# H2/H3/H4 + M1–M7 依赖分析与 worktree 并发方案

分析日期：2026-09-28
范围：`CODE_REVIEW.md` 中的 H2、H3、H4、M1–M7 共 10 条
结论：**推荐并发 5 个 worktree；上限 7 个**（需先落"配置契约"提交）

---

## 一、每条发现的文件足迹

行号基于当前工作树（含 M8 未提交改动）。

| 编号 | TypeScript 侧 | Python 侧 | 对称性 |
|---|---|---|---|
| **H2** | `config.ts` L275-282（`createHttpClientConfig`，`timeoutMs` 受护栏门控）、`mcp-tool-helpers.ts` L205-217（`withTimeout` 同样门控） | `config.py` L70 + L219（`upstream_timeout_seconds` 已存在且已在 HTTP 客户端层生效）、`servers.py` L365-372（`asyncio.wait_for` 仍受护栏门控） | **不对称**：Python 客户端层已有 30s 兜底，仅工具执行层仍门控；TS 两层都没有 |
| **H3** | 无（`http-server.ts:152` 硬编码 `'4mb'` 已存在） | `gateway.py` L350-359（`_consume_request_body`）、`config.py`（新增 `mcp_http_max_body_bytes`） | TS 仅需把硬编码值改为读配置（可选对齐） |
| **H4** | `http-server.ts`（`sessionStore` L29、`handleMcpRequest` L88-140、`/healthz` L154-170、DELETE L179-196）、`config.ts`（新增 TTL/max 配置） | `servers.py` L50-57（`ServiceRuntimeState`）、`gateway.py` L202-205（DELETE 清理，需补 lastSeen + GC）、`config.py` | 两端都要动，且都落在"网关主文件"上 |
| **M1** | `shared-result-store.ts` L128-138（`safeReadEnvelope`） | `shared_result_store.py` L202-210（`_safe_read_envelope`） | 对称 |
| **M2** | `shared-result-store.ts` L213-234（`cleanupExpiredResults`，调用点 L240 / L334） | `shared_result_store.py` L156-168，调用点 L47 | 对称 |
| **M3** | `openapi_server.ts` L25-26（`new Converter()` + `converter.load()`）；全量方案另需各 `*-server.ts` 工厂 + `http-server.ts:110` | 无（`openapi_schema.py` 已 `lru_cache`，`gateway.py:287` 已启动期一次性构建） | TS-only |
| **M4** | `sse-client.ts` L98-102（分片末无条件 flush） | 无（`sse_client.py` L92-101 行为正确） | TS-only，Python 仅补回归测试 |
| **M5** | `usage-log.ts`（`UsageLogger` L45+，`resolveActiveFile` / `cleanupOldFiles` / `listLogFiles`） | `usage_log.py` L87 + L151（两次 `_list_log_files()`）、L68（每次 `asyncio.to_thread`） | 对称 |
| **M6** | `rate-limiting.ts`（`FixedWindowRateLimiter.consume` L58-79） | `rate_limiting.py` L77-95 | 对称 |
| **M7** | `tool-annotations.ts` L3-33；若走"工具定义显式声明"路线还需 `tools.ts` | 无对应机制 | TS-only |

---

## 二、文件级冲突矩阵

只有 8 个文件出现"多发现争用"，其余全部独占。

| 文件 | 争用的发现 | 争用度 |
|---|---|---|
| `ts/src/config.ts` | H2、H3\*、H4 | 3 |
| `python/rizhiyi_mcp/config.py` | H2、H3、H4 | 3 |
| `ts/src/http-server.ts` | H3\*、H4、M3\* | 3 |
| `python/rizhiyi_mcp/gateway.py` | H3、H4、M3（只读） | 2 写 |
| `python/rizhiyi_mcp/servers.py` | H2、H4 | 2 |
| `ts/src/mcp-tool-helpers.ts` | H2、M7\* | 2 |
| `ts/src/shared-result-store.ts` | M1、M2 | 2 |
| `python/rizhiyi_mcp/shared_result_store.py` | M1、M2 | 2 |
| `sse-client.ts` / `usage-log.*` / `rate-limiting.*` / `tool-annotations.ts` | 各自独占 | 0 |

`*` 表示仅在全量/显式声明路线下才触碰；走最小方案则不计入冲突。

**关键结论**：冲突集中在两组——`{H2, H3, H4}`（配置面 + 网关）和 `{M1, M2}`（共享存储）。M3 / M4 / M5 / M6 / M7 彼此之间、以及与上面两组之间，均**零文件重叠**。

---

## 三、依赖关系

### 真依赖（必须串行）

1. **M2 → M1**。M2 若采用"过期时间编码进文件名"的方案，会改动文件名约定（`buildFilePath` / `isActiveEnvelopeFileName`），M1 的容错读取必须建立在同一约定之上。同一 worktree 内 **M2 先行**。
2. **M3（全量方案）→ H4**。若 M3 要缓存"身份无关的工具定义/转换结果"，最自然的挂载点是 H4 引入的 session 管理器。走**最小方案**（缓存落在 `openapi_server.ts` 内部）则完全独立，推荐走最小方案。
3. **H2 / H3 / H4 共享 config 契约**。严格说这是"冲突"而非"依赖"，但工程上等价于串行——三者都要往同一对 config 文件加键。

### 伪依赖（同文件但不必串行）

- **M1/M2 与 H1**：H1 会改 `SharedResultEnvelope`（加 `owner` / `route_name`）与存储布局（`ownerHash` 子目录），直接冲击 M1/M2 的两个文件。建议 **M1/M2 先落地**，或让 H1 直接吸收 M1/M2。H1 不在本批，但排期时要留意。
- **H2 与 M7**：都碰 `mcp-tool-helpers.ts`，但 H2 改 `withTimeout` 调用点（L205-217），M7 改 `registerToolDefinitions` 的注解参数（L130-152），相距 50+ 行，非相邻 hunk，合并风险低。M7 走"`tool-annotations.ts` 内部显式覆盖表"路线则完全不碰该文件。

---

## 四、并发方案

### 推荐：5 个并发 worktree

| worktree | 分支 | 承载 | 独占文件 | 内部顺序 |
|---|---|---|---|---|
| `wt-http-guard` | `fix/http-guard` | H2 + H3 + H4 | `config.{ts,py}`、`http-server.ts`、`gateway.py`、`servers.py` | H2 → H3 → H4 |
| `wt-store` | `fix/shared-store` | M1 + M2 | `shared-result-store.{ts,py}` | M2 → M1 |
| `wt-openapi` | `perf/openapi-cache` | M3 | `openapi_server.ts` | — |
| `wt-sse` | `fix/sse-fragmentation` | M4 | `sse-client.ts` | — |
| `wt-limits` | `fix/limits-annotations` | M5 + M6 + M7 | `usage-log.{ts,py}`、`rate-limiting.{ts,py}`、`tool-annotations.ts` | 三者互不相干 |

五个 worktree 之间**没有任何文件重叠**，可全程并行、无需 rebase 协调。

### 上限：7 个 worktree

先落一个**"配置契约"提交**（把 `UPSTREAM_TIMEOUT_SECONDS`、`MCP_HTTP_MAX_BODY_BYTES`、`MCP_HTTP_SESSION_IDLE_TTL_SECONDS`、`MCP_HTTP_SESSION_MAX_COUNT` 四个键连同解析、校验、默认值一次性加到两端 config），随后 H2 / H3 / H4 可拆成三枝：

| worktree | 承载 | 独占文件 |
|---|---|---|
| `wt-h2` | H2 | `mcp-tool-helpers.ts`、`config.ts::createHttpClientConfig`、`servers.py` |
| `wt-h3` | H3 | `gateway.py::_consume_request_body` |
| `wt-h4` | H4 | `http-server.ts`、`servers.py`、`gateway.py::DELETE 分支` |
| `wt-store` | M1 + M2 | `shared-result-store.{ts,py}` |
| `wt-openapi` | M3 | `openapi_server.ts` |
| `wt-sse` | M4 | `sse-client.ts` |
| `wt-limits` | M5 + M6 + M7 | `usage-log.*`、`rate-limiting.*`、`tool-annotations.ts` |

注意 `wt-h3` 与 `wt-h4` 仍共享 `gateway.py`（相距约 150 行，非相邻 hunk，合并风险可控），`wt-h2` 与 `wt-h4` 共享 `servers.py`。合并时按 `wt-h4 → wt-h2 → wt-h3` 顺序 rebase 可把冲突面降到最低。

---

## 五、执行前提

**当前工作树有 M8 的未提交改动**（10 个 `M` + 7 个 `??`）。worktree 从 commit 派生，未提交内容不会带过去，所以必须先提交 M8。

```bash
cd /Users/rizhiyi/Downloads/gitdir/rizhiyi-mcp

# 0. 先固化 M8
git add -A
git commit -m "fix(parity): 收敛 TS/Python 双实现漂移，建立单一常量源与黄金文件校验"

# 1. 派生五个 worktree（兄弟目录，避免嵌套）
git worktree add ../wt-http-guard -b fix/http-guard
git worktree add ../wt-store      -b fix/shared-store
git worktree add ../wt-openapi    -b perf/openapi-cache
git worktree add ../wt-sse        -b fix/sse-fragmentation
git worktree add ../wt-limits     -b fix/limits-annotations

# 2. 每个 worktree 各自准备依赖（不要跨树共享 node_modules）
for d in wt-http-guard wt-store wt-openapi wt-sse wt-limits; do
  (cd "../$d/ts" && npm ci)
done
```

---

## 六、各 worktree 的验证命令

TS 侧（任一 worktree）：

```bash
cd ts
npm run build
npm run test:analysis-parity     # 黄金文件双实现对齐
npm run test:http-smoke          # wt-http-guard / wt-openapi 必跑
npm run test:rate-limit          # wt-limits 必跑
npm run test:usage-log           # wt-limits 必跑
npm run test:guardrails          # wt-http-guard 必跑
```

Python 侧：

```bash
cd python
python -m pytest tests -q --basetemp=.pytest-tmp-check
```

`--basetemp` 是沙箱环境绕过 `pytest-of-unknown` 目录权限问题所需，非代码问题。

---

## 七、一句话总结

真正耦合的只有 `{H2, H3, H4}`（配置面 + 网关）和 `{M1, M2}`（共享存储）两组；M3 / M4 / M5 / M6 / M7 彼此以及与这两组之间零重叠。因此 **5 个 worktree 是收益/成本最优点**，先落配置契约则可开到 **7 个**。
