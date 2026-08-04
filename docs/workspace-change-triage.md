# novaway-coder 工作区改动分类（2026-07-19T06:39:56Z）

> **状态更新（2026-07-23）**：PowersNexus 第一方独立工作流已下线，改为默认全局插件 PowersNexus@git+https://gitee.com/nova-way/powersnexus.git（启动从 Gitee 安装）。下列历史 triage 条目仅作归档参考。

## 远程状态

> **状态更新（2026-07-23）**：PowersNexus 第一方独立工作流已下线，改为默认全局插件 PowersNexus@git+https://gitee.com/nova-way/powersnexus.git（启动从 Gitee 安装）。下列历史 triage 条目仅作归档参考。

- 当前仓库 **没有配置 git remote**（git remote 为空）。
- 本地 HEAD：`507d9c1`（历史：曾含 PowersNexus 第一方集成，现已回退为插件）。
- **在添加 remote 并确认分支策略之前，无法 push。**

## 已提交（可推远程的第一刀）

> **状态更新（2026-07-23）**：PowersNexus 第一方独立工作流已下线，改为默认全局插件 PowersNexus@git+https://gitee.com/nova-way/powersnexus.git（启动从 Gitee 安装）。下列历史 triage 条目仅作归档参考。

- `507d9c1` PowersNexus 第一方 bundled 集成（已废弃，改为 Gitee 插件）
- 不含 dbx-main、浮窗、嵌套 PowersNexus 仓库等

## 不建议提交（垃圾/缓存/嵌套仓库）

> **状态更新（2026-07-23）**：PowersNexus 第一方独立工作流已下线，改为默认全局插件 PowersNexus@git+https://gitee.com/nova-way/powersnexus.git（启动从 Gitee 安装）。下列历史 triage 条目仅作归档参考。

| 路径                                 | 原因                                                  |
| ------------------------------------ | ----------------------------------------------------- |
| `.claude/test-node-download/`        | 下载的 node 二进制与缓存                              |
| `.dbx-test-data/`                    | 本地测试数据                                          |
| `packages/desktop/.tmp/`             | 编译缓存                                              |
| `packages/opencode/.tmp-browser-qa/` | 浏览器验收临时截图                                    |
| `tmp-cdp-*.mjs` / `test-redirect.*`  | 临时脚本                                              |
| `harness-tasks.json.corrupt-*`       | 损坏备份                                              |
| `PowersNexus/`                       | 独立 git 仓库，应通过 remote 管理，勿整仓并入 novaway |
| `dbx-main/`                          | 大体量外部/并行工程，不宜混入本主题提交               |
| `pets-images/`                       | 资源素材，需单独确认产品归属                          |

## 可另开主题再提交（有价值但与历史 PowersNexus 第一方主题无关）

> **状态更新（2026-07-23）**：PowersNexus 第一方独立工作流已下线，改为默认全局插件 PowersNexus@git+https://gitee.com/nova-way/powersnexus.git（启动从 Gitee 安装）。下列历史 triage 条目仅作归档参考。

| 主题                   | 代表路径                                                                              |
| ---------------------- | ------------------------------------------------------------------------------------- |
| 桌面浮窗/剪贴板        | `packages/desktop/src/main/floating-*.ts`、`clipboard-file.ts`、`renderer/floating.*` |
| Agent 选择/Provider UI | `dialog-*-provider*`、`assistant-panel.tsx`、`select-provider-combobox.tsx`           |
| 数据库页 / dbx         | `packages/app/src/pages/database.tsx`、`.trae/specs/replace-database-with-dbx-mcp/`   |
| 媒体工具栏/宠物        | `packages/ui/.../media-toolbar.tsx`、`packages/app/public/pets/`                      |
| 多语言其余语种         | `packages/app/src/i18n/{ar,ja,ko,...}.ts`（zh/en 曾含第一方文案，现已移除）           |
| 规格文档               | `.trae/documents/*`、`.trae/specs/*`                                                  |

## 推荐操作顺序

> **状态更新（2026-07-23）**：PowersNexus 第一方独立工作流已下线，改为默认全局插件 PowersNexus@git+https://gitee.com/nova-way/powersnexus.git（启动从 Gitee 安装）。下列历史 triage 条目仅作归档参考。

1. 确认 novaway-coder 远程地址（origin）并 `git remote add origin <url>`。
2. 仅 push `507d9c1`（或先 PR）。
3. 其余主题各自开分支 / 分 commit。
4. 垃圾路径保持 ignore，不要 `git add .`。
