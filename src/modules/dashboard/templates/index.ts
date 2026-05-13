import { buildErrorInvestigationTemplate } from './error-investigation.js';
import { buildHostHealthTemplate } from './host-health.js';
import { buildServiceOverviewTemplate } from './service-overview.js';
import { buildTrafficTrendTemplate } from './traffic-trend.js';
import type {
    DashboardTemplateBuilder,
    DashboardTemplateContext,
    DashboardTemplateOptions,
    DashboardTemplateSpec
} from './types.js';

const templateRegistry: Record<string, DashboardTemplateBuilder> = {
    service_overview: buildServiceOverviewTemplate,
    error_investigation: buildErrorInvestigationTemplate,
    traffic_trend: buildTrafficTrendTemplate,
    host_health: buildHostHealthTemplate
};

export function buildDashboardTemplateSpec(
    template: string,
    name: string,
    context: DashboardTemplateContext = {},
    options: DashboardTemplateOptions = {}
): DashboardTemplateSpec | null {
    const builder = templateRegistry[template];
    if (!builder) {
        return null;
    }

    return builder(name, context, options);
}
