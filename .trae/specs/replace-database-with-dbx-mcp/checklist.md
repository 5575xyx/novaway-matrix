- [ ] `packages/opencode/src/config/config.ts` 的 `DEFAULT_MCP_SERVERS` 包含 `dbx` 条目，使用 `@dbx-app/mcp-server` 且 `enabled: true`

- [ ] 全局配置加载逻辑会自动将缺失的默认 MCP 服务器（包括 `dbx`）写入 `novaway.json`

- [ ] `database_sql` 工具已从 `tool/registry.ts` 中移除，工具列表中不再出现 `database_sql`

- [ ] `packages/opencode/src/tool/database-sql.ts` 文件已删除

- [ ] 数据库 HTTP API group 与 handler 文件已删除

- [ ] `InstanceHttpApi` 不再挂载 `DatabaseApi`

- [ ] UI Database Tab 文件已删除

- [ ] 侧栏 tab 列表中不再包含“数据库” tab，tab 类型中不再包含 `"database"`

- [ ] `database-rule.txt` 已更新为 DBX MCP 工具使用指南

- [ ] `instruction.ts` 不再读取 `.novaway/db-connections.json` 并注入系统提示

- [ ] SDK/OpenAPI 已重新生成，产物中不再包含 database 相关接口

- [ ] `bun lint` 通过

- [ ] `bun typecheck` 通过

- [ ] `packages/opencode` 的单元测试与 `test:httpapi` 通过

- [ ] 开发服务启动后，设置页 MCP 列表中出现 `dbx` 状态
