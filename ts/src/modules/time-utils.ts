export type TimeBucket = {
    bin: string;
    seconds: number;
};

/**
 * 解析时间字符串
 */
export function parseTimeString(timeStr: string): number {
    const now = Date.now();

    if (timeStr === 'now') {
        return now;
    }

    const match = timeStr.match(/now-(\d+)([smhd])/);
    if (match) {
        const value = parseInt(match[1], 10);
        const unit = match[2];

        const multipliers = {
            s: 1000,
            m: 60 * 1000,
            h: 60 * 60 * 1000,
            d: 24 * 60 * 60 * 1000
        };

        return now - (value * multipliers[unit as keyof typeof multipliers]);
    }

    return now;
}

/**
 * 解析时间范围字符串为毫秒
 */
export function parseDurationMs(timeRange: string): number {
    const parts = timeRange.split(',');
    if (parts.length !== 2) {
        return 15 * 60 * 1000;
    }

    const start = parseTimeString(parts[0]);
    const end = parseTimeString(parts[1]);
    return end - start;
}

/**
 * 选择合适的时间桶
 */
export function chooseBucket(durationMs: number): TimeBucket {
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
