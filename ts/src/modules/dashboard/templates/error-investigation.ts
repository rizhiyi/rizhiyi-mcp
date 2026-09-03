import { buildTemplateRuntimeContext } from './shared.js';
import type { DashboardTemplateBuilder } from './types.js';

export const buildErrorInvestigationTemplate: DashboardTemplateBuilder = (name, context, options) => {
    const { scopedQuery, timeRange, hostField } = buildTemplateRuntimeContext(context);

    return {
        name,
        ...options,
        tabs: [{
            name: '错误排查',
            panels: [
                { title: '错误趋势', type: 'trend', query: `${scopedQuery} AND status:error`, time_range: timeRange },
                { title: '错误主机 TopN', type: 'trend', query: `${scopedQuery} AND status:error | stats count() by ${hostField}`, time_range: timeRange, chartType: 'table' }
            ]
        }]
    };
};
