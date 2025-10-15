import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import * as fs from 'fs';
import * as yaml from 'js-yaml';
import axios from 'axios';
import https from 'https';
import dotenv from 'dotenv';

dotenv.config();

const customToolsBaseURL = process.env.LOGEASE_BASE_URL ?? 'https://192.168.40.116:8090';
const customToolsAuthHeader = process.env.LOGEASE_AUTH_HEADER;
const customToolsApiKey = process.env.LOGEASE_API_KEY;
const customToolsTlsRejectUnauthorized = process.env.LOGEASE_TLS_REJECT_UNAUTHORIZED !== 'false';

if (!customToolsBaseURL) {
  console.warn('LOGEASE_BASE_URL is not set. Using default: https://192.168.40.116:8090');
}

let authorization: string | undefined;
if (customToolsAuthHeader) {
  authorization = customToolsAuthHeader;
} else if (customToolsApiKey) {
  authorization = `apikey ${customToolsApiKey}`;
}

if (!authorization) {
  console.warn('Neither LOGEASE_AUTH_HEADER nor LOGEASE_API_KEY is set. Requests to LogEase server might fail.');
}

const httpsAgent = new https.Agent({
  rejectUnauthorized: customToolsTlsRejectUnauthorized,
});

// 创建HTTP客户端
const httpClient = axios.create({
  baseURL: customToolsBaseURL,
  headers: authorization ? { Authorization: authorization } : {},
  httpsAgent,
});

// 加载OpenAPI规范
const yamlContent = fs.readFileSync('/Users/rizhiyi/Downloads/gitdir/node-serp/rizhiyi-mcp/config/Api_5.3_schema_mini.yaml', 'utf8');
const apiSpecs = yaml.load(yamlContent);

// 提取一级模块
function extractModules(specs: any) {
  const modules: Record<string, any> = {};
  const paths = specs.paths || {};

  for (const path in paths) {
    const pathObj = paths[path];
    for (const method in pathObj) {
      const operation = pathObj[method];
      const tags = operation.tags || [];

      if (tags.length > 0) {
        const mainTag = tags[0];
        if (!Object.prototype.hasOwnProperty.call(modules, mainTag)) {
          modules[mainTag] = {
            name: mainTag,
            description: operation.summary || mainTag,
            apis: []
          };
        }

        if (!modules[mainTag].apis.some((api: any) => api.path === path && api.method === method)) {
          modules[mainTag].apis.push({
            path,
            method,
            summary: operation.summary || '',
            description: operation.description || '',
            parameters: operation.parameters || [],
            requestBody: operation.requestBody || null,
            responses: operation.responses || {}
          });
        }
      }
    }
  }

  return Object.values(modules);
}

// 从模块中提取API
function getApisFromModule(specs: any, moduleName: string) {
  const modules = extractModules(specs);
  const module = modules.find((m: any) => m.name === moduleName);

  if (!module) {
    return [];
  }

  return module.apis;
}

// 生成API调用代码并执行
async function generateAndExecuteApiCall(specs: any, apiPath: string, apiMethod: string, params: Record<string, any>) {
  try {
    const pathObj = specs.paths[apiPath];
    if (!pathObj) {
      return { error: `API path ${apiPath} not found` };
    }

    const operation = pathObj[apiMethod.toLowerCase()];
    if (!operation) {
      return { error: `Method ${apiMethod} not supported for ${apiPath}` };
    }

    // 构建请求URL
    let url = apiPath;
    const queryParams: Record<string, any> = {};
    const pathParams: Record<string, any> = {};
    const bodyParams: Record<string, any> = {};

    // 处理参数
    if (operation.parameters) {
      for (const param of operation.parameters) {
        if (param.in === 'path' && params[param.name]) {
          pathParams[param.name] = params[param.name];
          url = url.replace(`{${param.name}}`, params[param.name]);
        } else if (param.in === 'query' && params[param.name]) {
          queryParams[param.name] = params[param.name];
        }
      }
    }

    // 处理请求体
    if (operation.requestBody && params.body) {
      Object.assign(bodyParams, params.body);
    }

    // 执行API调用
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
      error: error.message,
      details: error.response?.data || null
    };
  }
}

// 定义工具
const tools = [
  {
    name: 'select_module',
    description: '根据用户提问选择日志易相关的功能模块',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: '用户的问题或需求描述'
        }
      },
      required: ['query']
    }
  },
  {
    name: 'select_api_from_module',
    description: '从指定的日志易模块中选择相关的API，返回对应的OpenAPI规范',
    inputSchema: {
      type: 'object',
      properties: {
        module_name: {
          type: 'string',
          description: '模块名称'
        },
        query: {
          type: 'string',
          description: '用户的问题或需求描述'
        }
      },
      required: ['module_name', 'query']
    }
  },
  {
    name: 'gencode_callapi',
    description: '根据日志易OpenAPI规范生成调用代码并执行',
    inputSchema: {
      type: 'object',
      properties: {
        api_path: {
          type: 'string',
          description: 'API路径'
        },
        api_method: {
          type: 'string',
          description: 'HTTP方法(GET, POST, PUT, DELETE等)'
        },
        parameters: {
          type: 'object',
          description: 'API调用参数',
          additionalProperties: true
        }
      },
      required: ['api_path', 'api_method']
    }
  }
];

// 创建服务器
const server = new Server(
  {
    name: 'rizhiyi-custom-tools',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  },
);

// 处理工具列表请求
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools,
  };
});

// 处理工具调用请求
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    const { name, arguments: parameters } = request.params;

    switch (name) {
      case 'select_module':
        try {
          const modules = extractModules(apiSpecs);
          return {
            content: [{
              type: "text",
              text: `Successfully extracted ${modules.length} modules: ${modules.map((m: any) => `${m.name} - ${m.description}`).join(', ')}`
            }]
          };
        } catch (error: any) {
          return {
            isError: true,
            content: [{
              type: "text",
              text: `Error extracting modules: ${error.message}`
            }]
          };
        }

      case 'select_api_from_module':
        try {
          const { module_name, query } = parameters as { module_name: string, query: string };
          const apis = getApisFromModule(apiSpecs, module_name);

          return {
            content: [{
              type: "text",
              text: `${JSON.stringify(apis, null, 2)}`
            }]
          };
        } catch (error: any) {
          return {
            isError: true,
            content: [{
              type: "text",
              text: `Error getting APIs from module: ${error.message}`
            }]
          };
        }

      case 'gencode_callapi':
        try {
          const { api_path, api_method = 'GET', parameters: apiParams } = parameters as { api_path: string; api_method: string; parameters?: Record<string, unknown> };
          const result = await generateAndExecuteApiCall(apiSpecs, api_path, api_method, apiParams || {});

          return {
            content: [{
              type: 'text',
              text: `${JSON.stringify(result, null, 2)}`
            }]
          };
        } catch (error: any) {
          return {
            isError: true,
            content: [{
              type: 'text',
              text: `Error calling API: ${error.message}`
            }]
          };
        }

      default:
        return {
          error: {
            message: `Unknown tool: ${name}`
          }
        };
    }
  } catch (error: any) {
    console.error('Error handling tool call:', error);
    return {
      error: {
        message: `工具调用出错: ${error.message || '未知错误'}`
      }
    };
  }
});

// 启动服务器
try {
  const transport = new StdioServerTransport();
  await server.connect(transport);
} catch (error) {
  console.error('服务器启动失败:', error);
  process.exit(1);
}