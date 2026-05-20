import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import https from 'https';
import dotenv from 'dotenv';
import type { HttpClientConfig } from './types.js';

import { LogEaseClient } from './client.js';
import { searchTools } from './tools.js';
import { LogSearchModule } from './modules/log-search.js';
import { StatisticsModule } from './modules/statistics.js';
import { TrendForecastModule } from './modules/trend-forecast.js';
import { AnomalyDetectionModule } from './modules/anomaly-detection.js';
import { formatErrorPayload, formatSuccessPayload } from './result-formatter.js';

// 加载环境变量
dotenv.config({path: ['.env.local', '.env']});

// 配置HTTP客户端（从环境变量读取）
const baseURL = process.env.LOGEASE_BASE_URL ?? 'http://127.0.0.1:8090';
const authHeader = process.env.LOGEASE_AUTH_HEADER || (process.env.LOGEASE_API_KEY ? `apikey ${process.env.LOGEASE_API_KEY}` : undefined);
const rejectUnauthorizedEnv = process.env.LOGEASE_TLS_REJECT_UNAUTHORIZED;
const rejectUnauthorized = typeof rejectUnauthorizedEnv !== 'undefined' ? rejectUnauthorizedEnv === 'true' : false;

if (!process.env.LOGEASE_BASE_URL) {
    console.warn('LOGEASE_BASE_URL 未设置，默认使用 http://127.0.0.1:8090');
}
if (!authHeader) {
    console.warn('未检测到认证信息（LOGEASE_AUTH_HEADER 或 LOGEASE_API_KEY），与服务交互可能失败');
}

// 显式构造 headers 以满足 Record<string, string> 类型
const headers: Record<string, string> = {};
if (authHeader) {
    headers.Authorization = authHeader;
}

const httpClientConfig: HttpClientConfig = {
    baseURL,
    headers,
    httpsAgent: new https.Agent({ rejectUnauthorized })
};

// 创建模块实例
const client = new LogEaseClient(httpClientConfig);
const logSearchModule = new LogSearchModule(client, baseURL);
const statisticsModule = new StatisticsModule(client);
const trendForecastModule = new TrendForecastModule(client);
const anomalyDetectionModule = new AnomalyDetectionModule(client);

const SERVER_LEVEL_INSTRUCTIONS = `使用说明:
## 核心原则：先统计，后采样
1. 数量：时间窗口内有多少日志？
2. 分布：涉及哪些服务/级别/错误类型？
3. 趋势：数量在增加、稳定还是减少？
4. 再采样：先摸清全局，再获取具体条目
5. 若后续要创建或更新 dashboard 图表，请先调用 query_precheck，确认 query 语法、数据和字段映射都没问题。

## 分析框架
### 第一步：俯瞰全局
- 日志总量
- 错误率及其分布
- 受影响最大的服务

### 第二步：识别模式
- 错误聚集（短时间内大量错误）
- 时间规律（从 X 时间点开始）
- 服务关联（服务 A 报错 → 服务 B 报错）

### 第三步：精准采样
- 在错误高峰处采样
- 获取每种不同错误类型的示例
- 与基线时段对比
## 如需减少上下文，请优先传 fields 仅选择关键字段。
## 遇到错误时，优先根据 suggestion 字段修正参数后自动重试一次。`;

// 创建MCP服务器
const server = new Server(
    {
        name: 'logease-mcp-server',
        version: '1.1.0',
        instructions: SERVER_LEVEL_INSTRUCTIONS,
    },
    {
        capabilities: {
            tools: {},
        },
    }
);

/**
 * 处理工具调用请求
 */
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
        const { name, arguments: parameters } = request.params;
        
        switch (name) {
            // 基础日志工具
            case 'log_search_sheet':
                return await handleLogSearchSheet(parameters);
                
            case 'log_reduce_pattern':
                return await handleLogReducePattern(parameters);
                
            case 'log_reduce_preview':
                return await handleLogReducePreview(parameters);
                
            case 'list_fields':
                return await handleListFields(parameters);
                
            case 'list_field_values':
                return await handleListFieldValues(parameters);

            case 'query_precheck':
                return await handleQueryPrecheck(parameters);

            // 统计分析工具
            case 'data_overview':
                return await handleDataOverview(parameters);
                
            case 'trend_summary':
                return await handleTrendSummary(parameters);
                
            case 'anomaly_points':
                return await handleAnomalyPoints(parameters);

            // 智能分析工具
            case 'pattern_classification':
                return await handlePatternClassification(parameters);
                
            case 'period_compare':
                return await handlePeriodCompare(parameters);
                
            case 'correlation_analysis':
                return await handleCorrelationAnalysis(parameters);
                
            case 'root_cause_suggestions':
                return await handleRootCauseSuggestions(parameters);

            // 预测分析工具
            case 'trend_forecast':
                return await handleTrendForecast(parameters);
                
            case 'anomaly_alert':
                return await handleAnomalyAlert(parameters);

            default:
                return buildToolError(
                    'UNKNOWN_TOOL',
                    `未知的工具: ${name}`,
                    '请先调用 tools 列表确认可用工具名称，再重试。'
                );
        }
    } catch (error: any) {
        return buildToolError(
            'TOOL_EXECUTION_EXCEPTION',
            `执行工具出错: ${error.message}`,
            '请检查输入参数格式；如果是时间范围查询，建议先缩小范围后重试。'
        );
    }
});

/**
 * 处理工具列表请求
 */
server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
        tools: searchTools,
    };
});

// 工具处理函数
async function handleLogSearchSheet(params: any) {
    if (!params?.time_range) {
        return buildToolError(
            'MISSING_REQUIRED_PARAM',
            '缺少必填参数 time_range。',
            '请传入 time_range，例如 now-15m,now。'
        );
    }
    const page = params.page ?? 0;
    const size = params.size ?? params.limit ?? 20;
    const result = await logSearchModule.executeLogSearchSheet(
        params.query || "*",
        params.time_range,
        params.index_name || "yotta",
        { page, size, limit: params.limit },
        params.fields
    );
    return formatResult(result, params);
}

async function handleLogReducePattern(params: any) {
    if (!params?.time_range) {
        return buildToolError(
            'MISSING_REQUIRED_PARAM',
            '缺少必填参数 time_range。',
            '请传入 time_range，例如 now-15m,now。'
        );
    }
    const result = await logSearchModule.executeLogReducePattern(
        params.query || "*",
        params.time_range,
        params.index_name || "yotta",
        params.pattern_options || {}
    );
    return formatResult(result, params);
}

async function handleLogReducePreview(params: any) {
    if (!params?.sid) {
        return buildToolError(
            'MISSING_REQUIRED_PARAM',
            '缺少必填参数 sid。',
            '请先调用 log_reduce_pattern 获取 sid，再调用 log_reduce_preview。'
        );
    }
    const result = await logSearchModule.executeLogReducePreview(
        params.sid,
        params.max_retries || 10,
        params.retry_interval || 5000
    );
    return formatResult(result, params);
}

async function handleListFields(params: any) {
    if (!params?.time_range) {
        return buildToolError(
            'MISSING_REQUIRED_PARAM',
            '缺少必填参数 time_range。',
            '请传入 time_range，例如 now-15m,now。'
        );
    }
    const result = await logSearchModule.executeListFields(
        params.query || "*",
        params.time_range,
        params.index_name || "yotta"
    );
    return formatResult(result, params);
}

async function handleListFieldValues(params: any) {
    if (!params?.field || !params?.time_range) {
        return buildToolError(
            'MISSING_REQUIRED_PARAM',
            'list_field_values 需要 field 和 time_range。',
            '请补充 field（如 status）与 time_range（如 now-1h,now）。'
        );
    }
    const result = await logSearchModule.executeListFieldValues(
        params.field,
        params.query || "*",
        params.time_range,
        params.index_name || "yotta",
        params.limit || 100
    );
    return formatResult(result, params);
}

async function handleQueryPrecheck(params: any) {
    if (!params?.query) {
        return buildToolError(
            'MISSING_REQUIRED_PARAM',
            'query_precheck 需要 query。',
            '请提供要预检的 SPL 查询语句；创图前建议使用 mode=full。'
        );
    }

    const result = await logSearchModule.executeQueryPrecheck({
        query: params.query,
        time_range: params.time_range || 'now-15m,now',
        index_name: params.index_name || 'yotta',
        mode: params.mode || 'full',
        expected_fields: params.expected_fields || [],
        field_mapping: params.field_mapping || {},
        sample_size: params.sample_size || 20,
        terminated_after_size: params.terminated_after_size || 100,
        sample_fields: params.sample_fields || []
    });
    return formatResult(result, params);
}

async function handleDataOverview(params: any) {
    if (!params?.time_range) {
        return buildToolError(
            'MISSING_REQUIRED_PARAM',
            '缺少必填参数 time_range。',
            '请传入 time_range，例如 now-15m,now。'
        );
    }
    const result = await statisticsModule.executeDataOverview(
        params.query || "*",
        params.time_range,
        params.index_name || "yotta",
        params.metric_field,
        params.percentiles || [50, 90, 99]
    );
    return formatResult(result, params);
}

async function handleTrendSummary(params: any) {
    if (!params?.time_range) {
        return buildToolError(
            'MISSING_REQUIRED_PARAM',
            '缺少必填参数 time_range。',
            '请传入 time_range，例如 now-15m,now。'
        );
    }
    const result = await statisticsModule.executeTrendSummary(
        params.query || "*",
        params.time_range,
        params.index_name || "yotta",
        params.bucket,
        params.metric_field,
        params.limit_peaks || 3
    );
    return formatResult(result, params);
}

async function handleAnomalyPoints(params: any) {
    if (!params?.time_range) {
        return buildToolError(
            'MISSING_REQUIRED_PARAM',
            '缺少必填参数 time_range。',
            '请传入 time_range，例如 now-15m,now。'
        );
    }
    const result = await statisticsModule.executeAnomalyPoints(
        params.query || "*",
        params.time_range,
        params.index_name || "yotta",
        params.bucket,
        params.metric_field,
        params.method || 'zscore',
        params.sensitivity || 3,
        params.min_support || 0
    );
    return formatResult(result, params);
}

async function handlePatternClassification(params: any) {
    // 如果提供了前一个tool的结果数据，直接使用它进行分析
    if (params.previous_result) {
        const result = await anomalyDetectionModule.executePatternClassification(
            params.previous_result,
            params.limit || 20
        );
        return formatResult(result, params);
    }
    
    // 否则执行完整的聚类分析流程
    if (!params.query || !params.time_range) {
        return buildToolError(
            'INVALID_ARGUMENT',
            '必须提供 previous_result 或者同时提供 query 和 time_range 参数。',
            '若已有上一步结果，请传 previous_result；否则传 query 和 time_range。'
        );
    }
    
    const result = await anomalyDetectionModule.executePatternClassification({
        query: params.query || "*",
        time_range: params.time_range,
        index_name: params.index_name || "yotta",
        pattern_options: params.pattern_options || {},
        limit: params.limit || 20
    });
    return formatResult(result, params);
}

async function handlePeriodCompare(params: any) {
    // 如果提供了之前的时间序列数据，直接构建数据对象进行分析
    if (params.previous_time_series_a || params.previous_time_series_b) {
        if (!params.previous_time_series_a || !params.previous_time_series_b) {
            return buildToolError(
                'INVALID_ARGUMENT',
                '必须同时提供 previous_time_series_a 和 previous_time_series_b 参数。',
                '请一次性传入两个时间序列，或改为使用 time_range_a/time_range_b。'
            );
        }
        
        // 构建符合模块方法期望格式的数据对象
        const mockResultA = {
            status: 200,
            data: { points: params.previous_time_series_a.points || [] },
            message: '时间段A数据（复用）'
        };
        
        const mockResultB = {
            status: 200,
            data: { points: params.previous_time_series_b.points || [] },
            message: '时间段B数据（复用）'
        };
        
        // 使用重构后的模块方法，直接传入数据进行分析
        const result = await anomalyDetectionModule.executePeriodCompareWithData(
            mockResultA,
            mockResultB,
            {
                compare_fields: params.compare_fields || [],
                topk: params.topk || 10
            }
        );
        return formatResult(result, params);
    }
    
    // 否则执行完整的数据获取流程
    if (!params.time_range_a || !params.time_range_b) {
        return buildToolError(
            'INVALID_ARGUMENT',
            '必须提供 previous_time_series 或者 time_range_a 和 time_range_b 参数。',
            '请传入 previous_time_series_a/b，或同时传 time_range_a 和 time_range_b。'
        );
    }
    
    const result = await anomalyDetectionModule.executePeriodCompare({
        query: params.query || "*",
        time_range_a: params.time_range_a,
        time_range_b: params.time_range_b,
        index_name: params.index_name || "yotta",
        bucket: params.bucket || "5m",
        compare_fields: params.compare_fields || [],
        topk: params.topk || 10,
        metric_field: params.metric_field
    });
    return formatResult(result, params);
}

async function handleCorrelationAnalysis(params: any) {
    const result = await anomalyDetectionModule.executeCorrelationAnalysis({
        query: params.query || "*",
        time_range: params.time_range,
        index_name: params.index_name || "yotta",
        fields: params.fields || [],
        method: params.method || 'mixed',
        limit: params.limit || 50
    });
    return formatResult(result, params);
}

async function handleRootCauseSuggestions(params: any) {
    const result = await anomalyDetectionModule.executeRootCauseSuggestions({
        query: params.query || "*",
        anomaly_window: params.anomaly_window,
        baseline_window: params.baseline_window,
        index_name: params.index_name || "yotta",
        candidate_fields: params.candidate_fields || [],
        significance_threshold: params.significance_threshold || 0.1,
        topk: params.topk || 5
    });
    return formatResult(result, params);
}

async function handleTrendForecast(params: any) {
    const result = await trendForecastModule.executeTrendForecast({
        query: params.query || "*",
        time_range: params.time_range,
        index_name: params.index_name || "yotta",
        bucket: params.bucket,
        horizon: params.horizon || 12,
        method: params.method || 'linear_regression',
        confidence: params.confidence || 0.95,
        metric_field: params.metric_field,
        window: params.window || 10,
        alpha: params.alpha || 0.3
    });
    return formatResult(result, params);
}

async function handleAnomalyAlert(params: any) {
    const result = await trendForecastModule.executeAnomalyAlert({
        query: params.query || "*",
        time_range: params.time_range,
        index_name: params.index_name || "yotta",
        bucket: params.bucket,
        method: params.method || 'prediction_band',
        threshold: params.threshold || 3.0,
        alert_on: params.alert_on || 'both',
        min_anomaly_points: params.min_anomaly_points || 3,
        forecast_horizon: params.forecast_horizon || 6,
        metric_field: params.metric_field
    });
    return formatResult(result, params);
}

/**
 * 格式化结果
 */
function formatResult(result: any, params: any = {}): any {
    if (result.error) {
        return {
            isError: true,
            content: [{
                type: 'text',
                text: formatErrorPayload({
                    error_code: result.error_code || inferErrorCode(result),
                    message: result.message || result.error,
                    suggestion: result.suggestion || inferSuggestion(result),
                    retryable: typeof result.retryable === 'boolean' ? result.retryable : true,
                    details: result.details
                })
            }]
        };
    }

    return {
        content: [{
            type: 'text',
            text: formatSuccessPayload(result.data || result, {
                outputFormat: params.output_format,
                includeRawJson: params.include_raw_json
            })
        }]
    };
}

function inferErrorCode(result: any): string {
    const message = String(result?.message || result?.error || '');
    if (message.includes('time_range')) return 'INVALID_TIME_RANGE';
    if (message.includes('bucket')) return 'INVALID_BUCKET';
    if (message.includes('field')) return 'INVALID_FIELD';
    return 'TOOL_EXECUTION_ERROR';
}

function inferSuggestion(result: any): string {
    const message = String(result?.message || result?.error || '');
    if (message.includes('time_range')) {
        return '请检查 time_range，示例：now-15m,now。';
    }
    if (message.includes('bucket')) {
        return '请检查 bucket，示例：1m、5m、1h。';
    }
    if (message.includes('field')) {
        return '请先调用 list_fields 确认字段名，再重试。';
    }
    return '请根据错误信息修正参数后重试；若数据量过大，建议先用聚合缩小范围。';
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
                retryable: true
            })
        }]
    };
}

/**
 * 启动服务器
 */
async function startServer(): Promise<void> {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('LogEase MCP 服务器已启动');
}

// 启动服务器
startServer().catch((error) => {
    console.error('启动服务器失败:', error);
    process.exit(1);
});
