import type { DashboardTemplateContext } from './types.js';

export type TemplateRuntimeContext = {
    query: string;
    timeRange: string;
    appname?: string;
    hostField: string;
    scopedQuery: string;
};

export function buildTemplateRuntimeContext(context: DashboardTemplateContext = {}): TemplateRuntimeContext {
    const query = context.query || '*';
    const timeRange = context.time_range || '-1h,now';
    const appname = context.appname;
    const hostField = context.host_field || 'hostname';

    return {
        query,
        timeRange,
        appname,
        hostField,
        scopedQuery: appname ? `appname:${appname}` : query
    };
}
