import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { isExecutedDirectly } from './runtime-entry.js';
import { LogEaseClient } from './client.js';
import { createHttpClientConfig, createServerContextForStdio, type ServerContext } from './config.js';
import { dashboardServerTools } from './tools.js';
import { DashboardModule } from './modules/dashboard.js';
import { registerToolDefinitions } from './mcp-tool-helpers.js';
import { buildToolSuccessResult, formatErrorPayload } from './result-formatter.js';

const SERVER_LEVEL_INSTRUCTIONS = `使用说明:
1. 仪表盘配置是复杂 JSON body，请优先使用动作型工具：先 list tabs/panels 看现状，再按模板创建、按 spec 创建、调整 layout、增删改 panel。
2. panel 默认可用 tab_name + panel_title 定位；若存在同名 panel，请优先使用 list_dashboard_panels 返回的 panel_id 精准定位。
3. 若布局(grid)未提供，服务端会根据 panel 数量、图表类型和阅读顺序自动补齐更合理的默认布局；若无法命中细粒度规则，会回退到稳定的两列布局。
4. 当前写入优先支持 trend 和 eventsTable；pie、single、table 等属于 trend 的 chartType，而不是独立 panel 类型。
5. 输出默认使用 output_format=auto，以减少上下文消耗。
6. 推荐创图流程：
   - 先通过 \`log-tools\` 获取数据概要，确认时间范围内是否有数据、有哪些可用字段。
   - 再编写最小可运行的 query，不要直接假设字段名一定正确。
   - 在创建或更新图表前，先调用 \`log-tools\` 的 \`query_precheck\`，检查语法、是否有数据、字段映射是否匹配。
   - 只有 query 预检通过后，才调用 \`create_dashboard_from_spec\`、\`add_dashboard_panel\` 或 \`update_dashboard_panel\`。
7. 若页面无图，优先排查 query 无数据、时间范围不合适、字段名错误，再排查 chartType 模板。
8. 对 \`networkflow\`、\`tracing\`、\`chord\`、\`sankey\`、\`force\`、\`attackmap\` 这类依赖显式字段映射的图表，不要跳过数据概要和 query 预检步骤。
9. 遇到错误时，优先根据 suggestion 字段修正参数后重试一次。`;

export function createDashboardServer(context: ServerContext): McpServer {
    const client = new LogEaseClient(createHttpClientConfig(context));
    const dashboardModule = new DashboardModule(client);

    const server = new McpServer(
        {
            name: 'rizhiyi-dashboard-server',
            version: '1.0.0',
        },
        {
            instructions: SERVER_LEVEL_INSTRUCTIONS,
        }
    );

    const handlers = {
        list_dashboard_tabs: async (parameters: Record<string, unknown>) => handleToolExecution('list_dashboard_tabs', () => dashboardModule.listDashboardTabs(parameters), parameters),
        get_dashboard_tab_content: async (parameters: Record<string, unknown>) => handleToolExecution('get_dashboard_tab_content', () => dashboardModule.getDashboardTabContent(parameters), parameters),
        clone_dashboard_tab: async (parameters: Record<string, unknown>) => handleToolExecution('clone_dashboard_tab', () => dashboardModule.cloneDashboardTab(parameters), parameters),
        evaluate_dashboard_aesthetics: async (parameters: Record<string, unknown>) => handleToolExecution('evaluate_dashboard_aesthetics', () => dashboardModule.evaluateDashboardAesthetics(parameters), parameters),
        list_dashboard_panels: async (parameters: Record<string, unknown>) => handleToolExecution('list_dashboard_panels', () => dashboardModule.listDashboardPanels(parameters), parameters),
        create_dashboard_from_template: async (parameters: Record<string, unknown>) => handleToolExecution('create_dashboard_from_template', () => dashboardModule.createDashboardFromTemplate(parameters), parameters),
        create_dashboard_from_spec: async (parameters: Record<string, unknown>) => handleToolExecution('create_dashboard_from_spec', () => dashboardModule.createDashboardFromSpec(parameters), parameters),
        update_dashboard_layout: async (parameters: Record<string, unknown>) => handleToolExecution('update_dashboard_layout', () => dashboardModule.updateDashboardLayout(parameters), parameters),
        add_dashboard_panel: async (parameters: Record<string, unknown>) => handleToolExecution('add_dashboard_panel', () => dashboardModule.addDashboardPanel(parameters), parameters),
        update_dashboard_panel: async (parameters: Record<string, unknown>) => handleToolExecution('update_dashboard_panel', () => dashboardModule.updateDashboardPanel(parameters), parameters),
        remove_dashboard_panel: async (parameters: Record<string, unknown>) => handleToolExecution('remove_dashboard_panel', () => dashboardModule.removeDashboardPanel(parameters), parameters)
    };

    registerToolDefinitions(server, dashboardServerTools, handlers);

    async function handleToolExecution(toolName: string, executor: () => Promise<any>, params: any) {
        try {
            const result = await executor();
            return formatResult(toolName, result, params);
        } catch (error: any) {
            return buildToolError(
                'TOOL_EXECUTION_EXCEPTION',
                `执行工具出错: ${String(error?.message || error)}`,
                '请检查仪表盘配置结构，特别是 tabs、panels、query 和 grid 字段。'
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
                        error_code: result.error_code || 'DASHBOARD_EXECUTION_ERROR',
                        message: result.message || result.error,
                        suggestion: result.suggestion || '请检查仪表盘配置结构，特别是 tabs、panels、query 和 grid 字段。',
                        retryable: typeof result.retryable === 'boolean' ? result.retryable : true,
                        details: result.details
                    })
                }]
            };
        }

        return buildToolSuccessResult(toolName, result.data || result, {
            outputFormat: params.output_format,
            includeRawJson: params.include_raw_json
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
    const server = createDashboardServer(createServerContextForStdio());
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('Rizhiyi Dashboard MCP 服务器已启动');
}

if (isExecutedDirectly(import.meta.url)) {
    startServer().catch((error) => {
        console.error('启动服务器失败:', error);
        process.exit(1);
    });
}
