from __future__ import annotations

import json
from typing import Any
from urllib.parse import urlencode

from .log_tools_business import LogToolsBusinessService
from .log_tools_definitions import SEARCH_TOOLS
from .config import RuntimeConfig
from .http_client import LogEaseHttpClient
from .shared_result_store import SharedResultStoreError, read_shared_result, save_shared_result
from .servers import McpServerError, RizhiyiFastMCPServer, ServiceRuntimeState, get_current_server_context
from .types import ApiResponse, SharedResultSummary, ToolCallResult

SERVER_LEVEL_INSTRUCTIONS = """使用说明:
## 核心原则：先统计，后采样
1. 数量：时间窗口内有多少日志？
2. 分布：涉及哪些服务/级别/错误类型？
3. 趋势：数量在增加、稳定还是减少？
4. 再采样：先摸清全局，再获取具体条目
5. 若后续要创建或更新 dashboard 图表，请先调用 query_precheck，确认 query 语法、数据和字段映射都没问题。

## 分析框架
### 第一步：俯瞰全局
- 日志总量
- 错误率及其分布
- 受影响最大的服务

### 第二步：识别模式
- 错误聚集（短时间内大量错误）
- 时间规律（从 X 时间点开始）
- 服务关联（服务 A 报错 -> 服务 B 报错）

### 第三步：精准采样
- 在错误高峰处采样
- 获取每种不同错误类型的示例
- 与基线时段对比
## 如需减少上下文，请优先传 fields 仅选择关键字段。
## 若用户已明确要求“最近 N 条日志并做关联/根因分析”，优先一次 log_search_sheet 后直接复用其返回的 resource_uri，不要额外补做趋势/字段探测。
## 遇到错误时，优先根据 suggestion 字段修正参数后自动重试一次。"""

class LogToolsServer(RizhiyiFastMCPServer):
    def __init__(self, runtime_config: RuntimeConfig, service_state: ServiceRuntimeState) -> None:
        super().__init__(
            route_name="log-tools",
            server_name="rizhiyi_search",
            title="日志分析服务",
            description="日志检索、统计分析、趋势/异常、根因分析。",
            runtime_config=runtime_config,
            service_state=service_state,
            instructions=SERVER_LEVEL_INSTRUCTIONS,
        )
        base_url = runtime_config.logease_base_url.rstrip("/")
        self._web_base_url = base_url if base_url else ""
        self._business_service = LogToolsBusinessService(self._request_json)

    def _custom_tool_definitions(self) -> list[Any]:
        return SEARCH_TOOLS

    async def call_tool(self, name: str, arguments: dict | None) -> ToolCallResult:
        safe_arguments = arguments or {}

        if name == "log_search_sheet":
            if not self._require_non_empty_str(safe_arguments, "time_range"):
                return self._build_tool_error(
                    "MISSING_REQUIRED_PARAM",
                    "缺少必填参数 time_range。",
                    "请传入 time_range，例如 now-15m,now。",
                )
            result = await self._execute_log_search_sheet(safe_arguments)
            return self._format_result(name, result, safe_arguments)

        if name == "list_fields":
            if not self._require_non_empty_str(safe_arguments, "time_range"):
                return self._build_tool_error(
                    "MISSING_REQUIRED_PARAM",
                    "缺少必填参数 time_range。",
                    "请传入 time_range，例如 now-15m,now。",
                )
            result = await self._execute_list_fields(safe_arguments)
            return self._format_result(name, result, safe_arguments)

        if name == "list_field_values":
            if not self._require_non_empty_str(safe_arguments, "field") or not self._require_non_empty_str(
                safe_arguments, "time_range"
            ):
                return self._build_tool_error(
                    "MISSING_REQUIRED_PARAM",
                    "list_field_values 需要 field 和 time_range。",
                    "请补充 field（如 status）与 time_range（如 now-1h,now）。",
                )
            result = await self._execute_list_field_values(safe_arguments)
            return self._format_result(name, result, safe_arguments)

        if name == "query_precheck":
            if not self._require_non_empty_str(safe_arguments, "query"):
                return self._build_tool_error(
                    "MISSING_REQUIRED_PARAM",
                    "query_precheck 需要 query。",
                    "请提供要预检的 SPL 查询语句；创图前建议使用 mode=full。",
                )
            result = await self._execute_query_precheck(safe_arguments)
            return self._format_result(name, result, safe_arguments)

        if name == "log_reduce_pattern":
            if not self._require_non_empty_str(safe_arguments, "time_range"):
                return self._build_tool_error(
                    "MISSING_REQUIRED_PARAM",
                    "缺少必填参数 time_range。",
                    "请传入 time_range，例如 now-15m,now。",
                )
            result = await self._business_service.execute_log_reduce_pattern(
                query=self._coerce_str(safe_arguments.get("query"), default="*"),
                time_range=self._coerce_str(safe_arguments.get("time_range"), default="now-15m,now"),
                index_name=self._coerce_str(safe_arguments.get("index_name"), default="yotta"),
                pattern_options=safe_arguments.get("pattern_options")
                if isinstance(safe_arguments.get("pattern_options"), dict)
                else {},
            )
            return self._format_result(name, result, safe_arguments)

        if name == "log_reduce_preview":
            sid = self._coerce_str(safe_arguments.get("sid"), default="")
            if not sid:
                sid = self._resolve_sid_from_resource_uri(safe_arguments)
            if not sid:
                return self._build_tool_error(
                    "MISSING_REQUIRED_PARAM",
                    "缺少必填参数 sid。",
                    "请先调用 log_reduce_pattern 获取 sid，或传入其返回的 resource_uri。",
                )
            result = await self._business_service.execute_log_reduce_preview(
                sid=sid,
                max_retries=self._coerce_int(safe_arguments.get("max_retries"), default=10, minimum=1),
                retry_interval_ms=self._coerce_int(
                    safe_arguments.get("retry_interval"), default=5000, minimum=0
                ),
            )
            if (
                not result.error
                and result.data is not None
                and bool(safe_arguments.get("analyze_patterns"))
                and isinstance(result.data.get("result"), list)
            ):
                result.data = {
                    **result.data,
                    "pattern_analysis": self._business_service.analyze_pattern_results(
                        [
                            item
                            for item in result.data.get("result", [])
                            if isinstance(item, dict)
                        ],
                        total_hits=self._coerce_int(result.data.get("total_hits"), default=0, minimum=0),
                        limit=self._coerce_int(safe_arguments.get("analysis_limit"), default=20, minimum=1),
                    ),
                }
            return self._format_result(name, result, safe_arguments)

        if name == "trend_summary":
            reused_series = self._resolve_reused_time_series(safe_arguments, key="resource_uri")
            if reused_series is not None:
                result = self._business_service.execute_trend_summary_with_data(
                    reused_series,
                    limit_peaks=self._coerce_int(safe_arguments.get("limit_peaks"), default=3, minimum=1),
                )
                return self._format_result(name, result, safe_arguments)
            if not self._require_non_empty_str(safe_arguments, "time_range"):
                return self._build_tool_error(
                    "MISSING_REQUIRED_PARAM",
                    "缺少必填参数 time_range 或 resource_uri。",
                    "请传入 time_range，例如 now-15m,now，或传入包含时间序列数据的 resource_uri。",
                )
            result = await self._business_service.execute_trend_summary(
                query=self._coerce_str(safe_arguments.get("query"), default="*"),
                time_range=self._coerce_str(safe_arguments.get("time_range"), default="now-15m,now"),
                index_name=self._coerce_str(safe_arguments.get("index_name"), default="yotta"),
                bucket=self._optional_str(safe_arguments.get("bucket")),
                metric_field=self._optional_str(safe_arguments.get("metric_field")),
                limit_peaks=self._coerce_int(safe_arguments.get("limit_peaks"), default=3, minimum=1),
            )
            return self._format_result(name, result, safe_arguments)

        if name == "anomaly_points":
            reused_series = self._resolve_reused_time_series(safe_arguments, key="resource_uri")
            if reused_series is not None:
                result = self._business_service.execute_anomaly_points_with_data(
                    reused_series,
                    method=self._coerce_str(safe_arguments.get("method"), default="zscore"),
                    sensitivity=self._coerce_float(safe_arguments.get("sensitivity"), default=3.0),
                    min_support=self._coerce_int(safe_arguments.get("min_support"), default=0, minimum=0),
                )
                return self._format_result(name, result, safe_arguments)
            if not self._require_non_empty_str(safe_arguments, "time_range"):
                return self._build_tool_error(
                    "MISSING_REQUIRED_PARAM",
                    "缺少必填参数 time_range 或 resource_uri。",
                    "请传入 time_range，例如 now-15m,now，或传入包含时间序列数据的 resource_uri。",
                )
            result = await self._business_service.execute_anomaly_points(
                query=self._coerce_str(safe_arguments.get("query"), default="*"),
                time_range=self._coerce_str(safe_arguments.get("time_range"), default="now-15m,now"),
                index_name=self._coerce_str(safe_arguments.get("index_name"), default="yotta"),
                bucket=self._optional_str(safe_arguments.get("bucket")),
                metric_field=self._optional_str(safe_arguments.get("metric_field")),
                method=self._coerce_str(safe_arguments.get("method"), default="zscore"),
                sensitivity=self._coerce_float(safe_arguments.get("sensitivity"), default=3.0),
                min_support=self._coerce_int(safe_arguments.get("min_support"), default=0, minimum=0),
            )
            return self._format_result(name, result, safe_arguments)

        if name == "period_compare":
            series_a = self._resolve_period_compare_input(
                safe_arguments,
                direct_key="previous_time_series_a",
                resource_key="resource_uri_a",
            )
            series_b = self._resolve_period_compare_input(
                safe_arguments,
                direct_key="previous_time_series_b",
                resource_key="resource_uri_b",
            )
            if series_a is not None or series_b is not None:
                if series_a is None or series_b is None:
                    return self._build_tool_error(
                        "INVALID_ARGUMENT",
                        "必须同时提供 previous_time_series_a 和 previous_time_series_b，或同时提供 resource_uri_a 和 resource_uri_b。",
                        "请一次性传入两个时间序列，或改为使用 time_range_a/time_range_b。",
                    )
                result = await self._business_service.execute_period_compare_with_data(
                    series_a,
                    series_b,
                    query=self._coerce_str(safe_arguments.get("query"), default="*"),
                    time_range_a=self._optional_str(safe_arguments.get("time_range_a")),
                    time_range_b=self._optional_str(safe_arguments.get("time_range_b")),
                    index_name=self._coerce_str(safe_arguments.get("index_name"), default="yotta"),
                    compare_fields=self._normalize_string_list(safe_arguments.get("compare_fields")),
                    topk=self._coerce_int(safe_arguments.get("topk"), default=10, minimum=1),
                )
                return self._format_result(name, result, safe_arguments)
            if not self._require_non_empty_str(safe_arguments, "time_range_a") or not self._require_non_empty_str(
                safe_arguments, "time_range_b"
            ):
                return self._build_tool_error(
                    "INVALID_ARGUMENT",
                    "必须提供 previous_time_series 或者 time_range_a 和 time_range_b 参数。",
                    "请传入 previous_time_series_a/b，或同时传 time_range_a 和 time_range_b。",
                )
            result = await self._business_service.execute_period_compare(
                query=self._coerce_str(safe_arguments.get("query"), default="*"),
                time_range_a=self._coerce_str(safe_arguments.get("time_range_a"), default=""),
                time_range_b=self._coerce_str(safe_arguments.get("time_range_b"), default=""),
                index_name=self._coerce_str(safe_arguments.get("index_name"), default="yotta"),
                bucket=self._optional_str(safe_arguments.get("bucket")),
                compare_fields=self._normalize_string_list(safe_arguments.get("compare_fields")),
                topk=self._coerce_int(safe_arguments.get("topk"), default=10, minimum=1),
                metric_field=self._optional_str(safe_arguments.get("metric_field")),
            )
            return self._format_result(name, result, safe_arguments)

        if name == "correlation_analysis":
            if not self._require_non_empty_str(safe_arguments, "time_range"):
                return self._build_tool_error(
                    "MISSING_REQUIRED_PARAM",
                    "缺少必填参数 time_range。",
                    "请传入 time_range，例如 now-15m,now。",
                )
            result = await self._business_service.execute_correlation_analysis(
                query=self._coerce_str(safe_arguments.get("query"), default="*"),
                time_range=self._coerce_str(safe_arguments.get("time_range"), default="now-15m,now"),
                index_name=self._coerce_str(safe_arguments.get("index_name"), default="yotta"),
                fields=self._normalize_string_list(safe_arguments.get("fields")),
                mode=self._coerce_str(safe_arguments.get("mode"), default="auto"),
                bucket=self._optional_str(safe_arguments.get("bucket")),
                max_lag=self._coerce_int(safe_arguments.get("max_lag"), default=3, minimum=0),
                min_support=self._coerce_float(safe_arguments.get("min_support"), default=0.05),
                min_confidence=self._coerce_float(safe_arguments.get("min_confidence"), default=0.6),
                sample_size=self._coerce_int(safe_arguments.get("sample_size"), default=500, minimum=1),
                limit=self._coerce_int(safe_arguments.get("limit"), default=20, minimum=1),
                input_rows=self._resolve_reused_rows(safe_arguments, key="resource_uri"),
            )
            return self._format_result(name, result, safe_arguments)

        if name == "root_cause_suggestions":
            if not self._require_non_empty_str(safe_arguments, "anomaly_window") or not self._require_non_empty_str(
                safe_arguments, "baseline_window"
            ):
                return self._build_tool_error(
                    "MISSING_REQUIRED_PARAM",
                    "root_cause_suggestions 需要 anomaly_window 和 baseline_window。",
                    "请补充异常窗口和基线窗口时间范围。",
                )
            result = await self._business_service.execute_root_cause_suggestions(
                query=self._coerce_str(safe_arguments.get("query"), default="*"),
                anomaly_window=self._coerce_str(safe_arguments.get("anomaly_window"), default=""),
                baseline_window=self._coerce_str(safe_arguments.get("baseline_window"), default=""),
                index_name=self._coerce_str(safe_arguments.get("index_name"), default="yotta"),
                candidate_fields=self._normalize_string_list(safe_arguments.get("candidate_fields")),
                significance_threshold=self._coerce_float(
                    safe_arguments.get("significance_threshold"), default=0.1
                ),
                topk=self._coerce_int(safe_arguments.get("topk"), default=5, minimum=1),
                field_value_limit=self._coerce_int(
                    safe_arguments.get("field_value_limit"), default=20, minimum=1
                ),
                sample_size=self._coerce_int(safe_arguments.get("sample_size"), default=300, minimum=1),
                slice_max_depth=self._coerce_int(safe_arguments.get("slice_max_depth"), default=2, minimum=1),
                min_slice_support=self._coerce_float(
                    safe_arguments.get("min_slice_support"), default=0.05
                ),
                min_slice_lift=self._coerce_float(safe_arguments.get("min_slice_lift"), default=2.0),
                input_rows=self._resolve_reused_rows(safe_arguments, key="resource_uri"),
            )
            return self._format_result(name, result, safe_arguments)

        if name == "trend_forecast":
            reused_series = self._resolve_reused_time_series(safe_arguments, key="resource_uri")
            if reused_series is not None:
                result = self._business_service.execute_trend_forecast_with_data(
                    reused_series,
                    horizon=self._coerce_int(safe_arguments.get("horizon"), default=12, minimum=1),
                    method=self._coerce_str(safe_arguments.get("method"), default="linear_regression"),
                    confidence=self._coerce_float(safe_arguments.get("confidence"), default=0.95),
                    window=self._coerce_int(safe_arguments.get("window"), default=10, minimum=1),
                    alpha=self._coerce_float(safe_arguments.get("alpha"), default=0.3),
                )
                return self._format_result(name, result, safe_arguments)
            if not self._require_non_empty_str(safe_arguments, "time_range"):
                return self._build_tool_error(
                    "MISSING_REQUIRED_PARAM",
                    "缺少必填参数 time_range 或 resource_uri。",
                    "请传入 time_range，例如 now-24h,now，或传入包含时间序列数据的 resource_uri。",
                )
            result = await self._business_service.execute_trend_forecast(
                query=self._coerce_str(safe_arguments.get("query"), default="*"),
                time_range=self._coerce_str(safe_arguments.get("time_range"), default="now-24h,now"),
                index_name=self._coerce_str(safe_arguments.get("index_name"), default="yotta"),
                bucket=self._optional_str(safe_arguments.get("bucket")),
                horizon=self._coerce_int(safe_arguments.get("horizon"), default=12, minimum=1),
                method=self._coerce_str(safe_arguments.get("method"), default="linear_regression"),
                confidence=self._coerce_float(safe_arguments.get("confidence"), default=0.95),
                metric_field=self._optional_str(safe_arguments.get("metric_field")),
                window=self._coerce_int(safe_arguments.get("window"), default=10, minimum=1),
                alpha=self._coerce_float(safe_arguments.get("alpha"), default=0.3),
            )
            return self._format_result(name, result, safe_arguments)

        if name == "anomaly_alert":
            reused_series = self._resolve_reused_time_series(safe_arguments, key="resource_uri")
            if reused_series is not None:
                result = self._business_service.execute_anomaly_alert_with_data(
                    reused_series,
                    method=self._coerce_str(safe_arguments.get("method"), default="prediction_band"),
                    threshold=self._coerce_float(safe_arguments.get("threshold"), default=3.0),
                    alert_on=self._coerce_str(safe_arguments.get("alert_on"), default="both"),
                    min_anomaly_points=self._coerce_int(
                        safe_arguments.get("min_anomaly_points"), default=3, minimum=1
                    ),
                    forecast_horizon=self._coerce_int(
                        safe_arguments.get("forecast_horizon"), default=6, minimum=1
                    ),
                )
                return self._format_result(name, result, safe_arguments)
            if not self._require_non_empty_str(safe_arguments, "time_range"):
                return self._build_tool_error(
                    "MISSING_REQUIRED_PARAM",
                    "缺少必填参数 time_range 或 resource_uri。",
                    "请传入 time_range，例如 now-24h,now，或传入包含时间序列数据的 resource_uri。",
                )
            result = await self._business_service.execute_anomaly_alert(
                query=self._coerce_str(safe_arguments.get("query"), default="*"),
                time_range=self._coerce_str(safe_arguments.get("time_range"), default="now-24h,now"),
                index_name=self._coerce_str(safe_arguments.get("index_name"), default="yotta"),
                bucket=self._optional_str(safe_arguments.get("bucket")),
                method=self._coerce_str(safe_arguments.get("method"), default="prediction_band"),
                threshold=self._coerce_float(safe_arguments.get("threshold"), default=3.0),
                alert_on=self._coerce_str(safe_arguments.get("alert_on"), default="both"),
                min_anomaly_points=self._coerce_int(
                    safe_arguments.get("min_anomaly_points"), default=3, minimum=1
                ),
                forecast_horizon=self._coerce_int(
                    safe_arguments.get("forecast_horizon"), default=6, minimum=1
                ),
                metric_field=self._optional_str(safe_arguments.get("metric_field")),
            )
            return self._format_result(name, result, safe_arguments)

        raise McpServerError(f"未知工具: {name}", code=-32601, data={"name": name})

    async def close(self) -> None:
        return None

    async def _request_json(
        self,
        path: str,
        *,
        params: dict[str, Any] | None = None,
    ) -> ApiResponse[dict[str, Any]]:
        context = get_current_server_context()
        client = LogEaseHttpClient(context.runtime_config.create_http_client_config(context.auth_context))
        try:
            return await client.get(path, params=params)
        finally:
            await client.close()

    async def _execute_log_search_sheet(self, arguments: dict[str, Any]) -> ApiResponse[dict[str, Any]]:
        page = self._coerce_int(arguments.get("page"), default=0, minimum=0)
        size = self._coerce_int(arguments.get("size"), default=None, minimum=0)
        limit = self._coerce_int(arguments.get("limit"), default=20, minimum=0)
        effective_size = size if size is not None else limit
        query = self._coerce_str(arguments.get("query"), default="*")
        time_range = self._coerce_str(arguments.get("time_range"), default="now-15m,now")
        index_name = self._coerce_str(arguments.get("index_name"), default="yotta")
        fields = arguments.get("fields")

        response = await self._request_json(
            "/api/v3/search/sheets/",
            params={
                "query": query,
                "time_range": time_range,
                "index_name": index_name,
                "page": page,
                "size": effective_size,
            },
        )
        if response.error or response.data is None:
            return response

        raw_rows = response.data.get("results", {}).get("sheets", {}).get("rows", [])
        rows = raw_rows if isinstance(raw_rows, list) else []
        total = self._coerce_int(response.data.get("results", {}).get("total_hits"), default=len(rows), minimum=0)
        hits = [self._inject_quick_links(row, query, time_range, index_name) for row in rows if isinstance(row, dict)]

        if isinstance(fields, list) and fields:
            requested_fields = [str(field) for field in fields if str(field).strip()]
            include_links = "_links" in requested_fields
            hits = [self._project_row(row, requested_fields, include_links=include_links) for row in hits]

        returned = len(hits)
        return ApiResponse(
            status=response.status,
            data={
                "hits": hits,
                "total": total,
                "page": page,
                "size": effective_size,
                "returned": returned,
                "has_more": self._compute_has_more(total, page, effective_size, returned),
            },
            message="日志搜索成功",
        )

    async def _execute_list_fields(self, arguments: dict[str, Any]) -> ApiResponse[dict[str, Any]]:
        query = self._coerce_str(arguments.get("query"), default="*")
        time_range = self._coerce_str(arguments.get("time_range"), default="now-15m,now")
        index_name = self._coerce_str(arguments.get("index_name"), default="yotta")

        response = await self._request_json(
            "/api/v3/search/sheets/",
            params={
                "query": query,
                "time_range": time_range,
                "index_name": index_name,
                "page": 0,
                "size": 0,
                "fields": True,
            },
        )
        if response.error or response.data is None:
            return response

        raw_fields = response.data.get("results", {}).get("fields", [])
        fields: list[dict[str, Any]] = []
        if isinstance(raw_fields, list):
            for item in raw_fields:
                if not isinstance(item, dict):
                    continue
                fields.append(
                    {
                        "name": item.get("name"),
                        "type": item.get("type") or "unknown",
                        "distinct_count": self._coerce_int(item.get("dc"), default=0, minimum=0),
                        "total": self._coerce_int(item.get("total"), default=0, minimum=0),
                        "top_values": item.get("topk") if isinstance(item.get("topk"), list) else [],
                    }
                )

        return ApiResponse(
            status=response.status,
            data={"fields": fields, "total": len(fields)},
            message="字段列表获取成功",
        )

    async def _execute_list_field_values(self, arguments: dict[str, Any]) -> ApiResponse[dict[str, Any]]:
        field = self._coerce_str(arguments.get("field"), default="")
        query = self._coerce_str(arguments.get("query"), default="*")
        time_range = self._coerce_str(arguments.get("time_range"), default="now-15m,now")
        index_name = self._coerce_str(arguments.get("index_name"), default="yotta")
        limit = self._coerce_int(arguments.get("limit"), default=100, minimum=0)

        field_query = f"{query} | stats count by {field}" if query != "*" else f"* | stats count by {field}"
        response = await self._request_json(
            "/api/v3/search/sheets/",
            params={
                "query": field_query,
                "time_range": time_range,
                "index_name": index_name,
                "page": 0,
                "size": limit,
                "fields": True,
            },
        )
        if response.error or response.data is None:
            return response

        raw_rows = response.data.get("results", {}).get("sheets", {}).get("rows", [])
        rows = raw_rows if isinstance(raw_rows, list) else []
        values = []
        for row in rows[:limit]:
            if not isinstance(row, dict):
                continue
            values.append(
                {
                    "value": row.get(field),
                    "count": self._coerce_int(row.get("count"), default=0, minimum=0),
                }
            )

        return ApiResponse(
            status=response.status,
            data={"field": field, "values": values, "total": len(values)},
            message="字段值列表获取成功",
        )

    async def _execute_query_precheck(self, arguments: dict[str, Any]) -> ApiResponse[dict[str, Any]]:
        query = self._coerce_str(arguments.get("query"), default="")
        time_range = self._coerce_str(arguments.get("time_range"), default="now-15m,now")
        index_name = self._coerce_str(arguments.get("index_name"), default="yotta")
        mode = self._coerce_str(arguments.get("mode"), default="full")
        expected_fields = self._normalize_string_list(arguments.get("expected_fields"))
        field_mapping = arguments.get("field_mapping") if isinstance(arguments.get("field_mapping"), dict) else {}
        sample_fields = self._normalize_string_list(arguments.get("sample_fields"))
        sample_size = self._coerce_int(arguments.get("sample_size"), default=20, minimum=0)
        terminated_after_size = self._coerce_int(arguments.get("terminated_after_size"), default=100, minimum=1)

        flattened_expected_fields = self._flatten_expected_fields(expected_fields, field_mapping)
        syntax_check: dict[str, Any] = {"checked": False, "passed": True}
        data_check: dict[str, Any] = {"checked": False}
        field_check: dict[str, Any] = {"checked": False}

        if mode in {"syntax_only", "full"}:
            syntax_response = await self._execute_query_syntax_precheck(query, time_range)
            if syntax_response.error or syntax_response.data is None:
                return self._copy_error_response(syntax_response, fallback_message="查询语法预检失败")
            syntax_check.update(syntax_response.data)

        if mode in {"data_only", "full"} and syntax_check.get("passed") is not False:
            merged_sample_fields = list(dict.fromkeys(sample_fields + flattened_expected_fields))
            data_response = await self._execute_query_data_precheck(
                query=query,
                time_range=time_range,
                index_name=index_name,
                sample_size=sample_size,
                terminated_after_size=terminated_after_size,
                sample_fields=merged_sample_fields,
            )
            if data_response.error or data_response.data is None:
                return self._copy_error_response(data_response, fallback_message="查询有数预检失败")
            data_check.update(data_response.data)

        if data_check.get("checked") and flattened_expected_fields:
            available_fields = self._normalize_string_list(data_check.get("available_fields"))
            available_set = {field.lower() for field in available_fields}
            missing_fields = [field for field in flattened_expected_fields if field.lower() not in available_set]
            field_check.update(
                {
                    "checked": True,
                    "field_match": not missing_fields,
                    "expected_fields": flattened_expected_fields,
                    "missing_fields": missing_fields,
                    "field_suggestions": self._build_field_suggestions(missing_fields, available_fields),
                }
            )

        available_fields = self._normalize_string_list(data_check.get("available_fields"))
        missing_fields = self._normalize_string_list(field_check.get("missing_fields"))
        field_suggestions = field_check.get("field_suggestions") if isinstance(field_check.get("field_suggestions"), dict) else {}

        recommended_next_action = "proceed"
        recommendation_reason = "查询通过预检，可以继续后续分析或创图。"
        if syntax_check.get("checked") and syntax_check.get("passed") is False:
            recommended_next_action = "fix_query_syntax"
            recommendation_reason = self._coerce_str(
                syntax_check.get("error_message"),
                default="查询语法预检失败，请先修正 SPL 语句。",
            )
        elif data_check.get("checked") and data_check.get("has_data") is False:
            recommended_next_action = "fix_query_or_time_range"
            recommendation_reason = "语法通过但当前时间范围内无数据，请调整 query 或 time_range。"
        elif field_check.get("checked") and field_check.get("field_match") is False:
            recommended_next_action = "fix_field_mapping"
            recommendation_reason = "查询有数据，但字段映射不匹配当前图表配置。"
        elif mode == "syntax_only":
            recommendation_reason = "当前只完成语法预检；如果要创图，建议继续执行 data_only 或 full。"

        return ApiResponse(
            status=200,
            data={
                "query": query,
                "mode": mode,
                "syntax_check": syntax_check,
                "data_check": data_check,
                "field_check": field_check,
                "has_data": data_check.get("has_data") if isinstance(data_check.get("has_data"), bool) else None,
                "available_fields": available_fields,
                "missing_fields": missing_fields,
                "field_suggestions": field_suggestions,
                "recommended_next_action": recommended_next_action,
                "recommendation_reason": recommendation_reason,
            },
            message="查询预检完成",
        )

    async def _execute_query_syntax_precheck(
        self,
        query: str,
        time_range: str,
    ) -> ApiResponse[dict[str, Any]]:
        response = await self._request_json(
            "/api/v3/search/precheck/",
            params={
                "query": query,
                "time_range": time_range,
                "lang": "zh_CN",
                "timeline": "false",
                "statsevents": "false",
            },
        )
        if response.error or response.data is None:
            return response

        raw = response.data
        error_message = self._extract_syntax_error_message(raw)
        passed = self._did_syntax_precheck_pass(raw, error_message)
        return ApiResponse(
            status=response.status,
            data={
                "checked": True,
                "passed": passed,
                "error_message": None if passed else (error_message or "查询语法预检未通过"),
                "hints": self._extract_syntax_hints(raw),
                "raw": raw,
            },
            message="查询语法预检通过" if passed else "查询语法预检未通过",
        )

    async def _execute_query_data_precheck(
        self,
        *,
        query: str,
        time_range: str,
        index_name: str,
        sample_size: int,
        terminated_after_size: int,
        sample_fields: list[str],
    ) -> ApiResponse[dict[str, Any]]:
        response = await self._request_json(
            "/api/v3/search/sheets/",
            params={
                "query": query,
                "time_range": time_range,
                "index_name": index_name,
                "size": sample_size,
                "fields": True,
                "timeline": "false",
                "highlight": "false",
                "statsevents": "false",
                "terminated_after_size": terminated_after_size,
            },
        )
        if response.error or response.data is None:
            return response

        raw = response.data
        raw_rows = raw.get("results", {}).get("sheets", {}).get("rows", [])
        rows = [row for row in raw_rows if isinstance(row, dict)] if isinstance(raw_rows, list) else []
        sample_rows = rows
        if sample_fields:
            sample_rows = [self._project_row(row, sample_fields, include_links=False) for row in rows]

        return ApiResponse(
            status=response.status,
            data={
                "checked": True,
                "has_data": bool(rows),
                "total_hits": self._coerce_int(raw.get("results", {}).get("total_hits"), default=len(rows), minimum=0),
                "sample_hit_count": len(rows),
                "available_fields": self._extract_available_fields(raw),
                "sample_rows": sample_rows,
                "terminated_after_size": terminated_after_size,
            },
            message="查询有数预检通过" if rows else "查询无数据",
        )

    def _format_result(
        self,
        tool_name: str,
        result: ApiResponse[dict[str, Any]],
        arguments: dict[str, Any],
    ) -> ToolCallResult:
        if result.error or result.data is None:
            return self._build_tool_error(
                result.error_code or self._infer_error_code(result),
                result.message or result.error or "工具执行失败",
                result.suggestion or self._infer_suggestion(result),
                retryable=result.retryable if isinstance(result.retryable, bool) else True,
                details=result.details,
            )

        payload = self._build_success_payload(result.data, arguments)
        return self._deliver_tool_payload(tool_name, payload, arguments)

    def _build_success_payload(self, data: dict[str, Any], arguments: dict[str, Any]) -> dict[str, Any]:
        payload = dict(data)
        if arguments.get("include_raw_json"):
            payload["raw_json"] = data
        return payload

    def _deliver_tool_payload(self, tool_name: str, payload: dict[str, Any], arguments: dict[str, Any]) -> ToolCallResult:
        delivery = self._coerce_str(arguments.get("result_delivery"), default="auto")
        should_resource = self._should_persist_as_shared_resource(tool_name, payload, arguments)
        if delivery == "inline" and not should_resource:
            return self._build_tool_result({"delivery": "inline", "data": payload})

        if should_resource:
            try:
                envelope = save_shared_result(
                    self.runtime_config,
                    route_name=self.route_name,
                    tool_name=tool_name,
                    result_kind=self._infer_shared_result_kind(tool_name),
                    payload=payload,
                    summary=self._build_shared_result_summary(tool_name, payload),
                    source_query=self._optional_str(arguments.get("query")),
                    time_range=self._resolve_primary_time_range(arguments),
                    index_name=self._optional_str(arguments.get("index_name")),
                    upstream_sid=self._extract_sid_from_payload(payload),
                    ttl_seconds=self._parse_ttl_seconds(arguments),
                )
            except SharedResultStoreError as exc:
                return self._build_tool_error(
                    exc.code,
                    str(exc),
                    self._shared_store_suggestion(exc.code),
                )
            return self._build_tool_result(
                {
                    "delivery": "resource",
                    "resource_uri": envelope.resource_uri,
                    "resource_title": envelope.resource_title,
                    "resource_type": envelope.resource_type,
                    "resource_mime_type": envelope.resource_mime_type,
                    "tool_name": envelope.tool_name,
                    "result_kind": envelope.result_kind,
                    "created_at": envelope.created_at,
                    "expires_at": envelope.expires_at,
                    "payload_bytes": envelope.payload_bytes,
                    "upstream_sid": envelope.upstream_sid,
                    "summary": {
                        "title": envelope.summary.title,
                        "text": envelope.summary.text,
                        "key_metrics": envelope.summary.key_metrics,
                        "preview_fields": envelope.summary.preview_fields,
                        "warnings": envelope.summary.warnings,
                    },
                }
            )

        return self._build_tool_result({"delivery": "inline", "data": payload})

    def _should_persist_as_shared_resource(
        self,
        tool_name: str,
        payload: dict[str, Any],
        arguments: dict[str, Any],
    ) -> bool:
        delivery = self._coerce_str(arguments.get("result_delivery"), default="auto")
        if delivery == "resource":
            return True
        if delivery == "inline":
            return False
        if tool_name == "log_search_sheet" and self._coerce_str(arguments.get("delivery_policy"), default="compat") != "bytes":
            requested_size = self._coerce_int(arguments.get("size"), default=None, minimum=0)
            if requested_size is None:
                requested_size = self._coerce_int(arguments.get("limit"), default=20, minimum=0)
            if requested_size > 20:
                return True
        serialized = payload
        if arguments.get("include_raw_json"):
            serialized = {"data": payload, "raw_json": payload}
        return len(json.dumps(serialized, ensure_ascii=False).encode("utf-8")) > self.runtime_config.log_tools_result_inline_max_bytes

    def _infer_shared_result_kind(self, tool_name: str) -> str:
        if tool_name == "log_search_sheet":
            return "rows"
        if tool_name == "query_precheck":
            return "precheck"
        if tool_name in {"log_reduce_pattern", "log_reduce_preview"}:
            return "patterns"
        if tool_name in {"list_fields", "list_field_values"}:
            return "stats"
        if tool_name in {"trend_summary", "anomaly_points", "period_compare", "trend_forecast", "anomaly_alert"}:
            return "timeseries"
        if tool_name in {"correlation_analysis", "root_cause_suggestions"}:
            return "analysis"
        return "generic"

    def _build_shared_result_summary(self, tool_name: str, payload: dict[str, Any]) -> SharedResultSummary:
        if tool_name == "log_search_sheet":
            hits = payload.get("hits") if isinstance(payload.get("hits"), list) else []
            preview_fields = list(hits[0].keys())[:8] if hits and isinstance(hits[0], dict) else []
            return SharedResultSummary(
                title="日志明细已转为共享资源",
                text=f'共命中 {self._coerce_int(payload.get("total"), default=len(hits), minimum=0)} 条，本页返回 {self._coerce_int(payload.get("returned"), default=len(hits), minimum=0)} 条。',
                key_metrics={
                    "total": self._coerce_int(payload.get("total"), default=len(hits), minimum=0),
                    "returned": self._coerce_int(payload.get("returned"), default=len(hits), minimum=0),
                    "page": self._coerce_int(payload.get("page"), default=0, minimum=0),
                    "size": self._coerce_int(payload.get("size"), default=len(hits), minimum=0),
                    "has_more": bool(payload.get("has_more")),
                },
                preview_fields=preview_fields,
            )
        if tool_name == "query_precheck":
            available_fields = self._normalize_string_list(payload.get("available_fields"))
            data_check = payload.get("data_check") if isinstance(payload.get("data_check"), dict) else {}
            return SharedResultSummary(
                title="预检结果已转为共享资源",
                text=f'has_data={payload.get("has_data")}，样例行 {self._coerce_int(data_check.get("sample_hit_count"), default=0, minimum=0)} 条。',
                key_metrics={
                    "has_data": payload.get("has_data"),
                    "total_hits": self._coerce_int(data_check.get("total_hits"), default=0, minimum=0),
                    "sample_hit_count": self._coerce_int(data_check.get("sample_hit_count"), default=0, minimum=0),
                    "available_fields_count": len(available_fields),
                    "missing_fields_count": len(self._normalize_string_list(payload.get("missing_fields"))),
                },
                preview_fields=available_fields[:8],
            )
        if tool_name in {"log_reduce_pattern", "log_reduce_preview"}:
            patterns = payload.get("result") if isinstance(payload.get("result"), list) else []
            return SharedResultSummary(
                title="聚类结果已转为共享资源",
                text=f'sid={self._extract_sid_from_payload(payload) or "unknown"}，总命中 {self._coerce_int(payload.get("total_hits"), default=0, minimum=0)}。',
                key_metrics={
                    "total_hits": self._coerce_int(payload.get("total_hits"), default=0, minimum=0),
                    "pattern_count": len(patterns),
                },
            )
        if tool_name in {"trend_summary", "anomaly_points", "trend_forecast", "anomaly_alert"}:
            series = self._extract_time_series_from_payload(payload)
            return SharedResultSummary(
                title="时间序列结果已转为共享资源",
                text=f"时间序列点数 {len(series)}。",
                key_metrics={
                    "series_points": len(series),
                    "anomaly_count": len(payload.get("anomalies", [])) if isinstance(payload.get("anomalies"), list) else 0,
                    "forecast_points": len(payload.get("forecast", [])) if isinstance(payload.get("forecast"), list) else 0,
                    "alert_triggered": bool(payload.get("alert_triggered")),
                },
            )
        if tool_name == "period_compare":
            period_a = payload.get("period_a") if isinstance(payload.get("period_a"), dict) else {}
            period_b = payload.get("period_b") if isinstance(payload.get("period_b"), dict) else {}
            differences = payload.get("differences") if isinstance(payload.get("differences"), dict) else {}
            return SharedResultSummary(
                title="时间序列对比结果已转为共享资源",
                text=f"窗口 A 点数 {len(self._extract_time_series_from_payload(period_a))}，窗口 B 点数 {len(self._extract_time_series_from_payload(period_b))}。",
                key_metrics={
                    "period_a_points": len(self._extract_time_series_from_payload(period_a)),
                    "period_b_points": len(self._extract_time_series_from_payload(period_b)),
                    "total_change": self._coerce_float(differences.get("total_change"), default=0.0),
                },
            )
        if tool_name in {"correlation_analysis", "root_cause_suggestions"}:
            result_count = 0
            if isinstance(payload.get("results"), list):
                result_count = len(payload["results"])
            elif isinstance(payload.get("distribution_drift"), list):
                result_count = len(payload["distribution_drift"])
            return SharedResultSummary(
                title="分析结果已转为共享资源",
                text=str(payload.get("summary") or "分析结果较大，已转为共享资源。"),
                key_metrics={"result_count": result_count},
            )
        return SharedResultSummary(
            title="结果已转为共享资源",
            text="该结果体积较大，已落盘为共享资源，可按需读取。",
        )

    def _resolve_primary_time_range(self, arguments: dict[str, Any]) -> str | None:
        for key in ("time_range", "anomaly_window", "time_range_a"):
            value = self._optional_str(arguments.get(key))
            if value:
                return value
        return None

    def _shared_store_suggestion(self, code: str) -> str:
        if code == "INVALID_RESOURCE_URI":
            return "请传入合法的 resource_uri，格式应为 `logease://shared-result/<handle>`。"
        if code == "HANDLE_NOT_FOUND":
            return "资源不存在。请确认它没有被删除，并且该 resource_uri 来自当前环境。"
        if code == "HANDLE_EXPIRED":
            return "资源已过期。请重新执行源工具，使用新生成的 resource_uri。"
        return "请缩小时间范围、减少 fields，或降低 sample_size 后重试。"

    def _resolve_sid_from_resource_uri(self, arguments: dict[str, Any]) -> str:
        resource_uri = self._optional_str(arguments.get("resource_uri"))
        if not resource_uri:
            return ""
        try:
            envelope = read_shared_result(self.runtime_config, resource_uri)
        except SharedResultStoreError:
            return ""
        return self._extract_sid_from_payload(envelope.payload) or self._optional_str(envelope.upstream_sid) or ""

    def _resolve_reused_rows(self, arguments: dict[str, Any], *, key: str) -> list[dict[str, Any]]:
        payload = self._read_resource_payload(arguments.get(key))
        if payload is None:
            return []
        return self._extract_rows_from_payload(payload)

    def _resolve_reused_time_series(self, arguments: dict[str, Any], *, key: str) -> list[dict[str, Any]] | None:
        payload = self._read_resource_payload(arguments.get(key))
        if payload is None:
            return None
        return self._extract_time_series_from_payload(payload)

    def _resolve_period_compare_input(
        self,
        arguments: dict[str, Any],
        *,
        direct_key: str,
        resource_key: str,
    ) -> Any | None:
        direct_value = arguments.get(direct_key)
        if isinstance(direct_value, dict):
            return direct_value
        if isinstance(direct_value, list):
            return direct_value
        return self._read_resource_payload(arguments.get(resource_key))

    def _read_resource_payload(self, value: Any) -> dict[str, Any] | None:
        resource_uri = self._optional_str(value)
        if not resource_uri:
            return None
        try:
            envelope = read_shared_result(self.runtime_config, resource_uri)
        except SharedResultStoreError:
            return None
        if isinstance(envelope.payload, dict):
            return envelope.payload
        return None

    def _extract_rows_from_payload(self, payload: dict[str, Any]) -> list[dict[str, Any]]:
        if isinstance(payload.get("hits"), list):
            return [item for item in payload["hits"] if isinstance(item, dict)]
        data_check = payload.get("data_check")
        if isinstance(data_check, dict) and isinstance(data_check.get("sample_rows"), list):
            return [item for item in data_check["sample_rows"] if isinstance(item, dict)]
        if isinstance(payload.get("sample_rows"), list):
            return [item for item in payload["sample_rows"] if isinstance(item, dict)]
        return []

    def _extract_time_series_from_payload(self, payload: dict[str, Any]) -> list[dict[str, Any]]:
        for key in ("series", "points", "source_series"):
            value = payload.get(key)
            if isinstance(value, list):
                return [item for item in value if isinstance(item, dict)]
        data = payload.get("data")
        if isinstance(data, dict):
            return self._extract_time_series_from_payload(data)
        if isinstance(payload.get("timestamps"), list) and isinstance(payload.get("values"), list):
            timestamps = payload["timestamps"]
            values = payload["values"]
            return [
                {
                    "timestamp": str(timestamp),
                    "value": self._coerce_float(values[index] if index < len(values) else 0, default=0.0),
                    "count": self._coerce_float(values[index] if index < len(values) else 0, default=0.0),
                }
                for index, timestamp in enumerate(timestamps)
            ]
        return []

    def _extract_sid_from_payload(self, payload: dict[str, Any]) -> str | None:
        sid = payload.get("sid")
        if isinstance(sid, str) and sid.strip():
            return sid.strip()
        raw_json = payload.get("raw_json")
        if isinstance(raw_json, dict):
            sid = raw_json.get("sid")
            if isinstance(sid, str) and sid.strip():
                return sid.strip()
        return None

    def _build_tool_error(
        self,
        error_code: str,
        message: str,
        suggestion: str,
        *,
        retryable: bool = True,
        details: Any | None = None,
    ) -> ToolCallResult:
        payload = {
            "error_code": error_code,
            "message": message,
            "suggestion": suggestion,
            "retryable": retryable,
            "details": details,
        }
        return ToolCallResult(
            structured_content=payload,
            content=[{"type": "text", "text": json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True)}],
            is_error=True,
        )

    def _copy_error_response(self, response: ApiResponse[Any], *, fallback_message: str) -> ApiResponse[dict[str, Any]]:
        return ApiResponse(
            status=response.status,
            error=response.error or fallback_message,
            error_code=response.error_code,
            suggestion=response.suggestion,
            retryable=response.retryable,
            details=response.details,
            message=response.message or fallback_message,
        )

    def _inject_quick_links(
        self,
        row: dict[str, Any],
        query: str,
        time_range: str,
        index_name: str,
    ) -> dict[str, Any]:
        links = self._generate_quick_links(row, query, time_range, index_name)
        enriched = dict(row)
        enriched["_links"] = links
        return enriched

    def _generate_quick_links(
        self,
        row: dict[str, Any],
        query: str,
        time_range: str,
        index_name: str,
    ) -> dict[str, str]:
        if not self._web_base_url:
            return {}

        unique_id_fields = {"context_id", "trace_id", "request_id", "spanid", "_id", "traceid"}
        feature_fields = {"appname", "hostname", "host", "client_ip", "ip", "level", "severity", "status", "uri", "url"}
        base_params = {
            "time_range": time_range,
            "searchMode": "intelligent",
        }
        if index_name:
            base_params["index_name"] = index_name

        links: dict[str, str] = {}
        for key, value in row.items():
            if value in (None, ""):
                continue
            key_lower = str(key).lower()
            query_value: str | None = None
            if key_lower in unique_id_fields:
                query_value = f"{key}:{value}"
            elif key_lower in feature_fields:
                prefix = "" if query == "*" else f"({query}) AND "
                query_value = f"{prefix}{key}:{value}"
            if not query_value:
                continue
            encoded = urlencode({**base_params, "query": query_value})
            links[str(key)] = f"{self._web_base_url}/search/?{encoded}"
        return links

    def _project_row(self, row: dict[str, Any], fields: list[str], *, include_links: bool) -> dict[str, Any]:
        projected: dict[str, Any] = {}
        for field in fields:
            if field == "_links":
                continue
            if field in row:
                projected[field] = row[field]
        if include_links and "_links" in row:
            projected["_links"] = row["_links"]
        return projected

    def _extract_available_fields(self, data: dict[str, Any]) -> list[str]:
        raw_fields = data.get("results", {}).get("fields")
        if isinstance(raw_fields, list):
            names = [
                item.get("name")
                for item in raw_fields
                if isinstance(item, dict) and isinstance(item.get("name"), str) and item.get("name")
            ]
            if names:
                return list(dict.fromkeys(names))

        rows = data.get("results", {}).get("sheets", {}).get("rows")
        if not isinstance(rows, list):
            return []

        flattened: list[str] = []
        for row in rows:
            if isinstance(row, dict):
                flattened.extend(str(key) for key in row.keys())
        return list(dict.fromkeys(flattened))

    def _flatten_expected_fields(
        self,
        expected_fields: list[str],
        field_mapping: dict[str, Any],
    ) -> list[str]:
        flattened = list(expected_fields)
        for value in field_mapping.values():
            if isinstance(value, str) and value.strip():
                flattened.append(value.strip())
            elif isinstance(value, list):
                flattened.extend(str(item).strip() for item in value if str(item).strip())
        return list(dict.fromkeys(flattened))

    def _build_field_suggestions(
        self,
        expected_fields: list[str],
        available_fields: list[str],
    ) -> dict[str, list[str]]:
        available = [
            {
                "original": field,
                "normalized": self._normalize_field_name(field),
            }
            for field in available_fields
        ]
        suggestions: dict[str, list[str]] = {}
        for expected in expected_fields:
            normalized_expected = self._normalize_field_name(expected)
            matched = []
            for candidate in available:
                candidate_lower = candidate["original"].lower()
                expected_lower = expected.lower()
                if (
                    candidate["normalized"] == normalized_expected
                    or candidate_lower.startswith(expected_lower)
                    or expected_lower.startswith(candidate_lower)
                    or candidate_lower in expected_lower
                    or expected_lower in candidate_lower
                ):
                    matched.append(candidate["original"])
            if matched:
                suggestions[expected] = list(dict.fromkeys(matched[:3]))
        return suggestions

    def _normalize_field_name(self, field_name: str) -> str:
        return "".join(ch for ch in field_name.lower() if ch.isalnum())

    def _extract_syntax_error_message(self, raw: dict[str, Any]) -> str | None:
        candidates = [
            raw.get("error"),
            raw.get("message"),
            raw.get("msg"),
            raw.get("detail"),
            raw.get("details", {}).get("message") if isinstance(raw.get("details"), dict) else None,
            raw.get("error_info", {}).get("message") if isinstance(raw.get("error_info"), dict) else None,
            raw.get("error_info", {}).get("msg") if isinstance(raw.get("error_info"), dict) else None,
        ]
        for item in candidates:
            if isinstance(item, str) and item.strip():
                return item.strip()
        return None

    def _extract_syntax_hints(self, raw: dict[str, Any]) -> list[str]:
        candidates = [
            raw.get("suggestion"),
            raw.get("suggestions"),
            raw.get("hint"),
            raw.get("hints"),
            raw.get("syntax_desc"),
            raw.get("desc"),
        ]
        hints: list[str] = []
        for item in candidates:
            if isinstance(item, str) and item.strip():
                hints.append(item.strip())
            elif isinstance(item, list):
                hints.extend(str(value).strip() for value in item if str(value).strip())
        return list(dict.fromkeys(hints))

    def _did_syntax_precheck_pass(self, raw: dict[str, Any], error_message: str | None) -> bool:
        if raw.get("result") is False:
            return False
        if raw.get("error") or raw.get("error_info"):
            return False
        if error_message:
            lowered = error_message.lower()
            if any(word in lowered for word in ("error", "错误", "failed", "失败")):
                return False
        return True

    def _infer_error_code(self, result: ApiResponse[Any]) -> str:
        message = f"{result.message or ''} {result.error or ''}".lower()
        if "time_range" in message:
            return "INVALID_TIME_RANGE"
        if "bucket" in message:
            return "INVALID_BUCKET"
        if "field" in message:
            return "INVALID_FIELD"
        return "TOOL_EXECUTION_ERROR"

    def _infer_suggestion(self, result: ApiResponse[Any]) -> str:
        message = f"{result.message or ''} {result.error or ''}".lower()
        if "time_range" in message:
            return "请检查 time_range，示例：now-15m,now。"
        if "bucket" in message:
            return "请检查 bucket，示例：1m、5m、1h。"
        if "field" in message:
            return "请先调用 list_fields 确认字段名，再重试。"
        return "请根据错误信息修正参数后重试；若数据量过大，建议先缩小时间范围。"

    def _normalize_string_list(self, value: Any) -> list[str]:
        if not isinstance(value, list):
            return []
        return [str(item).strip() for item in value if str(item).strip()]

    def _require_non_empty_str(self, arguments: dict[str, Any], key: str) -> bool:
        value = arguments.get(key)
        return isinstance(value, str) and bool(value.strip())

    def _coerce_str(self, value: Any, *, default: str) -> str:
        if isinstance(value, str) and value.strip():
            return value.strip()
        return default

    def _optional_str(self, value: Any) -> str | None:
        if isinstance(value, str) and value.strip():
            return value.strip()
        return None

    def _coerce_int(self, value: Any, *, default: int | None, minimum: int) -> int | None:
        if value is None:
            return default
        try:
            parsed = int(value)
        except (TypeError, ValueError):
            return default
        return max(parsed, minimum)

    def _coerce_float(self, value: Any, *, default: float) -> float:
        try:
            parsed = float(value)
        except (TypeError, ValueError):
            return default
        if parsed == float("inf") or parsed == float("-inf") or parsed != parsed:
            return default
        return parsed

    def _compute_has_more(self, total: int, page: int, size: int, returned: int) -> bool:
        if returned <= 0 or size <= 0:
            return False
        consumed = max(0, page) * max(0, size) + returned
        return total > consumed


def create_log_tools_server(runtime_config: RuntimeConfig, service_state: ServiceRuntimeState) -> LogToolsServer:
    return LogToolsServer(runtime_config, service_state)
