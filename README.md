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
| 管理类通用 OpenAPI           | `rizhiyi_manage`        | 按 tag 分类的增删改查工具（面较小，上下文友好）                                                                         |
| 完整 OpenAPI 直通（慎用）       | `openapi_server`        | 直接把 API schema 暴露为工具（接口多，易撑爆上下文）                                                                   |

> 工具的具体参数以 MCP 客户端里 `tools/list` 返回的自描述为准，在 AI 平台里导入后即可直接查看。

***

## 快速开始：3 步跑起来

### 第 1 步：安装

**方式 A：TypeScript（推荐，支持 stdio + HTTP 两种模式）**

```bash
cd ts
npm install
npm run build     # 构建产物到 ts/dist/，必须先执行
```

> 要求 Node.js ≥ 18。

**方式 B：Python（仅 HTTP 模式）**

```bash
cd python
/usr/local/bin/python3.11 -m venv .venv
source .venv/bin/activate
pip install -e '.[dev]'
```

> 要求 Python ≥ 3.11。

### 第 2 步：配置日志易服务器地址和凭据

两种实现都支持通过 `.env` 或环境变量注入：

```bash
# 复制示例
cp ts/.env.example ts/.env        # TS 版
cp python/.env.example python/.env  # Python 版
```

变量说明：

| 变量                    | 说明                                                                            |
| --------------------- | ----------------------------------------------------------------------------- |
| `LOGEASE_BASE_URL`    | 日志易实例地址，例如 `https://your-logease.example.com`                                 |
| `LOGEASE_API_KEY`     | API Key（推荐），格式通常是 `用户名:密钥`，如果用户名独立配置，则此处只填写密钥部分                               |
| `LOGEASE_AUTH_HEADER` | 或直接填完整的 `Authorization` 头，例如 `apikey user:secret` 或 `Basic base64(user:pass)` |
| `LOGEASE_USERNAME`    | （可选）传递给接口的中文用户名                                                               |

### 第 3 步：启动并接入你的 AI 平台

两种部署模式，二选一：

- **stdio 模式**：AI 客户端（如 Claude Desktop、Trae、Cursor）直接起子进程调用，最简单

- **HTTP 模式**：独立网关进程，支持多会话、多客户端、远程调用

***

## 模式一：stdio 本地接入（TS only）

在你的 MCP 客户端配置文件（通常是 `claude_desktop_config.json` 或平台对应的 mcpServers 配置）中，按需要添加服务器：

```json
{
  "mcpServers": {
    "rizhiyi_search": {
      "command": "node",
      "args": ["/path/to/rizhiyi-mcp/ts/dist/log-tools-server.js"]
      "environment": {
        "LOGEASE_BASE_URL": "http://<YOTTAWEB>",
        "LOGEASE_API_KEY": "<USER>:<API_KEY>",
        "LOGEASE_TLS_REJECT_UNAUTHORIZED": "false"
      }
    },
    "rizhiyi_dashboard": {
      "command": "node",
      "args": ["/path/to/rizhiyi-mcp/ts/dist/dashboard-server.js"]
    }
    ...
  }
}
```

> 别忘了把 `/path/to/rizhiyi-mcp/` 换成你机器上的实际绝对路径，并确认已经 `npm run build` 过。

配置完成后，重启 AI 客户端，就能在工具列表里看到上述服务器提供的所有工具了。

***

## 模式二：HTTP 网关（TS + Python 均支持）

适合多用户共享、远程部署、或客户端不支持 stdio 的场景。

### TS 版启动

```bash
cd ts
npm run start:http   # 等价于 npm run build && node dist/http-server.js
```

### Python 版启动

```bash
cd python
source .venv/bin/activate
rizhiyi-mcp-python
```

默认监听（TS 与 Python 一致）：

| 端点                  | 方法     | 说明                                               |
| ------------------- | ------ | ------------------------------------------------ |
| `/healthz`          | GET    | 健康检查                                             |
| `/mcp/{serverName}` | POST   | MCP 请求入口（initialize / tools/list / tools/call 等） |
| `/mcp/{serverName}` | DELETE | 关闭指定 session                                     |

可用的 `{serverName}`：`log-tools`、`chatspl`、`dashboard`、`manage`、`parserule`、`fieldconfig`、`ingest`、`openapi`。

环境变量：

| 变量                   | 默认        | 说明   |
| -------------------- | --------- | ---- |
| `MCP_HTTP_HOST`      | `0.0.0.0` | 监听地址 |
| `MCP_HTTP_PORT`      | `3000`    | 监听端口 |
| `MCP_HTTP_BASE_PATH` | `/mcp`    | 路由前缀 |

### HTTP 鉴权

所有请求必须带 `Authorization` 头，支持两种写法：

```
Authorization: apikey <your-api-key>
Authorization: Basic <base64(username:password)>
```

> 网关只做格式校验；真正的用户名/密码/密钥是否有效，由日志易上游 API 判断。同一个 HTTP session 内不允许切换身份。

#### HTTP 模式下的中文 username 怎么传

由于 HTTP 请求头原生不支持非 ASCII 字符直接写入，MCP  服务器做了专门处理：**先提取 username，再以 query 参数** **`?username=`** **的形式拼到上游请求 URL 上**，不会把中文塞进真正发送的 header。

HTTP 模式下 username 有两种传递方式，优先级从高到低：

**方式一（推荐）：直接放在 Authorization 头里，网关自动拆分**

```
# apikey 写法：<用户名>:<密钥>，冒号前的部分会被当作 username 提取
Authorization: apikey 张三:my-secret-key
Authorization: apikey 运维_小王:AKIAIOSFODNN7EXAMPLE

# Basic 写法：base64(用户名:密码) 解码后自动取用户名
Authorization: Basic 5byg5LiJOm15LXNlY3JldC1rZXk=
```

这种方式对 TS 和 Python 两个网关都生效，也是多用户共享网关场景下的标准用法——每个请求/会话带自己的身份即可。

**方式二（TS 版网关专用）：进程级显式覆盖，用** **`LOGEASE_USERNAME`** **环境变量**

启动网关进程时设置：

```bash
# TS 版 HTTP 网关
LOGEASE_USERNAME="王五" npm run start:http
```

一旦设置，它的优先级最高——即使 Authorization 里已经带了用户名，最终透传给上游 API 的 `username` 也会使用 `LOGEASE_USERNAME` 的值。适合"整个网关实例只代表一个用户"的单机部署场景。

> 💡 小结：多用户共享网关 → 用方式一，写进 `Authorization: apikey 用户名:密钥`；单机单用户 → 两种方式任选其一。Python 网关当前只支持方式一。

### 效果图

配置完成后，您的 AI 智能体即可通过自然语言指令或特定的工具调用语法来使用 `rizhiyi-mcp` 提供的功能。例如，您可以指示智能体“使用日志分析工具查询过去一小时的错误日志”： <img width="2880" height="1800" alt="image" src="https://github.com/user-attachments/assets/9400abe1-3248-46e7-a29c-5e5f302b2129" />

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

以下能力属于复杂 JSON body 配置类功能，计划以独立 MCP Server 方式提供：

- `rizhiyi_alert`：监控/告警配置（alerts）

- `rizhiyi_agent_config`：采集/Agent 配置（agent）

