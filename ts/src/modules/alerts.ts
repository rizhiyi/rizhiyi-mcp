import { LogEaseClient } from '../client.js';

// ============ 常量 & 类型 ============

export const ALERT_JSON_FIELDS = [
    'dataset_ids',
    'extend_dataset_ids',
    'check_condition',
    'check_condition_group',
    'composite_info',
    'extend_conf',
    'run_results',
] as const;

type AlertJsonField = typeof ALERT_JSON_FIELDS[number];

export const ALERT_MUTATION_WRITE_FIELDS = [
    'name',
    'description',
    'check_interval',
    'interval_unit',
    'check_condition',
    'enabled',
    'category',
    'crontab',
    'restrain_interval',
    'now_restrain_interval',
    'max_restrain_interval',
    'continuous_trigger_value',
    'group_suppress_field',
    'alert_when_recover',
    'generate',
    'graph_enabled',
    'query',
    'extend_query',
    'run_results',
    'dataset_ids',
    'extend_dataset_ids',
    'extend_conf',
    'use_spark',
    'extend_use_spark',
    'segmentation_field',
    'segmentation_result',
    'statistics_field',
    'market_day',
    'alert_line_send',
    'schedule_priority',
    'schedule_window',
    'window',
    'topic',
    'check_condition_group',
    'group_trigger_flag',
    'hosted_flag',
    'composite_info',
    'app_id',
    'export',
    'timezone',
    'alert_condition',
    'recover_condition',
    'alert_state',
    'alert_segmentation_result',
    'rt_names',
    'executor_id',
    'domain_id',
    'uuid',
] as const;

type AlertMutationWriteField = typeof ALERT_MUTATION_WRITE_FIELDS[number];

const DEFAULT_ALERT_LIST_FIELDS = [
    'id',
    'name',
    'category',
    'enabled',
    'check_interval',
    'window',
    'app_id',
].join(',');

export const ALERT_CREATE_REQUIRED_FIELDS = [
    'name',
    'query',
    'check_interval',
    'category',
    'enabled',
    'check_condition',
] as const;

export const ALERT_CATEGORY_META: Record<number, {
    name: string;
    description: string;
    requiredFields: string[];
    specificFields: string[];
    sampleCheckCondition: Record<string, any>;
    sampleBody: Record<string, any>;
}> = {
    0: {
        name: '关键字监控',
        description: '基于搜索关键字 + 时间窗口 count 的最基础告警。query 是原生查询字符串（不含 stats 聚合），check_condition.function=count 且不含 field。适用于"某时间段内某类日志超过 N 条"类场景。',
        requiredFields: ['name', 'query', 'check_interval', 'category', 'enabled', 'check_condition', 'executor_id'],
        specificFields: ['check_condition.function=count', 'check_condition 不含 field', 'statistics_field 应留空'],
        sampleCheckCondition: { timerange: '-5min', function: 'count', operator: '>', threshold: 'high:0' },
        sampleBody: {
            name: '关键字告警-Agent离线',
            category: 0,
            enabled: true,
            executor_id: 1,
            check_interval: 300,
            interval_unit: 1,
            window: '-5min',
            dataset_ids: [],
            query: 'tag:rizhiyi_agent_status',
            check_condition: { timerange: '-5min', function: 'count', operator: '>', threshold: 'high:0' },
            timezone: 'Asia/Shanghai',
        },
    },
    1: {
        name: '字段统计监控',
        description: '对指定数值字段做聚合统计告警。check_condition.field 指定要聚合的数值字段名（如 apache.req_time），check_condition.function 指定聚合函数（avg/sum/max/min 等）。query 可含 stats...by 做分组，此时 segmentation_field 设为分组字段。',
        requiredFields: ['name', 'query', 'check_interval', 'category', 'enabled', 'check_condition', 'executor_id'],
        specificFields: ['check_condition.field = 数值字段名', 'check_condition.function = avg/sum/max/min 等', 'segmentation_field 可选（stats...by 分组时设置）'],
        sampleCheckCondition: { field: 'apache.req_time', function: 'max', timerange: '-10m', operator: '>', threshold: 'low:0.0001' },
        sampleBody: {
            name: '字段统计-最大响应时间告警',
            category: 1,
            enabled: true,
            executor_id: 1,
            check_interval: 60,
            interval_unit: 0,
            dataset_ids: [{ dataset_id: 1 }],
            query: "* AND 'appname':apache",
            check_condition: { field: 'apache.req_time', function: 'max', timerange: '-10m', operator: '>', threshold: 'low:0.0001' },
            timezone: 'Asia/Shanghai',
        },
    },
    2: {
        name: '连续统计监控',
        description: '基于基线值对比的连续统计告警。check_condition 含 base_value（基线值）和 base_comparator（基线比较运算符），对当前统计值与基线值做对比判断。常见于"业务调用高耗时统计"等场景。',
        requiredFields: ['name', 'query', 'check_interval', 'category', 'enabled', 'check_condition', 'executor_id'],
        specificFields: ['check_condition.base_value 必填', 'check_condition.base_comparator 必填（如 >）', 'check_condition.field 指定统计字段', 'alert_segmentation_result 运行结果'],
        sampleCheckCondition: { timerange: '-10m', function: 'count', operator: '>', threshold: 'info:0;low:10;mid:100;high:1000', field: 'json.HTTP_RESPONSE', base_value: '5', base_comparator: '>' },
        sampleBody: {
            name: '连续统计-业务调用高耗时告警',
            category: 2,
            enabled: true,
            executor_id: 1,
            check_interval: 60,
            interval_unit: 0,
            dataset_ids: [],
            query: 'index=tanzhen_test appname:unipro json.L7_PROTOCOL:http',
            check_condition: { timerange: '-10m', function: 'count', operator: '>', threshold: 'info:0;low:10;mid:100;high:1000', field: 'json.HTTP_RESPONSE', base_value: '5', base_comparator: '>' },
            timezone: 'Asia/Shanghai',
        },
    },
    3: {
        name: '突变异常监控',
        description: '基于时间窗口基线对比的突变检测告警。check_condition 含 base_timerange（基线时间范围，如 now-2m,now-1m），将当前窗口统计值与基线窗口值做百分比/倍数对比。适用于"某字段值突然飙升"类场景。',
        requiredFields: ['name', 'query', 'check_interval', 'category', 'enabled', 'check_condition', 'executor_id'],
        specificFields: ['check_condition.base_timerange 必填（如 now-2m,now-1m）', 'check_condition.field 指定监控字段', 'threshold 含百分比格式（如 info:50%）', 'dataset_ids 可含 [{dataset_id,node_id}] 对象数组'],
        sampleCheckCondition: { timerange: '-1m', function: 'count', operator: '>', threshold: 'info:50%;mid:100%;high:200%;critical:500%', field: 'apache.status', base_timerange: 'now-2m,now-1m' },
        sampleBody: {
            name: '突变异常-status码飙升告警',
            category: 3,
            enabled: true,
            executor_id: 1,
            check_interval: 60,
            interval_unit: 0,
            dataset_ids: [{ dataset_id: 14, node_id: 8 }],
            query: 'apache.status:404',
            check_condition: { timerange: '-1m', function: 'count', operator: '>', threshold: 'info:50%;mid:100%;high:200%;critical:500%', field: 'apache.status', base_timerange: 'now-2m,now-1m' },
            timezone: 'Asia/Shanghai',
        },
    },
    4: {
        name: 'SPL 统计监控',
        description: 'query 传入完整 SPL（包含 stats 聚合或 inputlookup 等），dataset_ids 通常为 []。可对 SPL 输出列（如 cnt）做阈值判断。',
        requiredFields: ['name', 'query', 'check_interval', 'category', 'enabled', 'check_condition', 'executor_id'],
        specificFields: ['query 含完整 SPL（stats/inputlookup 等）', 'dataset_ids 一般为 []', 'check_condition.field = stats 输出列'],
        sampleCheckCondition: { threshold: 'mid:0', field: 'cnt', operator: '>', timerange: '-1m' },
        sampleBody: {
            name: 'SPL统计-Syslog未采集告警',
            category: 4,
            enabled: true,
            executor_id: 1,
            check_interval: 480,
            interval_unit: 0,
            dataset_ids: [],
            query: '| inputlookup syslog.csv\n| eval nowtime=now()\n| eval max_time=todouble(max_time)\n| sort by -json.last_update_timestamp\n| eval mtime=((tolong(nowtime)-tolong(max_time))/60000/60)\n| stats count() as cnt',
            check_condition: { threshold: 'mid:0', field: 'cnt', operator: '>', timerange: '-1m' },
            timezone: 'Asia/Shanghai',
        },
    },
    5: {
        name: '流式 lookup 监控',
        description: '基于 lookup 关联 + 流式计算的告警。topic 指定流式数据源（如 raw_message），query 含 lookup+where 做关联过滤。check_condition.timerange 通常为 "m"（分钟级）。check_interval 和 interval_unit 通常为 0（由流式驱动而非定时调度）。',
        requiredFields: ['name', 'query', 'topic', 'category', 'enabled', 'check_condition', 'executor_id'],
        specificFields: ['topic 必填（如 raw_message）', 'query 含 lookup...on...| where 条件', 'check_condition.timerange="m" 典型', 'check_interval=0, interval_unit=0 典型'],
        sampleCheckCondition: { timerange: 'm', function: 'count', operator: '>', threshold: 'info' },
        sampleBody: {
            name: '流式lookup-高危IP匹配告警',
            category: 5,
            enabled: true,
            executor_id: 1,
            check_interval: 0,
            interval_unit: 0,
            topic: 'raw_message',
            query: "(appname:unipro) | lookup ip_info as ip_name ip_alert.csv on ip=ip_info | where ((ip == ip))",
            check_condition: { timerange: 'm', function: 'count', operator: '>', threshold: 'info' },
            timezone: 'Asia/Shanghai',
        },
    },
    6: {
        name: '流式聚合监控',
        description: '基于流式计算 + stats 聚合的实时告警。topic 指定流式数据源（如 raw_message），query 含 stats...by+where 做流式聚合统计（区别于 cat=5 的 lookup+where）。check_condition 通常极简（仅 threshold）。check_interval 和 interval_unit 通常为 0（由流式驱动）。window 指定聚合窗口（如 "10m"，不带 - 前缀）。',
        requiredFields: ['name', 'query', 'topic', 'category', 'enabled', 'executor_id'],
        specificFields: ['topic 必填（如 raw_message）', 'query 含 stats...by + where 做流式聚合', 'check_condition 通常仅 threshold', 'check_interval=0, interval_unit=0 典型', 'window 不带 - 前缀（如 "10m"）'],
        sampleCheckCondition: { threshold: 'info' },
        sampleBody: {
            name: '日志打印趋势',
            category: 6,
            enabled: true,
            executor_id: 1,
            check_interval: 0,
            interval_unit: 0,
            topic: 'raw_message',
            window: '10m',
            dataset_ids: [],
            query: '(appname:unipro) | where (((ip) == ("172.21.16.8"))) | stats count(tag) as count_ by tag | where ((count_ > 0))',
            check_condition: { threshold: 'info' },
            timezone: 'Asia/Shanghai',
        },
    },
    19: {
        name: '联合监控',
        description: '组合多个子监控的联合告警。composite_info 必填，定义子监控的组合关系（operator=or/and，children 数组每项含 alert_uuid 和 watched_level）。query 通常为 "*"，check_condition.threshold="auto"。check_interval 和 interval_unit 通常为 0。',
        requiredFields: ['name', 'composite_info', 'category', 'enabled', 'executor_id'],
        specificFields: ['composite_info 必填（含 operator + children 数组）', 'children[].alert_uuid = 子监控 UUID', 'children[].watched_level = 关注级别数组', 'query 通常为 *', 'check_condition.threshold=auto 典型'],
        sampleCheckCondition: { threshold: 'auto', timerange: '' },
        sampleBody: {
            name: '联合监控-多告警联合',
            category: 19,
            enabled: true,
            executor_id: 1,
            check_interval: 0,
            interval_unit: 0,
            query: '*',
            composite_info: { operator: 'or', children: [{ alert_uuid: 'eab72cded2be4d7d926a4dcb76c6c101', watched_level: ['info', 'low', 'mid', 'high'], children: null }] },
            check_condition: { threshold: 'auto', timerange: '' },
            timezone: 'Asia/Shanghai',
        },
    },
};

// snake_case → camelCase 映射（供 preview/testrun 使用）
const SNAKE_TO_CAMEL_ALERT_FIELDS: Record<string, string> = {
    domain_id: 'domainId',
    executor_id: 'executorId',
    creator_id: 'creatorId',
    check_interval: 'checkInterval',
    interval_unit: 'intervalUnit',
    check_condition: 'checkCondition',
    restrain_interval: 'restrainInterval',
    now_restrain_interval: 'nowRestrainInterval',
    max_restrain_interval: 'maxRestrainInterval',
    continuous_trigger_value: 'continuousTriggerValue',
    group_suppress_field: 'groupSuppressField',
    alert_when_recover: 'alertWhenRecover',
    graph_enabled: 'graphEnabled',
    extend_query: 'extendQuery',
    run_results: 'runResults',
    dataset_ids: 'datasetIds',
    extend_dataset_ids: 'extendDatasetIds',
    extend_conf: 'extendConf',
    use_spark: 'useSpark',
    extend_use_spark: 'extendUseSpark',
    segmentation_field: 'segmentationField',
    segmentation_result: 'segmentationResult',
    statistics_field: 'statisticsField',
    market_day: 'marketDay',
    alert_line_send: 'alertLineSend',
    schedule_priority: 'schedulePriority',
    schedule_window: 'scheduleWindow',
    check_condition_group: 'checkConditionGroup',
    group_trigger_flag: 'groupTriggerFlag',
    hosted_flag: 'hostedFlag',
    composite_info: 'compositeInfo',
    app_id: 'appId',
    alert_condition: 'alertCondition',
    recover_condition: 'recoverCondition',
    alert_state: 'alertState',
    alert_segmentation_result: 'alertSegmentationResult',
    update_timestamp: 'updateTimestamp',
    last_run_timestamp: 'lastRunTimestamp',
    last_trigger_timestamp: 'lastTriggerTimestamp',
    rt_names: 'rtNames',
};

// ============ 模块主体 ============

export class AlertsModule {
    constructor(private client: LogEaseClient) {}

    // ---- 列表 / 详情 / 批量查询 ----

    async listAlerts(params: any): Promise<any> {
        const response = await this.client.get('/api/v3/alerts/', this.pickDefined({
            fields: this.resolveListFields(params?.fields),
            permits: params?.permits,
            page: params?.page,
            size: params?.size,
            id: params?.id,
            name: params?.name,
            domain_id: params?.domain_id,
            executor_id: params?.executor_id,
            creator_id: params?.creator_id,
            description: params?.description,
            crontab: params?.crontab,
            query: params?.query,
            extend_query: params?.extend_query,
            graph_enabled: params?.graph_enabled,
            use_spark: params?.use_spark,
            extend_use_spark: params?.extend_use_spark,
            extend_conf: params?.extend_conf,
            segmentation_field: params?.segmentation_field,
            alert_line_send: params?.alert_line_send,
            hosted_flag: params?.hosted_flag,
            category: params?.category,
            app_id: params?.app_id,
            rt_ids: params?.rt_ids,
            sort: params?.sort,
        }));

        if (response.error) return response;
        if (response.data && typeof response.data === 'object' && (response.data as any).result === false) {
            return this.buildError('UPSTREAM_BUSINESS_ERROR', 'list_alerts 上游接口返回失败。', '请检查过滤条件或上游服务。', response.data);
        }
        return { ...response, raw_data: response.data, data: response.data };
    }

    async getAlertDetail(params: any): Promise<any> {
        const id = this.requireId(params?.id, 'get_alert_detail 需要 id。');
        if (id.error) return id.error;

        const response = await this.client.get(`/api/v3/alerts/${id.value}/`, this.pickDefined({
            fields: params?.fields,
            permit: params?.permit,
        }));
        if (response.error) return response;
        if (response.data && typeof response.data === 'object' && (response.data as any).result === false) {
            return this.buildError('UPSTREAM_BUSINESS_ERROR', 'get_alert_detail 上游接口返回失败。', '请检查 id 是否存在。', response.data);
        }
        return { ...response, raw_data: response.data, data: (response.data as any)?.object ?? response.data };
    }

    async getAlertsBatch(params: any): Promise<any> {
        const idList = this.normalizeIdList(params);
        if (idList.error) return idList.error;

        const response = await this.client.get('/api/v3/alerts/set/', this.pickDefined({
            id_list: idList.value,
            fields: params?.fields,
            permits: params?.permits,
        }));
        if (response.error) return response;
        if (response.data && typeof response.data === 'object' && (response.data as any).result === false) {
            return this.buildError('UPSTREAM_BUSINESS_ERROR', 'get_alerts_batch 上游接口返回失败。', '请检查 id_list 是否正确。', response.data);
        }
        return { ...response, raw_data: response.data, data: response.data };
    }

    // ---- CRUD ----

    static CREATE_TYPED_ALERT_CATEGORIES: Record<string, number> = {
        create_keyword_alert: 0,
        create_field_stat_alert: 1,
        create_baseline_alert: 2,
        create_surge_alert: 3,
        create_spl_alert: 4,
        create_stream_lookup_alert: 5,
        create_stream_agg_alert: 6,
        create_composite_alert: 19,
    };

    private buildTypedRule(params: any, category: number, toolName: string): { value?: Record<string, unknown>; error?: any } {
        const rule: Record<string, unknown> = { category, enabled: true };
        for (const key of ALERT_MUTATION_WRITE_FIELDS) {
            if (Object.prototype.hasOwnProperty.call(params, key) && !this.isMissingRequiredValue(params[key])) {
                rule[key] = params[key];
            }
        }
        const extra = params?.extra;
        if (this.isPlainObject(extra)) {
            const picked = this.pickWriteFields(extra);
            Object.assign(rule, picked);
        } else if (!this.isMissingRequiredValue(extra)) {
            const normalized = this.normalizeJsonEncodedMutationField(extra, `${toolName}.extra`, true);
            if (normalized.error) return { error: normalized.error };
            let parsed: unknown;
            try {
                parsed = JSON.parse(normalized.value!);
            } catch (e: any) {
                return {
                    error: this.buildError(
                        'INVALID_JSON_STRING',
                        `${toolName}.extra 不是合法 JSON 对象字符串。`,
                        '请检查 extra 的 JSON 语法。',
                        { parse_error: e?.message || 'JSON parse failed' }
                    ),
                };
            }
            if (!this.isPlainObject(parsed)) {
                return {
                    error: this.buildError(
                        'INVALID_PARAM_TYPE',
                        `${toolName}.extra 解析结果不是对象。`,
                        'extra 需为对象或合法 JSON 对象字符串。'
                    ),
                };
            }
            Object.assign(rule, this.pickWriteFields(parsed));
        }
        rule.category = category;
        return { value: rule };
    }

    async createTypedAlert(params: any, category: number, toolName: string): Promise<any> {
        const ruleResult = this.buildTypedRule(params, category, toolName);
        if (ruleResult.error) return ruleResult.error;
        return this.createAlertCommon({ rule: ruleResult.value! }, toolName, category);
    }

    private async createAlertCommon(
        paramsBody: { rule: Record<string, unknown> },
        toolName: string,
        categoryValue: unknown
    ): Promise<any> {
        const body = this.extractMutationBody(paramsBody as any, 'rule', toolName);
        if (body.error) return body.error;

        const preprocessed = this.preprocessJsonFields(body.value!, `${toolName}.rule`);
        if (preprocessed.error) return preprocessed.error;

        const conflictErr = this.validateCategoryFieldConflicts(preprocessed.value!, toolName);
        if (conflictErr) return conflictErr;

        const requiredFields = this.resolveRequiredFieldsForCreate(
            categoryValue !== undefined && categoryValue !== null
                ? categoryValue
                : (preprocessed.value! as any).category
        );
        const requiredErr = this.validateRequiredFields(preprocessed.value!, requiredFields, toolName);
        if (requiredErr) return requiredErr;

        const response = await this.client.post('/api/v3/alerts/', preprocessed.value);
        if (response.error) return response;
        if (response.data && typeof response.data === 'object' && (response.data as any).result === false) {
            return this.buildError('UPSTREAM_BUSINESS_ERROR', `${toolName} 上游接口返回失败。`, '请检查必填字段或 category 与字段匹配关系。', response.data);
        }
        return { ...response, raw_data: response.data, data: response.data };
    }

    async createKeywordAlert(params: any): Promise<any> {
        return this.createTypedAlert(params, 0, 'create_keyword_alert');
    }

    async createFieldStatAlert(params: any): Promise<any> {
        return this.createTypedAlert(params, 1, 'create_field_stat_alert');
    }

    async createBaselineAlert(params: any): Promise<any> {
        return this.createTypedAlert(params, 2, 'create_baseline_alert');
    }

    async createSurgeAlert(params: any): Promise<any> {
        return this.createTypedAlert(params, 3, 'create_surge_alert');
    }

    async createSplAlert(params: any): Promise<any> {
        return this.createTypedAlert(params, 4, 'create_spl_alert');
    }

    async createStreamLookupAlert(params: any): Promise<any> {
        return this.createTypedAlert(params, 5, 'create_stream_lookup_alert');
    }

    async createStreamAggAlert(params: any): Promise<any> {
        return this.createTypedAlert(params, 6, 'create_stream_agg_alert');
    }

    async createCompositeAlert(params: any): Promise<any> {
        return this.createTypedAlert(params, 19, 'create_composite_alert');
    }

    async updateAlert(params: any): Promise<any> {
        const id = this.requireId(params?.id, 'update_alert 需要 id。');
        if (id.error) return id.error;

        const changes = this.extractMutationBody(params, 'changes', 'update_alert');
        if (changes.error) return changes.error;

        const preprocessed = this.preprocessJsonFields(changes.value!, 'update_alert.changes');
        if (preprocessed.error) return preprocessed.error;

        const categoryValue = (preprocessed.value! as any).category;
        if (categoryValue !== undefined && categoryValue !== null) {
            const conflictErr = this.validateCategoryFieldConflicts(preprocessed.value!, 'update_alert');
            if (conflictErr) return conflictErr;
        }

        const response = await this.client.put(`/api/v3/alerts/${id.value}/`, preprocessed.value);
        if (response.error) return response;
        if (response.data && typeof response.data === 'object' && (response.data as any).result === false) {
            return this.buildError('UPSTREAM_BUSINESS_ERROR', 'update_alert 上游接口返回失败。', '请检查 id 与变更字段。', response.data);
        }
        return { ...response, raw_data: response.data, data: response.data };
    }

    async updateAlertsBatch(params: any): Promise<any> {
        const items = this.extractBatchItems(params, 'update_alerts_batch');
        if (items.error) return items.error;

        const processedItems: any[] = [];
        for (const item of items.value!) {
            if (!item || typeof item !== 'object' || Array.isArray(item)) {
                return this.buildError(
                    'INVALID_BATCH_ITEM',
                    'update_alerts_batch 的每个 item 必须是对象。',
                    '请把 items 传成对象数组，每个对象包含 id 及变更字段。'
                );
            }
            if (this.isMissingRequiredValue((item as any).id)) {
                return this.buildError(
                    'MISSING_REQUIRED_FIELDS',
                    'update_alerts_batch 有 item 缺少 id。',
                    '每个 item 都需要显式提供 id，用于定位目标监控。'
                );
            }
            const pick = this.pickWriteFields(item as Record<string, unknown>);
            const preprocessed = this.preprocessJsonFields(pick, 'update_alerts_batch.item');
            if (preprocessed.error) return preprocessed.error;
            processedItems.push(preprocessed.value);
        }

        const response = await this.client.put('/api/v3/alerts/set/', processedItems as any);
        if (response.error) return response;
        if (response.data && typeof response.data === 'object' && (response.data as any).result === false) {
            return this.buildError('UPSTREAM_BUSINESS_ERROR', 'update_alerts_batch 上游接口返回失败。', '请逐项检查 items 内容。', response.data);
        }
        return { ...response, raw_data: response.data, data: response.data };
    }

    async deleteAlert(params: any): Promise<any> {
        const id = this.requireId(params?.id, 'delete_alert 需要 id。');
        if (id.error) return id.error;

        const response = await this.client.delete(`/api/v3/alerts/${id.value}/`);
        if (response.error) return response;
        if (response.data && typeof response.data === 'object' && (response.data as any).result === false) {
            return this.buildError('UPSTREAM_BUSINESS_ERROR', 'delete_alert 上游接口返回失败。', '请检查 id 是否存在。', response.data);
        }
        return { ...response, raw_data: response.data, data: response.data };
    }

    async deleteAlertsBatch(params: any): Promise<any> {
        const idList = this.normalizeIdList(params, /*allowIdsArray=*/ true, /*required=*/ true);
        if (idList.error) return idList.error;

        const response = await this.client.delete('/api/v3/alerts/set/', { id_list: idList.value });
        if (response.error) return response;
        if (response.data && typeof response.data === 'object' && (response.data as any).result === false) {
            return this.buildError('UPSTREAM_BUSINESS_ERROR', 'delete_alerts_batch 上游接口返回失败。', '请检查 ids/id_list 是否存在。', response.data);
        }
        return { ...response, raw_data: response.data, data: response.data };
    }

    // ---- Preview / Testrun / Pretest ----

    async previewAlert(params: any): Promise<any> {
        return this.submitPretest(params, 'preview_alert', '/api/v3/alerts/preview/submit/');
    }

    async testrunAlert(params: any): Promise<any> {
        return this.submitPretest(params, 'testrun_alert', '/api/v3/alerts/testrun/submit/');
    }

    private async submitPretest(params: any, toolName: string, path: string): Promise<any> {
        const alertRaw = params?.alert;
        if (this.isMissingRequiredValue(alertRaw)) {
            return this.buildError(
                'MISSING_REQUIRED_PARAM',
                `${toolName} 需要 alert 参数。`,
                '请传入 alert 草稿对象或 JSON 字符串；按目标监控类型（0/1/2/3/4/5/6/19）的字段结构拼装，类型差异见 get_alert_category_reference。'
            );
        }

        const alertParsed = this.parseMutationObject(alertRaw, 'alert', toolName);
        if ((alertParsed as any).error) return (alertParsed as any).error;
        const alertObject = (alertParsed as { value: Record<string, unknown> }).value;

        // category 冲突检查（宽松：有 category 就查）
        if (alertObject.category !== undefined && alertObject.category !== null) {
            const err = this.validateCategoryFieldConflicts(alertObject, toolName);
            if (err) return err;
        }

        // JSON 字段预处理（仍按 snake_case 做序列化，后续再统一转 camelCase）
        const preprocessed = this.preprocessJsonFields(alertObject, `${toolName}.alert`);
        if (preprocessed.error) return preprocessed.error;

        const camelAlert = this.snakeToCamelAlert(preprocessed.value!);

        // alert_meta: string or object → JSON string
        let alertMetaSerialized: string | undefined;
        const metaRaw = params?.alert_meta;
        if (!this.isMissingRequiredValue(metaRaw)) {
            const norm = this.normalizeJsonEncodedMutationField(metaRaw, `${toolName}.alert_meta`, true);
            if ((norm as any).error) return (norm as any).error;
            alertMetaSerialized = (norm as { value: string }).value;
        }

        const payload = this.pickDefined({
            alert: camelAlert,
            alert_meta: alertMetaSerialized,
            plugin_id: params?.plugin_id,
            timeout: params?.timeout,
        });

        const response = await this.client.post(path, payload);
        if (response.error) return response;
        if (response.data && typeof response.data === 'object' && (response.data as any).result === false) {
            return this.buildError('UPSTREAM_BUSINESS_ERROR', `${toolName} 上游接口返回失败。`, '请检查 alert 字段是否符合对应 category 的要求。', response.data);
        }
        return { ...response, raw_data: response.data, data: response.data };
    }

    async getAlertPretestResult(params: any): Promise<any> {
        const sid = params?.sid;
        if (this.isMissingRequiredValue(sid)) {
            return this.buildError(
                'MISSING_REQUIRED_PARAM',
                'get_alert_pretest_result 需要 sid。',
                'sid 来自 preview_alert / testrun_alert 的返回；请先调用其中一个工具。'
            );
        }

        const maxWaitMs = typeof params?.max_wait_ms === 'number' && params.max_wait_ms > 0 ? params.max_wait_ms : 0;
        const pollIntervalMs = typeof params?.poll_interval_ms === 'number' && params.poll_interval_ms > 0 ? params.poll_interval_ms : 1000;

        const deadline = Date.now() + maxWaitMs;
        let lastResponse: any = null;
        do {
            const response = await this.client.get('/api/v3/alerts/pretest/preview/', { sid: String(sid) });
            if (response.error) return response;
            lastResponse = response;
            const data = response.data as any;
            const isDone = !!(
                data &&
                typeof data === 'object' &&
                (data.finished === true ||
                    data.done === true ||
                    (typeof data.finished === 'string' && data.finished.toLowerCase() === 'true') ||
                    (data.meta && typeof data.meta === 'object' && data.meta.state === 'done') ||
                    Array.isArray(data.result) ||
                    (typeof data.result === 'object' && data.result !== null && typeof data.result !== 'boolean'))
            );
            if (isDone) {
                return { ...response, raw_data: response.data, data: response.data };
            }
            if (Date.now() + pollIntervalMs > deadline) break;
            await new Promise((r) => setTimeout(r, pollIntervalMs));
        } while (Date.now() < deadline);

        return {
            ...lastResponse,
            raw_data: lastResponse?.data,
            data: lastResponse?.data,
            _not_ready_hint: 'sid 对应结果尚未返回，建议数秒后再用相同 sid 调用 get_alert_pretest_result，可传 max_wait_ms 调整等待。',
        };
    }

    // ---- References ----

    async getAlertReferences(params: any): Promise<any> {
        const response = await this.client.get('/api/v3/alerts/references/');
        if (response.error) return response;
        if (response.data && typeof response.data === 'object' && (response.data as any).result === false) {
            return this.buildError('UPSTREAM_BUSINESS_ERROR', 'get_alert_references 上游接口返回失败。', '请检查上游 alerts/references 接口状态。', response.data);
        }
        return { ...response, raw_data: response.data, data: response.data };
    }

    getAlertCategoryReference(params: any): any {
        const requestedCategory = this.resolveRequestedCategory(params);
        const usage = '不传 category 时返回全部监控类别的完整参考；传 category（数字或数字字符串或名称）时只返回对应类别。';
        const catalog = {
            supported_categories: Object.values(ALERT_CATEGORY_META).map((v, i) => ({
                category: i,
                name: v.name,
                description: v.description,
            })),
            usage,
        };

        if (requestedCategory === null) {
            const full: Record<string, any> = {};
            for (const [cat, meta] of Object.entries(ALERT_CATEGORY_META)) {
                full[cat] = meta;
            }
            return { data: { catalog, categories: full } };
        }

        if (ALERT_CATEGORY_META[requestedCategory]) {
            return { data: { requested_category: requestedCategory, ...ALERT_CATEGORY_META[requestedCategory] } };
        }

        return this.buildError(
            'UNSUPPORTED_ALERT_CATEGORY',
            `暂不支持监控类别: ${requestedCategory}`,
            `当前支持 0/1/2/3/4/5/6/19 共 8 类监控：${Object.entries(ALERT_CATEGORY_META).map(([c, m]) => `${c}=${m.name}`).join('，')}。`
        );
    }

    // ============ 辅助方法（保持与 parserrule 模块一致的风格） ============

    // --- 对外导出的纯函数，便于自测脚本复用 ---
    public static preprocessJsonFieldsStatic(
        body: Record<string, unknown>,
        fieldPathPrefix: string,
        buildError: (code: string, msg: string, sug: string, det?: any) => any,
        normalizeFn: (raw: unknown, fp: string, allowObject?: boolean) => { value?: string; error?: any }
    ): { value?: Record<string, unknown>; error?: any } {
        const out: Record<string, unknown> = { ...body };
        for (const field of ALERT_JSON_FIELDS) {
            if (typeof out[field] === 'undefined' || out[field] === null) continue;
            if (typeof out[field] === 'string' && (out[field] as string).trim() === '') {
                // 空串跳过（上游可能接受空串）
                continue;
            }
            const normalized = normalizeFn(out[field], `${fieldPathPrefix}.${field}`, true);
            if (normalized.error) return { error: normalized.error };
            out[field] = normalized.value;
        }
        return { value: out };
    }

    public static validateCategoryFieldConflictsStatic(
        body: Record<string, unknown>,
        toolName: string,
        buildError: (code: string, msg: string, sug: string, det?: any) => any
    ): any | null {
        const category = Number(body.category);
        const has = (k: string) => !AlertsModule.isMissingValueStatic(body[k]);

        if (!Number.isFinite(category)) return null; // 未传 category 时跳过

        const nameOf = (c: number) => ALERT_CATEGORY_META[c]?.name || `类别${c}`;

        // 解析 check_condition（可能是对象或 JSON 字符串）
        const rawCond = body.check_condition;
        let cond: Record<string, any> | null = null;
        if (typeof rawCond === 'string' && rawCond.trim()) {
            try { cond = JSON.parse(rawCond); } catch { /* 非法 JSON 会在 preprocessJsonFields 中拦截 */ }
        } else if (rawCond && typeof rawCond === 'object' && !Array.isArray(rawCond)) {
            cond = rawCond as Record<string, any>;
        }
        const condHas = (k: string) => cond != null && !AlertsModule.isMissingValueStatic(cond[k]);

        // category=0 关键字：不能有 statistics_field 非空
        if (category === 0 && has('statistics_field')) {
            return buildError(
                'CATEGORY_FIELD_CONFLICT',
                `${toolName}：category=0（关键字监控）与 statistics_field 冲突。`,
                `category=0(${nameOf(0)}) 不要求 statistics_field；若确实要按数值字段聚合，请改用 category=1(${nameOf(1)})。`,
                { category, statistics_field: body.statistics_field }
            );
        }

        // category=1 字段统计：check_condition 必须含 field（数值字段名）
        if (category === 1 && !condHas('field')) {
            return buildError(
                'CATEGORY_FIELD_CONFLICT',
                `${toolName}：category=1（字段统计监控）的 check_condition 缺少 field。`,
                `category=1(${nameOf(1)}) 的 check_condition.field 必须指定要聚合的数值字段名（如 apache.req_time）。`,
                { category }
            );
        }

        // category=2 连续统计：check_condition 必须含 base_value
        if (category === 2 && !condHas('base_value')) {
            return buildError(
                'CATEGORY_FIELD_CONFLICT',
                `${toolName}：category=2（连续统计监控）的 check_condition 缺少 base_value。`,
                `category=2(${nameOf(2)}) 的 check_condition 必须含 base_value（基线值）和 base_comparator（比较运算符）。`,
                { category }
            );
        }

        // category=3 突变异常：check_condition 必须含 base_timerange
        if (category === 3 && !condHas('base_timerange')) {
            return buildError(
                'CATEGORY_FIELD_CONFLICT',
                `${toolName}：category=3（突变异常监控）的 check_condition 缺少 base_timerange。`,
                `category=3(${nameOf(3)}) 的 check_condition 必须含 base_timerange（基线时间范围，如 now-2m,now-1m）。`,
                { category }
            );
        }

        // category=5 流式 lookup：topic 必填
        if (category === 5 && !has('topic')) {
            return buildError(
                'CATEGORY_FIELD_CONFLICT',
                `${toolName}：category=5（流式 lookup 监控）缺少 topic。`,
                `category=5(${nameOf(5)}) 必须传非空的 topic（如 raw_message）；若这是离线批调度告警，请改用 category=0/1/4。`,
                { category }
            );
        }

        // category=6 流式聚合：topic 必填
        if (category === 6 && !has('topic')) {
            return buildError(
                'CATEGORY_FIELD_CONFLICT',
                `${toolName}：category=6（流式聚合监控）缺少 topic。`,
                `category=6(${nameOf(6)}) 必须传非空的 topic（如 raw_message）；若这是离线批调度告警，请改用 category=0/1/4。`,
                { category }
            );
        }

        // category=19 联合监控：composite_info 必填
        if (category === 19 && !has('composite_info')) {
            return buildError(
                'CATEGORY_FIELD_CONFLICT',
                `${toolName}：category=19（联合监控）缺少 composite_info。`,
                `category=19(${nameOf(19)}) 必须传 composite_info（含 operator 和 children 数组，children 每项含 alert_uuid + watched_level）。`,
                { category }
            );
        }

        // category=0/1/2/3/4：check_condition.timerange 必填（非流式、非联合类型）
        if ([0, 1, 2, 3, 4].includes(category) && !condHas('timerange')) {
            return buildError(
                'CATEGORY_FIELD_CONFLICT',
                `${toolName}：category=${category}（${nameOf(category)}）的 check_condition 缺少 timerange。`,
                `category=${category}(${nameOf(category)}) 的 check_condition 必须含 timerange（统计时段，如 "-5min"、"-1h"）。`,
                { category }
            );
        }

        // 所有监控类型：executor_id 必填
        if (!has('executor_id')) {
            return buildError(
                'CATEGORY_FIELD_CONFLICT',
                `${toolName}：缺少 executor_id（运行用户）。`,
                `所有监控类型都必须指定运行用户 executor_id。`,
                { category }
            );
        }

        return null;
    }

    public static isMissingValueStatic(value: unknown): boolean {
        if (typeof value === 'boolean') return false;
        if (typeof value === 'number') return false; // 允许 0
        if (typeof value === 'string') return value.trim().length === 0;
        if (Array.isArray(value)) return value.length === 0;
        return typeof value === 'undefined' || value === null;
    }

    // --- 私有辅助（复用上面静态方法） ---

    private preprocessJsonFields(
        body: Record<string, unknown>,
        fieldPathPrefix: string
    ): { value?: Record<string, unknown>; error?: any } {
        return AlertsModule.preprocessJsonFieldsStatic(
            body,
            fieldPathPrefix,
            this.buildError.bind(this),
            (raw, fp, allowObj) => this.normalizeJsonEncodedMutationField(raw, fp, allowObj)
        );
    }

    private validateCategoryFieldConflicts(body: Record<string, unknown>, toolName: string): any | null {
        return AlertsModule.validateCategoryFieldConflictsStatic(body, toolName, this.buildError.bind(this));
    }

    private isMissingRequiredValue(value: unknown): boolean {
        return AlertsModule.isMissingValueStatic(value);
    }

    private pickDefined(values: Record<string, unknown>): Record<string, unknown> {
        return Object.fromEntries(Object.entries(values).filter(([, v]) => typeof v !== 'undefined'));
    }

    private resolveListFields(fields: unknown): string {
        if (typeof fields === 'string' && fields.trim()) return fields.trim();
        return DEFAULT_ALERT_LIST_FIELDS;
    }

    private requireId(rawId: unknown, message: string): { value?: string; error?: any } {
        if (this.isMissingRequiredValue(rawId)) {
            return {
                error: this.buildError(
                    'MISSING_REQUIRED_PARAM',
                    message,
                    '请提供目标监控的 id（数字或数字字符串）。'
                ),
            };
        }
        return { value: String(rawId) };
    }

    private normalizeIdList(params: any, allowIdsArray: boolean = true, required: boolean = false): { value?: string; error?: any } {
        const rawIdList = params?.id_list;
        const rawIds = params?.ids;
        let joined: string | undefined;

        if (!this.isMissingRequiredValue(rawIdList) && typeof rawIdList === 'string') {
            joined = rawIdList.trim();
        } else if (allowIdsArray) {
            if (Array.isArray(rawIds)) {
                joined = rawIds.map((x) => String(x)).join(',');
            } else if (typeof rawIds === 'string' && rawIds.trim()) {
                joined = rawIds.trim();
            }
        }

        if (!joined || joined === '') {
            if (required) {
                return {
                    error: this.buildError(
                        'MISSING_REQUIRED_PARAM',
                        '缺少 ids / id_list。',
                        '请传 ids 数组（或逗号字符串），或 id_list 逗号字符串。'
                    ),
                };
            }
            return { value: '' };
        }
        return { value: joined };
    }

    private pickWriteFields(source: Record<string, unknown>): Record<string, unknown> {
        return this.pickDefined(
            ALERT_MUTATION_WRITE_FIELDS.reduce((acc, key) => {
                acc[key] = source[key];
                return acc;
            }, {} as Record<AlertMutationWriteField, unknown>)
        );
    }

    private extractMutationBody(
        params: any,
        fieldName: 'rule' | 'changes',
        toolName: string
    ): { value?: Record<string, unknown>; error?: any } {
        const source = params?.[fieldName];
        if (typeof source === 'undefined' || source === null || source === '') {
            return {
                error: this.buildError(
                    'MISSING_REQUIRED_PARAM',
                    `${toolName} 需要 ${fieldName}。`,
                    `请在 ${fieldName} 中传入监控主体对象或合法 JSON 字符串，至少包含 name、query、category 等关键字段。`
                ),
            };
        }
        const parsed = this.parseMutationObject(source, fieldName, toolName);
        if ((parsed as any).error) return parsed;
        const value = (parsed as { value: Record<string, unknown> }).value;
        const picked = this.pickWriteFields(value);
        if (Object.keys(picked).length === 0) {
            return {
                error: this.buildError(
                    'EMPTY_MUTATION_BODY',
                    `${toolName} 的 ${fieldName} 没有可识别的写入字段。`,
                    `请至少提供一个可写字段（如 name、category、enabled、query、check_condition 等）。`
                ),
            };
        }
        return { value: picked };
    }

    private extractBatchItems(params: any, toolName: string): { value?: Record<string, unknown>[]; error?: any } {
        const raw = params?.items ?? params?.payload;
        if (this.isMissingRequiredValue(raw)) {
            return {
                error: this.buildError(
                    'MISSING_REQUIRED_PARAM',
                    `${toolName} 需要 items 或 payload 数组。`,
                    '请传 items 数组，每个 item 包含 id 及变更字段。'
                ),
            };
        }
        if (Array.isArray(raw)) return { value: raw as any };
        if (typeof raw === 'string') {
            const parsed = this.parseJsonStringField(raw, 'items/payload', toolName);
            if ((parsed as any).error) return { error: (parsed as any).error };
            if (!Array.isArray((parsed as any).value)) {
                return {
                    error: this.buildError(
                        'INVALID_PARAM_TYPE',
                        `${toolName} 的 items/payload 必须是数组。`,
                        '如果传 JSON 字符串，请确保顶层是数组。'
                    ),
                };
            }
            return { value: (parsed as any).value };
        }
        return {
            error: this.buildError(
                'INVALID_PARAM_TYPE',
                `${toolName} 的 items/payload 必须是数组或合法 JSON 字符串数组。`,
                '请直接传对象数组，或传可以解析成数组的 JSON 字符串。'
            ),
        };
    }

    private parseMutationObject(
        rawValue: unknown,
        fieldName: string,
        toolName: string
    ): { value: Record<string, unknown>; error?: never } | { error: any } {
        if (this.isPlainObject(rawValue)) return { value: rawValue };
        if (typeof rawValue !== 'string') {
            return {
                error: this.buildError(
                    'INVALID_PARAM_TYPE',
                    `${toolName} 的 ${fieldName} 必须是对象。`,
                    `请把 ${fieldName} 传成对象，或传入可解析为对象的合法 JSON 字符串。`
                ),
            };
        }
        const trimmed = rawValue.trim();
        if (!trimmed) {
            return {
                error: this.buildError(
                    'EMPTY_MUTATION_BODY',
                    `${toolName} 的 ${fieldName} 不能为空字符串。`,
                    `请把 ${fieldName} 传成对象，或传入可解析为对象的合法 JSON 字符串。`
                ),
            };
        }
        try {
            const parsed = JSON.parse(trimmed);
            if (!this.isPlainObject(parsed)) {
                return {
                    error: this.buildError(
                        'INVALID_PARAM_TYPE',
                        `${toolName} 的 ${fieldName} JSON 解析结果不是对象。`,
                        `请确保 ${fieldName} 解析后是对象（顶层 {}），而不是数组或原始值。`
                    ),
                };
            }
            return { value: parsed };
        } catch (e: any) {
            return {
                error: this.buildError(
                    'INVALID_JSON_STRING',
                    `${toolName} 的 ${fieldName} 不是合法 JSON 字符串。`,
                    `请检查 ${fieldName} 的 JSON 语法（引号、逗号、括号）。`,
                    { parse_error: e?.message || 'JSON parse failed', preview: trimmed.slice(0, 300) }
                ),
            };
        }
    }

    private parseJsonStringField(
        rawValue: string,
        fieldName: string,
        toolName: string
    ): { value: any; error?: never } | { error: any } {
        try {
            return { value: JSON.parse(rawValue.trim()) };
        } catch (e: any) {
            return {
                error: this.buildError(
                    'INVALID_JSON',
                    `${toolName} 的 ${fieldName} 不是合法 JSON。`,
                    `请检查 ${fieldName} 的 JSON 语法。`,
                    { parse_error: e?.message || 'JSON parse failed', preview: rawValue.trim().slice(0, 300) }
                ),
            };
        }
    }

    private normalizeJsonEncodedMutationField(
        rawValue: unknown,
        fieldPath: string,
        allowObject: boolean = true
    ): { value?: string; error?: any } {
        if (typeof rawValue === 'string') {
            const trimmed = rawValue.trim();
            if (!trimmed) {
                return {
                    error: this.buildError(
                        'INVALID_JSON_STRING',
                        `${fieldPath} 不能为空字符串。`,
                        `请确保 ${fieldPath} 是合法 JSON 字符串，或直接传对象/数组。`
                    ),
                };
            }
            try {
                JSON.parse(trimmed);
                return { value: trimmed };
            } catch (e: any) {
                return {
                    error: this.buildError(
                        'INVALID_JSON_STRING',
                        `${fieldPath} 不是合法 JSON 字符串。`,
                        `请检查 ${fieldPath} 的 JSON 语法（引号、逗号、括号）。`,
                        { parse_error: e?.message || 'JSON parse failed', preview: trimmed.slice(0, 300) }
                    ),
                };
            }
        }
        if (Array.isArray(rawValue) || (allowObject && this.isPlainObject(rawValue))) {
            return { value: JSON.stringify(rawValue) };
        }
        return {
            error: this.buildError(
                'INVALID_PARAM_TYPE',
                `${fieldPath} 必须是 JSON 字符串、对象或数组。`,
                `请把 ${fieldPath} 传成对象/数组，或合法 JSON 字符串。`
            ),
        };
    }

    private validateRequiredFields(
        payload: Record<string, unknown>,
        requiredFields: readonly string[],
        toolName: string
    ): any | null {
        const missing = requiredFields.filter((f) => this.isMissingRequiredValue(payload[f]));
        if (missing.length === 0) return null;
        return this.buildError(
            'MISSING_REQUIRED_FIELDS',
            `${toolName} 缺少必填字段: ${missing.join(', ')}。`,
            `请补齐后重试：${missing.join(', ')}。`
        );
    }

    private resolveRequiredFieldsForCreate(category: unknown): readonly string[] {
        const c = Number(category);
        if (Number.isFinite(c) && ALERT_CATEGORY_META[c]) {
            return ALERT_CATEGORY_META[c].requiredFields;
        }
        return ALERT_CREATE_REQUIRED_FIELDS;
    }

    private resolveRequestedCategory(params: any): number | null {
        const candidates = [params?.category, params?.cat, params?.type];
        // 支持数字或数字字符串
        for (const cand of candidates) {
            if (typeof cand === 'number' && Number.isFinite(cand)) return cand;
            if (typeof cand === 'string' && cand.trim()) {
                const n = Number(cand.trim());
                if (Number.isFinite(n)) return n;
                // 支持按名称
                const byName = Object.entries(ALERT_CATEGORY_META).find(([, v]) => v.name === cand.trim());
                if (byName) return Number(byName[0]);
            }
        }
        return null;
    }

    private snakeToCamelAlert(alert: Record<string, unknown>): Record<string, unknown> {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(alert)) {
            const camel = SNAKE_TO_CAMEL_ALERT_FIELDS[k] ?? k;
            out[camel] = v;
        }
        return out;
    }

    private isPlainObject(value: unknown): value is Record<string, any> {
        return !!value && typeof value === 'object' && !Array.isArray(value);
    }

    private buildError(errorCode: string, message: string, suggestion: string, details?: any): any {
        return {
            error: message,
            error_code: errorCode,
            suggestion,
            retryable: true,
            details,
        };
    }
}
