export const supportedPanelTypes = new Set(['trend', 'eventsTable']);

export const trendChartTypes = new Set([
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

type BuildError = (errorCode: string, message: string, suggestion: string, details?: any) => any;

export function normalizePanelKind(rawType: string, rawChartType?: string): { type: string; chartType: string } {
    const type = (rawType || 'trend').trim();
    const chartType = (rawChartType || '').trim();

    if (type === 'eventsTable') {
        return {
            type: 'eventsTable',
            chartType: chartType || 'eventsTable'
        };
    }

    if (type === 'table' || trendChartTypes.has(type)) {
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

export function buildLegacyDefaultGrid(index: number): { x: number; y: number; w: number; h: number } {
    return {
        x: (index % 2) * 6,
        y: Math.floor(index / 2) * 5,
        w: 6,
        h: 5
    };
}

export function normalizePanelSpec(panel: any, index: number, options: { applyDefaultGrid?: boolean } = {}): any {
    const { applyDefaultGrid = true } = options;
    const rawType = panel?.type || panel?.panel_type || 'trend';
    const normalized = normalizePanelKind(rawType, panel?.chartType);
    const defaultGrid = buildLegacyDefaultGrid(index);
    const explicitGrid = panel?.grid && typeof panel.grid === 'object'
        ? {
            ...defaultGrid,
            ...(panel.grid || {})
        }
        : undefined;

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
        grid: applyDefaultGrid ? (explicitGrid || defaultGrid) : explicitGrid
    };
}

export function validatePanelSpec(panel: any, buildError: BuildError): any | null {
    if (!panel?.title || typeof panel.title !== 'string') {
        return buildError(
            'INVALID_PANEL_SPEC',
            'panel 缺少 title。',
            '请为 panel 提供 title。'
        );
    }
    if (!panel?.query || typeof panel.query !== 'string') {
        return buildError(
            'INVALID_PANEL_SPEC',
            `panel ${panel.title || ''} 缺少 query。`,
            '请为 panel 提供 SPL 查询语句。'
        );
    }

    const normalized = normalizePanelKind(panel?.type || panel?.panel_type || 'trend', panel?.chartType);
    if (!supportedPanelTypes.has(normalized.type)) {
        return buildError(
            'UNSUPPORTED_PANEL_TYPE',
            `当前写入仅支持 trend/eventsTable panel，收到类型: ${normalized.type}`,
            '请优先使用 trend；事件列表请使用 eventsTable。canvas 目前仅支持读取，不支持写入。'
        );
    }

    if (normalized.type === 'eventsTable' && normalized.chartType !== 'eventsTable') {
        return buildError(
            'INVALID_CHART_TYPE',
            `eventsTable panel 的 chartType 必须为 eventsTable，收到: ${normalized.chartType}`,
            '请将 type 设为 eventsTable，并将 chartType 设为 eventsTable。'
        );
    }

    if (normalized.type === 'trend' && !trendChartTypes.has(normalized.chartType)) {
        return buildError(
            'INVALID_CHART_TYPE',
            `trend panel 的 chartType 不受支持，收到: ${normalized.chartType}`,
            '请使用 line、pie、single、table、sunburst、multiaxis、bar、column、scatter、area、networkflow 或 tracing。'
        );
    }

    return null;
}

export function getWidgetTitle(widget: any): string {
    return widget?.searchData?.trendName || widget?.title || '';
}

export function getWidgetId(widget: any): string {
    return widget?.id || '';
}

export function panelToWidget(panel: any, index: number, widgetId?: string): any {
    const grid = panel.grid || buildLegacyDefaultGrid(index);
    const normalized = normalizePanelKind(panel?.type || 'trend', panel?.chartType);

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

export function widgetToPanel(widget: any): any {
    const normalized = normalizePanelKind(widget?.type || 'trend', widget?.searchData?.chartType);
    return {
        title: getWidgetTitle(widget),
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

export function patchWidgetWithChanges(widget: any, mergedPanel: any, changes: any): any {
    const rawWidget = widget && typeof widget === 'object' ? widget : {};
    const rawSearchData = rawWidget?.searchData && typeof rawWidget.searchData === 'object'
        ? rawWidget.searchData
        : {};
    const gridChanges = changes?.grid && typeof changes.grid === 'object' ? changes.grid : {};
    const nextWidget = {
        ...rawWidget,
        searchData: { ...rawSearchData }
    };

    if (Object.prototype.hasOwnProperty.call(gridChanges, 'x')) {
        nextWidget.x = mergedPanel.grid.x;
    }
    if (Object.prototype.hasOwnProperty.call(gridChanges, 'y')) {
        nextWidget.y = mergedPanel.grid.y;
    }
    if (Object.prototype.hasOwnProperty.call(gridChanges, 'w')) {
        nextWidget.w = mergedPanel.grid.w;
    }
    if (Object.prototype.hasOwnProperty.call(gridChanges, 'h')) {
        nextWidget.h = mergedPanel.grid.h;
    }

    if (Object.prototype.hasOwnProperty.call(changes, 'title')) {
        nextWidget.title = mergedPanel.title;
        nextWidget.searchData.trendName = mergedPanel.title;
    }
    if (Object.prototype.hasOwnProperty.call(changes, 'query')) {
        nextWidget.searchData.query = mergedPanel.query;
    }
    if (Object.prototype.hasOwnProperty.call(changes, 'time_range')) {
        nextWidget.searchData.time_range = mergedPanel.time_range;
    }
    if (Object.prototype.hasOwnProperty.call(changes, 'chartType')) {
        nextWidget.type = mergedPanel.type;
        nextWidget.searchData.chartType = mergedPanel.chartType;
    }
    if (Object.prototype.hasOwnProperty.call(changes, 'xField')) {
        nextWidget.searchData.xField = mergedPanel.xField;
    }
    if (Object.prototype.hasOwnProperty.call(changes, 'yField')) {
        nextWidget.searchData.yField = mergedPanel.yField;
    }
    if (Object.prototype.hasOwnProperty.call(changes, 'byFields')) {
        nextWidget.searchData.byFields = mergedPanel.byFields;
    }
    if (Object.prototype.hasOwnProperty.call(changes, 'description')) {
        nextWidget.searchData.description = mergedPanel.description;
    }
    if (Object.prototype.hasOwnProperty.call(changes, 'color')) {
        nextWidget.searchData.chartStartingColor = changes.color;
    }

    return nextWidget;
}

export function findPanelMatches(
    widgets: any[],
    criteria: { panelId?: string; panelTitle?: string } | string
): Array<{ index: number; widget: any }> {
    const normalizedCriteria = typeof criteria === 'string'
        ? { panelTitle: criteria }
        : (criteria || {});
    const panelId = normalizedCriteria.panelId?.trim();
    if (panelId) {
        return widgets
            .map((widget, index) => ({ index, widget }))
            .filter(({ widget }) => getWidgetId(widget) === panelId);
    }

    const panelTitle = normalizedCriteria.panelTitle || '';
    return widgets
        .map((widget, index) => ({ index, widget }))
        .filter(({ widget }) => getWidgetTitle(widget) === panelTitle);
}
