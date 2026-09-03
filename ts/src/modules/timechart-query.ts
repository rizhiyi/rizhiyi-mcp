import { LogEaseClient } from '../client.js';
import { ApiResponse, TimeSeriesPoint, TimechartQueryResult, TimeSeriesQueryParams } from '../types.js';
import { chooseBucket, parseDurationMs } from './time-utils.js';

export class TimechartQueryModule {
    constructor(private client: LogEaseClient) {}

    private resolveBucket(timeRange: string, bucket?: string): string {
        if (bucket) {
            return bucket;
        }

        const durationMs = parseDurationMs(timeRange);
        return chooseBucket(durationMs).bin;
    }

    private buildTimechartQuery(query: string, bucketUsed: string, metricField?: string): {
        query_executed: string;
        aggregation_type: 'count' | 'avg';
    } {
        if (metricField) {
            return {
                query_executed: `${query || '*'} | timechart span=${bucketUsed} avg(${metricField}) as value`,
                aggregation_type: 'avg'
            };
        }

        return {
            query_executed: `${query || '*'} | timechart span=${bucketUsed} count() as cnt`,
            aggregation_type: 'count'
        };
    }

    private normalizeSeries(rows: any[]): TimeSeriesPoint[] {
        return rows.map((item: any) => {
            const rawValue = item.cnt ?? item.value ?? item.count ?? 0;
            const value = typeof rawValue === 'number' ? rawValue : Number(rawValue) || 0;
            const timestamp = item.timestamp ?? item._time ?? item.time ?? item.ts ?? item._timestamp ?? '';

            return {
                timestamp: String(timestamp),
                value,
                count: value
            };
        });
    }

    async execute(params: TimeSeriesQueryParams): Promise<ApiResponse<TimechartQueryResult>> {
        try {
            const {
                query = '*',
                time_range,
                index_name = 'yotta',
                bucket,
                metric_field
            } = params;

            const bucketUsed = this.resolveBucket(time_range, bucket);
            const { query_executed, aggregation_type } = this.buildTimechartQuery(query, bucketUsed, metric_field);

            const result = await this.client.get<any>('/api/v3/search/sheets/', {
                query: query_executed,
                time_range,
                index_name,
                page: 0,
                size: 100
            });

            if (result.error) {
                return result;
            }

            const rows = Array.isArray(result.data?.results?.sheets?.rows)
                ? result.data.results.sheets.rows
                : [];

            return {
                status: result.status,
                data: {
                    series: this.normalizeSeries(rows),
                    bucket_used: bucketUsed,
                    query_executed,
                    aggregation_type,
                    metric_field
                },
                message: rows.length > 0 ? '时间序列数据获取成功' : '未找到符合条件的时间序列数据'
            };
        } catch (error: any) {
            return {
                error: error.message,
                message: `获取时间序列数据出错: ${error.message}`
            };
        }
    }
}
