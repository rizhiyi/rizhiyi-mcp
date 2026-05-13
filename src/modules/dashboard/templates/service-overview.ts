import { buildTemplateRuntimeContext } from './shared.js';
import type { DashboardTemplateBuilder } from './types.js';

export const buildServiceOverviewTemplate: DashboardTemplateBuilder = (name, context, options) => {
    const { scopedQuery, timeRange, hostField } = buildTemplateRuntimeContext(context);

    return {
        name,
        ...options,
        tabs: [{
            name: '总览',
            panels: [
                { title: '服务请求趋势', type: 'trend', query: scopedQuery, time_range: timeRange },
                { title: '主机分布', type: 'trend', query: `${scopedQuery} | stats count() by ${hostField}`, time_range: timeRange, chartType: 'table' }
            ]
        }]
    };
};
