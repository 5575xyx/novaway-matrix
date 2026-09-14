# 预览 V2 验证报告：分屏 + dev server 自动发现

生成时间：2026-09-14
设计契约：`.claude/context-summary-preview-v2.md`

## 1. 验证环境

- 平台：Windows PowerShell，Bun 1.3.14
- 类型检查器：`tsgo -b`（`bun typecheck`）
- Lint：根目录 `oxlint`（130 rules / 16 threads）
- 测试：`bun test`，UI 相关用例带 `--preload ./happydom.ts`
- 桌面端无法实机运行（规则禁止后台起服务），故只做类型与静态校验，行为验收留给人工

## 2. 命令与结果

| 命令 | 工作目录 | 结果 |
| --- | --- | --- |
| `bun typecheck` | `packages/app` | 0 错误，EXIT=0 |
| `bun typecheck` | `packages/desktop` | 0 错误，EXIT=0 |
| `bun test --preload ./happydom.ts <7 个相关用例文件>` | `packages/app` | 41 pass / 0 fail，169 断言 |
| `bun test --preload ./happydom.ts ./src` | `packages/app` | 570 pass / 8 fail / 1 error |
| `bun run lint <15 个改动文件>` | 仓库根 | 34 warnings / 0 errors |

### 全量测试的 8 fail + 1 error 判定为基线，与本轮改动无关

失败全部落在本轮**未触碰**的模块：

- `src/components/file-tree.test.ts`（1 fail）
- `src/utils/model-name.test.ts`（2 fail）
- `src/components/prompt-input/submit.test.ts`（4 fail，`modelsCtx.autoMode` 为 undefined）
- `src/pages/session/message-timeline.data.test.ts`（1 error，`@solidjs/router` 未导出 `useLocation`）

已用 `Select-String` 确认上述模块不含 `preview` / `devServer` / `viewMode` 相关引用（仅 `submit.ts` 有一个无关的 `preview?: string` 字段）。

### oxlint 34 warnings 判定为基线

其中 2 条落在本轮新增文件（`context/preview.tsx:9`、`context/dev-server.tsx:11`），规则 `typescript-eslint(unbound-method)`，指向 `createSimpleContext({ use ... })`。对既有 `context/terminal.tsx` + `context/command.tsx` 单独跑同一命令得到 8 条同类 warning —— 即**每个** `createSimpleContext` 调用点都会触发，属于仓库既有风格，非新增问题。其余 32 条分布在 `session.tsx` 等文件的 `consistent-return` / `unbound-method`，行号均不在本轮改动范围内。

## 3. 逐条验收标准自评

| # | 标准 | 状态 | 依据 |
| --- | --- | --- | --- |
| 1 | 标题栏按钮循环 chat → split → preview → chat，图标与 tooltip 同步 | 静态通过，待人工 | `layout.tsx:941-947` `toggle()` 三态循环；`session-header.tsx` 图标三态 `layout-right` / `layout-right-partial` / `layout-right-full`，`text-icon-strong` 判定改为 `!== "chat"` |
| 2 | split 下可横向拖拽，拖拽无过渡动画，拖到 320 以下不折叠 | 静态通过，待人工 | `ResizeHandle direction="horizontal" edge="start" min={320}`；宽度持久化到 `layout.previewWidth`，`previewMaxWidth()` 上限 `窗口宽 × 0.6` 且不低于 320；未接 `onCollapse`，故不会折叠 |
| 3 | 刷新/重启后 split 宽度与模式按会话恢复 | 静态通过 | `layout.tsx:110-112` `previewWidth?: number` 与 `viewMode?` 均在持久化的 sessionView 形态内；宽度走 `previewWidth.set()` 落库 |
| 4 | 终端打印 dev server 后浮出建议条，点「打开」填入地址并切到 split | 静态通过，待人工 | `terminal.tsx:579` `devServers.report(data)` 在 `output.push` 之前、且仅走 string 分支（控制帧 L574 提前 return）；`dev-server.tsx:56-62` `accept()` 写 URL 并 `viewMode.set("split")` |
| 5 | 忽略后不重复弹；不同端口分别弹 | 单测通过 | `utils/dev-server-detect.test.ts` 15 例覆盖去重、多端口、ANSI、跨 chunk、`0.0.0.0 → localhost` |
| 6 | 切换 workspace 后建议重置 | 静态通过 | `dev-server.tsx:23-37` `createEffect` 监听 `sdk.directory` 与 `sessionKey()`，换目录重建 detector 去重集合、换会话清空 pending；Provider 本身也在 keyed Show 内随目录重挂 |
| 7 | typecheck / oxlint / i18n parity 全绿；新增单测通过 | 通过 | 见第 2 节；`preview-url.test.ts` 6 例、`dev-server-detect.test.ts` 15 例、`parity.test.ts` 1 例均绿 |

## 4. 与设计契约的偏差

1. **Provider 挂载位置改为 `pages/directory-layout.tsx`**（契约写的是 `app.tsx`）。原因：`usePreview` 需要 `Persist.workspace(directory)`、`useDevServers` 需要 `useSessionLayout()` 的 `useParams()`，两者都必须位于 `/:dir` 路由作用域内；且挂在 `<Show when={resolved()} keyed>` 里可保证换工作区自动重建，与 `SDKProvider` 的生命周期一致。
2. **未做标题栏建议角标**。浮动建议条已承担提示职责，角标会与其信息完全重复，故删除。`session-header.tsx` 只保留三态图标 + 三态 tooltip 文案。
3. **建议条定位在会话内容行内**，而非会话面板右下角。给内容行容器补了 `relative`，使 `bottom-3 right-3` 落在 composer 之上而不遮挡输入框。
4. **`normalizePreviewUrl` 顺带修掉 3 个 V1 遗留缺陷**（由新增单测暴露）：
   - 裸 `localhost:3000` 被当成文件路径，得到 `file:///localhost:3000` → 现补 `http://`
   - `://` 未被拒绝，得到 `file:///://` → 现拒绝
   - `file:///`（只有根）未被拒绝 → 现要求 pathname 长度 > 1
   实现上把「盘符路径」「裸 localhost 地址」两类判断前置到通用协议判断之前，规避 `new URL` 把 `localhost:` 当协议解析的坑。
5. **`createSimpleContext` 必填 `name` 已补**（`"Preview"` / `"DevServer"`）。首次 typecheck 因此报 `TS2305`/`TS18046`/`TS2345`，同时 `createStore` 应从 `solid-js/store` 导入而非 `solid-js`，一并修正。

## 5. 未覆盖 / 需人工确认

- 桌面端本地文件预览（上一轮改动，涉及 `packages/desktop` 的自定义协议与 `oc-file`）本轮只做 typecheck，未实机点开文件验证。
- `message-timeline.data.test.ts` 的 `useLocation` 导出错误来自 `@solidjs/router@0.15.4` 包本身，与本轮无关，建议单独排查依赖版本。
- 分屏拖拽的手感（`min(px, 60%)` 与 `previewPaneWidth()` 在极端窄窗口下可能有细微不一致）需人工确认。

## 6. 实机首跑暴露的问题（已修）

**TDZ：`ReferenceError: Cannot access 'store' before initialization`（`previewMaxWidth`）**

`previewMaxWidth` 最初放在组件上半段，内部读 `store.view`，但 `const [store, setStore] = createStore(...)` 声明在更靠后。TS 不检查闭包内的前向引用（函数体被视为延迟执行），所以 typecheck 全绿；但 `previewPaneWidth = createMemo(...)` 在定义处**立即**求值，同步调到 `previewMaxWidth()` → 撞上 TDZ → 整个页面白屏。

修复：把 `previewMaxWidth` / `previewPaneWidth` 两行移到 `createStore` 之后，并留注释说明原因。教训是 `createMemo` / `createComputed` / `createEffect` 的首次执行是同步的，凡是被它们立即执行的引用都必须已初始化，不能靠"反正函数后面才会跑"来安排顺序。

已全量排查本轮新增代码的同类风险：其余 `createEffect` / `persisted` / `createStore` 调用所引用的绑定均已在其前声明；`use-session-commands.tsx` 的 handler 是纯回调，无立即执行问题。`ResizeHandle` 用 `splitProps` 代理，`size`/`min`/`max` 在 `mousedown`/`mousemove` 时才读取，传 memo 安全。

**composer 没跟着左栏收窄**

分栏最初只加在消息行（`content row`）内部，而对话框是会话面板的另一个子元素，位于消息行**之下**、横跨整个会话面板宽度 —— 于是分屏时聊天消息缩到了左边，输入框却仍然横跨到预览页下面。

修复：把分栏上提一层，左栏改成纵向 `flex flex-col`，同时装「消息容器（`flex-1 min-h-0`）」和「对话框（`shrink-0`）」，右栏只放预览。核对过 `session-composer-region.tsx` 根容器是 `shrink-0 w-full flex flex-col` 的普通流式布局，无绝对定位，所以换参照物不会错位。顺带确认 `centered()` 的居中现在是相对左栏宽度计算，行为正确。改完用 `bunx prettier --write` 只格式化了这一个文件。

## 7. 结论

静态层面全部通过：两个包 typecheck 0 错误、oxlint 0 错误（warnings 均为基线）、新增 21 例单测全绿、相关回归 41 例全绿、全量 570 通过且失败项均在未触碰模块。验收标准 1–6 中依赖交互表现的 4 条（1、2、4、5 的呈现部分）需要人工实机确认。
