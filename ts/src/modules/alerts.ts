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

// ---- 已触发告警历史（index=monitor appname:alert_record） ----

export const ALERT_HISTORY_SEARCH_PATH = '/api/v3/search/sheets/';
export const ALERT_HISTORY_INDEX = 'monitor';
export const ALERT_HISTORY_APPNAME = 'alert_record';
export const ALERT_HISTORY_DEFAULT_TIME_RANGE = '-24h,now';
export const ALERT_HISTORY_DEFAULT_SIZE = 20;
export const ALERT_HISTORY_MAX_SIZE = 200;
export const ALERT_HISTORY_DEFAULT_TIMEZONE = 'Asia/Shanghai';
// 事件描述的截断长度是展示细节，不是查询语义，因此不作为入参暴露，内部固定。
export const ALERT_HISTORY_DESCRIPTION_CHARS = 300;
export const ALERT_HISTORY_TOP_ALERTS = 10;
export const ALERT_HISTORY_SORT_FIELDS = ['timestamp', 'event_time', 'alert_level', 'alert_id', 'value'] as const;
export const ALERT_HISTORY_LEVELS = ['critical', 'high', 'mid', 'low', 'info'] as const;
export const ALERT_HISTORY_DEFAULT_ENTITY_FIELDS = ['result.appname', 'result.ip'] as const;
// 告警记录自身的 appname，不代表被监控系统，作为实体值没有意义。
export const ALERT_HISTORY_MEANINGLESS_ENTITY_VALUES = ['alert_record'] as const;
// complex_value 形如 "cnt:35"，这些是聚合列，不能当实体。
export const ALERT_HISTORY_AGGREGATE_COLUMNS = ['cnt', 'count', 'value', 'avg', 'sum', 'max', 'min', 'total'] as const;

// ---- alert_name 的字面量转义 ----
// 实测结论（两套日志易版本一致，见 ALERT_TRIGGERED_DETAIL_TOOL_DESIGN.md §3.2.1）：
//   1) 带引号的 `alert_name:"x*"` 里 `*` 是**字面量**，静默返回 0 条——不能用来做通配；
//   2) 不带引号的裸值一旦遇到空格/`-`/`/`/`(`/`[`/`:`/`|` 等字符就会被当语法，
//      轻则报 300/2100，重则静默变成"多段 AND"返回 0 条；
//   3) 日志易自己的钻取变量过滤器 `${token|e}` 就是"在特殊字符前面加 `\`"（docs/dashboard.adoc），
//      实测 `alert_name:K8s_kube\-dns\ \/\ CoreDNS_转发错误` 精确命中；
//   4) 转义是**幂等安全**的：`\_`、`\.`、`\,`、`\=`、`\>`、`\*`、`\"`、`\\` 都等价于对应字面量，
//      所以不必逐个甄别"哪些必须转义"，对 ASCII 非字母数字字符统一转义即可。
// 据此：alert_name 一律拼成**不带引号**的 `alert_name:<转义后的字面量>`，走索引（比 | where like 快）；
// 入参里的 `*` 保留不转义，作为通配符；要匹配字面星号目前只能改用 log_search_sheet。
export const ALERT_HISTORY_WILDCARD_CHARS = ['*'] as const;

// ---- 分段（分组）实体字段 ----
// 研发确认的 schema：当 result.is_segmentation=true 时，
//   result.segmentation_field          记录实体字段名（实测取值如 appname / json.DST_IP / json.URL）
//   result.segmentation_specify_value  记录该字段的值
// 注意：当前环境没有真正触发的告警，specify_value 尚未被写入（已实测：这些记录 issue_alert=false、
// 且索引里查不到 specify_value 字段）；一旦有触发数据即会带上。
// result.is_segmentation 仅作指示标记，保留在投影里供调用方判断该行是否分段；实体是否产出以「值存在」为准。
// 扁平 segmentation_field / segmentation_value 是更早环境的历史写法，保留为兼容回退，
// 字段不存在时服务端会静默丢弃，无副作用。
export const ALERT_HISTORY_SEGMENTATION_NAME_FIELDS = ['result.segmentation_field', 'segmentation_field'] as const;
export const ALERT_HISTORY_SEGMENTATION_VALUE_FIELDS = ['result.segmentation_specify_value', 'segmentation_value'] as const;

export const ALERT_NAME_FALLBACK_FIELDS = ['alert_name', 'result.name'] as const;
export const ALERT_TRIGGER_TIME_FALLBACK_FIELDS = [
    'timestamp',
    'event_time',
    'trigger_timestamp',
    'result.trigger_timestamp',
    'result.alert_condition_strategy.trigger_time',
    'result.strategy.trigger.end_time',
    'result.exec_time',
] as const;
export const ALERT_LEVEL_FALLBACK_FIELDS = [
    'alert_level',
    'event_level',
    'result.level',
    'result.strategy.trigger.level',
    'result.alert_condition_strategy.alert_level',
] as const;
export const ALERT_VALUE_FALLBACK_FIELDS = ['value', 'result.result.value'] as const;
export const ALERT_DESCRIPTION_FALLBACK_FIELDS = [
    'result.description',
    'result.strategy.trigger.compare_desc_text',
    'result.strategy.description',
] as const;

export const ALERT_HISTORY_PROJECTION_FLAT_FIELDS = [
    'alert_name',
    'alert_id',
    'alert_level',
    'event_level',
    'value',
    'timestamp',
    'event_time',
    'trigger_timestamp',
    'start_timestamp',
    'end_timestamp',
    'issue_alert',
    'is_recovery',
    'is_suppressed',
    'alert_history_id',
    'appname',
    'alert_type',
    'category',
    'search_url',
    'segmentation_field',
    'segmentation_value',
] as const;
export const ALERT_HISTORY_PROJECTION_NESTED_FIELDS = [
    'result.name',
    'result.alert_id',
    'result.level',
    'result.result.value',
    'result.description',
    'result.strategy.description',
    'result.strategy.trigger.level',
    'result.strategy.trigger.compare',
    'result.strategy.trigger.compare_value',
    'result.strategy.trigger.compare_desc_text',
    'result.alert_condition_strategy.alert_level',
    'result.alert_condition_strategy.trigger_time',
    'result.result.complex_value',
    'result.result.columns.name',
    'result.search.query',
    'result.trigger_timestamp',
    'result.exec_time',
    'result.is_segmentation',
    'result.segmentation_field',
    'result.segmentation_specify_value',
] as const;
export const ALERT_HISTORY_NOTIFICATION_FIELD = 'result.plugin.plugin_result';

export const ALERT_DESCRIPTION_SOURCE_LABELS: Record<string, string> = {
    'result.description': 'result.description',
    'result.strategy.trigger.compare_desc_text': 'strategy_trigger_desc',
    'result.strategy.description': 'strategy_description',
};

const HTML_TAG_RE = /<[^>]*>/g;
const WHITESPACE_RE = /\s+/g;
// 相对时间窗的 `now-<N><unit>` 写法；不同版本日志易支持度不同，统一归一化成 `-<N><unit>`。
const RELATIVE_NOW_RE = /^now\s*-\s*(\d+(?:\.\d+)?)\s*([a-zA-Z]+)$/;
const ALERT_NAME_IN_TEXT_RE = /告警名称\s*[:：]\s*(.+?)(?=\s*告警级别|\s*告警描述|\s*告警产生时间|$)/;
const HTML_ENTITY_REPLACEMENTS: Array<[string, string]> = [
    ['&nbsp;', ' '],
    ['&lt;', '<'],
    ['&gt;', '>'],
    ['&quot;', '"'],
    ['&#39;', "'"],
    ['&amp;', '&'],
];

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

    // ---- 已触发告警历史 ----

    async getTriggeredAlerts(params: any): Promise<any> {
        const built = this.buildHistoryQuery(params);
        if (built.error) return built.error;
        const plan = built.value as Record<string, any>;

        const response = await this.client.get(ALERT_HISTORY_SEARCH_PATH, {
            query: plan.query,
            time_range: plan.time_range,
            page: plan.page,
            size: plan.size,
        });
        if (response.error) return response;
        if (response.data && typeof response.data === 'object' && (response.data as any).result === false) {
            return this.buildError(
                'UPSTREAM_BUSINESS_ERROR',
                'get_triggered_alerts 上游检索接口返回失败。',
                '请检查 time_range / alert_id 等过滤条件，或稍后重试。',
                response.data
            );
        }

        const rows = AlertsModule.extractHistoryRows(response.data);
        const payload = AlertsModule.normalizeHistory(rows, plan, AlertsModule.extractHistoryTotal(response.data));
        return { ...response, raw_data: response.data, data: payload };
    }

    buildHistoryQuery(params: any): { value?: Record<string, any>; error?: any } {
        const timeRange = AlertsModule.normalizeHistoryTimeRange(params?.time_range);

        const entityFields = this.normalizeEntityFields(params?.entity_fields);
        if (entityFields.error) return entityFields;

        const levels = this.normalizeHistoryLevels(params?.levels);
        if (levels.error) return levels;

        const size = AlertsModule.resolveBoundedInt(params?.size, ALERT_HISTORY_DEFAULT_SIZE, 1, ALERT_HISTORY_MAX_SIZE);
        const page = AlertsModule.resolveBoundedInt(params?.page, 0, 0, null);
        const sort = AlertsModule.resolveHistorySort(params?.sort);

        const includeRecovery = typeof params?.include_recovery === 'boolean' ? params.include_recovery : false;

        // 本工具只服务"已触发告警"，issue_alert:true 是恒定条件而非开关——
        // 否则一个叫 getTriggeredAlerts 的工具会返回未触发的执行记录，语义自相矛盾。
        const clauses = [`index=${ALERT_HISTORY_INDEX}`, `appname:${ALERT_HISTORY_APPNAME}`, "'issue_alert':true"];
        if (!includeRecovery) clauses.push("NOT 'is_recovery':true");

        const alertId = AlertsModule.coerceHistoryNumber(params?.alert_id);
        if (alertId !== null) clauses.push(`alert_id:${Math.trunc(alertId)}`);

        const nameFilter = this.buildHistoryNameFilter(params?.alert_name);
        if (nameFilter.error) return nameFilter;
        if (nameFilter.value!.clause) clauses.push(nameFilter.value!.clause);

        const resolvedLevels = levels.value as string[];
        if (resolvedLevels.length) {
            const levelClause = resolvedLevels.map((level) => `alert_level:"${level}"`).join(' OR ');
            clauses.push(`(${levelClause})`);
        }

        const projection = AlertsModule.buildHistoryProjection(entityFields.value as string[]);
        // 刻意不在 SPL 里写 `| limit`：一旦写死条数，HTTP 的 page 参数就翻不动页了
        // （实测 page>=1 恒返回 0 行）。分页交给 size/page 参数处理。
        const query = [clauses.join(' '), `| sort by ${sort}`, `| fields ${projection.join(', ')}`].join(' ');

        return {
            value: {
                query,
                time_range: timeRange,
                page,
                size,
                entity_fields: entityFields.value,
                levels: resolvedLevels,
                include_recovery: includeRecovery,
                include_search_url: params?.include_search_url === true,
                timezone: AlertsModule.resolveHistoryTimezone(params?.timezone),
                sort,
            },
        };
    }

    /**
     * 把 alert_name 入参翻译成主查询里的索引子句。
     *
     * 返回 { value: { clause } }；clause 为空表示不过滤。
     *
     * 语义（已实测，见模块顶部常量注释）：
     * - 不传 / 空串 / 纯 `*`  → 不过滤，即"全系统所有监控"
     * - 不含 `*`             → `alert_name:<转义后的字面量>` 精确匹配
     * - 含 `*`               → 同上，但 `*` 保留为通配符（`交换机*`、`*攻击*`）
     *
     * 两种写法都落在**主查询**里（而非 `| where` 管道），因此都能吃索引。
     */
    buildHistoryNameFilter(raw: unknown): { value?: { clause: string }; error?: any } {
        if (typeof raw !== 'string') return { value: { clause: '' } };
        const text = raw.trim();
        if (!text) return { value: { clause: '' } };
        // 纯通配符等价于"不过滤"。用户直觉上会传 *，不能让它静默变成"匹配字面星号"而返回 0 条。
        if ([...text].every((ch) => (ALERT_HISTORY_WILDCARD_CHARS as readonly string[]).includes(ch))) {
            return { value: { clause: '' } };
        }

        const keepWildcard = [...text].some((ch) => (ALERT_HISTORY_WILDCARD_CHARS as readonly string[]).includes(ch));
        return { value: { clause: `alert_name:${AlertsModule.escapeSplTerm(text, keepWildcard)}` } };
    }

    /**
     * 把字面量转义成可以直接拼进 `field:<值>` 的形式。
     *
     * 规则：**ASCII 非字母数字字符**一律前置反斜杠；非 ASCII 字符（汉字、全角标点）原样保留，
     * 避免对多字节字符做无法验证的转义。
     *
     * 实测（env1 `172.21.16.9` + env2 `192.168.43.196`）转义是幂等安全的：`\_`、`\.`、`\,`、
     * `\=`、`\>`、`\*`、`\"`、`\\` 都与对应字面量等价；而**不**转义时
     * ` `、`-`、`/`、`(`、`)`、`[`、`]`、`:`、`|`、`"`、`'`、`!`、`{`、`}`、`<`、`>`
     * 会报 300/2100 或静默改变匹配结果。所以统一转义是唯一稳的做法。
     *
     * keepWildcard=true 时 `*` 不转义，保留通配语义。
     */
    static escapeSplTerm(text: string, keepWildcard = false): string {
        let out = '';
        for (const ch of text) {
            // 非 ASCII（码点 >= 0x80）原样保留；JS 的 for...of 按码点迭代，代理对不会被拆开。
            if (ch.codePointAt(0)! > 0x7f) {
                out += ch;
            } else if (/[0-9A-Za-z]/.test(ch)) {
                out += ch;
            } else if (keepWildcard && (ALERT_HISTORY_WILDCARD_CHARS as readonly string[]).includes(ch)) {
                out += ch;
            } else {
                out += '\\' + ch;
            }
        }
        return out;
    }

    private normalizeEntityFields(raw: unknown): { value?: string[]; error?: any } {
        if (raw === null || raw === undefined || (typeof raw === 'string' && !raw.trim())) {
            return { value: [...ALERT_HISTORY_DEFAULT_ENTITY_FIELDS] };
        }
        const parsed = this.parseArrayLike(raw);
        if (parsed.error) return { error: parsed.error };
        const fields: string[] = [];
        for (const item of parsed.value as unknown[]) {
            if (typeof item === 'string' && item.trim() && !fields.includes(item.trim())) {
                fields.push(item.trim());
            }
        }
        if (!fields.length) return { value: [...ALERT_HISTORY_DEFAULT_ENTITY_FIELDS] };
        return { value: fields };
    }

    private normalizeHistoryLevels(raw: unknown): { value?: string[]; error?: any } {
        if (raw === null || raw === undefined || (typeof raw === 'string' && !raw.trim())) {
            return { value: [] };
        }
        const parsed = this.parseArrayLike(raw);
        if (parsed.error) return { error: parsed.error };
        const levels: string[] = [];
        for (const item of parsed.value as unknown[]) {
            const name = item === null || item === undefined ? '' : String(item).trim().toLowerCase();
            if (!name) continue;
            if (!(ALERT_HISTORY_LEVELS as readonly string[]).includes(name)) {
                return {
                    error: this.buildError(
                        'INVALID_PARAM_VALUE',
                        `levels 含不支持的级别：${item}。`,
                        `可选级别：${ALERT_HISTORY_LEVELS.join(', ')}。`
                    ),
                };
            }
            if (!levels.includes(name)) levels.push(name);
        }
        return { value: levels };
    }

    private parseArrayLike(raw: unknown): { value?: unknown[]; error?: any } {
        if (Array.isArray(raw)) return { value: raw };
        if (typeof raw === 'string') {
            const trimmed = raw.trim();
            if (!trimmed) return { value: [] };
            if (trimmed.startsWith('[')) {
                let parsed: unknown;
                try {
                    parsed = JSON.parse(trimmed);
                } catch (error: any) {
                    return {
                        error: this.buildError(
                            'INVALID_JSON_STRING',
                            '参数不是合法 JSON 数组字符串。',
                            '请检查 JSON 语法，例如引号、逗号、括号是否完整。',
                            { parse_error: String(error?.message || error), preview: trimmed.slice(0, 300) }
                        ),
                    };
                }
                if (!Array.isArray(parsed)) {
                    return {
                        error: this.buildError(
                            'INVALID_PARAM_TYPE',
                            '参数必须是数组。',
                            '请传入数组，或传入可解析为数组的 JSON 字符串。'
                        ),
                    };
                }
                return { value: parsed };
            }
            return { value: trimmed.split(',').map((item) => item.trim()).filter((item) => item.length > 0) };
        }
        return {
            error: this.buildError(
                'INVALID_PARAM_TYPE',
                '参数必须是数组、逗号分隔字符串，或合法 JSON 数组字符串。',
                '请传入数组，或传入逗号分隔字符串。'
            ),
        };
    }

    private static resolveBoundedInt(raw: unknown, defaultValue: number, minimum: number, maximum: number | null): number {
        if (typeof raw === 'boolean' || raw === null || raw === undefined) return defaultValue;
        let value: number;
        if (typeof raw === 'string') {
            const text = raw.trim();
            if (!/^-?\d+$/.test(text)) return defaultValue;
            value = Number(text);
        } else if (typeof raw === 'number' && Number.isInteger(raw)) {
            value = raw;
        } else {
            return defaultValue;
        }
        if (value < minimum) return minimum;
        if (maximum !== null && value > maximum) return maximum;
        return value;
    }

    private static resolveHistorySort(raw: unknown): string {
        if (typeof raw !== 'string' || !raw.trim()) return '-timestamp';
        const candidate = raw.trim();
        const descending = candidate.startsWith('-');
        const name = descending ? candidate.slice(1).trim() : candidate;
        if (!(ALERT_HISTORY_SORT_FIELDS as readonly string[]).includes(name)) return '-timestamp';
        return descending ? `-${name}` : name;
    }

    /**
     * 归一化时间窗写法，兼容不同版本的日志易。
     *
     * 新版只接受 `-<N><unit>,now`（`now-24h,now` 会报 `参数 time_range 的值需满足…`），
     * 老版两种都接受。实测 `-<N><unit>,now` 在两端通用，故统一转换；
     * epoch 毫秒、`earliest`、绝对时间等原样透传。
     */
    static normalizeHistoryTimeRange(raw: unknown): string {
        const text = typeof raw === 'string' && raw.trim() ? raw.trim() : ALERT_HISTORY_DEFAULT_TIME_RANGE;
        const parts = text.split(',');
        if (parts.length !== 2) return text;
        const normalized = parts.map((part) => {
            const token = part.trim();
            const match = RELATIVE_NOW_RE.exec(token);
            return match ? `-${match[1]}${match[2]}` : token;
        });
        return normalized.join(',');
    }

    private static resolveHistoryTimezone(raw: unknown): string {
        if (typeof raw !== 'string' || !raw.trim()) return ALERT_HISTORY_DEFAULT_TIMEZONE;
        const candidate = raw.trim();
        try {
            new Intl.DateTimeFormat('en-US', { timeZone: candidate });
        } catch {
            return ALERT_HISTORY_DEFAULT_TIMEZONE;
        }
        return candidate;
    }

    private static buildHistoryProjection(entityFields: string[]): string[] {
        const rendered: string[] = [];
        const add = (name: string): void => {
            const candidate = name.includes('.') ? `'${name}'` : name;
            if (!rendered.includes(candidate)) rendered.push(candidate);
        };
        for (const name of ALERT_HISTORY_PROJECTION_FLAT_FIELDS) add(name);
        for (const name of entityFields) add(name);
        for (const name of ALERT_HISTORY_PROJECTION_NESTED_FIELDS) add(name);
        // 通知正文固定投影：它是"事件描述"的回退来源（正规字段为空时从里面刮），
        // 属于内部实现细节而非用户要素，所以不做成入参。
        add(ALERT_HISTORY_NOTIFICATION_FIELD);
        return rendered;
    }

    static extractHistoryRows(data: unknown): Array<Record<string, any>> {
        if (!data || typeof data !== 'object') return [];
        const results = (data as any).results;
        if (!results || typeof results !== 'object') return [];
        const sheets = results.sheets;
        if (!sheets || typeof sheets !== 'object') return [];
        const rows = sheets.rows;
        if (!Array.isArray(rows)) return [];
        return rows.filter((row: unknown): row is Record<string, any> => !!row && typeof row === 'object' && !Array.isArray(row));
    }

    static extractHistoryTotal(data: unknown): number | null {
        if (!data || typeof data !== 'object') return null;
        const results = (data as any).results;
        if (!results || typeof results !== 'object') return null;
        const total = results.total_hits;
        if (typeof total === 'boolean' || typeof total !== 'number' || !Number.isFinite(total)) return null;
        return Math.trunc(total);
    }

    static isEmptyRecordValue(value: unknown): boolean {
        if (value === null || value === undefined) return true;
        if (typeof value === 'boolean') return false;
        if (typeof value === 'string') {
            const text = value.trim();
            return text.length === 0 || text.toLowerCase() === 'null';
        }
        if (Array.isArray(value)) return value.length === 0;
        if (typeof value === 'object') return Object.keys(value as Record<string, unknown>).length === 0;
        return false;
    }

    static firstPresentEntry(row: Record<string, any>, fields: readonly string[]): { field: string | null; value: any } {
        for (const field of fields) {
            if (field in row && !AlertsModule.isEmptyRecordValue(row[field])) {
                return { field, value: row[field] };
            }
        }
        return { field: null, value: null };
    }

    static firstPresent(row: Record<string, any>, fields: readonly string[]): any {
        return AlertsModule.firstPresentEntry(row, fields).value;
    }

    static coerceHistoryNumber(value: unknown): number | null {
        if (typeof value === 'boolean' || value === null || value === undefined) return null;
        if (typeof value === 'number') return Number.isFinite(value) ? value : null;
        if (typeof value === 'string' && value.trim()) {
            const parsed = Number(value.trim());
            return Number.isFinite(parsed) ? parsed : null;
        }
        return null;
    }

    static formatHistoryTime(milliseconds: unknown, timezoneName: string): string | null {
        const number = AlertsModule.coerceHistoryNumber(milliseconds);
        if (number === null) return null;
        const date = new Date(number);
        if (Number.isNaN(date.getTime())) return null;

        let parts: Intl.DateTimeFormatPart[];
        try {
            parts = new Intl.DateTimeFormat('en-US', {
                timeZone: timezoneName,
                hour12: false,
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
            }).formatToParts(date);
        } catch {
            return null;
        }

        const lookup: Record<string, string> = {};
        for (const part of parts) lookup[part.type] = part.value;
        const hour = String(Number(lookup.hour) % 24).padStart(2, '0');
        const base = `${lookup.year}-${lookup.month}-${lookup.day}T${hour}:${lookup.minute}:${lookup.second}`;

        const asUtc = Date.UTC(
            Number(lookup.year),
            Number(lookup.month) - 1,
            Number(lookup.day),
            Number(hour),
            Number(lookup.minute),
            Number(lookup.second)
        );
        const offsetMinutes = Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60000);
        const sign = offsetMinutes >= 0 ? '+' : '-';
        const absolute = Math.abs(offsetMinutes);
        return `${base}${sign}${String(Math.floor(absolute / 60)).padStart(2, '0')}:${String(absolute % 60).padStart(2, '0')}`;
    }

    static stripHtmlText(value: unknown): string {
        if (typeof value !== 'string' || !value) return '';
        let text = value.replace(HTML_TAG_RE, ' ');
        for (const [entity, replacement] of HTML_ENTITY_REPLACEMENTS) {
            text = text.split(entity).join(replacement);
        }
        return text.replace(WHITESPACE_RE, ' ').trim();
    }

    static truncateText(text: string, limit: number): string {
        if (limit <= 0 || text.length <= limit) return text;
        return text.slice(0, limit);
    }

    static extractAlertNameFromNotification(raw: unknown): string | null {
        const text = AlertsModule.stripHtmlText(raw);
        if (!text) return null;
        const match = ALERT_NAME_IN_TEXT_RE.exec(text);
        if (!match) return null;
        return match[1].trim() || null;
    }

    static resolveHistoryDescription(row: Record<string, any>): { description: string | null; source: string } {
        const matched = AlertsModule.firstPresentEntry(row, ALERT_DESCRIPTION_FALLBACK_FIELDS);
        if (matched.field !== null) {
            const text = String(matched.value).trim();
            if (text) {
                return {
                    description: AlertsModule.truncateText(text, ALERT_HISTORY_DESCRIPTION_CHARS),
                    source: ALERT_DESCRIPTION_SOURCE_LABELS[matched.field] || matched.field,
                };
            }
        }
        // 正规描述字段都空时，从通知正文里刮一段作兜底（内部固定策略，不暴露开关）。
        const text = AlertsModule.stripHtmlText(row[ALERT_HISTORY_NOTIFICATION_FIELD]);
        if (text) {
            return { description: AlertsModule.truncateText(text, ALERT_HISTORY_DESCRIPTION_CHARS), source: 'notification_text' };
        }
        return { description: null, source: 'none' };
    }

    static matchEntityField(row: Record<string, any>, field: string): { key: string; value: any } | null {
        const candidates = [field];
        if (!field.startsWith('result.')) candidates.push(`result.${field}`);
        for (const key of candidates) {
            if (!(key in row)) continue;
            const value = row[key];
            if (AlertsModule.isEmptyRecordValue(value)) continue;
            if (typeof value === 'string' && (ALERT_HISTORY_MEANINGLESS_ENTITY_VALUES as readonly string[]).includes(value.trim().toLowerCase())) {
                continue;
            }
            return { key, value };
        }
        return null;
    }

    static parseComplexValueEntities(raw: unknown): Record<string, any> {
        if (typeof raw !== 'string' || !raw.trim()) return {};
        const entities: Record<string, any> = {};
        for (const chunk of raw.split(',')) {
            const separator = chunk.indexOf(':');
            if (separator < 0) continue;
            const key = chunk.slice(0, separator).trim();
            const value = chunk.slice(separator + 1).trim();
            if (!key || !value) continue;
            if ((ALERT_HISTORY_AGGREGATE_COLUMNS as readonly string[]).includes(key.toLowerCase())) continue;
            entities[key] = value;
        }
        return entities;
    }

    static resolveHistoryEntities(row: Record<string, any>, entityFields: string[]): { entities: Record<string, any>; source: string } {
        const entities: Record<string, any> = {};

        // 1) 分段（分组）实体：研发确认 result.is_segmentation=true 时，
        //    result.segmentation_field 是实体字段名、result.segmentation_specify_value 是实体字段值。
        //    以「值存在」为准落地实体——只有标记没有值时（当前环境未真正触发的记录即如此）
        //    不产出实体，继续走后面的回退链。
        const segmentationValue = AlertsModule.firstPresent(row, ALERT_HISTORY_SEGMENTATION_VALUE_FIELDS);
        let hasSegmentation = !AlertsModule.isEmptyRecordValue(segmentationValue);
        if (hasSegmentation) {
            const rawKey = AlertsModule.firstPresent(row, ALERT_HISTORY_SEGMENTATION_NAME_FIELDS);
            const keyName = typeof rawKey === 'string' && rawKey.trim() ? rawKey.trim() : 'segmentation_value';
            if ((ALERT_HISTORY_AGGREGATE_COLUMNS as readonly string[]).includes(keyName.toLowerCase())) {
                hasSegmentation = false;
            } else {
                entities[keyName] = segmentationValue;
            }
        }

        // 2) 用户指定/默认的告警结果字段（与分段实体并存，共同构成"可能涉及的实体"）
        for (const field of entityFields) {
            const matched = AlertsModule.matchEntityField(row, field);
            if (!matched || matched.key in entities) continue;
            entities[matched.key] = matched.value;
        }

        if (Object.keys(entities).length) {
            return { entities, source: hasSegmentation ? 'segmentation_value' : 'entity_fields' };
        }

        // 3) complex_value 形如 "src_ip:10.0.0.1,dst_ip:10.0.0.2"
        const complexEntities = AlertsModule.parseComplexValueEntities(row['result.result.complex_value']);
        if (Object.keys(complexEntities).length) {
            return { entities: complexEntities, source: 'complex_value' };
        }

        return { entities: {}, source: 'none' };
    }

    static resolveHistoryRecovery(row: Record<string, any>): boolean {
        const raw = row['is_recovery'];
        if (typeof raw === 'boolean' && raw) return true;
        if (typeof raw === 'string' && raw.trim().toLowerCase() === 'true') return true;
        const level = row['alert_level'];
        return typeof level === 'string' && level.trim().toLowerCase() === 'no_alert';
    }

    static collectEntityCandidates(rows: Array<Record<string, any>>): string[] {
        const candidates: string[] = [];
        for (const row of rows) {
            const raw = row['result.result.columns.name'];
            let values: unknown[];
            if (Array.isArray(raw)) {
                values = raw;
            } else if (typeof raw === 'string' && raw.trim()) {
                let parsed: unknown = null;
                try {
                    parsed = JSON.parse(raw);
                } catch {
                    parsed = null;
                }
                values = Array.isArray(parsed) ? parsed : raw.replace(/^\[/, '').replace(/\]$/, '').split(',');
            } else {
                values = [];
            }
            for (const item of values) {
                if (typeof item !== 'string') continue;
                const name = item.trim();
                if (!name || candidates.includes(name)) continue;
                if ((ALERT_HISTORY_AGGREGATE_COLUMNS as readonly string[]).includes(name.toLowerCase())) continue;
                candidates.push(name);
            }
            // 分段字段名（如 appname / json.DST_IP）本身就是最贴切的实体候选，
            // 在 entities 落空时能直接告诉调用方该换哪个字段下钻。
            for (const item of ALERT_HISTORY_SEGMENTATION_NAME_FIELDS) {
                const rawName = row[item];
                if (typeof rawName !== 'string') continue;
                const name = rawName.trim();
                if (!name || candidates.includes(name)) continue;
                if ((ALERT_HISTORY_AGGREGATE_COLUMNS as readonly string[]).includes(name.toLowerCase())) continue;
                candidates.push(name);
            }
        }
        return candidates;
    }

    static normalizeHistoryRow(row: Record<string, any>, plan: Record<string, any>): Record<string, any> {
        let alertId = AlertsModule.coerceHistoryNumber(row['alert_id']);
        if (alertId === null) alertId = AlertsModule.coerceHistoryNumber(row['result.alert_id']);

        const nameValue = AlertsModule.firstPresent(row, ALERT_NAME_FALLBACK_FIELDS);
        let alertName =
            (typeof nameValue === 'string' || typeof nameValue === 'number') && !(typeof nameValue === 'boolean')
                ? String(nameValue).trim()
                : null;
        if (!alertName) alertName = AlertsModule.extractAlertNameFromNotification(row[ALERT_HISTORY_NOTIFICATION_FIELD]);
        if (!alertName) alertName = alertId !== null ? `alert_id=${alertId}` : null;

        const triggerMs = AlertsModule.coerceHistoryNumber(AlertsModule.firstPresent(row, ALERT_TRIGGER_TIME_FALLBACK_FIELDS));

        const levelValue = AlertsModule.firstPresent(row, ALERT_LEVEL_FALLBACK_FIELDS);
        const level = typeof levelValue === 'string' && levelValue.trim() ? levelValue.trim().toLowerCase() : null;

        const valueNumber = AlertsModule.coerceHistoryNumber(AlertsModule.firstPresent(row, ALERT_VALUE_FALLBACK_FIELDS));

        const description = AlertsModule.resolveHistoryDescription(row);
        const resolvedEntities = AlertsModule.resolveHistoryEntities(row, plan.entity_fields);

        const historyId = AlertsModule.firstPresent(row, ['alert_history_id']);

        const item: Record<string, any> = {
            alert_name: alertName,
            alert_id: alertId,
            alert_history_id: typeof historyId === 'string' ? historyId : null,
            trigger_time: AlertsModule.formatHistoryTime(triggerMs, plan.timezone),
            trigger_time_ms: triggerMs,
            level,
            value: valueNumber,
            entities: resolvedEntities.entities,
            entity_source: resolvedEntities.source,
            description: description.description,
            description_source: description.source,
            is_recovery: AlertsModule.resolveHistoryRecovery(row),
        };
        if (plan.include_search_url) {
            const searchUrl = row['search_url'];
            item.search_url = typeof searchUrl === 'string' && searchUrl.trim() ? searchUrl : null;
        }
        return item;
    }

    static normalizeHistory(
        rows: Array<Record<string, any>>,
        plan: Record<string, any>,
        total: number | null
    ): Record<string, any> {
        const alerts = rows.map((row) => AlertsModule.normalizeHistoryRow(row, plan));

        const levelCounts: Record<string, number> = {};
        for (const item of alerts) {
            const level = item.level;
            if (typeof level === 'string' && level && level !== 'no_alert') {
                levelCounts[level] = (levelCounts[level] || 0) + 1;
            }
        }

        const grouped = new Map<string, Record<string, any>>();
        for (const item of alerts) {
            const key = item.alert_id !== null && item.alert_id !== undefined ? `id:${item.alert_id}` : item.alert_name;
            if (key === null || key === undefined) continue;
            const entry = grouped.get(String(key)) || { alert_id: item.alert_id, alert_name: item.alert_name, count: 0 };
            entry.count += 1;
            grouped.set(String(key), entry);
        }
        const alertCounts = Array.from(grouped.values())
            .sort((a, b) => {
                if (b.count !== a.count) return b.count - a.count;
                // 必须用码点序（与 Python 的字符串比较一致）；localeCompare 会按语言环境排序，导致双端漂移。
                const left = String(a.alert_name || '');
                const right = String(b.alert_name || '');
                if (left === right) return 0;
                return left < right ? -1 : 1;
            })
            .slice(0, ALERT_HISTORY_TOP_ALERTS);

        const warnings: string[] = [];
        if (total === 0) {
            warnings.push('该时间窗口内没有命中的已触发告警；可放宽 time_range，或把 include_recovery 设为 true 看恢复记录。');
        }
        if (alerts.length && alerts.every((item) => item.entity_source === 'none')) {
            warnings.push(
                '本页所有记录都未携带实体信息：可用 entity_fields 指定其它字段（参考 entity_candidates 里的列名），或改用日志检索服务下钻。'
            );
        }
        const missingValues = alerts.filter((item) => item.value === null).length;
        if (missingValues) {
            warnings.push(`有 ${missingValues} 条记录缺少触发值（value 与 result.result.value 均为空）。`);
        }

        const payload: Record<string, any> = {
            time_range: plan.time_range,
            query_executed: plan.query,
            total,
            returned: alerts.length,
            page: plan.page,
            size: plan.size,
            has_more: total !== null && (plan.page + 1) * plan.size < total,
            level_counts: levelCounts,
            alert_counts: alertCounts,
            alerts,
            warnings,
        };
        // 不回显 entity_fields：那是调用方自己传的入参，默认值也写在 schema 里，
        // 回显只会和 entity_candidates（真正新增的"数据里有哪些列可用"）混淆。
        // 每条记录的 entities 的 key 本身就是所用字段名，已自描述。
        const candidates = AlertsModule.collectEntityCandidates(rows);
        if (candidates.length) payload.entity_candidates = candidates;
        return payload;
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
