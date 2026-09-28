#!/usr/bin/env node
/**
 * 跨实现一致性校验（TypeScript 侧）。
 *
 * 目的：把「TS 与 Python 对同一输入必须给出同一结果」变成可自动执行的断言，
 * 而不是靠人工比对（见 CODE_REVIEW.md M8）。
 *
 * 覆盖两层：
 *   1. 共享常量层：时间桶档位 / 置信度 z 值 / 滑动平均窗口 / panel 尺寸 / 浮点格式化
 *   2. 业务输出层：同一组时间序列下 trend_summary、anomaly_points、
 *      trend_forecast、anomaly_alert 的数值与文本输出
 *
 * 做法：本脚本用 TS 实现计算上述内容，与 `config/analysis-parity.golden.json`
 * 逐字段比对；Python 侧由 `python/tests/test_analysis_constants.py` 读取同一份
 * 黄金文件做同样的比对。只要有一端偏离共享常量，两侧的测试都会红。
 *
 * 用法：
 *   npm run test:analysis-parity              # 校验
 *   npm run test:analysis-parity -- --write   # 重新生成黄金文件
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    chooseTimeBucket,
    normalizePanelSize,
    resolveMovingAverageWindow,
    zValueForConfidence
} from '../dist/modules/analysis-constants.js';
import { StatisticsModule, formatFixed, formatPythonFloat } from '../dist/modules/statistics.js';
import { TrendForecastModule } from '../dist/modules/trend-forecast.js';
import { searchTools } from '../dist/tools.js';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..', '..');
const goldenPath = path.join(repoRoot, 'config', 'analysis-parity.golden.json');
const shouldWrite = process.argv.includes('--write');

// ---------------------------------------------------------------------------
// 共享常量层采样
// ---------------------------------------------------------------------------

// 采样点刻意覆盖每档边界（max_ms）与边界 +1ms，避免"只测了中间值"的假通过。
const DURATION_SAMPLES = [
    -1000, 0,
    60000, 60001,
    300000, 300001,
    600000, 600001,
    1800000, 1800001,
    3600000, 3600001,
    7200000, 7200001,
    18000000, 18000001,
    36000000, 36000001,
    86400000, 86400001,
    172800000, 172800001,
    604800000, 604800001
];
const NON_FINITE_DURATIONS = [
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY]
];
const CONFIDENCE_SAMPLES = [1.0, 0.95, 0.9499, 0.9, 0.8999, 0.0, -1.0];
const WINDOW_SAMPLES = [[0, 5], [1, 5], [3, 5], [10, 5], [2.9, 5], [1, 1], [0, 0], [4, 4]];
const PANEL_SAMPLES = [[null, null], [0, 0], [1, 1], [6.5, 3.7], [-3, -4], [12, 8], [2, 2], [0.5, 1.2]];
const FLOAT_SAMPLES = [3, 2.0, 1.5, -3, 0, 2.5, 100];
// 13.625 / 0.125 恰好落在十进制中点，用来锁定 Python 的 round-half-to-even 语义
const FIXED_SAMPLES = [[13.625, 2], [0.125, 2], [2.5, 0], [3.5, 0], [-0.125, 2], [1.005, 2], [40, 2], [-0.27380952380952384, 3]];

// ---------------------------------------------------------------------------
// 业务输出层采样
// ---------------------------------------------------------------------------

const BUSINESS_SERIES = [
    { timestamp: '2024-01-01T00:00:00Z', value: 10 },
    { timestamp: '2024-01-01T00:05:00Z', value: 12 },
    { timestamp: '2024-01-01T00:10:00Z', value: 9 },
    { timestamp: '2024-01-01T00:15:00Z', value: 40 },
    { timestamp: '2024-01-01T00:20:00Z', value: 11 },
    { timestamp: '2024-01-01T00:25:00Z', value: 0 },
    { timestamp: '2024-01-01T00:30:00Z', value: 13 },
    { timestamp: '2024-01-01T00:35:00Z', value: 14 }
];

// 回声字段（原始序列）在两端都只是原样回传，留在黄金文件里只会制造噪音
const ECHO_KEYS = ['series', 'values', 'timestamps', 'source_series'];

/**
 * `bucket` 参数的 schema 契约：6 个时序工具都应当**不声明默认值**，
 * 从而让 `chooseTimeBucket` 的自适应选桶真正生效。
 * 若某一端偷偷加回 `default: '5m'`，这一节会立刻变红。
 */
function collectBucketSchemas() {
    return searchTools
        .filter((tool) => tool.inputSchema?.properties?.bucket)
        .map((tool) => ({
            name: tool.name,
            declaresDefault: Object.prototype.hasOwnProperty.call(
                tool.inputSchema.properties.bucket,
                'default'
            ),
            required: (tool.inputSchema.required || []).includes('bucket')
        }))
        .sort((left, right) => left.name.localeCompare(right.name));
}

function stripEcho(data) {
    const copy = { ...data };
    for (const key of ECHO_KEYS) {
        delete copy[key];
    }
    return copy;
}

async function buildBusinessOutputs() {
    const statistics = new StatisticsModule(null);
    const trendForecast = new TrendForecastModule(null);
    const series = BUSINESS_SERIES;

    const trendSummary = await statistics.executeTrendSummaryWithData(series, 3);
    const zscore = await statistics.executeAnomalyPointsWithData(series, 'zscore', 3, 0);
    const iqr = await statistics.executeAnomalyPointsWithData(series, 'iqr', 1.5, 0);
    const movingAverage = await trendForecast.executeTrendForecastWithData({
        time_series: series,
        horizon: 3,
        method: 'moving_average',
        window: 20
    });
    const linearRegression = await trendForecast.executeTrendForecastWithData({
        time_series: series,
        horizon: 3,
        method: 'linear_regression',
        confidence: 0.9
    });
    const exponentialSmoothing = await trendForecast.executeTrendForecastWithData({
        time_series: series,
        horizon: 3,
        method: 'exponential_smoothing',
        alpha: 0.4
    });
    const adaptiveAlert = await trendForecast.executeAnomalyAlertWithData({
        time_series: series,
        method: 'adaptive',
        threshold: 3,
        alert_on: 'both',
        min_anomaly_points: 2,
        forecast_horizon: 4
    });
    // min_anomaly_points=1 让告警真正触发，覆盖 alert_reasons 非空的分支
    const adaptiveAlertTriggered = await trendForecast.executeAnomalyAlertWithData({
        time_series: series,
        method: 'adaptive',
        threshold: 3,
        alert_on: 'both',
        min_anomaly_points: 1,
        forecast_horizon: 4
    });
    const predictionBandAlert = await trendForecast.executeAnomalyAlertWithData({
        time_series: series,
        method: 'prediction_band',
        threshold: 3,
        alert_on: 'lower',
        min_anomaly_points: 1,
        forecast_horizon: 4
    });

    const unwrap = (response) => {
        if (!response || response.error) {
            return { error: response?.error, message: response?.message };
        }
        return stripEcho(response.data);
    };

    return {
        trendSummary: unwrap(trendSummary),
        anomalyPointsZscore: unwrap(zscore),
        anomalyPointsIqr: unwrap(iqr),
        trendForecastMovingAverage: unwrap(movingAverage),
        trendForecastLinearRegression: unwrap(linearRegression),
        trendForecastExponentialSmoothing: unwrap(exponentialSmoothing),
        anomalyAlertAdaptive: unwrap(adaptiveAlert),
        anomalyAlertAdaptiveTriggered: unwrap(adaptiveAlertTriggered),
        anomalyAlertPredictionBand: unwrap(predictionBandAlert)
    };
}

// ---------------------------------------------------------------------------

async function buildSnapshot() {
    return {
        version: 1,
        timeBuckets: DURATION_SAMPLES.map((durationMs) => {
            const { bin, seconds } = chooseTimeBucket(durationMs);
            return { durationMs, bin, seconds };
        }),
        nonFiniteDurations: NON_FINITE_DURATIONS.map(([label, value]) => {
            const { bin, seconds } = chooseTimeBucket(value);
            return { input: label, bin, seconds };
        }),
        zValues: CONFIDENCE_SAMPLES.map((confidence) => ({
            confidence,
            z: zValueForConfidence(confidence)
        })),
        movingAverageWindows: WINDOW_SAMPLES.map(([window, length]) => ({
            window,
            length,
            resolved: resolveMovingAverageWindow(window, length)
        })),
        panelSizes: PANEL_SAMPLES.map(([w, h]) => {
            const size = normalizePanelSize(w, h);
            return { w, h, resolvedW: size.w, resolvedH: size.h };
        }),
        formattedFloats: FLOAT_SAMPLES.map((input) => ({
            input,
            text: formatPythonFloat(input)
        })),
        formattedFixed: FIXED_SAMPLES.map(([value, digits]) => ({
            value,
            digits,
            text: formatFixed(value, digits)
        })),
        timechartBucketSchemas: collectBucketSchemas(),
        businessOutputs: await buildBusinessOutputs()
    };
}

async function main() {
    const actual = await buildSnapshot();

    if (shouldWrite) {
        fs.writeFileSync(goldenPath, `${JSON.stringify(actual, null, 2)}\n`, 'utf8');
        console.log(`已写入黄金文件：${path.relative(repoRoot, goldenPath)}`);
        return;
    }

    if (!fs.existsSync(goldenPath)) {
        console.error(`缺少黄金文件 ${path.relative(repoRoot, goldenPath)}，请先运行：npm run test:analysis-parity -- --write`);
        process.exit(1);
    }

    const golden = JSON.parse(fs.readFileSync(goldenPath, 'utf8'));
    try {
        assert.deepStrictEqual(actual, golden);
    } catch (error) {
        console.error('TS 实现与共享常量黄金文件不一致：');
        console.error(error.message);
        console.error('\n若确认共享常量已按预期变更，请运行：npm run test:analysis-parity -- --write');
        process.exit(1);
    }

    const checked = actual.timeBuckets.length
        + actual.nonFiniteDurations.length
        + actual.zValues.length
        + actual.movingAverageWindows.length
        + actual.panelSizes.length
        + actual.formattedFloats.length
        + actual.formattedFixed.length
        + actual.timechartBucketSchemas.length
        + Object.keys(actual.businessOutputs).length;
    console.log(`跨实现一致性校验通过（TS 侧，共 ${checked} 个采样点）。`);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
