"""跨实现一致性校验（Python 侧）。

读取 ``config/analysis-parity.golden.json``（由
``ts/scripts/analysis-parity-test.mjs --write`` 生成），用 Python 实现重新计算同一组
输入，断言结果与 TypeScript 侧逐字段一致。

这套测试是 CODE_REVIEW.md M8「双实现漂移」的护栏：任何一端偷偷改掉算法阈值或
默认值，都会让这一侧的断言变红，从而把"人肉比对"变成"自动发现"。

注意：业务输出层是逐位比对浮点结果，前提是两端的求和顺序一致（Python 内置
``sum()`` 在 3.12 起对浮点改用 Neumaier 补偿求和，TS 侧是朴素累加）。当前项目
使用 Python 3.11，二者一致；若将来升级到 3.12+ 且出现尾差，需要把分析路径里的
``sum()`` 换成显式的朴素累加，而不是放宽这里的断言。
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from rizhiyi_mcp.analysis_constants import (
    choose_time_bucket,
    get_analysis_constants,
    normalize_panel_size,
    resolve_moving_average_window,
    z_value_for_confidence,
)
from rizhiyi_mcp.log_tools_business import LogToolsBusinessService, _format_float
from rizhiyi_mcp.log_tools_definitions import SEARCH_TOOLS

_REPO_ROOT = Path(__file__).resolve().parents[2]
_GOLDEN_PATH = _REPO_ROOT / "config" / "analysis-parity.golden.json"

# 黄金文件里用字符串表示无法用 JSON 表达的非有限值
_NON_FINITE_DURATIONS: dict[str, float] = {
    "NaN": float("nan"),
    "Infinity": float("inf"),
    "-Infinity": float("-inf"),
}

# 与 ts/scripts/analysis-parity-test.mjs 保持同一组输入
_BUSINESS_SERIES: list[dict[str, Any]] = [
    {"timestamp": "2024-01-01T00:00:00Z", "value": 10},
    {"timestamp": "2024-01-01T00:05:00Z", "value": 12},
    {"timestamp": "2024-01-01T00:10:00Z", "value": 9},
    {"timestamp": "2024-01-01T00:15:00Z", "value": 40},
    {"timestamp": "2024-01-01T00:20:00Z", "value": 11},
    {"timestamp": "2024-01-01T00:25:00Z", "value": 0},
    {"timestamp": "2024-01-01T00:30:00Z", "value": 13},
    {"timestamp": "2024-01-01T00:35:00Z", "value": 14},
]

# 回声字段（原始序列）两端都只是原样回传，留在黄金文件里只会制造噪音
_ECHO_KEYS = ("series", "values", "timestamps", "source_series")


async def _unused_request_json(*args: Any, **kwargs: Any) -> Any:
    raise AssertionError("一致性测试不应触发真实请求")


def _strip_echo(payload: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in payload.items() if key not in _ECHO_KEYS}


def _unwrap(response: Any) -> dict[str, Any]:
    if response.error or response.data is None:
        return {"error": response.error, "message": response.message}
    return _strip_echo(response.data)


def _collect_bucket_schemas() -> list[dict[str, Any]]:
    """`bucket` 参数的 schema 契约（与 TS 侧 ``collectBucketSchemas`` 对应）。

    6 个时序工具都应当**不声明默认值**，让按 time_range 的自适应选桶真正生效。
    """
    rows: list[dict[str, Any]] = []
    for tool in SEARCH_TOOLS:
        properties = (tool.input_schema or {}).get("properties") or {}
        if "bucket" not in properties:
            continue
        rows.append(
            {
                "name": tool.name,
                "declaresDefault": "default" in properties["bucket"],
                "required": "bucket" in ((tool.input_schema or {}).get("required") or []),
            }
        )
    return sorted(rows, key=lambda row: row["name"])


@pytest.fixture(scope="module")
def golden() -> dict[str, Any]:
    if not _GOLDEN_PATH.exists():
        pytest.skip(
            f"缺少 {_GOLDEN_PATH}，请先运行："
            "npm --prefix ts run test:analysis-parity -- --write"
        )
    return json.loads(_GOLDEN_PATH.read_text(encoding="utf-8"))


def test_time_bucket_parity(golden: dict[str, Any]) -> None:
    actual = []
    for sample in golden["timeBuckets"]:
        bin_value, seconds = choose_time_bucket(sample["durationMs"])
        actual.append({"durationMs": sample["durationMs"], "bin": bin_value, "seconds": seconds})
    assert actual == golden["timeBuckets"]


def test_non_finite_duration_parity(golden: dict[str, Any]) -> None:
    actual = []
    for sample in golden["nonFiniteDurations"]:
        duration = _NON_FINITE_DURATIONS[sample["input"]]
        bin_value, seconds = choose_time_bucket(duration)
        actual.append({"input": sample["input"], "bin": bin_value, "seconds": seconds})
    assert actual == golden["nonFiniteDurations"]


def test_z_value_parity(golden: dict[str, Any]) -> None:
    actual = [
        {"confidence": sample["confidence"], "z": z_value_for_confidence(sample["confidence"])}
        for sample in golden["zValues"]
    ]
    assert actual == golden["zValues"]


def test_moving_average_window_parity(golden: dict[str, Any]) -> None:
    actual = [
        {
            "window": sample["window"],
            "length": sample["length"],
            "resolved": resolve_moving_average_window(sample["window"], sample["length"]),
        }
        for sample in golden["movingAverageWindows"]
    ]
    assert actual == golden["movingAverageWindows"]


def test_panel_size_parity(golden: dict[str, Any]) -> None:
    actual = []
    for sample in golden["panelSizes"]:
        width, height = normalize_panel_size(sample["w"], sample["h"])
        actual.append(
            {
                "w": sample["w"],
                "h": sample["h"],
                "resolvedW": width,
                "resolvedH": height,
            }
        )
    assert actual == golden["panelSizes"]


def test_float_format_parity(golden: dict[str, Any]) -> None:
    """异常原因文本里的数字格式化必须与 TS ``formatPythonFloat`` 完全一致。"""
    actual = [
        {"input": sample["input"], "text": _format_float(sample["input"])}
        for sample in golden["formattedFloats"]
    ]
    assert actual == golden["formattedFloats"]


def test_fixed_format_parity(golden: dict[str, Any]) -> None:
    """定点格式化必须与 TS ``formatFixed`` 一致（Python 的 round-half-to-even）。"""
    actual = [
        {
            "value": sample["value"],
            "digits": sample["digits"],
            "text": f"{sample['value']:.{sample['digits']}f}",
        }
        for sample in golden["formattedFixed"]
    ]
    assert actual == golden["formattedFixed"]


def test_bucket_schema_parity(golden: dict[str, Any]) -> None:
    """`bucket` 参数的 schema 契约必须与 TS 侧一致。"""
    assert _collect_bucket_schemas() == golden["timechartBucketSchemas"]


def test_bucket_schema_has_no_default() -> None:
    """6 个时序工具都不应声明 bucket 默认值，否则自适应选桶会被旁路。"""
    rows = _collect_bucket_schemas()
    assert len(rows) == 6, f"预期 6 个带 bucket 参数的时序工具，实际 {len(rows)} 个"
    for row in rows:
        assert row["declaresDefault"] is False, f"{row['name']} 不应声明 bucket 默认值"
        assert row["required"] is False, f"{row['name']} 的 bucket 应为可选参数"


async def test_business_output_parity(golden: dict[str, Any]) -> None:
    """同一组时间序列下，两端业务输出必须逐字段一致。

    覆盖 CODE_REVIEW.md M8 里"输出结构"相关的全部漂移点：
    趋势摘要文本、peaks/anomalies 的 timestamp、异常原因文本、
    置信区间 z 值、预测步数收敛、告警原因仅在触发时返回。
    """
    service = LogToolsBusinessService(_unused_request_json)
    series = _BUSINESS_SERIES

    actual = {
        "trendSummary": _unwrap(service.execute_trend_summary_with_data(series, limit_peaks=3)),
        "anomalyPointsZscore": _unwrap(
            service.execute_anomaly_points_with_data(series, method="zscore", sensitivity=3, min_support=0)
        ),
        "anomalyPointsIqr": _unwrap(
            service.execute_anomaly_points_with_data(series, method="iqr", sensitivity=1.5, min_support=0)
        ),
        "trendForecastMovingAverage": _unwrap(
            service.execute_trend_forecast_with_data(
                series, horizon=3, method="moving_average", window=20
            )
        ),
        "trendForecastLinearRegression": _unwrap(
            service.execute_trend_forecast_with_data(
                series, horizon=3, method="linear_regression", confidence=0.9
            )
        ),
        "trendForecastExponentialSmoothing": _unwrap(
            service.execute_trend_forecast_with_data(
                series, horizon=3, method="exponential_smoothing", alpha=0.4
            )
        ),
        "anomalyAlertAdaptive": _unwrap(
            service.execute_anomaly_alert_with_data(
                series,
                method="adaptive",
                threshold=3,
                alert_on="both",
                min_anomaly_points=2,
                forecast_horizon=4,
            )
        ),
        # min_anomaly_points=1 让告警真正触发，覆盖 alert_reasons 非空的分支
        "anomalyAlertAdaptiveTriggered": _unwrap(
            service.execute_anomaly_alert_with_data(
                series,
                method="adaptive",
                threshold=3,
                alert_on="both",
                min_anomaly_points=1,
                forecast_horizon=4,
            )
        ),
        "anomalyAlertPredictionBand": _unwrap(
            service.execute_anomaly_alert_with_data(
                series,
                method="prediction_band",
                threshold=3,
                alert_on="lower",
                min_anomaly_points=1,
                forecast_horizon=4,
            )
        ),
    }

    assert actual == golden["businessOutputs"]


def test_bucket_table_invariants() -> None:
    """档位表自身的结构约束：严格递增 + 恰好一个兜底档。"""
    constants = get_analysis_constants()
    buckets = constants.time_buckets
    assert len(buckets) >= 2

    fallbacks = [bucket for bucket in buckets if bucket.max_ms is None]
    assert len(fallbacks) == 1, "必须有且仅有一个 max_ms 为 null 的兜底档位"
    assert buckets[-1].max_ms is None, "兜底档位必须是最后一档"

    bounded = [bucket for bucket in buckets if bucket.max_ms is not None]
    limits = [bucket.max_ms for bucket in bounded]
    assert limits == sorted(limits), "max_ms 必须严格递增"
    assert len(set(limits)) == len(limits), "max_ms 不允许重复"
    assert all(bucket.seconds > 0 for bucket in buckets), "档位秒数必须为正"


def test_z_value_table_is_sorted_by_confidence_desc() -> None:
    constants = get_analysis_constants()
    confidences = [min_confidence for min_confidence, _ in constants.confidence_z_values]
    assert confidences == sorted(confidences, reverse=True)
    assert confidences[-1] == 0.0, "最低一档必须是 0.0，保证任意置信度都有兜底 z 值"


def test_panel_size_rules_are_self_consistent() -> None:
    rules = get_analysis_constants().panel_size
    assert rules.default_width >= rules.min_width
    assert rules.default_height >= rules.min_height
    assert rules.min_width >= 1
    assert rules.min_height >= 1
