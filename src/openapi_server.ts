import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Converter } from 'openapi2mcptools';
import * as fs from 'fs';
import * as yaml from 'js-yaml';
import axios from 'axios';

import { isExecutedDirectly } from './runtime-entry.js';
import { createHttpClientConfig, createServerContextForStdio, type ServerContext } from './config.js';
import { registerToolDefinitions } from './mcp-tool-helpers.js';
import { buildToolSuccessResult } from './result-formatter.js';
import type { ToolDefinition } from './types.js';

const yamlContent = fs.readFileSync(new URL('../config/Api_5.3_schema.yaml', import.meta.url), 'utf8');
const rzySpecs = yaml.load(yamlContent);

export async function createOpenapiServer(context: ServerContext): Promise<McpServer> {
  const httpClientConfig = createHttpClientConfig(context);
  const httpClient = axios.create({
    baseURL: httpClientConfig.baseURL,
    headers: httpClientConfig.headers,
    httpsAgent: httpClientConfig.httpsAgent,
  });
  const converter = new Converter({ httpClient });
  await converter.load(rzySpecs);

  const tools = converter.getToolsList();
  const toolCaller = converter.getToolsCaller();

  const server = new McpServer(
    {
      name: 'rizhiyi',
      version: '1.0.0',
    },
  );

  registerToolDefinitions(server, tools as ToolDefinition[], Object.fromEntries(
    (tools as ToolDefinition[]).map((tool) => [
      tool.name,
      async (parameters: Record<string, unknown>) => {
        const result = await toolCaller({
          params: {
            name: tool.name,
            arguments: parameters,
          }
        } as any);

        if (result?.isError) {
          return result;
        }

        const payload = typeof result?.toolResult === 'undefined' ? result : result.toolResult;
        return buildToolSuccessResult(tool.name, payload);
      }
    ])
  ));

  return server;
}

async function startServer(): Promise<void> {
  const server = await createOpenapiServer(createServerContextForStdio());
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

if (isExecutedDirectly(import.meta.url)) {
  startServer().catch((error) => {
    console.error('启动 OpenAPI MCP 服务器失败:', error);
    process.exit(1);
  });
}
