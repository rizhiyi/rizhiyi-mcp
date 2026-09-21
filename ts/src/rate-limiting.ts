export type RateLimitScope = 'global' | 'tool';

export interface RateLimitDecision {
    allowed: boolean;
    scope?: RateLimitScope;
    limit?: number;
    current: number;
    remaining?: number;
    retry_after_seconds?: number;
    reset_at: number;
    window_seconds: number;
    route_name: string;
    tool_name: string;
}

export class FixedWindowRateLimiter {
    private windowId?: number;
    private globalCount = 0;
    private readonly toolCounts = new Map<string, number>();

    constructor(
        readonly globalLimit?: number,
        readonly perToolLimits: Record<string, number> = {},
        readonly windowSeconds = 60,
        private readonly clock: () => number = () => Date.now() / 1000
    ) {
        if (typeof globalLimit !== 'undefined' && (!Number.isInteger(globalLimit) || globalLimit <= 0)) {
            throw new Error('globalLimit 必须是正整数或 undefined');
        }
        if (!Number.isInteger(windowSeconds) || windowSeconds <= 0) {
            throw new Error('windowSeconds 必须是正整数');
        }
    }

    get enabled(): boolean {
        return typeof this.globalLimit !== 'undefined' || Object.keys(this.perToolLimits).length > 0;
    }

    consume(routeName: string, toolName: string): RateLimitDecision {
        const now = Math.max(0, this.clock());
        const windowId = Math.floor(now / this.windowSeconds);
        const resetAt = (windowId + 1) * this.windowSeconds;
        const exactToolKey = `${routeName}/${toolName}`;
        const hasExactToolLimit = Object.prototype.hasOwnProperty.call(this.perToolLimits, exactToolKey);
        const toolCounterKey = hasExactToolLimit ? exactToolKey : toolName;
        const toolLimit = hasExactToolLimit
            ? this.perToolLimits[exactToolKey]
            : Object.prototype.hasOwnProperty.call(this.perToolLimits, toolName)
                ? this.perToolLimits[toolName]
                : undefined;

        if (this.windowId !== windowId) {
            this.windowId = windowId;
            this.globalCount = 0;
            this.toolCounts.clear();
        }

        if (typeof this.globalLimit !== 'undefined') {
            this.globalCount += 1;
        }

        let toolCount = 0;
        if (typeof toolLimit !== 'undefined') {
            toolCount = (this.toolCounts.get(toolCounterKey) || 0) + 1;
            this.toolCounts.set(toolCounterKey, toolCount);
        }

        let scope: RateLimitScope | undefined;
        let limit: number | undefined;
        let current = 0;
        if (typeof this.globalLimit !== 'undefined' && this.globalCount > this.globalLimit) {
            scope = 'global';
            limit = this.globalLimit;
            current = this.globalCount;
        } else if (typeof toolLimit !== 'undefined' && toolCount > toolLimit) {
            scope = 'tool';
            limit = toolLimit;
            current = toolCount;
        }

        const allowed = typeof scope === 'undefined';
        return {
            allowed,
            scope,
            limit,
            current,
            remaining: typeof limit === 'undefined' ? undefined : Math.max(0, limit - current),
            retry_after_seconds: allowed ? undefined : Math.max(1, Math.ceil(resetAt - now)),
            reset_at: resetAt,
            window_seconds: this.windowSeconds,
            route_name: routeName,
            tool_name: toolName
        };
    }
}
