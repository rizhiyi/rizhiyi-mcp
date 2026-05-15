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

// 基础日志工具
export const basicLogTools: ToolDefinition[] = [
    {
        name: 'log_search_sheet',
        description: '基础数据概览：返回总命中数、窗口时长、每秒事件数等。支持指定字段统计和百分位数计算。**注意：返回结果会自动包含 `_links` 字段，其中提供了用于在浏览器中打开的、针对关键字段（如 trace_id, context_id, appname 等）的精准跳转 URL。这些链接仅供用户点击查看，不可用于 API 调用。**',
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
                limit: {
                    type: 'integer',
                    description: '返回结果数量限制',
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
                }
            },
            required: ['time_range']
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
        description: '根据任务ID(sid)获取日志聚类分析的实际结果，聚类分析很慢，需要自动轮询等待任务完成。返回的结果可以直接用于pattern_classification进行高级分析',
        inputSchema: {
            type: 'object',
            properties: {
                sid: { 
                    type: 'string', 
                    description: '日志聚类分析任务ID，通过log_reduce_pattern工具获取' 
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
                }
            },
            required: ['sid']
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
            },
            required: ['time_range']
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
    }
];

// 统计分析工具
export const statisticalAnalysisTools: ToolDefinition[] = [
    {
        name: 'trend_summary',
        description: '趋势概要：按时间桶统计，输出起止、最值、变化率、斜率等，并生成自然语言总结和峰值检测',
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
                }
            },
            required: ['time_range']
        }
    },
    {
        name: 'anomaly_points',
        description: '异常点标识：在时间序列上检测离群点，支持z-score和IQR方法',
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
                }
            },
            required: ['time_range']
        }
    }
];

// 智能分析工具
export const intelligentAnalysisTools: ToolDefinition[] = [
    {
        name: 'pattern_classification',
        description: '模式识别和分类：可直接使用 log_reduce_preview 的结果，或独立执行完整流程。当提供 previous_result 时，直接分析该数据；否则执行完整的聚类分析流程',
        inputSchema: {
            type: 'object',
            properties: {
                previous_result: {
                    type: 'object',
                    description: '前一个tool的结果数据，如log_reduce_preview的输出，包含patterns数据。提供此参数时将直接分析该数据而不再执行聚类分析'
                },
                query: { 
                    type: 'string', 
                    description: '搜索查询语句，例如："appname:firewall", "appname:firewall AND status:error"。当不提供previous_result时必须提供', 
                    default: '*' 
                },
                time_range: { 
                    type: 'string', 
                    description: '时间范围，例如："now-1h,now", "now/d,now+1d/d"。当不提供previous_result时必须提供',
                    default: 'now-15m,now'
                },
                index_name: { 
                    type: 'string', 
                    description: '索引名称', 
                    default: 'yotta' 
                },
                pattern_options: {
                    type: 'object',
                    description: '聚类分析选项（仅在需要执行聚类分析时生效）',
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
                },
                limit: {
                    type: 'integer',
                    description: '返回模式数量限制',
                    default: 20
                }
            }
        }
    },
    {
        name: 'period_compare',
        description: '跨时间段对比分析：对比两段时间的总量、趋势、差异字段分布。可复用已有时间序列数据进行分析',
        inputSchema: {
            type: 'object',
            properties: {
                previous_time_series_a: {
                    type: 'object',
                    description: '时间段A的已有时间序列数据，如trend_summary的输出，包含points数组。提供此参数时将跳过数据获取直接进行分析'
                },
                previous_time_series_b: {
                    type: 'object', 
                    description: '时间段B的已有时间序列数据，如trend_summary的输出，包含points数组。提供此参数时将跳过数据获取直接进行分析'
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
        description: '关联性分析：分析数值字段相关系数和类别字段共现关系',
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
                    description: '要分析的字段列表，如["response_time", "cpu_usage", "status"]',
                    default: []
                },
                method: {
                    type: 'string',
                    description: '关联分析方法，默认"mixed"，可选：["pearson", "spearman", "categorical", "mixed"]',
                    default: 'mixed',
                    enum: ['pearson', 'spearman', 'categorical', 'mixed']
                },
                limit: {
                    type: 'integer',
                    description: '返回结果数量限制，默认50',
                    default: 50
                }
            },
            required: ['time_range']
        }
    },
    {
        name: 'root_cause_suggestions',
        description: '根因分析建议：分析异常窗口与基线窗口的分布差异，提供根因假设和查询建议',
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
                    description: '候选字段列表，如["status", "level", "host"]',
                    default: []
                },
                significance_threshold: {
                    type: 'number',
                    description: '分布差异显著性阈值(JS散度)，默认0.1',
                    default: 0.1
                },
                topk: {
                    type: 'integer',
                    description: '返回最重要的K个根因假设，默认5',
                    default: 5
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
        description: '趋势预测（短期）：基于线性回归/滑动平均进行时间序列预测，包含置信区间',
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
                }
            },
            required: ['time_range']
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
                }
            },
            required: ['time_range']
        }
    }
];

// 仪表盘工具
export const dashboardTools: ToolDefinition[] = [
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
        description: '根据完整的 dashboard 说明创建仪表盘。适合已经明确 tabs 和 panels 结构的场景。注意：同一个 tab 内所有 chart 必须使用同一套 scheme 主题色，不同 tab 之间可以不同；服务端会按图表类别补齐默认 searchData，并按文档顺序逐步扩展更多 chartType。提交 panel 前，请先调用 `log-tools` 的 `query_precheck`，推荐使用 `mode=full`，并通过 `field_mapping` 或 `expected_fields` 校验 query 有数据且字段名与 `xField`、`yField`、`byFields`、`fromField`、`toField`、`weightField` 等配置一致；若页面无图，先排查 `query_precheck` 返回的语法/无数/字段映射问题，再排查 chartType 模板。当前已通过真实创建/回读验证，并结合页面观察确认可用的类型包括 `line`、`area`、`scatter`、`single`、`pie`、`rose`、`bar`、`sunburst`、`heatmap`、`wordcloud`、`liquidfill`、`multiaxis`、`column`、`rangeline`、`chord`、`sankey`、`force`、`attackmap`；`table`、`networkflow`、`tracing` 已纳入枚举，但仍建议继续按“先创建、再回读、再页面确认”的方式验证。',
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
        description: '调整指定 dashboard 某个 tab 下 panel 的布局，不修改 query 内容。',
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
        description: '向指定 dashboard/tab 新增一个 panel。请注意：panel 类型(type) 与图表展示类型(chartType) 是两回事。当前写入优先支持 type=trend 或 type=eventsTable；具体展示样式应放在 chartType 中。若传 color，必须属于该 tab 当前 scheme；服务端会按图表类别补齐默认 searchData，并继续按文档顺序扩展更多 chartType。提交前请先调用 `log-tools` 的 `query_precheck`，推荐 `mode=full`，并通过 `field_mapping` 或 `expected_fields` 验证 query 有数据且字段名与图表配置一致；尤其是 `networkflow`、`tracing`、关系图和攻击地图这类依赖显式字段名的图表，不要跳过这一步。若页面无图，先排查 `query_precheck` 返回的语法/无数/字段映射问题，再排查 chartType 模板。当前已完成真实闭环验证的类型包括 `line`、`area`、`scatter`、`single`、`pie`、`rose`、`bar`、`sunburst`、`heatmap`、`wordcloud`、`liquidfill`、`multiaxis`、`column`、`rangeline`、`chord`、`sankey`、`force`、`attackmap`。',
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
        description: '更新指定 dashboard/tab 下某个 panel 的内容，例如标题、query、时间范围、chartType、主题色或局部布局。注意：同一个 tab 内所有 chart 必须使用同一套 scheme，不同 tab 之间可以不同；若切换图表类型，服务端会按类别重新补齐对应的默认 searchData，并继续按文档顺序扩展更多 chartType。若修改了 query 或字段映射，请先调用 `log-tools` 的 `query_precheck`，推荐 `mode=full`，并通过 `field_mapping` 或 `expected_fields` 验证 query 仍然有数据且字段名可用，再提交更新。对于尚未做过真实闭环验证的类型，仍建议在更新后执行“创建/更新 -> 回读 content -> 页面确认”的最小验证流程；若页面无图，先排查 `query_precheck` 返回的语法/无数/字段映射问题，再排查 chartType 模板。',
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

export const searchTools: ToolDefinition[] = [
    ...withOutputControls(basicLogTools),
    ...withOutputControls(statisticalAnalysisTools),
    ...withOutputControls(intelligentAnalysisTools),
    ...withOutputControls(predictiveAnalysisTools)
];

export const dashboardServerTools: ToolDefinition[] = [
    ...withOutputControls(dashboardTools)
];

// 所有工具
export const allTools: ToolDefinition[] = [
    ...searchTools,
    ...dashboardServerTools
];
