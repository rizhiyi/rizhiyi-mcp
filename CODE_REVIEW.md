# rizhiyi-mcp 实现审查报告

审查日期：2026-09-28
审查范围：`ts/src/**`（约 22.5k 行）、`python/rizhiyi_mcp/**`（约 16.5k 行）、`python/tests/**`、构建与配置
审查方式：全量阅读核心链路源码（鉴权、网关、限流、护栏、共享资源、日志、双端业务模块），并做 TS/Python 交叉比对

---

## 一、总体评价

功能覆盖面很完整（9 个 MCP server、87 个工具、护栏/限流/审计日志/共享资源一应俱全），工程化程度明显高于一般内部项目。主要问题集中在三类：

1. **多租户隔离缺失** —— HTTP 网关是多用户共享的，但共享资源没有按用户隔离；
2. **可靠性护栏不完整** —— 超时、body 上限、session 生命周期这几处关键防线在 TS/Python 两端不齐；
3. **双实现已实质漂移** —— "功能对齐"的假设不再成立，维护成本正在转化为线上行为差异。

下面按严重程度分级。每条给出证据（文件:行号）、影响与建议。

---

## 二、高优先级（建议优先修复）

### H1. 共享资源（大结果）无用户隔离，存在跨用户数据泄漏

**证据**
- TS `ts/src/log-tools-server.ts:101-111`：`listSharedResults(sharedResultStoreConfig)` 列出 store 内**全部**结果，无任何过滤。
- TS `ts/src/log-tools-server.ts:113-131`：`readSharedResult(request.params.uri)` 只校验 handle 格式，不校验归属。
- TS `ts/src/types.ts:152-169`：`SharedResultEnvelope` **没有 `route_name` 字段**，所以 TS 端连"按 server 过滤"都做不到。
- Python `python/rizhiyi_mcp/servers.py:303,517` + `shared_result_store.py:136`：`list_shared_results(route_name=...)` 有按 server 过滤；`servers.py:332` 的 `read_resource` 也校验了 `route_name`。
- 但 Python 同样**没有按用户（auth 身份）过滤**。

**影响**
HTTP 网关是多用户共享入口，不同 `Authorization` 对应不同用户。当前任一用户都能：
- 通过 `resources/list` 枚举出他人大结果的 `resource_uri`；
- 通过 `resources/read` 读取其完整内容（日志原文，可能含业务敏感数据）。

TS 端更严重——还额外跨 server 泄漏（log-tools 的列表里会出现 dashboard/alert 的结果）。

**建议**
- envelope 增加 `owner`（来自 `authContext.username` 或凭据指纹）与 `route_name`（TS 需补）；
- `list` 与 `read` 都做 `owner` + `route_name` 双重校验，不匹配时按"不存在"处理，避免探测；
- 或按 `owner` 分目录存储（`storeDir/<ownerHash>/`），物理隔离。

---

### H2. TS 默认没有上游请求超时，工具调用可能永久挂起

**证据**
- `ts/src/config.ts:278-281`：`timeoutMs` 只在 `guardrails.enabled && mode === 'enforce'` 时才赋值；否则 axios `timeout` 为 `0`（= 永不超时）。
- `ts/src/mcp-tool-helpers.ts:205-217`：执行超时（`withTimeout`）同样只在护栏 enforce 模式下生效。
- 对比 Python：`python/rizhiyi_mcp/config.py:70` 有独立默认值 `upstream_timeout_seconds = 30.0`，`servers.py:369-372` 用 `asyncio.wait_for` 兜底。

**影响**
TS 是 README 推荐的默认实现，但默认配置下只要上游不响应，工具调用与对应 HTTP 请求会一直挂着，逐步耗尽连接与 session。护栏是安全特性，不该兼任可靠性开关。

**建议**
- 新增独立的 `UPSTREAM_TIMEOUT_SECONDS`（默认 30s），与护栏解耦，两端保持一致；
- 让 `withTimeout` 无条件生效（护栏只决定阈值）。

---

### H3. Python 网关无请求体大小上限

**证据**
- `python/rizhiyi_mcp/gateway.py:350-359`：`_consume_request_body` 循环读取直到 `more_body` 为假，**全程无上限**。
- 对比 TS：`ts/src/http-server.ts:152` 有 `express.json({ limit: '4mb' })`。

**影响**
单个超大 POST 就能把进程内存打满（DoS）；`tools/call` 的 arguments 也可能异常巨大。

**建议**
增加 `MCP_HTTP_MAX_BODY_BYTES`（默认 4MB），累计超过即中断并返回 413，与 TS 对齐。

---

### H4. HTTP session 无上限、无空闲回收

**证据**
- TS `ts/src/http-server.ts:29` 模块级 `const sessionStore = new Map(...)`；只在 `:186-195` 的 DELETE 分支删除。无 TTL、无数量上限、无定时清理。
- Python `python/rizhiyi_mcp/servers.py:54-56` 的 `session_auth` / `initialize_params` / `initialized_sessions`，仅在 `gateway.py:202-205` 的 DELETE 分支清理。

**影响**
MCP 客户端不主动发 DELETE 是常态，因此每个 session 都会长期驻留（TS 端每个 session 还持有一个完整的 `McpServer` + transport）。长跑必然内存泄漏；恶意方可用大量 `initialize` 快速放大。

**建议**
- 记录 session `lastSeenAt`，加空闲 TTL（如 30 分钟）与最大 session 数；
- 后台定时 GC，超限时淘汰最旧 session 并关闭其 transport；
- `/healthz` 暴露 `session_count`（Python 已有，TS 建议补上）便于观察。

---

### H5. TLS 校验默认关闭，且 SSE 通道硬编码无法开启

**证据**
- TS `ts/src/config.ts:236`：`rejectUnauthorized = parseBooleanEnv(env.LOGEASE_TLS_REJECT_UNAUTHORIZED, false)` —— 默认 false。
- TS `ts/src/client.ts:13`：`config.httpsAgent || new https.Agent({ rejectUnauthorized: false })` —— 又一层不安全兜底。
- TS `ts/src/sse-client.ts:46`：`rejectUnauthorized: false` —— **硬编码**，完全不受环境变量控制。
- Python `python/rizhiyi_mcp/config.py:47` → `http_client.py:16` 的 `verify=config.verify_tls`，默认同样不校验。

**影响**
默认不校验证书意味着中间人可截获 `Authorization`（含 API 凭据）。chatspl 的 SSE 通道在 TS 端更是无论如何都关着校验。

**建议**
- 默认改为开启校验（`true`），确需关闭时启动打印显著告警；
- SSE 客户端复用同一 TLS 配置，去掉硬编码；
- `.env.example` 同步更新说明。

---

## 三、中优先级

### M1. 单个损坏的结果文件会让整个大结果存储不可用

**证据**
- TS `ts/src/shared-result-store.ts:128-138`：`safeReadEnvelope` 只捕获 `ENOENT`，`JSON.parse` 抛错会向上冒泡。
- Python `python/rizhiyi_mcp/shared_result_store.py:202-210`：只捕获 `FileNotFoundError`，`json.loads` 失败同样冒泡。
- 而 `saveSharedResult` 开头就调用 `cleanupExpiredResults`（`shared-result-store.ts:240`；`shared_result_store.py:47`）。

**影响**
一个被写坏（进程被 kill、磁盘满）的 JSON 文件，会导致**之后所有**保存失败、`resources/list` 整体报错。故障面远大于故障本身。

**建议**
解析失败时记录日志并跳过（或移到 `corrupt/` 隔离目录），不中断批量流程。

---

### M2. 大结果清理是 O(N) 全目录扫描，且每次保存都执行

**证据**
- TS `ts/src/shared-result-store.ts:213-234`（`cleanupExpiredResults`）在 `:240`（每次保存）与 `:334`（每次列表）被调用；实现是 `readdir` + 逐个 `readFile` + `JSON.parse`。
- Python `shared_result_store.py:156-168` 同样在 `:47` 每次保存时执行，逐个读取解析。

**影响**
存量结果越多、单个越大，每次工具调用的固定开销越高，延迟随存量线性增长。

**建议**
- 把过期时间编码进文件名（如 `<expiresAtEpoch>-<handle>.json`），清理时只按文件名判断，无需读内容；
- 或改为后台定时清理 + 内存索引，写路径不做全量扫描。

---

### M3. TS 每个 HTTP session 都重建 server，openapi 还会重解析 4 万行 YAML

**证据**
- TS `ts/src/http-server.ts:110`：`const server = await factory(context)` —— 每个新 session 都完整执行一次 server 工厂。
- TS `ts/src/openapi_server.ts:14,25-26`：模块加载期读 YAML，但**每次创建 server** 仍执行 `new Converter()` + `await converter.load(rzySpecs)`。
- `config/Api_5.6_schema.yaml` 有 39,749 行、`Api_5.3_schema.yaml` 有 39,039 行。
- 对比 Python：`gateway.py:287-294` 启动时一次性建好所有 server；`openapi_schema.py:43-51` 用 `@lru_cache` 缓存解析结果。

**影响**
openapi server 每次 initialize 都要解析约 4 万行 YAML，初始化延迟高、CPU 抖动明显；其余 server 也重复做了大量与身份无关的注册工作。

**建议**
把"工具定义/转换结果"提升为进程级缓存（身份无关），per-session 只注入客户端与上下文。

---

### M4. TS SSE 客户端解析存在跨分片丢数据缺陷

**证据**
- `ts/src/sse-client.ts:98-102`：在每个网络分片处理完后，只要 `currentEvent` 有数据就**无条件 flush** 一次事件。而 SSE 规范中事件应由空行界定。
- 若某事件的多个 `data:` 行恰好被 TCP 分片切开：分片 1 末尾会以**不完整** data 触发一次事件并清空 `currentEvent`；分片 2 的剩余 `data:` 行因 `currentEvent === ''` 被静默丢弃。
- 对比 Python `python/rizhiyi_mcp/sse_client.py:92-101`：只在空行处解析（`_parse_sse_block`），行为正确。

**影响**
chatspl `deep_think` 的进度事件与 `send_spl` 输出可能丢失或 JSON 解析失败，最终表现为莫名的 `NO_SPL_GENERATED`。这是端到端行为差异，且难以复现。

**建议**
删除分片末的无条件 flush，仅以空行作为事件边界；补一个"事件跨分片"的单测。

---

### M5. 使用日志每次写入都做两次全目录 stat

**证据**
- TS `ts/src/usage-log.ts:64` → `resolveActiveFile` 调 `listLogFiles()`（`:112-145`，`readdir` + 每文件 `stat`）；`:66` → `cleanupOldFiles` 又调一次（`:148`）。`:76-84` 的 `active` 缓存检查发生在 `listLogFiles()` **之后**，等于没省。
- Python `python/rizhiyi_mcp/usage_log.py:87,151` 同样两次 `_list_log_files()`，且每次 `write` 都经 `asyncio.to_thread` 提交线程池（`:68`）。

**影响**
高频工具调用场景下，审计日志写入会成为吞吐瓶颈。

**建议**
缓存文件清单并按目录 mtime 失效；清理降频（每 N 次或每 60s 一次）；Python 端考虑批量写入。

---

### M6. 被限流拒绝的调用仍然计数

**证据**
- `ts/src/rate-limiting.ts:58-79`：先 `globalCount += 1` / `toolCount += 1`，再判断是否超限。
- `python/rizhiyi_mcp/rate_limiting.py:77-95`：同样先自增后判断。

**影响**
持续超限时计数只增不减，`remaining` 恒为 0，`retry_after_seconds` 计算偏乐观；全局窗口下会放大对正常调用的误伤。

**建议**
先判断后计数，或在拒绝分支回滚计数。

---

### M7. 工具注解靠命名前缀推断，存在误标

**证据**
`ts/src/tool-annotations.ts:3-33` 的 `READ_ONLY_PREFIXES` / `MUTATING_PREFIXES`：
- `assign_agent_to_group` 不匹配任何 mutating 前缀（列表里只有 `add_`，没有 `assign_`）→ 落入默认分支，`destructiveHint: false`；
- `preview_alert`、`apply_fieldconfig` 同样落入默认分支；
- `generate_` 被列为只读前缀，若将来出现真正写盘的 `generate_*` 工具，会被错误标记为 `readOnlyHint: true`。

**影响**
客户端会依据 annotations 做确认与权限决策（例如只读工具免确认），误标会带来错误的交互甚至误操作。

**建议**
改为在工具定义里显式声明 annotations，前缀推断仅作兜底并补测试锁定。

---

### M8. TS 与 Python 已出现多处行为漂移

**证据**（交叉比对结果）
| 维度 | TypeScript | Python |
|---|---|---|
| 自动时间桶档位 | 12 档（`modules/time-utils.ts:51-66`） | 6 档（`log_tools_business.py:1887-1901`） |
| Z-score 最小样本 | ≥3 点（`modules/series-analysis.ts:172`） | ≥2 点（`log_tools_business.py:1940`） |
| 置信区间 t 值 | 固定 1.96（`modules/statistics.ts:653`） | 按 confidence 取 1.96/1.64/1.28（`log_tools_business.py:2058`） |
| 滑动平均 window>len | 返回 forecast=0（`statistics.ts:551-553`） | window 收敛到 len（`log_tools_business.py:2007`） |
| trend_summary 输出 | peaks/anomalies 无 `timestamp` | 含 `timestamp`（`log_tools_business.py:229-246`） |
| values[0]==0 的 changeRate | NaN/Inf（`statistics.ts:265`） | 0（`log_tools_business.py:217`） |
| 仪表盘尺寸下限 | h>0（`dashboard/aesthetics.ts:90-91`） | h≥2（`dashboard_aesthetics.py:78-79`） |

**影响**
同一句自然语言，在 TS 版与 Python 版会得到不同的数值、异常判定与图表；用户无从预期，回归测试也拦不住（两端各测各的）。

**建议**
- 明确指定一端为参考实现，另一端以"对齐测试"约束；
- 把可参数化的部分（时间桶表、t 值表、评分权重、阈值）抽到共享 JSON/YAML，两端读取同一份；
- 为关键算法补跨实现一致性测试（同输入 → 同输出）。

**修复状态：已修复**

单一时序事实来源落在 `config/analysis-constants.yaml`，两端各自有薄加载层
（`ts/src/modules/analysis-constants.ts` / `python/rizhiyi_mcp/analysis_constants.py`），
所有阈值、默认值、档位表都从这里读，不再各自硬编码。

| 上表漂移项 | 采用基准 | 处理方式 |
|---|---|---|
| 自动时间桶档位 | TS 的 12 档 | 抽到 YAML，Python 的 6 档实现删除 |
| Z-score 最小样本 | TS 的 ≥3 | 抽到 YAML，Python 的 ≥2 改为读常量 |
| 置信区间 z 值 | Python 的 1.96/1.64/1.28 | 抽到 YAML，TS 的固定 1.96 改为按 confidence 取值 |
| 滑动平均 window>len | Python 的收敛到 len | 抽到 YAML，TS 的"返回 0"改为收敛 |
| trend_summary 的 timestamp | Python 的含 timestamp | TS 补齐 peaks/anomalies 的 `timestamp` |
| changeRate 的零值保护 | Python 的返回 0 | TS 加 `abs(values[0]) > 1e-9` 守卫 |
| 仪表盘尺寸下限 | Python 的 h≥2 | 抽到 YAML，TS 的 h>0 改为统一归一化 |

修复过程中另外发现并一并收敛的 5 处漂移：

1. **`bucket` 默认值在一端根本没生效**：两端 schema 都声明 `default: "5m"`，但 TS 经 Zod
   `.default()` 真正生效、Python 不经过 Zod 因而走自动选桶——同一句调用在两端会选中不同粒度。
   最终处理：**把两端 6 个时序工具的 `default: "5m"` 一并删除，统一走按 `time_range` 的自适应选桶**
   （该默认值本身是设计缺陷：默认时间窗 `now-15m,now` 下固定 `5m` 只能取到 3 个数据点，
   恰好把那张 12 档表旁路掉了）。现在 15 分钟 → `30s`（≈30 点）、1 小时 → `1m`（60 点）、
   24 小时 → `30m`（48 点）、7 天 → `6h`（28 点）。schema 描述同步改为
   "不传则按 time_range 自动选择"。原 `defaults.timechart_bucket` 配置项随之删除。
2. **浮点格式化不一致**：`str(float)` 语义（`3` → `"3.0"`）两端不同，导致异常原因文本肉眼可见地不同。
   TS 新增 `formatPythonFloat`，Python 新增 `_format_float`，共用同一套黄金用例。
3. **定点舍入不一致**：JS `toFixed` 是"四舍五入（远离零）"，Python `f"{v:.Nf}"` 是
   "四舍六入五成双"，`13.625` 会分别得到 `13.63` / `13.62`，直接体现在趋势摘要里。
   TS 新增 `formatFixed`（`Intl.NumberFormat` + `roundingMode: 'halfEven'`）复刻 Python 行为。
4. **`alert_reasons` 语义矛盾**：Python 在未告警时也返回原因列表（`alert_triggered=false`
   却带 reasons），已改为仅在告警触发时返回，与 TS 一致。
5. **第三份 Z-score 实现**：`ts/src/modules/anomaly-detection.ts` 里另有一份硬编码
   （`counts.length < 3` + `threshold = 2.0`）的 `detectStatisticalAnomalies`，
   已改为复用 `series-analysis.detectStatisticalAnomalies`。

护栏：`ts/scripts/analysis-parity-test.mjs`（`npm run test:analysis-parity`）与
`python/tests/test_analysis_constants.py` 读取同一份黄金文件
`config/analysis-parity.golden.json`，覆盖四层：

- 共享常量层：74 个采样点（每档边界与边界 +1ms、置信度分档、窗口收敛、panel 归一化）；
- 格式化层：`str(float)` 语义与定点舍入（含 `13.625` 这类中点值）；
- **schema 契约层**：6 个时序工具的 `bucket` 是否声明默认值 / 是否必填，防止默认值被单侧加回；
- 业务输出层：trend_summary / anomaly_points（zscore+iqr）/ trend_forecast（三种方法）/
  anomaly_alert（自适应未触发、自适应已触发、预测区间）逐字段比对。

任一端偏离都会让两侧测试同时变红。

---

## 四、低优先级（工程化与细节）

### L1. 无 CI，且测试依赖被 gitignore 的夹具 → 测试不可复现
- 仓库无 `.github/`（无任何 CI 配置）。
- `python/tests/support.py:26` 从 `api-responses/` 读取夹具，而 `.gitignore` 忽略了 `api-responses/` 与 `docs/`（`git ls-files api-responses` = 0）。
- 受影响测试：`test_gateway.py`、`test_log_tools_business.py`、`test_parserrule_service.py`、`support.py`（共 4 个文件引用夹具）。
- **影响**：干净克隆后 Python 测试套件跑不起来；TS 侧则完全没有单元测试（只有 `ts/scripts/*.mjs` 手动冒烟脚本）。
- **建议**：把最小必要夹具纳入版本控制（或提供生成脚本并在 CI 中先执行），并接入 CI（build + ruff + pytest + ts 类型检查）。

### L2. 文档指向未纳入版本控制的文件
- README、`ts/.env.example:47`、`python/.env.example` 都引用 `docs/research-spl-guardrails-risky-commands.md`，但 `docs/` 被 gitignore。
- **建议**：将设计文档纳入仓库，或迁移到 wiki 并同步更新链接。

### L3. DNS rebinding 默认值与文档自相矛盾
- `python/rizhiyi_mcp/config.py:56-58`：开关默认关闭，但 `mcp_allowed_hosts` 默认 `["*"]`；而 `python/.env.example` 明确写"allowed_hosts 不支持 `*` 全通配"。
- **影响**：用户只开开关、不覆盖 `MCP_ALLOWED_HOSTS`，会拿到一个无效通配，请求可能全被拒。
- **建议**：默认值改为空列表或具体 host；开启开关时做一致性校验并给出明确报错。

### L4. TS 的 DELETE session 端点不校验 Authorization
- `ts/src/http-server.ts:179-196`：只要求 `mcp-session-id`，不校验身份即可关闭任意 session。
- **建议**：DELETE 也要求并校验 Authorization，且与 session 绑定身份一致。

### L5. 内部错误信息直接回给客户端
- TS `ts/src/http-server.ts:137`：`sendJsonError(res, 500, 'MCP_HTTP_ERROR', error?.message)` 原样透出异常消息。
- Python `python/rizhiyi_mcp/servers.py:214-224`：把任意异常 `str(exc)` 回给调用方。
- **建议**：对外返回通用文案 + 关联 ID，细节只写服务端日志。

### L6. 死代码与未使用资源
- `ts/src/log-tools-server.ts:91` 注册了 `data_overview` 的 handler，但 `ts/src/tools.ts` 中**没有**该工具定义 → 永远不会被调用。
- `vendor/mcp2skill/`（312 个受版本控制的文件，含 LICENSE/Makefile/.venv 残留）与运行时代码无任何引用。
- **建议**：删除死 handler；vendor 改为 git submodule 或 dev 依赖。

### L7. TS 无 ESLint/Prettier，类型严格度被 `any` 稀释
- `ts/` 无 eslint/prettier 配置；Python 侧有 ruff（`pyproject.toml`）。
- `ts/src` 中 `as any` 大量出现（`modules/alerts.ts` 24 处、`manage-server.ts` 9 处、`modules/dashboard.ts` 6 处等），削弱了 `strict: true` 的收益。
- **建议**：接入 eslint + `@typescript-eslint/no-explicit-any`（warn 起步），逐步收敛。

### L8. Python 的会话初始化补丁较脆弱
- `python/rizhiyi_mcp/gateway.py:153-161,214-236`：当客户端未发 `notifications/initialized` 时，网关**伪造**该通知并再次调用 `session_manager.handle_request`。
- **影响**：多一次内部请求，且依赖 SDK 内部行为，升级 `mcp` 包易失效；同时掩盖了客户端不合规问题。
- **建议**：改为在 SDK 层处理或明确要求客户端补发，并用测试锁定行为。

### L9. 其他细节
| 位置 | 问题 |
|---|---|
| `ts/src/auth-header.ts:25-29` | `Buffer.from(x,'base64')` 不会因非法 base64 抛错，该 try/catch 是死代码（Python 用了 `validate=True` 才有意义） |
| `ts/src/config.ts:266-270` | `createHttpsAgent` 每次请求新建 Agent，无法复用连接池 |
| `ts/src/http-server.ts` | 未设置 `trust proxy`，反向代理后 `req.ip` 恒为代理地址，影响审计与按 IP 限流 |
| `ts/src/usage-log.ts:21,24` / `python/.../usage_log.py:30,33` | 字段命名混用 camelCase（`serverName`/`routeName`）与 snake_case |
| `ts/src/client.ts:199-228` | `pollUntilComplete` 固定间隔轮询，忽略上游 `Retry-After` |
| `ts/src/mcp-tool-helpers.ts:210-217` | 超时判定依赖 `routeName === 'log-tools'` 硬编码，新增 server 易漏 |

---

## 五、建议的修复顺序

| 阶段 | 内容 | 理由 |
|---|---|---|
| 第 1 批 | H1（资源隔离）、H5（TLS 默认） | 直接的安全风险，且改动局部 |
| 第 2 批 | H2（TS 超时）、H3（Python body 上限）、H4（session 回收） | 可用性/稳定性底线，防止线上雪崩 |
| 第 3 批 | M1、M2（存储健壮性与性能）、M4（SSE 丢数据）、M3（openapi 缓存） | 直接影响正确性与延迟 |
| 第 4 批 | M8（双实现漂移）+ L1（CI/夹具） | 先把"能自动发现差异"的能力建起来，再谈收敛 |
| 第 5 批 | M5、M6、M7 与全部 L 项 | 优化与工程化收尾 |

> 其中 **M8 + L1 是杠杆最大的一项**：当前双实现已漂移出 7 处以上行为差异，却没有任何机制能自动发现。建议优先建立共享常量 + 跨实现一致性测试 + CI，否则后续每一处修复都会在两端各写一遍，并继续产生新的漂移。
