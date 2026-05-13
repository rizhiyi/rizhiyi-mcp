import { buildTemplateRuntimeContext } from './shared.js';
import type { DashboardTemplateBuilder } from './types.js';

export const buildTrafficTrendTemplate: DashboardTemplateBuilder = (name, context, options) => {
    const { scopedQuery, timeRange } = buildTemplateRuntimeContext(context);

    return {
        name,
        ...options,
        tabs: [{
            name: '流量趋势',
            panels: [
                { title: '访问趋势', type: 'trend', query: scopedQuery, time_range: timeRange },
                { title: '访问来源分布', type: 'trend', query: `${scopedQuery} | stats count() by source`, time_range: timeRange, chartType: 'table' }
            ]
        }]
    };
};
