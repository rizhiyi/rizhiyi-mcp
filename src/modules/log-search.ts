import { LogEaseClient } from '../client.js';
import { 
    ApiResponse, 
    LogSearchResponse, 
    LogReduceResponse, 
    FieldsListResponse, 
    FieldValuesListResponse,
    LogReduceParams,
    QueryPrecheckDataResult,
    QueryPrecheckFieldResult,
    QueryPrecheckMode,
    QueryPrecheckResponse,
    QueryPrecheckSyntaxResult
} from '../types.js';
import { parseDurationMs as parseTimeRangeDurationMs, parseTimeString as parseTimeValue } from './time-utils.js';

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

    private normalizeSearchSheetsPaging(
        pagingOrLimit?: number | { page?: number; size?: number; limit?: number },
        defaultSize: number = 20
    ): { page: number; size: number } {
        if (typeof pagingOrLimit === 'number') {
            return { page: 0, size: pagingOrLimit };
        }

        const page = pagingOrLimit?.page ?? 0;
        const size = pagingOrLimit?.size ?? pagingOrLimit?.limit ?? defaultSize;
        return { page, size };
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

    private extractAvailableFields(data: any): string[] {
        const fieldsFromMetadata = Array.isArray(data?.results?.fields)
            ? data.results.fields
                .map((fieldInfo: any) => fieldInfo?.name)
                .filter((name: unknown): name is string => typeof name === 'string' && name.length > 0)
            : [];

        if (fieldsFromMetadata.length > 0) {
            return Array.from(new Set(fieldsFromMetadata));
        }

        const rows = Array.isArray(data?.results?.sheets?.rows) ? data.results.sheets.rows : [];
        const rowFields = rows.flatMap((row: Record<string, unknown>) => Object.keys(row || {}));
        return Array.from(new Set(rowFields));
    }

    private normalizeFieldName(field: string): string {
        return field.toLowerCase().replace(/[^a-z0-9]/g, '');
    }

    private flattenExpectedFields(expectedFields?: string[], fieldMapping?: Record<string, any>): string[] {
        const flattened: string[] = [];

        if (Array.isArray(expectedFields)) {
            flattened.push(...expectedFields);
        }

        if (fieldMapping && typeof fieldMapping === 'object') {
            for (const value of Object.values(fieldMapping)) {
                if (typeof value === 'string') {
                    flattened.push(value);
                } else if (Array.isArray(value)) {
                    flattened.push(...value.filter((item): item is string => typeof item === 'string'));
                }
            }
        }

        return Array.from(new Set(flattened.map((field) => field.trim()).filter(Boolean)));
    }

    private buildFieldSuggestions(expectedFields: string[], availableFields: string[]): Record<string, string[]> {
        const availableNormalized = availableFields.map((field) => ({
            original: field,
            normalized: this.normalizeFieldName(field)
        }));
        const suggestions: Record<string, string[]> = {};

        for (const expectedField of expectedFields) {
            const normalizedExpected = this.normalizeFieldName(expectedField);
            const matched = availableNormalized
                .filter(({ original, normalized }) => {
                    const originalLower = original.toLowerCase();
                    const expectedLower = expectedField.toLowerCase();
                    return normalized === normalizedExpected ||
                        originalLower.startsWith(expectedLower) ||
                        expectedLower.startsWith(originalLower) ||
                        originalLower.includes(expectedLower) ||
                        expectedLower.includes(originalLower);
                })
                .map(({ original }) => original)
                .slice(0, 3);

            if (matched.length > 0) {
                suggestions[expectedField] = Array.from(new Set(matched));
            }
        }

        return suggestions;
    }

    private extractSyntaxErrorMessage(raw: any): string | undefined {
        const candidates = [
            raw?.error,
            raw?.message,
            raw?.msg,
            raw?.error_info?.message,
            raw?.error_info?.msg,
            raw?.detail,
            raw?.details?.message
        ];

        return candidates.find((item): item is string => typeof item === 'string' && item.trim().length > 0)?.trim();
    }

    private extractSyntaxHints(raw: any): string[] {
        const candidates = [
            raw?.suggestion,
            raw?.suggestions,
            raw?.hint,
            raw?.hints,
            raw?.syntax_desc,
            raw?.desc
        ];

        const hints = candidates.flatMap((item) => {
            if (typeof item === 'string' && item.trim().length > 0) {
                return [item.trim()];
            }
            if (Array.isArray(item)) {
                return item.filter((value): value is string => typeof value === 'string' && value.trim().length > 0).map((value) => value.trim());
            }
            return [];
        });

        return Array.from(new Set(hints));
    }

    private didSyntaxPrecheckPass(raw: any, errorMessage?: string): boolean {
        if (raw?.result === false) return false;
        if (raw?.error || raw?.error_info) return false;
        if (typeof errorMessage === 'string' && errorMessage.length > 0) {
            const lowered = errorMessage.toLowerCase();
            if (lowered.includes('error') || lowered.includes('错误') || lowered.includes('failed') || lowered.includes('失败')) {
                return false;
            }
        }
        return true;
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
     * 执行日志搜索表格API调用
     */
    async executeLogSearchSheet(
        query: string, 
        timeRange: string, 
        indexName: string = "yotta", 
        pagingOrLimit: number | { page?: number; size?: number; limit?: number } = 20,
        fields?: string[]
    ): Promise<ApiResponse<LogSearchResponse>> {
        try {
            const apiPath = '/api/v3/search/sheets/';
            const { page, size } = this.normalizeSearchSheetsPaging(pagingOrLimit, 20);
            const params = {
                query,
                time_range: timeRange,
                index_name: indexName,
                page,
                size
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

            // 可选字段投影：减少返回体积，避免上下文爆炸
            if (Array.isArray(fields) && fields.length > 0) {
                const requested = new Set(fields);
                hits = hits.map((row: Record<string, unknown>) => {
                    const projected: Record<string, unknown> = {};
                    for (const key of fields) {
                        if (Object.prototype.hasOwnProperty.call(row, key)) {
                            projected[key] = row[key];
                        }
                    }
                    // 仅在显式请求时返回 _links
                    if (requested.has('_links') && Object.prototype.hasOwnProperty.call(row, '_links')) {
                        projected._links = row._links;
                    }
                    return projected;
                });
            }

            return {
                status: result.status,
                data: {
                    hits,
                    total,
                    page,
                    size,
                    returned: hits.length,
                    has_more: total > (page + 1) * size
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
                    total_hits: data?.result?.total_hits || 0,
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
                page: 0,
                size: 0,  // 设置 size=0 只获取字段信息，不返回数据行
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
                page: 0,
                size: limit,
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

    async executeQuerySyntaxPrecheck(
        query: string,
        timeRange: string = 'now-15m,now'
    ): Promise<ApiResponse<QueryPrecheckSyntaxResult>> {
        try {
            const result = await this.client.get<any>('/api/v3/search/precheck/', {
                query,
                time_range: timeRange,
                lang: 'zh_CN',
                timeline: 'false',
                statsevents: 'false'
            });

            if (result.error) {
                return result;
            }

            const raw = result.data ?? {};
            const errorMessage = this.extractSyntaxErrorMessage(raw);
            const passed = this.didSyntaxPrecheckPass(raw, errorMessage);

            return {
                status: result.status,
                data: {
                    checked: true,
                    passed,
                    error_message: passed ? undefined : (errorMessage || '查询语法预检未通过'),
                    hints: this.extractSyntaxHints(raw),
                    raw
                },
                message: passed ? '查询语法预检通过' : '查询语法预检未通过'
            };
        } catch (error: any) {
            return {
                error: error.message,
                message: `执行查询语法预检出错: ${error.message}`
            };
        }
    }

    async executeQueryDataPrecheck(
        query: string,
        timeRange: string,
        indexName: string = 'yotta',
        sampleSize: number = 20,
        terminatedAfterSize: number = 100,
        sampleFields?: string[]
    ): Promise<ApiResponse<QueryPrecheckDataResult>> {
        try {
            const result = await this.client.get<any>('/api/v3/search/sheets/', {
                query,
                time_range: timeRange,
                index_name: indexName,
                size: sampleSize,
                fields: true,
                timeline: 'false',
                highlight: 'false',
                statsevents: 'false',
                terminated_after_size: terminatedAfterSize
            });

            if (result.error) {
                return result;
            }

            const raw = result.data ?? {};
            const rows = Array.isArray(raw?.results?.sheets?.rows) ? raw.results.sheets.rows : [];
            const availableFields = this.extractAvailableFields(raw);
            const projectedRows = Array.isArray(sampleFields) && sampleFields.length > 0
                ? rows.map((row: Record<string, any>) => {
                    const projected: Record<string, any> = {};
                    for (const field of sampleFields) {
                        if (Object.prototype.hasOwnProperty.call(row, field)) {
                            projected[field] = row[field];
                        }
                    }
                    return projected;
                })
                : rows;

            return {
                status: result.status,
                data: {
                    checked: true,
                    has_data: rows.length > 0,
                    total_hits: Number(raw?.results?.total_hits ?? raw?.total_hits ?? rows.length ?? 0),
                    sample_hit_count: rows.length,
                    available_fields: availableFields,
                    sample_rows: projectedRows,
                    terminated_after_size: terminatedAfterSize
                },
                message: rows.length > 0 ? '查询有数预检通过' : '查询无数据'
            };
        } catch (error: any) {
            return {
                error: error.message,
                message: `执行查询有数预检出错: ${error.message}`
            };
        }
    }

    async executeQueryPrecheck(params: {
        query: string;
        time_range?: string;
        index_name?: string;
        mode?: QueryPrecheckMode;
        expected_fields?: string[];
        field_mapping?: Record<string, any>;
        sample_size?: number;
        terminated_after_size?: number;
        sample_fields?: string[];
    }): Promise<ApiResponse<QueryPrecheckResponse>> {
        const {
            query,
            time_range: timeRange = 'now-15m,now',
            index_name: indexName = 'yotta',
            mode = 'full',
            expected_fields: expectedFields,
            field_mapping: fieldMapping,
            sample_size: sampleSize = 20,
            terminated_after_size: terminatedAfterSize = 100,
            sample_fields: sampleFields
        } = params;

        const flattenedExpectedFields = this.flattenExpectedFields(expectedFields, fieldMapping);
        const syntaxCheck: QueryPrecheckSyntaxResult = { checked: false, passed: true };
        const dataCheck: QueryPrecheckDataResult = { checked: false };
        const fieldCheck: QueryPrecheckFieldResult = { checked: false };

        if (mode === 'syntax_only' || mode === 'full') {
            const syntaxResult = await this.executeQuerySyntaxPrecheck(query, timeRange);
            if (syntaxResult.error || !syntaxResult.data) {
                return {
                    status: syntaxResult.status,
                    error: syntaxResult.error || '查询语法预检失败',
                    error_code: syntaxResult.error_code,
                    suggestion: syntaxResult.suggestion,
                    retryable: syntaxResult.retryable,
                    details: syntaxResult.details,
                    message: syntaxResult.message
                };
            }
            Object.assign(syntaxCheck, syntaxResult.data);
        }

        if ((mode === 'data_only' || mode === 'full') && syntaxCheck.passed !== false) {
            const mergedSampleFields = Array.from(new Set([...(sampleFields || []), ...flattenedExpectedFields]));
            const dataResult = await this.executeQueryDataPrecheck(
                query,
                timeRange,
                indexName,
                sampleSize,
                terminatedAfterSize,
                mergedSampleFields.length > 0 ? mergedSampleFields : undefined
            );
            if (dataResult.error || !dataResult.data) {
                return {
                    status: dataResult.status,
                    error: dataResult.error || '查询有数预检失败',
                    error_code: dataResult.error_code,
                    suggestion: dataResult.suggestion,
                    retryable: dataResult.retryable,
                    details: dataResult.details,
                    message: dataResult.message
                };
            }
            Object.assign(dataCheck, dataResult.data);
        }

        if (dataCheck.checked && flattenedExpectedFields.length > 0) {
            const availableFields = dataCheck.available_fields || [];
            const availableFieldSet = new Set(availableFields.map((field) => field.toLowerCase()));
            const missingFields = flattenedExpectedFields.filter((field) => !availableFieldSet.has(field.toLowerCase()));
            const fieldSuggestions = this.buildFieldSuggestions(missingFields, availableFields);

            Object.assign(fieldCheck, {
                checked: true,
                field_match: missingFields.length === 0,
                expected_fields: flattenedExpectedFields,
                missing_fields: missingFields,
                field_suggestions: fieldSuggestions
            });
        }

        const availableFields = dataCheck.available_fields || [];
        const missingFields = fieldCheck.missing_fields || [];
        const fieldSuggestions = fieldCheck.field_suggestions || {};

        let recommendedNextAction: QueryPrecheckResponse['recommended_next_action'] = 'proceed';
        let recommendationReason = '查询通过预检，可以继续后续分析或创图。';

        if (syntaxCheck.checked && !syntaxCheck.passed) {
            recommendedNextAction = 'fix_query_syntax';
            recommendationReason = syntaxCheck.error_message || '查询语法预检失败，请先修正 SPL 语句。';
        } else if (dataCheck.checked && dataCheck.has_data === false) {
            recommendedNextAction = 'fix_query_or_time_range';
            recommendationReason = '语法通过但当前时间范围内无数据，请调整 query 或 time_range。';
        } else if (fieldCheck.checked && fieldCheck.field_match === false) {
            recommendedNextAction = 'fix_field_mapping';
            recommendationReason = '查询有数据，但字段映射不匹配当前图表配置。';
        } else if (mode === 'syntax_only') {
            recommendationReason = '当前只完成语法预检；如果要创图，建议继续执行 data_only 或 full。';
        }

        return {
            status: 200,
            data: {
                query,
                mode,
                syntax_check: syntaxCheck,
                data_check: dataCheck,
                field_check: fieldCheck,
                has_data: typeof dataCheck.has_data === 'boolean' ? dataCheck.has_data : null,
                available_fields: availableFields,
                missing_fields: missingFields,
                field_suggestions: fieldSuggestions,
                recommended_next_action: recommendedNextAction,
                recommendation_reason: recommendationReason
            },
            message: '查询预检完成'
        };
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
                page: 0,
                size: 100
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
