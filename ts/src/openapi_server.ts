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

const yamlContent = fs.readFileSync(new URL('../../config/Api_5.3_schema.yaml', import.meta.url), 'utf8');
const rzySpecs = yaml.load(yamlContent);

/**
 * OpenAPI spec 的解析结果：dereference 后的 schema + 已解析的 API 表。
 *
 * 这两者只由 config/Api_5.3_schema.yaml 的内容决定，**不包含任何调用身份**：
 * 没有 Authorization / baseURL / ServerContext，也没有绑定 session 的 handler 闭包。
 * 因此可以在进程内缓存、跨 session 共享，避免每个 session 都重新解析约 4 万行 spec。
 *
 * 与之相对，下面的 axios httpClient、`new Converter({ httpClient })` 以及
 * `converter.getToolsCaller()` 返回的闭包都携带 per-session 的认证信息，
 * 必须每个 session 各自创建，绝不能复用。
 */
interface ParsedOpenapiSpec {
  specs: Converter['specs'];
  apis: Converter['apis'];
}

let parsedSpecPromise: Promise<ParsedOpenapiSpec> | undefined;
let specLoadCount = 0;

/**
 * 进程级一次性解析 spec。
 *
 * 缓存的是 memoized **Promise** 而非值：并发 initialize 会共享同一个进行中的
 * 解析任务，避免 cache stampede。解析失败时清空缓存，允许后续调用重试，
 * 避免一次瞬时失败把 rejected promise 永久缓存住。
 */
function loadParsedSpec(): Promise<ParsedOpenapiSpec> {
  if (!parsedSpecPromise) {
    specLoadCount += 1;
    parsedSpecPromise = (async () => {
      // 这个 Converter 仅用于解析 spec（身份无关），其 httpClient 不会被使用。
      const parser = new Converter();
      await parser.load(rzySpecs);
      return { specs: parser.specs, apis: parser.apis };
    })().catch((error) => {
      parsedSpecPromise = undefined;
      throw error;
    });
  }

  return parsedSpecPromise;
}

/** 仅供验证脚本使用：返回本进程内 OpenAPI spec 的解析次数。 */
export function getOpenapiSpecLoadCount(): number {
  return specLoadCount;
}

/**
 * @deprecated The TypeScript OpenAPI bridge is not supported in new deployments.
 * Use the Python HTTP `openapi` route instead. The third-party converter emits
 * invalid JSON Schema for part of the bundled spec and fails during registration.
 */
export async function createOpenapiServer(context: ServerContext): Promise<McpServer> {
  const httpClientConfig = createHttpClientConfig(context);
  const httpClient = axios.create({
    baseURL: httpClientConfig.baseURL,
    headers: httpClientConfig.headers,
    httpsAgent: httpClientConfig.httpsAgent,
    timeout: httpClientConfig.timeoutMs,
  });

  // 复用进程级解析结果（身份无关），跳过每个 session 重复的 dereference 开销。
  const { specs, apis } = await loadParsedSpec();

  // Converter 与 httpClient 都是 per-session 的：认证信息隔离在当前 session 内。
  // 只把身份无关的 specs / apis 注入进来，getToolsCaller() 的闭包仍绑定本 session 的 httpClient。
  const converter = new Converter({ httpClient });
  converter.specs = specs;
  converter.apis = apis;

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
  ), context);

  return server;
}

async function startServer(): Promise<void> {
  const server = await createOpenapiServer(createServerContextForStdio(process.env, 'openapi'));
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

if (isExecutedDirectly(import.meta.url)) {
  startServer().catch((error) => {
    console.error('启动 OpenAPI MCP 服务器失败:', error);
    process.exit(1);
  });
}
