/** Shared per-process fan-out limit for analysis requests. */
export const ANALYSIS_MAX_CONCURRENCY = (() => {
    const parsed = Number(process.env.MCP_ANALYSIS_MAX_CONCURRENCY || 4);
    return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, 8) : 4;
})();
