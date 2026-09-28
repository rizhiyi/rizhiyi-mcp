import { LogEaseClient } from '../client.js';
import { ApiResponse, TrendAnalysisResult, AnomalyDetectionResult, TimeSeriesPoint } from '../types.js';
import { analyzeTimeline, detectStatisticalAnomalies } from './series-analysis.js';
import { TimechartQueryModule } from './timechart-query.js';
import { ANALYSIS_CONSTANTS, resolveMovingAverageWindow, zValueForConfidence } from './analysis-constants.js';
import {
    chooseBucket as chooseTimeBucket,
    parseDurationMs as parseTimeRangeDurationMs,
    parseTimeString as parseTimeValue
} from './time-utils.js';

/**
 * 按 Python `f"{value}"` 的浮点输出习惯格式化数字（整数值补 `.0`）。
 *
 * 异常原因文本里的阈值由两端各自拼接，若格式化不一致会产生肉眼可见的输出漂移，
 * 因此这里刻意对齐 Python 的 `str(float)` 表现。
 */
export function formatPythonFloat(value: number): string {
    if (!Number.isFinite(value)) {
        return String(value);
    }
    return Number.isInteger(value) ? value.toFixed(1) : String(value);
}

const FIXED_FORMATTERS = new Map<number, Intl.NumberFormat>();

/**
 * 按 Python `f"{value:.Nf}"` 的语义格式化定点小数。
 *
 * JS 的 `toFixed` 使用"四舍五入（远离零）"，而 Python 使用"四舍六入五成双"
 * （round-half-to-even）。当数值恰好落在中点时两者结果不同，例如
 * `13.625` → TS `13.63` / Python `13.62`，会直接体现在趋势摘要文本里。
 * 这里用 `Intl.NumberFormat` 的 `roundingMode: 'halfEven'` 复刻 Python 行为。
 */
export function formatFixed(value: number, digits: number): string {
    if (!Number.isFinite(value)) {
        return String(value);
    }
    let formatter = FIXED_FORMATTERS.get(digits);
    if (!formatter) {
        formatter = new Intl.NumberFormat('en-US', {
            minimumFractionDigits: digits,
            maximumFractionDigits: digits,
            useGrouping: false,
            roundingMode: 'halfEven'
        });
        FIXED_FORMATTERS.set(digits, formatter);
    }
    return formatter.format(value);
}

export class StatisticsModule {
    private timechartQuery: TimechartQueryModule;
    constructor(private client: LogEaseClient) {
        this.timechartQuery = new TimechartQueryModule(client);
    }

    /**
     * 解析时间范围字符串为毫秒
     */
    parseDurationMs(timeRange: string): number {
        return parseTimeRangeDurationMs(timeRange);
    }

    /**
     * 解析时间字符串
     */
    parseTimeString(timeStr: string): number {
        return parseTimeValue(timeStr);
    }

    /**
     * 选择合适的时间桶
     */
    chooseBucket(durationMs: number): { bin: string; seconds: number } {
        return chooseTimeBucket(durationMs);
    }

    /**
     * 计算平均值
     */
    mean(arr: number[]): number {
        return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
    }

    /**
     * 计算标准差
     */
    stddev(arr: number[]): number {
        if (arr.length === 0) return 0;
        const avg = this.mean(arr);
        const squareDiffs = arr.map(value => Math.pow(value - avg, 2));
        return Math.sqrt(this.mean(squareDiffs));
    }

    /**
     * 安全除法：分母接近 0 时返回 0，避免 NaN / Infinity 泄漏到结果里。
     * 与 Python `LogToolsBusinessService._safe_divide` 保持一致。
     */
    safeDivide(numerator: number, denominator: number): number {
        if (Math.abs(denominator) <= 1e-9) return 0;
        return numerator / denominator;
    }

    /**
     * 计算线性回归
     */
    linearRegression(y: number[]): { slope: number; intercept: number } {
        const n = y.length;
        if (n === 0) return { slope: 0, intercept: 0 };
        
        const x = Array.from({ length: n }, (_, i) => i);
        const sumX = x.reduce((a, b) => a + b, 0);
        const sumY = y.reduce((a, b) => a + b, 0);
        const sumXY = x.reduce((sum, xi, i) => sum + xi * y[i], 0);
        const sumXX = x.reduce((sum, xi) => sum + xi * xi, 0);
        
        const denominator = n * sumXX - sumX * sumX;
        if (denominator === 0) return { slope: 0, intercept: sumY / n };
        
        const slope = (n * sumXY - sumX * sumY) / denominator;
        const intercept = (sumY - slope * sumX) / n;
        
        return { slope, intercept };
    }

    /**
     * 提取数据行
     */
    extractRows(data: any): any[] {
        if (Array.isArray(data)) return data;
        if (data?.results) return data.results;
        if (data?.data) return this.extractRows(data.data);
        if (data?.hits) return data.hits;
        return [];
    }

    buildTimelineFromSeries(series: TimeSeriesPoint[]) {
        if (!Array.isArray(series) || series.length === 0) {
            return undefined;
        }

        const timestamps = series.map((point) => Number(point.timestamp));
        const fallbackInterval = timestamps.length > 1 ? Math.max(timestamps[1] - timestamps[0], 0) : 0;

        return {
            start_ts: Number.isFinite(timestamps[0]) ? timestamps[0] : undefined,
            end_ts: Number.isFinite(timestamps[timestamps.length - 1]) ? timestamps[timestamps.length - 1] : undefined,
            interval: fallbackInterval || undefined,
            rows: series.map((point, index) => {
                const startTs = Number(point.timestamp);
                const nextTs = index < series.length - 1 ? Number(series[index + 1].timestamp) : startTs + fallbackInterval;
                return {
                    start_ts: Number.isFinite(startTs) ? startTs : index,
                    end_ts: Number.isFinite(nextTs) ? nextTs : index + 1,
                    count: point.value
                };
            })
        };
    }

    /**
     * 计算百分位数
     */
    percentile(arr: number[], p: number): number {
        if (arr.length === 0) return 0;
        const sorted = [...arr].sort((a, b) => a - b);
        const index = Math.ceil(sorted.length * p / 100) - 1;
        return sorted[Math.max(0, Math.min(index, sorted.length - 1))];
    }

    /**
     * 检测峰值
     */
    detectPeaks(series: number[], limit: number = 3): Array<{index: number, value: number}> {
        const peaks: Array<{index: number, value: number}> = [];
        const threshold = this.mean(series) + 2 * this.stddev(series);
        
        for (let i = 1; i < series.length - 1; i++) {
            const prev = series[i - 1];
            const curr = series[i];
            const next = series[i + 1];
            
            if (curr > prev && curr > next && curr > threshold) {
                peaks.push({ index: i, value: curr });
            }
        }
        
        return peaks.sort((a, b) => b.value - a.value).slice(0, Math.max(1, limit));
    }

    /**
     * 使用IQR方法检测异常
     */
    detectAnomaliesIQR(series: number[], sensitivity: number = 1.5): Array<{index: number, value: number, threshold: number, reason: string}> {
        const anomalies: Array<{index: number, value: number, threshold: number, reason: string}> = [];
        
        if (series.length === 0) return anomalies;
        
        const sorted = [...series].sort((a, b) => a - b);
        const q1 = this.percentile(sorted, 25);
        const q3 = this.percentile(sorted, 75);
        const iqr = q3 - q1;
        
        const lowerBound = q1 - sensitivity * iqr;
        const upperBound = q3 + sensitivity * iqr;
        
        series.forEach((value, index) => {
            if (value < lowerBound) {
                anomalies.push({
                    index,
                    value,
                    threshold: lowerBound,
                    reason: `值 ${formatPythonFloat(value)} 小于下界 ${formatFixed(lowerBound, 2)}`
                });
            } else if (value > upperBound) {
                anomalies.push({
                    index,
                    value,
                    threshold: upperBound,
                    reason: `值 ${formatPythonFloat(value)} 大于上界 ${formatFixed(upperBound, 2)}`
                });
            }
        });
        
        return anomalies;
    }

    /**
     * 使用Z-score方法检测异常
     */
    detectAnomaliesZScore(series: number[], threshold: number = 3): Array<{index: number, value: number, threshold: number, reason: string}> {
        return detectStatisticalAnomalies(series, threshold).map((anomaly) => ({
            index: anomaly.index,
            value: anomaly.value,
            threshold: anomaly.z_score,
            reason: `Z-score ${formatFixed(anomaly.z_score, 2)} 超过阈值 ${formatPythonFloat(threshold)}`
        }));
    }

    /**
     * 生成趋势总结
     */
    generateTrendSummary(series: number[], slope: number, changeRate: number): string {
        const avg = this.mean(series);
        const max = Math.max(...series);
        const min = Math.min(...series);

        let summary = `时间序列分析结果：平均值=${formatFixed(avg, 2)}，最大值=${formatFixed(max, 2)}，最小值=${formatFixed(min, 2)}。`;

        if (Math.abs(changeRate) < 0.05) {
            summary += '整体趋势平稳，';
        } else if (changeRate > 0) {
            summary += `整体呈上升趋势，变化率 ${formatFixed(changeRate * 100, 1)}%，`;
        } else {
            summary += `整体呈下降趋势，变化率 ${formatFixed(changeRate * 100, 1)}%，`;
        }

        if (Math.abs(slope) > 0.1) {
            summary += `斜率为 ${formatFixed(slope, 3)}，表明趋势较为明显。`;
        } else {
            summary += '斜率较小，趋势变化缓慢。';
        }

        return summary;
    }

    normalizeTimeSeriesInput(input: any): TimeSeriesPoint[] {
        if (Array.isArray(input)) {
            return input
                .filter((item): item is Record<string, any> => Boolean(item) && typeof item === 'object')
                .map((item) => ({
                    timestamp: String(item.timestamp ?? item.time ?? item._timestamp ?? ''),
                    value: Number(item.value ?? item.count ?? item.cnt ?? 0),
                    count: Number(item.count ?? item.value ?? item.cnt ?? 0)
                }))
                .filter((item) => item.timestamp);
        }

        const series = input?.series || input?.data?.series || input?.points || input?.data?.points;
        if (Array.isArray(series)) {
            return this.normalizeTimeSeriesInput(series);
        }

        if (Array.isArray(input?.timestamps) && Array.isArray(input?.values)) {
            return input.timestamps.map((timestamp: string, index: number) => {
                const value = Number(input.values[index] ?? 0);
                return {
                    timestamp: String(timestamp),
                    value,
                    count: value
                };
            });
        }

        return [];
    }

    private buildTrendSummaryResult(
        series: TimeSeriesPoint[],
        limitPeaks: number,
        status: number = 200,
        message: string = '趋势分析完成'
    ): ApiResponse<TrendAnalysisResult> {
        if (series.length === 0) {
            return {
                error: '无数据',
                message: '未找到符合条件的时间序列数据'
            };
        }

        const values = series.map(point => point.value);
        const { slope, intercept } = this.linearRegression(values);
        // values[0] 接近 0 时不做除法，避免 NaN/Infinity 泄漏到 changeRate 与摘要文本
        const changeRate = values.length > 1 && Math.abs(values[0]) > 1e-9
            ? (values[values.length - 1] - values[0]) / values[0]
            : 0;
        const peaks = this.detectPeaks(values, limitPeaks).map((peak) => ({
            index: peak.index,
            value: peak.value,
            timestamp: series[peak.index]?.timestamp
        }));
        const timeline = this.buildTimelineFromSeries(series);
        const seriesAnalysis = analyzeTimeline(timeline);
        const anomalies = seriesAnalysis.statistical_anomalies.map((anomaly) => ({
            index: anomaly.index,
            value: anomaly.value,
            threshold: anomaly.z_score,
            reason: `Z-score ${formatFixed(anomaly.z_score, 2)} 超过阈值 ${formatPythonFloat(ANALYSIS_CONSTANTS.zScoreDefaultThreshold)}`,
            timestamp: series[anomaly.index]?.timestamp
        }));
        const summary = this.generateTrendSummary(values, slope, changeRate);

        return {
            status,
            data: {
                series,
                slope,
                intercept,
                changeRate,
                peaks,
                anomalies,
                summary
            },
            message
        };
    }

    private buildAnomalyPointsResult(
        series: TimeSeriesPoint[],
        method: string,
        sensitivity: number,
        minSupport: number,
        status: number = 200,
        message: string = '异常检测完成'
    ): ApiResponse<AnomalyDetectionResult> {
        if (series.length === 0) {
            return {
                error: '无数据',
                message: '未找到符合条件的时间序列数据'
            };
        }

        const values = series.map(point => point.value);
        let anomalies: Array<{index: number, value: number, threshold: number, reason: string}> = [];

        if (method === 'iqr') {
            anomalies = this.detectAnomaliesIQR(values, sensitivity);
        } else {
            anomalies = detectStatisticalAnomalies(values, sensitivity).map((anomaly) => ({
                index: anomaly.index,
                value: anomaly.value,
                threshold: anomaly.z_score,
                reason: `Z-score ${formatFixed(anomaly.z_score, 2)} 超过阈值 ${formatPythonFloat(sensitivity)}`
            }));
        }

        if (minSupport > 0) {
            anomalies = anomalies.filter(item => item.value >= minSupport);
        }

        return {
            status,
            data: {
                anomalies: anomalies.map((item) => ({
                    ...item,
                    timestamp: series[item.index]?.timestamp
                })),
                method,
                threshold: sensitivity,
                series
            },
            message
        };
    }

    async executeTrendSummaryWithData(
        reusedTimeSeries: any,
        limitPeaks: number = 3
    ): Promise<ApiResponse<TrendAnalysisResult>> {
        try {
            const series = this.normalizeTimeSeriesInput(reusedTimeSeries);
            return this.buildTrendSummaryResult(series, limitPeaks, 200, '趋势分析完成（数据复用）');
        } catch (error: any) {
            return {
                error: error.message,
                message: `执行趋势分析出错: ${error.message}`
            };
        }
    }

    async executeAnomalyPointsWithData(
        reusedTimeSeries: any,
        method: string = 'zscore',
        sensitivity: number = 3,
        minSupport: number = 0
    ): Promise<ApiResponse<AnomalyDetectionResult>> {
        try {
            const series = this.normalizeTimeSeriesInput(reusedTimeSeries);
            return this.buildAnomalyPointsResult(series, method, sensitivity, minSupport, 200, '异常检测完成（数据复用）');
        } catch (error: any) {
            return {
                error: error.message,
                message: `执行异常检测出错: ${error.message}`
            };
        }
    }

    /**
     * 获取趋势分析
     */
    async executeTrendSummary(
        query: string,
        timeRange: string,
        bucket?: string,
        metricField?: string,
        limitPeaks: number = 3
    ): Promise<ApiResponse<TrendAnalysisResult>> {
        try {
            const result = await this.timechartQuery.execute({
                query,
                time_range: timeRange,
                bucket,
                metric_field: metricField
            });

            if (result.error) {
                return {
                    error: result.error,
                    message: result.message
                };
            }

            const series = result.data?.series || [];
            return this.buildTrendSummaryResult(series, limitPeaks, result.status, '趋势分析完成');
        } catch (error: any) {
            return {
                error: error.message,
                message: `执行趋势分析出错: ${error.message}`
            };
        }
    }

    /**
     * 执行异常点检测
     */
    async executeAnomalyPoints(
        query: string,
        timeRange: string,
        bucket?: string,
        metricField?: string,
        method: string = 'zscore',
        sensitivity: number = 3,
        minSupport: number = 0
    ): Promise<ApiResponse<AnomalyDetectionResult>> {
        try {
            const result = await this.timechartQuery.execute({
                query,
                time_range: timeRange,
                bucket,
                metric_field: metricField
            });

            if (result.error) {
                return {
                    error: result.error,
                    message: result.message
                };
            }

            const series = result.data?.series || [];
            return this.buildAnomalyPointsResult(series, method, sensitivity, minSupport, result.status, '异常检测完成');
        } catch (error: any) {
            return {
                error: error.message,
                message: `执行异常检测出错: ${error.message}`
            };
        }
    }

    /**
     * 计算数据概览
     */
    async executeDataOverview(
        query: string,
        timeRange: string,
        metricField?: string,
        percentiles: number[] = [50, 90, 99]
    ): Promise<ApiResponse<any>> {
        try {
            const apiPath = '/api/v3/search/overview/';
            const params = {
                query,
                time_range: timeRange,
                ...(metricField && { metric_field: metricField }),
                percentiles: percentiles.join(',')
            };

            const result = await this.client.get<any>(apiPath, params);
            
            if (result.error) {
                return result;
            }

            return {
                status: result.status,
                data: result.data,
                message: '数据概览获取成功'
            };
        } catch (error: any) {
            return {
                error: error.message,
                message: `获取数据概览出错: ${error.message}`
            };
        }
    }

    /**
     * 计算方差
     */
    variance(data: number[]): number {
        if (data.length === 0) return 0;
        const avg = this.mean(data);
        const squareDiffs = data.map(value => Math.pow(value - avg, 2));
        return this.mean(squareDiffs);
    }

    /**
     * 计算R平方
     */
    calculateRSquared(actual: number[], predicted: number[]): number {
        if (actual.length !== predicted.length || actual.length === 0) return 0;
        
        const actualMean = this.mean(actual);
        const totalSumSquares = actual.reduce((sum, val) => sum + Math.pow(val - actualMean, 2), 0);
        const residualSumSquares = actual.reduce((sum, val, i) => sum + Math.pow(val - predicted[i], 2), 0);
        
        return totalSumSquares === 0 ? 0 : 1 - (residualSumSquares / totalSumSquares);
    }

    /**
     * 获取排名
     */
    getRanks(data: number[]): number[] {
        const indexed = data.map((value, index) => ({ value, index }));
        indexed.sort((a, b) => a.value - b.value);
        
        const ranks = new Array(data.length);
        indexed.forEach((item, rank) => {
            ranks[item.index] = rank + 1;
        });
        
        return ranks;
    }

    /**
     * 计算相关系数
     */
    calculateCorrelation(x: number[], y: number[], spearman: boolean = false): number {
        if (x.length !== y.length || x.length === 0) return 0;
        
        if (spearman) {
            const ranksX = this.getRanks(x);
            const ranksY = this.getRanks(y);
            return this.calculateCorrelation(ranksX, ranksY, false);
        }
        
        const meanX = this.mean(x);
        const meanY = this.mean(y);
        
        let numerator = 0;
        let sumSquaresX = 0;
        let sumSquaresY = 0;
        
        for (let i = 0; i < x.length; i++) {
            const diffX = x[i] - meanX;
            const diffY = y[i] - meanY;
            numerator += diffX * diffY;
            sumSquaresX += diffX * diffX;
            sumSquaresY += diffY * diffY;
        }
        
        const denominator = Math.sqrt(sumSquaresX * sumSquaresY);
        return denominator === 0 ? 0 : numerator / denominator;
    }

    /**
     * 计算移动平均
     *
     * 窗口会收敛到 [minWindow, data.length]（见 config/analysis-constants.yaml），
     * 而不是在 window > data.length 时直接返回 0，与 Python 实现保持一致。
     */
    simpleMovingAverage(data: number[], window: number): { forecast: number, trend: string } {
        if (data.length === 0) {
            return { forecast: 0, trend: 'stable' };
        }

        const resolvedWindow = resolveMovingAverageWindow(window, data.length);
        const recent = data.slice(-resolvedWindow);
        const forecast = this.mean(recent);

        // 中点至少为 1，保证单元素窗口也能算出趋势而不是 0/0
        const midpoint = Math.max(1, Math.floor(recent.length / 2));
        const firstAvg = this.mean(recent.slice(0, midpoint));
        const secondAvg = this.mean(recent.slice(midpoint));

        const change = this.safeDivide(secondAvg - firstAvg, firstAvg);

        let trend = 'stable';
        if (change > 0.1) trend = 'increasing';
        else if (change < -0.1) trend = 'decreasing';

        return { forecast, trend };
    }

    /**
     * 指数平滑
     */
    exponentialSmoothing(data: number[], alpha: number = 0.3, horizon: number = 1): {
        forecast: number[];
        smoothed: number[];
        trend: string;
    } {
        const resolvedHorizon = Math.max(1, Math.floor(horizon) || 1);
        if (data.length === 0) {
            return { forecast: [], smoothed: [], trend: 'stable' };
        }

        const resolvedAlpha = Math.min(1, Math.max(0, Number.isFinite(alpha) ? alpha : 0.3));
        const smoothed: number[] = [];
        let s = data[0];

        for (let i = 0; i < data.length; i++) {
            s = resolvedAlpha * data[i] + (1 - resolvedAlpha) * s;
            smoothed.push(s);
        }

        const forecast: number[] = [];
        for (let i = 0; i < resolvedHorizon; i++) {
            forecast.push(s);
        }

        // 计算趋势：中点至少为 1，避免 slice(-0) 取到整个数组
        const midpoint = Math.max(1, Math.floor(smoothed.length / 2));
        const olderAvg = this.mean(smoothed.slice(0, midpoint));
        const recentAvg = this.mean(smoothed.slice(midpoint));

        const change = this.safeDivide(recentAvg - olderAvg, olderAvg);

        let trend = 'stable';
        if (change > 0.1) trend = 'increasing';
        else if (change < -0.1) trend = 'decreasing';

        return { forecast, smoothed, trend };
    }

    /**
     * 线性趋势预测
     */
    linearTrendForecast(data: number[], horizon: number, confidence: number = 0.95): {
        forecast: number[];
        confidence_lower: number[];
        confidence_upper: number[];
        trend: string;
        r_squared: number;
    } {
        const resolvedHorizon = Math.max(1, Math.floor(horizon) || 1);
        if (data.length === 0) {
            return {
                forecast: new Array(resolvedHorizon).fill(0),
                confidence_lower: new Array(resolvedHorizon).fill(0),
                confidence_upper: new Array(resolvedHorizon).fill(0),
                trend: 'stable',
                r_squared: 0
            };
        }

        const { slope, intercept } = this.linearRegression(data);
        const n = data.length;

        // 计算预测值
        const forecast: number[] = [];
        for (let i = 0; i < resolvedHorizon; i++) {
            const x = n + i;
            forecast.push(slope * x + intercept);
        }

        // 计算R²
        const predicted = data.map((_, i) => slope * i + intercept);
        const r_squared = this.calculateRSquared(data, predicted);

        // 计算残差标准差
        const residuals = data.map((actual, i) => actual - predicted[i]);
        const residualStdDev = this.stddev(residuals);

        // 计算置信区间：z 值按 confidence 取值（与 Python 共用同一张表）
        const z_value = zValueForConfidence(confidence);
        const margin = z_value * residualStdDev;
        const confidence_lower = forecast.map((value) => value - margin);
        const confidence_upper = forecast.map((value) => value + margin);

        // 确定趋势
        let trend = 'stable';
        if (slope > 0.1) trend = 'increasing';
        else if (slope < -0.1) trend = 'decreasing';

        return {
            forecast,
            confidence_lower,
            confidence_upper,
            trend,
            r_squared
        };
    }
}
