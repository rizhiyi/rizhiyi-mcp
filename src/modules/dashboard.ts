import { LogEaseClient } from '../client.js';

export class DashboardModule {
    private client: LogEaseClient;
    private readonly supportedPanelTypes = new Set(['trend', 'eventsTable']);
    private readonly trendChartTypes = new Set([
        'line',
        'pie',
        'single',
        'table',
        'sunburst',
        'multiaxis',
        'bar',
        'column',
        'scatter',
        'area',
        'networkflow',
        'tracing'
    ]);

    constructor(client: LogEaseClient) {
        this.client = client;
    }

    async createDashboard(params: any): Promise<any> {
        return this.createDashboardFromSpec(params);
    }

    async createDashboardFromTemplate(params: any): Promise<any> {
        const { template, name, context = {}, app_id, data_user = 'viewer', export: exportType = 'local' } = params || {};

        if (!template || !name) {
            return this.buildError(
                'MISSING_REQUIRED_PARAM',
                'create_dashboard_from_template 需要 template 和 name。',
                '请提供模板名称以及仪表盘名称。'
            );
        }

        const spec = this.buildTemplateSpec(template, name, context, { app_id, data_user, export: exportType });
        if (!spec) {
            return this.buildError(
                'UNKNOWN_DASHBOARD_TEMPLATE',
                `未知的仪表盘模板: ${template}`,
                '可选模板：service_overview、error_investigation、traffic_trend、host_health。'
            );
        }

        return this.createDashboardFromSpec(spec);
    }

    async createDashboardFromSpec(params: any): Promise<any> {
        try {
            const normalizedSpec = this.normalizeDashboardSpec(params || {});
            const specValidationError = this.validateDashboardSpec(normalizedSpec);
            if (specValidationError) {
                return specValidationError;
            }

            const { name, app_id, tabs = [], data_user = 'viewer', export: exportType = 'local' } = normalizedSpec;

            const baseDashboardPayload: Record<string, unknown> = {
                name,
                data_user,
                export: exportType,
                active_tab: 0,
                default_display: 0
            };
            if (typeof app_id === 'number') {
                baseDashboardPayload.app_id = app_id;
            }

            const buildDashboardPayload = (includeAppId: boolean): Record<string, unknown> => {
                if (includeAppId && typeof app_id === 'number') {
                    return { ...baseDashboardPayload, app_id };
                }
                const { app_id: _, ...payloadWithoutAppId } = baseDashboardPayload;
                return payloadWithoutAppId;
            };

            const isAppIdNotFound = (data: any): boolean => {
                return data?.error?.code === '8703' && String(data?.error?.message || '').includes('app_id is not found');
            };

            let dashboardRes = await this.client.post('/api/v3/dashboards/', buildDashboardPayload(true));
            let dashboardData = dashboardRes.data as any;
            let dashboardId = dashboardData?.object?.id;

            if (!dashboardId && typeof app_id === 'number' && isAppIdNotFound(dashboardData)) {
                dashboardRes = await this.client.post('/api/v3/dashboards/', buildDashboardPayload(false));
                dashboardData = dashboardRes.data as any;
                dashboardId = dashboardData?.object?.id;
            }

            if (!dashboardId) {
                if (dashboardRes.error) {
                    throw new Error(`Failed to create dashboard: ${dashboardRes.message}`);
                }
                throw new Error('Failed to create dashboard, no ID returned: ' + JSON.stringify(dashboardData));
            }
            const createdTabs = [];

            for (let i = 0; i < tabs.length; i++) {
                const tab = tabs[i];
                const widgets = (tab.panels || []).map((panel: any, index: number) => this.panelToWidget(panel, index));

                const tabContent = {
                    refresh: { time: 3, unit: 'm', on: false, showRefreshProcess: true },
                    showFilters: true,
                    showTitle: true,
                    editable: true,
                    scheme: 'schemecat1',
                    theme: 'day',
                    activeDrilldown: false,
                    autoUpdate: true,
                    filters: [],
                    widgets: widgets
                };

                const tabPayload = {
                    name: tab.name || `Tab ${i + 1}`,
                    content: JSON.stringify(tabContent)
                };

                const tabRes = await this.client.post(`/api/v3/dashboards/${dashboardId}/tabs/`, tabPayload);
                const tabData = tabRes.data as any;
                if (tabRes.error || (tabData && tabData.result === false && tabData.error)) {
                    throw new Error(`Failed to create tab "${tabPayload.name}": ${JSON.stringify(tabData || tabRes.details || tabRes.message)}`);
                }
                createdTabs.push(tabData?.object || tabData);
            }

            return {
                status: 200,
                data: {
                    dashboard_id: dashboardId,
                    name: name,
                    tabs_created: createdTabs.length,
                    tabs: createdTabs.map((tab: any) => ({
                        id: tab?.id,
                        name: tab?.name
                    })),
                    message: 'Dashboard created successfully'
                }
            };
        } catch (error: any) {
            return this.buildError(
                'DASHBOARD_EXECUTION_ERROR',
                error.message,
                '请检查仪表盘名称、tabs、panels、query 和布局配置后重试。',
                error.response?.data || null
            );
        }
    }

    async updateDashboardLayout(params: any): Promise<any> {
        const { dashboard_id, tab_name, layout_strategy = 'auto_two_columns', panel_positions } = params || {};
        if (!dashboard_id || !tab_name) {
            return this.buildError(
                'MISSING_REQUIRED_PARAM',
                'update_dashboard_layout 需要 dashboard_id 和 tab_name。',
                '请提供目标仪表盘 ID 和标签页名称。'
            );
        }

        const contextResult = await this.loadTabContext(dashboard_id, tab_name);
        if (contextResult.error) {
            return contextResult;
        }

        const { dashboard, tab, content } = contextResult.data;
        const widgets = Array.isArray(content.widgets) ? [...content.widgets] : [];

        if (widgets.length === 0) {
            return this.buildError(
                'EMPTY_TAB',
                `标签页 ${tab_name} 下没有 panel，无法调整布局。`,
                '请先通过 add_dashboard_panel 添加 panel。'
            );
        }

        let updatedWidgets = widgets;
        if (Array.isArray(panel_positions) && panel_positions.length > 0) {
            const positionsMap = new Map<string, any>();
            for (const item of panel_positions) {
                if (item?.panel_title) {
                    positionsMap.set(item.panel_title, item);
                }
            }

            updatedWidgets = widgets.map((widget: any, index: number) => {
                const title = this.getWidgetTitle(widget) || `Panel ${index + 1}`;
                const override = positionsMap.get(title);
                if (!override) return widget;
                return {
                    ...widget,
                    x: override.x ?? widget.x ?? 0,
                    y: override.y ?? widget.y ?? 0,
                    w: override.w ?? widget.w ?? 6,
                    h: override.h ?? widget.h ?? 5,
                };
            });
        } else {
            updatedWidgets = this.applyLayoutStrategy(widgets, layout_strategy);
        }

        const updatedContent = {
            ...content,
            widgets: updatedWidgets
        };

        const saveResult = await this.saveTabContent(dashboard_id, tab, updatedContent);
        if (saveResult.error) {
            return saveResult;
        }

        return {
            status: 200,
            data: {
                dashboard_id,
                dashboard_name: dashboard?.name,
                tab_id: tab.id,
                tab_name: tab.name,
                layout_strategy: Array.isArray(panel_positions) && panel_positions.length > 0 ? 'manual_positions' : layout_strategy,
                panels_updated: updatedWidgets.length,
                message: 'Dashboard layout updated successfully'
            }
        };
    }

    async listDashboardTabs(params: any): Promise<any> {
        const { dashboard_id } = params || {};
        if (!dashboard_id) {
            return this.buildError(
                'MISSING_REQUIRED_PARAM',
                'list_dashboard_tabs 需要 dashboard_id。',
                '请提供目标仪表盘 ID。'
            );
        }

        const dashboardResult = await this.getDashboard(dashboard_id);
        if (dashboardResult.error) {
            return dashboardResult;
        }

        const dashboard = dashboardResult.data;
        const tabs = Array.isArray(dashboard?.tabs) ? dashboard.tabs : [];

        return {
            status: 200,
            data: {
                dashboard_id,
                dashboard_name: dashboard?.name,
                tab_count: tabs.length,
                tabs: tabs.map((tab: any) => {
                    const contentResult = this.parseTabContent(tab?.content);
                    const widgets = contentResult.error ? [] : Array.isArray(contentResult.data?.widgets) ? contentResult.data.widgets : [];
                    return {
                        id: tab?.id,
                        name: tab?.name,
                        panel_count: widgets.length
                    };
                }),
                message: 'Dashboard tabs listed successfully'
            }
        };
    }

    async listDashboardPanels(params: any): Promise<any> {
        const { dashboard_id, tab_name } = params || {};
        if (!dashboard_id || !tab_name) {
            return this.buildError(
                'MISSING_REQUIRED_PARAM',
                'list_dashboard_panels 需要 dashboard_id 和 tab_name。',
                '请提供目标仪表盘 ID 和标签页名称。'
            );
        }

        const contextResult = await this.loadTabContext(dashboard_id, tab_name);
        if (contextResult.error) {
            return contextResult;
        }

        const { dashboard, tab, content } = contextResult.data;
        const widgets = Array.isArray(content.widgets) ? content.widgets : [];

        return {
            status: 200,
            data: {
                dashboard_id,
                dashboard_name: dashboard?.name,
                tab_id: tab.id,
                tab_name: tab.name,
                panel_count: widgets.length,
                panels: widgets.map((widget: any, index: number) => ({
                    panel_id: this.getWidgetId(widget),
                    index,
                    title: this.getWidgetTitle(widget) || `Panel ${index + 1}`,
                    type: widget?.type || 'trend',
                    query: widget?.searchData?.query || '*',
                    time_range: widget?.searchData?.time_range || '-1h,now',
                    chartType: widget?.searchData?.chartType || '',
                    grid: {
                        x: widget?.x ?? 0,
                        y: widget?.y ?? 0,
                        w: widget?.w ?? 6,
                        h: widget?.h ?? 5
                    }
                })),
                message: 'Dashboard panels listed successfully'
            }
        };
    }

    async addDashboardPanel(params: any): Promise<any> {
        const { dashboard_id, tab_name, panel } = params || {};
        if (!dashboard_id || !tab_name || !panel) {
            return this.buildError(
                'MISSING_REQUIRED_PARAM',
                'add_dashboard_panel 需要 dashboard_id、tab_name 和 panel。',
                '请提供目标仪表盘、标签页以及 panel 配置。'
            );
        }

        const panelError = this.validatePanelSpec(panel);
        if (panelError) {
            return panelError;
        }

        const contextResult = await this.loadTabContext(dashboard_id, tab_name);
        if (contextResult.error) {
            return contextResult;
        }

        const { dashboard, tab, content } = contextResult.data;
        const widgets = Array.isArray(content.widgets) ? [...content.widgets] : [];
        const panelTitle = panel.title;

        if (this.findPanelMatches(widgets, panelTitle).length > 0) {
            return this.buildError(
                'PANEL_ALREADY_EXISTS',
                `标签页 ${tab_name} 下已存在同名 panel: ${panelTitle}`,
                '请修改 panel.title，或使用 update_dashboard_panel 更新已有 panel。'
            );
        }

        const normalizedPanel = this.normalizePanelSpec(panel, widgets.length);
        widgets.push(this.panelToWidget(normalizedPanel, widgets.length));

        const updatedContent = {
            ...content,
            widgets
        };

        const saveResult = await this.saveTabContent(dashboard_id, tab, updatedContent);
        if (saveResult.error) {
            return saveResult;
        }

        return {
            status: 200,
            data: {
                dashboard_id,
                dashboard_name: dashboard?.name,
                tab_id: tab.id,
                tab_name: tab.name,
                panel_id: this.getWidgetId(widgets[widgets.length - 1]),
                panel_title: panelTitle,
                panel_type: normalizedPanel.type,
                total_panels: widgets.length,
                message: 'Dashboard panel added successfully'
            }
        };
    }

    async updateDashboardPanel(params: any): Promise<any> {
        const { dashboard_id, tab_name, panel_id, panel_title, changes = {} } = params || {};
        if (!dashboard_id || !tab_name || (!panel_id && !panel_title)) {
            return this.buildError(
                'MISSING_REQUIRED_PARAM',
                'update_dashboard_panel 需要 dashboard_id、tab_name，以及 panel_id 或 panel_title。',
                '请提供目标仪表盘、标签页，并至少提供一个 panel 标识。'
            );
        }

        const contextResult = await this.loadTabContext(dashboard_id, tab_name);
        if (contextResult.error) {
            return contextResult;
        }

        const { dashboard, tab, content } = contextResult.data;
        const widgets = Array.isArray(content.widgets) ? [...content.widgets] : [];
        const matches = this.findPanelMatches(widgets, { panelId: panel_id, panelTitle: panel_title });

        if (matches.length === 0) {
            return this.buildError(
                'PANEL_NOT_FOUND',
                `未找到 panel: ${panel_id || panel_title}`,
                '请先通过 list_dashboard_panels 确认 panel_id 或 panel_title 是否正确。'
            );
        }
        if (matches.length > 1) {
            return this.buildError(
                'PANEL_NOT_UNIQUE',
                `标签页 ${tab_name} 下存在多个同名 panel: ${panel_title}`,
                '请改用 panel_id 精准定位。'
            );
        }

        const match = matches[0];
        const existingPanel = this.widgetToPanel(match.widget);
        const mergedPanel = this.normalizePanelSpec({
            ...existingPanel,
            ...changes,
            grid: {
                ...(existingPanel.grid || {}),
                ...(changes.grid || {})
            }
        }, match.index);

        const panelError = this.validatePanelSpec(mergedPanel);
        if (panelError) {
            return panelError;
        }

        widgets[match.index] = this.panelToWidget(mergedPanel, match.index, match.widget.id);

        const updatedContent = {
            ...content,
            widgets
        };

        const saveResult = await this.saveTabContent(dashboard_id, tab, updatedContent);
        if (saveResult.error) {
            return saveResult;
        }

        return {
            status: 200,
            data: {
                dashboard_id,
                dashboard_name: dashboard?.name,
                tab_id: tab.id,
                tab_name: tab.name,
                panel_id: this.getWidgetId(match.widget),
                panel_title_before: this.getWidgetTitle(match.widget),
                panel_title_after: mergedPanel.title,
                message: 'Dashboard panel updated successfully'
            }
        };
    }

    async removeDashboardPanel(params: any): Promise<any> {
        const { dashboard_id, tab_name, panel_id, panel_title } = params || {};
        if (!dashboard_id || !tab_name || (!panel_id && !panel_title)) {
            return this.buildError(
                'MISSING_REQUIRED_PARAM',
                'remove_dashboard_panel 需要 dashboard_id、tab_name，以及 panel_id 或 panel_title。',
                '请提供目标仪表盘、标签页，并至少提供一个 panel 标识。'
            );
        }

        const contextResult = await this.loadTabContext(dashboard_id, tab_name);
        if (contextResult.error) {
            return contextResult;
        }

        const { dashboard, tab, content } = contextResult.data;
        const widgets = Array.isArray(content.widgets) ? [...content.widgets] : [];
        const matches = this.findPanelMatches(widgets, { panelId: panel_id, panelTitle: panel_title });

        if (matches.length === 0) {
            return this.buildError(
                'PANEL_NOT_FOUND',
                `未找到 panel: ${panel_id || panel_title}`,
                '请先通过 list_dashboard_panels 确认 panel_id 或 panel_title 是否正确。'
            );
        }
        if (matches.length > 1) {
            return this.buildError(
                'PANEL_NOT_UNIQUE',
                `标签页 ${tab_name} 下存在多个同名 panel: ${panel_title}`,
                '请改用 panel_id 精准定位。'
            );
        }

        const matchedPanel = matches[0];
        const updatedWidgets = widgets.filter((_, index) => index !== matchedPanel.index);
        const updatedContent = {
            ...content,
            widgets: this.applyLayoutStrategy(updatedWidgets, 'auto_two_columns')
        };

        const saveResult = await this.saveTabContent(dashboard_id, tab, updatedContent);
        if (saveResult.error) {
            return saveResult;
        }

        return {
            status: 200,
            data: {
                dashboard_id,
                dashboard_name: dashboard?.name,
                tab_id: tab.id,
                tab_name: tab.name,
                panel_id: this.getWidgetId(matchedPanel.widget),
                panel_title: this.getWidgetTitle(matchedPanel.widget),
                remaining_panels: updatedWidgets.length,
                message: 'Dashboard panel removed successfully'
            }
        };
    }

    private async getDashboard(dashboardId: string | number): Promise<any> {
        const response = await this.client.get(`/api/v3/dashboards/${dashboardId}/`);
        const data = response.data as any;

        if (response.error) {
            return this.buildError(
                response.error_code || 'UPSTREAM_REQUEST_FAILED',
                response.message || response.error,
                response.suggestion || '请检查 dashboard_id 是否正确，并确认上游服务可用。',
                response.details
            );
        }

        if (data?.result === false && data?.error) {
            return this.buildError(
                'DASHBOARD_FETCH_FAILED',
                `获取仪表盘失败: ${JSON.stringify(data.error)}`,
                '请检查 dashboard_id 是否存在，以及当前账号是否有访问权限。'
            );
        }

        const dashboard = data?.object;
        if (!dashboard) {
            return this.buildError(
                'DASHBOARD_NOT_FOUND',
                `未找到 dashboard: ${dashboardId}`,
                '请确认 dashboard_id 是否正确。'
            );
        }

        return {
            status: 200,
            data: dashboard
        };
    }

    private async loadTabContext(dashboardId: string | number, tabName: string): Promise<any> {
        const dashboardResult = await this.getDashboard(dashboardId);
        if (dashboardResult.error) {
            return dashboardResult;
        }

        const dashboard = dashboardResult.data;
        const tabs = Array.isArray(dashboard?.tabs) ? dashboard.tabs : [];
        const tab = tabs.find((item: any) => item?.name === tabName);

        if (!tab) {
            return this.buildError(
                'TAB_NOT_FOUND',
                `未找到标签页: ${tabName}`,
                '请先确认 tab_name 是否正确，或先创建对应 tab。'
            );
        }

        const content = this.parseTabContent(tab.content);
        if (content.error) {
            return content;
        }

        return {
            status: 200,
            data: {
                dashboard,
                tab,
                content: content.data
            }
        };
    }

    private parseTabContent(rawContent: unknown): any {
        if (!rawContent) {
            return {
                status: 200,
                data: this.buildDefaultTabContent([])
            };
        }

        if (typeof rawContent === 'object') {
            return {
                status: 200,
                data: {
                    ...this.buildDefaultTabContent([]),
                    ...(rawContent as Record<string, unknown>)
                }
            };
        }

        if (typeof rawContent === 'string') {
            try {
                const parsed = JSON.parse(rawContent);
                return {
                    status: 200,
                    data: {
                        ...this.buildDefaultTabContent([]),
                        ...parsed
                    }
                };
            } catch {
                return this.buildError(
                    'INVALID_TAB_CONTENT',
                    '当前 tab 的 content 不是合法 JSON，无法安全更新。',
                    '请先检查 dashboard tab 的 content 数据结构。'
                );
            }
        }

        return this.buildError(
            'INVALID_TAB_CONTENT',
            '当前 tab 的 content 结构无法识别。',
            '请先检查 dashboard tab 的 content 数据结构。'
        );
    }

    private async saveTabContent(dashboardId: string | number, tab: any, content: Record<string, unknown>): Promise<any> {
        const payload = {
            name: tab.name,
            content: JSON.stringify(content)
        };

        const response = await this.client.put(`/api/v3/dashboards/${dashboardId}/tabs/${tab.id}/`, payload);
        const data = response.data as any;

        if (response.error) {
            return this.buildError(
                response.error_code || 'UPSTREAM_REQUEST_FAILED',
                response.message || response.error,
                response.suggestion || '更新 dashboard tab 失败，请检查参数和上游服务状态。',
                response.details
            );
        }

        if (data?.result === false && data?.error) {
            return this.buildError(
                'DASHBOARD_SAVE_FAILED',
                `更新 dashboard tab 失败: ${JSON.stringify(data.error)}`,
                '请检查 tab 内容是否符合日志易要求。'
            );
        }

        return {
            status: 200,
            data: data?.object || data
        };
    }

    private buildTemplateSpec(template: string, name: string, context: any, options: any): any | null {
        const query = context.query || '*';
        const timeRange = context.time_range || '-1h,now';
        const appname = context.appname;
        const hostField = context.host_field || 'hostname';
        const scopedQuery = appname ? `appname:${appname}` : query;

        const templates: Record<string, any> = {
            service_overview: {
                name,
                ...options,
                tabs: [{
                    name: '总览',
                    panels: [
                        { title: '服务请求趋势', type: 'trend', query: scopedQuery, time_range: timeRange },
                        { title: '主机分布', type: 'trend', query: `${scopedQuery} | stats count() by ${hostField}`, time_range: timeRange, chartType: 'table' }
                    ]
                }]
            },
            error_investigation: {
                name,
                ...options,
                tabs: [{
                    name: '错误排查',
                    panels: [
                        { title: '错误趋势', type: 'trend', query: `${scopedQuery} AND status:error`, time_range: timeRange },
                        { title: '错误主机 TopN', type: 'trend', query: `${scopedQuery} AND status:error | stats count() by ${hostField}`, time_range: timeRange, chartType: 'table' }
                    ]
                }]
            },
            traffic_trend: {
                name,
                ...options,
                tabs: [{
                    name: '流量趋势',
                    panels: [
                        { title: '访问趋势', type: 'trend', query: scopedQuery, time_range: timeRange },
                        { title: '访问来源分布', type: 'trend', query: `${scopedQuery} | stats count() by source`, time_range: timeRange, chartType: 'table' }
                    ]
                }]
            },
            host_health: {
                name,
                ...options,
                tabs: [{
                    name: '主机健康',
                    panels: [
                        { title: '主机日志趋势', type: 'trend', query: scopedQuery, time_range: timeRange },
                        { title: '主机日志量 TopN', type: 'trend', query: `${scopedQuery} | stats count() by ${hostField}`, time_range: timeRange, chartType: 'table' }
                    ]
                }]
            }
        };

        return templates[template] || null;
    }

    private normalizeDashboardSpec(spec: any): any {
        const tabs = Array.isArray(spec?.tabs) ? spec.tabs.map((tab: any) => ({
            name: tab?.name,
            panels: this.normalizePanels(Array.isArray(tab?.panels) ? tab.panels : [])
        })) : [];

        return {
            name: spec?.name,
            app_id: spec?.app_id,
            data_user: spec?.data_user || 'viewer',
            export: spec?.export || 'local',
            tabs
        };
    }

    private normalizePanels(panels: any[]): any[] {
        return panels.map((panel, index) => this.normalizePanelSpec(panel, index));
    }

    private normalizePanelSpec(panel: any, index: number): any {
        const rawType = panel?.type || panel?.panel_type || 'trend';
        const normalized = this.normalizePanelKind(rawType, panel?.chartType);
        const defaultGrid = { x: (index % 2) * 6, y: Math.floor(index / 2) * 5, w: 6, h: 5 };

        return {
            title: panel?.title,
            type: normalized.type,
            query: panel?.query || '*',
            time_range: panel?.time_range || '-1h,now',
            chartType: normalized.chartType,
            xField: panel?.xField || '',
            yField: panel?.yField || '',
            byFields: Array.isArray(panel?.byFields) ? panel.byFields : [],
            description: panel?.description || '',
            grid: {
                ...defaultGrid,
                ...(panel?.grid || {})
            }
        };
    }

    private validateDashboardSpec(spec: any): any | null {
        if (!spec?.name || !Array.isArray(spec?.tabs) || spec.tabs.length === 0) {
            return this.buildError(
                'INVALID_DASHBOARD_SPEC',
                '仪表盘配置至少需要 name 和一个非空 tabs。',
                '请提供仪表盘名称以及至少一个包含 panels 的标签页。'
            );
        }

        for (const tab of spec.tabs) {
            if (!tab?.name || !Array.isArray(tab?.panels)) {
                return this.buildError(
                    'INVALID_DASHBOARD_SPEC',
                    'tabs 结构不完整：每个 tab 都必须包含 name 和 panels 数组。',
                    '请检查 tabs[*].name 与 tabs[*].panels。'
                );
            }

            for (const panel of tab.panels) {
                const panelError = this.validatePanelSpec(panel);
                if (panelError) {
                    return panelError;
                }
            }
        }

        return null;
    }

    private validatePanelSpec(panel: any): any | null {
        if (!panel?.title || typeof panel.title !== 'string') {
            return this.buildError(
                'INVALID_PANEL_SPEC',
                'panel 缺少 title。',
                '请为 panel 提供 title。'
            );
        }
        if (!panel?.query || typeof panel.query !== 'string') {
            return this.buildError(
                'INVALID_PANEL_SPEC',
                `panel ${panel.title || ''} 缺少 query。`,
                '请为 panel 提供 SPL 查询语句。'
            );
        }

        const normalized = this.normalizePanelKind(panel?.type || panel?.panel_type || 'trend', panel?.chartType);
        if (!this.supportedPanelTypes.has(normalized.type)) {
            return this.buildError(
                'UNSUPPORTED_PANEL_TYPE',
                `当前写入仅支持 trend/eventsTable panel，收到类型: ${normalized.type}`,
                '请优先使用 trend；事件列表请使用 eventsTable。canvas 目前仅支持读取，不支持写入。'
            );
        }

        if (normalized.type === 'eventsTable' && normalized.chartType !== 'eventsTable') {
            return this.buildError(
                'INVALID_CHART_TYPE',
                `eventsTable panel 的 chartType 必须为 eventsTable，收到: ${normalized.chartType}`,
                '请将 type 设为 eventsTable，并将 chartType 设为 eventsTable。'
            );
        }

        if (normalized.type === 'trend' && !this.trendChartTypes.has(normalized.chartType)) {
            return this.buildError(
                'INVALID_CHART_TYPE',
                `trend panel 的 chartType 不受支持，收到: ${normalized.chartType}`,
                '请使用 line、pie、single、table、sunburst、multiaxis、bar、column、scatter、area、networkflow 或 tracing。'
            );
        }

        return null;
    }

    private panelToWidget(panel: any, index: number, widgetId?: string): any {
        const grid = panel.grid || { x: (index % 2) * 6, y: Math.floor(index / 2) * 5, w: 6, h: 5 };
        const normalized = this.normalizePanelKind(panel?.type || 'trend', panel?.chartType);

        return {
            y: grid.y,
            x: grid.x,
            w: grid.w,
            h: grid.h,
            type: normalized.type,
            importType: 'clone',
            id: widgetId || `panel_${Date.now()}_${index}`,
            searchData: {
                trendName: panel.title || `Panel ${index + 1}`,
                query: panel.query || '*',
                time_range: panel.time_range || '-1h,now',
                chartType: normalized.chartType,
                xField: panel.xField || '',
                yField: panel.yField || '',
                byFields: panel.byFields || [],
                description: panel.description || ''
            }
        };
    }

    private widgetToPanel(widget: any): any {
        const normalized = this.normalizePanelKind(widget?.type || 'trend', widget?.searchData?.chartType);
        return {
            title: this.getWidgetTitle(widget),
            type: normalized.type,
            query: widget?.searchData?.query || '*',
            time_range: widget?.searchData?.time_range || '-1h,now',
            chartType: normalized.chartType,
            xField: widget?.searchData?.xField || '',
            yField: widget?.searchData?.yField || '',
            byFields: Array.isArray(widget?.searchData?.byFields) ? widget.searchData.byFields : [],
            description: widget?.searchData?.description || '',
            grid: {
                x: widget?.x ?? 0,
                y: widget?.y ?? 0,
                w: widget?.w ?? 6,
                h: widget?.h ?? 5
            }
        };
    }

    private getWidgetTitle(widget: any): string {
        return widget?.searchData?.trendName || widget?.title || '';
    }

    private getWidgetId(widget: any): string {
        return widget?.id || '';
    }

    private normalizePanelKind(rawType: string, rawChartType?: string): { type: string; chartType: string } {
        const type = (rawType || 'trend').trim();
        const chartType = (rawChartType || '').trim();

        if (type === 'eventsTable') {
            return {
                type: 'eventsTable',
                chartType: chartType || 'eventsTable'
            };
        }

        // 兼容旧写法：把 table / pie / single 等误传为 panel type 的输入归一到 trend + chartType
        if (type === 'table' || this.trendChartTypes.has(type)) {
            return {
                type: 'trend',
                chartType: chartType || (type === 'table' ? 'table' : type)
            };
        }

        return {
            type,
            chartType: chartType || 'line'
        };
    }

    private findPanelMatches(
        widgets: any[],
        criteria: { panelId?: string; panelTitle?: string }
    ): Array<{ index: number; widget: any }> {
        const panelId = criteria.panelId?.trim();
        if (panelId) {
            return widgets
                .map((widget, index) => ({ index, widget }))
                .filter(({ widget }) => this.getWidgetId(widget) === panelId);
        }

        const panelTitle = criteria.panelTitle || '';
        return widgets
            .map((widget, index) => ({ index, widget }))
            .filter(({ widget }) => this.getWidgetTitle(widget) === panelTitle);
    }

    private applyLayoutStrategy(widgets: any[], strategy: string): any[] {
        const normalizedStrategy = strategy || 'auto_two_columns';

        return widgets.map((widget, index) => {
            const base = { ...widget };

            switch (normalizedStrategy) {
                case 'single_column':
                    return {
                        ...base,
                        x: 0,
                        y: index * 6,
                        w: 12,
                        h: 5
                    };
                case 'compact':
                    return {
                        ...base,
                        x: (index % 3) * 4,
                        y: Math.floor(index / 3) * 4,
                        w: 4,
                        h: 4
                    };
                case 'auto_two_columns':
                default:
                    return {
                        ...base,
                        x: (index % 2) * 6,
                        y: Math.floor(index / 2) * 5,
                        w: 6,
                        h: 5
                    };
            }
        });
    }

    private buildDefaultTabContent(widgets: any[]) {
        return {
            refresh: { time: 3, unit: 'm', on: false, showRefreshProcess: true },
            showFilters: true,
            showTitle: true,
            editable: true,
            scheme: 'schemecat1',
            theme: 'day',
            activeDrilldown: false,
            autoUpdate: true,
            filters: [],
            widgets
        };
    }

    private buildError(errorCode: string, message: string, suggestion: string, details: any = null): any {
        return {
            error: message,
            error_code: errorCode,
            message,
            suggestion,
            retryable: true,
            details
        }
    }
}
