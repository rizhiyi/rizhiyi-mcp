from __future__ import annotations

import asyncio
import hashlib
import json
import time
import os
from dataclasses import dataclass
from typing import Any, Awaitable, Callable

from .types import ApiResponse


@dataclass(slots=True)
class CacheEntry:
    expires_at: float
    value: ApiResponse[Any]


def _stable(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=str)


def _normalize_params(params: dict[str, Any]) -> dict[str, Any]:
    normalized = dict(params)
    for key in ("query", "time_range", "bucket", "metric_field"):
        if isinstance(normalized.get(key), str):
            normalized[key] = normalized[key].strip()
    return normalized


class QueryCache:
    """短 TTL 查询缓存，同时合并相同 key 的并发请求。"""

    def __init__(self, ttls: dict[str, float] | None = None) -> None:
        self._values: dict[str, CacheEntry] = {}
        self._inflight: dict[str, asyncio.Future[ApiResponse[Any]]] = {}
        self._ttls = ttls or {
            "timechart": 30.0,
            "overview": 30.0,
            "fields": 60.0,
            "field_values": 30.0,
            "sample_rows": 15.0,
            "exact_count": 15.0,
        }

    @staticmethod
    def _log(event: str, **fields: Any) -> None:
        if os.getenv("MCP_QUERY_CACHE_LOGGING", "").lower() == "true":
            print(json.dumps({"component": "query-cache", "event": event, **fields}, ensure_ascii=False), flush=True)

    def _ttl(self, path: str, params: dict[str, Any]) -> float:
        if "/search/sheets/" in path:
            query = str(params.get("query") or "").lower()
            if "timechart" in query:
                return self._ttls["timechart"]
            # list_fields and list_field_values share the sheets endpoint, so
            # classify them before the generic sample/count size buckets.
            if params.get("fields") is True and int(params.get("size") or 0) == 0:
                return self._ttls["fields"]
            if "stats count by" in query:
                return self._ttls["field_values"]
            return self._ttls["sample_rows"] if int(params.get("size") or 0) <= 5 else self._ttls["exact_count"]
        if "field_values" in path:
            return self._ttls["field_values"]
        if "fields" in path:
            return self._ttls["fields"]
        if "overview" in path:
            return self._ttls["overview"]
        return 0.0

    async def get_or_fetch(
        self,
        *,
        path: str,
        params: dict[str, Any],
        identity: str,
        fetch: Callable[[], Awaitable[ApiResponse[Any]]],
    ) -> ApiResponse[Any]:
        ttl = self._ttl(path, params)
        if ttl <= 0:
            return await fetch()
        normalized_params = _normalize_params(params)
        key = hashlib.sha256(_stable({"identity": identity, "path": path, "params": normalized_params}).encode()).hexdigest()
        now = time.monotonic()
        entry = self._values.get(key)
        if entry and entry.expires_at > now:
            self._log("cache_hit")
            return entry.value
        if entry:
            self._values.pop(key, None)
        pending = self._inflight.get(key)
        if pending:
            self._log("inflight_join")
            return await asyncio.shield(pending)
        self._log("cache_miss")
        started_at = time.monotonic()
        task = asyncio.create_task(fetch())
        self._inflight[key] = task
        try:
            result = await task
            self._log(
                "upstream_complete",
                duration_ms=round((time.monotonic() - started_at) * 1000, 1),
                status=result.status,
                error_code=result.error_code,
            )
            if not result.error:
                self._values[key] = CacheEntry(time.monotonic() + ttl, result)
            return result
        finally:
            self._inflight.pop(key, None)
