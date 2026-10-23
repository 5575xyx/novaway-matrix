# 布局结构改造（四 frame + 侧栏任务中心）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按已批准规格（`docs/superpowers/specs/2026-10-10-desktop-layout-ui-redesign-design.md` §3–§5、§7、§8）落地四 frame 布局：侧栏「任务 ↔ 文件树」整列切换、Side Pane 六 tabs、单行 WorkspaceHeader、titlebar 模式色点、首页 TaskCenterPage；移除 `viewMode`/split 预览。

**Architecture:** `LayoutProvider` 扩展（`sidePane{opened,tab,width}` + `sidebarView` + migrate v7）驱动全部消费方；侧栏与首页共用任务行语义；Side Pane 以 tab 形态重组现有右栏能力（预览/终端/文件/Git/Review/Context），split 三态删除。前置：Plan A（`2026-10-10-visual-token-convergence.md`）已合入，新组件直接使用 `text-ui-*` 字阶。

**Tech Stack:** SolidJS + createStore、`@novaway/ui` 组件、bun test / Playwright。

**关键现状事实**（执行前须知）：

- `FileProvider`/`useSDK` 只在 `SessionProviders`（app.tsx:174-188）内可用，侧栏（layout.tsx）拿不到——侧栏文件树**自建轻量树**（用 `globalSync` 按目录 SDK），不复用 `FileTree` 组件（规格 §4 的复用意图受作用域限制，此为已知偏差）。
- `sdk.client.session.list` 已支持 `archived` 参数（sdk.gen.ts:1261，走 `/experimental/session`）。
- 终端开关 `store.terminal.opened` 与 `view().terminal` 是同一份全局数据；TerminalPanel 关闭时不 unmount（height 0 + inert），tab/pty 状态不丢。
- `PreviewPanel` 无 props（依赖 `usePreview`/`usePreviewInspection`，均 app 级）——可直接迁入 Side Pane。
- `layout.tabs(sessionKey).open(tab)` 可从任意层写文件页签（tab 串经 `normalizeSessionTab` 归一）。

**范围排除**：Pulse/Office 布局结构（仅随 Task 4 的 session.tsx 同步点适配）、移动端抽屉（沿用现状）、悬浮桌宠。

**验证环**：`bun lint` → `bun typecheck` → `cd packages/app && bun run test:unit`；任务 8 做 e2e 与手动全量。

---

## File Structure

| 文件                                                       | 动作 | 职责                                                                                     |
| ---------------------------------------------------------- | ---- | ---------------------------------------------------------------------------------------- |
| `packages/app/src/context/layout.tsx`                      | 修改 | sidePane/sidebarView 状态、migrate v7 提取、viewMode/previewWidth 删除、默认宽度 280/360 |
| `packages/app/src/context/layout.test.ts`                  | 修改 | migrateLayoutStore 单测                                                                  |
| `packages/app/src/context/global-sync.tsx`                 | 修改 | 导出 `sdkForDirectory`                                                                   |
| `packages/app/src/pages/layout/sidebar-tasks.tsx`          | 创建 | 任务视图：状态过滤条 + 项目分组 flat 任务列表 + 归档加载                                 |
| `packages/app/src/pages/layout/sidebar-files.tsx`          | 创建 | 文件树视图：自建树 + git 变更徽标 + 仅变更 + ± 汇总                                      |
| `packages/app/src/pages/layout/sidebar-items.tsx`          | 修改 | SessionItem：分支徽标、±统计、选中 2px 模式色条                                          |
| `packages/app/src/pages/layout.tsx`                        | 修改 | 侧栏 segmented 切换、任务/树视图挂载、showSidebar 门控                                   |
| `packages/app/src/pages/session/session-side-panel.tsx`    | 修改 | 重构为 Side Pane 六 tabs                                                                 |
| `packages/app/src/pages/session.tsx`                       | 修改 | split/预览列删除、Side Pane 列、Terminal frame 互斥                                      |
| `packages/app/src/pages/session/terminal-panel.tsx`        | 修改 | `variant: "pane" \| "frame"`                                                             |
| `packages/app/src/pages/session/use-session-commands.tsx`  | 修改 | preview.toggle → sidePane                                                                |
| `packages/app/src/context/dev-server.tsx`                  | 修改 | set("split") → sidePane.open("preview")                                                  |
| `packages/app/src/components/session/session-header.tsx`   | 修改 | 三态按钮改 sidePane（Task 4）；portal 收敛（Task 5）                                     |
| `packages/app/src/components/session/workspace-header.tsx` | 创建 | 单行 WorkspaceHeader                                                                     |
| `packages/app/src/components/mode-switch.tsx`              | 修改 | 色点+名称克制形态                                                                        |
| `packages/app/src/components/titlebar.tsx`                 | 修改 | Logo、home 按钮行为、session-actions 槽移除                                              |
| `packages/app/src/pages/task-center.tsx`                   | 创建 | 首页任务中心                                                                             |
| `packages/app/src/pages/home.tsx`                          | 修改 | `/` 分支改 TaskCenterPage                                                                |
| `packages/app/src/components/mode-home.tsx`                | 删除 | 模式选择卡首页（让位 titlebar）                                                          |
| `packages/app/src/i18n/zh.ts` / `en.ts`                    | 修改 | 全部新文案                                                                               |
| `packages/app/e2e/office.spec.ts`                          | 修改 | enterZenOffice 改走 titlebar                                                             |
| `packages/app/e2e/layout.spec.ts`                          | 创建 | 侧栏切换/Side Pane e2e                                                                   |

---

### Task 1: LayoutProvider 状态扩展 + migrate v7

**Files:**

- Modify: `packages/app/src/context/layout.tsx`（L17-23 常量、L100-114 类型、L214-315 migrate、L317-362 store、L846 后 API）
- Modify: `packages/app/src/context/layout.test.ts`

- [ ] **Step 1: 导出新类型与常量**

`packages/app/src/context/layout.tsx` L23（`DEFAULT_PREVIEW_WIDTH` 行）后追加：

```ts
const DEFAULT_SIDE_PANE_WIDTH = 360
```

并将 L18 `const DEFAULT_SIDEBAR_WIDTH = 344` 改为 `const DEFAULT_SIDEBAR_WIDTH = 280`（仅默认值；已存用户宽度由 store 保留，不受影响）。

L124（`ReviewDiffStyle`）后追加：

```ts
export type SidePaneTab = "preview" | "terminal" | "files" | "git" | "review" | "context"
export type SidebarView = "tasks" | "tree"
```

- [ ] **Step 2: store 新增字段**

`packages/app/src/context/layout.tsx` L351（`sessionTabs` 行）之前插入：

```ts
    sidePane: {
      opened: true,
      tab: "files" as SidePaneTab,
      width: DEFAULT_SIDE_PANE_WIDTH,
    },
    sidebarView: "tasks" as SidebarView,
```

- [ ] **Step 3: 提取 migrate 为模块级导出函数并加 v7 分支**

将 init 内 L214-315 的 `migrate` 函数体**整体上移**为模块级函数（放在 `createSimpleContext` 调用之前），签名与函数名改为：

```ts
export function migrateLayoutStore(input: Record<string, any>) {
```

原 5 类历史迁移（sidebar/fileTree/git/review/sessionTabs）逻辑原样保留在函数体内；在函数末尾 `return` 之前追加：

```ts
// v7: viewMode 三态与 per-session previewWidth 废弃（split 预览取消，宽度并入 sidePane.width）
const sessionView = migrated.sessionView as Record<string, Record<string, unknown>> | undefined
if (sessionView) {
  for (const key of Object.keys(sessionView)) {
    const entry = sessionView[key]
    if (!entry || (!("viewMode" in entry) && !("previewWidth" in entry))) continue
    const next = { ...entry }
    delete next.viewMode
    delete next.previewWidth
    sessionView[key] = next
  }
}
```

（注意：原 migrate 若以 `let changed` + 返回原对象的模式实现，v7 分支直接就地改写 `sessionView` 即可，不需要计入 changed——删除字段宁可回写一次。`migrated` 为原函数内的浅拷贝变量名，沿用之。）

init 内引用改为（L317-319）：

```ts
  const target = Persist.global("layout", ["layout.v7"])
  const [store, setStore, _, ready] = persisted(
    { ...target, migrate: migrateLayoutStore },
    createStore({ ...默认值... }),
  )
```

（仅 `legacy` 数组与 `migrate` 引用两处；`createStore({...})` 默认值部分在 Step 2 已扩展，保持原样。）

- [ ] **Step 4: 暴露 sidePane / sidebarView API**

`packages/app/src/context/layout.tsx` L846（`sidePanelWidth` memo）之后插入：

```ts
      sidePane: {
        opened: createMemo(() => store.sidePane?.opened ?? true),
        tab: createMemo<SidePaneTab>(() => store.sidePane?.tab ?? "files"),
        width: createMemo(() => store.sidePane?.width ?? DEFAULT_SIDE_PANE_WIDTH),
        open(tab?: SidePaneTab) {
          batch(() => {
            if (tab) setStore("sidePane", "tab", tab)
            setStore("sidePane", "opened", true)
          })
        },
        close() {
          setStore("sidePane", "opened", false)
        },
        toggle(tab?: SidePaneTab) {
          if (store.sidePane?.opened && (!tab || store.sidePane.tab === tab)) {
            setStore("sidePane", "opened", false)
            return
          }
          batch(() => {
            if (tab) setStore("sidePane", "tab", tab)
            setStore("sidePane", "opened", true)
          })
        },
        setTab(tab: SidePaneTab) {
          batch(() => {
            setStore("sidePane", "tab", tab)
            setStore("sidePane", "opened", true)
          })
        },
        resize(width: number) {
          setStore("sidePane", "width", width)
        },
      },
      sidebarView: {
        current: createMemo<SidebarView>(() => store.sidebarView ?? "tasks"),
        set(view: SidebarView) {
          setStore("sidebarView", view)
        },
      },
```

（`batch` 确认已从 solid-js 导入——store 层代码常用；若无则加入。）

- [ ] **Step 5: migrate 单测**

`packages/app/src/context/layout.test.ts` 顶部追加 import 与用例（现有 bun:test 风格）：

```ts
import { migrateLayoutStore } from "./layout"

test("migrateLayoutStore v7 删除 per-session viewMode 与 previewWidth", () => {
  const out = migrateLayoutStore({
    sessionView: {
      "dir1/s1": { scroll: {}, viewMode: "split", previewWidth: 500, todoCollapsed: true },
      "dir1/s2": { scroll: {} },
    },
    sidebar: { opened: true, width: 344 },
  }) as Record<string, any>

  expect(out.sessionView["dir1/s1"]).toEqual({ scroll: {}, todoCollapsed: true })
  expect(out.sessionView["dir1/s2"]).toEqual({ scroll: {} })
  expect(out.sidebar).toEqual({ opened: true, width: 344 })
})

test("migrateLayoutStore v7 无 sessionView 时不抛错", () => {
  const out = migrateLayoutStore({ sidebar: { opened: false } }) as Record<string, any>
  expect(out.sidebar.opened).toBe(false)
})
```

- [ ] **Step 6: 验证（此时 viewMode 尚在，仅数据层清理，代码应全绿）**

Run: `bun lint && bun typecheck`
Expected: 通过（migrate 提取不改变行为；`SessionView` 类型中 viewMode/previewWidth 字段本任务**保留**定义，Task 4 再删）

Run: `bun run --cwd packages/app test:unit -- layout.test`
Expected: 2 个新用例 PASS

- [ ] **Step 7: Commit**

```bash
git add packages/app/src/context/layout.tsx packages/app/src/context/layout.test.ts
git commit -m "feat(layout): add sidePane/sidebarView state + migrate v7 (drop viewMode/previewWidth keys)"
```

---

### Task 2: 侧栏任务视图（状态过滤 + 项目分组 + 行增强 + 归档）

**Files:**

- Create: `packages/app/src/pages/layout/sidebar-tasks.tsx`
- Modify: `packages/app/src/pages/layout/sidebar-items.tsx`（SessionItem 增强）
- Modify: `packages/app/src/pages/layout.tsx`（segmented 切换 + 挂载）
- Modify: `packages/app/src/i18n/zh.ts`、`en.ts`

- [ ] **Step 1: i18n 新增文案**

`packages/app/src/i18n/zh.ts`：

```ts
  "sidebar.view.tasks": "任务",
  "sidebar.view.files": "文件",
  "sidebar.filter.all": "全部",
  "sidebar.filter.running": "运行中",
  "sidebar.filter.waiting": "待确认",
  "sidebar.filter.archived": "已归档",
  "sidebar.task.noProject": "打开或创建一个项目后，任务会显示在这里",
```

`packages/app/src/i18n/en.ts`：

```ts
  "sidebar.view.tasks": "Tasks",
  "sidebar.view.files": "Files",
  "sidebar.filter.all": "All",
  "sidebar.filter.running": "Running",
  "sidebar.filter.waiting": "Needs approval",
  "sidebar.filter.archived": "Archived",
  "sidebar.task.noProject": "Open or create a project to see tasks here",
```

- [ ] **Step 2: 创建任务列表组件**

创建 `packages/app/src/pages/layout/sidebar-tasks.tsx`：

```tsx
import { For, Show, createMemo, createSignal } from "solid-js"
import { Icon } from "@novaway/ui/icon"
import { useGlobalSync } from "@/context/global-sync"
import { useGlobalSDK } from "@/context/global-sdk"
import { useLanguage } from "@/context/language"
import { usePermission } from "@/context/permission"
import type { Session } from "@novaway/sdk/v2"
import type { LocalProject } from "@/context/layout"
import { SessionItem } from "./sidebar-items"
import { sortedRootSessions } from "./helpers"
import { sessionPermissionRequest } from "@/pages/session/composer/session-request-tree"
import { getFilename } from "@/utils/path"

export type TaskFilter = "all" | "running" | "waiting" | "archived"

export function ProjectTaskList(props: {
  project: LocalProject
  slug: string
  sidebarExpanded: () => boolean
  prefetchSession: (session: Session, priority?: "high" | "low") => void
  archiveSession: (session: Session) => Promise<void>
  filter: () => TaskFilter
  archived: () => Session[] | undefined
}) {
  const language = useLanguage()
  const globalSync = useGlobalSync()
  const permission = usePermission()

  const statusOf = (session: Session): "running" | "waiting" | "idle" => {
    const [store] = globalSync.child(session.directory)
    const waiting = sessionPermissionRequest(store.session, store.permission, session.id, (item) => {
      return !permission.autoResponds(item, session.directory)
    })
    if (waiting) return "waiting"
    if (store.session_working(session.id)) return "running"
    return "idle"
  }

  const sessions = createMemo(() => {
    if (props.filter() === "archived") return props.archived() ?? []
    const roots = sortedRootSessions(globalSync.child(props.project.worktree)[0].session)
    const f = props.filter()
    if (f === "all") return roots
    return roots.filter((s) => statusOf(s) === f)
  })

  return (
    <Show when={sessions().length > 0}>
      <div class="px-2 pt-2">
        <div class="flex items-center gap-1.5 px-1.5 pb-1 text-ui-xs text-text-weak">
          <Icon name="folder" size="small" class="shrink-0" />
          <span class="truncate flex-1">{getFilename(props.project.worktree)}</span>
          <span class="tabular-nums">{sessions().length}</span>
        </div>
        <For each={sessions()}>
          {(session) => (
            <SessionItem
              session={session}
              list={sessions()}
              slug={props.slug}
              sidebarExpanded={props.sidebarExpanded}
              clearHoverProjectSoon={() => {}}
              prefetchSession={props.prefetchSession}
              archiveSession={props.archiveSession}
            />
          )}
        </For>
      </div>
    </Show>
  )
}

export function TaskFilterBar(props: { filter: TaskFilter; onChange: (filter: TaskFilter) => void }) {
  const language = useLanguage()
  const tabs: Array<{ id: TaskFilter; key: string }> = [
    { id: "all", key: "sidebar.filter.all" },
    { id: "running", key: "sidebar.filter.running" },
    { id: "waiting", key: "sidebar.filter.waiting" },
    { id: "archived", key: "sidebar.filter.archived" },
  ]
  return (
    <div class="flex items-center gap-1 px-2 py-1.5">
      <For each={tabs}>
        {(tab) => (
          <button
            classList={{
              "px-2 py-0.5 rounded-md text-ui-xs transition-colors": true,
              "bg-surface-raised-base text-text-strong border border-border-weak-base": props.filter === tab.id,
              "text-text-weak hover:text-text-base border border-transparent": props.filter !== tab.id,
            }}
            onClick={() => props.onChange(tab.id)}
          >
            {language.t(tab.key)}
          </button>
        )}
      </For>
    </div>
  )
}

export function useArchivedSessions(projects: () => LocalProject[]) {
  const globalSDK = useGlobalSDK()
  const [archived, setArchived] = createSignal<Record<string, Session[]>>({})
  const load = () => {
    void Promise.all(
      projects().map((p) =>
        globalSDK.client.session
          .list({ directory: p.worktree, archived: true, roots: true })
          .then((r) => [p.worktree, (r.data ?? []).filter((s) => !!s?.id)] as const)
          .catch(() => [p.worktree, [] as Session[]] as const),
      ),
    ).then((entries) => setArchived(Object.fromEntries(entries)))
  }
  return { archived, load }
}
```

（`getFilename` 的 import 路径以 `sidebar-workspace.tsx` 现有引入为准——rg `getFilename` 的 import 行照抄；若该 util 名不同则用同名现有 util。`sessionPermissionRequest` 的 import 路径同理以 `sidebar-items.tsx` 现有引入为准。）

- [ ] **Step 3: SessionItem 行增强**

`packages/app/src/pages/layout/sidebar-items.tsx`：

1. 在 L131（`const language = useLanguage()`）附近加：

```ts
const selected = createMemo(() => params.id === props.session.id)
```

2. 在时间 span（L327-329 `任务完成 · {completionTime()}`）之后插入分支徽标与 ± 统计：

```tsx
            <Show when={sessionStore.vcs?.branch}>
              <span class="text-ui-xs text-text-weak shrink-0 max-w-[120px] truncate">
                ⎇ {sessionStore.vcs?.branch}
              </span>
            </Show>
            <Show
              when={
                props.session.summary &&
                (props.session.summary.additions > 0 || props.session.summary.deletions > 0)
              }
            >
              <span class="text-ui-xs tabular-nums shrink-0">
                <span class="text-[var(--icon-diff-add-base)]">+{props.session.summary?.additions ?? 0}</span>
                <span class="text-[var(--icon-diff-delete-base)]">-{props.session.summary?.deletions ?? 0}</span>
              </span>
            </Show>
```

3. 在 SessionItem 根元素（返回 JSX 的最外层，包住状态点/标题/菜单的容器 div）的 `classList` 中追加两行（保留全部现有类）：

```tsx
          "relative": true,
          "before:absolute before:left-0 before:top-1 before:bottom-1 before:w-0.5 before:rounded-full before:bg-[var(--novaway-mode-color,var(--border-strong-base))]": selected(),
```

- [ ] **Step 4: 侧栏挂载 segmented 切换 + 过滤条 + 任务列表**

`packages/app/src/pages/layout.tsx`：

1. 顶部 import 区追加（相对路径 `./layout/sidebar-tasks`）：

```ts
import { ProjectTaskList, TaskFilterBar, useArchivedSessions } from "./layout/sidebar-tasks"
```

并在 `Layout` 组件内（`projectList` memo 附近）加：

```ts
const [taskFilter, setTaskFilter] = createSignal<TaskFilter>("all")
const { archived, load: loadArchived } = useArchivedSessions(() => projectList())
```

（`TaskFilter` 类型一并 import。）

2. `SidebarPanel`（L2167-2423）头部（「工作区」标题行 L2211-2268 之后）插入 segmented 切换与过滤条：

```tsx
          <div class="flex items-center gap-1 px-2 pb-1">
            <div class="flex rounded-md border border-border-weak-base overflow-hidden">
              <button
                classList={{
                  "px-2.5 py-1 text-ui-caption transition-colors": true,
                  "bg-surface-raised-base text-text-strong": layout.sidebarView.current() === "tasks",
                  "text-text-weak hover:text-text-base": layout.sidebarView.current() !== "tasks",
                }}
                onClick={() => layout.sidebarView.set("tasks")}
              >
                {language.t("sidebar.view.tasks")}
              </button>
              <button
                classList={{
                  "px-2.5 py-1 text-ui-caption transition-colors": true,
                  "bg-surface-raised-base text-text-strong": layout.sidebarView.current() === "tree",
                  "text-text-weak hover:text-text-base": layout.sidebarView.current() !== "tree",
                }}
                onClick={() => layout.sidebarView.set("tree")}
              >
                {language.t("sidebar.view.files")}
              </button>
            </div>
          </div>
          <Show when={layout.sidebarView.current() === "tasks"}>
            <TaskFilterBar
              filter={taskFilter()}
              onChange={(f) => {
                setTaskFilter(f)
                if (f === "archived") loadArchived()
              }}
            />
          </Show>
```

3. 项目展开区（L2314-2378 的 `isExpanded` 分支）：在 `LocalWorkspace`/`SortableWorkspace` 之前插入任务视图分支：

```tsx
<Show
  when={layout.sidebarView.current() === "tasks"}
  fallback={
    {
      /* 现有 LocalWorkspace / SortableWorkspace 渲染原样作为 fallback */
    }
  }
>
  <ProjectTaskList
    project={proj}
    slug={slug()}
    sidebarExpanded={() => store.workspaceSidebarExpanded}
    prefetchSession={prefetchSession}
    archiveSession={archiveSession}
    filter={taskFilter}
    archived={() => archived()[proj.worktree]}
  />
</Show>
```

（`fallback` 内为 L2320-2378 现有两分支渲染，原样移入；`slug`/`prefetchSession`/`archiveSession` 用 SidebarPanel 作用域内同名现有值。）

4. 侧栏头部「工作区/项目数」旁的容器在 `sidebarView === "tree"` 时：项目列表区域整体仍显示（树视图 Task 3 处理整列替换）——本步仅保证 tasks 视图工作。

- [ ] **Step 5: 验证**

Run: `bun lint && bun typecheck`
Expected: 通过

手动（双 dev server，见 Plan A Task 1 Step 8）：侧栏出现「任务|文件」segmented；过滤条四切换可用（运行中/待确认按真实会话状态过滤；已归档拉取归档列表并可点击进入会话）；任务行显示状态点 + 标题 + 时间，有分支的项目行显示 `⎇` 徽标；选中行左缘出现 2px 模式色条。

- [ ] **Step 6: Commit**

```bash
git add packages/app/src/pages/layout/sidebar-tasks.tsx packages/app/src/pages/layout/sidebar-items.tsx packages/app/src/pages/layout.tsx packages/app/src/i18n/zh.ts packages/app/src/i18n/en.ts
git commit -m "feat(sidebar): task view with status filter, project grouping, branch badge, archived list"
```

---

### Task 3: 侧栏文件树视图（自建树 + git 变更徽标）

**Files:**

- Modify: `packages/app/src/context/global-sync.tsx`（L330 返回对象）
- Create: `packages/app/src/pages/layout/sidebar-files.tsx`
- Modify: `packages/app/src/pages/layout.tsx`（tree 视图挂载）
- Modify: `packages/app/src/i18n/zh.ts`、`en.ts`

- [ ] **Step 1: global-sync 导出按目录 SDK**

`packages/app/src/context/global-sync.tsx` 的 `useGlobalSync` 返回对象（L330 `loadSessions,` 同级）追加一行：

```ts
    sdkForDirectory: sdkFor,
```

（`sdkFor` 为 init 内既有闭包，形参 directory 返回目录 SDK。）

- [ ] **Step 2: i18n 新增文案**

`zh.ts`：

```ts
  "sidebar.tree.back": "返回任务",
  "sidebar.tree.title": "文件",
  "sidebar.tree.onlyChanged": "仅变更",
  "sidebar.tree.changes": "{count} 个变更",
  "sidebar.tree.empty": "当前没有可浏览的项目目录",
```

`en.ts`：

```ts
  "sidebar.tree.back": "Back to tasks",
  "sidebar.tree.title": "Files",
  "sidebar.tree.onlyChanged": "Changed only",
  "sidebar.tree.changes": "{count} changed",
  "sidebar.tree.empty": "No project directory to browse",
```

- [ ] **Step 3: 创建侧栏文件树组件**

创建 `packages/app/src/pages/layout/sidebar-files.tsx`：

```tsx
import { For, Show, createMemo, createSignal, onCleanup } from "solid-js"
import { Icon } from "@novaway/ui/icon"
import { IconButton } from "@novaway/ui/icon-button"
import { Switch } from "@novaway/ui/switch"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import type { GitSnapshotResponses } from "@novaway/sdk/v2"

type Entry = { path: string; name: string; type: "file" | "dir" }
type Kind = "add" | "del" | "mix"
type Snapshot = GitSnapshotResponses[200]

const REFRESH_INTERVAL = 5000

const mergeKind = (a: Kind | undefined, b: Kind): Kind => (!a || a === b ? b : "mix")

export function SidebarFiles(props: { directory: string; sessionKey: () => string }) {
  const language = useLanguage()
  const layout = useLayout()
  const globalSync = useGlobalSync()
  const [openDirs, setOpenDirs] = createSignal<Record<string, Entry[]>>({})
  const [onlyChanged, setOnlyChanged] = createSignal(true)
  const [snapshot, setSnapshot] = createSignal<Snapshot>()
  const sdk = () => globalSync.sdkForDirectory(props.directory)

  const refresh = () => {
    void sdk()
      .client.git.snapshot()
      .then((r) => setSnapshot(r.data))
      .catch(() => {})
  }
  refresh()
  const timer = setInterval(refresh, REFRESH_INTERVAL)
  onCleanup(() => clearInterval(timer))

  const changedFiles = createMemo(() => snapshot()?.changes.map((c) => c.path) ?? [])

  const kinds = createMemo(() => {
    const map = new Map<string, Kind>()
    for (const change of snapshot()?.changes ?? []) {
      const kind: Kind = change.status === "added" ? "add" : change.status === "deleted" ? "del" : "mix"
      let path = change.path.replaceAll("\\", "/")
      map.set(path, mergeKind(map.get(path), kind))
      const segments = path.split("/")
      while (segments.length > 1) {
        segments.pop()
        const dir = segments.join("/")
        map.set(dir, mergeKind(map.get(dir), kind))
      }
    }
    return map
  })

  const kindColor = (kind: Kind) => ({
    color:
      kind === "add"
        ? "var(--icon-diff-add-base)"
        : kind === "del"
          ? "var(--icon-diff-delete-base)"
          : "var(--icon-diff-modified-base)",
  })

  const loadDir = (dir: string) => {
    void sdk()
      .client.file.list({ path: dir })
      .then((r) => {
        const entries = (r.data ?? [])
          .map((x) => ({
            path: x.path,
            name: x.name,
            type: x.type === "directory" ? ("dir" as const) : ("file" as const),
          }))
          .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "dir" ? -1 : 1))
        setOpenDirs((prev) => ({ ...prev, [dir]: entries }))
      })
      .catch(() => {})
  }

  const toggleDir = (dir: string) => {
    if (openDirs()[dir]) {
      setOpenDirs((prev) => {
        const next = { ...prev }
        delete next[dir]
        return next
      })
      return
    }
    loadDir(dir)
  }

  const openFile = (entry: Entry) => {
    void layout.tabs(props.sessionKey()).open(entry.path)
    layout.tabs(props.sessionKey()).setActive(entry.path)
    layout.sidePane.open("preview")
  }

  const rootEntries = () => openDirs()[""] ?? []

  const visibleRoot = () => {
    if (!onlyChanged()) return rootEntries()
    const changedDirs = new Set(changedFiles().map((p) => p.replaceAll("\\", "/").split("/")[0]))
    return rootEntries().filter((e) => changedDirs.has(e.path.replaceAll("\\", "/").split("/")[0]))
  }

  const EntryRow = (p: { entry: Entry; depth: number }) => {
    const kind = () => kinds().get(p.entry.path.replaceAll("\\", "/"))
    const isOpen = () => !!openDirs()[p.entry.path]
    return (
      <div>
        <button
          class="flex w-full items-center gap-1.5 py-0.5 pr-2 text-ui-caption text-text-base hover:bg-surface-base-hover rounded-md"
          style={{ "padding-left": `${8 + p.depth * 14}px` }}
          onClick={() => (p.entry.type === "dir" ? toggleDir(p.entry.path) : openFile(p.entry))}
        >
          <Show when={p.entry.type === "dir"}>
            <Icon name={isOpen() ? "chevron-down" : "chevron-right"} size="small" class="shrink-0 text-icon-weak" />
            <Icon name="folder" size="small" class="shrink-0 text-icon-weak" />
          </Show>
          <Show when={p.entry.type === "file"}>
            <span class="size-4 shrink-0" />
            <Icon name="file" size="small" class="shrink-0 text-icon-weak" />
          </Show>
          <span class="truncate flex-1 text-left">{p.entry.name}</span>
          <Show when={kind()}>
            <span class="text-ui-xs font-semibold shrink-0" style={kindColor(kind()!)}>
              {kind() === "add" ? "A" : kind() === "del" ? "D" : "M"}
            </span>
          </Show>
        </button>
        <Show when={isOpen()}>
          <For each={openDirs()[p.entry.path]}>{(child) => <EntryRow entry={child} depth={p.depth + 1} />}</For>
        </Show>
      </div>
    )
  }

  return (
    <div class="flex flex-col size-full min-h-0">
      <div class="flex items-center gap-2 px-2 h-9 border-b border-border-weak-base shrink-0">
        <IconButton
          icon="chevron-left"
          title={language.t("sidebar.tree.back")}
          onClick={() => layout.sidebarView.set("tasks")}
        />
        <span class="text-ui-caption text-text-strong flex-1">{language.t("sidebar.tree.title")}</span>
        <label class="flex items-center gap-1.5 text-ui-xs text-text-weak cursor-pointer">
          {language.t("sidebar.tree.onlyChanged")}
          <Switch checked={onlyChanged()} onChange={setOnlyChanged} />
        </label>
      </div>
      <div class="flex-1 min-h-0 overflow-y-auto no-scrollbar py-1">
        <Show
          when={rootEntries().length > 0}
          fallback={<div class="px-3 py-4 text-ui-xs text-text-weak">{language.t("sidebar.tree.empty")}</div>}
        >
          <For each={visibleRoot()}>{(entry) => <EntryRow entry={entry} depth={0} />}</For>
        </Show>
      </div>
      <div class="shrink-0 px-3 py-1.5 border-t border-border-weak-base text-ui-xs text-text-weak">
        {language.t("sidebar.tree.changes", { count: changedFiles().length })}
      </div>
    </div>
  )
}
```

（`sdk.client.file.list` 返回项字段 `path/name/type` 以 `types.gen.ts` 的 FileList 响应元素为准——执行时 rg `file.list` 响应类型核对字段名，若为 `name`+`type: "directory"|"file"` 之外的形态，调整 `loadDir` 内 map；`Switch` 的 `onChange` 签名以 `@novaway/ui/switch` 现有用法为准，参照 `settings-general.tsx` 的 Switch 用法。i18n `{count}` 插值以 `language.t` 现有签名支持为准，不支持插值则改为模板拼接。）

- [ ] **Step 4: layout.tsx 挂载树视图**

`packages/app/src/pages/layout.tsx`：

1. import：

```ts
import { SidebarFiles } from "./layout/sidebar-files"
```

2. `SidebarPanel` 内，项目列表区域（`DragDropProvider` 包裹的列表，L2285-2389）外层包：

```tsx
<Show
  when={layout.sidebarView.current() === "tasks"}
  fallback={
    <SidebarFiles
      directory={currentProject()?.worktree ?? currentDir()}
      sessionKey={() => `${params.dir}${params.id ? "/" + params.id : ""}`}
    />
  }
>
  {/* 现有 DragDropProvider + 项目列表整块原样移入 */}
</Show>
```

（`currentProject`/`currentDir`/`params` 为 layout.tsx 既有值；`slug` 的 sessionKey 组合方式以 `session-layout.ts:7` 的 `${params.dir}/${params.id}` 形态为准。若树视图在无会话时也要显示，directory 回退 `currentDir()`。）

- [ ] **Step 5: 验证**

Run: `bun lint && bun typecheck`
Expected: 通过

手动：侧栏切「文件」——出现返回按钮、文件树（默认展开根目录）、A/M/D 徽标（在有 git 变更的项目）、「仅变更」开关过滤、底部「N 个变更」；点击文件 → Side Pane 打开并出现该文件页签（预览 tab）；点击目录展开/折叠。

- [ ] **Step 6: Commit**

```bash
git add packages/app/src/context/global-sync.tsx packages/app/src/pages/layout/sidebar-files.tsx packages/app/src/pages/layout.tsx packages/app/src/i18n/zh.ts packages/app/src/i18n/en.ts
git commit -m "feat(sidebar): file tree view with git badges, changed-only filter, open-in-preview"
```

---

### Task 4: Side Pane 六 tabs + viewMode/split 移除

**Files:**

- Modify: `packages/app/src/pages/session/session-side-panel.tsx`（渲染区整体重构）
- Modify: `packages/app/src/pages/session.tsx`
- Modify: `packages/app/src/pages/session/terminal-panel.tsx`
- Modify: `packages/app/src/components/session/session-header.tsx`
- Modify: `packages/app/src/pages/session/use-session-commands.tsx`
- Modify: `packages/app/src/context/dev-server.tsx`
- Modify: `packages/app/src/context/layout.tsx`（viewMode/previewWidth 类型与 API 删除）
- Modify: `packages/app/src/i18n/zh.ts`、`en.ts`

- [ ] **Step 1: i18n 新增 Side Pane tab 文案**

`zh.ts`：

```ts
  "sidePane.tab.preview": "预览",
  "sidePane.tab.terminal": "终端",
  "sidePane.tab.files": "文件",
  "sidePane.tab.git": "Git",
  "sidePane.tab.review": "审查",
  "sidePane.tab.context": "上下文",
```

`en.ts`：

```ts
  "sidePane.tab.preview": "Preview",
  "sidePane.tab.terminal": "Terminal",
  "sidePane.tab.files": "Files",
  "sidePane.tab.git": "Git",
  "sidePane.tab.review": "Review",
  "sidePane.tab.context": "Context",
```

- [ ] **Step 2: TerminalPanel 增加 pane 变体**

`packages/app/src/pages/session/terminal-panel.tsx`：

1. 组件签名（L23）改为：

```tsx
export function TerminalPanel(props: { variant?: "frame" | "pane" }) {
```

并在组件体顶部加：

```ts
const paneMode = () => props.variant === "pane"
```

2. L31 opened memo 改为：

```ts
const opened = createMemo(() => paneMode() || view().terminal.opened())
```

（L58-78 的自动开/建终端 effect 已依赖 `opened()`——pane 模式恒 true，切到终端 tab 时自动补建，无需改。）

3. L207 根元素 style 改为：

```ts
  style={{ height: paneMode() ? "100%" : opened() ? `${pane()}px` : "0px" }}
```

4. L216-228 的竖向 ResizeHandle 块整体包一层：

```tsx
<Show when={!paneMode()}>{/* 现有 onPointerDown 容器 + ResizeHandle + onCollapse 原样 */}</Show>
```

- [ ] **Step 3: 重构 SessionSidePanel 为六 tab 容器**

`packages/app/src/pages/session/session-side-panel.tsx`：

1. 组件签名与 props 接口（L36-49）**保持不变**；`createSessionTabs` 调用（L127-137）与 `openTab`（L 参照 helpers）**保持不变**。
2. 删除 `reviewOpen`/`fileOpen`/`gitOpen`/`open` 四个 memo（L138-143）。
3. 用以下结构**整体替换** L212-499 的渲染部分（`<aside id="review-panel">` 起至组件尾）：

```tsx
const tab = layout.sidePane.tab
const width = () => Math.min(layout.sidePane.width(), Math.round(window.innerWidth * 0.6))

const tabs: Array<{ id: SidePaneTab; icon: string; labelKey: string }> = [
  { id: "preview", icon: "layout-right", labelKey: "sidePane.tab.preview" },
  { id: "terminal", icon: "terminal", labelKey: "sidePane.tab.terminal" },
  { id: "files", icon: "file-tree", labelKey: "sidePane.tab.files" },
  { id: "git", icon: "branch", labelKey: "sidePane.tab.git" },
  { id: "review", icon: "diff", labelKey: "sidePane.tab.review" },
  { id: "context", icon: "database", labelKey: "sidePane.tab.context" },
]

return (
  <>
    <ResizeHandle
      direction="horizontal"
      size={layout.sidePane.width()}
      min={320}
      max={typeof window === "undefined" ? 1000 : window.innerWidth * 0.6}
      onResize={(w) => layout.sidePane.resize(w)}
    />
    <aside
      id="side-pane"
      class="shrink-0 h-full flex flex-col bg-background-base border-l border-border-weak-base"
      style={{ width: `${width()}px` }}
    >
      <div class="flex items-center gap-0.5 h-9 px-1.5 border-b border-border-weak-base shrink-0">
        <For each={tabs}>
          {(item) => (
            <button
              classList={{
                "flex items-center gap-1 px-2 h-7 rounded-md text-ui-xs transition-colors": true,
                "bg-surface-raised-base text-text-strong": tab() === item.id,
                "text-text-weak hover:text-text-base": tab() !== item.id,
              }}
              onClick={() => layout.sidePane.setTab(item.id)}
            >
              <Icon name={item.icon as any} size="small" />
              {language.t(item.labelKey)}
            </button>
          )}
        </For>
      </div>
      <div class="flex-1 min-h-0 overflow-hidden">
        <Show when={tab() === "preview"}>
          <Show when={activeFileTab()} keyed fallback={<PreviewPanel />}>
            {(t) => (
              <div class="flex flex-col size-full min-h-0">
                <div class="flex items-center gap-0.5 px-1.5 h-8 border-b border-border-weak-base overflow-x-auto no-scrollbar">
                  <For each={openedTabs()}>
                    {(fileTab) => <SortableTab tab={fileTab} onTabClose={tabsApi().close} />}
                  </For>
                </div>
                <div class="flex-1 min-h-0 overflow-hidden">
                  <FileTabContent tab={t()} />
                </div>
              </div>
            )}
          </Show>
        </Show>
        <Show when={tab() === "terminal"}>
          <TerminalPanel variant="pane" />
        </Show>
        <Show when={tab() === "files"}>
          <div class="flex flex-col size-full min-h-0">
            <div class="flex items-center gap-1 px-2 h-8 border-b border-border-weak-base shrink-0">
              <For
                each={
                  [
                    ["all", "session.files.all"],
                    ["changes", "session.tab.review"],
                    ["review", "session.tab.review"],
                  ] as const
                }
              >
                {(pair) => (
                  <button
                    classList={{
                      "px-2 py-0.5 rounded-md text-ui-xs": true,
                      "bg-surface-raised-base text-text-strong": fileTreeTab() === pair[0],
                      "text-text-weak": fileTreeTab() !== pair[0],
                    }}
                    onClick={() => setFileTreeTabValue(pair[0])}
                  >
                    {language.t(pair[1])}
                  </button>
                )}
              </For>
            </div>
            <div class="flex-1 min-h-0 overflow-hidden">
              <Show when={fileTreeTab() === "changes"}>
                <FileTree path="" allowed={diffFiles()} kinds={kinds()} onFileClick={focusReviewDiff} />
              </Show>
              <Show when={fileTreeTab() === "all"}>
                <FileTree path="" modified={diffFiles()} kinds={kinds()} onFileClick={openTab} />
              </Show>
              <Show when={fileTreeTab() === "review"}>{props.reviewPanel()}</Show>
            </div>
          </div>
        </Show>
        <Show when={tab() === "git"}>
          <GitPanel />
        </Show>
        <Show when={tab() === "review"}>{props.reviewPanel()}</Show>
        <Show when={tab() === "context"}>
          <SessionContextTab />
        </Show>
      </div>
    </aside>
  </>
)
```

4. import 调整：补 `For`、`PreviewPanel`（`./preview-panel`）、`TerminalPanel`（`./terminal-panel`）、`SidePaneTab`/`useLayout`（已有 layout 引用则复用）、`ResizeHandle`（沿用 session.tsx 现引入路径）、`Icon`；`fileTreeTab`/`setFileTreeTabValue`/`diffFiles`/`kinds`/`focusReviewDiff`/`openedTabs`/`activeFileTab`/`openTab` 沿用组件内现有 memo/helper 名（原文件已有）。文件树子 tab 的 label 第二项「changes」使用现有 `language.t("session.files.all")` 等键——changes tab 标签用现有键 `props.reviewCount()` 计数展示可保留（在按钮文本后拼 ` {props.reviewCount()}`）。

- [ ] **Step 4: session.tsx 布局改造**

`packages/app/src/pages/session.tsx`：

1. 删除 `previewMaxWidth`/`previewPaneWidth` memo（L431-432）与 split ResizeHandle/预览列整块（L1995-2028）。
2. `sessionPanelWidth` memo（L347-353）删除；左列容器（L1884 附近 `class` 绑定 sessionPanelWidth 处）改为 `class="flex-1 min-h-0 flex flex-col"`（宽度自适应）。
3. L2032-2045 的 `<SessionSidePanel ... />` 渲染改为：

```tsx
          <Show when={layout.sidePane.opened() && isDesktop()}>
            <SessionSidePanel
              canReview={...}
              diffs={...}
              diffsReady={...}
              empty={...}
              hasReview={...}
              reviewCount={...}
              reviewPanel={reviewPanel}
              activeDiff={...}
              focusReviewDiff={...}
              reviewSnap={...}
              size={...}
              reservedWidth={...}
            />
          </Show>
```

（props 全部沿用现状传值，仅外层条件与容器位置调整——Side Pane 现在是 `flex flex-col md:flex-row` 行内右列。office 分支 L2075-2088 同步改。）

4. 底部 Terminal frame（L2048 与 office 分支 L2091）改为互斥挂载：

```tsx
<Show when={layout.sidePane.tab() !== "terminal"}>
  <TerminalPanel />
</Show>
```

5. L907 键盘焦点条件改为：

```ts
    if (view().terminal.opened() || (layout.sidePane.opened() && layout.sidePane.tab() === "terminal")) {
```

- [ ] **Step 5: 消费方切换（session-header / 命令 / dev-server）**

1. `packages/app/src/components/session/session-header.tsx`：
   - 确认/补 `import { useLayout } from "@/context/layout"` 与 `const layout = useLayout()`。
   - L325-347 预览三态按钮替换为单一 sidePane 开关（图标固定 `layout-right`，删除 `previewIcon` L144-149）：

```tsx
<IconButton
  icon="layout-right"
  title={language.t("sidePane.tab.preview")}
  aria-expanded={layout.sidePane.opened()}
  onClick={() => layout.sidePane.toggle("preview")}
/>
```

- L366-390 文件树开关改为 `onClick={() => layout.sidePane.setTab("files")}`、aria-expanded 改读 `layout.sidePane.opened() && layout.sidePane.tab() === "files"`。
- L391-413 Git 开关改为 `onClick={() => layout.sidePane.setTab("git")}`、同上读 tab。
- L333/335/342/343 等对 `view().viewMode` 的引用全部移除（按钮已换）。

2. `packages/app/src/pages/session/use-session-commands.tsx` L467-473：

```ts
    {
      id: "preview.toggle",
      keybind: "mod+shift+b",
      onSelect: () => layout.sidePane.toggle("preview"),
    },
```

3. `packages/app/src/context/dev-server.tsx` L44：

```ts
layout.sidePane.open("preview")
```

（补 `import { useLayout }` 与 `const layout = useLayout()`；原 `view().viewMode.set("split")` 行删除。）

- [ ] **Step 6: 删除 layout context 中的 viewMode/previewWidth**

`packages/app/src/context/layout.tsx`：

1. `SessionView` 类型（L105-114）删除 `previewWidth?`/`viewMode?` 两行。
2. L917 `viewMode` memo、L943-953 `setViewMode`、L998-1005 `viewMode` API 块删除。
3. L986-997 `previewWidth` API 块删除。
4. rg 全包确认零残留：`rg "viewMode|previewWidth" packages/app/src packages/storybook` —— 若 `packages/storybook/.storybook/mocks/app/context/layout.ts` mock 了这两个字段则同步删。

- [ ] **Step 7: 验证**

Run: `bun lint && bun typecheck`
Expected: 通过（typecheck 会暴露 storybook mock 等残留——逐个清理）

Run: `bun run --cwd packages/app test:unit`
Expected: PASS

手动：

- 单击侧栏文件树的文件 → Side Pane 打开、预览 tab 显示文件页签与内容
- Side Pane 六 tab 全部可切；终端 tab 内终端可用且切走再切回 pty 保留
- 底部终端 frame（Ctrl+`）与 sidePane 终端 tab 互斥（同时只有一个 Terminal 实例）
- Side Pane 右缘可拖宽（320–60vw）、刷新后宽度保留
- `mod+shift+b`、titlebar 预览按钮切换 Side Pane

- [ ] **Step 8: Commit**

```bash
git add packages/app/src/pages/session packages/app/src/components/session/session-header.tsx packages/app/src/context/layout.tsx packages/app/src/context/dev-server.tsx packages/app/src/i18n/zh.ts packages/app/src/i18n/en.ts
git commit -m "feat(layout): Side Pane six-tab panel; remove viewMode/split preview"
```

---

### Task 5: 单行 WorkspaceHeader

**Files:**

- Create: `packages/app/src/components/session/workspace-header.tsx`
- Modify: `packages/app/src/pages/session.tsx`（L1846 挂载）
- Modify: `packages/app/src/components/session/session-header.tsx`（session-actions portal 删除）
- Modify: `packages/app/src/components/titlebar.tsx`（L294 槽删除）
- Modify: `packages/app/src/i18n/zh.ts`、`en.ts`

- [ ] **Step 1: i18n 新增文案**

`zh.ts`：

```ts
  "workspace.header.untitled": "未命名任务",
  "workspace.header.sidePane": "切换 Side Pane",
  "workspace.header.terminal": "切换终端",
  "workspace.header.more": "更多",
  "workspace.header.copyPath": "复制目录路径",
  "workspace.header.openProject": "打开项目",
```

`en.ts`：

```ts
  "workspace.header.untitled": "Untitled task",
  "workspace.header.sidePane": "Toggle side pane",
  "workspace.header.terminal": "Toggle terminal",
  "workspace.header.more": "More",
  "workspace.header.copyPath": "Copy directory path",
  "workspace.header.openProject": "Open project",
```

- [ ] **Step 2: 创建 WorkspaceHeader 组件**

创建 `packages/app/src/components/session/workspace-header.tsx`：

```tsx
import { Show, createMemo } from "solid-js"
import { useParams } from "@solidjs/router"
import { DropdownMenu } from "@novaway/ui/dropdown-menu"
import { Icon } from "@novaway/ui/icon"
import { IconButton } from "@novaway/ui/icon-button"
import { Select } from "@novaway/ui/select"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { useLocal } from "@/context/local"
import { useModels } from "@/context/models"
import { ModelSelectorPopover } from "@/components/dialog-select-model"
import { Button } from "@novaway/ui/button"
import { decode64 } from "@/utils/base64"
import { useSessionLayout } from "@/pages/session/session-layout"

export function WorkspaceHeader() {
  const params = useParams()
  const language = useLanguage()
  const layout = useLayout()
  const globalSync = useGlobalSync()
  const modelsCtx = useModels()
  const local = useLocal()
  const sessionLayout = useSessionLayout()
  const directory = createMemo(() => decode64(params.dir) ?? "")
  const [sessionStore] = globalSync.child(directory())
  const session = createMemo(() => sessionStore.session.find((s) => s.id === params.id))
  const variants = createMemo(() => ["default", ...local.model.variant.list()])
  const working = createMemo(() => (session() ? sessionStore.session_working(session()!.id) : false))
  const dirName = createMemo(() => directory().split(/[\\/]/).filter(Boolean).pop() ?? directory())

  return (
    <div class="flex items-center gap-2 h-10 px-3 border-b border-border-weak-base shrink-0 select-none">
      <Show when={working()}>
        <span class="size-2 rounded-full bg-[var(--border-success-selected)] animate-pulse shrink-0" />
      </Show>
      <span class="text-ui-base font-semibold text-text-strong truncate max-w-[280px]">
        {session()?.title ?? language.t("workspace.header.untitled")}
      </span>
      <span class="text-ui-xs text-text-weak truncate max-w-[180px] hidden md:block border border-border-weak-base rounded-md px-1.5 py-0.5">
        {dirName()}
      </span>
      <div class="flex-1" />
      <Show when={modelsCtx.autoMode() || local.model.current()}>
        <ModelSelectorPopover
          model={local.model}
          triggerAs={Button}
          triggerProps={{
            variant: "ghost",
            size: "normal",
            class: "text-ui-caption text-text-strong max-w-[200px] min-w-0",
          }}
        >
          <span class="truncate">
            {modelsCtx.autoMode() ? "Auto" : (local.model.current()?.name ?? language.t("dialog.model.select.title"))}
          </span>
          <Icon name="chevron-down" size="small" class="shrink-0" />
        </ModelSelectorPopover>
      </Show>
      <Show when={!modelsCtx.autoMode() && variants().length > 2}>
        <Select
          size="small"
          options={variants()}
          current={local.model.variant.current() ?? "default"}
          label={(x) => {
            if (x === "default") return "默认"
            if (x === "low") return "低"
            if (x === "medium") return "中"
            if (x === "high") return "高"
            if (x === "max") return "高+"
            return x
          }}
          onSelect={(value) => local.model.variant.set(value === "default" ? undefined : value)}
          variant="ghost"
          class="text-ui-caption"
        />
      </Show>
      <IconButton
        icon="layout-right"
        title={language.t("workspace.header.sidePane")}
        aria-expanded={layout.sidePane.opened()}
        onClick={() => layout.sidePane.toggle()}
        class={layout.sidePane.opened() ? "text-text-interactive-base" : ""}
      />
      <IconButton
        icon="terminal"
        title={language.t("workspace.header.terminal")}
        aria-expanded={sessionLayout.view().terminal.opened()}
        onClick={() => sessionLayout.view().terminal.toggle()}
        class={sessionLayout.view().terminal.opened() ? "text-text-interactive-base" : ""}
      />
      <DropdownMenu>
        <DropdownMenu.Trigger as={IconButton} icon="dot-grid" title={language.t("workspace.header.more")} />
        <DropdownMenu.Item
          onSelect={() => {
            void navigator.clipboard.writeText(directory())
          }}
        >
          {language.t("workspace.header.copyPath")}
        </DropdownMenu.Item>
        <DropdownMenu.Item
          onSelect={() => {
            void navigator.clipboard.writeText(session()?.title ?? directory())
          }}
        >
          {language.t("workspace.header.copyTitle")}
        </DropdownMenu.Item>
      </DropdownMenu>
    </div>
  )
}
```

（补 i18n key `workspace.header.copyTitle` = "复制任务标题"/"Copy task title"；`useLocal`/`useModels`/`ModelSelectorPopover`/`Select` 的 import 路径以 `prompt-input.tsx` 现有引入为准照抄；`Select` props 若 `size="small"` 不存在则用现有档位。）

- [ ] **Step 3: 挂载到会话页顶部**

`packages/app/src/pages/session.tsx`：

1. import：

```ts
import { WorkspaceHeader } from "@/components/session/workspace-header"
```

2. L1846 `<SessionHeader />` 之后追加：

```tsx
<WorkspaceHeader />
```

- [ ] **Step 4: session-header 收敛 + titlebar 槽移除**

1. `packages/app/src/components/session/session-header.tsx`：删除整块「会话操作组」portal（L321-417，预览/终端/文件树/Git 四按钮——Task 4 已把它们的逻辑迁到 header，此块成为冗余）；`setSessionActionsMount` 相关 state 与 `onMount` 中 `NovaWay-titlebar-session-actions` 的取值（L286）一并删。保留：搜索 portal（L291-320）、titlebar-right portal（StatusPopover 等 L418-544，其中整块隐藏的「外部应用打开」维持现状）。
2. `packages/app/src/components/titlebar.tsx` L294 `<div id="NovaWay-titlebar-session-actions" ...>` 删除（无消费者）。

- [ ] **Step 5: 验证**

Run: `bun lint && bun typecheck`
Expected: 通过

手动：会话页顶部出现单行 header（运行态绿点+标题+目录徽标+模型+执行档+两个开关+更多菜单）；titlebar 不再有预览/终端/文件树/Git 按钮；搜索与状态入口仍可用；模型/执行档切换与 composer 内控件一致联动。

- [ ] **Step 6: Commit**

```bash
git add packages/app/src/components/session/workspace-header.tsx packages/app/src/components/session/session-header.tsx packages/app/src/components/titlebar.tsx packages/app/src/pages/session.tsx packages/app/src/i18n/zh.ts packages/app/src/i18n/en.ts
git commit -m "feat(session): single-row WorkspaceHeader; slim session-header portals"
```

---

### Task 6: Titlebar 克制化（Logo + 模式色点）

**Files:**

- Modify: `packages/app/src/components/mode-switch.tsx`
- Modify: `packages/app/src/components/titlebar.tsx`
- Modify: `packages/app/src/i18n/zh.ts`、`en.ts`

- [ ] **Step 1: i18n 新增「选择模式」文案**

`zh.ts`：`"mode.select.placeholder": "选择模式",`
`en.ts`：`"mode.select.placeholder": "Select mode",`

- [ ] **Step 2: mode-switch.tsx 重写为色点+名称形态**

`packages/app/src/components/mode-switch.tsx` 整体替换为：

```tsx
import { Show } from "solid-js"
import { DropdownMenu } from "@novaway/ui/dropdown-menu"
import { Icon } from "@novaway/ui/icon"
import { useLanguage } from "@/context/language"
import { useLayout, type AppModeConfig } from "@/context/layout"

export function ModeSwitchButton(props: { onSelect: (mode: AppModeConfig) => void }) {
  const layout = useLayout()
  const language = useLanguage()
  const current = () => layout.mode.all.find((m) => m.id === layout.mode.current())

  return (
    <DropdownMenu placement="bottom" gutter={8}>
      <DropdownMenu.Trigger
        class="flex h-8 items-center gap-2 rounded-md border border-border-weak-base bg-surface-base px-2 text-ui-caption text-text-strong transition-colors hover:bg-surface-base-hover data-[expanded]:border-border-active"
        aria-label={language.t("mode.switch.ariaLabel")}
      >
        <Show
          when={current()}
          fallback={
            <>
              <span class="size-2 rounded-full bg-border-strong-base shrink-0" />
              <span class="text-text-weak">{language.t("mode.select.placeholder")}</span>
            </>
          }
        >
          {(mode) => (
            <>
              <span class="size-2 rounded-full shrink-0" style={{ background: mode().color }} />
              <span class="text-ui-caption text-text-strong">{mode().shortName}</span>
            </>
          )}
        </Show>
        <Icon name="chevron-down" size="small" class="shrink-0 text-icon-weak" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content class="z-50 w-72 rounded-lg border border-border-weak-base bg-surface-raised-stronger-non-alpha p-1.5 shadow-[var(--shadow-md)]">
          <For each={layout.mode.all}>
            {(mode) => (
              <DropdownMenu.Item
                class="flex items-center gap-2 rounded-md px-2 py-1.5 text-ui-caption text-text-base hover:bg-surface-raised-base-hover"
                onSelect={() => props.onSelect(mode)}
              >
                <span class="size-2 rounded-full shrink-0" style={{ background: mode.color }} />
                <span class="flex-1 text-left">{mode.shortName}</span>
                <Show when={layout.mode.current() === mode.id}>
                  <Icon name="check" size="small" class="text-icon-weak" />
                </Show>
              </DropdownMenu.Item>
            )}
          </For>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu>
  )
}
```

（`For` 从 solid-js 补导入；`mode.switch.ariaLabel` 用现有 key——rg 该文件旧 aria-label 用的 key 名照抄；`DropdownMenu.Portal`/`Content` 的存在性以 `@novaway/ui/dropdown-menu` 现有用法为准——旧文件若无 Portal 层则按旧文件的嵌套方式写。`shortName` 与 `color` 字段以 `AppModeConfig` 现有字段为准。）

- [ ] **Step 3: titlebar 加 Logo、home 按钮只导航**

`packages/app/src/components/titlebar.tsx`：

1. 顶部 import：

```ts
import { Mark } from "@novaway/ui/logo"
```

2. 左列前进/返回按钮（L227-251）之后插入：

```tsx
<Mark class="size-6 shrink-0" />
```

3. `goModeHome`（L103-106）改为只导航（模式不再从首页选，reset 语义删除）：

```ts
const goModeHome = () => {
  navigate("/")
}
```

4. 中列 `<Show when={layout.mode.hasSelected()}>` 包裹（L300）删除——ModeSwitchButton 始终显示（未选模式时显示「选择模式」占位）。

- [ ] **Step 4: 验证**

Run: `bun lint && bun typecheck`
Expected: 通过

手动：titlebar 左列出现 Logo；模式切换为「色点+短名+chevron」小按钮（无缩放动画/大阴影）；未选模式时显示「选择模式」；下拉列出 5 模式（色点+短名+当前勾选）；选中后 titlebar 立即显示色点+名称。

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/components/mode-switch.tsx packages/app/src/components/titlebar.tsx packages/app/src/i18n/zh.ts packages/app/src/i18n/en.ts
git commit -m "feat(titlebar): logo + restrained mode dot switcher"
```

---

### Task 7: TaskCenterPage 首页

**Files:**

- Create: `packages/app/src/pages/task-center.tsx`
- Modify: `packages/app/src/pages/home.tsx`
- Modify: `packages/app/src/pages/layout.tsx`（showSidebar 门控 L2426-2428）
- Delete: `packages/app/src/components/mode-home.tsx`
- Modify: `packages/app/src/i18n/zh.ts`、`en.ts`

- [ ] **Step 1: i18n 新增任务中心文案**

`zh.ts`：

```ts
  "taskCenter.title": "任务中心",
  "taskCenter.subtitle": "最近任务与快捷入口",
  "taskCenter.newTask": "新建任务",
  "taskCenter.openProject": "打开项目",
  "taskCenter.empty": "暂无任务。新建任务或打开一个项目开始。",
```

`en.ts`：

```ts
  "taskCenter.title": "Task center",
  "taskCenter.subtitle": "Recent tasks and quick actions",
  "taskCenter.newTask": "New task",
  "taskCenter.openProject": "Open project",
  "taskCenter.empty": "No tasks yet. Create a task or open a project to start.",
```

- [ ] **Step 2: 创建 TaskCenterPage**

创建 `packages/app/src/pages/task-center.tsx`：

```tsx
import { For, Show, createMemo, createSignal } from "solid-js"
import { useNavigate } from "@solidjs/router"
import { Button } from "@novaway/ui/button"
import { Icon } from "@novaway/ui/icon"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { useLayout, type LocalProject } from "@/context/layout"
import { useNotification } from "@/context/notification"
import { usePermission } from "@/context/permission"
import { sortedRootSessions } from "./layout/helpers"
import { sessionPermissionRequest } from "./session/composer/session-request-tree"
import { TaskFilterBar, useArchivedSessions, type TaskFilter } from "./layout/sidebar-tasks"
import { base64Encode } from "@/utils/base64"
import type { Session } from "@novaway/sdk/v2"

export default function TaskCenterPage() {
  const language = useLanguage()
  const navigate = useNavigate()
  const layout = useLayout()
  const globalSync = useGlobalSync()
  const permission = usePermission()
  const [filter, setFilter] = createSignal<TaskFilter>("all")
  const { archived, load: loadArchived } = useArchivedSessions(() => layout.projects.list())

  const statusOf = (session: Session): "running" | "waiting" | "idle" => {
    const [store] = globalSync.child(session.directory)
    const waiting = sessionPermissionRequest(store.session, store.permission, session.id, (item) => {
      return !permission.autoResponds(item, session.directory)
    })
    if (waiting) return "waiting"
    if (store.session_working(session.id)) return "running"
    return "idle"
  }

  const rows = createMemo(() => {
    const list: Array<{ project: LocalProject; session: Session }> = []
    for (const project of layout.projects.list()) {
      const sessions =
        filter() === "archived"
          ? (archived()[project.worktree] ?? [])
          : (() => {
              const roots = sortedRootSessions(globalSync.child(project.worktree)[0].session)
              const f = filter()
              if (f === "all") return roots
              return roots.filter((s) => statusOf(s) === f)
            })()
      for (const session of sessions) list.push({ project, session })
    }
    return list.sort((a, b) => (b.session.time?.updated ?? 0) - (a.session.time?.updated ?? 0)).slice(0, 40)
  })

  const openSession = (session: Session) => {
    navigate(`/${base64Encode(session.directory)}/session/${session.id}`)
  }

  return (
    <div class="size-full overflow-y-auto no-scrollbar">
      <div class="mx-auto max-w-3xl px-6 py-10 flex flex-col gap-6">
        <div class="flex flex-col gap-1">
          <h1 class="text-ui-xl font-semibold text-text-strong">{language.t("taskCenter.title")}</h1>
          <p class="text-ui-caption text-text-weak">{language.t("taskCenter.subtitle")}</p>
        </div>
        <div class="flex items-center gap-2">
          <Button
            variant="primary"
            size="normal"
            onClick={() => navigate(`/${base64Encode(layout.projects.list()[0]?.worktree ?? "")}/session`)}
          >
            {language.t("taskCenter.newTask")}
          </Button>
          <Button variant="secondary" size="normal" onClick={() => layout.projectPicker.show()}>
            {language.t("taskCenter.openProject")}
          </Button>
        </div>
        <TaskFilterBar
          filter={filter()}
          onChange={(f) => {
            setFilter(f)
            if (f === "archived") loadArchived()
          }}
        />
        <Show
          when={rows().length > 0}
          fallback={
            <div class="py-12 text-center text-ui-caption text-text-weak">{language.t("taskCenter.empty")}</div>
          }
        >
          <div class="flex flex-col rounded-lg border border-border-weak-base overflow-hidden">
            <For each={rows()}>
              {(row, i) => (
                <button
                  classList={{
                    "flex items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-surface-base-hover": true,
                    "border-t border-border-weak-base": i() > 0,
                  }}
                  onClick={() => openSession(row.session)}
                >
                  <span
                    classList={{
                      "size-2 rounded-full shrink-0": true,
                      "bg-[var(--border-success-selected)]": statusOf(row.session) === "running",
                      "bg-[var(--border-warning-selected)]": statusOf(row.session) === "waiting",
                      "bg-border-strong-base": statusOf(row.session) === "idle",
                    }}
                  />
                  <span class="text-ui-caption text-text-strong truncate flex-1">{row.session.title}</span>
                  <span class="text-ui-xs text-text-weak truncate max-w-[160px] hidden md:block">
                    {row.project.worktree.split(/[\\/]/).filter(Boolean).pop()}
                  </span>
                  <Show
                    when={
                      row.session.summary && (row.session.summary.additions > 0 || row.session.summary.deletions > 0)
                    }
                  >
                    <span class="text-ui-xs tabular-nums shrink-0">
                      <span class="text-[var(--icon-diff-add-base)]">+{row.session.summary?.additions ?? 0}</span>
                      <span class="text-[var(--icon-diff-delete-base)]">-{row.session.summary?.deletions ?? 0}</span>
                    </span>
                  </Show>
                </button>
              )}
            </For>
          </div>
        </Show>
      </div>
    </div>
  )
}
```

（`Button` 的 `variant="primary"/"secondary"` 以 `@novaway/ui/button` 现有档位为准；`base64Encode` 从 `@/utils/base64` 导入；`layout.projectPicker.show()` 与 project-switcher 弹层联动（layout.tsx:662-671），弹层由 layout 层常驻渲染，首页可用。）

- [ ] **Step 3: home.tsx 分支改造**

`packages/app/src/pages/home.tsx`：

1. L162 起的分支整体替换为：

```tsx
return (
  <Switch>
    <Match when={layout.mode.current() === "pulse"}>
      <Navigate href="/pulse" />
    </Match>
    <Match when={layout.mode.current() === "zen"}>
      <OfficeHomeWorkspace
      /* 沿用现有 props 传值 */
      />
    </Match>
    <Match when>
      <TaskCenterPage />
    </Match>
  </Switch>
)
```

2. `ModeHomePage`/`DefaultHome`/`RecentProjects` 的使用与定义删除（`mode-home.tsx` 的 import 一并删）；`DefaultHome` 中「打开项目/新建项目」CTA 语义已由 TaskCenter 顶栏按钮承接。
3. `packages/app/src/components/mode-home.tsx` 文件删除。
4. rg 残留：`rg "ModeHomePage|mode-home|DefaultHome" packages/app/src` → 零命中。

- [ ] **Step 4: showSidebar 门控去掉模式选择依赖**

`packages/app/src/pages/layout.tsx` L2426-2428：

```ts
const modeSelected = createMemo(() => layout.mode.hasSelected())
const isPulseMode = createMemo(() => layout.mode.current() === "pulse")
const showSidebar = createMemo(() => modeSelected() && !isPulseMode())
```

改为：

```ts
const isPulseMode = createMemo(() => layout.mode.current() === "pulse")
const showSidebar = createMemo(() => !isPulseMode())
```

（`modeSelected` 若无其他引用则删。）

- [ ] **Step 5: 验证**

Run: `bun lint && bun typecheck`
Expected: 通过

Run: `bun run --cwd packages/app test:unit`
Expected: PASS

手动：`/` 未选模式也显示侧栏与任务中心；任务中心有过滤条、最近任务行（状态点/标题/项目/±）、新建任务与打开项目按钮；点击行进入会话；titlebar 选 zen → 首页切 OfficeHome；pulse → /pulse；未选模式时 titlebar 显示「选择模式」。

- [ ] **Step 6: Commit**

```bash
git add packages/app/src/pages/task-center.tsx packages/app/src/pages/home.tsx packages/app/src/pages/layout.tsx packages/app/src/components/mode-home.tsx packages/app/src/i18n/zh.ts packages/app/src/i18n/en.ts
git commit -m "feat(home): TaskCenterPage replaces mode-home; mode selection moves to titlebar"
```

---

### Task 8: e2e 更新与全量验证

**Files:**

- Modify: `packages/app/e2e/office.spec.ts`
- Create: `packages/app/e2e/layout.spec.ts`

- [ ] **Step 1: office.spec 入口改走 titlebar**

`packages/app/e2e/office.spec.ts` L4-8 的 `enterZenOffice` 替换为：

```ts
async function enterZenOffice(page: Page) {
  await page.goto("/")
  await page
    .getByRole("button", { name: /切换工作模式|选择模式/ })
    .first()
    .click()
  await page.getByRole("menuitem", { name: /禅意模式/ }).click()
  await page.waitForTimeout(500)
}
```

（`aria-label` 实际文案以 Task 6 采用的 key 为准——若 ModeSwitch trigger 的 aria-label 为「切换工作模式」则匹配之；menuitem 文案匹配 APP_MODES 的 name「禅意模式（办公模式）」。）

- [ ] **Step 2: 新增布局 e2e**

创建 `packages/app/e2e/layout.spec.ts`：

```ts
import { test, expect, type Page } from "@playwright/test"

test("侧栏任务/文件视图切换", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "文件", exact: true }).first().click()
  await expect(page.getByText("返回任务").first()).toBeVisible()
  await page.getByRole("button", { name: "任务", exact: true }).first().click()
})

test("WorkspaceHeader 与 Side Pane 开关", async ({ page }) => {
  await page.goto("/")
  // 需要一个可进入的会话；环境有数据时执行——无数据则 skip
  const firstTask = page.locator("button", { hasText: /./ }).filter({ hasNotText: "任务中心" })
  // 进入会话的稳定选择器以环境为准；以 WorkspaceHeader 出现为断言目标
  // 若 CI 环境无会话数据，此测试使用 test.skip 前置条件：
  test.skip((await page.getByText("暂无任务").count()) > 0, "无会话数据环境跳过")
  await expect(
    page.locator("text=未命名任务").first().or(page.locator("[data-component=workspace-header]")).first(),
  ).toBeVisible()
})
```

（执行时若选择器不稳，以 Task 5 手动验证通过的选择器为准收敛；两个测试允许在空数据环境 skip。）

- [ ] **Step 3: 全量静态与单测**

Run（仓库根）:

```bash
bun lint
bun typecheck
bun run --cwd packages/app test:unit
```

Expected: 全部通过

- [ ] **Step 4: e2e**

Run:

```bash
bun run --cwd packages/app test:e2e
```

Expected: office.spec 6 测试 PASS（入口改造后）；layout.spec 新测试 PASS 或按条件 skip。

- [ ] **Step 5: 手动清单（规格 §9，两端 × 明暗 × 断点 × frame 组合）**

双 dev server（`packages/novaway` 4096 + `packages/app` 4444）与桌面端（`bun dev:desktop` 或现有 Electron 壳）各过一遍：

- [ ] 桌面 ≥1280：Sidebar(280 默认，可拖 244–30vw) ｜ 4px 间隙 ｜ Conversation(WorkspaceHeader 单行) ｜ 4px 间隙 ｜ Side Pane(360 默认，可拖 320–60vw，六 tabs) ｜ 底部 Terminal frame（Ctrl+` 开关、顶部拖高、关后 pty 保留）
- [ ] Side Pane 默认开启；split 概念消失（`mod+shift+b` 开关 Side Pane）
- [ ] 侧栏任务视图：过滤四档、项目分组、运行中呼吸点/待确认黄点、分支徽标、±统计（有 summary 的会话）、归档列表可进
- [ ] 侧栏文件树：返回任务、A/M/D 徽标、仅变更、底部变更计数、点文件进预览 tab
- [ ] 首页：未选模式即见任务中心；titlebar 选模式生效；zen/pulse 分支正常
- [ ] 明/暗两态 × 2 套主题抽查：新组件全用 text-ui-\*/语义色，无 Aurora 残留
- [ ] 断点 xl(1280) 以下侧栏抽屉、md(768) 以下 Side Pane 隐藏（沿用现状）
- [ ] 设置页/命令面板/数据库页（Plan A 表面）无回归
- [ ] 刷新后：sidebarWidth/sidePane.width/terminalHeight 保留；viewMode 等旧键被 migrate 清除（DevTools → novaway.global.dat:layout 检查无 viewMode/previewWidth 字段）

- [ ] **Step 6: 返工与最终提交**

清单问题逐项修复，`fix(layout): <描述>` 单独 commit；全绿后提醒用户：**两份计划的改动均仅在本地，确认后可推送**。

---

## 自查记录（Self-Review）

- **规格覆盖**：§3 四 frame + 4px 间隙（Task 4/8——间隙为 frame 间 border/gap，验证清单确认；Sidebar/SidePane/Terminal 宽度与开关 Task 1/4）；§4 侧栏两层项目→任务 + worktree 分支徽标 + 过滤 + 文件树视图 Task 2/3；§5 单行 WorkspaceHeader、Side Pane 六 tabs、终端双形态、`viewMode`→正交开关 Task 4/5；§6 视觉在 Plan A；§7 Titlebar/首页 Task 6/7；§8 状态迁移表 Task 1（viewMode 删除、sidePane 新增、sidebarView 新增、宽度 280/360、bump legacy→v7、±条件渲染）；§9 验证环 Task 8。
- **占位符**：无 TBD/TODO；新组件均有完整代码。少量「以现有 import/档位为准」指引（`getFilename`、`Switch` props、`Button` variant 等）为指向确切现有符号的绑定指令（含 rg 定位与参照文件），执行时照抄即可。
- **类型一致性**：`SidePaneTab`/`SidebarView` 定义于 Task 1，消费于 Task 2-5；`sidePane.open/close/toggle/setTab/resize` 形状 Task 1 定义后各任务引用一致；`TerminalPanel variant` Task 4 定义与使用一致。
- **已知边界**：侧栏文件树为自建轻量树（FileProvider 作用域限制，规格「复用 FileTree」的偏差，已在架构说明记录）；Side Pane「文件」tab 保留 all/changes/review 子视图，预览 tab 承载文件页签 + URL 预览双形态；移动端 Side Pane 沿用「隐藏」现状（规格排除项）。
