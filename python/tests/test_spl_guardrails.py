from __future__ import annotations

from unittest.mock import patch

from rizhiyi_mcp.config import RuntimeConfig
from rizhiyi_mcp.http_client import LogEaseHttpClient
from rizhiyi_mcp.shared_result_store import save_shared_result
from rizhiyi_mcp.spl_guardrails import (
    apply_output_guardrails,
    assess_generated_spl,
    assess_spl_query,
    assess_tool_arguments,
    extract_command_segments,
    guardrail_config_from_runtime,
    parse_time_range_to_hours,
)
from rizhiyi_mcp.types import SharedResultSummary
from tests.support import HttpGatewayTestCase


def _config(**overrides):
    runtime = RuntimeConfig(
        _env_file=None,
        mcp_guardrails_enabled=True,
        **overrides,
    )
    return guardrail_config_from_runtime(runtime)


def test_nested_delete_is_detected_and_blocked_in_enforce_mode() -> None:
    assessment = assess_tool_arguments(
        _config(mcp_guardrail_enforce_mode="enforce"),
        route_name="log-tools",
        tool_name="log_search_sheet",
        arguments={
            "query": "appname:web | append [[ search index=prod | delete ]]",
            "time_range": "now-1h,now",
        },
    )

    assert assessment.action == "blocked"
    assert assessment.denied_commands == ["delete"]
    assert "delete" in assessment.commands


def test_command_matching_does_not_confuse_inputlookup_with_outputlookup() -> None:
    commands = [
        command
        for command, _segment in extract_command_segments(
            "| inputlookup safe.csv | stats count() as cnt"
        )
    ]

    assert "inputlookup" in commands
    assert "outputlookup" not in commands


def test_search_term_named_delete_is_not_treated_as_delete_command() -> None:
    commands = [
        command
        for command, _segment in extract_command_segments(
            'delete error_message:"failed" | stats count() as cnt'
        )
    ]

    assert "delete" not in commands


def test_audit_mode_scores_expensive_patterns_without_blocking() -> None:
    assessment = assess_tool_arguments(
        _config(mcp_guardrail_enforce_mode="audit"),
        route_name="log-tools",
        tool_name="log_search_sheet",
        arguments={
            "query": "index=prod | transaction request_id | join host [[ search index=prod ]]",
            "time_range": "now-2d,now",
        },
    )

    assert assessment.action == "audit"
    assert assessment.risk_score >= 50
    assert not assessment.should_block


def test_dashboard_panel_queries_are_extracted_recursively() -> None:
    assessment = assess_tool_arguments(
        _config(mcp_guardrail_enforce_mode="enforce"),
        route_name="dashboard",
        tool_name="create_dashboard_from_spec",
        arguments={
            "tabs": [
                {
                    "panels": [
                        {
                            "query": "index=prod | outputlookup override=true export.csv",
                            "time_range": "-1h,now",
                        }
                    ]
                }
            ]
        },
    )

    assert assessment.should_block
    assert assessment.denied_commands == ["outputlookup"]


def test_output_is_sanitized_and_limited() -> None:
    guarded, sanitized, truncated, paths = apply_output_guardrails(
        {
            "hits": [
                {"card": "4111 1111 1111 1111", "ssn": "123-45-6789"},
                {"card": "5555-5555-5555-4444", "timestamp": "1690000000000"},
            ]
        },
        _config(mcp_guardrail_max_events=1),
    )

    assert sanitized == 2
    assert truncated == 1
    assert paths == ["result.hits"]
    assert guarded["hits"] == [
        {"card": "****-****-****-1111", "ssn": "***-**-****"}
    ]


def test_credit_card_mask_does_not_mask_common_epoch_timestamp() -> None:
    guarded, sanitized, _, _ = apply_output_guardrails(
        {"timestamp": "1690000000000"},
        _config(),
    )

    assert sanitized == 0
    assert guarded["timestamp"] == "1690000000000"


def test_logease_minute_timerange_unit_is_supported() -> None:
    assert parse_time_range_to_hours("-5min") == 5 / 60


def test_shared_result_sanitizes_source_query_before_persisting(tmp_path) -> None:
    runtime = RuntimeConfig(
        _env_file=None,
        mcp_guardrails_enabled=True,
        log_tools_result_store_dir=tmp_path,
    )
    envelope = save_shared_result(
        runtime,
        route_name="log-tools",
        tool_name="log_search_sheet",
        result_kind="rows",
        payload={"hits": []},
        summary=SharedResultSummary(title="test", text="test"),
        source_query='card:"4111 1111 1111 1111"',
    )

    assert envelope.source_query == 'card:"****-****-****-1111"'


def test_rule_overrides_can_disable_a_score() -> None:
    config = _config(mcp_guardrail_risk_rule_overrides={"append": 0})
    result = assess_spl_query(
        "index=prod | append [ search index=prod | head 10 ]",
        path="test.query",
        time_range="now-1h,now",
        config=config,
    )

    assert all(finding.rule != "append" for finding in result.findings)


def test_default_reject_threshold_100_keeps_score_only_findings_in_audit_action() -> None:
    assessment = assess_tool_arguments(
        _config(mcp_guardrail_enforce_mode="enforce"),
        route_name="log-tools",
        tool_name="log_search_sheet",
        arguments={
            "query": "* | transaction request_id | join host [ search * ]",
            "time_range": "all",
        },
    )

    assert assessment.risk_score == 100
    assert assessment.action == "audit"
    assert not assessment.should_block


def test_generated_chatspl_is_checked_before_it_is_returned() -> None:
    assessment = assess_generated_spl(
        _config(mcp_guardrail_enforce_mode="enforce"),
        route_name="chatspl",
        tool_name="chat_spl",
        payload={"spl": "index=prod | outputlookup export.csv"},
    )

    assert assessment.should_block
    assert assessment.denied_commands == ["outputlookup"]


class GuardrailGatewayTestCase(HttpGatewayTestCase):
    def build_runtime_config(self, **overrides):
        return super().build_runtime_config(
            mcp_guardrails_enabled=True,
            mcp_guardrail_enforce_mode="enforce",
            **overrides,
        )

    def test_blocked_query_never_reaches_upstream(self) -> None:
        session_id = self._initialize_session("log-tools")
        with patch.object(LogEaseHttpClient, "_request") as upstream_request:
            result = self._call_tool(
                "log-tools",
                session_id,
                "log_search_sheet",
                {
                    "query": "index=prod | delete",
                    "time_range": "now-1h,now",
                    "result_delivery": "inline",
                },
            )

        assert result["isError"] is True
        assert result["structuredContent"]["error_code"] == "SPL_GUARDRAIL_BLOCKED"
        assert result["structuredContent"]["guardrail"]["denied_commands"] == ["delete"]
        upstream_request.assert_not_called()
