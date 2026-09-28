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

            # 先判断后计数：被拒绝的请求不占用配额。
            # 边界语义：计数达到 limit 时仍放行，第 limit+1 次才拒绝（`>` 比较）。
            global_count = self._global_count
            tool_count = (
                self._tool_counts.get(tool_counter_key, 0)
                if tool_limit is not None
                else 0
            )

            scope: RateLimitScope | None = None
            limit: int | None = None
            current = 0
            if self.global_limit is not None and global_count + 1 > self.global_limit:
                scope = "global"
                limit = self.global_limit
                current = global_count + 1
            elif tool_limit is not None and tool_count + 1 > tool_limit:
                scope = "tool"
                limit = tool_limit
                current = tool_count + 1

            allowed = scope is None
            if allowed:
                if self.global_limit is not None:
                    self._global_count = global_count + 1
                if tool_limit is not None:
                    self._tool_counts[tool_counter_key] = tool_count + 1

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
