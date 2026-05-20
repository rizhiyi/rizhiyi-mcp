import { LogEaseClient } from '../client.js';
import { 
    ApiResponse, 
    TimeSeriesPoint, 
    ForecastResult, 
    TimeSeriesQueryParams 
} from '../types.js';
import { StatisticsModule } from './statistics.js';

export class TrendForecastModule {
    private statistics: StatisticsModule;

    constructor(private client: LogEaseClient) {
        this.statistics = new StatisticsModule(client);
    }

    /**
     * 趋势预测（短期）：基于线性回归/滑动平均进行时间序列预测，包含置信区间
     */
    async executeTrendForecast(params: {
        query?: string;
        time_range: string;
        index_name?: string;
        bucket?: string;
        horizon?: number;
        method?: string;
        confidence?: number;
        metric_field?: string;
        window?: number;
        alpha?: number;
    }): Promise<ApiResponse<ForecastResult>> {
        try {
            const {
                query = '*',
                time_range,
                index_name = 'yotta',
                bucket,
                horizon = 12,
                method = 'linear_regression',
                confidence = 0.95,
                metric_field,
                window = 10,
                alpha = 0.3
            } = params;

            // 获取时间序列数据 - 使用timechart管道命令
            const durationMs = this.statistics.parseDurationMs(time_range);
            const autoBucket = bucket || this.statistics.chooseBucket(durationMs).bin;
            
            // 构建timechart查询
            let tsQuery: string;
            if (metric_field) {
                tsQuery = `${query || '*'} | timechart span=${autoBucket} avg(${metric_field}) as value`;
            } else {
                tsQuery = `${query || '*'} | timechart span=${autoBucket} count() as cnt`;
            }
            
            const result = await this.client.get<any>('/api/v3/search/sheets/', {
                query: tsQuery,
                time_range,
                index_name,
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
            
            // 根据方法进行预测
            let forecastResult: {
                forecast: number[];
                confidence_lower?: number[];
                confidence_upper?: number[];
                trend: string;
                r_squared?: number;
            };

            switch (method) {
                case 'moving_average':
                    const maResult = this.statistics.simpleMovingAverage(values, window);
                    forecastResult = {
                        forecast: new Array(horizon).fill(maResult.forecast),
                        trend: maResult.trend
                    };
                    break;

                case 'exponential_smoothing':
                    const esResult = this.statistics.exponentialSmoothing(values, alpha, horizon);
                    forecastResult = {
                        forecast: esResult.forecast,
                        trend: esResult.trend
                    };
                    break;

                case 'linear_regression':
                default:
                    const lrResult = this.statistics.linearTrendForecast(values, horizon, confidence);
                    forecastResult = {
                        forecast: lrResult.forecast,
                        confidence_lower: lrResult.confidence_lower,
                        confidence_upper: lrResult.confidence_upper,
                        trend: lrResult.trend,
                        r_squared: lrResult.r_squared
                    };
                    break;
            }

            return {
                status: result.status,
                data: {
                    ...forecastResult,
                    method
                } as ForecastResult,
                message: '趋势预测完成'
            };
        } catch (error: any) {
            return {
                error: error.message,
                message: `执行趋势预测出错: ${error.message}`
            };
        }
    }

    /**
     * 异常预警：结合预测和阈值进行异常检测，支持预测上下界触发告警
     */
    async executeAnomalyAlert(params: {
        query?: string;
        time_range: string;
        index_name?: string;
        bucket?: string;
        method?: string;
        threshold?: number;
        alert_on?: string;
        min_anomaly_points?: number;
        forecast_horizon?: number;
        metric_field?: string;
    }): Promise<ApiResponse<any>> {
        try {
            const {
                query = '*',
                time_range,
                index_name = 'yotta',
                bucket,
                method = 'prediction_band',
                threshold = 3.0,
                alert_on = 'both',
                min_anomaly_points = 3,
                forecast_horizon = 6,
                metric_field
            } = params;

            // 获取历史数据 - 使用timechart管道命令
            const durationMs = this.statistics.parseDurationMs(time_range);
            const autoBucket = bucket || this.statistics.chooseBucket(durationMs).bin;
            
            // 构建timechart查询
            let tsQuery: string;
            if (metric_field) {
                tsQuery = `${query || '*'} | timechart span=${autoBucket} avg(${metric_field}) as value`;
            } else {
                tsQuery = `${query || '*'} | timechart span=${autoBucket} count() as cnt`;
            }
            
            const result = await this.client.get<any>('/api/v3/search/sheets/', {
                query: tsQuery,
                time_range,
                index_name,
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
            const values: number[] = rows.map((item: any) => item.cnt || item.value || item.count || 0);
            const timestamps: string[] = rows.map((item: any) => item.timestamp || item.time || item._timestamp);

            let anomalies: Array<{index: number, value: number, threshold: number, reason: string}> = [];
            let alertTriggered = false;
            let alertReasons: string[] = [];

            switch (method) {
                case 'prediction_band':
                    // 使用预测区间方法
                    const lrResult = this.statistics.linearTrendForecast(values, forecast_horizon);
                    const lastValues = values.slice(-forecast_horizon);
                    
                    lastValues.forEach((value: number, index: number) => {
                        const lowerBound = lrResult.confidence_lower[index];
                        const upperBound = lrResult.confidence_upper[index];
                        
                        if (value < lowerBound && (alert_on === 'lower' || alert_on === 'both')) {
                            anomalies.push({
                                index: values.length - forecast_horizon + index,
                                value,
                                threshold: lowerBound,
                                reason: `值 ${value} 低于预测区间下界 ${lowerBound.toFixed(2)}`
                            });
                        } else if (value > upperBound && (alert_on === 'upper' || alert_on === 'both')) {
                            anomalies.push({
                                index: values.length - forecast_horizon + index,
                                value,
                                threshold: upperBound,
                                reason: `值 ${value} 高于预测区间上界 ${upperBound.toFixed(2)}`
                            });
                        }
                    });
                    break;

                case 'statistical':
                    // 使用统计方法
                    const mean = this.statistics.mean(values);
                    const stddev = this.statistics.stddev(values);
                    
                    values.forEach((value: number, index: number) => {
                        const zScore = Math.abs((value - mean) / stddev);
                        if (zScore > threshold) {
                            const isUpper = value > mean;
                            if ((isUpper && (alert_on === 'upper' || alert_on === 'both')) ||
                                (!isUpper && (alert_on === 'lower' || alert_on === 'both'))) {
                                anomalies.push({
                                    index,
                                    value,
                                    threshold: zScore,
                                    reason: `Z-score ${zScore.toFixed(2)} 超过阈值 ${threshold}`
                                });
                            }
                        }
                    });
                    break;

                case 'adaptive':
                    // 使用IQR方法
                    anomalies = this.statistics.detectAnomaliesIQR(values, threshold);
                    anomalies = anomalies.filter(item => {
                        const isUpper = item.value > this.statistics.mean(values);
                        return (isUpper && (alert_on === 'upper' || alert_on === 'both')) ||
                               (!isUpper && (alert_on === 'lower' || alert_on === 'both'));
                    });
                    break;
            }

            // 检查是否触发告警
            if (anomalies.length >= min_anomaly_points) {
                alertTriggered = true;
                alertReasons = anomalies.slice(0, 5).map(item => item.reason);
            }

            return {
                status: result.status,
                data: {
                    alert_triggered: alertTriggered,
                    anomaly_count: anomalies.length,
                    min_anomaly_points,
                    alert_reasons: alertReasons,
                    anomalies: anomalies.slice(0, 10), // 限制返回数量
                    method,
                    threshold,
                    alert_on,
                    timestamps,
                    values
                },
                message: alertTriggered ? '异常告警触发' : '未检测到异常'
            };
        } catch (error: any) {
            return {
                error: error.message,
                message: `执行异常预警出错: ${error.message}`
            };
        }
    }
}
