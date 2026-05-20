import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import https from 'https';
import dotenv from 'dotenv';
import type { HttpClientConfig } from './types.js';

import { LogEaseClient } from './client.js';
import { fieldConfigServerTools } from './tools.js';
import { FieldConfigModule } from './modules/fieldconfig.js';
import { formatErrorPayload, formatSuccessPayload } from './result-formatter.js';

dotenv.config({ path: ['.env.local', '.env'] });

const baseURL = process.env.LOGEASE_BASE_URL ?? 'http://127.0.0.1:8090';
const authHeader = process.env.LOGEASE_AUTH_HEADER || (process.env.LOGEASE_API_KEY ? `apikey ${process.env.LOGEASE_API_KEY}` : undefined);
const rejectUnauthorizedEnv = process.env.LOGEASE_TLS_REJECT_UNAUTHORIZED;
const rejectUnauthorized = typeof rejectUnauthorizedEnv !== 'undefined' ? rejectUnauthorizedEnv === 'true' : false;

if (!process.env.LOGEASE_BASE_URL) {
    console.warn('LOGEASE_BASE_URL 未设置，默认使用 http://127.0.0.1:8090');
}
if (!authHeader) {
    console.warn('未检测到认证信息（LOGEASE_AUTH_HEADER 或 LOGEASE_API_KEY），与服务交互可能失败');
}

const headers: Record<string, string> = {};
if (authHeader) {
    headers.Authorization = authHeader;
}

const httpClientConfig: HttpClientConfig = {
    baseURL,
    headers,
    httpsAgent: new https.Agent({ rejectUnauthorized })
};

const client = new LogEaseClient(httpClientConfig);
const fieldConfigModule = new FieldConfigModule(client);

const SERVER_LEVEL_INSTRUCTIONS = `使用说明:
1. 这是动态字段专用入口，只处理 fieldconfigs，也就是 schema on read / 动态字段能力，不处理 parserrules 的字段提取能力。
2. 当前提供动态字段列表、fieldconfigs/verify、props 参考、transform 参考 4 类工具。
3. verify_fieldconfig 需要 rule 和 contents；contents 支持对象数组、字符串数组、单个对象、字符串，也兼容合法 JSON 字符串。
4. get_fieldconfig_props_reference 和 get_fieldconfig_transform_reference 会把原始配置整理成更适合 LLM 阅读的模板摘要。
5. 推荐流程：先 list_fieldconfigs 看现状，再按需 verify_fieldconfig 校验表达式，最后结合 props/transform 参考继续拼装动态字段配置。
6. 输出默认使用 output_format=auto，以减少上下文消耗。
7. 遇到错误时，优先根据 suggestion 字段修正参数后重试一次。`;

const server = new Server(
    {
        name: 'rizhiyi-fieldconfig-server',
        version: '0.1.0',
        instructions: SERVER_LEVEL_INSTRUCTIONS,
    },
    {
        capabilities: {
            tools: {},
        },
    }
);

server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
        const { name, arguments: parameters = {} } = request.params;

        switch (name) {
            case 'list_fieldconfigs':
                return await handleToolExecution(() => fieldConfigModule.listFieldConfigs(), parameters);
            case 'verify_fieldconfig':
                return await handleToolExecution(() => fieldConfigModule.verifyFieldConfig(parameters), parameters);
            case 'get_fieldconfig_props_reference':
                return await handleToolExecution(() => fieldConfigModule.getFieldConfigPropsReference(), parameters);
            case 'get_fieldconfig_transform_reference':
                return await handleToolExecution(() => fieldConfigModule.getFieldConfigTransformReference(), parameters);
            default:
                return buildToolError(
                    'UNKNOWN_TOOL',
                    `未知的工具: ${name}`,
                    '请先调用 tools 列表确认可用工具名称，再重试。'
                );
        }
    } catch (error: any) {
        return buildToolError(
            'TOOL_EXECUTION_EXCEPTION',
            `执行工具出错: ${error.message}`,
            '请检查动态字段工具参数结构，尤其是 rule 和 contents 的取值类型。'
        );
    }
});

server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
        tools: fieldConfigServerTools,
    };
});

async function handleToolExecution(executor: () => Promise<any>, params: any) {
    const result = await executor();
    return formatResult(result, params);
}

function formatResult(result: any, params: any = {}): any {
    if (result.error) {
        return {
            isError: true,
            content: [{
                type: 'text',
                text: formatErrorPayload({
                    error_code: result.error_code || 'FIELDCONFIG_EXECUTION_ERROR',
                    message: result.message || result.error,
                    suggestion: result.suggestion || '请检查动态字段参数结构后重试。',
                    retryable: typeof result.retryable === 'boolean' ? result.retryable : true,
                    details: result.details
                })
            }]
        };
    }

    return {
        content: [{
            type: 'text',
            text: formatSuccessPayload(result.data || result, {
                outputFormat: params.output_format,
                includeRawJson: params.include_raw_json,
                rawJsonData: result.raw_data || result.data || result
            })
        }]
    };
}

function buildToolError(errorCode: string, message: string, suggestion: string): any {
    return {
        isError: true,
        content: [{
            type: 'text',
            text: formatErrorPayload({
                error_code: errorCode,
                message,
                suggestion,
                retryable: true
            })
        }]
    };
}

async function startServer(): Promise<void> {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('Rizhiyi FieldConfig MCP 服务器已启动');
}

startServer().catch((error) => {
    console.error('启动服务器失败:', error);
    process.exit(1);
});
