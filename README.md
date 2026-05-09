# rizhiyi-mcp

## 项目简介

`rizhiyi-mcp` 是基于 Model Context Protocol (MCP) 的日志易服务器，专为 AI 智能体设计。该项目包含多个独立的 MCP 服务器实现，每个 MCP 服务器都针对不同的场景和需求进行了设计和优化。

## 主要功能

- **`openapi_server` (OpenAPI 封装服务器)**：直接封装了现有的 OpenAPI 接口，为 AI 智能体提供标准化的 API 访问能力，方便智能体调用各种外部服务。
  **注意：**由于日志易全版本的 OpenAPI 多达 400+ 个接口，该实现会直接撑爆 LLM 的上下文窗口导致会话不可用。想使用这种方式进行日志易平台增删改查管理操作的用户，需要自行删减 OpenAPI 的 yaml 文件内容。`config/` 目录下提供了 mini 和 agent 部分的删减示例。
- **`manage-server` (通用管理服务器)**：针对日志易的 OpenAPI 过多的问题，考虑到日志易一级功能项只有十几个，均在 yaml 中有 Tag 标注，设计了分层调用机制。LLM 可以先判断用户提问需要调用哪个功能，然后 MCP 服务器仅返回对应 Tag 的部分 API 做二次筛选，大幅降低了上下文爆炸的可能性。该入口会自动排除 `agent`、`alerts`、`parserrules`、`dashboard` 等复杂 JSON body 配置类能力，引导到专用服务器。
- **`log-tools_server` (日志分析工具服务器 / rizhiyi_search)**：专门为日志分析场景设计的 MCP 服务器，仅包含日志搜索、统计、趋势预测和异常检测等功能，使 AI 智能体能够深入分析和监控日志数据。
  当前提供的高层能力包括：
  - `log_search_sheet`
  - `log_reduce_pattern`
  - `log_reduce_preview`
  - `list_fields`
  - `list_field_values`
  - `trend_summary`
  - `anomaly_points`
  - `pattern_classification`
  - `period_compare`
  - `correlation_analysis`
  - `root_cause_suggestions`
  - `trend_forecast`
  - `anomaly_alert`
  所有工具通用输出控制参数：
  - `output_format`: auto|yaml|csv|json（默认 auto）
  - `include_raw_json`: 是否附带原始 JSON（默认 false）
- **`dashboard-server` (仪表盘专用服务器)**：专门处理 Dashboard 这类复杂 JSON body 配置，通过语义化输入创建和校验仪表盘，避免 LLM 直接拼接底层 API body。
  说明：根据真实 dashboard 数据，绝大多数图表面板的 `type` 为 `trend`，而 `pie`、`single`、`table`、`sunburst` 等通常属于 `chartType`；事件列表则使用独立的 `eventsTable` 类型。
  当前提供的高层能力包括：
  - `list_dashboard_tabs`
  - `list_dashboard_panels`
  - `create_dashboard_from_template`
  - `create_dashboard_from_spec`
  - `update_dashboard_layout`
  - `add_dashboard_panel`
  - `update_dashboard_panel`
  - `remove_dashboard_panel`

## Changelog

详见 [CHANGELOG.md](file:///Users/rizhiyi/Downloads/gitdir/node-serp/rizhiyi-mcp/CHANGELOG.md)。

## TODO

以下能力属于复杂 JSON body 配置类功能，计划以独立 MCP Server 方式提供：
- `rizhiyi_alert`：监控/告警配置（alerts）
- `rizhiyi_parserule`：解析规则配置与测试（parserrules）
- `rizhiyi_agent_config`：采集/Agent 配置（agent）

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
                }
            }
        }
        ```
        请确保将 `/path/to/your/rizhiyi-mcp/dist/log-tools-server.js`、`/path/to/your/rizhiyi-mcp/dist/manage-server.js` 和 `/path/to/your/rizhiyi-mcp/dist/dashboard-server.js` 替换为实际路径。
    -   **Rizhiyi 服务器信息**：Rizhiyi 服务器需要认证连接，请在 .env 文件或环境变量中配置相应的服务器 URL 和 API Key。

2.  **在智能体中使用**：
    配置完成后，您的 AI 智能体即可通过自然语言指令或特定的工具调用语法来使用 `rizhiyi-mcp` 提供的功能。例如，您可以指示智能体“使用日志分析工具查询过去一小时的错误日志”。效果如图：
<img width="2880" height="1800" alt="image" src="https://github.com/user-attachments/assets/9400abe1-3248-46e7-a29c-5e5f302b2129" />

## 开发

如果您想进行二次开发或贡献代码，请参考以下步骤：

1. **代码结构**：
   - `src/openapi_server.ts`: 负责直接封装 OpenAPI 接口的 MCP 服务器实现。
   - `src/manage-server.ts`: 负责提供通用管理类 OpenAPI 功能分类和 API 调用能力，并自动排除复杂配置类模块。
   - `src/log-tools-server.ts`: 负责日志分析工具的 MCP 服务器实现，其核心功能模块位于 `src/modules/` 目录下，如 `log-search.ts`, `statistics.ts`, `trend-forecast.ts`, `anomaly-detection.ts`。
   - `src/dashboard-server.ts`: 负责仪表盘专用 MCP 服务器实现，复用 `src/modules/dashboard.ts` 完成 Dashboard 语义化创建。

欢迎提交 Pull Request 或报告 Bug。请确保您的代码符合项目规范。
