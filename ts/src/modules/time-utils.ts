import { chooseTimeBucket } from './analysis-constants.js';

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
 *
 * 档位表来自 config/analysis-constants.yaml，与 Python 实现共用同一份定义，
 * 避免两端在相同时间窗下选出不同粒度。
 */
export function chooseBucket(durationMs: number): TimeBucket {
    return chooseTimeBucket(durationMs);
}
