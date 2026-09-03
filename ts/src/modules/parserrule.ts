import { LogEaseClient } from '../client.js';
import { findParserRuleReference, getParserRuleReferenceCatalog, getParserRuleReferenceDocSource } from './parserrule-reference.js';

const PARSER_RULE_MUTATION_FIELDS = [
    'name',
    'conf',
    'logtype',
    'desc',
    'category_id',
    'enable',
    'from_app',
    'notice_frequency',
    'sink_conf',
    'rt_names',
    'assign_data'
] as const;

const VERIFY_SAMPLE_TEXT_KEYS = [
    'raw_message',
    'rawMessage',
    'message',
    'log',
    'content'
] as const;

type ParserRuleMutationField = typeof PARSER_RULE_MUTATION_FIELDS[number];
type JsonEncodedMutationField = 'conf' | 'sink_conf';

const PARSER_RULE_CREATE_REQUIRED_FIELDS = [
    'name',
    'conf',
    'logtype',
    'desc',
    'category_id',
    'enable'
] as const;

const DEFAULT_PARSER_RULE_LIST_FIELDS = [
    'id',
    'name',
    'logtype',
    'desc',
    'enable',
    'from_app',
    'last_modified_time'
].join(',');

export class ParserRuleModule {
    constructor(private client: LogEaseClient) {}

    async listParserRules(params: any): Promise<any> {
        return this.client.get('/api/v3/parserrules/', this.pickDefined({
            fields: this.resolveListFields(params?.fields),
            permits: params?.permits,
            page: params?.page,
            size: params?.size,
            id: params?.id,
            uuid: params?.uuid,
            domain_id: params?.domain_id,
            creator_id: params?.creator_id,
            name: params?.name,
            from_app: params?.from_app,
            enable: params?.enable,
            desc: params?.desc,
            logtype: params?.logtype,
            rt_ids: params?.rt_ids,
            sort: params?.sort,
            useAdvancedSearch: params?.useAdvancedSearch,
            appname: params?.appname,
            tag: params?.tag
        }));
    }

    async getParserRuleDetail(params: any): Promise<any> {
        const id = this.requireId(params?.id, 'get_parserrule_detail 需要 id。');
        if (id.error) {
            return id.error;
        }

        return this.client.get(`/api/v3/parserrules/${id.value}/`, this.pickDefined({
            fields: params?.fields,
            permit: params?.permit
        }));
    }

    async createParserRule(params: any): Promise<any> {
        const rule = this.extractMutationBody(params, 'rule', 'create_parserrule');
        if (rule.error) {
            return rule.error;
        }

        const requiredFieldsError = this.validateRequiredFields(
            rule.value!,
            PARSER_RULE_CREATE_REQUIRED_FIELDS,
            'create_parserrule'
        );
        if (requiredFieldsError) {
            return requiredFieldsError;
        }

        return this.client.post('/api/v3/parserrules/', rule.value);
    }

    async updateParserRule(params: any): Promise<any> {
        const id = this.requireId(params?.id, 'update_parserrule 需要 id。');
        if (id.error) {
            return id.error;
        }

        const changes = this.extractMutationBody(params, 'changes', 'update_parserrule');
        if (changes.error) {
            return changes.error;
        }

        return this.client.put(`/api/v3/parserrules/${id.value}/`, changes.value);
    }

    async deleteParserRule(params: any): Promise<any> {
        const id = this.requireId(params?.id, 'delete_parserrule 需要 id。');
        if (id.error) {
            return id.error;
        }

        return this.client.delete(`/api/v3/parserrules/${id.value}/`);
    }

    async generateParserRuleDraft(params: any): Promise<any> {
        const request = this.buildGenerateDraftRequest(params);
        if (request.error) {
            return request.error;
        }
        const normalizedRequest = request as { payload: { sample_logs: string[] } };

        const response = await this.client.post('/api/v3/parserrules/generate/', normalizedRequest.payload);
        if (response.error) {
            return response;
        }

        if (response.data && typeof response.data === 'object' && (response.data as any).result === false) {
            return this.buildError(
                'UPSTREAM_BUSINESS_ERROR',
                'generate_parserrule_draft 上游接口返回失败。',
                '请先检查 sample_logs 是否足够且格式接近同一类日志；如果样例本身没问题，再检查上游服务状态。',
                response.data
            );
        }

        return {
            ...response,
            raw_data: response.data,
            data: this.formatGenerateDraftResponse(response.data, normalizedRequest.payload.sample_logs)
        };
    }

    async verifyParserRule(params: any): Promise<any> {
        const request = this.buildVerifyRequest(params);
        if (request.error) {
            return request.error;
        }
        const verifiedRequest = request as { payload: Record<string, unknown>; queryLogtype?: string };

        const response = await this.client.post(
            '/api/v3/parserrules/verify/logtype/',
            verifiedRequest.payload,
            this.pickDefined({
                domain: params?.domain,
                logtype: verifiedRequest.queryLogtype
            })
        );

        if (response.error) {
            return response;
        }

        if (response.data && typeof response.data === 'object' && (response.data as any).result === false) {
            return this.buildError(
                'UPSTREAM_BUSINESS_ERROR',
                'verify_parserrule 上游接口返回失败。',
                '请检查 rule、conf、logtype 与 sample_logs 是否匹配；如果参数本身没问题，再检查上游服务状态。',
                response.data
            );
        }

        return {
            ...response,
            raw_data: response.data,
            data: this.formatVerifyResponse(response.data, verifiedRequest.payload)
        };
    }

    async listParserRuleReferences(params: any): Promise<any> {
        const requestedRuleType = this.pickRequestedRuleType(params);

        if (!requestedRuleType) {
            return {
                data: {
                    ...getParserRuleReferenceCatalog(),
                    usage: '传入 rule_type 查询某一种规则类型的用途、关键字段、最小示例和注意事项。'
                }
            };
        }

        const reference = findParserRuleReference(requestedRuleType);
        if (!reference) {
            return this.buildError(
                'UNSUPPORTED_PARSERRULE_REFERENCE',
                `暂不支持规则类型: ${requestedRuleType}`,
                `请先不传 rule_type 查看支持列表，或改用 ${getParserRuleReferenceCatalog().supported_rule_types.map((item) => item.type).join('、')}。`
            );
        }

        return {
            data: {
                doc_source: getParserRuleReferenceDocSource(),
                requested_rule_type: requestedRuleType,
                ...reference
            }
        };
    }

    private extractMutationBody(
        params: any,
        fieldName: 'rule' | 'changes',
        toolName: 'create_parserrule' | 'update_parserrule'
    ): { value?: Record<string, unknown>; error?: any } {
        const source = params?.[fieldName];
        if (typeof source === 'undefined' || source === null || source === '') {
            return {
                error: this.buildError(
                    'MISSING_REQUIRED_PARAM',
                    `${toolName} 需要 ${fieldName}。`,
                    `请在 ${fieldName} 中传入解析规则主体，例如 name、conf、logtype、desc、category_id、enable。`
                )
            };
        }

        const parsedSource = this.parseMutationObject(source, fieldName, toolName);
        if (parsedSource.error) {
            return parsedSource;
        }

        const normalized = this.pickDefined(
            PARSER_RULE_MUTATION_FIELDS.reduce((acc, key) => {
                acc[key] = parsedSource.value?.[key];
                return acc;
            }, {} as Record<ParserRuleMutationField, unknown>)
        );

        if (Object.keys(normalized).length === 0) {
            return {
                error: this.buildError(
                    'EMPTY_MUTATION_BODY',
                    `${toolName} 的 ${fieldName} 不能为空对象。`,
                    `请在 ${fieldName} 中至少提供一个允许写入的字段，例如 name、conf、logtype、desc、enable、rt_names。`
                )
            };
        }

        for (const jsonField of ['conf', 'sink_conf'] as JsonEncodedMutationField[]) {
            if (typeof normalized[jsonField] === 'undefined') {
                continue;
            }

            const normalizedJsonField = this.normalizeJsonEncodedMutationField(
                normalized[jsonField],
                `${toolName}.${fieldName}.${jsonField}`
            );
            if (normalizedJsonField.error) {
                return { error: normalizedJsonField.error };
            }

            normalized[jsonField] = normalizedJsonField.value;
        }

        return { value: normalized };
    }

    private requireId(rawId: unknown, message: string): { value?: string; error?: any } {
        if (typeof rawId === 'undefined' || rawId === null || rawId === '') {
            return {
                error: this.buildError(
                    'MISSING_REQUIRED_PARAM',
                    message,
                    '请提供目标解析规则的 id。'
                )
            };
        }

        return { value: String(rawId) };
    }

    private parseMutationObject(
        rawValue: unknown,
        fieldName: 'rule' | 'changes',
        toolName: 'create_parserrule' | 'update_parserrule'
    ): { value?: Record<string, unknown>; error?: any } {
        if (this.isPlainObject(rawValue)) {
            return { value: rawValue };
        }

        if (typeof rawValue !== 'string') {
            return {
                error: this.buildError(
                    'INVALID_PARAM_TYPE',
                    `${toolName} 的 ${fieldName} 必须是对象。`,
                    `请把 ${fieldName} 传成对象，或传入可解析为对象的合法 JSON 字符串。`
                )
            };
        }

        const trimmed = rawValue.trim();
        if (!trimmed) {
            return {
                error: this.buildError(
                    'EMPTY_MUTATION_BODY',
                    `${toolName} 的 ${fieldName} 不能为空字符串。`,
                    `请把 ${fieldName} 传成对象，或传入合法的 JSON 对象字符串。`
                )
            };
        }

        try {
            const parsed = JSON.parse(trimmed);
            if (!this.isPlainObject(parsed)) {
                return {
                    error: this.buildError(
                        'INVALID_PARAM_TYPE',
                        `${toolName} 的 ${fieldName} 必须是对象。`,
                        `请把 ${fieldName} 传成对象，或传入可解析为对象的合法 JSON 对象字符串。`
                    )
                };
            }

            return { value: parsed };
        } catch (error: any) {
            return {
                error: this.buildError(
                    'INVALID_JSON_STRING',
                    `${toolName} 的 ${fieldName} 不是合法 JSON 字符串。`,
                    `请检查 ${fieldName} 的 JSON 语法，例如引号、逗号、括号是否完整。`,
                    {
                        field: fieldName,
                        parse_error: error?.message || 'JSON parse failed',
                        preview: trimmed.slice(0, 300)
                    }
                )
            };
        }
    }

    private normalizeJsonEncodedMutationField(rawValue: unknown, fieldPath: string): { value?: string; error?: any } {
        if (typeof rawValue === 'string') {
            const trimmed = rawValue.trim();
            if (!trimmed) {
                return {
                    error: this.buildError(
                        'INVALID_JSON_STRING',
                        `${fieldPath} 不能为空字符串。`,
                        `请确保 ${fieldPath} 是合法 JSON 字符串，或直接传对象/数组。`
                    )
                };
            }

            try {
                JSON.parse(trimmed);
                return { value: trimmed };
            } catch (error: any) {
                return {
                    error: this.buildError(
                        'INVALID_JSON_STRING',
                        `${fieldPath} 不是合法 JSON 字符串。`,
                        `请检查 ${fieldPath} 的 JSON 语法，例如引号、逗号、括号是否完整。`,
                        {
                            field: fieldPath,
                            parse_error: error?.message || 'JSON parse failed',
                            preview: trimmed.slice(0, 300)
                        }
                    )
                };
            }
        }

        if (Array.isArray(rawValue) || this.isPlainObject(rawValue)) {
            return { value: JSON.stringify(rawValue) };
        }

        return {
            error: this.buildError(
                'INVALID_PARAM_TYPE',
                `${fieldPath} 必须是 JSON 字符串、对象或数组。`,
                `请把 ${fieldPath} 传成对象/数组，或传入合法 JSON 字符串。`
            )
        };
    }

    private validateRequiredFields(
        payload: Record<string, unknown>,
        requiredFields: readonly string[],
        toolName: string
    ): any | null {
        const missingFields = requiredFields.filter((field) => this.isMissingRequiredValue(payload[field]));
        if (missingFields.length === 0) {
            return null;
        }

        return this.buildError(
            'MISSING_REQUIRED_FIELDS',
            `${toolName} 缺少必填字段: ${missingFields.join(', ')}。`,
            `请补齐必填字段后重试：${missingFields.join(', ')}。`
        );
    }

    private buildGenerateDraftRequest(params: any): { payload: { sample_logs: string[] }; error?: never } | { error: any } {
        const sampleLogs = this.normalizeGenerateSampleLogs(params?.sample_logs);
        if (sampleLogs.error) {
            return { error: sampleLogs.error };
        }
        const normalizedSampleLogs = sampleLogs as { value: string[] };

        return {
            payload: {
                sample_logs: normalizedSampleLogs.value
            }
        };
    }

    private normalizeGenerateSampleLogs(rawValue: unknown): { value: string[]; error?: never } | { error: any } {
        if (typeof rawValue === 'undefined' || rawValue === null) {
            return {
                error: this.buildError(
                    'MISSING_REQUIRED_PARAM',
                    'generate_parserrule_draft 需要 sample_logs。',
                    '请至少提供 1 条样例日志；支持字符串数组、对象数组、单个对象、单个字符串，或合法 JSON 字符串。'
                )
            };
        }

        if (typeof rawValue === 'string') {
            const trimmed = rawValue.trim();
            if (!trimmed) {
                return {
                    error: this.buildError(
                        'EMPTY_SAMPLE_LOGS',
                        'generate_parserrule_draft 的 sample_logs 不能为空字符串。',
                        '请至少提供 1 条样例日志；如果想传 JSON，请确保字符串内容不是空串。'
                    )
                };
            }

            if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
                const parsed = this.parseJsonStringField(trimmed, 'sample_logs');
                if (parsed.error) {
                    return { error: parsed.error };
                }

                return this.normalizeGenerateSampleLogs((parsed as { value: any }).value);
            }

            return { value: [trimmed] };
        }

        if (Array.isArray(rawValue)) {
            const normalized = rawValue
                .map((item) => this.normalizeGenerateSampleLogEntry(item))
                .filter((item): item is string => typeof item === 'string' && item.trim().length > 0);

            if (normalized.length === 0) {
                return {
                    error: this.buildError(
                        'EMPTY_SAMPLE_LOGS',
                        'generate_parserrule_draft 的 sample_logs 不能为空。',
                        '请至少提供 1 条可识别的样例日志文本。'
                    )
                };
            }

            return { value: normalized };
        }

        if (this.isPlainObject(rawValue)) {
            const normalized = this.normalizeGenerateSampleLogEntry(rawValue);
            if (!normalized) {
                return {
                    error: this.buildError(
                        'INVALID_PARAM_TYPE',
                        'generate_parserrule_draft 的 sample_logs 对象里没有可识别的日志文本。',
                        '请使用 raw_message、rawMessage、message、log 或 content 字段传样例日志，或直接传字符串。'
                    )
                };
            }

            return { value: [normalized] };
        }

        return {
            error: this.buildError(
                'INVALID_PARAM_TYPE',
                'generate_parserrule_draft 的 sample_logs 必须是数组、对象、字符串，或合法 JSON 字符串。',
                '请把 sample_logs 传成字符串数组、对象数组、单个对象、单个字符串，或传入可解析为这些结构的 JSON 字符串。'
            )
        };
    }

    private normalizeGenerateSampleLogEntry(sample: unknown): string | undefined {
        const extracted = this.extractSampleText(sample);
        if (typeof extracted === 'string' && extracted.trim()) {
            return extracted.trim();
        }

        if (typeof sample === 'string' && sample.trim()) {
            return sample.trim();
        }

        return undefined;
    }

    private isMissingRequiredValue(value: unknown): boolean {
        if (typeof value === 'boolean') {
            return false;
        }

        if (typeof value === 'string') {
            return value.trim().length === 0;
        }

        if (Array.isArray(value)) {
            return value.length === 0;
        }

        return typeof value === 'undefined' || value === null;
    }

    private formatGenerateDraftResponse(data: any, sampleLogs: string[]): any {
        const generatedRules = Array.isArray(data?.rules) ? data.rules : [];

        return {
            traceid: data?.traceid,
            upstream_result: data?.result,
            request_overview: {
                sample_count: sampleLogs.length,
                sample_preview: sampleLogs.slice(0, 3)
            },
            summary: data?.summary,
            generated_rule_count: generatedRules.length,
            generated_rules: generatedRules,
            contents: Array.isArray(data?.contents) ? data.contents : [],
            next_steps: [
                '先人工检查 generated_rules 是否符合预期，并根据 sample_logs 把 field、field_1、field_N 这类占位字段改成有业务语义的名字。',
                'create_parserrule / update_parserrule 时，请手动组装 rule 或 changes，并补齐 name、logtype、desc、category_id、enable 等必填上下文。',
                '推荐在 create/update 前后都调用 verify_parserrule 做样例日志验证。'
            ]
        };
    }

    private buildVerifyRequest(params: any): { payload: Record<string, unknown>; queryLogtype?: string; error?: never } | { error: any } {
        const source = this.resolveVerifySource(params);
        if (source.error) {
            return { error: source.error };
        }
        const resolvedSource = (source as { value: any }).value;

        const rule = this.normalizeVerifyArrayField(resolvedSource.rule, 'rule', '匹配规则');
        if (rule.error) {
            return { error: rule.error };
        }
        const normalizedRule = rule as { value: any[] };
        if (normalizedRule.value.length === 0) {
            return {
                error: this.buildError(
                    'EMPTY_RULE',
                    'verify_parserrule 的 rule 不能为空。',
                    '请至少提供 1 条匹配规则；如果你传的是 JSON 字符串，请确认它能解析成非空数组或对象。'
                )
            };
        }

        const conf = this.normalizeVerifyArrayField(resolvedSource.conf, 'conf', '解析规则 conf');
        if (conf.error) {
            return { error: conf.error };
        }
        const normalizedConf = conf as { value: any[] };
        if (normalizedConf.value.length === 0) {
            return {
                error: this.buildError(
                    'EMPTY_CONF',
                    'verify_parserrule 的 conf 不能为空。',
                    '请至少提供 1 条 conf 配置；如果你传的是 JSON 字符串，请确认它能解析成非空数组或对象。'
                )
            };
        }

        const logtype = this.normalizeVerifyLogtypeField(resolvedSource.logtype);
        if (logtype.error) {
            return { error: logtype.error };
        }
        const normalizedLogtype = logtype as { value: string };
        if (!normalizedLogtype.value) {
            return {
                error: this.buildError(
                    'EMPTY_LOGTYPE',
                    'verify_parserrule 的 logtype 不能为空。',
                    '请传入非空的 logtype；优先直接传字符串，例如 nginx_access、text。'
                )
            };
        }

        const sampleLogs = this.normalizeSampleLogs(resolvedSource.sample_logs);
        if (sampleLogs.error) {
            return { error: sampleLogs.error };
        }
        const normalizedSampleLogs = sampleLogs as { value: any[] };
        if (normalizedSampleLogs.value.length === 0) {
            return {
                error: this.buildError(
                    'EMPTY_SAMPLE_LOGS',
                    'verify_parserrule 的 sample_logs 不能为空。',
                    '请至少提供 1 条样例日志；可以传字符串数组、对象数组，或合法 JSON 字符串。'
                )
            };
        }

        const rawMessage = this.normalizeRawMessage(resolvedSource.rawMessage, normalizedSampleLogs.value);
        if (rawMessage.error) {
            return { error: rawMessage.error };
        }
        const normalizedRawMessage = rawMessage as { value: string };

        const enable = this.normalizeBoolean(resolvedSource.enable, 'enable');
        if (enable.error) {
            return { error: enable.error };
        }
        const normalizedEnable = enable as { value: boolean };

        const grok = this.normalizeOptionalObjectField(resolvedSource.grok, 'grok');
        if (grok.error) {
            return { error: grok.error };
        }
        const normalizedGrok = grok as { value?: Record<string, unknown> };

        return {
            payload: this.pickDefined({
                appname: this.normalizeOptionalScalar(resolvedSource.appname),
                conf: normalizedConf.value,
                logtype: normalizedLogtype.value,
                rawMessage: normalizedRawMessage.value,
                enable: normalizedEnable.value,
                rule: normalizedRule.value,
                sample_logs: normalizedSampleLogs.value,
                grok: normalizedGrok.value,
                hostname: this.normalizeOptionalScalar(resolvedSource.hostname),
                source: this.normalizeOptionalScalar(resolvedSource.source),
                ip: this.normalizeOptionalScalar(resolvedSource.ip)
            }),
            queryLogtype: this.normalizeQueryLogtype(params)
        };
    }

    private resolveVerifySource(params: any): { value: Record<string, unknown>; error?: never } | { error: any } {
        if (typeof params?.payload !== 'undefined') {
            const parsedPayload = this.parseJsonStringField(params.payload, 'payload');
            if (parsedPayload.error) {
                return { error: parsedPayload.error };
            }
            const verifiedPayload = parsedPayload as { value: any };

            if (!this.isPlainObject(verifiedPayload.value)) {
                return {
                    error: this.buildError(
                        'INVALID_PARAM_TYPE',
                        'verify_parserrule 的 payload 必须是对象。',
                        '请把 payload 传成对象，或传入可以解析为对象的合法 JSON 字符串。'
                    )
                };
            }

            return { value: verifiedPayload.value };
        }

        const source = this.pickDefined({
            appname: params?.appname,
            conf: params?.conf,
            logtype: params?.logtype,
            rawMessage: params?.rawMessage,
            enable: params?.enable,
            rule: params?.rule,
            sample_logs: params?.sample_logs,
            grok: params?.grok,
            hostname: params?.hostname,
            source: params?.source,
            ip: params?.ip
        });

        if (Object.keys(source).length === 0) {
            return {
                error: this.buildError(
                    'MISSING_REQUIRED_PARAM',
                    'verify_parserrule 需要 payload，或直接提供 rawMessage、rule、sample_logs、conf、logtype、enable。',
                    '推荐直接传 payload；如果想少包一层，也可以把 rawMessage、rule、sample_logs、conf、logtype、enable 这些字段平铺到顶层。'
                )
            };
        }

        return { value: source };
    }

    private normalizeVerifyLogtypeField(rawValue: unknown): { value: string; error?: never } | { error: any } {
        if (typeof rawValue === 'undefined' || rawValue === null) {
            return {
                error: this.buildError(
                    'MISSING_REQUIRED_PARAM',
                    'verify_parserrule 需要 logtype。',
                    '请提供当前规则 logtype；优先直接传字符串，例如 nginx_access、text。'
                )
            };
        }

        if (typeof rawValue === 'string') {
            const trimmed = rawValue.trim();
            if (!trimmed) {
                return { value: '' };
            }
            if (!trimmed.startsWith('[') && !trimmed.startsWith('{')) {
                return { value: trimmed };
            }
        }

        const parsed = this.parseJsonStringField(rawValue, 'logtype');
        if (parsed.error) {
            return { error: parsed.error };
        }

        const normalizedParsed = parsed as { value: any };
        const resolved = this.extractVerifyLogtypeValue(normalizedParsed.value);
        if (resolved) {
            return { value: resolved };
        }

        return {
            error: this.buildError(
                'INVALID_PARAM_TYPE',
                'verify_parserrule 的 logtype 必须是字符串、对象、数组，或合法 JSON 字符串。',
                '推荐直接传字符串；如果传对象/数组，请至少包含 name、type 或 logtype 这类可识别字段。'
            )
        };
    }

    private normalizeVerifyArrayField(rawValue: unknown, fieldName: string, displayName: string): { value: any[]; error?: never } | { error: any } {
        if (typeof rawValue === 'undefined' || rawValue === null) {
            return {
                error: this.buildError(
                    'MISSING_REQUIRED_PARAM',
                    `verify_parserrule 需要 ${fieldName}。`,
                    `请提供 ${displayName}，支持原生数组/对象，或传入可解析的 JSON 字符串。`
                )
            };
        }

        const parsed = this.parseJsonStringField(rawValue, fieldName);
        if (parsed.error) {
            return { error: parsed.error };
        }
        const normalizedParsed = parsed as { value: any };

        if (Array.isArray(normalizedParsed.value)) {
            return { value: normalizedParsed.value };
        }

        if (this.isPlainObject(normalizedParsed.value)) {
            return { value: [normalizedParsed.value] };
        }

        return {
            error: this.buildError(
                'INVALID_PARAM_TYPE',
                `verify_parserrule 的 ${fieldName} 必须是数组、对象或合法 JSON 字符串。`,
                `请把 ${fieldName} 传成原生数组/对象，或传入可解析为数组/对象的 JSON 字符串。`
            )
        };
    }

    private normalizeSampleLogs(rawValue: unknown): { value: any[]; error?: never } | { error: any } {
        if (typeof rawValue === 'undefined' || rawValue === null) {
            return {
                error: this.buildError(
                    'MISSING_REQUIRED_PARAM',
                    'verify_parserrule 需要 sample_logs。',
                    '请至少提供 1 条样例日志；支持字符串数组、对象数组、单个对象，或合法 JSON 字符串。'
                )
            };
        }

        if (typeof rawValue === 'string') {
            const trimmed = rawValue.trim();
            if (!trimmed) {
                return {
                    error: this.buildError(
                        'EMPTY_SAMPLE_LOGS',
                        'verify_parserrule 的 sample_logs 不能为空字符串。',
                        '请至少提供 1 条样例日志；如果想传 JSON，请确保字符串内容不是空串。'
                    )
                };
            }

            if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
                const parsed = this.parseJsonStringField(trimmed, 'sample_logs');
                if (parsed.error) {
                    return { error: parsed.error };
                }
                const normalizedParsed = parsed as { value: any };
                return this.normalizeSampleLogs(normalizedParsed.value);
            }

            return { value: [trimmed] };
        }

        if (Array.isArray(rawValue)) {
            return { value: rawValue.map((item) => this.normalizeSampleLogEntry(item)) };
        }

        if (this.isPlainObject(rawValue)) {
            return { value: [this.normalizeSampleLogEntry(rawValue)] };
        }

        return {
            error: this.buildError(
                'INVALID_PARAM_TYPE',
                'verify_parserrule 的 sample_logs 必须是数组、对象、字符串，或合法 JSON 字符串。',
                '请把 sample_logs 传成字符串数组、对象数组、单个对象，或传入可解析为这些结构的 JSON 字符串。'
            )
        };
    }

    private normalizeSampleLogEntry(sample: unknown): any {
        if (typeof sample === 'string') {
            return sample;
        }

        if (this.isPlainObject(sample)) {
            return sample;
        }

        return String(sample);
    }

    private normalizeRawMessage(rawValue: unknown, sampleLogs: any[]): { value: string; error?: never } | { error: any } {
        if (typeof rawValue === 'string' && rawValue.trim()) {
            return { value: rawValue };
        }

        if (typeof rawValue === 'number' || typeof rawValue === 'boolean') {
            return { value: String(rawValue) };
        }

        const fallback = sampleLogs
            .map((sample) => this.extractSampleText(sample))
            .find((text): text is string => typeof text === 'string' && text.trim().length > 0);

        if (fallback) {
            return { value: fallback };
        }

        return {
            error: this.buildError(
                'MISSING_REQUIRED_PARAM',
                'verify_parserrule 需要 rawMessage。',
                '请显式提供 rawMessage；如果想自动兜底，请确保 sample_logs 至少有一条带 raw_message、rawMessage、message、log 或 content 字段。'
            )
        };
    }

    private normalizeBoolean(rawValue: unknown, fieldName: string): { value: boolean; error?: never } | { error: any } {
        if (typeof rawValue === 'boolean') {
            return { value: rawValue };
        }

        if (typeof rawValue === 'string') {
            const normalized = rawValue.trim().toLowerCase();
            if (normalized === 'true') {
                return { value: true };
            }
            if (normalized === 'false') {
                return { value: false };
            }
        }

        return {
            error: this.buildError(
                'INVALID_PARAM_TYPE',
                `verify_parserrule 的 ${fieldName} 必须是布尔值。`,
                `请把 ${fieldName} 传成 true/false；如果是字符串，也只能是 "true" 或 "false"。`
            )
        };
    }

    private normalizeOptionalObjectField(rawValue: unknown, fieldName: string): { value?: Record<string, unknown>; error?: never } | { error: any } {
        if (typeof rawValue === 'undefined' || rawValue === null) {
            return { value: undefined };
        }

        const parsed = this.parseJsonStringField(rawValue, fieldName);
        if (parsed.error) {
            return { error: parsed.error };
        }
        const normalizedParsed = parsed as { value: any };

        if (this.isPlainObject(normalizedParsed.value)) {
            return { value: normalizedParsed.value };
        }

        return {
            error: this.buildError(
                'INVALID_PARAM_TYPE',
                `verify_parserrule 的 ${fieldName} 必须是对象或合法 JSON 字符串。`,
                `请把 ${fieldName} 传成对象，或传入可解析为对象的 JSON 字符串。`
            )
        };
    }

    private parseJsonStringField(rawValue: unknown, fieldName: string): { value: any; error?: never } | { error: any } {
        if (typeof rawValue !== 'string') {
            return { value: rawValue };
        }

        const trimmed = rawValue.trim();
        if (!trimmed) {
            return { value: trimmed };
        }

        try {
            return { value: JSON.parse(trimmed) };
        } catch (error: any) {
            return {
                error: this.buildError(
                    'INVALID_JSON',
                    `verify_parserrule 的 ${fieldName} 不是合法 JSON。`,
                    `请检查 ${fieldName} 的 JSON 语法，例如引号、逗号、括号是否完整；如果本意不是传 JSON，请改用原生对象/数组。`,
                    {
                        field: fieldName,
                        parse_error: error?.message || 'JSON parse failed',
                        preview: trimmed.slice(0, 300)
                    }
                )
            };
        }
    }

    private formatVerifyResponse(data: any, requestPayload: Record<string, unknown>): any {
        const contents = Array.isArray(data?.contents) ? data.contents : [];
        const samples = contents.map((content: any, index: number) => this.formatVerifySample(content, index));
        const successCount = samples.filter((item: any) => item.success).length;
        const failureCount = samples.length - successCount;
        const totalTimeCostUs = samples.reduce(
            (sum: number, item: any) => sum + (typeof item.time_cost_us === 'number' ? item.time_cost_us : 0),
            0
        );

        return {
            traceid: data?.traceid,
            upstream_result: data?.result,
            request_overview: {
                appname: requestPayload.appname,
                enable: requestPayload.enable,
                rule_count: Array.isArray(requestPayload.rule) ? requestPayload.rule.length : 0,
                conf_count: Array.isArray(requestPayload.conf) ? requestPayload.conf.length : 0,
                logtype_count: typeof requestPayload.logtype === 'string' && requestPayload.logtype.trim() ? 1 : 0,
                sample_count: Array.isArray(requestPayload.sample_logs) ? requestPayload.sample_logs.length : 0
            },
            summary: {
                total_samples: samples.length,
                success_count: successCount,
                failure_count: failureCount,
                average_time_cost_us: samples.length > 0 ? Number((totalTimeCostUs / samples.length).toFixed(2)) : 0
            },
            samples
        };
    }

    private formatVerifySample(content: any, index: number): any {
        const extractedFields = this.isPlainObject(content?.fields) ? content.fields : {};
        const fieldTypes = this.isPlainObject(content?.types) ? content.types : {};
        const hitRule = this.formatHitRule(content?.hit_rule);
        const parseResult = typeof content?.parse_result === 'string' ? content.parse_result : null;

        return {
            index,
            success: this.inferVerifySuccess(parseResult, extractedFields),
            parse_result: parseResult,
            time_cost_us: typeof content?.timeCostUs === 'number' ? content.timeCostUs : null,
            raw_message: this.extractSampleText(content),
            log_type: this.normalizeOptionalScalar(content?.log_type),
            hit_rule: hitRule,
            extracted_field_names: Object.keys(extractedFields),
            extracted_fields: extractedFields,
            field_types: fieldTypes
        };
    }

    private formatHitRule(hitRule: unknown): any {
        if (!Array.isArray(hitRule)) {
            return { raw: hitRule };
        }

        return {
            raw: hitRule,
            rule_type: hitRule[0] ?? null,
            stage_result: hitRule[3] ?? null,
            time_cost_us: typeof hitRule[4] === 'number' ? hitRule[4] : this.tryToNumber(hitRule[4]),
            grok_steps: hitRule[5] ?? null
        };
    }

    private inferVerifySuccess(parseResult: string | null, extractedFields: Record<string, unknown>): boolean {
        if (parseResult) {
            const normalized = parseResult.trim().toLowerCase();
            if (['success', 'ok', 'pass', 'parsed', 'hit'].includes(normalized)) {
                return true;
            }
            if (['fail', 'failed', 'error', 'skip', 'miss', 'no_match', 'false'].includes(normalized)) {
                return false;
            }
        }

        return Object.keys(extractedFields).length > 0;
    }

    private pickDefined(values: Record<string, unknown>): Record<string, unknown> {
        return Object.fromEntries(
            Object.entries(values).filter(([, value]) => typeof value !== 'undefined')
        );
    }

    private resolveListFields(fields: unknown): string {
        if (typeof fields === 'string' && fields.trim() !== '') {
            return fields.trim();
        }

        return DEFAULT_PARSER_RULE_LIST_FIELDS;
    }

    private pickRequestedRuleType(params: any): string | null {
        const candidates = [params?.rule_type, params?.type];
        const matched = candidates.find((value) => typeof value === 'string' && value.trim().length > 0);
        return matched ? matched.trim() : null;
    }

    private normalizeOptionalScalar(value: unknown): string | number | boolean | undefined {
        if (
            typeof value === 'string' ||
            typeof value === 'number' ||
            typeof value === 'boolean'
        ) {
            return value;
        }

        return undefined;
    }

    private normalizeQueryLogtype(params: any): string | undefined {
        if (typeof params?.query_logtype === 'string' && params.query_logtype.trim()) {
            return params.query_logtype;
        }

        return undefined;
    }

    private extractVerifyLogtypeValue(rawValue: unknown): string | undefined {
        if (typeof rawValue === 'string') {
            const trimmed = rawValue.trim();
            return trimmed || undefined;
        }

        if (Array.isArray(rawValue)) {
            for (const item of rawValue) {
                const resolved = this.extractVerifyLogtypeValue(item);
                if (resolved) {
                    return resolved;
                }
            }
            return undefined;
        }

        if (!this.isPlainObject(rawValue)) {
            return undefined;
        }

        for (const key of ['logtype', 'name', 'type']) {
            const candidate = rawValue[key];
            if (typeof candidate === 'string' && candidate.trim()) {
                return candidate.trim();
            }
        }

        return undefined;
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
