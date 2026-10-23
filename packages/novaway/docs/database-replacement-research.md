# 数据库实现替换调研

> 现状：数据库能力来自内置的 `@dbx-app/mcp-server`（`packages/desktop/resources/dbx-mcp`），
> 由 MCP 的 `dbx_*` 工具提供，UI 通过 `/experimental/tool/call` 调用，拿到的是 **markdown 文本**。
> 本文评估替换方案，不改动现有功能。

## 一、现状与根因

### 1. 为什么结果被截断在 100 行

`@dbx-app/node-core/dist/database.js`：

```js
const MAX_ROWS = 100
function resolveMaxRows(options) {
    return options?.maxRows ?? MAX_ROWS      // ← 其实支持传参
}
export async function executeQuery(config, sql, options) { ... }
```

`executeQuery` **支持 `options.maxRows`**，但 MCP 层（`dist/index.js`）从不传这个参数：

```js
server.tool("dbx_execute_query", "… (max 100 rows returned)", {
    connection_name, database, sql            // ← 只有三个参数
}, async ({ connection_name, database, sql }) => {
    const result = await backend.executeQuery(withDatabase(...), statement)   // 没有 options
    return formatQueryToolResult(result)
})
```

所以「100 行」不是数据层限制，而是 **MCP 适配层没有暴露参数**。

### 2. 为什么返回文本而不是结构化数据

`node-core` 返回的是结构化的：

```ts
{ columns: string[], rows: Record<string, unknown>[], row_count: number }
```

但 MCP 层用 `formatQueryToolResult` 把它压成 markdown：

```js
const rows = result.rows.map((r) => result.columns.map((c) => formatCell(r[c])))
return text(`${prefix}${mdTable(result.columns, rows)}\n\n${result.row_count} row(s)`)
```

而 `formatCell` **不转义** `|` 与换行，这就是 UI 侧必须写「按列边界切分」解析器的原因。

### 3. 其它结构性限制

| 限制                                         | 来源                                 |
| -------------------------------------------- | ------------------------------------ |
| 无分页游标                                   | MCP 层无 offset / cursor 参数        |
| `NULL` 与字符串 `"NULL"` 不可区分            | `formatCell` 把 null 输出成 `"NULL"` |
| JSON 字段被 `String()` / `JSON.stringify` 化 | 同上                                 |
| 无事务                                       | MCP 每次调用独立执行                 |
| 无查询历史                                   | 未实现                               |

### 4. 体积现状

`packages/desktop/resources/dbx-mcp` 合计 **417 MB**，其中真正与数据库相关的只有：

| 包                       | 体积                                                    |
| ------------------------ | ------------------------------------------------------- |
| `@dbx-app/node-core`     | 184 KB                                                  |
| `mysql2`（纯 JS）        | 834 KB                                                  |
| `pg`（纯 JS）            | 138 KB                                                  |
| `ioredis`（纯 JS）       | 1.1 MB                                                  |
| `better-sqlite3`（原生） | 69 MB（build 59MB + deps 9.8MB）                        |
| `keytar`（原生）         | 11 MB（**node-core 并未 import，属于 DBX 桌面端依赖**） |

其余 ~330 MB 是 DBX 桌面端的 Vue / ECharts / Lucide / TypeScript / Prettier 等前端依赖 ——
它们随 MCP 一起被打进了安装包，与数据库能力无关。

### 5. 能力覆盖（来自 node-core 的 dispatch）

- 直连驱动：MySQL / MariaDB / PostgreSQL / SQLite / RQLite / Redis(standalone) / TDengine
- 经 DBX 桌面端 bridge：MongoDB、SSH 隧道、Proxy、Doris / StarRocks / ManticoreSearch
  （bridge 依赖 `mcp-bridge-port` 文件，即 **DBX 桌面端必须在运行**）

> 这意味着：**我们现在内置的 dbx-mcp 单独跑时，MongoDB / SSH 隧道类连接其实是不可用的**，
> 会走 bridge 并失败。这一点值得在 UI 上标注。

---

## 二、可选路线

### 路线 A：自建瘦 MCP 服务，复用 `@dbx-app/node-core`

保留 MCP 形态与 `dbx_*` 工具名，只重写适配层：

```ts
const result = await backend.executeQuery(config, sql, { maxRows: pageSize + 1 })
return { structuredContent: result, content: [{ type: "text", text: JSON.stringify(result) }] }
```

- ✅ 结构化结果、`maxRows` / `offset` 可传、`NULL` 可区分
- ✅ 连接管理、各数据库方言、SSH/Mongo 逻辑全部复用，零重写
- ✅ 连接存储格式不变（`dbx.db` 的 `connections` / `connection_secrets` 表），无迁移
- ✅ 可按需裁剪依赖：去掉 keytar 与所有前端包，体积 **~8MB（含 better-sqlite3）**
- ⚠️ 仍需独立 node 进程（`better-sqlite3` 是原生模块，与 Electron ABI 不匹配）
- ⚠️ UI 侧要改 7 处调用点：从「解析 markdown」改为「读 JSON」
- 工作量：**约 400–600 行**（服务 ~250 行 + UI 改造 ~150 行 + 测试）

### 路线 B：完全自研数据库服务（novaway 原生 HTTP 路由）

在 `packages/novaway/src/database/` 新建服务，走 `pg` / `mysql2` / `ioredis` 直连，
UI 用类型化 SDK，Agent 侧加一个 `database` 工具。

- ✅ 最干净：无 MCP 跳转、无文本解析、可直接做分页 / 事务 / 历史
- ✅ 纯 JS 依赖，**不需要独立 node 进程**（~2.1MB）
- ❌ 需重写各方言的 `listTables` / `describeTable` / 类型映射（MySQL、PG、SQLite、Redis、Mongo…）
- ❌ 连接存储要迁移（或写一次性导入器读 `dbx.db`）
- ❌ 失去 SSH 隧道与 Mongo（除非再引入 `ssh2` 与 Mongo 驱动）
- 工作量：**约 1500–2000 行**，2–3 天

### 路线 C：直接改 dbx-mcp 的打包产物

在构建脚本里 patch `dist/index.js` 的 `formatQueryToolResult` 与其参数。

- ✅ 改动最小（几行）
- ❌ 每次升级 dbx 都要重新 patch，脆弱
- ❌ 体积仍是 417MB
- 不推荐

### 路线 D：维持现状 + UI 提示（已实施）

已在 `database.tsx` 提示「最多 100 行」「续行已合并」。
**作为过渡手段可接受，但不解决分页与结构化问题。**

---

## 三、对比

| 维度        | A 自建瘦 MCP        | B 原生服务         | C 补丁      | D 现状 |
| ----------- | ------------------- | ------------------ | ----------- | ------ |
| 结构化结果  | ✅                  | ✅                 | ⚠️ 需改格式 | ❌     |
| 分页        | ✅                  | ✅                 | ❌          | ❌     |
| 事务        | ❌                  | ✅                 | ❌          | ❌     |
| 连接迁移    | 无                  | 需迁移             | 无          | —      |
| DB 方言覆盖 | 全部（复用）        | 需重写             | 全部        | 全部   |
| SSH / Mongo | 复用（需 DBX 运行） | 需重做             | 复用        | 同左   |
| 依赖方式    | 独立 node 进程      | 纯 JS 直连         | 同现状      | 同现状 |
| 安装包体积  | ~8MB                | ~2.1MB             | 417MB       | 417MB  |
| 工作量      | 中（400–600 行）    | 大（1500–2000 行） | 小          | 0      |
| 升级风险    | 低（可锁版本）      | 自控               | 高          | —      |

---

## 四、建议

**先做路线 A，把路线 B 作为长期方向。**

理由：

1. 路线 A 能一次性解决用户实际感知的三个问题（100 行、文本解析、`NULL` 不可区分），
   同时**不重写任何数据库方言逻辑**，风险最低；
2. 顺便把安装包从 417MB 降到 ~8MB（仅保留 node-core + 驱动 + better-sqlite3 二进制）；
3. 路线 B 的价值在于事务、查询历史、纯 JS 无 ABI 依赖，这些是「锦上添花」，
   可以等 A 落地、观察真实需求后再做；
4. A 的 UI 改造（把 7 处 `dbx_*` 调用从解析 markdown 改成读 JSON）在 B 中同样需要，
   属于可复用投入。

### 实施步骤（路线 A）

1. 新建 `packages/desktop/resources/db-service/`：
   - `package.json` 仅依赖 `@dbx-app/node-core` + `@modelcontextprotocol/sdk` + `zod`
   - `index.js`：注册 `dbx_list_connections` / `dbx_execute_query`（新增 `limit` / `offset`）
     / `dbx_list_tables` / `dbx_describe_table` / `dbx_remove_connection` / `dbx_execute_redis_command`
   - 返回 `structuredContent` + JSON 文本，旧客户端仍可读
2. 构建脚本：安装依赖后把 `node-core` 与驱动复制进去，删除 `build/Release/obj` 等中间产物
3. `desktop/src/main/index.ts`：`DBX_MCP_SERVER_PATH` 指向新服务（保持环境变量名不变）
4. UI：`database.tsx` 改为优先读 `structuredContent`，回退到既有解析器（兼容旧服务）
5. 测试：新增 `structuredContent` 解析测试；保留 dbx-table 解析器作为兼容层

### 待验证

- [ ] `better-sqlite3` 二进制能否直接从现有 `dbx-mcp/node_modules` 复用（同 Node 版本时通常可以）
- [ ] 裁剪后的 node_modules 实际体积（预计 8–12MB）
- [x] `structuredContent` 透传：**可以**。
      `mcp.callTool()` 直接返回 SDK 的 `CallToolResult`（`handlers/experimental.ts` 未做二次加工），
      而内置的 `@modelcontextprotocol/sdk@1.29.0` 的 `CallToolResultSchema` 已包含
      `structuredContent`（`dist/esm/types.js:1302 / 1472`）。
      UI 侧只需在 `utils/tool-call.ts` 增加一个 `extractStructured()`。
- [ ] 上游 `@dbx-app/node-core` 的版本策略：锁版本 + 记录升级检查清单
