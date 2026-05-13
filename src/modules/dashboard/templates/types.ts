export type DashboardTemplateContext = {
    query?: string;
    time_range?: string;
    appname?: string;
    host_field?: string;
};

export type DashboardTemplateOptions = {
    app_id?: number;
    data_user?: string;
    export?: string;
};

export type DashboardTemplateSpec = {
    name: string;
    app_id?: number;
    data_user?: string;
    export?: string;
    tabs: Array<{
        name: string;
        panels: Array<Record<string, unknown>>;
    }>;
};

export type DashboardTemplateBuilder = (
    name: string,
    context: DashboardTemplateContext,
    options: DashboardTemplateOptions
) => DashboardTemplateSpec;
