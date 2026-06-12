from __future__ import annotations

import json
from typing import Any

from .config import RuntimeConfig
from .servers import ServiceRuntimeState, create_tool_server
from .service_tooling import BaseServiceModule, ServiceToolRuntime, with_output_controls
from .types import ToolDefinition

SERVER_LEVEL_INSTRUCTIONS = """使用说明:
1. 这是 parserrule 专用入口，只处理字段提取 / 解析规则，也就是 schema on write，不处理动态字段 fieldconfigs。
2. create/update 仍以“半结构化 body 透传”为主：请把完整规则主体放在 rule 或 changes 中，不要把字段平铺到顶层。
3. rule、changes、payload 支持对象，也兼容合法 JSON 字符串；conf、sink_conf 会在本地先校验是不是合法 JSON 字符串。
4. 推荐流程：先用 generate_parserrule_draft 基于样例日志生成初稿，再人工修正后调用 create/update，变更前后都建议调用 verify_parserrule 做样例日志验证。
5. list_parserrule_references 用于给后续语义化拼装提供模板，直接读取仓库内 docs/parserule.adoc 的整理结果，不依赖外部网络。
6. 输出默认使用 output_format=auto，以减少上下文消耗。
7. 遇到错误时，优先根据 suggestion 字段修正参数后重试一次。"""

PARSER_RULE_MUTATION_FIELDS = (
    "name",
    "conf",
    "logtype",
    "desc",
    "category_id",
    "enable",
    "from_app",
    "notice_frequency",
    "sink_conf",
    "rt_names",
    "assign_data",
)
PARSER_RULE_CREATE_REQUIRED_FIELDS = ("name", "conf", "logtype", "desc", "category_id", "enable")
VERIFY_SAMPLE_TEXT_KEYS = ("raw_message", "rawMessage", "message", "log", "content")
DEFAULT_PARSER_RULE_LIST_FIELDS = ",".join(
    ("id", "name", "logtype", "desc", "enable", "from_app", "last_modified_time")
)
PARSER_RULE_DOC_SOURCE = "docs/parserule.adoc"

PARSER_RULE_REFERENCES: list[dict[str, Any]] = [
    {
        "type": "regex",
        "title": "正则解析",
        "aliases": ["正则解析", "正则", "regex"],
        "purpose": "从来源字段按正则整体提取字段，支持单行和多行模式。",
        "keyFields": ["source", "pattern", "multiline", "condition"],
        "minimalExample": {"source": "raw_message", "pattern": [["(?<test>.*)"]], "multiline": True},
        "notes": [
            "pattern 只有一个子列表时可视为单行，多个子列表时表示多行。",
            "文档示例中 multiline 为内部字段，固定值 true。",
        ],
    },
    {
        "type": "regex_extract",
        "title": "正则片段解析",
        "aliases": ["正则片段解析", "extract", "regex_extract"],
        "purpose": "从日志里抽取位置不固定的小片段字段，适合 IP、端口、用户名等局部信息。",
        "keyFields": ["source", "multiline", "rule_name", "extract[].regex", "extract[].fields"],
        "minimalExample": {
            "source": "raw_message",
            "multiline": False,
            "rule_name": "",
            "extract": [[{"source": None, "regex": "(.*)", "fields": {"a": "$1"}, "description": "test regex"}]],
        },
        "notes": [
            "该算子与正则解析共用入口，但依赖 extract 而不是 pattern。",
            "为了性能更好，文档建议正则里尽量带固定文本。",
        ],
    },
    {
        "type": "json",
        "title": "JSON解析",
        "aliases": ["JSON解析", "json"],
        "purpose": "把 JSON 字符串解析成字段，支持按 paths 选取子路径。",
        "keyFields": ["source", "paths", "flatten_short_array", "extract_limit"],
        "minimalExample": {
            "source": "raw_message",
            "paths": ["a.b.c"],
            "flatten_short_array": False,
            "extract_limit": 0,
        },
        "notes": ["flatten_short_array 是隐藏参数，用来控制单元素数组是否展开。", "extract_limit 为 0 表示不限制最大解析长度。"],
    },
    {
        "type": "xml",
        "title": "XML解析",
        "aliases": ["XML解析", "xml"],
        "purpose": "把 XML 字符串解析成字段，支持按 paths 选取子路径。",
        "keyFields": ["source", "paths", "flatten_short_array", "extract_limit"],
        "minimalExample": {
            "source": "raw_message",
            "paths": ["a.b.c"],
            "flatten_short_array": False,
            "extract_limit": 0,
        },
        "notes": ["和 JSON 解析一样，也支持 flatten_short_array 隐藏参数。", "extract_limit 为 0 表示不限制最大解析长度。"],
    },
    {
        "type": "url",
        "title": "URL解析",
        "aliases": ["URL解析", "url"],
        "purpose": "解析 URL 字段内容。",
        "keyFields": ["source"],
        "minimalExample": {"source": "request_url"},
        "notes": ["文档里只有 source 这个核心字段。", "所有算子都可以额外带 condition。"],
    },
    {
        "type": "user_agent",
        "title": "UserAgent解析",
        "aliases": ["UserAgent解析", "useragent", "ua", "user_agent"],
        "purpose": "解析 User-Agent 字段内容。",
        "keyFields": ["source"],
        "minimalExample": {"source": "request_user_agent"},
        "notes": ["文档里只有 source 这个核心字段。", "所有算子都可以额外带 condition。"],
    },
    {
        "type": "drop_fields",
        "title": "删除字段",
        "aliases": ["删除字段", "drop_fields", "delete_fields"],
        "purpose": "删除指定字段列表。",
        "keyFields": ["source"],
        "minimalExample": {"source": ["a"]},
        "notes": ["source 这里是字段名数组，不是单个字符串。", "所有算子都可以额外带 condition。"],
    },
    {
        "type": "geo",
        "title": "GEO解析",
        "aliases": ["GEO解析", "geo"],
        "purpose": "根据 IP 字段补充地理位置信息。",
        "keyFields": ["source", "target", "field"],
        "minimalExample": {"source": "request_ip", "target": "geo", "field": ["all"]},
        "notes": [
            "target 默认是 geo，但高级配置里可以改成任意字段名。",
            "field 可选值包括 all、city、province、country、isp、latitude、longitude、org。",
        ],
    },
    {
        "type": "mobile_phone",
        "title": "手机号码解析",
        "aliases": ["手机号码解析", "phone", "mobile_phone"],
        "purpose": "解析手机号并输出到目标字段。",
        "keyFields": ["source", "target"],
        "minimalExample": {"source": "phone", "target": "phone"},
        "notes": ["和 GEO 解析类似，也可以单独控制 target。", "target 默认值是 phone。"],
    },
    {
        "type": "telephone",
        "title": "固定电话解析",
        "aliases": ["固定电话解析", "telephone"],
        "purpose": "解析固定电话号码并输出到目标字段。",
        "keyFields": ["source", "target"],
        "minimalExample": {"source": "telephone", "target": "telephone"},
        "notes": ["和 GEO 解析类似，也可以单独控制 target。", "target 默认值是 telephone。"],
    },
    {
        "type": "kv",
        "title": "KeyValue分解",
        "aliases": ["KeyValue分解", "kv", "keyvalue"],
        "purpose": "按分隔符拆解 key=value 形式的字段。",
        "keyFields": [
            "source",
            "field_split",
            "value_split",
            "drop_key_prefix",
            "drop_key",
            "reserved_key",
            "duplicate_key_strategy",
        ],
        "minimalExample": {
            "source": "kv",
            "field_split": [","],
            "value_split": ["="],
            "drop_key_prefix": [],
            "drop_key": [],
            "reserved_key": [],
            "duplicate_key_strategy": "use_last",
        },
        "notes": ["duplicate_key_strategy 可选 use_first、use_last、merge_as_array。", "drop_key_prefix、drop_key、reserved_key 都是可选过滤项。"],
    },
    {
        "type": "kv_regex",
        "title": "KeyValue正则匹配",
        "aliases": ["KeyValue正则匹配", "kv_regex", "keyvalue_regex"],
        "purpose": "通过组合正则来匹配和提取 KV 结构，适合格式更复杂的 KV 文本。",
        "keyFields": [
            "source",
            "kv_match_group[].key_regex",
            "kv_match_group[].value_regex",
            "kv_match_group[].value_split",
            "kv_match_group[].group_regex",
            "find_first_only",
            "duplicate_key_strategy",
        ],
        "minimalExample": {
            "source": "kv",
            "kv_match_group": [{"key_regex": "\\w*", "value_regex": "\\d*", "value_split": ["="], "group_regex": ""}],
            "find_first_only": False,
            "reserve_all_values_for_one_key": True,
            "drop_key_prefix": [],
            "drop_key": [],
            "reserved_key": [],
            "duplicate_key_strategy": "use_last",
        },
        "notes": [
            "group_regex 是隐藏高级参数，需要有且只有一个分组，并覆盖 group 到首个 KV 之间的分隔。",
            "如果带 reserve_all_values_for_one_key，duplicate_key_strategy 不生效。",
        ],
    },
    {
        "type": "csv_split",
        "title": "CSV解析(字段值拆分)",
        "aliases": ["CSV解析", "字段值拆分", "csv", "csv_split"],
        "purpose": "按分隔符或 CSV 语义拆分字段值。",
        "keyFields": ["source", "split_string", "names", "split_option"],
        "minimalExample": {"source": "array", "split_string": ",", "names": ["field_1"], "split_option": None},
        "notes": ["names 为空时，结果会自动变成数组字段。", "split_option 为 null 时按正则分割；为 csv 时按 CSV 规则分割，split_string 只能是一个字符。"],
    },
    {
        "type": "numeric_cast",
        "title": "数值型字段转换",
        "aliases": ["数值型字段转换", "numeric", "numeric_cast"],
        "purpose": "把字段转换成 int 或 float。",
        "keyFields": ["source", "numeric_type", "radix"],
        "minimalExample": [{"source": "request_status", "numeric_type": "int", "radix": 10}],
        "notes": ["这个算子的高级配置本身是数组，每个元素对应一个字段转换规则。", "numeric_type 可选 int 或 float。"],
    },
    {
        "type": "custom_dictionary",
        "title": "自定义字典",
        "aliases": ["自定义字典", "dictionary", "custom_dictionary"],
        "purpose": "用已上传的字典做字段映射或扩展字段补全。",
        "keyFields": ["source", "id", "field", "match_type", "ext_fields"],
        "minimalExample": {"source": "error", "id": "1", "field": "error_code", "match_type": "exact", "ext_fields": ["code", "name"]},
        "notes": ["id 是已存字典的内部 id，文档明确提示要谨慎修改。", "match_type 为 cidr 时支持 IPv4 或 IPv6，但字典文件不能混用两种 IP 类型。"],
    },
    {
        "type": "timestamp",
        "title": "时间戳识别",
        "aliases": ["时间戳识别", "timestamp"],
        "purpose": "按时间格式列表识别并解析时间字段。",
        "keyFields": ["source", "prefix", "max_lookahead", "rule", "zone", "locale"],
        "minimalExample": {
            "source": "timestamp",
            "prefix": "",
            "max_lookahead": 80,
            "rule": ["yyyy-MM-dd HH:mm:ss", "UNIX"],
            "zone": "Asia/Shanghai",
            "locale": "en",
        },
        "notes": ["rule 是时间格式列表，不是单个字符串。", "zone 和 locale 用来控制时区与本地化。"],
    },
    {
        "type": "ip_convert",
        "title": "IP格式转换",
        "aliases": ["IP格式转换", "ip_convert", "long2ip"],
        "purpose": "把 IP 字段做格式转换。",
        "keyFields": ["source", "op_type"],
        "minimalExample": {"source": "ip", "op_type": "long2ip"},
        "notes": ["文档示例里 op_type 可选值是 long2ip。", "所有算子都可以额外带 condition。"],
    },
    {
        "type": "hex_decode",
        "title": "hex转换",
        "aliases": ["hex转换", "hex", "hex_decode"],
        "purpose": "按指定字节分隔符和编码把 hex 内容转换成字符串。",
        "keyFields": ["source", "split_string", "codec_type"],
        "minimalExample": {"source": "hex", "split_string": " ", "codec_type": "GBK"},
        "notes": ["codec_type 可填写常见编码，如 GBK、UTF-8。", "split_string 用来指定字节之间的分隔符。"],
    },
    {
        "type": "replace",
        "title": "内容替换",
        "aliases": ["内容替换", "replace"],
        "purpose": "对字段内容按正则做替换。",
        "keyFields": ["source", "target", "regex", "replacement", "replace_first"],
        "minimalExample": {"source": "a", "target": "a", "regex": "(\\w*)=(\\d*)", "replacement": "$1 $2", "replace_first": True},
        "notes": ["replacement 可以用 $n 引用正则分组。", "replace_first 为 false 时会尝试多次替换。"],
    },
    {
        "type": "anonymize",
        "title": "脱敏配置",
        "aliases": ["脱敏配置", "脱敏", "anonymize", "anonymity"],
        "purpose": "按正则替换字段内容，并可同步对原文做脱敏。",
        "keyFields": ["source", "regex", "replacement", "regex_prefix", "regex_suffix", "replace_first", "anonymity"],
        "minimalExample": {
            "source": "a",
            "regex": "(\\w*)=(\\d*)",
            "replacement": "$1 $2",
            "regex_prefix": "",
            "regex_suffix": "",
            "replace_first": True,
            "anonymity": True,
        },
        "notes": ["anonymity 必须为 true，用来和普通内容替换区分。", "regex_prefix 和 regex_suffix 用来定位原文中的脱敏范围。"],
    },
    {
        "type": "format",
        "title": "格式化处理",
        "aliases": ["格式化处理", "format", "printf"],
        "purpose": "把多个字段按模板拼成新的结果字段。",
        "keyFields": ["params", "target", "printf"],
        "minimalExample": {"params": ["a", "b"], "target": "c", "printf": "$1 $2"},
        "notes": ["printf 里可以用 $n 引用 params 中对应位置的字段。", "文档说明 printf 为空时，会做多个字段名合并。"],
    },
    {
        "type": "struct_decode",
        "title": "结构体解析",
        "aliases": ["结构体解析", "struct_decode"],
        "purpose": "按结构体格式定义解析定长或结构化二进制/文本字段。",
        "keyFields": ["source", "codec_type", "format", "charset", "strict_mode", "strip_field"],
        "minimalExample": {
            "source": "field",
            "codec_type": "struct_decode",
            "format": "a:1,b:2",
            "charset": "utf-8",
            "strict_mode": False,
            "strip_field": True,
        },
        "notes": ["codec_type 必填且固定为 struct_decode。", "strict_mode 为 true 时，字段长度和结构体定义不一致会直接失败。"],
    },
    {
        "type": "rename",
        "title": "重命名字段",
        "aliases": ["重命名字段", "rename"],
        "purpose": "把字段名重命名到新的 target 字段。",
        "keyFields": ["source", "target", "force"],
        "minimalExample": {"source": "a", "target": "b", "force": False},
        "notes": ["source 支持正则。", "force 控制目标字段已存在时是否强制覆盖。"],
    },
    {
        "type": "redirect",
        "title": "重定向",
        "aliases": ["重定向", "redirect"],
        "purpose": "跳转到指定字段提取规则继续处理。",
        "keyFields": ["rule_id"],
        "minimalExample": {"rule_id": ""},
        "notes": ["rule_id 是规则内部 id，文档明确提示要谨慎使用。", "所有算子都可以额外带 condition。"],
    },
    {
        "type": "dissect",
        "title": "dissect解析",
        "aliases": ["dissect解析", "dissect"],
        "purpose": "按固定分隔符格式高性能提取字段，适合字段顺序和分隔稳定的日志。",
        "keyFields": ["source", "format", "strict_mode", "enable_escape"],
        "minimalExample": {"source": "", "format": "%{field}", "strict_mode": False, "enable_escape": False},
        "notes": ["文档强调它对固定格式日志性能很高，Apache 访问日志场景下比正则高一个数量级。", "format 支持普通字段、类型字段、嵌套字段、KV 字段和空字段语法。"],
    },
    {
        "type": "unicode_decode",
        "title": "unicode解析",
        "aliases": ["unicode解析", "unicode", "unicode_decode"],
        "purpose": "把 Python 风格的 unicode 转义文本解码成正常字符串。",
        "keyFields": ["source", "codec_type"],
        "minimalExample": {"source": "", "codec_type": "unicode_decode"},
        "notes": ["codec_type 必填且固定为 unicode_decode。", "文档示例展示了 \\u5ba2\\u6237 这类内容被解码成人类可读文本。"],
    },
    {
        "type": "base64_decode",
        "title": "base64解析",
        "aliases": ["base64解析", "base64", "base64_decode"],
        "purpose": "对 base64 编码日志先做解码。",
        "keyFields": ["source", "codec_type"],
        "minimalExample": {"source": "raw_message", "codec_type": "base64decode"},
        "notes": ["文档里这类规则需要通过自定义规则名称 codec 来配置。", "codec_type 在示例里固定为 base64decode。"],
    },
    {
        "type": "metadata",
        "title": "metadata修改",
        "aliases": ["metadata修改", "metadata"],
        "purpose": "修改元数据字段或控制部分处理流程元数据。",
        "keyFields": ["source", "value"],
        "minimalExample": {"source": "@index", "value": "metricidx"},
        "notes": ["可修改 @source、@ip、@hostname、@tag、@appname、raw_message 等元数据。", "修改 @index 前，目标索引必须已经在索引配置里预定义。"],
    },
]

PARSER_RULE_TOOLS = with_output_controls(
    [
        ToolDefinition(
            name="list_parserrules",
            description="列出解析规则列表，支持按名称、logtype、应用、启用状态等条件过滤。默认只返回 id、name、logtype、desc、enable、from_app、last_modified_time，不带 conf；如需自定义返回列，可显式传 fields。",
            input_schema={
                "type": "object",
                "properties": {
                    "fields": {"type": "string", "description": "可选，指定返回字段列表；未传时默认返回 id、name、logtype、desc、enable、from_app、last_modified_time，不包含 conf。"},
                    "permits": {"type": "string", "description": "可选，权限字段。"},
                    "page": {"type": "integer", "description": "页码。"},
                    "size": {"type": "integer", "description": "每页大小。"},
                    "id": {"type": "integer", "description": "按规则 ID 过滤。"},
                    "uuid": {"type": "string", "description": "按规则 UUID 过滤。"},
                    "domain_id": {"type": "integer", "description": "按 domain_id 过滤。"},
                    "creator_id": {"type": "integer", "description": "按创建人 ID 过滤。"},
                    "name": {"type": "string", "description": "按规则名称过滤。"},
                    "from_app": {"type": "integer", "description": "按关联应用 ID 过滤。"},
                    "enable": {"type": "boolean", "description": "按启用状态过滤。"},
                    "desc": {"type": "string", "description": "按描述过滤。"},
                    "logtype": {"type": "string", "description": "按 logtype 过滤。"},
                    "rt_ids": {"type": "string", "description": "按资源标签过滤，多个标签 ID 用逗号分隔。"},
                    "sort": {"type": "string", "description": "排序字段，例如 -id。"},
                    "useAdvancedSearch": {"type": "string", "description": "是否启用高级搜索。"},
                    "appname": {"type": "string", "description": "高级搜索时的 appname。"},
                    "tag": {"type": "string", "description": "高级搜索时的 tag。"},
                },
            },
        ),
        ToolDefinition(
            name="get_parserrule_detail",
            description="读取单个解析规则详情，适合在 update/verify 前先查看当前 conf、logtype、分配和标签信息。",
            input_schema={
                "type": "object",
                "properties": {
                    "id": {"type": "integer", "description": "解析规则 ID。"},
                    "fields": {"type": "string", "description": "可选，指定返回字段列表。"},
                    "permit": {"type": "string", "description": "可选，权限字段。"},
                },
                "required": ["id"],
            },
        ),
        ToolDefinition(
            name="generate_parserrule_draft",
            description="基于样例日志生成 parserrule 初稿。注意：这是“初稿生成”而不是最终规则，后端自动抽出的字段名可能是 `field`、`field_1`、`field_N` 这类无业务语义的占位名；调用后应结合 sample_logs 自行重命名字段，再继续 create/update/verify。",
            input_schema={
                "type": "object",
                "properties": {
                    "sample_logs": {
                        "oneOf": [
                            {"type": "array", "items": {"oneOf": [{"type": "string"}, {"type": "object", "additionalProperties": True}]}},
                            {"type": "object", "additionalProperties": True},
                            {"type": "string"},
                        ],
                        "description": "样例日志。优先传字符串数组；也兼容对象数组、单个对象、单个字符串或合法 JSON 字符串。对象时会优先提取 raw_message、rawMessage、message、log、content。",
                    }
                },
                "required": ["sample_logs"],
            },
        ),
        ToolDefinition(
            name="create_parserrule",
            description="创建解析规则。推荐先调用 `generate_parserrule_draft` 生成初稿，再把人工确认后的结果放进 rule。rule 支持对象，也兼容合法 JSON 字符串；会在本地校验必填字段，以及 conf/sink_conf 是否为合法 JSON 字符串。",
            input_schema={
                "type": "object",
                "properties": {
                    "rule": {
                        "oneOf": [
                            {
                                "type": "object",
                                "description": "解析规则主体。",
                                "properties": {
                                    "name": {"type": "string", "description": "规则名称。"},
                                    "conf": {"oneOf": [{"type": "string"}, {"type": "object", "additionalProperties": True}, {"type": "array", "items": {"type": "object"}}], "description": "规则 conf。传对象/数组时会自动序列化为 JSON 字符串。"},
                                    "logtype": {"type": "string", "description": "规则 logtype。"},
                                    "desc": {"type": "string", "description": "规则描述。"},
                                    "category_id": {"type": "integer", "description": "分类 ID。"},
                                    "enable": {"type": "boolean", "description": "是否启用。"},
                                    "from_app": {"type": "integer", "description": "关联应用 ID。"},
                                    "notice_frequency": {"type": "string", "description": "未解析日志通知频率。"},
                                    "sink_conf": {"oneOf": [{"type": "string"}, {"type": "object", "additionalProperties": True}, {"type": "array", "items": {"type": "object"}}], "description": "指标索引配置。传对象/数组时会自动序列化为 JSON 字符串。"},
                                    "rt_names": {"type": "string", "description": "关联资源标签名称，逗号分隔。"},
                                    "assign_data": {
                                        "type": "array",
                                        "description": "数据分配配置。",
                                        "items": {"type": "object", "properties": {"appnames": {"type": "string"}, "tags": {"type": "string"}}},
                                    },
                                },
                            },
                            {"type": "string", "description": "解析规则主体的 JSON 对象字符串。"},
                        ]
                    }
                },
                "required": ["rule"],
            },
        ),
        ToolDefinition(
            name="update_parserrule",
            description="更新解析规则。推荐先调用 `generate_parserrule_draft` 生成或重整初稿，再把人工确认后的字段放进 changes。changes 支持对象，也兼容合法 JSON 字符串；空 changes 和非法 JSON 会在本地直接拦截。",
            input_schema={
                "type": "object",
                "properties": {
                    "id": {"type": "integer", "description": "解析规则 ID。"},
                    "changes": {
                        "oneOf": [
                            {
                                "type": "object",
                                "description": "待更新字段。",
                                "properties": {
                                    "name": {"type": "string", "description": "规则名称。"},
                                    "conf": {"oneOf": [{"type": "string"}, {"type": "object", "additionalProperties": True}, {"type": "array", "items": {"type": "object"}}], "description": "规则 conf。传对象/数组时会自动序列化为 JSON 字符串。"},
                                    "logtype": {"type": "string", "description": "规则 logtype。"},
                                    "desc": {"type": "string", "description": "规则描述。"},
                                    "category_id": {"type": "integer", "description": "分类 ID。"},
                                    "enable": {"type": "boolean", "description": "是否启用。"},
                                    "from_app": {"type": "integer", "description": "关联应用 ID。"},
                                    "notice_frequency": {"type": "string", "description": "未解析日志通知频率。"},
                                    "sink_conf": {"oneOf": [{"type": "string"}, {"type": "object", "additionalProperties": True}, {"type": "array", "items": {"type": "object"}}], "description": "指标索引配置。传对象/数组时会自动序列化为 JSON 字符串。"},
                                    "rt_names": {"type": "string", "description": "关联资源标签名称，逗号分隔。"},
                                    "assign_data": {
                                        "type": "array",
                                        "description": "数据分配配置。",
                                        "items": {"type": "object", "properties": {"appnames": {"type": "string"}, "tags": {"type": "string"}}},
                                    },
                                },
                            },
                            {"type": "string", "description": "待更新字段的 JSON 对象字符串。"},
                        ]
                    },
                },
                "required": ["id", "changes"],
            },
        ),
        ToolDefinition(
            name="delete_parserrule",
            description="删除单个解析规则。",
            input_schema={"type": "object", "properties": {"id": {"type": "integer", "description": "解析规则 ID。"}}, "required": ["id"]},
        ),
        ToolDefinition(
            name="verify_parserrule",
            description="验证解析规则对样例日志的解析结果。推荐流程是先 `generate_parserrule_draft`，再 `create_parserrule` / `update_parserrule`，最后用本工具验证。底层调用 `parserrules/verify/logtype`，只用于字段提取 / schema on write。支持两种传参方式：1）传 payload 作为 verify 原始请求体；2）直接把 rawMessage、rule、sample_logs、conf、logtype、enable 平铺到顶层。rule/conf 支持原生数组对象或 JSON 字符串；logtype 优先传字符串，也兼容旧的对象/数组输入，工具会尽量提取其中的 name/type/logtype 字段。sample_logs 会尽量保持你传入的原始形态，既支持字符串数组，也支持对象数组。工具会先在本地校验空规则、空样例、非法 JSON，再把返回结果整理成更适合 LLM 阅读的摘要。",
            input_schema={
                "type": "object",
                "properties": {
                    "domain": {"type": "string", "description": "可选，domain。"},
                    "query_logtype": {"type": "string", "description": "可选，verify 接口 query 参数 logtype。"},
                    "logtype": {"oneOf": [{"type": "string", "description": "推荐直接传单个 logtype 字符串，例如 nginx_access、text。"}, {"type": "array", "items": {"oneOf": [{"type": "string"}, {"type": "object", "additionalProperties": True}]}, "description": "兼容旧输入：会从数组中提取首个可识别的 name/type/logtype。"}, {"type": "object", "additionalProperties": True, "description": "兼容旧输入：会从对象中提取 name/type/logtype。"}]},
                    "rawMessage": {"type": "string", "description": "顶层直传模式下的待解析原始日志。若缺失，会尝试从 sample_logs 第一条样例中兜底提取。"},
                    "enable": {"oneOf": [{"type": "boolean"}, {"type": "string"}], "description": '顶层直传模式下是否启用。字符串仅支持 "true"/"false"。'},
                    "rule": {"oneOf": [{"type": "array", "items": {"type": "object"}}, {"type": "object", "additionalProperties": True}, {"type": "string"}], "description": "顶层直传模式下的匹配规则；支持数组、对象或 JSON 字符串。"},
                    "sample_logs": {"oneOf": [{"type": "array", "items": {"oneOf": [{"type": "object"}, {"type": "string"}]}}, {"type": "object", "additionalProperties": True}, {"type": "string"}], "description": "顶层直传模式下的样例日志；支持对象数组、字符串数组、单个对象或字符串。"},
                    "conf": {"oneOf": [{"type": "array", "items": {"type": "object"}}, {"type": "object", "additionalProperties": True}, {"type": "string"}], "description": "顶层直传模式下的 conf；支持数组、对象或 JSON 字符串。"},
                    "appname": {"type": "string"},
                    "grok": {"oneOf": [{"type": "object", "additionalProperties": True}, {"type": "string"}]},
                    "hostname": {"type": "string"},
                    "source": {"type": "string"},
                    "ip": {"type": "string"},
                    "payload": {
                        "oneOf": [
                            {
                                "type": "object",
                                "description": "verify 原始请求体。",
                                "properties": {
                                    "appname": {"type": "string"},
                                    "conf": {"oneOf": [{"type": "array", "items": {"type": "object"}}, {"type": "object", "additionalProperties": True}, {"type": "string"}]},
                                    "logtype": {"oneOf": [{"type": "string", "description": "推荐直接传字符串；也兼容对象、数组或 JSON 字符串，并会尽量提取 name/type/logtype。"}, {"type": "array", "items": {"oneOf": [{"type": "string"}, {"type": "object", "additionalProperties": True}]}}, {"type": "object", "additionalProperties": True}]},
                                    "rawMessage": {"type": "string", "description": "待解析原始日志。"},
                                    "enable": {"oneOf": [{"type": "boolean"}, {"type": "string"}], "description": "是否启用。"},
                                    "rule": {"oneOf": [{"type": "array", "items": {"type": "object"}}, {"type": "object", "additionalProperties": True}, {"type": "string"}]},
                                    "sample_logs": {"oneOf": [{"type": "array", "items": {"oneOf": [{"type": "object"}, {"type": "string"}]}}, {"type": "object", "additionalProperties": True}, {"type": "string"}]},
                                    "grok": {"oneOf": [{"type": "object", "additionalProperties": True}, {"type": "string"}]},
                                    "hostname": {"type": "string"},
                                    "source": {"type": "string"},
                                    "ip": {"type": "string"},
                                },
                            },
                            {"type": "string", "description": "verify 原始请求体的 JSON 字符串。"},
                        ]
                    },
                },
            },
        ),
        ToolDefinition(
            name="list_parserrule_references",
            description="本地规则类型参考工具。数据来源于仓库内 docs/parserule.adoc，不依赖外部网络；不传 rule_type 时返回当前支持的主要算子类型列表，传入 rule_type 时返回对应类型的用途、关键字段、最小示例和注意事项。",
            input_schema={"type": "object", "properties": {"rule_type": {"type": "string", "description": "可选，规则类型。支持传入类型 key 或常见别名，例如 regex、json、kv、dissect、metadata、正则解析、JSON解析。"}, "type": {"type": "string", "description": "可选，rule_type 的兼容别名；新调用优先使用 rule_type。"}}},
        ),
    ]
)


class ParserRuleService(BaseServiceModule):
    async def list_parser_rules(self, params: dict[str, Any]) -> ApiResponse[Any]:
        return await self.request_json(
            "get",
            "/api/v3/parserrules/",
            params=self.pick_defined(
                {
                    "fields": self.resolve_list_fields(params.get("fields")),
                    "permits": params.get("permits"),
                    "page": params.get("page"),
                    "size": params.get("size"),
                    "id": params.get("id"),
                    "uuid": params.get("uuid"),
                    "domain_id": params.get("domain_id"),
                    "creator_id": params.get("creator_id"),
                    "name": params.get("name"),
                    "from_app": params.get("from_app"),
                    "enable": params.get("enable"),
                    "desc": params.get("desc"),
                    "logtype": params.get("logtype"),
                    "rt_ids": params.get("rt_ids"),
                    "sort": params.get("sort"),
                    "useAdvancedSearch": params.get("useAdvancedSearch"),
                    "appname": params.get("appname"),
                    "tag": params.get("tag"),
                }
            ),
        )

    async def get_parser_rule_detail(self, params: dict[str, Any]) -> Any:
        id_result = self.require_id(params.get("id"), "get_parserrule_detail 需要 id。", suggestion="请提供目标解析规则的 id。")
        if id_result.get("error"):
            return id_result["error"]
        return await self.request_json(
            "get",
            f"/api/v3/parserrules/{id_result['value']}/",
            params=self.pick_defined({"fields": params.get("fields"), "permit": params.get("permit")}),
        )

    async def create_parser_rule(self, params: dict[str, Any]) -> Any:
        rule = self.extract_mutation_body(params, "rule", "create_parserrule")
        if rule.get("error"):
            return rule["error"]

        required_fields_error = self.validate_required_fields(rule["value"], PARSER_RULE_CREATE_REQUIRED_FIELDS, "create_parserrule")
        if required_fields_error:
            return required_fields_error

        return await self.request_json("post", "/api/v3/parserrules/", data=rule["value"])

    async def update_parser_rule(self, params: dict[str, Any]) -> Any:
        id_result = self.require_id(params.get("id"), "update_parserrule 需要 id。", suggestion="请提供目标解析规则的 id。")
        if id_result.get("error"):
            return id_result["error"]

        changes = self.extract_mutation_body(params, "changes", "update_parserrule")
        if changes.get("error"):
            return changes["error"]

        return await self.request_json("put", f"/api/v3/parserrules/{id_result['value']}/", data=changes["value"])

    async def delete_parser_rule(self, params: dict[str, Any]) -> Any:
        id_result = self.require_id(params.get("id"), "delete_parserrule 需要 id。", suggestion="请提供目标解析规则的 id。")
        if id_result.get("error"):
            return id_result["error"]
        return await self.request_json("delete", f"/api/v3/parserrules/{id_result['value']}/")

    async def generate_parser_rule_draft(self, params: dict[str, Any]) -> Any:
        request = self.build_generate_draft_request(params)
        if request.get("error"):
            return request["error"]

        response = await self.request_json("post", "/api/v3/parserrules/generate/", data=request["payload"])
        if response.error:
            return self.api_response_to_error(response)
        if self.is_upstream_business_error(response.data):
            return self.build_error(
                "UPSTREAM_BUSINESS_ERROR",
                "generate_parserrule_draft 上游接口返回失败。",
                "请先检查 sample_logs 是否足够且格式接近同一类日志；如果样例本身没问题，再检查上游服务状态。",
                response.data,
            )

        return {
            "raw_data": response.data,
            "data": self.format_generate_draft_response(response.data, request["payload"]["sample_logs"]),
        }

    async def verify_parser_rule(self, params: dict[str, Any]) -> Any:
        request = self.build_verify_request(params)
        if request.get("error"):
            return request["error"]

        response = await self.request_json(
            "post",
            "/api/v3/parserrules/verify/logtype/",
            data=request["payload"],
            params=self.pick_defined({"domain": params.get("domain"), "logtype": request.get("queryLogtype")}),
        )
        if response.error:
            return self.api_response_to_error(response)
        if self.is_upstream_business_error(response.data):
            return self.build_error(
                "UPSTREAM_BUSINESS_ERROR",
                "verify_parserrule 上游接口返回失败。",
                "请检查 rule、conf、logtype 与 sample_logs 是否匹配；如果参数本身没问题，再检查上游服务状态。",
                response.data,
            )

        return {
            "raw_data": response.data,
            "data": self.format_verify_response(response.data, request["payload"]),
        }

    async def list_parser_rule_references(self, params: dict[str, Any]) -> Any:
        requested_rule_type = self.pick_requested_rule_type(params)
        if not requested_rule_type:
            return {
                "data": {
                    **self.get_parser_rule_reference_catalog(),
                    "usage": "传入 rule_type 查询某一种规则类型的用途、关键字段、最小示例和注意事项。",
                }
            }

        reference = self.find_parser_rule_reference(requested_rule_type)
        if not reference:
            supported = "、".join(item["type"] for item in self.get_parser_rule_reference_catalog()["supported_rule_types"])
            return self.build_error(
                "UNSUPPORTED_PARSERRULE_REFERENCE",
                f"暂不支持规则类型: {requested_rule_type}",
                f"请先不传 rule_type 查看支持列表，或改用 {supported}。",
            )

        return {
            "data": {
                "doc_source": PARSER_RULE_DOC_SOURCE,
                "requested_rule_type": requested_rule_type,
                **reference,
            }
        }

    def extract_mutation_body(self, params: dict[str, Any], field_name: str, tool_name: str) -> dict[str, Any]:
        source = params.get(field_name)
        if source in (None, ""):
            return {
                "error": self.build_error(
                    "MISSING_REQUIRED_PARAM",
                    f"{tool_name} 需要 {field_name}。",
                    f"请在 {field_name} 中传入解析规则主体，例如 name、conf、logtype、desc、category_id、enable。",
                )
            }

        parsed_source = self.parse_mutation_object(source, field_name, tool_name)
        if parsed_source.get("error"):
            return parsed_source

        normalized = self.pick_defined({key: parsed_source["value"].get(key) for key in PARSER_RULE_MUTATION_FIELDS})
        if not normalized:
            return {
                "error": self.build_error(
                    "EMPTY_MUTATION_BODY",
                    f"{tool_name} 的 {field_name} 不能为空对象。",
                    f"请在 {field_name} 中至少提供一个允许写入的字段，例如 name、conf、logtype、desc、enable、rt_names。",
                )
            }

        for json_field in ("conf", "sink_conf"):
            if json_field not in normalized:
                continue
            normalized_json_field = self.normalize_json_encoded_mutation_field(normalized[json_field], f"{tool_name}.{field_name}.{json_field}")
            if normalized_json_field.get("error"):
                return {"error": normalized_json_field["error"]}
            normalized[json_field] = normalized_json_field["value"]

        return {"value": normalized}

    def parse_mutation_object(self, raw_value: Any, field_name: str, tool_name: str) -> dict[str, Any]:
        if self.is_plain_object(raw_value):
            return {"value": raw_value}
        if not isinstance(raw_value, str):
            return {"error": self.build_error("INVALID_PARAM_TYPE", f"{tool_name} 的 {field_name} 必须是对象。", f"请把 {field_name} 传成对象，或传入可解析为对象的合法 JSON 字符串。")}
        trimmed = raw_value.strip()
        if not trimmed:
            return {"error": self.build_error("EMPTY_MUTATION_BODY", f"{tool_name} 的 {field_name} 不能为空字符串。", f"请把 {field_name} 传成对象，或传入合法的 JSON 对象字符串。")}
        try:
            parsed = json.loads(trimmed)
        except json.JSONDecodeError as exc:
            return {"error": self.build_error("INVALID_JSON_STRING", f"{tool_name} 的 {field_name} 不是合法 JSON 字符串。", f"请检查 {field_name} 的 JSON 语法，例如引号、逗号、括号是否完整。", {"field": field_name, "parse_error": str(exc), "preview": trimmed[:300]})}
        if not self.is_plain_object(parsed):
            return {"error": self.build_error("INVALID_PARAM_TYPE", f"{tool_name} 的 {field_name} 必须是对象。", f"请把 {field_name} 传成对象，或传入可解析为对象的合法 JSON 对象字符串。")}
        return {"value": parsed}

    def normalize_json_encoded_mutation_field(self, raw_value: Any, field_path: str) -> dict[str, Any]:
        if isinstance(raw_value, str):
            trimmed = raw_value.strip()
            if not trimmed:
                return {"error": self.build_error("INVALID_JSON_STRING", f"{field_path} 不能为空字符串。", f"请确保 {field_path} 是合法 JSON 字符串，或直接传对象/数组。")}
            try:
                json.loads(trimmed)
            except json.JSONDecodeError as exc:
                return {"error": self.build_error("INVALID_JSON_STRING", f"{field_path} 不是合法 JSON 字符串。", f"请检查 {field_path} 的 JSON 语法，例如引号、逗号、括号是否完整。", {"field": field_path, "parse_error": str(exc), "preview": trimmed[:300]})}
            return {"value": trimmed}
        if isinstance(raw_value, (list, dict)):
            return {"value": json.dumps(raw_value, ensure_ascii=False)}
        return {"error": self.build_error("INVALID_PARAM_TYPE", f"{field_path} 必须是 JSON 字符串、对象或数组。", f"请把 {field_path} 传成对象/数组，或传入合法 JSON 字符串。")}

    def validate_required_fields(self, payload: dict[str, Any], required_fields: tuple[str, ...], tool_name: str) -> dict[str, Any] | None:
        missing_fields = [field for field in required_fields if self.is_missing_required_value(payload.get(field))]
        if not missing_fields:
            return None
        return self.build_error("MISSING_REQUIRED_FIELDS", f"{tool_name} 缺少必填字段: {', '.join(missing_fields)}。", f"请补齐必填字段后重试：{', '.join(missing_fields)}。")

    def build_generate_draft_request(self, params: dict[str, Any]) -> dict[str, Any]:
        sample_logs = self.normalize_generate_sample_logs(params.get("sample_logs"))
        if sample_logs.get("error"):
            return {"error": sample_logs["error"]}
        return {"payload": {"sample_logs": sample_logs["value"]}}

    def normalize_generate_sample_logs(self, raw_value: Any) -> dict[str, Any]:
        if raw_value is None:
            return {"error": self.build_error("MISSING_REQUIRED_PARAM", "generate_parserrule_draft 需要 sample_logs。", "请至少提供 1 条样例日志；支持字符串数组、对象数组、单个对象、单个字符串，或合法 JSON 字符串。")}
        if isinstance(raw_value, str):
            trimmed = raw_value.strip()
            if not trimmed:
                return {"error": self.build_error("EMPTY_SAMPLE_LOGS", "generate_parserrule_draft 的 sample_logs 不能为空字符串。", "请至少提供 1 条样例日志；如果想传 JSON，请确保字符串内容不是空串。")}
            if trimmed.startswith("[") or trimmed.startswith("{"):
                parsed = self.parse_json_string_field(trimmed, "sample_logs")
                if parsed.get("error"):
                    return {"error": parsed["error"]}
                return self.normalize_generate_sample_logs(parsed["value"])
            return {"value": [trimmed]}
        if isinstance(raw_value, list):
            normalized = [item for item in (self.normalize_generate_sample_log_entry(entry) for entry in raw_value) if isinstance(item, str) and item.strip()]
            if not normalized:
                return {"error": self.build_error("EMPTY_SAMPLE_LOGS", "generate_parserrule_draft 的 sample_logs 不能为空。", "请至少提供 1 条可识别的样例日志文本。")}
            return {"value": normalized}
        if self.is_plain_object(raw_value):
            normalized = self.normalize_generate_sample_log_entry(raw_value)
            if not normalized:
                return {"error": self.build_error("INVALID_PARAM_TYPE", "generate_parserrule_draft 的 sample_logs 对象里没有可识别的日志文本。", "请使用 raw_message、rawMessage、message、log 或 content 字段传样例日志，或直接传字符串。")}
            return {"value": [normalized]}
        return {"error": self.build_error("INVALID_PARAM_TYPE", "generate_parserrule_draft 的 sample_logs 必须是数组、对象、字符串，或合法 JSON 字符串。", "请把 sample_logs 传成字符串数组、对象数组、单个对象、单个字符串，或传入可解析为这些结构的 JSON 字符串。")}

    def normalize_generate_sample_log_entry(self, sample: Any) -> str | None:
        extracted = self.extract_sample_text(sample)
        if isinstance(extracted, str) and extracted.strip():
            return extracted.strip()
        if isinstance(sample, str) and sample.strip():
            return sample.strip()
        return None

    def format_generate_draft_response(self, data: Any, sample_logs: list[str]) -> dict[str, Any]:
        generated_rules = data.get("rules") if isinstance(data, dict) and isinstance(data.get("rules"), list) else []
        return {
            "traceid": data.get("traceid") if isinstance(data, dict) else None,
            "upstream_result": data.get("result") if isinstance(data, dict) else None,
            "request_overview": {"sample_count": len(sample_logs), "sample_preview": sample_logs[:3]},
            "summary": data.get("summary") if isinstance(data, dict) else None,
            "generated_rule_count": len(generated_rules),
            "generated_rules": generated_rules,
            "contents": data.get("contents") if isinstance(data, dict) and isinstance(data.get("contents"), list) else [],
            "next_steps": [
                "先人工检查 generated_rules 是否符合预期，并根据 sample_logs 把 field、field_1、field_N 这类占位字段改成有业务语义的名字。",
                "create_parserrule / update_parserrule 时，请手动组装 rule 或 changes，并补齐 name、logtype、desc、category_id、enable 等必填上下文。",
                "推荐在 create/update 前后都调用 verify_parserrule 做样例日志验证。",
            ],
        }

    def build_verify_request(self, params: dict[str, Any]) -> dict[str, Any]:
        source = self.resolve_verify_source(params)
        if source.get("error"):
            return {"error": source["error"]}
        resolved_source = source["value"]

        rule = self.normalize_verify_array_field(resolved_source.get("rule"), "rule", "匹配规则")
        if rule.get("error"):
            return {"error": rule["error"]}
        if not rule["value"]:
            return {"error": self.build_error("EMPTY_RULE", "verify_parserrule 的 rule 不能为空。", "请至少提供 1 条匹配规则；如果你传的是 JSON 字符串，请确认它能解析成非空数组或对象。")}

        conf = self.normalize_verify_array_field(resolved_source.get("conf"), "conf", "解析规则 conf")
        if conf.get("error"):
            return {"error": conf["error"]}
        if not conf["value"]:
            return {"error": self.build_error("EMPTY_CONF", "verify_parserrule 的 conf 不能为空。", "请至少提供 1 条 conf 配置；如果你传的是 JSON 字符串，请确认它能解析成非空数组或对象。")}

        logtype = self.normalize_verify_logtype_field(resolved_source.get("logtype"))
        if logtype.get("error"):
            return {"error": logtype["error"]}
        if not logtype["value"]:
            return {"error": self.build_error("EMPTY_LOGTYPE", "verify_parserrule 的 logtype 不能为空。", "请传入非空的 logtype；优先直接传字符串，例如 nginx_access、text。")}

        sample_logs = self.normalize_sample_logs(resolved_source.get("sample_logs"))
        if sample_logs.get("error"):
            return {"error": sample_logs["error"]}
        if not sample_logs["value"]:
            return {"error": self.build_error("EMPTY_SAMPLE_LOGS", "verify_parserrule 的 sample_logs 不能为空。", "请至少提供 1 条样例日志；可以传字符串数组、对象数组，或合法 JSON 字符串。")}

        raw_message = self.normalize_raw_message(resolved_source.get("rawMessage"), sample_logs["value"])
        if raw_message.get("error"):
            return {"error": raw_message["error"]}

        enable = self.normalize_boolean(resolved_source.get("enable"), "enable")
        if enable.get("error"):
            return {"error": enable["error"]}

        grok = self.normalize_optional_object_field(resolved_source.get("grok"), "grok")
        if grok.get("error"):
            return {"error": grok["error"]}

        return {
            "payload": self.pick_defined(
                {
                    "appname": self.normalize_optional_scalar(resolved_source.get("appname")),
                    "conf": conf["value"],
                    "logtype": logtype["value"],
                    "rawMessage": raw_message["value"],
                    "enable": enable["value"],
                    "rule": rule["value"],
                    "sample_logs": sample_logs["value"],
                    "grok": grok.get("value"),
                    "hostname": self.normalize_optional_scalar(resolved_source.get("hostname")),
                    "source": self.normalize_optional_scalar(resolved_source.get("source")),
                    "ip": self.normalize_optional_scalar(resolved_source.get("ip")),
                }
            ),
            "queryLogtype": self.normalize_query_logtype(params),
        }

    def resolve_verify_source(self, params: dict[str, Any]) -> dict[str, Any]:
        if "payload" in params and params.get("payload") is not None:
            parsed_payload = self.parse_json_string_field(params.get("payload"), "payload")
            if parsed_payload.get("error"):
                return {"error": parsed_payload["error"]}
            if not self.is_plain_object(parsed_payload["value"]):
                return {"error": self.build_error("INVALID_PARAM_TYPE", "verify_parserrule 的 payload 必须是对象。", "请把 payload 传成对象，或传入可以解析为对象的合法 JSON 字符串。")}
            return {"value": parsed_payload["value"]}

        source = self.pick_defined(
            {
                "appname": params.get("appname"),
                "conf": params.get("conf"),
                "logtype": params.get("logtype"),
                "rawMessage": params.get("rawMessage"),
                "enable": params.get("enable"),
                "rule": params.get("rule"),
                "sample_logs": params.get("sample_logs"),
                "grok": params.get("grok"),
                "hostname": params.get("hostname"),
                "source": params.get("source"),
                "ip": params.get("ip"),
            }
        )
        if not source:
            return {"error": self.build_error("MISSING_REQUIRED_PARAM", "verify_parserrule 需要 payload，或直接提供 rawMessage、rule、sample_logs、conf、logtype、enable。", "推荐直接传 payload；如果想少包一层，也可以把 rawMessage、rule、sample_logs、conf、logtype、enable 这些字段平铺到顶层。")}
        return {"value": source}

    def normalize_verify_logtype_field(self, raw_value: Any) -> dict[str, Any]:
        if raw_value is None:
            return {"error": self.build_error("MISSING_REQUIRED_PARAM", "verify_parserrule 需要 logtype。", "请提供当前规则 logtype；优先直接传字符串，例如 nginx_access、text。")}

        if isinstance(raw_value, str):
            trimmed = raw_value.strip()
            if not trimmed:
                return {"value": ""}
            if not trimmed.startswith("[") and not trimmed.startswith("{"):
                return {"value": trimmed}

        parsed = self.parse_json_string_field(raw_value, "logtype")
        if parsed.get("error"):
            return {"error": parsed["error"]}

        resolved = self.extract_verify_logtype_value(parsed["value"])
        if resolved:
            return {"value": resolved}

        return {
            "error": self.build_error(
                "INVALID_PARAM_TYPE",
                "verify_parserrule 的 logtype 必须是字符串、对象、数组，或合法 JSON 字符串。",
                "推荐直接传字符串；如果传对象/数组，请至少包含 name、type 或 logtype 这类可识别字段。",
            )
        }

    def normalize_verify_array_field(self, raw_value: Any, field_name: str, display_name: str) -> dict[str, Any]:
        if raw_value is None:
            return {"error": self.build_error("MISSING_REQUIRED_PARAM", f"verify_parserrule 需要 {field_name}。", f"请提供{display_name}，支持原生数组/对象，或传入可解析的 JSON 字符串。")}
        parsed = self.parse_json_string_field(raw_value, field_name)
        if parsed.get("error"):
            return {"error": parsed["error"]}
        if isinstance(parsed["value"], list):
            return {"value": parsed["value"]}
        if self.is_plain_object(parsed["value"]):
            return {"value": [parsed["value"]]}
        return {"error": self.build_error("INVALID_PARAM_TYPE", f"verify_parserrule 的 {field_name} 必须是数组、对象或合法 JSON 字符串。", f"请把 {field_name} 传成原生数组/对象，或传入可解析为数组/对象的 JSON 字符串。")}

    def normalize_sample_logs(self, raw_value: Any) -> dict[str, Any]:
        if raw_value is None:
            return {"error": self.build_error("MISSING_REQUIRED_PARAM", "verify_parserrule 需要 sample_logs。", "请至少提供 1 条样例日志；支持字符串数组、对象数组、单个对象，或合法 JSON 字符串。")}
        if isinstance(raw_value, str):
            trimmed = raw_value.strip()
            if not trimmed:
                return {"error": self.build_error("EMPTY_SAMPLE_LOGS", "verify_parserrule 的 sample_logs 不能为空字符串。", "请至少提供 1 条样例日志；如果想传 JSON，请确保字符串内容不是空串。")}
            if trimmed.startswith("[") or trimmed.startswith("{"):
                parsed = self.parse_json_string_field(trimmed, "sample_logs")
                if parsed.get("error"):
                    return {"error": parsed["error"]}
                return self.normalize_sample_logs(parsed["value"])
            return {"value": [trimmed]}
        if isinstance(raw_value, list):
            return {"value": [self.normalize_sample_log_entry(item) for item in raw_value]}
        if self.is_plain_object(raw_value):
            return {"value": [self.normalize_sample_log_entry(raw_value)]}
        return {"error": self.build_error("INVALID_PARAM_TYPE", "verify_parserrule 的 sample_logs 必须是数组、对象、字符串，或合法 JSON 字符串。", "请把 sample_logs 传成字符串数组、对象数组、单个对象，或传入可解析为这些结构的 JSON 字符串。")}

    def normalize_sample_log_entry(self, sample: Any) -> Any:
        if isinstance(sample, str):
            return sample
        if self.is_plain_object(sample):
            return sample
        return str(sample)

    def normalize_raw_message(self, raw_value: Any, sample_logs: list[Any]) -> dict[str, Any]:
        if isinstance(raw_value, str) and raw_value.strip():
            return {"value": raw_value}
        if isinstance(raw_value, (int, float, bool)):
            return {"value": str(raw_value)}
        fallback = next((text for text in (self.extract_sample_text(sample) for sample in sample_logs) if isinstance(text, str) and text.strip()), None)
        if fallback:
            return {"value": fallback}
        return {"error": self.build_error("MISSING_REQUIRED_PARAM", "verify_parserrule 需要 rawMessage。", "请显式提供 rawMessage；如果想自动兜底，请确保 sample_logs 至少有一条带 raw_message、rawMessage、message、log 或 content 字段。")}

    def normalize_boolean(self, raw_value: Any, field_name: str) -> dict[str, Any]:
        if isinstance(raw_value, bool):
            return {"value": raw_value}
        if isinstance(raw_value, str):
            normalized = raw_value.strip().lower()
            if normalized == "true":
                return {"value": True}
            if normalized == "false":
                return {"value": False}
        return {"error": self.build_error("INVALID_PARAM_TYPE", f"verify_parserrule 的 {field_name} 必须是布尔值。", f'请把 {field_name} 传成 true/false；如果是字符串，也只能是 "true" 或 "false"。')}

    def normalize_optional_object_field(self, raw_value: Any, field_name: str) -> dict[str, Any]:
        if raw_value is None:
            return {"value": None}
        parsed = self.parse_json_string_field(raw_value, field_name)
        if parsed.get("error"):
            return {"error": parsed["error"]}
        if self.is_plain_object(parsed["value"]):
            return {"value": parsed["value"]}
        return {"error": self.build_error("INVALID_PARAM_TYPE", f"verify_parserrule 的 {field_name} 必须是对象或合法 JSON 字符串。", f"请把 {field_name} 传成对象，或传入可解析为对象的 JSON 字符串。")}

    def parse_json_string_field(self, raw_value: Any, field_name: str) -> dict[str, Any]:
        if not isinstance(raw_value, str):
            return {"value": raw_value}
        trimmed = raw_value.strip()
        if not trimmed:
            return {"value": trimmed}
        try:
            return {"value": json.loads(trimmed)}
        except json.JSONDecodeError as exc:
            return {"error": self.build_error("INVALID_JSON", f"verify_parserrule 的 {field_name} 不是合法 JSON。", f"请检查 {field_name} 的 JSON 语法，例如引号、逗号、括号是否完整；如果本意不是传 JSON，请改用原生对象/数组。", {"field": field_name, "parse_error": str(exc), "preview": trimmed[:300]})}

    def format_verify_response(self, data: Any, request_payload: dict[str, Any]) -> dict[str, Any]:
        contents = data.get("contents") if isinstance(data, dict) and isinstance(data.get("contents"), list) else []
        samples = [self.format_verify_sample(content, index) for index, content in enumerate(contents)]
        success_count = len([item for item in samples if item["success"]])
        failure_count = len(samples) - success_count
        total_time_cost_us = sum(item["time_cost_us"] for item in samples if isinstance(item["time_cost_us"], (int, float)))
        return {
            "traceid": data.get("traceid") if isinstance(data, dict) else None,
            "upstream_result": data.get("result") if isinstance(data, dict) else None,
            "request_overview": {
                "appname": request_payload.get("appname"),
                "enable": request_payload.get("enable"),
                "rule_count": len(request_payload.get("rule") or []),
                "conf_count": len(request_payload.get("conf") or []),
                "logtype_count": 1 if isinstance(request_payload.get("logtype"), str) and request_payload.get("logtype", "").strip() else 0,
                "sample_count": len(request_payload.get("sample_logs") or []),
            },
            "summary": {
                "total_samples": len(samples),
                "success_count": success_count,
                "failure_count": failure_count,
                "average_time_cost_us": round(total_time_cost_us / len(samples), 2) if samples else 0,
            },
            "samples": samples,
        }

    def format_verify_sample(self, content: Any, index: int) -> dict[str, Any]:
        extracted_fields = content.get("fields") if self.is_plain_object(content) and self.is_plain_object(content.get("fields")) else {}
        field_types = content.get("types") if self.is_plain_object(content) and self.is_plain_object(content.get("types")) else {}
        parse_result = content.get("parse_result") if self.is_plain_object(content) and isinstance(content.get("parse_result"), str) else None
        return {
            "index": index,
            "success": self.infer_verify_success(parse_result, extracted_fields),
            "parse_result": parse_result,
            "time_cost_us": content.get("timeCostUs") if self.is_plain_object(content) and isinstance(content.get("timeCostUs"), (int, float)) else None,
            "raw_message": self.extract_sample_text(content),
            "log_type": self.normalize_optional_scalar(content.get("log_type") if self.is_plain_object(content) else None),
            "hit_rule": self.format_hit_rule(content.get("hit_rule") if self.is_plain_object(content) else None),
            "extracted_field_names": list(extracted_fields.keys()),
            "extracted_fields": extracted_fields,
            "field_types": field_types,
        }

    def format_hit_rule(self, hit_rule: Any) -> dict[str, Any]:
        if not isinstance(hit_rule, list):
            return {"raw": hit_rule}
        return {
            "raw": hit_rule,
            "rule_type": hit_rule[0] if len(hit_rule) > 0 else None,
            "stage_result": hit_rule[3] if len(hit_rule) > 3 else None,
            "time_cost_us": hit_rule[4] if len(hit_rule) > 4 and isinstance(hit_rule[4], (int, float)) else self.try_to_number(hit_rule[4] if len(hit_rule) > 4 else None),
            "grok_steps": hit_rule[5] if len(hit_rule) > 5 else None,
        }

    def infer_verify_success(self, parse_result: str | None, extracted_fields: dict[str, Any]) -> bool:
        if parse_result:
            normalized = parse_result.strip().lower()
            if normalized in {"success", "ok", "pass", "parsed", "hit"}:
                return True
            if normalized in {"fail", "failed", "error", "skip", "miss", "no_match", "false"}:
                return False
        return bool(extracted_fields)

    def resolve_list_fields(self, fields: Any) -> str:
        return fields.strip() if isinstance(fields, str) and fields.strip() else DEFAULT_PARSER_RULE_LIST_FIELDS

    def pick_requested_rule_type(self, params: dict[str, Any]) -> str | None:
        for candidate in (params.get("rule_type"), params.get("type")):
            if isinstance(candidate, str) and candidate.strip():
                return candidate.strip()
        return None

    def normalize_optional_scalar(self, value: Any) -> Any:
        return value if isinstance(value, (str, int, float, bool)) else None

    def normalize_query_logtype(self, params: dict[str, Any]) -> str | None:
        if isinstance(params.get("query_logtype"), str) and params.get("query_logtype", "").strip():
            return params["query_logtype"]
        return None

    def extract_verify_logtype_value(self, raw_value: Any) -> str | None:
        if isinstance(raw_value, str):
            trimmed = raw_value.strip()
            return trimmed or None

        if isinstance(raw_value, list):
            for item in raw_value:
                resolved = self.extract_verify_logtype_value(item)
                if resolved:
                    return resolved
            return None

        if not self.is_plain_object(raw_value):
            return None

        for key in ("logtype", "name", "type"):
            candidate = raw_value.get(key)
            if isinstance(candidate, str) and candidate.strip():
                return candidate.strip()

        return None

    def extract_sample_text(self, sample: Any) -> str | None:
        if isinstance(sample, str):
            return sample
        if not self.is_plain_object(sample):
            return None
        for key in VERIFY_SAMPLE_TEXT_KEYS:
            value = sample.get(key)
            if isinstance(value, str) and value.strip():
                return value
        return None

    def api_response_to_error(self, response: ApiResponse[Any]) -> dict[str, Any]:
        return self.build_error(
            response.error_code or "UPSTREAM_REQUEST_FAILED",
            response.message or response.error or "上游请求失败。",
            response.suggestion or "请检查上游地址、认证信息和请求参数。",
            response.details,
        )

    def normalize_rule_type(self, value: str) -> str:
        return "".join(ch for ch in value.strip().lower() if ch.isalnum())

    def build_alias_set(self, reference: dict[str, Any]) -> list[str]:
        return [reference["type"], reference["title"], *reference["aliases"]]

    def list_supported_parser_rule_types(self) -> list[dict[str, Any]]:
        return [{"type": reference["type"], "title": reference["title"], "aliases": reference["aliases"]} for reference in PARSER_RULE_REFERENCES]

    def get_parser_rule_reference_catalog(self) -> dict[str, Any]:
        return {"doc_source": PARSER_RULE_DOC_SOURCE, "total": len(PARSER_RULE_REFERENCES), "supported_rule_types": self.list_supported_parser_rule_types()}

    def find_parser_rule_reference(self, rule_type: str) -> dict[str, Any] | None:
        normalized_input = self.normalize_rule_type(rule_type)
        if not normalized_input:
            return None
        for reference in PARSER_RULE_REFERENCES:
            if any(self.normalize_rule_type(alias) == normalized_input for alias in self.build_alias_set(reference)):
                return reference
        for reference in PARSER_RULE_REFERENCES:
            if any(normalized_input in self.normalize_rule_type(alias) for alias in self.build_alias_set(reference)):
                return reference
        return None


def create_parserrule_server(runtime_config: RuntimeConfig, service_state: ServiceRuntimeState):
    service = ParserRuleService()
    runtime = ServiceToolRuntime(
        route_name="parserrule",
        title="解析规则服务",
        default_error_code="PARSERRULE_EXECUTION_ERROR",
        default_error_suggestion="请检查解析规则参数结构后重试。",
    )
    return create_tool_server(
        route_name="parserrule",
        server_name="rizhiyi_parserule",
        title="解析规则服务",
        description="解析规则服务完整能力。",
        instructions=SERVER_LEVEL_INSTRUCTIONS,
        runtime_config=runtime_config,
        service_state=service_state,
        tool_definitions=PARSER_RULE_TOOLS,
        tool_handlers={
            "list_parserrules": lambda arguments: runtime.execute(tool_name="list_parserrules", arguments=arguments, executor=service.list_parser_rules),
            "get_parserrule_detail": lambda arguments: runtime.execute(tool_name="get_parserrule_detail", arguments=arguments, executor=service.get_parser_rule_detail),
            "generate_parserrule_draft": lambda arguments: runtime.execute(tool_name="generate_parserrule_draft", arguments=arguments, executor=service.generate_parser_rule_draft),
            "create_parserrule": lambda arguments: runtime.execute(tool_name="create_parserrule", arguments=arguments, executor=service.create_parser_rule),
            "update_parserrule": lambda arguments: runtime.execute(tool_name="update_parserrule", arguments=arguments, executor=service.update_parser_rule),
            "delete_parserrule": lambda arguments: runtime.execute(tool_name="delete_parserrule", arguments=arguments, executor=service.delete_parser_rule),
            "verify_parserrule": lambda arguments: runtime.execute(tool_name="verify_parserrule", arguments=arguments, executor=service.verify_parser_rule),
            "list_parserrule_references": lambda arguments: runtime.execute(tool_name="list_parserrule_references", arguments=arguments, executor=service.list_parser_rule_references),
        },
    )
