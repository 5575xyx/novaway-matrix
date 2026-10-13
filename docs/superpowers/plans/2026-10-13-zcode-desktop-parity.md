# 实施计划：NovaWay 桌面端对齐 ZCode（Round 1）

设计规格：`docs/superpowers/specs/2026-10-13-zcode-desktop-parity-design.md`
执行方式：逐任务串行，每个任务一个 commit，任务内先自测再进入下一个。

## 总览

| 任务 | 内容                                                                 | 依赖  | 主要文件                                                                                                                    |
| ---- | -------------------------------------------------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------- |
| T0   | 拆除闪烁诊断脚手架，恢复可验证基线                                   | —     | `packages/app/vite.config.ts`、`app.tsx`、`flicker-diag.tsx` 等                                                             |
| T1   | 平台 chrome：圆角变量 / 窗口根底色 / 帧表面 / resize handle          | T0    | `utils/workspace-chrome.ts`、`layout.tsx`、`session.tsx`、`terminal-panel.tsx`、`session-side-panel.tsx`、`resize-handle.*` |
| T2   | 真实 Header（会话帧内 `h-12`）并迁移 SessionHeader 内容              | T1    | `workspace-header.tsx`、`session-header.tsx`、`session.tsx`                                                                 |
| T3   | 移除全局 Titlebar，拖拽带下沉                                        | T2    | `layout.tsx`、`titlebar.tsx`                                                                                                |
| T4   | 侧栏 IA：264 / 拖拽带 / 新建 + 命令中心 / 文件树 slide-over / footer | T3    | `layout.tsx`、`sidebar-*.tsx`、`context/layout.tsx`                                                                         |
| T5   | 更新 e2e 与单测（含新增 A6–A9、A11）                                 | T2–T4 | `packages/app/e2e/layout.spec.ts`、相关单测                                                                                 |
| T6   | 逐条跑验收 A1–A14，记录证据                                          | T5    | `docs/superpowers/plans/2026-10-13-zcode-desktop-parity-verification.md`                                                    |

**每任务的收尾动作（统一）**

```bash
cd packages/app && bun run typecheck
cd packages/app && bun test --preload ./happydom.ts ./src --timeout 30000
cd <repo root> && bun lint
```

（e2e 需要 web dev server + novaway server，见 T5/§验证环境。）

---

## T0 · 拆除闪烁诊断脚手架，恢复可验证基线

### 为什么必须先做

当前工作树 **8/8 e2e 全红**，根因是 `packages/app/vite.config.ts` 的 `optimizeDeps.exclude` 让 vite 预打包崩溃、web dev server 起不来。该配置只为上一轮「排查每几秒闪烁」服务，用户已决定不再排查。

### 拆除范围（纯诊断，全部还原到 HEAD）

| 文件                                                  | 处置                  | 理由                                                                    |
| ----------------------------------------------------- | --------------------- | ----------------------------------------------------------------------- |
| `packages/app/vite.config.ts`                         | `git checkout --`     | 全文件 diff 只有 `optimizeDeps.exclude`                                 |
| `packages/app/src/app.tsx`                            | `git checkout --`     | 全文件 diff 只有 flicker 探针 + 把 `Session` 从 lazy 改直接导入（实验） |
| `packages/app/src/components/dialog-select-model.tsx` | `git checkout --`     | 只加了 `flickerLog("rebuild ModelSelectorPopover")`                     |
| `packages/app/src/components/prompt-input.tsx`        | `git checkout --`     | 只加了 `res-audit` 打点                                                 |
| `packages/app/src/pages/directory-layout.tsx`         | `git checkout --`     | 只加了 L2a Suspense 探针                                                |
| `packages/app/src/utils/flicker-diag.tsx`             | 删除文件（untracked） | 诊断浮层 + DOM rip observer + `console.error` 劫持                      |

### 保留范围（诊断期间landed 的真实修复，逐行手改移除打点、保留逻辑）

| 文件                                                    | 保留                                                                      | 移除                                                                                             |
| ------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `packages/app/src/pages/session.tsx`                    | `hydrated` / `timelineReady` 只进不出门控、`globalSync.session.pin/unpin` | `flickerLog` 调用与 import、`res-audit` 打点、`session gate` effect                              |
| `packages/app/src/context/global-sync.tsx`              | `pinnedSessions` 集合与 `session.pin/unpin` API                           | `console.warn` / `flickerLog`（若有）                                                            |
| `packages/app/src/context/global-sync/session-cache.ts` | `pickSessionCacheEvictions` 的 `preserve` 参数、`dropSessionCaches` 本体  | `console.warn` / `flickerLog("dropSessionCaches ...")` 与 import                                 |
| `packages/app/src/context/global-sync/event-reducer.ts` | `preserve` 透传                                                           | 无                                                                                               |
| `packages/app/src/pages/layout.tsx`                     | 侧栏/任务列表等真实改造                                                   | `console.warn("[flicker] Layout created")`、`flickerLog`、`autoselecting.loading` effect、import |

### 步骤

1. 记录基线：`git stash list` 为空、`git status --porcelain | wc -l` 记数
2. `git checkout -- packages/app/vite.config.ts packages/app/src/app.tsx packages/app/src/components/dialog-select-model.tsx packages/app/src/components/prompt-input.tsx packages/app/src/pages/directory-layout.tsx`
3. `rm packages/app/src/utils/flicker-diag.tsx`
4. 逐个手改上面「保留范围」的 4 个文件，删除所有 `flicker` 字样
5. 全局校验：`grep -rn "flicker" packages/app/src packages/app/vite.config.ts packages/desktop/src | wc -l` → 必须为 0
6. 起服务验证 dev server 能起来，e2e 从「全红」变为「只有结构性断言红」

### 验证

```bash
grep -rni "flicker" packages/app/src packages/app/vite.config.ts | wc -l   # 期望 0
cd packages/app && bun run typecheck                                        # 期望通过
cd packages/app && bun test --preload ./happydom.ts ./src --timeout 30000   # 期望通过
# e2e：起 novaway server + app dev server
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3000/             # 期望 200
```

**通过判据**：dev server 能起（200），e2e 不再出现 `ERR_CONNECTION_REFUSED`。

---

## T1 · 平台 chrome：圆角 / 窗口根底色 / 帧表面 / 拖拽热区

对应验收：**A2 A3 A4 A5 A6**

### 步骤

1. 新建 `packages/app/src/utils/workspace-chrome.ts`
   - `workspacePanelRadiusPx(os)`：`windows → 5`、`macos → 6`、其它 → `12`
   - 顶部注释写明：ZCode 在 macOS Tahoe(26)+ 用 12px，NovaWay `Platform` 无系统版本，本轮统一 6px，Round 2 接 preload
2. `packages/app/src/pages/layout.tsx`
   - 外壳根节点加 `bg-background-weak`（窗口根底色，替换当前无底色的容器）
   - 根节点内联 style 写入 `--workspace-panel-radius: <px>px`
   - 侧栏帧：`rounded-lg` → `rounded-[var(--workspace-panel-radius)]`；`border-border-weak-base` → `border-border-base`；`bg-background-stronger` → `bg-background-base`
   - 侧栏 resize handle 的 `min` 240 → 264、`max` `window.innerWidth * 0.3` → `* 0.5`
3. `packages/app/src/pages/session.tsx`
   - `conv-frame`：同上三项（圆角 / 边框 / 背景）
   - 外层 `p-1 gap-1` 保持（4px 间距不变）
4. `packages/app/src/pages/session/terminal-panel.tsx`（`terminal-frame`）、`packages/app/src/pages/session/session-side-panel.tsx`（`side-pane-frame`）：同上三项
5. `packages/ui/src/components/resize-handle.css`：按规格表改写（4px 热区、2px 线、`color-mix(in oklab, var(--text-weaker) 50%, transparent)`、默认 `opacity: 0`、hover/focus/`[data-dragging]` 显示、两端按 `var(--workspace-panel-radius, 12px)` 内缩、`border-radius: 9999px`）
6. `packages/ui/src/components/resize-handle.tsx`：`onMouseDown` 给元素置 `data-dragging="true"`，`mouseup` 清除；同步更新 `resize-handle.stories.tsx`（若引用了旧视觉）
7. 检查 `packages/ui/src/styles/tailwind/utilities.css` 是否已有 `no-scrollbar` 等自定义工具类命名规范，新增 CSS 变量不落地到 tailwind 生成物

### 验证

- `bun run typecheck`、`bun test`、`bun lint`
- CDP（Electron，`127.0.0.1:9222`）读四帧 computed：`borderRadius`（Windows 期望 `5px`）、`borderTopWidth`（`1px`）、`borderStyle`（`solid`）
- CDP 读 `getComputedStyle(document.documentElement).getPropertyValue('--background-weak')` vs `--background-base` 确认色差
- CDP 读 resize handle：`width` = 4px，`::after` 默认 `opacity: 0`，`page.mouse.move` 到热区后再读为 `2px`
- 截图（亮/暗）留档，确认 frames 背景变化后消息区可读性未下降

---

## T2 · 真实 Header（会话帧内 `h-12`）

对应验收：**A10**（并前置 A1）

### 为什么先于 T3

`SessionHeader` 是纯 Portal，内容挂在 Titlebar 的 `#NovaWay-titlebar-search` / `#NovaWay-titlebar-right`。若先删 Titlebar，这些内容直接消失。因此先建真实 Header 并迁移内容，再删 Titlebar。

### 步骤

1. `packages/app/src/components/session/workspace-header.tsx` 重写
   - 删除 `if (platform.platform === "desktop") return null`
   - 容器：`h-12 shrink-0 flex items-center gap-2 p-2 border-b border-border-weaker-base [app-region:drag]`，`data-component="workspace-header"` 保留（e2e 依赖）
   - 左区：working 指示点 → 标题（`displaySessionTitle`）→ 分支胶囊（`text-ui-xs` + 现有浮层）→ 模型选择器（`ModelSelectorPopover`）
   - 右区：状态胶囊 → 在编辑器中打开 → 终端开关 → Side Pane 开关 → 更多菜单
   - 所有交互元素加 `[app-region:no-drag]`
   - 平台判断统一用 `platform.platform === "desktop"`，注释点明与 `createMediaQuery` 的 `isDesktop()` 区别
2. `packages/app/src/components/session/session-header.tsx`
   - 移除两个 `Portal`（`searchMount` / `rightMount`）与其 `onMount` id 查找
   - 保留并导出可复用的子块：搜索按钮、状态胶囊、打开方式下拉、Side Pane 开关
   - 若某块只有 Header 使用，直接内联进 `workspace-header.tsx`，避免无意义中间层
3. `packages/app/src/pages/session.tsx`
   - 移除帧内首位 `<SessionHeader />`（桌面端与 Header 重复）
   - 从 `@/components/session` 的导出中清理已删除符号
4. `packages/app/src/components/titlebar.tsx`：保留 `#NovaWay-titlebar-search` / `#NovaWay-titlebar-right` 两个 slot 容器（T3 一并删除），本任务不改

### 验证

- typecheck / 单测 / lint
- e2e（Web）：`[data-component="workspace-header"]` 可见、高 48px、模型选择器可见且不溢出
- CDP：Header 内按钮 `getComputedStyle(el).getPropertyValue("app-region")` = `no-drag`；Header 容器 = `drag`
- 手工确认：Web 与桌面端 Header 内容一致（状态胶囊、打开方式、终端/Side Pane 开关均可点）

---

## T3 · 移除全局 Titlebar

对应验收：**A1 A12**

### 步骤

1. `packages/app/src/pages/layout.tsx`
   - 删除 `<Titlebar ... />` 与其 import
   - 外层容器改为 `bg-background-weak` + `p-1`（桌面 4px 外留白；手机 0）
   - 导航 `back/forward`、模式、主题、数据库、设置等原 Titlebar 功能确认已有新落点（T4 落 footer；本任务先做「可点」的最小迁移，T4 精修视觉）
   - 移动端（`<xl`）汉堡菜单入口：从 Titlebar 移到侧栏顶部拖拽带左端
2. 删除 `packages/app/src/components/titlebar.tsx` 与 `titlebar-history.ts`（若 `applyPath/backPath/forwardPath` 仅此处使用，则把 `back/forward` 直接接 `platform.back()/forward()`）
3. 新增 `packages/app/src/utils/window-drag.ts`（或就近实现）：导出 `useWindowDrag()`，返回 `{ onMouseDown }`，桌面端调用 `window.api?.startDragging?.()`；**同时**提供 CSS 类 `[app-region:drag]` 作为 Electron 原生拖拽路径
   - 说明：现有 `titlebar.tsx` 的 `drag()` 依赖 `window.__TAURI__`，Electron preload 不提供 → 恒为 no-op。本轮用 `app-region: drag`（Chromium 支持，Electron 42 可用）修复
4. 若需要，给 `packages/desktop/src/preload/index.ts` + `types.ts` 增加 `startDragging()`（`ipcRenderer.invoke("window:start-dragging")`）并在 `ipc.ts` 注册；**仅当** `app-region` 实测不可用时才做（先验证 CSS 路径）

### 验证

- typecheck / 单测 / lint
- e2e：会话页 `page.locator("header")` 在全局位置计数为 0；`workspace-header` 仍是 `conv-frame` 后代
- CDP：拖拽带 computed `app-region` = `drag`
- **人工**：拖动侧栏顶带 / Header 空白处可移动窗口；点击 Logo 回首页；点按钮不触发拖动（A12）

---

## T4 · 侧栏 IA

对应验收：**A7 A8 A9**

### 步骤

1. `packages/app/src/context/layout.tsx`：`DEFAULT_SIDEBAR_WIDTH` 280 → 264
2. `packages/app/src/pages/layout.tsx`
   - `side()` 的 `Math.max(width, 240)` → `Math.max(width, 264)`
   - resize handle `min` 264（T1 已改）、`max` 50%（T1 已改）
3. `packages/app/src/pages/layout.tsx` 的 `SidebarPanel`
   - 顶部：`h-12` 拖拽带（`[app-region:drag]`），左端 Logo（点击 `goHome`）+ 移动端汉堡菜单
   - 第一行：整宽「新建任务」按钮（`NewTaskButtonGroup` 等价物；现有 `chooseProject()` 语义保留为「无项目时打开项目」）
   - 第二行：整宽「命令中心」ghost 行 —— `size-4` 搜索图标 + 文案 + 右侧快捷键（`command.keybind("file.open")`），`onClick` 触发 `file.open`
   - 删除「任务/文件」分段控件与顶部竖排菜单卡片
   - 中部任务列表：保留 `TaskFilterBar` + `useProjectTaskList` 现有实现
   - footer：`pl-4 pr-3`，行内放置 模式切换 / 主题 / 数据库 / 设置（复用 `ModeSwitchButton`、`ThemeSchemeToggle`、`SidebarMenuRow`）
4. 文件树 slide-over
   - 在侧栏面板内包一层 `relative`，任务列表与 `SidebarFiles` 各占 `absolute inset-0`，用 `layout.sidebarView.current()` 驱动 `translate-x-full` / `translate-x-0` + `transition-transform duration-200`
   - `SidebarFiles` 顶部保留「返回任务」按钮（切回 `"tasks"`）
   - 打开文件后仍调 `layout.sidePane.add("preview")`（不变）
   - `aria-hidden` 与 `pointer-events-none` 同步处理，避免隐藏层可点
5. i18n：新增/复用的 key 走 `packages/app/src/i18n/{en,zh,zht}.ts`；已存在的不新增（`sidebar.search`、`sidebar.newTask`、`sidebar.backToTasks` 等）

### 验证

- typecheck / 单测 / lint
- e2e：侧栏宽 264；存在整宽「新建任务」/「命令中心」；不存在「任务/文件」分段按钮；文件树 slide-over transform 断言
- CDP：读侧栏内层 `transform` 与 `transition-duration`
- 截图（亮/暗）对照 ZCode 侧栏

---

## T5 · e2e 与单测更新

### 步骤

1. 先记录现状：`cd packages/app && bun run test:e2e:local -- e2e/layout.spec.ts`（T0 后应只剩结构性红）
2. `packages/app/e2e/layout.spec.ts` 逐条重写
   - 「侧栏任务/文件视图切换」→ 改为 slide-over 断言（A9）
   - 「侧栏分组结构与项目菜单可达」→ 去掉分段按钮断言，改为新建/命令中心行 + 项目菜单（A8）
   - 「WorkspaceHeader 与 Side Pane 开关」→ 保留；Header 高度断言改 `≤48`
   - 「四 frame 4px 间隙与 8px 圆角」→ 圆角改平台值（web 12px），保留 4px 间距（A2–A4）
   - 「WorkspaceHeader 单行且不溢出」→ `≤48`（A10）
   - 「Titlebar 结构」→ **删除**，替换为「会话帧内 Header 承载原 Titlebar 功能」（A1）
   - 新增：拖拽热区 4px + 指示线 opacity（A6）
3. 单测
   - 新增 `packages/app/src/utils/workspace-chrome.test.ts`：`workspacePanelRadiusPx` 按 os 分支
   - 更新引用 `sidebarView` / 分段控件的既有单测（如 `sidebar-tasks.test.ts`、`ux-refresh.test.ts`、`layout-scroll.test.ts` 若有耦合）
4. 删除因结构变化而失效的断言，不保留「跳过」

### 验证

```bash
# 终端 1
cd <repo root> && bun --env-file=.env.local run --cwd packages/novaway --conditions=browser src/index.ts serve --port 4096 --hostname 127.0.0.1
# 终端 2
cd packages/app && bun run test:e2e:local -- e2e/layout.spec.ts
```

**通过判据**：`e2e/layout.spec.ts` 全绿；`office.spec.ts` / `todo.spec.ts` 不回归。

---

## T6 · 验收与截图留证

### 步骤

1. 逐条执行 A1–A14，把「断言 / 方法 / 实测值 / 通过与否」写入 `docs/superpowers/plans/2026-10-13-zcode-desktop-parity-verification.md`
2. CDP `Page.captureScreenshot` 取亮/暗两套截图（首页 / 会话页 / 侧栏文件树态），与 ZCode 参考并排记录
3. A12（窗口拖动）无法自动化，标注为人工验证项并写明操作步骤
4. 汇总已知限制：macOS 统一 6px（Tahoe 待 Round 2）、Aurora token 未动、Zai 主题未引入

### 交付判据

- A1–A11、A13 全部通过；A12 有明确人工验证记录
- 桌面端会话页视觉与 ZCode 参考在结构层级上一致（无全局标题栏、四帧按平台圆角、窗口根色差、侧栏 264 + slide-over 文件树、Header `h-12`）

---

## 验证环境备忘

```bash
# novaway 服务（e2e 依赖 4096）
cd <repo root> && bun --env-file=.env.local run --cwd packages/novaway --conditions=browser src/index.ts serve --port 4096 --hostname 127.0.0.1

# app dev server（e2e 会自己起，可复用）
cd packages/app && VITE_OPENCODE_SERVER_HOST=127.0.0.1 VITE_OPENCODE_SERVER_PORT=4096 bun run dev -- --host 127.0.0.1 --port 3000

# Electron 开发端（CDP 9222，playwright 的 chromium 在本机起不来）
bun dev:desktop
curl -s http://127.0.0.1:9222/json | head -40
```

**注意**：`packages/app/vite.config.ts` 的 `optimizeDeps.exclude: ["solid-js", ...]` 会让 web dev server 直接崩溃（T0 已移除，勿再引入）。

## 已知限制（写进最终报告）

| 项                                 | 说明                                                           |
| ---------------------------------- | -------------------------------------------------------------- |
| macOS Tahoe(26)+ 圆角              | 需要 OS 版本探测；本轮统一 6px                                 |
| Windows/Linux 自绘窗控             | 沿用 Electron 原生 `titleBarOverlay`，ZCode 为 Header 内联自绘 |
| 窗口拖动自动化验证                 | CDP 可断言 `app-region`，真实拖动需人工                        |
| Aurora token / Zai 主题 / 浮层语言 | Round 2                                                        |

---

## T1.5 · 会话页每 5 秒整页闪烁：根因定位与修复（阻塞项，先于 T2）

用户在本次改造开始时提出的持续故障：桌面端会话页每隔几秒闪一下，上一轮排查未定位。已定位并修复。

### 证据链（CDP 实测，web 构建复现）

注入型探针（`node_modules/.bun/solid-js@1.9.10/.../dist/dev.js` 的 `[flicker-probe]`，非 git 内容）
打印每次 `createResource` 的加载/挂起：

| 项                                                              | 修复前                                                                                      | 修复后   |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | -------- |
| 26–32 秒稳态窗口内 `SUSPEND`                                    | **每 5.0 秒 4 次**，资源 id 每拍递增 4（#68→#91）                                           | **0 次** |
| 稳态窗口内 `LOAD`                                               | 每 5.0 秒 4 次，全部 `@ createResource <- useBaseQuery <- useQuery <- MemoryEvolutionPanel` | **0 次** |
| DOM 摘除（整页根节点 `<div class="…flex flex-col p-1 gap-1">`） | 2–5 秒一次                                                                                  | 0 次     |

### 根因链

1. `useGitSnapshot()`（`pages/session/git-panel.tsx`）每 5 秒轮询 `git.snapshot()`，
   无论内容是否变化都 `setStore({ snapshot: result.data })` → `snapshot` 引用每 5 秒翻新一次。
2. `useGitSection()` 的 `model` memo 依赖该引用 → 每 5 秒重算 → 返回**全新的区块描述符对象**。
3. `session.tsx` 的 `statusSections` memo 因此每 5 秒返回**全新数组**。
4. `status-panel.tsx` 的 `<For each={props.sections}>` 按**引用**比较 → 每 5 秒拆掉并重建
   所有区块 DOM，其中 `memory` 区块的 children 是 `<MemoryEvolutionPanel />`。
5. `MemoryEvolutionPanel` 重挂 → 它的 4 个 `useQuery` 各自新建一个 `createResource`；
   TanStack 的 `useBaseQuery` 用 `createResource(fetcher, {storage: createDeepSignal, …})`，
   第二个参数是**对象而非函数**，所以 Solid 走单参分支：`source = true`、`dynamic = undefined`，
   只在创建时 `load(false)` → 新建的资源**必然 pending 一次**。
6. 该 pending 被会话页外层的 Suspense 接住 → 整页子树被卸载、fallback（null）顶上 →
   **整页空白一帧，每 5 秒一次**。

**为什么上一轮没查到**：应用层探针只能报「哪层边界挂了」，报不了「哪个资源挂了」；
而唯一能报后者的 Solid 内核探针，当时打在 `packages/app/node_modules/.vite/deps/` 的预打包
chunk 上，桌面端实际加载的是 `packages/desktop/node_modules/.vite/deps/` 的 chunk——探针从未送达。

### 修复（两处，均在 NovaWay 侧）

1. `pages/session/git-panel.tsx`：`refresh()` 比对快照签名，**内容未变不写 store**，
   从源头掐断 5 秒一轮的引用翻新。
2. `pages/session.tsx`：给 `<SessionStatusPanel>` 加**局部 `Suspense fallback={null}`**，
   让面板自身的异步只影响面板（纵深防御：今后任何面板内查询重建都不会再闪整页）。

### 保留的已知项（记录，不在本轮修）

区块描述符仍会在**内容真实变化**时重建（`<For>` 按引用比较 + children 是即时创建的 JSX）。
真改动时 `MemoryEvolutionPanel` 会重挂（丢本地 UI 态、多打一次请求），并被上面的局部边界兜住。
彻底解法是把 `StatusPanelSection` 的 `summary` / `children` 改成访问器、面板按固定 id 顺序渲染，
使 DOM 身份只由 id 决定。列入 Round 2 的 Status Panel 专项。

---

## 完成状态（2026-10-13）

全部任务完成。验收逐条记录见
`docs/superpowers/plans/2026-10-13-zcode-desktop-parity-verification.md`。

| 提交      | 内容                                     |
| --------- | ---------------------------------------- |
| `19d1e15` | T0 基线（拆诊断脚手架）                  |
| `0b91d80` | T1.5 闪烁根因修复 + T1 平台 chrome       |
| `6dfacd2` | 上一轮已落地未提交的改造归档             |
| `aecf065` | T2 Header / T3 移除标题栏 / T4 侧栏 IA   |
| `b36bf43` | T5 e2e 与单测契约 + 办公模式顶带回归修复 |

结果：e2e layout 8/8、office 6/6；单测 685 pass / 6 fail（既有失败）；
`packages/app` 与 `packages/ui` typecheck 通过；oxlint 0 error；
Electron 实机 CDP 复核 A1/A2/A5/A10/A11 通过，A12（真实拖窗）人工确认，A14 暗色截图待人工补。
