from __future__ import annotations

import json
from typing import Any

from .config import RuntimeConfig
from .dashboard_aesthetics import build_aesthetics_analysis
from .dashboard_layout import apply_layout_strategy, assign_default_layout_to_panels, build_grid_for_additional_panel
from .dashboard_templates import build_dashboard_template_spec
from .dashboard_utils import (
    DEFAULT_DASHBOARD_SCHEME,
    find_panel_matches,
    get_widget_color,
    get_widget_id,
    get_widget_title,
    is_color_in_dashboard_scheme,
    is_supported_dashboard_scheme,
    list_supported_dashboard_schemes,
    normalize_dashboard_scheme,
    normalize_panel_spec,
    panel_to_widget,
    patch_widget_with_changes,
    validate_panel_spec,
    validate_single_widget_color_safety,
    widget_to_panel,
)
from .http_client import LogEaseHttpClient
from .servers import McpServerError, RizhiyiFastMCPServer, ServiceRuntimeState, get_current_server_context
from .types import ApiResponse, ToolCallResult, ToolDefinition

SERVER_LEVEL_INSTRUCTIONS = """使用说明:
1. 仪表盘配置是复杂 JSON body，请优先使用动作型工具：先 list tabs/panels 看现状，再按模板创建、按 spec 创建、调整 layout、增删改 panel。
2. panel 默认可用 tab_name + panel_title 定位；若存在同名 panel，请优先使用 list_dashboard_panels 返回的 panel_id 精准定位。
3. 若布局(grid)未提供，服务端会根据 panel 数量、图表类型和阅读顺序自动补齐默认布局。
4. 当前写入优先支持 trend 和 eventsTable；pie、single、table 等属于 trend 的 chartType。
5. 推荐创图流程：先 query_precheck，再 create/update dashboard。
6. 遇到错误时，优先根据 suggestion 字段修正参数后重试一次。"""

_OUTPUT_CONTROL_PROPERTIES: dict[str, Any] = {
    "output_format": {
        "type": "string",
        "description": "输出格式。当前 Python 版先统一返回 JSON 文本，保留该参数以兼容现有调用。",
        "default": "auto",
        "enum": ["auto", "yaml", "csv", "json"],
    },
    "include_raw_json": {
        "type": "boolean",
        "description": "是否在 structuredContent 中附带原始 JSON 数据。",
        "default": False,
    },
    "result_delivery": {
        "type": "string",
        "description": "结果交付方式。auto 小结果内联，大结果转 resource；inline 强制内联；resource 强制转 resource。",
        "default": "auto",
        "enum": ["auto", "inline", "resource"],
    },
    "result_ttl_seconds": {
        "type": "integer",
        "description": "转 resource 时的保活秒数。",
        "minimum": 1,
    },
}

DEFAULT_DASHBOARD_APP_ID = 1


def _with_output_controls(tools: list[ToolDefinition]) -> list[ToolDefinition]:
    enriched: list[ToolDefinition] = []
    for tool in tools:
        schema = dict(tool.input_schema)
        properties = dict(schema.get("properties") or {})
        properties.update(_OUTPUT_CONTROL_PROPERTIES)
        schema["properties"] = properties
        enriched.append(ToolDefinition(name=tool.name, description=tool.description, input_schema=schema))
    return enriched


class DashboardModule:
    def __init__(self) -> None:
        pass

    async def list_dashboards(self, params: dict[str, Any]) -> dict[str, Any]:
        allowed_keys = {"page", "size", "name", "uuid", "app_id", "export"}
        filtered = {key: value for key, value in (params or {}).items() if key in allowed_keys and value is not None}
        response = await self._request_json("get", "/api/v3/dashboards/", params=filtered or None)
        if response.error or response.data is None:
            return self._upstream_error(response)
        payload = response.data if isinstance(response.data, dict) else {"raw": response.data}
        return {"status": 200, "data": {"path": "/api/v3/dashboards/", "params": filtered, "status": response.status, **payload}}

    async def create_dashboard(self, params: dict[str, Any]) -> dict[str, Any]:
        return await self.create_dashboard_from_spec(params)

    async def create_dashboard_from_template(self, params: dict[str, Any]) -> dict[str, Any]:
        template = params.get("template")
        name = params.get("name")
        context = params.get("context") if isinstance(params.get("context"), dict) else {}
        app_id = params.get("app_id") if isinstance(params.get("app_id"), int) else DEFAULT_DASHBOARD_APP_ID
        data_user = params.get("data_user") or "viewer"
        export_type = params.get("export") or "local"
        if not template or not name:
            return self._build_error("MISSING_REQUIRED_PARAM", "create_dashboard_from_template 需要 template 和 name。", "请提供模板名称以及仪表盘名称。")
        spec = build_dashboard_template_spec(str(template), str(name), context, {"app_id": app_id, "data_user": data_user, "export": export_type})
        if spec is None:
            return self._build_error(
                "UNKNOWN_DASHBOARD_TEMPLATE",
                f"未知的仪表盘模板: {template}",
                "可选模板：service_overview、error_investigation、traffic_trend、host_health。",
            )
        return await self.create_dashboard_from_spec(spec)

    async def create_dashboard_from_spec(self, params: dict[str, Any]) -> dict[str, Any]:
        try:
            normalized_spec = self._normalize_dashboard_spec(params or {})
            validation_error = self._validate_dashboard_spec(normalized_spec)
            if validation_error:
                return validation_error

            name = normalized_spec["name"]
            app_id = normalized_spec.get("app_id")
            data_user = normalized_spec.get("data_user", "viewer")
            export_type = normalized_spec.get("export", "local")
            tabs = normalized_spec.get("tabs", [])
            payload = {"name": name, "data_user": data_user, "export": export_type, "active_tab": 0, "default_display": 0}
            if isinstance(app_id, int):
                payload["app_id"] = app_id

            response = await self._request_json("post", "/api/v3/dashboards/", data=payload)
            dashboard_data = response.data if isinstance(response.data, dict) else {}
            dashboard_id = ((dashboard_data.get("object") or {}) if isinstance(dashboard_data.get("object"), dict) else {}).get("id")

            if not dashboard_id and isinstance(app_id, int) and dashboard_data.get("error", {}).get("code") == "8703":
                fallback_payload = {key: value for key, value in payload.items() if key != "app_id"}
                response = await self._request_json("post", "/api/v3/dashboards/", data=fallback_payload)
                dashboard_data = response.data if isinstance(response.data, dict) else {}
                dashboard_id = ((dashboard_data.get("object") or {}) if isinstance(dashboard_data.get("object"), dict) else {}).get("id")

            if response.error or not dashboard_id:
                return self._upstream_error(response, fallback_message="创建 dashboard 失败。")

            created_tabs: list[dict[str, Any]] = []
            for index, tab in enumerate(tabs):
                widgets = [panel_to_widget(panel, panel_index) for panel_index, panel in enumerate(tab.get("panels", []))]
                tab_content = self._build_default_tab_content(widgets, tab.get("scheme"))
                tab_response = await self._request_json(
                    "post",
                    f"/api/v3/dashboards/{dashboard_id}/tabs/",
                    data={"name": tab.get("name") or f"Tab {index + 1}", "content": json.dumps(tab_content, ensure_ascii=False)},
                )
                if tab_response.error:
                    return self._upstream_error(tab_response, fallback_message=f'创建 tab {tab.get("name") or index + 1} 失败。')
                tab_payload = tab_response.data if isinstance(tab_response.data, dict) else {}
                created_tabs.append(tab_payload.get("object") if isinstance(tab_payload.get("object"), dict) else tab_payload)

            return {
                "status": 200,
                "data": {
                    "dashboard_id": dashboard_id,
                    "name": name,
                    "tabs_created": len(created_tabs),
                    "tabs": [{"id": tab.get("id"), "name": tab.get("name")} for tab in created_tabs],
                    "message": "Dashboard created successfully",
                },
            }
        except Exception as exc:
            return self._build_error(
                "DASHBOARD_EXECUTION_ERROR",
                str(exc),
                "请检查仪表盘名称、tabs、panels、query 和布局配置后重试。",
            )

    async def list_dashboard_tabs(self, params: dict[str, Any]) -> dict[str, Any]:
        dashboard_id = params.get("dashboard_id")
        if not dashboard_id:
            return self._build_error("MISSING_REQUIRED_PARAM", "list_dashboard_tabs 需要 dashboard_id。", "请提供目标仪表盘 ID。")
        dashboard_result = await self._get_dashboard(dashboard_id)
        if dashboard_result.get("error"):
            return dashboard_result
        dashboard = dashboard_result["data"]
        tabs = dashboard.get("tabs") if isinstance(dashboard.get("tabs"), list) else []
        result_tabs = []
        for tab in tabs:
            content_result = self._parse_tab_content(tab.get("content"))
            widgets = content_result["data"].get("widgets", []) if not content_result.get("error") else []
            result_tabs.append({"id": tab.get("id"), "name": tab.get("name"), "panel_count": len(widgets)})
        return {
            "status": 200,
            "data": {
                "dashboard_id": dashboard_id,
                "dashboard_name": dashboard.get("name"),
                "app_id": dashboard.get("app_id"),
                "tab_count": len(result_tabs),
                "tabs": result_tabs,
                "message": "Dashboard tabs listed successfully",
            },
        }

    async def get_dashboard_tab_content(self, params: dict[str, Any]) -> dict[str, Any]:
        dashboard_id = params.get("dashboard_id")
        tab_name = params.get("tab_name")
        if not dashboard_id or not tab_name:
            return self._build_error("MISSING_REQUIRED_PARAM", "get_dashboard_tab_content 需要 dashboard_id 和 tab_name。", "请提供目标仪表盘 ID 和标签页名称。")
        context_result = await self._load_tab_context(dashboard_id, str(tab_name))
        if context_result.get("error"):
            return context_result
        dashboard = context_result["data"]["dashboard"]
        tab = context_result["data"]["tab"]
        content = context_result["data"]["content"]
        return {
            "status": 200,
            "data": {
                "dashboard_id": dashboard_id,
                "dashboard_name": dashboard.get("name"),
                "app_id": dashboard.get("app_id"),
                "tab_id": tab.get("id"),
                "tab_name": tab.get("name"),
                "content": content,
                "message": "Dashboard tab content fetched successfully",
            },
        }

    async def clone_dashboard_tab(self, params: dict[str, Any]) -> dict[str, Any]:
        dashboard_id = params.get("dashboard_id")
        source_tab_name = str(params.get("source_tab_name") or "")
        new_tab_name = str(params.get("new_tab_name") or "").strip()
        if not dashboard_id or not source_tab_name or not new_tab_name:
            return self._build_error(
                "MISSING_REQUIRED_PARAM",
                "clone_dashboard_tab 需要 dashboard_id、source_tab_name 和 new_tab_name。",
                "请提供目标仪表盘 ID、源标签页名称以及新标签页名称。",
            )
        dashboard_result = await self._get_dashboard(dashboard_id)
        if dashboard_result.get("error"):
            return dashboard_result
        dashboard = dashboard_result["data"]
        tabs = dashboard.get("tabs") if isinstance(dashboard.get("tabs"), list) else []
        source_tab = next((item for item in tabs if item.get("name") == source_tab_name), None)
        if source_tab is None:
            return self._build_error("TAB_NOT_FOUND", f"未找到标签页: {source_tab_name}", "请先通过 list_dashboard_tabs 确认 source_tab_name 是否正确。")
        if any(item.get("name") == new_tab_name for item in tabs):
            return self._build_error("TAB_ALREADY_EXISTS", f"标签页 {new_tab_name} 已存在。", "请修改 new_tab_name，避免与现有标签页重名。")
        content_result = self._parse_tab_content(source_tab.get("content"))
        if content_result.get("error"):
            return content_result
        source_content = content_result["data"]
        create_result = await self._create_dashboard_tab(dashboard_id, new_tab_name, source_content)
        if create_result.get("error"):
            return create_result
        created_tab = create_result["data"]
        widgets = source_content.get("widgets") if isinstance(source_content.get("widgets"), list) else []
        return {
            "status": 200,
            "data": {
                "dashboard_id": dashboard_id,
                "dashboard_name": dashboard.get("name"),
                "app_id": dashboard.get("app_id"),
                "source_tab_id": source_tab.get("id"),
                "source_tab_name": source_tab_name,
                "new_tab_id": created_tab.get("id"),
                "new_tab_name": created_tab.get("name") or new_tab_name,
                "panel_count": len(widgets),
                "message": "Dashboard tab cloned successfully",
            },
        }

    async def evaluate_dashboard_aesthetics(self, params: dict[str, Any]) -> dict[str, Any]:
        dashboard_id = params.get("dashboard_id")
        tab_name = params.get("tab_name")
        if not dashboard_id or not tab_name:
            return self._build_error("MISSING_REQUIRED_PARAM", "evaluate_dashboard_aesthetics 需要 dashboard_id 和 tab_name。", "请提供目标仪表盘 ID 和标签页名称。")
        context_result = await self._load_tab_context(dashboard_id, str(tab_name))
        if context_result.get("error"):
            return context_result
        dashboard = context_result["data"]["dashboard"]
        tab = context_result["data"]["tab"]
        content = context_result["data"]["content"]
        widgets = content.get("widgets") if isinstance(content.get("widgets"), list) else []
        if not widgets:
            return self._build_error("EMPTY_TAB", f"标签页 {tab_name} 下没有 panel，无法进行美学评估。", "请先通过 add_dashboard_panel 添加 panel。")
        analysis = build_aesthetics_analysis(widgets, scheme=content.get("scheme"))
        return {
            "status": 200,
            "data": {
                "dashboard_id": dashboard_id,
                "dashboard_name": dashboard.get("name"),
                "tab_id": tab.get("id"),
                "tab_name": tab.get("name"),
                "widget_count": len(analysis["items"]),
                "canvas": analysis["canvas"],
                "scores": analysis["scores"],
                "overall_score": analysis["overallScore"],
                "color_analysis": analysis["colorAnalysis"],
                "issues": analysis["issues"],
                "suggestions": analysis["suggestions"],
                "message": "Dashboard aesthetics evaluated successfully",
            },
        }

    async def list_dashboard_panels(self, params: dict[str, Any]) -> dict[str, Any]:
        dashboard_id = params.get("dashboard_id")
        tab_name = params.get("tab_name")
        if not dashboard_id or not tab_name:
            return self._build_error("MISSING_REQUIRED_PARAM", "list_dashboard_panels 需要 dashboard_id 和 tab_name。", "请提供目标仪表盘 ID 和标签页名称。")
        context_result = await self._load_tab_context(dashboard_id, str(tab_name))
        if context_result.get("error"):
            return context_result
        dashboard = context_result["data"]["dashboard"]
        tab = context_result["data"]["tab"]
        content = context_result["data"]["content"]
        widgets = content.get("widgets") if isinstance(content.get("widgets"), list) else []
        panels = []
        for index, widget in enumerate(widgets):
            search_data = widget.get("searchData") if isinstance(widget.get("searchData"), dict) else {}
            panels.append(
                {
                    "panel_id": get_widget_id(widget),
                    "index": index,
                    "title": get_widget_title(widget) or f"Panel {index + 1}",
                    "type": widget.get("type") or "trend",
                    "query": search_data.get("query") or "*",
                    "time_range": search_data.get("time_range") or "-1h,now",
                    "chartType": search_data.get("chartType") or "",
                    "grid": {"x": widget.get("x", 0), "y": widget.get("y", 0), "w": widget.get("w", 6), "h": widget.get("h", 5)},
                }
            )
        return {
            "status": 200,
            "data": {
                "dashboard_id": dashboard_id,
                "dashboard_name": dashboard.get("name"),
                "tab_id": tab.get("id"),
                "tab_name": tab.get("name"),
                "panel_count": len(panels),
                "panels": panels,
                "message": "Dashboard panels listed successfully",
            },
        }

    async def update_dashboard_layout(self, params: dict[str, Any]) -> dict[str, Any]:
        dashboard_id = params.get("dashboard_id")
        tab_name = params.get("tab_name")
        layout_strategy = params.get("layout_strategy") or "auto_two_columns"
        panel_positions = params.get("panel_positions") if isinstance(params.get("panel_positions"), list) else None
        if not dashboard_id or not tab_name:
            return self._build_error("MISSING_REQUIRED_PARAM", "update_dashboard_layout 需要 dashboard_id 和 tab_name。", "请提供目标仪表盘 ID 和标签页名称。")
        context_result = await self._load_tab_context(dashboard_id, str(tab_name))
        if context_result.get("error"):
            return context_result
        dashboard = context_result["data"]["dashboard"]
        tab = context_result["data"]["tab"]
        content = context_result["data"]["content"]
        widgets = list(content.get("widgets") if isinstance(content.get("widgets"), list) else [])
        if not widgets:
            return self._build_error("EMPTY_TAB", f"标签页 {tab_name} 下没有 panel，无法调整布局。", "请先通过 add_dashboard_panel 添加 panel。")

        if panel_positions:
            positions_map = {item.get("panel_title"): item for item in panel_positions if isinstance(item, dict) and item.get("panel_title")}
            updated_widgets = []
            for index, widget in enumerate(widgets):
                title = get_widget_title(widget) or f"Panel {index + 1}"
                override = positions_map.get(title)
                if not override:
                    updated_widgets.append(widget)
                    continue
                updated_widgets.append(
                    {
                        **widget,
                        "x": override.get("x", widget.get("x", 0)),
                        "y": override.get("y", widget.get("y", 0)),
                        "w": override.get("w", widget.get("w", 6)),
                        "h": override.get("h", widget.get("h", 5)),
                    }
                )
            applied_strategy = "manual_positions"
        else:
            updated_widgets = apply_layout_strategy(widgets, str(layout_strategy))
            applied_strategy = str(layout_strategy)

        updated_content = {**content, "widgets": updated_widgets}
        save_result = await self._save_tab_content(dashboard_id, tab, updated_content)
        if save_result.get("error"):
            return save_result
        return {
            "status": 200,
            "data": {
                "dashboard_id": dashboard_id,
                "dashboard_name": dashboard.get("name"),
                "tab_id": tab.get("id"),
                "tab_name": tab.get("name"),
                "layout_strategy": applied_strategy,
                "panels_updated": len(updated_widgets),
                "message": "Dashboard layout updated successfully",
            },
        }

    async def add_dashboard_panel(self, params: dict[str, Any]) -> dict[str, Any]:
        dashboard_id = params.get("dashboard_id")
        tab_name = params.get("tab_name")
        panel = params.get("panel") if isinstance(params.get("panel"), dict) else None
        if not dashboard_id or not tab_name or panel is None:
            return self._build_error("MISSING_REQUIRED_PARAM", "add_dashboard_panel 需要 dashboard_id、tab_name 和 panel。", "请提供目标仪表盘、标签页以及 panel 配置。")
        panel_error = validate_panel_spec(panel, self._build_error)
        if panel_error:
            return panel_error
        context_result = await self._load_tab_context(dashboard_id, str(tab_name))
        if context_result.get("error"):
            return context_result
        dashboard = context_result["data"]["dashboard"]
        tab = context_result["data"]["tab"]
        content = context_result["data"]["content"]
        widgets = list(content.get("widgets") if isinstance(content.get("widgets"), list) else [])
        scheme_result = self._resolve_tab_scheme(content)
        if scheme_result.get("error"):
            return scheme_result
        tab_scheme = scheme_result["data"]["scheme"]
        if find_panel_matches(widgets, panel.get("title")):
            return self._build_error("PANEL_ALREADY_EXISTS", f'标签页 {tab_name} 下已存在同名 panel: {panel.get("title")}', "请修改 panel.title，或使用 update_dashboard_panel 更新已有 panel。")
        normalized_panel = normalize_panel_spec(panel, len(widgets), apply_default_grid=False)
        panel_color_error = self._validate_panel_color_for_scheme(normalized_panel, tab_scheme)
        if panel_color_error:
            return panel_color_error
        if normalized_panel.get("grid") is None:
            normalized_panel["grid"] = build_grid_for_additional_panel(normalized_panel, widgets)
        widgets.append(panel_to_widget(normalized_panel, len(widgets)))
        updated_content = {**content, "scheme": tab_scheme, "widgets": widgets}
        save_result = await self._save_tab_content(dashboard_id, tab, updated_content)
        if save_result.get("error"):
            return save_result
        return {
            "status": 200,
            "data": {
                "dashboard_id": dashboard_id,
                "dashboard_name": dashboard.get("name"),
                "tab_id": tab.get("id"),
                "tab_name": tab.get("name"),
                "panel_id": get_widget_id(widgets[-1]),
                "panel_title": panel.get("title"),
                "panel_type": normalized_panel["type"],
                "total_panels": len(widgets),
                "message": "Dashboard panel added successfully",
            },
        }

    async def update_dashboard_panel(self, params: dict[str, Any]) -> dict[str, Any]:
        dashboard_id = params.get("dashboard_id")
        tab_name = params.get("tab_name")
        panel_id = params.get("panel_id")
        panel_title = params.get("panel_title")
        changes = params.get("changes") if isinstance(params.get("changes"), dict) else {}
        if not dashboard_id or not tab_name or (not panel_id and not panel_title):
            return self._build_error("MISSING_REQUIRED_PARAM", "update_dashboard_panel 需要 dashboard_id、tab_name，以及 panel_id 或 panel_title。", "请提供目标仪表盘、标签页，并至少提供一个 panel 标识。")
        context_result = await self._load_tab_context(dashboard_id, str(tab_name))
        if context_result.get("error"):
            return context_result
        dashboard = context_result["data"]["dashboard"]
        tab = context_result["data"]["tab"]
        content = context_result["data"]["content"]
        widgets = list(content.get("widgets") if isinstance(content.get("widgets"), list) else [])
        matches = find_panel_matches(widgets, {"panelId": str(panel_id or ""), "panelTitle": str(panel_title or "")})
        if not matches:
            return self._build_error("PANEL_NOT_FOUND", f"未找到 panel: {panel_id or panel_title}", "请先通过 list_dashboard_panels 确认 panel_id 或 panel_title 是否正确。")
        if len(matches) > 1:
            return self._build_error("PANEL_NOT_UNIQUE", f"标签页 {tab_name} 下存在多个同名 panel: {panel_title}", "请改用 panel_id 精准定位。")

        match = matches[0]
        existing_panel = widget_to_panel(match["widget"])
        merged_panel = normalize_panel_spec(
            {
                **existing_panel,
                **changes,
                "grid": {**(existing_panel.get("grid") or {}), **(changes.get("grid") or {})},
            },
            match["index"],
        )
        panel_error = validate_panel_spec(merged_panel, self._build_error)
        if panel_error:
            return panel_error

        current_scheme_result = self._resolve_tab_scheme(content)
        if current_scheme_result.get("error"):
            return current_scheme_result
        target_scheme = current_scheme_result["data"]["scheme"]
        if "scheme" in changes:
            target_scheme = normalize_dashboard_scheme(changes.get("scheme"))
            scheme_error = self._validate_dashboard_scheme(target_scheme)
            if scheme_error:
                return scheme_error

        if "scheme" in changes or "color" in changes:
            panel_color_error = self._validate_panel_color_for_scheme(merged_panel, target_scheme)
            if panel_color_error:
                return panel_color_error

        widgets[match["index"]] = patch_widget_with_changes(match["widget"], merged_panel, changes)
        updated_content = {**content, "scheme": target_scheme, "widgets": widgets}
        if "scheme" in changes:
            conflicts = self._collect_tab_scheme_conflicts(updated_content, target_scheme)
            if conflicts["data"]:
                return self._build_error(
                    "TAB_SCHEME_COLOR_CONFLICT",
                    f"标签页 {tab_name} 的目标主题 {target_scheme} 与现有图表颜色冲突。",
                    "请先将当前 tab 内冲突 panel 的 color 改成该主题内的颜色，或保持当前主题。",
                    {"scheme": target_scheme, "conflicts": conflicts["data"]},
                )
        save_result = await self._save_tab_content(dashboard_id, tab, updated_content)
        if save_result.get("error"):
            return save_result
        return {
            "status": 200,
            "data": {
                "dashboard_id": dashboard_id,
                "dashboard_name": dashboard.get("name"),
                "tab_id": tab.get("id"),
                "tab_name": tab.get("name"),
                "panel_id": get_widget_id(match["widget"]),
                "panel_title_before": get_widget_title(match["widget"]),
                "panel_title_after": merged_panel["title"],
                "message": "Dashboard panel updated successfully",
            },
        }

    async def remove_dashboard_panel(self, params: dict[str, Any]) -> dict[str, Any]:
        dashboard_id = params.get("dashboard_id")
        tab_name = params.get("tab_name")
        panel_id = params.get("panel_id")
        panel_title = params.get("panel_title")
        if not dashboard_id or not tab_name or (not panel_id and not panel_title):
            return self._build_error("MISSING_REQUIRED_PARAM", "remove_dashboard_panel 需要 dashboard_id、tab_name，以及 panel_id 或 panel_title。", "请提供目标仪表盘、标签页，并至少提供一个 panel 标识。")
        context_result = await self._load_tab_context(dashboard_id, str(tab_name))
        if context_result.get("error"):
            return context_result
        dashboard = context_result["data"]["dashboard"]
        tab = context_result["data"]["tab"]
        content = context_result["data"]["content"]
        widgets = list(content.get("widgets") if isinstance(content.get("widgets"), list) else [])
        matches = find_panel_matches(widgets, {"panelId": str(panel_id or ""), "panelTitle": str(panel_title or "")})
        if not matches:
            return self._build_error("PANEL_NOT_FOUND", f"未找到 panel: {panel_id or panel_title}", "请先通过 list_dashboard_panels 确认 panel_id 或 panel_title 是否正确。")
        if len(matches) > 1:
            return self._build_error("PANEL_NOT_UNIQUE", f"标签页 {tab_name} 下存在多个同名 panel: {panel_title}", "请改用 panel_id 精准定位。")
        matched_panel = matches[0]
        updated_widgets = [widget for index, widget in enumerate(widgets) if index != matched_panel["index"]]
        updated_content = {**content, "widgets": apply_layout_strategy(updated_widgets, "auto_two_columns")}
        save_result = await self._save_tab_content(dashboard_id, tab, updated_content)
        if save_result.get("error"):
            return save_result
        return {
            "status": 200,
            "data": {
                "dashboard_id": dashboard_id,
                "dashboard_name": dashboard.get("name"),
                "tab_id": tab.get("id"),
                "tab_name": tab.get("name"),
                "panel_id": get_widget_id(matched_panel["widget"]),
                "panel_title": get_widget_title(matched_panel["widget"]),
                "remaining_panels": len(updated_widgets),
                "message": "Dashboard panel removed successfully",
            },
        }

    async def _request_json(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        data: Any = None,
    ) -> ApiResponse[dict[str, Any]]:
        context = get_current_server_context()
        client = LogEaseHttpClient(context.runtime_config.create_http_client_config(context.auth_context))
        try:
            request = getattr(client, method.lower())
            if method.lower() in {"post", "put"}:
                return await request(path, data=data, params=params)
            return await request(path, params=params)
        finally:
            await client.close()

    async def _get_dashboard(self, dashboard_id: str | int) -> dict[str, Any]:
        response = await self._request_json("get", f"/api/v3/dashboards/{dashboard_id}/")
        if response.error:
            return self._upstream_error(response)
        data = response.data if isinstance(response.data, dict) else {}
        if data.get("result") is False and data.get("error"):
            return self._build_error("DASHBOARD_FETCH_FAILED", f'获取仪表盘失败: {json.dumps(data.get("error"), ensure_ascii=False)}', "请检查 dashboard_id 是否存在，以及当前账号是否有访问权限。")
        dashboard = data.get("object") if isinstance(data.get("object"), dict) else None
        if dashboard is None:
            return self._build_error("DASHBOARD_NOT_FOUND", f"未找到 dashboard: {dashboard_id}", "请确认 dashboard_id 是否正确。")
        return {"status": 200, "data": dashboard}

    async def _load_tab_context(self, dashboard_id: str | int, tab_name: str) -> dict[str, Any]:
        dashboard_result = await self._get_dashboard(dashboard_id)
        if dashboard_result.get("error"):
            return dashboard_result
        dashboard = dashboard_result["data"]
        tabs = dashboard.get("tabs") if isinstance(dashboard.get("tabs"), list) else []
        tab = next((item for item in tabs if item.get("name") == tab_name), None)
        if tab is None:
            return self._build_error("TAB_NOT_FOUND", f"未找到标签页: {tab_name}", "请先确认 tab_name 是否正确，或先创建对应 tab。")
        content_result = self._parse_tab_content(tab.get("content"))
        if content_result.get("error"):
            return content_result
        return {"status": 200, "data": {"dashboard": dashboard, "tab": tab, "content": content_result["data"]}}

    def _parse_tab_content(self, raw_content: Any) -> dict[str, Any]:
        if raw_content is None:
            return {"status": 200, "data": self._build_default_tab_content([])}
        if isinstance(raw_content, dict):
            return {"status": 200, "data": {**self._build_default_tab_content([]), **raw_content}}
        if isinstance(raw_content, str):
            try:
                parsed = json.loads(raw_content)
            except json.JSONDecodeError:
                return self._build_error("INVALID_TAB_CONTENT", "当前 tab 的 content 不是合法 JSON，无法安全更新。", "请先检查 dashboard tab 的 content 数据结构。")
            if isinstance(parsed, dict):
                return {"status": 200, "data": {**self._build_default_tab_content([]), **parsed}}
        return self._build_error("INVALID_TAB_CONTENT", "当前 tab 的 content 结构无法识别。", "请先检查 dashboard tab 的 content 数据结构。")

    def _validate_tab_content_before_save(self, tab_name: str, content: dict[str, Any]) -> dict[str, Any] | None:
        widgets = content.get("widgets") if isinstance(content.get("widgets"), list) else []
        single_widget_issues = [issue for issue in (validate_single_widget_color_safety(widget) for widget in widgets if isinstance(widget, dict)) if issue]
        if single_widget_issues:
            return self._build_error(
                "INVALID_SINGLE_WIDGET_STYLE",
                f"标签页 {tab_name} 存在不安全的 single 图颜色配置。",
                "请确保 single 图在 background 模式下字色与背景色不同，且关键颜色字段保持一致。",
                {"issues": single_widget_issues},
            )
        overlaps = self._collect_widget_overlaps(widgets)
        if overlaps:
            return self._build_error(
                "PANEL_LAYOUT_OVERLAP",
                f"标签页 {tab_name} 存在 panel 重叠。",
                "请调整 panel 的 x、y、w、h，确保任意两个 panel 不发生重叠。",
                {"overlaps": overlaps},
            )
        return None

    def _collect_widget_overlaps(self, widgets: list[dict[str, Any]]) -> list[dict[str, Any]]:
        overlaps: list[dict[str, Any]] = []
        for i in range(len(widgets)):
            first = widgets[i]
            first_rect = {"x": int(first.get("x", 0)), "y": int(first.get("y", 0)), "w": int(first.get("w", 6)), "h": int(first.get("h", 5))}
            for j in range(i + 1, len(widgets)):
                second = widgets[j]
                second_rect = {"x": int(second.get("x", 0)), "y": int(second.get("y", 0)), "w": int(second.get("w", 6)), "h": int(second.get("h", 5))}
                intersects = (
                    first_rect["x"] < second_rect["x"] + second_rect["w"]
                    and first_rect["x"] + first_rect["w"] > second_rect["x"]
                    and first_rect["y"] < second_rect["y"] + second_rect["h"]
                    and first_rect["y"] + first_rect["h"] > second_rect["y"]
                )
                if intersects:
                    overlaps.append(
                        {
                            "first_panel": get_widget_title(first) or f"Panel {i + 1}",
                            "second_panel": get_widget_title(second) or f"Panel {j + 1}",
                            "first_grid": first_rect,
                            "second_grid": second_rect,
                        }
                    )
        return overlaps

    async def _save_tab_content(self, dashboard_id: str | int, tab: dict[str, Any], content: dict[str, Any]) -> dict[str, Any]:
        validation_error = self._validate_tab_content_before_save(str(tab.get("name") or "未命名标签页"), content)
        if validation_error:
            return validation_error
        response = await self._request_json(
            "put",
            f'/api/v3/dashboards/{dashboard_id}/tabs/{tab.get("id")}/',
            data={"name": tab.get("name"), "content": json.dumps(content, ensure_ascii=False)},
        )
        if response.error:
            return self._upstream_error(response)
        data = response.data if isinstance(response.data, dict) else {}
        if data.get("result") is False and data.get("error"):
            return self._build_error("DASHBOARD_SAVE_FAILED", f'更新 dashboard tab 失败: {json.dumps(data.get("error"), ensure_ascii=False)}', "请检查 tab 内容是否符合日志易要求。")
        return {"status": 200, "data": data.get("object") if isinstance(data.get("object"), dict) else data}

    async def _create_dashboard_tab(self, dashboard_id: str | int, tab_name: str, content: dict[str, Any]) -> dict[str, Any]:
        response = await self._request_json(
            "post",
            f"/api/v3/dashboards/{dashboard_id}/tabs/",
            data={"name": tab_name, "content": json.dumps(content, ensure_ascii=False)},
        )
        if response.error:
            return self._upstream_error(response)
        data = response.data if isinstance(response.data, dict) else {}
        if data.get("result") is False and data.get("error"):
            return self._build_error("DASHBOARD_TAB_CREATE_FAILED", f'创建 dashboard tab 失败: {json.dumps(data.get("error"), ensure_ascii=False)}', "请检查 tab 名称是否重复，以及 tab content 是否符合日志易要求。")
        return {"status": 200, "data": data.get("object") if isinstance(data.get("object"), dict) else data}

    def _normalize_dashboard_spec(self, spec: dict[str, Any]) -> dict[str, Any]:
        tabs = []
        raw_tabs = spec.get("tabs") if isinstance(spec.get("tabs"), list) else []
        for tab in raw_tabs:
            panels = [normalize_panel_spec(panel, index, apply_default_grid=False) for index, panel in enumerate(tab.get("panels", []) if isinstance(tab, dict) and isinstance(tab.get("panels"), list) else [])]
            tabs.append({"name": tab.get("name") if isinstance(tab, dict) else None, "scheme": normalize_dashboard_scheme((tab or {}).get("scheme") if isinstance(tab, dict) else spec.get("scheme")), "panels": assign_default_layout_to_panels(panels)})
        return {
            "name": spec.get("name"),
            "app_id": spec.get("app_id") if isinstance(spec.get("app_id"), int) else DEFAULT_DASHBOARD_APP_ID,
            "data_user": spec.get("data_user") or "viewer",
            "export": spec.get("export") or "local",
            "tabs": tabs,
        }

    def _validate_dashboard_spec(self, spec: dict[str, Any]) -> dict[str, Any] | None:
        if not spec.get("name") or not isinstance(spec.get("tabs"), list) or not spec["tabs"]:
            return self._build_error("INVALID_DASHBOARD_SPEC", "仪表盘配置至少需要 name 和一个非空 tabs。", "请提供仪表盘名称以及至少一个包含 panels 的标签页。")
        for tab in spec["tabs"]:
            if not tab.get("name") or not isinstance(tab.get("panels"), list):
                return self._build_error("INVALID_DASHBOARD_SPEC", "tabs 结构不完整：每个 tab 都必须包含 name 和 panels 数组。", "请检查 tabs[*].name 与 tabs[*].panels。")
            scheme_error = self._validate_dashboard_scheme(tab.get("scheme"))
            if scheme_error:
                return scheme_error
            for panel in tab["panels"]:
                panel_error = validate_panel_spec(panel, self._build_error)
                if panel_error:
                    return panel_error
                color_error = self._validate_panel_color_for_scheme(panel, str(tab.get("scheme")))
                if color_error:
                    return color_error
        return None

    def _validate_dashboard_scheme(self, scheme: str | None) -> dict[str, Any] | None:
        if is_supported_dashboard_scheme(scheme):
            return None
        return self._build_error(
            "INVALID_DASHBOARD_SCHEME",
            f"不支持的主题色方案: {scheme}",
            f'请使用以下主题之一：{"、".join(list_supported_dashboard_schemes())}。',
            {"supported_schemes": list_supported_dashboard_schemes()},
        )

    def _validate_panel_color_for_scheme(self, panel: dict[str, Any], scheme: str) -> dict[str, Any] | None:
        if not panel.get("color"):
            return None
        if is_color_in_dashboard_scheme(scheme, panel.get("color")):
            return None
        return self._build_error(
            "INVALID_PANEL_COLOR",
            f'panel {panel.get("title") or ""} 的颜色 {panel.get("color")} 不属于主题 {scheme}。',
            "请改用当前 tab 主题色卡中的颜色，或先显式切换当前 tab 的 scheme。",
            {"panel_title": panel.get("title") or "", "color": panel.get("color"), "scheme": scheme},
        )

    def _resolve_tab_scheme(self, content: dict[str, Any]) -> dict[str, Any]:
        scheme = normalize_dashboard_scheme(content.get("scheme"))
        scheme_error = self._validate_dashboard_scheme(scheme)
        if scheme_error:
            return scheme_error
        return {"status": 200, "data": {"scheme": scheme}}

    def _collect_tab_scheme_conflicts(self, content: dict[str, Any], target_scheme: str) -> dict[str, Any]:
        widgets = content.get("widgets") if isinstance(content.get("widgets"), list) else []
        conflicts = []
        for index, widget in enumerate(widgets):
            color = get_widget_color(widget)
            if color and not is_color_in_dashboard_scheme(target_scheme, color):
                conflicts.append({"panel_title": get_widget_title(widget) or f"Panel {index + 1}", "color": color})
        return {"status": 200, "data": conflicts}

    def _build_default_tab_content(self, widgets: list[dict[str, Any]], scheme: str | None = DEFAULT_DASHBOARD_SCHEME) -> dict[str, Any]:
        return {
            "refresh": {"time": 3, "unit": "m", "on": False, "showRefreshProcess": True},
            "showFilters": True,
            "showTitle": True,
            "editable": True,
            "scheme": normalize_dashboard_scheme(scheme),
            "theme": "day",
            "activeDrilldown": False,
            "autoUpdate": True,
            "filters": [],
            "widgets": widgets,
        }

    def _build_error(self, error_code: str, message: str, suggestion: str, details: Any | None = None) -> dict[str, Any]:
        return {"error": message, "error_code": error_code, "message": message, "suggestion": suggestion, "retryable": True, "details": details}

    def _upstream_error(self, response: ApiResponse[Any], *, fallback_message: str | None = None) -> dict[str, Any]:
        return self._build_error(
            response.error_code or "UPSTREAM_REQUEST_FAILED",
            response.message or response.error or fallback_message or "上游请求失败。",
            response.suggestion or "请检查上游地址、认证信息和请求参数。",
            response.details,
        )


class DashboardServer(RizhiyiFastMCPServer):
    def __init__(self, runtime_config: RuntimeConfig, service_state: ServiceRuntimeState) -> None:
        super().__init__(
            route_name="dashboard",
            server_name="rizhiyi_dashboard",
            title="仪表盘服务",
            description="仪表盘业务工具。",
            runtime_config=runtime_config,
            service_state=service_state,
            instructions=SERVER_LEVEL_INSTRUCTIONS,
        )
        self._module = DashboardModule()

    def _custom_tool_definitions(self) -> list[ToolDefinition]:
        panel_schema = {
            "type": "object",
            "properties": {
                "title": {"type": "string"},
                "type": {"type": "string"},
                "query": {"type": "string"},
                "time_range": {"type": "string"},
                "chartType": {"type": "string"},
                "xField": {"type": "string"},
                "yField": {"type": "string"},
                "yFields": {"type": "array", "items": {"type": "string"}},
                "ySmooths": {"type": "array", "items": {"type": "boolean"}},
                "yRanges": {"type": "array", "items": {"type": "object", "additionalProperties": True}},
                "byFields": {"type": "array", "items": {"type": "string"}},
                "fromField": {"type": "string"},
                "toField": {"type": "string"},
                "weightField": {"type": "string"},
                "outlierField": {"type": "string"},
                "upperField": {"type": "string"},
                "lowerField": {"type": "string"},
                "fromLongitudeField": {"type": "string"},
                "fromLatitudeField": {"type": "string"},
                "toLongitudeField": {"type": "string"},
                "toLatitudeField": {"type": "string"},
                "mapType": {"type": "string"},
                "color": {"type": "string"},
                "description": {"type": "string"},
                "grid": {
                    "type": "object",
                    "properties": {"x": {"type": "integer"}, "y": {"type": "integer"}, "w": {"type": "integer"}, "h": {"type": "integer"}},
                },
            },
            "required": ["title", "query"],
        }

        tools = [
            ToolDefinition(
                name="list_dashboards",
                description="获取仪表盘列表。",
                input_schema={
                    "type": "object",
                    "properties": {
                        "page": {"type": "integer", "minimum": 1},
                        "size": {"type": "integer", "minimum": 1},
                        "name": {"type": "string"},
                        "uuid": {"type": "string"},
                        "app_id": {"type": "integer"},
                        "export": {"type": "string", "enum": ["local", "system"]},
                    },
                },
            ),
            ToolDefinition(name="list_dashboard_tabs", description="列出 dashboard 下的 tabs 摘要。", input_schema={"type": "object", "properties": {"dashboard_id": {"type": "string"}}, "required": ["dashboard_id"]}),
            ToolDefinition(name="get_dashboard_tab_content", description="读取指定 dashboard/tab 的解析后 content JSON。", input_schema={"type": "object", "properties": {"dashboard_id": {"type": "string"}, "tab_name": {"type": "string"}}, "required": ["dashboard_id", "tab_name"]}),
            ToolDefinition(name="clone_dashboard_tab", description="在同一个 dashboard 内原样复制指定 tab 为新 tab。", input_schema={"type": "object", "properties": {"dashboard_id": {"type": "string"}, "source_tab_name": {"type": "string"}, "new_tab_name": {"type": "string"}}, "required": ["dashboard_id", "source_tab_name", "new_tab_name"]}),
            ToolDefinition(name="evaluate_dashboard_aesthetics", description="评估指定 dashboard/tab 的布局美学质量。", input_schema={"type": "object", "properties": {"dashboard_id": {"type": "string"}, "tab_name": {"type": "string"}}, "required": ["dashboard_id", "tab_name"]}),
            ToolDefinition(name="list_dashboard_panels", description="列出指定 dashboard/tab 下的 panel 摘要。", input_schema={"type": "object", "properties": {"dashboard_id": {"type": "string"}, "tab_name": {"type": "string"}}, "required": ["dashboard_id", "tab_name"]}),
            ToolDefinition(
                name="create_dashboard_from_template",
                description="按模板和少量上下文创建仪表盘。",
                input_schema={
                    "type": "object",
                    "properties": {
                        "template": {"type": "string", "enum": ["service_overview", "error_investigation", "traffic_trend", "host_health"]},
                        "name": {"type": "string"},
                        "app_id": {"type": "integer"},
                        "context": {"type": "object", "additionalProperties": True},
                        "data_user": {"type": "string", "enum": ["viewer", "creator"]},
                        "export": {"type": "string", "enum": ["local", "system"]},
                    },
                    "required": ["template", "name"],
                },
            ),
            ToolDefinition(
                name="create_dashboard_from_spec",
                description="根据完整的 dashboard 说明创建仪表盘。",
                input_schema={
                    "type": "object",
                    "properties": {
                        "name": {"type": "string"},
                        "app_id": {"type": "integer"},
                        "data_user": {"type": "string", "enum": ["viewer", "creator"]},
                        "export": {"type": "string", "enum": ["local", "system"]},
                        "scheme": {"type": "string", "enum": ["schemecat1", "schemecat2", "schemecat3", "schemecat4"]},
                        "tabs": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "name": {"type": "string"},
                                    "scheme": {"type": "string", "enum": ["schemecat1", "schemecat2", "schemecat3", "schemecat4"]},
                                    "panels": {"type": "array", "items": panel_schema},
                                },
                                "required": ["name", "panels"],
                            },
                        },
                    },
                    "required": ["name", "tabs"],
                },
            ),
            ToolDefinition(
                name="update_dashboard_layout",
                description="调整指定 dashboard 某个 tab 下 panel 的布局。",
                input_schema={
                    "type": "object",
                    "properties": {
                        "dashboard_id": {"type": "string"},
                        "tab_name": {"type": "string"},
                        "layout_strategy": {"type": "string", "enum": ["auto_two_columns", "single_column", "compact"]},
                        "panel_positions": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "panel_title": {"type": "string"},
                                    "x": {"type": "integer"},
                                    "y": {"type": "integer"},
                                    "w": {"type": "integer"},
                                    "h": {"type": "integer"},
                                },
                                "required": ["panel_title"],
                            },
                        },
                    },
                    "required": ["dashboard_id", "tab_name"],
                },
            ),
            ToolDefinition(name="add_dashboard_panel", description="向指定 dashboard/tab 新增一个 panel。", input_schema={"type": "object", "properties": {"dashboard_id": {"type": "string"}, "tab_name": {"type": "string"}, "panel": panel_schema}, "required": ["dashboard_id", "tab_name", "panel"]}),
            ToolDefinition(
                name="update_dashboard_panel",
                description="更新指定 dashboard/tab 下某个 panel 的内容。",
                input_schema={
                    "type": "object",
                    "properties": {
                        "dashboard_id": {"type": "string"},
                        "tab_name": {"type": "string"},
                        "panel_id": {"type": "string"},
                        "panel_title": {"type": "string"},
                        "changes": {**panel_schema, "required": []},
                    },
                    "required": ["dashboard_id", "tab_name", "changes"],
                },
            ),
            ToolDefinition(name="remove_dashboard_panel", description="删除指定 dashboard/tab 下的单个 panel。", input_schema={"type": "object", "properties": {"dashboard_id": {"type": "string"}, "tab_name": {"type": "string"}, "panel_id": {"type": "string"}, "panel_title": {"type": "string"}}, "required": ["dashboard_id", "tab_name"]}),
        ]
        return _with_output_controls(tools)

    async def call_tool(self, name: str, arguments: dict | None) -> ToolCallResult:
        safe_arguments = arguments or {}
        handlers = {
            "list_dashboards": self._module.list_dashboards,
            "list_dashboard_tabs": self._module.list_dashboard_tabs,
            "get_dashboard_tab_content": self._module.get_dashboard_tab_content,
            "clone_dashboard_tab": self._module.clone_dashboard_tab,
            "evaluate_dashboard_aesthetics": self._module.evaluate_dashboard_aesthetics,
            "list_dashboard_panels": self._module.list_dashboard_panels,
            "create_dashboard_from_template": self._module.create_dashboard_from_template,
            "create_dashboard_from_spec": self._module.create_dashboard_from_spec,
            "update_dashboard_layout": self._module.update_dashboard_layout,
            "add_dashboard_panel": self._module.add_dashboard_panel,
            "update_dashboard_panel": self._module.update_dashboard_panel,
            "remove_dashboard_panel": self._module.remove_dashboard_panel,
        }
        handler = handlers.get(name)
        if handler is None:
            raise McpServerError(f"未知工具: {name}", code=-32601, data={"name": name})
        result = await handler(safe_arguments)
        return self._format_result(name, result, safe_arguments)

    def _format_result(self, tool_name: str, result: dict[str, Any], arguments: dict[str, Any]) -> ToolCallResult:
        if result.get("error"):
            payload = {
                "error_code": result.get("error_code") or "DASHBOARD_EXECUTION_ERROR",
                "message": result.get("message") or result.get("error"),
                "suggestion": result.get("suggestion") or "请检查仪表盘配置结构，特别是 tabs、panels、query 和 grid 字段。",
                "retryable": result.get("retryable", True),
                "details": result.get("details"),
            }
            return ToolCallResult(
                structured_content=payload,
                content=[{"type": "text", "text": json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True)}],
                is_error=True,
            )
        payload = dict(result.get("data") or result)
        if arguments.get("include_raw_json"):
            payload["raw_json"] = payload
        return self._deliver_payload(tool_name, payload, arguments)


def create_dashboard_server(runtime_config: RuntimeConfig, service_state: ServiceRuntimeState) -> DashboardServer:
    return DashboardServer(runtime_config, service_state)
