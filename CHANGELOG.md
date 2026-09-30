# Changelog

## Unreleased

## 0.4.0

> 本版本围绕「性能优化」主题展开。除新增 `get_triggered_alerts` 工具外，大量改动来自 Codex 的系统性审查与改进。
>
> 升级提示：所有 log-tools 工具的 `index_name` 入参已移除（见 Fixed）；TypeScript 独立 `openapi_server` 已废弃（见 Deprecated）；新增 4 个网关配置与 8 个分析类配置，未显式配置时全部使用安全默认值，无需改动现有部署。

### Added

- 新增 `get_triggered_alerts`：数据来自告警执行历史 `index=monitor appname:alert_record`，默认只看最近 24h 内真正触发的记录（`'issue_alert':true AND NOT 'is_recovery':true`），逐条返回六要素：告警名称、触发时间、实体、触发级别、触发值、事件描述。
  - 实体优先取分组字段：当 `result.is_segmentation=true` 时，`result.segmentation_field` 是实体字段名、`result.segmentation_specify_value` 是实体字段值；否则按调用方传入的 `entity_fields` 匹配告警结果字段（默认 `["result.appname","result.ip"]`，可换成 `result.hostname` 等任意 `result.` 字段），再兜底解析 `result.result.complex_value`。实体落空时 `entity_candidates` 会带上分段字段名（如 `appname` / `json.DST_IP`）作为下钻提示。
  - 入参全部可选（共 11 个）：不传 `alert_id` / `alert_name` 即全系统所有监控的最近告警，不需要传 `` 占位；`levels` 不传即全部级别；`time_range` 默认 `-24h,now`，并兼容 `now-24h,now` 与 epoch 毫秒写法。
  - `alert_name` 默认精确匹配，支持 `` 通配（`交换机` 匹配前缀、`攻击` 匹配包含）。名称里的空格、斜杠、括号、引号等特殊字符由工具按日志易自身的转义规则自动转义，调用方无需处理；唯一限制是名称本身含字面星号时无法精确匹配，需改用日志检索工具。
  - 查询完全由结构化参数拼装，不开放任意 SPL 注入。
- HTTP 网关新增上游请求超时配置 `UPSTREAM_TIMEOUT_SECONDS`（默认 30 秒）。
- HTTP 网关新增请求体大小上限 `MCP_HTTP_MAX_BODY_BYTES`（默认 4MB）；超限时返回 `413 REQUEST_BODY_TOO_LARGE`。
- HTTP 网关新增 session 空闲回收与数量上限：`MCP_HTTP_SESSION_IDLE_TTL_SECONDS`（默认 1800）与 `MCP_HTTP_SESSION_MAX_COUNT`（默认 256）。两端记录 session 最近活跃时间并在每次请求命中时刷新；后台 GC 每 60 秒执行，优先级明确为先按空闲 TTL 清理、再按数量上限淘汰最旧 session，新 session 注册时也会立即做一次数量淘汰，避免两次 GC 之间无界增长。`GET /healthz` 新增 `session_count`。
- log-tools 新增查询缓存，按 `timechart` / `overview` / `fields` / `field_values` / `sample_rows` / `exact_count` 分类设置 TTL（默认 30s / 30s / 60s / 30s / 15s / 15s），合并同 key 的并发请求，缓存键按上游身份（`username` + `Authorization`）隔离；TTL 由 `MCP_QUERY_CACHE__TTL_SECONDS` 调整，`MCP_QUERY_CACHE_LOGGING=true` 打开调试日志。
- log-tools 新增受控并发开关 `MCP_ANALYSIS_MAX_CONCURRENCY`（默认 4、上限 8）：字段分布漂移、可疑切片精确验证、`period_compare` 字段对比改为受控并发，不再串行等待。
- log-tools 的 server instructions，重写为「意图路由 / 默认执行策略 / 分析深度 / 停止条件 / 结果交付」六节；各工具描述追加 `analysisGuidance`，显式约束模型不要为求「完整」而调用全部分析工具。
- `root_cause_suggestions` 新增 `max_candidates`（默认与上限均为 6）：用户显式传入的 `candidate_fields` 同样受限，避免单次根因分析打出几十个字段的无效上游查询。
- `log_reduce_preview` 轮询新增 deadline 模式：新增 `deadline_ms`（默认 30s）与指数退避（首次 1s、上限 8s）；超时后返回 `sid` 与 `job_status` 供后续继续查询，不再无限轮询。

### Changed

- 大结果共享存储的过期判定改走文件名快路径：文件名统一为 `<expiresAtEpochMilliseconds>-<handle>.json`，只比对文件名即可判定过期。
- `root_cause_suggestions` 的字段推断改用 `log_search_sheet` 样例行（不再全量 `list_fields`），响应新增 `sample_based` 与 `query_budget` 明确该结论来自采样而非全量字段表；候选字段自动过滤 `trace` / `span` / `session` / `url` / `message` 等高基数噪声字段，可疑切片的精确验证从 `max(10, topk3)` 收敛到 3~5 个候选。
- 共享资源复用前校验 `result_kind`：类型不匹配时返回 `RESOURCE_KIND_MISMATCH` 并说明实际类型、期望类型与修正建议，不再退化成误导性的「未找到数据」；`read_shared_result` / `listSharedResults` 改为按 `route_name` 隔离，跨 route 访问按不存在处理。资源响应补上 `source_query` / `time_range`，资源描述带上类型、工具与摘要。
- SSE 解析两端统一为宽松容错语义：TS 抽出可测试的纯解析器 `SseParser`，把行缓冲 / 当前事件名 / 当前 data 行提升为实例字段使解析状态跨分片保持，仅在空行与流结束时产出事件（删除「分片末无条件 flush」）；同时处理 `\r\n` 与 `\n` 两种换行（含切在 `\r` 与 `\n` 之间）。Python 侧 `_parse_sse_block` 由返回单个事件改为返回列表，补上「新的 `event:` 行即产出上一个 pending 事件」的隐式事件边界与 EOF flush，并保持孤儿 `data` 行干净丢弃。
- 工具注解改为显式覆盖表优先：新增按工具名 keyed 的 `TOOL_ANNOTATION_OVERRIDES`，命名前缀推断降为兜底。`chat_spl` / `preview_alert` / `generate_parserrule_draft` 显式标为只读；`testrun_alert` 标为非只读且非破坏（会真实发通知）；`replace_pipeline_groups` / `gencode_callapi` 标为破坏性写入。同时把语义过宽的 `generate_` 与 `data_` 移出只读前缀，避免未来出现写盘的同前缀工具被误标。
- 使用日志写入不再每次做两次全目录扫描：文件清单按「目录 mtime」缓存失效（外部进程新建/删除文件会改变目录 mtime 从而被及时发现，同一文件追加不改变目录 mtime，故稳态写入零 `readdir` + 零 `stat`），追加后同步更新缓存中的文件大小以免快路径按过期大小突破 `rotateBytes`；`active` 缓存检查提前到目录扫描之前；清理降频为「存在超额文件时立即清理，否则最多每 50 次写入或每 60s 一次」以保住 `keepFiles` 语义。保留「先写盘再返回」以保证崩溃时不丢审计日志。
- openapi 工具定义改为进程级缓存：消除每个 HTTP session 重解析约 4 万行 `Api_5.3_schema.yaml` 的开销。

### Deprecated

- TypeScript 独立 `openapi_server` 标记废弃：`openapi2mcptools` 0.0.3 对约 17 处请求体属性产出了布尔型 `required`（JSON Schema 要求数组），导致注册工具时必抛 `TypeError: boolean true is not iterable`（`ts/src/mcp-tool-helpers.ts`）。已从 `mcp-stdio.json.example`、`mcp-http.json.example` 与 README 的 server 列表中移除；TypeScript 侧请改用 Python HTTP 版的 `openapi` 路由。

### Fixed

- Basic 认证不再注入 `username` query 参数：此前对所有认证方式都从凭据里拆出 `username` 并附加到请求 URL 上，遇到直接拒绝该参数的日志易版本（Http Basic 部署，返回 `4104 Parameters 中不支持传入 username`）会导致所有请求失败。现在只有 `apikey` 认证才派生 `username`（这类部署确实要求把用户名作为 query 参数传入），Basic 认证的身份改从 `Authorization` 头解析结果里读取；显式配置的 `LOGEASE_USERNAME` 仍然优先。
- 移除全部 log-tools 工具的 `index_name` 入参：此前把 `datasets` 当成 `index_name` 传了下去，而上游 API 根本不支持 `index_name`，日志易 5.8 起安全加固会严格校验传参。
- 补齐 `data_overview` 工具的定义与实现：此前 TS 侧注册了 handler 却没有对应的 `ToolDefinition`。
- 限流改为「先判断后计数」：被拒绝的调用不再占用配额。
- SPL 护栏在 stdio 方式下实际生效：此前 stdio 启动的 server 缺少 `routeName`，导致护栏的按路由配置完全不生效。
- 损坏的共享结果文件不再拖垮整个存储：`safeReadEnvelope` 由「只捕获 ENOENT」改为不存在 / 权限 / 解析失败 / envelope 结构校验失败一律返回空而不抛异常，并把坏文件移入 `storeDir/corrupt/` 隔离（隔离失败仅记日志），避免每次扫描重复报错。
- TS SSE 客户端跨分片丢数据：解析器把「当前事件名 / 当前 data 行」声明在 `res.on('data')` 回调内部并在每个网络分片后无条件 flush，而 SSE 规范中事件由空行界定、分片边界与事件边界无关——分片 1 末尾的不完整 `data` 会提前产出一个事件并清空状态，分片 2 剩余的 `data` 行因状态已清空被静默丢弃。表现为 `chat_spl` 的 `deep_think` 进度事件丢失、`send_spl` 输出缺失，最终莫名 `NO_SPL_GENERATED`。同时修掉两个同类缺陷：EOF 时行缓冲中未以换行结尾的残余行被丢弃、TS 侧 `currentDataLines` 在无事件名的空行处跨空行残留。
- TS / Python 双实现行为漂移系统性收敛（统一到 `config/analysis-constants.yaml` 单一常量源）：
  - 自动时间桶档位 TS 12 档 / Python 6 档 → 统一 12 档；
  - Z-score 最小样本 TS ≥3 / Python ≥2 → 统一 ≥3；
  - 置信区间 z 值 TS 固定 1.96 / Python 按 `confidence` 取值 → 统一按档位取值；
  - 滑动平均 `window > len` 时 TS 返回 0 / Python 收敛到 `len` → 统一收敛到 `len`；
  - `trend_summary` 输出的 `peaks` / `anomalies` 是否含 `timestamp` → 统一含；
  - `changeRate` 在 `values[0] == 0` 时 TS 得 `NaN`/`Inf` / Python 得 0 → 统一为 0；
  - 仪表盘 panel 尺寸下限 TS `h > 0` / Python `h ≥ 2` → 统一下限。

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
