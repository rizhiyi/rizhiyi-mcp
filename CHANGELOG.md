# Changelog

## 0.2.0

### Added

- 新增 HTTP MCP 网关（Streamable HTTP），支持 stdio 之外的 HTTP 方式：
  - `GET /healthz`
  - `POST /mcp/{server}`（initialize、tools/list、tools/call、resources/read 等）
  - `DELETE /mcp/{server}`（关闭 session）
- 新增请求级鉴权解析与透传（HTTP）：
  - 支持 `Authorization: apikey ...` 与 `Authorization: Basic ...`
  - 同一 HTTP session 禁止切换 `Authorization`
- `.env.example` 补齐 HTTP 网关与共享结果落盘相关的环境变量示例，避免本地/部署时漏配：
  - `MCP_HTTP_HOST` / `MCP_HTTP_PORT` / `MCP_HTTP_BASE_PATH`
  - `LOG_TOOLS_RESULT_STORE_DIR` / `LOG_TOOLS_RESULT_TTL_SECONDS` / `LOG_TOOLS_RESULT_INLINE_MAX_BYTES` / `LOG_TOOLS_RESULT_MAX_FILE_BYTES`

### Changed

- 全量迁移各 server 入口到 `McpServer` 风格（`registerTool`/`registerResource`），提升与官方 SDK 对齐度。
- 利用 `zod` 将 JSON Schema 动态转换为 Zod Schema，并自动推导工具的 Annotations（如只读、破坏性操作等）。
- 将原本散落在各个文件中的环境变读取和 Axios 客户端配置统一提取到 `src/config.ts` 和 `src/auth-context.ts` 中。

### Breaking

- 依赖升级：`@modelcontextprotocol/sdk` 跨版本升级（如从 `v1.9.0` 到 `v1.29.0`）。旧客户端若未适配新握手/传输行为可能存在兼容性风险。

## 0.1.0

### Added

- 日志查询 MCP 采用标准 `resource` 共享工具执行结果：大结果返回 `resource_uri`，并支持 `resources/list`（只返回摘要）与 `resources/read`（读取完整 JSON）；部分分析工具可直接复用 `resource_uri`。
  - 大结果判定采用字节阈值：默认 `inlineMaxBytes≈24KB`，可通过环境变量调整：
    - `LOG_TOOLS_RESULT_INLINE_MAX_BYTES`
    - `LOG_TOOLS_RESULT_MAX_FILE_BYTES`（单资源落盘上限，默认 5MB）
    - `LOG_TOOLS_RESULT_TTL_SECONDS`（共享资源 TTL，默认 30 分钟）
  - 为兼容性考虑，`log_search_sheet` 增加 `delivery_policy`（仅 `result_delivery=auto` 生效）：
    - `compat`（默认）：`size<=20` 优先内联、`size>20` 优先转为 `resource`
    - `bytes`：始终按字节阈值判断
- 日志查询 MCP 新增 `query_precheck` 工具：创图/分析前做 SPL 语法与数据预检，并返回字段映射检查结果。
- 新增解析规则 MCP（`parserrule-server`）初版：支持列表、详情、草稿生成、CRUD、verify、规则参考。
- 增加动态字段配置 MCP（`fieldconfig-server`）。
- 仪表盘 MCP 新增 2 个工具：
  - 美观度评估与约束：`evaluate_dashboard_aesthetics`（含配色/空间占比等评分与建议），并在 create 时应用更合理的默认 layout 与模板
  - Tab 复制工具：支持复制 tab 页面结构以便快速复用

### Changed

- 日志分析链路重构：抽离公共模块，统一时间处理与时序分析逻辑（`time-utils`/`timechart-query`/`series-analysis`），减少重复代码与错误分支。
- 去掉 `pattern_classification` 工具，实际功能合并到 `log_reduce_preview` 结果中。

### Fixed

- `/search/sheet` 参数修复：使用 `page&size` 语义，避免把 `limit` 当分页参数导致行为不符合预期。
- 仪表盘 panel 更新修复：避免“更新某个字段却误改动其他参数”的副作用。
- 单值图修复：补齐 `app_id` 返回，并修复单值图颜色属性设置不正确的问题。

## 0.0.2

- 拆分为 3 个独立 MCP server：`rizhiyi_search`、`rizhiyi_manage`、`rizhiyi_dashboard`。
- `dashboard-server` 增强：支持列出 tabs/panels，返回 `panel_id` 精准定位，并支持按 `panel_id` 增删改 panel。
- Dashboard 写入模型对齐真实数据：`type` 表示 panel 类型（如 `trend`/`eventsTable`），`pie`/`single`/`table` 等应放在 `chartType`（旧写法会自动归一）。

## 0.0.1

- 初始版本：提供日志分析工具服务器与通用 OpenAPI 封装能力。
