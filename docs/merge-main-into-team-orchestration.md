# 把 main 合回 feat/team-orchestration（待执行）

> 状态：**阻塞中** —— 另一个会话正在 `feat/team-orchestration` 工作区里开发，
> 有 2000+ 未提交改动。等那边收工、工作区干净后再按本文执行。

## 基线（2026-10-30）

| 分支                      | HEAD       | 说明                               |
| ------------------------- | ---------- | ---------------------------------- |
| `main` / `github/main`    | `6a597afd` | 已同步，无未推送提交               |
| `feat/team-orchestration` | `0af8c5b1` | 领先 main 21 个提交，**落后 5 个** |

落后 main 的 5 个提交（分支里一个都没有）：

```
6a597afd  feat(kernel): 内核与客户端解耦收口
fe3e3880  perf(build): 安装包瘦身
6f184d6f  fix(desktop): electron-vite 的 CJS shim 修复
c7a580bb  chore(desktop): 删除悬浮宠物
eee77eac  feat(database): 原生数据库接管 dbx
```

## 执行步骤

### 1. 合并

```bash
git fetch github
git status            # 必须干净
git merge main
```

### 2. 解决 4 个冲突

`git merge-tree --write-tree main feat/team-orchestration` 已确认只有这 4 个：

**a. `packages/novaway/src/tool/registry.ts`**
两边都加了 `database_*` capability。按 main 基线的 `Tool.Capabilities` 形态保留：

```ts
database_list: { readOnly: true, concurrencySafe: true },
database_tables: { readOnly: true, concurrencySafe: true },
database_describe: { readOnly: true, concurrencySafe: true },
database_query: { maxResultBytes: 200_000 },
```

（main 那一版还没有 `idempotent` 字段、`destructive` 也不接受函数；分支里的 `team_*` 条目全部保留。）

**b. `packages/novaway/src/server/routes/instance/httpapi/server.ts`**
两层都留：

```ts
      Elicitation.defaultLayer,   // 来自 main（MCP elicitation）
      Reference.defaultLayer,     // 来自分支
```

**c/d. `packages/sdk-v2-latest/src/v2/gen/{sdk,types}.gen.ts`**
**不要手工合并**。先随便取一侧让它不冲突，然后按下一步重新生成覆盖。

### 3. 重新生成 SDK

```bash
cd packages/sdk/js && bun run build
cd ../../sdk-v2-latest && bun run build
```

两个脚本内部都会在 `packages/novaway` 执行 `bun dev generate` 并重写
`openapi.json` + `src/v2/gen/**`。

### 4. 校验

```bash
bun run typecheck                                   # 根目录 turbo，16 个任务
cd packages/novaway && bun test test/database test/tool/registry.test.ts
cd packages/desktop && bun run prebuild && bun run build   # 验证 CJS shim 与打包配置
```

`packages/desktop` 的 `bun run build` 通过即说明 `electron.vite.config.ts` 里
`novaway:cjs-shim` 插件仍在生效（否则会报 `Unterminated string literal`）。

### 5. 提交并推送

```bash
git commit -m "merge: 合入 main（原生数据库 / 瘦身 / CJS shim / 删宠物 / 内核解耦）"
git push github feat/team-orchestration
```

pre-push 钩子会跑全仓 `bun typecheck`，必须用真实的 node_modules
（不要用 junction 临时 worktree，`@novaway/app` 会解析到别的检出）。

## 收尾注意

- 工作区里那批未提交的瘦身改动（删宠物、拆 dbx、打包配置）与 main 已提交内容
  **重复**，合并时以 main 为准丢弃重复部分，否则会变成大面积冲突。
- 不要在有其他会话运行时 `git add -A`：2026-10-30 曾把对方进行中的 merge
  一起提交（已 reset 恢复，未丢代码）。快照 tag `slim-snapshot-20261030` 仍在。
- 离线打包（Electron 下载被墙）：解压
  `~/AppData/Local/electron/Cache/68ef756a.../electron-v42.1.0-win32-x64.zip`
  到 `packages/desktop/.tmp/electron-42`，然后
  `bunx electron-builder --win --config electron-builder.config.ts --config.electronDist=.tmp/electron-42`。
