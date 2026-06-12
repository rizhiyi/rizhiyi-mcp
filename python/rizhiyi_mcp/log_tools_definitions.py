from __future__ import annotations

from typing import Any

from .types import ToolDefinition

OUTPUT_CONTROL_PROPERTIES: dict[str, Any] = {
    "output_format": {
        "type": "string",
        "description": "输出格式。当前 Python 版先统一返回 JSON 文本，保留该参数以兼容现有调用。",
        "default": "auto",
        "enum": ["auto", "yaml", "csv", "json"],
    },
    "include_raw_json": {
        "type": "boolean",
        "description": "是否在 structuredContent 中附带原始 JSON 数据。",
        "default": False,
    },
    "result_delivery": {
        "type": "string",
        "description": "结果交付方式。auto 小结果内联，大结果转 resource；inline 强制内联；resource 强制转 resource。",
        "default": "auto",
        "enum": ["auto", "inline", "resource"],
    },
    "result_ttl_seconds": {
        "type": "integer",
        "description": "转 resource 时的保活秒数。",
        "minimum": 1,
    },
}


def with_output_controls(tools: list[ToolDefinition]) -> list[ToolDefinition]:
    enriched: list[ToolDefinition] = []
    for tool in tools:
        schema = dict(tool.input_schema)
        properties = dict(schema.get("properties") or {})
        properties.update(OUTPUT_CONTROL_PROPERTIES)
        schema["properties"] = properties
        enriched.append(
            ToolDefinition(
                name=tool.name,
                description=tool.description,
                input_schema=schema,
            )
        )
    return enriched


def with_shared_resource_hint(tools: list[ToolDefinition]) -> list[ToolDefinition]:
    hint = " 大结果默认不会直接内联返回，而是转为 MCP resource 共享并返回 `resource_uri`；如需强制内联，可传 `result_delivery=inline`。"
    enriched: list[ToolDefinition] = []
    for tool in tools:
        description = tool.description
        if "MCP resource" not in description:
            description = f"{description}{hint}"
        enriched.append(
            ToolDefinition(
                name=tool.name,
                description=description,
                input_schema=tool.input_schema,
            )
        )
    return enriched


BASIC_LOG_TOOLS: list[ToolDefinition] = [
    ToolDefinition(
        name="log_search_sheet",
        description=(
            "基础数据概览：按页返回日志明细，并附带总命中数与分页元数据。支持指定字段统计和百分位数计算。"
            "返回中会包含 `page`、`size`、`returned`、`has_more`，当 `has_more=true` 时可继续传入下一页 `page` 查看后续结果。"
            "返回结果会自动包含 `_links` 字段，其中提供了用于在浏览器中打开的、针对关键字段的精准跳转 URL。"
        ),
        input_schema={
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": '搜索查询语句，默认 "*"。',
                    "default": "*",
                },
                "time_range": {
                    "type": "string",
                    "description": '时间范围，例如 "now-1h,now"。',
                    "default": "now-15m,now",
                },
                "index_name": {
                    "type": "string",
                    "description": "索引名称。",
                    "default": "yotta",
                },
                "page": {
                    "type": "integer",
                    "description": "页码，从 0 开始。默认 0。",
                    "default": 0,
                },
                "size": {
                    "type": "integer",
                    "description": "每页返回条数。默认 20。",
                    "default": 20,
                },
                "limit": {
                    "type": "integer",
                    "description": "兼容旧参数，等价于 size；若同时传 size，则以 size 为准。",
                    "default": 20,
                },
                "fields": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": '可选字段投影，仅返回指定字段，例如 ["_time","status","trace_id","message"]。',
                    "default": [],
                },
                "metric_field": {
                    "type": "string",
                    "description": "数值型字段名，若不提供则对 count 聚合。",
                },
                "percentiles": {
                    "type": "array",
                    "items": {"type": "number"},
                    "description": "百分位数数组，默认 [50,90,99]。",
                    "default": [50, 90, 99],
                },
                "delivery_policy": {
                    "type": "string",
                    "description": "仅对 log_search_sheet 的 auto 交付生效。compat：按历史规则；bytes：始终按结果字节大小判断。",
                    "default": "compat",
                    "enum": ["compat", "bytes"],
                },
            },
        },
    ),
    ToolDefinition(
        name="log_reduce_pattern",
        description="日志聚类分析：提交分析任务并返回任务 ID(sid)",
        input_schema={
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": '搜索查询语句，例如 "appname:firewall"。',
                    "default": "*",
                },
                "time_range": {
                    "type": "string",
                    "description": '时间范围，例如 "now-1h,now"。',
                    "default": "now-15m,now",
                },
                "index_name": {
                    "type": "string",
                    "description": "索引名称。",
                    "default": "yotta",
                },
                "pattern_options": {
                    "type": "object",
                    "description": "聚类分析选项。",
                    "properties": {
                        "initial_dist": {"type": "string", "description": "初始距离", "default": "0.01"},
                        "alpha": {"type": "string", "description": "alpha 值", "default": "1.8"},
                        "multi_align_threshold": {
                            "type": "string",
                            "description": "多模式对齐阈值",
                            "default": "0.1",
                        },
                        "pattern_discover_align_threshold": {
                            "type": "string",
                            "description": "模式发现对齐阈值",
                            "default": "0.05",
                        },
                        "find_cluster_align_threshold": {
                            "type": "string",
                            "description": "聚类对齐阈值",
                            "default": "0.2",
                        },
                        "stop_threshold": {
                            "type": "string",
                            "description": "停止阈值",
                            "default": "0.5",
                        },
                    },
                    "additionalProperties": True,
                },
            },
            "required": ["query", "time_range"],
        },
    ),
    ToolDefinition(
        name="log_reduce_preview",
        description=(
            "根据任务 ID(sid)轮询并返回日志聚类结果。适合回答“最近有哪些重复日志模式”“哪几类 raw_message/错误模式最常见”。"
            "当 `analyze_patterns=true` 时，会在返回聚类结果的同时，对每个聚类模式补充时间分布、突发性、周期性、异常点和重要性分析。"
        ),
        input_schema={
            "type": "object",
            "properties": {
                "sid": {
                    "type": "string",
                    "description": "日志聚类分析任务 ID，通过 log_reduce_pattern 获取。",
                },
                "resource_uri": {
                    "type": "string",
                    "description": "可选，共享资源 URI。若来源于 log_reduce_pattern 的大结果返回，可自动从元数据中提取 sid。",
                },
                "max_retries": {
                    "type": "integer",
                    "description": "最大重试次数。",
                    "default": 10,
                },
                "retry_interval": {
                    "type": "integer",
                    "description": "重试间隔（毫秒）。",
                    "default": 5000,
                },
                "analyze_patterns": {
                    "type": "boolean",
                    "description": "是否对返回的每个聚类模式做进一步分析。",
                    "default": False,
                },
                "analysis_limit": {
                    "type": "integer",
                    "description": "当 analyze_patterns=true 时，返回的重要模式分析数量上限。",
                    "default": 20,
                },
            },
        },
    ),
    ToolDefinition(
        name="list_fields",
        description="列出所有日志字段，使用 search/sheets API 提取 results.fields 中的字段信息",
        input_schema={
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": '搜索查询语句，用于限定字段范围，例如 "appname:firewall"，默认为 "*"。',
                    "default": "*",
                },
                "time_range": {
                    "type": "string",
                    "description": '时间范围，例如 "now-1h,now"。',
                    "default": "now-15m,now",
                },
                "index_name": {
                    "type": "string",
                    "description": "索引名称。",
                    "default": "yotta",
                },
            },
        },
    ),
    ToolDefinition(
        name="list_field_values",
        description="列出指定字段的所有值及其出现频率，使用 search/sheets API 获取字段统计信息",
        input_schema={
            "type": "object",
            "properties": {
                "field": {
                    "type": "string",
                    "description": '要查询的字段名称，例如 "appname"。',
                },
                "query": {
                    "type": "string",
                    "description": '搜索查询语句，默认为 "*"。',
                    "default": "*",
                },
                "time_range": {
                    "type": "string",
                    "description": '时间范围，例如 "now-1h,now"。',
                    "default": "now-15m,now",
                },
                "index_name": {
                    "type": "string",
                    "description": "索引名称。",
                    "default": "yotta",
                },
                "limit": {
                    "type": "integer",
                    "description": "返回结果数量限制。",
                    "default": 100,
                },
            },
            "required": ["field", "time_range"],
        },
    ),
    ToolDefinition(
        name="query_precheck",
        description="统一 query 预检工具：在创图或分析前先检查 SPL 语法、快速确认是否有数据，并按预期字段映射检查字段是否齐全。",
        input_schema={
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "要预检的 SPL 查询语句。",
                },
                "mode": {
                    "type": "string",
                    "description": "预检模式：仅语法、仅有数、或完整预检。",
                    "default": "full",
                    "enum": ["syntax_only", "data_only", "full"],
                },
                "time_range": {
                    "type": "string",
                    "description": '时间范围。syntax_only 可省略；data_only/full 建议显式传入，例如 "now-15m,now"。',
                    "default": "now-15m,now",
                },
                "index_name": {
                    "type": "string",
                    "description": "索引名称。",
                    "default": "yotta",
                },
                "expected_fields": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": '可选，预期必须存在的字段列表，例如 ["hostname","cnt"]。',
                    "default": [],
                },
                "field_mapping": {
                    "type": "object",
                    "description": '可选，语义化字段映射，例如 {"xField":"hostname","yField":"cnt"}。',
                    "additionalProperties": True,
                },
                "sample_fields": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "可选，返回样例行时优先保留的字段列表。",
                    "default": [],
                },
                "sample_size": {
                    "type": "integer",
                    "description": "快速有数预检时返回的样例行数量。",
                    "default": 20,
                },
                "terminated_after_size": {
                    "type": "integer",
                    "description": "快速有数预检的分片取样数量。",
                    "default": 100,
                },
            },
            "required": ["query"],
        },
    ),
]


STATISTICAL_ANALYSIS_TOOLS: list[ToolDefinition] = [
    ToolDefinition(
        name="trend_summary",
        description=(
            "趋势概要：当你想回答“最近是在上涨、下跌还是持平”“什么时候冲高/触底”“整体走势怎么样”时使用。"
            "它会按时间桶汇总并给出起止、最值、变化率、斜率、峰值和自然语言总结，适合做时间序列概览。"
        ),
        input_schema={
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": '搜索查询语句，默认 "*"。', "default": "*"},
                "time_range": {
                    "type": "string",
                    "description": '时间范围，例如 "now-1h,now"。',
                    "default": "now-15m,now",
                },
                "index_name": {"type": "string", "description": "索引名称。", "default": "yotta"},
                "bucket": {
                    "type": "string",
                    "description": '可选，固定聚合桶（如 1m/5m/1h）。',
                    "default": "5m",
                },
                "metric_field": {
                    "type": "string",
                    "description": "数值型字段名，若无则按 count 统计。",
                },
                "limit_peaks": {
                    "type": "integer",
                    "description": "返回峰值数量。",
                    "default": 3,
                },
                "resource_uri": {
                    "type": "string",
                    "description": "可选，共享资源 URI。若资源中已包含 series/points，会优先复用已有时间序列。",
                },
            },
        },
    ),
    ToolDefinition(
        name="anomaly_points",
        description=(
            "异常点标识：当你想回答“这条时间序列在哪些时间点突然异常”“哪些桶是离群点”时使用。"
            "它会在单条时间序列上识别异常时间点，适合做 detect anomalies 场景。"
        ),
        input_schema={
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": '搜索查询语句，默认 "*"。', "default": "*"},
                "time_range": {
                    "type": "string",
                    "description": '时间范围，例如 "now-1h,now"。',
                    "default": "now-15m,now",
                },
                "index_name": {"type": "string", "description": "索引名称。", "default": "yotta"},
                "bucket": {
                    "type": "string",
                    "description": '可选，固定聚合桶（如 1m/5m/1h）。',
                    "default": "5m",
                },
                "metric_field": {
                    "type": "string",
                    "description": "数值型字段名，若无则按 count 统计。",
                },
                "method": {
                    "type": "string",
                    "description": '异常检测方法，默认 "zscore"，可选：["zscore", "iqr"]。',
                    "default": "zscore",
                    "enum": ["zscore", "iqr"],
                },
                "sensitivity": {
                    "type": "number",
                    "description": "异常检测灵敏度。",
                    "default": 3,
                },
                "min_support": {
                    "type": "integer",
                    "description": "最小支持度。",
                    "default": 0,
                },
                "resource_uri": {
                    "type": "string",
                    "description": "可选，共享资源 URI。若资源中已包含 series/points，会优先复用已有时间序列。",
                },
            },
        },
    ),
]


INTELLIGENT_ANALYSIS_TOOLS: list[ToolDefinition] = [
    ToolDefinition(
        name="period_compare",
        description=(
            "跨时间段对比分析：当你想回答“今天和昨天相比差了多少”“故障前后哪一段变化最大”时使用。"
            "它适合比较两段时间的总量、趋势和字段分布差异，也可复用已有时间序列数据。"
        ),
        input_schema={
            "type": "object",
            "properties": {
                "previous_time_series_a": {
                    "type": "object",
                    "description": "时间段 A 的已有时间序列数据。",
                },
                "previous_time_series_b": {
                    "type": "object",
                    "description": "时间段 B 的已有时间序列数据。",
                },
                "resource_uri_a": {
                    "type": "string",
                    "description": "可选，共享资源 URI A。若资源中已包含 series/points，将优先复用为时间段 A 数据。",
                },
                "resource_uri_b": {
                    "type": "string",
                    "description": "可选，共享资源 URI B。若资源中已包含 series/points，将优先复用为时间段 B 数据。",
                },
                "query": {
                    "type": "string",
                    "description": '搜索查询语句，默认 "*"。当不提供 previous_time_series 时需提供。',
                    "default": "*",
                },
                "time_range_a": {
                    "type": "string",
                    "description": '第一时间段，例如 "now-2h,now-1h"。',
                    "default": "now-2h,now-1h",
                },
                "time_range_b": {
                    "type": "string",
                    "description": '第二时间段，例如 "now-1h,now"。',
                    "default": "now-1h,now",
                },
                "index_name": {"type": "string", "description": "索引名称。", "default": "yotta"},
                "bucket": {
                    "type": "string",
                    "description": '时间桶大小，如 "1m"、"5m"、"1h"。',
                    "default": "5m",
                },
                "compare_fields": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": '要对比的字段列表，如 ["status", "level"]。',
                    "default": [],
                },
                "topk": {
                    "type": "integer",
                    "description": "返回差异最大的前 K 个字段值。",
                    "default": 10,
                },
                "metric_field": {
                    "type": "string",
                    "description": "数值型字段名，若无则按 count 统计。",
                },
            },
        },
    ),
    ToolDefinition(
        name="correlation_analysis",
        description=(
            "关联分析：当你想回答“哪个数值指标会领先或滞后另一个指标”“哪些字段值经常一起出现”时使用。"
            "数值时间序列相关请用 `lagged_pearson`，离散字段共现请用 `fp_growth`，不确定时可用 `auto` 自动判断。"
        ),
        input_schema={
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": '搜索查询语句，默认 "*"。', "default": "*"},
                "time_range": {
                    "type": "string",
                    "description": '时间范围，例如 "now-1h,now"。',
                    "default": "now-15m,now",
                },
                "index_name": {"type": "string", "description": "索引名称。", "default": "yotta"},
                "fields": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "要分析的字段列表。",
                    "default": [],
                },
                "mode": {
                    "type": "string",
                    "description": "分析模式。",
                    "default": "auto",
                    "enum": ["lagged_pearson", "fp_growth", "auto"],
                },
                "bucket": {
                    "type": "string",
                    "description": '数值模式下的时间桶大小，如 "1m"、"5m"、"1h"。',
                },
                "max_lag": {
                    "type": "integer",
                    "description": "数值模式下最大滞后桶数。",
                    "default": 3,
                },
                "min_support": {
                    "type": "number",
                    "description": "离散模式下最小支持度。",
                    "default": 0.05,
                },
                "min_confidence": {
                    "type": "number",
                    "description": "离散模式下生成关联规则的最小置信度。",
                    "default": 0.6,
                },
                "sample_size": {
                    "type": "integer",
                    "description": "离散模式和 auto 判断时抽样的日志条数。",
                    "default": 500,
                },
                "limit": {
                    "type": "integer",
                    "description": "返回结果数量限制。",
                    "default": 20,
                },
                "resource_uri": {
                    "type": "string",
                    "description": "可选，共享资源 URI。若资源中已包含 rows/sample_rows，会优先复用。",
                },
            },
        },
    ),
    ToolDefinition(
        name="root_cause_suggestions",
        description=(
            "根因分析建议：当你想回答“异常窗口相比基线窗口到底什么变了”“哪一撮日志最可疑”时使用。"
            "工具会同时输出 `distribution_drift` 和 `suspicious_slices`。"
        ),
        input_schema={
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": '搜索查询语句，默认 "*"。', "default": "*"},
                "anomaly_window": {
                    "type": "string",
                    "description": '异常窗口时间范围，例如 "now-30m,now"。',
                    "default": "now-30m,now",
                },
                "baseline_window": {
                    "type": "string",
                    "description": '基线窗口时间范围，例如 "now-90m,now-60m"。',
                    "default": "now-90m,now-60m",
                },
                "index_name": {"type": "string", "description": "索引名称。", "default": "yotta"},
                "candidate_fields": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "候选字段列表。",
                    "default": [],
                },
                "significance_threshold": {
                    "type": "number",
                    "description": "字段分布漂移显著性阈值。",
                    "default": 0.1,
                },
                "topk": {
                    "type": "integer",
                    "description": "返回最重要的 K 个漂移字段和可疑切片。",
                    "default": 5,
                },
                "field_value_limit": {
                    "type": "integer",
                    "description": "每个字段显式查询的值分布上限。",
                    "default": 20,
                },
                "sample_size": {
                    "type": "integer",
                    "description": "异常切片挖掘使用的采样条数。",
                    "default": 300,
                },
                "slice_max_depth": {
                    "type": "integer",
                    "description": "可疑切片组合的最大深度。",
                    "default": 2,
                },
                "min_slice_support": {
                    "type": "number",
                    "description": "可疑切片在异常窗口中的最小支持度。",
                    "default": 0.05,
                },
                "min_slice_lift": {
                    "type": "number",
                    "description": "可疑切片相对基线窗口的最小提升度。",
                    "default": 2,
                },
                "resource_uri": {
                    "type": "string",
                    "description": "可选，共享资源 URI。若资源中已包含异常窗口样本，会优先复用该样本。",
                },
            },
            "required": ["anomaly_window", "baseline_window"],
        },
    ),
]


PREDICTIVE_ANALYSIS_TOOLS: list[ToolDefinition] = [
    ToolDefinition(
        name="trend_forecast",
        description=(
            "趋势预测（短期）：当你想回答“按当前走势接下来几个时间桶会怎么走”“未来是否还会继续升高/降低”时使用。"
            "它基于历史时间序列做短期预测，并返回预测值与置信区间。"
        ),
        input_schema={
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": '搜索查询语句，默认 "*"。', "default": "*"},
                "time_range": {
                    "type": "string",
                    "description": '历史数据时间范围，例如 "now-24h,now"。',
                    "default": "now-24h,now",
                },
                "index_name": {"type": "string", "description": "索引名称。", "default": "yotta"},
                "bucket": {
                    "type": "string",
                    "description": '时间桶大小，如 "1m"、"5m"、"1h"。',
                    "default": "5m",
                },
                "horizon": {
                    "type": "integer",
                    "description": "预测步数（未来多少个桶）。",
                    "default": 12,
                },
                "method": {
                    "type": "string",
                    "description": "预测方法。",
                    "default": "linear_regression",
                    "enum": ["linear_regression", "moving_average", "exponential_smoothing"],
                },
                "confidence": {
                    "type": "number",
                    "description": "置信水平。",
                    "default": 0.95,
                },
                "metric_field": {
                    "type": "string",
                    "description": "数值型字段名，若无则按 count 统计。",
                },
                "window": {
                    "type": "integer",
                    "description": "移动平均窗口大小（仅 moving_average 方法有效）。",
                    "default": 10,
                },
                "alpha": {
                    "type": "number",
                    "description": "指数平滑参数（仅 exponential_smoothing 方法有效）。",
                    "default": 0.3,
                },
                "resource_uri": {
                    "type": "string",
                    "description": "可选，共享资源 URI。若资源中已包含 series/points，会优先复用已有时间序列。",
                },
            },
        },
    ),
    ToolDefinition(
        name="anomaly_alert",
        description="异常预警：结合预测和阈值进行异常检测，支持预测上下界触发告警",
        input_schema={
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": '搜索查询语句，默认 "*"。', "default": "*"},
                "time_range": {
                    "type": "string",
                    "description": '历史数据时间范围，例如 "now-24h,now"。',
                    "default": "now-24h,now",
                },
                "index_name": {"type": "string", "description": "索引名称。", "default": "yotta"},
                "bucket": {
                    "type": "string",
                    "description": '时间桶大小，如 "1m"、"5m"、"1h"。',
                    "default": "5m",
                },
                "method": {
                    "type": "string",
                    "description": "异常检测方法。",
                    "default": "prediction_band",
                    "enum": ["prediction_band", "statistical", "adaptive"],
                },
                "threshold": {
                    "type": "number",
                    "description": "异常阈值（标准差倍数或预测偏差倍数）。",
                    "default": 3.0,
                },
                "alert_on": {
                    "type": "string",
                    "description": "告警触发条件。",
                    "default": "both",
                    "enum": ["upper", "lower", "both"],
                },
                "min_anomaly_points": {
                    "type": "integer",
                    "description": "最少异常点数才触发告警。",
                    "default": 3,
                },
                "forecast_horizon": {
                    "type": "integer",
                    "description": "预测范围（用于 prediction_band 方法）。",
                    "default": 6,
                },
                "metric_field": {
                    "type": "string",
                    "description": "数值型字段名，若无则按 count 统计。",
                },
                "resource_uri": {
                    "type": "string",
                    "description": "可选，共享资源 URI。若资源中已包含 series/points，会优先复用已有时间序列。",
                },
            },
        },
    ),
]


SEARCH_TOOLS: list[ToolDefinition] = with_output_controls(
    with_shared_resource_hint(
        BASIC_LOG_TOOLS + STATISTICAL_ANALYSIS_TOOLS + INTELLIGENT_ANALYSIS_TOOLS + PREDICTIVE_ANALYSIS_TOOLS
    )
)
