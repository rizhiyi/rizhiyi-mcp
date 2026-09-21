import type { RuntimeConfig } from './config.js';

export type GuardrailAction = 'allow' | 'audit' | 'blocked';

const SPL_ROUTES = new Set(['log-tools', 'dashboard', 'alert', 'chatspl', 'manage', 'openapi']);
const NON_EXECUTING_QUERY_TOOLS = new Set(['alert/list_alerts']);
const QUERY_KEYS = new Set(['query', 'spl', 'spl_query', 'splQuery', 'extend_query', 'extendQuery']);
const TIME_KEYS = ['time_range', 'timeRange', 'timerange'];
const KNOWN_COMMANDS = new Set([
    'append', 'appendcols', 'collect', 'dbxexec', 'dbxlookup', 'dbxoutput', 'dbxquery',
    'delete', 'download', 'fit', 'foreach', 'fromes', 'fromkafkapy', 'history',
    'inputlookup', 'join', 'ldapfetch', 'ldapfilter', 'ldapgroup', 'ldapsearch',
    'loadjob', 'lookup2', 'map', 'mcollect', 'multireport', 'multisearch',
    'outputlookup', 'partition', 'rest', 'save', 'search', 'transaction', 'union'
]);
const SOURCE_GENERATING_COMMANDS = new Set([
    'dbxlookup', 'dbxquery', 'fromes', 'fromkafkapy', 'history', 'inputlookup',
    'ldapfetch', 'ldapfilter', 'ldapgroup', 'ldapsearch', 'loadjob', 'rest',
    'search', 'union', 'multisearch', 'multireport'
]);
const EXPENSIVE_COMMANDS = new Set(['transaction', 'map', 'join']);
const NESTED_COMMANDS = new Set(['union', 'multisearch', 'multireport', 'partition', 'foreach']);

export interface CompiledCustomPattern {
    pattern: RegExp;
    replacement: string;
}

export interface GuardrailConfig {
    enabled: boolean;
    mode: 'audit' | 'enforce';
    denyCommands: Set<string>;
    alertThreshold: number;
    rejectThreshold: number;
    ruleOverrides: Record<string, number>;
    safeTimerange: string;
    execTimeoutSeconds: number;
    maxEvents: number;
    sanitizeEnabled: boolean;
    sanitizeMasks: Set<string>;
    sanitizeCustomPatterns: CompiledCustomPattern[];
}

export interface RiskFinding {
    rule: string;
    score: number;
    message: string;
}

export interface QueryRiskAssessment {
    path: string;
    risk_score: number;
    commands: string[];
    denied_commands: string[];
    time_range?: string;
    findings: RiskFinding[];
}

export interface GuardrailAssessmentDetails {
    enabled: boolean;
    mode: 'audit' | 'enforce';
    action: GuardrailAction;
    risk_score: number;
    alert_threshold: number;
    reject_threshold: number;
    requires_review: boolean;
    commands: string[];
    denied_commands: string[];
    findings: RiskFinding[];
    queries: QueryRiskAssessment[];
    message: string;
    output: {
        sanitized_values: number;
        truncated_events: number;
        truncated_paths: string[];
    };
}

export class GuardrailAssessment {
    enabled: boolean;
    mode: 'audit' | 'enforce';
    action: GuardrailAction = 'allow';
    riskScore = 0;
    commands: string[] = [];
    deniedCommands: string[] = [];
    findings: RiskFinding[] = [];
    queries: QueryRiskAssessment[] = [];
    alertThreshold: number;
    rejectThreshold: number;
    message = '未发现 SPL 风险。';
    sanitizedValues = 0;
    truncatedEvents = 0;
    truncatedPaths: string[] = [];

    constructor(config: GuardrailConfig) {
        this.enabled = config.enabled;
        this.mode = config.mode;
        this.alertThreshold = config.alertThreshold;
        this.rejectThreshold = config.rejectThreshold;
    }

    get shouldBlock(): boolean {
        return this.action === 'blocked';
    }

    toDetails(): GuardrailAssessmentDetails {
        return {
            enabled: this.enabled,
            mode: this.mode,
            action: this.action,
            risk_score: this.riskScore,
            alert_threshold: this.alertThreshold,
            reject_threshold: this.rejectThreshold,
            requires_review: this.riskScore >= this.alertThreshold,
            commands: this.commands,
            denied_commands: this.deniedCommands,
            findings: this.findings,
            queries: this.queries,
            message: this.message,
            output: {
                sanitized_values: this.sanitizedValues,
                truncated_events: this.truncatedEvents,
                truncated_paths: this.truncatedPaths
            }
        };
    }
}

interface SplCandidate {
    path: string;
    query: string;
    timeRange?: string;
}

export function guardrailConfigFromRuntime(runtimeConfig: RuntimeConfig): GuardrailConfig {
    return runtimeConfig.guardrails;
}

export function assessToolArguments(
    config: GuardrailConfig,
    routeName: string,
    toolName: string,
    argumentsValue: Record<string, unknown>
): GuardrailAssessment {
    const assessment = new GuardrailAssessment(config);
    if (!config.enabled) return assessment;
    return assessCandidates(config, extractSplCandidates(routeName, toolName, argumentsValue));
}

export function assessGeneratedSpl(
    config: GuardrailConfig,
    routeName: string,
    toolName: string,
    payload: unknown
): GuardrailAssessment {
    const assessment = new GuardrailAssessment(config);
    if (!config.enabled || routeName !== 'chatspl' || toolName !== 'chat_spl') return assessment;

    const candidates: SplCandidate[] = [];
    const visit = (value: unknown, path: string): void => {
        if (Array.isArray(value)) {
            value.forEach((item, index) => visit(item, `${path}[${index}]`));
            return;
        }
        if (!isPlainObject(value)) return;
        for (const [key, item] of Object.entries(value)) {
            const childPath = `${path}.${key}`;
            if (key === 'spl' && typeof item === 'string' && item.trim()) {
                candidates.push({ path: childPath, query: item.trim() });
            } else {
                visit(item, childPath);
            }
        }
    };
    visit(payload, 'result');
    return assessCandidates(config, candidates);
}

export function extractSplCandidates(
    routeName: string,
    toolName: string,
    argumentsValue: Record<string, unknown>
): SplCandidate[] {
    if (!SPL_ROUTES.has(routeName) || NON_EXECUTING_QUERY_TOOLS.has(`${routeName}/${toolName}`)) return [];
    const candidates: SplCandidate[] = [];
    const seen = new Set<string>();

    const add = (path: string, query: string, timeRange?: string): void => {
        const normalized = query.trim();
        if (!normalized) return;
        const marker = `${path}\u0000${normalized}\u0000${timeRange || ''}`;
        if (seen.has(marker)) return;
        seen.add(marker);
        candidates.push({ path, query: normalized, timeRange });
    };

    const visit = (value: unknown, path: string, inheritedTimeRange?: string): void => {
        if (Array.isArray(value)) {
            value.forEach((item, index) => visit(item, `${path}[${index}]`, inheritedTimeRange));
            return;
        }
        if (!isPlainObject(value)) return;
        const localTimeRange = findTimeRange(value) || inheritedTimeRange;
        for (const [key, item] of Object.entries(value)) {
            const childPath = `${path}.${key}`;
            if (QUERY_KEYS.has(key) && typeof item === 'string') {
                add(childPath, item, localTimeRange);
                continue;
            }
            if (key === 'knowledge_text' && typeof item === 'string') {
                const parsed = tryParseJson(item);
                if (isPlainObject(parsed) && typeof parsed.output === 'string') {
                    add(`${childPath}.output`, parsed.output, localTimeRange);
                }
                continue;
            }
            if (key === 'alert' && typeof item === 'string') {
                const parsed = tryParseJson(item);
                if (typeof parsed !== 'undefined') visit(parsed, childPath, localTimeRange);
                continue;
            }
            visit(item, childPath, localTimeRange);
        }
    };

    visit(argumentsValue, `${routeName}/${toolName}`);
    return candidates;
}

export function assessSplQuery(
    query: string,
    path: string,
    timeRange: string | undefined,
    config: GuardrailConfig
): QueryRiskAssessment {
    const commandSegments = extractCommandSegments(query);
    const commands = commandSegments.map(([command]) => command);
    const uniqueCommands = unique(commands);
    const deniedCommands = unique(commands.filter((command) => config.denyCommands.has(command))).sort();
    const findings: RiskFinding[] = [];
    const add = (rule: string, defaultScore: number, message: string, multiplier = 1): void => {
        const score = (config.ruleOverrides[rule] ?? defaultScore) * multiplier;
        if (score > 0) findings.push({ rule, score, message });
    };

    if (commands.includes('delete')) add('delete', 80, 'delete 会删除原始日志。');
    if (commands.includes('lookup2')) add('external_command', 40, 'lookup2 会执行自定义 Python 模块。');

    const collectSegments = commandSegments.filter(([command]) => command === 'collect').map(([, segment]) => segment);
    if (collectSegments.some((segment) => !/\btestmode\s*=\s*true\b/i.test(segment))) {
        add('collect', 25, 'collect 未启用 testmode=true，会把结果写回索引。');
    }
    const outputlookupSegments = commandSegments.filter(([command]) => command === 'outputlookup').map(([, segment]) => segment);
    if (outputlookupSegments.some((segment) => /\boverride\s*=\s*true\b/i.test(segment))) {
        add('outputlookup_override', 20, 'outputlookup override=true 可能覆盖已有字典。');
    }

    const expensiveCount = commands.filter((command) => EXPENSIVE_COMMANDS.has(command)).length;
    if (expensiveCount) {
        add('expensive_command', 20, `检测到 ${expensiveCount} 个 transaction/map/join 高开销命令。`, expensiveCount);
    }
    const appendCount = commands.filter((command) => command === 'append' || command === 'appendcols').length;
    if (appendCount) add('append', 15, `检测到 ${appendCount} 个 append/appendcols 内存敏感命令。`, appendCount);
    const nestedCount = commands.filter((command) => NESTED_COMMANDS.has(command)).length;
    if (nestedCount) add('nested_search', 15, `检测到 ${nestedCount} 个可展开子搜索的命令。`, nestedCount);

    const unboundedSubsearches = countUnboundedSubsearches(query);
    if (unboundedSubsearches) {
        add('unbounded_subsearch', 20, `检测到 ${unboundedSubsearches} 个未显式限制结果量的子搜索。`, unboundedSubsearches);
    }
    for (const [command, segment] of commandSegments) {
        if (command !== 'map') continue;
        const match = segment.match(/\bmaxsearches\s*=\s*(\d+)/i);
        if (!match || Number(match[1]) > 10) {
            add('map_unbounded', 20, 'map 未设置 maxsearches，或 maxsearches 大于 10。');
            break;
        }
    }

    const indexRisk = assessIndexScope(query, uniqueCommands);
    if (indexRisk === 'wildcard_constrained') add('index_wildcard_constrained', 20, '查询使用 index=*，但存在字段约束。');
    if (indexRisk === 'broad') add('index_broad', 35, '查询未限定具体索引或字段范围，可能扫描过多数据。');

    const timeKind = assessTimeRange(query, timeRange, config.safeTimerange);
    if (timeKind === 'exceeds_safe') add('time_range_exceeds', 20, `查询时间范围超过安全窗口 ${config.safeTimerange}。`);
    if (timeKind === 'all_time') add('time_range_all', 50, '查询使用全时间范围。');
    if (timeKind === 'no_time') add('time_range_missing', 50, '查询未声明时间范围。');

    return {
        path,
        risk_score: Math.min(100, findings.reduce((total, item) => total + item.score, 0)),
        commands: uniqueCommands,
        denied_commands: deniedCommands,
        time_range: timeRange,
        findings
    };
}

export function extractCommandSegments(query: string): Array<[string, string]> {
    const results: Array<[string, string]> = [];
    const visited = new Set<string>();
    const scan = (value: string): void => {
        const normalized = value.trim();
        if (!normalized || visited.has(normalized)) return;
        visited.add(normalized);
        const segments = splitPipeline(normalized);
        const startsWithPipe = normalized.startsWith('|');
        segments.forEach((rawSegment, index) => {
            const segment = rawSegment.trim().replace(/^\[+/, '').trim();
            const match = segment.match(/^([a-zA-Z][\w]*)\b/);
            if (!match) return;
            const command = match[1].toLowerCase();
            const isCommandPosition = index > 0 || startsWithPipe || SOURCE_GENERATING_COMMANDS.has(command);
            if (!isCommandPosition || !KNOWN_COMMANDS.has(command)) return;
            results.push([command, segment]);
            if (command === 'map') extractMapQueries(segment).forEach((item) => scan(item));
        });
        extractBracketContents(normalized).forEach((item) => scan(item));
    };
    scan(query);
    return results;
}

export function countUnboundedSubsearches(query: string): number {
    return extractBracketContents(query)
        .filter((content) => !/\b(?:maxout|maxresults|maxsearches|head)\b/i.test(content))
        .length;
}

export function applyOutputGuardrails(
    data: unknown,
    config: GuardrailConfig
): { data: unknown; sanitizedValues: number; truncatedEvents: number; truncatedPaths: string[] } {
    if (!config.enabled) return { data, sanitizedValues: 0, truncatedEvents: 0, truncatedPaths: [] };
    const truncated = truncateOutput(data, config.maxEvents);
    const sanitized = sanitizeOutput(truncated.data, config);
    return {
        data: sanitized.data,
        sanitizedValues: sanitized.count,
        truncatedEvents: truncated.count,
        truncatedPaths: truncated.paths
    };
}

export function sanitizeOutput(data: unknown, config: GuardrailConfig): { data: unknown; count: number } {
    if (!config.enabled || !config.sanitizeEnabled) return { data, count: 0 };
    let count = 0;
    const sanitizeString = (value: string): string => {
        let result = value;
        if (config.sanitizeMasks.has('credit_card')) {
            result = result.replace(/(?<!\d)(?:\d[ -]?){12,18}\d(?!\d)/g, (match) => {
                const digits = match.replace(/\D/g, '');
                if (!passesLuhn(digits)) return match;
                count++;
                return `****-****-****-${digits.slice(-4)}`;
            });
        }
        if (config.sanitizeMasks.has('ssn')) {
            result = result.replace(/(?<!\d)\d{3}-\d{2}-\d{4}(?!\d)/g, () => {
                count++;
                return '***-**-****';
            });
        }
        for (const item of config.sanitizeCustomPatterns) {
            item.pattern.lastIndex = 0;
            const matches = result.match(item.pattern);
            count += matches?.length || 0;
            item.pattern.lastIndex = 0;
            result = result.replace(item.pattern, item.replacement);
        }
        return result;
    };
    const visit = (value: unknown): unknown => {
        if (typeof value === 'string') return sanitizeString(value);
        if (Array.isArray(value)) return value.map(visit);
        if (isPlainObject(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, visit(item)]));
        return value;
    };
    return { data: visit(data), count };
}

export function truncateOutput(data: unknown, maxEvents: number): { data: unknown; count: number; paths: string[] } {
    let count = 0;
    const paths: string[] = [];
    const visit = (value: unknown, path: string): unknown => {
        if (Array.isArray(value)) {
            let items = value;
            if (items.length > maxEvents) {
                count += items.length - maxEvents;
                paths.push(path);
                items = items.slice(0, maxEvents);
            }
            return items.map((item, index) => visit(item, `${path}[${index}]`));
        }
        if (isPlainObject(value)) {
            return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, visit(item, `${path}.${key}`)]));
        }
        return value;
    };
    return { data: visit(data, 'result'), count, paths };
}

export function mergeAssessments(primary: GuardrailAssessment, secondary: GuardrailAssessment): GuardrailAssessment {
    if (!secondary.enabled || secondary.queries.length === 0) return primary;
    const config: GuardrailConfig = {
        enabled: true,
        mode: primary.mode,
        denyCommands: new Set(),
        alertThreshold: primary.alertThreshold,
        rejectThreshold: primary.rejectThreshold,
        ruleOverrides: {},
        safeTimerange: '24h',
        execTimeoutSeconds: 60,
        maxEvents: 1000,
        sanitizeEnabled: true,
        sanitizeMasks: new Set(),
        sanitizeCustomPatterns: []
    };
    const merged = new GuardrailAssessment(config);
    merged.queries = [...primary.queries, ...secondary.queries];
    finalizeAssessment(merged);
    return merged;
}

function assessCandidates(config: GuardrailConfig, candidates: SplCandidate[]): GuardrailAssessment {
    const assessment = new GuardrailAssessment(config);
    assessment.queries = candidates.map((candidate) => assessSplQuery(
        candidate.query,
        candidate.path,
        candidate.timeRange,
        config
    ));
    finalizeAssessment(assessment);
    return assessment;
}

function finalizeAssessment(assessment: GuardrailAssessment): void {
    assessment.riskScore = Math.max(0, ...assessment.queries.map((item) => item.risk_score));
    assessment.commands = unique(assessment.queries.flatMap((item) => item.commands)).sort();
    assessment.deniedCommands = unique(assessment.queries.flatMap((item) => item.denied_commands)).sort();
    assessment.findings = assessment.queries.flatMap((item) => item.findings);
    const shouldRejectScore = assessment.rejectThreshold < 100 && assessment.riskScore >= assessment.rejectThreshold;
    if (assessment.mode === 'enforce' && (assessment.deniedCommands.length > 0 || shouldRejectScore)) {
        assessment.action = 'blocked';
        assessment.message = assessment.deniedCommands.length > 0
            ? `SPL 包含禁止命令: ${assessment.deniedCommands.join(', ')}。`
            : `SPL 风险分 ${assessment.riskScore} 达到拒绝阈值 ${assessment.rejectThreshold}。`;
    } else if (assessment.queries.length > 0 && (assessment.deniedCommands.length > 0 || assessment.riskScore >= assessment.alertThreshold)) {
        assessment.action = 'audit';
        assessment.message = `SPL 风险分 ${assessment.riskScore}；建议与日志易管理员复核后执行。`;
    } else if (assessment.findings.length > 0) {
        assessment.action = 'audit';
        assessment.message = `SPL 风险分 ${assessment.riskScore}，已记录审计信息。`;
    } else {
        assessment.action = 'allow';
        assessment.message = 'SPL 检查通过，未发现已配置的风险模式。';
    }
}

function findTimeRange(value: Record<string, unknown>): string | undefined {
    for (const key of TIME_KEYS) {
        const item = value[key];
        if (typeof item === 'string' && item.trim()) return item.trim();
    }
    const checkCondition = value.check_condition || value.checkCondition;
    if (isPlainObject(checkCondition) && typeof checkCondition.timerange === 'string' && checkCondition.timerange.trim()) {
        return checkCondition.timerange.trim();
    }
    return undefined;
}

function splitPipeline(query: string): string[] {
    const segments: string[] = [];
    let start = 0;
    let quote: string | undefined;
    let escaped = false;
    let bracketDepth = 0;
    for (let index = 0; index < query.length; index++) {
        const character = query[index];
        if (escaped) { escaped = false; continue; }
        if (character === '\\' && quote) { escaped = true; continue; }
        if (quote) { if (character === quote) quote = undefined; continue; }
        if (character === '"' || character === "'") { quote = character; continue; }
        if (character === '[') { bracketDepth++; continue; }
        if (character === ']' && bracketDepth > 0) { bracketDepth--; continue; }
        if (character === '|' && bracketDepth === 0) {
            segments.push(query.slice(start, index));
            start = index + 1;
        }
    }
    segments.push(query.slice(start));
    return segments;
}

function extractBracketContents(query: string): string[] {
    const contents: string[] = [];
    const stack: number[] = [];
    let quote: string | undefined;
    let escaped = false;
    for (let index = 0; index < query.length; index++) {
        const character = query[index];
        if (escaped) { escaped = false; continue; }
        if (character === '\\' && quote) { escaped = true; continue; }
        if (quote) { if (character === quote) quote = undefined; continue; }
        if (character === '"' || character === "'") { quote = character; continue; }
        if (character === '[') stack.push(index);
        if (character === ']' && stack.length > 0) {
            const start = stack.pop()!;
            if (stack.length === 0) {
                const content = query.slice(start + 1, index).trim().replace(/^\[|\]$/g, '').trim();
                if (content) contents.push(content);
            }
        }
    }
    return contents;
}

function extractMapQueries(segment: string): string[] {
    const queries: string[] = [];
    const pattern = /\b(?:search|query)\s*=\s*(['"])/gi;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(segment)) !== null) {
        const quote = match[1];
        let index = pattern.lastIndex;
        let escaped = false;
        let buffer = '';
        while (index < segment.length) {
            const character = segment[index];
            if (escaped) { buffer += character; escaped = false; }
            else if (character === '\\') escaped = true;
            else if (character === quote) break;
            else buffer += character;
            index++;
        }
        if (buffer) queries.push(buffer);
    }
    return queries;
}

function assessIndexScope(query: string, commands: string[]): 'safe' | 'wildcard_constrained' | 'broad' {
    if (commands.some((command) => SOURCE_GENERATING_COMMANDS.has(command))) return 'safe';
    const baseQuery = splitPipeline(query)[0];
    const indexMatch = baseQuery.match(/(?<![\w.])index\s*(?::|=)\s*(['"]?)([^\s|,)]+)\1/i);
    const constraints = [...baseQuery.matchAll(/(?<![\w.])(?:['"]?[a-zA-Z_][\w.]*['"]?)\s*(?::|=)\s*(?!\*)[^\s|,)]+/g)]
        .map((item) => item[0])
        .filter((item) => !item.toLowerCase().replace(/^['"]/, '').startsWith('index'));
    if (indexMatch) {
        const value = indexMatch[2].replace(/^['"]|['"]$/g, '').toLowerCase();
        if (['*', 'all', 'alltime'].includes(value)) return constraints.length > 0 ? 'wildcard_constrained' : 'broad';
        return 'safe';
    }
    return constraints.length > 0 ? 'safe' : 'broad';
}

function assessTimeRange(query: string, timeRange: string | undefined, safeTimerange: string): 'safe' | 'exceeds_safe' | 'all_time' | 'no_time' {
    const safeHours = parseTimeToHours(safeTimerange);
    if (timeRange) {
        const duration = parseTimeRangeToHours(timeRange);
        if (!Number.isFinite(duration)) return 'all_time';
        return duration > safeHours ? 'exceeds_safe' : 'safe';
    }
    const earliest = query.match(/\bearliest(?:_time)?\s*=\s*([^\s|]+)/i)?.[1];
    const latest = query.match(/\blatest(?:_time)?\s*=\s*([^\s|]+)/i)?.[1];
    if (earliest || latest) {
        const duration = durationBetween(earliest || 'now', latest || 'now');
        if (!Number.isFinite(duration)) return 'all_time';
        return duration > safeHours ? 'exceeds_safe' : 'safe';
    }
    if (/\ball\s*time\b|\balltime\b/i.test(query)) return 'all_time';
    return 'no_time';
}

export function parseTimeRangeToHours(value: string): number {
    const normalized = value.trim().toLowerCase();
    if (['0', 'all', 'alltime', 'all time', '*'].includes(normalized)) return Infinity;
    if (normalized.includes(',')) {
        const [start, end] = normalized.split(',', 2).map((item) => item.trim());
        return durationBetween(start, end);
    }
    const offset = parseRelativeOffsetHours(normalized);
    return offset === undefined ? parseTimeToHours(normalized) : Math.abs(offset);
}

export function parseTimeToHours(value: string): number {
    let normalized = value.trim().toLowerCase();
    if (['0', 'all', 'alltime', 'all time', '*'].includes(normalized)) return Infinity;
    normalized = normalized.replace(/@\w+$/, '').replace(/^now/, '');
    const match = normalized.match(/^([+-]?\d+(?:\.\d+)?)\s*(s|sec|m|min|h|hour|d|day|w|week|mon|q|y)?$/);
    if (!match) return 24;
    const amount = Math.abs(Number(match[1]));
    const multipliers: Record<string, number> = {
        s: 1 / 3600, sec: 1 / 3600, m: 1 / 60, min: 1 / 60,
        h: 1, hour: 1, d: 24, day: 24, w: 168, week: 168,
        mon: 720, q: 2184, y: 8760
    };
    return amount * multipliers[match[2] || 'h'];
}

function durationBetween(start: string, end: string): number {
    if (['0', 'all', 'alltime', 'all time', '*'].includes(start.trim().toLowerCase())) return Infinity;
    const startOffset = parseRelativeOffsetHours(start);
    const endOffset = parseRelativeOffsetHours(end);
    if (typeof startOffset === 'number' && typeof endOffset === 'number') return Math.abs(endOffset - startOffset);
    const startTime = Date.parse(start);
    const endTime = Date.parse(end);
    if (Number.isFinite(startTime) && Number.isFinite(endTime)) return Math.abs(endTime - startTime) / 3_600_000;
    return 24;
}

function parseRelativeOffsetHours(value: string): number | undefined {
    let normalized = value.trim().toLowerCase();
    if (normalized === 'now') return 0;
    normalized = normalized.replace(/@\w+$/, '').replace(/^now/, '');
    const match = normalized.match(/^([+-]?\d+(?:\.\d+)?)\s*(s|sec|m|min|h|hour|d|day|w|week|mon|q|y)$/);
    if (!match) return undefined;
    const multipliers: Record<string, number> = {
        s: 1 / 3600, sec: 1 / 3600, m: 1 / 60, min: 1 / 60,
        h: 1, hour: 1, d: 24, day: 24, w: 168, week: 168,
        mon: 720, q: 2184, y: 8760
    };
    return Number(match[1]) * multipliers[match[2]];
}

function tryParseJson(value: string): unknown | undefined {
    try { return JSON.parse(value); } catch { return undefined; }
}

function passesLuhn(digits: string): boolean {
    if (digits.length < 13 || digits.length > 19 || new Set(digits).size === 1) return false;
    let total = 0;
    const parity = digits.length % 2;
    for (let index = 0; index < digits.length; index++) {
        let value = Number(digits[index]);
        if (index % 2 === parity) {
            value *= 2;
            if (value > 9) value -= 9;
        }
        total += value;
    }
    return total % 10 === 0;
}

function isPlainObject(value: unknown): value is Record<string, any> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function unique<T>(items: T[]): T[] {
    return [...new Set(items)];
}
