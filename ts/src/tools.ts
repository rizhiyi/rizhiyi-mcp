import { ToolDefinition } from './types.js';

const outputControlProperties = {
    output_format: {
        type: 'string',
        description: '输出格式，auto会自动选择（扁平表格优先CSV，嵌套对象优先YAML）',
        default: 'auto',
        enum: ['auto', 'yaml', 'csv', 'json']
    },
    include_raw_json: {
        type: 'boolean',
        description: '是否在输出中附带原始JSON数据，默认false',
        default: false
    },
    result_delivery: {
        type: 'string',
        description: '结果交付方式。默认 auto：当结果较小时直接内联返回，结果较大时会自动转为 MCP resource 共享并返回稳定的 resource_uri；inline 强制内联返回；resource 强制转为共享资源。',
        default: 'auto',
        enum: ['auto', 'inline', 'resource']
    },
    result_ttl_seconds: {
        type: 'integer',
        description: '当结果转为共享资源（MCP resource）时的存活秒数；未传则使用服务端默认 TTL。',
        minimum: 1
    }
};

function withOutputControls(tools: ToolDefinition[]): ToolDefinition[] {
    return tools.map((tool) => ({
        ...tool,
        inputSchema: {
            ...tool.inputSchema,
            properties: {
                ...tool.inputSchema.properties,
                ...outputControlProperties
            }
        }
    }));
}

function withSharedResourceHint(tools: ToolDefinition[]): ToolDefinition[] {
    const hint = ' 大结果默认不会直接内联返回，而是转为 MCP resource 共享并返回 `resource_uri`；如需强制内联，可传 `result_delivery=inline`。';
    return tools.map((tool) => ({
        ...tool,
        description: tool.description.includes('MCP resource')
            ? tool.description
            : `${tool.description}${hint}`
    }));
}

// 基础日志工具
export const basicLogTools: ToolDefinition[] = [
    {
        name: 'log_search_sheet',
        description: '基础数据概览：按页返回日志明细，并附带总命中数与分页元数据。支持指定字段统计和百分位数计算。返回中会包含 `page`、`size`、`returned`、`has_more`，当 `has_more=true` 时可继续传入下一页 `page` 查看后续结果。**注意：返回结果会自动包含 `_links` 字段，其中提供了用于在浏览器中打开的、针对关键字段（如 trace_id, context_id, appname 等）的精准跳转 URL。这些链接仅供用户点击查看，不可用于 API 调用。**',
        inputSchema: {
            type: 'object',
            properties: {
                query: { 
                    type: 'string', 
                    description: '搜索查询语句，默认"*"', 
                    default: '*' 
                },
                time_range: { 
                    type: 'string', 
                    description: '时间范围，例如："now-1h,now"',
                    default: 'now-15m,now'
                },
                index_name: { 
                    type: 'string', 
                    description: '索引名称', 
                    default: 'yotta' 
                },
                page: {
                    type: 'integer',
                    description: '页码，从 0 开始。默认 0，返回第一页。',
                    default: 0
                },
                size: {
                    type: 'integer',
                    description: '每页返回条数。默认 20；若结果不够，可保持 size 不变并将 page 加 1 继续翻页。',
                    default: 20
                },
                limit: {
                    type: 'integer',
                    description: '兼容旧参数，等价于 size；若同时传 size，则以 size 为准。',
                    default: 20
                },
                fields: {
                    type: 'array',
                    items: { type: 'string' },
                    description: '可选字段投影，仅返回指定字段，例如 ["_time","status","trace_id","message"]',
                    default: []
                },
                metric_field: { 
                    type: 'string', 
                    description: '数值型字段名，若不提供则对count聚合' 
                },
                percentiles: {
                    type: 'array',
                    items: { type: 'number' },
                    description: '百分位数数组，默认[50,90,99]',
                    default: [50, 90, 99]
                },
                delivery_policy: {
                    type: 'string',
                    description: '仅对 log_search_sheet 的 auto 交付生效。compat：兼容历史习惯，size<=20 时优先内联、size>20 时优先转 resource，但仍保留字节兜底；bytes：始终按结果字节大小判断。',
                    default: 'compat',
                    enum: ['compat', 'bytes']
                }
            }
        }
    },
    {
        name: 'log_reduce_pattern',
        description: '日志聚类分析：提交分析任务并返回任务ID(sid)',
        inputSchema: {
            type: 'object',
            properties: {
                query: { 
                    type: 'string', 
                    description: '搜索查询语句，例如："appname:firewall", "appname:firewall AND status:error"', 
                    default: '*' 
                },
                time_range: { 
                    type: 'string', 
                    description: '时间范围，例如："now-1h,now", "now/d,now+1d/d"',
                    default: 'now-15m,now'
                },
                index_name: { 
                    type: 'string', 
                    description: '索引名称', 
                    default: 'yotta' 
                },
                pattern_options: {
                    type: 'object',
                    description: '聚类分析选项',
                    properties: {
                        initial_dist: {
                            type: 'string',
                            description: '初始距离',
                            default: '0.01'
                        },
                        alpha: {
                            type: 'string',
                            description: 'alpha值',
                            default: '1.8'
                        },
                        multi_align_threshold: {
                            type: 'string',
                            description: '多模式对齐阈值',
                            default: '0.1'
                        },
                        pattern_discover_align_threshold: {
                            type: 'string',
                            description: '模式发现对齐阈值',
                            default: '0.05'
                        },
                        find_cluster_align_threshold: {
                            type: 'string',
                            description: '聚类对齐阈值',
                            default: '0.2'
                        },
                        stop_threshold: {
                            type: 'string',
                            description: '停止阈值',
                            default: '0.5'
                        }
                    },
                    additionalProperties: true
                }
            },
            required: ['query', 'time_range']
        }
    },
    {
        name: 'log_reduce_preview',
        description: '根据任务ID(sid)轮询并返回日志聚类结果。适合回答“最近有哪些重复日志模式”“哪几类 raw_message/错误模式最常见”。当 `analyze_patterns=true` 时，会在返回聚类结果的同时，对每个聚类模式补充时间分布、突发性、周期性、异常点和重要性分析，适合继续判断哪些模式更值得优先排查。',
        inputSchema: {
            type: 'object',
            properties: {
                sid: { 
                    type: 'string', 
                    description: '日志聚类分析任务ID，通过log_reduce_pattern工具获取' 
                },
                resource_uri: {
                    type: 'string',
                    description: '可选，共享资源 URI。若来源于 log_reduce_pattern 的大结果返回，可自动从元数据中提取 sid。'
                },
                max_retries: {
                    type: 'integer',
                    description: '最大重试次数',
                    default: 10
                },
                retry_interval: {
                    type: 'integer',
                    description: '重试间隔(毫秒)',
                    default: 5000
                },
                analyze_patterns: {
                    type: 'boolean',
                    description: '是否对返回的每个聚类模式做进一步分析，默认 false',
                    default: false
                },
                analysis_limit: {
                    type: 'integer',
                    description: '当 analyze_patterns=true 时，返回的重要模式分析数量上限，默认 20',
                    default: 20
                }
            }
        }
    },
    {
        name: 'list_fields',
        description: '列出所有日志字段，使用search/sheets API提取results.fields中的字段信息',
        inputSchema: {
            type: 'object',
            properties: {
                query: { 
                    type: 'string', 
                    description: '搜索查询语句，用于限定字段范围，例如："appname:firewall"，默认为"*"', 
                    default: '*' 
                },
                time_range: { 
                    type: 'string', 
                    description: '时间范围，例如："now-1h,now","now/d,now+1d/d"',
                    default: 'now-15m,now'
                },
                index_name: { 
                    type: 'string', 
                    description: '索引名称', 
                    default: 'yotta' 
                }
            }
        }
    },
    {
        name: 'list_field_values',
        description: '列出指定字段的所有值及其出现频率，使用search/sheets API获取字段统计信息',
        inputSchema: {
            type: 'object',
            properties: {
                field: { 
                    type: 'string', 
                    description: '要查询的字段名称，例如："appname", "status", "src_ip"' 
                },
                query: { 
                    type: 'string', 
                    description: '搜索查询语句，用于限定数据范围，例如："appname:firewall"，默认为"*"', 
                    default: '*' 
                },
                time_range: { 
                    type: 'string', 
                    description: '时间范围，例如："now-1h,now","now/d,now+1d/d"',
                    default: 'now-15m,now'
                },
                index_name: { 
                    type: 'string', 
                    description: '索引名称', 
                    default: 'yotta' 
                },
                limit: {
                    type: 'integer',
                    description: '返回结果数量限制',
                    default: 100
                }
            },
            required: ['field', 'time_range']
        }
    },
    {
        name: 'query_precheck',
        description: '统一 query 预检工具：在创图或分析前先检查 SPL 语法、快速确认是否有数据，并按预期字段映射检查字段是否齐全。推荐 dashboard 创图前优先使用 mode=full。',
        inputSchema: {
            type: 'object',
            properties: {
                query: {
                    type: 'string',
                    description: '要预检的 SPL 查询语句'
                },
                mode: {
                    type: 'string',
                    description: '预检模式：仅语法、仅有数、或完整预检',
                    default: 'full',
                    enum: ['syntax_only', 'data_only', 'full']
                },
                time_range: {
                    type: 'string',
                    description: '时间范围。syntax_only 可省略；data_only/full 建议显式传入，例如 "now-15m,now"',
                    default: 'now-15m,now'
                },
                index_name: {
                    type: 'string',
                    description: '索引名称',
                    default: 'yotta'
                },
                expected_fields: {
                    type: 'array',
                    items: { type: 'string' },
                    description: '可选，预期必须存在的字段列表，例如 ["hostname","cnt"]',
                    default: []
                },
                field_mapping: {
                    type: 'object',
                    description: '可选，语义化字段映射，例如 {"xField":"hostname","yField":"cnt"} 或 {"fromField":"src_ip","toField":"dst_ip","weightField":"count"}',
                    additionalProperties: true
                },
                sample_fields: {
                    type: 'array',
                    items: { type: 'string' },
                    description: '可选，返回样例行时优先保留的字段列表；若同时传了 expected_fields/field_mapping，会自动合并',
                    default: []
                },
                sample_size: {
                    type: 'integer',
                    description: '快速有数预检时返回的样例行数量，默认 20',
                    default: 20
                },
                terminated_after_size: {
                    type: 'integer',
                    description: '快速有数预检的分片取样数量，默认 100',
                    default: 100
                }
            },
            required: ['query']
        }
    },
    
];

// 统计分析工具
export const statisticalAnalysisTools: ToolDefinition[] = [
    {
        name: 'trend_summary',
        description: '趋势概要：当你想回答“最近是在上涨、下跌还是持平”“什么时候冲高/触底”“整体走势怎么样”时使用。它会按时间桶汇总并给出起止、最值、变化率、斜率、峰值和自然语言总结，适合做时间序列概览。它不负责逐点异常判定、跨时间窗口对比或根因归因；要找异常点用 `anomaly_points`，要比较两个时间段用 `period_compare`，要解释异常原因用 `root_cause_suggestions`。',
        inputSchema: {
            type: 'object',
            properties: {
                query: { 
                    type: 'string', 
                    description: '搜索查询语句，默认"*"', 
                    default: '*' 
                },
                time_range: { 
                    type: 'string', 
                    description: '时间范围，例如："now-1h,now"',
                    default: 'now-15m,now'
                },
                index_name: { 
                    type: 'string', 
                    description: '索引名称', 
                    default: 'yotta' 
                },
                bucket: { 
                    type: 'string', 
                    description: '可选，固定聚合桶(如 1m/5m/1h)',
                    default: '5m'
                },
                metric_field: { 
                    type: 'string', 
                    description: '数值型字段名，若无则按count统计' 
                },
                limit_peaks: {
                    type: 'integer',
                    description: '返回峰值数量，默认3',
                    default: 3
                },
                resource_uri: {
                    type: 'string',
                    description: '可选，共享资源 URI。若资源中已包含 series/points，会优先复用已有时间序列，减少重复查询。'
                }
            }
        }
    },
    {
        name: 'anomaly_points',
        description: '异常点标识：当你想回答“这条时间序列在哪些时间点突然异常”“哪些桶是离群点”时使用。它会在单条时间序列上识别异常时间点，适合做 detect anomalies 场景。它不解释异常为什么发生，也不负责跨窗口对比或字段共现分析；要看整体走势用 `trend_summary`，要做异常归因用 `root_cause_suggestions`，要分析指标/字段相关性用 `correlation_analysis`。',
        inputSchema: {
            type: 'object',
            properties: {
                query: { 
                    type: 'string', 
                    description: '搜索查询语句，默认"*"', 
                    default: '*' 
                },
                time_range: { 
                    type: 'string', 
                    description: '时间范围，例如："now-1h,now"',
                    default: 'now-15m,now'
                },
                index_name: { 
                    type: 'string', 
                    description: '索引名称', 
                    default: 'yotta' 
                },
                bucket: { 
                    type: 'string', 
                    description: '可选，固定聚合桶(如 1m/5m/1h)',
                    default: '5m'
                },
                metric_field: { 
                    type: 'string', 
                    description: '数值型字段名，若无则按count统计' 
                },
                method: {
                    type: 'string',
                    description: '异常检测方法，默认"zscore"，可选：["zscore", "iqr"]',
                    default: 'zscore',
                    enum: ['zscore', 'iqr']
                },
                sensitivity: {
                    type: 'number',
                    description: '异常检测灵敏度，z-score方法为倍数，IQR方法为IQR倍数，默认3',
                    default: 3
                },
                min_support: {
                    type: 'integer',
                    description: '最小支持度，默认0',
                    default: 0
                },
                resource_uri: {
                    type: 'string',
                    description: '可选，共享资源 URI。若资源中已包含 series/points，会优先复用已有时间序列，减少重复查询。'
                }
            }
        }
    }
];

// 智能分析工具
export const intelligentAnalysisTools: ToolDefinition[] = [
    {
        name: 'period_compare',
        description: '跨时间段对比分析：当你想回答“今天和昨天相比差了多少”“故障前后哪一段变化最大”“两个窗口的趋势和总量有什么不同”时使用。它适合比较两段时间的总量、趋势和字段分布差异，也可复用已有时间序列数据。它不是逐点异常检测，也不是根因候选排序；要定位异常时间点用 `anomaly_points`，要解释异常窗口相对基线窗口到底什么变了用 `root_cause_suggestions`。',
        inputSchema: {
            type: 'object',
            properties: {
                previous_time_series_a: {
                    type: 'object',
                    description: '时间段A的已有时间序列数据，如 trend_summary 或统一 timechart 查询的输出。兼容 series 数组与旧版 points 数组；提供此参数时将跳过数据获取直接进行分析'
                },
                previous_time_series_b: {
                    type: 'object', 
                    description: '时间段B的已有时间序列数据，如 trend_summary 或统一 timechart 查询的输出。兼容 series 数组与旧版 points 数组；提供此参数时将跳过数据获取直接进行分析'
                },
                resource_uri_a: {
                    type: 'string',
                    description: '可选，共享资源 URI A。若资源中已包含 series/points，将优先复用为时间段A数据。'
                },
                resource_uri_b: {
                    type: 'string',
                    description: '可选，共享资源 URI B。若资源中已包含 series/points，将优先复用为时间段B数据。'
                },
                query: { 
                    type: 'string', 
                    description: '搜索查询语句，默认"*"。当不提供previous_time_series时需提供', 
                    default: '*' 
                },
                time_range_a: { 
                    type: 'string', 
                    description: '第一时间段，例如："now-2h,now-1h"。当不提供previous_time_series_a时需提供',
                    default: 'now-2h,now-1h'
                },
                time_range_b: { 
                    type: 'string', 
                    description: '第二时间段，例如："now-1h,now"。当不提供previous_time_series_b时需提供',
                    default: 'now-1h,now'
                },
                index_name: { 
                    type: 'string', 
                    description: '索引名称', 
                    default: 'yotta' 
                },
                bucket: { 
                    type: 'string', 
                    description: '时间桶大小，如"1m"、"5m"、"1h"',
                    default: '5m'
                },
                compare_fields: { 
                    type: 'array',
                    items: { type: 'string' },
                    description: '要对比的字段列表，如["status", "level"]',
                    default: []
                },
                topk: {
                    type: 'integer',
                    description: '返回差异最大的前K个字段值，默认10',
                    default: 10
                },
                metric_field: { 
                    type: 'string', 
                    description: '数值型字段名，若无则按count统计' 
                }
            }
        }
    },
    {
        name: 'correlation_analysis',
        description: '关联分析：当你想回答“哪个数值指标会领先或滞后另一个指标”“哪些字段值经常一起出现”时使用。数值时间序列相关请用 `lagged_pearson`，离散字段共现请用 `fp_growth`，不确定时可用 `auto` 自动判断，但所有输入字段必须同属数值或同属离散字段。它适合做 correlate events / metrics，不直接给出根因结论，也不替代日志检索或异常检测；要查异常窗口相对基线窗口哪里变了用 `root_cause_suggestions`，要找异常时间点用 `anomaly_points`。',
        inputSchema: {
            type: 'object',
            properties: {
                query: { 
                    type: 'string', 
                    description: '搜索查询语句，默认"*"', 
                    default: '*' 
                },
                time_range: { 
                    type: 'string', 
                    description: '时间范围，例如："now-1h,now"',
                    default: 'now-15m,now'
                },
                index_name: { 
                    type: 'string', 
                    description: '索引名称', 
                    default: 'yotta' 
                },
                fields: { 
                    type: 'array',
                    items: { type: 'string' },
                    description: '要分析的字段列表。数值模式建议传 2~5 个数值字段；离散模式建议传 2~6 个离散字段。',
                    default: []
                },
                mode: {
                    type: 'string',
                    description: '分析模式。lagged_pearson 用于数值时间序列滞后相关；fp_growth 用于离散字段频繁项集和规则；auto 会先判断字段类型再自动路由。',
                    default: 'auto',
                    enum: ['lagged_pearson', 'fp_growth', 'auto']
                },
                bucket: {
                    type: 'string',
                    description: '数值模式下的时间桶大小，如 "1m"、"5m"、"1h"；不传则按 time_range 自动选择。'
                },
                max_lag: {
                    type: 'integer',
                    description: '数值模式下最大滞后桶数，系统会计算 [-max_lag, +max_lag] 范围内的 Pearson 相关，默认 3。',
                    default: 3
                },
                min_support: {
                    type: 'number',
                    description: '离散模式下最小支持度，范围 0~1，默认 0.05。',
                    default: 0.05
                },
                min_confidence: {
                    type: 'number',
                    description: '离散模式下生成关联规则的最小置信度，范围 0~1，默认 0.6。',
                    default: 0.6
                },
                sample_size: {
                    type: 'integer',
                    description: '离散模式和 auto 判断时抽样的日志条数，默认 500。',
                    default: 500
                },
                limit: {
                    type: 'integer',
                    description: '返回结果数量限制，默认 20。',
                    default: 20
                },
                resource_uri: {
                    type: 'string',
                    description: '可选，共享资源 URI。若资源中已包含 rows/sample_rows，会优先复用，减少重复查询。'
                }
            }
        }
    },
    {
        name: 'root_cause_suggestions',
        description: '根因分析建议：当你想回答“异常窗口相比基线窗口到底什么变了”“哪一撮日志最可疑”“应该优先排查哪些字段组合”时使用。工具会同时输出 `distribution_drift`（字段分布漂移）和 `suspicious_slices`（高支持度、高提升度的可疑切片），适合做 root cause analysis 和根因候选排序。它不负责原始日志检索、单纯趋势概览或纯相关性计算；要搜日志明细用 `log_search_sheet`，要看走势用 `trend_summary`，要做相关/共现分析用 `correlation_analysis`。',
        inputSchema: {
            type: 'object',
            properties: {
                query: { 
                    type: 'string', 
                    description: '搜索查询语句，默认"*"', 
                    default: '*' 
                },
                anomaly_window: { 
                    type: 'string', 
                    description: '异常窗口时间范围，例如："now-30m,now"',
                    default: 'now-30m,now'
                },
                baseline_window: { 
                    type: 'string', 
                    description: '基线窗口时间范围，例如："now-90m,now-60m"',
                    default: 'now-90m,now-60m'
                },
                index_name: { 
                    type: 'string', 
                    description: '索引名称', 
                    default: 'yotta' 
                },
                candidate_fields: { 
                    type: 'array',
                    items: { type: 'string' },
                    description: '候选字段列表，如["status", "level", "host"]。不传时会自动从两个窗口的公共字段中挑选一批字段分析。',
                    default: []
                },
                significance_threshold: {
                    type: 'number',
                    description: '字段分布漂移显著性阈值（drift score），默认0.1',
                    default: 0.1
                },
                topk: {
                    type: 'integer',
                    description: '返回最重要的 K 个漂移字段和可疑切片，默认5',
                    default: 5
                },
                field_value_limit: {
                    type: 'integer',
                    description: '每个字段显式查询的值分布上限，默认20',
                    default: 20
                },
                sample_size: {
                    type: 'integer',
                    description: '异常切片挖掘使用的采样条数，默认300',
                    default: 300
                },
                slice_max_depth: {
                    type: 'integer',
                    description: '可疑切片组合的最大深度，默认2；值越大组合爆炸风险越高',
                    default: 2
                },
                min_slice_support: {
                    type: 'number',
                    description: '可疑切片在异常窗口中的最小支持度，默认0.05',
                    default: 0.05
                },
                min_slice_lift: {
                    type: 'number',
                    description: '可疑切片相对基线窗口的最小提升度，默认2',
                    default: 2
                },
                resource_uri: {
                    type: 'string',
                    description: '可选，共享资源 URI。若资源中已包含异常窗口样本，会优先复用该样本，并仅补齐基线侧查询。'
                }
            },
            required: ['anomaly_window', 'baseline_window']
        }
    }
];

// 预测分析工具
export const predictiveAnalysisTools: ToolDefinition[] = [
    {
        name: 'trend_forecast',
        description: '趋势预测（短期）：当你想回答“按当前走势接下来几个时间桶会怎么走”“未来是否还会继续升高/降低”时使用。它基于历史时间序列做短期预测，并返回预测值与置信区间，适合 forecast 场景。它不负责识别已发生的异常点，也不解释异常原因；要看历史走势概览用 `trend_summary`，要识别异常点用 `anomaly_points`，要做异常归因用 `root_cause_suggestions`。',
        inputSchema: {
            type: 'object',
            properties: {
                query: { 
                    type: 'string', 
                    description: '搜索查询语句，默认"*"', 
                    default: '*' 
                },
                time_range: { 
                    type: 'string', 
                    description: '历史数据时间范围，例如："now-24h,now"',
                    default: 'now-24h,now'
                },
                index_name: { 
                    type: 'string', 
                    description: '索引名称', 
                    default: 'yotta' 
                },
                bucket: { 
                    type: 'string', 
                    description: '时间桶大小，如"1m"、"5m"、"1h"',
                    default: '5m'
                },
                horizon: {
                    type: 'integer',
                    description: '预测步数（未来多少个桶），默认12',
                    default: 12
                },
                method: {
                    type: 'string',
                    description: '预测方法，默认"linear_regression"，可选：["linear_regression", "moving_average", "exponential_smoothing"]',
                    default: 'linear_regression',
                    enum: ['linear_regression', 'moving_average', 'exponential_smoothing']
                },
                confidence: {
                    type: 'number',
                    description: '置信水平，默认0.95',
                    default: 0.95
                },
                metric_field: { 
                    type: 'string', 
                    description: '数值型字段名，若无则按count统计' 
                },
                window: {
                    type: 'integer',
                    description: '移动平均窗口大小（仅moving_average方法有效），默认10',
                    default: 10
                },
                alpha: {
                    type: 'number',
                    description: '指数平滑参数（仅exponential_smoothing方法有效），默认0.3',
                    default: 0.3
                },
                resource_uri: {
                    type: 'string',
                    description: '可选，共享资源 URI。若资源中已包含 series/points，会优先复用已有时间序列，减少重复查询。'
                }
            }
        }
    },
    {
        name: 'anomaly_alert',
        description: '异常预警：结合预测和阈值进行异常检测，支持预测上下界触发告警',
        inputSchema: {
            type: 'object',
            properties: {
                query: { 
                    type: 'string', 
                    description: '搜索查询语句，默认"*"', 
                    default: '*' 
                },
                time_range: { 
                    type: 'string', 
                    description: '历史数据时间范围，例如："now-24h,now"',
                    default: 'now-24h,now'
                },
                index_name: { 
                    type: 'string', 
                    description: '索引名称', 
                    default: 'yotta' 
                },
                bucket: { 
                    type: 'string', 
                    description: '时间桶大小，如"1m"、"5m"、"1h"',
                    default: '5m'
                },
                method: {
                    type: 'string',
                    description: '异常检测方法，默认"prediction_band"，可选：["prediction_band", "statistical", "adaptive"]',
                    default: 'prediction_band',
                    enum: ['prediction_band', 'statistical', 'adaptive']
                },
                threshold: {
                    type: 'number',
                    description: '异常阈值（标准差倍数或预测偏差倍数），默认3.0',
                    default: 3.0
                },
                alert_on: {
                    type: 'string',
                    description: '告警触发条件，默认"both"，可选：["upper", "lower", "both"]',
                    default: 'both',
                    enum: ['upper', 'lower', 'both']
                },
                min_anomaly_points: {
                    type: 'integer',
                    description: '最少异常点数才触发告警，默认3',
                    default: 3
                },
                forecast_horizon: {
                    type: 'integer',
                    description: '预测范围（用于prediction_band方法），默认6',
                    default: 6
                },
                metric_field: { 
                    type: 'string', 
                    description: '数值型字段名，若无则按count统计' 
                },
                resource_uri: {
                    type: 'string',
                    description: '可选，共享资源 URI。若资源中已包含 series/points，会优先复用已有时间序列，减少重复查询。'
                }
            }
        }
    }
];

// 仪表盘工具
export const dashboardTools: ToolDefinition[] = [
    {
        name: 'list_dashboards',
        description: '获取仪表盘列表，便于先发现可用 dashboard，再继续查看 tabs、panels 或内容。',
        inputSchema: {
            type: 'object',
            properties: {
                page: {
                    type: 'integer',
                    description: '页码，从 1 开始'
                },
                size: {
                    type: 'integer',
                    description: '每页数量'
                },
                name: {
                    type: 'string',
                    description: '按仪表盘名称过滤'
                },
                uuid: {
                    type: 'string',
                    description: '按仪表盘 UUID 过滤'
                },
                app_id: {
                    type: 'integer',
                    description: '按应用 ID 过滤'
                },
                export: {
                    type: 'string',
                    enum: ['local', 'system'],
                    description: '导出类型过滤'
                }
            }
        }
    },
    {
        name: 'list_dashboard_tabs',
        description: '列出指定 dashboard 下的 tabs 摘要，便于后续定位 tab 和查看 panel 数量。',
        inputSchema: {
            type: 'object',
            properties: {
                dashboard_id: {
                    type: 'string',
                    description: '仪表盘 ID'
                }
            },
            required: ['dashboard_id']
        }
    },
    {
        name: 'get_dashboard_tab_content',
        description: '读取指定 dashboard/tab 的解析后 content JSON，便于校验 widgets、filters、theme 以及扩展字段是否被保留。',
        inputSchema: {
            type: 'object',
            properties: {
                dashboard_id: {
                    type: 'string',
                    description: '仪表盘 ID'
                },
                tab_name: {
                    type: 'string',
                    description: '标签页名称'
                }
            },
            required: ['dashboard_id', 'tab_name']
        }
    },
    {
        name: 'clone_dashboard_tab',
        description: '在同一个 dashboard 内原样复制指定 tab 为新 tab。适合“先复制，再在副本上做布局和配色优化”的场景；会尽量保留原 tab 的 widgets、filters、theme 和扩展字段，不做语义化重建。推荐顺序是“先 clone -> 再串行执行 remove/update/layout -> 每步后回读 content 校验”，不要把 clone 后的副本再按 panel 语义重建。',
        inputSchema: {
            type: 'object',
            properties: {
                dashboard_id: {
                    type: 'string',
                    description: '仪表盘 ID'
                },
                source_tab_name: {
                    type: 'string',
                    description: '要复制的源标签页名称'
                },
                new_tab_name: {
                    type: 'string',
                    description: '新标签页名称'
                }
            },
            required: ['dashboard_id', 'source_tab_name', 'new_tab_name']
        }
    },
    {
        name: 'evaluate_dashboard_aesthetics',
        description: '评估指定 dashboard/tab 的布局美学质量，返回 7 个指标评分、综合分、问题解释和布局建议。',
        inputSchema: {
            type: 'object',
            properties: {
                dashboard_id: {
                    type: 'string',
                    description: '仪表盘 ID'
                },
                tab_name: {
                    type: 'string',
                    description: '标签页名称'
                }
            },
            required: ['dashboard_id', 'tab_name']
        }
    },
    {
        name: 'list_dashboard_panels',
        description: '列出指定 dashboard/tab 下的 panel 摘要，返回 panel_id，便于后续按 panel_id 或 panel_title 做增删改。',
        inputSchema: {
            type: 'object',
            properties: {
                dashboard_id: {
                    type: 'string',
                    description: '仪表盘 ID'
                },
                tab_name: {
                    type: 'string',
                    description: '标签页名称'
                }
            },
            required: ['dashboard_id', 'tab_name']
        }
    },
    {
        name: 'create_dashboard_from_template',
        description: '按模板和少量上下文创建仪表盘，适合“错误排查 / 服务概览 / 流量趋势 / 主机健康”等常见场景。',
        inputSchema: {
            type: 'object',
            properties: {
                template: {
                    type: 'string',
                    description: '模板名称',
                    enum: ['service_overview', 'error_investigation', 'traffic_trend', 'host_health']
                },
                name: {
                    type: 'string',
                    description: '仪表盘名称'
                },
                app_id: {
                    type: 'integer',
                    description: '所属应用ID。可选；默认使用 1。'
                },
                context: {
                    type: 'object',
                    description: '模板上下文，例如 appname、query、time_range、host_field 等',
                    additionalProperties: true
                },
                data_user: {
                    type: 'string',
                    description: '数据用户权限，"viewer"或"creator"，默认 "viewer"',
                    default: 'viewer',
                    enum: ['viewer', 'creator']
                },
                export: {
                    type: 'string',
                    description: '可见范围，"local"或"system"，默认 "local"',
                    default: 'local',
                    enum: ['local', 'system']
                }
            },
            required: ['template', 'name']
        }
    },
    {
        name: 'create_dashboard_from_spec',
        description: '根据完整的 dashboard 说明创建仪表盘。适合已经明确 tabs 和 panels 结构的场景。注意：同一个 tab 内所有 chart 必须使用同一套 scheme 主题色，不同 tab 之间可以不同；服务端会按图表类别补齐默认 searchData，并按文档顺序逐步扩展更多 chartType。提交 panel 前，请先调用 `log-tools` 的 `query_precheck`，推荐使用 `mode=full`，并通过 `field_mapping` 或 `expected_fields` 校验 query 有数据且字段名与 `xField`、`yField`、`byFields`、`fromField`、`toField`、`weightField` 等配置一致；若页面无图，先排查 `query_precheck` 返回的语法/无数/字段映射问题，再排查 chartType 模板。对 `single` 图，若采用背景填充样式，务必在创建后回读 content，确认 `singleChartFontColor` 与 `singleChartBackgroundColor` 不同，且 `searchData/config/originWidgetConfData` 三层没有颜色冲突。当前已通过真实创建/回读验证，并结合页面观察确认可用的类型包括 `line`、`area`、`scatter`、`single`、`pie`、`rose`、`bar`、`sunburst`、`heatmap`、`wordcloud`、`liquidfill`、`multiaxis`、`column`、`rangeline`、`chord`、`sankey`、`force`、`attackmap`；`table`、`networkflow`、`tracing` 已纳入枚举，但仍建议继续按“先创建、再回读、再页面确认”的方式验证。',
        inputSchema: {
            type: 'object',
            properties: {
                name: {
                    type: 'string',
                    description: '仪表盘名称'
                },
                app_id: {
                    type: 'integer',
                    description: '所属应用ID。可选；默认使用 1。'
                },
                data_user: {
                    type: 'string',
                    description: '数据用户权限，"viewer"或"creator"，默认 "viewer"',
                    default: 'viewer',
                    enum: ['viewer', 'creator']
                },
                export: {
                    type: 'string',
                    description: '可见范围，"local"或"system"，默认 "local"',
                    default: 'local',
                    enum: ['local', 'system']
                },
                scheme: {
                    type: 'string',
                    description: '默认主题色方案。作为 tabs[*].scheme 未显式提供时的默认值；默认 schemecat1。',
                    default: 'schemecat1',
                    enum: ['schemecat1', 'schemecat2', 'schemecat3', 'schemecat4']
                },
                tabs: {
                    type: 'array',
                    description: '标签页列表',
                    items: {
                        type: 'object',
                        properties: {
                            name: {
                                type: 'string',
                                description: '标签页名称'
                            },
                            scheme: {
                                type: 'string',
                                description: '当前 tab 的主题色方案。该 tab 内所有 panel 的 color 都必须来自这套色卡；不传时继承顶层 scheme 或默认 schemecat1。',
                                enum: ['schemecat1', 'schemecat2', 'schemecat3', 'schemecat4']
                            },
                            panels: {
                                type: 'array',
                                description: '图表列表',
                                items: {
                                    type: 'object',
                                    properties: {
                                        title: { type: 'string', description: '图表标题' },
                                        type: { type: 'string', description: 'panel 类型。当前写入优先支持 "trend" 和 "eventsTable"；若误传旧写法，服务端会自动归一到 trend + chartType。', enum: ['trend', 'eventsTable', 'pie', 'rose', 'single', 'liquidfill', 'table', 'line', 'bar', 'column', 'sunburst', 'heatmap', 'wordcloud', 'attackmap'] },
                                        query: { type: 'string', description: 'SPL 查询语句，例如: * | stats count() by hostname' },
                                        time_range: { type: 'string', description: '时间范围，例如: -1h,now' },
                                        chartType: { type: 'string', description: '图表展示类型。trend 常见值包括 "line"、"area"、"scatter"、"column"、"rangeline"、"multiaxis"、"pie"、"rose"、"bar"、"sunburst"、"single"、"liquidfill"、"heatmap"、"wordcloud"、"chord"、"sankey"、"force"、"attackmap"；eventsTable 固定为 "eventsTable"。', enum: ['line', 'area', 'scatter', 'column', 'rangeline', 'multiaxis', 'pie', 'rose', 'bar', 'sunburst', 'single', 'liquidfill', 'heatmap', 'wordcloud', 'chord', 'sankey', 'force', 'attackmap', 'table', 'networkflow', 'tracing', 'eventsTable'] },
                                        xField: { type: 'string', description: '字段映射。对序列类通常表示 X 轴；对 `single` 表示展示字段；对 `pie` 若未提供 `byFields`，也兼容旧写法把它当作切分字段候选。' },
                                        yField: { type: 'string', description: '字段映射。对序列类通常表示 Y 轴；对 `single/pie` 可作为展示值字段。未传时会优先从聚合别名（如 `stats count() as cnt` 中的 `cnt`）推断。' },
                                        yFields: { type: 'array', items: { type: 'string' }, description: '多指标字段列表。主要用于 `multiaxis`，也兼容 `column`。若传入，则会优先于单个 `yField` 写入 searchData.yFields。' },
                                        ySmooths: { type: 'array', items: { type: 'boolean' }, description: '与 `yFields` 一一对应的平滑开关列表。主要用于 `multiaxis`，未传时默认按 false 补齐。' },
                                        yRanges: { type: 'array', items: { type: 'object', additionalProperties: true }, description: '与 `yFields` 一一对应的 Y 轴范围列表，例如 [{"min":0,"max":100}]。主要用于 `multiaxis`。' },
                                        byFields: { type: 'array', items: { type: 'string' }, description: '分组/切分字段列表。对 `pie`、`column`、`multiaxis` 会写入类别模板；对 `pie` 未传时会尝试从查询中的 `by` 子句推断。' },
                                        fromField: { type: 'string', description: '关系类图表来源字段，例如 `chord/sankey/force/attackmap`。' },
                                        toField: { type: 'string', description: '关系类图表目标字段，例如 `chord/sankey/force/attackmap`。' },
                                        weightField: { type: 'string', description: '关系类图表权重字段。' },
                                        outlierField: { type: 'string', description: '区间图 `rangeline` 的预测值字段。' },
                                        upperField: { type: 'string', description: '区间图 `rangeline` 的上限字段。' },
                                        lowerField: { type: 'string', description: '区间图 `rangeline` 的下限字段。' },
                                        fromLongitudeField: { type: 'string', description: '攻击地图来源经度字段。' },
                                        fromLatitudeField: { type: 'string', description: '攻击地图来源纬度字段。' },
                                        toLongitudeField: { type: 'string', description: '攻击地图目标经度字段。' },
                                        toLatitudeField: { type: 'string', description: '攻击地图目标纬度字段。' },
                                        mapType: { type: 'string', description: '攻击地图区域，可选 world/china。', enum: ['world', 'china'] },
                                        color: { type: 'string', description: '图表主色，映射到 searchData.chartStartingColor。必须从当前 tab 的 scheme 色卡中选择，例如 #F6903D。' },
                                        grid: {
                                            type: 'object',
                                            description: '图表布局位置和大小。网格系统总宽12。例如 {"x":0, "y":0, "w":6, "h":5}。若不传，服务端会根据 panel 数量和图表类型自动分配默认布局。',
                                            properties: {
                                                x: { type: 'integer' },
                                                y: { type: 'integer' },
                                                w: { type: 'integer' },
                                                h: { type: 'integer' }
                                            }
                                        }
                                    },
                                    required: ['title', 'query']
                                }
                            }
                        },
                        required: ['name', 'panels']
                    }
                }
            },
            required: ['name', 'tabs']
        }
    },
    {
        name: 'update_dashboard_layout',
        description: '调整指定 dashboard 某个 tab 下 panel 的布局，不修改 query 内容。该工具应与 remove/update panel 串行使用，不建议并发混用；手动传入 `panel_positions` 时请确保任意两个 panel 不重叠，保存后建议立刻回读 content 或重新评估美观度确认布局结果。',
        inputSchema: {
            type: 'object',
            properties: {
                dashboard_id: {
                    type: 'string',
                    description: '仪表盘 ID'
                },
                tab_name: {
                    type: 'string',
                    description: '标签页名称'
                },
                layout_strategy: {
                    type: 'string',
                    description: '布局策略，默认 auto_two_columns',
                    default: 'auto_two_columns',
                    enum: ['auto_two_columns', 'single_column', 'compact']
                },
                panel_positions: {
                    type: 'array',
                    description: '手动布局配置；如果提供则优先于 layout_strategy',
                    items: {
                        type: 'object',
                        properties: {
                            panel_title: { type: 'string', description: 'panel 标题' },
                            x: { type: 'integer', description: '横坐标' },
                            y: { type: 'integer', description: '纵坐标' },
                            w: { type: 'integer', description: '宽度' },
                            h: { type: 'integer', description: '高度' }
                        },
                        required: ['panel_title']
                    }
                }
            },
            required: ['dashboard_id', 'tab_name']
        }
    },
    {
        name: 'add_dashboard_panel',
        description: '向指定 dashboard/tab 新增一个 panel。请注意：panel 类型(type) 与图表展示类型(chartType) 是两回事。当前写入优先支持 type=trend 或 type=eventsTable；具体展示样式应放在 chartType 中。若传 color，必须属于该 tab 当前 scheme；服务端会按图表类别补齐默认 searchData，并继续按文档顺序扩展更多 chartType。提交前请先调用 `log-tools` 的 `query_precheck`，推荐 `mode=full`，并通过 `field_mapping` 或 `expected_fields` 验证 query 有数据且字段名与图表配置一致；尤其是 `networkflow`、`tracing`、关系图和攻击地图这类依赖显式字段名的图表，不要跳过这一步。若页面无图，先排查 `query_precheck` 返回的语法/无数/字段映射问题，再排查 chartType 模板。若新增的是 `single` 图且使用背景填充样式，请在写入后回读 content，检查 `singleChartFontColor` 与 `singleChartBackgroundColor` 不同，且 `searchData/config/originWidgetConfData` 多层颜色字段没有互相打架。当前已完成真实闭环验证的类型包括 `line`、`area`、`scatter`、`single`、`pie`、`rose`、`bar`、`sunburst`、`heatmap`、`wordcloud`、`liquidfill`、`multiaxis`、`column`、`rangeline`、`chord`、`sankey`、`force`、`attackmap`。',
        inputSchema: {
            type: 'object',
            properties: {
                dashboard_id: {
                    type: 'string',
                    description: '仪表盘 ID'
                },
                tab_name: {
                    type: 'string',
                    description: '标签页名称'
                },
                panel: {
                    type: 'object',
                    description: '要新增的 panel 配置。建议优先使用 type=trend，再通过 chartType 指定具体展示样式。',
                    properties: {
                        title: { type: 'string', description: '图表标题' },
                        type: { type: 'string', description: 'panel 类型。当前写入优先支持 trend / eventsTable。不要把展示样式直接填在这里；若误传旧写法，服务端会自动归一到 trend + chartType。', enum: ['trend', 'eventsTable', 'pie', 'rose', 'single', 'liquidfill', 'table', 'line', 'bar', 'column', 'sunburst', 'heatmap', 'wordcloud', 'attackmap'] },
                        query: { type: 'string', description: 'SPL 查询语句' },
                        time_range: { type: 'string', description: '时间范围，例如 -1h,now' },
                        chartType: { type: 'string', description: '图表展示类型。对于 type=trend，可选 line/area/scatter/column/rangeline/multiaxis/pie/rose/bar/sunburst/single/liquidfill/heatmap/wordcloud/chord/sankey/force/attackmap/table/networkflow/tracing；对于 type=eventsTable，固定为 eventsTable。', enum: ['line', 'area', 'scatter', 'column', 'rangeline', 'multiaxis', 'pie', 'rose', 'bar', 'sunburst', 'single', 'liquidfill', 'heatmap', 'wordcloud', 'chord', 'sankey', 'force', 'attackmap', 'table', 'networkflow', 'tracing', 'eventsTable'] },
                        xField: { type: 'string', description: '字段映射。对序列类通常表示 X 轴；对 `single` 表示展示字段；对 `pie` 若未提供 `byFields`，也兼容旧写法把它当作切分字段候选。' },
                        yField: { type: 'string', description: '字段映射。对序列类通常表示 Y 轴；对 `single/pie` 可作为展示值字段。未传时会优先从聚合别名（如 `cnt`）推断。' },
                        yFields: { type: 'array', items: { type: 'string' }, description: '多指标字段列表。主要用于 `multiaxis`，也兼容 `column`。若传入，则会优先于单个 `yField` 写入 searchData.yFields。' },
                        ySmooths: { type: 'array', items: { type: 'boolean' }, description: '与 `yFields` 一一对应的平滑开关列表。主要用于 `multiaxis`，未传时默认按 false 补齐。' },
                        yRanges: { type: 'array', items: { type: 'object', additionalProperties: true }, description: '与 `yFields` 一一对应的 Y 轴范围列表，例如 [{"min":0,"max":100}]。主要用于 `multiaxis`。' },
                        byFields: { type: 'array', items: { type: 'string' }, description: '分组/切分字段列表。对 `pie`、`column`、`multiaxis` 会写入类别模板；对 `pie` 未传时会尝试从查询中的 `by` 子句推断。' },
                        fromField: { type: 'string', description: '关系类图表来源字段，例如 `chord/sankey/force/attackmap`。' },
                        toField: { type: 'string', description: '关系类图表目标字段，例如 `chord/sankey/force/attackmap`。' },
                        weightField: { type: 'string', description: '关系类图表权重字段。' },
                        outlierField: { type: 'string', description: '区间图 `rangeline` 的预测值字段。' },
                        upperField: { type: 'string', description: '区间图 `rangeline` 的上限字段。' },
                        lowerField: { type: 'string', description: '区间图 `rangeline` 的下限字段。' },
                        fromLongitudeField: { type: 'string', description: '攻击地图来源经度字段。' },
                        fromLatitudeField: { type: 'string', description: '攻击地图来源纬度字段。' },
                        toLongitudeField: { type: 'string', description: '攻击地图目标经度字段。' },
                        toLatitudeField: { type: 'string', description: '攻击地图目标纬度字段。' },
                        mapType: { type: 'string', description: '攻击地图区域，可选 world/china。', enum: ['world', 'china'] },
                        color: { type: 'string', description: '图表主色，映射到 searchData.chartStartingColor。必须从当前 tab 的 scheme 色卡中选择，例如 #F6903D。' },
                        description: { type: 'string', description: '图表说明' },
                        grid: {
                            type: 'object',
                            description: '图表布局位置和大小。若不传，服务端会在保留现有 panels 布局的前提下，为新 panel 自动分配一个不重叠的默认位置。',
                            properties: {
                                x: { type: 'integer' },
                                y: { type: 'integer' },
                                w: { type: 'integer' },
                                h: { type: 'integer' }
                            }
                        }
                    },
                    required: ['title', 'query']
                }
            },
            required: ['dashboard_id', 'tab_name', 'panel']
        }
    },
    {
        name: 'update_dashboard_panel',
        description: '更新指定 dashboard/tab 下某个 panel 的内容，例如标题、query、时间范围、chartType、主题色或局部布局。注意：同一个 tab 内所有 chart 必须使用同一套 scheme，不同 tab 之间可以不同；若切换图表类型，服务端会按类别重新补齐对应的默认 searchData，并继续按文档顺序扩展更多 chartType。若修改了 query 或字段映射，请先调用 `log-tools` 的 `query_precheck`，推荐 `mode=full`，并通过 `field_mapping` 或 `expected_fields` 验证 query 仍然有数据且字段名可用，再提交更新。若修改的是 `single` 图颜色，请把它当成高风险更新：写入后必须回读 content，确认 `singleChartFontColor`、`singleChartBackgroundColor`、`singleChartDefaultColor` 与 `chartStartingColor` 的结果符合预期；若是背景填充样式，字色与背景色不能相同。对于尚未做过真实闭环验证的类型，仍建议在更新后执行“创建/更新 -> 回读 content -> 页面确认”的最小验证流程；若页面无图，先排查 `query_precheck` 返回的语法/无数/字段映射问题，再排查 chartType 模板。不要把 `update_dashboard_panel` 与 `update_dashboard_layout`、`remove_dashboard_panel` 并发混用，建议按“增删/更新 panel -> 调布局 -> 回读验证”的顺序串行执行。',
        inputSchema: {
            type: 'object',
            properties: {
                dashboard_id: {
                    type: 'string',
                    description: '仪表盘 ID'
                },
                tab_name: {
                    type: 'string',
                    description: '标签页名称'
                },
                panel_id: {
                    type: 'string',
                    description: '要修改的 panel 唯一 ID。若提供，则优先使用该字段精确定位。'
                },
                panel_title: {
                    type: 'string',
                    description: '要修改的 panel 标题。未提供 panel_id 时使用。'
                },
                changes: {
                    type: 'object',
                    description: '要修改的字段。未传的配置项会尽量保持原值不变。',
                    properties: {
                        title: { type: 'string', description: '新的标题' },
                        query: { type: 'string', description: '新的查询语句' },
                        time_range: { type: 'string', description: '新的时间范围' },
                        chartType: { type: 'string', description: '新的图表展示类型。trend 常见值为 line/area/scatter/column/rangeline/multiaxis/pie/rose/bar/sunburst/single/liquidfill/heatmap/wordcloud/chord/sankey/force/attackmap/table，eventsTable 固定为 eventsTable', enum: ['line', 'area', 'scatter', 'column', 'rangeline', 'multiaxis', 'pie', 'rose', 'bar', 'sunburst', 'single', 'liquidfill', 'heatmap', 'wordcloud', 'chord', 'sankey', 'force', 'attackmap', 'table', 'networkflow', 'tracing', 'eventsTable'] },
                        scheme: { type: 'string', description: '新的当前 tab 主题色方案。传入后只会更新当前 tab 的 scheme，并校验当前 tab 内现有 panel 颜色是否都属于该主题。', enum: ['schemecat1', 'schemecat2', 'schemecat3', 'schemecat4'] },
                        color: { type: 'string', description: '新的图表主色，映射到 searchData.chartStartingColor，例如 #F6903D。必须属于当前 tab 的 scheme；若同时传 scheme，则必须属于目标 scheme。' },
                        xField: { type: 'string', description: '新的 X 轴字段' },
                        yField: { type: 'string', description: '新的 Y 轴字段' },
                        yFields: { type: 'array', items: { type: 'string' }, description: '新的多指标字段列表。主要用于 `multiaxis`，也兼容 `column`。若传入，则会优先于单个 `yField` 写入 searchData.yFields。' },
                        ySmooths: { type: 'array', items: { type: 'boolean' }, description: '新的平滑开关列表，与 `yFields` 一一对应。主要用于 `multiaxis`。' },
                        yRanges: { type: 'array', items: { type: 'object', additionalProperties: true }, description: '新的 Y 轴范围列表，与 `yFields` 一一对应，例如 [{"min":0,"max":100}]。主要用于 `multiaxis`。' },
                        byFields: { type: 'array', items: { type: 'string' }, description: '新的分组字段列表' },
                        fromField: { type: 'string', description: '新的关系来源字段。' },
                        toField: { type: 'string', description: '新的关系目标字段。' },
                        weightField: { type: 'string', description: '新的关系权重字段。' },
                        outlierField: { type: 'string', description: '新的区间图预测值字段。' },
                        upperField: { type: 'string', description: '新的区间图上限字段。' },
                        lowerField: { type: 'string', description: '新的区间图下限字段。' },
                        fromLongitudeField: { type: 'string', description: '新的攻击地图来源经度字段。' },
                        fromLatitudeField: { type: 'string', description: '新的攻击地图来源纬度字段。' },
                        toLongitudeField: { type: 'string', description: '新的攻击地图目标经度字段。' },
                        toLatitudeField: { type: 'string', description: '新的攻击地图目标纬度字段。' },
                        mapType: { type: 'string', description: '新的攻击地图区域。', enum: ['world', 'china'] },
                        description: { type: 'string', description: '新的图表说明' },
                        grid: {
                            type: 'object',
                            description: '新的布局位置和大小',
                            properties: {
                                x: { type: 'integer' },
                                y: { type: 'integer' },
                                w: { type: 'integer' },
                                h: { type: 'integer' }
                            }
                        }
                    }
                }
            },
            required: ['dashboard_id', 'tab_name', 'changes']
        }
    },
    {
        name: 'remove_dashboard_panel',
        description: '删除指定 dashboard/tab 下的单个 panel。',
        inputSchema: {
            type: 'object',
            properties: {
                dashboard_id: {
                    type: 'string',
                    description: '仪表盘 ID'
                },
                tab_name: {
                    type: 'string',
                    description: '标签页名称'
                },
                panel_id: {
                    type: 'string',
                    description: '要删除的 panel 唯一 ID。若提供，则优先使用该字段精确定位。'
                },
                panel_title: {
                    type: 'string',
                    description: '要删除的 panel 标题。未提供 panel_id 时使用。'
                }
            },
            required: ['dashboard_id', 'tab_name']
        }
    }
];

export const parserRuleTools: ToolDefinition[] = [
    {
        name: 'list_parserrules',
        description: '列出解析规则列表，支持按名称、logtype、应用、启用状态等条件过滤。默认只返回 id、name、logtype、desc、enable、from_app、last_modified_time，不带 conf；如需自定义返回列，可显式传 fields。',
        inputSchema: {
            type: 'object',
            properties: {
                fields: { type: 'string', description: '可选，指定返回字段列表；未传时默认返回 id、name、logtype、desc、enable、from_app、last_modified_time，不包含 conf。' },
                permits: { type: 'string', description: '可选，权限字段。' },
                page: { type: 'integer', description: '页码。' },
                size: { type: 'integer', description: '每页大小。' },
                id: { type: 'integer', description: '按规则 ID 过滤。' },
                uuid: { type: 'string', description: '按规则 UUID 过滤。' },
                domain_id: { type: 'integer', description: '按 domain_id 过滤。' },
                creator_id: { type: 'integer', description: '按创建人 ID 过滤。' },
                name: { type: 'string', description: '按规则名称过滤。' },
                from_app: { type: 'integer', description: '按关联应用 ID 过滤。' },
                enable: { type: 'boolean', description: '按启用状态过滤。' },
                desc: { type: 'string', description: '按描述过滤。' },
                logtype: { type: 'string', description: '按 logtype 过滤。' },
                rt_ids: { type: 'string', description: '按资源标签过滤，多个标签 ID 用逗号分隔。' },
                sort: { type: 'string', description: '排序字段，例如 -id。' },
                useAdvancedSearch: { type: 'string', description: '是否启用高级搜索。' },
                appname: { type: 'string', description: '高级搜索时的 appname。' },
                tag: { type: 'string', description: '高级搜索时的 tag。' }
            }
        }
    },
    {
        name: 'get_parserrule_detail',
        description: '读取单个解析规则详情，适合在 update/verify 前先查看当前 conf、logtype、分配和标签信息。',
        inputSchema: {
            type: 'object',
            properties: {
                id: { type: 'integer', description: '解析规则 ID。' },
                fields: { type: 'string', description: '可选，指定返回字段列表。' },
                permit: { type: 'string', description: '可选，权限字段。' }
            },
            required: ['id']
        }
    },
    {
        name: 'generate_parserrule_draft',
        description: '基于样例日志生成 parserrule 初稿。注意：这是“初稿生成”而不是最终规则，后端自动抽出的字段名可能是 `field`、`field_1`、`field_N` 这类无业务语义的占位名；调用后应结合 sample_logs 自行重命名字段，再继续 create/update/verify。',
        inputSchema: {
            type: 'object',
            properties: {
                sample_logs: {
                    oneOf: [
                        { type: 'array', items: { oneOf: [{ type: 'string' }, { type: 'object', additionalProperties: true }] } },
                        { type: 'object', additionalProperties: true },
                        { type: 'string' }
                    ],
                    description: '样例日志。优先传字符串数组；也兼容对象数组、单个对象、单个字符串或合法 JSON 字符串。对象时会优先提取 raw_message、rawMessage、message、log、content。'
                }
            },
            required: ['sample_logs']
        }
    },
    {
        name: 'create_parserrule',
        description: '创建解析规则。推荐先调用 `generate_parserrule_draft` 生成初稿，再把人工确认后的结果放进 rule。rule 支持对象，也兼容合法 JSON 字符串；会在本地校验必填字段，以及 conf/sink_conf 是否为合法 JSON 字符串。',
        inputSchema: {
            type: 'object',
            properties: {
                rule: {
                    oneOf: [
                        {
                            type: 'object',
                            description: '解析规则主体。',
                            properties: {
                                name: { type: 'string', description: '规则名称。' },
                                conf: { oneOf: [{ type: 'string' }, { type: 'object', additionalProperties: true }, { type: 'array', items: { type: 'object' } }], description: '规则 conf。传对象/数组时会自动序列化为 JSON 字符串。' },
                                logtype: { type: 'string', description: '规则 logtype。' },
                                desc: { type: 'string', description: '规则描述。' },
                                category_id: { type: 'integer', description: '分类 ID。' },
                                enable: { type: 'boolean', description: '是否启用。' },
                                from_app: { type: 'integer', description: '关联应用 ID。' },
                                notice_frequency: { type: 'string', description: '未解析日志通知频率。' },
                                sink_conf: { oneOf: [{ type: 'string' }, { type: 'object', additionalProperties: true }, { type: 'array', items: { type: 'object' } }], description: '指标索引配置。传对象/数组时会自动序列化为 JSON 字符串。' },
                                rt_names: { type: 'string', description: '关联资源标签名称，逗号分隔。' },
                                assign_data: {
                                    type: 'array',
                                    description: '数据分配配置。',
                                    items: {
                                        type: 'object',
                                        properties: {
                                            appnames: { type: 'string' },
                                            tags: { type: 'string' }
                                        }
                                    }
                                }
                            }
                        },
                        {
                            type: 'string',
                            description: '解析规则主体的 JSON 对象字符串。'
                        }
                    ]
                }
            },
            required: ['rule']
        }
    },
    {
        name: 'update_parserrule',
        description: '更新解析规则。推荐先调用 `generate_parserrule_draft` 生成或重整初稿，再把人工确认后的字段放进 changes。changes 支持对象，也兼容合法 JSON 字符串；空 changes 和非法 JSON 会在本地直接拦截。',
        inputSchema: {
            type: 'object',
            properties: {
                id: { type: 'integer', description: '解析规则 ID。' },
                changes: {
                    oneOf: [
                        {
                            type: 'object',
                            description: '待更新字段。',
                            properties: {
                                name: { type: 'string', description: '规则名称。' },
                                conf: { oneOf: [{ type: 'string' }, { type: 'object', additionalProperties: true }, { type: 'array', items: { type: 'object' } }], description: '规则 conf。传对象/数组时会自动序列化为 JSON 字符串。' },
                                logtype: { type: 'string', description: '规则 logtype。' },
                                desc: { type: 'string', description: '规则描述。' },
                                category_id: { type: 'integer', description: '分类 ID。' },
                                enable: { type: 'boolean', description: '是否启用。' },
                                from_app: { type: 'integer', description: '关联应用 ID。' },
                                notice_frequency: { type: 'string', description: '未解析日志通知频率。' },
                                sink_conf: { oneOf: [{ type: 'string' }, { type: 'object', additionalProperties: true }, { type: 'array', items: { type: 'object' } }], description: '指标索引配置。传对象/数组时会自动序列化为 JSON 字符串。' },
                                rt_names: { type: 'string', description: '关联资源标签名称，逗号分隔。' },
                                assign_data: {
                                    type: 'array',
                                    description: '数据分配配置。',
                                    items: {
                                        type: 'object',
                                        properties: {
                                            appnames: { type: 'string' },
                                            tags: { type: 'string' }
                                        }
                                    }
                                }
                            }
                        },
                        {
                            type: 'string',
                            description: '待更新字段的 JSON 对象字符串。'
                        }
                    ]
                }
            },
            required: ['id', 'changes']
        }
    },
    {
        name: 'delete_parserrule',
        description: '删除单个解析规则。',
        inputSchema: {
            type: 'object',
            properties: {
                id: { type: 'integer', description: '解析规则 ID。' }
            },
            required: ['id']
        }
    },
    {
        name: 'verify_parserrule',
        description: '验证解析规则对样例日志的解析结果。推荐流程是先 `generate_parserrule_draft`，再 `create_parserrule` / `update_parserrule`，最后用本工具验证。底层调用 `parserrules/verify/logtype`，只用于字段提取 / schema on write。支持两种传参方式：1）传 payload 作为 verify 原始请求体；2）直接把 rawMessage、rule、sample_logs、conf、logtype、enable 平铺到顶层。rule/conf 支持原生数组对象或 JSON 字符串；logtype 优先传字符串，也兼容旧的对象/数组输入，工具会尽量提取其中的 name/type/logtype 字段。sample_logs 会尽量保持你传入的原始形态，既支持字符串数组，也支持对象数组。工具会先在本地校验空规则、空样例、非法 JSON，再把返回结果整理成更适合 LLM 阅读的摘要。',
        inputSchema: {
            type: 'object',
            properties: {
                domain: { type: 'string', description: '可选，domain。' },
                query_logtype: { type: 'string', description: '可选，verify 接口 query 参数 logtype。' },
                logtype: {
                    oneOf: [
                        { type: 'string', description: '推荐直接传单个 logtype 字符串，例如 nginx_access、text。' },
                        { type: 'array', items: { oneOf: [{ type: 'string' }, { type: 'object', additionalProperties: true }] }, description: '兼容旧输入：会从数组中提取首个可识别的 name/type/logtype。' },
                        { type: 'object', additionalProperties: true, description: '兼容旧输入：会从对象中提取 name/type/logtype。' }
                    ]
                },
                rawMessage: { type: 'string', description: '顶层直传模式下的待解析原始日志。若缺失，会尝试从 sample_logs 第一条样例中兜底提取。' },
                enable: { oneOf: [{ type: 'boolean' }, { type: 'string' }], description: '顶层直传模式下是否启用。字符串仅支持 "true"/"false"。' },
                rule: {
                    oneOf: [
                        { type: 'array', items: { type: 'object' } },
                        { type: 'object', additionalProperties: true },
                        { type: 'string' }
                    ],
                    description: '顶层直传模式下的匹配规则；支持数组、对象或 JSON 字符串。'
                },
                sample_logs: {
                    oneOf: [
                        { type: 'array', items: { oneOf: [{ type: 'object' }, { type: 'string' }] } },
                        { type: 'object', additionalProperties: true },
                        { type: 'string' }
                    ],
                    description: '顶层直传模式下的样例日志；支持对象数组、字符串数组、单个对象或字符串。'
                },
                conf: {
                    oneOf: [
                        { type: 'array', items: { type: 'object' } },
                        { type: 'object', additionalProperties: true },
                        { type: 'string' }
                    ],
                    description: '顶层直传模式下的 conf；支持数组、对象或 JSON 字符串。'
                },
                appname: { type: 'string' },
                grok: {
                    oneOf: [
                        { type: 'object', additionalProperties: true },
                        { type: 'string' }
                    ]
                },
                hostname: { type: 'string' },
                source: { type: 'string' },
                ip: { type: 'string' },
                payload: {
                    oneOf: [
                        {
                            type: 'object',
                            description: 'verify 原始请求体。',
                            properties: {
                                appname: { type: 'string' },
                                conf: {
                                    oneOf: [
                                        { type: 'array', items: { type: 'object' } },
                                        { type: 'object', additionalProperties: true },
                                        { type: 'string' }
                                    ],
                                    description: '解析规则 conf。支持数组、对象或 JSON 字符串。'
                                },
                                logtype: {
                                    oneOf: [
                                        { type: 'array', items: { type: 'object' } },
                                        { type: 'object', additionalProperties: true },
                                        { type: 'string' }
                                    ],
                                    description: '当前规则 logtype。推荐直接传字符串；也兼容对象、数组或 JSON 字符串，并会尽量提取 name/type/logtype。'
                                },
                                rawMessage: { type: 'string', description: '待解析原始日志。' },
                                enable: { oneOf: [{ type: 'boolean' }, { type: 'string' }], description: '是否启用。' },
                                rule: {
                                    oneOf: [
                                        { type: 'array', items: { type: 'object' } },
                                        { type: 'object', additionalProperties: true },
                                        { type: 'string' }
                                    ],
                                    description: '匹配规则。支持数组、对象或 JSON 字符串。'
                                },
                                sample_logs: {
                                    oneOf: [
                                        { type: 'array', items: { oneOf: [{ type: 'object' }, { type: 'string' }] } },
                                        { type: 'object', additionalProperties: true },
                                        { type: 'string' }
                                    ],
                                    description: '样例日志。支持对象数组、字符串数组、单个对象或字符串。'
                                },
                                grok: {
                                    oneOf: [
                                        { type: 'object', additionalProperties: true },
                                        { type: 'string' }
                                    ]
                                },
                                hostname: { type: 'string' },
                                source: { type: 'string' },
                                ip: { type: 'string' }
                            }
                        },
                        {
                            type: 'string',
                            description: 'verify 原始请求体的 JSON 字符串。'
                        }
                    ]
                }
            }
        }
    },
    {
        name: 'list_parserrule_references',
        description: '本地规则类型参考工具。数据来源于仓库内 docs/parserule.adoc，不依赖外部网络；不传 rule_type 时返回当前支持的主要算子类型列表，传入 rule_type 时返回对应类型的用途、关键字段、最小示例和注意事项。',
        inputSchema: {
            type: 'object',
            properties: {
                rule_type: {
                    type: 'string',
                    description: '可选，规则类型。支持传入类型 key 或常见别名，例如 regex、json、kv、dissect、metadata、正则解析、JSON解析。'
                },
                type: {
                    type: 'string',
                    description: '可选，rule_type 的兼容别名；新调用优先使用 rule_type。'
                }
            }
        }
    }
];

export const fieldConfigTools: ToolDefinition[] = [
    {
        name: 'list_fieldconfigs',
        description: '列出动态字段配置列表，也就是 schema on read 能力的当前配置概览。会按应用整理 props/transform，并补充作用域、模板数量、transform 名称等摘要信息。',
        inputSchema: {
            type: 'object',
            properties: {}
        }
    },
    {
        name: 'verify_fieldconfig',
        description: '校验动态字段规则。底层调用 `fieldconfigs/verify`；需要传 rule 和 contents。contents 支持对象数组、字符串数组、单个对象、字符串，也兼容合法 JSON 字符串。返回结果会整理成更适合 LLM 阅读的字段提取摘要。',
        inputSchema: {
            type: 'object',
            properties: {
                rule: {
                    type: 'string',
                    description: '动态字段校验规则字符串，例如正则表达式。'
                },
                contents: {
                    oneOf: [
                        { type: 'array', items: { oneOf: [{ type: 'object' }, { type: 'string' }] } },
                        { type: 'object', additionalProperties: true },
                        { type: 'string' }
                    ],
                    description: '待校验内容；支持对象数组、字符串数组、单个对象、字符串，或可解析为这些结构的 JSON 字符串。'
                }
            },
            required: ['rule', 'contents']
        }
    },
    {
        name: 'get_fieldconfig_props_reference',
        description: '读取动态字段 props 参考配置，并整理成适合 LLM 阅读的“scope / config_type / template / key_fields / example”结构，供后续动态字段配置时参考 alias、lookup、dictionary 等模板。',
        inputSchema: {
            type: 'object',
            properties: {}
        }
    },
    {
        name: 'get_fieldconfig_transform_reference',
        description: '读取动态字段 transform 参考配置，并整理成适合 LLM 阅读的“transform_name / key_fields / example”结构，供后续动态字段配置时参考 lowercase、substring 等转换模板。',
        inputSchema: {
            type: 'object',
            properties: {}
        }
    }
];

export const ingestTools: ToolDefinition[] = [
    {
        name: 'list_agents',
        description: '列出 Agent 列表。只读工具；`group_ids` 可选，默认值为 `all`，表示当前账号可读的全部分组。可按 IP、平台、状态、主机名等条件过滤。',
        inputSchema: {
            type: 'object',
            properties: {
                fields: { type: 'string', description: '可选，返回字段列表，逗号分隔。' },
                permits: { type: 'string', description: '可选，是否返回权限相关信息。' },
                page: { type: 'integer', description: '页码。' },
                size: { type: 'integer', description: '每页条数。' },
                group_ids: { type: 'string', description: '可选，逗号分隔的分组 id 集合，或特殊值 `all`；默认 `all`。', default: 'all' },
                id: { type: 'integer', description: '按 Agent ID 过滤。' },
                ip: { type: 'string', description: '按 Agent IP 过滤。' },
                port: { type: 'integer', description: '按端口过滤。' },
                status: { type: 'string', description: '按状态过滤。' },
                os: { type: 'string', description: '按操作系统过滤。' },
                platform: { type: 'string', description: '按平台过滤。' },
                cur_version: { type: 'string', description: '按当前版本过滤。' },
                expected_version: { type: 'string', description: '按预期版本过滤。' },
                is_server_heka: {
                    oneOf: [{ type: 'boolean' }, { type: 'string' }],
                    description: '是否为 Server 类型；支持布尔值或字符串。'
                },
                proxy_ip: { type: 'string', description: '按代理地址过滤。' },
                proxy_port: { type: 'integer', description: '按代理端口过滤。' },
                domain_id: { type: 'integer', description: '按 domain_id 过滤。' },
                hostname: { type: 'string', description: '按主机名过滤。' },
                comment: { type: 'string', description: '按备注过滤。' },
                cmd: { type: 'string', description: '按命令状态过滤。' },
                cmd_timestamp: { type: 'string', description: '按命令时间过滤。' },
                create_timestamp: { type: 'string', description: '按接入时间过滤。' },
                last_update_timestamp: { type: 'string', description: '按最近更新时间过滤。' },
                sort: { type: 'string', description: '排序字段。' }
            }
        }
    },
    {
        name: 'list_agent_groups',
        description: '列出 Agent 分组列表，可按名称、描述、创建者等过滤。`assignable_only=true` 时切换为仅返回当前账号可分配 Agent 的分组。',
        inputSchema: {
            type: 'object',
            properties: {
                assignable_only: { type: 'boolean', description: '可选，是否只返回当前账号有更新权限、可用于分配 Agent 的分组。默认 false。', default: false },
                fields: { type: 'string', description: '可选，返回字段列表，逗号分隔。' },
                permits: { type: 'string', description: '可选，是否返回权限相关信息。' },
                page: { type: 'integer', description: '页码。' },
                size: { type: 'integer', description: '每页条数。' },
                custom_collection: { type: 'string', description: '可选，自定义收藏过滤。' },
                id: { type: 'integer', description: '按分组 ID 过滤。' },
                domain_id: { type: 'integer', description: '按 domain_id 过滤。' },
                name: { type: 'string', description: '按名称过滤。' },
                memo: { type: 'string', description: '按描述过滤。' },
                creator_id: { type: 'integer', description: '按创建者过滤。' },
                from_app: { type: 'integer', description: '按所属应用过滤。' },
                rt_ids: { type: 'string', description: '按资源标签过滤，多个标签用逗号分隔。' },
                sort: { type: 'string', description: '排序字段。' }
            }
        }
    },
    {
        name: 'get_agent_group_detail',
        description: '读取单个 Agent 分组详情。',
        inputSchema: {
            type: 'object',
            properties: {
                id: { type: 'integer', description: '分组 ID。' },
                fields: { type: 'string', description: '可选，返回字段列表。' },
                permit: { type: 'string', description: '可选，是否返回资源权限。' }
            },
            required: ['id']
        }
    },
    {
        name: 'create_agent_group',
        description: '创建 Agent 分组。请把主体放在 `group` 中，至少提供 `name` 和 `roles`。',
        inputSchema: {
            type: 'object',
            properties: {
                group: {
                    oneOf: [
                        {
                            type: 'object',
                            properties: {
                                name: { type: 'string', description: '分组名称。' },
                                memo: { type: 'string', description: '分组描述。' },
                                rt_names: { type: 'string', description: '资源标签名称。' },
                                roles: { type: 'array', items: { type: 'number' }, description: '角色 ID 数组。' }
                            }
                        },
                        {
                            type: 'string',
                            description: '创建分组请求体的 JSON 对象字符串。'
                        }
                    ]
                }
            },
            required: ['group']
        }
    },
    {
        name: 'update_agent_group',
        description: '更新 Agent 分组。请提供分组 `id` 和 `changes`。',
        inputSchema: {
            type: 'object',
            properties: {
                id: { type: 'integer', description: '分组 ID。' },
                changes: {
                    oneOf: [
                        {
                            type: 'object',
                            properties: {
                                name: { type: 'string', description: '新的分组名称。' },
                                memo: { type: 'string', description: '新的分组描述。' },
                                rt_names: { type: 'string', description: '新的资源标签名称。' },
                                roles: { type: 'array', items: { type: 'number' }, description: '新的角色 ID 数组。' }
                            }
                        },
                        {
                            type: 'string',
                            description: '更新分组请求体的 JSON 对象字符串。'
                        }
                    ]
                }
            },
            required: ['id', 'changes']
        }
    },
    {
        name: 'delete_agent_group',
        description: '删除单个 Agent 分组。',
        inputSchema: {
            type: 'object',
            properties: {
                id: { type: 'integer', description: '分组 ID。' }
            },
            required: ['id']
        }
    },
    {
        name: 'add_agents_to_group',
        description: '把指定 Agent 加入某个分组。`target_agents` 支持 Agent ID 数组、对象数组，或逗号分隔字符串。',
        inputSchema: {
            type: 'object',
            properties: {
                id: { type: 'integer', description: '目标分组 ID。' },
                target_agents: {
                    oneOf: [
                        {
                            type: 'array',
                            items: {
                                oneOf: [
                                    { type: 'integer' },
                                    { type: 'string' },
                                    {
                                        type: 'object',
                                        properties: {
                                            id: { type: 'integer', description: 'Agent ID。' },
                                            group_ids: { type: 'string', description: '可选，分组 id 串；默认使用路径上的分组 id。' }
                                        }
                                    }
                                ]
                            }
                        },
                        {
                            type: 'string',
                            description: 'Agent ID 的逗号分隔字符串，或 JSON 数组字符串。'
                        }
                    ],
                    description: '待加入分组的 Agent 集合。'
                }
            },
            required: ['id', 'target_agents']
        }
    },
    {
        name: 'remove_agents_from_group',
        description: '把指定 Agent 从某个分组移除。`target_agents` 支持 Agent ID 数组、对象数组，或逗号分隔字符串。',
        inputSchema: {
            type: 'object',
            properties: {
                id: { type: 'integer', description: '目标分组 ID。' },
                target_agents: {
                    oneOf: [
                        {
                            type: 'array',
                            items: {
                                oneOf: [
                                    { type: 'integer' },
                                    { type: 'string' },
                                    {
                                        type: 'object',
                                        properties: {
                                            id: { type: 'integer', description: 'Agent ID。' }
                                        }
                                    }
                                ]
                            }
                        },
                        {
                            type: 'string',
                            description: 'Agent ID 的逗号分隔字符串，或 JSON 数组字符串。'
                        }
                    ],
                    description: '待移出分组的 Agent 集合。'
                }
            },
            required: ['id', 'target_agents']
        }
    },
    {
        name: 'list_pipeline_schemas',
        description: '列出指定平台下的 pipeline schema，用于辅助组装 pipeline.detail。',
        inputSchema: {
            type: 'object',
            properties: {
                kind: {
                    type: 'string',
                    description: 'schema 类型。',
                    enum: ['InstanceConfiguration', 'PluginType', 'ReferenceResource']
                },
                platform: { type: 'string', description: '目标平台。' }
            },
            required: ['kind', 'platform']
        }
    },
    {
        name: 'list_pipelines',
        description: '列出 pipeline 列表。',
        inputSchema: {
            type: 'object',
            properties: {
                page: { type: 'integer', description: '页码。' },
                size: { type: 'integer', description: '每页条数。' },
                filter: { type: 'string', description: '过滤条件。' },
                sort: { type: 'string', description: '排序字段。' },
                order: { type: 'string', description: '升序/降序。' }
            }
        }
    },
    {
        name: 'get_pipeline_detail',
        description: '读取单个 pipeline 详情。',
        inputSchema: {
            type: 'object',
            properties: {
                id: { type: 'string', description: 'pipeline ID。' }
            },
            required: ['id']
        }
    },
    {
        name: 'create_pipeline',
        description: '创建 pipeline。请把主体放在 `pipeline` 中；其中 `detail` 支持对象、数组或合法 JSON 字符串。',
        inputSchema: {
            type: 'object',
            properties: {
                pipeline: {
                    oneOf: [
                        {
                            type: 'object',
                            properties: {
                                name: { type: 'string', description: 'pipeline 名称。' },
                                platform: { type: 'string', description: '目标平台。' },
                                memo: { type: 'string', description: '备注。' },
                                detail: {
                                    oneOf: [
                                        { type: 'string', description: '插件配置 JSON 字符串。' },
                                        { type: 'object', additionalProperties: true, description: '插件配置对象。' },
                                        { type: 'array', items: { type: 'object' }, description: '插件配置对象数组。' }
                                    ]
                                }
                            }
                        },
                        {
                            type: 'string',
                            description: '创建 pipeline 请求体的 JSON 对象字符串。'
                        }
                    ]
                }
            },
            required: ['pipeline']
        }
    },
    {
        name: 'update_pipeline',
        description: '更新 pipeline。请提供 `id` 和 `changes`；其中 `detail` 支持对象、数组或合法 JSON 字符串。',
        inputSchema: {
            type: 'object',
            properties: {
                id: { type: 'string', description: 'pipeline ID。' },
                changes: {
                    oneOf: [
                        {
                            type: 'object',
                            properties: {
                                name: { type: 'string', description: '新的 pipeline 名称。' },
                                platform: { type: 'string', description: '新的平台。' },
                                memo: { type: 'string', description: '新的备注。' },
                                detail: {
                                    oneOf: [
                                        { type: 'string', description: '插件配置 JSON 字符串。' },
                                        { type: 'object', additionalProperties: true, description: '插件配置对象。' },
                                        { type: 'array', items: { type: 'object' }, description: '插件配置对象数组。' }
                                    ]
                                }
                            }
                        },
                        {
                            type: 'string',
                            description: '更新 pipeline 请求体的 JSON 对象字符串。'
                        }
                    ]
                }
            },
            required: ['id', 'changes']
        }
    },
    {
        name: 'delete_pipeline',
        description: '删除单个 pipeline。',
        inputSchema: {
            type: 'object',
            properties: {
                id: { type: 'string', description: 'pipeline ID。' }
            },
            required: ['id']
        }
    },
    {
        name: 'get_pipeline_groups',
        description: '读取某个 pipeline 当前关联的 Agent 分组。',
        inputSchema: {
            type: 'object',
            properties: {
                id: { type: 'string', description: 'pipeline ID。' },
                page: { type: 'integer', description: '页码。' },
                size: { type: 'integer', description: '每页条数。' }
            },
            required: ['id']
        }
    },
    {
        name: 'add_pipeline_groups',
        description: '给某个 pipeline 增量添加 Agent 分组。',
        inputSchema: {
            type: 'object',
            properties: {
                id: { type: 'string', description: 'pipeline ID。' },
                group_ids: {
                    oneOf: [
                        { type: 'array', items: { oneOf: [{ type: 'integer' }, { type: 'string' }, { type: 'object', additionalProperties: true }] } },
                        { type: 'string', description: '分组 ID 的逗号分隔字符串，或 JSON 数组字符串。' }
                    ],
                    description: '目标分组 id 集合。'
                }
            },
            required: ['id', 'group_ids']
        }
    },
    {
        name: 'replace_pipeline_groups',
        description: '整体替换某个 pipeline 关联的 Agent 分组。',
        inputSchema: {
            type: 'object',
            properties: {
                id: { type: 'string', description: 'pipeline ID。' },
                group_ids: {
                    oneOf: [
                        { type: 'array', items: { oneOf: [{ type: 'integer' }, { type: 'string' }, { type: 'object', additionalProperties: true }] } },
                        { type: 'string', description: '分组 ID 的逗号分隔字符串，或 JSON 数组字符串。' }
                    ],
                    description: '目标分组 id 集合。'
                }
            },
            required: ['id', 'group_ids']
        }
    },
    {
        name: 'delete_pipeline_groups',
        description: '清空某个 pipeline 当前关联的所有 Agent 分组。',
        inputSchema: {
            type: 'object',
            properties: {
                id: { type: 'string', description: 'pipeline ID。' }
            },
            required: ['id']
        }
    },
    {
        name: 'get_pipeline_agent_status',
        description: '读取某个 pipeline 关联 Agent 的同步状态。`group_ids` 可选，默认值为 `all`，表示当前账号可读的全部分组。',
        inputSchema: {
            type: 'object',
            properties: {
                id: { type: 'string', description: 'pipeline ID。' },
                page: { type: 'integer', description: '页码。' },
                size: { type: 'integer', description: '每页条数。' },
                filter: { type: 'string', description: '过滤条件。' },
                group_ids: { type: 'string', description: '可选，逗号分隔的分组 id 集合，或特殊值 `all`；默认 `all`。', default: 'all' },
                sort: { type: 'string', description: '排序字段。' },
                order: { type: 'string', description: '升序/降序。' },
                status: { type: 'string', description: '文件下发状态。' }
            },
            required: ['id']
        }
    },
    {
        name: 'list_available_pipeline_agents',
        description: '列出指定平台下可用于 pipeline 绑定的 Agent。`group_ids` 可选，默认值为 `all`，表示当前账号可读的全部分组。',
        inputSchema: {
            type: 'object',
            properties: {
                page: { type: 'integer', description: '页码。' },
                size: { type: 'integer', description: '每页条数。' },
                filter: { type: 'string', description: '过滤条件。' },
                group_ids: { type: 'string', description: '可选，逗号分隔的分组 id 集合，或特殊值 `all`；默认 `all`。', default: 'all' },
                sort: { type: 'string', description: '排序字段。' },
                order: { type: 'string', description: '升序/降序。' },
                platform: { type: 'string', description: '目标平台。' },
                exclude_instance: { type: 'string', description: '排除的实例 id。' }
            },
            required: ['platform']
        }
    },
    {
        name: 'list_available_pipeline_agent_groups',
        description: '列出可用于 pipeline 关联的 Agent 分组。',
        inputSchema: {
            type: 'object',
            properties: {
                permit: { type: 'string', description: '可选，权限过滤。' }
            }
        }
    }
];

export const searchTools: ToolDefinition[] = [
    ...withOutputControls(withSharedResourceHint(basicLogTools)),
    ...withOutputControls(withSharedResourceHint(statisticalAnalysisTools)),
    ...withOutputControls(withSharedResourceHint(intelligentAnalysisTools)),
    ...withOutputControls(withSharedResourceHint(predictiveAnalysisTools))
];

export const dashboardServerTools: ToolDefinition[] = [
    ...withOutputControls(dashboardTools)
];

export const parserRuleServerTools: ToolDefinition[] = [
    ...withOutputControls(parserRuleTools)
];

export const fieldConfigServerTools: ToolDefinition[] = [
    ...withOutputControls(fieldConfigTools)
];

export const ingestServerTools: ToolDefinition[] = [
    ...withOutputControls(ingestTools)
];

// 所有工具
export const allTools: ToolDefinition[] = [
    ...searchTools,
    ...dashboardServerTools,
    ...parserRuleServerTools,
    ...fieldConfigServerTools,
    ...ingestServerTools
];
