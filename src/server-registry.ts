import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ServerContext } from './config.js';
import { createDashboardServer } from './dashboard-server.js';
import { createFieldConfigServer } from './fieldconfig-server.js';
import { createLogToolsServer } from './log-tools-server.js';
import { createManageServer } from './manage-server.js';
import { createOpenapiServer } from './openapi_server.js';
import { createParserRuleServer } from './parserrule-server.js';

export type ServerFactory = (context: ServerContext) => Promise<McpServer> | McpServer;

export const serverRegistry: Record<string, ServerFactory> = {
    'log-tools': createLogToolsServer,
    manage: createManageServer,
    dashboard: createDashboardServer,
    parserrule: createParserRuleServer,
    fieldconfig: createFieldConfigServer,
    openapi: createOpenapiServer
};
