import { LogEaseClient } from '../client.js';
import { buildAestheticsAnalysis as analyzeDashboardAesthetics } from './dashboard/aesthetics.js';
import {
    applyLayoutStrategy as applyLayoutStrategyToWidgets,
    assignDefaultLayoutToPanels as assignDefaultPanelLayout,
    buildGridForAdditionalPanel as buildAdditionalPanelGrid
} from './dashboard/layout.js';
import {
    DEFAULT_DASHBOARD_SCHEME,
    findPanelMatches as findMatchingPanels,
    getWidgetColor as extractWidgetColor,
    getWidgetId as extractWidgetId,
    getWidgetTitle as extractWidgetTitle,
    isColorInDashboardScheme as isColorAllowedInScheme,
    isSupportedDashboardScheme as isSupportedColorScheme,
    listSupportedDashboardSchemes,
    normalizeDashboardScheme as normalizeColorSchemeName,
    normalizePanelSpec as normalizePanelDefinition,
    panelToWidget as mapPanelToWidget,
    patchWidgetWithChanges as patchWidget,
    validatePanelSpec as validatePanelDefinition,
    widgetToPanel as mapWidgetToPanel
} from './dashboard/panel-utils.js';
import { buildDashboardTemplateSpec } from './dashboard/templates/index.js';

const DEFAULT_DASHBOARD_APP_ID = 1;

export class DashboardModule {
    private client: LogEaseClient;

    constructor(client: LogEaseClient) {
        this.client = client;
    }

    async createDashboard(params: any): Promise<any> {
        return this.createDashboardFromSpec(params);
    }

    async createDashboardFromTemplate(params: any): Promise<any> {
        const { template, name, context = {}, app_id, data_user = 'viewer', export: exportType = 'local' } = params || {};
        const resolvedAppId = Number.isInteger(app_id) ? app_id : DEFAULT_DASHBOARD_APP_ID;

        if (!template || !name) {
            return this.buildError(
                'MISSING_REQUIRED_PARAM',
                'create_dashboard_from_template 需要 template 和 name。',
                '请提供模板名称以及仪表盘名称。'
            );
        }

        const spec = this.buildTemplateSpec(template, name, context, { app_id: resolvedAppId, data_user, export: exportType });
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

                const tabContent = this.buildDefaultTabContent(widgets, tab.scheme);

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

    async getDashboardTabContent(params: any): Promise<any> {
        const { dashboard_id, tab_name } = params || {};
        if (!dashboard_id || !tab_name) {
            return this.buildError(
                'MISSING_REQUIRED_PARAM',
                'get_dashboard_tab_content 需要 dashboard_id 和 tab_name。',
                '请提供目标仪表盘 ID 和标签页名称。'
            );
        }

        const contextResult = await this.loadTabContext(dashboard_id, tab_name);
        if (contextResult.error) {
            return contextResult;
        }

        const { dashboard, tab, content } = contextResult.data;

        return {
            status: 200,
            data: {
                dashboard_id,
                dashboard_name: dashboard?.name,
                tab_id: tab.id,
                tab_name: tab.name,
                content,
                message: 'Dashboard tab content fetched successfully'
            }
        };
    }

    async evaluateDashboardAesthetics(params: any): Promise<any> {
        const { dashboard_id, tab_name } = params || {};
        if (!dashboard_id || !tab_name) {
            return this.buildError(
                'MISSING_REQUIRED_PARAM',
                'evaluate_dashboard_aesthetics 需要 dashboard_id 和 tab_name。',
                '请提供目标仪表盘 ID 和标签页名称。'
            );
        }

        const contextResult = await this.loadTabContext(dashboard_id, tab_name);
        if (contextResult.error) {
            return contextResult;
        }

        const { dashboard, tab, content } = contextResult.data;
        const widgets = Array.isArray(content.widgets) ? content.widgets : [];
        if (widgets.length === 0) {
            return this.buildError(
                'EMPTY_TAB',
                `标签页 ${tab_name} 下没有 panel，无法进行美学评估。`,
                '请先通过 add_dashboard_panel 添加 panel。'
            );
        }

        const analysis = this.buildAestheticsAnalysis(widgets, { scheme: content?.scheme });

        return {
            status: 200,
            data: {
                dashboard_id,
                dashboard_name: dashboard?.name,
                tab_id: tab.id,
                tab_name: tab.name,
                widget_count: analysis.items.length,
                canvas: analysis.canvas,
                scores: analysis.scores,
                overall_score: analysis.overallScore,
                color_analysis: analysis.colorAnalysis,
                issues: analysis.issues,
                suggestions: analysis.suggestions,
                message: 'Dashboard aesthetics evaluated successfully'
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
        const schemeResult = this.resolveTabScheme(content);
        if (schemeResult.error) {
            return schemeResult;
        }
        const tabScheme = schemeResult.data.scheme;

        if (this.findPanelMatches(widgets, panelTitle).length > 0) {
            return this.buildError(
                'PANEL_ALREADY_EXISTS',
                `标签页 ${tab_name} 下已存在同名 panel: ${panelTitle}`,
                '请修改 panel.title，或使用 update_dashboard_panel 更新已有 panel。'
            );
        }

        const normalizedPanel = this.normalizePanelSpec(panel, widgets.length, { applyDefaultGrid: false });
        const panelColorError = this.validatePanelColorForScheme(normalizedPanel, tabScheme);
        if (panelColorError) {
            return panelColorError;
        }
        if (!normalizedPanel.grid) {
            normalizedPanel.grid = this.buildGridForAdditionalPanel(normalizedPanel, widgets);
        }
        widgets.push(this.panelToWidget(normalizedPanel, widgets.length));

        const updatedContent = {
            ...content,
            scheme: tabScheme,
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

        const currentSchemeResult = this.resolveTabScheme(content);
        if (currentSchemeResult.error) {
            return currentSchemeResult;
        }

        const wantsSchemeChange = Object.prototype.hasOwnProperty.call(changes, 'scheme');
        const wantsColorChange = Object.prototype.hasOwnProperty.call(changes, 'color');
        let targetScheme = currentSchemeResult.data.scheme;
        if (wantsSchemeChange) {
            targetScheme = this.normalizeDashboardColorScheme(changes.scheme);
            const schemeError = this.validateDashboardScheme(targetScheme);
            if (schemeError) {
                return schemeError;
            }
        }

        if (wantsSchemeChange || wantsColorChange) {
            const panelColorError = this.validatePanelColorForScheme(mergedPanel, targetScheme);
            if (panelColorError) {
                return panelColorError;
            }
        }

        widgets[match.index] = this.patchWidgetWithChanges(match.widget, mergedPanel, changes);

        const updatedContent = {
            ...content,
            scheme: targetScheme,
            widgets
        };

        if (wantsSchemeChange) {
            const conflictResult = this.collectTabSchemeConflicts(updatedContent, targetScheme);
            if (conflictResult.error) {
                return conflictResult;
            }
            if (conflictResult.data.length > 0) {
                return this.buildError(
                    'TAB_SCHEME_COLOR_CONFLICT',
                    `标签页 ${tab_name} 的目标主题 ${targetScheme} 与现有图表颜色冲突。`,
                    '请先将当前 tab 内冲突 panel 的 color 改成该主题内的颜色，或保持当前主题。',
                    {
                        scheme: targetScheme,
                        conflicts: conflictResult.data
                    }
                );
            }

        }

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
        return buildDashboardTemplateSpec(template, name, context, options);
    }

    private normalizeDashboardSpec(spec: any): any {
        const tabs = Array.isArray(spec?.tabs) ? spec.tabs.map((tab: any) => {
            const normalizedPanels = this.normalizePanels(Array.isArray(tab?.panels) ? tab.panels : []);
            return {
                name: tab?.name,
                scheme: this.normalizeDashboardColorScheme(tab?.scheme ?? spec?.scheme),
                panels: normalizedPanels
            };
        }) : [];

        return {
            name: spec?.name,
            app_id: Number.isInteger(spec?.app_id) ? spec.app_id : DEFAULT_DASHBOARD_APP_ID,
            data_user: spec?.data_user || 'viewer',
            export: spec?.export || 'local',
            tabs
        };
    }

    private normalizePanels(panels: any[]): any[] {
        const normalizedPanels = panels.map((panel, index) => this.normalizePanelSpec(panel, index, { applyDefaultGrid: false }));
        return assignDefaultPanelLayout(normalizedPanels);
    }

    private normalizePanelSpec(panel: any, index: number, options: { applyDefaultGrid?: boolean } = {}): any {
        return normalizePanelDefinition(panel, index, options);
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

            const schemeError = this.validateDashboardScheme(tab?.scheme);
            if (schemeError) {
                return schemeError;
            }

            for (const panel of tab.panels) {
                const panelError = this.validatePanelSpec(panel);
                if (panelError) {
                    return panelError;
                }

                const panelColorError = this.validatePanelColorForScheme(panel, tab.scheme);
                if (panelColorError) {
                    return panelColorError;
                }
            }
        }

        return null;
    }

    private validatePanelSpec(panel: any): any | null {
        return validatePanelDefinition(panel, this.buildError.bind(this));
    }

    private panelToWidget(panel: any, index: number, widgetId?: string): any {
        return mapPanelToWidget(panel, index, widgetId);
    }

    private widgetToPanel(widget: any): any {
        return mapWidgetToPanel(widget);
    }

    private getWidgetTitle(widget: any): string {
        return extractWidgetTitle(widget);
    }

    private getWidgetId(widget: any): string {
        return extractWidgetId(widget);
    }

    private getWidgetColor(widget: any): string {
        return extractWidgetColor(widget);
    }

    private patchWidgetWithChanges(widget: any, mergedPanel: any, changes: any): any {
        return patchWidget(widget, mergedPanel, changes);
    }

    private buildGridForAdditionalPanel(
        panel: any,
        occupiedSource: Array<any>,
        options: { startY?: number } = {}
    ): { x: number; y: number; w: number; h: number } {
        return buildAdditionalPanelGrid(panel, occupiedSource, options);
    }

    private findPanelMatches(
        widgets: any[],
        criteria: { panelId?: string; panelTitle?: string } | string
    ): Array<{ index: number; widget: any }> {
        return findMatchingPanels(widgets, criteria);
    }

    private applyLayoutStrategy(widgets: any[], strategy: string): any[] {
        return applyLayoutStrategyToWidgets(widgets, strategy);
    }

    private buildAestheticsAnalysis(widgets: any[], options: { scheme?: string } = {}) {
        return analyzeDashboardAesthetics(widgets, options);
    }

    private normalizeDashboardColorScheme(scheme?: string): string {
        return normalizeColorSchemeName(scheme);
    }

    private validateDashboardScheme(scheme?: string): any | null {
        if (isSupportedColorScheme(scheme)) {
            return null;
        }

        return this.buildError(
            'INVALID_DASHBOARD_SCHEME',
            `不支持的主题色方案: ${scheme}`,
            `请使用以下主题之一：${listSupportedDashboardSchemes().join('、')}。`,
            { supported_schemes: listSupportedDashboardSchemes() }
        );
    }

    private validatePanelColorForScheme(panel: any, scheme: string): any | null {
        if (!panel?.color) {
            return null;
        }

        if (isColorAllowedInScheme(scheme, panel.color)) {
            return null;
        }

        return this.buildError(
            'INVALID_PANEL_COLOR',
            `panel ${panel.title || ''} 的颜色 ${panel.color} 不属于主题 ${scheme}。`,
            '请改用当前 tab 主题色卡中的颜色，或先显式切换当前 tab 的 scheme。',
            {
                panel_title: panel.title || '',
                color: panel.color,
                scheme
            }
        );
    }

    private resolveTabScheme(content: any): any {
        const scheme = this.normalizeDashboardColorScheme(content?.scheme);
        const schemeError = this.validateDashboardScheme(scheme);
        if (schemeError) {
            return schemeError;
        }

        return {
            status: 200,
            data: { scheme }
        };
    }

    private collectTabSchemeConflicts(content: any, targetScheme: string): any {
        const widgets = Array.isArray(content?.widgets) ? content.widgets : [];
        const conflicts: Array<{ panel_title: string; color: string }> = [];

        widgets.forEach((widget: any, index: number) => {
            const color = this.getWidgetColor(widget);
            if (color && !isColorAllowedInScheme(targetScheme, color)) {
                conflicts.push({
                    panel_title: this.getWidgetTitle(widget) || `Panel ${index + 1}`,
                    color
                });
            }
        });

        return {
            status: 200,
            data: conflicts
        };
    }

    private buildDefaultTabContent(widgets: any[], scheme: string = DEFAULT_DASHBOARD_SCHEME) {
        return {
            refresh: { time: 3, unit: 'm', on: false, showRefreshProcess: true },
            showFilters: true,
            showTitle: true,
            editable: true,
            scheme: this.normalizeDashboardColorScheme(scheme),
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
