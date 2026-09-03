export interface ParserRuleReference {
    type: string;
    title: string;
    aliases: string[];
    purpose: string;
    keyFields: string[];
    minimalExample: unknown;
    notes: string[];
}

const DOC_SOURCE = 'docs/parserule.adoc';

const PARSER_RULE_REFERENCES: ParserRuleReference[] = [
    {
        type: 'regex',
        title: '正则解析',
        aliases: ['正则解析', '正则', 'regex'],
        purpose: '从来源字段按正则整体提取字段，支持单行和多行模式。',
        keyFields: ['source', 'pattern', 'multiline', 'condition'],
        minimalExample: {
            source: 'raw_message',
            pattern: [['(?<test>.*)']],
            multiline: true
        },
        notes: [
            'pattern 只有一个子列表时可视为单行，多个子列表时表示多行。',
            '文档示例中 multiline 为内部字段，固定值 true。'
        ]
    },
    {
        type: 'regex_extract',
        title: '正则片段解析',
        aliases: ['正则片段解析', 'extract', 'regex_extract'],
        purpose: '从日志里抽取位置不固定的小片段字段，适合 IP、端口、用户名等局部信息。',
        keyFields: ['source', 'multiline', 'rule_name', 'extract[].regex', 'extract[].fields'],
        minimalExample: {
            source: 'raw_message',
            multiline: false,
            rule_name: '',
            extract: [[{
                source: null,
                regex: '(.*)',
                fields: {
                    a: '$1'
                },
                description: 'test regex'
            }]]
        },
        notes: [
            '该算子与正则解析共用入口，但依赖 extract 而不是 pattern。',
            '为了性能更好，文档建议正则里尽量带固定文本。'
        ]
    },
    {
        type: 'json',
        title: 'JSON解析',
        aliases: ['JSON解析', 'json'],
        purpose: '把 JSON 字符串解析成字段，支持按 paths 选取子路径。',
        keyFields: ['source', 'paths', 'flatten_short_array', 'extract_limit'],
        minimalExample: {
            source: 'raw_message',
            paths: ['a.b.c'],
            flatten_short_array: false,
            extract_limit: 0
        },
        notes: [
            'flatten_short_array 是隐藏参数，用来控制单元素数组是否展开。',
            'extract_limit 为 0 表示不限制最大解析长度。'
        ]
    },
    {
        type: 'xml',
        title: 'XML解析',
        aliases: ['XML解析', 'xml'],
        purpose: '把 XML 字符串解析成字段，支持按 paths 选取子路径。',
        keyFields: ['source', 'paths', 'flatten_short_array', 'extract_limit'],
        minimalExample: {
            source: 'raw_message',
            paths: ['a.b.c'],
            flatten_short_array: false,
            extract_limit: 0
        },
        notes: [
            '和 JSON 解析一样，也支持 flatten_short_array 隐藏参数。',
            'extract_limit 为 0 表示不限制最大解析长度。'
        ]
    },
    {
        type: 'url',
        title: 'URL解析',
        aliases: ['URL解析', 'url'],
        purpose: '解析 URL 字段内容。',
        keyFields: ['source'],
        minimalExample: {
            source: 'request_url'
        },
        notes: [
            '文档里只有 source 这个核心字段。',
            '所有算子都可以额外带 condition。'
        ]
    },
    {
        type: 'user_agent',
        title: 'UserAgent解析',
        aliases: ['UserAgent解析', 'useragent', 'ua', 'user_agent'],
        purpose: '解析 User-Agent 字段内容。',
        keyFields: ['source'],
        minimalExample: {
            source: 'request_user_agent'
        },
        notes: [
            '文档里只有 source 这个核心字段。',
            '所有算子都可以额外带 condition。'
        ]
    },
    {
        type: 'drop_fields',
        title: '删除字段',
        aliases: ['删除字段', 'drop_fields', 'delete_fields'],
        purpose: '删除指定字段列表。',
        keyFields: ['source'],
        minimalExample: {
            source: ['a']
        },
        notes: [
            'source 这里是字段名数组，不是单个字符串。',
            '所有算子都可以额外带 condition。'
        ]
    },
    {
        type: 'geo',
        title: 'GEO解析',
        aliases: ['GEO解析', 'geo'],
        purpose: '根据 IP 字段补充地理位置信息。',
        keyFields: ['source', 'target', 'field'],
        minimalExample: {
            source: 'request_ip',
            target: 'geo',
            field: ['all']
        },
        notes: [
            'target 默认是 geo，但高级配置里可以改成任意字段名。',
            'field 可选值包括 all、city、province、country、isp、latitude、longitude、org。'
        ]
    },
    {
        type: 'mobile_phone',
        title: '手机号码解析',
        aliases: ['手机号码解析', 'phone', 'mobile_phone'],
        purpose: '解析手机号并输出到目标字段。',
        keyFields: ['source', 'target'],
        minimalExample: {
            source: 'phone',
            target: 'phone'
        },
        notes: [
            '和 GEO 解析类似，也可以单独控制 target。',
            'target 默认值是 phone。'
        ]
    },
    {
        type: 'telephone',
        title: '固定电话解析',
        aliases: ['固定电话解析', 'telephone'],
        purpose: '解析固定电话号码并输出到目标字段。',
        keyFields: ['source', 'target'],
        minimalExample: {
            source: 'telephone',
            target: 'telephone'
        },
        notes: [
            '和 GEO 解析类似，也可以单独控制 target。',
            'target 默认值是 telephone。'
        ]
    },
    {
        type: 'kv',
        title: 'KeyValue分解',
        aliases: ['KeyValue分解', 'kv', 'keyvalue'],
        purpose: '按分隔符拆解 key=value 形式的字段。',
        keyFields: ['source', 'field_split', 'value_split', 'drop_key_prefix', 'drop_key', 'reserved_key', 'duplicate_key_strategy'],
        minimalExample: {
            source: 'kv',
            field_split: [','],
            value_split: ['='],
            drop_key_prefix: [],
            drop_key: [],
            reserved_key: [],
            duplicate_key_strategy: 'use_last'
        },
        notes: [
            'duplicate_key_strategy 可选 use_first、use_last、merge_as_array。',
            'drop_key_prefix、drop_key、reserved_key 都是可选过滤项。'
        ]
    },
    {
        type: 'kv_regex',
        title: 'KeyValue正则匹配',
        aliases: ['KeyValue正则匹配', 'kv_regex', 'keyvalue_regex'],
        purpose: '通过组合正则来匹配和提取 KV 结构，适合格式更复杂的 KV 文本。',
        keyFields: ['source', 'kv_match_group[].key_regex', 'kv_match_group[].value_regex', 'kv_match_group[].value_split', 'kv_match_group[].group_regex', 'find_first_only', 'duplicate_key_strategy'],
        minimalExample: {
            source: 'kv',
            kv_match_group: [{
                key_regex: '\\w*',
                value_regex: '\\d*',
                value_split: ['='],
                group_regex: ''
            }],
            find_first_only: false,
            reserve_all_values_for_one_key: true,
            drop_key_prefix: [],
            drop_key: [],
            reserved_key: [],
            duplicate_key_strategy: 'use_last'
        },
        notes: [
            'group_regex 是隐藏高级参数，需要有且只有一个分组，并覆盖 group 到首个 KV 之间的分隔。',
            '如果带 reserve_all_values_for_one_key，duplicate_key_strategy 不生效。'
        ]
    },
    {
        type: 'csv_split',
        title: 'CSV解析(字段值拆分)',
        aliases: ['CSV解析', '字段值拆分', 'csv', 'csv_split'],
        purpose: '按分隔符或 CSV 语义拆分字段值。',
        keyFields: ['source', 'split_string', 'names', 'split_option'],
        minimalExample: {
            source: 'array',
            split_string: ',',
            names: ['field_1'],
            split_option: null
        },
        notes: [
            'names 为空时，结果会自动变成数组字段。',
            'split_option 为 null 时按正则分割；为 csv 时按 CSV 规则分割，split_string 只能是一个字符。'
        ]
    },
    {
        type: 'numeric_cast',
        title: '数值型字段转换',
        aliases: ['数值型字段转换', 'numeric', 'numeric_cast'],
        purpose: '把字段转换成 int 或 float。',
        keyFields: ['source', 'numeric_type', 'radix'],
        minimalExample: [{
            source: 'request_status',
            numeric_type: 'int',
            radix: 10
        }],
        notes: [
            '这个算子的高级配置本身是数组，每个元素对应一个字段转换规则。',
            'numeric_type 可选 int 或 float。'
        ]
    },
    {
        type: 'custom_dictionary',
        title: '自定义字典',
        aliases: ['自定义字典', 'dictionary', 'custom_dictionary'],
        purpose: '用已上传的字典做字段映射或扩展字段补全。',
        keyFields: ['source', 'id', 'field', 'match_type', 'ext_fields'],
        minimalExample: {
            source: 'error',
            id: '1',
            field: 'error_code',
            match_type: 'exact',
            ext_fields: ['code', 'name']
        },
        notes: [
            'id 是已存字典的内部 id，文档明确提示要谨慎修改。',
            'match_type 为 cidr 时支持 IPv4 或 IPv6，但字典文件不能混用两种 IP 类型。'
        ]
    },
    {
        type: 'timestamp',
        title: '时间戳识别',
        aliases: ['时间戳识别', 'timestamp'],
        purpose: '按时间格式列表识别并解析时间字段。',
        keyFields: ['source', 'prefix', 'max_lookahead', 'rule', 'zone', 'locale'],
        minimalExample: {
            source: 'timestamp',
            prefix: '',
            max_lookahead: 80,
            rule: ['yyyy-MM-dd HH:mm:ss', 'UNIX'],
            zone: 'Asia/Shanghai',
            locale: 'en'
        },
        notes: [
            'rule 是时间格式列表，不是单个字符串。',
            'zone 和 locale 用来控制时区与本地化。'
        ]
    },
    {
        type: 'ip_convert',
        title: 'IP格式转换',
        aliases: ['IP格式转换', 'ip_convert', 'long2ip'],
        purpose: '把 IP 字段做格式转换。',
        keyFields: ['source', 'op_type'],
        minimalExample: {
            source: 'ip',
            op_type: 'long2ip'
        },
        notes: [
            '文档示例里 op_type 可选值是 long2ip。',
            '所有算子都可以额外带 condition。'
        ]
    },
    {
        type: 'hex_decode',
        title: 'hex转换',
        aliases: ['hex转换', 'hex', 'hex_decode'],
        purpose: '按指定字节分隔符和编码把 hex 内容转换成字符串。',
        keyFields: ['source', 'split_string', 'codec_type'],
        minimalExample: {
            source: 'hex',
            split_string: ' ',
            codec_type: 'GBK'
        },
        notes: [
            'codec_type 可填写常见编码，如 GBK、UTF-8。',
            'split_string 用来指定字节之间的分隔符。'
        ]
    },
    {
        type: 'replace',
        title: '内容替换',
        aliases: ['内容替换', 'replace'],
        purpose: '对字段内容按正则做替换。',
        keyFields: ['source', 'target', 'regex', 'replacement', 'replace_first'],
        minimalExample: {
            source: 'a',
            target: 'a',
            regex: '(\\w*)=(\\d*)',
            replacement: '$1 $2',
            replace_first: true
        },
        notes: [
            'replacement 可以用 $n 引用正则分组。',
            'replace_first 为 false 时会尝试多次替换。'
        ]
    },
    {
        type: 'anonymize',
        title: '脱敏配置',
        aliases: ['脱敏配置', '脱敏', 'anonymize', 'anonymity'],
        purpose: '按正则替换字段内容，并可同步对原文做脱敏。',
        keyFields: ['source', 'regex', 'replacement', 'regex_prefix', 'regex_suffix', 'replace_first', 'anonymity'],
        minimalExample: {
            source: 'a',
            regex: '(\\w*)=(\\d*)',
            replacement: '$1 $2',
            regex_prefix: '',
            regex_suffix: '',
            replace_first: true,
            anonymity: true
        },
        notes: [
            'anonymity 必须为 true，用来和普通内容替换区分。',
            'regex_prefix 和 regex_suffix 用来定位原文中的脱敏范围。'
        ]
    },
    {
        type: 'format',
        title: '格式化处理',
        aliases: ['格式化处理', 'format', 'printf'],
        purpose: '把多个字段按模板拼成新的结果字段。',
        keyFields: ['params', 'target', 'printf'],
        minimalExample: {
            params: ['a', 'b'],
            target: 'c',
            printf: '$1 $2'
        },
        notes: [
            'printf 里可以用 $n 引用 params 中对应位置的字段。',
            '文档说明 printf 为空时，会做多个字段名合并。'
        ]
    },
    {
        type: 'struct_decode',
        title: '结构体解析',
        aliases: ['结构体解析', 'struct_decode'],
        purpose: '按结构体格式定义解析定长或结构化二进制/文本字段。',
        keyFields: ['source', 'codec_type', 'format', 'charset', 'strict_mode', 'strip_field'],
        minimalExample: {
            source: 'field',
            codec_type: 'struct_decode',
            format: 'a:1,b:2',
            charset: 'utf-8',
            strict_mode: false,
            strip_field: true
        },
        notes: [
            'codec_type 必填且固定为 struct_decode。',
            'strict_mode 为 true 时，字段长度和结构体定义不一致会直接失败。'
        ]
    },
    {
        type: 'rename',
        title: '重命名字段',
        aliases: ['重命名字段', 'rename'],
        purpose: '把字段名重命名到新的 target 字段。',
        keyFields: ['source', 'target', 'force'],
        minimalExample: {
            source: 'a',
            target: 'b',
            force: false
        },
        notes: [
            'source 支持正则。',
            'force 控制目标字段已存在时是否强制覆盖。'
        ]
    },
    {
        type: 'redirect',
        title: '重定向',
        aliases: ['重定向', 'redirect'],
        purpose: '跳转到指定字段提取规则继续处理。',
        keyFields: ['rule_id'],
        minimalExample: {
            rule_id: ''
        },
        notes: [
            'rule_id 是规则内部 id，文档明确提示要谨慎使用。',
            '所有算子都可以额外带 condition。'
        ]
    },
    {
        type: 'dissect',
        title: 'dissect解析',
        aliases: ['dissect解析', 'dissect'],
        purpose: '按固定分隔符格式高性能提取字段，适合字段顺序和分隔稳定的日志。',
        keyFields: ['source', 'format', 'strict_mode', 'enable_escape'],
        minimalExample: {
            source: '',
            format: '%{field}',
            strict_mode: false,
            enable_escape: false
        },
        notes: [
            '文档强调它对固定格式日志性能很高，Apache 访问日志场景下比正则高一个数量级。',
            'format 支持普通字段、类型字段、嵌套字段、KV 字段和空字段语法。'
        ]
    },
    {
        type: 'unicode_decode',
        title: 'unicode解析',
        aliases: ['unicode解析', 'unicode', 'unicode_decode'],
        purpose: '把 Python 风格的 unicode 转义文本解码成正常字符串。',
        keyFields: ['source', 'codec_type'],
        minimalExample: {
            source: '',
            codec_type: 'unicode_decode'
        },
        notes: [
            'codec_type 必填且固定为 unicode_decode。',
            '文档示例展示了 \\u5ba2\\u6237 这类内容被解码成人类可读文本。'
        ]
    },
    {
        type: 'base64_decode',
        title: 'base64解析',
        aliases: ['base64解析', 'base64', 'base64_decode'],
        purpose: '对 base64 编码日志先做解码。',
        keyFields: ['source', 'codec_type'],
        minimalExample: {
            source: 'raw_message',
            codec_type: 'base64decode'
        },
        notes: [
            '文档里这类规则需要通过自定义规则名称 codec 来配置。',
            'codec_type 在示例里固定为 base64decode。'
        ]
    },
    {
        type: 'metadata',
        title: 'metadata修改',
        aliases: ['metadata修改', 'metadata'],
        purpose: '修改元数据字段或控制部分处理流程元数据。',
        keyFields: ['source', 'value'],
        minimalExample: {
            source: '@index',
            value: 'metricidx'
        },
        notes: [
            '可修改 @source、@ip、@hostname、@tag、@appname、raw_message 等元数据。',
            '修改 @index 前，目标索引必须已经在索引配置里预定义。'
        ]
    }
];

function normalizeRuleType(value: string): string {
    return value
        .trim()
        .toLowerCase()
        .replace(/[\s_\-()/]+/g, '');
}

function buildAliasSet(reference: ParserRuleReference): string[] {
    return [reference.type, reference.title, ...reference.aliases];
}

export function listSupportedParserRuleTypes(): Array<{ type: string; title: string; aliases: string[] }> {
    return PARSER_RULE_REFERENCES.map((reference) => ({
        type: reference.type,
        title: reference.title,
        aliases: reference.aliases
    }));
}

export function getParserRuleReferenceCatalog(): {
    doc_source: string;
    total: number;
    supported_rule_types: Array<{ type: string; title: string; aliases: string[] }>;
} {
    return {
        doc_source: DOC_SOURCE,
        total: PARSER_RULE_REFERENCES.length,
        supported_rule_types: listSupportedParserRuleTypes()
    };
}

export function findParserRuleReference(ruleType: string): ParserRuleReference | null {
    const normalizedInput = normalizeRuleType(ruleType);
    if (!normalizedInput) {
        return null;
    }

    const exactMatch = PARSER_RULE_REFERENCES.find((reference) =>
        buildAliasSet(reference).some((alias) => normalizeRuleType(alias) === normalizedInput)
    );

    if (exactMatch) {
        return exactMatch;
    }

    return PARSER_RULE_REFERENCES.find((reference) =>
        buildAliasSet(reference).some((alias) => normalizeRuleType(alias).includes(normalizedInput))
    ) ?? null;
}

export function getParserRuleReferenceDocSource(): string {
    return DOC_SOURCE;
}
