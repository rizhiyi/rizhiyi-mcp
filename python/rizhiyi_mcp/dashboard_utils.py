from __future__ import annotations

import re
import time
from copy import deepcopy
from typing import Any, Callable


SUPPORTED_PANEL_TYPES = {"trend", "eventsTable"}
TREND_CHART_TYPES = {
    "line",
    "pie",
    "rose",
    "single",
    "liquidfill",
    "table",
    "sunburst",
    "multiaxis",
    "bar",
    "column",
    "rangeline",
    "scatter",
    "area",
    "heatmap",
    "wordcloud",
    "chord",
    "sankey",
    "force",
    "attackmap",
    "networkflow",
    "tracing",
}
DEFAULT_DASHBOARD_SCHEME = "schemecat1"
DEFAULT_SINGLE_FONT_SIZE = 60
DEFAULT_SINGLE_DISPLAY_MODE = "default"
DEFAULT_SINGLE_COMPARE_MODE = "percent"
DEFAULT_TREND_COLOR_TYPE = "scheme"
DEFAULT_SINGLE_TREND_COLOR_TYPE = "redUp"

BuildError = Callable[[str, str, str, Any | None], Any]


DASHBOARD_SCHEME_COLORS: dict[str, list[list[str]]] = {
    "schemecat1": [
        ["#2050E9", "#24D1AE", "#F61479", "#7511CB", "#F4C400", "#272F53", "#47A610", "#EE621A", "#CA0303", "#DD55B9"],
        ["#3661EB", "#39DEBE", "#F72585", "#7F00E2", "#FFD010", "#303967", "#5DD400", "#F0763B", "#E30202", "#E168C1"],
        ["#4D73ED", "#51E1C4", "#F84E9B", "#8C37EE", "#FFDA46", "#3E4983", "#5FDE1C", "#F28752", "#FC100C", "#E57AC8"],
        ["#6484F0", "#66E5CC", "#F962A6", "#9950F0", "#FFDE5C", "#4A589E", "#50E82E", "#F49667", "#FD2827", "#E88BD0"],
        ["#7A96F2", "#7CE9D3", "#FA75B1", "#A969F2", "#FEE270", "#5D6BB3", "#5EEB4B", "#F4A57D", "#FD4645", "#EB9BD6"],
        ["#8FA7F4", "#91EDD9", "#FB89BC", "#B782F4", "#FEE784", "#7784BF", "#7AEF6C", "#F7B493", "#FC6565", "#EEACDD"],
        ["#FFFFFF", "#E9F5FF", "#4A4A4A", "#242731", "#FFD010", "#F0763B", "#E30202", "#7F00E2", "#3661EB", "#5DD400"],
    ],
    "schemecat2": [
        ["#1F295B", "#C20B7B", "#22AAA8", "#ECB30E", "#590FA9", "#BD0F4F", "#459C49", "#2500CC", "#C000F5", "#1EBCED"],
        ["#293679", "#E00C8E", "#27C2BF", "#F5BB09", "#6E12CE", "#D81259", "#4CAF52", "#2D00F7", "#CC17FF", "#4BC9F0"],
        ["#334598", "#F4149E", "#33D7D4", "#F7C327", "#7214D4", "#EE1C69", "#64BB68", "#491FFF", "#D333FF", "#68D1F3"],
        ["#3E51B6", "#F63DAE", "#55DDDB", "#F8CF4E", "#811FEB", "#F04382", "#7FC784", "#5933FF", "#D748FF", "#7BD8F4"],
        ["#495CC1", "#F863BF", "#65E1DF", "#FAD362", "#8C31ED", "#F3679B", "#9CD39E", "#7A5CFF", "#DD5DFF", "#8EDEF6"],
        ["#5969C6", "#F877C6", "#89E7E6", "#FBD974", "#A157F0", "#F68EB4", "#B8E0BB", "#9B85FF", "#E070FF", "#A2E3F7"],
        ["#FFFFFF", "#E9F5FF", "#4A4A4A", "#242731", "#F5BB09", "#D81259", "#6E12CE", "#2D00F7", "#4BC9F0", "#4CAF52"],
    ],
    "schemecat3": [
        ["#F47A13", "#3CD093", "#5C4BFC", "#EB6FA4", "#51C6F6", "#5A6888", "#ECB30E", "#07736F", "#3977F9", "#E8377A"],
        ["#F6903D", "#59D8A6", "#7162FD", "#EF8BB4", "#78D3F8", "#65779B", "#F6BD14", "#098E89", "#5C8FFA", "#EA4C89"],
        ["#F89B4F", "#6ADCAF", "#7D6FFF", "#F597BE", "#8BDAF8", "#7786A6", "#F7C327", "#07ADA7", "#749FFB", "#EE6C9E"],
        ["#FFA65D", "#8BE4C0", "#9385FD", "#F4A5C6", "#90DEFC", "#8D9BB4", "#F8CF4E", "#12C0BA", "#88ADFB", "#F07FAA"],
        ["#F9B177", "#9CE8C9", "#A49BFD", "#F5B6D1", "#9FE2FD", "#9BA8BF", "#FBD974", "#55DDDB", "#9DBAFC", "#F291B7"],
        ["#FAC79D", "#ADECD1", "#B8AFFE", "#F7C9DD", "#A5E1F9", "#A6B0C4", "#FBDE89", "#89E7E6", "#B1C8FD", "#F4A3C3"],
        ["#FFFFFF", "#E9F5FF", "#4A4A4A", "#242731", "#F6BD14", "#F6903D", "#EA4C89", "#7162FD", "#78D3F8", "#59D8A6"],
    ],
    "schemecat4": [
        ["#43745B", "#FAB84C", "#C84E2C", "#9BAEBF", "#C893B0", "#485C85", "#DF7517", "#6F4B80", "#A9D86F", "#7D744F"],
        ["#538D6F", "#FBC771", "#D66443", "#B0BFCD", "#D0A3BC", "#506794", "#EC9244", "#7E5999", "#BDE08F", "#8E8358"],
        ["#65A484", "#FCCF88", "#DA7458", "#B8C7D4", "#DBAEC7", "#6178A9", "#EE9E58", "#8465A4", "#C6E59F", "#A19568"],
        ["#7FB498", "#FDD79B", "#DE8268", "#C1CCD7", "#DDBCCE", "#6F84B0", "#F0A96A", "#9072AC", "#CCE9A6", "#B0A782"],
        ["#98C3AC", "#FEDFAF", "#E29079", "#C6D0D9", "#E5C9D8", "#7B8FB8", "#F2B47D", "#A88BBB", "#D1E9AF", "#C0B99B"],
        ["#A5CAB7", "#FCE2BB", "#E69E8A", "#D9E1E7", "#EED7E4", "#95A4C6", "#F4BE8F", "#B498C3", "#DAEDBF", "#D0CAB4"],
        ["#FFFFFF", "#E9F5FF", "#4A4A4A", "#242731", "#FBC771", "#D66443", "#7E5999", "#506794", "#538D6F", "#BDE08F"],
    ],
}

def list_supported_dashboard_schemes() -> list[str]:
    return list(DASHBOARD_SCHEME_COLORS)


def normalize_dashboard_scheme(scheme: str | None) -> str:
    return str(scheme or DEFAULT_DASHBOARD_SCHEME).strip().lower() or DEFAULT_DASHBOARD_SCHEME


def is_supported_dashboard_scheme(scheme: str | None) -> bool:
    return normalize_dashboard_scheme(scheme) in _SCHEME_COLOR_SETS


def normalize_hex_color(color: str | None) -> str:
    return str(color or "").strip().upper()


_SCHEME_COLOR_SETS = {
    key: {normalize_hex_color(color) for row in value for color in row}
    for key, value in DASHBOARD_SCHEME_COLORS.items()
}


def is_color_in_dashboard_scheme(scheme: str, color: str | None) -> bool:
    normalized_color = normalize_hex_color(color)
    if not normalized_color:
        return True
    return normalized_color in _SCHEME_COLOR_SETS.get(normalize_dashboard_scheme(scheme), set())


def normalize_panel_kind(raw_type: str | None, raw_chart_type: str | None = None) -> dict[str, str]:
    panel_type = str(raw_type or "trend").strip() or "trend"
    chart_type = str(raw_chart_type or "").strip()
    if panel_type == "eventsTable":
        return {"type": "eventsTable", "chartType": chart_type or "eventsTable"}
    if panel_type == "table" or panel_type in TREND_CHART_TYPES:
        return {"type": "trend", "chartType": chart_type or ("table" if panel_type == "table" else panel_type)}
    return {"type": panel_type, "chartType": chart_type or "line"}


def build_legacy_default_grid(index: int) -> dict[str, int]:
    return {"x": (index % 2) * 6, "y": (index // 2) * 5, "w": 6, "h": 5}


def normalize_panel_spec(panel: dict[str, Any], index: int, *, apply_default_grid: bool = True) -> dict[str, Any]:
    normalized_kind = normalize_panel_kind(panel.get("type") or panel.get("panel_type"), panel.get("chartType"))
    default_grid = build_legacy_default_grid(index)
    explicit_grid = None
    if isinstance(panel.get("grid"), dict):
        explicit_grid = {**default_grid, **panel["grid"]}
    return {
        "title": panel.get("title"),
        "type": normalized_kind["type"],
        "query": panel.get("query") or "*",
        "time_range": panel.get("time_range") or "-1h,now",
        "chartType": normalized_kind["chartType"],
        "xField": sanitize_field_name(panel.get("xField")),
        "yField": sanitize_field_name(panel.get("yField")),
        "yFields": split_field_list(panel.get("yFields")),
        "ySmooths": normalize_boolean_list(panel.get("ySmooths")),
        "yRanges": normalize_range_list(panel.get("yRanges")),
        "byFields": split_field_list(panel.get("byFields")),
        "fromField": sanitize_field_name(panel.get("fromField")),
        "toField": sanitize_field_name(panel.get("toField")),
        "weightField": sanitize_field_name(panel.get("weightField")),
        "outlierField": sanitize_field_name(panel.get("outlierField")),
        "upperField": sanitize_field_name(panel.get("upperField")),
        "lowerField": sanitize_field_name(panel.get("lowerField")),
        "fromLongitudeField": sanitize_field_name(panel.get("fromLongitudeField")),
        "fromLatitudeField": sanitize_field_name(panel.get("fromLatitudeField")),
        "toLongitudeField": sanitize_field_name(panel.get("toLongitudeField")),
        "toLatitudeField": sanitize_field_name(panel.get("toLatitudeField")),
        "mapType": str(panel.get("mapType") or "world").strip() or "world",
        "description": panel.get("description") or "",
        "color": normalize_hex_color(panel.get("color") or panel.get("chartStartingColor")) or None,
        "grid": (explicit_grid or default_grid) if apply_default_grid else explicit_grid,
    }


def validate_panel_spec(panel: dict[str, Any], build_error: BuildError) -> Any | None:
    if not isinstance(panel.get("title"), str) or not panel["title"].strip():
        return build_error("INVALID_PANEL_SPEC", "panel 缺少 title。", "请为 panel 提供 title。")
    if not isinstance(panel.get("query"), str) or not panel["query"].strip():
        return build_error("INVALID_PANEL_SPEC", f'panel {panel.get("title", "")} 缺少 query。', "请为 panel 提供 SPL 查询语句。")

    normalized_kind = normalize_panel_kind(panel.get("type") or panel.get("panel_type"), panel.get("chartType"))
    if normalized_kind["type"] not in SUPPORTED_PANEL_TYPES:
        return build_error(
            "UNSUPPORTED_PANEL_TYPE",
            f'当前写入仅支持 trend/eventsTable panel，收到类型: {normalized_kind["type"]}',
            "请优先使用 trend；事件列表请使用 eventsTable。",
        )
    if normalized_kind["type"] == "eventsTable" and normalized_kind["chartType"] != "eventsTable":
        return build_error(
            "INVALID_CHART_TYPE",
            f'eventsTable panel 的 chartType 必须为 eventsTable，收到: {normalized_kind["chartType"]}',
            "请将 type 和 chartType 都设为 eventsTable。",
        )
    if normalized_kind["type"] == "trend" and normalized_kind["chartType"] not in TREND_CHART_TYPES:
        return build_error(
            "INVALID_CHART_TYPE",
            f'trend panel 的 chartType 不受支持，收到: {normalized_kind["chartType"]}',
            "请改用受支持的 chartType，例如 line、single、table、pie、bar、column。",
        )
    if panel.get("color") is not None and not isinstance(panel.get("color"), str):
        return build_error(
            "INVALID_PANEL_COLOR",
            f'panel {panel.get("title", "")} 的 color 必须是字符串。',
            "请传入十六进制颜色值，例如 #F6903D。",
        )
    return None


def get_widget_title(widget: dict[str, Any]) -> str:
    search_data = widget.get("searchData") if isinstance(widget.get("searchData"), dict) else {}
    return str(search_data.get("trendName") or widget.get("title") or "")


def get_widget_id(widget: dict[str, Any]) -> str:
    return str(widget.get("id") or "")


def _is_single_widget(widget: dict[str, Any]) -> bool:
    search_data = widget.get("searchData") if isinstance(widget.get("searchData"), dict) else {}
    chart = widget.get("chart") if isinstance(widget.get("chart"), dict) else {}
    return search_data.get("chartType") == "single" or chart.get("chartType") == "single"


def get_single_widget_style_snapshot(widget: dict[str, Any]) -> dict[str, Any]:
    search_data = widget.get("searchData") if isinstance(widget.get("searchData"), dict) else {}
    chart = widget.get("chart") if isinstance(widget.get("chart"), dict) else {}
    origin = widget.get("originWidgetConfData") if isinstance(widget.get("originWidgetConfData"), dict) else {}
    config = search_data.get("config")[2] if isinstance(search_data.get("config"), list) and len(search_data.get("config")) > 2 and isinstance(search_data.get("config")[2], dict) else {}
    font_sources = {
        "searchData": normalize_hex_color(search_data.get("singleChartFontColor")),
        "config": normalize_hex_color(config.get("singleChartFontColor")),
        "originWidgetConfData": normalize_hex_color(origin.get("singleChartFontColor")),
        "chart": normalize_hex_color(chart.get("singleChartFontColor")),
    }
    background_sources = {
        "searchData": normalize_hex_color(search_data.get("singleChartBackgroundColor")),
        "config": normalize_hex_color(config.get("singleChartBackgroundColor")),
        "originWidgetConfData": normalize_hex_color(origin.get("singleChartBackgroundColor")),
        "chart": normalize_hex_color(chart.get("singleChartBackgroundColor")),
    }
    return {
        "fillMode": str(
            search_data.get("singleChartColorFillingMode")
            or config.get("singleChartColorFillingMode")
            or origin.get("singleChartColorFillingMode")
            or chart.get("singleChartColorFillingMode")
            or "font"
        ).strip(),
        "fontColor": normalize_hex_color(
            font_sources["searchData"]
            or font_sources["config"]
            or font_sources["originWidgetConfData"]
            or font_sources["chart"]
            or search_data.get("singleChartDefaultColor")
            or origin.get("singleChartDefaultColor")
            or chart.get("singleChartDefaultColor")
            or search_data.get("chartStartingColor")
            or chart.get("chartStartingColor")
            or origin.get("chartStartingColor")
        ),
        "backgroundColor": normalize_hex_color(
            background_sources["searchData"]
            or background_sources["config"]
            or background_sources["originWidgetConfData"]
            or background_sources["chart"]
            or "#FFFFFF"
        ),
        "fontSources": font_sources,
        "backgroundSources": background_sources,
    }


def validate_single_widget_color_safety(widget: dict[str, Any]) -> dict[str, Any] | None:
    if not _is_single_widget(widget):
        return None
    title = get_widget_title(widget) or get_widget_id(widget) or "未命名 single panel"
    style = get_single_widget_style_snapshot(widget)
    font_values = {value for value in style["fontSources"].values() if value}
    background_values = {value for value in style["backgroundSources"].values() if value}
    if len(font_values) > 1 or len(background_values) > 1:
        return {
            "code": "SINGLE_WIDGET_STYLE_INCONSISTENT",
            "panelTitle": title,
            "message": f"single 图 {title} 的颜色字段在不同配置层级之间不一致。",
            "details": {
                "fillMode": style["fillMode"],
                "fontSources": style["fontSources"],
                "backgroundSources": style["backgroundSources"],
            },
        }
    if style["fillMode"] == "background" and style["fontColor"] and style["fontColor"] == style["backgroundColor"]:
        return {
            "code": "SINGLE_WIDGET_COLOR_CONFLICT",
            "panelTitle": title,
            "message": f"single 图 {title} 的字色与背景色相同，页面会不可读。",
            "details": {
                "fillMode": style["fillMode"],
                "fontColor": style["fontColor"],
                "backgroundColor": style["backgroundColor"],
            },
        }
    return None


def get_widget_color(widget: dict[str, Any]) -> str:
    if _is_single_widget(widget):
        return get_single_widget_style_snapshot(widget)["fontColor"]
    search_data = widget.get("searchData") if isinstance(widget.get("searchData"), dict) else {}
    chart = widget.get("chart") if isinstance(widget.get("chart"), dict) else {}
    return normalize_hex_color(search_data.get("chartStartingColor") or chart.get("chartStartingColor"))


def sanitize_field_name(value: Any) -> str:
    if not isinstance(value, str):
        return ""
    return re.sub(r"[,)]+$", "", value.strip().strip("`'\""))


def split_field_list(value: Any) -> list[str]:
    if isinstance(value, list):
        return [item for item in (sanitize_field_name(v) for v in value) if item]
    if isinstance(value, str):
        return [item for item in (sanitize_field_name(v) for v in value.split(",")) if item]
    return []


def normalize_boolean_list(value: Any) -> list[bool]:
    if isinstance(value, list):
        return [bool(item) for item in value]
    if isinstance(value, str) and value.strip():
        return [item.strip().lower() in {"true", "1", "yes"} for item in value.split(",")]
    return []


def normalize_range_list(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    return [deepcopy(item) if isinstance(item, dict) else {} for item in value]


def infer_metric_field_from_query(query: Any) -> str:
    if not isinstance(query, str):
        return ""
    matches = list(re.finditer(r"\b(?:stats|chart|timechart)\b([^|]*)", query, re.IGNORECASE))
    segment = matches[-1].group(1).strip() if matches else ""
    if not segment:
        return ""
    alias_matches = list(re.finditer(r"\bas\s+([^\s,|]+)", segment, re.IGNORECASE))
    alias = sanitize_field_name(alias_matches[-1].group(1)) if alias_matches else ""
    if alias:
        return alias
    if re.search(r"\bcount\s*\(\s*\)", segment, re.IGNORECASE):
        return "count"
    return ""


def infer_by_fields_from_query(query: Any) -> list[str]:
    if not isinstance(query, str):
        return []
    matches = list(re.finditer(r"\b(?:stats|chart|timechart)\b([^|]*)", query, re.IGNORECASE))
    segment = matches[-1].group(1).strip() if matches else ""
    by_match = re.search(r"\bby\b\s+(.+)$", segment, re.IGNORECASE)
    if not by_match:
        return []
    return [item for item in (sanitize_field_name(v) for v in by_match.group(1).split(",")) if item]


def resolve_panel_field_hints(panel: dict[str, Any], chart_type: str) -> dict[str, Any]:
    x_field = sanitize_field_name(panel.get("xField"))
    y_field = sanitize_field_name(panel.get("yField"))
    y_fields = split_field_list(panel.get("yFields"))
    y_smooths = normalize_boolean_list(panel.get("ySmooths"))
    y_ranges = normalize_range_list(panel.get("yRanges"))
    explicit_by_fields = split_field_list(panel.get("byFields"))
    inferred_by_fields = [] if explicit_by_fields or chart_type == "multiaxis" else infer_by_fields_from_query(panel.get("query"))
    by_fields = explicit_by_fields or inferred_by_fields
    metric_field = infer_metric_field_from_query(panel.get("query"))

    if chart_type == "single":
        value_field = y_field or x_field or metric_field or "count"
        return {
            "xField": x_field or value_field,
            "yField": y_field or value_field,
            "yFields": [value_field],
            "ySmooths": [],
            "yRanges": [],
            "byFields": by_fields,
            "valueField": value_field,
            "categoryField": "",
        }

    if chart_type in {"pie", "rose", "sunburst", "heatmap", "wordcloud"}:
        category_field = (explicit_by_fields[0] if explicit_by_fields else x_field) or (by_fields[0] if by_fields else "")
        value_field = y_field or (metric_field if category_field else x_field) or metric_field or "count"
        return {
            "xField": category_field,
            "yField": y_field or value_field,
            "yFields": [value_field],
            "ySmooths": [],
            "yRanges": [],
            "byFields": by_fields or ([category_field] if category_field else []),
            "valueField": value_field,
            "categoryField": category_field,
        }

    if chart_type == "liquidfill":
        value_field = x_field or y_field or metric_field or "count"
        return {
            "xField": value_field,
            "yField": value_field,
            "yFields": [value_field],
            "ySmooths": [],
            "yRanges": [],
            "byFields": by_fields,
            "valueField": value_field,
            "categoryField": "",
        }

    if chart_type == "bar":
        category_field = (explicit_by_fields[0] if explicit_by_fields else y_field) or ""
        value_field = x_field or metric_field or y_field or "count"
        return {
            "xField": value_field,
            "yField": category_field,
            "yFields": [value_field],
            "ySmooths": [],
            "yRanges": [],
            "byFields": [category_field] if category_field else [],
            "valueField": value_field,
            "categoryField": category_field,
        }

    if chart_type == "multiaxis":
        resolved_y_fields = y_fields or [y_field or metric_field or "count"]
        primary_y_field = resolved_y_fields[0]
        return {
            "xField": x_field,
            "yField": primary_y_field,
            "yFields": resolved_y_fields,
            "ySmooths": y_smooths,
            "yRanges": y_ranges,
            "byFields": by_fields,
            "valueField": primary_y_field,
            "categoryField": x_field or (by_fields[0] if by_fields else ""),
        }

    resolved_y_fields = y_fields or ([y_field] if y_field else ([metric_field] if metric_field else []))
    primary_y_field = y_field or (resolved_y_fields[0] if resolved_y_fields else metric_field)
    return {
        "xField": x_field,
        "yField": primary_y_field or "",
        "yFields": resolved_y_fields,
        "ySmooths": y_smooths,
        "yRanges": y_ranges,
        "byFields": by_fields,
        "valueField": primary_y_field or "",
        "categoryField": x_field or (by_fields[0] if by_fields else ""),
    }


def _build_chart_search_data(chart_type: str, field_hints: dict[str, Any], panel: dict[str, Any], existing: dict[str, Any]) -> dict[str, Any]:
    common = {
        "trendName": panel.get("title") or "Panel",
        "query": panel.get("query") or "*",
        "time_range": panel.get("time_range") or "-1h,now",
        "chartType": chart_type,
        "xField": field_hints["xField"],
        "description": panel.get("description") or "",
        "scheme": normalize_dashboard_scheme(existing.get("scheme") or panel.get("scheme")),
        "market_day": 1 if bool(existing.get("market_day") or panel.get("market_day")) else 0,
    }
    if chart_type not in {"single", "pie", "rose", "multiaxis"}:
        common["yField"] = field_hints["yField"]
    if chart_type != "single":
        common["byFields"] = field_hints["byFields"]
    if chart_type not in {"pie", "rose", "multiaxis"}:
        common["trendColorType"] = existing.get("trendColorType") or panel.get("trendColorType") or DEFAULT_TREND_COLOR_TYPE

    if chart_type == "single":
        color = normalize_hex_color(panel.get("color") or existing.get("singleChartFontColor") or existing.get("chartStartingColor")) or "#4A4A4A"
        return {
            **common,
            "showType": "single",
            "visType": "STATS_NEW",
            "singleChartDisplayMode": existing.get("singleChartDisplayMode") or DEFAULT_SINGLE_DISPLAY_MODE,
            "singleChartComparsionMode": existing.get("singleChartComparsionMode") or DEFAULT_SINGLE_COMPARE_MODE,
            "singleChartFontSize": int(existing.get("singleChartFontSize") or DEFAULT_SINGLE_FONT_SIZE),
            "singleChartFontColor": color,
            "singleChartDefaultColor": color,
            "singleChartBackgroundColor": existing.get("singleChartBackgroundColor") or "#FFFFFF",
            "singleChartColorFillingMode": existing.get("singleChartColorFillingMode") or "font",
            "chartStartingColor": color,
            "xField": field_hints["xField"],
            "config": [
                {"xField": field_hints["xField"]},
                {"trellisField": existing.get("trellisField") or ""},
                {
                    "singleChartDisplayMode": existing.get("singleChartDisplayMode") or DEFAULT_SINGLE_DISPLAY_MODE,
                    "singleChartFontSize": int(existing.get("singleChartFontSize") or DEFAULT_SINGLE_FONT_SIZE),
                    "singleChartFontColor": color,
                    "singleChartBackgroundColor": existing.get("singleChartBackgroundColor") or "#FFFFFF",
                },
            ],
        }

    if chart_type in {"pie", "rose"}:
        color = normalize_hex_color(existing.get("chartStartingColor") or panel.get("color")) or "#3661EB"
        return {
            **common,
            "chartStartingColor": color,
            "categoryField": field_hints["categoryField"],
            "dimensionField": field_hints["categoryField"],
            "pieCategoryField": field_hints["categoryField"],
            "valueField": field_hints["valueField"],
            "metricField": field_hints["valueField"],
            "pieValueField": field_hints["valueField"],
            "labelFormatter": existing.get("labelFormatter") or "onlyName",
            "showType": existing.get("showType") or "topN",
            "config": [
                {"xField": field_hints["categoryField"]},
                {"byFields": field_hints["byFields"]},
                {"layoutColumns": int(existing.get("layoutColumns") or 1)},
                {"chartStartingColor": color, "labelFormatter": existing.get("labelFormatter") or "onlyName"},
            ],
        }

    if chart_type == "liquidfill":
        return {**common, "xField": field_hints["valueField"]}

    if chart_type == "bar":
        color = normalize_hex_color(existing.get("chartStartingColor") or panel.get("color")) or "#3661EB"
        return {
            **common,
            "xField": field_hints["valueField"],
            "yField": field_hints["categoryField"],
            "byFields": [],
            "chartStartingColor": color,
            "labelFormatter": existing.get("labelFormatter") or "onlyName",
            "config": [
                {"xField": field_hints["valueField"]},
                {"yField": field_hints["categoryField"]},
                {"byFields": []},
                {"chartStartingColor": color},
            ],
        }

    if chart_type in {"sunburst", "heatmap", "wordcloud"}:
        return {
            **common,
            "xField": field_hints["valueField"],
            "byFields": field_hints["byFields"],
            "config": [{"xField": field_hints["valueField"]}, {"byFields": field_hints["byFields"]}],
        }

    if chart_type == "multiaxis":
        y_fields = field_hints["yFields"] or [field_hints["yField"]]
        y_smooths = field_hints["ySmooths"] or [False for _ in y_fields]
        y_ranges = field_hints["yRanges"] or [{} for _ in y_fields]
        return {
            **common,
            "chartType": "multiaxis",
            "xField": field_hints["xField"],
            "yFields": y_fields,
            "ySmooths": [bool(y_smooths[index]) if index < len(y_smooths) else False for index in range(len(y_fields))],
            "yRanges": [y_ranges[index] if index < len(y_ranges) else {} for index in range(len(y_fields))],
            "legendPosition": existing.get("legendPosition") or "bottom",
            "config": [],
        }

    if chart_type == "column":
        color = normalize_hex_color(existing.get("chartStartingColor") or panel.get("color")) or "#5C9DF5"
        return {
            **common,
            "xField": field_hints["xField"],
            "yField": field_hints["yField"],
            "byFields": field_hints["byFields"],
            "chartStartingColor": color,
            "labelFormatter": existing.get("labelFormatter") or "noLabel",
            "config": [
                {"xField": field_hints["xField"]},
                {"yField": field_hints["yField"]},
                {"byFields": field_hints["byFields"]},
                {"chartStartingColor": color},
            ],
        }

    if chart_type == "rangeline":
        return {
            **common,
            "xField": field_hints["xField"],
            "yField": field_hints["yField"],
            "outlierField": sanitize_field_name(panel.get("outlierField") or existing.get("outlierField")),
            "upperField": sanitize_field_name(panel.get("upperField") or existing.get("upperField")),
            "lowerField": sanitize_field_name(panel.get("lowerField") or existing.get("lowerField")),
            "config": [
                {"xField": field_hints["xField"]},
                {"yField": field_hints["yField"], "outlierField": sanitize_field_name(panel.get("outlierField") or existing.get("outlierField"))},
                {"upperField": sanitize_field_name(panel.get("upperField") or existing.get("upperField")), "lowerField": sanitize_field_name(panel.get("lowerField") or existing.get("lowerField"))},
            ],
        }

    if chart_type in {"chord", "sankey", "force", "networkflow", "tracing"}:
        return {
            **common,
            "fromField": sanitize_field_name(panel.get("fromField") or existing.get("fromField")),
            "toField": sanitize_field_name(panel.get("toField") or existing.get("toField")),
            "weightField": sanitize_field_name(panel.get("weightField") or existing.get("weightField")),
            "config": [
                {"fromField": sanitize_field_name(panel.get("fromField") or existing.get("fromField"))},
                {"toField": sanitize_field_name(panel.get("toField") or existing.get("toField"))},
                {"weightField": sanitize_field_name(panel.get("weightField") or existing.get("weightField"))},
            ],
        }

    if chart_type == "attackmap":
        return {
            **common,
            "fromField": sanitize_field_name(panel.get("fromField") or existing.get("fromField")),
            "toField": sanitize_field_name(panel.get("toField") or existing.get("toField")),
            "weightField": sanitize_field_name(panel.get("weightField") or existing.get("weightField")),
            "fromLongitudeField": sanitize_field_name(panel.get("fromLongitudeField") or existing.get("fromLongitudeField")),
            "fromLatitudeField": sanitize_field_name(panel.get("fromLatitudeField") or existing.get("fromLatitudeField")),
            "toLongitudeField": sanitize_field_name(panel.get("toLongitudeField") or existing.get("toLongitudeField")),
            "toLatitudeField": sanitize_field_name(panel.get("toLatitudeField") or existing.get("toLatitudeField")),
            "mapType": str(panel.get("mapType") or existing.get("mapType") or "world"),
            "config": [
                {
                    "fromField": sanitize_field_name(panel.get("fromField") or existing.get("fromField")),
                    "fromLongitudeField": sanitize_field_name(panel.get("fromLongitudeField") or existing.get("fromLongitudeField")),
                    "fromLatitudeField": sanitize_field_name(panel.get("fromLatitudeField") or existing.get("fromLatitudeField")),
                },
                {
                    "toField": sanitize_field_name(panel.get("toField") or existing.get("toField")),
                    "toLongitudeField": sanitize_field_name(panel.get("toLongitudeField") or existing.get("toLongitudeField")),
                    "toLatitudeField": sanitize_field_name(panel.get("toLatitudeField") or existing.get("toLatitudeField")),
                },
                {"weightField": sanitize_field_name(panel.get("weightField") or existing.get("weightField")), "mapType": str(panel.get("mapType") or existing.get("mapType") or "world")},
            ],
        }

    color = normalize_hex_color(existing.get("chartStartingColor") or panel.get("color"))
    result = {
        **common,
        "xField": field_hints["xField"],
        "yField": field_hints["yField"],
        "byFields": field_hints["byFields"],
        "showLegend": True,
        "legendPosition": existing.get("legendPosition") or "bottom",
        "xAxisRotate": existing.get("xAxisRotate") or "left",
        "xAxisSort": existing.get("xAxisSort") or "default",
        "config": [
            {"xField": field_hints["xField"], "xAxisRotate": existing.get("xAxisRotate") or "left", "xAxisSort": existing.get("xAxisSort") or "default"},
            {"yField": field_hints["yField"]},
            {"byFields": field_hints["byFields"]},
        ],
    }
    if color:
        result["chartStartingColor"] = color
    return result


def panel_to_widget(panel: dict[str, Any], index: int, widget_id: str | None = None) -> dict[str, Any]:
    grid = panel.get("grid") or build_legacy_default_grid(index)
    normalized_kind = normalize_panel_kind(panel.get("type"), panel.get("chartType"))
    search_data = _build_chart_search_data(
        normalized_kind["chartType"],
        resolve_panel_field_hints(panel, normalized_kind["chartType"]),
        panel,
        {},
    )
    return {
        "y": grid["y"],
        "x": grid["x"],
        "w": grid["w"],
        "h": grid["h"],
        "type": normalized_kind["type"],
        "importType": "clone",
        "id": widget_id or f"panel_{int(time.time() * 1000)}_{index}",
        "searchData": search_data,
    }


def widget_to_panel(widget: dict[str, Any]) -> dict[str, Any]:
    search_data = widget.get("searchData") if isinstance(widget.get("searchData"), dict) else {}
    normalized_kind = normalize_panel_kind(widget.get("type"), search_data.get("chartType"))
    return {
        "title": get_widget_title(widget),
        "type": normalized_kind["type"],
        "query": search_data.get("query") or "*",
        "time_range": search_data.get("time_range") or "-1h,now",
        "chartType": normalized_kind["chartType"],
        "xField": search_data.get("xField") or "",
        "yField": search_data.get("yField") or "",
        "yFields": split_field_list(search_data.get("yFields")),
        "ySmooths": normalize_boolean_list(search_data.get("ySmooths")),
        "yRanges": normalize_range_list(search_data.get("yRanges")),
        "byFields": split_field_list(search_data.get("byFields")),
        "fromField": sanitize_field_name(search_data.get("fromField")),
        "toField": sanitize_field_name(search_data.get("toField")),
        "weightField": sanitize_field_name(search_data.get("weightField")),
        "outlierField": sanitize_field_name(search_data.get("outlierField")),
        "upperField": sanitize_field_name(search_data.get("upperField")),
        "lowerField": sanitize_field_name(search_data.get("lowerField")),
        "fromLongitudeField": sanitize_field_name(search_data.get("fromLongitudeField")),
        "fromLatitudeField": sanitize_field_name(search_data.get("fromLatitudeField")),
        "toLongitudeField": sanitize_field_name(search_data.get("toLongitudeField")),
        "toLatitudeField": sanitize_field_name(search_data.get("toLatitudeField")),
        "mapType": str(search_data.get("mapType") or "world"),
        "description": search_data.get("description") or "",
        "color": get_widget_color(widget) or None,
        "grid": {"x": widget.get("x", 0), "y": widget.get("y", 0), "w": widget.get("w", 6), "h": widget.get("h", 5)},
    }


def patch_widget_with_changes(widget: dict[str, Any], merged_panel: dict[str, Any], changes: dict[str, Any]) -> dict[str, Any]:
    existing_search_data = widget.get("searchData") if isinstance(widget.get("searchData"), dict) else {}
    normalized_kind = normalize_panel_kind(merged_panel.get("type"), merged_panel.get("chartType"))
    if "chartType" in changes:
        existing_search_data = {key: value for key, value in existing_search_data.items() if key in {"scheme", "market_day", "trendColorType", "legendPosition", "xAxisRotate", "xAxisSort"}}
    next_widget = deepcopy(widget)
    next_widget["type"] = normalized_kind["type"]
    next_widget["searchData"] = _build_chart_search_data(
        normalized_kind["chartType"],
        resolve_panel_field_hints(merged_panel, normalized_kind["chartType"]),
        merged_panel,
        existing_search_data,
    )
    grid_changes = changes.get("grid") if isinstance(changes.get("grid"), dict) else {}
    if "x" in grid_changes:
        next_widget["x"] = merged_panel["grid"]["x"]
    if "y" in grid_changes:
        next_widget["y"] = merged_panel["grid"]["y"]
    if "w" in grid_changes:
        next_widget["w"] = merged_panel["grid"]["w"]
    if "h" in grid_changes:
        next_widget["h"] = merged_panel["grid"]["h"]
    if "title" in changes:
        next_widget["title"] = merged_panel["title"]
    if "color" in changes and merged_panel.get("color"):
        color = normalize_hex_color(merged_panel["color"])
        next_widget["chart"] = {**(next_widget.get("chart") if isinstance(next_widget.get("chart"), dict) else {}), "chartStartingColor": color}
        if next_widget["searchData"].get("chartType") == "single":
            single_style = get_single_widget_style_snapshot(widget)
            config_list = list(next_widget["searchData"].get("config") or [])
            while len(config_list) < 3:
                config_list.append({})
            config_list[2] = {
                **(config_list[2] if isinstance(config_list[2], dict) else {}),
                "singleChartFontColor": color,
                "singleChartBackgroundColor": single_style["backgroundColor"] or "#FFFFFF",
            }
            next_widget["searchData"].update(
                {
                    "chartStartingColor": color,
                    "singleChartFontColor": color,
                    "singleChartDefaultColor": color,
                    "singleChartBackgroundColor": single_style["backgroundColor"] or "#FFFFFF",
                    "singleChartColorFillingMode": single_style["fillMode"] or "font",
                    "config": config_list,
                }
            )
            next_widget["originWidgetConfData"] = {
                **(next_widget.get("originWidgetConfData") if isinstance(next_widget.get("originWidgetConfData"), dict) else {}),
                "chartStartingColor": color,
                "singleChartFontColor": color,
                "singleChartDefaultColor": color,
                "singleChartBackgroundColor": single_style["backgroundColor"] or "#FFFFFF",
                "singleChartColorFillingMode": single_style["fillMode"] or "font",
            }
            next_widget["chart"].update(
                {
                    "singleChartFontColor": color,
                    "singleChartDefaultColor": color,
                    "singleChartBackgroundColor": single_style["backgroundColor"] or "#FFFFFF",
                }
            )
    return next_widget


def find_panel_matches(widgets: list[dict[str, Any]], criteria: dict[str, str] | str) -> list[dict[str, Any]]:
    normalized = {"panelTitle": criteria} if isinstance(criteria, str) else (criteria or {})
    panel_id = str(normalized.get("panelId") or "").strip()
    if panel_id:
        return [{"index": index, "widget": widget} for index, widget in enumerate(widgets) if get_widget_id(widget) == panel_id]
    panel_title = str(normalized.get("panelTitle") or "")
    return [{"index": index, "widget": widget} for index, widget in enumerate(widgets) if get_widget_title(widget) == panel_title]
