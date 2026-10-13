# 会话状态面板与 Side Pane 收敛 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把状态类信息（Git / 进度 / Context）从 Side Pane tab 拆到 conversation 右上角的 Status Panel，Side Pane 收敛为 3 个按需创建的重交互 tab，并清除本轮发现的重复入口与死代码。

**Architecture:** 状态与功能两层分离——新增 `SessionStatusPanel` 挂在已是 `@container` 的 `conv-frame` 右上角，按 container query 裁决 mini/展开形态；`sidePane` 状态由单值 `tab` 改为 `tabs[] + activeTab`，操作语义收敛为纯函数 `reduceSidePane`（可单测），持久化经 `migrateLayoutStore` 迁移。

**Tech Stack:** SolidJS + `@solidjs/store`、Tailwind v4（`text-ui-*` 字阶）、Playwright e2e、bun test + happy-dom（纯逻辑单测）。

**Spec:** `docs/superpowers/specs/2026-10-11-side-pane-tab-model-design.md`

## Global Constraints

- 全仓根 `bun typecheck` 必须 16 包 0 error；`packages/app` 内 `bun test:unit`、`bun test:e2e`、`bunx oxlint .` 全绿
- 测试**只能**在 `packages/app` 目录下跑（仓库根 `bun fig.toml` 拒绝）
- commit **只 add 本任务明确列出的文件**，禁止 `git add -A`；禁止建/删/切 worktree 或分支；禁止推送
- 不得重启 app / server 进程（后端 4096 是用户进程）
- 风格：`semi: false`、`printWidth: 120`、dot notation、`prefer const`、禁 `try`/`catch`、禁 `any`
- UI 字号只用 `text-ui-*`；禁新增 Aurora 装饰
- i18n 键增删需同步 `src/i18n/en.ts` 与 `src/i18n/zh.ts`（其余 locale 由既有机制兜底）；`src/i18n/parity.test.ts` **不可修改**
- 全部文案走 `language.t(...)`，禁新增硬编码中文

## Review Focus

以下五类风险是 spec 隐含但最容易在实现中被漏掉的，各归属任务的测试已就位：

1. **旧持久化数据里仍存 `tab: "files" | "git" | "context"`** —— 迁移后不得崩溃、不得在 DOM 残留这三类 tab；期望 `migrateLayoutStore` 把它们映射为新 `activeTab` 且 `tabs` 单元素。→ Task 3 迁移单测
2. **窄容器下 Status Panel 的 mini 胶囊遮挡 Composer 或消息** —— 期望 < 1280px 容器只显示胶囊、不显示面板，且不读 `window.innerWidth`。→ Task 5 Step 5 grep 静态断言 + Step 3 的 container query 类实现；形态的视觉正确性在 Task 9 人工核对
3. **clean repo / 无 todo / 无 context 时面板留空白占位** —— 期望整个 `<aside>` 不挂载。→ Task 5 Step 1–4 `shouldMountStatusPanel` 单测（UI 层 `return null` 由它驱动；不写数据依赖的 e2e）
4. **默认 `opened: true` + `tabs: []` 的组合** —— 期望首屏显示空态而非崩溃，且 `e2e/layout.spec.ts:157`（依赖默认展开）继续通过。→ Task 3 unit + Task 5 Step 5 的 layout e2e
5. **删掉 `files` tab 后 `wantsReview` 漏拉数据导致审查面板白屏** —— 期望 review 在侧栏文件树入口与顶级入口下都能拉到数据并渲染。→ Task 1 Step 3（`wantsReview` 收口）+ Task 2 Step 6 layout e2e

---

## File Structure

| 文件 | 职责 | 任务 |
| --- | --- | --- |
| `src/context/layout.tsx` | sidePane 状态模型、`reduceSidePane`、`migrateLayoutStore`、死状态清理 | 1, 2, 3, 4 |
| `src/context/layout.test.ts` | 迁移与操作语义单测 | 2, 3, 4 |
| `src/pages/session/session-side-panel.tsx` | tab strip 收敛、空态、渲染分支 | 1, 3 |
| `src/pages/session.tsx` | 挂载点、布局 memo、`wantsReview`、`setFileTreeTab` | 1, 2, 5 |
| `src/pages/session/use-session-commands.tsx` | 命令入口 | 1, 3, 4 |
| `src/components/session/workspace-header.tsx` | 菜单收口 | 1 |
| `src/pages/session/status-panel/`（新增） | Status Panel 骨架与三个区块 | 5–8 |
| `src/pages/session/git-panel.tsx` | 数据链路复用（UI 收敛进卡片） | 6 |
| `src/components/session/session-context-tab.tsx` | breakdown 渲染复用 | 8 |
| `src/i18n/en.ts` / `src/i18n/zh.ts` | 文案键 | 1, 5–8 |
| `src/pages/session/composer/session-todo-dock.tsx`、`src/components/task-list.tsx(+test)` | 删除 | 4 |
| `e2e/layout.spec.ts` | 布局回归门（Task 2/3/5 各跑一次） | 2, 3, 5 |

---

### Task 1: Side Pane tab 收敛 6→3 + 入口收口

**Files:**
- Modify: `src/context/layout.tsx:124`（`SidePaneTab` 类型）
- Modify: `src/pages/session/session-side-panel.tsx:196-206`（`tabsList`）、`:314-395`（渲染分支）
- Modify: `src/pages/session.tsx:340-348`（`sidePaneShowsFiles` 删除）
- Modify: `src/components/session/workspace-header.tsx:111-118`（菜单两项）
- Modify: `src/pages/session/use-session-commands.tsx:480`、`:488`
- Modify: `src/i18n/en.ts:107-108`、`src/i18n/zh.ts:119-120`（删 2 键）

**Interfaces:**
- Produces: `export type SidePaneTab = "preview" | "review" | "terminal"`；此后所有任务只允许出现这三个字面量
- Consumes: 无（首个任务）

- [ ] **Step 1: 收窄 `SidePaneTab`，用 typecheck 当失败门**

`layout.tsx:124` 改为 `export type SidePaneTab = "preview" | "review" | "terminal"`。

> 注：**不能**用 `bun test` 断言类型错误——bun 只剥离类型不做检查。本任务的失败门是 `tsgo`。

Run: 仓库根 `bun typecheck`
Expected: FAIL，报错点即全部需要收口的调用方清单（`session-side-panel.tsx` 的 `tabsList` 与三处 `<Show>`、`session.tsx:341`、`workspace-header.tsx:112/116`、`use-session-commands.tsx:480/488`、i18n 键类型）

- [ ] **Step 2: 按报错清单清空渲染分支**

`session-side-panel.tsx` 删除 `files`/`git`/`context` 三项 `tabsList` 与对应 `<Show when={tab() === "files"|"git"|"context"}>` 分支（保留 `preview`/`terminal`/`review` 三个分支）。

- [ ] **Step 3: 收口入口**

- `workspace-header.tsx:111-118` 删除「文件树」「Git」两个 `DropdownMenu.Item`
- `use-session-commands.tsx:480` `toggle("files")`、`:488` `toggle("git")` 两条命令整体删除
- `session.tsx:340-342` 删除 `sidePaneShowsFiles` 的定义，并从 `wantsReview`（`:517-524`）中删掉 `sidePaneShowsFiles() ||` 一项——本任务直接完成这一处，Task 2 不再碰 `wantsReview`
- i18n 删 `sidePane.tab.files` / `sidePane.tab.git` 两键（en + zh）

- [ ] **Step 4: typecheck 转绿**

Run: 仓库根 `bun typecheck`
Expected: 16 包 0 error

- [ ] **Step 5: grep 确认无残留**

Run: 仓库根 `bunx oxlint .`，再 `grep -rn 'sidePane.tab.files\|sidePane.tab.git\|toggle("files")\|toggle("git")' packages/app/src`
Expected: oxlint 0 error；grep 0 匹配

- [ ] **Step 6: Commit**

```bash
git add packages/app/src/context/layout.tsx \
  packages/app/src/pages/session/session-side-panel.tsx packages/app/src/pages/session.tsx \
  packages/app/src/components/session/workspace-header.tsx \
  packages/app/src/pages/session/use-session-commands.tsx \
  packages/app/src/i18n/en.ts packages/app/src/i18n/zh.ts
git commit -m "refactor(app): 收敛 Side Pane 为 preview/review/terminal 三 tab"
```

---

### Task 2: 审查去重

**Files:**
- Modify: `src/context/layout.tsx:234`（`fileTree.tab` 合法集合）、`:362`（默认值）、`:799`（accessor 类型）
- Modify: `src/pages/session.tsx:315`（`setTab("review")`）、`:938`（`setFileTreeTab`）、`:960-963`（`showAllFiles`）
- Modify: `src/pages/session/session-side-panel.tsx:317-377`（files 子态不再渲染 `reviewPanel()`）
- Test: `src/context/layout.test.ts`

**Interfaces:**
- Produces: `fileTree.tab` 取值域 `"changes" | "all"`；`setFileTreeTab(value: "changes" | "all")`
- Consumes: Task 1 的 `SidePaneTab` 与已删去 `sidePaneShowsFiles` 的 `wantsReview`（本任务不再改 `wantsReview`）

- [ ] **Step 1: 写失败的迁移测试**

在 `layout.test.ts` 的 `describe("migrateLayoutStore")`（若无则新建）中加：

```ts
test("maps legacy fileTree review tab to changes", () => {
  const out = migrateLayoutStore({ fileTree: { opened: true, width: 260, tab: "review" } })
  expect(out.fileTree.tab).toBe("changes")
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/app && bun test --preload ./happydom.ts ./src/context/layout.test.ts`
Expected: FAIL，`"review"` 原样返回

- [ ] **Step 3: 实现迁移与去重**

- `layout.tsx:234` 的合法集合改为 `tab === "changes" || tab === "all"`，`"review"` 与非法值一并落 `tab: "changes"`
- `layout.tsx:362` 默认值改 `"changes"`；`:799` accessor 收窄类型
- `session.tsx:938` `setFileTreeTab(value: "changes" | "all")`；`:315` `layout.fileTree.setTab("review")` 改为 `layout.sidePane.open("review")`
- `session.tsx:960-963` `showAllFiles` 的守卫 `if (fileTreeTab() !== "changes" && fileTreeTab() !== "review") return` 简化为 `if (fileTreeTab() !== "changes") return`（`review` 取值已不存在）
- `session-side-panel.tsx` files 子态只保留 `all`/`changes` 两个 pill，删除渲染 `props.reviewPanel()` 的分支

- [ ] **Step 4: 跑测试确认通过**

Run: 同 Step 2
Expected: PASS

- [ ] **Step 5: typecheck 与审查可达性验证**

Run: 仓库根 `bun typecheck`
Expected: 0 error —— 本任务**不改** `wantsReview`（Task 1 已删 `sidePaneShowsFiles`），若 typecheck 报 `reviewPanel` 未使用或 `showAllFiles` 类型不符，回 Step 3 补齐

- [ ] **Step 6: e2e 验证审查入口**

Run: `cd packages/app && bun test:e2e -- layout.spec.ts`
Expected: PASS（14 项基线不回归）

- [ ] **Step 7: Commit**

```bash
git add packages/app/src/context/layout.tsx packages/app/src/context/layout.test.ts \
  packages/app/src/pages/session.tsx packages/app/src/pages/session/session-side-panel.tsx
git commit -m "refactor(app): 审查入口去重，fileTree 收敛为 changes/all"
```

---

### Task 3: sidePane 状态模型 `tabs[] + activeTab` + 空态

**Files:**
- Modify: `src/context/layout.tsx:374-378`（默认值）、`:868-900`（API）、`:207+`（`migrateLayoutStore` 追加 sidePane 分支）
- Modify: `src/pages/session/session-side-panel.tsx:192-260`（tab strip 改 `tabs()` + 拖拽 + 空态）
- Modify: `src/pages/session.tsx:340-348`、`:982`、`src/components/prompt-input.tsx:239/246`、`src/context/dev-server.tsx:46`、`src/pages/layout/sidebar-files.tsx:120`、`src/pages/session/use-session-commands.tsx:255/466`（`setTab` → `setActive`、`toggle(tab)` → `add(tab)`）
- Test: `src/context/layout.test.ts`

**Interfaces:**
- Consumes: Task 1 的三字面量 `SidePaneTab`
- Produces:

```ts
sidePane: {
  opened: Memo<boolean>
  tabs: Memo<SidePaneTab[]>
  activeTab: Memo<SidePaneTab | null>
  width: Memo<number>
  open(): void            // 只展开，不创建 tab
  close(): void           // 收起，保留 tabs
  toggle(): void          // 只开关容器，签名无 tab 参数
  add(tab: SidePaneTab): void
  remove(tab: SidePaneTab): void   // 移除最后一个时自动 close()
  setActive(tab: SidePaneTab): void
  move(from: number, to: number): void
  resize(width: number): void
}
export function reduceSidePane(state: SidePaneState, action: SidePaneAction): SidePaneState  // 纯函数，可单测
```

- [ ] **Step 1: 写失败的语义与迁移测试**

```ts
test("toggle never creates or switches tabs", () => {
  const s = { opened: true, tabs: ["review"], activeTab: "review" as const }
  expect(reduceSidePane(s, { type: "toggle" })).toEqual({ ...s, opened: false })
})

test("removing last tab collapses the pane", () => {
  const s = { opened: true, tabs: ["preview"] as const, activeTab: "preview" as const }
  const next = reduceSidePane(s, { type: "remove", tab: "preview" })
  expect(next).toEqual({ opened: false, tabs: [], activeTab: null })
})

test("add activates an existing tab instead of duplicating", () => {
  const s = { opened: false, tabs: ["review"] as const, activeTab: "review" as const }
  const next = reduceSidePane(s, { type: "add", tab: "review" })
  expect(next.tabs).toEqual(["review"])
  expect(next.opened).toBe(true)
})

test("migrates legacy single tab and maps removed tabs", () => {
  expect(migrateLayoutStore({ sidePane: { opened: true, tab: "files", width: 320 } }))
    .toMatchObject({ sidePane: { opened: true, tabs: ["review"], activeTab: "review", width: 320 } })
  expect(migrateLayoutStore({ sidePane: { opened: true, tab: "git", width: 320 } }).sidePane.tabs)
    .toEqual(["preview"])
})

test("fresh default stays expanded with empty tabs", () => {
  expect(migrateLayoutStore({})).toEqual({})
  const fallback = { opened: true, tabs: [], activeTab: null }
  expect(fallback.opened).toBe(true)
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/app && bun test --preload ./happydom.ts ./src/context/layout.test.ts`
Expected: FAIL，`reduceSidePane is not a function` / 迁移未生效

- [ ] **Step 3: 实现纯函数与迁移**

- 新增 `reduceSidePane(state, action)`（放在 `layout.tsx` 内、`migrateLayoutStore` 下方，`export`）
- `migrateLayoutStore` 追加 `sidePane` 分支，规则见 spec §5.2 迁移 1–5 条；无 `sidePane` 键时返回原值（保持 identity 比较风格，见 `:310-319`）
- `createStore` 默认值改 `{ opened: true, tabs: [], activeTab: null, width: DEFAULT_SIDE_PANE_WIDTH }`
- context `sidePane` API 改为 Produces 块签名，内部一律委托 `reduceSidePane` + `setStore`

- [ ] **Step 4: 跑测试确认通过**

Run: 同 Step 2
Expected: PASS（含既有 `migrateLayoutStore` 用例全部不回归）

- [ ] **Step 5: 适配全部调用点**

按 spec §5.3：`setTab(x)` → `setActive(x)`；`toggle("review"|"preview")` → `add("review"|"preview")`；`open("preview")` / `open("review")` → 直接 `add(...)`（`add` 已包含「展开 + 已存在则激活」，无需再调 `open()`）。涉及文件见本任务 Files 列表。

- [ ] **Step 6: 实现空态**

`session-side-panel.tsx`：`tabs().length === 0` 时渲染空态——图标 + `sidePane.empty.title`（en "Open tab" / zh "打开标签页"）+ 三个 `add()` 入口按钮（preview/review/terminal，各自 i18n 标签复用 `sidePane.tab.*`）。新增键写入 `en.ts` + `zh.ts`。

- [ ] **Step 7: 验证**

Run: 仓库根 `bun typecheck` → `cd packages/app && bun test:unit` → `bun test:e2e -- layout.spec.ts`
Expected: typecheck 0 error；unit 全 pass；layout e2e PASS（默认展开断言仍成立）

- [ ] **Step 8: Commit**

```bash
git add packages/app/src/context/layout.tsx packages/app/src/context/layout.test.ts \
  packages/app/src/pages/session/session-side-panel.tsx packages/app/src/pages/session.tsx \
  packages/app/src/pages/session/use-session-commands.tsx packages/app/src/components/prompt-input.tsx \
  packages/app/src/context/dev-server.tsx packages/app/src/pages/layout/sidebar-files.tsx \
  packages/app/src/i18n/en.ts packages/app/src/i18n/zh.ts
git commit -m "feat(app): Side Pane 改为按需创建的 tabs 模型并增加空态"
```

---

### Task 4: 死代码与死状态清理

**Files:**
- Modify: `src/context/layout.tsx:364-367`（`git` 默认值段）、`:110`、`:1009-1017`（`todoCollapsed`）
- Modify: `src/pages/session/use-session-commands.tsx:495`、`src/pages/session/session-side-panel.tsx:57-61`
- Delete: `src/pages/session/composer/session-todo-dock.tsx`、`src/components/task-list.tsx`、`src/components/task-list.test.ts`
- Modify: `src/pages/session/composer/session-composer-region.tsx:21`（死导入）

**Interfaces:**
- Consumes: Task 3 的 `sidePane` API（`todoCollapsed` 的快捷键改切 Status Panel，此时面板尚不存在——本任务先改为 no-op 并留 `// TODO(status-panel)` 注释，Task 5 接回）

- [ ] **Step 1: 写失败的清理测试**

```ts
test("drops legacy git panel state", () => {
  const out = migrateLayoutStore({ git: { opened: true, width: 300 } })
  expect("git" in out).toBe(false)
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/app && bun test --preload ./happydom.ts ./src/context/layout.test.ts`
Expected: FAIL，`git` 键仍被原样返回

- [ ] **Step 3: 删除死状态与死代码**

- `migrateLayoutStore` 中 `migratedGit` 段（`:245-251`）与返回对象的 `git` 键一并删除；`createStore` 默认值 `git` 段删除
- 删除 `session-todo-dock.tsx`、`task-list.tsx`、`task-list.test.ts` 三文件及 `session-composer-region.tsx:21` 导入
- `todoCollapsed`：删除 `layout.tsx:110` 字段与 `:1009-1017` accessor；`use-session-commands.tsx:495` 与 `session-side-panel.tsx:57-61` 改为 no-op + 注释

- [ ] **Step 4: 跑测试与静态检查**

Run: `cd packages/app && bun test:unit` → 仓库根 `bun typecheck` → `bunx oxlint .`
Expected: unit 全 pass（`layout.test.ts` 中既有 `todoCollapsed` 用例同步更新）；typecheck 0 error；oxlint 0 error

- [ ] **Step 5: grep 确认无残留**

Run: `grep -rn 'SessionTodoDock\|task-list\|layout.git\.\|todoCollapsed' packages/app/src packages/ui/src`
Expected: 0 匹配（storybook `todo-panel-motion.stories.tsx` 中提及 `SessionTodoDock` 的注释一并更新）

- [ ] **Step 6: Commit**

```bash
git add -u packages/app/src packages/ui/src
git rm packages/app/src/pages/session/composer/session-todo-dock.tsx \
  packages/app/src/components/task-list.tsx packages/app/src/components/task-list.test.ts
git commit -m "chore(app): 清除 layout.git 死状态与 SessionTodoDock/TaskList 死代码"
```

---

### Task 5: Status Panel 骨架

**Files:**
- Create: `src/pages/session/status-panel/status-panel.tsx`（骨架 + 形态 + mini 胶囊）
- Create: `src/pages/session/status-panel/status-section.tsx`（可折叠区块容器）
- Modify: `src/pages/session.tsx:1866-1869`（挂载点）
- Modify: `src/i18n/en.ts`、`src/i18n/zh.ts`
- Test: `src/pages/session/status-panel/status-panel.test.ts`

**Interfaces:**
- Produces:

```ts
// status-panel.tsx
export function SessionStatusPanel(props: { sections: Array<{ id: string; title: string; summary?: JSX.Element; defaultOpen?: boolean; children: JSX.Element }> }): JSX.Element | null
// sections 全空时返回 null（整个不挂载）
// status-section.tsx
export function StatusSection(props: { id: string; title: string; summary?: JSX.Element; open: boolean; onToggle: () => void; children: JSX.Element }): JSX.Element
```

- Consumes: `conv-frame`（`session.tsx:1865` 已是 `@container`）

- [ ] **Step 1: 写失败的单测（挂载判定）**

`src/pages/session/status-panel/status-panel.test.ts`：

```ts
import { describe, expect, test } from "bun:test"
import { shouldMountStatusPanel } from "./status-panel"

describe("shouldMountStatusPanel", () => {
  test("never mounts without content", () => {
    expect(shouldMountStatusPanel([])).toBe(false)
  })
  test("mounts once at least one section survives filtering", () => {
    expect(shouldMountStatusPanel([{ id: "git" }])).toBe(true)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/app && bun test --preload ./happydom.ts ./src/pages/session/status-panel`
Expected: FAIL，`shouldMountStatusPanel is not a function` 或模块不存在

- [ ] **Step 3: 实现骨架与挂载**

- `status-panel.tsx` 导出 `shouldMountStatusPanel(sections: readonly { id: string }[]): boolean`（`sections.length > 0`），组件用它决定返回 `null` 还是渲染
- 渲染 `aside[data-component="status-panel"]`，类 `absolute top-4 right-4 z-10 w-80 max-h-[min(64dvh,32rem)]`；第二个及后续区块加 `border-t border-border-weak-base`；缺失区块不占位
- mini 胶囊态：同一 aside 内的 `w-max` 胶囊，与展开态靠 container query 互斥显示（收起态常驻 DOM，展开态用 `opacity`/`visibility`/`pointer-events` 藏起）
- container query：父级 `conv-frame` 已是 `@container`，容器宽 < 1280px 强制 mini；**禁止**读 `window.innerWidth` 或注册 `ResizeObserver`
- 手动收起/展开写入 per-workspace 偏好并持久化（沿用 `layout.tsx` 既有持久化模式）
- `status-section.tsx` 实现可折叠区块：标题 `text-ui-base`、摘要 `text-ui-sm tabular-nums`、限高滚动容器 `max-h-48`（进度区块后续用 `max-h-80`），标题固定在滚动视口外
- `session.tsx:1869` 相对容器内挂 `<SessionStatusPanel sections={...} />`，本任务传空数组

- [ ] **Step 4: 跑测试确认通过**

Run: 同 Step 2
Expected: PASS

- [ ] **Step 5: 静态约束与不回归**

Run: 仓库根 `grep -n 'window.innerWidth\|ResizeObserver' packages/app/src/pages/session/status-panel/*.tsx`（Expected: 0 匹配）→ `bun typecheck`（Expected: 0 error）→ `cd packages/app && bun test:e2e -- layout.spec.ts`（Expected: PASS）

> 「无内容不挂载」由 Step 1 单测 + `return null` 保证；**不写数据依赖的 e2e 存在性断言**（面板是否出现取决于仓库 git 状态与 todo，e2e 环境不可控）。

- [ ] **Step 6: Commit**

```bash
git add packages/app/src/pages/session/status-panel packages/app/src/pages/session.tsx \
  packages/app/src/i18n/en.ts packages/app/src/i18n/zh.ts
git commit -m "feat(app): 新增 Status Panel 骨架与 container query 形态裁决"
```

---

### Task 6: Git 区块

**Files:**
- Create: `src/pages/session/status-panel/git-section.tsx`
- Modify: `src/pages/session/git-panel.tsx`（数据链路抽出复用，重交互 UI 不再挂载）
- Modify: `src/pages/session/session-side-panel.tsx`（git 分支已在 Task 1 删除，此处仅接线）
- Test: `src/context/` 或就近新增 `git-section.test.ts`

**Interfaces:**
- Consumes: git snapshot 轮询（`git-panel.tsx:16` `REFRESH_INTERVAL`、`Snapshot` 类型）
- Produces: `export function buildGitSectionModel(snapshot: Snapshot | undefined): { added: number; removed: number; branch: string | null; dirty: number } | null`（非 git 仓库或 `added + removed <= 0` 返回 `null`）

- [ ] **Step 1: 写失败测试**

```ts
test("null when clean or not a repo", () => {
  expect(buildGitSectionModel(undefined)).toBeNull()
  expect(buildGitSectionModel({ isRepository: false } as never)).toBeNull()
  expect(buildGitSectionModel({ isRepository: true, added: 0, removed: 0, branch: "main" } as never)).toBeNull()
})
test("counts changes and branch", () => {
  expect(buildGitSectionModel({ isRepository: true, added: 734, removed: 7, branch: "feat/x" } as never))
    .toEqual({ added: 734, removed: 7, branch: "feat/x", dirty: 0 })
})
```

- [ ] **Step 2: 跑测试确认失败** — Run: `cd packages/app && bun test --preload ./happydom.ts ./src/pages/session/status-panel` → Expected: FAIL `buildGitSectionModel is not a function`

- [ ] **Step 3: 实现模型与区块**

- `buildGitSectionModel` 按 Produces 签名实现；区块渲染三行（Changes `+n -n` 点击 → `sidePane.add("review")`、分支行、Commit 动作行），字号 `text-ui-base`/`text-ui-sm`，diff 语义色用 `--color-diff-added`/`--color-diff-removed` 对应的既有 token
- 收起态摘要：`+n -n`（`text-ui-sm tabular-nums`）
- Commit 动作复用 `git-panel.tsx` 的提交请求，不新造 RPC

- [ ] **Step 4: 跑测试确认通过** — Expected: PASS

- [ ] **Step 5: 接线并验证**

`status-panel.tsx` 传入该区块（model 为 `null` 时不进 `sections`）。跑仓库根 `bun typecheck` + `cd packages/app && bun test:unit` + `bun test:e2e -- layout.spec.ts`，全绿后：

```bash
git add packages/app/src/pages/session/status-panel packages/app/src/pages/session/git-panel.tsx
git commit -m "feat(app): Status Panel 接入 Git 区块，clean repo 不挂载"
```

---

### Task 7: 进度区块

**Files:**
- Create: `src/pages/session/status-panel/todo-section.tsx`
- Modify: `src/pages/session/status-panel/status-panel.tsx`（接线）
- Modify: `src/i18n/en.ts`、`src/i18n/zh.ts`
- Test: `src/pages/session/status-panel/todo-section.test.ts`

**Interfaces:**
- Consumes: `globalSync.data.session_todo`（`Todo[]`，字段 `id`/`content`/`status`）
- Produces: `export function todoSectionModel(todos: Todo[]): { done: number; total: number; focus: Todo[]; preceding: number; following: number } | null`（空数组返回 `null`；>6 条走聚焦窗口：定位 `in_progress` → 第一个未完成 → 末尾，取连续 3 条）

- [ ] **Step 1: 写失败测试**

```ts
test("null on empty", () => expect(todoSectionModel([])).toBeNull())
test("counts done and total", () => {
  const m = todoSectionModel(t2("completed", "pending", "in_progress"))
  expect(m).toMatchObject({ done: 1, total: 3 })
})
test("focus window keeps 3 consecutive around in_progress when over 6", () => {
  const todos = t2("completed", "completed", "in_progress", "pending", "pending", "pending", "pending")
  const m = todoSectionModel(todos)!
  expect(m.focus).toHaveLength(3)
  expect(m.focus[0].status).toBe("in_progress")
  expect(m.preceding + m.focus.length + m.following).toBe(7)
})
test("buckets are counts, not slices", () => {
  const m = todoSectionModel(t2("completed", "completed", "completed", "completed", "completed", "in_progress"))!
  expect(m.preceding + m.focus.length + m.following).toBe(6)
})
```

- [ ] **Step 2: 跑测试确认失败** — Run: `cd packages/app && bun test --preload ./happydom.ts ./src/pages/session/status-panel` → Expected: FAIL

- [ ] **Step 3: 实现模型与区块**

模型按签名实现；区块渲染 Checkbox 行（复用 Task 4 删除的 dock 的行样式思路但重写为 `text-ui-base`），收起摘要 `done/total`（`text-ui-sm tabular-nums`），内容区 `max-h-80 overflow-y-auto`，标题固定在滚动视口外。

- [ ] **Step 4: 跑测试确认通过** — Expected: PASS

- [ ] **Step 5: 接线 + 恢复 todo 快捷键**

`use-session-commands.tsx:495` 的 no-op 改为「展开 Status Panel 并打开进度区块」。跑 typecheck + unit + `bun test:e2e -- layout.spec.ts`，全绿后：

```bash
git add packages/app/src/pages/session/status-panel packages/app/src/pages/session/use-session-commands.tsx \
  packages/app/src/i18n/en.ts packages/app/src/i18n/zh.ts
git commit -m "feat(app): Status Panel 接入进度区块，含 6 条以上聚焦窗口"
```

---

### Task 8: Context 区块

**Files:**
- Create: `src/pages/session/status-panel/context-section.tsx`
- Modify: `src/components/session/session-context-tab.tsx`（breakdown 渲染抽为可复用片段）
- Modify: `src/pages/session/status-panel/status-panel.tsx`（接线）
- Modify: `src/i18n/en.ts`、`src/i18n/zh.ts`
- Test: `src/pages/session/status-panel/context-section.test.ts`

**Interfaces:**
- Consumes: `getSessionContextMetrics`、`estimateSessionContextBreakdown`（`src/components/session/`）
- Produces: `export function contextSectionModel(metrics: ReturnType<typeof getSessionContextMetrics> | undefined): { label: string; percent: number } | null`

- [ ] **Step 1: 写失败测试** — 断言无 metrics 返回 `null`；有 metrics 时返回用量与百分比

- [ ] **Step 2: 跑测试确认失败** — Expected: FAIL

- [ ] **Step 3: 实现模型与区块** — 收起摘要显示百分比；展开态复用 `session-context-tab.tsx` 的 breakdown 行渲染（抽出为共享组件或渲染函数，避免复制两份），内容区 `max-h-48 overflow-y-auto`

- [ ] **Step 4: 跑测试确认通过** — Expected: PASS

- [ ] **Step 5: 接线 + 全量验证 + Commit**

```bash
cd packages/app && bun test:unit && bun test:e2e
cd .. && cd .. && bun typecheck && bunx oxlint .
```
全绿后：

```bash
git add packages/app/src/pages/session/status-panel packages/app/src/components/session/session-context-tab.tsx \
  packages/app/src/i18n/en.ts packages/app/src/i18n/zh.ts
git commit -m "feat(app): Status Panel 接入 Context 区块"
```

---

### Task 9: 全量验证与收尾

**Files:** 无新增（仅验证与可能的修补）

- [ ] **Step 1: 跑全部验证门**

```bash
bun typecheck                      # 仓库根，期望 16 包 0 error
cd packages/app
bun test:unit                      # 期望全 pass
bun test:e2e                       # 期望 14 pass / 1 skip 基线不回归
bun test ./src/i18n/parity.test.ts
bunx oxlint .                      # 期望 0 error
```

- [ ] **Step 2: 对照 spec §8 验收逐条核对**

12 条验收逐条打勾；任何一条不过 → 修补后重跑该条对应命令。

- [ ] **Step 3: grep 终检**

```bash
grep -rn 'sidePane.tab.files\|sidePane.tab.git\|sidePane.tab.context\|toggle("files")\|toggle("git")' packages/app/src
grep -rn 'window.innerWidth\|ResizeObserver' packages/app/src/pages/session/status-panel
grep -rn 'text-14-regular\|text-1[0-9]-' packages/app/src/pages/session/status-panel
```
Expected: 均 0 匹配（第三方既有文件中的命中不计，仅 status-panel 目录内须为 0）

- [ ] **Step 4: 汇报并提醒推送**

向用户汇报全部 commit、验证结果，并**提醒**可推送（不得自行推送）。
