# Tasks

- [x] Task 1: 将 DBX 注册为内置 MCP 服务器
  - [x] SubTask 1.1: 在 `packages/opencode/src/config/config.ts` 的 `DEFAULT_MCP_SERVERS` 中新增 `dbx` 条目
  - [x] SubTask 1.2: 确认配置加载时会自动将缺失的默认 MCP 服务器写入 `novaway.json`

- [x] Task 2: 移除自研 `database_sql` 工具
  - [x] SubTask 2.1: 删除 `packages/opencode/src/tool/database-sql.ts`
  - [x] SubTask 2.2: 在 `packages/opencode/src/tool/registry.ts` 中移除 `DatabaseSqlTool` 的 import、初始化与 `database_sql` 注册

- [x] Task 3: 移除数据库 HTTP API
  - [x] SubTask 3.1: 删除 `packages/opencode/src/server/routes/instance/httpapi/groups/database.ts`
  - [x] SubTask 3.2: 删除 `packages/opencode/src/server/routes/instance/httpapi/handlers/database.ts`
  - [x] SubTask 3.3: 在 `packages/opencode/src/server/routes/instance/httpapi/server.ts` 中移除 `databaseHandlers` import 与 `Layer.provide` 引用
  - [x] SubTask 3.4: 在 `packages/opencode/src/server/routes/instance/httpapi/api.ts` 中移除 `DatabaseApi` import 与 `.addHttpApi(DatabaseApi)`
  - [x] SubTask 3.5: 在 `packages/opencode/src/server/routes/instance/httpapi/middleware/authorization.ts` 中移除 `DatabasePaths` import 与相关公开路径放行逻辑

- [x] Task 4: 移除 UI Database Tab
  - [x] SubTask 4.1: 删除 `packages/app/src/pages/session/database-tab.tsx`
  - [x] SubTask 4.2: 在 `packages/app/src/pages/session/session-side-panel.tsx` 中移除 `DatabaseTab` import、触发器、内容区及 `setFileTreeTabValue` 中的 database 分支
  - [x] SubTask 4.3: 在 `packages/app/src/context/layout.tsx` 中将 fileTree tab 类型从 `"changes" | "all" | "review" | "database"` 精简为 `"changes" | "all" | "review"`，并移除相关 normalize 分支

- [x] Task 5: 更新系统提示与连接注入逻辑
  - [x] SubTask 5.1: 重写 `packages/opencode/src/session/prompt/database-rule.txt`，指导 AI 使用 DBX MCP 工具
  - [x] SubTask 5.2: 在 `packages/opencode/src/session/instruction.ts` 中移除读取 `.novaway/db-connections.json` 并注入系统提示的代码块

- [x] Task 6: 重新生成 SDK 与 OpenAPI
  - [x] SubTask 6.1: 使用 `bun dev generate` 重新生成 `packages/sdk/openapi.json`（通过 Bun spawn 避免 Windows 重定向截断）
  - [x] SubTask 6.2: 运行 `bun ./packages/sdk/js/script/build.ts` 重新生成 SDK
  - [x] SubTask 6.3: 确认生成产物中不再包含 database 相关 API 类型

- [ ] Task 7: 验证
  - [ ] SubTask 7.1: 运行 `bun lint`
  - [ ] SubTask 7.2: 运行 `bun typecheck`（在相关包目录分别执行）
  - [ ] SubTask 7.3: 运行 `packages/opencode` 的测试与 `test:httpapi`
  - [ ] SubTask 7.4: 启动开发服务，确认设置页 MCP 列表出现 `dbx` 且侧栏无“数据库” tab

# Task Dependencies

- Task 2 依赖 Task 1（先确保 DBX 工具可用再移除旧工具）
- Task 3 依赖 Task 4（后端 API 移除后 UI 调用点也同步移除，避免编译错误）
- Task 6 依赖 Task 3（API 删除后重新生成）
- Task 7 依赖 Task 6（生成完成后再做全量验证）
