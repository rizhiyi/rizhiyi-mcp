import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { isExecutedDirectly } from './runtime-entry.js';
import { LogEaseClient } from './client.js';
import { createHttpClientConfig, createServerContextForStdio, type ServerContext } from './config.js';
import { fieldConfigServerTools } from './tools.js';
import { FieldConfigModule } from './modules/fieldconfig.js';
import { registerToolDefinitions } from './mcp-tool-helpers.js';
import { buildToolSuccessResult, formatErrorPayload } from './result-formatter.js';

const SERVER_LEVEL_INSTRUCTIONS = `使用说明:
1. 这是动态字段专用入口，只处理 fieldconfigs，也就是 schema on read / 动态字段能力，不处理 parserrules 的字段提取能力。
2. 当前提供动态字段列表、fieldconfigs/verify、props 参考、transform 参考 4 类工具。
3. verify_fieldconfig 需要 rule 和 contents；contents 支持对象数组、字符串数组、单个对象、字符串，也兼容合法 JSON 字符串。
4. get_fieldconfig_props_reference 和 get_fieldconfig_transform_reference 会把原始配置整理成更适合 LLM 阅读的模板摘要。
5. 推荐流程：先 list_fieldconfigs 看现状，再按需 verify_fieldconfig 校验表达式，最后结合 props/transform 参考继续拼装动态字段配置。
6. 输出默认使用 output_format=auto，以减少上下文消耗。
7. 遇到错误时，优先根据 suggestion 字段修正参数后重试一次。`;

export function createFieldConfigServer(context: ServerContext): McpServer {
    const client = new LogEaseClient(createHttpClientConfig(context));
    const fieldConfigModule = new FieldConfigModule(client);

    const server = new McpServer(
        {
            name: 'rizhiyi-fieldconfig-server',
            version: '0.1.0',
        },
        {
            instructions: SERVER_LEVEL_INSTRUCTIONS,
        }
    );

    const handlers = {
        list_fieldconfigs: async (parameters: Record<string, unknown>) => handleToolExecution('list_fieldconfigs', () => fieldConfigModule.listFieldConfigs(), parameters),
        verify_fieldconfig: async (parameters: Record<string, unknown>) => handleToolExecution('verify_fieldconfig', () => fieldConfigModule.verifyFieldConfig(parameters), parameters),
        get_fieldconfig_props_reference: async (parameters: Record<string, unknown>) => handleToolExecution('get_fieldconfig_props_reference', () => fieldConfigModule.getFieldConfigPropsReference(), parameters),
        get_fieldconfig_transform_reference: async (parameters: Record<string, unknown>) => handleToolExecution('get_fieldconfig_transform_reference', () => fieldConfigModule.getFieldConfigTransformReference(), parameters)
    };

    registerToolDefinitions(server, fieldConfigServerTools, handlers);

    async function handleToolExecution(toolName: string, executor: () => Promise<any>, params: any) {
        try {
            const result = await executor();
            return formatResult(toolName, result, params);
        } catch (error: any) {
            return buildToolError(
                'TOOL_EXECUTION_EXCEPTION',
                `执行工具出错: ${String(error?.message || error)}`,
                '请检查动态字段参数结构后重试。'
            );
        }
    }

    function formatResult(toolName: string, result: any, params: any = {}): any {
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
    const server = createFieldConfigServer(createServerContextForStdio());
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('Rizhiyi FieldConfig MCP 服务器已启动');
}

if (isExecutedDirectly(import.meta.url)) {
    startServer().catch((error) => {
        console.error('启动服务器失败:', error);
        process.exit(1);
    });
}
