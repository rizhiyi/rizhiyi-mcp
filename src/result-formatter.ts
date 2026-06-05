import yaml from 'js-yaml';

export type OutputFormat = 'auto' | 'yaml' | 'csv' | 'json';

export interface FormatOptions {
  outputFormat?: string;
  includeRawJson?: boolean;
  rawJsonData?: unknown;
}

function resolveStructuredArrayKey(toolName: string): string | undefined {
  switch (toolName) {
    case 'select_module':
      return 'modules';
    case 'select_api_from_module':
      return 'apis';
    case 'list_fields':
      return 'fields';
    case 'list_field_values':
      return 'values';
    case 'list_dashboard_tabs':
      return 'tabs';
    case 'list_dashboard_panels':
      return 'panels';
    case 'list_parserrules':
      return 'parserrules';
    case 'list_parserrule_references':
      return 'references';
    case 'list_fieldconfigs':
      return 'fieldconfigs';
    default:
      return undefined;
  }
}

function toFiniteNumber(value: unknown, fallback: number): number {
  const num = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function computeHasMore(total: number, page: number, size: number, returned: number): boolean {
  if (returned <= 0 || size <= 0) {
    return false;
  }
  const consumed = Math.max(0, page) * Math.max(0, size) + returned;
  return total > consumed;
}

function isSharedResourceEnvelopeLike(value: Record<string, unknown>): boolean {
  return value.delivery === 'resource' && typeof value.resource_uri === 'string';
}

function normalizeStructuredObject(toolName: string, value: Record<string, unknown>): Record<string, unknown> {
  if (isSharedResourceEnvelopeLike(value)) {
    return value;
  }

  switch (toolName) {
    case 'log_search_sheet': {
      const hits = Array.isArray(value.hits) ? value.hits : [];
      const total = toFiniteNumber(value.total, hits.length);
      const page = toFiniteNumber(value.page, 0);
      const size = toFiniteNumber(value.size, hits.length || 0);
      const returned = toFiniteNumber(value.returned, hits.length);
      const has_more = typeof value.has_more === 'boolean'
        ? value.has_more
        : computeHasMore(total, page, size, returned);

      return {
        ...value,
        hits,
        total,
        page,
        size,
        returned,
        has_more
      };
    }
    case 'list_fields': {
      const fields = Array.isArray(value.fields) ? value.fields : [];
      const total = toFiniteNumber(value.total, fields.length);
      return { ...value, fields, total };
    }
    case 'list_field_values': {
      const field = typeof value.field === 'string' ? value.field : '';
      const values = Array.isArray(value.values) ? value.values : [];
      const total = toFiniteNumber(value.total, values.length);
      return { ...value, field, values, total };
    }
    default:
      return value;
  }
}

function toStructuredContent(data: unknown, options: FormatOptions = {}, toolName?: string): Record<string, unknown> {
  const rawJsonData = typeof options.rawJsonData === 'undefined' ? data : options.rawJsonData;
  let structuredContent: Record<string, unknown>;

  if (Array.isArray(data)) {
    const semanticKey = toolName ? resolveStructuredArrayKey(toolName) : undefined;
    structuredContent = semanticKey ? { [semanticKey]: data } : { items: data };
  } else if (data && typeof data === 'object') {
    structuredContent = { ...(data as Record<string, unknown>) };
  } else {
    structuredContent = { value: data ?? null };
  }

  if (toolName && structuredContent && typeof structuredContent === 'object' && !Array.isArray(structuredContent)) {
    structuredContent = normalizeStructuredObject(toolName, structuredContent);
  }

  if (options.includeRawJson) {
    structuredContent.raw_json = rawJsonData;
  }

  return structuredContent;
}

function isScalar(value: unknown): boolean {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  );
}

function isFlatObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.values(value).every(isScalar);
}

function canRenderAsCsv(value: unknown): value is Record<string, unknown>[] {
  if (!Array.isArray(value) || value.length === 0) return false;
  return value.every((item) => isFlatObject(item));
}

function csvEscape(raw: unknown): string {
  const value = raw === null || typeof raw === 'undefined' ? '' : String(raw);
  if (value.includes('"') || value.includes(',') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function toCsv(rows: Record<string, unknown>[]): string {
  const allKeys = Array.from(
    rows.reduce((acc, row) => {
      Object.keys(row).forEach((k) => acc.add(k));
      return acc;
    }, new Set<string>())
  );

  const header = allKeys.join(',');
  const body = rows
    .map((row) => allKeys.map((key) => csvEscape(row[key])).join(','))
    .join('\n');

  return `${header}\n${body}`;
}

function normalizeOutputFormat(format: string | undefined): OutputFormat {
  const candidate = (format || 'auto').toLowerCase();
  if (candidate === 'yaml' || candidate === 'csv' || candidate === 'json' || candidate === 'auto') {
    return candidate;
  }
  return 'auto';
}

export function formatSuccessPayload(data: unknown, options: FormatOptions = {}): string {
  const outputFormat = normalizeOutputFormat(options.outputFormat);
  const includeRawJson = options.includeRawJson === true;
  const rawJsonData = typeof options.rawJsonData === 'undefined' ? data : options.rawJsonData;
  const actualData = includeRawJson ? { data, raw_json: rawJsonData } : data;

  if (outputFormat === 'json') {
    return JSON.stringify(actualData, null, 2);
  }

  if (outputFormat === 'csv') {
    if (canRenderAsCsv(data)) return toCsv(data);
    return yaml.dump(actualData, { noRefs: true, lineWidth: 120 });
  }

  if (outputFormat === 'yaml') {
    return yaml.dump(actualData, { noRefs: true, lineWidth: 120 });
  }

  if (canRenderAsCsv(data)) return toCsv(data);
  return yaml.dump(actualData, { noRefs: true, lineWidth: 120 });
}

export function buildSuccessResult(data: unknown, options: FormatOptions = {}): {
  content: Array<{ type: 'text'; text: string }>;
  structuredContent: Record<string, unknown>;
} {
  return {
    content: [{
      type: 'text',
      text: formatSuccessPayload(data, options)
    }],
    structuredContent: toStructuredContent(data, options)
  };
}

export function buildToolSuccessResult(toolName: string, data: unknown, options: FormatOptions = {}): {
  content: Array<{ type: 'text'; text: string }>;
  structuredContent: Record<string, unknown>;
} {
  return {
    content: [{
      type: 'text',
      text: formatSuccessPayload(data, options)
    }],
    structuredContent: toStructuredContent(data, options, toolName)
  };
}

export function formatErrorPayload(params: {
  error_code: string;
  message: string;
  suggestion?: string;
  retryable?: boolean;
  details?: unknown;
}): string {
  const payload = {
    error_code: params.error_code,
    message: params.message,
    suggestion: params.suggestion || '请根据错误提示修正参数后重试。',
    retryable: params.retryable !== false,
    details: params.details
  };

  return yaml.dump(payload, { noRefs: true, lineWidth: 120 });
}
