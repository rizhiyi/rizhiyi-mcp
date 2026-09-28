"""跨实现共享常量加载器。

常量定义在仓库根目录的 ``config/analysis-constants.yaml``，TypeScript 与 Python
两侧读取同一份文件，从结构上避免算法阈值/默认值再次漂移。
TypeScript 侧对应实现见 ``ts/src/modules/analysis-constants.ts``。
"""

from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
import math
from pathlib import Path
from typing import Any

import yaml

_REPO_ROOT = Path(__file__).resolve().parents[2]
_CONSTANTS_PATH = _REPO_ROOT / "config" / "analysis-constants.yaml"


@dataclass(frozen=True, slots=True)
class TimeBucketRule:
    max_ms: int | None
    bin: str
    seconds: int


@dataclass(frozen=True, slots=True)
class PanelSizeRules:
    default_width: int
    default_height: int
    min_width: int
    min_height: int
    integer_only: bool


@dataclass(frozen=True, slots=True)
class AnalysisConstants:
    time_buckets: tuple[TimeBucketRule, ...]
    z_score_min_samples: int
    z_score_default_threshold: float
    confidence_z_values: tuple[tuple[float, float], ...]
    moving_average_min_window: int
    moving_average_clamp_to_length: bool
    panel_size: PanelSizeRules


def _require_number(value: Any, path: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"analysis-constants.yaml 的 {path} 必须是数字")
    return float(value)


def _require_int(value: Any, path: str) -> int:
    number = _require_number(value, path)
    if number != int(number):
        raise ValueError(f"analysis-constants.yaml 的 {path} 必须是整数")
    return int(number)


def _require_mapping(value: Any, path: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError(f"analysis-constants.yaml 的 {path} 必须是对象")
    return value


def _parse_constants(raw: Any) -> AnalysisConstants:
    root = _require_mapping(raw, "顶层")

    raw_buckets = root.get("time_buckets")
    if not isinstance(raw_buckets, list) or not raw_buckets:
        raise ValueError("analysis-constants.yaml 的 time_buckets 必须是非空数组")
    time_buckets: list[TimeBucketRule] = []
    for index, item in enumerate(raw_buckets):
        label = f"time_buckets[{index}]"
        entry = _require_mapping(item, label)
        bin_value = entry.get("bin")
        if not isinstance(bin_value, str) or not bin_value:
            raise ValueError(f"analysis-constants.yaml 的 {label}.bin 必须是非空字符串")
        raw_max = entry.get("max_ms")
        max_ms = None if raw_max is None else _require_int(raw_max, f"{label}.max_ms")
        time_buckets.append(
            TimeBucketRule(
                max_ms=max_ms,
                bin=bin_value,
                seconds=_require_int(entry.get("seconds"), f"{label}.seconds"),
            )
        )
    # 兜底档位必须存在，否则超长时间窗无法选桶
    if sum(1 for bucket in time_buckets if bucket.max_ms is None) != 1:
        raise ValueError(
            "analysis-constants.yaml 的 time_buckets 必须恰好包含一个 max_ms 为 null 的兜底档位"
        )

    statistics = _require_mapping(root.get("statistics"), "statistics")

    raw_z_values = statistics.get("confidence_z_values")
    if not isinstance(raw_z_values, list) or not raw_z_values:
        raise ValueError("analysis-constants.yaml 的 statistics.confidence_z_values 必须是非空数组")
    confidence_z_values: list[tuple[float, float]] = []
    for index, item in enumerate(raw_z_values):
        entry = _require_mapping(item, f"confidence_z_values[{index}]")
        confidence_z_values.append(
            (
                _require_number(entry.get("min_confidence"), f"confidence_z_values[{index}].min_confidence"),
                _require_number(entry.get("z"), f"confidence_z_values[{index}].z"),
            )
        )
    # 按 min_confidence 降序，保证"第一个满足 confidence >= min_confidence"语义稳定
    confidence_z_values.sort(key=lambda pair: pair[0], reverse=True)

    moving_average = _require_mapping(statistics.get("moving_average", {}), "statistics.moving_average")
    raw_panel_size = _require_mapping(
        _require_mapping(root.get("dashboard_aesthetics"), "dashboard_aesthetics").get("panel_size"),
        "dashboard_aesthetics.panel_size",
    )

    return AnalysisConstants(
        time_buckets=tuple(time_buckets),
        z_score_min_samples=_require_int(statistics.get("z_score_min_samples"), "statistics.z_score_min_samples"),
        z_score_default_threshold=_require_number(
            statistics.get("z_score_default_threshold"), "statistics.z_score_default_threshold"
        ),
        confidence_z_values=tuple(confidence_z_values),
        moving_average_min_window=_require_int(
            moving_average.get("min_window"), "statistics.moving_average.min_window"
        ),
        moving_average_clamp_to_length=moving_average.get("clamp_window_to_length", True) is not False,
        panel_size=PanelSizeRules(
            default_width=_require_int(raw_panel_size.get("default_width"), "panel_size.default_width"),
            default_height=_require_int(raw_panel_size.get("default_height"), "panel_size.default_height"),
            min_width=_require_int(raw_panel_size.get("min_width"), "panel_size.min_width"),
            min_height=_require_int(raw_panel_size.get("min_height"), "panel_size.min_height"),
            integer_only=raw_panel_size.get("integer_only", True) is not False,
        ),
    )


@lru_cache(maxsize=1)
def get_analysis_constants() -> AnalysisConstants:
    if not _CONSTANTS_PATH.exists():
        raise FileNotFoundError(
            f"读取 config/analysis-constants.yaml 失败（{_CONSTANTS_PATH}）。"
            " 该文件是 TS/Python 共享的算法常量来源，必须随仓库一起部署。"
        )
    with _CONSTANTS_PATH.open("r", encoding="utf-8") as handle:
        raw = yaml.safe_load(handle)
    return _parse_constants(raw)


def choose_time_bucket(duration_ms: float) -> tuple[str, int]:
    """按 duration_ms 选择聚合桶，返回 ``(bin, seconds)``。

    与 TypeScript ``analysis-constants.chooseTimeBucket`` 行为一致。
    """
    try:
        numeric = float(duration_ms)
    except (TypeError, ValueError):
        numeric = float("inf")
    # 非有限值（NaN/±Infinity）意味着时间范围无法解析，退回最粗的档位，
    # 避免因解析失败而生成海量聚合桶、把上游查询打爆。
    safe_duration = numeric if math.isfinite(numeric) else float("inf")
    constants = get_analysis_constants()
    for bucket in constants.time_buckets:
        if bucket.max_ms is None or safe_duration <= bucket.max_ms:
            return (bucket.bin, bucket.seconds)
    fallback = constants.time_buckets[-1]
    return (fallback.bin, fallback.seconds)


def resolve_moving_average_window(window: float, length: int) -> int:
    """把滑动平均窗口收敛到 ``[min_window, length]``。

    与 TypeScript ``analysis-constants.resolveMovingAverageWindow`` 一致。
    窗口大于样本数时收敛到样本数（而不是返回 0），保证小样本也能给出预测值。
    """
    constants = get_analysis_constants()
    try:
        requested = int(float(window))
    except (TypeError, ValueError):
        requested = constants.moving_average_min_window
    lower_bounded = max(constants.moving_average_min_window, requested)
    if constants.moving_average_clamp_to_length:
        return min(lower_bounded, max(1, length))
    return lower_bounded


def z_value_for_confidence(confidence: float) -> float:
    """按置信度取置信区间的 z 值。与 TypeScript ``zValueForConfidence`` 一致。"""
    try:
        target = float(confidence)
    except (TypeError, ValueError):
        target = 0.95
    constants = get_analysis_constants()
    for min_confidence, z_value in constants.confidence_z_values:
        if target >= min_confidence:
            return z_value
    return constants.confidence_z_values[-1][1]


def normalize_panel_size(width: Any, height: Any) -> tuple[int, int]:
    """归一化 panel 尺寸：整数化并应用下界。

    与 TypeScript ``normalizePanelSize`` 一致。
    """
    rules = get_analysis_constants().panel_size

    def coerce(value: Any, fallback: int, minimum: int) -> int:
        try:
            numeric = float(value)
        except (TypeError, ValueError):
            numeric = float("nan")
        usable = numeric if numeric == numeric and numeric > 0 else float(fallback)
        integral = int(usable)
        return max(minimum, integral)

    return (
        coerce(width, rules.default_width, rules.min_width),
        coerce(height, rules.default_height, rules.min_height),
    )
