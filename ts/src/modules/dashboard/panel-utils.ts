export const supportedPanelTypes = new Set(['trend', 'eventsTable']);

export const trendChartTypes = new Set([
    'line',
    'pie',
    'rose',
    'single',
    'liquidfill',
    'table',
    'sunburst',
    'multiaxis',
    'bar',
    'column',
    'rangeline',
    'scatter',
    'area',
    'heatmap',
    'wordcloud',
    'chord',
    'sankey',
    'force',
    'attackmap',
    'networkflow',
    'tracing'
]);

export const DEFAULT_DASHBOARD_SCHEME = 'schemecat1';
const DEFAULT_SINGLE_CHART_FONT_SIZE = 60;
const DEFAULT_TREND_COLOR_TYPE = 'scheme';
const DEFAULT_SINGLE_TREND_COLOR_TYPE = 'redUp';
const DEFAULT_SINGLE_CHART_DISPLAY_MODE = 'default';
const DEFAULT_SINGLE_CHART_COMPARSION_MODE = 'percent';
const DEFAULT_PIE_LABEL_FORMATTER = 'name';
const DEFAULT_PIE_SHOW_TYPE = 'all';
const DEFAULT_PIE_PERCENT_N = 2;
const DEFAULT_PIE_RADIUS_RATIO = 0.72;
const DEFAULT_PIE_OUTER_RADIUS_RATIO = 1;
const DEFAULT_PIE_CORNER_RADIUS = 0;
const DEFAULT_PIE_LAYOUT_COLUMNS = 1;
type WidgetChartCategory = 'sequence' | 'dimension' | 'relationship';

type WidgetConfigBlock = Record<string, any>;

type PanelFieldHints = {
    xField: string;
    yField: string;
    yFields: string[];
    ySmooths: boolean[];
    yRanges: Array<Record<string, any>>;
    byFields: string[];
    valueField: string;
    categoryField: string;
};

// 当前首批按类别抽象的图表映射。
// sequence: line/area/scatter/column/rangeline/multiaxis
// dimension: pie/rose/single/liquidfill/bar/sunburst/heatmap/wordcloud
// relationship: chord/sankey/force/attackmap/networkflow/tracing
const CHART_CATEGORY_BY_TYPE: Record<string, WidgetChartCategory> = {
    line: 'sequence',
    area: 'sequence',
    scatter: 'sequence',
    column: 'sequence',
    rangeline: 'sequence',
    multiaxis: 'sequence',
    pie: 'dimension',
    rose: 'dimension',
    single: 'dimension',
    liquidfill: 'dimension',
    bar: 'dimension',
    sunburst: 'dimension',
    heatmap: 'dimension',
    wordcloud: 'dimension',
    chord: 'relationship',
    sankey: 'relationship',
    force: 'relationship',
    attackmap: 'relationship',
    networkflow: 'relationship',
    tracing: 'relationship'
};

const CHART_SPECIFIC_SEARCH_DATA_KEYS = [
    'config',
    'valueField',
    'metricField',
    'singleValueField',
    'singleChartFontSize',
    'singleValueFontSize',
    'singleChartDisplayMode',
    'singleChartComparsionMode',
    'singleDisplayMode',
    'showSparkline',
    'showComparison',
    'compareTime',
    'colorValues',
    'trendColorType',
    'scheme',
    'market_day',
    'categoryField',
    'dimensionField',
    'pieCategoryField',
    'pieValueField',
    'showLegend',
    'legendPosition',
    'donut',
    'innerRadius',
    'labelDisplay',
    'labelFormatter',
    'showType',
    'percentN',
    'radiusRatio',
    'outerRadiusRatio',
    'cornerRadius',
    'layoutColumns',
    'trellisField',
    'yFields',
    'ySmooths',
    'yRanges',
    'yAxisAttrs',
    'xAxisRotate',
    'xAxisSort',
    'byStacks',
    'columnWidth',
    'columnBorderRadius',
    'fromField',
    'toField',
    'weightField',
    'outlierField',
    'upperField',
    'lowerField',
    'fromLongitudeField',
    'fromLatitudeField',
    'toLongitudeField',
    'toLatitudeField',
    'mapType'
];

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
        yFields: splitFieldList(panel?.yFields),
        ySmooths: normalizeBooleanList(panel?.ySmooths),
        yRanges: normalizeRangeList(panel?.yRanges),
        byFields: Array.isArray(panel?.byFields) ? panel.byFields : [],
        outlierField: sanitizeFieldName(panel?.outlierField || ''),
        upperField: sanitizeFieldName(panel?.upperField || ''),
        lowerField: sanitizeFieldName(panel?.lowerField || ''),
        fromField: sanitizeFieldName(panel?.fromField || ''),
        toField: sanitizeFieldName(panel?.toField || ''),
        weightField: sanitizeFieldName(panel?.weightField || ''),
        fromLongitudeField: sanitizeFieldName(panel?.fromLongitudeField || ''),
        fromLatitudeField: sanitizeFieldName(panel?.fromLatitudeField || ''),
        toLongitudeField: sanitizeFieldName(panel?.toLongitudeField || ''),
        toLatitudeField: sanitizeFieldName(panel?.toLatitudeField || ''),
        mapType: typeof panel?.mapType === 'string' && panel.mapType.trim() ? panel.mapType.trim() : 'world',
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

function isSingleWidget(widget: any): boolean {
    return widget?.searchData?.chartType === 'single' || widget?.chart?.chartType === 'single';
}

function getSingleWidgetStyleConfig(widget: any): Record<string, any> {
    const config = widget?.searchData?.config;
    if (!Array.isArray(config)) {
        return {};
    }
    const displayConfig = config[2];
    return displayConfig && typeof displayConfig === 'object' ? displayConfig : {};
}

function collectExplicitSingleWidgetColors(widget: any) {
    const searchData = widget?.searchData && typeof widget.searchData === 'object' ? widget.searchData : {};
    const origin = widget?.originWidgetConfData && typeof widget.originWidgetConfData === 'object'
        ? widget.originWidgetConfData
        : {};
    const chart = widget?.chart && typeof widget.chart === 'object' ? widget.chart : {};
    const config = getSingleWidgetStyleConfig(widget);

    const fontSources = {
        searchData: normalizeHexColor(searchData?.singleChartFontColor),
        config: normalizeHexColor(config?.singleChartFontColor),
        originWidgetConfData: normalizeHexColor(origin?.singleChartFontColor),
        chart: normalizeHexColor(chart?.singleChartFontColor)
    };
    const backgroundSources = {
        searchData: normalizeHexColor(searchData?.singleChartBackgroundColor),
        config: normalizeHexColor(config?.singleChartBackgroundColor),
        originWidgetConfData: normalizeHexColor(origin?.singleChartBackgroundColor),
        chart: normalizeHexColor(chart?.singleChartBackgroundColor)
    };

    return {
        searchData,
        origin,
        chart,
        config,
        fontSources,
        backgroundSources
    };
}

function distinctDefinedColors(colorSources: Record<string, string>): string[] {
    return [...new Set(Object.values(colorSources).filter(Boolean))];
}

export function getSingleWidgetStyleSnapshot(widget: any): {
    fillMode: string;
    fontColor: string;
    backgroundColor: string;
    fontSources: Record<string, string>;
    backgroundSources: Record<string, string>;
} {
    const { searchData, origin, chart, config, fontSources, backgroundSources } = collectExplicitSingleWidgetColors(widget);
    return {
        fillMode: String(
            searchData?.singleChartColorFillingMode
            || config?.singleChartColorFillingMode
            || origin?.singleChartColorFillingMode
            || chart?.singleChartColorFillingMode
            || 'font'
        ).trim(),
        fontColor: normalizeHexColor(
            fontSources.searchData
            || fontSources.config
            || fontSources.originWidgetConfData
            || fontSources.chart
            || searchData?.singleChartDefaultColor
            || origin?.singleChartDefaultColor
            || chart?.singleChartDefaultColor
            || searchData?.chartStartingColor
            || chart?.chartStartingColor
            || origin?.chartStartingColor
        ),
        backgroundColor: normalizeHexColor(
            backgroundSources.searchData
            || backgroundSources.config
            || backgroundSources.originWidgetConfData
            || backgroundSources.chart
            || '#FFFFFF'
        ),
        fontSources,
        backgroundSources
    };
}

export function validateSingleWidgetColorSafety(widget: any): {
    code: string;
    panelTitle: string;
    message: string;
    details: Record<string, any>;
} | null {
    if (!isSingleWidget(widget)) {
        return null;
    }

    const panelTitle = getWidgetTitle(widget) || getWidgetId(widget) || '未命名 single panel';
    const style = getSingleWidgetStyleSnapshot(widget);
    const fontVariants = distinctDefinedColors(style.fontSources);
    const backgroundVariants = distinctDefinedColors(style.backgroundSources);

    if (fontVariants.length > 1 || backgroundVariants.length > 1) {
        return {
            code: 'SINGLE_WIDGET_STYLE_INCONSISTENT',
            panelTitle,
            message: `single 图 ${panelTitle} 的颜色字段在不同配置层级之间不一致。`,
            details: {
                fillMode: style.fillMode,
                fontSources: style.fontSources,
                backgroundSources: style.backgroundSources
            }
        };
    }

    if (style.fillMode === 'background' && style.fontColor && style.backgroundColor && style.fontColor === style.backgroundColor) {
        return {
            code: 'SINGLE_WIDGET_COLOR_CONFLICT',
            panelTitle,
            message: `single 图 ${panelTitle} 的字色与背景色相同，页面会不可读。`,
            details: {
                fillMode: style.fillMode,
                fontColor: style.fontColor,
                backgroundColor: style.backgroundColor
            }
        };
    }

    return null;
}

export function getWidgetColor(widget: any): string {
    if (isSingleWidget(widget)) {
        return getSingleWidgetStyleSnapshot(widget).fontColor;
    }

    return normalizeHexColor(widget?.searchData?.chartStartingColor || widget?.chart?.chartStartingColor);
}

function sanitizeFieldName(rawField: unknown): string {
    if (typeof rawField !== 'string') {
        return '';
    }

    return rawField
        .trim()
        .replace(/^[`'"]+/, '')
        .replace(/[`'"]+$/, '')
        .replace(/[,)]+$/, '');
}

function inferStatsSegment(query: unknown): string {
    if (typeof query !== 'string') {
        return '';
    }

    const segments = [...query.matchAll(/\b(?:stats|chart|timechart)\b([^|]*)/gi)];
    return (segments[segments.length - 1]?.[1] || '').trim();
}

function inferMetricFieldFromQuery(query: unknown): string {
    const statsSegment = inferStatsSegment(query);
    if (!statsSegment) {
        return '';
    }

    const metricSegment = statsSegment.split(/\bby\b/i)[0] || '';
    const aliasMatches = [...metricSegment.matchAll(/\bas\s+([^\s,|]+)/gi)];
    const alias = sanitizeFieldName(aliasMatches[aliasMatches.length - 1]?.[1] || '');
    if (alias) {
        return alias;
    }

    if (/\bcount\s*\(\s*\)/i.test(metricSegment)) {
        return 'count';
    }

    return '';
}

function inferByFieldsFromQuery(query: unknown): string[] {
    const statsSegment = inferStatsSegment(query);
    if (!statsSegment) {
        return [];
    }

    const byMatch = statsSegment.match(/\bby\b\s+(.+)$/i);
    if (!byMatch?.[1]) {
        return [];
    }

    return byMatch[1]
        .split(',')
        .map((field) => sanitizeFieldName(field))
        .filter(Boolean);
}

function splitFieldList(rawValue: unknown): string[] {
    if (Array.isArray(rawValue)) {
        return rawValue
            .map((field: unknown) => sanitizeFieldName(field))
            .filter(Boolean);
    }

    if (typeof rawValue === 'string') {
        return rawValue
            .split(',')
            .map((field) => sanitizeFieldName(field))
            .filter(Boolean);
    }

    return [];
}

function omitChartSpecificSearchData(searchData: any): any {
    const nextSearchData = searchData && typeof searchData === 'object'
        ? { ...searchData }
        : {};

    CHART_SPECIFIC_SEARCH_DATA_KEYS.forEach((key) => {
        delete nextSearchData[key];
    });

    return nextSearchData;
}

function resolveChartCategory(chartType: string): WidgetChartCategory | undefined {
    return CHART_CATEGORY_BY_TYPE[chartType];
}

function normalizeBooleanList(rawValue: unknown): boolean[] {
    if (Array.isArray(rawValue)) {
        return rawValue.map((item) => Boolean(item));
    }

    if (typeof rawValue === 'string' && rawValue.trim()) {
        return rawValue
            .split(',')
            .map((item) => ['true', '1', 'yes'].includes(item.trim().toLowerCase()));
    }

    return [];
}

function normalizeRangeList(rawValue: unknown): Array<Record<string, any>> {
    if (!Array.isArray(rawValue)) {
        return [];
    }

    return rawValue.map((item) => (
        item && typeof item === 'object' && !Array.isArray(item)
            ? { ...(item as Record<string, any>) }
            : {}
    ));
}

function createConfigBlock(_key: string, values: Record<string, any>): WidgetConfigBlock {
    return { ...values };
}

function buildSequenceChartConfig(chartType: string, searchData: Record<string, any>): WidgetConfigBlock[] {
    if (chartType === 'multiaxis') {
        return [];
    }

    if (chartType === 'rangeline') {
        return [
            {
                xField: searchData?.xField || ''
            },
            {
                yField: searchData?.yField || '',
                outlierField: searchData?.outlierField || ''
            },
            {
                upperField: searchData?.upperField || '',
                lowerField: searchData?.lowerField || ''
            }
        ];
    }

    const yFields = splitFieldList(searchData?.yFields);
    const ySmooths = normalizeBooleanList(searchData?.ySmooths);
    const yRanges = normalizeRangeList(searchData?.yRanges);
    const blocks: WidgetConfigBlock[] = [
        {
            xField: searchData?.xField || '',
            xAxisFontSize: searchData?.xAxisFontSize ?? 12,
            xAxisBold: Boolean(searchData?.xAxisBold),
            xAxisRotate: searchData?.xAxisRotate || 'left',
            xAxisSort: searchData?.xAxisSort || 'default',
            labelInterval: searchData?.labelInterval || '',
            customLabel: searchData?.customLabel || '',
            showAllXAxisLabels: Boolean(searchData?.showAllXAxisLabels)
        },
        {
            yField: searchData?.yField || '',
            yAxisFontSize: searchData?.yAxisFontSize ?? 12,
            yAxisBold: Boolean(searchData?.yAxisBold),
            yUnit: searchData?.yUnit || '',
            yRange: yRanges[0] || searchData?.yRange || { min: '', max: '' }
        },
        {
            byFields: Array.isArray(searchData?.byFields) ? searchData.byFields : [],
            byStacks: Array.isArray(searchData?.byStacks) && searchData.byStacks.length > 0
                ? searchData.byStacks.some(Boolean)
                : Boolean(searchData?.byStacks)
        },
        {
            trellisField: searchData?.trellisField || '',
            layout: {
                layoutColumns: typeof searchData?.layoutColumns === 'number' ? searchData.layoutColumns : 1
            }
        },
        {
            legendPosition: searchData?.legendPosition || 'bottom',
            legendLayout: searchData?.legendLayout || 'page'
        }
    ];

    if (chartType === 'column') {
        blocks.push({
            chartStartingColor: normalizeHexColor(searchData?.chartStartingColor) || '#5C9DF5',
            labelFormatter: searchData?.labelFormatter || 'noLabel',
            dataPrecision: searchData?.dataPrecision || '',
            cornerRadius: typeof searchData?.cornerRadius === 'number' ? searchData.cornerRadius : 4,
            maxColumnSize: typeof searchData?.maxColumnSize === 'number' ? searchData.maxColumnSize : 32
        });
        blocks.push({
            promptSpl: searchData?.promptSpl || '',
            promptTimeField: searchData?.promptTimeField || '',
            promptInfoField: searchData?.promptInfoField || '',
            promptColor: searchData?.promptColor || '#FDE360'
        });
    }

    return blocks;
}

function buildDimensionChartConfig(chartType: string, searchData: Record<string, any>): WidgetConfigBlock[] {
    if (chartType === 'single') {
        return [
            {
                xField: searchData?.xField || '',
                singleDisplayField: searchData?.singleDisplayField || '',
                useSparkline: Boolean(searchData?.useSparkline),
                sparklineXAxisField: searchData?.sparklineXAxisField || ''
            },
            {
                trellisField: searchData?.trellisField || '',
                layout: {
                    layoutRows: typeof searchData?.layoutRows === 'number' ? searchData.layoutRows : 1,
                    layoutColumns: typeof searchData?.layoutColumns === 'number' ? searchData.layoutColumns : 1
                }
            },
            {
                singleChartDisplayMode: searchData?.singleChartDisplayMode || DEFAULT_SINGLE_CHART_DISPLAY_MODE,
                alignment: searchData?.alignment || 'center',
                singleChartFontSize: typeof searchData?.singleChartFontSize === 'number' ? searchData.singleChartFontSize : DEFAULT_SINGLE_CHART_FONT_SIZE,
                singleChartFontColor: searchData?.singleChartFontColor || '#4A4A4A',
                singleChartBackgroundColor: searchData?.singleChartBackgroundColor || '#FFFFFF',
                singleChartIconColor: searchData?.singleChartIconColor || '#3661EB',
                liveRefresh: Boolean(searchData?.liveRefresh),
                dataPrecision: searchData?.dataPrecision || '',
                useThousandSeparators: Boolean(searchData?.useThousandSeparators),
                singleUnit: searchData?.singleUnit || '',
                singleUnitFontSize: typeof searchData?.singleUnitFontSize === 'number' ? searchData.singleUnitFontSize : DEFAULT_SINGLE_CHART_FONT_SIZE,
                singleUnitPosition: searchData?.singleUnitPosition || 'after'
            },
            {
                singleChartIcon: searchData?.singleChartIcon || 'none'
            },
            {
                singleSubtitle: searchData?.singleSubtitle || ''
            }
        ];
    }

    if (chartType === 'pie' || chartType === 'rose') {
        return [
            {
                xField: searchData?.categoryField
                    || searchData?.dimensionField
                    || searchData?.pieCategoryField
                    || (Array.isArray(searchData?.byFields) ? searchData.byFields[0] : '')
                    || ''
            },
            {
                byFields: Array.isArray(searchData?.byFields) ? searchData.byFields : []
            },
            {
                trellisField: searchData?.trellisField || '',
                layout: {
                    layoutColumns: typeof searchData?.layoutColumns === 'number' ? searchData.layoutColumns : 1
                }
            },
            {
                chartStartingColor: normalizeHexColor(searchData?.chartStartingColor) || '#3661EB',
                labelFormatter: searchData?.labelFormatter || 'onlyName',
                dataPrecision: searchData?.dataPrecision || '',
                showType: searchData?.showType || 'topN',
                topN: searchData?.topN || '',
                radiusRatio: typeof searchData?.radiusRatio === 'number' ? searchData.radiusRatio : 0.35,
                outerRadiusRatio: typeof searchData?.outerRadiusRatio === 'number' ? searchData.outerRadiusRatio : 0.8,
                cornerRadius: typeof searchData?.cornerRadius === 'number' ? searchData.cornerRadius : 0
            }
        ];
    }

    if (chartType === 'liquidfill') {
        return [
            {
                xField: searchData?.xField || ''
            }
        ];
    }

    if (chartType === 'bar') {
        return [
            {
                xField: searchData?.yField || (Array.isArray(searchData?.byFields) ? searchData.byFields[0] : '') || ''
            },
            {
                yField: searchData?.yField || (Array.isArray(searchData?.byFields) ? searchData.byFields[0] : '') || ''
            },
            {
                byFields: searchData?.yField ? [searchData.yField] : (Array.isArray(searchData?.byFields) ? searchData.byFields : []),
                byStacks: Boolean(searchData?.byStacks)
            },
            {
                trellisField: searchData?.trellisField || '',
                layout: {
                    layoutColumns: typeof searchData?.layoutColumns === 'number' ? searchData.layoutColumns : 1
                }
            },
            {
                chartStartingColor: normalizeHexColor(searchData?.chartStartingColor) || '#3661EB',
                labelFormatter: searchData?.labelFormatter || 'onlyName',
                labelPosition: searchData?.labelPosition || 'left',
                dataPrecision: searchData?.dataPrecision || '',
                cornerRadius: typeof searchData?.cornerRadius === 'number' ? searchData.cornerRadius : 4,
                maxColumnSize: typeof searchData?.maxColumnSize === 'number' ? searchData.maxColumnSize : 32
            }
        ];
    }

    if (chartType === 'sunburst' || chartType === 'heatmap' || chartType === 'wordcloud') {
        return [
            {
                xField: searchData?.xField || ''
            },
            {
                byFields: Array.isArray(searchData?.byFields) ? searchData.byFields : []
            }
        ];
    }

    return [
        createConfigBlock('display', {
            xField: searchData?.xField || ''
        }),
        createConfigBlock('group', {
            byFields: Array.isArray(searchData?.byFields) ? searchData.byFields : []
        }),
        createConfigBlock('style', {
            trendColorType: searchData?.trendColorType || DEFAULT_TREND_COLOR_TYPE,
            scheme: normalizeDashboardScheme(searchData?.scheme)
        }),
        createConfigBlock('other', {
            market_day: resolveMarketDay(searchData?.market_day) ? 1 : 0
        })
    ];
}

function buildRelationshipChartConfig(chartType: string, searchData: Record<string, any>): WidgetConfigBlock[] {
    if (chartType === 'attackmap') {
        return [
            {
                fromField: searchData?.fromField || '',
                fromLongitudeField: searchData?.fromLongitudeField || '',
                fromLatitudeField: searchData?.fromLatitudeField || ''
            },
            {
                toField: searchData?.toField || '',
                toLongitudeField: searchData?.toLongitudeField || '',
                toLatitudeField: searchData?.toLatitudeField || ''
            },
            {
                weightField: searchData?.weightField || '',
                mapType: searchData?.mapType || 'world'
            }
        ];
    }

    return [
        createConfigBlock('source', {
            fromField: searchData?.fromField || ''
        }),
        createConfigBlock('target', {
            toField: searchData?.toField || ''
        }),
        createConfigBlock('weight', {
            weightField: searchData?.weightField || ''
        })
    ];
}

function buildChartConfig(chartType: string, searchData: Record<string, any>): WidgetConfigBlock[] {
    const category = resolveChartCategory(chartType);
    if (category === 'sequence') {
        return buildSequenceChartConfig(chartType, searchData);
    }
    if (category === 'dimension') {
        return buildDimensionChartConfig(chartType, searchData);
    }
    if (category === 'relationship') {
        return buildRelationshipChartConfig(chartType, searchData);
    }
    return [];
}

function resolveTrendColorType(rawValue: unknown): string {
    return typeof rawValue === 'string' && rawValue.trim()
        ? rawValue.trim()
        : DEFAULT_TREND_COLOR_TYPE;
}

function resolveMarketDay(rawValue: unknown): boolean {
    if (typeof rawValue === 'number') {
        return rawValue !== 0;
    }

    if (typeof rawValue === 'string' && rawValue.trim()) {
        return !['0', 'false', 'no'].includes(rawValue.trim().toLowerCase());
    }

    return typeof rawValue === 'boolean' ? rawValue : false;
}

function resolvePanelFieldHints(panel: any, chartType: string): PanelFieldHints {
    const explicitXField = sanitizeFieldName(panel?.xField || '');
    const explicitYField = sanitizeFieldName(panel?.yField || '');
    const explicitYFields = splitFieldList(panel?.yFields);
    const explicitYSmooths = normalizeBooleanList(panel?.ySmooths);
    const explicitYRanges = normalizeRangeList(panel?.yRanges);
    const explicitByFields = splitFieldList(panel?.byFields);
    const allowInferredByFields = chartType !== 'multiaxis';
    const inferredByFields = explicitByFields.length > 0 || !allowInferredByFields ? [] : inferByFieldsFromQuery(panel?.query);
    const byFields = explicitByFields.length > 0 ? explicitByFields : inferredByFields;
    const inferredMetricField = inferMetricFieldFromQuery(panel?.query);

    if (chartType === 'single') {
        const valueField = explicitYField || explicitXField || inferredMetricField || 'count';
        return {
            xField: explicitXField || valueField,
            yField: explicitYField || valueField,
            yFields: [valueField],
            ySmooths: [],
            yRanges: [],
            byFields,
            valueField,
            categoryField: ''
        };
    }

    if (chartType === 'bar') {
        const categoryField = explicitByFields[0] || explicitYField || '';
        const valueField = explicitXField || inferredMetricField || explicitYField || 'count';
        return {
            xField: explicitXField || valueField,
            yField: explicitYField || categoryField,
            yFields: [valueField],
            ySmooths: [],
            yRanges: [],
            byFields: categoryField ? [categoryField] : [],
            valueField,
            categoryField
        };
    }

    if (chartType === 'pie' || chartType === 'rose' || chartType === 'sunburst' || chartType === 'heatmap' || chartType === 'wordcloud') {
        const legacyCategoryField = explicitByFields.length > 0 ? explicitByFields[0] : explicitXField;
        const categoryField = legacyCategoryField || byFields[0] || '';
        const valueField = explicitYField || (categoryField ? inferredMetricField : explicitXField) || inferredMetricField || 'count';
        return {
            xField: categoryField,
            yField: explicitYField || valueField,
            yFields: [valueField],
            ySmooths: [],
            yRanges: [],
            byFields: byFields.length > 0 ? byFields : (categoryField ? [categoryField] : []),
            valueField,
            categoryField
        };
    }

    if (chartType === 'liquidfill') {
        const valueField = explicitXField || explicitYField || inferredMetricField || 'count';
        return {
            xField: valueField,
            yField: valueField,
            yFields: [valueField],
            ySmooths: [],
            yRanges: [],
            byFields,
            valueField,
            categoryField: ''
        };
    }

    if (chartType === 'multiaxis') {
        const yFields = explicitYFields.length > 0
            ? explicitYFields
            : [explicitYField || inferredMetricField || 'count'].filter(Boolean);
        const primaryYField = yFields[0] || explicitYField || inferredMetricField || 'count';
        return {
            xField: explicitXField,
            yField: primaryYField,
            yFields,
            ySmooths: explicitYSmooths,
            yRanges: explicitYRanges,
            byFields,
            valueField: primaryYField,
            categoryField: explicitXField || byFields[0] || ''
        };
    }

    const yFields = explicitYFields.length > 0
        ? explicitYFields
        : [explicitYField || inferredMetricField].filter(Boolean);
    const primaryYField = explicitYField || yFields[0] || inferredMetricField || '';

    return {
        xField: explicitXField,
        yField: primaryYField,
        yFields,
        ySmooths: explicitYSmooths,
        yRanges: explicitYRanges,
        byFields,
        valueField: primaryYField,
        categoryField: explicitXField || byFields[0] || ''
    };
}

function buildCommonChartSearchData(panel: any, existing?: any): Record<string, any> {
    return {
        trendColorType: resolveTrendColorType(existing?.trendColorType ?? panel?.trendColorType),
        scheme: normalizeDashboardScheme(existing?.scheme ?? panel?.scheme),
        market_day: resolveMarketDay(existing?.market_day ?? panel?.market_day) ? 1 : 0
    };
}

function buildChartCategorySearchData(chartType: string): Record<string, any> {
    const category = resolveChartCategory(chartType);
    if (category === 'sequence') {
        return {
            showLegend: true,
            legendPosition: 'bottom',
            xAxisRotate: 'left',
            xAxisSort: 'default'
        };
    }

    if (category === 'dimension') {
        return {};
    }

    if (category === 'relationship') {
        return {};
    }

    return {};
}

function buildChartSpecificSearchData(
    chartType: string,
    fieldHints: PanelFieldHints,
    panel: any,
    existing?: any
): Record<string, any> {
    if (chartType === 'single') {
        const singleColor = normalizeHexColor(
            panel?.color
            || existing?.singleChartFontColor
            || existing?.singleChartDefaultColor
            || existing?.chartStartingColor
        ) || '#4A4A4A';
        return {
            xField: fieldHints.xField,
            cur_XField: fieldHints.xField,
            showType: 'single',
            visType: 'STATS_NEW',
            isTimechart: false,
            sourcegroup: existing?.sourcegroup || 'all',
            sourcegroupCn: existing?.sourcegroupCn || 'all',
            singleDisplayField: existing?.singleDisplayField || '',
            singleFieldDisplayType: existing?.singleFieldDisplayType || 'default',
            useSparkline: Boolean(existing?.useSparkline),
            sparklineXAxisField: existing?.sparklineXAxisField || '',
            trellisField: existing?.trellisField || '',
            layoutColumns: typeof existing?.layoutColumns === 'number' ? existing.layoutColumns : 1,
            layoutRows: typeof existing?.layoutRows === 'number' ? existing.layoutRows : 1,
            singleChartDisplayMode: existing?.singleChartDisplayMode || DEFAULT_SINGLE_CHART_DISPLAY_MODE,
            alignment: existing?.alignment || 'center',
            singleChartFontSize: typeof existing?.singleChartFontSize === 'number' ? existing.singleChartFontSize : DEFAULT_SINGLE_CHART_FONT_SIZE,
            singleChartFontColor: singleColor,
            singleChartBackgroundColor: existing?.singleChartBackgroundColor || '#FFFFFF',
            singleChartIconColor: existing?.singleChartIconColor || '#3661EB',
            singleChartDefaultColor: singleColor,
            singleChartColorFillingMode: existing?.singleChartColorFillingMode || 'font',
            liveRefresh: Boolean(existing?.liveRefresh),
            compareTime: existing?.compareTime || 'none',
            comparedField: existing?.comparedField || '-1h',
            cur_ComparedField: existing?.cur_ComparedField || '-1h',
            singleChartComparsionMode: existing?.singleChartComparsionMode || DEFAULT_SINGLE_CHART_COMPARSION_MODE,
            trendColorType: existing?.trendColorType || panel?.trendColorType || DEFAULT_SINGLE_TREND_COLOR_TYPE,
            singleChartFontRangeColors: Array.isArray(existing?.singleChartFontRangeColors) ? existing.singleChartFontRangeColors : [],
            singleChartBackgroundRangeColors: Array.isArray(existing?.singleChartBackgroundRangeColors) ? existing.singleChartBackgroundRangeColors : [],
            dataPrecision: existing?.dataPrecision || '',
            useThousandSeparators: Boolean(existing?.useThousandSeparators),
            singleUnit: existing?.singleUnit || '',
            singleUnitFontSize: typeof existing?.singleUnitFontSize === 'number' ? existing.singleUnitFontSize : DEFAULT_SINGLE_CHART_FONT_SIZE,
            singleUnitPosition: existing?.singleUnitPosition || 'after',
            singleChartIcon: existing?.singleChartIcon || 'none',
            iconField: existing?.iconField || '',
            fixedSetting: existing?.fixedSetting || '',
            singleSubtitle: existing?.singleSubtitle || '',
            market_day: resolveMarketDay(existing?.market_day ?? panel?.market_day) ? 1 : 0
        };
    }

    if (chartType === 'pie' || chartType === 'rose') {
        return {
            xField: fieldHints.valueField,
            ...(fieldHints.categoryField ? {
                categoryField: fieldHints.categoryField,
                dimensionField: fieldHints.categoryField,
                pieCategoryField: fieldHints.categoryField
            } : {}),
            byFields: fieldHints.byFields,
            trellisField: existing?.trellisField || '',
            layoutColumns: typeof existing?.layoutColumns === 'number' ? existing.layoutColumns : 1,
            chartStartingColor: normalizeHexColor(existing?.chartStartingColor || panel?.color) || '#3661EB',
            labelFormatter: existing?.labelFormatter || 'onlyName',
            dataPrecision: existing?.dataPrecision || '',
            showType: existing?.showType || 'topN',
            topN: existing?.topN || '',
            percentN: typeof existing?.percentN === 'number' ? existing.percentN : 1,
            radiusRatio: typeof existing?.radiusRatio === 'number' ? existing.radiusRatio : 0.35,
            outerRadiusRatio: typeof existing?.outerRadiusRatio === 'number' ? existing.outerRadiusRatio : 0.8,
            cornerRadius: typeof existing?.cornerRadius === 'number' ? existing.cornerRadius : 0,
            valueField: fieldHints.valueField,
            metricField: fieldHints.valueField,
            pieValueField: fieldHints.valueField,
            market_day: resolveMarketDay(existing?.market_day ?? panel?.market_day) ? 1 : 0
        };
    }

    if (chartType === 'bar') {
        return {
            xField: fieldHints.valueField,
            yField: fieldHints.categoryField,
            byFields: [],
            byStacks: Boolean(existing?.byStacks),
            trellisField: existing?.trellisField || '',
            layoutColumns: typeof existing?.layoutColumns === 'number' ? existing.layoutColumns : 1,
            chartStartingColor: normalizeHexColor(existing?.chartStartingColor || panel?.color) || '#3661EB',
            labelFormatter: existing?.labelFormatter || 'onlyName',
            labelPosition: existing?.labelPosition || 'left',
            dataPrecision: existing?.dataPrecision || '',
            cornerRadius: typeof existing?.cornerRadius === 'number' ? existing.cornerRadius : 4,
            maxColumnSize: typeof existing?.maxColumnSize === 'number' ? existing.maxColumnSize : 32,
            market_day: resolveMarketDay(existing?.market_day ?? panel?.market_day) ? 1 : 0
        };
    }

    if (chartType === 'sunburst' || chartType === 'heatmap' || chartType === 'wordcloud') {
        return {
            xField: fieldHints.valueField,
            byFields: fieldHints.byFields,
            market_day: resolveMarketDay(existing?.market_day ?? panel?.market_day) ? 1 : 0
        };
    }

    if (chartType === 'liquidfill') {
        return {
            xField: fieldHints.valueField,
            market_day: resolveMarketDay(existing?.market_day ?? panel?.market_day) ? 1 : 0
        };
    }

    if (chartType === 'multiaxis') {
        const yFields = fieldHints.yFields.length > 0 ? fieldHints.yFields : [fieldHints.yField].filter(Boolean);
        const ySmooths = fieldHints.ySmooths.length > 0
            ? yFields.map((_, index) => fieldHints.ySmooths[index] ?? false)
            : Array.isArray(existing?.ySmooths)
                ? yFields.map((_, index) => Boolean(existing.ySmooths[index]))
                : yFields.map(() => false);
        const yRanges = fieldHints.yRanges.length > 0
            ? yFields.map((_, index) => fieldHints.yRanges[index] || {})
            : Array.isArray(existing?.yRanges)
                ? yFields.map((_, index) => existing.yRanges[index] || {})
                : yFields.map(() => ({}));
        return {
            page: existing?.page ?? 0,
            order: existing?.order || 'desc',
            now: existing?.now || '',
            timeline: existing?.timeline ?? true,
            statsevents: existing?.statsevents ?? false,
            fields: existing?.fields ?? true,
            fromSearch: existing?.fromSearch ?? true,
            app_id: existing?.app_id ?? 1,
            highlight: existing?.highlight ?? false,
            onlySortByTimestamp: existing?.onlySortByTimestamp ?? false,
            use_spark: existing?.use_spark ?? false,
            xField: fieldHints.xField,
            xAxisRotate: existing?.xAxisRotate || 'left',
            xAxisSort: existing?.xAxisSort || 'default',
            labelInterval: existing?.labelInterval || '',
            customLabel: existing?.customLabel || '',
            showAllXAxisLabels: existing?.showAllXAxisLabels ?? false,
            yAxisAttrs: yFields.map((field, index) => {
                const rawRange = yRanges[index];
                const normalizedRange = rawRange && typeof rawRange === 'object' && !Array.isArray(rawRange)
                    ? {
                        min: rawRange.min ?? '',
                        max: rawRange.max ?? ''
                    }
                    : { min: '', max: '' };
                return {
                    unit: '',
                    range: normalizedRange,
                    fields: [{
                        name: field,
                        type: index === 0 ? 'line' : 'scatter',
                        color: index === 0 ? '#E30202' : '#51E1C4',
                        opacity: 0.6,
                        smooth: ySmooths[index] ?? false,
                        connectNull: index === 0
                    }]
                };
            }),
            byFields: fieldHints.byFields,
            legendPosition: existing?.legendPosition || 'bottom',
            legendEllipsis: existing?.legendEllipsis || 'right',
            dataPrecision: existing?.dataPrecision || '',
            scheme: normalizeDashboardScheme(existing?.scheme ?? panel?.scheme),
            chartType: 'multiaxis',
            isNew: existing?.isNew || 'true',
            dataset_ids: existing?.dataset_ids || '[]',
            trendDescription: existing?.trendDescription || '',
            ids: existing?.ids || '',
            legendLayout: existing?.legendLayout || 'page'
        };
    }

    if (chartType === 'column') {
        return {
            now: existing?.now || '',
            highlight: existing?.highlight ?? false,
            onlySortByTimestamp: existing?.onlySortByTimestamp ?? false,
            use_spark: existing?.use_spark ?? false,
            xField: fieldHints.xField,
            xAxisFontSize: existing?.xAxisFontSize ?? 12,
            xAxisBold: Boolean(existing?.xAxisBold),
            xAxisRotate: existing?.xAxisRotate || 'left',
            xAxisSort: existing?.xAxisSort || 'default',
            labelInterval: existing?.labelInterval || '',
            customLabel: existing?.customLabel || '',
            showAllXAxisLabels: existing?.showAllXAxisLabels ?? false,
            yField: fieldHints.yField,
            yAxisFontSize: existing?.yAxisFontSize ?? 12,
            yAxisBold: Boolean(existing?.yAxisBold),
            yUnit: existing?.yUnit || '',
            ySmooth: existing?.ySmooth ?? false,
            yConnectNull: existing?.yConnectNull ?? false,
            yRange: fieldHints.yRanges[0] || existing?.yRange || { min: '', max: '' },
            byFields: fieldHints.byFields,
            byStacks: Array.isArray(existing?.byStacks) && existing.byStacks.length > 0 ? existing.byStacks : true,
            trellisField: existing?.trellisField || '',
            layoutColumns: typeof existing?.layoutColumns === 'number' ? existing.layoutColumns : 1,
            legendPosition: existing?.legendPosition || 'bottom',
            legendEllipsis: existing?.legendEllipsis || 'right',
            legendLayout: existing?.legendLayout || 'page',
            chartStartingColor: normalizeHexColor(existing?.chartStartingColor || panel?.color) || '#5C9DF5',
            labelPosition: existing?.labelPosition || 'top',
            labelFormatter: existing?.labelFormatter || 'noLabel',
            dataPrecision: existing?.dataPrecision || '',
            cornerRadius: typeof existing?.cornerRadius === 'number' ? existing.cornerRadius : 4,
            maxColumnSize: typeof existing?.maxColumnSize === 'number' ? existing.maxColumnSize : 32,
            promptColor: existing?.promptColor || '#FDE360',
            promptInfoField: existing?.promptInfoField || '',
            promptTimeField: existing?.promptTimeField || '',
            promptSpl: existing?.promptSpl || '',
            market_day: resolveMarketDay(existing?.market_day ?? panel?.market_day) ? 1 : 0
        };
    }

    if (chartType === 'rangeline') {
        return {
            xField: fieldHints.xField,
            yField: fieldHints.yField,
            outlierField: sanitizeFieldName(panel?.outlierField || existing?.outlierField || ''),
            upperField: sanitizeFieldName(panel?.upperField || existing?.upperField || ''),
            lowerField: sanitizeFieldName(panel?.lowerField || existing?.lowerField || ''),
            legendPosition: existing?.legendPosition || 'bottom',
            xAxisRotate: existing?.xAxisRotate || 'left',
            xAxisSort: existing?.xAxisSort || 'default',
            market_day: resolveMarketDay(existing?.market_day ?? panel?.market_day) ? 1 : 0
        };
    }

    if (chartType === 'chord' || chartType === 'sankey' || chartType === 'force' || chartType === 'networkflow' || chartType === 'tracing') {
        return {
            fromField: sanitizeFieldName(panel?.fromField || existing?.fromField || ''),
            toField: sanitizeFieldName(panel?.toField || existing?.toField || ''),
            weightField: sanitizeFieldName(panel?.weightField || existing?.weightField || ''),
            market_day: resolveMarketDay(existing?.market_day ?? panel?.market_day) ? 1 : 0
        };
    }

    if (chartType === 'attackmap') {
        return {
            fromField: sanitizeFieldName(panel?.fromField || existing?.fromField || ''),
            fromLongitudeField: sanitizeFieldName(panel?.fromLongitudeField || existing?.fromLongitudeField || ''),
            fromLatitudeField: sanitizeFieldName(panel?.fromLatitudeField || existing?.fromLatitudeField || ''),
            toField: sanitizeFieldName(panel?.toField || existing?.toField || ''),
            toLongitudeField: sanitizeFieldName(panel?.toLongitudeField || existing?.toLongitudeField || ''),
            toLatitudeField: sanitizeFieldName(panel?.toLatitudeField || existing?.toLatitudeField || ''),
            weightField: sanitizeFieldName(panel?.weightField || existing?.weightField || ''),
            mapType: existing?.mapType || panel?.mapType || 'world',
            market_day: resolveMarketDay(existing?.market_day ?? panel?.market_day) ? 1 : 0
        };
    }

    return {};
}

function buildWidgetSearchData(panel: any, options: { existing?: any; panelIndex: number } ): any {
    const normalized = normalizePanelKind(panel?.type || 'trend', panel?.chartType);
    const normalizedColor = normalizeHexColor(panel?.color);
    const fieldHints = resolvePanelFieldHints(panel, normalized.chartType);
    const nextSearchData = {
        ...(options.existing && typeof options.existing === 'object' ? options.existing : {}),
        trendName: panel.title || `Panel ${options.panelIndex + 1}`,
        query: panel.query || '*',
        time_range: panel.time_range || '-1h,now',
        chartType: normalized.chartType,
        xField: fieldHints.xField,
        yField: fieldHints.yField,
        byFields: fieldHints.byFields,
        description: panel.description || '',
        ...buildCommonChartSearchData(panel, options.existing),
        ...buildChartCategorySearchData(normalized.chartType),
        ...buildChartSpecificSearchData(normalized.chartType, fieldHints, panel, options.existing)
    };

    if (normalizedColor) {
        nextSearchData.chartStartingColor = normalizedColor;
    }

    if (normalized.chartType === 'single' || normalized.chartType === 'pie' || normalized.chartType === 'rose' || normalized.chartType === 'multiaxis') {
        delete nextSearchData.yField;
    }

    if (normalized.chartType === 'single') {
        delete nextSearchData.byFields;
        delete nextSearchData.valueField;
        delete nextSearchData.metricField;
        delete nextSearchData.singleValueField;
    }

    if (normalized.chartType === 'pie' || normalized.chartType === 'rose') {
        delete nextSearchData.trendColorType;
        delete nextSearchData.showLegend;
        delete nextSearchData.legendPosition;
        delete nextSearchData.donut;
        delete nextSearchData.innerRadius;
        delete nextSearchData.labelDisplay;
        delete nextSearchData.valueField;
        delete nextSearchData.metricField;
        delete nextSearchData.pieValueField;
        delete nextSearchData.categoryField;
        delete nextSearchData.dimensionField;
        delete nextSearchData.pieCategoryField;
    }

    if (normalized.chartType === 'multiaxis') {
        delete nextSearchData.showLegend;
        delete nextSearchData.trendColorType;
        delete nextSearchData.config;
    }

    if (normalized.chartType === 'column') {
        delete nextSearchData.showLegend;
        delete nextSearchData.trendColorType;
    }

    const nextConfig = buildChartConfig(normalized.chartType, nextSearchData);
    if (nextConfig.length > 0) {
        nextSearchData.config = nextConfig;
    } else {
        delete nextSearchData.config;
    }

    return nextSearchData;
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
        searchData: buildWidgetSearchData(panel, { panelIndex: index })
    };
}

export function widgetToPanel(widget: any): any {
    const normalized = normalizePanelKind(widget?.type || 'trend', widget?.searchData?.chartType);
    const searchData = widget?.searchData || {};
    return {
        title: getWidgetTitle(widget),
        type: normalized.type,
        query: searchData?.query || '*',
        time_range: searchData?.time_range || '-1h,now',
        chartType: normalized.chartType,
        xField: searchData?.xField || '',
        yField: searchData?.yField || '',
        yFields: splitFieldList(searchData?.yFields),
        ySmooths: normalizeBooleanList(searchData?.ySmooths),
        yRanges: normalizeRangeList(searchData?.yRanges),
        byFields: Array.isArray(searchData?.byFields) ? searchData.byFields : [],
        outlierField: sanitizeFieldName(searchData?.outlierField || ''),
        upperField: sanitizeFieldName(searchData?.upperField || ''),
        lowerField: sanitizeFieldName(searchData?.lowerField || ''),
        fromField: sanitizeFieldName(searchData?.fromField || ''),
        toField: sanitizeFieldName(searchData?.toField || ''),
        weightField: sanitizeFieldName(searchData?.weightField || ''),
        fromLongitudeField: sanitizeFieldName(searchData?.fromLongitudeField || ''),
        fromLatitudeField: sanitizeFieldName(searchData?.fromLatitudeField || ''),
        toLongitudeField: sanitizeFieldName(searchData?.toLongitudeField || ''),
        toLatitudeField: sanitizeFieldName(searchData?.toLatitudeField || ''),
        mapType: typeof searchData?.mapType === 'string' && searchData.mapType.trim() ? searchData.mapType.trim() : 'world',
        description: searchData?.description || '',
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
    const chartTypeChanged = Object.prototype.hasOwnProperty.call(changes, 'chartType');
    const colorChanged = Object.prototype.hasOwnProperty.call(changes, 'color');
    const normalizedColor = normalizeHexColor(mergedPanel?.color);
    const nextWidget = {
        ...rawWidget,
        type: mergedPanel.type,
        searchData: buildWidgetSearchData(mergedPanel, {
            panelIndex: 0,
            existing: chartTypeChanged ? omitChartSpecificSearchData(rawSearchData) : rawSearchData
        })
    };

    if (colorChanged && normalizedColor) {
        const singleStyle = nextWidget.searchData?.chartType === 'single'
            ? getSingleWidgetStyleSnapshot(rawWidget)
            : null;
        nextWidget.chart = {
            ...(rawWidget?.chart && typeof rawWidget.chart === 'object' ? rawWidget.chart : {}),
            chartStartingColor: normalizedColor
        };

        if (nextWidget.searchData?.chartType === 'single') {
            const existingConfig = Array.isArray(rawSearchData?.config) ? [...rawSearchData.config] : [];
            while (existingConfig.length < 3) {
                existingConfig.push({});
            }
            existingConfig[2] = {
                ...(existingConfig[2] && typeof existingConfig[2] === 'object' ? existingConfig[2] : {}),
                singleChartFontColor: normalizedColor,
                singleChartBackgroundColor: singleStyle?.backgroundColor || '#FFFFFF'
            };

            nextWidget.searchData = {
                ...nextWidget.searchData,
                chartStartingColor: normalizedColor,
                singleChartFontColor: normalizedColor,
                singleChartDefaultColor: normalizedColor,
                singleChartBackgroundColor: singleStyle?.backgroundColor || '#FFFFFF',
                singleChartColorFillingMode: singleStyle?.fillMode || nextWidget.searchData?.singleChartColorFillingMode || 'font',
                config: existingConfig
            };
            nextWidget.originWidgetConfData = {
                ...(rawWidget?.originWidgetConfData && typeof rawWidget.originWidgetConfData === 'object'
                    ? rawWidget.originWidgetConfData
                    : {}),
                chartStartingColor: normalizedColor,
                singleChartFontColor: normalizedColor,
                singleChartDefaultColor: normalizedColor,
                singleChartBackgroundColor: singleStyle?.backgroundColor || '#FFFFFF',
                singleChartColorFillingMode: singleStyle?.fillMode || rawWidget?.originWidgetConfData?.singleChartColorFillingMode || 'font'
            };
            nextWidget.chart.singleChartFontColor = normalizedColor;
            nextWidget.chart.singleChartDefaultColor = normalizedColor;
            nextWidget.chart.singleChartBackgroundColor = singleStyle?.backgroundColor || '#FFFFFF';
        }
    }

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
