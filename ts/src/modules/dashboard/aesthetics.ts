import {
    DEFAULT_DASHBOARD_SCHEME,
    dashboardSchemeColors,
    getWidgetColor,
    getWidgetId,
    getWidgetTitle,
    normalizeDashboardScheme,
    normalizePanelKind
} from './panel-utils.js';

type Severity = 'high' | 'medium' | 'low';

const COLOR_DISTRIBUTION_TARGETS = {
    main: 0.6,
    secondary: 0.3,
    accent: 0.1
};
const SECONDARY_HUE_OFFSETS = [120, 135, 150, -120, -135, -150];
const ACCENT_HUE_OFFSETS = [60, -60];
const MIN_DARK_CONTRAST = 4.5;
const DARK_BACKGROUND_COLOR = '#0B1220';
const DEFAULT_SINGLE_GRID_PX_PER_H = 105;
const DEFAULT_SINGLE_HEADER_CHROME_PX = 38;
const DEFAULT_SINGLE_FONT_SIZE_PX = 60;
const SINGLE_HEIGHT_RATIO_COMFORT_MIN = 0.22;
const SINGLE_HEIGHT_RATIO_ACCEPTABLE_MAX = 0.48;

export function buildAestheticsAnalysis(widgets: any[], options: { scheme?: string } = {}) {
    const items = extractAestheticItems(widgets);
    const canvas = calculateCanvas(items);
    const overlapPairs = findOverlappingPairs(items);
    const density = computeDensityScore(items, canvas);
    const symmetry = computeSymmetryScore(items, canvas);
    const balance = computeBalanceScore(items, canvas);
    const proportionality = computeProportionalityScore(items);
    const uniformity = computeUniformityScore(items, canvas);
    const simplicity = computeSimplicityScore(items.length);
    const sequence = computeSequenceScore(items);
    const rawScores = {
        density,
        symmetry,
        balance,
        proportionality,
        uniformity,
        simplicity,
        sequence
    };
    const weights = {
        density: 0.138,
        symmetry: 0.185,
        balance: 0.142,
        proportionality: 0.167,
        uniformity: 0.126,
        simplicity: 0.179,
        sequence: 0.063
    };
    const overallRaw = rawScores.density * weights.density
        + rawScores.symmetry * weights.symmetry
        + rawScores.balance * weights.balance
        + rawScores.proportionality * weights.proportionality
        + rawScores.uniformity * weights.uniformity
        + rawScores.simplicity * weights.simplicity
        + rawScores.sequence * weights.sequence;

    const scores = {
        density: toPercentageScore(rawScores.density),
        symmetry: toPercentageScore(rawScores.symmetry),
        balance: toPercentageScore(rawScores.balance),
        proportionality: toPercentageScore(rawScores.proportionality),
        uniformity: toPercentageScore(rawScores.uniformity),
        simplicity: toPercentageScore(rawScores.simplicity),
        sequence: toPercentageScore(rawScores.sequence)
    };

    return {
        items,
        canvas,
        scores,
        overallScore: toPercentageScore(overallRaw),
        colorAnalysis: buildColorAnalysis(items, options.scheme),
        issues: buildAestheticIssues(items, canvas, rawScores, overlapPairs),
        suggestions: buildAestheticSuggestions(items, rawScores, overlapPairs)
    };
}

function extractAestheticItems(widgets: any[]) {
    return widgets.map((widget: any, index: number) => {
        const x = Number.isFinite(widget?.x) ? Number(widget.x) : 0;
        const y = Number.isFinite(widget?.y) ? Number(widget.y) : 0;
        const w = Number.isFinite(widget?.w) && Number(widget.w) > 0 ? Number(widget.w) : 6;
        const h = Number.isFinite(widget?.h) && Number(widget.h) > 0 ? Number(widget.h) : 5;
        const area = w * h;
        const normalized = normalizePanelKind(
            widget?.type || widget?.panel_type || 'trend',
            widget?.searchData?.chartType || widget?.chart?.chartType || widget?.chart?.showType
        );
        const chartType = normalized.chartType;
        const singleValueFontSize = chartType === 'single' ? getSingleValueFontSize(widget) : null;
        const singleValueHeightRatio = chartType === 'single'
            ? estimateSingleValueHeightRatio(h, singleValueFontSize || DEFAULT_SINGLE_FONT_SIZE_PX)
            : null;
        const effectiveAreaFactor = chartType === 'single' && singleValueHeightRatio !== null
            ? clamp01(singleValueHeightRatio)
            : 1;

        return {
            index,
            id: getWidgetId(widget) || `panel_${index}`,
            title: getWidgetTitle(widget) || `Panel ${index + 1}`,
            x,
            y,
            w,
            h,
            right: x + w,
            bottom: y + h,
            cx: x + w / 2,
            cy: y + h / 2,
            area,
            effectiveArea: area * effectiveAreaFactor,
            effectiveAreaFactor,
            chartType,
            singleValueFontSize,
            singleValueHeightRatio,
            color: getWidgetColor(widget)
        };
    });
}

function buildColorAnalysis(items: any[], scheme?: string) {
    const normalizedScheme = normalizeDashboardScheme(scheme);
    const paletteInfos = getSchemePaletteInfos(normalizedScheme);
    const totalArea = items.reduce((sum: number, item: any) => sum + item.area, 0);
    const coloredItems = items.filter((item: any) => item.color);

    if (totalArea <= 0 || coloredItems.length === 0) {
        return {
            score: 0,
            scheme: normalizedScheme,
            roles: {
                main: null,
                secondary: null,
                accent: null
            },
            distribution: {
                main: 0,
                secondary: 0,
                accent: 0,
                other: 0,
                uncolored: 1
            },
            suggestions: [{
                category: 'color',
                priority: 'high',
                message: '当前 tab 里的 panel 还没有设置 chartStartingColor，无法形成 60/30/10 的颜色层次。'
            }]
        };
    }

    const mainColor = selectMainColor(coloredItems);
    const sameFamilyRoles = buildSameFamilyScheme(mainColor, paletteInfos);
    const adjacentRoles = buildAdjacentScheme(mainColor, paletteInfos);
    const schemeSuggestions = [
        buildSchemeSuggestion(
            '同色系方案',
            'same_family',
            sameFamilyRoles,
            '整体更统一、更柔和，但颜色区分度偏弱。'
        ),
        buildSchemeSuggestion(
            '邻近色方案',
            'adjacent',
            adjacentRoles,
            '层次更分明、辅助色更自然，更适合主次分层明显的 dashboard。'
        )
    ].filter((item): item is {
        name: string;
        strategy: string;
        roles: { main: string | null; secondary: string | null; accent: string | null };
        contrast: {
            dark: { main: number | null; secondary: number | null; accent: number | null };
            light: { main: number | null; secondary: number | null; accent: number | null };
        };
        summary: string;
    } => Boolean(item));
    const selectedSuggestion = schemeSuggestions.find((item: any) => item.strategy === 'adjacent')
        || schemeSuggestions[0];
    const selectedRoles = selectedSuggestion?.roles || {
        main: mainColor,
        secondary: null,
        accent: null
    };
    const distribution = computeRoleDistribution(items, selectedRoles, totalArea);
    const colorScore = computeColorDistributionScore(distribution);

    return {
        score: toPercentageScore(colorScore),
        scheme: normalizedScheme,
        selected_strategy: selectedSuggestion?.strategy || 'adjacent',
        roles: selectedRoles,
        distribution,
        scheme_suggestions: schemeSuggestions,
        suggestions: buildColorSuggestions(distribution, {
            ...selectedRoles,
            schemeSuggestions
        }, colorScore)
    };
}

function getSchemePaletteInfos(scheme: string): Array<{ color: string; hsl: { h: number; s: number; l: number } }> {
    const palette = dashboardSchemeColors[scheme] || dashboardSchemeColors[DEFAULT_DASHBOARD_SCHEME] || [];
    return Array.from(new Set(palette.flat().map((color) => color.toUpperCase())))
        .map((color) => {
            const hsl = hexToHsl(color);
            return hsl ? { color, hsl } : null;
        })
        .filter((item): item is { color: string; hsl: { h: number; s: number; l: number } } => Boolean(item));
}

function buildSameFamilyScheme(
    mainColor: string,
    paletteInfos: Array<{ color: string; hsl: { h: number; s: number; l: number } }>
) {
    const mainHsl = hexToHsl(mainColor);
    const secondaryColor = mainHsl
        ? findClosestPaletteColor(
            buildSameFamilySecondaryTarget(mainHsl),
            paletteInfos,
            new Set([mainColor])
        )
        : null;
    const accentColor = mainHsl
        ? findClosestPaletteColor(
            buildSameFamilyAccentTarget(mainHsl),
            paletteInfos,
            new Set([mainColor, secondaryColor || ''])
        )
        : null;

    return {
        main: mainColor,
        secondary: secondaryColor,
        accent: accentColor
    };
}

function buildAdjacentScheme(
    mainColor: string,
    paletteInfos: Array<{ color: string; hsl: { h: number; s: number; l: number } }>
) {
    const mainHsl = hexToHsl(mainColor);
    const secondaryColor = mainHsl
        ? deriveRoleColor({
            baseHsl: mainHsl,
            hueOffsets: SECONDARY_HUE_OFFSETS,
            paletteInfos,
            excluded: new Set([mainColor]),
            saturationScale: 0.92,
            lightnessDelta: 0.02
        })
        : null;
    const secondaryHsl = hexToHsl(secondaryColor || '');
    const accentColor = secondaryHsl
        ? deriveRoleColor({
            baseHsl: secondaryHsl,
            hueOffsets: ACCENT_HUE_OFFSETS,
            paletteInfos,
            excluded: new Set([mainColor, secondaryColor || '']),
            saturationScale: 1.04,
            lightnessDelta: 0
        })
        : null;

    return {
        main: mainColor,
        secondary: secondaryColor,
        accent: accentColor
    };
}

function buildSchemeSuggestion(
    name: string,
    strategy: string,
    roles: { main: string | null; secondary: string | null; accent: string | null },
    summary: string
) {
    if (!roles?.main) {
        return null;
    }

    return {
        name,
        strategy,
        roles,
        contrast: buildRoleContrasts(roles),
        summary
    };
}

function buildRoleContrasts(roles: { main: string | null; secondary: string | null; accent: string | null }) {
    const buildSide = (background: string) => ({
        main: roles.main ? roundNumber(contrastRatio(roles.main, background)) : null,
        secondary: roles.secondary ? roundNumber(contrastRatio(roles.secondary, background)) : null,
        accent: roles.accent ? roundNumber(contrastRatio(roles.accent, background)) : null
    });

    return {
        dark: buildSide(DARK_BACKGROUND_COLOR),
        light: buildSide('#FFFFFF')
    };
}

function selectMainColor(items: any[]): string {
    const colorStats = new Map<string, { count: number; area: number; firstIndex: number }>();

    items.forEach((item: any) => {
        if (!item.color) {
            return;
        }

        const existing = colorStats.get(item.color) || { count: 0, area: 0, firstIndex: item.index };
        colorStats.set(item.color, {
            count: existing.count + 1,
            area: existing.area + item.area,
            firstIndex: existing.firstIndex
        });
    });

    return [...colorStats.entries()]
        .sort((left, right) => {
            if (right[1].count !== left[1].count) {
                return right[1].count - left[1].count;
            }
            if (right[1].area !== left[1].area) {
                return right[1].area - left[1].area;
            }
            return left[1].firstIndex - right[1].firstIndex;
        })[0]?.[0] || '';
}

function computeColorDistributionScore(distribution: { main: number; secondary: number; accent: number; other: number; uncolored: number }): number {
    const baseError = Math.abs(distribution.main - COLOR_DISTRIBUTION_TARGETS.main)
        + Math.abs(distribution.secondary - COLOR_DISTRIBUTION_TARGETS.secondary)
        + Math.abs(distribution.accent - COLOR_DISTRIBUTION_TARGETS.accent);
    const extraError = (distribution.other * 0.8) + distribution.uncolored;
    return clamp01(1 - ((baseError + extraError) / 1.35));
}

function computeRoleDistribution(
    items: any[],
    roles: { main: string | null; secondary: string | null; accent: string | null },
    totalArea: number
) {
    const roleAreas = {
        main: 0,
        secondary: 0,
        accent: 0,
        other: 0,
        uncolored: 0
    };

    items.forEach((item: any) => {
        if (!item.color) {
            roleAreas.uncolored += item.area;
            return;
        }
        if (roles.main && item.color === roles.main) {
            roleAreas.main += item.area;
            return;
        }
        if (roles.secondary && item.color === roles.secondary) {
            roleAreas.secondary += item.area;
            return;
        }
        if (roles.accent && item.color === roles.accent) {
            roleAreas.accent += item.area;
            return;
        }
        roleAreas.other += item.area;
    });

    return {
        main: roundNumber(roleAreas.main / Math.max(totalArea, 1)),
        secondary: roundNumber(roleAreas.secondary / Math.max(totalArea, 1)),
        accent: roundNumber(roleAreas.accent / Math.max(totalArea, 1)),
        other: roundNumber(roleAreas.other / Math.max(totalArea, 1)),
        uncolored: roundNumber(roleAreas.uncolored / Math.max(totalArea, 1))
    };
}

function buildColorSuggestions(
    distribution: { main: number; secondary: number; accent: number; other: number; uncolored: number },
    roles: {
        main: string | null;
        secondary: string | null;
        accent: string | null;
        schemeSuggestions?: Array<{ name: string; summary: string }>;
    },
    colorScore: number
) {
    const suggestions: any[] = [];

    if (Array.isArray(roles.schemeSuggestions) && roles.schemeSuggestions.length > 1) {
        suggestions.push({
            category: 'color',
            priority: 'low',
            message: '当前同时返回“同色系方案”和“邻近色方案”：前者更统一柔和，后者更强调层次和区分度，可按场景挑选。'
        });
    }

    if (distribution.uncolored > 0.1) {
        suggestions.push({
            category: 'color',
            priority: scoreToPriority(1 - distribution.uncolored),
            message: '先给还未设置 chartStartingColor 的 panel 补齐颜色，否则很难形成稳定的主次层次。'
        });
    }

    if (distribution.main < 0.5) {
        suggestions.push({
            category: 'color',
            priority: scoreToPriority(distribution.main / Math.max(COLOR_DISTRIBUTION_TARGETS.main, 1e-6)),
            message: `主色 ${roles.main || ''} 的覆盖面积偏低，建议让更多核心大 panel 复用它，整体更接近 60% 主色占比。`
        });
    } else if (distribution.main > 0.75) {
        suggestions.push({
            category: 'color',
            priority: scoreToPriority(1 - distribution.main),
            message: '主色占比偏高，建议把部分次级 panel 调整为辅助色，避免画面过满、层次单一。'
        });
    }

    if (distribution.secondary < 0.2) {
        suggestions.push({
            category: 'color',
            priority: scoreToPriority(distribution.secondary / Math.max(COLOR_DISTRIBUTION_TARGETS.secondary, 1e-6)),
            message: `辅助色 ${roles.secondary || ''} 的存在感偏弱，建议让一部分非核心 panel 承担 30% 左右的过渡层。`
        });
    } else if (distribution.secondary > 0.4) {
        suggestions.push({
            category: 'color',
            priority: scoreToPriority(1 - distribution.secondary),
            message: '辅助色占比偏高，建议收敛一部分辅助色面积，把视觉重心还给主色。'
        });
    }

    if (distribution.accent < 0.05) {
        suggestions.push({
            category: 'color',
            priority: 'low',
            message: `强调色 ${roles.accent || ''} 用得偏少，可给关键指标、异常趋势或告警面板预留少量点缀，接近 10% 更有层次。`
        });
    } else if (distribution.accent > 0.18) {
        suggestions.push({
            category: 'color',
            priority: scoreToPriority(1 - distribution.accent),
            message: '强调色面积偏大，建议只保留在少数关键 panel 上，避免画面显得过跳。'
        });
    }

    if (distribution.other > 0.12) {
        suggestions.push({
            category: 'color',
            priority: scoreToPriority(1 - distribution.other),
            message: '当前 tab 里出现了较多主色/辅助色/强调色之外的颜色，建议收敛到三角色配色，整体会更稳。'
        });
    }

    if (suggestions.length === 0) {
        suggestions.push({
            category: 'color',
            priority: colorScore >= 0.85 ? 'low' : 'medium',
            message: '当前 tab 的配色层次比较稳定，可继续围绕 60/30/10 维持主色、辅助色、强调色的分工。'
        });
    }

    return deduplicateSuggestions(suggestions);
}

function buildSameFamilySecondaryTarget(hsl: { h: number; s: number; l: number }) {
    return {
        h: hsl.h,
        s: clamp01(hsl.s * 0.72),
        l: clamp01(hsl.l + 0.08)
    };
}

function buildSameFamilyAccentTarget(hsl: { h: number; s: number; l: number }) {
    return {
        h: wrapHue(hsl.h + 18),
        s: clamp01(Math.min(1, hsl.s * 1.05)),
        l: clamp01(hsl.l - 0.06)
    };
}

function findClosestPaletteColor(
    target: { h: number; s: number; l: number },
    paletteInfos: Array<{ color: string; hsl: { h: number; s: number; l: number } }>,
    excluded: Set<string> = new Set()
): string | null {
    let bestColor: string | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;

    paletteInfos.forEach((item) => {
        if (!item.color || excluded.has(item.color)) {
            return;
        }

        const distance = computeHslDistance(target, item.hsl);
        if (distance < bestDistance) {
            bestDistance = distance;
            bestColor = item.color;
        }
    });

    return bestColor;
}

function deriveRoleColor(options: {
    baseHsl: { h: number; s: number; l: number };
    hueOffsets: number[];
    paletteInfos: Array<{ color: string; hsl: { h: number; s: number; l: number } }>;
    excluded?: Set<string>;
    saturationScale?: number;
    lightnessDelta?: number;
}): string | null {
    const {
        baseHsl,
        hueOffsets,
        paletteInfos,
        excluded = new Set(),
        saturationScale = 1,
        lightnessDelta = 0
    } = options;
    let bestColor: string | null = null;
    let bestScore = Number.POSITIVE_INFINITY;

    for (const offset of hueOffsets) {
        const target = ensureContrastGuard({
            h: wrapHue(baseHsl.h + offset),
            s: clamp01(baseHsl.s * saturationScale),
            l: clamp01(baseHsl.l + lightnessDelta)
        });
        const candidate = findClosestPaletteColorWithGuard(target, paletteInfos, excluded);
        if (!candidate) {
            continue;
        }

        const score = computeCandidateScore(target, candidate.hsl, candidate.color);
        if (score < bestScore) {
            bestScore = score;
            bestColor = candidate.color;
        }
    }

    return bestColor;
}

function findClosestPaletteColorWithGuard(
    target: { h: number; s: number; l: number },
    paletteInfos: Array<{ color: string; hsl: { h: number; s: number; l: number } }>,
    excluded: Set<string> = new Set()
): { color: string; hsl: { h: number; s: number; l: number } } | null {
    let bestCandidate: { color: string; hsl: { h: number; s: number; l: number } } | null = null;
    let bestScore = Number.POSITIVE_INFINITY;

    for (let step = 0; step <= 10; step++) {
        const liftedTarget = ensureContrastGuard({
            ...target,
            l: clamp01(target.l + (step * 0.04))
        });

        for (const item of paletteInfos) {
            if (!item.color || excluded.has(item.color)) {
                continue;
            }

            const contrast = contrastRatio(item.color, DARK_BACKGROUND_COLOR);
            const contrastPenalty = contrast < MIN_DARK_CONTRAST
                ? (MIN_DARK_CONTRAST - contrast) * 0.45
                : 0;
            const score = computeHslDistance(liftedTarget, item.hsl) + contrastPenalty;
            if (score < bestScore) {
                bestScore = score;
                bestCandidate = item;
            }
        }

        if (bestCandidate && contrastRatio(bestCandidate.color, DARK_BACKGROUND_COLOR) >= MIN_DARK_CONTRAST) {
            return bestCandidate;
        }
    }

    return bestCandidate;
}

function computeCandidateScore(
    target: { h: number; s: number; l: number },
    candidate: { h: number; s: number; l: number },
    color: string
) {
    const contrast = contrastRatio(color, DARK_BACKGROUND_COLOR);
    const contrastPenalty = contrast < MIN_DARK_CONTRAST
        ? (MIN_DARK_CONTRAST - contrast) * 0.45
        : 0;
    return computeHslDistance(target, candidate) + contrastPenalty;
}

function ensureContrastGuard(hsl: { h: number; s: number; l: number }) {
    let next = { ...hsl };
    for (let step = 0; step < 12; step++) {
        const hex = hslToHex(next);
        if (contrastRatio(hex, DARK_BACKGROUND_COLOR) >= MIN_DARK_CONTRAST || next.l >= 0.96) {
            return next;
        }
        next = {
            ...next,
            l: clamp01(next.l + 0.04)
        };
    }
    return next;
}

function wrapHue(hue: number) {
    const normalized = hue % 360;
    return normalized < 0 ? normalized + 360 : normalized;
}

function computeHslDistance(left: { h: number; s: number; l: number }, right: { h: number; s: number; l: number }) {
    const hueDiff = Math.min(Math.abs(left.h - right.h), 360 - Math.abs(left.h - right.h)) / 180;
    const satDiff = Math.abs(left.s - right.s);
    const lightDiff = Math.abs(left.l - right.l);
    return (0.5 * hueDiff) + (0.25 * satDiff) + (0.25 * lightDiff);
}

function hexToHsl(color: string): { h: number; s: number; l: number } | null {
    const rgb = hexToRgb(color);
    if (!rgb) {
        return null;
    }

    const r = rgb.r / 255;
    const g = rgb.g / 255;
    const b = rgb.b / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;

    if (max === min) {
        return { h: 0, s: 0, l };
    }

    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h = 0;

    switch (max) {
        case r:
            h = ((g - b) / d) + (g < b ? 6 : 0);
            break;
        case g:
            h = ((b - r) / d) + 2;
            break;
        default:
            h = ((r - g) / d) + 4;
            break;
    }

    h *= 60;

    return { h, s, l };
}

function hexToRgb(color: string): { r: number; g: number; b: number } | null {
    const normalized = color.trim().replace('#', '');
    if (!/^[0-9A-Fa-f]{6}$/.test(normalized)) {
        return null;
    }

    return {
        r: parseInt(normalized.slice(0, 2), 16),
        g: parseInt(normalized.slice(2, 4), 16),
        b: parseInt(normalized.slice(4, 6), 16)
    };
}

function hslToHex(hsl: { h: number; s: number; l: number }): string {
    const hue = wrapHue(hsl.h) / 360;
    const saturation = clamp01(hsl.s);
    const lightness = clamp01(hsl.l);

    if (saturation === 0) {
        const value = Math.round(lightness * 255);
        return rgbToHex(value, value, value);
    }

    const q = lightness < 0.5
        ? lightness * (1 + saturation)
        : lightness + saturation - (lightness * saturation);
    const p = 2 * lightness - q;
    const r = hueToRgb(p, q, hue + (1 / 3));
    const g = hueToRgb(p, q, hue);
    const b = hueToRgb(p, q, hue - (1 / 3));

    return rgbToHex(Math.round(r * 255), Math.round(g * 255), Math.round(b * 255));
}

function hueToRgb(p: number, q: number, t: number): number {
    let nextT = t;
    if (nextT < 0) nextT += 1;
    if (nextT > 1) nextT -= 1;
    if (nextT < 1 / 6) return p + ((q - p) * 6 * nextT);
    if (nextT < 1 / 2) return q;
    if (nextT < 2 / 3) return p + ((q - p) * ((2 / 3) - nextT) * 6);
    return p;
}

function rgbToHex(r: number, g: number, b: number): string {
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
}

function toHex(value: number): string {
    return value.toString(16).padStart(2, '0');
}

function contrastRatio(foreground: string, background: string): number {
    const lighter = Math.max(relativeLuminance(foreground), relativeLuminance(background));
    const darker = Math.min(relativeLuminance(foreground), relativeLuminance(background));
    return (lighter + 0.05) / (darker + 0.05);
}

function relativeLuminance(color: string): number {
    const rgb = hexToRgb(color);
    if (!rgb) {
        return 0;
    }

    const transform = (channel: number) => {
        const value = channel / 255;
        return value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
    };

    const r = transform(rgb.r);
    const g = transform(rgb.g);
    const b = transform(rgb.b);
    return (0.2126 * r) + (0.7152 * g) + (0.0722 * b);
}

function calculateCanvas(items: any[]) {
    const width = Math.max(1, ...items.map((item: any) => item.right));
    const height = Math.max(1, ...items.map((item: any) => item.bottom));
    return {
        width,
        height,
        area: width * height
    };
}

function computeDensityScore(items: any[], canvas: any): number {
    const totalArea = items.reduce((sum: number, item: any) => sum + getVisualArea(item), 0);
    const ratio = totalArea / Math.max(canvas.area, 1);
    if (ratio < 0.25) {
        return clamp01(ratio / 0.25);
    }
    if (ratio <= 0.55) {
        return 1;
    }
    return clamp01(1 - ((ratio - 0.55) / 0.45));
}

function computeSymmetryScore(items: any[], canvas: any): number {
    if (items.length <= 1) {
        return 1;
    }

    const centerX = canvas.width / 2;
    const leftItems = items.filter((item: any) => item.cx < centerX);
    const rightPool = items.filter((item: any) => item.cx > centerX);
    const centerItems = items.filter((item: any) => item.cx === centerX);
    const unmatchedRight = [...rightPool];
    const deviations: number[] = [];

    for (const left of leftItems) {
        const targetCx = canvas.width - left.cx;
        let bestIndex = -1;
        let bestDeviation = 1;

        unmatchedRight.forEach((right: any, index: number) => {
            const centerDeviation = Math.abs(right.cx - targetCx) / Math.max(canvas.width, 1);
            const verticalDeviation = Math.abs(right.cy - left.cy) / Math.max(canvas.height, 1);
            const areaDeviation = Math.abs(right.area - left.area) / Math.max(left.area, right.area, 1);
            const combined = (centerDeviation + verticalDeviation + areaDeviation) / 3;
            if (combined < bestDeviation) {
                bestDeviation = combined;
                bestIndex = index;
            }
        });

        deviations.push(bestDeviation);
        if (bestIndex >= 0) {
            unmatchedRight.splice(bestIndex, 1);
        }
    }

    for (const centerItem of centerItems) {
        deviations.push(Math.abs(centerItem.cx - centerX) / Math.max(centerX, 1));
    }

    for (let i = 0; i < unmatchedRight.length; i++) {
        deviations.push(1);
    }

    if (deviations.length === 0) {
        return 1;
    }

    const avgDeviation = deviations.reduce((sum: number, value: number) => sum + value, 0) / deviations.length;
    return clamp01(1 - avgDeviation);
}

function computeBalanceScore(items: any[], canvas: any): number {
    const centerX = canvas.width / 2;
    let leftMoment = 0;
    let rightMoment = 0;

    for (const item of items) {
        const visualArea = getVisualArea(item);
        if (item.cx < centerX) {
            leftMoment += visualArea * (centerX - item.cx);
        } else if (item.cx > centerX) {
            rightMoment += visualArea * (item.cx - centerX);
        }
    }

    const denominator = Math.max(leftMoment, rightMoment, 1e-6);
    return clamp01(1 - (Math.abs(leftMoment - rightMoment) / denominator));
}

function computeProportionalityScore(items: any[]): number {
    const goldenRatio = 1.618;
    const deviations = items.map((item: any) => {
        const ratio = Math.max(item.w / Math.max(item.h, 1), item.h / Math.max(item.w, 1));
        return Math.abs(ratio - goldenRatio);
    });
    const avgDeviation = deviations.reduce((sum: number, value: number) => sum + value, 0) / Math.max(deviations.length, 1);
    return clamp01(1 - avgDeviation);
}

function computeUniformityScore(items: any[], canvas: any): number {
    if (items.length <= 1) {
        return 1;
    }

    const horizontalGaps: number[] = [];
    const verticalGaps: number[] = [];

    for (const item of items) {
        let nearestRightGap: number | null = null;
        let nearestDownGap: number | null = null;

        for (const other of items) {
            if (other.index === item.index) continue;

            const verticalOverlap = Math.min(item.bottom, other.bottom) - Math.max(item.y, other.y);
            if (other.x >= item.right && verticalOverlap > 0) {
                const gap = other.x - item.right;
                if (nearestRightGap === null || gap < nearestRightGap) {
                    nearestRightGap = gap;
                }
            }

            const horizontalOverlap = Math.min(item.right, other.right) - Math.max(item.x, other.x);
            if (other.y >= item.bottom && horizontalOverlap > 0) {
                const gap = other.y - item.bottom;
                if (nearestDownGap === null || gap < nearestDownGap) {
                    nearestDownGap = gap;
                }
            }
        }

        if (nearestRightGap !== null) {
            horizontalGaps.push(nearestRightGap);
        }
        if (nearestDownGap !== null) {
            verticalGaps.push(nearestDownGap);
        }
    }

    if (horizontalGaps.length === 0 && verticalGaps.length === 0) {
        return 1;
    }

    const sigmaX = computeStandardDeviation(horizontalGaps);
    const sigmaY = computeStandardDeviation(verticalGaps);
    const parts = [sigmaX, sigmaY].filter((value) => Number.isFinite(value));
    const sigmaAvg = parts.reduce((sum, value) => sum + value, 0) / Math.max(parts.length, 1);
    const threshold = Math.max(canvas.width / 10, 1);
    return clamp01(1 - (sigmaAvg / threshold));
}

function computeSimplicityScore(widgetCount: number): number {
    if (widgetCount < 4) {
        return clamp01(1 - ((4 - widgetCount) / 4));
    }
    if (widgetCount <= 9) {
        return 1;
    }
    return clamp01(1 - ((widgetCount - 9) / 9));
}

function computeSequenceScore(items: any[]): number {
    if (items.length <= 1) {
        return 1;
    }

    const idealOrder = [...items]
        .sort((a: any, b: any) => a.y - b.y || a.x - b.x || a.index - b.index)
        .map((item: any) => item.index);
    const totalPairs = (idealOrder.length * (idealOrder.length - 1)) / 2;

    if (totalPairs === 0) {
        return 1;
    }

    let inversions = 0;
    for (let i = 0; i < idealOrder.length; i++) {
        for (let j = i + 1; j < idealOrder.length; j++) {
            if (idealOrder[i] > idealOrder[j]) {
                inversions += 1;
            }
        }
    }

    return clamp01(1 - (inversions / totalPairs));
}

function findOverlappingPairs(items: any[]) {
    const pairs: Array<{ left: string; right: string }> = [];
    for (let i = 0; i < items.length; i++) {
        for (let j = i + 1; j < items.length; j++) {
            const a = items[i];
            const b = items[j];
            const overlaps = a.x < b.right && a.right > b.x && a.y < b.bottom && a.bottom > b.y;
            if (overlaps) {
                pairs.push({ left: a.title, right: b.title });
            }
        }
    }
    return pairs;
}

function buildAestheticIssues(items: any[], canvas: any, rawScores: any, overlapPairs: Array<{ left: string; right: string }>) {
    const issues: any[] = [];
    const totalArea = items.reduce((sum: number, item: any) => sum + getVisualArea(item), 0);
    const fillRatio = totalArea / Math.max(canvas.area, 1);
    const singleValueAnalysis = analyzeSingleValuePanels(items);

    if (overlapPairs.length > 0) {
        issues.push({
            metric: 'layout',
            severity: 'high',
            reason: `检测到 ${overlapPairs.length} 组 panel 存在重叠，可能影响阅读和交互。`
        });
    }

    if (rawScores.density < 0.85) {
        issues.push({
            metric: 'density',
            severity: scoreToSeverity(rawScores.density),
            reason: fillRatio < 0.25
                ? `当前填充率约为 ${roundNumber(fillRatio * 100)}%，留白偏多，布局显得偏松。`
                : `当前填充率约为 ${roundNumber(fillRatio * 100)}%，组件偏挤，信息密度过高。`
        });
    }

    if (rawScores.symmetry < 0.85) {
        issues.push({
            metric: 'symmetry',
            severity: scoreToSeverity(rawScores.symmetry),
            reason: '左右区域的镜像关系较弱，面板在左右两侧的呼应不够明显。'
        });
    }

    if (rawScores.balance < 0.85) {
        issues.push({
            metric: 'balance',
            severity: scoreToSeverity(rawScores.balance),
            reason: '左右视觉重量分布不均衡，画面重心偏向单侧。'
        });
    }

    if (rawScores.proportionality < 0.85) {
        issues.push({
            metric: 'proportionality',
            severity: scoreToSeverity(rawScores.proportionality),
            reason: '部分面板长宽比差异较大，整体比例协调性不足。'
        });
    }

    if (rawScores.uniformity < 0.85) {
        issues.push({
            metric: 'uniformity',
            severity: scoreToSeverity(rawScores.uniformity),
            reason: '组件之间的水平或垂直间距不够统一，网格节奏不稳定。'
        });
    }

    if (rawScores.simplicity < 0.85) {
        issues.push({
            metric: 'simplicity',
            severity: scoreToSeverity(rawScores.simplicity),
            reason: items.length < 4
                ? `当前仅有 ${items.length} 个 panel，信息量偏少，层次表达可能不够完整。`
                : `当前共有 ${items.length} 个 panel，数量偏多，容易造成画面碎片化。`
        });
    }

    if (rawScores.sequence < 0.85) {
        issues.push({
            metric: 'sequence',
            severity: scoreToSeverity(rawScores.sequence),
            reason: '面板顺序与从左上到右下的阅读流不够一致，浏览路径不够自然。'
        });
    }

    if (singleValueAnalysis.tooSparse.length > 0) {
        issues.push({
            metric: 'content_fit',
            severity: scoreToSeverity(singleValueAnalysis.sparseScore),
            reason: `单值图 ${formatItemTitleList(singleValueAnalysis.tooSparse)} 的字号相对 panel 高度偏小，当前估算占比约为 ${roundNumber(singleValueAnalysis.minSparseRatio * 100)}%~${roundNumber(singleValueAnalysis.maxSparseRatio * 100)}%，大面积留白会稀释重点数值。`
        });
    }

    if (singleValueAnalysis.tooDense.length > 0) {
        issues.push({
            metric: 'content_fit',
            severity: scoreToSeverity(singleValueAnalysis.denseScore),
            reason: `单值图 ${formatItemTitleList(singleValueAnalysis.tooDense)} 的字号相对 panel 高度偏满，当前估算占比约为 ${roundNumber(singleValueAnalysis.minDenseRatio * 100)}%~${roundNumber(singleValueAnalysis.maxDenseRatio * 100)}%，容易挤占标题和工具栏的呼吸空间。`
        });
    }

    return issues;
}

function buildAestheticSuggestions(items: any[], rawScores: any, overlapPairs: Array<{ left: string; right: string }>) {
    const suggestions: any[] = [];
    const singleValueAnalysis = analyzeSingleValuePanels(items);

    if (overlapPairs.length > 0) {
        suggestions.push({
            category: 'layout',
            priority: 'high',
            message: '先消除面板重叠，再进行其他美化调整，避免遮挡和点击冲突。'
        });
    }

    if (rawScores.density < 0.85) {
        suggestions.push({
            category: 'layout',
            priority: scoreToPriority(rawScores.density),
            message: rawScores.density < 0.5
                ? '优先重新分配画布空间：减少过度留白或缓解组件拥挤，让填充率回到舒适区间。'
                : '微调面板尺寸和留白，让画面疏密更均衡。'
        });
    }

    if (rawScores.balance < 0.85 || rawScores.symmetry < 0.85) {
        suggestions.push({
            category: 'layout',
            priority: scoreToPriority(Math.min(rawScores.balance, rawScores.symmetry)),
            message: '尝试让左右两侧的组件面积和位置更对称，避免核心视觉重量过度集中在单侧。'
        });
    }

    if (rawScores.uniformity < 0.85) {
        suggestions.push({
            category: 'layout',
            priority: scoreToPriority(rawScores.uniformity),
            message: '统一相邻卡片的间距、宽度和高度，尽量让同层级组件使用稳定的网格节奏。'
        });
    }

    if (rawScores.proportionality < 0.85) {
        suggestions.push({
            category: 'layout',
            priority: scoreToPriority(rawScores.proportionality),
            message: '减少过扁或过高的面板，优先复用接近统一比例的卡片尺寸。'
        });
    }

    if (rawScores.simplicity < 0.85) {
        suggestions.push({
            category: 'layout',
            priority: scoreToPriority(rawScores.simplicity),
            message: items.length > 9
                ? '合并零散小面板，减少首屏碎片化信息。'
                : '适当增加辅助面板或放大核心面板，增强层次表达。'
        });
    }

    if (rawScores.sequence < 0.85) {
        suggestions.push({
            category: 'layout',
            priority: scoreToPriority(rawScores.sequence),
            message: '按“左上到右下”的阅读流重新排序面板，把最重要的内容放在左上或首屏。'
        });
    }

    if (singleValueAnalysis.tooSparse.length > 0) {
        suggestions.push({
            category: 'layout',
            priority: scoreToPriority(singleValueAnalysis.sparseScore),
            message: '单值图优先让字号占可用高度的约 22%~38%；若明显偏空，优先放大字号，或把 panel 高度从当前 h 适当收紧。'
        });
    }

    if (singleValueAnalysis.tooDense.length > 0) {
        suggestions.push({
            category: 'layout',
            priority: scoreToPriority(singleValueAnalysis.denseScore),
            message: '单值图若字号占可用高度超过约 48%，建议降低字号或增大 panel 高度，避免数值与标题、工具栏争抢空间。'
        });
    }

    if (suggestions.length === 0) {
        suggestions.push({
            category: 'layout',
            priority: 'low',
            message: '当前布局整体较稳定，可在保持网格结构的前提下微调关键面板的面积与位置。'
        });
    }

    return deduplicateSuggestions(suggestions);
}

function deduplicateSuggestions(suggestions: any[]) {
    const seen = new Set<string>();
    return suggestions.filter((suggestion) => {
        const key = `${suggestion.category}|${suggestion.priority}|${suggestion.message}`;
        if (seen.has(key)) {
            return false;
        }
        seen.add(key);
        return true;
    });
}

function computeStandardDeviation(values: number[]): number {
    if (!Array.isArray(values) || values.length <= 1) {
        return 0;
    }

    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    const variance = values.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / (values.length - 1);
    return Math.sqrt(variance);
}

function getSingleValueFontSize(widget: any): number {
    const candidates = [
        widget?.chart?.singleChartFontSize,
        widget?.chart?.singleUnitFontSize,
        widget?.chart?.fontSize,
        widget?.chart?.size,
        widget?.searchData?.fontSize,
        widget?.searchData?.singleFontSize,
        widget?.searchData?.singleValueFontSize,
        widget?.searchData?.valueFontSize,
        widget?.searchData?.numberFontSize,
        widget?.searchData?.chartFontSize,
        widget?.searchData?.textStyle?.fontSize,
        widget?.searchData?.style?.fontSize,
        widget?.fontSize
    ];

    for (const candidate of candidates) {
        const parsed = parsePositiveNumber(candidate);
        if (parsed !== null) {
            return parsed;
        }
    }

    return DEFAULT_SINGLE_FONT_SIZE_PX;
}

function parsePositiveNumber(value: any): number | null {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
        return value;
    }
    if (typeof value === 'string') {
        const match = value.trim().match(/^(\d+(?:\.\d+)?)/);
        if (match) {
            const parsed = Number(match[1]);
            if (Number.isFinite(parsed) && parsed > 0) {
                return parsed;
            }
        }
    }
    return null;
}

function estimateSingleValueHeightRatio(gridHeight: number, fontSizePx: number): number {
    const contentHeightPx = (DEFAULT_SINGLE_GRID_PX_PER_H * Math.max(gridHeight, 1)) - DEFAULT_SINGLE_HEADER_CHROME_PX;
    if (contentHeightPx <= 0) {
        return 1;
    }
    return clamp01(fontSizePx / contentHeightPx);
}

function getVisualArea(item: any): number {
    const effectiveArea = Number(item?.effectiveArea);
    if (Number.isFinite(effectiveArea) && effectiveArea > 0) {
        return effectiveArea;
    }
    return Number(item?.area) || 0;
}

function analyzeSingleValuePanels(items: any[]) {
    const singleItems = items.filter((item: any) => item.chartType === 'single' && Number.isFinite(item.singleValueHeightRatio));
    const tooSparse = singleItems.filter((item: any) => item.singleValueHeightRatio < SINGLE_HEIGHT_RATIO_COMFORT_MIN);
    const tooDense = singleItems.filter((item: any) => item.singleValueHeightRatio > SINGLE_HEIGHT_RATIO_ACCEPTABLE_MAX);

    return {
        tooSparse,
        tooDense,
        sparseScore: tooSparse.length > 0
            ? average(tooSparse.map((item: any) => clamp01(item.singleValueHeightRatio / SINGLE_HEIGHT_RATIO_COMFORT_MIN)))
            : 1,
        denseScore: tooDense.length > 0
            ? average(tooDense.map((item: any) => clamp01(1 - ((item.singleValueHeightRatio - SINGLE_HEIGHT_RATIO_ACCEPTABLE_MAX) / Math.max(1 - SINGLE_HEIGHT_RATIO_ACCEPTABLE_MAX, 1e-6)))))
            : 1,
        minSparseRatio: tooSparse.length > 0 ? Math.min(...tooSparse.map((item: any) => item.singleValueHeightRatio)) : 0,
        maxSparseRatio: tooSparse.length > 0 ? Math.max(...tooSparse.map((item: any) => item.singleValueHeightRatio)) : 0,
        minDenseRatio: tooDense.length > 0 ? Math.min(...tooDense.map((item: any) => item.singleValueHeightRatio)) : 0,
        maxDenseRatio: tooDense.length > 0 ? Math.max(...tooDense.map((item: any) => item.singleValueHeightRatio)) : 0
    };
}

function average(values: number[]): number {
    if (!Array.isArray(values) || values.length === 0) {
        return 0;
    }
    return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function formatItemTitleList(items: any[]): string {
    const titles = items
        .map((item: any) => item.title)
        .filter((title: string) => typeof title === 'string' && title.trim().length > 0)
        .slice(0, 3);
    if (titles.length === 0) {
        return '部分单值图';
    }
    if (items.length > 3) {
        return `${titles.join('、')} 等 ${items.length} 个 panel`;
    }
    return titles.join('、');
}

function scoreToSeverity(score: number): Severity {
    if (score < 0.5) {
        return 'high';
    }
    if (score < 0.7) {
        return 'medium';
    }
    return 'low';
}

function scoreToPriority(score: number): Severity {
    if (score < 0.5) {
        return 'high';
    }
    if (score < 0.7) {
        return 'medium';
    }
    return 'low';
}

function toPercentageScore(score: number): number {
    return roundNumber(clamp01(score) * 100);
}

function clamp01(value: number): number {
    if (!Number.isFinite(value)) {
        return 0;
    }
    return Math.min(1, Math.max(0, value));
}

function roundNumber(value: number): number {
    return Math.round(value * 100) / 100;
}
