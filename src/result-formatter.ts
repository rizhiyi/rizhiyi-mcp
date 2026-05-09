import yaml from 'js-yaml';

export type OutputFormat = 'auto' | 'yaml' | 'csv' | 'json';

export interface FormatOptions {
  outputFormat?: string;
  includeRawJson?: boolean;
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
  const actualData = includeRawJson ? { data, raw_json: data } : data;

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
