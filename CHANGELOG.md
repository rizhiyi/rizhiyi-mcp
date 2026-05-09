# Changelog

## 0.0.2

- 拆分为 3 个独立 MCP server：`rizhiyi_search`、`rizhiyi_manage`、`rizhiyi_dashboard`。
- `dashboard-server` 增强：支持列出 tabs/panels，返回 `panel_id` 精准定位，并支持按 `panel_id` 增删改 panel。
- Dashboard 写入模型对齐真实数据：`type` 表示 panel 类型（如 `trend`/`eventsTable`），`pie`/`single`/`table` 等应放在 `chartType`（旧写法会自动归一）。

## 0.0.1

- 初始版本：提供日志分析工具服务器与通用 OpenAPI 封装能力。
