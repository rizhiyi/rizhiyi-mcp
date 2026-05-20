import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import https from 'https';
import dotenv from 'dotenv';
import type { HttpClientConfig } from './types.js';

import { LogEaseClient } from './client.js';
import { parserRuleServerTools } from './tools.js';
import { ParserRuleModule } from './modules/parserrule.js';
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
const parserRuleModule = new ParserRuleModule(client);

const SERVER_LEVEL_INSTRUCTIONS = `使用说明:
1. 这是 parserrule 专用入口，只处理字段提取 / 解析规则，也就是 schema on write，不处理动态字段 fieldconfigs。
2. create/update 仍以“半结构化 body 透传”为主：请把完整规则主体放在 rule 或 changes 中，不要把字段平铺到顶层。
3. rule、changes、payload 支持对象，也兼容合法 JSON 字符串；conf、sink_conf 会在本地先校验是不是合法 JSON 字符串。
4. 推荐流程：先用 generate_parserrule_draft 基于样例日志生成初稿，再人工修正后调用 create/update，变更前后都建议调用 verify_parserrule 做样例日志验证。
5. list_parserrule_references 用于给后续语义化拼装提供模板，直接读取仓库内 docs/parserule.adoc 的整理结果，不依赖外部网络。
6. 输出默认使用 output_format=auto，以减少上下文消耗。
7. 遇到错误时，优先根据 suggestion 字段修正参数后重试一次。`;

const server = new Server(
    {
        name: 'rizhiyi-parserrule-server',
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
            case 'list_parserrules':
                return await handleToolExecution(() => parserRuleModule.listParserRules(parameters), parameters);
            case 'get_parserrule_detail':
                return await handleToolExecution(() => parserRuleModule.getParserRuleDetail(parameters), parameters);
            case 'generate_parserrule_draft':
                return await handleToolExecution(() => parserRuleModule.generateParserRuleDraft(parameters), parameters);
            case 'create_parserrule':
                return await handleToolExecution(() => parserRuleModule.createParserRule(parameters), parameters);
            case 'update_parserrule':
                return await handleToolExecution(() => parserRuleModule.updateParserRule(parameters), parameters);
            case 'delete_parserrule':
                return await handleToolExecution(() => parserRuleModule.deleteParserRule(parameters), parameters);
            case 'verify_parserrule':
                return await handleToolExecution(() => parserRuleModule.verifyParserRule(parameters), parameters);
            case 'list_parserrule_references':
                return await handleToolExecution(() => parserRuleModule.listParserRuleReferences(parameters), parameters);
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
            '请检查 parserrule 工具参数结构，尤其是 sample_logs、rule、changes 和 payload 的取值类型。'
        );
    }
});

server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
        tools: parserRuleServerTools,
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
                    error_code: result.error_code || 'PARSERRULE_EXECUTION_ERROR',
                    message: result.message || result.error,
                    suggestion: result.suggestion || '请检查解析规则参数结构后重试。',
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
    console.error('Rizhiyi ParserRule MCP 服务器已启动');
}

startServer().catch((error) => {
    console.error('启动服务器失败:', error);
    process.exit(1);
});
