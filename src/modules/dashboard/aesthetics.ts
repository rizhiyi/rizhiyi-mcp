import { getWidgetId, getWidgetTitle } from './panel-utils.js';

type Severity = 'high' | 'medium' | 'low';

export function buildAestheticsAnalysis(widgets: any[]) {
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
            area
        };
    });
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
    const totalArea = items.reduce((sum: number, item: any) => sum + item.area, 0);
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
        if (item.cx < centerX) {
            leftMoment += item.area * (centerX - item.cx);
        } else if (item.cx > centerX) {
            rightMoment += item.area * (item.cx - centerX);
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
    const totalArea = items.reduce((sum: number, item: any) => sum + item.area, 0);
    const fillRatio = totalArea / Math.max(canvas.area, 1);

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

    return issues;
}

function buildAestheticSuggestions(items: any[], rawScores: any, overlapPairs: Array<{ left: string; right: string }>) {
    const suggestions: any[] = [];

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
