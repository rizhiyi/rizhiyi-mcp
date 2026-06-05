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
    'log_reduce_',
    'generate_',
    'data_'
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
    'select_api_from_module',
    'gencode_callapi'
]);

function hasAnyPrefix(name: string, prefixes: string[]): boolean {
    return prefixes.some((prefix) => name.startsWith(prefix));
}

export function deriveToolAnnotations(toolName: string): ToolAnnotations {
    const isMutating = hasAnyPrefix(toolName, MUTATING_PREFIXES);
    const isReadOnly = READ_ONLY_EXACT_NAMES.has(toolName) || hasAnyPrefix(toolName, READ_ONLY_PREFIXES);

    if (toolName === 'gencode_callapi') {
        return {
            readOnlyHint: false,
            destructiveHint: true,
            idempotentHint: false,
            openWorldHint: true
        };
    }

    if (isMutating) {
        return {
            readOnlyHint: false,
            destructiveHint: true,
            idempotentHint: false,
            openWorldHint: true
        };
    }

    if (isReadOnly) {
        return {
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: true
        };
    }

    return {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true
    };
}
