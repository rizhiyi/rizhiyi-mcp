import {
    buildLegacyDefaultGrid,
    normalizePanelKind
} from './panel-utils.js';

function toGridRect(grid: any): { x: number; y: number; w: number; h: number } {
    return {
        x: Number.isFinite(grid?.x) ? Number(grid.x) : 0,
        y: Number.isFinite(grid?.y) ? Number(grid.y) : 0,
        w: Number.isFinite(grid?.w) && Number(grid.w) > 0 ? Number(grid.w) : 6,
        h: Number.isFinite(grid?.h) && Number(grid.h) > 0 ? Number(grid.h) : 5
    };
}

function hasGridOverlap(candidate: { x: number; y: number; w: number; h: number }, occupied: Array<{ x: number; y: number; w: number; h: number }>): boolean {
    return occupied.some((item) => (
        candidate.x < item.x + item.w
        && candidate.x + candidate.w > item.x
        && candidate.y < item.y + item.h
        && candidate.y + candidate.h > item.y
    ));
}

function getPanelLayoutFamily(panel: any): 'single' | 'table' | 'trend' {
    const normalized = normalizePanelKind(panel?.type || panel?.panel_type || 'trend', panel?.chartType);
    if (normalized.type === 'eventsTable' || normalized.chartType === 'table' || normalized.chartType === 'eventsTable') {
        return 'table';
    }
    if (normalized.chartType === 'single') {
        return 'single';
    }
    return 'trend';
}

function getPreferredGridSize(
    panel: any,
    role: 'main' | 'secondary' | 'remainder'
): { w: number; h: number } {
    const family = getPanelLayoutFamily(panel);
    if (role === 'main') {
        if (family === 'single') {
            return { w: 6, h: 4 };
        }
        if (family === 'table') {
            return { w: 8, h: 6 };
        }
        return { w: 8, h: 6 };
    }

    if (family === 'single') {
        return { w: 4, h: 3 };
    }
    if (family === 'table') {
        return role === 'remainder'
            ? { w: 6, h: 5 }
            : { w: 5, h: 5 };
    }
    return role === 'remainder'
        ? { w: 4, h: 4 }
        : { w: 5, h: 6 };
}

function fitPanelIntoSlot(
    slot: { x: number; y: number; w: number; h: number },
    panel: any,
    role: 'main' | 'secondary'
): { x: number; y: number; w: number; h: number } {
    const preferred = getPreferredGridSize(panel, role);
    return {
        x: slot.x,
        y: slot.y,
        w: Math.max(1, Math.min(slot.w, preferred.w)),
        h: Math.max(2, Math.min(slot.h, preferred.h))
    };
}

function buildGridSizeCandidates(preferred: { w: number; h: number }): Array<{ w: number; h: number }> {
    const candidates = [
        preferred,
        { w: Math.min(6, Math.max(4, preferred.w)), h: Math.max(4, preferred.h) },
        { w: 6, h: 4 },
        { w: 4, h: 4 }
    ];
    const unique = new Set<string>();

    return candidates.filter((candidate) => {
        const normalized = {
            w: Math.min(12, Math.max(1, Math.round(candidate.w))),
            h: Math.max(2, Math.round(candidate.h))
        };
        const key = `${normalized.w}x${normalized.h}`;
        if (unique.has(key)) {
            return false;
        }
        unique.add(key);
        Object.assign(candidate, normalized);
        return true;
    });
}

function getSidebarSplitHeight(panel: any): number {
    const family = getPanelLayoutFamily(panel);
    if (family === 'single') {
        return 2;
    }
    if (family === 'table') {
        return 4;
    }
    return 3;
}

function buildTwoPanelDefaultGrids(panels: any[]): Array<{ x: number; y: number; w: number; h: number }> {
    const primary = panels[0];
    const secondary = panels[1];
    const secondarySize = getPreferredGridSize(secondary, 'secondary');
    const secondaryWidth = Math.min(6, Math.max(4, secondarySize.w));
    const primarySlot = { x: 0, y: 0, w: 12 - secondaryWidth, h: 6 };
    const secondarySlot = { x: 12 - secondaryWidth, y: 0, w: secondaryWidth, h: 6 };

    return [
        fitPanelIntoSlot(primarySlot, primary, 'main'),
        fitPanelIntoSlot(secondarySlot, secondary, 'secondary')
    ];
}

function buildThreePanelDefaultGrids(panels: any[]): Array<{ x: number; y: number; w: number; h: number }> {
    const sidebarHeight = getSidebarSplitHeight(panels[1]);
    const topHeight = 6;
    const bottomHeight = Math.max(2, topHeight - sidebarHeight);
    const topSlot = { x: 8, y: 0, w: 4, h: topHeight - bottomHeight };
    const bottomSlot = { x: 8, y: topSlot.h, w: 4, h: bottomHeight };

    return [
        fitPanelIntoSlot({ x: 0, y: 0, w: 8, h: 6 }, panels[0], 'main'),
        fitPanelIntoSlot(topSlot, panels[1], 'secondary'),
        fitPanelIntoSlot(bottomSlot, panels[2], 'secondary')
    ];
}

function buildDefaultGridsForPanels(panels: any[]): Array<{ x: number; y: number; w: number; h: number }> {
    if (panels.length === 0) {
        return [];
    }

    if (panels.length === 1) {
        return [fitPanelIntoSlot({ x: 0, y: 0, w: 12, h: 6 }, panels[0], 'main')];
    }

    if (panels.length === 2) {
        return buildTwoPanelDefaultGrids(panels);
    }

    if (panels.length === 3) {
        return buildThreePanelDefaultGrids(panels);
    }

    const grids = buildThreePanelDefaultGrids(panels.slice(0, 3));
    const occupied = grids.map((grid) => toGridRect(grid));
    const startY = occupied.reduce((max: number, item: any) => Math.max(max, item.y + item.h), 0);
    for (let index = 3; index < panels.length; index++) {
        const grid = buildGridForAdditionalPanel(panels[index], occupied, { startY });
        occupied.push(grid);
        grids.push(grid);
    }
    return grids;
}

export function buildGridForAdditionalPanel(
    panel: any,
    occupiedSource: Array<any>,
    options: { startY?: number } = {}
): { x: number; y: number; w: number; h: number } {
    const { startY = 0 } = options;
    const occupied = occupiedSource.map((item) => toGridRect(item));
    const preferred = getPreferredGridSize(panel, 'remainder');
    const maxBottom = occupied.reduce((max: number, item: any) => Math.max(max, item.y + item.h), 0);
    const candidates = buildGridSizeCandidates(preferred);

    for (const candidate of candidates) {
        for (let y = startY; y <= maxBottom + 24; y++) {
            for (let x = 0; x <= 12 - candidate.w; x++) {
                const nextRect = { x, y, w: candidate.w, h: candidate.h };
                if (!hasGridOverlap(nextRect, occupied)) {
                    return nextRect;
                }
            }
        }
    }

    return buildLegacyDefaultGrid(occupied.length);
}

export function assignDefaultLayoutToPanels(panels: any[]): any[] {
    const nextPanels = panels.map((panel) => ({
        ...panel,
        grid: panel?.grid ? { ...panel.grid } : undefined
    }));
    const missingIndexes = nextPanels
        .map((panel, index) => panel?.grid ? -1 : index)
        .filter((index) => index >= 0);

    if (missingIndexes.length === 0) {
        return nextPanels;
    }

    const positionedPanels = nextPanels.filter((panel) => panel?.grid);
    if (positionedPanels.length === 0) {
        const generatedGrids = buildDefaultGridsForPanels(missingIndexes.map((index) => nextPanels[index]));
        missingIndexes.forEach((panelIndex, generatedIndex) => {
            nextPanels[panelIndex] = {
                ...nextPanels[panelIndex],
                grid: generatedGrids[generatedIndex]
            };
        });
        return nextPanels;
    }

    const occupied = positionedPanels.map((panel) => toGridRect(panel.grid));
    for (const panelIndex of missingIndexes) {
        const grid = buildGridForAdditionalPanel(nextPanels[panelIndex], occupied);
        occupied.push(grid);
        nextPanels[panelIndex] = {
            ...nextPanels[panelIndex],
            grid
        };
    }

    return nextPanels;
}

export function applyLayoutStrategy(widgets: any[], strategy: string): any[] {
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
