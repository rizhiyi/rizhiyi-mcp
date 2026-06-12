from __future__ import annotations

from typing import Any


def build_dashboard_template_spec(
    template: str,
    name: str,
    context: dict[str, Any] | None = None,
    options: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    builders = {
        "service_overview": _build_service_overview_template,
        "error_investigation": _build_error_investigation_template,
        "traffic_trend": _build_traffic_trend_template,
        "host_health": _build_host_health_template,
    }
    builder = builders.get(str(template or "").strip())
    if builder is None:
        return None
    return builder(name, context or {}, options or {})


def _build_runtime_context(context: dict[str, Any]) -> dict[str, Any]:
    query = str(context.get("query") or "*").strip() or "*"
    time_range = str(context.get("time_range") or "-1h,now").strip() or "-1h,now"
    appname = str(context.get("appname") or "").strip() or None
    host_field = str(context.get("host_field") or "hostname").strip() or "hostname"
    scoped_query = f"appname:{appname}" if appname else query
    return {
        "query": query,
        "time_range": time_range,
        "appname": appname,
        "host_field": host_field,
        "scoped_query": scoped_query,
    }


def _build_service_overview_template(name: str, context: dict[str, Any], options: dict[str, Any]) -> dict[str, Any]:
    runtime = _build_runtime_context(context)
    return {
        "name": name,
        **options,
        "tabs": [
            {
                "name": "总览",
                "panels": [
                    {
                        "title": "服务请求趋势",
                        "type": "trend",
                        "query": runtime["scoped_query"],
                        "time_range": runtime["time_range"],
                    },
                    {
                        "title": "主机分布",
                        "type": "trend",
                        "query": f'{runtime["scoped_query"]} | stats count() by {runtime["host_field"]}',
                        "time_range": runtime["time_range"],
                        "chartType": "table",
                    },
                ],
            }
        ],
    }


def _build_error_investigation_template(name: str, context: dict[str, Any], options: dict[str, Any]) -> dict[str, Any]:
    runtime = _build_runtime_context(context)
    scoped_error_query = f'{runtime["scoped_query"]} AND status:error'
    return {
        "name": name,
        **options,
        "tabs": [
            {
                "name": "错误排查",
                "panels": [
                    {
                        "title": "错误趋势",
                        "type": "trend",
                        "query": scoped_error_query,
                        "time_range": runtime["time_range"],
                    },
                    {
                        "title": "错误主机 TopN",
                        "type": "trend",
                        "query": f'{scoped_error_query} | stats count() by {runtime["host_field"]}',
                        "time_range": runtime["time_range"],
                        "chartType": "table",
                    },
                ],
            }
        ],
    }


def _build_traffic_trend_template(name: str, context: dict[str, Any], options: dict[str, Any]) -> dict[str, Any]:
    runtime = _build_runtime_context(context)
    return {
        "name": name,
        **options,
        "tabs": [
            {
                "name": "流量趋势",
                "panels": [
                    {
                        "title": "访问趋势",
                        "type": "trend",
                        "query": runtime["scoped_query"],
                        "time_range": runtime["time_range"],
                    },
                    {
                        "title": "访问来源分布",
                        "type": "trend",
                        "query": f'{runtime["scoped_query"]} | stats count() by source',
                        "time_range": runtime["time_range"],
                        "chartType": "table",
                    },
                ],
            }
        ],
    }


def _build_host_health_template(name: str, context: dict[str, Any], options: dict[str, Any]) -> dict[str, Any]:
    runtime = _build_runtime_context(context)
    return {
        "name": name,
        **options,
        "tabs": [
            {
                "name": "主机健康",
                "panels": [
                    {
                        "title": "主机日志趋势",
                        "type": "trend",
                        "query": runtime["scoped_query"],
                        "time_range": runtime["time_range"],
                    },
                    {
                        "title": "主机日志量 TopN",
                        "type": "trend",
                        "query": f'{runtime["scoped_query"]} | stats count() by {runtime["host_field"]}',
                        "time_range": runtime["time_range"],
                        "chartType": "table",
                    },
                ],
            }
        ],
    }
