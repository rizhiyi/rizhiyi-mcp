import { LogEaseClient } from '../client.js';

const VERIFY_SAMPLE_TEXT_KEYS = [
    'raw_message',
    'rawMessage',
    'message',
    'log',
    'content'
] as const;

export class FieldConfigModule {
    constructor(private client: LogEaseClient) {}

    async listFieldConfigs(): Promise<any> {
        const response = await this.client.get('/api/v3/fieldconfigs/');
        if (response.error) {
            return response;
        }

        if (response.data && typeof response.data === 'object' && (response.data as any).result === false) {
            return this.buildError(
                'UPSTREAM_BUSINESS_ERROR',
                'list_fieldconfigs 上游接口返回失败。',
                '请稍后重试；如果问题持续，请检查 fieldconfigs 列表接口状态。',
                response.data
            );
        }

        return {
            ...response,
            raw_data: response.data,
            data: this.formatFieldConfigListResponse(response.data)
        };
    }

    async verifyFieldConfig(params: any): Promise<any> {
        const request = this.buildVerifyRequest(params);
        if (request.error) {
            return request.error;
        }
        const verifiedRequest = request as { payload: Record<string, unknown> };

        const response = await this.client.post('/api/v3/fieldconfigs/verify/', verifiedRequest.payload);
        if (response.error) {
            return response;
        }

        if (response.data && typeof response.data === 'object' && (response.data as any).result === false) {
            return this.buildError(
                'UPSTREAM_BUSINESS_ERROR',
                'verify_fieldconfig 上游接口返回失败。',
                '请检查 rule 与 contents 是否匹配；如果参数没问题，再检查上游 fieldconfigs/verify 接口状态。',
                response.data
            );
        }

        return {
            ...response,
            raw_data: response.data,
            data: this.formatVerifyResponse(response.data, verifiedRequest.payload)
        };
    }

    async getFieldConfigPropsReference(): Promise<any> {
        const response = await this.client.get('/api/v3/fieldconfigs/get_props_list/');
        if (response.error) {
            return response;
        }

        if (response.data && typeof response.data === 'object' && (response.data as any).result === false) {
            return this.buildError(
                'UPSTREAM_BUSINESS_ERROR',
                'get_fieldconfig_props_reference 上游接口返回失败。',
                '请稍后重试；如果问题持续，请检查 fieldconfigs props 接口状态。',
                response.data
            );
        }

        return {
            ...response,
            raw_data: response.data,
            data: this.formatPropsReferenceResponse(response.data)
        };
    }

    async getFieldConfigTransformReference(): Promise<any> {
        const response = await this.client.get('/api/v3/fieldconfigs/get_transform_list/');
        if (response.error) {
            return response;
        }

        if (response.data && typeof response.data === 'object' && (response.data as any).result === false) {
            return this.buildError(
                'UPSTREAM_BUSINESS_ERROR',
                'get_fieldconfig_transform_reference 上游接口返回失败。',
                '请稍后重试；如果问题持续，请检查 fieldconfigs transform 接口状态。',
                response.data
            );
        }

        return {
            ...response,
            raw_data: response.data,
            data: this.formatTransformReferenceResponse(response.data)
        };
    }

    private buildVerifyRequest(params: any): { payload: Record<string, unknown>; error?: never } | { error: any } {
        const rule = typeof params?.rule === 'string' ? params.rule.trim() : '';
        if (!rule) {
            return {
                error: this.buildError(
                    'MISSING_REQUIRED_PARAM',
                    'verify_fieldconfig 需要 rule。',
                    '请提供动态字段规则字符串，例如正则表达式。'
                )
            };
        }

        const contents = this.normalizeContents(params?.contents);
        if (contents.error) {
            return { error: contents.error };
        }
        const normalizedContents = contents as { value: any[] };

        if (normalizedContents.value.length === 0) {
            return {
                error: this.buildError(
                    'EMPTY_CONTENTS',
                    'verify_fieldconfig 的 contents 不能为空。',
                    '请至少提供 1 条待校验内容；支持对象数组、字符串数组、单个对象或字符串。'
                )
            };
        }

        return {
            payload: {
                rule,
                contents: normalizedContents.value
            }
        };
    }

    private normalizeContents(rawValue: unknown): { value: any[]; error?: never } | { error: any } {
        if (typeof rawValue === 'undefined' || rawValue === null) {
            return {
                error: this.buildError(
                    'MISSING_REQUIRED_PARAM',
                    'verify_fieldconfig 需要 contents。',
                    '请提供待校验内容；支持对象数组、字符串数组、单个对象或字符串。'
                )
            };
        }

        if (typeof rawValue === 'string') {
            const trimmed = rawValue.trim();
            if (!trimmed) {
                return { value: [] };
            }

            if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
                const parsed = this.parseJsonStringField(trimmed, 'contents');
                if (parsed.error) {
                    return { error: parsed.error };
                }
                return this.normalizeContents((parsed as { value: any }).value);
            }

            return { value: [{ raw_message: trimmed }] };
        }

        if (Array.isArray(rawValue)) {
            return { value: rawValue.map((item) => this.normalizeContentEntry(item)) };
        }

        if (this.isPlainObject(rawValue)) {
            return { value: [this.normalizeContentEntry(rawValue)] };
        }

        return {
            error: this.buildError(
                'INVALID_PARAM_TYPE',
                'verify_fieldconfig 的 contents 必须是数组、对象、字符串，或合法 JSON 字符串。',
                '请把 contents 传成字符串数组、对象数组、单个对象，或传入可解析为这些结构的 JSON 字符串。'
            )
        };
    }

    private normalizeContentEntry(content: unknown): any {
        if (typeof content === 'string') {
            return { raw_message: content };
        }

        if (this.isPlainObject(content)) {
            return content;
        }

        return { raw_message: String(content) };
    }

    private parseJsonStringField(rawValue: string, fieldName: string): { value: any; error?: never } | { error: any } {
        try {
            return { value: JSON.parse(rawValue) };
        } catch (error: any) {
            return {
                error: this.buildError(
                    'INVALID_JSON',
                    `verify_fieldconfig 的 ${fieldName} 不是合法 JSON。`,
                    `请检查 ${fieldName} 的 JSON 语法，例如引号、逗号、括号是否完整；如果本意不是传 JSON，请改用原生对象/数组。`,
                    {
                        field: fieldName,
                        parse_error: error?.message || 'JSON parse failed',
                        preview: rawValue.slice(0, 300)
                    }
                )
            };
        }
    }

    private formatFieldConfigListResponse(data: any): any {
        const objects = Array.isArray(data?.objects) ? data.objects : [];
        const items = objects.map((item: any, index: number) => {
            const props = this.isPlainObject(item?.props) ? item.props : {};
            const transform = this.isPlainObject(item?.transform) ? item.transform : {};
            const propScopes = Object.keys(props);
            const transformNames = Object.keys(transform);

            return {
                index,
                app_name: item?.app_name ?? null,
                app_id: item?.app_id ?? null,
                prop_scopes: propScopes,
                prop_scope_count: propScopes.length,
                prop_template_count: this.countNestedEntries(props),
                transform_names: transformNames,
                transform_count: transformNames.length,
                props,
                transform
            };
        });

        return {
            traceid: data?.traceid,
            upstream_result: data?.result,
            summary: {
                total_configs: items.length,
                app_names: items.map((item: any) => item.app_name).filter(Boolean)
            },
            items
        };
    }

    private formatVerifyResponse(data: any, requestPayload: Record<string, unknown>): any {
        const contents = Array.isArray(data?.contents) ? data.contents : [];
        const samples = contents.map((content: any, index: number) => ({
            index,
            raw_message: this.extractSampleText(content),
            extracted_field_names: this.isPlainObject(content?.fields) ? Object.keys(content.fields) : [],
            extracted_fields: this.isPlainObject(content?.fields) ? content.fields : {},
            time_cost_us: typeof content?.timeCostUs === 'number' ? content.timeCostUs : this.tryToNumber(content?.timeCostUs),
            runtime: typeof content?.runtime === 'number' ? content.runtime : this.tryToNumber(content?.runtime),
            success: this.isPlainObject(content?.fields) ? Object.keys(content.fields).length > 0 : false
        }));
        const successCount = samples.filter((item: any) => item.success).length;
        const failureCount = samples.length - successCount;

        return {
            traceid: data?.traceid,
            upstream_result: data?.result,
            request_overview: {
                rule: requestPayload.rule,
                content_count: Array.isArray(requestPayload.contents) ? requestPayload.contents.length : 0
            },
            summary: {
                total_samples: samples.length,
                success_count: successCount,
                failure_count: failureCount
            },
            samples
        };
    }

    private formatPropsReferenceResponse(data: any): any {
        const objects = Array.isArray(data?.objects) ? data.objects : [];
        const scopes = new Set<string>();
        const configTypes = new Set<string>();
        const entries: any[] = [];

        objects.forEach((item: any) => {
            const dynamicKeyNames = this.isPlainObject(item?.dynamicKeyNames) ? item.dynamicKeyNames : {};
            Object.entries(dynamicKeyNames).forEach(([scopeName, scopeValue]) => {
                scopes.add(scopeName);

                if (!this.isPlainObject(scopeValue)) {
                    entries.push({
                        scope: scopeName,
                        config_type: 'unknown',
                        template_name: null,
                        key_fields: this.extractTopLevelKeys(scopeValue),
                        example: scopeValue
                    });
                    return;
                }

                Object.entries(scopeValue).forEach(([configType, templateMap]) => {
                    configTypes.add(configType);

                    if (!this.isPlainObject(templateMap)) {
                        entries.push({
                            scope: scopeName,
                            config_type: configType,
                            template_name: null,
                            key_fields: this.extractTopLevelKeys(templateMap),
                            example: templateMap
                        });
                        return;
                    }

                    const templateEntries = Object.entries(templateMap);
                    if (templateEntries.length === 0) {
                        entries.push({
                            scope: scopeName,
                            config_type: configType,
                            template_name: null,
                            key_fields: [],
                            example: templateMap
                        });
                        return;
                    }

                    templateEntries.forEach(([templateName, templateValue]) => {
                        entries.push({
                            scope: scopeName,
                            config_type: configType,
                            template_name: templateName,
                            key_fields: this.extractTopLevelKeys(templateValue),
                            example: templateValue
                        });
                    });
                });
            });
        });

        return {
            traceid: data?.traceid,
            upstream_result: data?.result,
            summary: {
                total_reference_groups: objects.length,
                total_entries: entries.length,
                scopes: Array.from(scopes).sort(),
                config_types: Array.from(configTypes).sort()
            },
            entries
        };
    }

    private formatTransformReferenceResponse(data: any): any {
        const objects = Array.isArray(data?.objects) ? data.objects : [];
        const entries: any[] = [];

        objects.forEach((item: any) => {
            const dynamicKeyNames = this.isPlainObject(item?.dynamicKeyNames) ? item.dynamicKeyNames : {};
            Object.entries(dynamicKeyNames).forEach(([transformName, transformValue]) => {
                entries.push({
                    transform_name: transformName,
                    key_fields: this.extractTopLevelKeys(transformValue),
                    example: transformValue
                });
            });
        });

        return {
            traceid: data?.traceid,
            upstream_result: data?.result,
            summary: {
                total_reference_groups: objects.length,
                total_transforms: entries.length,
                transform_names: entries.map((entry) => entry.transform_name).sort()
            },
            entries
        };
    }

    private countNestedEntries(value: Record<string, unknown>): number {
        return Object.values(value).reduce<number>((count, item) => {
            if (!this.isPlainObject(item)) {
                return count + 1;
            }

            return count + Math.max(Object.keys(item).length, 1);
        }, 0);
    }

    private extractSampleText(sample: unknown): string | undefined {
        if (typeof sample === 'string') {
            return sample;
        }

        if (!this.isPlainObject(sample)) {
            return undefined;
        }

        for (const key of VERIFY_SAMPLE_TEXT_KEYS) {
            if (typeof sample[key] === 'string' && sample[key].trim()) {
                return sample[key];
            }
        }

        return undefined;
    }

    private extractTopLevelKeys(value: unknown): string[] {
        if (this.isPlainObject(value)) {
            return Object.keys(value);
        }

        return [];
    }

    private tryToNumber(value: unknown): number | null {
        if (typeof value === 'number' && Number.isFinite(value)) {
            return value;
        }

        if (typeof value === 'string' && value.trim()) {
            const parsed = Number(value);
            if (Number.isFinite(parsed)) {
                return parsed;
            }
        }

        return null;
    }

    private isPlainObject(value: unknown): value is Record<string, any> {
        return !!value && typeof value === 'object' && !Array.isArray(value);
    }

    private buildError(errorCode: string, message: string, suggestion: string, details?: any): any {
        return {
            error: message,
            error_code: errorCode,
            suggestion,
            retryable: true,
            details
        };
    }
}
