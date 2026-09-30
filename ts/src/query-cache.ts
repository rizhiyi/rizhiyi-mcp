import type { ApiResponse } from './types.js';

export interface QueryCacheTtls {
    timechart: number;
    overview: number;
    fields: number;
    fieldValues: number;
    sampleRows: number;
    exactCount: number;
    default: number;
}

type Entry<T> = { expiresAt: number; value: T };

function stable(value: unknown): string {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
    return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`).join(',')}}`;
}

function normalizeCacheParams(params: Record<string, any>): Record<string, any> {
    const normalized = { ...params };
    for (const key of ['query', 'time_range', 'bucket', 'metric_field']) {
        if (typeof normalized[key] === 'string') normalized[key] = normalized[key].trim();
    }
    return normalized;
}

export function defaultQueryCacheTtls(env: NodeJS.ProcessEnv = process.env): QueryCacheTtls {
    const seconds = (name: string, fallback: number) => {
        const value = Number(env[name]);
        return Number.isFinite(value) && value > 0 ? value * 1000 : fallback * 1000;
    };
    return {
        timechart: seconds('MCP_QUERY_CACHE_TIMECHART_TTL_SECONDS', 30),
        overview: seconds('MCP_QUERY_CACHE_OVERVIEW_TTL_SECONDS', 30),
        fields: seconds('MCP_QUERY_CACHE_FIELDS_TTL_SECONDS', 60),
        fieldValues: seconds('MCP_QUERY_CACHE_FIELD_VALUES_TTL_SECONDS', 30),
        sampleRows: seconds('MCP_QUERY_CACHE_SAMPLE_ROWS_TTL_SECONDS', 15),
        exactCount: seconds('MCP_QUERY_CACHE_EXACT_COUNT_TTL_SECONDS', 15),
        default: seconds('MCP_QUERY_CACHE_DEFAULT_TTL_SECONDS', 15)
    };
}

export class QueryCache {
    private readonly values = new Map<string, Entry<ApiResponse<any>>>();
    private readonly inFlight = new Map<string, Promise<ApiResponse<any>>>();

    constructor(
        private readonly ttls: QueryCacheTtls = defaultQueryCacheTtls(),
        private readonly logger: (event: Record<string, unknown>) => void = (event) => {
            if (process.env.MCP_QUERY_CACHE_LOGGING === 'true') {
                console.debug(JSON.stringify({ component: 'query-cache', ...event }));
            }
        }
    ) {}

    async getOrFetch<T>(
        keyParts: Record<string, unknown>,
        fetcher: () => Promise<ApiResponse<T>>,
        ttlMs: number
    ): Promise<ApiResponse<T>> {
        const key = stable({
            ...keyParts,
            params: keyParts.params && typeof keyParts.params === 'object'
                ? normalizeCacheParams(keyParts.params as Record<string, any>)
                : keyParts.params
        });
        const now = Date.now();
        const cached = this.values.get(key);
        if (cached && cached.expiresAt > now) {
            this.logger({ event: 'cache_hit' });
            return cached.value as ApiResponse<T>;
        }
        if (cached) this.values.delete(key);
        const pending = this.inFlight.get(key);
        if (pending) {
            this.logger({ event: 'inflight_join' });
            return pending as Promise<ApiResponse<T>>;
        }
        this.logger({ event: 'cache_miss' });
        const startedAt = Date.now();
        const request = fetcher().then((result) => {
            this.logger({ event: 'upstream_complete', duration_ms: Date.now() - startedAt, status: result.status, error_code: result.error_code || null });
            if (!result.error && ttlMs > 0) this.values.set(key, { expiresAt: Date.now() + ttlMs, value: result });
            return result;
        }).finally(() => this.inFlight.delete(key));
        this.inFlight.set(key, request);
        return request;
    }

    ttlForPath(path: string, params: Record<string, any> = {}): number {
        // 聚类任务提交和轮询必须读取最新状态，不能缓存。
        if (path.includes('/search/logreduce/') || path.includes('/search/preview/logreduce/')) return 0;
        if (path.includes('/search/sheets/')) {
            const query = String(params.query || '').toLowerCase();
            if (query.includes('timechart')) return this.ttls.timechart;
            if (params.fields === true && Number(params.size || 0) === 0) return this.ttls.fields;
            if (query.includes('stats count by')) return this.ttls.fieldValues;
            const size = Number(params.size || 0);
            return size <= 5 ? this.ttls.sampleRows : this.ttls.exactCount;
        }
        if (path.includes('/fieldconfigs') || path.includes('/fields')) return this.ttls.fields;
        if (path.includes('field_values')) return this.ttls.fieldValues;
        if (path.includes('overview')) return this.ttls.overview;
        // Keep management and other mutable GET endpoints uncached unless they
        // are explicitly classified above.
        return 0;
    }
}
