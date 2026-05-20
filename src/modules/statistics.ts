import { LogEaseClient } from '../client.js';
import { ApiResponse, TimeSeriesPoint, TrendAnalysisResult, AnomalyDetectionResult } from '../types.js';

export class StatisticsModule {
    constructor(private client: LogEaseClient) {}

    /**
     * 解析时间范围字符串为毫秒
     */
    parseDurationMs(timeRange: string): number {
        const parts = timeRange.split(',');
        if (parts.length !== 2) return 15 * 60 * 1000; // 默认15分钟
        
        const start = this.parseTimeString(parts[0]);
        const end = this.parseTimeString(parts[1]);
        return end - start;
    }

    /**
     * 解析时间字符串
     */
    parseTimeString(timeStr: string): number {
        const now = Date.now();
        
        if (timeStr === 'now') return now;
        
        const match = timeStr.match(/now-(\d+)([smhd])/);
        if (match) {
            const value = parseInt(match[1]);
            const unit = match[2];
            
            const multipliers = {
                's': 1000,
                'm': 60 * 1000,
                'h': 60 * 60 * 1000,
                'd': 24 * 60 * 60 * 1000
            };
            
            return now - (value * multipliers[unit as keyof typeof multipliers]);
        }
        
        return now;
    }

    /**
     * 选择合适的时间桶
     */
    chooseBucket(durationMs: number): { bin: string; seconds: number } {
        const seconds = Math.floor(durationMs / 1000);
        
        if (seconds <= 60) return { bin: '1s', seconds: 1 };
        if (seconds <= 300) return { bin: '5s', seconds: 5 };
        if (seconds <= 600) return { bin: '10s', seconds: 10 };
        if (seconds <= 1800) return { bin: '30s', seconds: 30 };
        if (seconds <= 3600) return { bin: '1m', seconds: 60 };
        if (seconds <= 7200) return { bin: '2m', seconds: 120 };
        if (seconds <= 18000) return { bin: '5m', seconds: 300 };
        if (seconds <= 36000) return { bin: '10m', seconds: 600 };
        if (seconds <= 86400) return { bin: '30m', seconds: 1800 };
        if (seconds <= 172800) return { bin: '1h', seconds: 3600 };
        if (seconds <= 604800) return { bin: '6h', seconds: 21600 };
        return { bin: '1d', seconds: 86400 };
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
        
        return peaks.sort((a, b) => b.value - a.value).slice(0, limit);
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
                    reason: `值 ${value} 小于下界 ${lowerBound.toFixed(2)}`
                });
            } else if (value > upperBound) {
                anomalies.push({
                    index,
                    value,
                    threshold: upperBound,
                    reason: `值 ${value} 大于上界 ${upperBound.toFixed(2)}`
                });
            }
        });
        
        return anomalies;
    }

    /**
     * 使用Z-score方法检测异常
     */
    detectAnomaliesZScore(series: number[], threshold: number = 3): Array<{index: number, value: number, threshold: number, reason: string}> {
        const anomalies: Array<{index: number, value: number, threshold: number, reason: string}> = [];
        
        if (series.length === 0) return anomalies;
        
        const mean = this.mean(series);
        const stddev = this.stddev(series);
        
        if (stddev === 0) return anomalies;
        
        series.forEach((value, index) => {
            const zScore = Math.abs((value - mean) / stddev);
            if (zScore > threshold) {
                anomalies.push({
                    index,
                    value,
                    threshold: zScore,
                    reason: `Z-score ${zScore.toFixed(2)} 超过阈值 ${threshold}`
                });
            }
        });
        
        return anomalies;
    }

    /**
     * 生成趋势总结
     */
    generateTrendSummary(series: number[], slope: number, changeRate: number): string {
        const avg = this.mean(series);
        const max = Math.max(...series);
        const min = Math.min(...series);
        
        let summary = `时间序列分析结果：平均值=${avg.toFixed(2)}, 最大值=${max.toFixed(2)}, 最小值=${min.toFixed(2)}。`;
        
        if (Math.abs(changeRate) < 0.05) {
            summary += '整体趋势平稳，';
        } else if (changeRate > 0) {
            summary += `整体呈上升趋势，变化率${(changeRate * 100).toFixed(1)}%，`;
        } else {
            summary += `整体呈下降趋势，变化率${(changeRate * 100).toFixed(1)}%，`;
        }
        
        if (Math.abs(slope) > 0.1) {
            summary += `斜率为${slope.toFixed(3)}，表明趋势较为明显。`;
        } else {
            summary += '斜率较小，趋势变化缓慢。';
        }
        
        return summary;
    }

    /**
     * 获取趋势分析
     */
    async executeTrendSummary(
        query: string,
        timeRange: string,
        indexName: string = "yotta",
        bucket?: string,
        metricField?: string,
        limitPeaks: number = 3
    ): Promise<ApiResponse<TrendAnalysisResult>> {
        try {
            // 获取时间序列数据 - 使用timechart管道命令
            const durationMs = this.parseDurationMs(timeRange);
            const autoBucket = bucket || this.chooseBucket(durationMs).bin;
            
            // 构建timechart查询
            let tsQuery: string;
            if (metricField) {
                tsQuery = `${query || '*'} | timechart span=${autoBucket} avg(${metricField}) as value`;
            } else {
                tsQuery = `${query || '*'} | timechart span=${autoBucket} count() as cnt`;
            }
            
            const result = await this.client.get<any>('/api/v3/search/sheets/', {
                query: tsQuery,
                time_range: timeRange,
                index_name: indexName,
                page: 0,
                size: 100
            });
            
            if (result.error) {
                return result;
            }

            const data = result.data;
            if (!data?.results?.sheets?.rows || data.results.sheets.rows.length === 0) {
                return {
                    error: '无数据',
                    message: '未找到符合条件的时间序列数据'
                };
            }

            // 提取时间序列数据
            const rows = data.results.sheets.rows;
            const series: TimeSeriesPoint[] = rows.map((item: any) => ({
                timestamp: item.timestamp || item._time || item.ts,
                value: item.cnt || item.value || 0
            }));

            const values = series.map(point => point.value);
            
            // 计算趋势分析
            const { slope, intercept } = this.linearRegression(values);
            const changeRate = values.length > 1 ? (values[values.length - 1] - values[0]) / values[0] : 0;
            
            // 检测峰值
            const peaks = this.detectPeaks(values, limitPeaks);
            
            // 检测异常
            const anomalies = this.detectAnomaliesZScore(values);
            
            // 生成总结
            const summary = this.generateTrendSummary(values, slope, changeRate);

            return {
                status: result.status,
                data: {
                    series,
                    slope,
                    intercept,
                    changeRate,
                    peaks,
                    anomalies,
                    summary
                },
                message: '趋势分析完成'
            };
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
        indexName: string = "yotta",
        bucket?: string,
        metricField?: string,
        method: string = 'zscore',
        sensitivity: number = 3,
        minSupport: number = 0
    ): Promise<ApiResponse<AnomalyDetectionResult>> {
        try {
            // 获取时间序列数据 - 使用timechart管道命令
            const durationMs = this.parseDurationMs(timeRange);
            const autoBucket = bucket || this.chooseBucket(durationMs).bin;
            
            // 构建timechart查询
            let tsQuery: string;
            if (metricField) {
                tsQuery = `${query || '*'} | timechart span=${autoBucket} avg(${metricField}) as value`;
            } else {
                tsQuery = `${query || '*'} | timechart span=${autoBucket} count() as cnt`;
            }
            
            const result = await this.client.get<any>('/api/v3/search/sheets/', {
                query: tsQuery,
                time_range: timeRange,
                index_name: indexName,
                page: 0,
                size: 100
            });
            
            if (result.error) {
                return result;
            }

            const data = result.data;
            if (!data?.results?.sheets?.rows || data.results.sheets.rows.length === 0) {
                return {
                    error: '无数据',
                    message: '未找到符合条件的时间序列数据'
                };
            }

            // 提取时间序列数据
            const rows = data.results.sheets.rows;
            const series: TimeSeriesPoint[] = rows.map((item: any) => ({
                timestamp: item.timestamp || item.time || item._timestamp,
                value: item.cnt || item.value || item.count || 0,
                count: item.cnt || item.value || item.count || 0
            }));

            const values = series.map(point => point.value);
            
            // 检测异常
            let anomalies: Array<{index: number, value: number, threshold: number, reason: string}> = [];
            
            if (method === 'iqr') {
                anomalies = this.detectAnomaliesIQR(values, sensitivity);
            } else {
                anomalies = this.detectAnomaliesZScore(values, sensitivity);
            }

            // 过滤最小支持度
            if (minSupport > 0) {
                anomalies = anomalies.filter(item => item.value >= minSupport);
            }

            return {
                status: result.status,
                data: {
                    anomalies,
                    method,
                    threshold: sensitivity
                },
                message: '异常检测完成'
            };
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
        indexName: string = "yotta",
        metricField?: string,
        percentiles: number[] = [50, 90, 99]
    ): Promise<ApiResponse<any>> {
        try {
            const apiPath = '/api/v3/search/overview/';
            const params = {
                query,
                time_range: timeRange,
                index_name: indexName,
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
     */
    simpleMovingAverage(data: number[], window: number): { forecast: number, trend: string } {
        if (data.length === 0 || window <= 0 || window > data.length) {
            return { forecast: 0, trend: 'stable' };
        }
        
        const recent = data.slice(-window);
        const forecast = this.mean(recent);
        
        const firstHalf = recent.slice(0, Math.floor(recent.length / 2));
        const secondHalf = recent.slice(Math.floor(recent.length / 2));
        
        const firstAvg = this.mean(firstHalf);
        const secondAvg = this.mean(secondHalf);
        
        const change = (secondAvg - firstAvg) / firstAvg;
        
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
        if (data.length === 0) {
            return { forecast: [], smoothed: [], trend: 'stable' };
        }
        
        const smoothed: number[] = [];
        let s = data[0];
        
        for (let i = 0; i < data.length; i++) {
            s = alpha * data[i] + (1 - alpha) * s;
            smoothed.push(s);
        }
        
        const forecast: number[] = [];
        for (let i = 0; i < horizon; i++) {
            forecast.push(s);
        }
        
        // 计算趋势
        const recent = smoothed.slice(-Math.floor(smoothed.length / 2));
        const older = smoothed.slice(0, Math.floor(smoothed.length / 2));
        
        const recentAvg = this.mean(recent);
        const olderAvg = this.mean(older);
        
        const change = (recentAvg - olderAvg) / olderAvg;
        
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
        if (data.length === 0) {
            return {
                forecast: new Array(horizon).fill(0),
                confidence_lower: new Array(horizon).fill(0),
                confidence_upper: new Array(horizon).fill(0),
                trend: 'stable',
                r_squared: 0
            };
        }
        
        const { slope, intercept } = this.linearRegression(data);
        const n = data.length;
        
        // 计算预测值
        const forecast: number[] = [];
        for (let i = 0; i < horizon; i++) {
            const x = n + i;
            forecast.push(slope * x + intercept);
        }
        
        // 计算R²
        const predicted = data.map((_, i) => slope * i + intercept);
        const r_squared = this.calculateRSquared(data, predicted);
        
        // 计算残差标准差
        const residuals = data.map((actual, i) => actual - predicted[i]);
        const residualStdDev = this.stddev(residuals);
        
        // 计算置信区间
        const t_value = 1.96; // 95%置信度
        const confidence_lower: number[] = [];
        const confidence_upper: number[] = [];
        
        for (let i = 0; i < horizon; i++) {
            const margin = t_value * residualStdDev;
            confidence_lower.push(forecast[i] - margin);
            confidence_upper.push(forecast[i] + margin);
        }
        
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
