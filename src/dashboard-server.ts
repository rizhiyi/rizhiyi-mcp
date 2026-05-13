import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import https from 'https';
import dotenv from 'dotenv';
import type { HttpClientConfig } from './types.js';

import { LogEaseClient } from './client.js';
import { dashboardServerTools } from './tools.js';
import { DashboardModule } from './modules/dashboard.js';
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
const dashboardModule = new DashboardModule(client);

const SERVER_LEVEL_INSTRUCTIONS = `使用说明:
1. 仪表盘配置是复杂 JSON body，请优先使用动作型工具：先 list tabs/panels 看现状，再按模板创建、按 spec 创建、调整 layout、增删改 panel。
2. panel 默认可用 tab_name + panel_title 定位；若存在同名 panel，请优先使用 list_dashboard_panels 返回的 panel_id 精准定位。
3. 若布局(grid)未提供，服务端会根据 panel 数量、图表类型和阅读顺序自动补齐更合理的默认布局；若无法命中细粒度规则，会回退到稳定的两列布局。
4. 当前写入优先支持 trend 和 eventsTable；pie、single、table 等属于 trend 的 chartType，而不是独立 panel 类型。
5. 输出默认使用 output_format=auto，以减少上下文消耗。
6. 遇到错误时，优先根据 suggestion 字段修正参数后重试一次。`;

const server = new Server(
    {
        name: 'rizhiyi-dashboard-server',
        version: '1.0.0',
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
        const { name, arguments: parameters } = request.params;

        switch (name) {
            case 'list_dashboard_tabs':
                return await handleToolExecution(() => dashboardModule.listDashboardTabs(parameters), parameters);
            case 'get_dashboard_tab_content':
                return await handleToolExecution(() => dashboardModule.getDashboardTabContent(parameters), parameters);
            case 'evaluate_dashboard_aesthetics':
                return await handleToolExecution(() => dashboardModule.evaluateDashboardAesthetics(parameters), parameters);
            case 'list_dashboard_panels':
                return await handleToolExecution(() => dashboardModule.listDashboardPanels(parameters), parameters);
            case 'create_dashboard_from_template':
                return await handleToolExecution(() => dashboardModule.createDashboardFromTemplate(parameters), parameters);
            case 'create_dashboard_from_spec':
                return await handleToolExecution(() => dashboardModule.createDashboardFromSpec(parameters), parameters);
            case 'update_dashboard_layout':
                return await handleToolExecution(() => dashboardModule.updateDashboardLayout(parameters), parameters);
            case 'add_dashboard_panel':
                return await handleToolExecution(() => dashboardModule.addDashboardPanel(parameters), parameters);
            case 'update_dashboard_panel':
                return await handleToolExecution(() => dashboardModule.updateDashboardPanel(parameters), parameters);
            case 'remove_dashboard_panel':
                return await handleToolExecution(() => dashboardModule.removeDashboardPanel(parameters), parameters);
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
            '请检查仪表盘名称、tabs、panels 结构以及 query 配置后重试。'
        );
    }
});

server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
        tools: dashboardServerTools,
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
                    error_code: result.error_code || 'DASHBOARD_EXECUTION_ERROR',
                    message: result.message || result.error,
                    suggestion: result.suggestion || '请检查仪表盘配置结构，特别是 tabs、panels、query 和 grid 字段。',
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
                includeRawJson: params.include_raw_json
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
    console.error('Rizhiyi Dashboard MCP 服务器已启动');
}

startServer().catch((error) => {
    console.error('启动服务器失败:', error);
    process.exit(1);
});
