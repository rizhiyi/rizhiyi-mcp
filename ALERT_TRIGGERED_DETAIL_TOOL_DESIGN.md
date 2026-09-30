# 告警服务新增工具设计：`get_triggered_alerts`（已触发告警详情）

- 设计日期：2026-09-29
- 目标服务：`alert`（`rizhiyi_alert_server` / `create_alerts_server`）
- 双端实现：`python/rizhiyi_mcp/service_alerts.py` + `ts/src/modules/alerts.ts`（含工具定义与 handler 注册）
- 状态：**已实施并双端验收通过**（2026-09-30 落码；在两套日志易环境上验证——`172.21.16.9` apikey 与
  `192.168.43.196` Basic；验收结论见 §8，实施清单见 §11，风险见 §10）

---

## 一、背景与目标

告警服务目前只覆盖**监控配置**的 CRUD / 预览 / 试跑，没有任何"告警发生后"的读取能力。用户想知道
"最近哪些告警真的触发了、什么时候触发、级别多高、值是多少、涉及哪些实体"，只能自己去日志检索里拼 SPL。

日志易没有提供"已触发告警列表"的专门 API，但监控执行历史会落到固定索引：

```
index=monitor appname:alert_record
```

因此新增一个工具：**通过 `search/sheets` 查询该索引，把原始执行记录规整成"已触发告警详情"列表**。

### 目标输出（每条已触发告警）

| 字段 | 含义 |
|---|---|
| `alert_name` | 告警名称 |
| `trigger_time` / `trigger_time_ms` | 触发时间（ISO8601 + 毫秒时间戳） |
| `entities` | 可能涉及的实体（默认告警结果字段 `result.appname` / `result.ip`，可用 `entity_fields` 自定义） |
| `level` | 触发级别 |
| `value` | 触发时的统计值 |
| `description` | 事件描述 |

### 非目标

- 不做告警配置的增删改（已有 `create_*` / `update_alert`）。
- 不做通知渠道、抑制策略的管理。
- 不替代 `log-tools` 的通用检索能力（复杂分析仍走 `log_search_sheet`）。

---

## 二、现状调研（已在真实环境验证）

调研覆盖**两套日志易部署**，避免只按单一版本的脾气写死：

| 环境 | 地址 | 认证 | 特点 |
|---|---|---|---|
| env1 | `http://172.21.16.9` | `Authorization: apikey tmp:<secret>`（与 `python/rizhiyi_mcp/auth.py` 的 `_parse_apikey_authorization` 一致） | 要求**同时**把 `username` 作为 query 参数传入；`now-24h,now` 与 `-24h,now` 都接受；**不支持** Http Basic |
| env2 | `https://192.168.43.196` | Http Basic（`admin:***`） | **拒绝** `username` 参数（`4104 Parameters 中不支持传入 username`）；只接受 `-24h,now`（`now-24h,now` 报 `4003`）；HTTP 被 nginx 301 跳到 HTTPS |

两套环境的差异直接决定了两个实现细节：`time_range` 统一走 `-<N><unit>,now` 写法，Basic 认证不再注入 `username` 参数（详见 §10）。

### 2.1 关键结论

| 结论 | 证据 |
|---|---|
| `appname:alert_record` **必须带 `index=monitor`** 才命中 | 不带 index 时 `appname:alert_record` 近 7 天 0 命中；`index=monitor appname:alert_record` 7 天 **171,928** 条 |
| 触发记录用 `'issue_alert':true AND NOT 'is_recovery':true` 过滤 | 7 天命中 **30,204** 条（约 18% 是真实触发） |
| 恢复记录 `'is_recovery':true` 单独存在 | 7 天 **9,897** 条，且 `alert_level = no_alert` |
| `index=monitor` 单独查询会报语法错 | `syntax error in 'query': unexpected end of spl`，必须跟至少一个过滤条件 |
| `search/sheets` 端点接受完整 SPL（含 `\|`、`stats`、`sort`、`limit`、`fields`） | 实测通过 |
| `time_range` 同时支持相对（`-7d,now`）与 **epoch 毫秒**（`1790076698110,1790681498110`） | 实测通过，窗口被正确采纳 |
| 相对窗口必须用 `-<N><unit>,now` 写法才能跨版本通用 | `-24h,now` 在 env1 / env2 均通过；`now-24h,now` 在 env2 报 `4003`。已加 `normalize_history_time_range` 自动把 `now-24h,now` 归一化为 `-24h,now`（见 §6.1） |
| SPL 字段投影支持带点号字段（需引号），且**不存在的字段被静默丢弃** | `\| fields alert_name, 'result.result.value', 'result.description'` 正常；混入 `segmentation_value` / `result.segmentation_specify_value` 等不存在字段不报错，只是不返回（实测） |
| Basic 认证下**不能**注入 `username` query 参数 | env2 传 `username` 直接 `4104 Parameters 中不支持传入 username`。原 `auth.py` 对所有认证方式都从凭据拆 username 并注入，属真实缺陷，已修（见 §10） |
| 带引号的 `alert_name:"x*"` 里 `*` 是**字面量**，匹配不到任何东西 | `alert_name:"xct*"` → **0 条**（静默返回空，不报错）；`alert_name:xct*` 不带引号 → 命中 1 条 |
| **不带引号的裸值**遇到空格/`-`/`/`/`(`/`[`/`:`/`|` 等字符会被当语法 | `alert_name:K8s_kube-dns / CoreDNS_转发错误` → `300 语法错误: unexpected token '/ CoreDNS_转发错误'`；只转义空格不转义 `/` → 语句被切成多段 AND，**静默返回 0 条** |
| **日志易自身就是"特殊字符前加 `\`"**（钻取变量过滤器 `${token\|e}`） | `docs/dashboard.adoc` 明确写："在输入项输入的特殊字符前面加 `\`，避免搜索的时候因为特殊字符报错"；用户从 env2 页面复制的真实查询即 `'alert_name':K8s_kube\-dns\ \/\ CoreDNS_转发错误` |
| **转义是幂等安全的**，所以对 ASCII 非字母数字字符统一转义即可 | 逐个实测：`\ `` `、`\-`、`\/`、`\_`、`\.`、`\,`、`\=`、`\>`、`\*`、`\"`、`\\`、`\!`、`\<` 都等价于对应字面量；反过来**不**转义时会报 300/2100 或静默改变结果 |
| 需要转义的字符（实测为"不转义就出错或结果不对"） | `` ` ``(空格)、`-`、`/`、`(`、`)`、`[`、`]`、`:`、`|`、`"`、`'`、`!`、`{`、`}`、`<`、`>`。其中 `<` `>` `-` 是**静默**少一条（不报错），最危险 |
| 可以不转义但转了也没事（实测等价） | `_`、`.`、`,`、`=`、`*`、`@`、`#`、`$`、`^`、`&`、`~`、`;`、`` ` ``、`?`、`+` |
| 转义写法**吃索引**，`\| where like(...)` 不吃 | 转义子句是搜索表达式的一部分，与 `appname:alert_record` 同级；`like` 是管道过滤，必须先把数据捞进管道 |
| SPL 里写 `\| limit N` 会让 HTTP 的 `page` 参数失效 | `\| limit 3` 时 page=0 返回 3 行、page=1/2 恒返回 **0 行**；去掉 `\| limit` 后 page=1 正常返回下一批 |
| `page` 参数**并非所有构建都支持** | env1 翻页正常；env2（Basic 那套）`page=0/1/2` 恒返回同一批首页数据，参数被忽略 |

### 2.2 `alert_record` 记录结构（实测）

顶层字段（节选；单条记录实测 75–103 个字段，随告警类型不同，索引元数据共 150 个字段名）：

```
alert_name / alert_id / alert_level / event_level / value / timestamp / event_time
start_timestamp / end_timestamp / issue_alert / is_recovery / is_suppressed
alert_history_id / _id / _index / appname(=alert_record) / alert_type / category
run_timestamp / search_url / status / create_time
segmentation_field（扁平，与 result.segmentation_field 同值）
result.*（~60 个，见下）
```

`result.*` 关键字段：

```
result.name / result.alert_id / result.level / result.description
result.strategy.name / result.strategy.description
result.strategy.trigger.{level, category, compare, compare_value, compare_style,
                         compare_desc_text, time_range, time_range_unit,
                         start_time, end_time, field, method, alert_thresholds,
                         baseline_*}
result.alert_condition_strategy.{name, alert_level, trigger_level,
                                 trigger_time, trigger_event_times, description}
result.result.{value, total, complex_value, columns.name, columns.type}
result.search.query / result.exec_time / result.trigger_timestamp
result.is_segmentation / result.segmentation_field / result.segmentation_specify_value  ← 分段（分组）实体
result.plugin.plugin_result     ← 通知正文（HTML，含"告警名称/级别/描述/最近事件"）
result.resource_groups / result.alert_owner_name / result.traceid
```

### 2.3 真实触发记录样例（脱敏节选）

```json
{
  "alert_name": "交换机_华为S12700_高级别事件告警",
  "alert_id": 75,
  "alert_level": "high",
  "event_level": "high",
  "value": 64,
  "timestamp": 1790682665059,
  "event_time": 1790682665059,
  "trigger_timestamp": 1790682665059,
  "issue_alert": "true",
  "is_recovery": "false",
  "alert_history_id": "75_1790682665059_0",
  "appname": "alert_record",
  "result.name": "交换机_华为S12700_高级别事件告警",
  "result.description": "",
  "result.strategy.trigger.compare": ">",
  "result.strategy.trigger.compare_value": 20,
  "result.strategy.trigger.compare_desc_text": "计数大于20",
  "result.search.query": "logtype:switch tag:huawei_S12700 switch.severity:<4",
  "result.plugin.plugin_result": "<br>告警名称: 交换机_..._高级别事件告警<br>告警级别：高<br>..."
}
```

另一条（SPL 统计类，`result.description` 有值、`complex_value` 有值）：

```json
{
  "alert_name": "服务调用报错-示例zyt",
  "alert_level": "critical",
  "value": 35,
  "result.description": "-1m内收到来自的35条日志，触发条件是计数>[10]",
  "result.result.complex_value": "cnt:35",
  "result.result.columns.name": ["service", "error_message", "cnt", "alert_msg"]
}
```

### 2.4 分段（分组）实体字段（研发确认 + 实测）

**研发确认的 schema**：当 `result.is_segmentation=true` 时，

| 字段 | 含义 |
|---|---|
| `result.is_segmentation` | 布尔标记，该行是否为分段（分组）执行记录 |
| `result.segmentation_field` | **实体字段名**（实测取值：`appname` / `json.DST_IP` / `json.URL`） |
| `result.segmentation_specify_value` | **实体字段值**（该字段在触发时才会被写入） |

实测佐证（`index=monitor appname:alert_record result.is_segmentation:true`）：

**env1（`172.21.16.9`，近 7 天）——只有字段名、没有值：**

- 近 7 天 `result.is_segmentation:true` 命中 **40,064** 条（占全量 171,932 的约 23%），
  说明分段执行记录**大量存在**；但它们的 `issue_alert` 全是 `"false"`——即**该环境没有真正触发的告警**，
  所以 `result.segmentation_specify_value` 尚未被写入（索引元数据里也查不到该字段）。
- 索引元数据中 `result.segmentation_field` 有 45 条取值、3 个不同值：
  `appname`(22) / `json.DST_IP`(12) / `json.URL`(11)；同时存在**同值的扁平字段** `segmentation_field`。
- `result.segmentation_value`（扁平）与 `result.segmentation_specify_value` 在**该环境均不存在**。

**env2（`192.168.43.196`，Basic 认证）——真实触发数据，值路径确认：**

- 窗口内共 **1,943** 条真实触发记录，其中 `result.is_segmentation:true` 的 **21** 条。
- 实测一条真实触发行：`result.is_segmentation=true`、
  `result.segmentation_field="appname"`、`result.segmentation_specify_value="audit_test"`、`issue_alert="true"`。
- 端到端输出：`entities={"appname":"audit_test"}`、`entity_source="segmentation_value"`、`warnings=[]`。

→ 研发给出的 schema 在**真实触发数据上完全成立**（详见 §8.6）。

**落地策略**（以「值存在」为准，不依赖标记）：

1. 依次找 `result.segmentation_specify_value` → 扁平 `segmentation_value`，取第一个非空值；
2. 有值 → 实体键名取 `result.segmentation_field` → 扁平 `segmentation_field`，都缺则用 `segmentation_value`；
   与 `entity_fields` 的匹配结果**合并**（共同构成"可能涉及的实体"），`entity_source = segmentation_value`；
3. **只有标记、没有值**（= env1 形态）→ 不产出分段实体，继续走 `entity_fields` 回退，
   但会把分段字段名（如 `appname`）放进 `entity_candidates`，提示调用方该换哪个字段下钻。

> 保留扁平 `segmentation_field` / `segmentation_value` 作为历史兼容：用户提供的"触发告警详情表格"URL 里
> 引用过 `segmentation_value`，说明另一套环境（192.168.40.113）可能存在该写法。
> 该环境用现有两把密钥均认证失败（`用户名邮箱或密码错误` / `api_key 未找到`），
> 故保留了扁平字段的读取分支；而 `result.segmentation_specify_value` 的**真实取值已在 env2 上直接观测到**。

---

## 三、接口设计

### 3.1 工具名

**`get_triggered_alerts`**（主选，与 `list_alerts` / `get_alert_detail` 命名风格一致）

备选：`get_alert_history`。二选一，建议主选。

### 3.2 入参

**全部参数都是可选的**（两端 schema 都没有 `required` 列表）——不传任何参数即"看最近 24h 全系统所有监控的已触发告警"。

| 参数 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `alert_id` | integer | 不传=不限 | 只看某个监控的触发记录（对应 `alert_id:<n>`） |
| `alert_name` | string | 不传=不限 | 按告警名称过滤。**默认精确匹配**；支持 `*` 通配（`交换机*` 前缀、`*攻击*` 包含）。见 §3.2.1 |
| `time_range` | string | `-24h,now` | 相对窗口请用 `-<N><unit>,now`（如 `-7d,now`）；`now-24h,now` 会被自动归一化；也支持 epoch 毫秒 |
| `levels` | string[] | **全部级别** | 不传即 `critical/high/mid/low/info` 全要，不拼 `alert_level` 子句 |
| `entity_fields` | string[] | `["result.appname","result.ip"]` | **自定义实体字段**，取值必须是告警结果记录里的字段名（`result.` 前缀），如 `["result.hostname","result.src_ip"]` |
| `include_recovery` | boolean | `false` | 是否把恢复记录（`is_recovery:true`，级别 `no_alert`）也一并返回 |
| `include_search_url` | boolean | `false` | 是否返回日志检索跳转链接 `search_url`（单条约 600 字节，故默认关闭） |
| `timezone` | string | `Asia/Shanghai` | 触发时间的输出时区，非法值静默回落默认 |
| `size` | integer | `20` | 每页条数（1–200）。实测单条规整后约 500 字节，默认 20 可保证结果内联 |
| `page` | integer | `0` | 页码。**注意：部分日志易构建会忽略该参数**（§10 风险 11） |
| `sort` | string | `-timestamp` | 排序字段，前缀 `-` 降序；白名单外回落 `-timestamp` |
| `output_format` / `include_raw_json` / `result_delivery` / `result_ttl_seconds` | — | — | 由 `with_output_controls` 自动注入 |

**刻意不提供的参数**（早期草案里有，评审时删掉）：

| 已删 | 删掉的理由 |
|---|---|
| `only_triggered` | 工具名已承诺"已触发"，再开 `only_triggered=false` 等于让一个叫"已触发告警"的工具返回**未触发**的执行记录，语义自相矛盾。`issue_alert:true` 改为**恒定条件**。"要不要看恢复"这个真正有意义的维度由 `include_recovery` 承担 |
| `include_notification_text` | 它控制的是 `result.plugin.plugin_result`（通知正文 HTML）是否作为**描述的兜底来源**——这是内部实现细节，不是用户要素。改为固定投影 + 固定回退 |
| `description_max_chars` | 截断长度是**展示细节**而非查询语义，调用方要短自己截。改为内部固定 300 |

**不提供 `extra_filter`**（已定稿）：本工具只接受结构化参数，SPL 完全由工具内部拼装，
不向调用方开放任何语句注入面。需要任意条件过滤时，请改用 `log-tools` 的 `log_search_sheet`。

`entity_fields` 同时接受数组与逗号分隔字符串（复用 `parse_array_like` 语义），
元素按**记录字段名**做字面匹配。

`time_range` 会在进入 SPL 前先经 `normalize_history_time_range` 归一化：
把 `now-24h,now` 这类写法改写成 `-24h,now`（正则 `^now\s*-\s*(\d+(?:\.\d+)?)\s*([a-zA-Z]+)$`），
epoch 毫秒、绝对时间等其它写法原样透传。两套日志易版本对相对窗口的语法要求不同（§2.1），
归一化让调用方不必关心连的是哪个版本。

#### 3.2.1 `alert_name` 的过滤语义与转义

**不传 `alert_name`（或传空串 / 纯 `*`）就是"全系统所有监控"**——不需要用 `*` 占位，
传 `*` 也等价于不传（不会静默变成"匹配字面星号"）。

有值时一律拼成**不带引号**的索引子句：

```
alert_name:<转义后的字面量>            # 不含 *，精确匹配
alert_name:<转义后的字面量，* 保留>     # 含 *，前缀/包含匹配
```

**为什么不带引号。** 不带引号的裸值是最省事的写法，但空格、`-`、`/`、`(`、`[`、`:`、`|`
会被当语法。实测（env2 真实告警名 `K8s_kube-dns / CoreDNS_转发错误`）：

| 写法 | 结果 |
|---|---|
| `alert_name:"K8s_kube-dns / CoreDNS_转发错误"` | 22 条 ✓（能用，但 `*` 会退化成字面量） |
| `alert_name:K8s_kube-dns / CoreDNS_转发错误` | `300 语法错误: unexpected token '/ CoreDNS_转发错误'` |
| `alert_name:K8s_kube-dns\ /\ CoreDNS_转发错误`（只转义空格） | `300 语法错误`（`/` 也破坏语句） |
| `alert_name:K8s_kube-dns \/ CoreDNS_转发错误`（只转义 `/`） | **0 条**——空格把语句切成三段 AND，静默返回空 |
| `alert_name:K8s_kube\-dns\ \/\ CoreDNS_转发错误`（全转义） | 22 条 ✓ |

**转义方案：ASCII 非字母数字字符一律前置 `\`。** 这不是我们自己发明的语法——
日志易的钻取变量过滤器 `${token|e}` 的官方描述就是"在输入项输入的特殊字符前面加 `\`，
避免搜索的时候因为特殊字符报错"（`docs/dashboard.adoc`），用户从 env2 页面复制出来的
真实查询也正是 `'alert_name':K8s_kube\-dns\ \/\ CoreDNS_转发错误`。

**为什么是"全部转义"而不是"只转必要的"。** 逐个字符实测后有两类：

| 类别 | 字符 | 不转义的后果 |
|---|---|---|
| **必须转义** | 空格、`-`、`/`、`(`、`)`、`[`、`]`、`:`、`\|`、`"`、`'`、`!`、`{`、`}`、`<`、`>` | 报 `300` / `2100`，**或者更糟：静默少一条/返回 0 条**（`<` `>` `-` 属于后者） |
| 转了也无害 | `_`、`.`、`,`、`=`、`*`、`@`、`#`、`$`、`^`、`&`、`~`、`;`、`` ` ``、`?`、`+` | 无（实测 `\_` `\.` `\,` `\=` `\>` `\*` `\"` `\\` 均与字面量等价） |

既然"转了也无害"覆盖了全部剩余字符，就没必要维护一张"必须转义"的白名单（那反而容易漏），
统一转义是唯一稳且不会随版本漂移的做法。**顺带**：这条规则同时解决了 `"` 和 `\` ——
它们不再需要被拒绝（上一版曾直接报 `INVALID_PARAM_VALUE`），实测 `\"` 与 `\\` 都能当字面量用。

非 ASCII 字符（汉字、全角标点）**原样保留**，不做无法验证的多字节转义。

`*` 是唯一的例外：它保留不转义，作为通配符。

| 用户输入 | 实际拼进 SPL |
|---|---|
| `交换机*` | `alert_name:交换机*` |
| `*Brute Force*` | `alert_name:*Brute\ Force*` |
| `[内置监控]*` | `alert_name:\[内置监控\]*` |
| `K8s_kube-dns / CoreDNS_转发错误` | `alert_name:K8s\_kube\-dns\ \/\ CoreDNS\_转发错误` |
| `业务请求返回码异常告警(SPL)` | `alert_name:业务请求返回码异常告警\(SPL\)` |
| `a"b` | `alert_name:a\"b` |
| `*` / `**` / 空串 | 不过滤 |

> 代价：想匹配**字面星号**目前没有办法（`*` 永远被当通配符）。
> 告警名里带 `*` 的场景极罕见，需要时改用 `log-tools` 的 `log_search_sheet`。

**为什么不再用 `| where like(...)`。** 上一版为了"既支持通配又保住引号"，走了
`| where like(alert_name, "交换机%")` 管道过滤。它能用，但有两个问题：
一是 `like` 是**管道过滤**，必须先把命中数据捞进管道再筛，吃不到索引；
二是 `like` 的模式串是**正则语义**（`%` → `.*`、`_` → `.`、其余按正则解释），
用户输入里的 `.` `[` `(` 等都要再转义一层，语义叠了两层，很容易在某个字符上静默出错。
换成转义写法后这两个问题同时消失：子句回到搜索表达式里，和 `appname:alert_record` 同级。

### 3.3 返回结构

```jsonc
{
  "time_range": "-24h,now",
  "query_executed": "index=monitor appname:alert_record AND 'issue_alert':true ...",
  "total": 4300,           // 窗口内命中总数
  "returned": 20,          // 本页返回条数
  "page": 0,
  "size": 20,
  "has_more": true,
  "level_counts": { "critical": 78, "high": 59, "mid": 39, "low": 13, "info": 11 },
  "alert_counts": [ { "alert_id": 1489, "alert_name": "服务调用报错-示例zyt", "count": 65 } ],
  "entity_candidates": ["appname", "json.URL", "json.DST_IP", "result.hostname", "src_ip", "service", "..."],
  "alerts": [
    {
      "alert_name": "交换机_华为S12700_高级别事件告警",
      "alert_id": 75,
      "alert_history_id": "75_1790682665059_0",
      "trigger_time": "2026-09-29T19:51:05+08:00",
      "trigger_time_ms": 1790682665059,
      "level": "high",
      "value": 64,
      "entities": { "result.appname": "switch", "result.ip": "10.0.1.13" },  // key 为完整记录字段名
      "entity_source": "entity_fields",     // segmentation_value | entity_fields | complex_value | none
      "description": "计数大于20",
      "description_source": "strategy_trigger_desc", // result.description | strategy_trigger_desc | notification_text | none
      "is_recovery": false,
      "search_url": "http://rizhiyi.com/search/?..."
    }
  ],
  "warnings": []
}
```

`level_counts` / `alert_counts` 由本地对**本页结果**聚合（不额外发请求）；`alert_counts` 取 Top 10。

**关于 `entity_candidates`，以及为什么不再回显 `entity_fields`**：
两者名字像但语义完全不同，同时出现会让人分不清——

| 字段 | 是什么 | 处置 |
|---|---|---|
| `entity_fields` | **回显调用方自己传的入参**（连默认值也回显） | **已删除**。调用方本来就知道自己传了什么，默认值也写在 schema 里；每条记录 `entities` 的 key 本身就是所用字段名，已自描述 |
| `entity_candidates` | **从数据里发现的可选字段名**（`result.result.columns.name` + 分段字段名），是工具真正新增的信息 | **保留**。它回答的是"这批数据里还能拿哪些列当实体"，在 `entities` 落空时给出下钻方向 |

### 3.4 SPL 构造规则

```
index=monitor appname:alert_record
  'issue_alert':true                       # 恒定条件（不再是开关）
  [AND NOT 'is_recovery':true]             # !include_recovery
  [AND alert_id:<id>]
  [AND alert_name:<转义后的字面量>]          # * 保留为通配符；全部落在主查询里，吃索引
  [AND (alert_level:"high" OR alert_level:"mid" ...)]   # levels
| sort by -timestamp
| fields <投影字段列表>                     # 刻意不写 | limit，见 §3.4.1
```

注意：**没有管道过滤段**。`alert_name` 的两种写法（精确 / 通配）都在主查询里，
因此都能吃索引；上一版含 `*` 时会多出一段 `| where like(...)`，现已去掉（原因见 §3.2.1）。

实测可用的等价查询（用户给的示例 URL 语义一致，只是端点换成 `search/sheets`）：

```
index=monitor alert_id:1451 AND appname:alert_record AND 'issue_alert':true AND NOT 'is_recovery':true
index=monitor appname:alert_record AND 'issue_alert':true AND NOT 'is_recovery':true | sort by -timestamp | fields alert_id, alert_name, timestamp, alert_level
index=monitor appname:alert_record AND 'issue_alert':true AND alert_name:交换机* | sort by -timestamp | fields alert_id, alert_name, timestamp, alert_level
index=monitor appname:alert_record AND 'issue_alert':true AND alert_name:K8s\_kube\-dns\ \/\ CoreDNS\_转发错误 | sort by -timestamp | fields alert_id, alert_name, timestamp, alert_level
```

**投影字段列表**（固定超集，约 40 个；分段实体字段与用户自定义实体字段一并列入）：

```
alert_name, alert_id, alert_level, event_level, value, timestamp, event_time,
trigger_timestamp, start_timestamp, end_timestamp, issue_alert, is_recovery,
is_suppressed, alert_history_id, _id, appname, alert_type, category, search_url,
segmentation_field, segmentation_value,          # 扁平写法（历史兼容，缺失时服务端静默丢弃）
'result.name', 'result.alert_id', 'result.level', 'result.result.value',
'result.description', 'result.strategy.description',
'result.strategy.trigger.level', 'result.strategy.trigger.compare',
'result.strategy.trigger.compare_value', 'result.strategy.trigger.compare_desc_text',
'result.alert_condition_strategy.alert_level',
'result.alert_condition_strategy.trigger_time',
'result.result.complex_value', 'result.result.columns.name',
'result.search.query', 'result.trigger_timestamp', 'result.exec_time',
'result.is_segmentation', 'result.segmentation_field', 'result.segmentation_specify_value',
'result.plugin.plugin_result'                # 固定投影（描述的兜底来源，不再是开关）
+ 每个 entity_field 原样列入（如 'result.appname' / 'result.ip' / 'result.hostname'）
```

> 不存在的字段被服务端**静默丢弃**（实测：混入 `segmentation_value` /
> `result.segmentation_specify_value` 等不存在字段不会报错，只是不返回），因此固定超集是安全的。

> 为什么必须服务端投影：单条记录约 75–103 个字段，`result.plugin.plugin_result` 单条 5–10KB HTML。
> 不投影时 `size=50` 的响应可达数百 KB，会直接触发 shared-resource 降级。

> `alert_name` 的过滤值一律经 `escape_spl_term` / `escapeSplTerm` 处理：
> ASCII 非字母数字字符前置 `\`，非 ASCII（汉字/全角）原样保留，`*` 保留为通配符（见 §3.2.1）。

#### 3.4.1 为什么 SPL 里**不能**写 `| limit <size>`

早期实现在管道末尾拼了 `| limit <size>`。实测这会**让 HTTP 的 `page` 参数彻底失效**——
一旦在 SPL 里写死条数，服务端就只有那么几行可供分页：

```
| limit 3, page=0, size=3   → rows=3  alert_ids=[1338, 1180, 1489]
| limit 3, page=1, size=3   → rows=0  alert_ids=[]          ← 翻不动
| limit 3, page=2, size=3   → rows=0  alert_ids=[]
无 limit,  page=1, size=3   → rows=3  alert_ids=[1489, 74, 75] ← 正常
```

因此改为**不在 SPL 里限制条数**，分页完全交给 `size` / `page` 参数。
（`page` 本身在部分日志易构建上仍会被忽略，见 §10 风险 11。）

---

## 四、字段映射与回退链

所有回退链都是**纯函数**，双端各自实现、由测试锁定行为。

### 4.1 告警名称

```
alert_name → result.name → 从 plugin_result 抽 "告警名称: X" → "alert_id=<id>"
```

### 4.2 触发时间

```
timestamp → event_time → trigger_timestamp → result.trigger_timestamp
         → result.alert_condition_strategy.trigger_time
         → result.strategy.trigger.end_time → result.exec_time（运行时间，兜底）
```

输出同时给 `trigger_time_ms`（原始毫秒）与 `trigger_time`（ISO8601，带 `+08:00`）。
时区取参数 `timezone`（默认 `Asia/Shanghai`）——沿用告警配置里的同名字段习惯。

### 4.3 级别

```
alert_level → event_level → result.level → result.strategy.trigger.level
            → result.alert_condition_strategy.alert_level
```

统一 `lower()`。`no_alert` 视为恢复，不参与 level 统计。

### 4.4 触发值

```
value → result.result.value
```

两者都没有时返回 `null`，并在 `warnings` 里记一条（例如 `value` 缺失的记录数）。

> 注意：`result.strategy.trigger.compare_value` 是**阈值**而不是触发值，不能拿来兜底；
> 它单独作为 `threshold` 字段输出（可选增强项，见 §7）。

### 4.5 事件描述

```
result.description
→ result.strategy.trigger.compare_desc_text
→ result.strategy.description
→ plugin_result 剥离 HTML 后的正文        # 固定兜底，不是开关
→ null
```

HTML 剥离规则：去标签 → `&lt;/&gt;/&amp;/&nbsp;` 反转义 → 折叠空白 → 按内部固定的 300 字截断。
同时回填 `description_source`，让调用方知道这条描述的可信度。

> 最后一步（通知正文兜底）早期做成 `include_notification_text` 入参，评审时删除：
> 它是**内部回退来源**而非用户要素，暴露出去等于泄漏实现细节。现在固定执行，
> 调用方若嫌描述太长，自己截断即可。

---

## 五、实体识别策略（核心）

优先级从高到低：

1. **分段（分组）实体**：当 `result.is_segmentation=true` 时，`result.segmentation_field` 是实体字段名、
   `result.segmentation_specify_value` 是实体字段值（研发确认的 schema）。
   实现上以「**值存在**」为准落地：依次找 `result.segmentation_specify_value` → 扁平 `segmentation_value`，
   取第一个非空值；键名取 `result.segmentation_field` → 扁平 `segmentation_field`（都缺则用 `segmentation_value`）。
   **只有标记没有值时不产出实体**（env1 形态），继续往下走回退链。
2. **用户传参的 `entity_fields`**（默认 `["result.appname","result.ip"]`）→ **按记录字段名做字面匹配**，
   结果与第 1 步**合并**（共同构成"可能涉及的实体"）。
   - 命中条件：key 存在，且值非空（排除 `None` / 空串 / 字符串 `"null"`）。
   - 便利回退：若传入的名字**不带 `result.` 前缀**，再试一次 `result.<名字>`（仅作兼容，不改变默认语义）。
   - 无意义值过滤：值为 `alert_record` 时跳过——那是告警记录自身的 `appname`，不是被监控系统。
3. **`result.result.complex_value` 解析**（低优先兜底）：形如 `k1:v1, k2:v2`，
   只取**非聚合列**（排除 `cnt/count/value/avg/sum/max/min/total`）的键值对作为实体。
4. 都拿不到 → `entities = {}`，`entity_source = "none"`，并在 `warnings` 里提示
   "该条记录未携带实体信息，可用 entity_fields 指定其它字段或改用 log_search_sheet 下钻"。

`entity_source` 取值：`segmentation_value` | `entity_fields` | `complex_value` | `none`。

### 5.1 实测说明

在 **env1（`172.21.16.9`）** 里，默认 `entity_fields` 会**空手而归**，这是符合预期的：

- `result.appname` / `result.ip` / `result.hostname` 这些字段在 env1 的触发记录里**不存在**
  （字段列表里没有）。
- 裸字段 `appname` 恒为 `alert_record`——是记录自身的应用名，**不是被监控系统**，
  所以即便走便利回退也会被 §5 第 2 条的"无意义值过滤"挡掉。
- 被监控系统的真实身份出现在三个地方：`result.segmentation_field`（分段字段名，如 `appname` /
  `json.DST_IP` / `json.URL`）、`result.result.columns.name`（结果列名）与
  `result.plugin.plugin_result` 的 "最近事件: appname:switch, hostname:VM_16_9_centos"。
  因此当 `entity_source = "none"` 时，工具会额外回传 `entity_candidates`
  （取 `result.result.columns.name` **与** `result.segmentation_field`），让模型知道还能用哪些字段名去下钻。

> 在 **env2（`192.168.43.196`）** 有真实触发数据时，第 1 步（分段实体）直接命中：
> `entities={"appname":"audit_test"}`、`entity_source="segmentation_value"`、`warnings=[]`，
> 不会走到 `entity_fields` 空手而归的分支（§8.6）。

> 这套行为在用户环境（192.168.40.113）里应该也会命中——那边既可能有 `segmentation_value`，
> 也可能有 `result.ip` / `result.appname` 这类展平字段。默认值保持"`result.` 前缀"是为了
> 与用户明确的字段形态一致。

---

## 六、双端实现落点

> 本仓库是 TS→Python 迁移中的双实现仓库，**任何改动必须双端对称**，
> 否则会触发 `dual-impl-parity-guard` 关注的"双实现漂移"。

| 层 | Python | TypeScript |
|---|---|---|
| 工具定义 | `python/rizhiyi_mcp/service_alerts.py::ALERT_TOOLS` 追加 `ToolDefinition` | `ts/src/tools.ts::alertTools` 数组追加同构定义 |
| 纯函数映射 | `AlertService` 静态/实例方法（`build_history_query`、`normalize_entity_fields`、`normalize_history_levels`、`resolve_history_sort`、`resolve_history_timezone`、`resolve_history_entities`、`resolve_history_description`、`normalize_history` 等） | `AlertsModule` 同名方法 |
| 业务方法 | `AlertService.get_triggered_alerts(params)` → `request_json("get", "/api/v3/search/sheets/", params={query, time_range, page, size})` | `AlertsModule.getTriggeredAlerts(params)` → `this.client.get('/api/v3/search/sheets/', {...})` |
| handler 注册 | `create_alerts_server` 的 `tool_handlers` 加一行 | `alert-server.ts` 的 `handlers` 加一行 |
| 服务说明 | `SERVER_LEVEL_INSTRUCTIONS` 增加第 9 条 | 同左（保持两段文案逐字一致） |

### 6.1 Python 骨架

> 下面是**设计期**的骨架示意；落地时的常量与函数名以 §11 所列文件为准，
> 常量统一加了 `ALERT_HISTORY_` 前缀、`normalize_history` 为公开方法。

```python
ALERT_HISTORY_INDEX = "monitor"
ALERT_HISTORY_APPNAME = "alert_record"
ALERT_HISTORY_SEARCH_PATH = "/api/v3/search/sheets/"
ALERT_HISTORY_DEFAULT_TIME_RANGE = "-24h,now"     # 跨日志易版本通用写法
ALERT_HISTORY_DESCRIPTION_CHARS = 300             # 展示细节，内部固定，不做成入参
ALERT_HISTORY_DEFAULT_ENTITY_FIELDS = ("result.appname", "result.ip")
ALERT_HISTORY_AGGREGATE_COLUMNS = ("cnt", "count", "value", "avg", "sum", "max", "min", "total")
ALERT_HISTORY_WILDCARD_CHARS = ("*",)            # 唯一保留为通配符的字符

async def get_triggered_alerts(self, params: dict[str, Any]) -> Any:
    built = self.build_history_query(params)          # 纯函数，可单测
    # build_history_query 内先做两件归一化：
    #   1) 时间窗口：normalize_history_time_range，`now-24h,now` → `-24h,now`
    #   2) 名称过滤：build_history_name_filter
    #        - 空 / 纯 `*`      → 不过滤
    #        - 其余             → alert_name:<escape_spl_term(...)>（都在主查询里，吃索引）
    #          escape_spl_term：ASCII 非字母数字前置 `\`，非 ASCII 原样保留，`*` 保留为通配符
    if built.get("error"):
        return built["error"]
    response = await self.request_json(
        "get",
        ALERT_HISTORY_SEARCH_PATH,
        params={"query": built["value"]["query"],
                "time_range": built["value"]["time_range"],
                "page": built["value"]["page"],
                "size": built["value"]["size"]},
    )
    if response.error:
        return self.api_response_to_error(response)
    rows = self.extract_history_rows(response.data)
    return {"raw_data": response.data,
            "data": self.normalize_history(rows, built["value"], self.extract_history_total(response.data))}
```

### 6.2 双端一致性点（已落实）

- `str(float)` 语义：Python 的 `value` 可能是 `64` 或 `64.0`，TS 侧 `JSON.parse` 后是 `64`。
  统一规则：**整数值去掉 `.0`**（`coerce_history_number` 双端同实现），否则 CSV/YAML 输出会出现肉眼漂移。
- 时间格式化：Python 用 `zoneinfo`，TS 用 `Intl.DateTimeFormat` + `formatToParts`。
  双端都直接输出 `YYYY-MM-DDTHH:mm:ss±HH:mm` 手写格式，避免库差异。
- `sort` 字符串白名单：`timestamp / event_time / alert_level / alert_id / value`，非法值回落 `-timestamp`。
- 聚合排序：`alert_counts` 次键必须用**码点序**比较告警名。TS 的 `localeCompare` 是语言环境序，
  与 Python 的字符串比较不一致——这是本次字节级比对抓出的真实漂移，已在 TS 侧改为显式 `<` / `>` 比较。
- 时间窗口归一化：`normalize_history_time_range` / `normalizeHistoryTimeRange` 双端同实现，
  正则 `^now\s*-\s*(\d+(?:\.\d+)?)\s*([a-zA-Z]+)$` 把 `now-24h` 改写成 `-24h`，其它片段原样保留。
- 字面量转义：`escape_spl_term` / `escapeSplTerm` 双端同实现——ASCII 非字母数字字符前置 `\`，
  非 ASCII 原样保留，`keep_wildcard=True` 时 `*` 不转义；`build_history_name_filter` /
  `buildHistoryNameFilter` 只产出主查询子句（不再有 `stage`）。由 §8.7 的 28 组用例逐字节锁定。
- 认证头构造：只有 `apikey` 才从凭据里拆 `username` 并注入 query 参数；Basic 不注入（见 §10）。

---

## 七、可选增强（v1.1 候选）

1. **`threshold` 字段**：输出 `result.strategy.trigger.compare` + `compare_value` + `compare_desc_text`，
   让"为什么触发"更直观。
2. **`group_by_alert_id`**：按 `alert_id` 聚合（首次/末次触发时间、触发次数、最高级别），
   适合"最近有哪些告警在反复报"这类问题。
3. **`include_source_query`**：输出 `result.search.query`（触发时的原始检索语句），便于直接下钻。
4. **实体聚合**：`entity_summary`（Top N 实体 + 计数），回答"哪个 IP 报得最多"。
5. **`dedupe_window`**：同一 `alert_id` + 同一 `entities` 在 N 分钟内只保留一条，降低刷屏。

> 原计划里的 `include_search_url` 已在 v1 落地（默认关闭），不再列为待办。

---

## 八、测试方案（已实施）

### 8.1 Python（`python/tests/test_alerts_service.py` → `AlertHistoryTestCase`，43 个用例；整文件 76 个）

纯函数测试，全部离线：

- `build_history_query`：默认 SPL 逐字断言（含"默认过滤子句必须是全系统、无 `| limit`"）；
  `alert_id` / `levels` / `include_recovery=true` / `entity_fields` 逗号字符串 / `size` 上下限 /
  `sort` 回落 各分支；非法 `levels` 被拦截。
- 已删参数不再出现在 plan 里（`only_triggered` / `include_notification_text` / `description_max_chars`）。
- **`alert_name` 转义**：`escape_spl_term` 的逐字符断言（汉字/空格/`-`/`/`/括号/引号/反斜杠/`|:`/`.,`/`!<>`
  共 11 组）、`keep_wildcard` 开关 4 组；`build_history_name_filter` 的精确 vs 通配、
  真实告警名 `K8s_kube-dns / CoreDNS_转发错误` 的完整期望串、`*` 与空值等价于不过滤、
  `"`/`\` **被转义而非拒绝**；并回归断言任何写法都不再产生 `| where like`。
- 六条回退链各至少一个用例，全部使用 §2.3 的真实脱敏样例。
- `strip_html_text` / `truncate_text` / `format_history_time`（含 UTC 与非法时区回落）。
- 实体识别：四条路径 + `appname=alert_record` 跳过 + 裸字段名回落 `result.<name>`；
  分段实体另测「`result.*` 三段字段齐全」「只有标记没有值 → 落空」「扁平历史字段兼容」三种情形。
- `normalize_history`：`level_counts` / `alert_counts` / `has_more` / `entity_candidates`（聚合列被过滤、含分段字段名）/ 三类 warnings；
  并断言**不再回显 `entity_fields`**。
- `extract_history_rows` / `extract_history_total` 的异常输入。

### 8.2 TypeScript（`ts/scripts/alert-selfcheck.mjs`）

与 Python 侧**使用同一份黄金样例**（同名字段、同值），断言同一组期望输出。
`node ts/scripts/alert-selfcheck.mjs` → `ALL PASSED ✓`。

### 8.3 双端逐字节比对（`normalize_history`，本次实际执行）

用真实环境数据跑了 6 个场景（默认 / `alert_id` 过滤 + `include_search_url` / `levels` 过滤 /
含恢复记录 / 分段实体记录 / 通配符过滤），把同一份 `rows + plan` 分别喂给两端的 `normalize_history`，
序列化后 diff：

```
[OK]   all-records
[OK]   default
[OK]   filtered
[OK]   levels
[OK]   segmentation
[OK]   wildcard
========================================
PARITY OK
```

**这一步抓到一个真实漂移**：`alert_counts` 的次级排序，Python 用字符串码点序，
TS 最初写成 `localeCompare`（语言环境序）——中文告警名多的时候顺序会不一致。
已改为码点比较，并在代码里留了注释说明原因。

### 8.4 端到端冒烟（`ts/scripts/alert-history-smoke.mjs`）

```bash
cd ts && npm run build
# apikey 版本
LOGEASE_BASE_URL=http://<host> LOGEASE_API_KEY=<user>:<secret> \
  node scripts/alert-history-smoke.mjs --time-range -1d,now --size 3
# Basic 版本（不传 username 参数）
LOGEASE_BASE_URL=https://192.168.43.196 LOGEASE_AUTH_HEADER='Basic <base64>' \
  node scripts/alert-history-smoke.mjs --time-range -1d,now --size 5
# 通配符 / 含空格与斜杠的精确名
  ... node scripts/alert-history-smoke.mjs --alert-name "交换机*"
  ... node scripts/alert-history-smoke.mjs --alert-name "K8s_kube-dns / CoreDNS_转发错误"
```

无凭证时打印 `[SKIP]` 并以 0 退出，便于进 CI。脚本除六要素断言外，还包含：
`entity_fields` 不再回显、SPL 未硬编码 `| limit`、**不再出现 `| where like`**、
以及**翻页自检**（page=0 与 page=1 内容不同）。
若服务端忽略 `page`（见 §10 风险 11），只打 `[warn]` 而不判失败。

脚本用 Node 原生 `fetch`（沙箱里 `curl` 会被代理拦截，见 `WORKTREE_PLAN.md` 9.4）；
连 env2 这种自签 HTTPS 需 `NODE_TLS_REJECT_UNAUTHORIZED=0`，且必须用 `https://` 直连
（HTTP 会被 301 跨源跳转丢掉 `Authorization` 头，退化成 `1502`）。

**实跑结果**：

| 环境 | 场景 | 结果 |
|---|---|---|
| env1（apikey） | 默认 `-1d` | `ALL PASSED ✓`，分页正常（page=1 返回下一批） |
| env1 | `alert_name="交换机*"`（`-7d`） | `ALL PASSED ✓`，total=27144（`-1d` 下 905） |
| env1 | `alert_name="RDP Brute Force Attack"`（精确、含空格） | `ALL PASSED ✓` |
| env1 | `alert_name="*Brute Force*"`（`-7d`） | total=3249 |
| env1 | `alert_name="[内置监控]*"`（含方括号，`-7d`） | total=45 |
| env1 | `alert_name="*攻击*"`（`-7d`） | total=26 |
| env2（Basic） | 默认 `-30d` | `ALL PASSED ✓`，`[warn] 该构建忽略 page 参数` |
| env2 | `alert_name="K8s_kube-dns / CoreDNS_转发错误"`（含空格+斜杠） | `ALL PASSED ✓`，total=34 |
| env2 | `alert_name="K8s_kube*"` / `"*CoreDNS*"` | total=34 |

**新写法 vs 双引号参考写法（同窗口、同过滤条件逐条对照，全部一致）**：

| 环境 | 告警名 | 双引号参考 | 新转义写法 |
|---|---|---|---|
| env1 | `服务调用报错-示例zyt` | 42907 | 42907 ✓ |
| env1 | `RDP Brute Force Attack` | 1672 | 1672 ✓ |
| env1 | `业务请求返回码异常告警(SPL)` | 228 | 228 ✓ |
| env1 | `[内置监控][APP][日志采集]-日志产生到日志发送耗时超60秒监控` | 28 | 28 ✓ |
| env1 | `交换机_华为S12700_高级别事件告警` | 6815 | 6815 ✓ |
| env1 | `攻击链模拟-大流量外传告警` | 8 | 8 ✓ |
| env1 | `日志易Agent失联状态监控` | 8401 | 8401 ✓ |
| env2 | `K8s_kube-dns / CoreDNS_转发错误` | 34 | 34 ✓ |

### 8.5 回归

| 项 | 结果 |
|---|---|
| `python -m pytest tests -q` | **218 passed / 1 skipped**；唯一失败是 `test_analysis_constants.py::test_business_output_parity`，为 Python ≥3.12 的已知求和差异（本机 venv 是 3.14），与本次改动无关 |
| `tsc` 构建 | 零错误 |
| TS 校验脚本 | `*-test.mjs` 家族 **11 个** + `alert-selfcheck.mjs`，共 **12 个全绿**；`tool-annotations` 工具数保持 **85**（本次只改入参与内部转义，未增删工具）。`alert-history-smoke.mjs` 需真实凭证，见 §8.4 |
| `ruff check`（改动文件） | 仅剩 4 条改动前就存在的告警，未新增 |

> 跑 Python 测试前需要把 gitignore 掉的 `api-responses/` 与 `docs/` 同步进 worktree，
> 否则会多出 10 个 fixture 缺失型失败（`WORKTREE_PLAN.md` 8.3 已记录该坑）。

### 8.6 分段实体真实数据验证（§2.4 配套）

环境 `172.21.16.9` 只有"字段名路径"可验证（无真实触发数据）；换到 `192.168.43.196` 后拿到了
**带值的真实分段记录**，端到端跑通：

```
env2：index=monitor appname:alert_record 近窗口共 1,943 条触发记录，
      其中 result.is_segmentation:true 的 21 条

真实行原始字段：
  result.is_segmentation        = true
  result.segmentation_field     = "appname"
  result.segmentation_specify_value = "audit_test"
  issue_alert                   = "true"

normalize_history 输出：
  entities       = {"appname": "audit_test"}
  entity_source  = "segmentation_value"
  warnings       = []
```

即研发描述的 schema（`is_segmentation` / `segmentation_field` / `segmentation_specify_value`）
在真实触发数据上完全成立，§10 风险 1 关闭。

### 8.7 查询构造的双端逐字节比对（本次新增）

`normalize_history` 之外，本次还新增了一轮**入参 → SPL** 的比对
（`/tmp/parity_name_{py,ts,cmp}.py`）：同一批入参分别喂给两端，dump 出
`build_history_query` 的 plan 与 `build_history_name_filter` 的 `{clause}`，
序列化后 diff：

```
cases=28  name_filters=28  queries=28
PARITY OK
```

覆盖：默认 / 空串 / `*` / `**` / 精确名 / 前缀通配 / 包含通配 / 含空格 / 方括号 /
圆括号 / 竖线冒号 / 点与逗号 / 双引号 / 反斜杠 / 感叹号与尖括号 / `%` `+` `=` / `@#$^&~` /
`;` 与反引号与问号 / 花括号 / `alert_id`+`levels` / `include_recovery` / `size` 上限 /
`page` / `sort` / 时间窗归一化 / 逗号字符串 `entity_fields` / `include_search_url`。

---

## 九、文档与说明同步

**已完成**：两个 `SERVER_LEVEL_INSTRUCTIONS`（Python `service_alerts.py:48-54` / TS `alert-server.ts:45-51`）
逐字一致地追加了第 9 条（实际落地文案）：

> 9. 查【已触发告警】用 `get_triggered_alerts`（默认看最近 24h）。它读的是 `index=monitor appname:alert_record` 的
>    执行历史，不是配置本身，返回每条告警的名称/触发时间/实体/级别/触发值/描述，并带 `entity_source`、
>    `description_source` 两个来源标记（标记为 none 表示该要素确实没取到，不要臆造）。
>    不传 `alert_id` / `alert_name` 就是全系统所有监控，不要传 `*` 占位；`alert_name` 支持 `*` 通配（如 `"交换机*"`、`"*攻击*"`）。
>    实体默认取告警结果里的 `result.appname` 与 `result.ip`，需要别的字段用 `entity_fields` 指定（如 `result.hostname`）；
>    若告警是分段（分组）触发的，实体还会带上 `result.segmentation_field` 指定的字段（如 `appname` / `json.DST_IP`）；
>    若返回的 `warnings` 提示未携带实体，可参考 `entity_candidates` 里的列名再换一次。
>    要下钻原始日志：传 `include_search_url=true` 拿跳转链接，或改用日志检索服务的 `log_search_sheet`。

- `README.md`：`rizhiyi_alert` 行补 `get_triggered_alerts`（已触发告警详情）。✅
- `CHANGELOG.md`：**只写对外可见的最终行为，不写开发过程**。`get_triggered_alerts` 仍在
  `## Unreleased`（从未对外发布过），所以它的全部设计迭代——删参数、`| where like` → 转义索引子句、
  `| limit` 分页修复、时间窗默认值——都**折叠进 `### Added` 那一条**，以"这个工具最终长什么样"
  的口径描述；不出现"上一版…""删除 `xxx` 方法""内部常量"这类只有开发者关心的内容。
  `### Changed` / `### Fixed` 只保留真正改动到**已发布行为**的条目
  （Basic 认证的 `username` 注入、HTTP 网关三个新配置键及其行为变化）。
  迭代过程记录留在本文件 §11 与 `.workbuddy-ai/memory/`。✅

---

## 十、风险与开放问题

| # | 风险 / 问题 | 影响 | 处理 |
|---|---|---|---|
| 1 | `result.segmentation_specify_value` 的**真实取值**未能直接观测（`172.21.16.9` 无真正触发的告警） | 实体识别的"高优先路径"缺真实样本 | **已闭合**：换到 `192.168.43.196` 后用真实触发记录端到端验证通过——`result.is_segmentation=true` / `result.segmentation_field="appname"` / `result.segmentation_specify_value="audit_test"` → `entities={"appname":"audit_test"}`、`entity_source="segmentation_value"`（§8.6） |
| 2 | 默认 `entity_fields`（`result.appname` / `result.ip`）在部分环境不存在 | 默认输出 `entities` 可能为空 | **已按预期落地**：这是符合字段形态设计的正常行为；实测 `172.21.16.9` 上返回 `entities: []` 同时给出 `warnings` + `entity_candidates`（现已包含分段字段名 `appname` / `json.DST_IP` / `json.URL`），引导模型换字段下钻 |
| 3 | `total_hits` 需要全窗口扫描，7 天窗口下响应偏慢 | 首字节延迟 | 默认窗口压到 `-24h,now`；必要时引入 `terminated_after_size`（会牺牲 total 精确性，需权衡） |
| 4 | 双端实现漂移 | 迁移验收不通过 | **已闭合**：纯函数 + 同一份黄金样例双向断言（§8.1 / §8.2），并做了两轮真实数据字节级对比（§8.3 `normalize_history` 6 场景 + §8.7 查询构造 28 组），期间发现并修掉 `localeCompare` 排序漂移 |
| 5 | 记录里同时存在 `timestamp` / `event_time` / `trigger_timestamp` / `exec_time` | 时间语义混淆 | 回退链写死并单测锁定；`exec_time` 仅作最后兜底 |
| 6 | 用户示例 URL 用的是 `/api/v3/search/submit/`，本设计用 `/api/v3/search/sheets/` | 端点不一致 | 保持 `sheets`：与 `log-tools` 现有实现一致、同步返回、免轮询，实测同样接受该 SPL |
| 7 | `alert_name` / `levels` 等参数会拼进 SPL 字面量 | 特殊字符可能破坏语句 | **已闭合**：只做结构化拼接 + 字面量转义，不开放自由注入（**无 `extra_filter`**）。`alert_name` 一律拼成**不带引号**的 `alert_name:<转义后字面量>`——ASCII 非字母数字字符前置 `\`（日志易自家钻取过滤器 `${token\|e}` 的官方做法），非 ASCII 原样保留，`*` 保留为通配符。实测 28 组字符全部与双引号参考写法等价；`"` 与 `\` 不再需要拒绝（§3.2.1） |
| 8 | 相对时间窗口的写法随日志易版本不同（`now-24h,now` vs `-24h,now`） | 换环境即报 `4003`，工具不可用 | **已闭合**：默认值改 `-24h,now`，并加 `normalize_history_time_range` / `normalizeHistoryTimeRange` 把 `now-<N><unit>,now` 归一化，双端同实现（§2.1 / §3.2） |
| 9 | **原 `auth.py` 对所有认证方式都从凭据拆 `username` 并注入 query 参数** | Basic 部署（`192.168.43.196`）直接 `4104 Parameters 中不支持传入 username`，请求全挂 | **已闭合（真实缺陷）**：`username` 只在 `authorization.kind == "apikey"` 时注入；Basic 不再注入，身份改从 `context.authorization.username` 读取（`servers.py` / `mcp-tool-helpers.ts` 同步）；显式 `LOGEASE_USERNAME` 仍优先。新增 `test_auth_context.py` / `auth-context-test.mjs` 锁定 |
| 10 | **`log-tools` 的检索工具仍是 `now-24h,now` 默认值**（`log_tools_definitions.py` / `log_tools_server.py` / `ts/src/tools.ts`） | 在只接受 `-<N><unit>,now` 的日志易版本上，该工具同样会报 `4003` | **开放（本次未改，超出本工具范围）**：本次只修了 `get_triggered_alerts`。若要一并修，可复用同一套归一化逻辑——但会改变 `log-tools` 的既有默认值与行为，需单独评审 |
| 11 | **`page` 参数并非所有日志易构建都支持** | env2 那套构建完全忽略 `page`，恒返回首页；调用方按 `has_more=true` 去翻页会拿到重复数据 | **部分闭合（服务端行为，SPL 层面绕不过去）**：已去掉 SPL 里硬编码的 `\| limit`（那是本工具自己的 bug，会让 env1 也无法翻页，§3.4.1）；剩余的是上游限制。冒烟脚本改为如实 `[warn]` 而非判失败，并在参数说明里标注。调用方需要收窄结果时应调小 `size` / 缩小 `time_range` / 加 `alert_name` 过滤 |
| 12 | 通配符模式（`交换机*`）能否吃到索引 | 大窗口 + 宽通配时比精确匹配慢 | **已缓解**：上一版走 `\| where like` 管道，**完全**吃不到索引；现在 `alert_name:交换机*` 与精确子句同级，走搜索表达式。实测 env1 `-7d` 下 `交换机*` 27144 条、`*Brute Force*` 3249 条均可正常返回；前导通配（`*foo`）是否仍要全扫取决于日志易实现，无法在本环境证伪——宽通配仍建议配合 `time_range` 收窄 |
| 13 | **转义字符集是实测归纳的，不是官方清单** | 若某字符的转义语义与实测不同，可能出现静默 0 命中 | **已知并接受**：日志易未公开"特殊字符"清单（`docs/dashboard.adoc` 只描述行为不给集合）。本设计采取"**统一转义所有 ASCII 非字母数字字符**"，实测 20+ 字符（含空格、`-`、`/`、`()`、`[]`、`{}`、`:`、`\|`、`"`、`'`、`!`、`<`、`>`、`\`、`*`、`_`、`.`、`,`、`=`）均为"转义等价于字面量"，因此超集转义不会引入新的静默错误。唯一无法验证的是**字面星号**（`*` 恒为通配符，见 §3.2.1 末尾） |
| 14 | 非 ASCII 字符（汉字、全角标点）不做转义 | 若某个全角标点恰是 SPL 语法字符，可能出问题 | **已知并接受**：全角字符在所有实测样例（含含全角逗号的 `result.description`）中都不需要转义；反过来对多字节字符做 `\` 前缀无法在真实数据上验证，风险更高。故选择"只转义 ASCII" |

---

## 十一、实施计划（拆任务）

| 阶段 | 内容 | 产出 | 状态 |
|---|---|---|---|
| P0 | 评审通过：**不开放 `extra_filter`**；`entity_fields` 取告警结果字段（`result.appname` / `result.ip` / `result.hostname` 形态），默认 `["result.appname","result.ip"]` | 已锁定（2026-09-30） | ✅ |
| P1 | Python 纯函数（`build_history_query` + 6 个 resolve + `normalize_history`）+ 单测 | `python/rizhiyi_mcp/service_alerts.py`、`python/tests/test_alerts_service.py`（30 用例） | ✅ |
| P2 | Python 工具定义 + handler + 服务说明 | `ALERT_TOOLS` 新增 `get_triggered_alerts`、`create_alerts_server` handler、`SERVER_LEVEL_INSTRUCTIONS` 第 9 条 | ✅ |
| P3 | TS 侧镜像实现（`alerts.ts` + `tools.ts` + `alert-server.ts`） | `ts/src/modules/alerts.ts`、`ts/src/tools.ts`、`ts/src/alert-server.ts` | ✅ |
| P4 | TS 纯函数自测（`alert-selfcheck.mjs`） | 同构断言，双端黄金样例一致 | ✅ |
| P5 | 真实环境冒烟 + README/CHANGELOG | `ts/scripts/alert-history-smoke.mjs`、`README.md`、`CHANGELOG.md` | ✅ |
| P6 | 记录到 `.workbuddy-ai/memory/` | 工作日志 | ✅ |
| P7 | 研发确认分段实体 schema 后修正取值路径（`result.is_segmentation` / `result.segmentation_field` / `result.segmentation_specify_value`）+ 双端测试 + 真实数据验证 | 见 §2.4；`entity_candidates` 增补分段字段名 | ✅ |
| P8 | 换环境（`192.168.43.196`，Basic 认证）复测：暴露相对时间窗口写法差异与 `username` 参数缺陷，双端修复 | `normalize_history_time_range` / `normalizeHistoryTimeRange`、`auth.py` / `auth-context.ts`、`test_auth_context.py` / `auth-context-test.mjs` | ✅ |
| P9 | 修复后重跑双端逐字节比对（5 场景含分段） | §8.3 `PARITY OK` | ✅ |
| P10 | **接口评审后的精简与修复**：删 `only_triggered` / `include_notification_text` / `description_max_chars` 三个内部旋钮；`alert_name` 支持 `*` 通配；去掉 SPL 硬编码 `\| limit` 修复分页；返回结构不再回显 `entity_fields` | §3.2 / §3.2.1 / §3.4.1 / §3.3；`build_history_name_filter`；`test_alerts_service.py` + `alert-selfcheck.mjs` | ✅ |
| P11 | **改用索引级转义子句替换 `\| where like`**：按用户反馈（"like 效率不高"）与 env2 真实查询样例，改为 ASCII 非字母数字统一前置 `\` 的 `alert_name:<字面量>`；`*` 保留通配；删除 `build_spl_like_pattern` / `escape_spl_literal` 与整个 `stage` 通道；`"`/`\` 从"拒绝"改为"转义" | `escape_spl_term` / `escapeSplTerm`、`build_history_name_filter` 简化；`test_alerts_service.py` 43 用例 + `alert-selfcheck.mjs` + §8.7 查询构造 parity（28 组）+ §8.4 两套环境实跑对照 | ✅ |

> 交付验证见 §8：Python `218 passed / 1 skipped`（唯一失败是已知的 Python ≥3.12 求和差异）、
> `tsc` 零错误、TS 校验脚本 12 个全绿（`*-test.mjs` 11 个 + `alert-selfcheck`，工具数保持 85）、
> 双端字节级比对 `normalize_history` 6 场景 + 查询构造 28 组 全 `PARITY OK`、
> 两套环境冒烟 `alert-history-smoke: ALL PASSED ✓`（`172.21.16.9` apikey + `192.168.43.196` Basic），
> 且 8 个真实告警名的"新转义写法 vs 双引号参考写法"计数逐条一致；
> 分段实体已在真实触发记录上端到端验证（§8.6）。

---

## 十二、一句话总结

用 `index=monitor appname:alert_record` 这一条**唯一可用**的查询路径（必须带 `index=monitor`），
配恒定的 `'issue_alert':true AND NOT 'is_recovery':true` 过滤出真实触发记录，
在告警服务里新增 `get_triggered_alerts`，把记录规整成
「名称 / 触发时间 / 实体 / 级别 / 值 / 描述」六要素；
实体优先取分段（分组）字段——`result.is_segmentation=true` 时用 `result.segmentation_field` 作字段名、
`result.segmentation_specify_value` 作字段值——再合并用户可自定义的 `entity_fields`
（默认告警结果字段 `result.appname` + `result.ip`），
全部字段都带显式回退链与来源标记，双端对称实现并用同一份黄金样例锁定。

接口只暴露**有查询语义**的参数：不传任何监控项即全系统总体视图，`levels` 不传即全级别，
`alert_name` 支持 `*` 通配（其余字符按日志易自家的 `\` 转义规则处理，因此含空格/斜杠/括号的
真实告警名也能精确命中，且全程走索引、不用 `| where like` 管道）；
截断长度、通知正文回退、是否只看触发这类**内部实现细节不再外露**。
