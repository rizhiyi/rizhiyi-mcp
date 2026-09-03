import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { isExecutedDirectly } from './runtime-entry.js';
import { LogEaseClient } from './client.js';
import { createHttpClientConfig, createServerContextForStdio, type ServerContext } from './config.js';
import { parserRuleServerTools } from './tools.js';
import { ParserRuleModule } from './modules/parserrule.js';
import { registerToolDefinitions } from './mcp-tool-helpers.js';
import { buildToolSuccessResult, formatErrorPayload } from './result-formatter.js';

const SERVER_LEVEL_INSTRUCTIONS = `使用说明:
1. 这是 parserrule 专用入口，只处理字段提取 / 解析规则，也就是 schema on write，不处理动态字段 fieldconfigs。
2. create/update 仍以“半结构化 body 透传”为主：请把完整规则主体放在 rule 或 changes 中，不要把字段平铺到顶层。
3. rule、changes、payload 支持对象，也兼容合法 JSON 字符串；conf、sink_conf 会在本地先校验是不是合法 JSON 字符串。
4. 推荐流程：先用 generate_parserrule_draft 基于样例日志生成初稿，再人工修正后调用 create/update，变更前后都建议调用 verify_parserrule 做样例日志验证。
5. list_parserrule_references 用于给后续语义化拼装提供模板，直接读取仓库内 docs/parserule.adoc 的整理结果，不依赖外部网络。
6. 输出默认使用 output_format=auto，以减少上下文消耗。
7. 遇到错误时，优先根据 suggestion 字段修正参数后重试一次。`;

export function createParserRuleServer(context: ServerContext): McpServer {
    const client = new LogEaseClient(createHttpClientConfig(context));
    const parserRuleModule = new ParserRuleModule(client);

    const server = new McpServer(
        {
            name: 'rizhiyi-parserrule-server',
            version: '0.1.0',
        },
        {
            instructions: SERVER_LEVEL_INSTRUCTIONS,
        }
    );

    const handlers = {
        list_parserrules: async (parameters: Record<string, unknown>) => handleToolExecution('list_parserrules', () => parserRuleModule.listParserRules(parameters), parameters),
        get_parserrule_detail: async (parameters: Record<string, unknown>) => handleToolExecution('get_parserrule_detail', () => parserRuleModule.getParserRuleDetail(parameters), parameters),
        generate_parserrule_draft: async (parameters: Record<string, unknown>) => handleToolExecution('generate_parserrule_draft', () => parserRuleModule.generateParserRuleDraft(parameters), parameters),
        create_parserrule: async (parameters: Record<string, unknown>) => handleToolExecution('create_parserrule', () => parserRuleModule.createParserRule(parameters), parameters),
        update_parserrule: async (parameters: Record<string, unknown>) => handleToolExecution('update_parserrule', () => parserRuleModule.updateParserRule(parameters), parameters),
        delete_parserrule: async (parameters: Record<string, unknown>) => handleToolExecution('delete_parserrule', () => parserRuleModule.deleteParserRule(parameters), parameters),
        verify_parserrule: async (parameters: Record<string, unknown>) => handleToolExecution('verify_parserrule', () => parserRuleModule.verifyParserRule(parameters), parameters),
        list_parserrule_references: async (parameters: Record<string, unknown>) => handleToolExecution('list_parserrule_references', () => parserRuleModule.listParserRuleReferences(parameters), parameters)
    };

    registerToolDefinitions(server, parserRuleServerTools, handlers);

    async function handleToolExecution(toolName: string, executor: () => Promise<any>, params: any) {
        const result = await executor();
        return formatResult(toolName, result, params);
    }

    function formatResult(toolName: string, result: any, params: any = {}): any {
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

        return buildToolSuccessResult(toolName, result.data || result, {
            outputFormat: params.output_format,
            includeRawJson: params.include_raw_json,
            rawJsonData: result.raw_data || result.data || result
        });
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

    return server;
}

async function startServer(): Promise<void> {
    const server = createParserRuleServer(createServerContextForStdio());
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('Rizhiyi ParserRule MCP 服务器已启动');
}

if (isExecutedDirectly(import.meta.url)) {
    startServer().catch((error) => {
        console.error('启动服务器失败:', error);
        process.exit(1);
    });
}
