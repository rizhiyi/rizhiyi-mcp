from __future__ import annotations

from unittest.mock import patch

from rizhiyi_mcp.http_client import LogEaseHttpClient

from tests.support import (
    BaseMcpHttpTestCase,
    FakeDashboardUpstream,
    dashboard_fixture,
    dashboard_spec_fixture,
)


class DashboardServerTestCase(BaseMcpHttpTestCase):

    def test_dashboard_tools_list_contains_business_tools(self) -> None:
        session_id = self._initialize_session("dashboard")
        tool_names = {tool["name"] for tool in self._tools_list("dashboard", session_id)}
        self.assertTrue(
            {
                "list_dashboards",
                "list_dashboard_tabs",
                "get_dashboard_tab_content",
                "clone_dashboard_tab",
                "evaluate_dashboard_aesthetics",
                "list_dashboard_panels",
                "create_dashboard_from_template",
                "create_dashboard_from_spec",
                "update_dashboard_layout",
                "add_dashboard_panel",
                "update_dashboard_panel",
                "remove_dashboard_panel",
            }
            <= tool_names
        )

    def test_dashboard_business_tools_end_to_end(self) -> None:
        session_id = self._initialize_session("dashboard")
        upstream = FakeDashboardUpstream()

        with patch.object(LogEaseHttpClient, "_request", new=upstream.request):
            create_result = self._call_tool(
                "dashboard",
                session_id,
                "create_dashboard_from_spec",
                dashboard_spec_fixture(name="服务面板"),
                request_id=10,
            )
            self.assertFalse(create_result["isError"])
            created = create_result["structuredContent"]["data"]
            dashboard_id = created["dashboard_id"]

            list_dashboards_result = self._call_tool("dashboard", session_id, "list_dashboards", {"name": "服务"}, request_id=11)
            self.assertFalse(list_dashboards_result["isError"])
            self.assertEqual(list_dashboards_result["structuredContent"]["data"]["count"], 1)

            list_tabs_result = self._call_tool("dashboard", session_id, "list_dashboard_tabs", {"dashboard_id": dashboard_id}, request_id=12)
            tabs = list_tabs_result["structuredContent"]["data"]["tabs"]
            self.assertEqual(len(tabs), 1)
            self.assertEqual(tabs[0]["panel_count"], 3)

            tab_content_result = self._call_tool(
                "dashboard",
                session_id,
                "get_dashboard_tab_content",
                {"dashboard_id": dashboard_id, "tab_name": "总览"},
                request_id=13,
            )
            self.assertEqual(len(tab_content_result["structuredContent"]["data"]["content"]["widgets"]), 3)

            list_panels_result = self._call_tool(
                "dashboard",
                session_id,
                "list_dashboard_panels",
                {"dashboard_id": dashboard_id, "tab_name": "总览"},
                request_id=14,
            )
            panels = list_panels_result["structuredContent"]["data"]["panels"]
            self.assertEqual(len(panels), 3)
            first_panel_id = panels[0]["panel_id"]

            add_panel_result = self._call_tool(
                "dashboard",
                session_id,
                "add_dashboard_panel",
                {
                    "dashboard_id": dashboard_id,
                    "tab_name": "总览",
                    "panel": {
                        "title": "错误占比",
                        "type": "trend",
                        "query": "appname:gateway AND status:error | stats count() by status",
                        "time_range": "-1h,now",
                        "chartType": "pie",
                        "xField": "status",
                        "yField": "count",
                        "color": "#59D8A6",
                    },
                },
                request_id=15,
            )
            self.assertFalse(add_panel_result["isError"])
            self.assertEqual(add_panel_result["structuredContent"]["data"]["total_panels"], 4)

            update_panel_result = self._call_tool(
                "dashboard",
                session_id,
                "update_dashboard_panel",
                {
                    "dashboard_id": dashboard_id,
                    "tab_name": "总览",
                    "panel_id": first_panel_id,
                    "changes": {"title": "请求趋势-分钟", "color": "#7162FD"},
                },
                request_id=16,
            )
            self.assertFalse(update_panel_result["isError"])
            self.assertEqual(update_panel_result["structuredContent"]["data"]["panel_title_after"], "请求趋势-分钟")

            layout_result = self._call_tool(
                "dashboard",
                session_id,
                "update_dashboard_layout",
                {"dashboard_id": dashboard_id, "tab_name": "总览", "layout_strategy": "compact"},
                request_id=17,
            )
            self.assertFalse(layout_result["isError"])
            self.assertEqual(layout_result["structuredContent"]["data"]["panels_updated"], 4)

            remove_panel_result = self._call_tool(
                "dashboard",
                session_id,
                "remove_dashboard_panel",
                {"dashboard_id": dashboard_id, "tab_name": "总览", "panel_title": "错误占比"},
                request_id=18,
            )
            self.assertFalse(remove_panel_result["isError"])
            self.assertEqual(remove_panel_result["structuredContent"]["data"]["remaining_panels"], 3)

            clone_tab_result = self._call_tool(
                "dashboard",
                session_id,
                "clone_dashboard_tab",
                {"dashboard_id": dashboard_id, "source_tab_name": "总览", "new_tab_name": "总览-副本"},
                request_id=19,
            )
            self.assertFalse(clone_tab_result["isError"])
            self.assertEqual(clone_tab_result["structuredContent"]["data"]["panel_count"], 3)

            aesthetics_result = self._call_tool(
                "dashboard",
                session_id,
                "evaluate_dashboard_aesthetics",
                {"dashboard_id": dashboard_id, "tab_name": "总览"},
                request_id=20,
            )
            self.assertFalse(aesthetics_result["isError"])
            aesthetics_data = aesthetics_result["structuredContent"]["data"]
            self.assertIn("overall_score", aesthetics_data)
            self.assertIn("scores", aesthetics_data)
            self.assertIn("color_analysis", aesthetics_data)

    def test_dashboard_seed_fixture_covers_list_content_panel_and_resource_paths(self) -> None:
        session_id = self._initialize_session("dashboard")
        upstream = FakeDashboardUpstream()
        dashboard_id = upstream.seed_dashboard(dashboard_fixture(name="服务健康仪表盘"))

        with patch.object(LogEaseHttpClient, "_request", new=upstream.request):
            list_dashboards_result = self._call_tool(
                "dashboard",
                session_id,
                "list_dashboards",
                {"name": "服务健康", "result_delivery": "resource"},
                request_id=50,
            )
            self.assertFalse(list_dashboards_result["isError"])
            resource_uri = list_dashboards_result["structuredContent"]["resource_uri"]

            resource_read_response = self.client.post(
                "/mcp/dashboard",
                headers=self._json_headers(session_id=session_id),
                json={
                    "jsonrpc": "2.0",
                    "id": 51,
                    "method": "resources/read",
                    "params": {"uri": resource_uri},
                },
            )
            self.assertEqual(resource_read_response.status_code, 200)
            self.assertIn("服务健康仪表盘", resource_read_response.json()["result"]["contents"][0]["text"])

            tab_content_result = self._call_tool(
                "dashboard",
                session_id,
                "get_dashboard_tab_content",
                {"dashboard_id": dashboard_id, "tab_name": "总览"},
                request_id=52,
            )
            self.assertFalse(tab_content_result["isError"])
            content = tab_content_result["structuredContent"]["data"]["content"]
            self.assertEqual(content["scheme"], "schemecat3")
            self.assertEqual(len(content["widgets"]), 3)

            panels_result = self._call_tool(
                "dashboard",
                session_id,
                "list_dashboard_panels",
                {"dashboard_id": dashboard_id, "tab_name": "总览"},
                request_id=53,
            )
            self.assertFalse(panels_result["isError"])
            self.assertEqual(
                [panel["title"] for panel in panels_result["structuredContent"]["data"]["panels"]],
                ["请求趋势", "状态分布", "异常告警"],
            )

            layout_result = self._call_tool(
                "dashboard",
                session_id,
                "update_dashboard_layout",
                {
                    "dashboard_id": dashboard_id,
                    "tab_name": "总览",
                    "panel_positions": [{"panel_title": "请求趋势", "x": 1, "y": 20, "w": 8, "h": 6}],
                },
                request_id=54,
            )
            self.assertFalse(layout_result["isError"])
            self.assertEqual(layout_result["structuredContent"]["data"]["layout_strategy"], "manual_positions")

            refreshed_tab_result = self._call_tool(
                "dashboard",
                session_id,
                "get_dashboard_tab_content",
                {"dashboard_id": dashboard_id, "tab_name": "总览"},
                request_id=55,
            )

        refreshed_widgets = refreshed_tab_result["structuredContent"]["data"]["content"]["widgets"]
        self.assertEqual(refreshed_widgets[0]["x"], 1)
        self.assertEqual(refreshed_widgets[0]["y"], 20)
        self.assertEqual(refreshed_widgets[0]["w"], 8)
        self.assertEqual(refreshed_widgets[0]["h"], 6)

    def test_dashboard_template_and_scheme_validation(self) -> None:
        session_id = self._initialize_session("dashboard")
        upstream = FakeDashboardUpstream()

        with patch.object(LogEaseHttpClient, "_request", new=upstream.request):
            create_template_result = self._call_tool(
                "dashboard",
                session_id,
                "create_dashboard_from_template",
                {
                    "template": "service_overview",
                    "name": "模板仪表盘",
                    "context": {"appname": "nginx", "time_range": "-15m,now", "host_field": "hostname"},
                },
                request_id=30,
            )
            self.assertFalse(create_template_result["isError"])
            dashboard_id = create_template_result["structuredContent"]["data"]["dashboard_id"]

            invalid_color_result = self._call_tool(
                "dashboard",
                session_id,
                "add_dashboard_panel",
                {
                    "dashboard_id": dashboard_id,
                    "tab_name": "总览",
                    "panel": {
                        "title": "非法颜色图",
                        "type": "trend",
                        "query": "appname:nginx",
                        "time_range": "-15m,now",
                        "chartType": "line",
                        "color": "#000000",
                    },
                },
                request_id=31,
            )
            self.assertTrue(invalid_color_result["isError"])
            self.assertEqual(invalid_color_result["structuredContent"]["error_code"], "INVALID_PANEL_COLOR")

    def test_dashboard_template_falls_back_when_app_id_not_found(self) -> None:
        session_id = self._initialize_session("dashboard")
        upstream = FakeDashboardUpstream(reject_first_app_id_create=True)

        with patch.object(LogEaseHttpClient, "_request", new=upstream.request):
            create_result = self._call_tool(
                "dashboard",
                session_id,
                "create_dashboard_from_template",
                {
                    "template": "service_overview",
                    "name": "模板回退仪表盘",
                    "app_id": 999,
                    "context": {"appname": "nginx", "time_range": "-15m,now", "host_field": "hostname"},
                },
                request_id=40,
            )
            self.assertFalse(create_result["isError"])
            created = create_result["structuredContent"]["data"]

            list_tabs_result = self._call_tool(
                "dashboard",
                session_id,
                "list_dashboard_tabs",
                {"dashboard_id": created["dashboard_id"]},
                request_id=41,
            )

        self.assertEqual(
            upstream.dashboard_create_payloads,
            [
                {
                    "name": "模板回退仪表盘",
                    "data_user": "viewer",
                    "export": "local",
                    "active_tab": 0,
                    "default_display": 0,
                    "app_id": 999,
                },
                {
                    "name": "模板回退仪表盘",
                    "data_user": "viewer",
                    "export": "local",
                    "active_tab": 0,
                    "default_display": 0,
                },
            ],
        )
        self.assertFalse(list_tabs_result["isError"])
        self.assertEqual(list_tabs_result["structuredContent"]["data"]["app_id"], None)
        self.assertEqual(list_tabs_result["structuredContent"]["data"]["tab_count"], 1)


if __name__ == "__main__":
    unittest.main()
