import { ToolDefinition } from './types.js';

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

// 所有工具
export const allTools: ToolDefinition[] = [
    ...basicLogTools,
    ...statisticalAnalysisTools,
    ...intelligentAnalysisTools,
    ...predictiveAnalysisTools
];