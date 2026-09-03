from __future__ import annotations

import inspect
import json
import re
from dataclasses import dataclass, field
from typing import Any, Callable

import httpx

from .types import HttpClientConfig

_SQL_FENCE_RE = re.compile(r"```spl\s*\n([\s\S]*?)\n```")


@dataclass
class SseEvent:
    event: str
    data: str


@dataclass
class SseStep:
    id: str | None = None
    title: str | None = None
    status: str | None = None
    tool_name: str | None = None


@dataclass
class SseChatResult:
    conversation_id: int | None = None
    conversation: dict[str, Any] | None = None
    spl: str | None = None
    steps: list[SseStep] = field(default_factory=list)


def _parse_sse_block(lines: list[str]) -> SseEvent | None:
    event_name = ""
    data_lines: list[str] = []
    for line in lines:
        if line.startswith("event: "):
            event_name = line[7:].strip()
        elif line.startswith("data: "):
            data_lines.append(line[6:])
    if not event_name or not data_lines:
        return None
    return SseEvent(event=event_name, data="\n".join(data_lines))


def extract_spl_from_markdown(content: str) -> str:
    match = _SQL_FENCE_RE.search(content)
    if match:
        return match.group(1).strip()
    return re.sub(r"```[\s\S]*?```", "", content).strip()


async def request_sse(
    *,
    url: str,
    headers: dict[str, str],
    body: str,
    config: HttpClientConfig,
    timeout_ms: int = 120000,
    on_event: Callable[[SseEvent], Any] | None = None,
) -> SseChatResult:
    """通过 HTTP SSE 流式请求 /api/v3/copilot/chat/ 并聚合结果。"""
    result = SseChatResult()
    request_headers = dict(headers)
    request_headers.setdefault("Accept", "text/event-stream")
    request_headers.setdefault("Cache-Control", "no-cache")
    request_headers.setdefault("Connection", "keep-alive")

    transport = httpx.AsyncHTTPTransport(verify=config.verify_tls)
    async with httpx.AsyncClient(
        base_url=config.base_url,
        headers=config.headers,
        verify=config.verify_tls,
        transport=transport,
        timeout=timeout_ms / 1000.0,
    ) as client:
        async with client.stream("POST", url, headers=request_headers, content=body) as response:
            if response.status_code >= 400:
                error_text = (await response.aread()).decode("utf-8", errors="replace")
                raise httpx.HTTPStatusError(
                    f"SSE request failed ({response.status_code}): {error_text[:500]}",
                    request=response.request,
                    response=response,
                )

            current_lines: list[str] = []
            async for line in response.aiter_lines():
                stripped = line.strip()
                if stripped:
                    current_lines.append(line)
                    continue
                event = _parse_sse_block(current_lines)
                current_lines = []
                if event is None:
                    continue
                _process_event(event, result)
                if on_event is not None:
                    callback_result = on_event(event)
                    if callback_result is not None and inspect.isawaitable(callback_result):
                        await callback_result

    return result


def _process_event(
    event: SseEvent,
    result: SseChatResult,
) -> None:
    if event.event == "DONE":
        try:
            parsed = json.loads(event.data)
            if parsed.get("conversation_id"):
                result.conversation_id = parsed.get("conversation_id")
        except (json.JSONDecodeError, TypeError):
            pass
        return

    if event.event == "META":
        try:
            parsed = json.loads(event.data)
            if parsed.get("conversation"):
                result.conversation = parsed.get("conversation")
        except (json.JSONDecodeError, TypeError):
            pass
        return

    if event.event == "CREATE_STEP":
        try:
            parsed = json.loads(event.data)
            details = parsed.get("details")
            result.steps.append(
                SseStep(
                    id=parsed.get("id"),
                    title=parsed.get("title"),
                    status="CREATED",
                    tool_name=details.get("tool_name") if isinstance(details, dict) else None,
                )
            )
        except (json.JSONDecodeError, TypeError):
            pass
        return

    if event.event == "SET_STATUS":
        try:
            parsed = json.loads(event.data)
            for step in result.steps:
                if step.id == parsed.get("id"):
                    step.status = parsed.get("status")
                    if parsed.get("title"):
                        step.title = parsed.get("title")
                    break
        except (json.JSONDecodeError, TypeError):
            pass
        return

    if event.event == "STEP_OUTPUT":
        try:
            parsed = json.loads(event.data)
            for step in result.steps:
                if step.id == parsed.get("id") and step.tool_name == "send_spl" and parsed.get("content"):
                    result.spl = extract_spl_from_markdown(parsed["content"])
                    break
        except (json.JSONDecodeError, TypeError):
            pass
        return
