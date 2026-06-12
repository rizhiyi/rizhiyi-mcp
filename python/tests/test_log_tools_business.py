from __future__ import annotations

import asyncio
import time
from unittest.mock import patch

from rizhiyi_mcp.log_tools_business import LogToolsBusinessService
from rizhiyi_mcp.shared_result_store import SharedResultStoreError, read_shared_result
from rizhiyi_mcp.types import SharedResultSummary

from tests.support import (
    LogToolsHttpTestCase,
    api_response,
    clone_fixture_data,
    load_api_response_fixture,
    load_json_fixture,
    search_rows_from_fixture,
    search_sheets_response,
    search_sheets_response_from_fixture,
    time_series_rows_from_fixture,
)


class LogToolsBusinessGatewayTestCase(LogToolsHttpTestCase):
    def setUp(self) -> None:
        super().setUp()
        self.runtime_config.log_tools_result_ttl_seconds = 300
        self.runtime_config.log_tools_result_inline_max_bytes = 1024

    def test_tools_list_includes_missing_business_tools(self) -> None:
        session_id = self._initialize_session()
        tool_names = {tool["name"] for tool in self._tools_list(session_id)}
        self.assertTrue(
            {
                "log_reduce_pattern",
                "log_reduce_preview",
                "trend_summary",
                "anomaly_points",
                "period_compare",
                "correlation_analysis",
                "root_cause_suggestions",
                "trend_forecast",
                "anomaly_alert",
            }
            <= tool_names
        )

    def test_log_reduce_pattern_submit_returns_sid(self) -> None:
        session_id = self._initialize_session()

        async def fake_get(_self, path, *, params=None, headers=None):
            if path == "/api/v3/search/logreduce/":
                self.assertEqual(params["query"], "status:error")
                return api_response(status=200, data={"sid": "sid-1", "accepted": True})
            raise AssertionError(f"unexpected path: {path}")

        with patch("rizhiyi_mcp.log_tools_server.LogEaseHttpClient.get", new=fake_get):
            submit_payload = self._call_tool(
                session_id,
                "log_reduce_pattern",
                {"query": "status:error", "time_range": "now-15m,now"},
                request_id=10,
            )

        self.assertEqual(submit_payload["delivery"], "inline")
        self.assertEqual(submit_payload["data"]["sid"], "sid-1")

    def test_log_reduce_preview_parses_real_fixture(self) -> None:
        preview_payload = clone_fixture_data(load_json_fixture("real-logreduce-pattern-preview-response.json")["data"])

        async def fake_request_json(path, *, params=None):
            self.assertEqual(path, "/api/v3/search/preview/logreduce/")
            self.assertEqual(params, {"sid": "sid-1"})
            return api_response(data=preview_payload)

        service = LogToolsBusinessService(fake_request_json)
        response = asyncio.run(service.execute_log_reduce_preview(sid="sid-1", max_retries=1, retry_interval_ms=0))

        self.assertIsNone(response.error)
        self.assertIsNotNone(response.data)
        data = response.data or {}
        self.assertEqual(data["job_status"], "COMPLETED")
        self.assertTrue(data["sid"])
        self.assertGreater(data["total_hits"], 0)
        self.assertGreater(len(data["result"]), 5)

        analysis = service.analyze_pattern_results(data["result"], total_hits=data["total_hits"], limit=5)
        self.assertGreater(analysis["total_patterns"], 5)
        self.assertTrue(analysis["patterns"][0]["pattern"])
        self.assertIn(
            analysis["patterns"][0]["classification"],
            {"normal", "anomalous", "bursty", "periodic"},
        )

    def test_trend_summary_real_fixture_resource_can_be_reused_by_anomaly_points(self) -> None:
        session_id = self._initialize_session()
        calls: list[dict] = []

        async def fake_get(_self, path, *, params=None, headers=None):
            calls.append({"path": path, "params": params})
            self.assertEqual(path, "/api/v3/search/sheets/")
            return load_api_response_fixture("real-timechart-response.json")

        with patch("rizhiyi_mcp.log_tools_server.LogEaseHttpClient.get", new=fake_get):
            trend_payload = self._call_tool(
                session_id,
                "trend_summary",
                {"query": "*", "time_range": "now-15m,now", "result_delivery": "resource"},
                request_id=20,
            )
            anomaly_payload = self._call_tool(
                session_id,
                "anomaly_points",
                {
                    "resource_uri": trend_payload["resource_uri"],
                    "method": "zscore",
                    "sensitivity": 2,
                    "result_delivery": "inline",
                },
                request_id=21,
            )

        self.assertEqual(trend_payload["delivery"], "resource")
        self.assertEqual(anomaly_payload["delivery"], "inline")
        self.assertEqual(len(anomaly_payload["data"]["series"]), 13)
        self.assertEqual(
            [item["timestamp"] for item in anomaly_payload["data"]["anomalies"]],
            ["1758100500000"],
        )
        self.assertEqual(len(calls), 1)

    def test_period_compare_supports_resource_inputs_built_from_real_fixture(self) -> None:
        session_id = self._initialize_session()
        period_a = time_series_rows_from_fixture("real-timechart-response.json")
        period_b = clone_fixture_data(period_a)
        for row in period_b:
            row["cnt"] = int(row["cnt"] * 1.1)

        resource_uri_a = self.save_shared_result_fixture(
            route_name="log-tools",
            tool_name="trend_summary",
            result_kind="timeseries",
            payload={"series": period_a},
            summary=SharedResultSummary(title="period a", text="fixture period a"),
        ).resource_uri
        resource_uri_b = self.save_shared_result_fixture(
            route_name="log-tools",
            tool_name="trend_summary",
            result_kind="timeseries",
            payload={"series": period_b},
            summary=SharedResultSummary(title="period b", text="fixture period b"),
        ).resource_uri

        payload = self._call_tool(
            session_id,
            "period_compare",
            {
                "resource_uri_a": resource_uri_a,
                "resource_uri_b": resource_uri_b,
                "topk": 3,
                "result_delivery": "inline",
            },
            request_id=30,
        )

        self.assertEqual(payload["delivery"], "inline")
        self.assertEqual(payload["data"]["period_a"]["total"], sum(row["cnt"] for row in period_a))
        self.assertEqual(payload["data"]["period_b"]["total"], sum(row["cnt"] for row in period_b))
        self.assertGreater(payload["data"]["differences"]["total_change"], 0)
        self.assertEqual(len(payload["data"]["period_a"]["series"]), len(period_a))

    def test_log_search_sheet_real_fixture_resource_can_feed_correlation_analysis(self) -> None:
        session_id = self._initialize_session()
        calls: list[dict] = []

        async def fake_get(_self, path, *, params=None, headers=None):
            calls.append({"path": path, "params": params})
            self.assertEqual(path, "/api/v3/search/sheets/")
            return search_sheets_response_from_fixture("real-search-sheet-response.json")

        with patch("rizhiyi_mcp.log_tools_server.LogEaseHttpClient.get", new=fake_get):
            search_payload = self._call_tool(
                session_id,
                "log_search_sheet",
                {"query": "*", "time_range": "now-15m,now", "size": 30},
                request_id=40,
            )
            correlation_payload = self._call_tool(
                session_id,
                "correlation_analysis",
                {
                    "resource_uri": search_payload["resource_uri"],
                    "time_range": "now-15m,now",
                    "fields": ["appname", "logtype"],
                    "mode": "auto",
                    "result_delivery": "inline",
                },
                request_id=41,
            )

        self.assertEqual(search_payload["delivery"], "resource")
        self.assertEqual(
            search_payload["summary"]["key_metrics"]["returned"],
            len(search_rows_from_fixture("real-search-sheet-response.json")),
        )
        self.assertEqual(correlation_payload["delivery"], "inline")
        self.assertEqual(correlation_payload["data"]["mode"], "fp_growth")
        self.assertEqual(
            correlation_payload["data"]["results"][0]["items"],
            ["appname=demoTraceData", "logtype=trace"],
        )
        self.assertEqual(
            correlation_payload["data"]["evidence"]["field_types"],
            [
                {
                    "field": "appname",
                    "detected_type": "categorical",
                    "sample_count": 20,
                    "numeric_count": 0,
                    "categorical_count": 20,
                },
                {
                    "field": "logtype",
                    "detected_type": "categorical",
                    "sample_count": 20,
                    "numeric_count": 0,
                    "categorical_count": 20,
                },
            ],
        )
        self.assertEqual(len(calls), 1)

    def test_shared_timeseries_fixture_expires_after_save(self) -> None:
        resource_uri = self.save_shared_result_fixture(
            route_name="log-tools",
            tool_name="trend_summary",
            result_kind="timeseries",
            payload={"series": time_series_rows_from_fixture("real-timechart-response.json")},
            summary=SharedResultSummary(title="timeseries", text="short lived fixture"),
            ttl_seconds=1,
        ).resource_uri

        active_resource = read_shared_result(self.runtime_config, resource_uri)
        self.assertEqual(active_resource.result_kind, "timeseries")

        time.sleep(1.2)

        with self.assertRaises(SharedResultStoreError) as context:
            read_shared_result(self.runtime_config, resource_uri)
        self.assertEqual(context.exception.code, "HANDLE_EXPIRED")

    def test_root_cause_suggestions_can_reuse_anomaly_rows(self) -> None:
        session_id = self._initialize_session()

        async def fake_get(_self, path, *, params=None, headers=None):
            self.assertEqual(path, "/api/v3/search/sheets/")
            query = params["query"]
            time_range = params["time_range"]

            if params.get("size") == 30 and query == "*" and time_range == "now-30m,now":
                rows = [
                    {"status": "error"},
                    {"status": "error"},
                    {"status": "error"},
                    {"status": "error"},
                    {"status": "info"},
                    {"status": "info"},
                ]
                return search_sheets_response(rows, total_hits=6)

            if query == "*" and time_range == "now-90m,now-60m":
                rows = [{"status": "error"}, {"status": "info"}, {"status": "info"}]
                return search_sheets_response(rows, total_hits=3)

            if query == "* | stats count by status" and time_range == "now-90m,now-60m":
                rows = [{"status": "error", "count": 1}, {"status": "info", "count": 2}]
                return search_sheets_response(rows)

            if query == "* | stats count by status" and time_range == "now-30m,now":
                rows = [{"status": "error", "count": 4}, {"status": "info", "count": 2}]
                return search_sheets_response(rows)

            if query == "* | stats count() as count" and time_range == "now-30m,now":
                return search_sheets_response([{"count": 6}])

            if query == "* | stats count() as count" and time_range == "now-90m,now-60m":
                return search_sheets_response([{"count": 3}])

            if query == 'status:"error" | stats count() as count' and time_range == "now-30m,now":
                return search_sheets_response([{"count": 4}])

            if query == 'status:"error" | stats count() as count' and time_range == "now-90m,now-60m":
                return search_sheets_response([{"count": 1}])

            raise AssertionError(f"unexpected request: {params}")

        with patch("rizhiyi_mcp.log_tools_server.LogEaseHttpClient.get", new=fake_get):
            search_payload = self._call_tool(
                session_id,
                "log_search_sheet",
                {"query": "*", "time_range": "now-30m,now", "size": 30},
                request_id=50,
            )
            root_payload = self._call_tool(
                session_id,
                "root_cause_suggestions",
                {
                    "resource_uri": search_payload["resource_uri"],
                    "query": "*",
                    "anomaly_window": "now-30m,now",
                    "baseline_window": "now-90m,now-60m",
                    "candidate_fields": ["status"],
                    "sample_size": 3,
                    "topk": 3,
                    "significance_threshold": 0.01,
                    "slice_max_depth": 1,
                    "min_slice_lift": 1.5,
                    "result_delivery": "inline",
                },
                request_id=51,
            )

        self.assertEqual(root_payload["delivery"], "inline")
        self.assertEqual(root_payload["data"]["distribution_drift"][0]["field"], "status")
        self.assertEqual(root_payload["data"]["suspicious_slices"][0]["slice"]["status"], "error")

    def test_trend_forecast_resource_can_be_reused_by_anomaly_alert(self) -> None:
        session_id = self._initialize_session()
        calls: list[dict] = []

        async def fake_get(_self, path, *, params=None, headers=None):
            calls.append({"path": path, "params": params})
            self.assertEqual(path, "/api/v3/search/sheets/")
            return search_sheets_response(
                [
                    {"_time": "2026-06-10T10:00:00Z", "cnt": 5},
                    {"_time": "2026-06-10T10:05:00Z", "cnt": 6},
                    {"_time": "2026-06-10T10:10:00Z", "cnt": 20},
                    {"_time": "2026-06-10T10:15:00Z", "cnt": 7},
                ],
            )

        with patch("rizhiyi_mcp.log_tools_server.LogEaseHttpClient.get", new=fake_get):
            forecast_payload = self._call_tool(
                session_id,
                "trend_forecast",
                {"query": "*", "time_range": "now-24h,now", "result_delivery": "resource"},
                request_id=60,
            )
            alert_payload = self._call_tool(
                session_id,
                "anomaly_alert",
                {
                    "resource_uri": forecast_payload["resource_uri"],
                    "method": "statistical",
                    "threshold": 1.0,
                    "min_anomaly_points": 1,
                },
                request_id=61,
            )

        self.assertEqual(forecast_payload["delivery"], "resource")
        self.assertEqual(alert_payload["delivery"], "inline")
        self.assertTrue(alert_payload["data"]["alert_triggered"])
        self.assertGreaterEqual(alert_payload["data"]["anomaly_count"], 1)
        self.assertEqual(len(calls), 1)

    def test_log_reduce_preview_can_resolve_sid_from_resource_uri(self) -> None:
        session_id = self._initialize_session()
        resource_uri = self.save_shared_result_fixture(
            route_name="log-tools",
            tool_name="log_reduce_pattern",
            result_kind="patterns",
            payload={"sid": "sid-from-resource"},
            summary=SharedResultSummary(title="pattern fixture", text="saved pattern result"),
            upstream_sid="sid-from-resource",
        ).resource_uri

        async def fake_get(_self, path, *, params=None, headers=None):
            self.assertEqual(path, "/api/v3/search/preview/logreduce/")
            self.assertEqual(params["sid"], "sid-from-resource")
            return api_response(
                status=200,
                data={
                    "sid": "sid-from-resource",
                    "job_status": "COMPLETED",
                    "result": {
                        "total_hits": 3,
                        "body": [
                            {
                                "id": "pattern-1",
                                "pattern_string": "error timeout",
                                "count": 3,
                                "timeline": {"rows": [{"count": 1}, {"count": 2}]},
                            }
                        ],
                    },
                },
            )

        with patch("rizhiyi_mcp.log_tools_server.LogEaseHttpClient.get", new=fake_get):
            preview_payload = self._call_tool(
                session_id,
                "log_reduce_preview",
                {"resource_uri": resource_uri, "analyze_patterns": True},
                request_id=70,
            )

        self.assertEqual(preview_payload["delivery"], "inline")
        self.assertEqual(preview_payload["data"]["sid"], "sid-from-resource")
        self.assertEqual(preview_payload["data"]["pattern_analysis"]["total_patterns"], 1)


if __name__ == "__main__":
    unittest.main()
