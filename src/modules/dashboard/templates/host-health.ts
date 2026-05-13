import { buildTemplateRuntimeContext } from './shared.js';
import type { DashboardTemplateBuilder } from './types.js';

export const buildHostHealthTemplate: DashboardTemplateBuilder = (name, context, options) => {
    const { scopedQuery, timeRange, hostField } = buildTemplateRuntimeContext(context);

    return {
        name,
        ...options,
        tabs: [{
            name: '主机健康',
            panels: [
                { title: '主机日志趋势', type: 'trend', query: scopedQuery, time_range: timeRange },
                { title: '主机日志量 TopN', type: 'trend', query: `${scopedQuery} | stats count() by ${hostField}`, time_range: timeRange, chartType: 'table' }
            ]
        }]
    };
};
