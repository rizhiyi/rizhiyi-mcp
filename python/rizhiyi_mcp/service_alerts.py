from __future__ import annotations

import json
import time
from typing import Any

from .config import RuntimeConfig
from .servers import ServiceRuntimeState, create_tool_server
from .service_tooling import BaseServiceModule, ServiceToolRuntime, with_output_controls
from .types import ApiResponse, ToolDefinition

SERVER_LEVEL_INSTRUCTIONS = """使用说明:
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
   g) 已运行一段时间的监控可查 index=monitor alert_id:<alert_id> 的历史运行数据校准阈值，减少告警疲劳或告警盲区。"""

ALERT_JSON_FIELDS = (
    "dataset_ids",
    "extend_dataset_ids",
    "check_condition",
    "check_condition_group",
    "composite_info",
    "extend_conf",
    "run_results",
)

ALERT_MUTATION_WRITE_FIELDS = (
    "name",
    "description",
    "check_interval",
    "interval_unit",
    "check_condition",
    "enabled",
    "category",
    "crontab",
    "restrain_interval",
    "now_restrain_interval",
    "max_restrain_interval",
    "continuous_trigger_value",
    "group_suppress_field",
    "alert_when_recover",
    "generate",
    "graph_enabled",
    "query",
    "extend_query",
    "run_results",
    "dataset_ids",
    "extend_dataset_ids",
    "extend_conf",
    "use_spark",
    "extend_use_spark",
    "segmentation_field",
    "segmentation_result",
    "statistics_field",
    "market_day",
    "alert_line_send",
    "schedule_priority",
    "schedule_window",
    "window",
    "topic",
    "check_condition_group",
    "group_trigger_flag",
    "hosted_flag",
    "composite_info",
    "app_id",
    "export",
    "timezone",
    "alert_condition",
    "recover_condition",
    "alert_state",
    "alert_segmentation_result",
    "rt_names",
    "executor_id",
    "domain_id",
    "uuid",
)

ALERT_CREATE_REQUIRED_FIELDS = ("name", "query", "check_interval", "category", "enabled", "check_condition")

DEFAULT_ALERT_LIST_FIELDS = ",".join(("id", "name", "category", "enabled", "check_interval", "window", "app_id"))

ALERT_CATEGORY_META: dict[int, dict[str, Any]] = {
    0: {
        "name": "关键字监控",
        "description": "基于搜索关键字 + 时间窗口 count 的最基础告警。query 是原生查询字符串（不含 stats 聚合），check_condition.function=count 且不含 field。适用于\"某时间段内某类日志超过 N 条\"类场景。",
        "requiredFields": ["name", "query", "check_interval", "category", "enabled", "check_condition"],
        "specificFields": ["check_condition.function=count", "check_condition 不含 field", "statistics_field 应留空"],
        "sampleCheckCondition": {"timerange": "-5min", "function": "count", "operator": ">", "threshold": "high:0"},
        "sampleBody": {
            "name": "关键字告警-Agent离线",
            "category": 0,
            "enabled": True,
            "check_interval": 300,
            "interval_unit": 1,
            "window": "-5min",
            "dataset_ids": [],
            "query": "tag:rizhiyi_agent_status",
            "check_condition": {"timerange": "-5min", "function": "count", "operator": ">", "threshold": "high:0"},
            "timezone": "Asia/Shanghai",
        },
    },
    1: {
        "name": "字段统计监控",
        "description": "对指定数值字段做聚合统计告警。check_condition.field 指定要聚合的数值字段名（如 apache.req_time），check_condition.function 指定聚合函数（avg/sum/max/min 等）。query 可含 stats...by 做分组，此时 segmentation_field 设为分组字段。",
        "requiredFields": ["name", "query", "check_interval", "category", "enabled", "check_condition"],
        "specificFields": ["check_condition.field = 数值字段名", "check_condition.function = avg/sum/max/min 等", "segmentation_field 可选（stats...by 分组时设置）"],
        "sampleCheckCondition": {"field": "apache.req_time", "function": "max", "timerange": "-10m", "operator": ">", "threshold": "low:0.0001"},
        "sampleBody": {
            "name": "字段统计-最大响应时间告警",
            "category": 1,
            "enabled": True,
            "check_interval": 60,
            "interval_unit": 0,
            "dataset_ids": [{"dataset_id": 1}],
            "query": "* AND 'appname':apache",
            "check_condition": {"field": "apache.req_time", "function": "max", "timerange": "-10m", "operator": ">", "threshold": "low:0.0001"},
            "timezone": "Asia/Shanghai",
        },
    },
    2: {
        "name": "连续统计监控",
        "description": "基于基线值对比的连续统计告警。check_condition 含 base_value（基线值）和 base_comparator（基线比较运算符），对当前统计值与基线值做对比判断。常见于\"业务调用高耗时统计\"等场景。",
        "requiredFields": ["name", "query", "check_interval", "category", "enabled", "check_condition"],
        "specificFields": ["check_condition.base_value 必填", "check_condition.base_comparator 必填（如 >）", "check_condition.field 指定统计字段", "alert_segmentation_result 运行结果"],
        "sampleCheckCondition": {"timerange": "-10m", "function": "count", "operator": ">", "threshold": "info:0;low:10;mid:100;high:1000", "field": "json.HTTP_RESPONSE", "base_value": "5", "base_comparator": ">"},
        "sampleBody": {
            "name": "连续统计-业务调用高耗时告警",
            "category": 2,
            "enabled": True,
            "check_interval": 60,
            "interval_unit": 0,
            "dataset_ids": [],
            "query": "index=tanzhen_test appname:unipro json.L7_PROTOCOL:http",
            "check_condition": {"timerange": "-10m", "function": "count", "operator": ">", "threshold": "info:0;low:10;mid:100;high:1000", "field": "json.HTTP_RESPONSE", "base_value": "5", "base_comparator": ">"},
            "timezone": "Asia/Shanghai",
        },
    },
    3: {
        "name": "突变异常监控",
        "description": "基于时间窗口基线对比的突变检测告警。check_condition 含 base_timerange（基线时间范围，如 now-2m,now-1m），将当前窗口统计值与基线窗口值做百分比/倍数对比。适用于\"某字段值突然飙升\"类场景。",
        "requiredFields": ["name", "query", "check_interval", "category", "enabled", "check_condition"],
        "specificFields": ["check_condition.base_timerange 必填（如 now-2m,now-1m）", "check_condition.field 指定监控字段", "threshold 含百分比格式（如 info:50%）", "dataset_ids 可含 [{dataset_id,node_id}] 对象数组"],
        "sampleCheckCondition": {"timerange": "-1m", "function": "count", "operator": ">", "threshold": "info:50%;mid:100%;high:200%;critical:500%", "field": "apache.status", "base_timerange": "now-2m,now-1m"},
        "sampleBody": {
            "name": "突变异常-status码飙升告警",
            "category": 3,
            "enabled": True,
            "check_interval": 60,
            "interval_unit": 0,
            "dataset_ids": [{"dataset_id": 14, "node_id": 8}],
            "query": "apache.status:404",
            "check_condition": {"timerange": "-1m", "function": "count", "operator": ">", "threshold": "info:50%;mid:100%;high:200%;critical:500%", "field": "apache.status", "base_timerange": "now-2m,now-1m"},
            "timezone": "Asia/Shanghai",
        },
    },
    4: {
        "name": "SPL 统计监控",
        "description": "query 传入完整 SPL（包含 stats 聚合或 inputlookup 等），dataset_ids 通常为 []。可对 SPL 输出列（如 cnt）做阈值判断。",
        "requiredFields": ["name", "query", "check_interval", "category", "enabled", "check_condition"],
        "specificFields": ["query 含完整 SPL（stats/inputlookup 等）", "dataset_ids 一般为 []", "check_condition.field = stats 输出列"],
        "sampleCheckCondition": {"threshold": "mid:0", "field": "cnt", "operator": ">", "timerange": "-1m"},
        "sampleBody": {
            "name": "SPL统计-Syslog未采集告警",
            "category": 4,
            "enabled": True,
            "check_interval": 480,
            "interval_unit": 0,
            "dataset_ids": [],
            "query": "| inputlookup syslog.csv\n| eval nowtime=now()\n| eval max_time=todouble(max_time)\n| sort by -json.last_update_timestamp\n| eval mtime=((tolong(nowtime)-tolong(max_time))/60000/60)\n| stats count() as cnt",
            "check_condition": {"threshold": "mid:0", "field": "cnt", "operator": ">", "timerange": "-1m"},
            "timezone": "Asia/Shanghai",
        },
    },
    5: {
        "name": "流式 lookup 监控",
        "description": "基于 lookup 关联 + 流式计算的告警。topic 指定流式数据源（如 raw_message），query 含 lookup+where 做关联过滤。check_condition.timerange 通常为 \"m\"（分钟级）。check_interval 和 interval_unit 通常为 0（由流式驱动而非定时调度）。",
        "requiredFields": ["name", "query", "topic", "category", "enabled", "check_condition"],
        "specificFields": ["topic 必填（如 raw_message）", "query 含 lookup...on...| where 条件", "check_condition.timerange=\"m\" 典型", "check_interval=0, interval_unit=0 典型"],
        "sampleCheckCondition": {"timerange": "m", "function": "count", "operator": ">", "threshold": "info"},
        "sampleBody": {
            "name": "流式lookup-高危IP匹配告警",
            "category": 5,
            "enabled": True,
            "check_interval": 0,
            "interval_unit": 0,
            "topic": "raw_message",
            "query": "(appname:unipro) | lookup ip_info as ip_name ip_alert.csv on ip=ip_info | where ((ip == ip))",
            "check_condition": {"timerange": "m", "function": "count", "operator": ">", "threshold": "info"},
            "timezone": "Asia/Shanghai",
        },
    },
    6: {
        "name": "流式聚合监控",
        "description": "基于流式计算 + stats 聚合的实时告警。topic 指定流式数据源（如 raw_message），query 含 stats...by+where 做流式聚合统计（区别于 cat=5 的 lookup+where）。check_condition 通常极简（仅 threshold）。check_interval 和 interval_unit 通常为 0（由流式驱动）。window 指定聚合窗口（如 \"10m\"，不带 - 前缀）。",
        "requiredFields": ["name", "query", "topic", "category", "enabled"],
        "specificFields": ["topic 必填（如 raw_message）", "query 含 stats...by + where 做流式聚合", "check_condition 通常仅 threshold", "check_interval=0, interval_unit=0 典型", "window 不带 - 前缀（如 \"10m\"）"],
        "sampleCheckCondition": {"threshold": "info"},
        "sampleBody": {
            "name": "日志打印趋势",
            "category": 6,
            "enabled": True,
            "check_interval": 0,
            "interval_unit": 0,
            "topic": "raw_message",
            "window": "10m",
            "dataset_ids": [],
            "query": "(appname:unipro) | where (((ip) == (\"172.21.16.8\"))) | stats count(tag) as count_ by tag | where ((count_ > 0))",
            "check_condition": {"threshold": "info"},
            "timezone": "Asia/Shanghai",
        },
    },
    19: {
        "name": "联合监控",
        "description": "组合多个子监控的联合告警。composite_info 必填，定义子监控的组合关系（operator=or/and，children 数组每项含 alert_uuid 和 watched_level）。query 通常为 \"*\"，check_condition.threshold=\"auto\"。check_interval 和 interval_unit 通常为 0。",
        "requiredFields": ["name", "composite_info", "category", "enabled"],
        "specificFields": ["composite_info 必填（含 operator + children 数组）", "children[].alert_uuid = 子监控 UUID", "children[].watched_level = 关注级别数组", "query 通常为 *", "check_condition.threshold=auto 典型"],
        "sampleCheckCondition": {"threshold": "auto", "timerange": ""},
        "sampleBody": {
            "name": "联合监控-多告警联合",
            "category": 19,
            "enabled": True,
            "check_interval": 0,
            "interval_unit": 0,
            "query": "*",
            "composite_info": {"operator": "or", "children": [{"alert_uuid": "eab72cded2be4d7d926a4dcb76c6c101", "watched_level": ["info", "low", "mid", "high"], "children": None}]},
            "check_condition": {"threshold": "auto", "timerange": ""},
            "timezone": "Asia/Shanghai",
        },
    },
}

SNAKE_TO_CAMEL_ALERT_FIELDS: dict[str, str] = {
    "domain_id": "domainId",
    "executor_id": "executorId",
    "creator_id": "creatorId",
    "check_interval": "checkInterval",
    "interval_unit": "intervalUnit",
    "check_condition": "checkCondition",
    "restrain_interval": "restrainInterval",
    "now_restrain_interval": "nowRestrainInterval",
    "max_restrain_interval": "maxRestrainInterval",
    "continuous_trigger_value": "continuousTriggerValue",
    "group_suppress_field": "groupSuppressField",
    "alert_when_recover": "alertWhenRecover",
    "graph_enabled": "graphEnabled",
    "extend_query": "extendQuery",
    "run_results": "runResults",
    "dataset_ids": "datasetIds",
    "extend_dataset_ids": "extendDatasetIds",
    "extend_conf": "extendConf",
    "use_spark": "useSpark",
    "extend_use_spark": "extendUseSpark",
    "segmentation_field": "segmentationField",
    "segmentation_result": "segmentationResult",
    "statistics_field": "statisticsField",
    "market_day": "marketDay",
    "alert_line_send": "alertLineSend",
    "schedule_priority": "schedulePriority",
    "schedule_window": "scheduleWindow",
    "check_condition_group": "checkConditionGroup",
    "group_trigger_flag": "groupTriggerFlag",
    "hosted_flag": "hostedFlag",
    "composite_info": "compositeInfo",
    "app_id": "appId",
    "alert_condition": "alertCondition",
    "recover_condition": "recoverCondition",
    "alert_state": "alertState",
    "alert_segmentation_result": "alertSegmentationResult",
    "update_timestamp": "updateTimestamp",
    "last_run_timestamp": "lastRunTimestamp",
    "last_trigger_timestamp": "lastTriggerTimestamp",
    "rt_names": "rtNames",
}


_COMMON_CREATE_PROPERTIES: dict[str, Any] = {
    "name": {"type": "string", "description": "监控名称，必填。"},
    "description": {"type": "string", "description": "监控描述。"},
    "enabled": {"type": "boolean", "description": "是否启用，默认 true。"},
    "check_interval": {"type": "integer", "description": "检查间隔（秒）。建议与 check_condition.timerange（或 window）匹配：timerange=-5min 时 ≤300s，timerange=-1h 时 ≤3600s。"},
    "interval_unit": {"type": "integer", "description": "间隔单位：0=秒，1=分钟，默认 0。"},
    "window": {"type": "string", "description": "查询时间窗口，如 \"-5min\"；流式聚合（category=6）用 \"10m\"（不带 - 前缀）。"},
    "dataset_ids": {"type": "array", "items": {"type": "object", "additionalProperties": True}, "description": "数据源 ID 列表，如 [{\"dataset_id\": 1}] 或 [{\"dataset_id\": 14, \"node_id\": 8}]；也可传 JSON 字符串。"},
    "extend_dataset_ids": {"type": "array", "items": {"type": "object", "additionalProperties": True}, "description": "扩展数据源 ID 列表；也可传 JSON 字符串。"},
    "extend_query": {"type": "string", "description": "扩展搜索语句（字符串，不做 JSON 序列化）。支持 {{alert.result.hits.0.fieldname}} 模板变量引用主搜索结果，及 [[ ... ]] SPL 内嵌子查询。"},
    "extend_conf": {"type": "object", "additionalProperties": True, "description": "固定键值元数据，会被 JSON 序列化传上游；也可传 JSON 字符串。"},
    "segmentation_field": {"type": "string", "description": "分组/切分字段（stats...by 或分割），避免高基数字段（如 raw_message、session_id）。"},
    "graph_enabled": {"type": "boolean", "description": "是否开启图形。"},
    "timezone": {"type": "string", "description": "时区，如 \"Asia/Shanghai\"。"},
    "use_spark": {"type": "boolean", "description": "主查询是否启用高基 spark。"},
    "check_condition_group": {"type": "object", "additionalProperties": True, "description": "多条件组（OR/AND 组合）条件；也可传 JSON 字符串。"},
    "extra": {"type": "object", "additionalProperties": True, "description": "兜底：其他未单独列出的写字段（snake_case）可放这里，本工具会合并进监控 body（白名单过滤）。"},
}

_CHECK_CONDITION_PROPERTY: dict[str, Any] = {
    "check_condition": {
        "oneOf": [
            {"type": "object", "additionalProperties": True, "description": "检查条件对象（snake_case 键）。结构随类型不同而异，参考对应类型描述；也可传合法 JSON 字符串。"},
            {"type": "string", "description": "检查条件的 JSON 对象字符串。"},
        ]
    }
}


def _create_typed_alert_tools() -> list[ToolDefinition]:
    def tool(
        name: str,
        desc: str,
        required: list[str],
        extra_properties: dict[str, Any] | None = None,
    ) -> ToolDefinition:
        properties: dict[str, Any] = dict(_COMMON_CREATE_PROPERTIES)
        properties = {k: dict(v) for k, v in properties.items()}
        properties.update(_CHECK_CONDITION_PROPERTY)
        if extra_properties:
            properties.update(extra_properties)
        schema: dict[str, Any] = {"type": "object", "properties": properties}
        if required:
            schema["required"] = required
        return ToolDefinition(name=name, description=desc, input_schema=schema)

    def query_desc(extra: str) -> str:
        return "查询/检索语句，必填。可作为原生查询字符串或完整 SPL。" + extra

    spl_query = "完整 SPL 查询语句（含 stats/inputlookup 等），必填。结果需产生 check_condition.field 指定的输出列。"

    composite_info = {
        "composite_info": {
            "type": "object",
            "additionalProperties": True,
            "description": "联合监控定义，必填。结构：{\"operator\": \"or|and\", \"children\": [{\"alert_uuid\": \"<子监控UUID>\", \"watched_level\": [\"info\",\"low\",\"mid\",\"high\"], \"children\": null}]}；也可传 JSON 字符串。",
        }
    }

    return [
        tool(
            "create_keyword_alert",
            "创建【关键字监控】（category=0）：基于搜索关键字 + 时间窗口 count 的最基础告警，适用于\"某时间段内某类日志超过 N 条\"类场景。check_condition.function=count（不含 field），statistics_field 必须留空（传了会被拦截）。",
            required=["name", "query", "check_condition"],
            extra_properties={
                "query": {"type": "string", "description": query_desc("此处为原生查询字符串，不包含 stats 聚合。")},
            },
        ),
        tool(
            "create_field_stat_alert",
            "创建【字段统计监控】（category=1）：对指定数值字段做聚合统计告警（avg/sum/max/min 等）。check_condition.field 必填（数值字段名如 apache.req_time），check_condition.function 指定聚合函数。query 可含 stats...by 做分组，此时 segmentation_field 设为分组字段。",
            required=["name", "query", "check_condition"],
            extra_properties={
                "query": {"type": "string", "description": query_desc("可含 stats ... by 分组语句。")},
                "statistics_field": {"type": "string", "description": "要聚合统计的字段名；与 check_condition.field 配合。"},
            },
        ),
        tool(
            "create_baseline_alert",
            "创建【连续统计监控】（category=2）：基于基线值对比的连续统计告警，常见于\"业务调用高耗时统计\"等场景。check_condition 必须含 base_value（基线值）和 base_comparator（比较运算符，如 >），可含 field 指定统计字段。",
            required=["name", "query", "check_condition"],
            extra_properties={
                "query": {"type": "string", "description": query_desc("")},
            },
        ),
        tool(
            "create_surge_alert",
            "创建【突变异常监控】（category=3）：基于时间窗口基线对比的突变检测告警，适用于\"某字段值突然飙升\"类场景。check_condition 必须含 base_timerange（基线时间范围，如 now-2m,now-1m），可含 field 指定监控字段，threshold 含百分比格式（如 info:50%;high:200%）。",
            required=["name", "query", "check_condition"],
            extra_properties={
                "query": {"type": "string", "description": query_desc("")},
            },
        ),
        tool(
            "create_spl_alert",
            "创建【SPL 统计监控】（category=4）：query 传入完整 SPL（含 stats/inputlookup 等）做复杂聚合，dataset_ids 一般为 []。check_condition.field = stats 输出列（如 cnt）。仅当查询需要完整 SPL 语法时才用本类型；简单计数请用 create_keyword_alert。",
            required=["name", "query", "check_condition"],
            extra_properties={
                "query": {"type": "string", "description": spl_query},
            },
        ),
        tool(
            "create_stream_lookup_alert",
            "创建【流式 lookup 监控】（category=5）：基于 lookup 关联 + 流式计算的实时告警。需 topic 指定流式数据源（如 raw_message），query 含 lookup...on...| where 做关联过滤。check_condition.timerange 通常为 \"m\"；check_interval/interval_unit 通常为 0（由流式驱动）。",
            required=["name", "query", "topic", "check_condition"],
            extra_properties={
                "query": {"type": "string", "description": query_desc("此处含 lookup...on... 与 where 过滤。")},
                "topic": {"type": "string", "description": "流式数据源（如 raw_message），必填。"},
            },
        ),
        tool(
            "create_stream_agg_alert",
            "创建【流式聚合监控】（category=6）：基于流式计算 + stats 聚合的实时告警。需 topic 指定流式数据源（如 raw_message），query 含 stats...by+where 做流式聚合统计（区别于 cat=5 的 lookup+where）。check_condition 通常仅 threshold；check_interval/interval_unit 通常为 0；window 不带 - 前缀（如 \"10m\"）。",
            required=["name", "query", "topic"],
            extra_properties={
                "query": {"type": "string", "description": query_desc("此处含 stats ... by 与 where 做流式聚合。")},
                "topic": {"type": "string", "description": "流式数据源（如 raw_message），必填。"},
            },
        ),
        tool(
            "create_composite_alert",
            "创建【联合监控】（category=19）：组合多个子监控的联合告警。composite_info 必填（operator=or/and + children 数组，每项含 alert_uuid 和 watched_level）。query 通常为 *，check_condition.threshold=auto 典型；check_interval/interval_unit 通常为 0。",
            required=["name", "composite_info"],
            extra_properties={
                "query": {"type": "string", "description": "通常传 \"*\"。"},
                **composite_info,
            },
        ),
    ]


ALERT_TOOLS = with_output_controls(
    [
        ToolDefinition(
            name="list_alerts",
            description="获取监控/告警配置列表。默认返回 id,name,category,enabled,check_interval,window,app_id 轻量字段，可通过 fields 自定义列；支持按 category（0=关键字，1=字段统计，2=连续统计，3=突变异常，4=SPL 统计，5=流式 lookup，6=流式聚合，19=联合监控）、enabled、name、app_id、rt_ids 等过滤；支持 page/size 分页和 sort 排序。创建/更新监控前建议先 get_alert_category_reference 看类别差异。",
            input_schema={
                "type": "object",
                "properties": {
                    "fields": {"type": "string", "description": "自定义返回字段列表（逗号分隔）。默认返回 id,name,category,enabled,check_interval,window,app_id，不带大段 JSON。"},
                    "permits": {"type": "string", "description": "是否返回权限集合，默认 true。"},
                    "page": {"type": "integer", "description": "页码，从 0 开始，默认 0。"},
                    "size": {"type": "integer", "description": "每页条数，默认 10。"},
                    "id": {"type": "integer", "description": "按监控 ID 精确过滤。"},
                    "name": {"type": "string", "description": "按监控名称过滤。"},
                    "domain_id": {"type": "integer", "description": "按 domain_id 过滤。"},
                    "executor_id": {"type": "integer", "description": "按执行人 ID 过滤。"},
                    "creator_id": {"type": "integer", "description": "按创建人 ID 过滤。"},
                    "description": {"type": "string", "description": "按描述关键字过滤。"},
                    "crontab": {"type": "string", "description": "按 crontab 表达式过滤。"},
                    "query": {"type": "string", "description": "按主查询字符串过滤。"},
                    "extend_query": {"type": "string", "description": "按 extend_query 字符串过滤。"},
                    "graph_enabled": {"type": "boolean", "description": "按是否开启图形过滤。"},
                    "use_spark": {"type": "boolean", "description": "按主查询是否启用高基 spark 过滤。"},
                    "extend_use_spark": {"type": "boolean", "description": "按 extend 是否启用高基 spark 过滤。"},
                    "extend_conf": {"type": "string", "description": "按 extend_conf 子串过滤。"},
                    "segmentation_field": {"type": "string", "description": "按切分字段名过滤。"},
                    "alert_line_send": {"type": "boolean", "description": "按是否启用线路发送过滤。"},
                    "hosted_flag": {"type": "boolean", "description": "按是否托管（流式匹配）过滤。"},
                    "category": {"type": "integer", "description": "按监控类别过滤：0=关键字 1=字段统计 2=连续统计 3=突变异常 4=SPL统计 5=流式lookup 6=流式聚合 19=联合监控。"},
                    "app_id": {"type": "integer", "description": "按所属应用 app_id 过滤。"},
                    "rt_ids": {"type": "string", "description": "按资源标签过滤，多个标签 ID 用逗号分隔。"},
                    "sort": {"type": "string", "description": "排序规则，可选 check_interval/continuous_trigger_value/crontab/enabled/group_suppress_field/id/name/restrain_interval/segmentation_field，前缀 - 表示降序，默认 -id。"},
                },
            },
        ),
        ToolDefinition(
            name="get_alert_detail",
            description="获取单个监控的完整配置详情（含只读字段 id, create_time, update_timestamp, last_run_timestamp, last_trigger_timestamp, alert_metas, rt_list 等）。通常在 update 前调用，读取当前 body 作为 changes 起点；或在 create 后读取确认字段。",
            input_schema={
                "type": "object",
                "properties": {
                    "id": {"type": "integer", "description": "监控 ID。"},
                    "fields": {"type": "string", "description": "可选，指定返回字段列表。"},
                    "permit": {"type": "string", "description": "可选，是否返回权限集合。"},
                },
                "required": ["id"],
            },
        ),
        ToolDefinition(
            name="get_alerts_batch",
            description="批量按 ID 集合获取多个监控详情（/alerts/set/ 接口）。",
            input_schema={
                "type": "object",
                "properties": {
                    "ids": {"type": "array", "items": {"type": "integer"}, "description": "监控 ID 数组，例如 [1178,1180,214]；也兼容传入逗号字符串 \"1178,1180,214\"（会在内部转换）。"},
                    "id_list": {"type": "string", "description": "兼容字段：逗号分隔的 ID 列表，例如 \"214,1178\"。当 ids 缺省时读取此字段。"},
                    "fields": {"type": "string", "description": "自定义返回字段。"},
                    "permits": {"type": "string", "description": "是否返回权限集合。"},
                },
            },
        ),
        *_create_typed_alert_tools(),
        ToolDefinition(
            name="update_alert",
            description="更新单个监控。**必须先调用 get_alert_detail(id) 读取该监控当前完整配置，再组装 changes 对象**（只传要改的字段），切勿凭记忆重写整段配置。changes 为对象（推荐）或合法 JSON 字符串；JSON 字段自动序列化、category 冲突校验（只校验 changes 中存在的 category）逻辑生效。若当前监控是 category=19 联合监控，变更 composite_info 需谨慎。",
            input_schema={
                "type": "object",
                "properties": {
                    "id": {"type": "integer", "description": "监控 ID，必填。"},
                    "changes": {
                        "oneOf": [
                            {
                                "type": "object",
                                "additionalProperties": True,
                                "description": "待更新字段（snake_case），属性与各 create_* 工具的同名字段一致；也可直接传合法 JSON 对象字符串，内部会自动解析为对象。建议先 get_alert_detail 读取当前配置后做局部修改。",
                            },
                            {"type": "string", "description": "待更新字段的 JSON 对象字符串。"},
                        ]
                    },
                },
                "required": ["id", "changes"],
            },
        ),
        ToolDefinition(
            name="update_alerts_batch",
            description="批量更新多个监控（/alerts/set/）。每个 item 必须包含 id；其余字段走与 update_alert 相同的 JSON 预处理。items 支持对象数组，也兼容合法 JSON 字符串数组（内部自动解析）。",
            input_schema={
                "type": "object",
                "properties": {
                    "items": {"type": "array", "items": {"type": "object", "additionalProperties": True}, "description": "批量更新的 items 数组，每个对象包含 id 及变更字段；也兼容传入可解析为对象数组的 JSON 字符串（内部自动转换）。"},
                    "payload": {"type": "array", "items": {"type": "object", "additionalProperties": True}, "description": "兼容字段：与 items 语义相同，当 items 缺省时读取 payload；也可传入可解析的 JSON 字符串。"},
                },
            },
        ),
        ToolDefinition(
            name="delete_alert",
            description="删除单个监控。",
            input_schema={"type": "object", "properties": {"id": {"type": "integer", "description": "监控 ID，必填。"}}, "required": ["id"]},
        ),
        ToolDefinition(
            name="delete_alerts_batch",
            description="批量删除多个监控（/alerts/set/）。",
            input_schema={
                "type": "object",
                "properties": {
                    "ids": {"type": "array", "items": {"type": "integer"}, "description": "监控 ID 数组，例如 [214, 1178]；也兼容传入逗号字符串 \"214,1178\"（内部自动转换）。"},
                    "id_list": {"type": "string", "description": "兼容字段：逗号分隔的 ID 列表，例如 \"214,1178\"；当 ids 缺省时读取此字段。"},
                },
            },
        ),
        ToolDefinition(
            name="preview_alert",
            description="告警发送预览：提交 alert 草稿（模型按目标监控类型的字段结构拼装，类型差异见 get_alert_category_reference）和可选 alert_meta/plugin_id/timeout，返回 sid。预览并不会真的触发创建，而是跑一遍条件匹配和通知渠道渲染。拿到 sid 后，再用 get_alert_pretest_result(sid) 轮询最终输出（正文/错误等）。alert 字段支持 snake_case（本工具自动转换为上游需要的 camelCase）。alert 支持对象或合法 JSON 字符串两种写法，alert_meta 也支持对象或 JSON 字符串，内部统一处理，category 与字段冲突、非法 JSON 会本地拦截。",
            input_schema={
                "type": "object",
                "properties": {
                    "alert": {
                        "oneOf": [
                            {
                                "type": "object",
                                "additionalProperties": True,
                                "description": "必填，监控草稿（snake_case 或 camelCase 皆可）；也可传入合法 JSON 对象字符串，内部自动解析。按目标监控类型（0/1/2/3/4/5/6/19）的字段结构拼装。",
                            },
                            {"type": "string", "description": "监控草稿的 JSON 对象字符串。"},
                        ]
                    },
                    "alert_meta": {
                        "oneOf": [
                            {
                                "type": "object",
                                "additionalProperties": True,
                                "description": "可选，通知渠道元数据；结构按上游 alerts plugin 的格式。也支持传入合法 JSON 对象字符串。",
                            },
                            {"type": "string", "description": "通知渠道元数据的 JSON 对象字符串。"},
                        ]
                    },
                    "plugin_id": {"type": "number", "description": "可选，插件 ID。"},
                    "timeout": {"type": "number", "description": "可选，超时（毫秒）。"},
                },
                "required": ["alert"],
            },
        ),
        ToolDefinition(
            name="testrun_alert",
            description="告警测试运行：比 preview 更接近真实触发，会按实际的查询与窗口/统计跑一遍后尝试通知。参数、字段转换、JSON 预处理、sid 轮询方式与 preview_alert 完全相同。建议在正式 create/update 前至少跑一次 testrun。",
            input_schema={
                "type": "object",
                "properties": {
                    "alert": {
                        "oneOf": [
                            {
                                "type": "object",
                                "additionalProperties": True,
                                "description": "必填，监控草稿对象；也可传入合法 JSON 对象字符串，内部自动解析。",
                            },
                            {"type": "string", "description": "监控草稿的 JSON 对象字符串。"},
                        ]
                    },
                    "alert_meta": {
                        "oneOf": [
                            {
                                "type": "object",
                                "additionalProperties": True,
                                "description": "可选，通知渠道元数据对象；也可传入合法 JSON 对象字符串。",
                            },
                            {"type": "string", "description": "通知渠道元数据的 JSON 对象字符串。"},
                        ]
                    },
                    "plugin_id": {"type": "number", "description": "可选，插件 ID。"},
                    "timeout": {"type": "number", "description": "可选，超时（毫秒）。"},
                },
                "required": ["alert"],
            },
        ),
        ToolDefinition(
            name="get_alert_pretest_result",
            description="按 sid 获取 preview_alert / testrun_alert 的执行结果。如果结果尚未就绪，返回时会带 _not_ready_hint 提示，建议数秒后用相同 sid 再次调用；或直接传 max_wait_ms 做客户端轮询等待。",
            input_schema={
                "type": "object",
                "properties": {
                    "sid": {"type": "string", "description": "preview_alert 或 testrun_alert 返回的会话 sid，必填。"},
                    "max_wait_ms": {"type": "integer", "description": "客户端轮询最大等待毫秒数。默认 0=只查一次。"},
                    "poll_interval_ms": {"type": "integer", "description": "轮询间隔毫秒，默认 1000ms。"},
                },
                "required": ["sid"],
            },
        ),
        ToolDefinition(
            name="get_alert_references",
            description="获取联合告警关联关系引用（/api/v3/alerts/references/）。用于拼装 category=5 联合监控的 composite_info 时确认被引用监控。",
            input_schema={"type": "object", "properties": {}},
        ),
        ToolDefinition(
            name="get_alert_category_reference",
            description="本地参考工具（不调用外网）：返回 8 类监控（category=0/1/2/3/4/5/6/19）的用途、必填字段、特有字段、最小 check_condition JSON 示例和最小 sampleBody 示例。不传 category 时返回全部 8 类；传 category 时返回对应类别（支持数字/数字字符串/名称如\"关键字监控\"，兼容 type/cat 别名）。任何 create/update 前强烈建议先看一次对应类别的 sampleBody。",
            input_schema={
                "type": "object",
                "properties": {
                    "category": {"type": "string", "description": "可选：指定类别。支持数字 0-5、数字字符串 \"1\"、或类别名称如 \"SPL统计监控\"。当传入数字类型值会自动在内部转换为字符串处理。"},
                    "type": {"type": "string", "description": "兼容字段：category 的别名，用法同上。"},
                    "cat": {"type": "string", "description": "兼容字段：category 的别名，用法同上。"},
                },
            },
        ),
    ]
)


class AlertService(BaseServiceModule):
    # ---- 列表 / 详情 / 批量查询 ----

    async def list_alerts(self, params: dict[str, Any]) -> Any:
        response = await self.request_json(
            "get",
            "/api/v3/alerts/",
            params=self.pick_defined(
                {
                    "fields": self.resolve_list_fields(params.get("fields")),
                    "permits": params.get("permits"),
                    "page": params.get("page"),
                    "size": params.get("size"),
                    "id": params.get("id"),
                    "name": params.get("name"),
                    "domain_id": params.get("domain_id"),
                    "executor_id": params.get("executor_id"),
                    "creator_id": params.get("creator_id"),
                    "description": params.get("description"),
                    "crontab": params.get("crontab"),
                    "query": params.get("query"),
                    "extend_query": params.get("extend_query"),
                    "graph_enabled": params.get("graph_enabled"),
                    "use_spark": params.get("use_spark"),
                    "extend_use_spark": params.get("extend_use_spark"),
                    "extend_conf": params.get("extend_conf"),
                    "segmentation_field": params.get("segmentation_field"),
                    "alert_line_send": params.get("alert_line_send"),
                    "hosted_flag": params.get("hosted_flag"),
                    "category": params.get("category"),
                    "app_id": params.get("app_id"),
                    "rt_ids": params.get("rt_ids"),
                    "sort": params.get("sort"),
                }
            ),
        )
        if response.error:
            return self.api_response_to_error(response)
        if self.is_upstream_business_error(response.data):
            return self.build_error("UPSTREAM_BUSINESS_ERROR", "list_alerts 上游接口返回失败。", "请检查过滤条件或上游服务。", response.data)
        return {"raw_data": response.data, "data": response.data}

    async def get_alert_detail(self, params: dict[str, Any]) -> Any:
        id_result = self.require_id(params.get("id"), "get_alert_detail 需要 id。", suggestion="请提供目标监控的 id（数字或数字字符串）。")
        if id_result.get("error"):
            return id_result["error"]

        response = await self.request_json(
            "get",
            f"/api/v3/alerts/{id_result['value']}/",
            params=self.pick_defined({"fields": params.get("fields"), "permit": params.get("permit")}),
        )
        if response.error:
            return self.api_response_to_error(response)
        if self.is_upstream_business_error(response.data):
            return self.build_error("UPSTREAM_BUSINESS_ERROR", "get_alert_detail 上游接口返回失败。", "请检查 id 是否存在。", response.data)
        data = response.data
        detail = data.get("object") if isinstance(data, dict) else None
        return {"raw_data": response.data, "data": detail if detail is not None else data}

    async def get_alerts_batch(self, params: dict[str, Any]) -> Any:
        id_list_result = self.normalize_id_list(params, allow_ids_array=True, required=False)
        if id_list_result.get("error"):
            return id_list_result["error"]

        response = await self.request_json(
            "get",
            "/api/v3/alerts/set/",
            params=self.pick_defined(
                {
                    "id_list": id_list_result["value"],
                    "fields": params.get("fields"),
                    "permits": params.get("permits"),
                }
            ),
        )
        if response.error:
            return self.api_response_to_error(response)
        if self.is_upstream_business_error(response.data):
            return self.build_error("UPSTREAM_BUSINESS_ERROR", "get_alerts_batch 上游接口返回失败。", "请检查 id_list 是否正确。", response.data)
        return {"raw_data": response.data, "data": response.data}

    # ---- CRUD ----

    CREATE_TYPED_ALERT_CATEGORIES: dict[str, int] = {
        "create_keyword_alert": 0,
        "create_field_stat_alert": 1,
        "create_baseline_alert": 2,
        "create_surge_alert": 3,
        "create_spl_alert": 4,
        "create_stream_lookup_alert": 5,
        "create_stream_agg_alert": 6,
        "create_composite_alert": 19,
    }

    def build_typed_rule(self, params: dict[str, Any], category: int, tool_name: str) -> dict[str, Any]:
        rule: dict[str, Any] = {"category": category, "enabled": True}
        for key in ALERT_MUTATION_WRITE_FIELDS:
            if key in params and not self.is_missing_required_value(params.get(key)):
                rule[key] = params[key]
        extra = params.get("extra")
        if self.is_plain_object(extra):
            merged = dict(rule)
            picked = self.pick_write_fields(extra)
            merged.update(picked)
            rule = merged
        elif not self.is_missing_required_value(extra):
            normalized = self.normalize_json_encoded_mutation_field(extra, f"{tool_name}.extra", allow_object=True)
            if normalized.get("error"):
                return {"error": normalized["error"]}
            try:
                parsed = json.loads(normalized["value"])
            except json.JSONDecodeError as exc:
                return self.build_error("INVALID_JSON_STRING", f"{tool_name}.extra 不是合法 JSON 对象字符串。", "请检查 extra 的 JSON 语法。", {"parse_error": str(exc)})
            if not self.is_plain_object(parsed):
                return self.build_error("INVALID_PARAM_TYPE", f"{tool_name}.extra 解析结果不是对象。", "extra 需为对象或合法 JSON 对象字符串。")
            picked = self.pick_write_fields(parsed)
            rule.update(picked)
        rule["category"] = category
        return {"value": rule}

    async def create_typed_alert(self, params: dict[str, Any], category: int, tool_name: str) -> Any:
        rule_result = self.build_typed_rule(params, category, tool_name)
        if rule_result.get("error"):
            return rule_result["error"]
        body = {"rule": rule_result["value"]}
        return await self._create_alert_common(body, tool_name, category)

    async def _create_alert_common(self, params_body: dict[str, Any], tool_name: str, category_value: Any) -> Any:
        body = self.extract_mutation_body(params_body, "rule", tool_name)
        if body.get("error"):
            return body["error"]

        preprocessed = self.preprocess_json_fields(body["value"], f"{tool_name}.rule")
        if preprocessed.get("error"):
            return preprocessed["error"]

        conflict_err = self.validate_category_field_conflicts(preprocessed["value"], tool_name)
        if conflict_err:
            return conflict_err

        required_fields = self.resolve_required_fields_for_create(category_value if category_value is not None else preprocessed["value"].get("category"))
        required_err = self.validate_required_fields(preprocessed["value"], required_fields, tool_name)
        if required_err:
            return required_err

        response = await self.request_json("post", "/api/v3/alerts/", data=preprocessed["value"])
        if response.error:
            return self.api_response_to_error(response)
        if self.is_upstream_business_error(response.data):
            return self.build_error("UPSTREAM_BUSINESS_ERROR", f"{tool_name} 上游接口返回失败。", "请检查必填字段或 category 与字段匹配关系。", response.data)
        return {"raw_data": response.data, "data": response.data}

    async def create_keyword_alert(self, params: dict[str, Any]) -> Any:
        return await self.create_typed_alert(params, 0, "create_keyword_alert")

    async def create_field_stat_alert(self, params: dict[str, Any]) -> Any:
        return await self.create_typed_alert(params, 1, "create_field_stat_alert")

    async def create_baseline_alert(self, params: dict[str, Any]) -> Any:
        return await self.create_typed_alert(params, 2, "create_baseline_alert")

    async def create_surge_alert(self, params: dict[str, Any]) -> Any:
        return await self.create_typed_alert(params, 3, "create_surge_alert")

    async def create_spl_alert(self, params: dict[str, Any]) -> Any:
        return await self.create_typed_alert(params, 4, "create_spl_alert")

    async def create_stream_lookup_alert(self, params: dict[str, Any]) -> Any:
        return await self.create_typed_alert(params, 5, "create_stream_lookup_alert")

    async def create_stream_agg_alert(self, params: dict[str, Any]) -> Any:
        return await self.create_typed_alert(params, 6, "create_stream_agg_alert")

    async def create_composite_alert(self, params: dict[str, Any]) -> Any:
        return await self.create_typed_alert(params, 19, "create_composite_alert")

    async def update_alert(self, params: dict[str, Any]) -> Any:
        id_result = self.require_id(params.get("id"), "update_alert 需要 id。", suggestion="请提供目标监控的 id（数字或数字字符串）。")
        if id_result.get("error"):
            return id_result["error"]

        changes = self.extract_mutation_body(params, "changes", "update_alert")
        if changes.get("error"):
            return changes["error"]

        preprocessed = self.preprocess_json_fields(changes["value"], "update_alert.changes")
        if preprocessed.get("error"):
            return preprocessed["error"]

        category_value = preprocessed["value"].get("category")
        if category_value is not None:
            conflict_err = self.validate_category_field_conflicts(preprocessed["value"], "update_alert")
            if conflict_err:
                return conflict_err

        response = await self.request_json("put", f"/api/v3/alerts/{id_result['value']}/", data=preprocessed["value"])
        if response.error:
            return self.api_response_to_error(response)
        if self.is_upstream_business_error(response.data):
            return self.build_error("UPSTREAM_BUSINESS_ERROR", "update_alert 上游接口返回失败。", "请检查 id 与变更字段。", response.data)
        return {"raw_data": response.data, "data": response.data}

    async def update_alerts_batch(self, params: dict[str, Any]) -> Any:
        items_result = self.extract_batch_items(params, "update_alerts_batch")
        if items_result.get("error"):
            return items_result["error"]

        processed_items: list[dict[str, Any]] = []
        for item in items_result["value"]:
            if not isinstance(item, dict):
                return self.build_error("INVALID_BATCH_ITEM", "update_alerts_batch 的每个 item 必须是对象。", "请把 items 传成对象数组，每个对象包含 id 及变更字段。")
            if self.is_missing_required_value(item.get("id")):
                return self.build_error("MISSING_REQUIRED_FIELDS", "update_alerts_batch 有 item 缺少 id。", "每个 item 都需要显式提供 id，用于定位目标监控。")
            picked = self.pick_write_fields(item)
            preprocessed = self.preprocess_json_fields(picked, "update_alerts_batch.item")
            if preprocessed.get("error"):
                return preprocessed["error"]
            processed_items.append(preprocessed["value"])

        response = await self.request_json("put", "/api/v3/alerts/set/", data=processed_items)
        if response.error:
            return self.api_response_to_error(response)
        if self.is_upstream_business_error(response.data):
            return self.build_error("UPSTREAM_BUSINESS_ERROR", "update_alerts_batch 上游接口返回失败。", "请逐项检查 items 内容。", response.data)
        return {"raw_data": response.data, "data": response.data}

    async def delete_alert(self, params: dict[str, Any]) -> Any:
        id_result = self.require_id(params.get("id"), "delete_alert 需要 id。", suggestion="请提供目标监控的 id（数字或数字字符串）。")
        if id_result.get("error"):
            return id_result["error"]

        response = await self.request_json("delete", f"/api/v3/alerts/{id_result['value']}/")
        if response.error:
            return self.api_response_to_error(response)
        if self.is_upstream_business_error(response.data):
            return self.build_error("UPSTREAM_BUSINESS_ERROR", "delete_alert 上游接口返回失败。", "请检查 id 是否存在。", response.data)
        return {"raw_data": response.data, "data": response.data}

    async def delete_alerts_batch(self, params: dict[str, Any]) -> Any:
        id_list_result = self.normalize_id_list(params, allow_ids_array=True, required=True)
        if id_list_result.get("error"):
            return id_list_result["error"]

        response = await self.request_json("delete", "/api/v3/alerts/set/", params={"id_list": id_list_result["value"]})
        if response.error:
            return self.api_response_to_error(response)
        if self.is_upstream_business_error(response.data):
            return self.build_error("UPSTREAM_BUSINESS_ERROR", "delete_alerts_batch 上游接口返回失败。", "请检查 ids/id_list 是否存在。", response.data)
        return {"raw_data": response.data, "data": response.data}

    # ---- Preview / Testrun / Pretest ----

    async def preview_alert(self, params: dict[str, Any]) -> Any:
        return await self.submit_pretest(params, "preview_alert", "/api/v3/alerts/preview/submit/")

    async def testrun_alert(self, params: dict[str, Any]) -> Any:
        return await self.submit_pretest(params, "testrun_alert", "/api/v3/alerts/testrun/submit/")

    async def submit_pretest(self, params: dict[str, Any], tool_name: str, path: str) -> Any:
        alert_raw = params.get("alert")
        if self.is_missing_required_value(alert_raw):
            return self.build_error("MISSING_REQUIRED_PARAM", f"{tool_name} 需要 alert 参数。", "请传入监控草稿对象或 JSON 字符串；按目标监控类型（0/1/2/3/4/5/6/19）的字段结构拼装，类型差异见 get_alert_category_reference。")

        alert_parsed = self.parse_mutation_object(alert_raw, "alert", tool_name)
        if alert_parsed.get("error"):
            return alert_parsed["error"]
        alert_object = alert_parsed["value"]

        if alert_object.get("category") is not None:
            conflict_err = self.validate_category_field_conflicts(alert_object, tool_name)
            if conflict_err:
                return conflict_err

        preprocessed = self.preprocess_json_fields(alert_object, f"{tool_name}.alert")
        if preprocessed.get("error"):
            return preprocessed["error"]

        camel_alert = self.snake_to_camel_alert(preprocessed["value"])

        alert_meta_serialized = None
        meta_raw = params.get("alert_meta")
        if not self.is_missing_required_value(meta_raw):
            normalized = self.normalize_json_encoded_mutation_field(meta_raw, f"{tool_name}.alert_meta", allow_object=True)
            if normalized.get("error"):
                return normalized["error"]
            alert_meta_serialized = normalized["value"]

        payload = self.pick_defined(
            {
                "alert": camel_alert,
                "alert_meta": alert_meta_serialized,
                "plugin_id": params.get("plugin_id"),
                "timeout": params.get("timeout"),
            }
        )

        response = await self.request_json("post", path, data=payload)
        if response.error:
            return self.api_response_to_error(response)
        if self.is_upstream_business_error(response.data):
            return self.build_error("UPSTREAM_BUSINESS_ERROR", f"{tool_name} 上游接口返回失败。", "请检查 alert 字段是否符合对应 category 的要求。", response.data)
        return {"raw_data": response.data, "data": response.data}

    async def get_alert_pretest_result(self, params: dict[str, Any]) -> Any:
        sid = params.get("sid")
        if self.is_missing_required_value(sid):
            return self.build_error(
                "MISSING_REQUIRED_PARAM",
                "get_alert_pretest_result 需要 sid。",
                "sid 来自 preview_alert / testrun_alert 的返回；请先调用其中一个工具。",
            )

        max_wait_ms = params.get("max_wait_ms")
        if not isinstance(max_wait_ms, int) or max_wait_ms <= 0:
            max_wait_ms = 0
        poll_interval_ms = params.get("poll_interval_ms")
        if not isinstance(poll_interval_ms, int) or poll_interval_ms <= 0:
            poll_interval_ms = 1000

        deadline = time.monotonic() * 1000 + max_wait_ms
        last_response = None
        while True:
            response = await self.request_json("get", "/api/v3/alerts/pretest/preview/", params={"sid": str(sid)})
            if response.error:
                return self.api_response_to_error(response)
            last_response = response
            if self.is_pretest_done(response.data):
                return {"raw_data": response.data, "data": response.data}
            if time.monotonic() * 1000 + poll_interval_ms > deadline:
                break
            time.sleep(poll_interval_ms / 1000.0)
            if time.monotonic() * 1000 >= deadline:
                break

        data = last_response.data if last_response is not None else None
        return {
            "raw_data": data,
            "data": data,
            "_not_ready_hint": "sid 对应结果尚未返回，建议数秒后再用相同 sid 调用 get_alert_pretest_result，可传 max_wait_ms 调整等待。",
        }

    def is_pretest_done(self, data: Any) -> bool:
        if not isinstance(data, dict):
            return False
        if data.get("finished") is True or data.get("done") is True:
            return True
        if isinstance(data.get("finished"), str) and data["finished"].lower() == "true":
            return True
        if isinstance(data.get("meta"), dict) and data["meta"].get("state") == "done":
            return True
        if isinstance(data.get("result"), list):
            return True
        if isinstance(data.get("result"), dict):
            return True
        return False

    # ---- References ----

    async def get_alert_references(self, params: dict[str, Any]) -> Any:
        response = await self.request_json("get", "/api/v3/alerts/references/")
        if response.error:
            return self.api_response_to_error(response)
        if self.is_upstream_business_error(response.data):
            return self.build_error("UPSTREAM_BUSINESS_ERROR", "get_alert_references 上游接口返回失败。", "请检查上游 alerts/references 接口状态。", response.data)
        return {"raw_data": response.data, "data": response.data}

    def get_alert_category_reference(self, params: dict[str, Any]) -> Any:
        requested_category = self.resolve_requested_category(params)
        usage = "不传 category 时返回全部监控类别的完整参考；传 category（数字或数字字符串或名称）时只返回对应类别。"
        catalog = {
            "supported_categories": [
                {"category": category, "name": meta["name"], "description": meta["description"]}
                for category, meta in ALERT_CATEGORY_META.items()
            ],
            "usage": usage,
        }

        if requested_category is None:
            return {"data": {"catalog": catalog, "categories": {str(cat): meta for cat, meta in ALERT_CATEGORY_META.items()}}}

        if requested_category in ALERT_CATEGORY_META:
            return {"data": {"requested_category": requested_category, **ALERT_CATEGORY_META[requested_category]}}

        supported = "，".join(f"{cat}={meta['name']}" for cat, meta in ALERT_CATEGORY_META.items())
        return self.build_error(
            "UNSUPPORTED_ALERT_CATEGORY",
            f"暂不支持监控类别: {requested_category}",
            f"当前支持 0/1/2/3/4/5/6/19 共 8 类监控：{supported}。",
        )

    # ============ 辅助方法 ============

    def preprocess_json_fields(self, body: dict[str, Any], field_path_prefix: str) -> dict[str, Any]:
        out: dict[str, Any] = dict(body)
        for field in ALERT_JSON_FIELDS:
            raw = out.get(field)
            if raw is None:
                continue
            if isinstance(raw, str) and raw.strip() == "":
                continue
            normalized = self.normalize_json_encoded_mutation_field(raw, f"{field_path_prefix}.{field}", allow_object=True)
            if normalized.get("error"):
                return {"error": normalized["error"]}
            out[field] = normalized["value"]
        return {"value": out}

    def validate_category_field_conflicts(self, body: dict[str, Any], tool_name: str) -> dict[str, Any] | None:
        if body.get("category") is None:
            return None
        try:
            category = self.try_to_number(body.get("category"))
        except (TypeError, ValueError):
            category = None
        if category is None:
            return None
        category = int(category)

        def has(key: str) -> bool:
            return not self.is_missing_required_value(body.get(key))

        def name_of(c: int) -> str:
            meta = ALERT_CATEGORY_META.get(c)
            return meta["name"] if meta else f"类别{c}"

        raw_cond = body.get("check_condition")
        cond = None
        if isinstance(raw_cond, str) and raw_cond.strip():
            try:
                cond = json.loads(raw_cond)
            except json.JSONDecodeError:
                cond = None
        elif isinstance(raw_cond, dict):
            cond = raw_cond

        def cond_has(key: str) -> bool:
            return cond is not None and not self.is_missing_required_value(cond.get(key))

        if category == 0 and has("statistics_field"):
            return self.build_error(
                "CATEGORY_FIELD_CONFLICT",
                f"{tool_name}：category=0（关键字监控）与 statistics_field 冲突。",
                f"category=0({name_of(0)}) 不要求 statistics_field；若确实要按数值字段聚合，请改用 category=1({name_of(1)})。",
                {"category": category, "statistics_field": body.get("statistics_field")},
            )

        if category == 1 and not cond_has("field"):
            return self.build_error(
                "CATEGORY_FIELD_CONFLICT",
                f"{tool_name}：category=1（字段统计监控）的 check_condition 缺少 field。",
                f"category=1({name_of(1)}) 的 check_condition.field 必须指定要聚合的数值字段名（如 apache.req_time）。",
                {"category": category},
            )

        if category == 2 and not cond_has("base_value"):
            return self.build_error(
                "CATEGORY_FIELD_CONFLICT",
                f"{tool_name}：category=2（连续统计监控）的 check_condition 缺少 base_value。",
                f"category=2({name_of(2)}) 的 check_condition 必须含 base_value（基线值）和 base_comparator（比较运算符）。",
                {"category": category},
            )

        if category == 3 and not cond_has("base_timerange"):
            return self.build_error(
                "CATEGORY_FIELD_CONFLICT",
                f"{tool_name}：category=3（突变异常监控）的 check_condition 缺少 base_timerange。",
                f"category=3({name_of(3)}) 的 check_condition 必须含 base_timerange（基线时间范围，如 now-2m,now-1m）。",
                {"category": category},
            )

        if category == 5 and not has("topic"):
            return self.build_error(
                "CATEGORY_FIELD_CONFLICT",
                f"{tool_name}：category=5（流式 lookup 监控）缺少 topic。",
                f"category=5({name_of(5)}) 必须传非空的 topic（如 raw_message）；若这是离线批调度告警，请改用 category=0/1/4。",
                {"category": category},
            )

        if category == 6 and not has("topic"):
            return self.build_error(
                "CATEGORY_FIELD_CONFLICT",
                f"{tool_name}：category=6（流式聚合监控）缺少 topic。",
                f"category=6({name_of(6)}) 必须传非空的 topic（如 raw_message）；若这是离线批调度告警，请改用 category=0/1/4。",
                {"category": category},
            )

        if category == 19 and not has("composite_info"):
            return self.build_error(
                "CATEGORY_FIELD_CONFLICT",
                f"{tool_name}：category=19（联合监控）缺少 composite_info。",
                f"category=19({name_of(19)}) 必须传 composite_info（含 operator 和 children 数组，children 每项含 alert_uuid + watched_level）。",
                {"category": category},
            )

        return None

    def resolve_list_fields(self, fields: Any) -> str:
        return fields.strip() if isinstance(fields, str) and fields.strip() else DEFAULT_ALERT_LIST_FIELDS

    def normalize_id_list(self, params: dict[str, Any], *, allow_ids_array: bool = True, required: bool = False) -> dict[str, Any]:
        raw_id_list = params.get("id_list")
        raw_ids = params.get("ids")
        joined: str | None = None

        if not self.is_missing_required_value(raw_id_list) and isinstance(raw_id_list, str):
            joined = raw_id_list.strip()
        elif allow_ids_array:
            if isinstance(raw_ids, list):
                joined = ",".join(str(x) for x in raw_ids)
            elif isinstance(raw_ids, str) and raw_ids.strip():
                joined = raw_ids.strip()

        if not joined:
            if required:
                return {"error": self.build_error("MISSING_REQUIRED_PARAM", "缺少 ids / id_list。", "请传 ids 数组（或逗号字符串），或 id_list 逗号字符串。")}
            return {"value": ""}
        return {"value": joined}

    def extract_mutation_body(self, params: dict[str, Any], field_name: str, tool_name: str) -> dict[str, Any]:
        source = params.get(field_name)
        if source in (None, ""):
            return {
                "error": self.build_error(
                    "MISSING_REQUIRED_PARAM",
                    f"{tool_name} 需要 {field_name}。",
                    f"请在 {field_name} 中传入监控主体对象或合法 JSON 字符串，至少包含 name、query、category 等关键字段。",
                )
            }

        parsed_source = self.parse_mutation_object(source, field_name, tool_name)
        if parsed_source.get("error"):
            return parsed_source

        picked = self.pick_write_fields(parsed_source["value"])
        if not picked:
            return {
                "error": self.build_error(
                    "EMPTY_MUTATION_BODY",
                    f"{tool_name} 的 {field_name} 没有可识别的写入字段。",
                    "请至少提供一个可写字段（如 name、category、enabled、query、check_condition 等）。",
                )
            }
        return {"value": picked}

    def extract_batch_items(self, params: dict[str, Any], tool_name: str) -> dict[str, Any]:
        raw = params.get("items", params.get("payload"))
        if self.is_missing_required_value(raw):
            return {"error": self.build_error("MISSING_REQUIRED_PARAM", f"{tool_name} 需要 items 或 payload 数组。", "请传 items 数组，每个 item 包含 id 及变更字段。")}
        if isinstance(raw, list):
            return {"value": raw}
        if isinstance(raw, str):
            parsed = self.parse_json_string_field(raw, "items/payload", tool_name)
            if parsed.get("error"):
                return {"error": parsed["error"]}
            if not isinstance(parsed["value"], list):
                return {"error": self.build_error("INVALID_PARAM_TYPE", f"{tool_name} 的 items/payload 必须是数组。", "如果传 JSON 字符串，请确保顶层是数组。")}
            return {"value": parsed["value"]}
        return {"error": self.build_error("INVALID_PARAM_TYPE", f"{tool_name} 的 items/payload 必须是数组或合法 JSON 字符串数组。", "请直接传对象数组，或传可以解析成数组的 JSON 字符串。")}

    def parse_mutation_object(self, raw_value: Any, field_name: str, tool_name: str) -> dict[str, Any]:
        if self.is_plain_object(raw_value):
            return {"value": raw_value}
        if not isinstance(raw_value, str):
            return {"error": self.build_error("INVALID_PARAM_TYPE", f"{tool_name} 的 {field_name} 必须是对象。", f"请把 {field_name} 传成对象，或传入可解析为对象的合法 JSON 字符串。")}
        trimmed = raw_value.strip()
        if not trimmed:
            return {"error": self.build_error("EMPTY_MUTATION_BODY", f"{tool_name} 的 {field_name} 不能为空字符串。", f"请把 {field_name} 传成对象，或传入可解析为对象的合法 JSON 字符串。")}
        try:
            parsed = json.loads(trimmed)
        except json.JSONDecodeError as exc:
            return {
                "error": self.build_error(
                    "INVALID_JSON_STRING",
                    f"{tool_name} 的 {field_name} 不是合法 JSON 字符串。",
                    f"请检查 {field_name} 的 JSON 语法（引号、逗号、括号）。",
                    {"parse_error": str(exc), "preview": trimmed[:300]},
                )
            }
        if not self.is_plain_object(parsed):
            return {"error": self.build_error("INVALID_PARAM_TYPE", f"{tool_name} 的 {field_name} JSON 解析结果不是对象。", f"请确保 {field_name} 解析后是对象（顶层 {{}}），而不是数组或原始值。")}
        return {"value": parsed}

    def parse_json_string_field(self, raw_value: str, field_name: str, tool_name: str) -> dict[str, Any]:
        try:
            return {"value": json.loads(raw_value.strip())}
        except json.JSONDecodeError as exc:
            return {
                "error": self.build_error(
                    "INVALID_JSON",
                    f"{tool_name} 的 {field_name} 不是合法 JSON。",
                    f"请检查 {field_name} 的 JSON 语法。",
                    {"parse_error": str(exc), "preview": raw_value.strip()[:300]},
                )
            }

    def normalize_json_encoded_mutation_field(self, raw_value: Any, field_path: str, *, allow_object: bool = True) -> dict[str, Any]:
        if isinstance(raw_value, str):
            trimmed = raw_value.strip()
            if not trimmed:
                return {"error": self.build_error("INVALID_JSON_STRING", f"{field_path} 不能为空字符串。", f"请确保 {field_path} 是合法 JSON 字符串，或直接传对象/数组。")}
            try:
                json.loads(trimmed)
            except json.JSONDecodeError as exc:
                return {"error": self.build_error("INVALID_JSON_STRING", f"{field_path} 不是合法 JSON 字符串。", f"请检查 {field_path} 的 JSON 语法（引号、逗号、括号）。", {"parse_error": str(exc), "preview": trimmed[:300]})}
            return {"value": trimmed}
        if isinstance(raw_value, list) or (allow_object and self.is_plain_object(raw_value)):
            return {"value": json.dumps(raw_value, ensure_ascii=False)}
        return {"error": self.build_error("INVALID_PARAM_TYPE", f"{field_path} 必须是 JSON 字符串、对象或数组。", f"请把 {field_path} 传成对象/数组，或合法 JSON 字符串。")}

    def validate_required_fields(self, payload: dict[str, Any], required_fields: tuple[str, ...], tool_name: str) -> dict[str, Any] | None:
        missing_fields = [field for field in required_fields if self.is_missing_required_value(payload.get(field))]
        if not missing_fields:
            return None
        return self.build_error("MISSING_REQUIRED_FIELDS", f"{tool_name} 缺少必填字段: {', '.join(missing_fields)}。", f"请补齐后重试：{', '.join(missing_fields)}。")

    def resolve_required_fields_for_create(self, category: Any) -> tuple[str, ...]:
        c = self.try_to_number(category)
        if c is not None and int(c) in ALERT_CATEGORY_META:
            return tuple(ALERT_CATEGORY_META[int(c)]["requiredFields"])
        return ALERT_CREATE_REQUIRED_FIELDS

    def resolve_requested_category(self, params: dict[str, Any]) -> int | None:
        for candidate in (params.get("category"), params.get("cat"), params.get("type")):
            if isinstance(candidate, int):
                return candidate
            if isinstance(candidate, str) and candidate.strip():
                number = self.try_to_number(candidate.strip())
                if number is not None:
                    return int(number)
                for cat, meta in ALERT_CATEGORY_META.items():
                    if meta["name"] == candidate.strip():
                        return cat
        return None

    def snake_to_camel_alert(self, alert: dict[str, Any]) -> dict[str, Any]:
        return {SNAKE_TO_CAMEL_ALERT_FIELDS.get(key, key): value for key, value in alert.items()}

    def pick_write_fields(self, source: dict[str, Any]) -> dict[str, Any]:
        return self.pick_defined({key: source.get(key) for key in ALERT_MUTATION_WRITE_FIELDS})

    def api_response_to_error(self, response: ApiResponse[Any]) -> dict[str, Any]:
        return self.build_error(
            response.error_code or "UPSTREAM_REQUEST_FAILED",
            response.message or response.error or "上游请求失败。",
            response.suggestion or "请检查监控告警参数结构后重试。",
            response.details,
        )


def create_alerts_server(runtime_config: RuntimeConfig, service_state: ServiceRuntimeState):
    service = AlertService()
    runtime = ServiceToolRuntime(
        route_name="alert",
        title="监控告警服务",
        default_error_code="ALERTS_EXECUTION_ERROR",
        default_error_suggestion="请检查监控告警参数结构后重试。",
    )
    return create_tool_server(
        route_name="alert",
        server_name="rizhiyi_alert_server",
        title="监控告警服务",
        description="监控/告警配置服务的完整能力。",
        instructions=SERVER_LEVEL_INSTRUCTIONS,
        runtime_config=runtime_config,
        service_state=service_state,
        tool_definitions=ALERT_TOOLS,
        tool_handlers={
            "list_alerts": lambda arguments: runtime.execute(tool_name="list_alerts", arguments=arguments, executor=service.list_alerts),
            "get_alert_detail": lambda arguments: runtime.execute(tool_name="get_alert_detail", arguments=arguments, executor=service.get_alert_detail),
            "get_alerts_batch": lambda arguments: runtime.execute(tool_name="get_alerts_batch", arguments=arguments, executor=service.get_alerts_batch),
            "create_keyword_alert": lambda arguments: runtime.execute(tool_name="create_keyword_alert", arguments=arguments, executor=service.create_keyword_alert),
            "create_field_stat_alert": lambda arguments: runtime.execute(tool_name="create_field_stat_alert", arguments=arguments, executor=service.create_field_stat_alert),
            "create_baseline_alert": lambda arguments: runtime.execute(tool_name="create_baseline_alert", arguments=arguments, executor=service.create_baseline_alert),
            "create_surge_alert": lambda arguments: runtime.execute(tool_name="create_surge_alert", arguments=arguments, executor=service.create_surge_alert),
            "create_spl_alert": lambda arguments: runtime.execute(tool_name="create_spl_alert", arguments=arguments, executor=service.create_spl_alert),
            "create_stream_lookup_alert": lambda arguments: runtime.execute(tool_name="create_stream_lookup_alert", arguments=arguments, executor=service.create_stream_lookup_alert),
            "create_stream_agg_alert": lambda arguments: runtime.execute(tool_name="create_stream_agg_alert", arguments=arguments, executor=service.create_stream_agg_alert),
            "create_composite_alert": lambda arguments: runtime.execute(tool_name="create_composite_alert", arguments=arguments, executor=service.create_composite_alert),
            "update_alert": lambda arguments: runtime.execute(tool_name="update_alert", arguments=arguments, executor=service.update_alert),
            "update_alerts_batch": lambda arguments: runtime.execute(tool_name="update_alerts_batch", arguments=arguments, executor=service.update_alerts_batch),
            "delete_alert": lambda arguments: runtime.execute(tool_name="delete_alert", arguments=arguments, executor=service.delete_alert),
            "delete_alerts_batch": lambda arguments: runtime.execute(tool_name="delete_alerts_batch", arguments=arguments, executor=service.delete_alerts_batch),
            "preview_alert": lambda arguments: runtime.execute(tool_name="preview_alert", arguments=arguments, executor=service.preview_alert),
            "testrun_alert": lambda arguments: runtime.execute(tool_name="testrun_alert", arguments=arguments, executor=service.testrun_alert),
            "get_alert_pretest_result": lambda arguments: runtime.execute(tool_name="get_alert_pretest_result", arguments=arguments, executor=service.get_alert_pretest_result),
            "get_alert_references": lambda arguments: runtime.execute(tool_name="get_alert_references", arguments=arguments, executor=service.get_alert_references),
            "get_alert_category_reference": lambda arguments: runtime.execute(tool_name="get_alert_category_reference", arguments=arguments, executor=service.get_alert_category_reference),
        },
    )
