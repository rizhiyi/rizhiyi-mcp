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

export const DEFAULT_DASHBOARD_SCHEME = 'schemecat1';

export const dashboardSchemeColors: Record<string, string[][]> = {
    schemecat1: [
        ['#2050E9', '#24D1AE', '#F61479', '#7511CB', '#F4C400', '#272F53', '#47A610', '#EE621A', '#CA0303', '#DD55B9'],
        ['#3661EB', '#39DEBE', '#F72585', '#7F00E2', '#FFD010', '#303967', '#5DD400', '#F0763B', '#E30202', '#E168C1'],
        ['#4D73ED', '#51E1C4', '#F84E9B', '#8C37EE', '#FFDA46', '#3E4983', '#5FDE1C', '#F28752', '#FC100C', '#E57AC8'],
        ['#6484F0', '#66E5CC', '#F962A6', '#9950F0', '#FFDE5C', '#4A589E', '#50E82E', '#F49667', '#FD2827', '#E88BD0'],
        ['#7A96F2', '#7CE9D3', '#FA75B1', '#A969F2', '#FEE270', '#5D6BB3', '#5EEB4B', '#F4A57D', '#FD4645', '#EB9BD6'],
        ['#8FA7F4', '#91EDD9', '#FB89BC', '#B782F4', '#FEE784', '#7784BF', '#7AEF6C', '#F7B493', '#FC6565', '#EEACDD'],
        ['#FFFFFF', '#E9F5FF', '#4A4A4A', '#242731', '#FFD010', '#F0763B', '#E30202', '#7F00E2', '#3661EB', '#5DD400'],
    ],
    schemecat2: [
        ['#1F295B', '#C20B7B', '#22AAA8', '#ECB30E', '#590FA9', '#BD0F4F', '#459C49', '#2500CC', '#C000F5', '#1EBCED'],
        ['#293679', '#E00C8E', '#27C2BF', '#F5BB09', '#6E12CE', '#D81259', '#4CAF52', '#2D00F7', '#CC17FF', '#4BC9F0'],
        ['#334598', '#F4149E', '#33D7D4', '#F7C327', '#7214D4', '#EE1C69', '#64BB68', '#491FFF', '#D333FF', '#68D1F3'],
        ['#3E51B6', '#F63DAE', '#55DDDB', '#F8CF4E', '#811FEB', '#F04382', '#7FC784', '#5933FF', '#D748FF', '#7BD8F4'],
        ['#495CC1', '#F863BF', '#65E1DF', '#FAD362', '#8C31ED', '#F3679B', '#9CD39E', '#7A5CFF', '#DD5DFF', '#8EDEF6'],
        ['#5969C6', '#F877C6', '#89E7E6', '#FBD974', '#A157F0', '#F68EB4', '#B8E0BB', '#9B85FF', '#E070FF', '#A2E3F7'],
        ['#FFFFFF', '#E9F5FF', '#4A4A4A', '#242731', '#F5BB09', '#D81259', '#6E12CE', '#2D00F7', '#4BC9F0', '#4CAF52'],
    ],
    schemecat3: [
        ['#F47A13', '#3CD093', '#5C4BFC', '#EB6FA4', '#51C6F6', '#5A6888', '#ECB30E', '#07736F', '#3977F9', '#E8377A'],
        ['#F6903D', '#59D8A6', '#7162FD', '#EF8BB4', '#78D3F8', '#65779B', '#F6BD14', '#098E89', '#5C8FFA', '#EA4C89'],
        ['#F89B4F', '#6ADCAF', '#7D6FFF', '#F597BE', '#8BDAF8', '#7786A6', '#F7C327', '#07ADA7', '#749FFB', '#EE6C9E'],
        ['#FFA65D', '#8BE4C0', '#9385FD', '#F4A5C6', '#90DEFC', '#8D9BB4', '#F8CF4E', '#12C0BA', '#88ADFB', '#F07FAA'],
        ['#F9B177', '#9CE8C9', '#A49BFD', '#F5B6D1', '#9FE2FD', '#9BA8BF', '#FBD974', '#55DDDB', '#9DBAFC', '#F291B7'],
        ['#FAC79D', '#ADECD1', '#B8AFFE', '#F7C9DD', '#A5E1F9', '#A6B0C4', '#FBDE89', '#89E7E6', '#B1C8FD', '#F4A3C3'],
        ['#FFFFFF', '#E9F5FF', '#4A4A4A', '#242731', '#F6BD14', '#F6903D', '#EA4C89', '#7162FD', '#78D3F8', '#59D8A6'],
    ],
    schemecat4: [
        ['#43745B', '#FAB84C', '#C84E2C', '#9BAEBF', '#C893B0', '#485C85', '#DF7517', '#6F4B80', '#A9D86F', '#7D744F'],
        ['#538D6F', '#FBC771', '#D66443', '#B0BFCD', '#D0A3BC', '#506794', '#EC9244', '#7E5999', '#BDE08F', '#8E8358'],
        ['#65A484', '#FCCF88', '#DA7458', '#B8C7D4', '#DBAEC7', '#6178A9', '#EE9E58', '#8465A4', '#C6E59F', '#A19568'],
        ['#7FB498', '#FDD79B', '#DE8268', '#C1CCD7', '#DDBCCE', '#6F84B0', '#F0A96A', '#9072AC', '#CCE9A6', '#B0A782'],
        ['#98C3AC', '#FEDFAF', '#E29079', '#C6D0D9', '#E5C9D8', '#7B8FB8', '#F2B47D', '#A88BBB', '#D1E9AF', '#C0B99B'],
        ['#A5CAB7', '#FCE2BB', '#E69E8A', '#D9E1E7', '#EED7E4', '#95A4C6', '#F4BE8F', '#B498C3', '#DAEDBF', '#D0CAB4'],
        ['#FFFFFF', '#E9F5FF', '#4A4A4A', '#242731', '#FBC771', '#D66443', '#7E5999', '#506794', '#538D6F', '#BDE08F'],
    ]
};

const dashboardSchemeColorSets = new Map<string, Set<string>>(
    Object.entries(dashboardSchemeColors).map(([scheme, palette]) => [
        scheme,
        new Set(palette.flat().map((color) => color.toUpperCase()))
    ])
);

type BuildError = (errorCode: string, message: string, suggestion: string, details?: any) => any;

export function listSupportedDashboardSchemes(): string[] {
    return Object.keys(dashboardSchemeColors);
}

export function normalizeDashboardScheme(scheme?: string): string {
    return (scheme || DEFAULT_DASHBOARD_SCHEME).trim().toLowerCase();
}

export function isSupportedDashboardScheme(scheme?: string): boolean {
    return dashboardSchemeColorSets.has(normalizeDashboardScheme(scheme));
}

export function normalizeHexColor(color?: string): string {
    return typeof color === 'string' ? color.trim().toUpperCase() : '';
}

export function isColorInDashboardScheme(scheme: string, color?: string): boolean {
    const normalizedScheme = normalizeDashboardScheme(scheme);
    const normalizedColor = normalizeHexColor(color);
    if (!normalizedColor) {
        return true;
    }

    return dashboardSchemeColorSets.get(normalizedScheme)?.has(normalizedColor) ?? false;
}

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
    const normalizedColor = normalizeHexColor(panel?.color ?? panel?.chartStartingColor);
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
        color: normalizedColor || undefined,
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

    if (typeof panel?.color !== 'undefined' && typeof panel.color !== 'string') {
        return buildError(
            'INVALID_PANEL_COLOR',
            `panel ${panel.title || ''} 的 color 必须是字符串。`,
            '请传入十六进制颜色值，例如 #F6903D。'
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

export function getWidgetColor(widget: any): string {
    return normalizeHexColor(widget?.searchData?.chartStartingColor);
}

export function panelToWidget(panel: any, index: number, widgetId?: string): any {
    const grid = panel.grid || buildLegacyDefaultGrid(index);
    const normalized = normalizePanelKind(panel?.type || 'trend', panel?.chartType);
    const normalizedColor = normalizeHexColor(panel?.color);

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
            description: panel.description || '',
            ...(normalizedColor ? { chartStartingColor: normalizedColor } : {})
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
        color: getWidgetColor(widget) || undefined,
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
        nextWidget.searchData.chartStartingColor = normalizeHexColor(changes.color);
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
