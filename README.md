# rizhiyi-mcp

## 项目简介

`rizhiyi-mcp` 是基于 Model Context Protocol (MCP) 的日志易服务器，专为 AI 智能体设计。该项目包含多个独立的 MCP 服务器实现，每个 MCP 服务器都针对不同的场景和需求进行了设计和优化。

## 主要功能

- 这是一个面向 AI 智能体的 MCP Server 集合，目标是：在不撑爆上下文窗口的前提下，把“查日志 + 做分析 + 生成仪表盘/配置”的能力以工具形式交给智能体。
- **核心设计点**：大结果不直接塞进对话里，而是落到 MCP 标准 `resource`，以 `resource_uri` 的形式在工具之间共享（按需读取、避免重复拉取）。

### 服务器一览

| MCP 服务器 | 入口脚本 | 适用场景 |
| --- | --- | --- |
| `rizhiyi_search` | `dist/log-tools-server.js` | 日志检索、统计分析、趋势/异常、根因分析 |
| `rizhiyi_manage` | `dist/manage-server.js` | 管理类 OpenAPI（按 tag 分层暴露，降低工具面） |
| `rizhiyi_dashboard` | `dist/dashboard-server.js` | 仪表盘创建/更新/校验与美观度评分 |
| `rizhiyi_parserule` | `dist/parserrule-server.js` | 解析规则（schema on write）常用操作 |
| `rizhiyi_dynamic_field` | `dist/fieldconfig-server.js` | 动态字段（schema on read）常用操作 |
| `openapi_server` | `dist/openapi_server.js` | OpenAPI 直封装（可选；未裁剪时接口过多，容易撑爆上下文） |

工具明细与参数以 MCP 的 tools 自描述为准（在你的 MCP 客户端里查看 tools 列表即可）。

## 安装

请确保您已安装 Node.js 和 npm。

1. 克隆项目仓库：

   ```bash
   git clone https://github.com/rizhiyi/rizhiyi-mcp.git
   cd rizhiyi-mcp
   ```

2. 安装依赖：

   ```bash
   npm install
   ```

3. 构建项目：

   ```bash
   npm run build
   ```
   注意：仓库默认忽略 `dist/`，使用前需先构建生成产物。

## 使用

### 集成到 AI 智能体平台

`rizhiyi-mcp` 提供的 MCP 服务器可以集成到支持自定义工具或插件的 AI 智能体平台中，例如 Cursor、Claude Desktop 或 Trae。以下是通用的集成步骤：

1.  **配置工具/插件**：
    在您的 AI 智能体平台中，根据其指引配置新导入的工具或插件。这通常包括：
    -   **工具名称**：为您的工具指定一个易于识别的名称，例如“日志分析工具”、“日志易服务”等。
    -   **MCP 服务器信息**：将以下配置添加到你的 MCP 客户端配置文件中：
        ```json
        {
            "mcpServers": {
                "rizhiyi_search": {
                    "command": "node",
                    "args": [
                        "/path/to/your/rizhiyi-mcp/dist/log-tools-server.js"
                    ]
                },
                "rizhiyi_manage": {
                    "command": "node",
                    "args": [
                        "/path/to/your/rizhiyi-mcp/dist/manage-server.js"
                    ]
                },
                "rizhiyi_dashboard": {
                    "command": "node",
                    "args": [
                        "/path/to/your/rizhiyi-mcp/dist/dashboard-server.js"
                    ]
                },
                "rizhiyi_parserule": {
                    "command": "node",
                    "args": [
                        "/path/to/your/rizhiyi-mcp/dist/parserrule-server.js"
                    ]
                },
                "rizhiyi_dynamic_field": {
                    "command": "node",
                    "args": [
                        "/path/to/your/rizhiyi-mcp/dist/fieldconfig-server.js"
                    ]
                }
            }
        }
        ```
        请确保将 `/path/to/your/rizhiyi-mcp/dist/log-tools-server.js`、`/path/to/your/rizhiyi-mcp/dist/manage-server.js`、`/path/to/your/rizhiyi-mcp/dist/dashboard-server.js`、`/path/to/your/rizhiyi-mcp/dist/parserrule-server.js` 和 `/path/to/your/rizhiyi-mcp/dist/fieldconfig-server.js` 替换为实际路径。
    -   **Rizhiyi 服务器信息**：Rizhiyi 服务器需要认证连接，请在 .env 文件或环境变量中配置相应的服务器 URL 和 API Key。

### 资源共享（MCP resources）

日志分析工具在大结果场景下会返回 `resource_uri`。推荐流程：

1. 先调用任意日志分析工具（如 `log_search_sheet`）获取 `resource_uri`
2. 如需查看完整返回，使用 MCP 标准 `resources/read` 按 `resource_uri` 读取
3. 如需继续分析，直接把 `resource_uri` 作为输入传给支持复用的分析工具（例如 `correlation_analysis`、`root_cause_suggestions` 等）

可调参数（可选）：
- `result_delivery`: `auto|inline|resource`（默认 `auto`）
- `result_ttl_seconds`: 共享资源存活秒数（可选）

### 效果图

配置完成后，您的 AI 智能体即可通过自然语言指令或特定的工具调用语法来使用 `rizhiyi-mcp` 提供的功能。例如，您可以指示智能体“使用日志分析工具查询过去一小时的错误日志”：
<img width="2880" height="1800" alt="image" src="https://github.com/user-attachments/assets/9400abe1-3248-46e7-a29c-5e5f302b2129" />

## Changelog

详见 [CHANGELOG.md](CHANGELOG.md)。

## TODO

以下能力属于复杂 JSON body 配置类功能，计划以独立 MCP Server 方式提供：
- `rizhiyi_alert`：监控/告警配置（alerts）
- `rizhiyi_agent_config`：采集/Agent 配置（agent）

## 开发

如果您想进行二次开发或贡献代码，请参考以下步骤：

1. **代码结构**：
   - `src/*-server.ts`：各 MCP server 的入口
   - `src/modules/*`：各领域能力的实现（日志分析 / 仪表盘 / 解析规则 / 动态字段）

欢迎提交 Pull Request 或报告 Bug。请确保您的代码符合项目规范。
