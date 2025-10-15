import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { Converter } from 'openapi2mcptools';
import * as fs from 'fs';
import * as yaml from 'js-yaml';
import axios from 'axios';
import https from 'https';
import dotenv from 'dotenv';

dotenv.config();

const openapiBaseURL = process.env.LOGEASE_BASE_URL ?? 'https://192.168.40.116:8090';
const openapiAuthHeader = process.env.LOGEASE_AUTH_HEADER;
const openapiApiKey = process.env.LOGEASE_API_KEY;
const openapiTlsRejectUnauthorized = process.env.LOGEASE_TLS_REJECT_UNAUTHORIZED !== 'false';

if (!openapiBaseURL) {
  console.warn('LOGEASE_BASE_URL is not set. Using default: https://192.168.40.116:8090');
}

let authorization: string | undefined;
if (openapiAuthHeader) {
  authorization = openapiAuthHeader;
} else if (openapiApiKey) {
  authorization = `apikey ${openapiApiKey}`;
}

if (!authorization) {
  console.warn('Neither LOGEASE_AUTH_HEADER nor LOGEASE_API_KEY is set. Requests to LogEase server might fail.');
}

const httpsAgent = new https.Agent({
  rejectUnauthorized: openapiTlsRejectUnauthorized,
});

const httpClient = axios.create({
  baseURL: openapiBaseURL,
  headers: authorization ? { Authorization: authorization } : {},
  httpsAgent,
});
const converter = new Converter({ httpClient });

const yamlContent = fs.readFileSync('/Users/rizhiyi/Downloads/gitdir/node-serp/rizhiyi-mcp/config/Api_5.3_schema.yaml', 'utf8');
const rzy_specs = yaml.load(yamlContent);
await converter.load(rzy_specs);

const tools = converter.getToolsList();
const toolCaller = converter.getToolsCaller();

const server = new Server(
  {
    name: 'rizhiyi',
    version: '1.0.0',
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
  return await toolCaller(request);
});

const transport = new StdioServerTransport();
await server.connect(transport);
