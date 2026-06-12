from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Generic, Literal, TYPE_CHECKING, TypeVar

T = TypeVar("T")

SharedResultKind = Literal[
    "rows",
    "precheck",
    "patterns",
    "stats",
    "analysis",
    "timeseries",
    "generic",
]
RequestSource = Literal["stdio", "http"]


@dataclass(slots=True)
class ApiResponse(Generic[T]):
    status: int | None = None
    data: T | None = None
    error: str | None = None
    error_code: str | None = None
    suggestion: str | None = None
    retryable: bool | None = None
    details: Any | None = None
    progress: Any | None = None
    message: str | None = None


@dataclass(slots=True)
class HttpClientConfig:
    base_url: str
    headers: dict[str, str]
    verify_tls: bool = False
    timeout_seconds: float = 30.0


@dataclass(slots=True)
class SharedResultSummary:
    title: str
    text: str
    key_metrics: dict[str, Any] = field(default_factory=dict)
    preview_fields: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


@dataclass(slots=True)
class SharedResultEnvelope(Generic[T]):
    handle: str
    resource_uri: str
    resource_title: str
    resource_type: SharedResultKind
    resource_mime_type: str
    created_at: str
    expires_at: str
    tool_name: str
    result_kind: SharedResultKind
    payload_bytes: int
    summary: SharedResultSummary
    payload: T
    source_query: str | None = None
    time_range: str | None = None
    index_name: str | None = None
    upstream_sid: str | None = None
    route_name: str | None = None


@dataclass(slots=True)
class RequestMeta:
    source: RequestSource
    path: str | None = None
    client_address: str | None = None


@dataclass(slots=True)
class ApiKeyAuthorization:
    kind: Literal["apikey"]
    raw_authorization: str
    api_key_preview: str


@dataclass(slots=True)
class BasicAuthorization:
    kind: Literal["basic"]
    raw_authorization: str
    username: str


ParsedAuthorization = ApiKeyAuthorization | BasicAuthorization


@dataclass(slots=True)
class AuthContext:
    authorization: ParsedAuthorization | None
    headers: dict[str, str]


if TYPE_CHECKING:
    from .config import RuntimeConfig


@dataclass(slots=True)
class ServerContext:
    runtime_config: RuntimeConfig
    auth_context: AuthContext
    request_meta: RequestMeta


@dataclass(slots=True)
class ToolDefinition:
    name: str
    description: str
    input_schema: dict[str, Any]


@dataclass(slots=True)
class ResourceDefinition:
    uri: str
    name: str
    description: str
    mime_type: str = "application/json"


@dataclass(slots=True)
class ResourceContent:
    uri: str
    mime_type: str
    text: str


@dataclass(slots=True)
class ToolCallResult:
    structured_content: dict[str, Any]
    content: list[dict[str, Any]]
    is_error: bool = False
