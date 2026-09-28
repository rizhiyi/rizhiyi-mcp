import fs from 'node:fs';
import yaml from 'js-yaml';

/**
 * 跨实现共享常量加载器。
 *
 * 常量定义在仓库根目录的 `config/analysis-constants.yaml`，TypeScript 与 Python
 * 两侧读取同一份文件，从结构上避免算法阈值/默认值再次漂移。
 * Python 侧对应实现见 `python/rizhiyi_mcp/analysis_constants.py`。
 */

export interface TimeBucketRule {
    maxMs: number | null;
    bin: string;
    seconds: number;
}

export interface AnalysisConstants {
    timeBuckets: TimeBucketRule[];
    zScoreMinSamples: number;
    zScoreDefaultThreshold: number;
    confidenceZValues: Array<{ minConfidence: number; z: number }>;
    movingAverageMinWindow: number;
    movingAverageClampToLength: boolean;
    panelSize: {
        defaultWidth: number;
        defaultHeight: number;
        minWidth: number;
        minHeight: number;
        integerOnly: boolean;
    };
}

const CONSTANTS_FILE_URL = new URL('../../../config/analysis-constants.yaml', import.meta.url);

function requireNumber(value: unknown, path: string): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new Error(`analysis-constants.yaml 的 ${path} 必须是数字`);
    }
    return value;
}

function parseConstants(raw: unknown): AnalysisConstants {
    if (!raw || typeof raw !== 'object') {
        throw new Error('analysis-constants.yaml 顶层必须是对象');
    }
    const root = raw as Record<string, any>;

    const rawBuckets = root.time_buckets;
    if (!Array.isArray(rawBuckets) || rawBuckets.length === 0) {
        throw new Error('analysis-constants.yaml 的 time_buckets 必须是非空数组');
    }
    const timeBuckets: TimeBucketRule[] = rawBuckets.map((item: any, index: number) => {
        const label = `time_buckets[${index}]`;
        if (!item || typeof item !== 'object') {
            throw new Error(`analysis-constants.yaml 的 ${label} 必须是对象`);
        }
        if (typeof item.bin !== 'string' || !item.bin) {
            throw new Error(`analysis-constants.yaml 的 ${label}.bin 必须是非空字符串`);
        }
        const maxMs = item.max_ms === null || typeof item.max_ms === 'undefined'
            ? null
            : requireNumber(item.max_ms, `${label}.max_ms`);
        return {
            maxMs,
            bin: item.bin,
            seconds: requireNumber(item.seconds, `${label}.seconds`)
        };
    });
    // 兜底档位必须存在，否则超长时间窗无法选桶
    if (timeBuckets.filter((bucket) => bucket.maxMs === null).length !== 1) {
        throw new Error('analysis-constants.yaml 的 time_buckets 必须恰好包含一个 max_ms 为 null 的兜底档位');
    }

    const statistics = root.statistics;
    if (!statistics || typeof statistics !== 'object') {
        throw new Error('analysis-constants.yaml 缺少 statistics 段');
    }
    const rawZValues = statistics.confidence_z_values;
    if (!Array.isArray(rawZValues) || rawZValues.length === 0) {
        throw new Error('analysis-constants.yaml 的 statistics.confidence_z_values 必须是非空数组');
    }
    const confidenceZValues = rawZValues.map((item: any, index: number) => ({
        minConfidence: requireNumber(item?.min_confidence, `confidence_z_values[${index}].min_confidence`),
        z: requireNumber(item?.z, `confidence_z_values[${index}].z`)
    }));
    // 按 min_confidence 降序，保证"第一个满足 confidence >= min_confidence"语义稳定
    confidenceZValues.sort((left, right) => right.minConfidence - left.minConfidence);

    const movingAverage = statistics.moving_average ?? {};
    const rawPanelSize = root.dashboard_aesthetics?.panel_size;
    if (!rawPanelSize || typeof rawPanelSize !== 'object') {
        throw new Error('analysis-constants.yaml 缺少 dashboard_aesthetics.panel_size 段');
    }

    return {
        timeBuckets,
        zScoreMinSamples: requireNumber(statistics.z_score_min_samples, 'statistics.z_score_min_samples'),
        zScoreDefaultThreshold: requireNumber(statistics.z_score_default_threshold, 'statistics.z_score_default_threshold'),
        confidenceZValues,
        movingAverageMinWindow: requireNumber(movingAverage.min_window, 'statistics.moving_average.min_window'),
        movingAverageClampToLength: movingAverage.clamp_window_to_length !== false,
        panelSize: {
            defaultWidth: requireNumber(rawPanelSize.default_width, 'panel_size.default_width'),
            defaultHeight: requireNumber(rawPanelSize.default_height, 'panel_size.default_height'),
            minWidth: requireNumber(rawPanelSize.min_width, 'panel_size.min_width'),
            minHeight: requireNumber(rawPanelSize.min_height, 'panel_size.min_height'),
            integerOnly: rawPanelSize.integer_only !== false
        }
    };
}

function loadConstants(): AnalysisConstants {
    let content: string;
    try {
        content = fs.readFileSync(CONSTANTS_FILE_URL, 'utf8');
    } catch (error: any) {
        throw new Error(
            `读取 config/analysis-constants.yaml 失败（${CONSTANTS_FILE_URL.pathname}）：${error?.message || error}。`
            + ' 该文件是 TS/Python 共享的算法常量来源，必须随仓库一起部署。'
        );
    }
    return parseConstants(yaml.load(content));
}

export const ANALYSIS_CONSTANTS: AnalysisConstants = loadConstants();

/**
 * 按 durationMs 选择聚合桶，返回 `{ bin, seconds }`。
 * 与 Python `analysis_constants.choose_time_bucket` 行为一致。
 */
export function chooseTimeBucket(durationMs: number): { bin: string; seconds: number } {
    // 非有限值（NaN/Infinity）意味着时间范围无法解析，退回最粗的档位，
    // 避免因解析失败而生成海量聚合桶、把上游查询打爆。
    const safeDuration = Number.isFinite(durationMs) ? durationMs : Number.POSITIVE_INFINITY;
    for (const bucket of ANALYSIS_CONSTANTS.timeBuckets) {
        if (bucket.maxMs === null || safeDuration <= bucket.maxMs) {
            return { bin: bucket.bin, seconds: bucket.seconds };
        }
    }
    // parseConstants 已保证兜底档位存在，这里仅为类型收窄
    const fallback = ANALYSIS_CONSTANTS.timeBuckets[ANALYSIS_CONSTANTS.timeBuckets.length - 1];
    return { bin: fallback.bin, seconds: fallback.seconds };
}

/**
 * 把滑动平均窗口收敛到 `[minWindow, length]`。
 * 与 Python `analysis_constants.resolve_moving_average_window` 行为一致。
 * 窗口大于样本数时收敛到样本数（而不是返回 0），保证小样本也能给出预测值。
 */
export function resolveMovingAverageWindow(window: number, length: number): number {
    const { movingAverageMinWindow, movingAverageClampToLength } = ANALYSIS_CONSTANTS;
    const requested = Number.isFinite(window) ? Math.floor(window) : movingAverageMinWindow;
    const lowerBounded = Math.max(movingAverageMinWindow, requested);
    return movingAverageClampToLength
        ? Math.min(lowerBounded, Math.max(1, length))
        : lowerBounded;
}

/**
 * 按置信度取置信区间的 z 值。与 Python `analysis_constants.z_value_for_confidence` 一致。
 */
export function zValueForConfidence(confidence: number): number {
    const target = Number.isFinite(confidence) ? confidence : 0.95;
    for (const entry of ANALYSIS_CONSTANTS.confidenceZValues) {
        if (target >= entry.minConfidence) {
            return entry.z;
        }
    }
    return ANALYSIS_CONSTANTS.confidenceZValues[ANALYSIS_CONSTANTS.confidenceZValues.length - 1].z;
}

/**
 * 归一化 panel 尺寸：整数化并应用下界。与 Python `analysis_constants.normalize_panel_size` 一致。
 */
export function normalizePanelSize(
    width: unknown,
    height: unknown
): { w: number; h: number } {
    const { defaultWidth, defaultHeight, minWidth, minHeight, integerOnly } = ANALYSIS_CONSTANTS.panelSize;
    const coerce = (value: unknown, fallback: number, min: number): number => {
        const numeric = typeof value === 'number' ? value : Number(value);
        const usable = Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
        const integral = integerOnly ? Math.trunc(usable) : usable;
        return Math.max(min, integral);
    };
    return {
        w: coerce(width, defaultWidth, minWidth),
        h: coerce(height, defaultHeight, minHeight)
    };
}
