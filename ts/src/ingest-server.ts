import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { isExecutedDirectly } from './runtime-entry.js';
import { LogEaseClient } from './client.js';
import { createHttpClientConfig, createServerContextForStdio, type ServerContext } from './config.js';
import { ingestServerTools } from './tools.js';
import { IngestModule } from './modules/ingest.js';
import { registerToolDefinitions } from './mcp-tool-helpers.js';
import { buildToolSuccessResult, formatErrorPayload } from './result-formatter.js';

const SERVER_LEVEL_INSTRUCTIONS = `使用说明:
1. 这是 ingest 专用入口，只处理 Agent 只读、Agent 分组管理和 pipeline 管理。
2. 初版只支持 pipeline 这一种采集配置方案，不处理 agent/config 和 agentgroup/inputs。
3. 推荐流程：先 list_agent_groups / list_pipelines 看现状，再做 add_agents_to_group、create_pipeline、replace_pipeline_groups 等变更。
4. create_pipeline / update_pipeline 的 detail 支持对象、数组或合法 JSON 字符串；工具会先做本地 JSON 合法性检查。
5. 输出默认使用 output_format=auto，以减少上下文消耗。
6. 遇到错误时，优先根据 suggestion 字段修正参数后重试一次。`;

export function createIngestServer(context: ServerContext): McpServer {
    const client = new LogEaseClient(createHttpClientConfig(context));
    const ingestModule = new IngestModule(client);

    const server = new McpServer(
        {
            name: 'rizhiyi-ingest-server',
            version: '0.1.0',
        },
        {
            instructions: SERVER_LEVEL_INSTRUCTIONS,
        }
    );

    const handlers = {
        list_agents: async (parameters: Record<string, unknown>) => handleToolExecution('list_agents', () => ingestModule.listAgents(parameters), parameters),
        list_agent_groups: async (parameters: Record<string, unknown>) => handleToolExecution('list_agent_groups', () => ingestModule.listAgentGroups(parameters), parameters),
        get_agent_group_detail: async (parameters: Record<string, unknown>) => handleToolExecution('get_agent_group_detail', () => ingestModule.getAgentGroupDetail(parameters), parameters),
        create_agent_group: async (parameters: Record<string, unknown>) => handleToolExecution('create_agent_group', () => ingestModule.createAgentGroup(parameters), parameters),
        update_agent_group: async (parameters: Record<string, unknown>) => handleToolExecution('update_agent_group', () => ingestModule.updateAgentGroup(parameters), parameters),
        delete_agent_group: async (parameters: Record<string, unknown>) => handleToolExecution('delete_agent_group', () => ingestModule.deleteAgentGroup(parameters), parameters),
        add_agents_to_group: async (parameters: Record<string, unknown>) => handleToolExecution('add_agents_to_group', () => ingestModule.addAgentsToGroup(parameters), parameters),
        remove_agents_from_group: async (parameters: Record<string, unknown>) => handleToolExecution('remove_agents_from_group', () => ingestModule.removeAgentsFromGroup(parameters), parameters),
        list_pipeline_schemas: async (parameters: Record<string, unknown>) => handleToolExecution('list_pipeline_schemas', () => ingestModule.listPipelineSchemas(parameters), parameters),
        list_pipelines: async (parameters: Record<string, unknown>) => handleToolExecution('list_pipelines', () => ingestModule.listPipelines(parameters), parameters),
        get_pipeline_detail: async (parameters: Record<string, unknown>) => handleToolExecution('get_pipeline_detail', () => ingestModule.getPipelineDetail(parameters), parameters),
        create_pipeline: async (parameters: Record<string, unknown>) => handleToolExecution('create_pipeline', () => ingestModule.createPipeline(parameters), parameters),
        update_pipeline: async (parameters: Record<string, unknown>) => handleToolExecution('update_pipeline', () => ingestModule.updatePipeline(parameters), parameters),
        delete_pipeline: async (parameters: Record<string, unknown>) => handleToolExecution('delete_pipeline', () => ingestModule.deletePipeline(parameters), parameters),
        get_pipeline_groups: async (parameters: Record<string, unknown>) => handleToolExecution('get_pipeline_groups', () => ingestModule.getPipelineGroups(parameters), parameters),
        add_pipeline_groups: async (parameters: Record<string, unknown>) => handleToolExecution('add_pipeline_groups', () => ingestModule.addPipelineGroups(parameters), parameters),
        replace_pipeline_groups: async (parameters: Record<string, unknown>) => handleToolExecution('replace_pipeline_groups', () => ingestModule.replacePipelineGroups(parameters), parameters),
        delete_pipeline_groups: async (parameters: Record<string, unknown>) => handleToolExecution('delete_pipeline_groups', () => ingestModule.deletePipelineGroups(parameters), parameters),
        get_pipeline_agent_status: async (parameters: Record<string, unknown>) => handleToolExecution('get_pipeline_agent_status', () => ingestModule.getPipelineAgentStatus(parameters), parameters),
        list_available_pipeline_agents: async (parameters: Record<string, unknown>) => handleToolExecution('list_available_pipeline_agents', () => ingestModule.listAvailablePipelineAgents(parameters), parameters),
        list_available_pipeline_agent_groups: async (parameters: Record<string, unknown>) => handleToolExecution('list_available_pipeline_agent_groups', () => ingestModule.listAvailablePipelineAgentGroups(parameters), parameters),
    };

    registerToolDefinitions(server, ingestServerTools, handlers);

    async function handleToolExecution(toolName: string, executor: () => Promise<any>, params: any) {
        try {
            const result = await executor();
            return formatResult(toolName, result, params);
        } catch (error: any) {
            return buildToolError(
                'TOOL_EXECUTION_EXCEPTION',
                `执行工具出错: ${String(error?.message || error)}`,
                '请检查参数结构后重试。'
            );
        }
    }

    function formatResult(toolName: string, result: any, params: any = {}): any {
        if (result?.error) {
            return {
                isError: true,
                content: [{
                    type: 'text',
                    text: formatErrorPayload({
                        error_code: result.error_code || 'INGEST_EXECUTION_ERROR',
                        message: result.message || result.error,
                        suggestion: result.suggestion || '请检查 ingest 参数结构后重试。',
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
    const server = createIngestServer(createServerContextForStdio());
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('Rizhiyi Ingest MCP 服务器已启动');
}

if (isExecutedDirectly(import.meta.url)) {
    startServer().catch((error) => {
        console.error('启动服务器失败:', error);
        process.exit(1);
    });
}
