from __future__ import annotations

import math
from typing import Any

from .dashboard_utils import get_widget_color, get_widget_id, get_widget_title, normalize_dashboard_scheme, normalize_panel_kind


def build_aesthetics_analysis(widgets: list[dict[str, Any]], *, scheme: str | None = None) -> dict[str, Any]:
    items = _extract_items(widgets)
    canvas = _calculate_canvas(items)
    overlap_pairs = _find_overlapping_pairs(items)
    raw_scores = {
        "density": _compute_density_score(items, canvas),
        "symmetry": _compute_symmetry_score(items, canvas),
        "balance": _compute_balance_score(items, canvas),
        "proportionality": _compute_proportionality_score(items),
        "uniformity": _compute_uniformity_score(items, canvas),
        "simplicity": _compute_simplicity_score(len(items)),
        "sequence": _compute_sequence_score(items),
    }
    weights = {
        "density": 0.138,
        "symmetry": 0.185,
        "balance": 0.142,
        "proportionality": 0.167,
        "uniformity": 0.126,
        "simplicity": 0.179,
        "sequence": 0.063,
    }
    overall_raw = sum(raw_scores[key] * weights[key] for key in raw_scores)
    color_analysis = _build_color_analysis(items, scheme)
    issues = _build_issues(items, canvas, raw_scores, overlap_pairs)
    suggestions = _build_suggestions(items, raw_scores, overlap_pairs)
    return {
        "items": items,
        "canvas": canvas,
        "scores": {key: _to_percentage_score(value) for key, value in raw_scores.items()},
        "overallScore": _to_percentage_score(overall_raw),
        "colorAnalysis": color_analysis,
        "issues": issues,
        "suggestions": suggestions,
    }


def _extract_items(widgets: list[dict[str, Any]]) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    for index, widget in enumerate(widgets):
        x = int(widget.get("x", 0) or 0)
        y = int(widget.get("y", 0) or 0)
        w = max(1, int(widget.get("w", 6) or 6))
        h = max(2, int(widget.get("h", 5) or 5))
        chart_type = normalize_panel_kind(widget.get("type"), (widget.get("searchData") or {}).get("chartType"))["chartType"]
        items.append(
            {
                "index": index,
                "id": get_widget_id(widget) or f"panel_{index}",
                "title": get_widget_title(widget) or f"Panel {index + 1}",
                "x": x,
                "y": y,
                "w": w,
                "h": h,
                "right": x + w,
                "bottom": y + h,
                "cx": x + (w / 2),
                "cy": y + (h / 2),
                "area": w * h,
                "chartType": chart_type,
                "color": get_widget_color(widget),
            }
        )
    return items


def _build_color_analysis(items: list[dict[str, Any]], scheme: str | None) -> dict[str, Any]:
    total_area = sum(item["area"] for item in items) or 1
    colored = [item for item in items if item["color"]]
    if not colored:
        return {
            "score": 0,
            "scheme": normalize_dashboard_scheme(scheme),
            "roles": {"main": None, "secondary": None, "accent": None},
            "distribution": {"main": 0, "secondary": 0, "accent": 0, "other": 0, "uncolored": 1},
            "suggestions": [
                {
                    "category": "color",
                    "priority": "high",
                    "message": "当前 tab 里的 panel 还没有设置 chartStartingColor，无法形成稳定的主次层次。",
                }
            ],
        }

    stats: dict[str, dict[str, float]] = {}
    for item in colored:
        stats.setdefault(item["color"], {"count": 0, "area": 0})
        stats[item["color"]]["count"] += 1
        stats[item["color"]]["area"] += item["area"]

    ranked_colors = sorted(stats.items(), key=lambda pair: (-pair[1]["count"], -pair[1]["area"], pair[0]))
    main = ranked_colors[0][0] if ranked_colors else None
    secondary = ranked_colors[1][0] if len(ranked_colors) > 1 else None
    accent = ranked_colors[2][0] if len(ranked_colors) > 2 else None

    distribution = {"main": 0.0, "secondary": 0.0, "accent": 0.0, "other": 0.0, "uncolored": 0.0}
    for item in items:
        if not item["color"]:
            distribution["uncolored"] += item["area"]
        elif item["color"] == main:
            distribution["main"] += item["area"]
        elif item["color"] == secondary:
            distribution["secondary"] += item["area"]
        elif item["color"] == accent:
            distribution["accent"] += item["area"]
        else:
            distribution["other"] += item["area"]
    for key in distribution:
        distribution[key] = _round(distribution[key] / total_area)

    target = {"main": 0.6, "secondary": 0.3, "accent": 0.1}
    error = (
        abs(distribution["main"] - target["main"])
        + abs(distribution["secondary"] - target["secondary"])
        + abs(distribution["accent"] - target["accent"])
        + distribution["other"] * 0.8
        + distribution["uncolored"]
    )
    score = _clamp01(1 - (error / 1.35))

    suggestions: list[dict[str, Any]] = []
    if distribution["uncolored"] > 0.1:
        suggestions.append({"category": "color", "priority": "high", "message": "先给未设置颜色的 panel 补齐 chartStartingColor，整体层次会更稳定。"})
    if distribution["main"] < 0.5:
        suggestions.append({"category": "color", "priority": "medium", "message": f"主色 {main} 覆盖面积偏低，建议让更多核心 panel 复用它。"})
    elif distribution["main"] > 0.75:
        suggestions.append({"category": "color", "priority": "medium", "message": "主色占比偏高，建议把部分次级 panel 调整成辅助色。"})
    if distribution["secondary"] < 0.2:
        suggestions.append({"category": "color", "priority": "low", "message": f"辅助色 {secondary or ''} 的存在感偏弱，可以给非核心 panel 增加过渡层。"})
    if distribution["accent"] > 0.18:
        suggestions.append({"category": "color", "priority": "medium", "message": "强调色面积偏大，建议只保留在少数关键 panel 上。"})
    if not suggestions:
        suggestions.append({"category": "color", "priority": "low", "message": "当前 tab 的配色层次比较稳定，可继续维持主色、辅助色、强调色分工。"})

    return {
        "score": _to_percentage_score(score),
        "scheme": normalize_dashboard_scheme(scheme),
        "roles": {"main": main, "secondary": secondary, "accent": accent},
        "distribution": distribution,
        "suggestions": suggestions,
    }


def _calculate_canvas(items: list[dict[str, Any]]) -> dict[str, Any]:
    width = max([1] + [item["right"] for item in items])
    height = max([1] + [item["bottom"] for item in items])
    return {"width": width, "height": height, "area": width * height}


def _compute_density_score(items: list[dict[str, Any]], canvas: dict[str, Any]) -> float:
    total_area = sum(item["area"] for item in items)
    ratio = total_area / max(canvas["area"], 1)
    if ratio < 0.25:
        return _clamp01(ratio / 0.25)
    if ratio <= 0.55:
        return 1.0
    return _clamp01(1 - ((ratio - 0.55) / 0.45))


def _compute_symmetry_score(items: list[dict[str, Any]], canvas: dict[str, Any]) -> float:
    if len(items) <= 1:
        return 1.0
    center_x = canvas["width"] / 2
    left_items = [item for item in items if item["cx"] < center_x]
    right_pool = [item for item in items if item["cx"] > center_x]
    center_items = [item for item in items if item["cx"] == center_x]
    unmatched_right = list(right_pool)
    deviations: list[float] = []

    for left in left_items:
        target_cx = canvas["width"] - left["cx"]
        best_index = -1
        best_deviation = 1.0
        for index, right in enumerate(unmatched_right):
            center_deviation = abs(right["cx"] - target_cx) / max(canvas["width"], 1)
            vertical_deviation = abs(right["cy"] - left["cy"]) / max(canvas["height"], 1)
            area_deviation = abs(right["area"] - left["area"]) / max(left["area"], right["area"], 1)
            combined = (center_deviation + vertical_deviation + area_deviation) / 3
            if combined < best_deviation:
                best_deviation = combined
                best_index = index
        deviations.append(best_deviation)
        if best_index >= 0:
            unmatched_right.pop(best_index)

    for center_item in center_items:
        deviations.append(abs(center_item["cx"] - center_x) / max(center_x, 1))
    deviations.extend([1.0] * len(unmatched_right))
    if not deviations:
        return 1.0
    return _clamp01(1 - (sum(deviations) / len(deviations)))


def _compute_balance_score(items: list[dict[str, Any]], canvas: dict[str, Any]) -> float:
    center_x = canvas["width"] / 2
    left_moment = 0.0
    right_moment = 0.0
    for item in items:
        if item["cx"] < center_x:
            left_moment += item["area"] * (center_x - item["cx"])
        elif item["cx"] > center_x:
            right_moment += item["area"] * (item["cx"] - center_x)
    denominator = max(left_moment, right_moment, 1e-6)
    return _clamp01(1 - (abs(left_moment - right_moment) / denominator))


def _compute_proportionality_score(items: list[dict[str, Any]]) -> float:
    if not items:
        return 1.0
    golden_ratio = 1.618
    deviations = [abs(max(item["w"] / max(item["h"], 1), item["h"] / max(item["w"], 1)) - golden_ratio) for item in items]
    return _clamp01(1 - (sum(deviations) / len(deviations)))


def _compute_uniformity_score(items: list[dict[str, Any]], canvas: dict[str, Any]) -> float:
    if len(items) <= 1:
        return 1.0
    horizontal_gaps: list[float] = []
    vertical_gaps: list[float] = []
    for item in items:
        nearest_right = None
        nearest_down = None
        for other in items:
            if other["index"] == item["index"]:
                continue
            vertical_overlap = min(item["bottom"], other["bottom"]) - max(item["y"], other["y"])
            if other["x"] >= item["right"] and vertical_overlap > 0:
                gap = other["x"] - item["right"]
                nearest_right = gap if nearest_right is None else min(nearest_right, gap)
            horizontal_overlap = min(item["right"], other["right"]) - max(item["x"], other["x"])
            if other["y"] >= item["bottom"] and horizontal_overlap > 0:
                gap = other["y"] - item["bottom"]
                nearest_down = gap if nearest_down is None else min(nearest_down, gap)
        if nearest_right is not None:
            horizontal_gaps.append(nearest_right)
        if nearest_down is not None:
            vertical_gaps.append(nearest_down)
    if not horizontal_gaps and not vertical_gaps:
        return 1.0
    sigma_x = _stddev(horizontal_gaps)
    sigma_y = _stddev(vertical_gaps)
    parts = [value for value in [sigma_x, sigma_y] if math.isfinite(value)]
    sigma_avg = sum(parts) / max(len(parts), 1)
    threshold = max(canvas["width"] / 10, 1)
    return _clamp01(1 - (sigma_avg / threshold))


def _compute_simplicity_score(widget_count: int) -> float:
    if widget_count < 4:
        return _clamp01(1 - ((4 - widget_count) / 4))
    if widget_count <= 9:
        return 1.0
    return _clamp01(1 - ((widget_count - 9) / 9))


def _compute_sequence_score(items: list[dict[str, Any]]) -> float:
    if len(items) <= 1:
        return 1.0
    ideal_order = [item["index"] for item in sorted(items, key=lambda item: (item["y"], item["x"], item["index"]))]
    total_pairs = (len(ideal_order) * (len(ideal_order) - 1)) / 2
    if total_pairs == 0:
        return 1.0
    inversions = 0
    for i in range(len(ideal_order)):
        for j in range(i + 1, len(ideal_order)):
            if ideal_order[i] > ideal_order[j]:
                inversions += 1
    return _clamp01(1 - (inversions / total_pairs))


def _find_overlapping_pairs(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    pairs: list[dict[str, Any]] = []
    for i in range(len(items)):
        for j in range(i + 1, len(items)):
            a = items[i]
            b = items[j]
            overlaps = a["x"] < b["right"] and a["right"] > b["x"] and a["y"] < b["bottom"] and a["bottom"] > b["y"]
            if overlaps:
                pairs.append({"left": a["title"], "right": b["title"]})
    return pairs


def _build_issues(
    items: list[dict[str, Any]],
    canvas: dict[str, Any],
    raw_scores: dict[str, float],
    overlap_pairs: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    issues: list[dict[str, Any]] = []
    fill_ratio = sum(item["area"] for item in items) / max(canvas["area"], 1)
    if overlap_pairs:
        issues.append({"metric": "layout", "severity": "high", "reason": f'检测到 {len(overlap_pairs)} 组 panel 存在重叠，可能影响阅读和交互。'})
    if raw_scores["density"] < 0.85:
        issues.append({"metric": "density", "severity": _score_to_level(raw_scores["density"]), "reason": f"当前填充率约为 {_round(fill_ratio * 100)}%，布局疏密不够均衡。"})
    if raw_scores["symmetry"] < 0.85:
        issues.append({"metric": "symmetry", "severity": _score_to_level(raw_scores["symmetry"]), "reason": "左右区域的镜像关系较弱，面板呼应不够明显。"})
    if raw_scores["balance"] < 0.85:
        issues.append({"metric": "balance", "severity": _score_to_level(raw_scores["balance"]), "reason": "左右视觉重量分布不均衡，画面重心偏向单侧。"})
    if raw_scores["proportionality"] < 0.85:
        issues.append({"metric": "proportionality", "severity": _score_to_level(raw_scores["proportionality"]), "reason": "部分面板长宽比差异较大，整体比例协调性不足。"})
    if raw_scores["uniformity"] < 0.85:
        issues.append({"metric": "uniformity", "severity": _score_to_level(raw_scores["uniformity"]), "reason": "组件之间的水平或垂直间距不够统一，网格节奏不稳定。"})
    if raw_scores["simplicity"] < 0.85:
        issues.append({"metric": "simplicity", "severity": _score_to_level(raw_scores["simplicity"]), "reason": f"当前共有 {len(items)} 个 panel，层次表达与信息密度还可以继续优化。"})
    if raw_scores["sequence"] < 0.85:
        issues.append({"metric": "sequence", "severity": _score_to_level(raw_scores["sequence"]), "reason": "面板顺序与从左上到右下的阅读流不够一致。"})
    return issues


def _build_suggestions(items: list[dict[str, Any]], raw_scores: dict[str, float], overlap_pairs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    suggestions: list[dict[str, Any]] = []
    if overlap_pairs:
        suggestions.append({"category": "layout", "priority": "high", "message": "先消除面板重叠，再进行其他美化调整，避免遮挡和点击冲突。"})
    if raw_scores["density"] < 0.85:
        suggestions.append({"category": "layout", "priority": _score_to_level(raw_scores["density"]), "message": "重新分配画布空间，减少过度留白或缓解组件拥挤。"})
    if raw_scores["balance"] < 0.85 or raw_scores["symmetry"] < 0.85:
        suggestions.append({"category": "layout", "priority": _score_to_level(min(raw_scores["balance"], raw_scores["symmetry"])), "message": "让左右两侧的组件面积和位置更对称，避免核心视觉重量过度集中在单侧。"})
    if raw_scores["uniformity"] < 0.85:
        suggestions.append({"category": "layout", "priority": _score_to_level(raw_scores["uniformity"]), "message": "统一相邻卡片的间距、宽度和高度，让网格节奏更稳定。"})
    if raw_scores["proportionality"] < 0.85:
        suggestions.append({"category": "layout", "priority": _score_to_level(raw_scores["proportionality"]), "message": "减少过扁或过高的面板，优先复用接近统一比例的卡片尺寸。"})
    if raw_scores["sequence"] < 0.85:
        suggestions.append({"category": "layout", "priority": _score_to_level(raw_scores["sequence"]), "message": "按左上到右下的阅读流重新排序面板，把最重要的内容放在左上或首屏。"})
    if not suggestions:
        suggestions.append({"category": "layout", "priority": "low", "message": "当前布局整体较稳定，可继续微调关键面板面积与位置。"})
    return _deduplicate_suggestions(suggestions)


def _deduplicate_suggestions(suggestions: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: set[str] = set()
    result: list[dict[str, Any]] = []
    for suggestion in suggestions:
        key = f'{suggestion["category"]}|{suggestion["priority"]}|{suggestion["message"]}'
        if key in seen:
            continue
        seen.add(key)
        result.append(suggestion)
    return result


def _stddev(values: list[float]) -> float:
    if len(values) <= 1:
        return 0.0
    mean = sum(values) / len(values)
    variance = sum((value - mean) ** 2 for value in values) / (len(values) - 1)
    return math.sqrt(variance)


def _score_to_level(score: float) -> str:
    if score < 0.5:
        return "high"
    if score < 0.7:
        return "medium"
    return "low"


def _to_percentage_score(score: float) -> float:
    return _round(_clamp01(score) * 100)


def _clamp01(value: float) -> float:
    if not math.isfinite(value):
        return 0.0
    return min(1.0, max(0.0, value))


def _round(value: float) -> float:
    return round(value * 100) / 100
