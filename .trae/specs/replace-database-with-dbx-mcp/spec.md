# 将数据库能力替换为 DBX 内置 MCP

## Why

当前 OpenCode 自己维护一套数据库连接、SQL 执行和 UI（`database_sql` 工具 + `/database` HTTP API + Database Tab），依赖本机数据库 CLI、需要手动填写连接参数，维护成本高且能力有限。DBX 已经提供了成熟的 MCP Server，可自动读取 DBX 中已配置的连接，提供连接管理、列表、表结构、SQL 执行、Redis 等 9 个工具，并内置连接池与 SQL 安全检查。把 DBX 作为内置 MCP 接入，可以直接复用 DBX 生态，减少自研数据库实现。

## What Changes

- 在 `packages/opencode/src/config/config.ts` 的 `DEFAULT_MCP_SERVERS` 中新增 `dbx` 内置 MCP 服务器。
- 移除 `packages/opencode/src/tool/database-sql.ts` 及在 `tool/registry.ts` 中的注册。
- 移除 `packages/opencode/src/server/routes/instance/httpapi/groups/database.ts` 与 `handlers/database.ts`，并从 `server.ts`、`api.ts` 中取消引用。
- 移除 `packages/app/src/pages/session/database-tab.tsx`，并从 `session-side-panel.tsx`、`session-layout.ts` 中移除 database tab 相关逻辑与类型。
- 更新内置数据库规则 `packages/opencode/src/session/prompt/database-rule.txt`，改为指导 AI 使用 DBX MCP 工具。
- 移除 `packages/opencode/src/session/instruction.ts` 中从 `.novaway/db-connections.json` 读取并注入连接信息的逻辑。
- 重新生成 SDK 与 OpenAPI（`./script/generate.ts`）。
- 运行 lint、typecheck 和相关测试验证变更。

## Impact

- Affected specs: MCP 内置服务器、工具注册、HTTP API、会话系统提示、UI 侧栏布局。
- Affected code:
  - `packages/opencode/src/config/config.ts`
  - `packages/opencode/src/tool/database-sql.ts`
  - `packages/opencode/src/tool/registry.ts`
  - `packages/opencode/src/server/routes/instance/httpapi/groups/database.ts`
  - `packages/opencode/src/server/routes/instance/httpapi/handlers/database.ts`
  - `packages/opencode/src/server/routes/instance/httpapi/server.ts`
  - `packages/opencode/src/server/routes/instance/httpapi/api.ts`
  - `packages/opencode/src/session/prompt/database-rule.txt`
  - `packages/opencode/src/session/instruction.ts`
  - `packages/app/src/pages/session/database-tab.tsx`
  - `packages/app/src/pages/session/session-side-panel.tsx`
  - `packages/app/src/pages/session/session-layout.ts`（类型）
  - 生成产物：`packages/sdk/js/src/v2/gen/client/`、`packages/sdk/openapi.json` 等

## ADDED Requirements

### Requirement: DBX 作为内置 MCP 服务器

The system SHALL 将 `@dbx-app/mcp-server` 注册为默认内置 MCP 服务器，启动时自动连接。

#### Scenario: 首次启动或 novaway.json 缺少 dbx

- **WHEN** 配置加载流程发现全局配置中不存在 `dbx` MCP 条目
- **THEN** 自动写入 `dbx` 条目：`type: "local"`，`command: ["cmd", "/c", "npx", "-y", "@dbx-app/mcp-server"]`，`enabled: true`

#### Scenario: DBX MCP 工具可用

- **WHEN** 用户会话中 AI 需要查询数据库
- **THEN** 工具列表中应出现 `dbx_dbx_list_connections`、`dbx_dbx_execute_query` 等 DBX 工具，且能正常调用

## MODIFIED Requirements

### Requirement: 系统提示中的数据库规则

The system SHALL 使用 DBX MCP 工具替代 `database_sql` 工具完成数据库操作。

#### Scenario: 普通数据库查询

- **WHEN** AI 需要查询数据库
- **THEN** 优先使用 `dbx_dbx_list_connections` 获取连接，再使用 `dbx_dbx_execute_query` 执行 SQL

#### Scenario: 查看表结构

- **WHEN** AI 需要了解某张表结构
- **THEN** 使用 `dbx_dbx_describe_table` 或 `dbx_dbx_get_schema_context`

## REMOVED Requirements

### Requirement: 内置 `database_sql` 工具

**Reason**: DBX MCP 提供了更完整的 SQL 执行、连接管理、安全检查能力，无需再维护自研 CLI 调用工具。
**Migration**: 已保存的 `.novaway/db-connections.json` 不再被读取。用户需要将这些连接配置迁移到 DBX 应用中；AI 会通过 DBX MCP 自动读取。

### Requirement: UI Database Tab

**Reason**: 数据库连接与查询由 DBX 桌面应用负责，OpenCode 不再提供独立的数据库浏览器。
**Migration**: 用户通过 DBX 应用管理连接；OpenCode 侧栏中的“数据库” tab 被移除。
