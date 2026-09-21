from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
import json
import math
import re
from typing import Any, Literal

from .config import RuntimeConfig

GuardrailAction = Literal["allow", "audit", "blocked"]

_SPL_ROUTES = {"log-tools", "dashboard", "alert", "chatspl", "manage", "openapi"}
_NON_EXECUTING_QUERY_TOOLS = {("alert", "list_alerts")}
_QUERY_KEYS = {"query", "spl", "spl_query", "splQuery", "extend_query", "extendQuery"}
_TIME_KEYS = ("time_range", "timeRange", "timerange")
_KNOWN_COMMANDS = {
    "append",
    "appendcols",
    "collect",
    "dbxexec",
    "dbxlookup",
    "dbxoutput",
    "dbxquery",
    "delete",
    "download",
    "fit",
    "foreach",
    "fromes",
    "fromkafkapy",
    "history",
    "inputlookup",
    "join",
    "ldapfetch",
    "ldapfilter",
    "ldapgroup",
    "ldapsearch",
    "loadjob",
    "lookup2",
    "map",
    "mcollect",
    "multireport",
    "multisearch",
    "outputlookup",
    "partition",
    "rest",
    "save",
    "search",
    "transaction",
    "union",
}
_SOURCE_GENERATING_COMMANDS = {
    "dbxlookup",
    "dbxquery",
    "fromes",
    "fromkafkapy",
    "history",
    "inputlookup",
    "ldapfetch",
    "ldapfilter",
    "ldapgroup",
    "ldapsearch",
    "loadjob",
    "rest",
    "search",
    "union",
    "multisearch",
    "multireport",
}
_EXPENSIVE_COMMANDS = {"transaction", "map", "join"}
_NESTED_COMMANDS = {"union", "multisearch", "multireport", "partition", "foreach"}

_CREDIT_CARD_RE = re.compile(r"(?<!\d)(?:\d[ -]?){12,18}\d(?!\d)")
_SSN_RE = re.compile(r"(?<!\d)\d{3}-\d{2}-\d{4}(?!\d)")
_FIELD_CONSTRAINT_RE = re.compile(
    r"(?<![\w.])(?:['\"]?[a-zA-Z_][\w.]*['\"]?)\s*(?::|=)\s*(?!\*)[^\s|,)]+"
)
_INDEX_RE = re.compile(r"(?<![\w.])index\s*(?::|=)\s*(['\"]?)([^\s|,)]+)\1", re.I)
_EARLIEST_RE = re.compile(r"\bearliest(?:_time)?\s*=\s*([^\s|]+)", re.I)
_LATEST_RE = re.compile(r"\blatest(?:_time)?\s*=\s*([^\s|]+)", re.I)


@dataclass(frozen=True, slots=True)
class GuardrailConfig:
    enabled: bool
    mode: Literal["audit", "enforce"]
    deny_commands: frozenset[str]
    alert_threshold: int
    reject_threshold: int
    rule_overrides: dict[str, int]
    safe_timerange: str
    exec_timeout_seconds: int
    max_events: int
    sanitize_enabled: bool
    sanitize_masks: frozenset[str]
    sanitize_custom_patterns: tuple[tuple[re.Pattern[str], str], ...]


@dataclass(frozen=True, slots=True)
class SplCandidate:
    path: str
    query: str
    time_range: str | None = None


@dataclass(frozen=True, slots=True)
class RiskFinding:
    rule: str
    score: int
    message: str

    def to_details(self) -> dict[str, Any]:
        return {"rule": self.rule, "score": self.score, "message": self.message}


@dataclass(frozen=True, slots=True)
class QueryRiskAssessment:
    path: str
    risk_score: int
    commands: tuple[str, ...]
    denied_commands: tuple[str, ...]
    findings: tuple[RiskFinding, ...]
    time_range: str | None

    def to_details(self) -> dict[str, Any]:
        return {
            "path": self.path,
            "risk_score": self.risk_score,
            "commands": list(self.commands),
            "denied_commands": list(self.denied_commands),
            "time_range": self.time_range,
            "findings": [item.to_details() for item in self.findings],
        }


@dataclass(slots=True)
class GuardrailAssessment:
    enabled: bool
    mode: Literal["audit", "enforce"]
    action: GuardrailAction = "allow"
    risk_score: int = 0
    commands: list[str] = field(default_factory=list)
    denied_commands: list[str] = field(default_factory=list)
    findings: list[RiskFinding] = field(default_factory=list)
    queries: list[QueryRiskAssessment] = field(default_factory=list)
    alert_threshold: int = 50
    reject_threshold: int = 100
    message: str = "未发现 SPL 风险。"
    sanitized_values: int = 0
    truncated_events: int = 0
    truncated_paths: list[str] = field(default_factory=list)

    @property
    def should_block(self) -> bool:
        return self.action == "blocked"

    @property
    def has_warning(self) -> bool:
        return bool(
            self.denied_commands
            or self.risk_score >= self.alert_threshold
            or self.findings
            or self.sanitized_values
            or self.truncated_events
        )

    def to_details(self) -> dict[str, Any]:
        return {
            "enabled": self.enabled,
            "mode": self.mode,
            "action": self.action,
            "risk_score": self.risk_score,
            "alert_threshold": self.alert_threshold,
            "reject_threshold": self.reject_threshold,
            "requires_review": self.risk_score >= self.alert_threshold,
            "commands": self.commands,
            "denied_commands": self.denied_commands,
            "findings": [item.to_details() for item in self.findings],
            "queries": [item.to_details() for item in self.queries],
            "message": self.message,
            "output": {
                "sanitized_values": self.sanitized_values,
                "truncated_events": self.truncated_events,
                "truncated_paths": self.truncated_paths,
            },
        }


def guardrail_config_from_runtime(runtime_config: RuntimeConfig) -> GuardrailConfig:
    custom_patterns: list[tuple[re.Pattern[str], str]] = []
    for item in runtime_config.mcp_guardrail_sanitize_custom_patterns:
        try:
            custom_patterns.append((re.compile(item["pattern"]), item.get("replacement", "")))
        except re.error as exc:
            raise ValueError(f"无效的自定义脱敏正则 {item['pattern']!r}: {exc}") from exc

    return GuardrailConfig(
        enabled=runtime_config.mcp_guardrails_enabled,
        mode=runtime_config.mcp_guardrail_enforce_mode,
        deny_commands=frozenset(runtime_config.mcp_guardrail_deny_commands),
        alert_threshold=runtime_config.mcp_guardrail_risk_alert_threshold,
        reject_threshold=runtime_config.mcp_guardrail_risk_reject_threshold,
        rule_overrides=dict(runtime_config.mcp_guardrail_risk_rule_overrides),
        safe_timerange=runtime_config.mcp_guardrail_safe_timerange,
        exec_timeout_seconds=runtime_config.mcp_guardrail_exec_timeout_seconds,
        max_events=runtime_config.mcp_guardrail_max_events,
        sanitize_enabled=runtime_config.mcp_guardrail_sanitize_enabled,
        sanitize_masks=frozenset(runtime_config.mcp_guardrail_sanitize_masks),
        sanitize_custom_patterns=tuple(custom_patterns),
    )


def assess_tool_arguments(
    config: GuardrailConfig,
    *,
    route_name: str,
    tool_name: str,
    arguments: dict[str, Any],
) -> GuardrailAssessment:
    assessment = GuardrailAssessment(
        enabled=config.enabled,
        mode=config.mode,
        alert_threshold=config.alert_threshold,
        reject_threshold=config.reject_threshold,
    )
    if not config.enabled:
        return assessment

    candidates = extract_spl_candidates(route_name, tool_name, arguments)
    return _assess_candidates(config, candidates)


def assess_generated_spl(
    config: GuardrailConfig,
    *,
    route_name: str,
    tool_name: str,
    payload: Any,
) -> GuardrailAssessment:
    assessment = GuardrailAssessment(
        enabled=config.enabled,
        mode=config.mode,
        alert_threshold=config.alert_threshold,
        reject_threshold=config.reject_threshold,
    )
    if not config.enabled or route_name != "chatspl" or tool_name != "chat_spl":
        return assessment

    candidates: list[SplCandidate] = []

    def visit(value: Any, path: str) -> None:
        if isinstance(value, dict):
            for key, item in value.items():
                child_path = f"{path}.{key}"
                if key == "spl" and isinstance(item, str) and item.strip():
                    candidates.append(SplCandidate(path=child_path, query=item.strip()))
                else:
                    visit(item, child_path)
        elif isinstance(value, list):
            for index, item in enumerate(value):
                visit(item, f"{path}[{index}]")

    visit(payload, "result")
    return _assess_candidates(config, candidates)


def extract_spl_candidates(
    route_name: str,
    tool_name: str,
    arguments: dict[str, Any],
) -> list[SplCandidate]:
    if route_name not in _SPL_ROUTES or (route_name, tool_name) in _NON_EXECUTING_QUERY_TOOLS:
        return []

    candidates: list[SplCandidate] = []
    seen: set[tuple[str, str, str | None]] = set()

    def add(path: str, query: str, time_range: str | None) -> None:
        normalized = query.strip()
        if not normalized:
            return
        marker = (path, normalized, time_range)
        if marker in seen:
            return
        seen.add(marker)
        candidates.append(SplCandidate(path=path, query=normalized, time_range=time_range))

    def visit(value: Any, path: str, inherited_time_range: str | None = None) -> None:
        if isinstance(value, dict):
            local_time_range = _find_time_range(value) or inherited_time_range
            for key, item in value.items():
                child_path = f"{path}.{key}"
                if key in _QUERY_KEYS and isinstance(item, str):
                    add(child_path, item, local_time_range)
                    continue
                if key == "knowledge_text" and isinstance(item, str):
                    parsed = _try_parse_json(item)
                    if isinstance(parsed, dict) and isinstance(parsed.get("output"), str):
                        add(f"{child_path}.output", parsed["output"], local_time_range)
                    continue
                if key == "alert" and isinstance(item, str):
                    parsed = _try_parse_json(item)
                    if parsed is not None:
                        visit(parsed, child_path, local_time_range)
                    continue
                visit(item, child_path, local_time_range)
        elif isinstance(value, list):
            for index, item in enumerate(value):
                visit(item, f"{path}[{index}]", inherited_time_range)

    visit(arguments, f"{route_name}/{tool_name}")
    return candidates


def assess_spl_query(
    query: str,
    *,
    path: str,
    time_range: str | None,
    config: GuardrailConfig,
) -> QueryRiskAssessment:
    command_segments = extract_command_segments(query)
    commands = [command for command, _segment in command_segments]
    unique_commands = tuple(dict.fromkeys(commands))
    denied_commands = tuple(sorted(set(commands) & config.deny_commands))
    findings: list[RiskFinding] = []

    def add(rule: str, default_score: int, message: str, *, multiplier: int = 1) -> None:
        score = config.rule_overrides.get(rule, default_score) * multiplier
        if score > 0:
            findings.append(RiskFinding(rule=rule, score=score, message=message))

    if "delete" in commands:
        add("delete", 80, "delete 会删除原始日志。")
    if "lookup2" in commands:
        add("external_command", 40, "lookup2 会执行自定义 Python 模块。")

    collect_segments = [segment for command, segment in command_segments if command == "collect"]
    if collect_segments and any(not re.search(r"\btestmode\s*=\s*true\b", item, re.I) for item in collect_segments):
        add("collect", 25, "collect 未启用 testmode=true，会把结果写回索引。")

    outputlookup_segments = [segment for command, segment in command_segments if command == "outputlookup"]
    if outputlookup_segments and any(re.search(r"\boverride\s*=\s*true\b", item, re.I) for item in outputlookup_segments):
        add("outputlookup_override", 20, "outputlookup override=true 可能覆盖已有字典。")

    expensive_count = sum(1 for command in commands if command in _EXPENSIVE_COMMANDS)
    if expensive_count:
        add(
            "expensive_command",
            20,
            f"检测到 {expensive_count} 个 transaction/map/join 高开销命令。",
            multiplier=expensive_count,
        )

    append_count = sum(1 for command in commands if command in {"append", "appendcols"})
    if append_count:
        add(
            "append",
            15,
            f"检测到 {append_count} 个 append/appendcols 内存敏感命令。",
            multiplier=append_count,
        )

    nested_count = sum(1 for command in commands if command in _NESTED_COMMANDS)
    if nested_count:
        add(
            "nested_search",
            15,
            f"检测到 {nested_count} 个可展开子搜索的命令。",
            multiplier=nested_count,
        )

    unbounded_subsearches = count_unbounded_subsearches(query)
    if unbounded_subsearches:
        add(
            "unbounded_subsearch",
            20,
            f"检测到 {unbounded_subsearches} 个未显式限制结果量的子搜索。",
            multiplier=unbounded_subsearches,
        )

    for command, segment in command_segments:
        if command != "map":
            continue
        match = re.search(r"\bmaxsearches\s*=\s*(\d+)", segment, re.I)
        if match is None or int(match.group(1)) > 10:
            add("map_unbounded", 20, "map 未设置 maxsearches，或 maxsearches 大于 10。")
            break

    index_risk = _assess_index_scope(query, unique_commands)
    if index_risk == "wildcard_constrained":
        add("index_wildcard_constrained", 20, "查询使用 index=*，但存在字段约束。")
    elif index_risk == "broad":
        add("index_broad", 35, "查询未限定具体索引或字段范围，可能扫描过多数据。")

    time_kind = _assess_time_range(query, time_range, config.safe_timerange)
    if time_kind == "exceeds_safe":
        add("time_range_exceeds", 20, f"查询时间范围超过安全窗口 {config.safe_timerange}。")
    elif time_kind == "all_time":
        add("time_range_all", 50, "查询使用全时间范围。")
    elif time_kind == "no_time":
        add("time_range_missing", 50, "查询未声明时间范围。")

    risk_score = min(100, sum(item.score for item in findings))
    return QueryRiskAssessment(
        path=path,
        risk_score=risk_score,
        commands=unique_commands,
        denied_commands=denied_commands,
        findings=tuple(findings),
        time_range=time_range,
    )


def extract_command_segments(query: str) -> list[tuple[str, str]]:
    results: list[tuple[str, str]] = []
    visited: set[str] = set()

    def scan(text: str) -> None:
        normalized = text.strip()
        if not normalized or normalized in visited:
            return
        visited.add(normalized)
        segments = _split_pipeline(normalized)
        starts_with_pipe = normalized.lstrip().startswith("|")
        for index, raw_segment in enumerate(segments):
            segment = raw_segment.strip().lstrip("[").strip()
            if not segment:
                continue
            token_match = re.match(r"([a-zA-Z][\w]*)\b", segment)
            if token_match is None:
                continue
            command = token_match.group(1).lower()
            is_command_position = (
                index > 0
                or starts_with_pipe
                or command in _SOURCE_GENERATING_COMMANDS
            )
            if not is_command_position or command not in _KNOWN_COMMANDS:
                continue
            results.append((command, segment))
            if command == "map":
                for quoted_query in _extract_map_queries(segment):
                    scan(quoted_query)

        for subsearch in _extract_bracket_contents(normalized):
            scan(subsearch)

    scan(query)
    return results


def count_unbounded_subsearches(query: str) -> int:
    count = 0
    for content in _extract_bracket_contents(query):
        if not re.search(r"\b(?:maxout|maxresults|maxsearches|head)\b", content, re.I):
            count += 1
    return count


def sanitize_output(data: Any, config: GuardrailConfig) -> tuple[Any, int]:
    if not config.enabled or not config.sanitize_enabled:
        return data, 0

    replacements = 0

    def sanitize_string(value: str) -> str:
        nonlocal replacements
        result = value
        if "credit_card" in config.sanitize_masks:
            def mask_card(match: re.Match[str]) -> str:
                nonlocal replacements
                digits = re.sub(r"\D", "", match.group(0))
                if not _passes_luhn(digits):
                    return match.group(0)
                replacements += 1
                return f"****-****-****-{digits[-4:]}"

            result = _CREDIT_CARD_RE.sub(mask_card, result)
        if "ssn" in config.sanitize_masks:
            result, count = _SSN_RE.subn("***-**-****", result)
            replacements += count
        for pattern, replacement in config.sanitize_custom_patterns:
            result, count = pattern.subn(replacement, result)
            replacements += count
        return result

    def visit(value: Any) -> Any:
        if isinstance(value, str):
            return sanitize_string(value)
        if isinstance(value, dict):
            return {key: visit(item) for key, item in value.items()}
        if isinstance(value, list):
            return [visit(item) for item in value]
        if isinstance(value, tuple):
            return tuple(visit(item) for item in value)
        return value

    return visit(data), replacements


def truncate_output(data: Any, max_events: int) -> tuple[Any, int, list[str]]:
    omitted = 0
    paths: list[str] = []

    def visit(value: Any, path: str) -> Any:
        nonlocal omitted
        if isinstance(value, list):
            items = value
            if len(items) > max_events:
                omitted += len(items) - max_events
                paths.append(path)
                items = items[:max_events]
            return [visit(item, f"{path}[{index}]") for index, item in enumerate(items)]
        if isinstance(value, tuple):
            return tuple(visit(list(value), path))
        if isinstance(value, dict):
            return {key: visit(item, f"{path}.{key}") for key, item in value.items()}
        return value

    return visit(data, "result"), omitted, paths


def apply_output_guardrails(
    data: Any,
    config: GuardrailConfig,
) -> tuple[Any, int, int, list[str]]:
    if not config.enabled:
        return data, 0, 0, []
    truncated, truncated_events, truncated_paths = truncate_output(data, config.max_events)
    sanitized, sanitized_values = sanitize_output(truncated, config)
    return sanitized, sanitized_values, truncated_events, truncated_paths


def merge_assessments(
    primary: GuardrailAssessment,
    secondary: GuardrailAssessment,
) -> GuardrailAssessment:
    if not secondary.enabled or not secondary.queries:
        return primary
    combined_queries = primary.queries + secondary.queries
    config_like = (primary.mode, primary.alert_threshold, primary.reject_threshold)
    merged = GuardrailAssessment(
        enabled=True,
        mode=config_like[0],
        alert_threshold=config_like[1],
        reject_threshold=config_like[2],
        queries=combined_queries,
    )
    _finalize_assessment(merged)
    return merged


def _assess_candidates(
    config: GuardrailConfig,
    candidates: list[SplCandidate],
) -> GuardrailAssessment:
    assessment = GuardrailAssessment(
        enabled=config.enabled,
        mode=config.mode,
        alert_threshold=config.alert_threshold,
        reject_threshold=config.reject_threshold,
    )
    assessment.queries = [
        assess_spl_query(
            candidate.query,
            path=candidate.path,
            time_range=candidate.time_range,
            config=config,
        )
        for candidate in candidates
    ]
    _finalize_assessment(assessment)
    return assessment


def _finalize_assessment(assessment: GuardrailAssessment) -> None:
    assessment.risk_score = max((item.risk_score for item in assessment.queries), default=0)
    assessment.commands = sorted({command for item in assessment.queries for command in item.commands})
    assessment.denied_commands = sorted(
        {command for item in assessment.queries for command in item.denied_commands}
    )
    assessment.findings = [finding for item in assessment.queries for finding in item.findings]
    should_reject_score = (
        assessment.reject_threshold < 100
        and assessment.risk_score >= assessment.reject_threshold
    )
    if assessment.mode == "enforce" and (assessment.denied_commands or should_reject_score):
        assessment.action = "blocked"
        if assessment.denied_commands:
            assessment.message = f"SPL 包含禁止命令: {', '.join(assessment.denied_commands)}。"
        else:
            assessment.message = (
                f"SPL 风险分 {assessment.risk_score} 达到拒绝阈值 "
                f"{assessment.reject_threshold}。"
            )
    elif assessment.queries and (assessment.denied_commands or assessment.risk_score >= assessment.alert_threshold):
        assessment.action = "audit"
        assessment.message = (
            f"SPL 风险分 {assessment.risk_score}；建议与日志易管理员复核后执行。"
        )
    elif assessment.findings:
        assessment.action = "audit"
        assessment.message = f"SPL 风险分 {assessment.risk_score}，已记录审计信息。"
    else:
        assessment.action = "allow"
        assessment.message = "SPL 检查通过，未发现已配置的风险模式。"


def _find_time_range(value: dict[str, Any]) -> str | None:
    for key in _TIME_KEYS:
        item = value.get(key)
        if isinstance(item, str) and item.strip():
            return item.strip()
    check_condition = value.get("check_condition") or value.get("checkCondition")
    if isinstance(check_condition, dict):
        timerange = check_condition.get("timerange")
        if isinstance(timerange, str) and timerange.strip():
            return timerange.strip()
    return None


def _try_parse_json(value: str) -> Any | None:
    try:
        return json.loads(value)
    except (json.JSONDecodeError, TypeError):
        return None


def _split_pipeline(query: str) -> list[str]:
    segments: list[str] = []
    start = 0
    quote: str | None = None
    escaped = False
    bracket_depth = 0
    for index, character in enumerate(query):
        if escaped:
            escaped = False
            continue
        if character == "\\" and quote is not None:
            escaped = True
            continue
        if quote is not None:
            if character == quote:
                quote = None
            continue
        if character in {'"', "'"}:
            quote = character
            continue
        if character == "[":
            bracket_depth += 1
            continue
        if character == "]" and bracket_depth > 0:
            bracket_depth -= 1
            continue
        if character == "|" and bracket_depth == 0:
            segments.append(query[start:index])
            start = index + 1
    segments.append(query[start:])
    return segments


def _extract_bracket_contents(query: str) -> list[str]:
    contents: list[str] = []
    stack: list[int] = []
    quote: str | None = None
    escaped = False
    for index, character in enumerate(query):
        if escaped:
            escaped = False
            continue
        if character == "\\" and quote is not None:
            escaped = True
            continue
        if quote is not None:
            if character == quote:
                quote = None
            continue
        if character in {'"', "'"}:
            quote = character
            continue
        if character == "[":
            stack.append(index)
        elif character == "]" and stack:
            start = stack.pop()
            if not stack:
                content = query[start + 1:index].strip().strip("[]").strip()
                if content:
                    contents.append(content)
    return contents


def _extract_map_queries(segment: str) -> list[str]:
    queries: list[str] = []
    pattern = re.compile(r"\b(?:search|query)\s*=\s*(['\"])", re.I)
    for match in pattern.finditer(segment):
        quote = match.group(1)
        index = match.end()
        buffer: list[str] = []
        escaped = False
        while index < len(segment):
            character = segment[index]
            if escaped:
                buffer.append(character)
                escaped = False
            elif character == "\\":
                escaped = True
            elif character == quote:
                break
            else:
                buffer.append(character)
            index += 1
        if buffer:
            queries.append("".join(buffer))
    return queries


def _assess_index_scope(query: str, commands: tuple[str, ...]) -> str:
    if any(command in _SOURCE_GENERATING_COMMANDS for command in commands):
        return "safe"
    base_query = _split_pipeline(query)[0]
    index_match = _INDEX_RE.search(base_query)
    constraints = [
        match.group(0)
        for match in _FIELD_CONSTRAINT_RE.finditer(base_query)
        if not match.group(0).lower().lstrip("'\"").startswith("index")
    ]
    if index_match:
        index_value = index_match.group(2).strip("'\"").lower()
        if index_value in {"*", "all", "alltime"}:
            return "wildcard_constrained" if constraints else "broad"
        return "safe"
    if constraints:
        return "safe"
    return "broad"


def _assess_time_range(query: str, time_range: str | None, safe_timerange: str) -> str:
    safe_hours = parse_time_to_hours(safe_timerange)
    if time_range:
        duration = parse_time_range_to_hours(time_range)
        if math.isinf(duration):
            return "all_time"
        return "exceeds_safe" if duration > safe_hours else "safe"

    earliest_match = _EARLIEST_RE.search(query)
    latest_match = _LATEST_RE.search(query)
    if earliest_match or latest_match:
        earliest = earliest_match.group(1) if earliest_match else "now"
        latest = latest_match.group(1) if latest_match else "now"
        duration = _duration_between(earliest, latest)
        if math.isinf(duration):
            return "all_time"
        return "exceeds_safe" if duration > safe_hours else "safe"

    if re.search(r"\ball\s*time\b|\balltime\b", query, re.I):
        return "all_time"
    return "no_time"


def parse_time_range_to_hours(value: str) -> float:
    normalized = value.strip().lower()
    if normalized in {"0", "all", "alltime", "all time", "*"}:
        return math.inf
    if "," in normalized:
        start, end = (item.strip() for item in normalized.split(",", 1))
        return _duration_between(start, end)
    parsed = _parse_relative_offset_hours(normalized)
    if parsed is not None:
        return abs(parsed)
    return parse_time_to_hours(normalized)


def parse_time_to_hours(value: str) -> float:
    normalized = value.strip().lower()
    if normalized in {"0", "all", "alltime", "all time", "*"}:
        return math.inf
    normalized = re.sub(r"@\w+$", "", normalized)
    normalized = normalized.removeprefix("now")
    match = re.fullmatch(
        r"([+-]?\d+(?:\.\d+)?)\s*(s|sec|m|min|h|hour|d|day|w|week|mon|q|y)?",
        normalized,
    )
    if not match:
        return 24.0
    amount = abs(float(match.group(1)))
    unit = match.group(2) or "h"
    multiplier = {
        "s": 1 / 3600,
        "sec": 1 / 3600,
        "m": 1 / 60,
        "min": 1 / 60,
        "h": 1,
        "hour": 1,
        "d": 24,
        "day": 24,
        "w": 24 * 7,
        "week": 24 * 7,
        "mon": 24 * 30,
        "q": 24 * 91,
        "y": 24 * 365,
    }[unit]
    return amount * multiplier


def _duration_between(start: str, end: str) -> float:
    if start.strip().lower() in {"0", "all", "alltime", "all time", "*"}:
        return math.inf
    start_offset = _parse_relative_offset_hours(start)
    end_offset = _parse_relative_offset_hours(end)
    if start_offset is not None and end_offset is not None:
        return abs(end_offset - start_offset)
    try:
        start_date = datetime.fromisoformat(start.replace("Z", "+00:00"))
        end_date = datetime.fromisoformat(end.replace("Z", "+00:00"))
        return abs((end_date - start_date).total_seconds()) / 3600
    except ValueError:
        return 24.0


def _parse_relative_offset_hours(value: str) -> float | None:
    normalized = value.strip().lower()
    if normalized == "now":
        return 0.0
    normalized = re.sub(r"@\w+$", "", normalized)
    normalized = normalized.removeprefix("now")
    match = re.fullmatch(
        r"([+-]?\d+(?:\.\d+)?)\s*(s|sec|m|min|h|hour|d|day|w|week|mon|q|y)",
        normalized,
    )
    if not match:
        return None
    amount = float(match.group(1))
    unit = match.group(2)
    multiplier = {
        "s": 1 / 3600,
        "sec": 1 / 3600,
        "m": 1 / 60,
        "min": 1 / 60,
        "h": 1,
        "hour": 1,
        "d": 24,
        "day": 24,
        "w": 24 * 7,
        "week": 24 * 7,
        "mon": 24 * 30,
        "q": 24 * 91,
        "y": 24 * 365,
    }[unit]
    return amount * multiplier


def _passes_luhn(digits: str) -> bool:
    if len(digits) < 13 or len(digits) > 19 or len(set(digits)) == 1:
        return False
    total = 0
    parity = len(digits) % 2
    for index, character in enumerate(digits):
        value = int(character)
        if index % 2 == parity:
            value *= 2
            if value > 9:
                value -= 9
        total += value
    return total % 10 == 0
