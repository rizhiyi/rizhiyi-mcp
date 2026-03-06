import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import https from 'https';
import dotenv from 'dotenv';
import type { HttpClientConfig } from './types.js';

import { LogEaseClient } from './client.js';
import { allTools } from './tools.js';
import { LogSearchModule } from './modules/log-search.js';
import { StatisticsModule } from './modules/statistics.js';
import { TrendForecastModule } from './modules/trend-forecast.js';
import { AnomalyDetectionModule } from './modules/anomaly-detection.js';

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

// 创建MCP服务器
const server = new Server(
    {
        name: 'logease-mcp-server',
        version: '1.0.0',
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
                return {
                    isError: true,
                    content: [{
                        type: 'text',
                        text: `未知的工具: ${name}`
                    }]
                };
        }
    } catch (error: any) {
        return {
            isError: true,
            content: [{
                type: 'text',
                text: `执行工具出错: ${error.message}`
            }]
        };
    }
});

/**
 * 处理工具列表请求
 */
server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
        tools: allTools,
    };
});

// 工具处理函数
async function handleLogSearchSheet(params: any) {
    const result = await logSearchModule.executeLogSearchSheet(
        params.query || "*",
        params.time_range,
        params.index_name || "yotta",
        params.limit || 100
    );
    return formatResult(result);
}

async function handleLogReducePattern(params: any) {
    const result = await logSearchModule.executeLogReducePattern(
        params.query || "*",
        params.time_range,
        params.index_name || "yotta",
        params.pattern_options || {}
    );
    return formatResult(result);
}

async function handleLogReducePreview(params: any) {
    const result = await logSearchModule.executeLogReducePreview(
        params.sid,
        params.max_retries || 10,
        params.retry_interval || 5000
    );
    return formatResult(result);
}

async function handleListFields(params: any) {
    const result = await logSearchModule.executeListFields(
        params.query || "*",
        params.time_range,
        params.index_name || "yotta"
    );
    return formatResult(result);
}

async function handleListFieldValues(params: any) {
    const result = await logSearchModule.executeListFieldValues(
        params.field,
        params.query || "*",
        params.time_range,
        params.index_name || "yotta",
        params.limit || 100
    );
    return formatResult(result);
}

async function handleDataOverview(params: any) {
    const result = await statisticsModule.executeDataOverview(
        params.query || "*",
        params.time_range,
        params.index_name || "yotta",
        params.metric_field,
        params.percentiles || [50, 90, 99]
    );
    return formatResult(result);
}

async function handleTrendSummary(params: any) {
    const result = await statisticsModule.executeTrendSummary(
        params.query || "*",
        params.time_range,
        params.index_name || "yotta",
        params.bucket,
        params.metric_field,
        params.limit_peaks || 3
    );
    return formatResult(result);
}

async function handleAnomalyPoints(params: any) {
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
    return formatResult(result);
}

async function handlePatternClassification(params: any) {
    // 如果提供了前一个tool的结果数据，直接使用它进行分析
    if (params.previous_result) {
        const result = await anomalyDetectionModule.executePatternClassification(
            params.previous_result,
            params.limit || 20
        );
        return formatResult(result);
    }
    
    // 否则执行完整的聚类分析流程
    if (!params.query || !params.time_range) {
        return {
            isError: true,
            content: [{
                type: 'text',
                text: '必须提供 previous_result 或者同时提供 query 和 time_range 参数'
            }]
        };
    }
    
    const result = await anomalyDetectionModule.executePatternClassification({
        query: params.query || "*",
        time_range: params.time_range,
        index_name: params.index_name || "yotta",
        pattern_options: params.pattern_options || {},
        limit: params.limit || 20
    });
    return formatResult(result);
}

async function handlePeriodCompare(params: any) {
    // 如果提供了之前的时间序列数据，直接构建数据对象进行分析
    if (params.previous_time_series_a || params.previous_time_series_b) {
        if (!params.previous_time_series_a || !params.previous_time_series_b) {
            return {
                isError: true,
                content: [{
                    type: 'text',
                    text: '必须同时提供 previous_time_series_a 和 previous_time_series_b 参数'
                }]
            };
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
        return formatResult(result);
    }
    
    // 否则执行完整的数据获取流程
    if (!params.time_range_a || !params.time_range_b) {
        return {
            isError: true,
            content: [{
                type: 'text',
                text: '必须提供 previous_time_series 或者 time_range_a 和 time_range_b 参数'
            }]
        };
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
    return formatResult(result);
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
    return formatResult(result);
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
    return formatResult(result);
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
    return formatResult(result);
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
    return formatResult(result);
}

/**
 * 格式化结果
 */
function formatResult(result: any): any {
    if (result.error) {
        return {
            isError: true,
            content: [{
                type: 'text',
                text: result.message || result.error
            }]
        };
    }

    return {
        content: [{
            type: 'text',
            text: JSON.stringify(result.data || result, null, 2)
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