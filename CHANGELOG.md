# Changelog

## Unreleased

### Added

- **告警服务新增 `get_triggered_alerts`（已触发告警详情）**：TS/Python 双端同构实现。数据来自告警执行历史 `index=monitor appname:alert_record`，默认只看最近 24h 内真正触发的记录（`'issue_alert':true AND NOT 'is_recovery':true`），逐条返回六要素：告警名称、触发时间、实体、触发级别、触发值、事件描述。
  - 每个要素都带显式回退链与来源标记（`entity_source` / `description_source`），标记为 `none` 即表示确实未取到，不会臆造。
  - 实体优先取分段（分组）字段：当 `result.is_segmentation=true` 时，`result.segmentation_field` 是实体字段名、`result.segmentation_specify_value` 是实体字段值；否则按调用方传入的 `entity_fields` 匹配告警结果字段（默认 `["result.appname","result.ip"]`，可换成 `result.hostname` 等任意 `result.*` 字段），再兜底解析 `result.result.complex_value`。实体落空时 `entity_candidates` 会带上分段字段名（如 `appname` / `json.DST_IP`）作为下钻提示。
  - 记录里的裸 `appname` 恒为 `alert_record`（记录自身的应用名，不是被监控系统），命中该值时会被判为无意义实体并跳过。
  - 入参全部可选（共 11 个）：不传 `alert_id` / `alert_name` 即全系统所有监控的最近告警，不需要传 `*` 占位；`levels` 不传即全部级别；`time_range` 默认 `-24h,now`，并兼容 `now-24h,now` 与 epoch 毫秒写法。
  - `alert_name` 默认精确匹配，支持 `*` 通配（`交换机*` 匹配前缀、`*攻击*` 匹配包含）。名称里的空格、斜杠、括号、引号等特殊字符由工具自动转义，调用方无需处理；唯一限制是名称本身含**字面星号**时无法精确匹配，需改用日志检索工具。
  - 查询完全由结构化参数拼装，不开放任意 SPL 注入。
- **HTTP 网关新增上游请求超时配置 `UPSTREAM_TIMEOUT_SECONDS`**（默认 30 秒，TS/Python 同名同默认值）。
- **HTTP 网关新增请求体大小上限 `MCP_HTTP_MAX_BODY_BYTES`**（默认 4MB）；超限时返回 `413 REQUEST_BODY_TOO_LARGE`。
- **HTTP 网关新增 session 空闲回收与数量上限**：`MCP_HTTP_SESSION_IDLE_TTL_SECONDS`（默认 1800）与 `MCP_HTTP_SESSION_MAX_COUNT`（默认 256）。后台每 60 秒先按空闲 TTL 清理、再按数量上限淘汰最旧 session，淘汰时关闭其 transport；`GET /healthz` 新增 `session_count`。

### Changed

- **HTTP 网关的上游请求超时不再受护栏开关影响**：护栏处于 `enforce` 且命中 SPL 执行路径时仍使用 `MCP_GUARDRAIL_EXEC_TIMEOUT_SECONDS`，其余情况统一回退到 `UPSTREAM_TIMEOUT_SECONDS`（默认 30 秒）。
- **TypeScript 网关的 `express.json` 请求体上限由硬编码 4MB 改为读 `MCP_HTTP_MAX_BODY_BYTES`**，与 Python 侧行为对齐。

### Fixed

- **Basic 认证不再注入 `username` query 参数**：此前对所有认证方式都从凭据里拆出 `username` 并附加到请求 URL 上，遇到直接拒绝该参数的日志易版本（Http Basic 部署，返回 `4104 Parameters 中不支持传入 username`）会导致**所有**请求失败。现在只有 `apikey` 认证才派生 `username`（这类部署确实要求把用户名作为 query 参数传入），Basic 认证的身份改从 `Authorization` 头解析结果里读取；显式配置的 `LOGEASE_USERNAME` 仍然优先。

## 0.3.1

### Added

- Streamable HTTP 网关新增固定分钟窗口的工具调用限流，支持全局上限与单工具上限。
- TypeScript、Python 的 Streamable HTTP 网关新增本地 JSON Lines 工具调用日志，支持按文件大小或按天/小时轮转、保留份数清理，并记录成功、错误及限流调用；日志不包含工具参数和结果正文。
- TypeScript、Python 新增统一 SPL 安全评分与执行护栏：递归识别嵌套危险命令，支持 audit/enforce、评分阈值、执行超时、返回条数上限、PII/自定义正则脱敏，并在共享 resource 落盘前应用相同保护。

## 0.3.0

> 同时提供 TS 与 Python 版本的实现。

### Added

- 新增 ChatSPL MCP 服务器（仅限日志易v5.6版本）：专门处理"自然语言 → SPL"与知识库规则管理。

  - `chat_spl`：自然语言描述转 SPL 查询，支持 `deep_think` 深度思考模式（分步思考链、SSE 进度推送）

  - `list_chatspl_rules` / `create_chatspl_rule` / `update_chatspl_rule` / `delete_chatspl_rule` / `delete_chatspl_rules_batch`：知识库规则 CRUD，规则格式为 `{"input":"自然语言描述","output":"SPL语句"}`

- 新增 `rizhiyi_ingest` MCP 服务器，覆盖：

  - Agent 分组管理（list/create/assign/delete）

  - 基于采集项管道的 pipeline 配置管理

  - Agent 只读状态查询（在线离线、心跳、版本等）

- 仪表盘 MCP 新增 `list_dashboards`工具：支持分页列出仪表盘基本信息。

### Changed

- 目录结构整理：TS 源码统一在 `ts/`、Python 源码统一在 `python/`，共享 `config/` 与 `vendor/`，两边独立构建互不干扰。

### Fixed

- `parserrule/verify` 接口：将请求体编码从表单改为 JSON，解决参数被后端拒识导致校验失败的问题。

- 支持通过请求参数传递中文 username：新增 `LOGEASE_USERNAME` 环境变量，配置后会自动作为 query 参数附加到接口 URL 上，解决 auth header 不支持中文用户名的问题。

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

<br />
