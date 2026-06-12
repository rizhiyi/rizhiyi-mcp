from __future__ import annotations

import json
from typing import Any

from .config import RuntimeConfig
from .servers import ServiceRuntimeState, create_tool_server
from .service_tooling import BaseServiceModule, ServiceToolRuntime, with_output_controls
from .types import ApiResponse, ToolDefinition

SERVER_LEVEL_INSTRUCTIONS = """使用说明:
1. 这是 ingest 专用入口，只处理 Agent 只读、Agent 分组管理和 pipeline 管理。
2. 初版只支持 pipeline 这一种采集配置方案，不处理 agent/config 和 agentgroup/inputs。
3. 推荐流程：先 list_agent_groups / list_pipelines 看现状，再做 add_agents_to_group、create_pipeline、replace_pipeline_groups 等变更。
4. create_pipeline / update_pipeline 的 detail 支持对象、数组或合法 JSON 字符串；工具会先做本地 JSON 合法性检查。
5. 输出默认使用 output_format=auto，以减少上下文消耗。
6. 遇到错误时，优先根据 suggestion 字段修正参数后重试一次。"""

DEFAULT_AGENT_FIELDS = ",".join(
    ("id", "ip", "port", "hostname", "platform", "os", "status", "cur_version", "expected_version", "last_update_timestamp")
)
DEFAULT_AGENT_GROUP_FIELDS = ",".join(("id", "name", "memo", "creator_id", "from_app"))

INGEST_TOOLS = with_output_controls(
    [
        ToolDefinition(
            name="list_agents",
            description="列出 Agent 列表。只读工具；`group_ids` 可选，默认值为 `all`，表示当前账号可读的全部分组。可按 IP、平台、状态、主机名等条件过滤。",
            input_schema={
                "type": "object",
                "properties": {
                    "fields": {"type": "string", "description": "可选，返回字段列表，逗号分隔。"},
                    "permits": {"type": "string", "description": "可选，是否返回权限相关信息。"},
                    "page": {"type": "integer", "description": "页码。"},
                    "size": {"type": "integer", "description": "每页条数。"},
                    "group_ids": {"type": "string", "description": "可选，逗号分隔的分组 id 集合，或特殊值 `all`；默认 `all`。", "default": "all"},
                    "id": {"type": "integer", "description": "按 Agent ID 过滤。"},
                    "ip": {"type": "string", "description": "按 Agent IP 过滤。"},
                    "port": {"type": "integer", "description": "按端口过滤。"},
                    "status": {"type": "string", "description": "按状态过滤。"},
                    "os": {"type": "string", "description": "按操作系统过滤。"},
                    "platform": {"type": "string", "description": "按平台过滤。"},
                    "cur_version": {"type": "string", "description": "按当前版本过滤。"},
                    "expected_version": {"type": "string", "description": "按预期版本过滤。"},
                    "is_server_heka": {"oneOf": [{"type": "boolean"}, {"type": "string"}], "description": "是否为 Server 类型；支持布尔值或字符串。"},
                    "proxy_ip": {"type": "string", "description": "按代理地址过滤。"},
                    "proxy_port": {"type": "integer", "description": "按代理端口过滤。"},
                    "domain_id": {"type": "integer", "description": "按 domain_id 过滤。"},
                    "hostname": {"type": "string", "description": "按主机名过滤。"},
                    "comment": {"type": "string", "description": "按备注过滤。"},
                    "cmd": {"type": "string", "description": "按命令状态过滤。"},
                    "cmd_timestamp": {"type": "string", "description": "按命令时间过滤。"},
                    "create_timestamp": {"type": "string", "description": "按接入时间过滤。"},
                    "last_update_timestamp": {"type": "string", "description": "按最近更新时间过滤。"},
                    "sort": {"type": "string", "description": "排序字段。"},
                },
            },
        ),
        ToolDefinition(
            name="list_agent_groups",
            description="列出 Agent 分组列表，可按名称、描述、创建者等过滤。`assignable_only=true` 时切换为仅返回当前账号可分配 Agent 的分组。",
            input_schema={
                "type": "object",
                "properties": {
                    "assignable_only": {"type": "boolean", "description": "可选，是否只返回当前账号有更新权限、可用于分配 Agent 的分组。默认 false。", "default": False},
                    "fields": {"type": "string", "description": "可选，返回字段列表，逗号分隔。"},
                    "permits": {"type": "string", "description": "可选，是否返回权限相关信息。"},
                    "page": {"type": "integer", "description": "页码。"},
                    "size": {"type": "integer", "description": "每页条数。"},
                    "custom_collection": {"type": "string", "description": "可选，自定义收藏过滤。"},
                    "id": {"type": "integer", "description": "按分组 ID 过滤。"},
                    "domain_id": {"type": "integer", "description": "按 domain_id 过滤。"},
                    "name": {"type": "string", "description": "按名称过滤。"},
                    "memo": {"type": "string", "description": "按描述过滤。"},
                    "creator_id": {"type": "integer", "description": "按创建者过滤。"},
                    "from_app": {"type": "integer", "description": "按所属应用过滤。"},
                    "rt_ids": {"type": "string", "description": "按资源标签过滤，多个标签用逗号分隔。"},
                    "sort": {"type": "string", "description": "排序字段。"},
                },
            },
        ),
        ToolDefinition(
            name="get_agent_group_detail",
            description="读取单个 Agent 分组详情。",
            input_schema={"type": "object", "properties": {"id": {"type": "integer", "description": "分组 ID。"}, "fields": {"type": "string", "description": "可选，返回字段列表。"}, "permit": {"type": "string", "description": "可选，是否返回资源权限。"}}, "required": ["id"]},
        ),
        ToolDefinition(
            name="create_agent_group",
            description="创建 Agent 分组。请把主体放在 `group` 中，至少提供 `name` 和 `roles`。",
            input_schema={"type": "object", "properties": {"group": {"oneOf": [{"type": "object", "properties": {"name": {"type": "string", "description": "分组名称。"}, "memo": {"type": "string", "description": "分组描述。"}, "rt_names": {"type": "string", "description": "资源标签名称。"}, "roles": {"type": "array", "items": {"type": "number"}, "description": "角色 ID 数组。"}}}, {"type": "string", "description": "创建分组请求体的 JSON 对象字符串。"}]}}, "required": ["group"]},
        ),
        ToolDefinition(
            name="update_agent_group",
            description="更新 Agent 分组。请提供分组 `id` 和 `changes`。",
            input_schema={"type": "object", "properties": {"id": {"type": "integer", "description": "分组 ID。"}, "changes": {"oneOf": [{"type": "object", "properties": {"name": {"type": "string", "description": "新的分组名称。"}, "memo": {"type": "string", "description": "新的分组描述。"}, "rt_names": {"type": "string", "description": "新的资源标签名称。"}, "roles": {"type": "array", "items": {"type": "number"}, "description": "新的角色 ID 数组。"}}}, {"type": "string", "description": "更新分组请求体的 JSON 对象字符串。"}]}}, "required": ["id", "changes"]},
        ),
        ToolDefinition(
            name="delete_agent_group",
            description="删除单个 Agent 分组。",
            input_schema={"type": "object", "properties": {"id": {"type": "integer", "description": "分组 ID。"}}, "required": ["id"]},
        ),
        ToolDefinition(
            name="add_agents_to_group",
            description="把指定 Agent 加入某个分组。`target_agents` 支持 Agent ID 数组、对象数组，或逗号分隔字符串。",
            input_schema={"type": "object", "properties": {"id": {"type": "integer", "description": "目标分组 ID。"}, "target_agents": {"oneOf": [{"type": "array", "items": {"oneOf": [{"type": "integer"}, {"type": "string"}, {"type": "object", "properties": {"id": {"type": "integer", "description": "Agent ID。"}, "group_ids": {"type": "string", "description": "可选，分组 id 串；默认使用路径上的分组 id。"}}}]}}, {"type": "string", "description": "Agent ID 的逗号分隔字符串，或 JSON 数组字符串。"}], "description": "待加入分组的 Agent 集合。"}}, "required": ["id", "target_agents"]},
        ),
        ToolDefinition(
            name="remove_agents_from_group",
            description="把指定 Agent 从某个分组移除。`target_agents` 支持 Agent ID 数组、对象数组，或逗号分隔字符串。",
            input_schema={"type": "object", "properties": {"id": {"type": "integer", "description": "目标分组 ID。"}, "target_agents": {"oneOf": [{"type": "array", "items": {"oneOf": [{"type": "integer"}, {"type": "string"}, {"type": "object", "properties": {"id": {"type": "integer", "description": "Agent ID。"}}}]}}, {"type": "string", "description": "Agent ID 的逗号分隔字符串，或 JSON 数组字符串。"}], "description": "待移出分组的 Agent 集合。"}}, "required": ["id", "target_agents"]},
        ),
        ToolDefinition(
            name="list_pipeline_schemas",
            description="列出指定平台下的 pipeline schema，用于辅助组装 pipeline.detail。",
            input_schema={"type": "object", "properties": {"kind": {"type": "string", "description": "schema 类型。", "enum": ["InstanceConfiguration", "PluginType", "ReferenceResource"]}, "platform": {"type": "string", "description": "目标平台。"}}, "required": ["kind", "platform"]},
        ),
        ToolDefinition(
            name="list_pipelines",
            description="列出 pipeline 列表。",
            input_schema={"type": "object", "properties": {"page": {"type": "integer", "description": "页码。"}, "size": {"type": "integer", "description": "每页条数。"}, "filter": {"type": "string", "description": "过滤条件。"}, "sort": {"type": "string", "description": "排序字段。"}, "order": {"type": "string", "description": "升序/降序。"}}},
        ),
        ToolDefinition(
            name="get_pipeline_detail",
            description="读取单个 pipeline 详情。",
            input_schema={"type": "object", "properties": {"id": {"type": "string", "description": "pipeline ID。"}}, "required": ["id"]},
        ),
        ToolDefinition(
            name="create_pipeline",
            description="创建 pipeline。请把主体放在 `pipeline` 中；其中 `detail` 支持对象、数组或合法 JSON 字符串。",
            input_schema={"type": "object", "properties": {"pipeline": {"oneOf": [{"type": "object", "properties": {"name": {"type": "string", "description": "pipeline 名称。"}, "platform": {"type": "string", "description": "目标平台。"}, "memo": {"type": "string", "description": "备注。"}, "detail": {"oneOf": [{"type": "string", "description": "插件配置 JSON 字符串。"}, {"type": "object", "additionalProperties": True, "description": "插件配置对象。"}, {"type": "array", "items": {"type": "object"}, "description": "插件配置对象数组。"}]}}}, {"type": "string", "description": "创建 pipeline 请求体的 JSON 对象字符串。"}]}}, "required": ["pipeline"]},
        ),
        ToolDefinition(
            name="update_pipeline",
            description="更新 pipeline。请提供 `id` 和 `changes`；其中 `detail` 支持对象、数组或合法 JSON 字符串。",
            input_schema={"type": "object", "properties": {"id": {"type": "string", "description": "pipeline ID。"}, "changes": {"oneOf": [{"type": "object", "properties": {"name": {"type": "string", "description": "新的 pipeline 名称。"}, "platform": {"type": "string", "description": "新的平台。"}, "memo": {"type": "string", "description": "新的备注。"}, "detail": {"oneOf": [{"type": "string", "description": "插件配置 JSON 字符串。"}, {"type": "object", "additionalProperties": True, "description": "插件配置对象。"}, {"type": "array", "items": {"type": "object"}, "description": "插件配置对象数组。"}]}}}, {"type": "string", "description": "更新 pipeline 请求体的 JSON 对象字符串。"}]}}, "required": ["id", "changes"]},
        ),
        ToolDefinition(
            name="delete_pipeline",
            description="删除单个 pipeline。",
            input_schema={"type": "object", "properties": {"id": {"type": "string", "description": "pipeline ID。"}}, "required": ["id"]},
        ),
        ToolDefinition(
            name="get_pipeline_groups",
            description="读取某个 pipeline 当前关联的 Agent 分组。",
            input_schema={"type": "object", "properties": {"id": {"type": "string", "description": "pipeline ID。"}, "page": {"type": "integer", "description": "页码。"}, "size": {"type": "integer", "description": "每页条数。"}}, "required": ["id"]},
        ),
        ToolDefinition(
            name="add_pipeline_groups",
            description="给某个 pipeline 增量添加 Agent 分组。",
            input_schema={"type": "object", "properties": {"id": {"type": "string", "description": "pipeline ID。"}, "group_ids": {"oneOf": [{"type": "array", "items": {"oneOf": [{"type": "integer"}, {"type": "string"}, {"type": "object", "additionalProperties": True}]}}, {"type": "string", "description": "分组 ID 的逗号分隔字符串，或 JSON 数组字符串。"}], "description": "目标分组 id 集合。"}}, "required": ["id", "group_ids"]},
        ),
        ToolDefinition(
            name="replace_pipeline_groups",
            description="整体替换某个 pipeline 关联的 Agent 分组。",
            input_schema={"type": "object", "properties": {"id": {"type": "string", "description": "pipeline ID。"}, "group_ids": {"oneOf": [{"type": "array", "items": {"oneOf": [{"type": "integer"}, {"type": "string"}, {"type": "object", "additionalProperties": True}]}}, {"type": "string", "description": "分组 ID 的逗号分隔字符串，或 JSON 数组字符串。"}], "description": "目标分组 id 集合。"}}, "required": ["id", "group_ids"]},
        ),
        ToolDefinition(
            name="delete_pipeline_groups",
            description="清空某个 pipeline 当前关联的所有 Agent 分组。",
            input_schema={"type": "object", "properties": {"id": {"type": "string", "description": "pipeline ID。"}}, "required": ["id"]},
        ),
        ToolDefinition(
            name="get_pipeline_agent_status",
            description="读取某个 pipeline 关联 Agent 的同步状态。`group_ids` 可选，默认值为 `all`，表示当前账号可读的全部分组。",
            input_schema={"type": "object", "properties": {"id": {"type": "string", "description": "pipeline ID。"}, "page": {"type": "integer", "description": "页码。"}, "size": {"type": "integer", "description": "每页条数。"}, "filter": {"type": "string", "description": "过滤条件。"}, "group_ids": {"type": "string", "description": "可选，逗号分隔的分组 id 集合，或特殊值 `all`；默认 `all`。", "default": "all"}, "sort": {"type": "string", "description": "排序字段。"}, "order": {"type": "string", "description": "升序/降序。"}, "status": {"type": "string", "description": "文件下发状态。"}}, "required": ["id"]},
        ),
        ToolDefinition(
            name="list_available_pipeline_agents",
            description="列出指定平台下可用于 pipeline 绑定的 Agent。`group_ids` 可选，默认值为 `all`，表示当前账号可读的全部分组。",
            input_schema={"type": "object", "properties": {"page": {"type": "integer", "description": "页码。"}, "size": {"type": "integer", "description": "每页条数。"}, "filter": {"type": "string", "description": "过滤条件。"}, "group_ids": {"type": "string", "description": "可选，逗号分隔的分组 id 集合，或特殊值 `all`；默认 `all`。", "default": "all"}, "sort": {"type": "string", "description": "排序字段。"}, "order": {"type": "string", "description": "升序/降序。"}, "platform": {"type": "string", "description": "目标平台。"}, "exclude_instance": {"type": "string", "description": "排除的实例 id。"}}, "required": ["platform"]},
        ),
        ToolDefinition(
            name="list_available_pipeline_agent_groups",
            description="列出可用于 pipeline 关联的 Agent 分组。",
            input_schema={"type": "object", "properties": {"permit": {"type": "string", "description": "可选，权限过滤。"}}},
        ),
    ]
)


class IngestService(BaseServiceModule):
    async def list_agents(self, params: dict[str, Any]) -> Any:
        response = await self.request_json(
            "get",
            "/api/v3/agent/",
            params=self.pick_defined(
                {
                    "fields": self.resolve_string(params.get("fields"), DEFAULT_AGENT_FIELDS),
                    "permits": params.get("permits"),
                    "page": params.get("page"),
                    "size": params.get("size"),
                    "group_ids": self.resolve_group_ids_query(params.get("group_ids")),
                    "id": params.get("id"),
                    "ip": params.get("ip"),
                    "port": params.get("port"),
                    "status": params.get("status"),
                    "os": params.get("os"),
                    "platform": params.get("platform"),
                    "cur_version": params.get("cur_version"),
                    "expected_version": params.get("expected_version"),
                    "is_server_heka": self.normalize_boolean_query(params.get("is_server_heka")),
                    "proxy_ip": params.get("proxy_ip"),
                    "proxy_port": params.get("proxy_port"),
                    "domain_id": params.get("domain_id"),
                    "hostname": params.get("hostname"),
                    "comment": params.get("comment"),
                    "cmd": params.get("cmd"),
                    "cmd_timestamp": params.get("cmd_timestamp"),
                    "create_timestamp": params.get("create_timestamp"),
                    "last_update_timestamp": params.get("last_update_timestamp"),
                    "sort": params.get("sort"),
                }
            ),
        )
        if response.error:
            return self.api_response_to_error(response)
        if self.is_upstream_business_error(response.data):
            return self.build_error("UPSTREAM_BUSINESS_ERROR", "list_agents 上游接口返回失败。", "请检查 Agent 列表查询参数后重试。", response.data)
        return {"raw_data": response.data, "data": self.format_agent_list_response(response.data)}

    async def list_agent_groups(self, params: dict[str, Any]) -> Any:
        assignable_only = self.resolve_boolean_flag(params.get("assignable_only"))
        if assignable_only:
            response = await self.request_json("get", "/api/v3/agentgroup/assign/")
        else:
            response = await self.request_json(
                "get",
                "/api/v3/agentgroup/",
                params=self.pick_defined(
                    {
                        "fields": self.resolve_string(params.get("fields"), DEFAULT_AGENT_GROUP_FIELDS),
                        "permits": params.get("permits"),
                        "page": params.get("page"),
                        "size": params.get("size"),
                        "custom_collection": params.get("custom_collection"),
                        "id": params.get("id"),
                        "domain_id": params.get("domain_id"),
                        "name": params.get("name"),
                        "memo": params.get("memo"),
                        "creator_id": params.get("creator_id"),
                        "from_app": params.get("from_app"),
                        "rt_ids": params.get("rt_ids"),
                        "sort": params.get("sort"),
                    }
                ),
            )
        if response.error:
            return self.api_response_to_error(response)
        if self.is_upstream_business_error(response.data):
            return self.build_error("UPSTREAM_BUSINESS_ERROR", "list_agent_groups 上游接口返回失败。", "请检查 Agent 分组查询参数后重试。", response.data)
        return {"raw_data": response.data, "data": self.format_agent_group_list_response(response.data, assignable_only)}

    async def get_agent_group_detail(self, params: dict[str, Any]) -> Any:
        id_result = self.require_id(params.get("id"), "get_agent_group_detail 需要 id。")
        if id_result.get("error"):
            return id_result["error"]
        response = await self.request_json("get", f"/api/v3/agentgroup/{id_result['value']}/", params=self.pick_defined({"fields": params.get("fields"), "permit": params.get("permit")}))
        if response.error:
            return self.api_response_to_error(response)
        if self.is_upstream_business_error(response.data):
            return self.build_error("UPSTREAM_BUSINESS_ERROR", "get_agent_group_detail 上游接口返回失败。", "请确认 Agent 分组 id 是否存在。", response.data)
        return {"raw_data": response.data, "data": self.format_agent_group_detail_response(response.data)}

    async def create_agent_group(self, params: dict[str, Any]) -> Any:
        group = self.parse_object_input(params.get("group"), "group", "create_agent_group")
        if group.get("error"):
            return group["error"]
        normalized_group = self.pick_defined({"name": group["value"].get("name"), "memo": group["value"].get("memo"), "rt_names": group["value"].get("rt_names"), "roles": group["value"].get("roles")})
        if self.is_missing_required_value(normalized_group.get("name")):
            return self.build_error("MISSING_REQUIRED_PARAM", "create_agent_group 缺少 group.name。", "请在 group 中提供分组名称。")
        if not isinstance(normalized_group.get("roles"), list) or not normalized_group["roles"]:
            return self.build_error("MISSING_REQUIRED_PARAM", "create_agent_group 缺少 group.roles。", "请在 group.roles 中至少提供 1 个角色 id。")
        response = await self.request_json("post", "/api/v3/agentgroup/", data=normalized_group)
        return self.format_mutation_response(response, "create_agent_group 上游接口返回失败。", "请检查 group.name 和 group.roles 是否完整。", lambda data: self.format_agent_group_mutation_response(data, "create", normalized_group.get("name")))

    async def update_agent_group(self, params: dict[str, Any]) -> Any:
        id_result = self.require_id(params.get("id"), "update_agent_group 需要 id。")
        if id_result.get("error"):
            return id_result["error"]
        changes = self.parse_object_input(params.get("changes"), "changes", "update_agent_group")
        if changes.get("error"):
            return changes["error"]
        normalized_changes = self.pick_defined({"name": changes["value"].get("name"), "memo": changes["value"].get("memo"), "rt_names": changes["value"].get("rt_names"), "roles": changes["value"].get("roles")})
        if not normalized_changes:
            return self.build_error("EMPTY_MUTATION_BODY", "update_agent_group 的 changes 不能为空对象。", "请至少提供一个可更新字段，例如 name、memo、rt_names、roles。")
        response = await self.request_json("put", f"/api/v3/agentgroup/{id_result['value']}/", data=normalized_changes)
        return self.format_mutation_response(response, "update_agent_group 上游接口返回失败。", "请检查 id 和 changes 字段后重试。", lambda data: self.format_agent_group_mutation_response(data, "update", normalized_changes.get("name"), id_result["value"]))

    async def delete_agent_group(self, params: dict[str, Any]) -> Any:
        id_result = self.require_id(params.get("id"), "delete_agent_group 需要 id。")
        if id_result.get("error"):
            return id_result["error"]
        response = await self.request_json("delete", f"/api/v3/agentgroup/{id_result['value']}/")
        return self.format_mutation_response(response, "delete_agent_group 上游接口返回失败。", "请确认 Agent 分组 id 是否正确。", lambda data: self.format_simple_mutation_result(data, "delete_agent_group", "delete", id_result["value"]))

    async def add_agents_to_group(self, params: dict[str, Any]) -> Any:
        id_result = self.require_id(params.get("id"), "add_agents_to_group 需要 id。")
        if id_result.get("error"):
            return id_result["error"]
        group_id = id_result["value"]
        target_agents = self.normalize_target_agents_for_add(params.get("target_agents"), group_id)
        if target_agents.get("error"):
            return target_agents["error"]
        response = await self.request_json("post", f"/api/v3/agentgroup/{group_id}/add_member/", data={"target_agents": target_agents["value"]})
        return self.format_mutation_response(response, "add_agents_to_group 上游接口返回失败。", "请确认目标分组 id 和 target_agents 是否正确。", lambda data: self.format_group_membership_response(data, "add", group_id, target_agents["value"]))

    async def remove_agents_from_group(self, params: dict[str, Any]) -> Any:
        id_result = self.require_id(params.get("id"), "remove_agents_from_group 需要 id。")
        if id_result.get("error"):
            return id_result["error"]
        group_id = id_result["value"]
        target_agents = self.normalize_target_agents_for_remove(params.get("target_agents"))
        if target_agents.get("error"):
            return target_agents["error"]
        response = await self.request_json("post", f"/api/v3/agentgroup/{group_id}/remove_member/", data={"target_agents": target_agents["value"]})
        return self.format_mutation_response(response, "remove_agents_from_group 上游接口返回失败。", "请确认目标分组 id 和 target_agents 是否正确。", lambda data: self.format_group_removal_response(data, group_id, target_agents["value"]))

    async def list_pipeline_schemas(self, params: dict[str, Any]) -> Any:
        kind = self.require_non_empty_string(params.get("kind"), "list_pipeline_schemas 需要 kind。", "请传入 kind，例如 InstanceConfiguration、PluginType、ReferenceResource。")
        if kind.get("error"):
            return kind["error"]
        platform = self.require_non_empty_string(params.get("platform"), "list_pipeline_schemas 需要 platform。", "请传入目标平台，例如 linux-x64。")
        if platform.get("error"):
            return platform["error"]
        response = await self.request_json("get", "/api/v3/pipelineconfig/schemas/", params={"kind": kind["value"], "platform": platform["value"]})
        if response.error:
            return self.api_response_to_error(response)
        if self.is_upstream_business_error(response.data):
            return self.build_error("UPSTREAM_BUSINESS_ERROR", "list_pipeline_schemas 上游接口返回失败。", "请检查 kind 和 platform 是否匹配。", response.data)
        return {"raw_data": response.data, "data": self.format_pipeline_schemas_response(response.data, kind["value"], platform["value"])}

    async def list_pipelines(self, params: dict[str, Any]) -> Any:
        response = await self.request_json("get", "/api/v3/pipelineconfig/pipelines/", params=self.pick_defined({"page": params.get("page"), "size": params.get("size"), "filter": params.get("filter"), "sort": params.get("sort"), "order": params.get("order")}))
        if response.error:
            return self.api_response_to_error(response)
        if self.is_upstream_business_error(response.data):
            return self.build_error("UPSTREAM_BUSINESS_ERROR", "list_pipelines 上游接口返回失败。", "请检查 pipeline 查询参数后重试。", response.data)
        return {"raw_data": response.data, "data": self.format_pipeline_list_response(response.data)}

    async def get_pipeline_detail(self, params: dict[str, Any]) -> Any:
        id_result = self.require_id(params.get("id"), "get_pipeline_detail 需要 id。")
        if id_result.get("error"):
            return id_result["error"]
        response = await self.request_json("get", f"/api/v3/pipelineconfig/pipelines/{id_result['value']}/")
        if response.error:
            return self.api_response_to_error(response)
        if self.is_upstream_business_error(response.data):
            return self.build_error("UPSTREAM_BUSINESS_ERROR", "get_pipeline_detail 上游接口返回失败。", "请确认 pipeline id 是否存在。", response.data)
        return {"raw_data": response.data, "data": self.format_pipeline_detail_response(response.data)}

    async def create_pipeline(self, params: dict[str, Any]) -> Any:
        pipeline = self.parse_object_input(params.get("pipeline"), "pipeline", "create_pipeline")
        if pipeline.get("error"):
            return pipeline["error"]
        normalized_pipeline = self.normalize_pipeline_mutation_body(pipeline["value"], "create_pipeline")
        if normalized_pipeline.get("error"):
            return normalized_pipeline["error"]
        if self.is_missing_required_value(normalized_pipeline["value"].get("name")):
            return self.build_error("MISSING_REQUIRED_PARAM", "create_pipeline 缺少 pipeline.name。", "请在 pipeline 中提供数据流名称。")
        if self.is_missing_required_value(normalized_pipeline["value"].get("platform")):
            return self.build_error("MISSING_REQUIRED_PARAM", "create_pipeline 缺少 pipeline.platform。", "请在 pipeline 中提供目标平台。")
        response = await self.request_json("post", "/api/v3/pipelineconfig/pipelines/", data=normalized_pipeline["value"])
        return self.format_mutation_response(response, "create_pipeline 上游接口返回失败。", "请检查 pipeline.name、pipeline.platform 和 pipeline.detail。", lambda data: self.format_pipeline_mutation_response(data, "create", normalized_pipeline["value"]))

    async def update_pipeline(self, params: dict[str, Any]) -> Any:
        id_result = self.require_id(params.get("id"), "update_pipeline 需要 id。")
        if id_result.get("error"):
            return id_result["error"]
        changes = self.parse_object_input(params.get("changes"), "changes", "update_pipeline")
        if changes.get("error"):
            return changes["error"]
        normalized_changes = self.normalize_pipeline_mutation_body(changes["value"], "update_pipeline")
        if normalized_changes.get("error"):
            return normalized_changes["error"]
        if not normalized_changes["value"]:
            return self.build_error("EMPTY_MUTATION_BODY", "update_pipeline 的 changes 不能为空对象。", "请至少提供一个可更新字段，例如 name、platform、memo、detail。")
        response = await self.request_json("put", f"/api/v3/pipelineconfig/pipelines/{id_result['value']}/", data=normalized_changes["value"])
        return self.format_mutation_response(response, "update_pipeline 上游接口返回失败。", "请检查 pipeline id 和 changes 字段后重试。", lambda data: self.format_pipeline_mutation_response(data, "update", normalized_changes["value"], id_result["value"]))

    async def delete_pipeline(self, params: dict[str, Any]) -> Any:
        id_result = self.require_id(params.get("id"), "delete_pipeline 需要 id。")
        if id_result.get("error"):
            return id_result["error"]
        response = await self.request_json("delete", f"/api/v3/pipelineconfig/pipelines/{id_result['value']}/")
        return self.format_mutation_response(response, "delete_pipeline 上游接口返回失败。", "请确认 pipeline id 是否正确。", lambda data: self.format_simple_mutation_result(data, "delete_pipeline", "delete", id_result["value"]))

    async def get_pipeline_groups(self, params: dict[str, Any]) -> Any:
        id_result = self.require_id(params.get("id"), "get_pipeline_groups 需要 id。")
        if id_result.get("error"):
            return id_result["error"]
        response = await self.request_json("get", f"/api/v3/pipelineconfig/pipelines/{id_result['value']}/groups/", params=self.pick_defined({"page": params.get("page"), "size": params.get("size")}))
        if response.error:
            return self.api_response_to_error(response)
        if self.is_upstream_business_error(response.data):
            return self.build_error("UPSTREAM_BUSINESS_ERROR", "get_pipeline_groups 上游接口返回失败。", "请确认 pipeline id 是否正确。", response.data)
        return {"raw_data": response.data, "data": self.format_pipeline_groups_response(response.data, id_result["value"])}

    async def add_pipeline_groups(self, params: dict[str, Any]) -> Any:
        id_result = self.require_id(params.get("id"), "add_pipeline_groups 需要 id。")
        if id_result.get("error"):
            return id_result["error"]
        group_ids = self.normalize_group_ids(params.get("group_ids"), "add_pipeline_groups")
        if group_ids.get("error"):
            return group_ids["error"]
        response = await self.request_json("post", f"/api/v3/pipelineconfig/pipelines/{id_result['value']}/groups/", data={"group_ids": group_ids["value"]})
        return self.format_mutation_response(response, "add_pipeline_groups 上游接口返回失败。", "请确认 pipeline id 和 group_ids 是否正确。", lambda data: self.format_pipeline_group_mutation_response(data, "add", id_result["value"], group_ids["value"]))

    async def replace_pipeline_groups(self, params: dict[str, Any]) -> Any:
        id_result = self.require_id(params.get("id"), "replace_pipeline_groups 需要 id。")
        if id_result.get("error"):
            return id_result["error"]
        group_ids = self.normalize_group_ids(params.get("group_ids"), "replace_pipeline_groups")
        if group_ids.get("error"):
            return group_ids["error"]
        response = await self.request_json("put", f"/api/v3/pipelineconfig/pipelines/{id_result['value']}/groups/", data={"group_ids": group_ids["value"]})
        return self.format_mutation_response(response, "replace_pipeline_groups 上游接口返回失败。", "请确认 pipeline id 和 group_ids 是否正确。", lambda data: self.format_pipeline_group_mutation_response(data, "replace", id_result["value"], group_ids["value"]))

    async def delete_pipeline_groups(self, params: dict[str, Any]) -> Any:
        id_result = self.require_id(params.get("id"), "delete_pipeline_groups 需要 id。")
        if id_result.get("error"):
            return id_result["error"]
        response = await self.request_json("delete", f"/api/v3/pipelineconfig/pipelines/{id_result['value']}/groups/")
        return self.format_mutation_response(response, "delete_pipeline_groups 上游接口返回失败。", "请确认 pipeline id 是否正确。", lambda data: self.format_simple_mutation_result(data, "delete_pipeline_groups", "delete_groups", id_result["value"]))

    async def get_pipeline_agent_status(self, params: dict[str, Any]) -> Any:
        id_result = self.require_id(params.get("id"), "get_pipeline_agent_status 需要 id。")
        if id_result.get("error"):
            return id_result["error"]
        response = await self.request_json(
            "get",
            f"/api/v3/pipelineconfig/pipelines/{id_result['value']}/status/",
            params=self.pick_defined(
                {
                    "page": params.get("page"),
                    "size": params.get("size"),
                    "filter": params.get("filter"),
                    "group_ids": self.resolve_group_ids_query(params.get("group_ids")),
                    "sort": params.get("sort"),
                    "order": params.get("order"),
                    "status": params.get("status"),
                }
            ),
        )
        if response.error:
            return self.api_response_to_error(response)
        if self.is_upstream_business_error(response.data):
            return self.build_error("UPSTREAM_BUSINESS_ERROR", "get_pipeline_agent_status 上游接口返回失败。", "请确认 pipeline id 是否正确，或缩小筛选范围后重试。", response.data)
        return {"raw_data": response.data, "data": self.format_pipeline_agent_status_response(response.data, id_result["value"])}

    async def list_available_pipeline_agents(self, params: dict[str, Any]) -> Any:
        platform = self.require_non_empty_string(params.get("platform"), "list_available_pipeline_agents 需要 platform。", "请传入目标平台，例如 linux-x64。")
        if platform.get("error"):
            return platform["error"]
        response = await self.request_json(
            "get",
            "/api/v3/pipelineconfig/agents/",
            params=self.pick_defined(
                {
                    "page": params.get("page"),
                    "size": params.get("size"),
                    "filter": params.get("filter"),
                    "group_ids": self.resolve_group_ids_query(params.get("group_ids")),
                    "sort": params.get("sort"),
                    "order": params.get("order"),
                    "platform": platform["value"],
                    "exclude_instance": params.get("exclude_instance"),
                }
            ),
        )
        if response.error:
            return self.api_response_to_error(response)
        if self.is_upstream_business_error(response.data):
            return self.build_error("UPSTREAM_BUSINESS_ERROR", "list_available_pipeline_agents 上游接口返回失败。", "请检查 platform 是否正确。", response.data)
        return {"raw_data": response.data, "data": self.format_available_pipeline_agents_response(response.data, platform["value"])}

    async def list_available_pipeline_agent_groups(self, params: dict[str, Any]) -> Any:
        response = await self.request_json("get", "/api/v3/pipelineconfig/agentgroups/", params=self.pick_defined({"permit": params.get("permit")}))
        if response.error:
            return self.api_response_to_error(response)
        if self.is_upstream_business_error(response.data):
            return self.build_error("UPSTREAM_BUSINESS_ERROR", "list_available_pipeline_agent_groups 上游接口返回失败。", "请稍后重试，或确认当前账号具备访问分组的权限。", response.data)
        return {"raw_data": response.data, "data": self.format_available_pipeline_agent_groups_response(response.data)}

    def format_mutation_response(self, response: ApiResponse[Any], upstream_error_message: str, suggestion: str, formatter: Any) -> Any:
        if response.error:
            return self.api_response_to_error(response)
        if self.is_upstream_business_error(response.data):
            return self.build_error("UPSTREAM_BUSINESS_ERROR", upstream_error_message, suggestion, response.data)
        return {"raw_data": response.data, "data": formatter(response.data)}

    def format_agent_list_response(self, data: Any) -> dict[str, Any]:
        meta = self.extract_meta(data)
        items = [
            {
                "id": item.get("id"),
                "ip": item.get("ip"),
                "port": item.get("port"),
                "hostname": item.get("hostname"),
                "platform": item.get("platform"),
                "os": item.get("os"),
                "status": item.get("status"),
                "group_ids": item.get("group_ids"),
                "cur_version": item.get("cur_version"),
                "expected_version": item.get("expected_version"),
                "last_update_timestamp": item.get("last_update_timestamp"),
            }
            for item in self.ensure_array(data.get("objects") if isinstance(data, dict) else None)
            if self.is_plain_object(item)
        ]
        return {"traceid": data.get("traceid") if isinstance(data, dict) else None, "upstream_result": data.get("result") if isinstance(data, dict) else None, "summary": {"total": meta.get("total", len(items)), "returned": meta.get("count", len(items)), "page": meta.get("page"), "size": meta.get("size")}, "items": items, "meta": meta}

    def format_agent_group_list_response(self, data: Any, assignable_only: bool = False) -> dict[str, Any]:
        meta = self.extract_meta(data)
        items = []
        for item in self.ensure_array(data.get("objects") if isinstance(data, dict) else None):
            if not self.is_plain_object(item):
                continue
            base = {"id": item.get("id"), "name": item.get("name"), "memo": item.get("memo"), "creator_id": item.get("creator_id"), "from_app": item.get("from_app")}
            if assignable_only:
                items.append({**base, "resource_ids": self.ensure_array(item.get("resource_ids")), "extra": item.get("extra")})
            else:
                items.append({**base, "rt_list": self.ensure_array(item.get("rt_list")), "is_collected": item.get("is_collected")})
        return {"traceid": data.get("traceid") if isinstance(data, dict) else None, "upstream_result": data.get("result") if isinstance(data, dict) else None, "summary": {"total": meta.get("total", len(items)), "returned": meta.get("count", len(items)), "assignable_only": assignable_only}, "items": items, "meta": meta}

    def format_agent_group_detail_response(self, data: Any) -> dict[str, Any]:
        detail = data.get("object") if isinstance(data, dict) else None
        return {"traceid": data.get("traceid") if isinstance(data, dict) else None, "upstream_result": data.get("result") if isinstance(data, dict) else None, "summary": {"id": detail.get("id") if self.is_plain_object(detail) else None, "name": detail.get("name") if self.is_plain_object(detail) else None, "memo": detail.get("memo") if self.is_plain_object(detail) else None}, "detail": detail}

    def format_agent_group_mutation_response(self, data: Any, action: str, name: Any = None, id_value: str | None = None) -> dict[str, Any]:
        obj = data.get("object") if isinstance(data, dict) else None
        return {"action": action, "target_id": obj.get("id") if self.is_plain_object(obj) else id_value, "target_name": obj.get("name") if self.is_plain_object(obj) else name, "upstream_result": data.get("result") if isinstance(data, dict) else None, "object": obj}

    def format_group_membership_response(self, data: Any, action: str, group_id: str, target_agents: list[dict[str, Any]]) -> dict[str, Any]:
        objects = self.ensure_array(data.get("objects") if isinstance(data, dict) else None)
        return {"action": action, "group_id": group_id, "requested_agent_count": len(target_agents), "affected_count": len(objects), "upstream_result": data.get("result") if isinstance(data, dict) else None, "objects": objects}

    def format_group_removal_response(self, data: Any, group_id: str, target_agents: str) -> dict[str, Any]:
        objects = self.ensure_array(data.get("objects") if isinstance(data, dict) else None)
        return {"action": "remove", "group_id": group_id, "target_agents": target_agents, "affected_count": len(objects), "upstream_result": data.get("result") if isinstance(data, dict) else None, "objects": objects}

    def format_pipeline_schemas_response(self, data: Any, kind: str, platform: str) -> dict[str, Any]:
        types = self.ensure_array(data.get("data", {}).get("types") if isinstance(data, dict) and self.is_plain_object(data.get("data")) else None)
        return {"traceid": data.get("traceid") if isinstance(data, dict) else None, "upstream_result": data.get("result") if isinstance(data, dict) else None, "summary": {"kind": kind, "platform": platform, "schema_count": len(types)}, "items": types}

    def format_pipeline_list_response(self, data: Any) -> dict[str, Any]:
        payload = data.get("data") if isinstance(data, dict) and self.is_plain_object(data.get("data")) else {}
        items = self.ensure_array(payload.get("Configurations"))
        return {"traceid": data.get("traceid") if isinstance(data, dict) else None, "upstream_result": data.get("result") if isinstance(data, dict) else None, "summary": {"total": payload.get("Total", len(items)), "returned": len(items)}, "items": items}

    def format_pipeline_detail_response(self, data: Any) -> dict[str, Any]:
        detail = data.get("data") if isinstance(data, dict) else None
        return {"traceid": data.get("traceid") if isinstance(data, dict) else None, "upstream_result": data.get("result") if isinstance(data, dict) else None, "summary": {"id": detail.get("id") if self.is_plain_object(detail) else None, "uuid": detail.get("uuid") if self.is_plain_object(detail) else None, "name": detail.get("name") if self.is_plain_object(detail) else None, "platform": detail.get("platform") if self.is_plain_object(detail) else None}, "detail": detail}

    def format_pipeline_mutation_response(self, data: Any, action: str, payload: dict[str, Any] | None = None, id_value: str | None = None) -> dict[str, Any]:
        nested_data = data.get("data") if isinstance(data, dict) else None
        return {"action": action, "target_id": nested_data.get("id") if self.is_plain_object(nested_data) else id_value, "target_uuid": nested_data.get("uuid") if self.is_plain_object(nested_data) else None, "target_name": payload.get("name") if self.is_plain_object(payload) else None, "upstream_result": data.get("result") if isinstance(data, dict) else None, "data": nested_data}

    def format_pipeline_groups_response(self, data: Any, pipeline_id: str) -> dict[str, Any]:
        nested_data = data.get("data") if isinstance(data, dict) and self.is_plain_object(data.get("data")) else {}
        groups = self.ensure_array(nested_data.get("groups"))
        return {"traceid": data.get("traceid") if isinstance(data, dict) else None, "upstream_result": data.get("result") if isinstance(data, dict) else None, "summary": {"pipeline_id": pipeline_id, "total": nested_data.get("total", len(groups)), "returned": len(groups)}, "items": groups}

    def format_pipeline_group_mutation_response(self, data: Any, action: str, pipeline_id: str, group_ids: list[Any]) -> dict[str, Any]:
        return {"action": action, "pipeline_id": pipeline_id, "group_ids": group_ids, "upstream_result": data.get("result") if isinstance(data, dict) else None, "data": data.get("data") if isinstance(data, dict) else None}

    def format_pipeline_agent_status_response(self, data: Any, pipeline_id: str) -> dict[str, Any]:
        nested_data = data.get("data") if isinstance(data, dict) and self.is_plain_object(data.get("data")) else {}
        sync_status = self.ensure_array(nested_data.get("sync_status"))
        return {"traceid": data.get("traceid") if isinstance(data, dict) else None, "upstream_result": data.get("result") if isinstance(data, dict) else None, "summary": {"pipeline_id": pipeline_id, "total": nested_data.get("total", len(sync_status)), "returned": len(sync_status)}, "items": sync_status}

    def format_available_pipeline_agents_response(self, data: Any, platform: str) -> dict[str, Any]:
        nested_data = data.get("data") if isinstance(data, dict) and self.is_plain_object(data.get("data")) else {}
        agents = self.ensure_array(nested_data.get("agents"))
        return {"traceid": data.get("traceid") if isinstance(data, dict) else None, "upstream_result": data.get("result") if isinstance(data, dict) else None, "summary": {"platform": platform, "total": nested_data.get("total", len(agents)), "returned": len(agents)}, "items": agents}

    def format_available_pipeline_agent_groups_response(self, data: Any) -> dict[str, Any]:
        nested_data = data.get("data") if isinstance(data, dict) and self.is_plain_object(data.get("data")) else {}
        groups = self.ensure_array(nested_data.get("groups"))
        return {"traceid": data.get("traceid") if isinstance(data, dict) else None, "upstream_result": data.get("result") if isinstance(data, dict) else None, "summary": {"total": len(groups)}, "items": groups}

    def format_simple_mutation_result(self, data: Any, tool_name: str, action: str, id_value: str) -> dict[str, Any]:
        return {"tool": tool_name, "action": action, "target_id": id_value, "upstream_result": data.get("result") if isinstance(data, dict) else None, "data": data.get("data") if isinstance(data, dict) else data.get("object") if isinstance(data, dict) else None}

    def normalize_pipeline_mutation_body(self, payload: dict[str, Any], tool_name: str) -> dict[str, Any]:
        normalized = self.pick_defined({"name": payload.get("name"), "platform": payload.get("platform"), "memo": payload.get("memo"), "detail": payload.get("detail")})
        if "detail" in normalized:
            detail = self.normalize_json_like_field(normalized["detail"], f"{tool_name}.detail")
            if detail.get("error"):
                return {"error": detail["error"]}
            normalized["detail"] = detail["value"]
        return {"value": normalized}

    def normalize_json_like_field(self, raw_value: Any, field_path: str) -> dict[str, Any]:
        if isinstance(raw_value, str):
            trimmed = raw_value.strip()
            if not trimmed:
                return {"error": self.build_error("INVALID_JSON_STRING", f"{field_path} 不能为空字符串。", f"请确保 {field_path} 是合法 JSON 字符串，或直接传对象。")}
            try:
                json.loads(trimmed)
            except json.JSONDecodeError as exc:
                return {"error": self.build_error("INVALID_JSON_STRING", f"{field_path} 不是合法 JSON 字符串。", f"请检查 {field_path} 的 JSON 语法，例如引号、逗号、括号是否完整。", {"field": field_path, "parse_error": str(exc), "preview": trimmed[:300]})}
            return {"value": trimmed}
        if isinstance(raw_value, (dict, list)):
            return {"value": json.dumps(raw_value, ensure_ascii=False)}
        return {"error": self.build_error("INVALID_PARAM_TYPE", f"{field_path} 必须是对象、数组或合法 JSON 字符串。", f"请把 {field_path} 传成对象/数组，或传入合法 JSON 字符串。")}

    def normalize_target_agents_for_add(self, raw_value: Any, group_id: str) -> dict[str, Any]:
        parsed = self.parse_array_like(raw_value)
        if parsed.get("error"):
            return {"error": parsed["error"]}
        normalized = []
        for item in parsed["value"]:
            if isinstance(item, (int, float, str)):
                try:
                    item_id = int(item)
                except (TypeError, ValueError):
                    continue
                normalized.append({"id": item_id, "group_ids": group_id})
                continue
            if self.is_plain_object(item):
                item_id = item.get("id")
                try:
                    parsed_id = int(item_id)
                except (TypeError, ValueError):
                    continue
                normalized.append(self.pick_defined({"id": parsed_id, "group_ids": self.resolve_string(item.get("group_ids"), group_id)}))
        if not normalized:
            return {"error": self.build_error("MISSING_REQUIRED_PARAM", "add_agents_to_group 需要 target_agents。", "请传入 Agent id 数组，或传入包含 id 的对象数组。")}
        return {"value": normalized}

    def normalize_target_agents_for_remove(self, raw_value: Any) -> dict[str, Any]:
        if isinstance(raw_value, str) and raw_value.strip():
            return {"value": raw_value.strip()}
        parsed = self.parse_array_like(raw_value)
        if parsed.get("error"):
            return {"error": parsed["error"]}
        ids = []
        for item in parsed["value"]:
            if isinstance(item, (int, float, str)):
                candidate = str(item).strip()
            elif self.is_plain_object(item) and item.get("id") is not None:
                candidate = str(item.get("id")).strip()
            else:
                candidate = ""
            if candidate:
                ids.append(candidate)
        if not ids:
            return {"error": self.build_error("MISSING_REQUIRED_PARAM", "remove_agents_from_group 需要 target_agents。", "请传入 Agent id 的逗号分隔字符串，或传入 Agent id 数组。")}
        return {"value": ",".join(ids)}

    def normalize_group_ids(self, raw_value: Any, tool_name: str) -> dict[str, Any]:
        parsed = self.parse_array_like(raw_value)
        if parsed.get("error"):
            return parsed
        if not parsed["value"]:
            return {"error": self.build_error("MISSING_REQUIRED_PARAM", f"{tool_name} 需要 group_ids。", "请传入分组 id 数组。")}
        return {"value": parsed["value"]}

    def resolve_group_ids_query(self, raw_value: Any) -> str:
        return raw_value.strip() if isinstance(raw_value, str) and raw_value.strip() else "all"

    def resolve_boolean_flag(self, raw_value: Any) -> bool:
        if isinstance(raw_value, bool):
            return raw_value
        if isinstance(raw_value, str):
            return raw_value.strip().lower() in {"true", "1", "yes"}
        return False

    def extract_meta(self, data: Any) -> dict[str, Any]:
        return data.get("meta") if isinstance(data, dict) and self.is_plain_object(data.get("meta")) else {}

    def normalize_boolean_query(self, raw_value: Any) -> Any:
        if isinstance(raw_value, bool):
            return raw_value
        if isinstance(raw_value, str) and raw_value.strip():
            return raw_value
        return None

    def resolve_string(self, value: Any, fallback: str | None = None) -> str | None:
        return value.strip() if isinstance(value, str) and value.strip() else fallback

    def api_response_to_error(self, response: ApiResponse[Any]) -> dict[str, Any]:
        return self.build_error(
            response.error_code or "UPSTREAM_REQUEST_FAILED",
            response.message or response.error or "上游请求失败。",
            response.suggestion or "请检查上游地址、认证信息和请求参数。",
            response.details,
        )


def create_ingest_server(runtime_config: RuntimeConfig, service_state: ServiceRuntimeState):
    service = IngestService()
    runtime = ServiceToolRuntime(
        route_name="ingest",
        title="采集配置服务",
        default_error_code="INGEST_EXECUTION_ERROR",
        default_error_suggestion="请检查 ingest 参数结构后重试。",
    )
    return create_tool_server(
        route_name="ingest",
        server_name="rizhiyi_ingest",
        title="采集配置服务",
        description="采集配置服务完整能力。",
        instructions=SERVER_LEVEL_INSTRUCTIONS,
        runtime_config=runtime_config,
        service_state=service_state,
        tool_definitions=INGEST_TOOLS,
        tool_handlers={
            "list_agents": lambda arguments: runtime.execute(tool_name="list_agents", arguments=arguments, executor=service.list_agents),
            "list_agent_groups": lambda arguments: runtime.execute(tool_name="list_agent_groups", arguments=arguments, executor=service.list_agent_groups),
            "get_agent_group_detail": lambda arguments: runtime.execute(tool_name="get_agent_group_detail", arguments=arguments, executor=service.get_agent_group_detail),
            "create_agent_group": lambda arguments: runtime.execute(tool_name="create_agent_group", arguments=arguments, executor=service.create_agent_group),
            "update_agent_group": lambda arguments: runtime.execute(tool_name="update_agent_group", arguments=arguments, executor=service.update_agent_group),
            "delete_agent_group": lambda arguments: runtime.execute(tool_name="delete_agent_group", arguments=arguments, executor=service.delete_agent_group),
            "add_agents_to_group": lambda arguments: runtime.execute(tool_name="add_agents_to_group", arguments=arguments, executor=service.add_agents_to_group),
            "remove_agents_from_group": lambda arguments: runtime.execute(tool_name="remove_agents_from_group", arguments=arguments, executor=service.remove_agents_from_group),
            "list_pipeline_schemas": lambda arguments: runtime.execute(tool_name="list_pipeline_schemas", arguments=arguments, executor=service.list_pipeline_schemas),
            "list_pipelines": lambda arguments: runtime.execute(tool_name="list_pipelines", arguments=arguments, executor=service.list_pipelines),
            "get_pipeline_detail": lambda arguments: runtime.execute(tool_name="get_pipeline_detail", arguments=arguments, executor=service.get_pipeline_detail),
            "create_pipeline": lambda arguments: runtime.execute(tool_name="create_pipeline", arguments=arguments, executor=service.create_pipeline),
            "update_pipeline": lambda arguments: runtime.execute(tool_name="update_pipeline", arguments=arguments, executor=service.update_pipeline),
            "delete_pipeline": lambda arguments: runtime.execute(tool_name="delete_pipeline", arguments=arguments, executor=service.delete_pipeline),
            "get_pipeline_groups": lambda arguments: runtime.execute(tool_name="get_pipeline_groups", arguments=arguments, executor=service.get_pipeline_groups),
            "add_pipeline_groups": lambda arguments: runtime.execute(tool_name="add_pipeline_groups", arguments=arguments, executor=service.add_pipeline_groups),
            "replace_pipeline_groups": lambda arguments: runtime.execute(tool_name="replace_pipeline_groups", arguments=arguments, executor=service.replace_pipeline_groups),
            "delete_pipeline_groups": lambda arguments: runtime.execute(tool_name="delete_pipeline_groups", arguments=arguments, executor=service.delete_pipeline_groups),
            "get_pipeline_agent_status": lambda arguments: runtime.execute(tool_name="get_pipeline_agent_status", arguments=arguments, executor=service.get_pipeline_agent_status),
            "list_available_pipeline_agents": lambda arguments: runtime.execute(tool_name="list_available_pipeline_agents", arguments=arguments, executor=service.list_available_pipeline_agents),
            "list_available_pipeline_agent_groups": lambda arguments: runtime.execute(tool_name="list_available_pipeline_agent_groups", arguments=arguments, executor=service.list_available_pipeline_agent_groups),
        },
    )
