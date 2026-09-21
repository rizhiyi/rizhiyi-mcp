from __future__ import annotations

from collections.abc import Callable, Mapping
from dataclasses import asdict, dataclass
from math import ceil
from threading import Lock
import time
from typing import Literal


RateLimitScope = Literal["global", "tool"]


@dataclass(frozen=True, slots=True)
class RateLimitDecision:
    allowed: bool
    scope: RateLimitScope | None
    limit: int | None
    current: int
    remaining: int | None
    retry_after_seconds: int | None
    reset_at: int
    window_seconds: int
    route_name: str
    tool_name: str

    def to_details(self) -> dict[str, object]:
        return asdict(self)


class FixedWindowRateLimiter:
    """Per-process fixed-window limiter for MCP tool calls."""

    def __init__(
        self,
        *,
        global_limit: int | None = None,
        per_tool_limits: Mapping[str, int] | None = None,
        window_seconds: int = 60,
        clock: Callable[[], float] = time.time,
    ) -> None:
        if global_limit is not None and global_limit <= 0:
            raise ValueError("global_limit 必须是正整数或 None")
        if window_seconds <= 0:
            raise ValueError("window_seconds 必须是正整数")

        self.global_limit = global_limit
        self.per_tool_limits = dict(per_tool_limits or {})
        self.window_seconds = window_seconds
        self._clock = clock
        self._lock = Lock()
        self._window_id: int | None = None
        self._global_count = 0
        self._tool_counts: dict[str, int] = {}

    @property
    def enabled(self) -> bool:
        return self.global_limit is not None or bool(self.per_tool_limits)

    def consume(self, *, route_name: str, tool_name: str) -> RateLimitDecision:
        now = max(0.0, float(self._clock()))
        window_id = int(now // self.window_seconds)
        reset_at = (window_id + 1) * self.window_seconds
        exact_tool_key = f"{route_name}/{tool_name}"
        tool_limit = self.per_tool_limits.get(exact_tool_key)
        tool_counter_key = exact_tool_key
        if tool_limit is None:
            tool_limit = self.per_tool_limits.get(tool_name)
            tool_counter_key = tool_name

        with self._lock:
            if self._window_id != window_id:
                self._window_id = window_id
                self._global_count = 0
                self._tool_counts.clear()

            if self.global_limit is not None:
                self._global_count += 1

            tool_count = 0
            if tool_limit is not None:
                tool_count = self._tool_counts.get(tool_counter_key, 0) + 1
                self._tool_counts[tool_counter_key] = tool_count

            scope: RateLimitScope | None = None
            limit: int | None = None
            current = 0
            if self.global_limit is not None and self._global_count > self.global_limit:
                scope = "global"
                limit = self.global_limit
                current = self._global_count
            elif tool_limit is not None and tool_count > tool_limit:
                scope = "tool"
                limit = tool_limit
                current = tool_count

            allowed = scope is None
            remaining = None
            if limit is not None:
                remaining = max(0, limit - current)
            retry_after_seconds = max(1, ceil(reset_at - now)) if not allowed else None

            return RateLimitDecision(
                allowed=allowed,
                scope=scope,
                limit=limit,
                current=current,
                remaining=remaining,
                retry_after_seconds=retry_after_seconds,
                reset_at=reset_at,
                window_seconds=self.window_seconds,
                route_name=route_name,
                tool_name=tool_name,
            )
