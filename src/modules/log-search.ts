import { LogEaseClient } from '../client.js';
import { 
    ApiResponse, 
    LogSearchResponse, 
    LogReduceResponse, 
    FieldsListResponse, 
    FieldValuesListResponse,
    LogReduceParams 
} from '../types.js';

export class LogSearchModule {
    private baseURL: string;

    constructor(private client: LogEaseClient, baseURL: string = '') {
        // 移除末尾的斜杠，确保格式统一
        this.baseURL = baseURL.endsWith('/') ? baseURL.slice(0, -1) : baseURL;
    }

    /**
     * 生成精准溯源链接
     */
    private generateQuickLinks(row: any, originalQuery: string, timeRange: string, indexName: string): Record<string, string> {
        const links: Record<string, string> = {};
        if (!this.baseURL) return links;

        // 关键唯一标识字段 - 直接查询该ID
        const uniqueIdFields = ['context_id', 'trace_id', 'request_id', 'spanid', '_id', 'traceid'];
        
        // 特征字段 - 追加到原查询条件
        const featureFields = ['appname', 'hostname', 'host', 'client_ip', 'ip', 'level', 'severity', 'status', 'uri', 'url'];

        // 基础参数
        const baseParams = new URLSearchParams();
        baseParams.append('time_range', timeRange);
        if (indexName) baseParams.append('index_name', indexName); // 注意：Web端参数可能不叫index_name，通常是datasets或隐含
        // Web UI 通常使用 datasets=["index_name"]，这里简化处理，或者忽略 index_name 如果它是默认的 yotta
        // 根据用户提供的样例: datasets=[] (空数组), app_id=45. 
        // 既然无法准确知道 Web 端对应的 datasets 格式，且通常 search 页面默认会选当前 index，我们暂时只传 query 和 time_range
        // 补充：用户提供的 URL 包含 searchMode=intelligent
        baseParams.append('searchMode', 'intelligent');

        // 遍历行数据中的字段
        for (const [key, value] of Object.entries(row)) {
            if (value === undefined || value === null || value === '') continue;
            const strValue = String(value);

            // 1. 处理唯一标识符
            if (uniqueIdFields.includes(key.toLowerCase())) {
                const query = `${key}:${strValue}`;
                const params = new URLSearchParams(baseParams);
                params.append('query', query);
                links[key] = `${this.baseURL}/search/?${params.toString()}`;
            }
            // 2. 处理特征字段
            else if (featureFields.includes(key.toLowerCase())) {
                // 如果原查询是 *，则直接查字段；否则追加 AND
                const cleanQuery = originalQuery === '*' ? '' : `(${originalQuery}) AND `;
                const query = `${cleanQuery}${key}:${strValue}`;
                const params = new URLSearchParams(baseParams);
                params.append('query', query);
                links[key] = `${this.baseURL}/search/?${params.toString()}`;
            }
        }

        return links;
    }

    /**
     * 提取数据行 - 从搜索结果中提取行数据
     */
    extractRows(data: any): any[] {
        if (Array.isArray(data)) return data;
        if (data?.results) return data.results;
        if (data?.data) return this.extractRows(data.data);
        if (data?.hits) return data.hits;
        return [];
    }

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
     * 执行日志搜索表格API调用
     */
    async executeLogSearchSheet(
        query: string, 
        timeRange: string, 
        indexName: string = "yotta", 
        limit: number = 100
    ): Promise<ApiResponse<LogSearchResponse>> {
        try {
            const apiPath = '/api/v3/search/sheets/';
            const params = {
                query,
                time_range: timeRange,
                index_name: indexName,
                limit
            };

            const result = await this.client.get<any>(apiPath, params);
            
            if (result.error) {
                return result;
            }

            // 解析真实的API响应数据
            const data = result.data;
            let hits: any[] = [];
            let total = 0;

            // 日志易真实的响应结构：results.sheets.rows 包含数据行
            if (data?.results?.sheets?.rows) {
                hits = data.results.sheets.rows;
                total = data.results.total_hits || hits.length;
            } else if (data?.results?.length > 0) {
                // 兼容其他可能的响应格式
                hits = data.results;
                total = data.total || hits.length;
            }

            // 为每行数据注入 _links
            hits = hits.map(row => {
                const links = this.generateQuickLinks(row, query, timeRange, indexName);
                return { ...row, _links: links };
            });

            return {
                status: result.status,
                data: {
                    hits,
                    total
                },
                message: '日志搜索成功'
            };
        } catch (error: any) {
            return {
                error: error.message,
                message: `执行日志搜索出错: ${error.message}`
            };
        }
    }

    /**
     * 执行日志聚类分析
     */
    async executeLogReducePattern(
        query: string,
        timeRange: string,
        indexName: string = "yotta",
        patternOptions: LogReduceParams['pattern_options'] = {}
    ): Promise<ApiResponse<LogReduceResponse>> {
        try {
            const apiPath = '/api/v3/search/logreduce/';
            
            // 构建请求数据
            const requestData = {
                query,
                time_range: timeRange,
                index_name: indexName,
                mask_url: true,
                initial_dist: patternOptions?.initial_dist || '0.01',
                alpha: patternOptions?.alpha || '1.8',
                multi_align_threshold: patternOptions?.multi_align_threshold || '0.1',
                pattern_discover_align_threshold: patternOptions?.pattern_discover_align_threshold || '0.05',
                find_cluster_align_threshold: patternOptions?.find_cluster_align_threshold || '0.2',
                stop_threshold: patternOptions?.stop_threshold || '0.5'
            };

            const result = await this.client.get<any>(apiPath, requestData);
            
            if (result.error) {
                return result;
            }
            
            return {
                status: result.status,
                data: result.data,
                message: '日志聚类分析任务提交成功'
            };
        } catch (error: any) {
            return {
                error: error.message,
                message: `执行日志聚类分析出错: ${error.message}`
            };
        }
    }

    /**
     * 获取日志聚类分析结果
     */
    async executeLogReducePreview(
        sid: string,
        maxRetries: number = 10,
        retryInterval: number = 5000
    ): Promise<ApiResponse<LogReduceResponse>> {
        try {
            const apiPath = `/api/v3/search/preview/logreduce/`;
            
            // 轮询获取结果
            const result = await this.client.pollUntilComplete<any>(
                apiPath,
                (response) => {
                    // 检查是否完成
                    return response.data?.job_status === 'COMPLETED' || 
                           response.data?.job_status === 'FAILED' ||
                           response.error !== undefined;
                },
                maxRetries,
                retryInterval,
                {
                    sid: sid
                },
                {
                    timeout: 30000, // 增加超时时间到 30 秒
                    transformResponse: [(data: any) => {
                        // 处理 API 返回重复 result 键的问题
                        if (typeof data === 'string') {
                            // 将 "result": true/false 替换为 "success": true/false
                            // 避免覆盖包含数据的 "result": { ... } 对象
                            const fixedData = data.replace(/"result"\s*:\s*(true|false)/g, '"success":$1');
                            try {
                                return JSON.parse(fixedData);
                            } catch (e) {
                                return data;
                            }
                        }
                        return data;
                    }]
                }
            );
            
            if (result.error) {
                return result;
            }

            const data = result.data;
            
            // 确定结果数据位置：可能在 result.body 或 tree_layer.clusters
            let patterns = [];
            if (data?.result?.body) {
                patterns = data.result.body;
            } else if (data?.tree_layer?.clusters) {
                patterns = data.tree_layer.clusters;
            }

            // 移除 _cus_raw 字段以节省上下文空间
            if (patterns && Array.isArray(patterns)) {
                patterns.forEach((item: any) => {
                    if (item._cus_raw) {
                        delete item._cus_raw;
                    }
                });
            }
            
            return {
                status: result.status,
                data: {
                    sid: data?.sid,
                    job_status: data?.job_status,
                    result: patterns
                }
            };
        } catch (error: any) {
            return {
                error: error.message,
                message: `获取日志聚类分析结果出错: ${error.message}`
            };
        }
    }

    /**
     * 列出所有日志字段
     */
    async executeListFields(
        query: string,
        timeRange: string,
        indexName: string = "yotta"
    ): Promise<ApiResponse<FieldsListResponse>> {
        try {
            const apiPath = '/api/v3/search/sheets/';
            const params = {
                query,
                time_range: timeRange,
                index_name: indexName,
                limit: 0,  // 设置 limit=0 只获取字段信息，不返回数据行
                fields: true  // 明确请求字段信息
            };

            const result = await this.client.get<any>(apiPath, params);
            
            if (result.error) {
                return result;
            }

            const data = result.data;
            let fields: any[] = [];
            let total = 0;

            // 根据真实的API响应结构处理字段信息
            if (data?.results?.fields) {
                fields = data.results.fields.map((fieldInfo: any) => ({
                    name: fieldInfo.name,
                    type: fieldInfo.type || 'unknown',
                    distinct_count: fieldInfo.dc || 0,  // 日志易使用 dc 表示 distinct_count
                    total: fieldInfo.total || 0,
                    top_values: fieldInfo.topk || []  // 日志易使用 topk 而不是 top_values
                }));
                total = fields.length;
            }

            return {
                status: result.status,
                data: {
                    fields,
                    total
                },
                message: '字段列表获取成功'
            };
        } catch (error: any) {
            return {
                error: error.message,
                message: `获取字段列表出错: ${error.message}`
            };
        }
    }

    /**
     * 列出指定字段的所有值及其出现频率
     */
    async executeListFieldValues(
        field: string,
        query: string,
        timeRange: string,
        indexName: string = "yotta",
        limit: number = 100
    ): Promise<ApiResponse<FieldValuesListResponse>> {
        try {
            // 构建stats查询来获取字段值分布 - 使用原始实现的方法
            const fieldQuery = query !== '*' ? `${query} | stats count by ${field}` : `* | stats count by ${field}`;
            
            const apiPath = '/api/v3/search/sheets/';
            const params = {
                query: fieldQuery,
                time_range: timeRange,
                index_name: indexName,
                limit: limit,
                fields: true  // 获取字段统计信息
            };

            const result = await this.client.get<any>(apiPath, params);
            
            if (result.error) {
                return result;
            }

            const data = result.data;
            let values: any[] = [];
            let total = 0;

            // 从真实的API响应结构中提取字段值信息
            // stats count by 查询返回的数据在 sheets.rows 中
            if (data?.results?.sheets?.rows) {
                values = data.results.sheets.rows.map((row: any) => ({
                    value: row[field],  // 字段值
                    count: row.count    // 计数
                }));
                total = values.length;
            }

            return {
                status: result.status,
                data: {
                    field,
                    values: values.slice(0, limit),
                    total
                },
                message: '字段值列表获取成功'
            };
        } catch (error: any) {
            return {
                error: error.message,
                message: `获取字段值列表出错: ${error.message}`
            };
        }
    }

    /**
     * 获取时间序列计数数据 - 使用timechart管道命令
     */
    async executeTimeSeriesCounts(
        query: string,
        timeRange: string,
        indexName: string = "yotta",
        bucket: string = "5m",
        metricField?: string
    ): Promise<ApiResponse<{ points: Array<{ time: number; count: number }> }>> {
        try {
            // 构建timechart查询
            let tsQuery: string;
            if (metricField) {
                tsQuery = `${query || '*'} | timechart span=${bucket} avg(${metricField}) as value`;
            } else {
                tsQuery = `${query || '*'} | timechart span=${bucket} count() as cnt`;
            }
            
            // 使用日志搜索API执行timechart查询
            const result = await this.client.get<any>('/api/v3/search/sheets/', {
                query: tsQuery,
                time_range: timeRange,
                index_name: indexName,
                limit: 100
            });
            
            if (result.error) {
                return result;
            }

            // 从真实的API响应结构中提取数据
            const data = result.data;
            if (!data?.results?.sheets?.rows || data.results.sheets.rows.length === 0) {
                return {
                    status: result.status,
                    data: { points: [] },
                    message: '未找到符合条件的时间序列数据'
                };
            }

            // 转换API响应格式到期望的格式
            const points = data.results.sheets.rows.map((item: any) => ({
                time: item._time || item.time || item.timestamp,
                count: item.cnt || item.value || item.count || 0
            }));
            
            return {
                status: result.status,
                data: { points },
                message: '时间序列数据获取成功'
            };
        } catch (error: any) {
            return {
                error: error.message,
                message: `获取时间序列数据出错: ${error.message}`
            };
        }
    }

    /**
     * 获取数据概览 - 使用stats管道命令
     */
    async executeDataOverview(
        query: string,
        timeRange: string,
        indexName: string = "yotta",
        metricField?: string,
        percentiles: number[] = [50, 90, 99]
    ): Promise<ApiResponse<any>> {
        try {
            const durationMs = this.parseDurationMs(timeRange);
            
            if (metricField) {
                // 获取基础统计数据
                const statsQuery = `${query || '*'} | stats count, min(${metricField}), max(${metricField}), avg(${metricField}), sum(${metricField})`;
                const statsResponse = await this.executeLogSearchSheet(statsQuery, timeRange, indexName, 100);
                const statsRows = this.extractRows(statsResponse.data);
                
                if (statsRows.length > 0) {
                    const stats = statsRows[0];
                    
                    // 获取百分位数数据
                    let percentilesData = {};
                    if (percentiles.length > 0) {
                        const percentileList = percentiles.join(', ');
                        const percQuery = `${query || '*'} | stats pct(${metricField}, ${percentileList}) as p`;
                        const percResponse = await this.executeLogSearchSheet(percQuery, timeRange, indexName, 100);
                        const percRows = this.extractRows(percResponse.data);
                        
                        if (percRows.length > 0) {
                            const percResult = percRows[0];
                            percentilesData = percentiles.reduce((acc, p) => {
                                const key = `p.${p}`;
                                if (percResult[key] !== undefined) {
                                    acc[`p${p}`] = percResult[key];
                                }
                                return acc;
                            }, {} as Record<string, number>);
                        }
                    }
                    
                    return {
                        status: 200,
                        data: {
                            overview: {
                                total_count: stats.count || 0,
                                min: stats[`min(${metricField})`] || 0,
                                max: stats[`max(${metricField})`] || 0,
                                avg: stats[`avg(${metricField})`] || 0,
                                sum: stats[`sum(${metricField})`] || 0,
                                percentiles: percentilesData,
                                window_ms: durationMs,
                                metric_field: metricField
                            },
                            time_range: timeRange,
                            index_name: indexName
                        }
                    };
                }
            }
            
            // 默认行为：计算总命中数和每秒事件数
            const summary = await this.executeLogSearchSheet(query || '*', timeRange, indexName, 1);
            const total = (summary.data as any)?.results?.total_hits ?? 0;
            const eps = durationMs > 0 ? (total / (durationMs / 1000)) : 0;
            return {
                status: 200,
                data: {
                    overview: {
                        total_hits: total,
                        window_ms: durationMs,
                        events_per_second: Number(eps.toFixed(4))
                    },
                    time_range: timeRange,
                    index_name: indexName
                }
            };
        } catch (error: any) {
            return {
                error: error.message,
                message: `获取数据概览出错: ${error.message}`
            };
        }
    }
}