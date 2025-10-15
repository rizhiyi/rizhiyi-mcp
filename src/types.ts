// 基础接口定义
export interface LogReduceParams {
    query: string;
    time_range: string;
    index_name?: string;
    pattern_options?: {
        initial_dist?: string;
        alpha?: string;
        multi_align_threshold?: string;
        pattern_discover_align_threshold?: string;
        find_cluster_align_threshold?: string;
        stop_threshold?: string;
    };
}

export interface ApiResponse<T> {
    status?: number;
    data?: T;
    error?: string;
    details?: any;
    progress?: any;
    message?: string;
}

export interface LogSearchResponse {
    hits?: Array<{
        [key: string]: any;
    }>;
    total?: number;
}

export interface LogReduceResponse {
    sid?: string;
    job_status?: string;
    tree_layer?: {
        clusters?: Array<{
            pattern_string: string;
            count: number;
        }>;
    };
    result?: {
        level?: number;
        max_level?: number;
        total_hits?: number;
        body?: Array<{
            pattern_string: string;
            count: number;
        }>;
    };
}

export interface FieldsListResponse {
    fields?: Array<{
        name: string;
        type: string;
        distinct_count?: number;
        total?: number;
        top_values?: Array<{
            value: string;
            count: number;
        }>;
    }>;
    total?: number;
}

export interface FieldValuesListResponse {
    values?: Array<{
        value: string;
        count: number;
    }>;
    field?: string;
    total?: number;
}

// 时间序列相关接口
export interface TimeSeriesPoint {
    timestamp: string;
    value: number;
    count?: number;
}

export interface TrendAnalysisResult {
    series: TimeSeriesPoint[];
    slope: number;
    intercept: number;
    changeRate: number;
    peaks: Array<{index: number, value: number}>;
    anomalies: Array<{index: number, value: number, threshold: number, reason: string}>;
    summary: string;
}

// 预测分析接口
export interface ForecastResult {
    forecast: number[];
    confidence_lower: number[];
    confidence_upper: number[];
    trend: string;
    r_squared?: number;
    method: string;
}

// 异常检测接口
export interface AnomalyDetectionResult {
    anomalies: Array<{
        index: number;
        value: number;
        threshold: number;
        reason: string;
    }>;
    method: string;
    threshold: number;
}

// 关联分析接口
export interface CorrelationResult {
    correlations: Array<{
        field1: string;
        field2: string;
        correlation: number;
        method: string;
        significance?: number;
    }>;
    cooccurrence?: Array<{
        field1: string;
        field2: string;
        cooccurrence: number;
        support: number;
    }>;
}

// 对比分析接口
export interface PeriodComparisonResult {
    period_a: {
        total: number;
        avg: number;
        max: number;
        min: number;
        series: TimeSeriesPoint[];
    };
    period_b: {
        total: number;
        avg: number;
        max: number;
        min: number;
        series: TimeSeriesPoint[];
    };
    differences: {
        total_change: number;
        avg_change: number;
        max_change: number;
        min_change: number;
    };
    field_differences?: Array<{
        field: string;
        value: string;
        count_a: number;
        count_b: number;
        change: number;
        jsd: number;
    }>;
}

// 根因分析接口
export interface RootCauseAnalysisResult {
    suggestions: Array<{
        field: string;
        hypothesis: string;
        top_changes: Array<{
            value: string;
            baseline_count: number;
            anomaly_count: number;
            change_ratio: number;
        }>;
    }>;
    suggested_queries: string[];
    summary: string;
}

// 工具定义接口
export interface ToolDefinition {
    name: string;
    description: string;
    inputSchema: {
        type: string;
        properties: Record<string, any>;
        required?: string[];
    };
}

// 配置接口
export interface HttpClientConfig {
    baseURL: string;
    headers: Record<string, string>;
    httpsAgent?: any;
}

// 通用查询参数
export interface BaseQueryParams {
    query?: string;
    time_range: string;
    index_name?: string;
    limit?: number;
}

// 时间序列查询参数
export interface TimeSeriesQueryParams extends BaseQueryParams {
    bucket?: string;
    metric_field?: string;
}

// 聚类分析参数
export interface PatternClassificationParams extends BaseQueryParams {
    pattern_options?: LogReduceParams['pattern_options'];
}