import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { isExecutedDirectly } from './runtime-entry.js';
import { LogEaseClient } from './client.js';
import { createHttpClientConfig, createServerContextForStdio, type ServerContext } from './config.js';
import { chatSplServerTools } from './tools.js';
import { ChatSplModule } from './modules/chatspl.js';
import { registerToolDefinitions } from './mcp-tool-helpers.js';
import { buildToolSuccessResult, formatErrorPayload } from './result-formatter.js';

const SERVER_LEVEL_INSTRUCTIONS = `使用说明:
1. 这是 ChatSPL 专用入口，处理自然语言生成 SPL 和知识库规则管理。
2. chat_spl 工具将自然语言转换为 SPL 查询语句，支持深度思考模式。
3. 知识库规则管理：list/create/update/delete chatspl rules。
4. 规则格式: {"input":"自然语言描述","output":"SPL语句"}。
5. 遇到错误时，优先根据 suggestion 字段修正参数后重试一次。`;

export function createChatsplServer(context: ServerContext): McpServer {
    const client = new LogEaseClient(createHttpClientConfig(context));
    const httpClientConfig = createHttpClientConfig(context);
    const chatSplModule = new ChatSplModule(client, httpClientConfig);

    const server = new McpServer(
        {
            name: 'rizhiyi-chatspl-server',
            version: '0.1.0',
        },
        {
            instructions: SERVER_LEVEL_INSTRUCTIONS,
        }
    );

    const handlers = {
        chat_spl: async (parameters: Record<string, unknown>, extra: any) =>
            handleChatSpl(parameters, extra),
        list_chatspl_rules: async (parameters: Record<string, unknown>) =>
            handleToolExecution('list_chatspl_rules', () => chatSplModule.listRules(
                (parameters.page as number) || 1,
                (parameters.size as number) || 100
            ), parameters),
        create_chatspl_rule: async (parameters: Record<string, unknown>) =>
            handleToolExecution('create_chatspl_rule', () => chatSplModule.createRule(
                parameters.knowledge_text as string
            ), parameters),
        update_chatspl_rule: async (parameters: Record<string, unknown>) =>
            handleToolExecution('update_chatspl_rule', () => chatSplModule.updateRule(
                parameters.id as number,
                parameters.knowledge_text as string
            ), parameters),
        delete_chatspl_rule: async (parameters: Record<string, unknown>) =>
            handleToolExecution('delete_chatspl_rule', () => chatSplModule.deleteRule(
                parameters.id as number
            ), parameters),
        delete_chatspl_rules_batch: async (parameters: Record<string, unknown>) =>
            handleToolExecution('delete_chatspl_rules_batch', () => chatSplModule.deleteRulesBatch(
                parameters.ids as number[]
            ), parameters)
    };

    registerToolDefinitions(server, chatSplServerTools, handlers);

    async function handleChatSpl(parameters: Record<string, unknown>, extra: any): Promise<any> {
        const content = (parameters.content as string) || '';
        const deepThink = (parameters.deep_think as boolean) || false;
        const lang = (parameters.lang as string) || 'zh_CN';

        const totalSteps = 7;
        const stepNames = [
            '重写问题',
            '问题分类',
            '关键信息提取',
            '选择数据源',
            '收集相关数据',
            '生成SPL',
            '发送SPL'
        ];

        try {
            const result = await chatSplModule.chatSpl(content, deepThink, lang, async (step, index, total) => {
                const stepName = stepNames[index] || step;
                try {
                    await extra.sendNotification({
                        method: 'notifications/message',
                        params: {
                            level: 'info',
                            data: `[${index + 1}/${total}] ${stepName}`
                        }
                    });
                } catch { /* 客户端可能不支持，忽略 */ }
            });

            if (result.error) {
                return buildToolError(
                    'CHAT_SPL_FAILED',
                    result.error,
                    result.suggestion || '请检查输入后重试。'
                );
            }

            return buildToolSuccessResult('chat_spl', result.data);
        } catch (error: any) {
            return buildToolError(
                'CHAT_SPL_EXCEPTION',
                `执行 chat_spl 出错: ${String(error?.message || error)}`,
                '请检查网络连接和日志易服务状态后重试。'
            );
        }
    }

    async function handleToolExecution(toolName: string, executor: () => Promise<any>, params: any) {
        try {
            const result = await executor();
            return formatResult(toolName, result, params);
        } catch (error: any) {
            return buildToolError(
                'TOOL_EXECUTION_EXCEPTION',
                `执行工具出错: ${String(error?.message || error)}`,
                '请检查参数后重试。'
            );
        }
    }

    function formatResult(toolName: string, result: any, params: any = {}): any {
        if (result.error) {
            return {
                isError: true,
                content: [{
                    type: 'text' as const,
                    text: formatErrorPayload({
                        error_code: result.error_code || 'UPSTREAM_ERROR',
                        message: result.error,
                        suggestion: result.suggestion,
                        details: result.details
                    })
                }]
            };
        }

        return buildToolSuccessResult(toolName, result.data);
    }

    function buildToolError(errorCode: string, message: string, suggestion: string): any {
        return {
            isError: true,
            content: [{
                type: 'text' as const,
                text: formatErrorPayload({
                    error_code: errorCode,
                    message,
                    suggestion
                })
            }]
        };
    }

    return server;
}

if (isExecutedDirectly(import.meta.url)) {
    const context = createServerContextForStdio();
    const server = createChatsplServer(context);
    const transport = new StdioServerTransport();
    server.connect(transport).catch(console.error);
}
