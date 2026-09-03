from __future__ import annotations

import math
from typing import Any

from .dashboard_utils import (
    DASHBOARD_SCHEME_COLORS,
    DEFAULT_DASHBOARD_SCHEME,
    get_widget_color,
    get_widget_id,
    get_widget_title,
    normalize_dashboard_scheme,
    normalize_panel_kind,
)

_COLOR_DISTRIBUTION_TARGETS: dict[str, float] = {"main": 0.6, "secondary": 0.3, "accent": 0.1}
_SECONDARY_HUE_OFFSETS: list[int] = [120, 135, 150, -120, -135, -150]
_ACCENT_HUE_OFFSETS: list[int] = [60, -60]
_MIN_DARK_CONTRAST: float = 4.5
_DARK_BACKGROUND_COLOR: str = "#0B1220"
_DEFAULT_SINGLE_GRID_PX_PER_H: float = 105.0
_DEFAULT_SINGLE_HEADER_CHROME_PX: float = 38.0
_DEFAULT_SINGLE_FONT_SIZE_PX: float = 60.0
_SINGLE_HEIGHT_RATIO_COMFORT_MIN: float = 0.22
_SINGLE_HEIGHT_RATIO_ACCEPTABLE_MAX: float = 0.48


def build_aesthetics_analysis(widgets: list[dict[str, Any]], *, scheme: str | None = None) -> dict[str, Any]:
    items = _extract_items(widgets)
    canvas = _calculate_canvas(items)
    overlap_pairs = _find_overlapping_pairs(items)
    density = _compute_density_score(items, canvas)
    symmetry = _compute_symmetry_score(items, canvas)
    balance = _compute_balance_score(items, canvas)
    proportionality = _compute_proportionality_score(items)
    uniformity = _compute_uniformity_score(items, canvas)
    simplicity = _compute_simplicity_score(len(items))
    sequence = _compute_sequence_score(items)
    raw_scores: dict[str, float] = {
        "density": density,
        "symmetry": symmetry,
        "balance": balance,
        "proportionality": proportionality,
        "uniformity": uniformity,
        "simplicity": simplicity,
        "sequence": sequence,
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
    return {
        "items": items,
        "canvas": canvas,
        "scores": {key: _to_percentage_score(value) for key, value in raw_scores.items()},
        "overallScore": _to_percentage_score(overall_raw),
        "colorAnalysis": _build_color_analysis(items, scheme),
        "issues": _build_issues(items, canvas, raw_scores, overlap_pairs),
        "suggestions": _build_suggestions(items, raw_scores, overlap_pairs),
    }


# ---------------------------------------------------------------------------
# Item extraction
# ---------------------------------------------------------------------------

def _extract_items(widgets: list[dict[str, Any]]) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    for index, widget in enumerate(widgets):
        x = int(widget.get("x", 0) or 0)
        y = int(widget.get("y", 0) or 0)
        w = max(1, int(widget.get("w", 6) or 6))
        h = max(2, int(widget.get("h", 5) or 5))
        area = w * h
        normalized = normalize_panel_kind(widget.get("type") or widget.get("panel_type"), _get_chart_type(widget))
        chart_type = normalized["chartType"]
        single_value_font_size = _get_single_value_font_size(widget) if chart_type == "single" else None
        single_value_height_ratio = (
            _estimate_single_value_height_ratio(h, single_value_font_size or _DEFAULT_SINGLE_FONT_SIZE_PX)
            if chart_type == "single"
            else None
        )
        effective_area_factor = (
            _clamp01(single_value_height_ratio)
            if chart_type == "single" and single_value_height_ratio is not None
            else 1.0
        )
        items.append({
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
            "area": area,
            "effectiveArea": area * effective_area_factor,
            "effectiveAreaFactor": effective_area_factor,
            "chartType": chart_type,
            "singleValueFontSize": single_value_font_size,
            "singleValueHeightRatio": single_value_height_ratio,
            "color": get_widget_color(widget),
        })
    return items


def _get_chart_type(widget: dict[str, Any]) -> str | None:
    search_data = widget.get("searchData") if isinstance(widget.get("searchData"), dict) else {}
    chart = widget.get("chart") if isinstance(widget.get("chart"), dict) else {}
    return search_data.get("chartType") or chart.get("chartType") or chart.get("showType")


def _get_single_value_font_size(widget: dict[str, Any]) -> float | None:
    search_data = widget.get("searchData") if isinstance(widget.get("searchData"), dict) else {}
    chart = widget.get("chart") if isinstance(widget.get("chart"), dict) else {}
    candidates = [
        chart.get("singleChartFontSize"),
        chart.get("singleUnitFontSize"),
        chart.get("fontSize"),
        chart.get("size"),
        search_data.get("fontSize"),
        search_data.get("singleFontSize"),
        search_data.get("singleValueFontSize"),
        search_data.get("valueFontSize"),
        search_data.get("numberFontSize"),
        search_data.get("chartFontSize"),
        (search_data.get("textStyle") or {}).get("fontSize"),
        (search_data.get("style") or {}).get("fontSize"),
        widget.get("fontSize"),
    ]
    for candidate in candidates:
        parsed = _parse_positive_number(candidate)
        if parsed is not None:
            return parsed
    return None


def _parse_positive_number(value: Any) -> float | None:
    if isinstance(value, (int, float)) and math.isfinite(value) and value > 0:
        return float(value)
    if isinstance(value, str):
        import re
        match = re.match(r"^(\d+(?:\.\d+)?)", value.strip())
        if match:
            parsed = float(match.group(1))
            if math.isfinite(parsed) and parsed > 0:
                return parsed
    return None


def _estimate_single_value_height_ratio(grid_height: int, font_size_px: float) -> float:
    content_height_px = (_DEFAULT_SINGLE_GRID_PX_PER_H * max(grid_height, 1)) - _DEFAULT_SINGLE_HEADER_CHROME_PX
    if content_height_px <= 0:
        return 1.0
    return _clamp01(font_size_px / content_height_px)


# ---------------------------------------------------------------------------
# HSL color tool chain
# ---------------------------------------------------------------------------

def _hex_to_rgb(color: str) -> tuple[int, int, int] | None:
    normalized = color.strip().lstrip("#")
    if len(normalized) != 6 or not all(c in "0123456789ABCDEFabcdef" for c in normalized):
        return None
    return (int(normalized[0:2], 16), int(normalized[2:4], 16), int(normalized[4:6], 16))


def _hex_to_hsl(color: str) -> dict[str, float] | None:
    rgb = _hex_to_rgb(color)
    if rgb is None:
        return None
    r, g, b = rgb[0] / 255.0, rgb[1] / 255.0, rgb[2] / 255.0
    max_val = max(r, g, b)
    min_val = min(r, g, b)
    lightness = (max_val + min_val) / 2.0

    if max_val == min_val:
        return {"h": 0.0, "s": 0.0, "l": lightness}

    d = max_val - min_val
    s = d / (2.0 - max_val - min_val) if lightness > 0.5 else d / (max_val + min_val)
    if max_val == r:
        h = ((g - b) / d) + (6 if g < b else 0)
    elif max_val == g:
        h = ((b - r) / d) + 2
    else:
        h = ((r - g) / d) + 4
    h *= 60.0
    return {"h": h, "s": s, "l": lightness}


def _hsl_to_hex(hsl: dict[str, float]) -> str:
    h = _wrap_hue(hsl["h"]) / 360.0
    s = _clamp01(hsl["s"])
    lightness = _clamp01(hsl["l"])

    if s == 0:
        value = round(lightness * 255)
        return _rgb_to_hex(value, value, value)

    q = lightness * (1 + s) if lightness < 0.5 else lightness + s - (lightness * s)
    p = 2 * lightness - q
    r = _hue_to_rgb(p, q, h + 1.0 / 3)
    g = _hue_to_rgb(p, q, h)
    b = _hue_to_rgb(p, q, h - 1.0 / 3)
    return _rgb_to_hex(round(r * 255), round(g * 255), round(b * 255))


def _hue_to_rgb(p: float, q: float, t: float) -> float:
    next_t = t
    if next_t < 0:
        next_t += 1
    if next_t > 1:
        next_t -= 1
    if next_t < 1.0 / 6:
        return p + (q - p) * 6 * next_t
    if next_t < 0.5:
        return q
    if next_t < 2.0 / 3:
        return p + (q - p) * ((2.0 / 3) - next_t) * 6
    return p


def _rgb_to_hex(r: int, g: int, b: int) -> str:
    return f"#{r:02X}{g:02X}{b:02X}"


def _wrap_hue(hue: float) -> float:
    normalized = hue % 360
    return normalized + 360 if normalized < 0 else normalized


def _compute_hsl_distance(left: dict[str, float], right: dict[str, float]) -> float:
    hue_diff = min(abs(left["h"] - right["h"]), 360 - abs(left["h"] - right["h"])) / 180.0
    sat_diff = abs(left["s"] - right["s"])
    light_diff = abs(left["l"] - right["l"])
    return 0.5 * hue_diff + 0.25 * sat_diff + 0.25 * light_diff


def _relative_luminance(color: str) -> float:
    rgb = _hex_to_rgb(color)
    if rgb is None:
        return 0.0

    def transform(channel: int) -> float:
        value = channel / 255.0
        return value / 12.92 if value <= 0.03928 else ((value + 0.055) / 1.055) ** 2.4

    r = transform(rgb[0])
    g = transform(rgb[1])
    b = transform(rgb[2])
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def _contrast_ratio(foreground: str, background: str) -> float:
    lighter = max(_relative_luminance(foreground), _relative_luminance(background))
    darker = min(_relative_luminance(foreground), _relative_luminance(background))
    return (lighter + 0.05) / (darker + 0.05)


def _ensure_contrast_guard(hsl: dict[str, float]) -> dict[str, float]:
    current = dict(hsl)
    for _ in range(12):
        hex_color = _hsl_to_hex(current)
        if _contrast_ratio(hex_color, _DARK_BACKGROUND_COLOR) >= _MIN_DARK_CONTRAST or current["l"] >= 0.96:
            return current
        current = dict(current)
        current["l"] = _clamp01(current["l"] + 0.04)
    return current


# ---------------------------------------------------------------------------
# Palette & role selection
# ---------------------------------------------------------------------------

def _get_scheme_palette_infos(scheme: str) -> list[dict[str, Any]]:
    palette_rows = DASHBOARD_SCHEME_COLORS.get(scheme) or DASHBOARD_SCHEME_COLORS.get(DEFAULT_DASHBOARD_SCHEME) or []
    seen: set[str] = set()
    result: list[dict[str, Any]] = []
    for row in palette_rows:
        for color in row:
            upper = color.upper()
            if upper in seen:
                continue
            seen.add(upper)
            hsl = _hex_to_hsl(upper)
            if hsl is not None:
                result.append({"color": upper, "hsl": hsl})
    return result


def _select_main_color(items: list[dict[str, Any]]) -> str:
    color_stats: dict[str, dict[str, Any]] = {}
    for item in items:
        color = item.get("color")
        if not color:
            continue
        if color not in color_stats:
            color_stats[color] = {"count": 0, "area": 0, "firstIndex": item["index"]}
        color_stats[color]["count"] += 1
        color_stats[color]["area"] += item["area"]

    ranked = sorted(color_stats.items(), key=lambda pair: (-pair[1]["count"], -pair[1]["area"], pair[1]["firstIndex"]))
    return ranked[0][0] if ranked else ""


def _find_closest_palette_color(
    target: dict[str, float],
    palette_infos: list[dict[str, Any]],
    excluded: set[str] | None = None,
) -> str | None:
    excluded = excluded or set()
    best_color: str | None = None
    best_distance = float("inf")
    for item in palette_infos:
        if not item["color"] or item["color"] in excluded:
            continue
        distance = _compute_hsl_distance(target, item["hsl"])
        if distance < best_distance:
            best_distance = distance
            best_color = item["color"]
    return best_color


def _find_closest_palette_color_with_guard(
    target: dict[str, float],
    palette_infos: list[dict[str, Any]],
    excluded: set[str] | None = None,
) -> dict[str, Any] | None:
    excluded = excluded or set()
    best_candidate: dict[str, Any] | None = None
    best_score = float("inf")

    for step in range(11):
        lifted_target = _ensure_contrast_guard({"h": target["h"], "s": target["s"], "l": _clamp01(target["l"] + step * 0.04)})
        for item in palette_infos:
            if not item["color"] or item["color"] in excluded:
                continue
            contrast = _contrast_ratio(item["color"], _DARK_BACKGROUND_COLOR)
            contrast_penalty = (_MIN_DARK_CONTRAST - contrast) * 0.45 if contrast < _MIN_DARK_CONTRAST else 0
            score = _compute_hsl_distance(lifted_target, item["hsl"]) + contrast_penalty
            if score < best_score:
                best_score = score
                best_candidate = item
        if best_candidate and _contrast_ratio(best_candidate["color"], _DARK_BACKGROUND_COLOR) >= _MIN_DARK_CONTRAST:
            return best_candidate

    return best_candidate


def _compute_candidate_score(
    target: dict[str, float],
    candidate: dict[str, float],
    color: str,
) -> float:
    contrast = _contrast_ratio(color, _DARK_BACKGROUND_COLOR)
    contrast_penalty = (_MIN_DARK_CONTRAST - contrast) * 0.45 if contrast < _MIN_DARK_CONTRAST else 0
    return _compute_hsl_distance(target, candidate) + contrast_penalty


def _derive_role_color(
    base_hsl: dict[str, float],
    hue_offsets: list[int],
    palette_infos: list[dict[str, Any]],
    excluded: set[str] | None = None,
    saturation_scale: float = 1.0,
    lightness_delta: float = 0.0,
) -> str | None:
    excluded = excluded or set()
    best_color: str | None = None
    best_score = float("inf")

    for offset in hue_offsets:
        target = _ensure_contrast_guard({
            "h": _wrap_hue(base_hsl["h"] + offset),
            "s": _clamp01(base_hsl["s"] * saturation_scale),
            "l": _clamp01(base_hsl["l"] + lightness_delta),
        })
        candidate = _find_closest_palette_color_with_guard(target, palette_infos, excluded)
        if candidate is None:
            continue
        score = _compute_candidate_score(target, candidate["hsl"], candidate["color"])
        if score < best_score:
            best_score = score
            best_color = candidate["color"]

    return best_color


def _build_same_family_scheme(
    main_color: str, palette_infos: list[dict[str, Any]]
) -> dict[str, str | None]:
    main_hsl = _hex_to_hsl(main_color)
    if main_hsl is None:
        return {"main": main_color, "secondary": None, "accent": None}

    secondary_color = _find_closest_palette_color(
        {"h": main_hsl["h"], "s": _clamp01(main_hsl["s"] * 0.72), "l": _clamp01(main_hsl["l"] + 0.08)},
        palette_infos,
        {main_color},
    )
    accent_color = _find_closest_palette_color(
        {"h": _wrap_hue(main_hsl["h"] + 18), "s": _clamp01(min(1.0, main_hsl["s"] * 1.05)), "l": _clamp01(main_hsl["l"] - 0.06)},
        palette_infos,
        {main_color, secondary_color or ""},
    )
    return {"main": main_color, "secondary": secondary_color, "accent": accent_color}


def _build_adjacent_scheme(
    main_color: str, palette_infos: list[dict[str, Any]]
) -> dict[str, str | None]:
    main_hsl = _hex_to_hsl(main_color)
    if main_hsl is None:
        return {"main": main_color, "secondary": None, "accent": None}

    secondary_color = _derive_role_color(
        main_hsl, _SECONDARY_HUE_OFFSETS, palette_infos,
        {main_color}, saturation_scale=0.92, lightness_delta=0.02,
    )
    secondary_hsl = _hex_to_hsl(secondary_color or "") if secondary_color else None
    accent_color = (
        _derive_role_color(
            secondary_hsl, _ACCENT_HUE_OFFSETS, palette_infos,
            {main_color, secondary_color or ""}, saturation_scale=1.04, lightness_delta=0.0,
        )
        if secondary_hsl is not None
        else None
    )
    return {"main": main_color, "secondary": secondary_color, "accent": accent_color}


def _build_role_contrasts(roles: dict[str, str | None]) -> dict[str, dict[str, float | None]]:
    def build_side(background: str) -> dict[str, float | None]:
        return {
            "main": _round(_contrast_ratio(roles["main"], background)) if roles["main"] else None,
            "secondary": _round(_contrast_ratio(roles["secondary"], background)) if roles["secondary"] else None,
            "accent": _round(_contrast_ratio(roles["accent"], background)) if roles["accent"] else None,
        }

    return {"dark": build_side(_DARK_BACKGROUND_COLOR), "light": build_side("#FFFFFF")}


def _build_scheme_suggestion(
    name: str,
    strategy: str,
    roles: dict[str, str | None],
    summary: str,
) -> dict[str, Any] | None:
    if not roles.get("main"):
        return None
    return {
        "name": name,
        "strategy": strategy,
        "roles": roles,
        "contrast": _build_role_contrasts(roles),
        "summary": summary,
    }


def _compute_role_distribution(
    items: list[dict[str, Any]],
    roles: dict[str, str | None],
    total_area: float,
) -> dict[str, float]:
    role_areas: dict[str, float] = {"main": 0, "secondary": 0, "accent": 0, "other": 0, "uncolored": 0}
    for item in items:
        color = item.get("color")
        if not color:
            role_areas["uncolored"] += item["area"]
            continue
        if roles["main"] and color == roles["main"]:
            role_areas["main"] += item["area"]
            continue
        if roles["secondary"] and color == roles["secondary"]:
            role_areas["secondary"] += item["area"]
            continue
        if roles["accent"] and color == roles["accent"]:
            role_areas["accent"] += item["area"]
            continue
        role_areas["other"] += item["area"]

    denominator = max(total_area, 1)
    return {key: _round(value / denominator) for key, value in role_areas.items()}


def _compute_color_distribution_score(distribution: dict[str, float]) -> float:
    base_error = (
        abs(distribution["main"] - _COLOR_DISTRIBUTION_TARGETS["main"])
        + abs(distribution["secondary"] - _COLOR_DISTRIBUTION_TARGETS["secondary"])
        + abs(distribution["accent"] - _COLOR_DISTRIBUTION_TARGETS["accent"])
    )
    extra_error = distribution["other"] * 0.8 + distribution["uncolored"]
    return _clamp01(1 - (base_error + extra_error) / 1.35)


# ---------------------------------------------------------------------------
# Color analysis (replaces old simple version)
# ---------------------------------------------------------------------------

def _build_color_analysis(items: list[dict[str, Any]], scheme: str | None) -> dict[str, Any]:
    normalized_scheme = normalize_dashboard_scheme(scheme)
    palette_infos = _get_scheme_palette_infos(normalized_scheme)
    total_area = sum(item["area"] for item in items)
    colored_items = [item for item in items if item.get("color")]

    if total_area <= 0 or not colored_items:
        return {
            "score": 0,
            "scheme": normalized_scheme,
            "roles": {"main": None, "secondary": None, "accent": None},
            "distribution": {"main": 0, "secondary": 0, "accent": 0, "other": 0, "uncolored": 1},
            "suggestions": [{
                "category": "color",
                "priority": "high",
                "message": "当前 tab 里的 panel 还没有设置 chartStartingColor，无法形成 60/30/10 的颜色层次。",
            }],
        }

    main_color = _select_main_color(colored_items)
    same_family_roles = _build_same_family_scheme(main_color, palette_infos)
    adjacent_roles = _build_adjacent_scheme(main_color, palette_infos)
    scheme_suggestions: list[dict[str, Any]] = [
        s
        for s in [
            _build_scheme_suggestion("同色系方案", "same_family", same_family_roles, "整体更统一、更柔和，但颜色区分度偏弱。"),
            _build_scheme_suggestion("邻近色方案", "adjacent", adjacent_roles, "层次更分明、辅助色更自然，更适合主次分层明显的 dashboard。"),
        ]
        if s is not None
    ]

    selected_suggestion = next(
        (s for s in scheme_suggestions if s["strategy"] == "adjacent"),
        scheme_suggestions[0] if scheme_suggestions else None,
    )
    selected_roles = (selected_suggestion or {}).get("roles") or {"main": main_color, "secondary": None, "accent": None}
    distribution = _compute_role_distribution(items, selected_roles, total_area)
    color_score = _compute_color_distribution_score(distribution)

    return {
        "score": _to_percentage_score(color_score),
        "scheme": normalized_scheme,
        "selected_strategy": (selected_suggestion or {}).get("strategy") or "adjacent",
        "roles": selected_roles,
        "distribution": distribution,
        "scheme_suggestions": scheme_suggestions,
        "suggestions": _build_color_suggestions(distribution, {**selected_roles, "schemeSuggestions": scheme_suggestions}, color_score),
    }


def _build_color_suggestions(
    distribution: dict[str, float],
    roles: dict[str, Any],
    color_score: float,
) -> list[dict[str, Any]]:
    suggestions: list[dict[str, Any]] = []
    scheme_suggestions = roles.get("schemeSuggestions", [])

    if len(scheme_suggestions) > 1:
        suggestions.append({
            "category": "color",
            "priority": "low",
            "message": "当前同时返回“同色系方案”和“邻近色方案”：前者更统一柔和，后者更强调层次和区分度，可按场景挑选。",
        })

    if distribution["uncolored"] > 0.1:
        suggestions.append({
            "category": "color",
            "priority": _score_to_priority(1 - distribution["uncolored"]),
            "message": "先给还未设置 chartStartingColor 的 panel 补齐颜色，否则很难形成稳定的主次层次。",
        })

    if distribution["main"] < 0.5:
        suggestions.append({
            "category": "color",
            "priority": _score_to_priority(distribution["main"] / max(_COLOR_DISTRIBUTION_TARGETS["main"], 1e-6)),
            "message": f"主色 {roles.get('main') or ''} 的覆盖面积偏低，建议让更多核心大 panel 复用它，整体更接近 60% 主色占比。",
        })
    elif distribution["main"] > 0.75:
        suggestions.append({
            "category": "color",
            "priority": _score_to_priority(1 - distribution["main"]),
            "message": "主色占比偏高，建议把部分次级 panel 调整为辅助色，避免画面过满、层次单一。",
        })

    if distribution["secondary"] < 0.2:
        suggestions.append({
            "category": "color",
            "priority": _score_to_priority(distribution["secondary"] / max(_COLOR_DISTRIBUTION_TARGETS["secondary"], 1e-6)),
            "message": f"辅助色 {roles.get('secondary') or ''} 的存在感偏弱，建议让一部分非核心 panel 承担 30% 左右的过渡层。",
        })
    elif distribution["secondary"] > 0.4:
        suggestions.append({
            "category": "color",
            "priority": _score_to_priority(1 - distribution["secondary"]),
            "message": "辅助色占比偏高，建议收敛一部分辅助色面积，把视觉重心还给主色。",
        })

    if distribution["accent"] < 0.05:
        suggestions.append({
            "category": "color",
            "priority": "low",
            "message": f"强调色 {roles.get('accent') or ''} 用得偏少，可给关键指标、异常趋势或告警面板预留少量点缀，接近 10% 更有层次。",
        })
    elif distribution["accent"] > 0.18:
        suggestions.append({
            "category": "color",
            "priority": _score_to_priority(1 - distribution["accent"]),
            "message": "强调色面积偏大，建议只保留在少数关键 panel 上，避免画面显得过跳。",
        })

    if distribution["other"] > 0.12:
        suggestions.append({
            "category": "color",
            "priority": _score_to_priority(1 - distribution["other"]),
            "message": "当前 tab 里出现了较多主色/辅助色/强调色之外的颜色，建议收敛到三角色配色，整体会更稳。",
        })

    if not suggestions:
        suggestions.append({
            "category": "color",
            "priority": "low" if color_score >= 0.85 else "medium",
            "message": "当前 tab 的配色层次比较稳定，可继续围绕 60/30/10 维持主色、辅助色、强调色的分工。",
        })

    return _deduplicate_suggestions(suggestions)


# ---------------------------------------------------------------------------
# Visual area (for density / balance)
# ---------------------------------------------------------------------------

def _get_visual_area(item: dict[str, Any]) -> float:
    effective = item.get("effectiveArea")
    if isinstance(effective, (int, float)) and math.isfinite(effective) and effective > 0:
        return effective
    return item.get("area", 0)


# ---------------------------------------------------------------------------
# Single-value panel analysis
# ---------------------------------------------------------------------------

def _analyze_single_value_panels(items: list[dict[str, Any]]) -> dict[str, Any]:
    single_items = [
        item for item in items
        if item.get("chartType") == "single" and isinstance(item.get("singleValueHeightRatio"), (int, float))
    ]
    too_sparse = [item for item in single_items if item["singleValueHeightRatio"] < _SINGLE_HEIGHT_RATIO_COMFORT_MIN]
    too_dense = [item for item in single_items if item["singleValueHeightRatio"] > _SINGLE_HEIGHT_RATIO_ACCEPTABLE_MAX]

    sparse_score = (
        _average([_clamp01(item["singleValueHeightRatio"] / _SINGLE_HEIGHT_RATIO_COMFORT_MIN) for item in too_sparse])
        if too_sparse
        else 1.0
    )
    dense_score = (
        _average([
            _clamp01(1 - (item["singleValueHeightRatio"] - _SINGLE_HEIGHT_RATIO_ACCEPTABLE_MAX) / max(1 - _SINGLE_HEIGHT_RATIO_ACCEPTABLE_MAX, 1e-6))
            for item in too_dense
        ])
        if too_dense
        else 1.0
    )

    return {
        "tooSparse": too_sparse,
        "tooDense": too_dense,
        "sparseScore": sparse_score,
        "denseScore": dense_score,
        "minSparseRatio": min((item["singleValueHeightRatio"] for item in too_sparse), default=0),
        "maxSparseRatio": max((item["singleValueHeightRatio"] for item in too_sparse), default=0),
        "minDenseRatio": min((item["singleValueHeightRatio"] for item in too_dense), default=0),
        "maxDenseRatio": max((item["singleValueHeightRatio"] for item in too_dense), default=0),
    }


def _average(values: list[float]) -> float:
    if not values:
        return 0.0
    return sum(values) / len(values)


def _format_item_title_list(items: list[dict[str, Any]]) -> str:
    titles = [item.get("title", "") for item in items if isinstance(item.get("title"), str) and item["title"].strip()][:3]
    if not titles:
        return "部分单值图"
    if len(items) > 3:
        return f"{'、'.join(titles)} 等 {len(items)} 个 panel"
    return "、".join(titles)


# ---------------------------------------------------------------------------
# Canvas
# ---------------------------------------------------------------------------

def _calculate_canvas(items: list[dict[str, Any]]) -> dict[str, Any]:
    width = max([1] + [item["right"] for item in items])
    height = max([1] + [item["bottom"] for item in items])
    return {"width": width, "height": height, "area": width * height}


# ---------------------------------------------------------------------------
# Scoring functions
# ---------------------------------------------------------------------------

def _compute_density_score(items: list[dict[str, Any]], canvas: dict[str, Any]) -> float:
    total_area = sum(_get_visual_area(item) for item in items)
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
        visual_area = _get_visual_area(item)
        if item["cx"] < center_x:
            left_moment += visual_area * (center_x - item["cx"])
        elif item["cx"] > center_x:
            right_moment += visual_area * (item["cx"] - center_x)
    denominator = max(left_moment, right_moment, 1e-6)
    return _clamp01(1 - (abs(left_moment - right_moment) / denominator))


def _compute_proportionality_score(items: list[dict[str, Any]]) -> float:
    if not items:
        return 1.0
    golden_ratio = 1.618
    deviations = [abs(max(item["w"] / max(item["h"], 1), item["h"] / max(item["w"], 1)) - golden_ratio) for item in items]
    avg_deviation = sum(deviations) / max(len(deviations), 1)
    return _clamp01(1 - avg_deviation)


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


# ---------------------------------------------------------------------------
# Overlap detection
# ---------------------------------------------------------------------------

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


# ---------------------------------------------------------------------------
# Issues (context-aware)
# ---------------------------------------------------------------------------

def _build_issues(
    items: list[dict[str, Any]],
    canvas: dict[str, Any],
    raw_scores: dict[str, float],
    overlap_pairs: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    issues: list[dict[str, Any]] = []
    total_area = sum(_get_visual_area(item) for item in items)
    fill_ratio = total_area / max(canvas["area"], 1)
    single_value_analysis = _analyze_single_value_panels(items)

    if overlap_pairs:
        issues.append({
            "metric": "layout",
            "severity": "high",
            "reason": f"检测到 {len(overlap_pairs)} 组 panel 存在重叠，可能影响阅读和交互。",
        })

    if raw_scores["density"] < 0.85:
        density_reason = (
            f"当前填充率约为 {_round(fill_ratio * 100)}%，留白偏多，布局显得偏松。"
            if fill_ratio < 0.25
            else f"当前填充率约为 {_round(fill_ratio * 100)}%，组件偏挤，信息密度过高。"
        )
        issues.append({"metric": "density", "severity": _score_to_severity(raw_scores["density"]), "reason": density_reason})

    if raw_scores["symmetry"] < 0.85:
        issues.append({
            "metric": "symmetry",
            "severity": _score_to_severity(raw_scores["symmetry"]),
            "reason": "左右区域的镜像关系较弱，面板在左右两侧的呼应不够明显。",
        })

    if raw_scores["balance"] < 0.85:
        issues.append({
            "metric": "balance",
            "severity": _score_to_severity(raw_scores["balance"]),
            "reason": "左右视觉重量分布不均衡，画面重心偏向单侧。",
        })

    if raw_scores["proportionality"] < 0.85:
        issues.append({
            "metric": "proportionality",
            "severity": _score_to_severity(raw_scores["proportionality"]),
            "reason": "部分面板长宽比差异较大，整体比例协调性不足。",
        })

    if raw_scores["uniformity"] < 0.85:
        issues.append({
            "metric": "uniformity",
            "severity": _score_to_severity(raw_scores["uniformity"]),
            "reason": "组件之间的水平或垂直间距不够统一，网格节奏不稳定。",
        })

    if raw_scores["simplicity"] < 0.85:
        simplicity_reason = (
            f"当前仅有 {len(items)} 个 panel，信息量偏少，层次表达可能不够完整。"
            if len(items) < 4
            else f"当前共有 {len(items)} 个 panel，数量偏多，容易造成画面碎片化。"
        )
        issues.append({
            "metric": "simplicity",
            "severity": _score_to_severity(raw_scores["simplicity"]),
            "reason": simplicity_reason,
        })

    if raw_scores["sequence"] < 0.85:
        issues.append({
            "metric": "sequence",
            "severity": _score_to_severity(raw_scores["sequence"]),
            "reason": "面板顺序与从左上到右下的阅读流不够一致，浏览路径不够自然。",
        })

    if single_value_analysis["tooSparse"]:
        issues.append({
            "metric": "content_fit",
            "severity": _score_to_severity(single_value_analysis["sparseScore"]),
            "reason": (
                f"单值图 {_format_item_title_list(single_value_analysis['tooSparse'])} 的字号相对 panel 高度偏小，"
                f"当前估算占比约为 {_round(single_value_analysis['minSparseRatio'] * 100)}%~{_round(single_value_analysis['maxSparseRatio'] * 100)}%，"
                "大面积留白会稀释重点数值。"
            ),
        })

    if single_value_analysis["tooDense"]:
        issues.append({
            "metric": "content_fit",
            "severity": _score_to_severity(single_value_analysis["denseScore"]),
            "reason": (
                f"单值图 {_format_item_title_list(single_value_analysis['tooDense'])} 的字号相对 panel 高度偏满，"
                f"当前估算占比约为 {_round(single_value_analysis['minDenseRatio'] * 100)}%~{_round(single_value_analysis['maxDenseRatio'] * 100)}%，"
                "容易挤占标题和工具栏的呼吸空间。"
            ),
        })

    return issues


# ---------------------------------------------------------------------------
# Suggestions (context-aware)
# ---------------------------------------------------------------------------

def _build_suggestions(
    items: list[dict[str, Any]],
    raw_scores: dict[str, float],
    overlap_pairs: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    suggestions: list[dict[str, Any]] = []
    single_value_analysis = _analyze_single_value_panels(items)

    if overlap_pairs:
        suggestions.append({"category": "layout", "priority": "high", "message": "先消除面板重叠，再进行其他美化调整，避免遮挡和点击冲突。"})

    if raw_scores["density"] < 0.85:
        suggestions.append({
            "category": "layout",
            "priority": _score_to_priority(raw_scores["density"]),
            "message": (
                "优先重新分配画布空间：减少过度留白或缓解组件拥挤，让填充率回到舒适区间。"
                if raw_scores["density"] < 0.5
                else "微调面板尺寸和留白，让画面疏密更均衡。"
            ),
        })

    if raw_scores["balance"] < 0.85 or raw_scores["symmetry"] < 0.85:
        suggestions.append({
            "category": "layout",
            "priority": _score_to_priority(min(raw_scores["balance"], raw_scores["symmetry"])),
            "message": "尝试让左右两侧的组件面积和位置更对称，避免核心视觉重量过度集中在单侧。",
        })

    if raw_scores["uniformity"] < 0.85:
        suggestions.append({
            "category": "layout",
            "priority": _score_to_priority(raw_scores["uniformity"]),
            "message": "统一相邻卡片的间距、宽度和高度，尽量让同层级组件使用稳定的网格节奏。",
        })

    if raw_scores["proportionality"] < 0.85:
        suggestions.append({
            "category": "layout",
            "priority": _score_to_priority(raw_scores["proportionality"]),
            "message": "减少过扁或过高的面板，优先复用接近统一比例的卡片尺寸。",
        })

    if raw_scores["simplicity"] < 0.85:
        suggestions.append({
            "category": "layout",
            "priority": _score_to_priority(raw_scores["simplicity"]),
            "message": (
                "合并零散小面板，减少首屏碎片化信息。"
                if len(items) > 9
                else "适当增加辅助面板或放大核心面板，增强层次表达。"
            ),
        })

    if raw_scores["sequence"] < 0.85:
        suggestions.append({
            "category": "layout",
            "priority": _score_to_priority(raw_scores["sequence"]),
            "message": "按“左上到右下”的阅读流重新排序面板，把最重要的内容放在左上或首屏。",
        })

    if single_value_analysis["tooSparse"]:
        suggestions.append({
            "category": "layout",
            "priority": _score_to_priority(single_value_analysis["sparseScore"]),
            "message": "单值图优先让字号占可用高度的约 22%~38%；若明显偏空，优先放大字号，或把 panel 高度从当前 h 适当收紧。",
        })

    if single_value_analysis["tooDense"]:
        suggestions.append({
            "category": "layout",
            "priority": _score_to_priority(single_value_analysis["denseScore"]),
            "message": "单值图若字号占可用高度超过约 48%，建议降低字号或增大 panel 高度，避免数值与标题、工具栏争抢空间。",
        })

    if not suggestions:
        suggestions.append({
            "category": "layout",
            "priority": "low",
            "message": "当前布局整体较稳定，可在保持网格结构的前提下微调关键面板的面积与位置。",
        })

    return _deduplicate_suggestions(suggestions)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

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


def _score_to_severity(score: float) -> str:
    if score < 0.5:
        return "high"
    if score < 0.7:
        return "medium"
    return "low"


def _score_to_priority(score: float) -> str:
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
