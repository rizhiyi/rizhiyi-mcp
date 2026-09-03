import { LogEaseClient } from '../client.js';
import { requestSse, type SseChatResult } from '../sse-client.js';
import type { HttpClientConfig } from '../types.js';

export interface ChatProgressCallback {
    (step: string, index: number, total: number): void;
}

export class ChatSplModule {
    constructor(
        private client: LogEaseClient,
        private httpClientConfig: HttpClientConfig
    ) {}

    async listRules(page = 1, size = 100): Promise<any> {
        const response = await this.client.get('/api/v3/chatsplrules/', { page, size });
        if (response.error) {
            return response;
        }

        if (response.data && typeof response.data === 'object' && (response.data as any).result === false) {
            return this.buildError(
                'UPSTREAM_BUSINESS_ERROR',
                'list_chatspl_rules 上游接口返回失败。',
                '请稍后重试。',
                response.data
            );
        }

        const data = response.data as any;
        const objects = Array.isArray(data?.objects) ? data.objects : [];
        const items = objects.map((item: any) => ({
            id: item.id,
            input: this.tryParseKnowledgeInput(item.knowledge_text),
            output: this.tryParseKnowledgeOutput(item.knowledge_text),
            knowledge_text: item.knowledge_text,
            creator_id: item.creator_id,
            domain_id: item.domain_id,
            create_time: item.create_time,
            update_time: item.update_time
        }));

        return {
            data: {
                total: data?.meta?.total ?? items.length,
                items
            }
        };
    }

    async createRule(knowledgeText: string): Promise<any> {
        if (!knowledgeText || !knowledgeText.trim()) {
            return this.buildError(
                'MISSING_REQUIRED_PARAM',
                'create_chatspl_rule 需要 knowledge_text。',
                '请提供 knowledge_text，格式为 JSON 字符串: {"input":"自然语言描述","output":"SPL语句"}'
            );
        }

        const parsed = this.validateKnowledgeText(knowledgeText);
        if (parsed.error) {
            return parsed.error;
        }

        const response = await this.client.post('/api/v3/chatsplrules/', { knowledge_text: knowledgeText });
        if (response.error) {
            return response;
        }

        if (response.data && typeof response.data === 'object' && (response.data as any).result === false) {
            return this.buildError(
                'UPSTREAM_BUSINESS_ERROR',
                'create_chatspl_rule 上游接口返回失败。',
                '请检查 knowledge_text 格式后重试。',
                response.data
            );
        }

        return { data: { success: true } };
    }

    async updateRule(id: number, knowledgeText: string): Promise<any> {
        if (!id || id <= 0) {
            return this.buildError(
                'MISSING_REQUIRED_PARAM',
                'update_chatspl_rule 需要有效的 id。',
                '请提供要更新的规则 ID。'
            );
        }

        if (!knowledgeText || !knowledgeText.trim()) {
            return this.buildError(
                'MISSING_REQUIRED_PARAM',
                'update_chatspl_rule 需要 knowledge_text。',
                '请提供 knowledge_text，格式为 JSON 字符串: {"input":"自然语言描述","output":"SPL语句"}'
            );
        }

        const parsed = this.validateKnowledgeText(knowledgeText);
        if (parsed.error) {
            return parsed.error;
        }

        const response = await this.client.put(`/api/v3/chatsplrules/${id}/`, { knowledge_text: knowledgeText });
        if (response.error) {
            return response;
        }

        if (response.data && typeof response.data === 'object' && (response.data as any).result === false) {
            return this.buildError(
                'UPSTREAM_BUSINESS_ERROR',
                'update_chatspl_rule 上游接口返回失败。',
                '请检查规则 ID 和 knowledge_text 格式后重试。',
                response.data
            );
        }

        return { data: { success: true } };
    }

    async deleteRule(id: number): Promise<any> {
        if (!id || id <= 0) {
            return this.buildError(
                'MISSING_REQUIRED_PARAM',
                'delete_chatspl_rule 需要有效的 id。',
                '请提供要删除的规则 ID。'
            );
        }

        const response = await this.client.delete(`/api/v3/chatsplrules/${id}/`);
        if (response.error) {
            return response;
        }

        if (response.data && typeof response.data === 'object' && (response.data as any).result === false) {
            return this.buildError(
                'UPSTREAM_BUSINESS_ERROR',
                'delete_chatspl_rule 上游接口返回失败。',
                '请检查规则 ID 是否存在。',
                response.data
            );
        }

        return { data: { success: true } };
    }

    async deleteRulesBatch(ids: number[]): Promise<any> {
        if (!ids || ids.length === 0) {
            return this.buildError(
                'MISSING_REQUIRED_PARAM',
                'delete_chatspl_rules_batch 需要 id_list。',
                '请提供要删除的规则 ID 列表。'
            );
        }

        const idList = ids.join(',');
        const response = await this.client.delete('/api/v3/chatsplrules/set/', { id_list: idList });
        if (response.error) {
            return response;
        }

        if (response.data && typeof response.data === 'object' && (response.data as any).result === false) {
            return this.buildError(
                'UPSTREAM_BUSINESS_ERROR',
                'delete_chatspl_rules_batch 上游接口返回失败。',
                '请检查规则 ID 列表后重试。',
                response.data
            );
        }

        return { data: { success: true } };
    }

    async chatSpl(
        content: string,
        deepThink = false,
        lang = 'zh_CN',
        onProgress?: ChatProgressCallback
    ): Promise<any> {
        if (!content || !content.trim()) {
            return this.buildError(
                'MISSING_REQUIRED_PARAM',
                'chat_spl 需要 content。',
                '请提供自然语言描述，例如："检索今天的错误日志"。'
            );
        }

        const baseUrl = this.httpClientConfig.baseURL;
        const authHeader = this.httpClientConfig.headers?.Authorization || '';
        const username = this.httpClientConfig.username;

        let url = `${baseUrl.replace(/\/+$/, '')}/api/v3/copilot/chat/?lang=${encodeURIComponent(lang)}&agent=chatspl`;
        if (username) {
            url += `&username=${encodeURIComponent(username)}`;
        }
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            Authorization: authHeader
        };

        const body = JSON.stringify({ content, deep_think: deepThink });

        const totalSteps = 7;
        let stepIndex = 0;

        let result: SseChatResult;
        try {
            result = await requestSse({
                url,
                headers,
                body,
                timeoutMs: 120000,
                onEvent: (evt) => {
                    if (evt.event === 'CREATE_STEP') {
                        try {
                            const parsed = JSON.parse(evt.data);
                            if (onProgress && parsed.details?.tool_name) {
                                onProgress(parsed.details.tool_name, stepIndex, totalSteps);
                            }
                        } catch { /* ignore */ }
                        stepIndex++;
                    }
                }
            });
        } catch (err: any) {
            return this.buildError(
                'SSE_REQUEST_FAILED',
                `chat_spl SSE 请求失败: ${err?.message || err}`,
                '请检查网络连接和日志易服务状态。'
            );
        }

        if (!result.spl) {
            return this.buildError(
                'NO_SPL_GENERATED',
                'chat_spl 未能生成 SPL。',
                '请尝试更具体的描述，或检查 ChatSPL 服务是否正常。'
            );
        }

        const completedSteps = result.steps.filter((s) => s.status === 'DONE');

        return {
            data: {
                spl: result.spl,
                conversation_id: result.conversation_id,
                conversation_summary: result.conversation?.summary,
                steps: completedSteps.map((s) => ({
                    title: s.title,
                    tool_name: s.tool_name
                }))
            }
        };
    }

    private validateKnowledgeText(text: string): { valid?: true; error?: any } {
        try {
            const parsed = JSON.parse(text);
            if (!parsed.input || !parsed.output) {
                return {
                    error: this.buildError(
                        'INVALID_KNOWLEDGE_TEXT',
                        'knowledge_text 必须包含 input 和 output 字段。',
                        '格式: {"input":"自然语言描述","output":"SPL语句"}，例如: {"input":"华为交换机","output":"appname:huawei_switch"}'
                    )
                };
            }
            return { valid: true };
        } catch {
            return {
                error: this.buildError(
                    'INVALID_JSON',
                    'knowledge_text 不是合法 JSON。',
                    '格式: {"input":"自然语言描述","output":"SPL语句"}，注意外层是 JSON 字符串。'
                )
            };
        }
    }

    private tryParseKnowledgeInput(text: string): string | null {
        try {
            const parsed = JSON.parse(text);
            return parsed.input || null;
        } catch {
            return null;
        }
    }

    private tryParseKnowledgeOutput(text: string): string | null {
        try {
            const parsed = JSON.parse(text);
            return parsed.output || null;
        } catch {
            return null;
        }
    }

    private buildError(errorCode: string, message: string, suggestion: string, details?: any): any {
        return {
            error: message,
            error_code: errorCode,
            suggestion,
            retryable: true,
            details
        };
    }
}
