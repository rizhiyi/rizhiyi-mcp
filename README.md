# rizhiyi-mcp 使用指南

`rizhiyi-mcp` 把日志易平台的核心能力（查日志、做分析、生成仪表盘、管理配置，以及自然语言转 SPL）封装成一组标准的 MCP 服务器，供 AI 智能体直接以"工具调用"的方式使用。

本仓库同时提供 **TypeScript** 和 **Python** 两种实现，功能对齐、部署方式略有差异，任选其一即可。

***

## 一句话了解它能做什么

| 你想让 AI 帮你……             | 对应 MCP 服务器              | 典型工具举例                                                                                             |
| ----------------------- | ----------------------- | -------------------------------------------------------------------------------------------------- |
| 查日志、做统计、看趋势、找根因         | `rizhiyi_search`        | `log_search_sheet`、`statistics_analyze`、`trend_analysis`、`anomaly_detect`、`root_cause_suggestions` |
| 用自然语言写 SPL / 管理知识库      | `rizhiyi_chatspl`       | `chat_spl`、`list_chatspl_rules`、`create_chatspl_rule`、`update_chatspl_rule`、`delete_chatspl_rule`  |
| 新建 / 修改仪表盘，评估美化        | `rizhiyi_dashboard`     | `create_dashboard`、`update_dashboard`、`score_dashboard_layout`、`list_dashboards`                   |
| 管理解析规则（schema on write） | `rizhiyi_parserule`     | `create_parserule`、`verify_parserule`、`list_parserules`                                            |
| 管理动态字段（schema on read）  | `rizhiyi_dynamic_field` | `create_fieldconfig`、`list_fieldconfigs`、`apply_fieldconfig`                                       |
| 管理采集 Agent、pipeline     | `rizhiyi_ingest`        | `list_agent_groups`、`assign_agent_to_group`、`list_pipelines`、`query_agent_status`                  |
| 管理监控 / 告警配置（关键字/字段统计/SPL/流式/联合） | `rizhiyi_alert`     | `create_keyword_alert` 等 8 个按类型创建工具、`update_alert`、`preview_alert`、`testrun_alert`、`list_alerts`、`get_alert_category_reference` |
| 管理类通用 OpenAPI           | `rizhiyi_manage`        | 按 tag 分类的增删改查工具（面较小，上下文友好）                                                                         |
| 完整 OpenAPI 直通（已废弃）     | `openapi_server`        | TypeScript 独立 server 已废弃；请使用 Python HTTP 版的 `openapi` 路由                                                               |

> 工具的具体参数以 MCP 客户端里 `tools/list` 返回的自描述为准，在 AI 平台里导入后即可直接查看。

***

## 选择你的路径

| | TypeScript（推荐） | Python |
| --- | --- | --- |
| 支持模式 | stdio + HTTP | 仅 HTTP |
| 要求 | Node.js ≥ 18 | Python ≥ 3.10 |

请根据你偏好的语言和运行模式，选择以下其中一个章节，从头到尾跟着走即可：

- **[TypeScript 版使用指南](#typescript-版使用指南)** — 支持 stdio（推荐）和 HTTP 两种接入方式
- **[Python 版使用指南](#python-版使用指南)** — 仅 HTTP 模式

***

## TypeScript 版使用指南

### 第 1 步：安装

```bash
cd ts
npm install
npm run build     # 构建产物到 ts/dist/，必须先执行
```

### 第 2 步：启动并接入你的 AI 平台

TS 版支持两种运行模式，选其一。两种模式的凭据注入方式不同，别弄混：

- **模式 A（stdio）**：**不用配置 `.env`**，日志易地址和凭据直接写在客户端配置的 `env` 字段里；
- **模式 B（HTTP）**：需要配置 `ts/.env`，网关进程启动时读取。

---

#### 模式 A：stdio 本地接入（推荐）

AI 客户端（如 Claude Desktop、Trae、Cursor）直接起子进程调用，最简单。此模式**不依赖 `ts/.env`**——日志易地址和凭据通过下面客户端配置里每个 server 的 `env` 字段注入。

**客户端配置示例**（以 Claude Desktop 为例）：

```json
{
  "mcpServers": {
    "rizhiyi_search": {
      "command": "node",
      "args": ["/your/absolute/path/to/rizhiyi-mcp/ts/dist/log-tools-server.js"],
      "env": {
        "LOGEASE_BASE_URL": "https://your-logease.example.com",
        "LOGEASE_API_KEY": "<USERNAME>:<API_KEY>"
      }
    },
    "rizhiyi_chatspl": {
      "command": "node",
      "args": ["/your/absolute/path/to/rizhiyi-mcp/ts/dist/chatspl-server.js"],
      "env": {
        "LOGEASE_BASE_URL": "https://your-logease.example.com",
        "LOGEASE_API_KEY": "<USERNAME>:<API_KEY>"
      }
    },
    "rizhiyi_dashboard": {
      "command": "node",
      "args": ["/your/absolute/path/to/rizhiyi-mcp/ts/dist/dashboard-server.js"],
      "env": {
        "LOGEASE_BASE_URL": "https://your-logease.example.com",
        "LOGEASE_API_KEY": "<USERNAME>:<API_KEY>"
      }
    },
    "rizhiyi_parserrule": {
      "command": "node",
      "args": ["/your/absolute/path/to/rizhiyi-mcp/ts/dist/parserrule-server.js"],
      "env": {
        "LOGEASE_BASE_URL": "https://your-logease.example.com",
        "LOGEASE_API_KEY": "<USERNAME>:<API_KEY>"
      }
    },
    "rizhiyi_dynamic_field": {
      "command": "node",
      "args": ["/your/absolute/path/to/rizhiyi-mcp/ts/dist/fieldconfig-server.js"],
      "env": {
        "LOGEASE_BASE_URL": "https://your-logease.example.com",
        "LOGEASE_API_KEY": "<USERNAME>:<API_KEY>"
      }
    },
    "rizhiyi_ingest": {
      "command": "node",
      "args": ["/your/absolute/path/to/rizhiyi-mcp/ts/dist/ingest-server.js"],
      "env": {
        "LOGEASE_BASE_URL": "https://your-logease.example.com",
        "LOGEASE_API_KEY": "<USERNAME>:<API_KEY>"
      }
    },
    "rizhiyi_alert": {
      "command": "node",
      "args": ["/your/absolute/path/to/rizhiyi-mcp/ts/dist/alert-server.js"],
      "env": {
        "LOGEASE_BASE_URL": "https://your-logease.example.com",
        "LOGEASE_API_KEY": "<USERNAME>:<API_KEY>"
      }
    },
    "rizhiyi_manage": {
      "command": "node",
      "args": ["/your/absolute/path/to/rizhiyi-mcp/ts/dist/manage-server.js"],
      "env": {
        "LOGEASE_BASE_URL": "https://your-logease.example.com",
        "LOGEASE_API_KEY": "<USERNAME>:<API_KEY>"
      }
    }
  }
}
```

**替换说明：**

| 占位符                      | 替换成                                             |
| ----------------------- | ---------------------------------------------- |
| `/your/absolute/path/to/rizhiyi-mcp` | 仓库在你机器上的**绝对路径**    |
| `https://your-logease.example.com` | 日志易实例地址（`LOGEASE_BASE_URL`） |
| `<USERNAME>:<API_KEY>`  | 日志易 API 凭据（`LOGEASE_API_KEY`），格式 `用户名:密钥`，支持中文用户名 |

**各 server 的入口文件：**

| 配置 key               | 启动入口（`ts/dist/*.js`）   |
| --------------------- | ------------------------------ |
| `rizhiyi_search`      | `log-tools-server.js`          |
| `rizhiyi_chatspl`     | `chatspl-server.js`            |
| `rizhiyi_dashboard`   | `dashboard-server.js`          |
| `rizhiyi_parserrule`  | `parserrule-server.js`         |
| `rizhiyi_dynamic_field` | `fieldconfig-server.js`        |
| `rizhiyi_ingest`      | `ingest-server.js`             |
| `rizhiyi_alert`       | `alert-server.js`              |
| `rizhiyi_manage`      | `manage-server.js`             |

> **要点**
>
> - 每个服务器是独立子进程：配几个 server 就拉起几个 `node` 进程。
> - stdio 子进程**不读取 `.env`**（工作目录不一定是仓库目录），所以日志易地址和凭据必须写进每个 server 的 `env` 字段。
> - 完整示例也可从 [`mcp-stdio.json.example`](mcp-stdio.json.example) 复制，替换三处占位符后合并进客户端配置。

配置完成后，**重启 AI 客户端**，就能在工具列表里看到上述服务器提供的所有工具了。

---

#### 模式 B：HTTP 网关

适合多用户共享、远程部署、或客户端不支持 stdio 的场景。

##### 1. 配置 `ts/.env`

HTTP 网关进程会读取 `ts/.env`。复制示例并填入日志易实例地址：

```bash
cp .env.example .env
```

编辑 `ts/.env`：

```bash
LOGEASE_BASE_URL=https://your-logease.example.com
```

> 认证信息**不需要**写在这里——HTTP 模式下每个请求的身份由 **MCP 客户端**通过 `Authorization` 头携带，见下文「HTTP 鉴权」。

可选的网关专属环境变量（也在 `ts/.env` 中配置）：

| 变量                   | 默认        | 说明   |
| -------------------- | --------- | ---- |
| `MCP_HTTP_HOST`      | `0.0.0.0` | 监听地址 |
| `MCP_HTTP_PORT`      | `3000`    | 监听端口 |
| `MCP_HTTP_BASE_PATH` | `/mcp`    | 路由前缀 |
| `MCP_RATE_LIMIT_GLOBAL_PER_MINUTE` | 未设置 | 全部工具调用合计的每分钟上限 |
| `MCP_RATE_LIMIT_PER_TOOL` | `{}` | 单工具每分钟上限的 JSON 映射 |
| `UPSTREAM_TIMEOUT_SECONDS` | `30` | 上游请求 / 工具执行兜底超时（秒），与护栏解耦 |
| `MCP_HTTP_MAX_BODY_BYTES` | `4194304` | 单次请求体上限（字节），超限返回 413 |
| `MCP_HTTP_SESSION_IDLE_TTL_SECONDS` | `1800` | HTTP session 空闲回收 TTL（秒） |
| `MCP_HTTP_SESSION_MAX_COUNT` | `256` | HTTP session 全局数量上限，超限淘汰最旧 |

##### 2. 启动网关

```bash
cd ts
npm run start:http   # 等价于 npm run build && node dist/http-server.js
```

默认监听 `0.0.0.0:3000`，端点如下：

| 端点                  | 方法     | 说明                                               |
| ------------------- | ------ | ------------------------------------------------ |
| `/healthz`          | GET    | 健康检查                                             |
| `/mcp/{serverName}` | POST   | MCP 请求入口（initialize / tools/list / tools/call 等） |
| `/mcp/{serverName}` | DELETE | 关闭指定 session                                     |

可用的 `{serverName}`：`log-tools`、`chatspl`、`dashboard`、`manage`、`parserule`、`fieldconfig`、`ingest`、`alert`。

##### 3. 客户端接入配置

仓库根目录的 [`mcp-http.json.example`](mcp-http.json.example) 已写好全部 9 个 server 的 HTTP 接入配置，复制后替换两个占位符即可：

```json
{
  "mcpServers": {
    "rizhiyi_search": {
      "type": "http",
      "url": "http://<MCP_HTTP_HOST>:3000/mcp/log-tools",
      "headers": {
        "Authorization": "apikey <USERNAME>:<API_KEY>"
      }
    },
    "rizhiyi_chatspl": {
      "type": "http",
      "url": "http://<MCP_HTTP_HOST>:3000/mcp/chatspl",
      "headers": {
        "Authorization": "apikey <USERNAME>:<API_KEY>"
      }
    }
  }
}
```

| 占位符                   | 替换成                                            |
| -------------------- | ---------------------------------------------- |
| `<MCP_HTTP_HOST>`      | 网关所在主机，本机部署就是 `127.0.0.1`                     |
| `<USERNAME>:<API_KEY>` | 每个请求都要带的身份凭据，写入 `headers.Authorization` |

> URL 末尾的路径段（`log-tools`、`chatspl` …）就是上面的 `{serverName}`，与网关路由一一对应。`type: "http"` 是流式 HTTP（Streamable HTTP）传输；部分客户端写作 `"type": "streamable-http"`，效果相同。

##### 4. HTTP 鉴权

所有请求必须带 `Authorization` 头，支持两种写法：

```
Authorization: apikey <your-api-key>
Authorization: Basic <base64(username:password)>
```

**推荐：把身份写进 `Authorization` 头，支持中文 username**

`用户名:密钥` 放在 apikey 后面，或编码进 Basic base64，网关会自动拆分出 username：

```
# apikey 写法：<用户名>:<密钥>，冒号前的部分会被当作 username 提取
Authorization: apikey 张三:my-secret-key
Authorization: apikey 运维_小王:AKIAIOSFODNN7EXAMPLE

# Basic 写法：base64(用户名:密码) 解码后自动取用户名
Authorization: Basic 5byg5LiJOm15LXNlY3JldC1rZXk=
```

> 由于 HTTP 请求头原生不支持非 ASCII 字符直接写入，MCP 服务器会先提取 username，再以 query 参数 `?username=` 拼到上游请求 URL 上，不会把中文塞进真正发送的 header。
>
> 网关只做格式校验；真正的用户名/密码/密钥是否有效，由日志易上游 API 判断。同一个 HTTP session 内不允许切换身份。

***

## Python 版使用指南

> Python 版仅支持 HTTP 模式。如需 stdio 接入，请使用 TypeScript 版。

### 第 1 步：安装

```bash
cd python
/usr/local/bin/python3 -m venv .venv   # 需 Python ≥ 3.10
source .venv/bin/activate
pip install -e '.[dev]'
```

### 第 2 步：配置日志易服务器地址

```bash
cp .env.example .env
```

编辑 `python/.env`，填入日志易实例地址：

```bash
LOGEASE_BASE_URL=https://your-logease.example.com
```

> 认证信息**不需要**写在这里——HTTP 模式下每个请求的身份由 **MCP 客户端**通过 `Authorization` 头携带，见下文「HTTP 鉴权」。

可选的网关专属环境变量（也在 `python/.env` 中配置）：

| 变量                   | 默认        | 说明   |
| -------------------- | --------- | ---- |
| `MCP_HTTP_HOST`      | `0.0.0.0` | 监听地址 |
| `MCP_HTTP_PORT`      | `3000`    | 监听端口 |
| `MCP_HTTP_BASE_PATH` | `/mcp`    | 路由前缀 |
| `MCP_RATE_LIMIT_GLOBAL_PER_MINUTE` | 未设置 | 全部工具调用合计的每分钟上限 |
| `MCP_RATE_LIMIT_PER_TOOL` | `{}` | 单工具每分钟上限的 JSON 映射 |
| `UPSTREAM_TIMEOUT_SECONDS` | `30` | 上游请求 / 工具执行兜底超时（秒），与护栏解耦 |
| `MCP_HTTP_MAX_BODY_BYTES` | `4194304` | 单次请求体上限（字节），超限返回 413 |
| `MCP_HTTP_SESSION_IDLE_TTL_SECONDS` | `1800` | HTTP session 空闲回收 TTL（秒） |
| `MCP_HTTP_SESSION_MAX_COUNT` | `256` | HTTP session 全局数量上限，超限淘汰最旧 |

### 第 3 步：启动 HTTP 网关

```bash
cd python
source .venv/bin/activate
rizhiyi-mcp-python
```

默认监听 `0.0.0.0:3000`，端点如下：

| 端点                  | 方法     | 说明                                               |
| ------------------- | ------ | ------------------------------------------------ |
| `/healthz`          | GET    | 健康检查                                             |
| `/mcp/{serverName}` | POST   | MCP 请求入口（initialize / tools/list / tools/call 等） |
| `/mcp/{serverName}` | DELETE | 关闭指定 session                                     |

可用的 `{serverName}`：`log-tools`、`chatspl`、`dashboard`、`manage`、`parserule`、`fieldconfig`、`ingest`、`openapi`、`alert`。

### 第 4 步：客户端接入配置

仓库根目录的 [`mcp-http.json.example`](mcp-http.json.example) 已写好全部 9 个 server 的 HTTP 接入配置，复制后替换两个占位符即可：

```json
{
  "mcpServers": {
    "rizhiyi_search": {
      "type": "http",
      "url": "http://<MCP_HTTP_HOST>:3000/mcp/log-tools",
      "headers": {
        "Authorization": "apikey <USERNAME>:<API_KEY>"
      }
    },
    "rizhiyi_chatspl": {
      "type": "http",
      "url": "http://<MCP_HTTP_HOST>:3000/mcp/chatspl",
      "headers": {
        "Authorization": "apikey <USERNAME>:<API_KEY>"
      }
    }
  }
}
```

| 占位符                   | 替换成                                            |
| -------------------- | ---------------------------------------------- |
| `<MCP_HTTP_HOST>`      | 网关所在主机，本机部署就是 `127.0.0.1`                     |
| `<USERNAME>:<API_KEY>` | 每个请求都要带的身份凭据，写入 `headers.Authorization` |

> URL 末尾的路径段（`log-tools`、`chatspl` …）就是上面的 `{serverName}`，与网关路由一一对应。`type: "http"` 是流式 HTTP（Streamable HTTP）传输；部分客户端写作 `"type": "streamable-http"`，效果相同。

#### HTTP 鉴权

所有请求必须带 `Authorization` 头，支持两种写法：

```
Authorization: apikey <your-api-key>
Authorization: Basic <base64(username:password)>
```

**推荐：把身份写进 `Authorization` 头，支持中文 username**

`用户名:密钥` 放在 apikey 后面，或编码进 Basic base64，网关会自动拆分出 username：

```
# apikey 写法：<用户名>:<密钥>，冒号前的部分会被当作 username 提取
Authorization: apikey 张三:my-secret-key
Authorization: apikey 运维_小王:AKIAIOSFODNN7EXAMPLE

# Basic 写法：base64(用户名:密码) 解码后自动取用户名
Authorization: Basic 5byg5LiJOm15LXNlY3JldC1rZXk=
```

> 由于 HTTP 请求头原生不支持非 ASCII 字符直接写入，MCP 服务器会先提取 username，再以 query 参数 `?username=` 拼到上游请求 URL 上，不会把中文塞进真正发送的 header。
>
> 网关只做格式校验；真正的用户名/密码/密钥是否有效，由日志易上游 API 判断。同一个 HTTP session 内不允许切换身份。

***

## 工具调用限流

Streamable HTTP 网关支持与 [Splunk MCP Server rate limiting](https://help.splunk.com/en/splunk-cloud-platform/mcp-server-for-splunk-platform/1.3/mcp-server-rate-limiting) 类似的固定窗口限流：统计所有 `tools/call` 的全局调用量，也可以为单个工具设置更严格的上限。默认不设置任何上限。

```bash
# 当前进程内全部工具每分钟最多调用 600 次
MCP_RATE_LIMIT_GLOBAL_PER_MINUTE=600

# 工具名规则作用于所有 server；server/tool_name 只作用于指定 server
MCP_RATE_LIMIT_PER_TOOL='{"log_search_sheet":120,"dashboard/create_dashboard_from_spec":10}'
```

规则说明：

- 使用自然分钟固定窗口，计数在下一分钟开始时重置。
- `server/tool_name` 精确规则优先于仅包含 `tool_name` 的规则；仅含工具名的规则会让各 server 中的同名工具共享计数。
- 全局规则与单工具规则同时计数，任一规则超限都会拒绝本次工具执行。
- 如果全局上限低于某个单工具上限，全局规则会先触发，该单工具上限实际无法用满。
- 超限结果是 `isError: true` 的 MCP 工具结果，`error_code` 为 `RATE_LIMIT_EXCEEDED`；`details` 包含 `scope`、`limit`、`retry_after_seconds` 和 `reset_at`。
- 计数仅保存在当前进程内，不会在多进程、多副本或多节点之间同步。需要集群级硬限制时，应在外层网关或共享存储中实现。
- TypeScript 的 stdio 模式不启用这组限制；Python 版仅提供 HTTP 模式。

`GET /healthz` 的 `rate_limiting` 字段会显示是否启用、全局上限和已配置的单工具规则数量，但不会暴露具体工具规则。

***

## HTTP 网关可靠性与资源上限

TypeScript、Python 两套网关共享同一组配置键与默认值，用于避免工具调用永久挂起和 session 无界增长：

```bash
# 上游请求 / 工具执行兜底超时（秒），与护栏解耦：护栏关闭时同样生效
UPSTREAM_TIMEOUT_SECONDS=30
# 单次请求体上限（字节），超过即返回 413 REQUEST_BODY_TOO_LARGE
MCP_HTTP_MAX_BODY_BYTES=4194304
# HTTP session 空闲回收 TTL（秒）与全局数量上限
MCP_HTTP_SESSION_IDLE_TTL_SECONDS=1800
MCP_HTTP_SESSION_MAX_COUNT=256
```

- `UPSTREAM_TIMEOUT_SECONDS` 是可靠性兜底，不再依赖 `MCP_GUARDRAILS_ENABLED`。当护栏处于 `enforce` 且命中 SPL 执行路径时，使用 `MCP_GUARDRAIL_EXEC_TIMEOUT_SECONDS`；其余情况一律使用 `UPSTREAM_TIMEOUT_SECONDS`。
- 每个 HTTP session 记录最近活跃时间，每次请求命中即刷新。后台 GC 每 60 秒执行一次，**先按空闲 TTL 清理，再按数量上限淘汰最旧的 session**；被淘汰的 session 会真正关闭其 transport。
- `GET /healthz` 的 `session_count` 字段展示当前存活的 session 数量。

***

## SPL 安全评分与执行护栏

TypeScript、Python 两套服务均支持统一的 SPL 执行前检查和返回前保护。默认关闭；建议先用 `audit` 灰度观察，再切换到 `enforce`。

```bash
MCP_GUARDRAILS_ENABLED=true
MCP_GUARDRAIL_ENFORCE_MODE=audit
MCP_GUARDRAIL_SAFE_TIMERANGE=24h
MCP_GUARDRAIL_RISK_ALERT_THRESHOLD=50
MCP_GUARDRAIL_RISK_REJECT_THRESHOLD=100
MCP_GUARDRAIL_EXEC_TIMEOUT_SECONDS=60
MCP_GUARDRAIL_MAX_EVENTS=1000
```

护栏会递归检查普通管道、`[[ ... ]]` / `[ ... ]` 子搜索、`map search="..."`，以及 dashboard、告警和 ChatSPL 知识规则中的嵌套 query：

- 默认禁止写入、删除、导出、自定义执行和外部访问命令，如 `delete`、`collect`、`outputlookup`、`lookup2`、`rest`、`dbxquery`、`history`。
- 对 `transaction`、`map`、`join`、`append`、无限额子搜索、宽索引范围和超长时间窗累计风险分。
- `audit` 模式返回结构化 `guardrail` 评分并写入审计元数据，但不阻止执行；`enforce` 模式会在命中禁止命令或达到已启用的拒绝阈值时返回 `SPL_GUARDRAIL_BLOCKED`。
- `MCP_GUARDRAIL_RISK_REJECT_THRESHOLD=100` 表示仅按禁止命令拦截，不启用纯评分自动拒绝；设置为 `0-99` 可启用评分阈值拒绝。
- 返回结果会按配置递归脱敏信用卡号、SSN 和自定义正则，并把数组截断到 `MCP_GUARDRAIL_MAX_EVENTS`；共享 resource 在落盘前执行相同保护。
- `GET /healthz` 的 `guardrails` 字段会显示开关、模式、评分阈值和事件上限。

完整变量和默认禁止命令见 `python/.env.example`、`ts/.env.example`；规则依据见 `docs/research-spl-guardrails-risky-commands.md`。

***

## 本地工具调用日志

Streamable HTTP 网关会把每次工具调用写成一行 JSON，默认存放在 `./logs/mcp-server-YYYYMMDD.log`。日志只包含调用元数据（时间、session、server、工具名、状态、耗时、用户和错误码），不记录工具参数、查询正文或返回结果。

```bash
RIZHIYI_LOG_DIR=./logs
RIZHIYI_LOG_NAME_PREFIX=mcp-server
RIZHIYI_LOG_ROTATE_BYTES=10485760  # 默认 10MB；<=0 时改为按时间轮转
RIZHIYI_LOG_ROTATE_INTERVAL=1d     # 按时间轮转时支持 1d / 1h
RIZHIYI_LOG_KEEP_FILES=7           # 包含当前文件在内的保留份数
```

同一天内发生多次轮转时，文件依次命名为 `mcp-server-YYYYMMDD.1.log`、`mcp-server-YYYYMMDD.2.log`。超过保留份数后自动删除最旧文件；被限流的调用记录为 `status=ok-limited` 和 `error_code=RATE_LIMIT_EXCEEDED`。启用 SPL 护栏后，日志还会记录 action、风险分和命中的禁止命令，但仍不会记录查询正文。

***

## 效果图

配置完成后，您的 AI 智能体即可通过自然语言指令或特定的工具调用语法来使用 `rizhiyi-mcp` 提供的功能。例如，您可以指示智能体"使用日志分析工具查询过去一小时的错误日志"： <img width="2880" height="1800" alt="image" src="https://github.com/user-attachments/assets/9400abe1-3248-46e7-a29c-5e5f302b2129" />

## 资源共享（大结果怎么处理）

日志检索/统计的结果可能非常大，如果直接塞到对话里很容易把上下文窗口撑爆。rizhiyi-mcp 的处理方式是：**大结果写入 MCP resource，只返回一个** **`resource_uri`**，后续工具按需读取或复用。

推荐使用流程：

1. 调用任意日志分析工具（如 `log_search_sheet`），拿到返回里的 `resource_uri`
2. 想查看完整内容时，用 MCP 标准 `resources/read` 按 URI 读取
3. 想继续做关联分析 / 根因分析时，直接把 `resource_uri` 作为参数传给 `correlation_analysis`、`root_cause_suggestions` 等工具，工具内部会自动拉取，不必重新拉原始数据

可选参数（工具级）：

| 参数                   | 值                              | 默认     | 说明            |
| -------------------- | ------------------------------ | ------ | ------------- |
| `result_delivery`    | `auto` / `inline` / `resource` | `auto` | 强制指定结果以哪种方式返回 |
| `result_ttl_seconds` | 正整数                            | 服务端默认  | 共享资源的存活秒数     |

***

## 常见问题

**Q：TS 版 build 之后没有 dist 目录？**
A：必须在 `ts/` 目录下执行 `npm run build`，仓库根目录下的 `gitignore` 默认忽略了 `ts/dist/`。

**Q：调用工具返回 401 / 403？**
A：说明 `LOGEASE_API_KEY` 或 `Authorization` 不被日志易实例接受。请直接用相同的凭据访问一次 `{LOGEASE_BASE_URL}/api/v3/healthz` 验证，确认后再配置给 rizhiyi-mcp。

**Q：HTTP 模式下客户端收到** **`406 Not Acceptable`？**
A：`Accept` 请求头没有包含 `text/event-stream`。官方 Streamable HTTP 协议要求同时接受 `application/json` 和 `text/event-stream`。

***

## Changelog

详见 [CHANGELOG.md](CHANGELOG.md)。

## TODO

- `rizhiyi_agent_config`：采集/Agent 配置（agent）
