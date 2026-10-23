# 数据库功能

## 架构

自研数据库服务（**不再依赖 dbx MCP**），位于 `packages/novaway/src/database/`：

```
database/
├── schema.ts         公共类型（连接、列、表、查询结果）
├── secrets.ts        密码加密（AES-256-GCM + 安装期随机密钥）
├── store.ts          连接配置存储（data/database/connections.json）
├── service.ts        Database.Service：list / save / remove / test / query / tables / columns
└── drivers/
    ├── postgres.ts   pg（纯 JS）
    ├── mysql.ts      mysql2（纯 JS）
    ├── sqlite.ts     bun:sqlite / node:sqlite（运行时内置，无原生依赖）
    └── redis.ts      ioredis（纯 JS）
```

HTTP 接口挂在实例 API 下：`GET/POST /database`、`DELETE /database/connections/:id`、
`POST /database/connections/:id/test`、`POST /database/query`、
`GET /database/connections/:id/tables`、`GET .../tables/:table/columns`。

## 为什么换掉 dbx

旧实现通过 `@dbx-app/mcp-server` 调用，问题都出在**适配层**：

| 问题     | 旧行为                                    | 现在                                           |
| -------- | ----------------------------------------- | ---------------------------------------------- |
| 结果格式 | 压成 markdown 文本，单元格含 `\|` 会串列  | 结构化 `columns` / `rows`                      |
| 行数     | 固定 100 行，无分页                       | 默认 200 行，支持 limit/offset，可「加载更多」 |
| NULL     | 输出字符串 `"NULL"`，与真实数据无法区分   | `null` 原样返回，UI 单独渲染                   |
| 体积     | 打包 417MB（含 DBX 桌面端前端依赖）       | 纯 JS 驱动，约 2.1MB                           |
| 原生模块 | better-sqlite3 + keytar（ABI 不匹配风险） | 无（SQLite 用运行时内置）                      |

## 分页策略

- `SELECT` / `WITH` 且**顶层没有 `LIMIT`** 时，自动包一层：
  ```sql
  SELECT * FROM (<你的 SQL>) AS __novaway_page LIMIT 200 OFFSET 0
  ```
  由数据库真正分页，不会把百万行拉进内存；
- 已经带 `LIMIT`、写语句、多语句则原样执行，驱动层截断到 `limit + 1` 行并标记 `truncated`；
- UI 命中 `truncated` 时显示「加载更多」，offset 每次 +200。

## 安全

**密码存储**：AES-256-GCM 加密后写入 `data/database/connections.json`，
密钥在同目录 `secret.key`（权限 0600）。API 只回 `hasPassword`，密码永不出现在响应里。
保存时省略 `password` 表示保留旧密码，传空串表示清除。

> 这不能防御「攻击者已能以你的用户身份读任意文件」，但能避免密码以明文躺在
> 便于随手分享的配置文件里。

**SQL 风险**：UI 执行前按三档确认（`app/src/utils/sql-guard.ts`）：

| 风险        | 语句                                       | 表现     |
| ----------- | ------------------------------------------ | -------- |
| safe        | `SELECT …`                                 | 直接执行 |
| write       | `INSERT` / `UPDATE` / `CREATE` …           | 常规确认 |
| destructive | `DELETE` / `DROP` / `TRUNCATE` / `ALTER` … | 红色确认 |

服务端另有 `assertReadOnly()`：Agent 调用（`readOnly: true`）时直接拒绝任何写语句。

## 已知限制

| 限制         | 说明                                                                   |
| ------------ | ---------------------------------------------------------------------- |
| 无事务 UI    | 驱动层支持多语句，但界面一次执行一条；事务请用 SQL 显式 `BEGIN/COMMIT` |
| 无 SSH 隧道  | 需要直连或本地端口转发                                                 |
| 无 MongoDB   | 驱动只覆盖 postgres / mysql / sqlite / redis                           |
| 大结果集     | 分页后单页最多 2000 行（`MAX_PAGE_SIZE`），再大请用聚合或导出          |
| MySQL 大整数 | `BIGINT` / `DECIMAL` 以字符串返回，避免超出 JS 安全整数丢精度          |

## 与旧 dbx 数据的关系

新服务使用自己的连接存储，**不会读取旧 DBX 的 `dbx.db`**。
如需迁移，可在「数据库」页重新添加连接（字段一一对应）。
