import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
    CallToolRequestSchema,
    ErrorCode,
    ListResourcesRequestSchema,
    ListToolsRequestSchema,
    McpError,
    ReadResourceRequestSchema
} from '@modelcontextprotocol/sdk/types.js';
import https from 'https';
import dotenv from 'dotenv';
import type {
    HttpClientConfig,
    SharedResultEnvelope,
    SharedResultKind,
    SharedResultReadView,
    SharedResultSummary
} from './types.js';

import { LogEaseClient } from './client.js';
import { searchTools } from './tools.js';
import { LogSearchModule } from './modules/log-search.js';
import { StatisticsModule } from './modules/statistics.js';
import { TrendForecastModule } from './modules/trend-forecast.js';
import { AnomalyDetectionModule } from './modules/anomaly-detection.js';
import { formatErrorPayload, formatSuccessPayload } from './result-formatter.js';
import {
    listSharedResults,
    SharedResultStoreError,
    getSharedResultStoreConfig,
    readSharedResult,
    saveSharedResult
} from './shared-result-store.js';

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
const sharedResultStoreConfig = getSharedResultStoreConfig();

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
## 若用户已明确要求“最近 N 条日志并做关联/根因分析”，优先一次 log_search_sheet 后直接复用其返回的 resource_uri，不要额外补做趋势/字段探测。
## 遇到错误时，优先根据 suggestion 字段修正参数后自动重试一次。`;

// 创建MCP服务器
const server = new Server(
    {
        name: 'logease-mcp-server',
        version: '0.1.0',
        instructions: SERVER_LEVEL_INSTRUCTIONS,
    },
    {
        capabilities: {
            tools: {},
            resources: {},
        },
    }
);

/**
 * 处理工具调用请求
 */
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
        const { name, arguments: rawParameters } = request.params;
        const parameters = {
            ...(rawParameters && typeof rawParameters === 'object' ? rawParameters : {}),
            __tool_name: name
        };
        
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

server.setRequestHandler(ListResourcesRequestSchema, async () => {
    const resources = await listSharedResults(sharedResultStoreConfig);
    return {
        resources: resources.map((envelope) => ({
            uri: envelope.resource_uri,
            name: envelope.resource_title,
            mimeType: envelope.resource_mime_type,
            description: buildSharedResourceDescription(envelope)
        }))
    };
});

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    try {
        const envelope = await readSharedResult(request.params.uri, sharedResultStoreConfig);
        return {
            contents: [{
                uri: envelope.resource_uri,
                mimeType: envelope.resource_mime_type,
                text: JSON.stringify(buildSharedResultReadResponse(envelope, {
                    view: 'full',
                    offset: 0,
                    limit: 1,
                    fields: []
                }), null, 2)
            }]
        };
    } catch (error: any) {
        throw toMcpResourceError(error);
    }
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
    const sharedResultRef = getSharedResultReference(params, ['resource_uri']);
    let sid = params?.sid;
    if (!sid && sharedResultRef) {
        try {
            const envelope = await readSharedResult(sharedResultRef, sharedResultStoreConfig);
            sid = envelope.upstream_sid || extractSidFromPayload(envelope.payload);
        } catch (error: any) {
            return buildSharedStoreError(error, '请确认 resource_uri 是否来自 log_reduce_pattern，或重新传入 sid。');
        }
    }

    if (!sid) {
        return buildToolError(
            'MISSING_REQUIRED_PARAM',
            '缺少必填参数 sid。',
            '请先调用 log_reduce_pattern 获取 sid，或传入其返回的 resource_uri。'
        );
    }
    const result = await logSearchModule.executeLogReducePreview(
        sid,
        params.max_retries || 10,
        params.retry_interval || 5000
    );

    if (result.error || !params?.analyze_patterns) {
        return formatResult(result, params);
    }

    const patterns = result.data?.result;
    if (!Array.isArray(patterns)) {
        return buildToolError(
            'INVALID_PATTERN_RESULT',
            '日志聚类结果不可用于模式分析。',
            '请确认 sid 对应的聚类任务已完成且返回了有效的模式结果。'
        );
    }

    const analysis = anomalyDetectionModule.analyzePatternResults(
        patterns,
        result.data?.total_hits || 0,
        params.analysis_limit || 20
    );

    result.data = {
        ...result.data,
        pattern_analysis: analysis
    };

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
    const sharedResultRef = getSharedResultReference(params, ['resource_uri']);
    if (!params?.time_range && !sharedResultRef) {
        return buildToolError(
            'MISSING_REQUIRED_PARAM',
            '缺少必填参数 time_range 或 resource_uri。',
            '请传入 time_range，例如 now-15m,now，或传入包含时间序列数据的 resource_uri。'
        );
    }

    if (sharedResultRef) {
        try {
            const envelope = await readSharedResult(sharedResultRef, sharedResultStoreConfig);
            const reusedSeries = extractTimeSeriesFromPayload(envelope.payload);
            const reusedResult = await statisticsModule.executeTrendSummaryWithData(
                reusedSeries,
                params.limit_peaks || 3
            );
            return formatResult(reusedResult, params);
        } catch (error: any) {
            return buildSharedStoreError(error, '请确认 resource_uri 有效且包含时间序列数据，或改为直接传 query/time_range 重新分析。');
        }
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
    const sharedResultRef = getSharedResultReference(params, ['resource_uri']);
    if (!params?.time_range && !sharedResultRef) {
        return buildToolError(
            'MISSING_REQUIRED_PARAM',
            '缺少必填参数 time_range 或 resource_uri。',
            '请传入 time_range，例如 now-15m,now，或传入包含时间序列数据的 resource_uri。'
        );
    }

    if (sharedResultRef) {
        try {
            const envelope = await readSharedResult(sharedResultRef, sharedResultStoreConfig);
            const reusedSeries = extractTimeSeriesFromPayload(envelope.payload);
            const reusedResult = await statisticsModule.executeAnomalyPointsWithData(
                reusedSeries,
                params.method || 'zscore',
                params.sensitivity || 3,
                params.min_support || 0
            );
            return formatResult(reusedResult, params);
        } catch (error: any) {
            return buildSharedStoreError(error, '请确认 resource_uri 有效且包含时间序列数据，或改为直接传 query/time_range 重新分析。');
        }
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

async function handlePeriodCompare(params: any) {
    let previousTimeSeriesA = params.previous_time_series_a;
    let previousTimeSeriesB = params.previous_time_series_b;
    const sharedResultRefA = getSharedResultReference(params, ['resource_uri_a']);
    const sharedResultRefB = getSharedResultReference(params, ['resource_uri_b']);

    if (sharedResultRefA || sharedResultRefB) {
        if (!sharedResultRefA || !sharedResultRefB) {
            return buildToolError(
                'INVALID_ARGUMENT',
                '必须同时提供 resource_uri_a 和 resource_uri_b 参数。',
                '请一次性传入两个时间序列 resource_uri，或改为使用 previous_time_series_a/b 或 time_range_a/time_range_b。'
            );
        }
        try {
            const [envelopeA, envelopeB] = await Promise.all([
                readSharedResult(sharedResultRefA, sharedResultStoreConfig),
                readSharedResult(sharedResultRefB, sharedResultStoreConfig)
            ]);
            previousTimeSeriesA = { series: extractTimeSeriesFromPayload(envelopeA.payload) };
            previousTimeSeriesB = { series: extractTimeSeriesFromPayload(envelopeB.payload) };
        } catch (error: any) {
            return buildSharedStoreError(error, '请确认 resource_uri_a/resource_uri_b 有效且包含时间序列数据，或改为直接传 previous_time_series_a/b。');
        }
    }

    // 如果提供了之前的时间序列数据，直接构建数据对象进行分析
    if (previousTimeSeriesA || previousTimeSeriesB) {
        if (!previousTimeSeriesA || !previousTimeSeriesB) {
            return buildToolError(
                'INVALID_ARGUMENT',
                '必须同时提供 previous_time_series_a 和 previous_time_series_b 参数。',
                '请一次性传入两个时间序列，或改为使用 time_range_a/time_range_b。'
            );
        }

        const previousSeriesA = previousTimeSeriesA.series || previousTimeSeriesA.data?.series || [];
        const previousPointsA = previousTimeSeriesA.points || previousTimeSeriesA.data?.points || [];
        const previousSeriesB = previousTimeSeriesB.series || previousTimeSeriesB.data?.series || [];
        const previousPointsB = previousTimeSeriesB.points || previousTimeSeriesB.data?.points || [];

        // 构建符合模块方法期望格式的数据对象
        const mockResultA = {
            status: 200,
            data: {
                series: previousSeriesA,
                points: previousPointsA
            },
            message: '时间段A数据（复用）'
        };
        
        const mockResultB = {
            status: 200,
            data: {
                series: previousSeriesB,
                points: previousPointsB
            },
            message: '时间段B数据（复用）'
        };
        
        // 使用重构后的模块方法，直接传入数据进行分析
        const result = await anomalyDetectionModule.executePeriodCompareWithData(
            mockResultA,
            mockResultB,
            {
                compare_fields: params.compare_fields || [],
                topk: params.topk || 10,
                query: params.query || "*",
                time_range_a: params.time_range_a,
                time_range_b: params.time_range_b,
                index_name: params.index_name || "yotta"
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
        bucket: params.bucket,
        compare_fields: params.compare_fields || [],
        topk: params.topk || 10,
        metric_field: params.metric_field
    });
    return formatResult(result, params);
}

async function handleCorrelationAnalysis(params: any) {
    if (!params?.time_range) {
        return buildToolError(
            'MISSING_REQUIRED_PARAM',
            '缺少必填参数 time_range。',
            '请传入 time_range，例如 now-15m,now。'
        );
    }

    let inputRows: Array<Record<string, any>> = [];
    const sharedResultRef = getSharedResultReference(params, ['resource_uri']);
    if (sharedResultRef) {
        try {
            const envelope = await readSharedResult(sharedResultRef, sharedResultStoreConfig);
            inputRows = extractRowsFromPayload(envelope.payload);
        } catch (error: any) {
            return buildSharedStoreError(error, '请确认 resource_uri 有效，或改为直接传 query/time_range 重新分析。');
        }
    }

    const result = await anomalyDetectionModule.executeCorrelationAnalysis({
        query: params.query || "*",
        time_range: params.time_range,
        index_name: params.index_name || "yotta",
        fields: params.fields || [],
        mode: params.mode || 'auto',
        bucket: params.bucket,
        max_lag: params.max_lag ?? 3,
        min_support: params.min_support ?? 0.05,
        min_confidence: params.min_confidence ?? 0.6,
        sample_size: params.sample_size ?? 500,
        limit: params.limit || 20,
        input_rows: inputRows
    });
    return formatResult(result, params);
}

async function handleRootCauseSuggestions(params: any) {
    let inputRows: Array<Record<string, any>> = [];
    const sharedResultRef = getSharedResultReference(params, ['resource_uri']);
    if (sharedResultRef) {
        try {
            const envelope = await readSharedResult(sharedResultRef, sharedResultStoreConfig);
            inputRows = extractRowsFromPayload(envelope.payload);
        } catch (error: any) {
            return buildSharedStoreError(error, '请确认 resource_uri 有效，或改为直接传异常窗口参数重新分析。');
        }
    }

    const result = await anomalyDetectionModule.executeRootCauseSuggestions({
        query: params.query || "*",
        anomaly_window: params.anomaly_window,
        baseline_window: params.baseline_window,
        index_name: params.index_name || "yotta",
        candidate_fields: params.candidate_fields || [],
        significance_threshold: params.significance_threshold ?? 0.1,
        topk: params.topk ?? 5,
        field_value_limit: params.field_value_limit ?? 20,
        sample_size: params.sample_size ?? 300,
        slice_max_depth: params.slice_max_depth ?? 2,
        min_slice_support: params.min_slice_support ?? 0.05,
        min_slice_lift: params.min_slice_lift ?? 2,
        input_rows: inputRows
    });
    return formatResult(result, params);
}

async function handleTrendForecast(params: any) {
    const sharedResultRef = getSharedResultReference(params, ['resource_uri']);
    if (!params?.time_range && !sharedResultRef) {
        return buildToolError(
            'MISSING_REQUIRED_PARAM',
            '缺少必填参数 time_range 或 resource_uri。',
            '请传入 time_range，例如 now-24h,now，或传入包含时间序列数据的 resource_uri。'
        );
    }

    if (sharedResultRef) {
        try {
            const envelope = await readSharedResult(sharedResultRef, sharedResultStoreConfig);
            const reusedSeries = extractTimeSeriesFromPayload(envelope.payload);
            const reusedResult = await trendForecastModule.executeTrendForecastWithData({
                time_series: reusedSeries,
                horizon: params.horizon || 12,
                method: params.method || 'linear_regression',
                confidence: params.confidence || 0.95,
                window: params.window || 10,
                alpha: params.alpha || 0.3
            });
            return formatResult(reusedResult, params);
        } catch (error: any) {
            return buildSharedStoreError(error, '请确认 resource_uri 有效且包含时间序列数据，或改为直接传 query/time_range 重新分析。');
        }
    }

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
    const sharedResultRef = getSharedResultReference(params, ['resource_uri']);
    if (!params?.time_range && !sharedResultRef) {
        return buildToolError(
            'MISSING_REQUIRED_PARAM',
            '缺少必填参数 time_range 或 resource_uri。',
            '请传入 time_range，例如 now-24h,now，或传入包含时间序列数据的 resource_uri。'
        );
    }

    if (sharedResultRef) {
        try {
            const envelope = await readSharedResult(sharedResultRef, sharedResultStoreConfig);
            const reusedSeries = extractTimeSeriesFromPayload(envelope.payload);
            const reusedResult = await trendForecastModule.executeAnomalyAlertWithData({
                time_series: reusedSeries,
                method: params.method || 'prediction_band',
                threshold: params.threshold || 3.0,
                alert_on: params.alert_on || 'both',
                min_anomaly_points: params.min_anomaly_points || 3,
                forecast_horizon: params.forecast_horizon || 6
            });
            return formatResult(reusedResult, params);
        } catch (error: any) {
            return buildSharedStoreError(error, '请确认 resource_uri 有效且包含时间序列数据，或改为直接传 query/time_range 重新分析。');
        }
    }

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
async function formatResult(result: any, params: any = {}): Promise<any> {
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

    const payload = result.data || result;
    if (shouldPersistAsSharedResource(payload, params)) {
        try {
            const toolName = String(params.__tool_name || 'unknown_tool');
            const envelope = await saveSharedResult({
                toolName,
                resultKind: inferSharedResultKind(toolName),
                payload,
                summary: buildSharedResultSummary(toolName, payload),
                sourceQuery: params.query,
                timeRange: resolvePrimaryTimeRange(params),
                indexName: params.index_name,
                upstreamSid: extractSidFromPayload(payload),
                ttlSeconds: Number(params.result_ttl_seconds)
            }, sharedResultStoreConfig);

            return formatImmediateSuccess(buildSharedResourceResponse(envelope), {
                ...params,
                include_raw_json: false
            });
        } catch (error: any) {
            return buildSharedStoreError(error, '请缩小时间范围、减少 fields，或降低 sample_size 后重试。');
        }
    }

    return formatImmediateSuccess(payload, params);
}

function formatImmediateSuccess(data: unknown, params: any = {}): any {
    return {
        content: [{
            type: 'text',
            text: formatSuccessPayload(data, {
                outputFormat: params.output_format,
                includeRawJson: params.include_raw_json
            })
        }]
    };
}

function shouldPersistAsSharedResource(payload: unknown, params: any): boolean {
    if (params.result_delivery === 'inline') {
        return false;
    }
    if (params.result_delivery === 'resource') {
        return true;
    }

    const toolName = String(params?.__tool_name || '');
    const deliveryPolicy = String(params?.delivery_policy || '');
    if (toolName === 'log_search_sheet' && deliveryPolicy !== 'bytes') {
        const requestedSize = Number(params?.size ?? params?.limit ?? 20);
        if (Number.isFinite(requestedSize) && requestedSize > 20) {
            return true;
        }
    }

    const serializedPayload = params.include_raw_json
        ? { data: payload, raw_json: payload }
        : payload;
    const bytes = Buffer.byteLength(JSON.stringify(serializedPayload ?? null), 'utf8');
    return bytes > sharedResultStoreConfig.inlineMaxBytes;
}

function buildSharedResourceResponse(envelope: SharedResultEnvelope): Record<string, unknown> {
    return {
        delivery: 'resource',
        resource_uri: envelope.resource_uri,
        resource_title: envelope.resource_title,
        resource_type: envelope.resource_type,
        resource_mime_type: envelope.resource_mime_type,
        tool_name: envelope.tool_name,
        result_kind: envelope.result_kind,
        created_at: envelope.created_at,
        expires_at: envelope.expires_at,
        payload_bytes: envelope.payload_bytes,
        upstream_sid: envelope.upstream_sid,
        summary: envelope.summary
    };
}

function getSharedResultReference(
    params: any,
    keys: string[]
): string | undefined {
    for (const key of keys) {
        const value = params?.[key];
        if (typeof value === 'string' && value.trim()) {
            return value.trim();
        }
    }
    return undefined;
}

function inferSharedResultKind(toolName: string): SharedResultKind {
    switch (toolName) {
        case 'log_search_sheet':
            return 'rows';
        case 'query_precheck':
            return 'precheck';
        case 'log_reduce_pattern':
        case 'log_reduce_preview':
            return 'patterns';
        case 'trend_summary':
        case 'anomaly_points':
        case 'trend_forecast':
        case 'anomaly_alert':
        case 'period_compare':
            return 'timeseries';
        case 'data_overview':
        case 'list_fields':
        case 'list_field_values':
            return 'stats';
        case 'correlation_analysis':
        case 'root_cause_suggestions':
            return 'analysis';
        default:
            return 'generic';
    }
}

function buildSharedResultSummary(toolName: string, payload: any): SharedResultSummary {
    switch (toolName) {
        case 'log_search_sheet': {
            const hits = Array.isArray(payload?.hits) ? payload.hits : [];
            const previewFields = hits[0] ? Object.keys(hits[0]).slice(0, 8) : [];
            return {
                title: '日志明细已转为共享资源',
                text: `共命中 ${Number(payload?.total ?? hits.length)} 条，本页返回 ${Number(payload?.returned ?? hits.length)} 条。`,
                key_metrics: {
                    total: Number(payload?.total ?? hits.length),
                    returned: Number(payload?.returned ?? hits.length),
                    page: Number(payload?.page ?? 0),
                    size: Number(payload?.size ?? hits.length),
                    has_more: Boolean(payload?.has_more)
                },
                preview_fields: previewFields
            };
        }
        case 'query_precheck':
            return {
                title: '预检结果已转为共享资源',
                text: `has_data=${String(payload?.has_data)}，样例行 ${Number(payload?.data_check?.sample_hit_count ?? 0)} 条。`,
                key_metrics: {
                    has_data: payload?.has_data ?? null,
                    total_hits: Number(payload?.data_check?.total_hits ?? 0),
                    sample_hit_count: Number(payload?.data_check?.sample_hit_count ?? 0),
                    available_fields_count: Array.isArray(payload?.available_fields) ? payload.available_fields.length : 0,
                    missing_fields_count: Array.isArray(payload?.missing_fields) ? payload.missing_fields.length : 0
                },
                preview_fields: Array.isArray(payload?.available_fields) ? payload.available_fields.slice(0, 8) : []
            };
        case 'log_reduce_pattern':
        case 'log_reduce_preview':
            return {
                title: '聚类结果已转为共享资源',
                text: `聚类 sid=${extractSidFromPayload(payload) || 'unknown'}，总命中 ${Number(payload?.total_hits ?? payload?.result?.total_hits ?? 0)}。`,
                key_metrics: {
                    total_hits: Number(payload?.total_hits ?? payload?.result?.total_hits ?? 0),
                    pattern_count: Array.isArray(payload?.result)
                        ? payload.result.length
                        : Array.isArray(payload?.result?.body)
                            ? payload.result.body.length
                            : 0
                }
            };
        case 'trend_summary':
        case 'anomaly_points':
        case 'trend_forecast':
        case 'anomaly_alert':
            return {
                title: '时间序列结果已转为共享资源',
                text: `时间序列点数 ${extractTimeSeriesFromPayload(payload).length}。`,
                key_metrics: {
                    series_points: extractTimeSeriesFromPayload(payload).length,
                    anomaly_count: Array.isArray(payload?.anomalies) ? payload.anomalies.length : 0,
                    forecast_points: Array.isArray(payload?.forecast) ? payload.forecast.length : 0,
                    alert_triggered: Boolean(payload?.alert_triggered)
                }
            };
        case 'period_compare':
            return {
                title: '时间序列对比结果已转为共享资源',
                text: `窗口A点数 ${extractTimeSeriesFromPayload(payload?.period_a).length}，窗口B点数 ${extractTimeSeriesFromPayload(payload?.period_b).length}。`,
                key_metrics: {
                    period_a_points: extractTimeSeriesFromPayload(payload?.period_a).length,
                    period_b_points: extractTimeSeriesFromPayload(payload?.period_b).length,
                    total_change: Number(payload?.differences?.total_change ?? 0)
                }
            };
        case 'correlation_analysis':
        case 'root_cause_suggestions':
            return {
                title: '分析结果已转为共享资源',
                text: String(payload?.summary || '分析结果较大，已转为共享资源。'),
                key_metrics: {
                    result_count: Array.isArray(payload?.results)
                        ? payload.results.length
                        : Array.isArray(payload?.distribution_drift)
                            ? payload.distribution_drift.length
                            : 0
                }
            };
        default:
            return {
                title: '结果已转为共享资源',
                text: '该结果体积较大，已落盘为共享资源，可按需读取。',
                key_metrics: {}
            };
    }
}

function resolvePrimaryTimeRange(params: any): string | undefined {
    return params.time_range || params.anomaly_window || params.time_range_a;
}

function extractSidFromPayload(payload: any): string | undefined {
    if (typeof payload?.sid === 'string' && payload.sid) {
        return payload.sid;
    }
    if (typeof payload?.raw_json?.sid === 'string' && payload.raw_json.sid) {
        return payload.raw_json.sid;
    }
    return undefined;
}

function extractRowsFromPayload(payload: any): Array<Record<string, any>> {
    if (Array.isArray(payload)) {
        return payload.filter((item): item is Record<string, any> => Boolean(item) && typeof item === 'object');
    }
    if (Array.isArray(payload?.hits)) {
        return payload.hits;
    }
    if (Array.isArray(payload?.sample_rows)) {
        return payload.sample_rows;
    }
    if (Array.isArray(payload?.data_check?.sample_rows)) {
        return payload.data_check.sample_rows;
    }
    return [];
}

function extractTimeSeriesFromPayload(payload: any): Array<Record<string, any>> {
    if (Array.isArray(payload?.series)) {
        return payload.series;
    }
    if (Array.isArray(payload?.points)) {
        return payload.points;
    }
    if (Array.isArray(payload?.data?.series)) {
        return payload.data.series;
    }
    if (Array.isArray(payload?.data?.points)) {
        return payload.data.points;
    }
    if (Array.isArray(payload?.source_series)) {
        return payload.source_series;
    }
    if (Array.isArray(payload?.period_a?.series) && Array.isArray(payload?.period_b?.series)) {
        return [];
    }
    if (Array.isArray(payload?.timestamps) && Array.isArray(payload?.values)) {
        return payload.timestamps.map((timestamp: string, index: number) => ({
            timestamp,
            value: Number(payload.values[index] ?? 0),
            count: Number(payload.values[index] ?? 0)
        }));
    }
    return [];
}

function buildSharedResultReadResponse(
    envelope: SharedResultEnvelope,
    options: {
        view: SharedResultReadView;
        offset: number;
        limit: number;
        fields: string[];
    }
): Record<string, unknown> {
    const metadata = {
        handle: envelope.handle,
        resource_uri: envelope.resource_uri,
        resource_title: envelope.resource_title,
        resource_type: envelope.resource_type,
        resource_mime_type: envelope.resource_mime_type,
        tool_name: envelope.tool_name,
        result_kind: envelope.result_kind,
        created_at: envelope.created_at,
        expires_at: envelope.expires_at,
        payload_bytes: envelope.payload_bytes,
        upstream_sid: envelope.upstream_sid,
        source_query: envelope.source_query,
        time_range: envelope.time_range,
        index_name: envelope.index_name,
        summary: envelope.summary
    };

    if (options.view === 'summary') {
        return metadata;
    }

    if (options.view === 'full') {
        return {
            ...metadata,
            payload: envelope.payload
        };
    }

    return {
        ...metadata,
        sample: buildSamplePayload(envelope.payload, options.offset, options.limit, options.fields)
    };
}

function buildSamplePayload(payload: any, offset: number, limit: number, fields: string[]): unknown {
    if (Array.isArray(payload)) {
        return projectRows(payload.slice(offset, offset + limit), fields);
    }

    if (Array.isArray(payload?.hits)) {
        return {
            ...payload,
            hits: projectRows(payload.hits.slice(offset, offset + limit), fields),
            returned: Math.min(limit, Math.max(0, payload.hits.length - offset))
        };
    }

    if (Array.isArray(payload?.data_check?.sample_rows)) {
        return {
            ...payload,
            data_check: {
                ...payload.data_check,
                sample_rows: projectRows(payload.data_check.sample_rows.slice(offset, offset + limit), fields),
                sample_hit_count: Math.min(limit, Math.max(0, payload.data_check.sample_rows.length - offset))
            }
        };
    }

    if (Array.isArray(payload?.result)) {
        return {
            ...payload,
            result: payload.result.slice(offset, offset + limit)
        };
    }

    if (Array.isArray(payload?.result?.body)) {
        return {
            ...payload,
            result: {
                ...payload.result,
                body: payload.result.body.slice(offset, offset + limit)
            }
        };
    }

    if (Array.isArray(payload?.series)) {
        return {
            ...payload,
            series: payload.series.slice(offset, offset + limit)
        };
    }

    return {
        note: '当前 payload 不支持 sample 视图，请改用 summary 或 full。',
        payload_kind: typeof payload
    };
}

function projectRows(rows: Array<Record<string, any>>, fields: string[]): Array<Record<string, any>> {
    if (!Array.isArray(fields) || fields.length === 0) {
        return rows;
    }

    return rows.map((row) => {
        const projected: Record<string, any> = {};
        fields.forEach((field) => {
            if (Object.prototype.hasOwnProperty.call(row, field)) {
                projected[field] = row[field];
            }
        });
        return projected;
    });
}

function buildSharedResourceDescription(envelope: SharedResultEnvelope): string {
    return [
        `type=${envelope.resource_type}`,
        `tool=${envelope.tool_name}`,
        `expires_at=${envelope.expires_at}`,
        envelope.summary.text
    ].filter(Boolean).join(' | ');
}

function buildSharedStoreError(error: any, suggestion: string): any {
    if (error instanceof SharedResultStoreError) {
        return buildToolError(error.code, error.message, getSharedStoreSuggestion(error, suggestion));
    }
    return buildToolError(
        'SHARED_RESULT_ERROR',
        error?.message || '共享结果处理失败。',
        suggestion
    );
}

function getSharedStoreSuggestion(error: SharedResultStoreError, fallback: string): string {
    switch (error.code) {
        case 'INVALID_RESOURCE_URI':
            return '请传入合法的 resource_uri，格式应为 `logease://shared-result/<handle>`。';
        case 'HANDLE_NOT_FOUND':
            return '资源不存在。请确认它没有被删除，并且该 resource_uri 来自当前环境。';
        case 'HANDLE_EXPIRED':
            return '资源已过期。请重新执行源工具，使用新生成的 resource_uri。';
        default:
            return fallback;
    }
}

function toMcpResourceError(error: unknown): McpError {
    if (error instanceof SharedResultStoreError) {
        return new McpError(ErrorCode.InvalidParams, error.message, {
            code: error.code
        });
    }

    return new McpError(ErrorCode.InternalError, '读取共享资源失败。', {
        message: error instanceof Error ? error.message : String(error)
    });
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
