import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';

const READ_ONLY_PREFIXES = [
    'get_',
    'list_',
    'verify_',
    'evaluate_',
    'query_',
    'trend_',
    'anomaly_',
    'correlation_',
    'period_',
    'root_cause_',
    'log_search_',
    'log_reduce_'
    // 注意：不再包含 'generate_' 与 'data_'。
    // 这两个前缀语义过于宽泛，未来一旦出现真正写盘的 generate_*/data_* 工具，
    // 命中即会被误标为只读。已知的只读 generate_* 工具（generate_parserrule_draft）
    // 改由下方 TOOL_ANNOTATION_OVERRIDES 显式声明。
];

const MUTATING_PREFIXES = [
    'create_',
    'update_',
    'delete_',
    'remove_',
    'add_',
    'clone_'
];

const READ_ONLY_EXACT_NAMES = new Set([
    'select_module',
    'select_api_from_module'
]);

const READ_ONLY_ANNOTATIONS: ToolAnnotations = {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true
};

const MUTATING_ANNOTATIONS: ToolAnnotations = {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true
};

/**
 * 显式覆盖表：按工具名 keyed，优先于前缀推断。
 *
 * 仅收录“前缀推断会判错”的工具；前缀推断继续作为兜底，新增工具默认走前缀推断。
 * 每项都注明：为什么前缀推断判错 + 该工具的实际语义。
 */
const TOOL_ANNOTATION_OVERRIDES: Record<string, ToolAnnotations> = {
    // 前缀推断判错：不命中任何只读前缀，会落入默认分支被标成非只读。
    // 实际语义：自然语言生成 SPL，仅返回文本结果，不落盘、不改服务端状态。
    chat_spl: READ_ONLY_ANNOTATIONS,

    // 前缀推断判错：不命中任何只读前缀，会落入默认分支被标成非只读。
    // 实际语义：告警发送预览（/alerts/preview/submit/）只跑一遍条件匹配与渲染，
    // 明确“并不会真的触发创建”，不创建/更新监控。
    preview_alert: READ_ONLY_ANNOTATIONS,

    // 前缀推断判错：不命中任何前缀，会落入默认分支；但 testrun 很容易被误当成只读的“测试”。
    // 实际语义：按真实查询/窗口跑一遍并“尝试通知”，会向通知渠道发出消息（外部副作用），
    // 故非只读；它不修改监控配置，因此也非破坏性。
    testrun_alert: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true
    },

    // 前缀推断判错：MUTATING_PREFIXES 只有 add_ 而没有 replace_，会落入默认分支被标成非破坏性。
    // 实际语义：整体替换 pipeline 的 group 绑定，会移除既有绑定，属于破坏性写入。
    replace_pipeline_groups: MUTATING_ANNOTATIONS,

    // 前缀推断判错：generate_ 已从只读前缀中移除（语义过于宽泛），否则未来写盘工具会被误标只读。
    // 实际语义：基于样例日志生成 parserrule 初稿，仅返回草稿供人工确认后再 create/update，不落盘。
    generate_parserrule_draft: READ_ONLY_ANNOTATIONS,

    // 原特判，收进覆盖表：gencode_callapi 会执行生成的 API 调用，具备写入副作用。
    gencode_callapi: MUTATING_ANNOTATIONS
};

function hasAnyPrefix(name: string, prefixes: string[]): boolean {
    return prefixes.some((prefix) => name.startsWith(prefix));
}

export function deriveToolAnnotations(toolName: string): ToolAnnotations {
    // 优先查显式覆盖表。
    const override = TOOL_ANNOTATION_OVERRIDES[toolName];
    if (override) {
        return { ...override };
    }

    // 前缀推断仅作兜底。
    const isMutating = hasAnyPrefix(toolName, MUTATING_PREFIXES);
    const isReadOnly = READ_ONLY_EXACT_NAMES.has(toolName) || hasAnyPrefix(toolName, READ_ONLY_PREFIXES);

    if (isMutating) {
        return { ...MUTATING_ANNOTATIONS };
    }

    if (isReadOnly) {
        return { ...READ_ONLY_ANNOTATIONS };
    }

    return {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true
    };
}
