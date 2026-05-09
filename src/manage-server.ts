import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import * as fs from 'fs';
import * as yaml from 'js-yaml';
import axios from 'axios';
import https from 'https';
import dotenv from 'dotenv';

import { formatErrorPayload, formatSuccessPayload } from './result-formatter.js';

dotenv.config({ path: ['.env.local', '.env'] });

const baseURL = process.env.LOGEASE_BASE_URL ?? 'http://127.0.0.1:8090';
const authHeader = process.env.LOGEASE_AUTH_HEADER || (process.env.LOGEASE_API_KEY ? `apikey ${process.env.LOGEASE_API_KEY}` : undefined);
const rejectUnauthorizedEnv = process.env.LOGEASE_TLS_REJECT_UNAUTHORIZED;
const rejectUnauthorized = typeof rejectUnauthorizedEnv !== 'undefined' ? rejectUnauthorizedEnv === 'true' : false;

if (!process.env.LOGEASE_BASE_URL) {
  console.warn('LOGEASE_BASE_URL 未设置，默认使用 http://127.0.0.1:8090');
}
if (!authHeader) {
  console.warn('未检测到认证信息（LOGEASE_AUTH_HEADER 或 LOGEASE_API_KEY），与服务交互可能失败');
}

const httpClient = axios.create({
  baseURL,
  headers: authHeader ? { Authorization: authHeader } : {},
  httpsAgent: new https.Agent({ rejectUnauthorized }),
});

const EXCLUDED_MODULE_SERVER_MAP: Record<string, string> = {
  agent: 'rizhiyi_agent_config',
  alerts: 'rizhiyi_alert',
  parserrules: 'rizhiyi_parserule',
  dashboard: 'rizhiyi_dashboard',
  dashboards: 'rizhiyi_dashboard',
};

const MANAGE_SERVER_INSTRUCTIONS = `使用说明:
1. 这是通用管理入口，只适合简单查询、列表、详情和低复杂度 CRUD。
2. 遇到 agent、alerts、parserrules、dashboard 这类复杂 JSON body 配置类能力时，请改用专用 MCP 服务器。
3. 推荐流程：先 select_module，再 select_api_from_module，最后 gencode_callapi。
4. 输出默认使用 output_format=auto，避免把大段 JSON 直接塞给 Agent。
5. 遇到错误时，优先根据 suggestion 字段修正参数后重试一次。`;

const yamlContent = fs.readFileSync(new URL('../config/Api_5.3_schema_mini.yaml', import.meta.url), 'utf8');
const fullSpecs = yaml.load(yamlContent) as Record<string, any>;
const manageSpecs = filterManageSpecs(fullSpecs);

function getPrimaryTag(operation: any): string | undefined {
  const tags = operation?.tags || [];
  return tags.length > 0 ? tags[0] : undefined;
}

function isExcludedTag(tag: string | undefined): boolean {
  return !!tag && Object.prototype.hasOwnProperty.call(EXCLUDED_MODULE_SERVER_MAP, tag);
}

function filterManageSpecs(specs: Record<string, any>): Record<string, any> {
  const filteredPaths: Record<string, any> = {};
  const paths = specs.paths || {};

  for (const apiPath of Object.keys(paths)) {
    const pathObj = paths[apiPath];
    const filteredMethods: Record<string, any> = {};

    for (const method of Object.keys(pathObj)) {
      const operation = pathObj[method];
      const tag = getPrimaryTag(operation);
      if (!isExcludedTag(tag)) {
        filteredMethods[method] = operation;
      }
    }

    if (Object.keys(filteredMethods).length > 0) {
      filteredPaths[apiPath] = filteredMethods;
    }
  }

  return {
    ...specs,
    paths: filteredPaths,
  };
}

function extractModules(specs: Record<string, any>) {
  const modules: Record<string, any> = {};
  const paths = specs.paths || {};

  for (const apiPath of Object.keys(paths)) {
    const pathObj = paths[apiPath];
    for (const method of Object.keys(pathObj)) {
      const operation = pathObj[method];
      const mainTag = getPrimaryTag(operation);

      if (!mainTag) continue;

      if (!Object.prototype.hasOwnProperty.call(modules, mainTag)) {
        modules[mainTag] = {
          name: mainTag,
          description: operation.summary || mainTag,
          apis: [],
        };
      }

      if (!modules[mainTag].apis.some((api: any) => api.path === apiPath && api.method === method)) {
        modules[mainTag].apis.push({
          path: apiPath,
          method,
          summary: operation.summary || '',
          description: operation.description || '',
          parameters: operation.parameters || [],
          requestBody: operation.requestBody || null,
          responses: operation.responses || {},
        });
      }
    }
  }

  return Object.values(modules);
}

function getApisFromModule(specs: Record<string, any>, moduleName: string) {
  const modules = extractModules(specs);
  return modules.find((m: any) => m.name === moduleName)?.apis || [];
}

function getOperation(full: Record<string, any>, apiPath: string, apiMethod: string): any {
  return full?.paths?.[apiPath]?.[apiMethod.toLowerCase()];
}

function buildManageToolError(errorCode: string, message: string, suggestion: string, details?: unknown) {
  return {
    isError: true,
    content: [{
      type: 'text',
      text: formatErrorPayload({
        error_code: errorCode,
        message,
        suggestion,
        retryable: true,
        details
      })
    }]
  };
}

function formatManageSuccess(data: unknown, parameters: Record<string, any> = {}) {
  return {
    content: [{
      type: 'text',
      text: formatSuccessPayload(data, {
        outputFormat: parameters.output_format,
        includeRawJson: parameters.include_raw_json
      })
    }]
  };
}

async function generateAndExecuteApiCall(apiPath: string, apiMethod: string, params: Record<string, any>) {
  try {
    const operation = getOperation(fullSpecs, apiPath, apiMethod);
    if (!operation) {
      return {
        error_code: 'API_NOT_FOUND',
        message: `API path ${apiPath} 或方法 ${apiMethod} 不存在。`,
        suggestion: '请先调用 select_api_from_module 确认 API 路径和 HTTP 方法。'
      };
    }

    const tag = getPrimaryTag(operation);
    if (isExcludedTag(tag)) {
      return {
        error_code: 'USE_DEDICATED_SERVER',
        message: `模块 ${tag} 已从 manage 入口排除。`,
        suggestion: `该能力属于复杂配置场景，请改用专用 MCP 服务器 ${EXCLUDED_MODULE_SERVER_MAP[tag!] || '对应专用入口'}。`
      };
    }

    let url = apiPath;
    const queryParams: Record<string, any> = {};
    const bodyParams: Record<string, any> = {};

    if (operation.parameters) {
      for (const param of operation.parameters) {
        if (param.in === 'path' && Object.prototype.hasOwnProperty.call(params, param.name)) {
          url = url.replace(`{${param.name}}`, String(params[param.name]));
        } else if (param.in === 'query' && Object.prototype.hasOwnProperty.call(params, param.name)) {
          queryParams[param.name] = params[param.name];
        }
      }
    }

    if (operation.requestBody && params.body) {
      Object.assign(bodyParams, params.body);
    }

    const response = await httpClient({
      method: apiMethod.toLowerCase(),
      url,
      params: queryParams,
      data: Object.keys(bodyParams).length > 0 ? bodyParams : undefined
    });

    return {
      status: response.status,
      data: response.data
    };
  } catch (error: any) {
    return {
      error_code: error?.code === 'ECONNRESET' || String(error?.message || '').includes('socket hang up')
        ? 'UPSTREAM_CONNECTION_RESET'
        : 'UPSTREAM_REQUEST_FAILED',
      message: `请求失败: ${error.message}`,
      suggestion: '请检查上游日志易服务地址、认证信息和 API 参数；若是复杂配置类接口，请确认是否走错了 manage 入口。',
      details: error.response?.data || null
    };
  }
}

const tools = [
  {
    name: 'select_module',
    description: '列出适合通用管理入口的模块；复杂配置类模块已被自动排除。',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: '可选，按模块名或描述做简单过滤'
        },
        output_format: {
          type: 'string',
          description: '输出格式，默认 auto',
          default: 'auto',
          enum: ['auto', 'yaml', 'csv', 'json']
        },
        include_raw_json: {
          type: 'boolean',
          description: '是否附带原始 JSON',
          default: false
        }
      }
    }
  },
  {
    name: 'select_api_from_module',
    description: '从指定的通用管理模块中列出可用 API；若模块被专用 server 接管，将返回迁移建议。',
    inputSchema: {
      type: 'object',
      properties: {
        module_name: {
          type: 'string',
          description: '模块名称'
        },
        query: {
          type: 'string',
          description: '可选，按 API summary 或 path 过滤'
        },
        output_format: {
          type: 'string',
          description: '输出格式，默认 auto',
          default: 'auto',
          enum: ['auto', 'yaml', 'csv', 'json']
        },
        include_raw_json: {
          type: 'boolean',
          description: '是否附带原始 JSON',
          default: false
        }
      },
      required: ['module_name']
    }
  },
  {
    name: 'gencode_callapi',
    description: '执行通用管理类 API；如果目标 API 属于复杂配置模块，将返回专用 server 指引。',
    inputSchema: {
      type: 'object',
      properties: {
        api_path: {
          type: 'string',
          description: 'API 路径'
        },
        api_method: {
          type: 'string',
          description: 'HTTP 方法(GET, POST, PUT, DELETE等)'
        },
        parameters: {
          type: 'object',
          description: 'API 调用参数。query/path 参数直接平铺；请求体放在 body 字段中。',
          additionalProperties: true
        },
        output_format: {
          type: 'string',
          description: '输出格式，默认 auto',
          default: 'auto',
          enum: ['auto', 'yaml', 'csv', 'json']
        },
        include_raw_json: {
          type: 'boolean',
          description: '是否附带原始 JSON',
          default: false
        }
      },
      required: ['api_path', 'api_method']
    }
  }
];

const server = new Server(
  {
    name: 'rizhiyi-manage-server',
    version: '1.0.1',
    instructions: MANAGE_SERVER_INSTRUCTIONS,
  },
  {
    capabilities: {
      tools: {},
    },
  },
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools,
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    const { name, arguments: parameters = {} } = request.params;

    switch (name) {
      case 'select_module': {
        const modules = extractModules(manageSpecs);
        const query = String((parameters as any).query || '').toLowerCase().trim();
        const filteredModules = query
          ? modules.filter((m: any) =>
              String(m.name).toLowerCase().includes(query) ||
              String(m.description).toLowerCase().includes(query)
            )
          : modules;

        return formatManageSuccess(
          filteredModules.map((m: any) => ({
            name: m.name,
            description: m.description,
            api_count: m.apis.length
          })),
          parameters as Record<string, any>
        );
      }

      case 'select_api_from_module': {
        const { module_name, query } = parameters as { module_name: string; query?: string };
        if (isExcludedTag(module_name)) {
          return buildManageToolError(
            'USE_DEDICATED_SERVER',
            `模块 ${module_name} 已从 manage 入口排除。`,
            `请改用专用 MCP 服务器 ${EXCLUDED_MODULE_SERVER_MAP[module_name] || '对应专用入口'}。`
          );
        }

        const apis = getApisFromModule(manageSpecs, module_name);
        if (apis.length === 0) {
          return buildManageToolError(
            'MODULE_NOT_FOUND',
            `未找到模块 ${module_name}，或该模块已被专用 server 接管。`,
            '请先调用 select_module 查看当前 manage 入口可用模块。'
          );
        }

        const normalizedQuery = String(query || '').toLowerCase().trim();
        const filteredApis = normalizedQuery
          ? apis.filter((api: any) =>
              String(api.path).toLowerCase().includes(normalizedQuery) ||
              String(api.summary).toLowerCase().includes(normalizedQuery)
            )
          : apis;

        return formatManageSuccess(filteredApis, parameters as Record<string, any>);
      }

      case 'gencode_callapi': {
        const { api_path, api_method = 'GET', parameters: apiParams } = parameters as {
          api_path: string;
          api_method: string;
          parameters?: Record<string, unknown>;
        };

        const result = await generateAndExecuteApiCall(api_path, api_method, apiParams || {});
        if ((result as any).error_code) {
          return buildManageToolError(
            (result as any).error_code,
            (result as any).message,
            (result as any).suggestion,
            (result as any).details
          );
        }

        return formatManageSuccess(result, parameters as Record<string, any>);
      }

      default:
        return buildManageToolError(
          'UNKNOWN_TOOL',
          `未知的工具: ${name}`,
          '请先调用 tools 列表确认可用工具名称，再重试。'
        );
    }
  } catch (error: any) {
    return buildManageToolError(
      'TOOL_EXECUTION_EXCEPTION',
      `工具调用出错: ${error.message || '未知错误'}`,
      '请检查模块名、API 路径和参数格式后重试。'
    );
  }
});

try {
  const transport = new StdioServerTransport();
  await server.connect(transport);
} catch (error) {
  console.error('服务器启动失败:', error);
  process.exit(1);
}
