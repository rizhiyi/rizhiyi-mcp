import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ServerContext } from './config.js';
import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { deriveToolAnnotations } from './tool-annotations.js';
import type { ToolDefinition } from './types.js';
import { createUsageLogEntry, type UsageLogStatus } from './usage-log.js';
import {
    applyOutputGuardrails,
    assessGeneratedSpl,
    assessToolArguments,
    guardrailConfigFromRuntime,
    GuardrailAssessment,
    mergeAssessments
} from './spl-guardrails.js';

type JsonSchema = {
    type?: string;
    description?: string;
    enum?: unknown[];
    default?: unknown;
    minimum?: number;
    maximum?: number;
    minLength?: number;
    maxLength?: number;
    items?: JsonSchema;
    properties?: Record<string, JsonSchema>;
    required?: string[];
    additionalProperties?: boolean;
};

type ToolHandler = (args: Record<string, unknown>, extra: any) => Promise<any> | any;

function applyCommonJsonSchemaRules(schema: z.ZodTypeAny, jsonSchema: JsonSchema): z.ZodTypeAny {
    let result = schema;

    if (jsonSchema.description) {
        result = result.describe(jsonSchema.description);
    }

    if (typeof jsonSchema.default !== 'undefined') {
        result = result.default(jsonSchema.default as never);
    }

    return result;
}

function convertJsonSchemaProperty(jsonSchema: JsonSchema): z.ZodTypeAny {
    const schemaType = jsonSchema.type ?? 'string';

    if (Array.isArray(jsonSchema.enum) && jsonSchema.enum.length > 0) {
        const enumValues = jsonSchema.enum;
        if (enumValues.every((item) => typeof item === 'string')) {
            return applyCommonJsonSchemaRules(z.enum(enumValues as [string, ...string[]]), jsonSchema);
        }

        if (enumValues.length === 1) {
            return applyCommonJsonSchemaRules(z.literal(enumValues[0] as string | number | boolean | null), jsonSchema);
        }

        return applyCommonJsonSchemaRules(
            z.union(enumValues.map((item) => z.literal(item as string | number | boolean | null)) as [z.ZodLiteral<any>, z.ZodLiteral<any>, ...z.ZodLiteral<any>[]]),
            jsonSchema
        );
    }

    switch (schemaType) {
        case 'string': {
            let stringSchema = z.string();
            if (typeof jsonSchema.minLength === 'number') {
                stringSchema = stringSchema.min(jsonSchema.minLength);
            }
            if (typeof jsonSchema.maxLength === 'number') {
                stringSchema = stringSchema.max(jsonSchema.maxLength);
            }
            return applyCommonJsonSchemaRules(stringSchema, jsonSchema);
        }
        case 'integer': {
            let numberSchema = z.number().int();
            if (typeof jsonSchema.minimum === 'number') {
                numberSchema = numberSchema.min(jsonSchema.minimum);
            }
            if (typeof jsonSchema.maximum === 'number') {
                numberSchema = numberSchema.max(jsonSchema.maximum);
            }
            return applyCommonJsonSchemaRules(numberSchema, jsonSchema);
        }
        case 'number': {
            let numberSchema = z.number();
            if (typeof jsonSchema.minimum === 'number') {
                numberSchema = numberSchema.min(jsonSchema.minimum);
            }
            if (typeof jsonSchema.maximum === 'number') {
                numberSchema = numberSchema.max(jsonSchema.maximum);
            }
            return applyCommonJsonSchemaRules(numberSchema, jsonSchema);
        }
        case 'boolean':
            return applyCommonJsonSchemaRules(z.boolean(), jsonSchema);
        case 'array': {
            const itemSchema = jsonSchema.items ? convertJsonSchemaProperty(jsonSchema.items) : z.any();
            return applyCommonJsonSchemaRules(z.array(itemSchema), jsonSchema);
        }
        case 'object': {
            const shape = jsonSchemaObjectToZodShape(jsonSchema);
            const baseObjectSchema = z.object(shape);
            const objectSchema = jsonSchema.additionalProperties ? baseObjectSchema.catchall(z.any()) : baseObjectSchema.strict();
            return applyCommonJsonSchemaRules(objectSchema, jsonSchema);
        }
        default:
            return applyCommonJsonSchemaRules(z.any(), jsonSchema);
    }
}

export function jsonSchemaObjectToZodShape(jsonSchema: JsonSchema): Record<string, z.ZodTypeAny> {
    const requiredSet = new Set(jsonSchema.required || []);
    const properties = jsonSchema.properties || {};

    return Object.fromEntries(
        Object.entries(properties).map(([name, propertySchema]) => {
            let fieldSchema = convertJsonSchemaProperty(propertySchema);
            if (!requiredSet.has(name) && typeof propertySchema.default === 'undefined') {
                fieldSchema = fieldSchema.optional();
            }
            return [name, fieldSchema];
        })
    );
}

export function registerToolDefinitions(
    server: McpServer,
    tools: ToolDefinition[],
    handlers: Record<string, ToolHandler>,
    context?: ServerContext,
    annotationsByName: Record<string, ToolAnnotations> = {}
): void {
    for (const tool of tools) {
        const handler = handlers[tool.name];
        if (!handler) {
            throw new Error(`工具 ${tool.name} 缺少处理函数。`);
        }

        server.registerTool(
            tool.name,
            {
                description: tool.description,
                inputSchema: jsonSchemaObjectToZodShape(tool.inputSchema as JsonSchema),
                annotations: {
                    ...deriveToolAnnotations(tool.name),
                    ...(annotationsByName[tool.name] || {})
                }
            },
            async (args, extra) => {
                const startedAt = Date.now();
                const decision = context?.rateLimiter?.consume(
                    context.requestMeta.routeName || 'unknown',
                    tool.name
                );
                if (decision && !decision.allowed) {
                    const payload = {
                        error_code: 'RATE_LIMIT_EXCEEDED',
                        message: '工具调用频率已超过当前固定窗口上限。',
                        suggestion: `请在 ${decision.retry_after_seconds} 秒后重试。`,
                        retryable: true,
                        details: decision
                    };
                    const result = {
                        content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
                        structuredContent: payload,
                        isError: true
                    };
                    await writeUsageLogSafely(context, tool.name, 'ok-limited', startedAt, payload.error_code);
                    return result;
                }
                let activeAssessment: GuardrailAssessment | undefined;
                try {
                    const guardrailConfig = context
                        ? guardrailConfigFromRuntime(context.runtimeConfig)
                        : undefined;
                    let assessment = guardrailConfig
                        ? assessToolArguments(
                            guardrailConfig,
                            context?.requestMeta.routeName || 'unknown',
                            tool.name,
                            args as Record<string, unknown>
                        )
                        : undefined;
                    activeAssessment = assessment;

                    if (assessment?.shouldBlock) {
                        const result = buildGuardrailBlockedResult(assessment);
                        await writeUsageLogSafely(
                            context,
                            tool.name,
                            'error',
                            startedAt,
                            'SPL_GUARDRAIL_BLOCKED',
                            assessment.toDetails()
                        );
                        return result;
                    }

                    const invocation = Promise.resolve(handler(args as Record<string, unknown>, extra));
                    let result: any;
                    if (
                        guardrailConfig?.enabled
                        && guardrailConfig.mode === 'enforce'
                        && (assessment?.queries.length || context?.requestMeta.routeName === 'log-tools')
                    ) {
                        result = await withTimeout(
                            invocation,
                            guardrailConfig.execTimeoutSeconds * 1000,
                            guardrailConfig.execTimeoutSeconds
                        );
                    } else {
                        result = await invocation;
                    }

                    if (guardrailConfig && assessment) {
                        const generatedAssessment = assessGeneratedSpl(
                            guardrailConfig,
                            context?.requestMeta.routeName || 'unknown',
                            tool.name,
                            result?.structuredContent
                        );
                        assessment = mergeAssessments(assessment, generatedAssessment);
                        activeAssessment = assessment;
                        if (generatedAssessment.shouldBlock) {
                            result = buildGuardrailBlockedResult(assessment);
                        } else {
                            result = applyGuardrailsToResult(result, assessment, guardrailConfig);
                        }
                    }
                    await writeUsageLogSafely(
                        context,
                        tool.name,
                        result?.isError ? 'error' : 'ok',
                        startedAt,
                        extractErrorCode(result),
                        result?.structuredContent?.guardrail
                    );
                    return result;
                } catch (error: any) {
                    if (error?.code === 'SPL_EXECUTION_TIMEOUT') {
                        const guardrail = activeAssessment?.toDetails();
                        const payload = {
                            error_code: 'SPL_EXECUTION_TIMEOUT',
                            message: error.message,
                            suggestion: '请缩小 time_range、收紧查询条件或拆分查询后重试。',
                            retryable: true,
                            details: {
                                timeout_seconds: error.timeoutSeconds,
                                guardrail
                            },
                            guardrail
                        };
                        const result = {
                            content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
                            structuredContent: payload,
                            isError: true
                        };
                        await writeUsageLogSafely(
                            context,
                            tool.name,
                            'error',
                            startedAt,
                            payload.error_code,
                            guardrail
                        );
                        return result;
                    }
                    await writeUsageLogSafely(
                        context,
                        tool.name,
                        'error',
                        startedAt,
                        extractThrownErrorCode(error),
                        activeAssessment?.toDetails()
                    );
                    throw error;
                }
            }
        );
    }
}

async function writeUsageLogSafely(
    context: ServerContext | undefined,
    toolName: string,
    status: UsageLogStatus,
    startedAt: number,
    errorCode?: string,
    guardrail?: Record<string, any>
): Promise<void> {
    if (!context?.usageLogger) {
        return;
    }

    try {
        const now = new Date();
        await context.usageLogger.write(createUsageLogEntry({
            session_id: context.requestMeta.sessionId || null,
            serverName: context.requestMeta.serverName || context.requestMeta.routeName || 'unknown',
            tool: toolName,
            routeName: context.requestMeta.routeName || 'unknown',
            status,
            duration_ms: Math.max(0, now.getTime() - startedAt),
            user: context.authContext.username || null,
            error_code: errorCode || null,
            guardrail_action: guardrail?.action || null,
            guardrail_risk_score: Number.isInteger(guardrail?.risk_score) ? Number(guardrail?.risk_score) : null,
            guardrail_denied_commands: Array.isArray(guardrail?.denied_commands)
                ? guardrail.denied_commands.map(String)
                : []
        }, now));
    } catch (error) {
        console.error('写入 MCP 使用日志失败:', error);
    }
}

function buildGuardrailBlockedResult(assessment: GuardrailAssessment): any {
    const details = assessment.toDetails();
    const payload = {
        error_code: 'SPL_GUARDRAIL_BLOCKED',
        message: assessment.message,
        suggestion: '请移除写入、删除、导出或外部访问命令，缩小时间范围，并为子搜索增加显式限额后重试。',
        retryable: false,
        details,
        guardrail: details
    };
    return {
        content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
        structuredContent: payload,
        isError: true
    };
}

function applyGuardrailsToResult(
    result: any,
    assessment: GuardrailAssessment,
    config: ReturnType<typeof guardrailConfigFromRuntime>
): any {
    if (!config.enabled || !result) return result;
    const structured = applyOutputGuardrails(result.structuredContent, config);
    assessment.sanitizedValues += structured.sanitizedValues;
    assessment.truncatedEvents += structured.truncatedEvents;
    assessment.truncatedPaths.push(...structured.truncatedPaths);

    const structuredContent: Record<string, unknown> = structured.data && typeof structured.data === 'object' && !Array.isArray(structured.data)
        ? { ...(structured.data as Record<string, unknown>) }
        : { value: structured.data ?? null };

    let content: any[];
    if (structured.truncatedEvents > 0) {
        content = [{ type: 'text', text: JSON.stringify(structuredContent, null, 2) }];
    } else {
        const guardedContent = applyOutputGuardrails(result.content, config);
        content = Array.isArray(guardedContent.data) ? guardedContent.data : [];
    }

    if (assessment.queries.length > 0 || assessment.sanitizedValues > 0 || assessment.truncatedEvents > 0) {
        structuredContent.guardrail = assessment.toDetails();
        content = [...content, { type: 'text', text: JSON.stringify({ guardrail: assessment.toDetails() }, null, 2) }];
    }
    return { ...result, structuredContent, content };
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutSeconds: number): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    try {
        return await Promise.race([
            promise,
            new Promise<T>((_resolve, reject) => {
                timer = setTimeout(() => {
                    const error: any = new Error(`SPL 工具执行超过护栏时长上限 ${timeoutSeconds} 秒。`);
                    error.code = 'SPL_EXECUTION_TIMEOUT';
                    error.timeoutSeconds = timeoutSeconds;
                    reject(error);
                }, timeoutMs);
            })
        ]);
    } finally {
        if (timer) clearTimeout(timer);
    }
}

function extractErrorCode(result: any): string | undefined {
    const value = result?.structuredContent?.error_code;
    return typeof value === 'string' && value ? value : undefined;
}

function extractThrownErrorCode(error: any): string | undefined {
    const value = error?.error_code || error?.code;
    if (typeof value === 'string' && value) {
        return value;
    }
    if (typeof value === 'number') {
        return String(value);
    }
    return undefined;
}
