import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { isExecutedDirectly } from './runtime-entry.js';
import { LogEaseClient } from './client.js';
import { createHttpClientConfig, createServerContextForStdio, type ServerContext } from './config.js';
import { alertServerTools } from './tools.js';
import { AlertsModule } from './modules/alerts.js';
import { registerToolDefinitions } from './mcp-tool-helpers.js';
import { buildToolSuccessResult, formatErrorPayload } from './result-formatter.js';

const SERVER_LEVEL_INSTRUCTIONS = `使用说明:
1. 这是告警/监控专用入口，只处理监控配置的查询、创建、更新、删除、预览与测试运行；不处理 dashboard、parserrule、动态字段等其他配置。
2. 工作流程：
   a) 先 list_alerts / get_alert_detail 了解现状，避免重复创建。
   b) 创建监控：按目标类型选择对应的 create_* 工具（清单见第 3 条）。
   c) 修改已有监控：先用 get_alert_detail(id) 读取该监控当前完整配置，再基于现状用 update_alert 做局部修改，不要凭记忆重写整段配置。
   d) 上线前建议先用 preview_alert（仅预览通知内容）或 testrun_alert（真实跑一遍查询+统计+通知）验证，再用 get_alert_pretest_result(sid) 获取结果。
3. 创建工具按监控类型区分，先判断要监控哪种场景再选：
   - create_keyword_alert（关键字）：某时间窗口内命中超过 N 条即告警的最基础场景，优先考虑。
   - create_field_stat_alert（字段统计）：对指定数值字段做 avg/sum/max/min 聚合统计。
   - create_baseline_alert（连续统计）：当前统计值与预设基线值（base_value/base_comparator）比较。
   - create_surge_alert（突变异常）：与基线时间窗口比较，检测某字段值突然飙升（base_timerange）。
   - create_spl_alert（SPL 统计）：需要完整 SPL 语法（stats 之外的分支、inputlookup、子查询等）才选用；简单计数勿用，见第 8 条 a)。
   - create_stream_lookup_alert（流式 lookup）：流式数据源上用 lookup 关联 + where 实时匹配，需填 topic。
   - create_stream_agg_alert（流式聚合）：流式数据源上做 stats 聚合，需填 topic 与 window。
   - create_composite_alert（联合监控）：组合多个子监控做 or/and 联合告警，需传 composite_info。
   - 不确定某类型的必填字段与结构时，先调用 get_alert_category_reference 查看该类别的示例 body。
4. 参数约定：
   - 嵌套字段（dataset_ids、check_condition、check_condition_group、composite_info、extend_conf、run_results）可直接传对象，也可传合法 JSON 字符串。
   - 未单独列出的字段可放入 extra 对象。
   - check_condition 的结构随类型不同，按 get_alert_category_reference 中该类别的示例填写。
   - extend_conf 是固定键值元数据；extend_query 是扩展搜索语句（字符串），可用 {{alert.result.hits.0.fieldname}} 引用主搜索结果，用 [[ query ]] 做内嵌子查询。
5. preview_alert / testrun_alert 的 alert 参数是完整的监控对象结构（参考 get_alert_category_reference 的 sampleBody），与 create_* 的扁平单字段参数不同。
6. 传参错误（必填缺失、字段与类型冲突、非法 JSON）会被本地拦截，返回 error 与 suggestion，按 suggestion 修正后重试即可。
7. 输出默认使用 output_format=auto，大结果自动转为 MCP resource；需要强制内联时传 result_delivery=inline。
8. 【选型避坑】
   a) 简单计数勿用 SPL 统计（create_spl_alert）：查询本质只是"命中 N 条即告警"时用 create_keyword_alert，执行路径更轻。
   b) 想把查询保存为定时指标时用字段统计或连续统计，而不是 SPL 统计（SPL 统计每次独立执行，不做定时聚合存档）。
   c) 流式监控依赖常驻流式引擎、资源开销大：创建前先 list_alerts 查是否已有等效配置，有则用 update_alert 复用，勿重复建。
   d) 统计分组字段避免高基数（raw_message、timestamp、session_id 等），优先用 appname、status、level、src_ip 等低基数字段。
   e) check_interval 应与时间窗口匹配：窗口 -5min 时间隔 ≤300s，-1h 时 ≤3600s；间隔过大易漏报，过小重复计算浪费资源。
   f) 通知要携带日志原文时，用 extend_query 引用主搜索结果，不要用 stats count() by raw_message 这类把原文放分组的写法。
   g) 已运行一段时间的监控可查 index=monitor alert_id:<alert_id> 的历史运行数据校准阈值，减少告警疲劳或告警盲区。`;

export function createAlertServer(context: ServerContext): McpServer {
    const client = new LogEaseClient(createHttpClientConfig(context));
    const alertsModule = new AlertsModule(client);

    const server = new McpServer(
        {
            name: 'rizhiyi-alert-server',
            version: '0.1.0',
        },
        {
            instructions: SERVER_LEVEL_INSTRUCTIONS,
        }
    );

    const handlers = {
        list_alerts:                (p: Record<string, unknown>) => handleToolExecution('list_alerts',                () => alertsModule.listAlerts(p), p),
        get_alert_detail:           (p: Record<string, unknown>) => handleToolExecution('get_alert_detail',           () => alertsModule.getAlertDetail(p), p),
        get_alerts_batch:           (p: Record<string, unknown>) => handleToolExecution('get_alerts_batch',           () => alertsModule.getAlertsBatch(p), p),
        create_keyword_alert:       (p: Record<string, unknown>) => handleToolExecution('create_keyword_alert',       () => alertsModule.createKeywordAlert(p), p),
        create_field_stat_alert:    (p: Record<string, unknown>) => handleToolExecution('create_field_stat_alert',    () => alertsModule.createFieldStatAlert(p), p),
        create_baseline_alert:      (p: Record<string, unknown>) => handleToolExecution('create_baseline_alert',      () => alertsModule.createBaselineAlert(p), p),
        create_surge_alert:         (p: Record<string, unknown>) => handleToolExecution('create_surge_alert',         () => alertsModule.createSurgeAlert(p), p),
        create_spl_alert:           (p: Record<string, unknown>) => handleToolExecution('create_spl_alert',           () => alertsModule.createSplAlert(p), p),
        create_stream_lookup_alert: (p: Record<string, unknown>) => handleToolExecution('create_stream_lookup_alert', () => alertsModule.createStreamLookupAlert(p), p),
        create_stream_agg_alert:    (p: Record<string, unknown>) => handleToolExecution('create_stream_agg_alert',    () => alertsModule.createStreamAggAlert(p), p),
        create_composite_alert:     (p: Record<string, unknown>) => handleToolExecution('create_composite_alert',     () => alertsModule.createCompositeAlert(p), p),
        update_alert:               (p: Record<string, unknown>) => handleToolExecution('update_alert',               () => alertsModule.updateAlert(p), p),
        update_alerts_batch:        (p: Record<string, unknown>) => handleToolExecution('update_alerts_batch',        () => alertsModule.updateAlertsBatch(p), p),
        delete_alert:               (p: Record<string, unknown>) => handleToolExecution('delete_alert',               () => alertsModule.deleteAlert(p), p),
        delete_alerts_batch:        (p: Record<string, unknown>) => handleToolExecution('delete_alerts_batch',        () => alertsModule.deleteAlertsBatch(p), p),
        preview_alert:              (p: Record<string, unknown>) => handleToolExecution('preview_alert',              () => alertsModule.previewAlert(p), p),
        testrun_alert:              (p: Record<string, unknown>) => handleToolExecution('testrun_alert',              () => alertsModule.testrunAlert(p), p),
        get_alert_pretest_result:   (p: Record<string, unknown>) => handleToolExecution('get_alert_pretest_result',   () => alertsModule.getAlertPretestResult(p), p),
        get_alert_references:       (p: Record<string, unknown>) => handleToolExecution('get_alert_references',       () => alertsModule.getAlertReferences(p), p),
        get_alert_category_reference:(p: Record<string, unknown>) => handleToolExecution('get_alert_category_reference',() => alertsModule.getAlertCategoryReference(p), p),
    };

    registerToolDefinitions(server, alertServerTools, handlers as any);

    async function handleToolExecution(toolName: string, executor: () => Promise<any>, params: any) {
        try {
            const result = await executor();
            return formatResult(toolName, result, params);
        } catch (error: any) {
            return buildToolError(
                'TOOL_EXECUTION_EXCEPTION',
                `执行工具 ${toolName} 出错: ${String(error?.message || error)}`,
                '请检查参数结构，尤其是 category 与字段的对应关系；如仍有疑问，建议先 get_alert_category_reference 看类别说明后再重试。'
            );
        }
    }

    function formatResult(toolName: string, result: any, params: any = {}): any {
        if (result && result.error) {
            return {
                isError: true,
                content: [{
                    type: 'text',
                    text: formatErrorPayload({
                        error_code: result.error_code || 'ALERTS_EXECUTION_ERROR',
                        message: result.message || result.error,
                        suggestion: result.suggestion || '请检查监控告警参数结构后重试。',
                        retryable: typeof result.retryable === 'boolean' ? result.retryable : true,
                        details: result.details,
                    })
                }]
            };
        }

        return buildToolSuccessResult(toolName, result?.data ?? result, {
            outputFormat: params?.output_format,
            includeRawJson: params?.include_raw_json,
            rawJsonData: result?.raw_data ?? result?.data ?? result,
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
                    retryable: true,
                })
            }]
        };
    }

    return server;
}

async function startServer(): Promise<void> {
    const server = createAlertServer(createServerContextForStdio());
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('Rizhiyi Alert MCP 服务器已启动 (rizhiyi_alert)');
}

if (isExecutedDirectly(import.meta.url)) {
    startServer().catch((err) => {
        console.error('启动 rizhiyi_alert MCP 服务器失败:', err);
        process.exit(1);
    });
}
