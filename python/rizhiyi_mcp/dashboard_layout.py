from __future__ import annotations

from typing import Any

from .dashboard_utils import build_legacy_default_grid, normalize_panel_kind


def _to_grid_rect(grid: dict[str, Any] | None) -> dict[str, int]:
    grid = grid or {}
    return {
        "x": int(grid.get("x", 0) or 0),
        "y": int(grid.get("y", 0) or 0),
        "w": max(1, int(grid.get("w", 6) or 6)),
        "h": max(2, int(grid.get("h", 5) or 5)),
    }


def _has_grid_overlap(candidate: dict[str, int], occupied: list[dict[str, int]]) -> bool:
    for item in occupied:
        if (
            candidate["x"] < item["x"] + item["w"]
            and candidate["x"] + candidate["w"] > item["x"]
            and candidate["y"] < item["y"] + item["h"]
            and candidate["y"] + candidate["h"] > item["y"]
        ):
            return True
    return False


def _get_panel_layout_family(panel: dict[str, Any]) -> str:
    normalized = normalize_panel_kind(panel.get("type") or panel.get("panel_type"), panel.get("chartType"))
    if normalized["type"] == "eventsTable" or normalized["chartType"] in {"table", "eventsTable"}:
        return "table"
    if normalized["chartType"] == "single":
        return "single"
    return "trend"


def _get_preferred_grid_size(panel: dict[str, Any], role: str) -> dict[str, int]:
    family = _get_panel_layout_family(panel)
    if role == "main":
        if family == "single":
            return {"w": 6, "h": 4}
        return {"w": 8, "h": 6}
    if family == "single":
        return {"w": 4, "h": 3}
    if family == "table":
        return {"w": 6 if role == "remainder" else 5, "h": 5}
    return {"w": 4 if role == "remainder" else 5, "h": 4 if role == "remainder" else 6}


def _fit_panel_into_slot(slot: dict[str, int], panel: dict[str, Any], role: str) -> dict[str, int]:
    preferred = _get_preferred_grid_size(panel, role)
    return {
        "x": slot["x"],
        "y": slot["y"],
        "w": max(1, min(slot["w"], preferred["w"])),
        "h": max(2, min(slot["h"], preferred["h"])),
    }


def _build_grid_size_candidates(preferred: dict[str, int]) -> list[dict[str, int]]:
    candidates = [
        preferred,
        {"w": min(6, max(4, preferred["w"])), "h": max(4, preferred["h"])},
        {"w": 6, "h": 4},
        {"w": 4, "h": 4},
    ]
    seen: set[str] = set()
    result: list[dict[str, int]] = []
    for candidate in candidates:
        normalized = {"w": min(12, max(1, round(candidate["w"]))), "h": max(2, round(candidate["h"]))}
        key = f'{normalized["w"]}x{normalized["h"]}'
        if key in seen:
            continue
        seen.add(key)
        result.append(normalized)
    return result


def _get_sidebar_split_height(panel: dict[str, Any]) -> int:
    family = _get_panel_layout_family(panel)
    if family == "single":
        return 2
    if family == "table":
        return 4
    return 3


def _build_two_panel_default_grids(panels: list[dict[str, Any]]) -> list[dict[str, int]]:
    primary, secondary = panels
    secondary_width = min(6, max(4, _get_preferred_grid_size(secondary, "secondary")["w"]))
    primary_slot = {"x": 0, "y": 0, "w": 12 - secondary_width, "h": 6}
    secondary_slot = {"x": 12 - secondary_width, "y": 0, "w": secondary_width, "h": 6}
    return [
        _fit_panel_into_slot(primary_slot, primary, "main"),
        _fit_panel_into_slot(secondary_slot, secondary, "secondary"),
    ]


def _build_three_panel_default_grids(panels: list[dict[str, Any]]) -> list[dict[str, int]]:
    sidebar_height = _get_sidebar_split_height(panels[1])
    top_height = 6
    bottom_height = max(2, top_height - sidebar_height)
    top_slot = {"x": 8, "y": 0, "w": 4, "h": top_height - bottom_height}
    bottom_slot = {"x": 8, "y": top_slot["h"], "w": 4, "h": bottom_height}
    return [
        _fit_panel_into_slot({"x": 0, "y": 0, "w": 8, "h": 6}, panels[0], "main"),
        _fit_panel_into_slot(top_slot, panels[1], "secondary"),
        _fit_panel_into_slot(bottom_slot, panels[2], "secondary"),
    ]


def _build_default_grids_for_panels(panels: list[dict[str, Any]]) -> list[dict[str, int]]:
    if not panels:
        return []
    if len(panels) == 1:
        return [_fit_panel_into_slot({"x": 0, "y": 0, "w": 12, "h": 6}, panels[0], "main")]
    if len(panels) == 2:
        return _build_two_panel_default_grids(panels)
    if len(panels) == 3:
        return _build_three_panel_default_grids(panels)

    grids = _build_three_panel_default_grids(panels[:3])
    occupied = [_to_grid_rect(item) for item in grids]
    start_y = max((item["y"] + item["h"] for item in occupied), default=0)
    for index in range(3, len(panels)):
        grid = build_grid_for_additional_panel(panels[index], occupied, start_y=start_y)
        occupied.append(grid)
        grids.append(grid)
    return grids


def build_grid_for_additional_panel(panel: dict[str, Any], occupied_source: list[dict[str, Any]], *, start_y: int = 0) -> dict[str, int]:
    occupied = [_to_grid_rect(item) for item in occupied_source]
    preferred = _get_preferred_grid_size(panel, "remainder")
    max_bottom = max((item["y"] + item["h"] for item in occupied), default=0)
    for candidate in _build_grid_size_candidates(preferred):
        for y in range(start_y, max_bottom + 25):
            for x in range(0, 12 - candidate["w"] + 1):
                next_rect = {"x": x, "y": y, "w": candidate["w"], "h": candidate["h"]}
                if not _has_grid_overlap(next_rect, occupied):
                    return next_rect
    return build_legacy_default_grid(len(occupied))


def assign_default_layout_to_panels(panels: list[dict[str, Any]]) -> list[dict[str, Any]]:
    next_panels = [{**panel, "grid": dict(panel["grid"]) if isinstance(panel.get("grid"), dict) else None} for panel in panels]
    missing_indexes = [index for index, panel in enumerate(next_panels) if panel.get("grid") is None]
    if not missing_indexes:
        return next_panels

    positioned = [panel for panel in next_panels if panel.get("grid")]
    if not positioned:
        generated = _build_default_grids_for_panels([next_panels[index] for index in missing_indexes])
        for generated_index, panel_index in enumerate(missing_indexes):
            next_panels[panel_index]["grid"] = generated[generated_index]
        return next_panels

    occupied = [_to_grid_rect(panel.get("grid")) for panel in positioned]
    for panel_index in missing_indexes:
        grid = build_grid_for_additional_panel(next_panels[panel_index], occupied)
        occupied.append(grid)
        next_panels[panel_index]["grid"] = grid
    return next_panels


def apply_layout_strategy(widgets: list[dict[str, Any]], strategy: str | None) -> list[dict[str, Any]]:
    normalized_strategy = str(strategy or "auto_two_columns").strip() or "auto_two_columns"
    next_widgets: list[dict[str, Any]] = []
    for index, widget in enumerate(widgets):
        base = dict(widget)
        if normalized_strategy == "single_column":
            base.update({"x": 0, "y": index * 6, "w": 12, "h": 5})
        elif normalized_strategy == "compact":
            base.update({"x": (index % 3) * 4, "y": (index // 3) * 4, "w": 4, "h": 4})
        else:
            base.update({"x": (index % 2) * 6, "y": (index // 2) * 5, "w": 6, "h": 5})
        next_widgets.append(base)
    return next_widgets
