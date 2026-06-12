import { LogEaseClient } from '../client.js';

const DEFAULT_AGENT_FIELDS = [
    'id',
    'ip',
    'port',
    'hostname',
    'platform',
    'os',
    'status',
    'cur_version',
    'expected_version',
    'last_update_timestamp'
].join(',');

const DEFAULT_AGENT_GROUP_FIELDS = [
    'id',
    'name',
    'memo',
    'creator_id',
    'from_app'
].join(',');

export class IngestModule {
    constructor(private client: LogEaseClient) {}

    async listAgents(params: any): Promise<any> {
        const groupIds = this.resolveGroupIdsQuery(params?.group_ids);

        const response = await this.client.get('/api/v3/agent/', this.pickDefined({
            fields: this.resolveString(params?.fields, DEFAULT_AGENT_FIELDS),
            permits: params?.permits,
            page: params?.page,
            size: params?.size,
            group_ids: groupIds,
            id: params?.id,
            ip: params?.ip,
            port: params?.port,
            status: params?.status,
            os: params?.os,
            platform: params?.platform,
            cur_version: params?.cur_version,
            expected_version: params?.expected_version,
            is_server_heka: this.normalizeBooleanQuery(params?.is_server_heka),
            proxy_ip: params?.proxy_ip,
            proxy_port: params?.proxy_port,
            domain_id: params?.domain_id,
            hostname: params?.hostname,
            comment: params?.comment,
            cmd: params?.cmd,
            cmd_timestamp: params?.cmd_timestamp,
            create_timestamp: params?.create_timestamp,
            last_update_timestamp: params?.last_update_timestamp,
            sort: params?.sort
        }));

        if (response.error) {
            return response;
        }

        if (this.isUpstreamBusinessError(response.data)) {
            return this.buildError(
                'UPSTREAM_BUSINESS_ERROR',
                'list_agents 上游接口返回失败。',
                '请检查 Agent 列表查询参数后重试。',
                response.data
            );
        }

        return {
            ...response,
            raw_data: response.data,
            data: this.formatAgentListResponse(response.data)
        };
    }

    async listAgentGroups(params: any): Promise<any> {
        const assignableOnly = this.resolveBooleanFlag(params?.assignable_only);
        const response = assignableOnly
            ? await this.client.get('/api/v3/agentgroup/assign/')
            : await this.client.get('/api/v3/agentgroup/', this.pickDefined({
                fields: this.resolveString(params?.fields, DEFAULT_AGENT_GROUP_FIELDS),
                permits: params?.permits,
                page: params?.page,
                size: params?.size,
                custom_collection: params?.custom_collection,
                id: params?.id,
                domain_id: params?.domain_id,
                name: params?.name,
                memo: params?.memo,
                creator_id: params?.creator_id,
                from_app: params?.from_app,
                rt_ids: params?.rt_ids,
                sort: params?.sort
            }));

        if (response.error) {
            return response;
        }

        if (this.isUpstreamBusinessError(response.data)) {
            return this.buildError(
                'UPSTREAM_BUSINESS_ERROR',
                'list_agent_groups 上游接口返回失败。',
                '请检查 Agent 分组查询参数后重试。',
                response.data
            );
        }

        return {
            ...response,
            raw_data: response.data,
            data: this.formatAgentGroupListResponse(response.data, assignableOnly)
        };
    }

    async getAgentGroupDetail(params: any): Promise<any> {
        const id = this.requireId(params?.id, 'get_agent_group_detail 需要 id。');
        if (id.error) {
            return id.error;
        }

        const response = await this.client.get(`/api/v3/agentgroup/${id.value}/`, this.pickDefined({
            fields: params?.fields,
            permit: params?.permit
        }));

        if (response.error) {
            return response;
        }

        if (this.isUpstreamBusinessError(response.data)) {
            return this.buildError(
                'UPSTREAM_BUSINESS_ERROR',
                'get_agent_group_detail 上游接口返回失败。',
                '请确认 Agent 分组 id 是否存在。',
                response.data
            );
        }

        return {
            ...response,
            raw_data: response.data,
            data: this.formatAgentGroupDetailResponse(response.data)
        };
    }

    async createAgentGroup(params: any): Promise<any> {
        const group = this.parseObjectInput(params?.group, 'group', 'create_agent_group');
        if (group.error) {
            return group.error;
        }

        const normalizedGroup = this.pickDefined({
            name: group.value?.name,
            memo: group.value?.memo,
            rt_names: group.value?.rt_names,
            roles: group.value?.roles
        });

        if (this.isMissingRequiredValue(normalizedGroup.name)) {
            return this.buildError(
                'MISSING_REQUIRED_PARAM',
                'create_agent_group 缺少 group.name。',
                '请在 group 中提供分组名称。'
            );
        }

        if (!Array.isArray(normalizedGroup.roles) || normalizedGroup.roles.length === 0) {
            return this.buildError(
                'MISSING_REQUIRED_PARAM',
                'create_agent_group 缺少 group.roles。',
                '请在 group.roles 中至少提供 1 个角色 id。'
            );
        }

        const response = await this.client.post('/api/v3/agentgroup/', normalizedGroup);
        return this.formatMutationResponse(
            response,
            'create_agent_group 上游接口返回失败。',
            '请检查 group.name 和 group.roles 是否完整。',
            (data) => this.formatAgentGroupMutationResponse(data, 'create', normalizedGroup.name as string | undefined)
        );
    }

    async updateAgentGroup(params: any): Promise<any> {
        const id = this.requireId(params?.id, 'update_agent_group 需要 id。');
        if (id.error) {
            return id.error;
        }

        const changes = this.parseObjectInput(params?.changes, 'changes', 'update_agent_group');
        if (changes.error) {
            return changes.error;
        }

        const normalizedChanges = this.pickDefined({
            name: changes.value?.name,
            memo: changes.value?.memo,
            rt_names: changes.value?.rt_names,
            roles: changes.value?.roles
        });

        if (Object.keys(normalizedChanges).length === 0) {
            return this.buildError(
                'EMPTY_MUTATION_BODY',
                'update_agent_group 的 changes 不能为空对象。',
                '请至少提供一个可更新字段，例如 name、memo、rt_names、roles。'
            );
        }

        const response = await this.client.put(`/api/v3/agentgroup/${id.value}/`, normalizedChanges);
        return this.formatMutationResponse(
            response,
            'update_agent_group 上游接口返回失败。',
            '请检查 id 和 changes 字段后重试。',
            (data) => this.formatAgentGroupMutationResponse(data, 'update', normalizedChanges.name as string | undefined, id.value)
        );
    }

    async deleteAgentGroup(params: any): Promise<any> {
        const id = this.requireId(params?.id, 'delete_agent_group 需要 id。');
        if (id.error) {
            return id.error;
        }
        const idValue = id.value!;

        const response = await this.client.delete(`/api/v3/agentgroup/${idValue}/`);
        return this.formatMutationResponse(
            response,
            'delete_agent_group 上游接口返回失败。',
            '请确认 Agent 分组 id 是否正确。',
            (data) => this.formatSimpleMutationResult(data, 'delete_agent_group', 'delete', idValue)
        );
    }

    async addAgentsToGroup(params: any): Promise<any> {
        const id = this.requireId(params?.id, 'add_agents_to_group 需要 id。');
        if (id.error) {
            return id.error;
        }
        const idValue = id.value!;

        const targetAgents = this.normalizeTargetAgentsForAdd(params?.target_agents, idValue);
        if (targetAgents.error) {
            return targetAgents.error;
        }

        const response = await this.client.post(`/api/v3/agentgroup/${idValue}/add_member/`, {
            target_agents: targetAgents.value
        });

        return this.formatMutationResponse(
            response,
            'add_agents_to_group 上游接口返回失败。',
            '请确认目标分组 id 和 target_agents 是否正确。',
            (data) => this.formatGroupMembershipResponse(data, 'add', idValue, targetAgents.value as Array<Record<string, unknown>>)
        );
    }

    async removeAgentsFromGroup(params: any): Promise<any> {
        const id = this.requireId(params?.id, 'remove_agents_from_group 需要 id。');
        if (id.error) {
            return id.error;
        }
        const idValue = id.value!;

        const targetAgents = this.normalizeTargetAgentsForRemove(params?.target_agents);
        if (targetAgents.error) {
            return targetAgents.error;
        }

        const response = await this.client.post(`/api/v3/agentgroup/${idValue}/remove_member/`, {
            target_agents: targetAgents.value
        });

        return this.formatMutationResponse(
            response,
            'remove_agents_from_group 上游接口返回失败。',
            '请确认目标分组 id 和 target_agents 是否正确。',
            (data) => this.formatGroupRemovalResponse(data, idValue, targetAgents.value as string)
        );
    }

    async listPipelineSchemas(params: any): Promise<any> {
        const kind = this.requireNonEmptyString(params?.kind, 'list_pipeline_schemas 需要 kind。', '请传入 kind，例如 InstanceConfiguration、PluginType、ReferenceResource。');
        if (kind.error) {
            return kind.error;
        }
        const kindValue = kind.value!;

        const platform = this.requireNonEmptyString(params?.platform, 'list_pipeline_schemas 需要 platform。', '请传入目标平台，例如 linux-x64。');
        if (platform.error) {
            return platform.error;
        }
        const platformValue = platform.value!;

        const response = await this.client.get('/api/v3/pipelineconfig/schemas/', {
            kind: kindValue,
            platform: platformValue
        });

        if (response.error) {
            return response;
        }

        if (this.isUpstreamBusinessError(response.data)) {
            return this.buildError(
                'UPSTREAM_BUSINESS_ERROR',
                'list_pipeline_schemas 上游接口返回失败。',
                '请检查 kind 和 platform 是否匹配。',
                response.data
            );
        }

        return {
            ...response,
            raw_data: response.data,
            data: this.formatPipelineSchemasResponse(response.data, kindValue, platformValue)
        };
    }

    async listPipelines(params: any): Promise<any> {
        const response = await this.client.get('/api/v3/pipelineconfig/pipelines/', this.pickDefined({
            page: params?.page,
            size: params?.size,
            filter: params?.filter,
            sort: params?.sort,
            order: params?.order
        }));

        if (response.error) {
            return response;
        }

        if (this.isUpstreamBusinessError(response.data)) {
            return this.buildError(
                'UPSTREAM_BUSINESS_ERROR',
                'list_pipelines 上游接口返回失败。',
                '请检查 pipeline 查询参数后重试。',
                response.data
            );
        }

        return {
            ...response,
            raw_data: response.data,
            data: this.formatPipelineListResponse(response.data)
        };
    }

    async getPipelineDetail(params: any): Promise<any> {
        const id = this.requireId(params?.id, 'get_pipeline_detail 需要 id。');
        if (id.error) {
            return id.error;
        }

        const response = await this.client.get(`/api/v3/pipelineconfig/pipelines/${id.value}/`);
        if (response.error) {
            return response;
        }

        if (this.isUpstreamBusinessError(response.data)) {
            return this.buildError(
                'UPSTREAM_BUSINESS_ERROR',
                'get_pipeline_detail 上游接口返回失败。',
                '请确认 pipeline id 是否存在。',
                response.data
            );
        }

        return {
            ...response,
            raw_data: response.data,
            data: this.formatPipelineDetailResponse(response.data)
        };
    }

    async createPipeline(params: any): Promise<any> {
        const pipeline = this.parseObjectInput(params?.pipeline, 'pipeline', 'create_pipeline');
        if (pipeline.error) {
            return pipeline.error;
        }

        const normalizedPipeline = this.normalizePipelineMutationBody(pipeline.value || {}, 'create_pipeline');
        if (normalizedPipeline.error) {
            return normalizedPipeline.error;
        }

        if (this.isMissingRequiredValue(normalizedPipeline.value?.name)) {
            return this.buildError(
                'MISSING_REQUIRED_PARAM',
                'create_pipeline 缺少 pipeline.name。',
                '请在 pipeline 中提供数据流名称。'
            );
        }

        if (this.isMissingRequiredValue(normalizedPipeline.value?.platform)) {
            return this.buildError(
                'MISSING_REQUIRED_PARAM',
                'create_pipeline 缺少 pipeline.platform。',
                '请在 pipeline 中提供目标平台。'
            );
        }

        const response = await this.client.post('/api/v3/pipelineconfig/pipelines/', normalizedPipeline.value);
        return this.formatMutationResponse(
            response,
            'create_pipeline 上游接口返回失败。',
            '请检查 pipeline.name、pipeline.platform 和 pipeline.detail。',
            (data) => this.formatPipelineMutationResponse(data, 'create', normalizedPipeline.value)
        );
    }

    async updatePipeline(params: any): Promise<any> {
        const id = this.requireId(params?.id, 'update_pipeline 需要 id。');
        if (id.error) {
            return id.error;
        }

        const changes = this.parseObjectInput(params?.changes, 'changes', 'update_pipeline');
        if (changes.error) {
            return changes.error;
        }

        const normalizedChanges = this.normalizePipelineMutationBody(changes.value || {}, 'update_pipeline');
        if (normalizedChanges.error) {
            return normalizedChanges.error;
        }

        if (Object.keys(normalizedChanges.value || {}).length === 0) {
            return this.buildError(
                'EMPTY_MUTATION_BODY',
                'update_pipeline 的 changes 不能为空对象。',
                '请至少提供一个可更新字段，例如 name、platform、memo、detail。'
            );
        }

        const response = await this.client.put(`/api/v3/pipelineconfig/pipelines/${id.value}/`, normalizedChanges.value);
        return this.formatMutationResponse(
            response,
            'update_pipeline 上游接口返回失败。',
            '请检查 pipeline id 和 changes 字段后重试。',
            (data) => this.formatPipelineMutationResponse(data, 'update', normalizedChanges.value, id.value)
        );
    }

    async deletePipeline(params: any): Promise<any> {
        const id = this.requireId(params?.id, 'delete_pipeline 需要 id。');
        if (id.error) {
            return id.error;
        }
        const idValue = id.value!;

        const response = await this.client.delete(`/api/v3/pipelineconfig/pipelines/${idValue}/`);
        return this.formatMutationResponse(
            response,
            'delete_pipeline 上游接口返回失败。',
            '请确认 pipeline id 是否正确。',
            (data) => this.formatSimpleMutationResult(data, 'delete_pipeline', 'delete', idValue)
        );
    }

    async getPipelineGroups(params: any): Promise<any> {
        const id = this.requireId(params?.id, 'get_pipeline_groups 需要 id。');
        if (id.error) {
            return id.error;
        }
        const idValue = id.value!;

        const response = await this.client.get(`/api/v3/pipelineconfig/pipelines/${idValue}/groups/`, this.pickDefined({
            page: params?.page,
            size: params?.size
        }));

        if (response.error) {
            return response;
        }

        if (this.isUpstreamBusinessError(response.data)) {
            return this.buildError(
                'UPSTREAM_BUSINESS_ERROR',
                'get_pipeline_groups 上游接口返回失败。',
                '请确认 pipeline id 是否正确。',
                response.data
            );
        }

        return {
            ...response,
            raw_data: response.data,
            data: this.formatPipelineGroupsResponse(response.data, idValue)
        };
    }

    async addPipelineGroups(params: any): Promise<any> {
        const id = this.requireId(params?.id, 'add_pipeline_groups 需要 id。');
        if (id.error) {
            return id.error;
        }
        const idValue = id.value!;

        const groupIds = this.normalizeGroupIds(params?.group_ids, 'add_pipeline_groups');
        if (groupIds.error) {
            return groupIds.error;
        }

        const response = await this.client.post(`/api/v3/pipelineconfig/pipelines/${idValue}/groups/`, {
            group_ids: groupIds.value
        });

        return this.formatMutationResponse(
            response,
            'add_pipeline_groups 上游接口返回失败。',
            '请确认 pipeline id 和 group_ids 是否正确。',
            (data) => this.formatPipelineGroupMutationResponse(data, 'add', idValue, groupIds.value as unknown[])
        );
    }

    async replacePipelineGroups(params: any): Promise<any> {
        const id = this.requireId(params?.id, 'replace_pipeline_groups 需要 id。');
        if (id.error) {
            return id.error;
        }
        const idValue = id.value!;

        const groupIds = this.normalizeGroupIds(params?.group_ids, 'replace_pipeline_groups');
        if (groupIds.error) {
            return groupIds.error;
        }

        const response = await this.client.put(`/api/v3/pipelineconfig/pipelines/${idValue}/groups/`, {
            group_ids: groupIds.value
        });

        return this.formatMutationResponse(
            response,
            'replace_pipeline_groups 上游接口返回失败。',
            '请确认 pipeline id 和 group_ids 是否正确。',
            (data) => this.formatPipelineGroupMutationResponse(data, 'replace', idValue, groupIds.value as unknown[])
        );
    }

    async deletePipelineGroups(params: any): Promise<any> {
        const id = this.requireId(params?.id, 'delete_pipeline_groups 需要 id。');
        if (id.error) {
            return id.error;
        }
        const idValue = id.value!;

        const response = await this.client.delete(`/api/v3/pipelineconfig/pipelines/${idValue}/groups/`);
        return this.formatMutationResponse(
            response,
            'delete_pipeline_groups 上游接口返回失败。',
            '请确认 pipeline id 是否正确。',
            (data) => this.formatSimpleMutationResult(data, 'delete_pipeline_groups', 'delete_groups', idValue)
        );
    }

    async getPipelineAgentStatus(params: any): Promise<any> {
        const id = this.requireId(params?.id, 'get_pipeline_agent_status 需要 id。');
        if (id.error) {
            return id.error;
        }
        const idValue = id.value!;
        const groupIds = this.resolveGroupIdsQuery(params?.group_ids);

        const response = await this.client.get(`/api/v3/pipelineconfig/pipelines/${idValue}/status/`, this.pickDefined({
            page: params?.page,
            size: params?.size,
            filter: params?.filter,
            group_ids: groupIds,
            sort: params?.sort,
            order: params?.order,
            status: params?.status
        }));

        if (response.error) {
            return response;
        }

        if (this.isUpstreamBusinessError(response.data)) {
            return this.buildError(
                'UPSTREAM_BUSINESS_ERROR',
                'get_pipeline_agent_status 上游接口返回失败。',
                '请确认 pipeline id 是否正确，或缩小筛选范围后重试。',
                response.data
            );
        }

        return {
            ...response,
            raw_data: response.data,
            data: this.formatPipelineAgentStatusResponse(response.data, idValue)
        };
    }

    async listAvailablePipelineAgents(params: any): Promise<any> {
        const platform = this.requireNonEmptyString(params?.platform, 'list_available_pipeline_agents 需要 platform。', '请传入目标平台，例如 linux-x64。');
        if (platform.error) {
            return platform.error;
        }
        const platformValue = platform.value!;
        const groupIds = this.resolveGroupIdsQuery(params?.group_ids);

        const response = await this.client.get('/api/v3/pipelineconfig/agents/', this.pickDefined({
            page: params?.page,
            size: params?.size,
            filter: params?.filter,
            group_ids: groupIds,
            sort: params?.sort,
            order: params?.order,
            platform: platformValue,
            exclude_instance: params?.exclude_instance
        }));

        if (response.error) {
            return response;
        }

        if (this.isUpstreamBusinessError(response.data)) {
            return this.buildError(
                'UPSTREAM_BUSINESS_ERROR',
                'list_available_pipeline_agents 上游接口返回失败。',
                '请检查 platform 是否正确。',
                response.data
            );
        }

        return {
            ...response,
            raw_data: response.data,
            data: this.formatAvailablePipelineAgentsResponse(response.data, platformValue)
        };
    }

    async listAvailablePipelineAgentGroups(params: any): Promise<any> {
        const response = await this.client.get('/api/v3/pipelineconfig/agentgroups/', this.pickDefined({
            permit: params?.permit
        }));

        if (response.error) {
            return response;
        }

        if (this.isUpstreamBusinessError(response.data)) {
            return this.buildError(
                'UPSTREAM_BUSINESS_ERROR',
                'list_available_pipeline_agent_groups 上游接口返回失败。',
                '请稍后重试，或确认当前账号具备访问分组的权限。',
                response.data
            );
        }

        return {
            ...response,
            raw_data: response.data,
            data: this.formatAvailablePipelineAgentGroupsResponse(response.data)
        };
    }

    private formatMutationResponse(
        response: any,
        upstreamErrorMessage: string,
        suggestion: string,
        formatter: (data: any) => any
    ): any {
        if (response.error) {
            return response;
        }

        if (this.isUpstreamBusinessError(response.data)) {
            return this.buildError('UPSTREAM_BUSINESS_ERROR', upstreamErrorMessage, suggestion, response.data);
        }

        return {
            ...response,
            raw_data: response.data,
            data: formatter(response.data)
        };
    }

    private formatAgentListResponse(data: any): any {
        const meta = this.extractMeta(data);
        const items = this.ensureArray(data?.objects).map((item: any) => ({
            id: item?.id ?? null,
            ip: item?.ip ?? null,
            port: item?.port ?? null,
            hostname: item?.hostname ?? null,
            platform: item?.platform ?? null,
            os: item?.os ?? null,
            status: item?.status ?? null,
            group_ids: item?.group_ids ?? null,
            cur_version: item?.cur_version ?? null,
            expected_version: item?.expected_version ?? null,
            last_update_timestamp: item?.last_update_timestamp ?? null
        }));

        return {
            traceid: data?.traceid,
            upstream_result: data?.result,
            summary: {
                total: meta.total ?? items.length,
                returned: meta.count ?? items.length,
                page: meta.page ?? null,
                size: meta.size ?? null
            },
            items,
            meta
        };
    }

    private formatAgentGroupListResponse(data: any, assignableOnly = false): any {
        const meta = this.extractMeta(data);
        const items = this.ensureArray(data?.objects).map((item: any) => {
            const base = {
                id: item?.id ?? null,
                name: item?.name ?? null,
                memo: item?.memo ?? null,
                creator_id: item?.creator_id ?? null,
                from_app: item?.from_app ?? null
            };

            if (assignableOnly) {
                return {
                    ...base,
                    resource_ids: this.ensureArray(item?.resource_ids),
                    extra: item?.extra ?? null
                };
            }

            return {
                ...base,
                rt_list: this.ensureArray(item?.rt_list),
                is_collected: item?.is_collected ?? null
            };
        });

        return {
            traceid: data?.traceid,
            upstream_result: data?.result,
            summary: {
                total: meta.total ?? items.length,
                returned: meta.count ?? items.length,
                assignable_only: assignableOnly
            },
            items,
            meta
        };
    }

    private formatAgentGroupDetailResponse(data: any): any {
        const detail = data?.object ?? null;
        return {
            traceid: data?.traceid,
            upstream_result: data?.result,
            summary: {
                id: detail?.id ?? null,
                name: detail?.name ?? null,
                memo: detail?.memo ?? null
            },
            detail
        };
    }

    private formatAgentGroupMutationResponse(data: any, action: string, name?: string, id?: string): any {
        const object = data?.object ?? null;
        return {
            action,
            target_id: object?.id ?? id ?? null,
            target_name: object?.name ?? name ?? null,
            upstream_result: data?.result,
            object
        };
    }

    private formatGroupMembershipResponse(data: any, action: string, groupId: string, targetAgents: Array<Record<string, unknown>>): any {
        const objects = this.ensureArray(data?.objects);
        return {
            action,
            group_id: groupId,
            requested_agent_count: targetAgents.length,
            affected_count: objects.length,
            upstream_result: data?.result,
            objects
        };
    }

    private formatGroupRemovalResponse(data: any, groupId: string, targetAgents: string): any {
        const objects = this.ensureArray(data?.objects);
        return {
            action: 'remove',
            group_id: groupId,
            target_agents: targetAgents,
            affected_count: objects.length,
            upstream_result: data?.result,
            objects
        };
    }

    private formatPipelineSchemasResponse(data: any, kind: string, platform: string): any {
        const types = this.ensureArray(data?.data?.types);
        return {
            traceid: data?.traceid,
            upstream_result: data?.result,
            summary: {
                kind,
                platform,
                schema_count: types.length
            },
            items: types
        };
    }

    private formatPipelineListResponse(data: any): any {
        const list = this.ensureArray(data?.data?.Configurations);
        return {
            traceid: data?.traceid,
            upstream_result: data?.result,
            summary: {
                total: data?.data?.Total ?? list.length,
                returned: list.length
            },
            items: list
        };
    }

    private formatPipelineDetailResponse(data: any): any {
        const detail = data?.data ?? null;
        return {
            traceid: data?.traceid,
            upstream_result: data?.result,
            summary: {
                id: detail?.id ?? null,
                uuid: detail?.uuid ?? null,
                name: detail?.name ?? null,
                platform: detail?.platform ?? null
            },
            detail
        };
    }

    private formatPipelineMutationResponse(data: any, action: string, payload?: Record<string, unknown>, id?: string): any {
        return {
            action,
            target_id: data?.data?.id ?? id ?? null,
            target_uuid: data?.data?.uuid ?? null,
            target_name: payload?.name ?? null,
            upstream_result: data?.result,
            data: data?.data ?? null
        };
    }

    private formatPipelineGroupsResponse(data: any, pipelineId: string): any {
        const groups = this.ensureArray(data?.data?.groups);
        return {
            traceid: data?.traceid,
            upstream_result: data?.result,
            summary: {
                pipeline_id: pipelineId,
                total: data?.data?.total ?? groups.length,
                returned: groups.length
            },
            items: groups
        };
    }

    private formatPipelineGroupMutationResponse(data: any, action: string, pipelineId: string, groupIds: unknown[]): any {
        return {
            action,
            pipeline_id: pipelineId,
            group_ids: groupIds,
            upstream_result: data?.result,
            data: data?.data ?? null
        };
    }

    private formatPipelineAgentStatusResponse(data: any, pipelineId: string): any {
        const syncStatus = this.ensureArray(data?.data?.sync_status);
        return {
            traceid: data?.traceid,
            upstream_result: data?.result,
            summary: {
                pipeline_id: pipelineId,
                total: data?.data?.total ?? syncStatus.length,
                returned: syncStatus.length
            },
            items: syncStatus
        };
    }

    private formatAvailablePipelineAgentsResponse(data: any, platform: string): any {
        const agents = this.ensureArray(data?.data?.agents);
        return {
            traceid: data?.traceid,
            upstream_result: data?.result,
            summary: {
                platform,
                total: data?.data?.total ?? agents.length,
                returned: agents.length
            },
            items: agents
        };
    }

    private formatAvailablePipelineAgentGroupsResponse(data: any): any {
        const groups = this.ensureArray(data?.data?.groups);
        return {
            traceid: data?.traceid,
            upstream_result: data?.result,
            summary: {
                total: groups.length
            },
            items: groups
        };
    }

    private formatSimpleMutationResult(data: any, toolName: string, action: string, id: string): any {
        return {
            tool: toolName,
            action,
            target_id: id,
            upstream_result: data?.result,
            data: data?.data ?? data?.object ?? null
        };
    }

    private normalizePipelineMutationBody(
        payload: Record<string, unknown>,
        toolName: 'create_pipeline' | 'update_pipeline'
    ): { value?: Record<string, unknown>; error?: any } {
        const normalized = this.pickDefined({
            name: payload?.name,
            platform: payload?.platform,
            memo: payload?.memo,
            detail: payload?.detail
        });

        if (typeof normalized.detail !== 'undefined') {
            const detail = this.normalizeJsonLikeField(normalized.detail, `${toolName}.detail`);
            if (detail.error) {
                return { error: detail.error };
            }
            normalized.detail = detail.value;
        }

        return { value: normalized };
    }

    private normalizeJsonLikeField(rawValue: unknown, fieldPath: string): { value?: string; error?: any } {
        if (typeof rawValue === 'string') {
            const trimmed = rawValue.trim();
            if (!trimmed) {
                return {
                    error: this.buildError(
                        'INVALID_JSON_STRING',
                        `${fieldPath} 不能为空字符串。`,
                        `请确保 ${fieldPath} 是合法 JSON 字符串，或直接传对象。`
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

        if (this.isPlainObject(rawValue) || Array.isArray(rawValue)) {
            return { value: JSON.stringify(rawValue) };
        }

        return {
            error: this.buildError(
                'INVALID_PARAM_TYPE',
                `${fieldPath} 必须是对象、数组或合法 JSON 字符串。`,
                `请把 ${fieldPath} 传成对象/数组，或传入合法 JSON 字符串。`
            )
        };
    }

    private normalizeTargetAgentsForAdd(rawValue: unknown, groupId: string): { value?: Array<Record<string, unknown>>; error?: any } {
        const list = this.parseArrayLike(rawValue);
        if (list.error) {
            return { error: list.error };
        }

        const normalized = (list.value || []).map((item) => {
            if (typeof item === 'number' || typeof item === 'string') {
                return {
                    id: Number(item),
                    group_ids: groupId
                };
            }

            if (this.isPlainObject(item)) {
                const id = item.id;
                return this.pickDefined({
                    id: typeof id === 'string' ? Number(id) : id,
                    group_ids: this.resolveString(item.group_ids, groupId)
                });
            }

            return {
                id: Number(item),
                group_ids: groupId
            };
        }).filter((item) => typeof item.id !== 'undefined' && !Number.isNaN(Number(item.id)));

        if (normalized.length === 0) {
            return {
                error: this.buildError(
                    'MISSING_REQUIRED_PARAM',
                    'add_agents_to_group 需要 target_agents。',
                    '请传入 Agent id 数组，或传入包含 id 的对象数组。'
                )
            };
        }

        return { value: normalized };
    }

    private normalizeTargetAgentsForRemove(rawValue: unknown): { value?: string; error?: any } {
        if (typeof rawValue === 'string' && rawValue.trim()) {
            return { value: rawValue.trim() };
        }

        const list = this.parseArrayLike(rawValue);
        if (list.error) {
            return { error: list.error };
        }

        const ids = (list.value || []).map((item) => {
            if (typeof item === 'number' || typeof item === 'string') {
                return String(item).trim();
            }
            if (this.isPlainObject(item) && typeof item.id !== 'undefined') {
                return String(item.id).trim();
            }
            return '';
        }).filter(Boolean);

        if (ids.length === 0) {
            return {
                error: this.buildError(
                    'MISSING_REQUIRED_PARAM',
                    'remove_agents_from_group 需要 target_agents。',
                    '请传入 Agent id 的逗号分隔字符串，或传入 Agent id 数组。'
                )
            };
        }

        return { value: ids.join(',') };
    }

    private normalizeGroupIds(rawValue: unknown, toolName: string): { value?: unknown[]; error?: any } {
        const list = this.parseArrayLike(rawValue);
        if (list.error) {
            return list;
        }

        if (!list.value || list.value.length === 0) {
            return {
                error: this.buildError(
                    'MISSING_REQUIRED_PARAM',
                    `${toolName} 需要 group_ids。`,
                    '请传入分组 id 数组。'
                )
            };
        }

        return { value: list.value };
    }

    private resolveGroupIdsQuery(rawValue: unknown): string {
        if (typeof rawValue === 'string' && rawValue.trim()) {
            return rawValue.trim();
        }

        return 'all';
    }

    private resolveBooleanFlag(rawValue: unknown): boolean {
        if (typeof rawValue === 'boolean') {
            return rawValue;
        }

        if (typeof rawValue === 'string') {
            const normalized = rawValue.trim().toLowerCase();
            return normalized === 'true' || normalized === '1' || normalized === 'yes';
        }

        return false;
    }

    private parseObjectInput(
        rawValue: unknown,
        fieldName: string,
        toolName: string
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
                    `请把 ${fieldName} 传成对象，或传入合法 JSON 对象字符串。`
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

    private parseArrayLike(rawValue: unknown): { value?: unknown[]; error?: any } {
        if (Array.isArray(rawValue)) {
            return { value: rawValue };
        }

        if (typeof rawValue === 'string') {
            const trimmed = rawValue.trim();
            if (!trimmed) {
                return { value: [] };
            }

            if (trimmed.startsWith('[')) {
                try {
                    const parsed = JSON.parse(trimmed);
                    if (Array.isArray(parsed)) {
                        return { value: parsed };
                    }
                    return {
                        error: this.buildError(
                            'INVALID_PARAM_TYPE',
                            '参数必须是数组。',
                            '请传入数组，或传入可解析为数组的 JSON 字符串。'
                        )
                    };
                } catch (error: any) {
                    return {
                        error: this.buildError(
                            'INVALID_JSON_STRING',
                            '参数不是合法 JSON 数组字符串。',
                            '请检查 JSON 语法，例如引号、逗号、括号是否完整。',
                            {
                                parse_error: error?.message || 'JSON parse failed',
                                preview: trimmed.slice(0, 300)
                            }
                        )
                    };
                }
            }

            return {
                value: trimmed.split(',').map((item) => item.trim()).filter(Boolean)
            };
        }

        return {
            error: this.buildError(
                'INVALID_PARAM_TYPE',
                '参数必须是数组、逗号分隔字符串，或合法 JSON 数组字符串。',
                '请传入数组，或传入逗号分隔字符串。'
            )
        };
    }

    private requireId(rawId: unknown, message: string): { value?: string; error?: any } {
        if (typeof rawId === 'undefined' || rawId === null || rawId === '') {
            return {
                error: this.buildError(
                    'MISSING_REQUIRED_PARAM',
                    message,
                    '请提供目标资源 id。'
                )
            };
        }

        return { value: String(rawId) };
    }

    private requireNonEmptyString(rawValue: unknown, message: string, suggestion: string): { value?: string; error?: any } {
        if (typeof rawValue !== 'string' || !rawValue.trim()) {
            return {
                error: this.buildError(
                    'MISSING_REQUIRED_PARAM',
                    message,
                    suggestion
                )
            };
        }

        return { value: rawValue.trim() };
    }

    private extractMeta(data: any): Record<string, unknown> {
        return this.isPlainObject(data?.meta) ? data.meta : {};
    }

    private ensureArray(value: unknown): any[] {
        if (Array.isArray(value)) {
            return value;
        }

        if (this.isPlainObject(value)) {
            return Object.values(value);
        }

        return [];
    }

    private normalizeBooleanQuery(rawValue: unknown): string | boolean | undefined {
        if (typeof rawValue === 'boolean') {
            return rawValue;
        }

        if (typeof rawValue === 'string' && rawValue.trim()) {
            return rawValue;
        }

        return undefined;
    }

    private resolveString(value: unknown, fallback?: string): string | undefined {
        if (typeof value === 'string' && value.trim()) {
            return value.trim();
        }

        return fallback;
    }

    private pickDefined(values: Record<string, unknown>): Record<string, unknown> {
        return Object.fromEntries(
            Object.entries(values).filter(([, value]) => typeof value !== 'undefined')
        );
    }

    private isUpstreamBusinessError(data: any): boolean {
        return !!(data && typeof data === 'object' && data.result === false);
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
