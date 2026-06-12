from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml

_REPO_ROOT = Path(__file__).resolve().parents[2]
_CONFIG_DIR = _REPO_ROOT / "config"
_HTTP_METHODS = ("get", "post", "put", "patch", "delete", "options", "head")
_JSON_CONTENT_TYPES = (
    "application/json",
    "application/*+json",
    "application/merge-patch+json",
)


@dataclass(frozen=True, slots=True)
class SchemaParameter:
    name: str
    location: str
    required: bool
    schema: dict[str, Any]
    description: str


@dataclass(frozen=True, slots=True)
class SchemaOperation:
    tool_name: str
    path: str
    method: str
    description: str
    input_schema: dict[str, Any]
    tag: str | None
    parameters: tuple[SchemaParameter, ...]
    request_body_required: bool = False
    request_body_schema: dict[str, Any] | None = None
    request_body_content_type: str | None = None


@lru_cache(maxsize=8)
def load_yaml_spec(file_name: str) -> dict[str, Any]:
    with (_CONFIG_DIR / file_name).open("r", encoding="utf-8") as handle:
        loaded = yaml.safe_load(handle)
    return loaded if isinstance(loaded, dict) else {}


@lru_cache(maxsize=8)
def build_operation_catalog(file_name: str) -> tuple[SchemaOperation, ...]:
    spec = load_yaml_spec(file_name)
    operations: list[SchemaOperation] = []

    for api_path, path_item in spec.get("paths", {}).items():
        if not isinstance(path_item, dict):
            continue

        path_parameters = _resolve_parameters(path_item.get("parameters"), spec)

        for method, raw_operation in path_item.items():
            if method.lower() not in _HTTP_METHODS or not isinstance(raw_operation, dict):
                continue
            operations.append(
                _build_operation(
                    spec=spec,
                    api_path=str(api_path),
                    method=str(method).upper(),
                    raw_operation=raw_operation,
                    path_parameters=path_parameters,
                )
            )

    return tuple(sorted(operations, key=lambda item: (item.tool_name, item.path, item.method)))


@lru_cache(maxsize=8)
def build_operation_index(file_name: str) -> dict[tuple[str, str], SchemaOperation]:
    return {
        (operation.path, operation.method): operation
        for operation in build_operation_catalog(file_name)
    }


def _build_operation(
    *,
    spec: dict[str, Any],
    api_path: str,
    method: str,
    raw_operation: dict[str, Any],
    path_parameters: tuple[SchemaParameter, ...],
) -> SchemaOperation:
    operation = _resolve_node(raw_operation, spec)
    own_parameters = _resolve_parameters(operation.get("parameters"), spec)
    merged_parameters = _merge_parameters(path_parameters, own_parameters)
    request_body = _resolve_request_body(operation.get("requestBody"), spec)

    summary = str(operation.get("summary") or "").strip()
    description = str(operation.get("description") or "").strip()
    tool_name = _derive_tool_name(operation, api_path, method)
    tool_description = summary or description or f"{method} {api_path}"
    tag = _get_primary_tag(operation)

    return SchemaOperation(
        tool_name=tool_name,
        path=api_path,
        method=method,
        description=tool_description,
        input_schema=_build_input_schema(merged_parameters, request_body, method, api_path),
        tag=tag,
        parameters=merged_parameters,
        request_body_required=bool(request_body and request_body.get("required")),
        request_body_schema=request_body.get("schema") if request_body else None,
        request_body_content_type=request_body.get("content_type") if request_body else None,
    )


def _build_input_schema(
    parameters: tuple[SchemaParameter, ...],
    request_body: dict[str, Any] | None,
    method: str,
    api_path: str,
) -> dict[str, Any]:
    properties: dict[str, Any] = {}
    required: list[str] = []

    for parameter in parameters:
        schema = dict(parameter.schema)
        if parameter.description and "description" not in schema:
            schema["description"] = parameter.description
        properties[parameter.name] = schema
        if parameter.required:
            required.append(parameter.name)

    if request_body is not None:
        body_schema = request_body.get("schema") or {"type": "object", "additionalProperties": True}
        body_description = request_body.get("description") or f"{method} {api_path} 的请求体。"
        properties["body"] = {
            **body_schema,
            "description": body_description,
        }
        if request_body.get("required"):
            required.append("body")

    result: dict[str, Any] = {
        "type": "object",
        "properties": properties,
        "additionalProperties": False,
    }
    if required:
        result["required"] = required
    return result


def _resolve_parameters(raw_parameters: Any, spec: dict[str, Any]) -> tuple[SchemaParameter, ...]:
    if not isinstance(raw_parameters, list):
        return ()

    resolved: list[SchemaParameter] = []
    for raw_parameter in raw_parameters:
        parameter = _resolve_node(raw_parameter, spec)
        if not isinstance(parameter, dict):
            continue

        name = parameter.get("name")
        location = parameter.get("in")
        if not isinstance(name, str) or not isinstance(location, str):
            continue

        schema = _normalize_json_schema(parameter.get("schema"), spec)
        description = str(parameter.get("description") or "").strip()
        resolved.append(
            SchemaParameter(
                name=name,
                location=location,
                required=bool(parameter.get("required")),
                schema=schema,
                description=description,
            )
        )

    return tuple(resolved)


def _merge_parameters(
    inherited_parameters: tuple[SchemaParameter, ...],
    own_parameters: tuple[SchemaParameter, ...],
) -> tuple[SchemaParameter, ...]:
    merged: dict[tuple[str, str], SchemaParameter] = {
        (parameter.name, parameter.location): parameter
        for parameter in inherited_parameters
    }
    for parameter in own_parameters:
        merged[(parameter.name, parameter.location)] = parameter
    return tuple(merged.values())


def _resolve_request_body(raw_request_body: Any, spec: dict[str, Any]) -> dict[str, Any] | None:
    request_body = _resolve_node(raw_request_body, spec)
    if not isinstance(request_body, dict):
        return None

    content = request_body.get("content")
    if not isinstance(content, dict) or not content:
        return None

    chosen_content_type, media_type_object = _pick_media_type(content)
    if not isinstance(media_type_object, dict):
        return None

    return {
        "required": bool(request_body.get("required")),
        "description": str(request_body.get("description") or "").strip(),
        "content_type": chosen_content_type,
        "schema": _normalize_json_schema(media_type_object.get("schema"), spec),
    }


def _pick_media_type(content: dict[str, Any]) -> tuple[str | None, Any]:
    for content_type in _JSON_CONTENT_TYPES:
        if content_type in content:
            return content_type, content[content_type]

    for content_type, media_type_object in content.items():
        if content_type.endswith("+json"):
            return str(content_type), media_type_object

    first_content_type = next(iter(content.items()))
    return str(first_content_type[0]), first_content_type[1]


def _normalize_json_schema(raw_schema: Any, spec: dict[str, Any]) -> dict[str, Any]:
    schema = _resolve_node(raw_schema, spec)
    if not isinstance(schema, dict):
        return {"type": "object", "additionalProperties": True}

    if "allOf" in schema and isinstance(schema["allOf"], list):
        merged: dict[str, Any] = {"type": "object", "properties": {}, "required": []}
        for item in schema["allOf"]:
            normalized = _normalize_json_schema(item, spec)
            merged["properties"].update(normalized.get("properties", {}))
            merged["required"].extend(normalized.get("required", []))
        if schema.get("description"):
            merged["description"] = schema["description"]
        merged["required"] = sorted(set(merged["required"]))
        return merged

    normalized: dict[str, Any] = {}
    passthrough_keys = (
        "type",
        "description",
        "enum",
        "default",
        "minimum",
        "maximum",
        "minLength",
        "maxLength",
        "format",
        "example",
        "examples",
        "nullable",
        "additionalProperties",
    )
    for key in passthrough_keys:
        if key in schema:
            normalized[key] = schema[key]

    if "properties" in schema and isinstance(schema["properties"], dict):
        normalized["type"] = normalized.get("type", "object")
        normalized["properties"] = {
            str(name): _normalize_json_schema(value, spec)
            for name, value in schema["properties"].items()
        }
    if "required" in schema and isinstance(schema["required"], list):
        normalized["required"] = [str(name) for name in schema["required"]]
    if "items" in schema:
        normalized["items"] = _normalize_json_schema(schema["items"], spec)
    if "oneOf" in schema and isinstance(schema["oneOf"], list):
        normalized["oneOf"] = [_normalize_json_schema(item, spec) for item in schema["oneOf"]]
    if "anyOf" in schema and isinstance(schema["anyOf"], list):
        normalized["anyOf"] = [_normalize_json_schema(item, spec) for item in schema["anyOf"]]

    if not normalized:
        return {"type": "object", "additionalProperties": True}
    return normalized


def _resolve_node(raw_node: Any, spec: dict[str, Any]) -> Any:
    if isinstance(raw_node, dict) and "$ref" in raw_node:
        return _resolve_ref(str(raw_node["$ref"]), spec)
    return raw_node


def _resolve_ref(ref: str, spec: dict[str, Any]) -> Any:
    if not ref.startswith("#/"):
        return {}

    current: Any = spec
    for part in ref[2:].split("/"):
        if not isinstance(current, dict):
            return {}
        current = current.get(part)
    return _resolve_node(current, spec)


def _derive_tool_name(operation: dict[str, Any], api_path: str, method: str) -> str:
    operation_id = operation.get("operationId")
    if isinstance(operation_id, str) and operation_id.strip():
        return operation_id.strip()

    path_name = api_path.strip("/").replace("/", "_").replace("{", "").replace("}", "")
    return f"{method.lower()}_{path_name or 'root'}"


def _get_primary_tag(operation: dict[str, Any]) -> str | None:
    tags = operation.get("tags")
    if not isinstance(tags, list) or not tags:
        return None
    first = tags[0]
    return first if isinstance(first, str) else None
