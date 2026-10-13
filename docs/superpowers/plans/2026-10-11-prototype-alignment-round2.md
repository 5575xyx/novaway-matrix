# 原型对齐第二轮实施计划（P0+P1+P2 全量）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把桌面/Web UI 的视觉外壳与首页/侧栏信息密度补齐到已批准原型（`.superpowers/brainstorm/20261010-121745/content/prototype-full.html`）——四 frame + 4px 间隙、侧栏去 workspace 外壳改为「项目→任务」分组、共享 TaskRow（状态点/分支/相对时间/±统计/待确认徽标/模式色条）、Side Pane tab 不折行、WorkspaceHeader 精炼、Titlebar 克制化、首页任务中心完整信息密度，外加死代码清理与 i18n 提取。

**Architecture:** 只动 `packages/app`（桌面/Web 共用，不分支）。结构层改 `pages/layout.tsx` 的绝对定位偏移量 + 各 frame 根节点类名，不重构 Provider 树；行模型抽成 `TaskRow` 供侧栏与首页共用；所有新增文案走 i18n（`en.ts` 为回退基线，`language.tsx` 的 `merge` 会用 base=en 兜底缺失键，故只需 en+zh+zht 三文件）。视觉验证不只靠人眼：frame 几何与 tab 不折行写进 `e2e/layout.spec.ts` 的断言。

**Tech Stack:** SolidJS + Tailwind v4（含 `@container`/`@min-[...]` 容器查询变体）+ Kobalte + Playwright + oxlint。

**Spec:**
- 已批准设计：`docs/superpowers/specs/2026-10-10-desktop-layout-ui-redesign-design.md`（§3 四 frame/§4 侧栏/§5 会话区/§7 Titlebar 与首页）
- 原型（像素基准）：`.superpowers/brainstorm/20261010-121745/content/prototype-full.html`
- 差异证据（本轮开工前实测）：`C:\Users\13428\AppData\Local\Temp\app-home-taskcenter.png`、`app-session-expanded.png`

## Global Constraints

- 禁止 `git add -A`。工作区存在他人未提交改动：`packages/novaway/src/cli/cmd/run/theme.ts`、`packages/novaway/typecheck.log`、`packages/plugin/src/tui.ts`、`bun.lock`（install 副产物）——每个 commit 只 add 本任务文件。
- 禁止 push。全部完成后提醒用户。
- 禁止重启 app/server 进程（`packages/app/AGENTS.md` 明令）。后端 4096 已在跑（PID 23656），不要动。
- 代码风格：`semi: false`、`printWidth: 120`、dot notation、prefer const、avoid try/catch 与 any、Bun API。
- 字体：UI 层禁用 Tailwind 内置 `text-sm/base` 与任意字号，只用 `text-ui-xl/lg/base/caption/sm/xs`（Plan A 已收敛）。
- 状态色语义：绿=通过/运行、黄=待确认、红=失败、灰=空闲。禁止在 UI 新增 Aurora 类装饰。
- 持久化：若改 store 形状，Persist 版本常量必须 bump（当前 `Persist.global("layout", ["layout.v7"])` → `"layout.v8"`，`Persist.global("layout.page", ["layout.page.v1"])` 若删字段则 bump 为 `v2`），并在 `migrateLayoutStore` 里清除废弃键。
- 每个任务收尾验证：`cd packages/app && bun run typecheck` 过；`cd packages/app && bun test --preload ./happydom.ts ./src` 失败集合不得扩大（基线 **598 pass / 6 fail / 1 error**，存量：prompt-input/submit 4、file-tree 1、message-timeline.data 1）；`cd packages/app && bun test ./src/i18n/parity.test.ts` 1 pass；`bunx oxlint <改动文件>` 0 error。
- **不得猜测 token**：`text-ui-*`、`bg-*`、`text-*`、`border-*` 类若不确定是否存在，先 `rg -- '^\s*--color' packages/ui/src/styles/tokens.css packages/ui/src/styles/colors.css` 确认；颜色 token 名不确定时以 `sidebar-items.tsx`、`task-center.tsx` 里已存在的同类用法为准。
- 原型是像素基准但不是法律：标题栏内联搜索框保留（规格 §7 未列入移除项，⌘K 全局入口），此为已记录的有意偏差。

## Review Focus

1. **四 frame 间隙在窄窗口下塌陷**：`side()` 被 clamp 到 min 240 时，`--main-left`、ResizeHandle `left`、`pl-1` 三处偏移必须同步，否则出现 0px 或 8px 间隙——由 Task 1 的 e2e 几何断言钉住。
2. **侧栏删掉 workspace 外壳后功能丢失**：`ProjectSidebarContext` 的 12 个动作（编辑/关闭/移模式/工作区开关/新建工作区/进入/重命名/重置/删除/新建任务/清通知）必须全部能在新的项目分组头菜单触达，否则用户无法管理项目——Task 3 逐条核对。
3. **TaskRow 的四态判定与过滤脱节**：`sessionStatusOf` 是过滤与渲染的唯一真源，若侧栏过滤用一份、行内渲染用另一份，会出现「过滤=待确认但点显示灰色」——Task 2 合并两处 `statusOf`。
4. **模式色条按项目取色失败**：`--novaway-mode-color` 由全局 `layout.mode.current()` 注入（`layout.tsx:221-230`），侧栏一行可能属于另一个模式的项目，必须按 `appModeConfig(layout.mode.projectMode(dir))?.color` 取，否则跨模式项目行颜色错误。
5. **`layout.sidebar.opened()` 仍被 `SidebarPanel` 的 `merged` 读取**（`layout.tsx:2137`），删 workspace 外壳时若连这个 memo 一起动，会把移动端抽屉一并打坏——Task 3 只改 `merged` 的样式分支，不改其语义。

---

## Task 1: 四 frame + 4px 间隙外壳

**Files:**
- Modify: `packages/app/src/pages/layout.tsx`（`nav` 2398-2409、ResizeHandle 2412-2431、顶部分隔线 2433-2437 删除、main wrapper 2466-2477、`main` 2490-2495、`side()` 1997-2001、`--dialog-left-margin` 1993-1994、`SidebarPanel` 根 2146-2157）
- Modify: `packages/app/src/pages/session.tsx`（root 1834、WorkspaceHeader 1837 移入会话 frame、会话 frame 1865、主行 1866）
- Modify: `packages/app/src/pages/session/session-side-panel.tsx:209-215`（aside 根）
- Modify: `packages/app/src/pages/session/terminal-panel.tsx:194-209`（frame 根）
- Modify: `packages/app/src/components/titlebar.tsx:177-188`（根加 `border-b`）
- Test: `packages/app/e2e/layout.spec.ts`（新增几何断言）

**Interfaces:**
- Produces: 三个 frame 几何常量约定——frame 圆角 `rounded-lg`(8px)、边框 `border border-border-weak-base`、frame 间间隙 `4px`(`gap-1`/`p-1`)、侧栏宽度下限 `240`、侧栏 frame 右边缘 = `side() + 4`。后续任务复用同一组类名，不得各写各的。

- [ ] **Step 1: 写会失败的 e2e 几何断言**

在 `packages/app/e2e/layout.spec.ts` 追加测试（该文件已有 `test.describe`/`enterZenOffice` 结构，沿用其 fixture 与导航方式；若现有用例通过 titlebar 切模式进入会话，本用例同样先切模式再断言）：

```ts
test("四 frame 4px 间隙与 8px 圆角", async ({ page }) => {
  await enterZenOffice(page)
  await page.getByRole("button", { name: /Toggle side pane|切换 Side Pane/ }).first().click()
  const gap = async (a: string, b: string) =>
    page.evaluate(
      ([x, y]) => {
        const el = (s: string) => document.querySelector(s)
        if (!el(x) || !el(y)) return null
        const r = el(x)!.getBoundingClientRect()
        const s = el(y)!.getBoundingClientRect()
        return Math.round(s.x - r.right)
      },
      [a, b] as const,
    )
  // 侧栏 frame 与 会话 frame 横向间隙 = 4
  expect(await gap('[data-component="sidebar-nav-desktop"]', '[data-component="conv-frame"]')).toBe(4)
  // 会话 frame 与 侧栏 pane 横向间隙 = 4
  expect(await gap('[data-component="conv-frame"]', '[data-component="side-pane-frame"]')).toBe(4)
  // 终端 frame 上边距 = 4（先打开终端：Ctrl+`）
  await page.keyboard.press("Control+`")
  await page.waitForTimeout(600)
  const vertical = await page.evaluate(() => {
    const c = document.querySelector('[data-component="conv-frame"]')!.getBoundingClientRect()
    const t = document.querySelector('[data-component="terminal-frame"]')!.getBoundingClientRect()
    return Math.round(t.top - c.bottom)
  })
  expect(vertical).toBe(4)
  for (const sel of ['[data-component="sidebar-nav-desktop"]', '[data-component="conv-frame"]', '[data-component="side-pane-frame"]', '[data-component="terminal-frame"]']) {
    const r = await page.evaluate((s) => {
      const el = document.querySelector(s)!
      const cs = getComputedStyle(el)
      return { radius: cs.borderRadius, border: cs.borderStyle }
    }, sel)
    expect(r.radius).toBe("8px")
    expect(r.border).toBe("solid")
  }
})
```

- [ ] **Step 2: 运行确认失败**

Run: `cd packages/app && bun test:e2e --grep "四 frame"`
Expected: FAIL（`--main-left` 偏移为 `side()` 导致间隙 0，且各 frame 无圆角/边框）

- [ ] **Step 3: 实现外壳偏移与 frame 类**

`packages/app/src/pages/layout.tsx`：

1. `side()`（1997-2001）最小宽改 240：`Math.max(layout.sidebar.width(), 240)`；ResizeHandle（2418-2429）`min={244}` → `min={240}`。
2. 侧栏 `nav`（2398-2409）：`classList` 的 `"absolute inset-y-0 left-0"` 改为 `"absolute inset-y-1 left-1"`，`style` 保持 `width: ${side()}px`，并加 `data-component="sidebar-nav-desktop"`（已有则跳过）。
3. ResizeHandle 包裹层（2412-2417）：`style={{ left: `${side()}px` }}` → `style={{ left: `${side() + 4}px` }}`，class 加 `inset-y-1`。
4. 顶部分隔线（2433-2437，`border-t border-border-weaker-base` 且 `left: 12px`）：**整块删除**——frame 自带边框。
5. main wrapper（2466-2477）：`classList` 的 `"xl:inset-y-0 xl:right-0 xl:left-[var(--main-left)]"` 改为 `"xl:inset-y-1 xl:right-1 xl:left-[var(--main-left)]"`；`style` 的 `"--main-left": showSidebar() ? `${side()}px` : "0px"` 改为 `showSidebar() ? `${side() + 4}px` : "4px"`。
6. `main`（2490-2495）：类改为 `"size-full overflow-x-hidden flex flex-col items-start pl-1 bg-background-base page-transition"`；删除 `border-t border-border-weak-base` 与条件项 `"xl:border-l xl:rounded-tl-lg"`。
7. `--dialog-left-margin`（1993-1994）：`${sidebarWidth}px` → `${side() + 4}px`，使弹层与 frame 左缘对齐。
8. `SidebarPanel` 根（2146-2157）：`classList` 整块替换为

```ts
{
  "flex flex-col min-h-0 min-w-0 box-border rounded-lg border border-border-weak-base bg-background-stronger overflow-hidden": true,
  "flex-1 min-w-0 max-w-full": panelProps.mobile,
}
```

（删除 `rounded-tl-[12px]`、`px-3`、`border border-b-0`、`border-l border-t border-border-weaker-base`；`merged` memo 保留不动，仅其样式分支失效。`)

`packages/app/src/components/titlebar.tsx:177-188`：根 class 追加 `border-b border-border-weak-base`（承接从 `main` 移走的分隔线）。

`packages/app/src/pages/session.tsx`：

9. root（1834）`class="relative bg-background-base size-full overflow-hidden flex flex-col"` → 追加 `p-1 gap-1`。
10. 将 `<WorkspaceHeader />`（1837）从 root 直接子级**移入会话 frame 内作为首个子元素**（会话 frame 是 1865 的 `<div class="@container relative flex-1 min-h-0 flex flex-col bg-background-panel">`），使单行 header 属于会话 frame 而非 root 缝隙。
11. 会话 frame（1865）→ `class="@container relative flex-1 min-h-0 flex flex-col rounded-lg border border-border-weak-base bg-background-panel overflow-hidden" data-component="conv-frame"`。
12. 主行（1866）→ 追加 `gap-1`：`class="relative flex-1 min-h-0 overflow-hidden flex flex-col md:flex-row gap-1"`。

`packages/app/src/pages/session/session-side-panel.tsx:209-215`：`class="relative shrink-0 h-full flex flex-col rounded-lg border border-border-weak-base bg-background-base overflow-hidden"`（删 `border-l`）+ `data-component="side-pane-frame"`。

`packages/app/src/pages/session/terminal-panel.tsx:194-209`：root class 追加 `rounded-lg border border-border-weak-base`，并把 `classList` 中的 `"border-t border-border-weak-base"` 改为 `"border border-border-weak-base"`；加 `data-component="terminal-frame"`。

- [ ] **Step 4: 运行 e2e 断言确认通过**

Run: `cd packages/app && bun test:e2e --grep "四 frame"`
Expected: PASS（三处间隙均 4px、四个 frame 均 `borderRadius: 8px` + `solid`）

- [ ] **Step 5: 全量验证**

Run: `cd packages/app && bun run typecheck` → 0 error
Run: `cd packages/app && bun test --preload ./happydom.ts ./src` → 仍为 598 pass / 6 fail / 1 error
Run: `bunx oxlint packages/app/src/pages/layout.tsx packages/app/src/pages/session.tsx packages/app/src/pages/session/session-side-panel.tsx packages/app/src/pages/session/terminal-panel.tsx packages/app/src/components/titlebar.tsx packages/app/e2e/layout.spec.ts` → 0 error

- [ ] **Step 6: Commit**

```bash
git add packages/app/src/pages/layout.tsx packages/app/src/pages/session.tsx packages/app/src/pages/session/session-side-panel.tsx packages/app/src/pages/session/terminal-panel.tsx packages/app/src/components/titlebar.tsx packages/app/e2e/layout.spec.ts
git commit -m "feat(layout): four independent frames with 4px gaps"
```

---

## Task 2: 共享 TaskRow 与统一状态判定

**Files:**
- Create: `packages/app/src/components/session/task-row.tsx`
- Create: `packages/app/src/utils/relative-time.ts`
- Modify: `packages/app/src/pages/layout/helpers.ts`（新增 `sessionStatusOf`）
- Modify: `packages/app/src/utils/session-title.ts`（新增 `isDefaultSessionTitle`）
- Modify: `packages/app/src/i18n/en.ts`、`zh.ts`、`zht.ts`
- Modify: `packages/app/src/i18n/parity.test.ts`（把新增 key 纳入定向 parity 断言）

**Interfaces:**
- Consumes: `Session`（`packages/sdk/js/src/v2/gen/types.gen.ts:747-795`：`title: string`、`summary?: { additions, deletions, files }`、`time: { created, updated, archived? }`、`directory`）；`globalSync.child(dir)` → `[store, set]`，`store.session_working(id)`、`store.vcs?.branch`（`context/global-sync/types.ts:33-79`）；`sessionPermissionRequest(session, permission, sessionID?, include?)`（`pages/session/composer/session-request-tree.ts:36-43`）；`notification.session.unseenHasError(id)`（`context/notification.tsx:355-356`）；`layout.mode.projectMode(dir)` + `appModeConfig(mode).color`（`context/layout.tsx:731-753`、`:37-83`）。
- Produces:
```ts
// task-row.tsx
export type TaskStatus = "running" | "waiting" | "failed" | "idle"
export const TaskRow = (props: {
  title: () => string
  status: () => TaskStatus
  branch?: () => string | undefined
  updated?: () => number | undefined
  additions?: () => number
  deletions?: () => number
  waitingBadge?: () => boolean
  selected?: () => boolean
  modeColor?: () => string | undefined
  onClick: () => void
}): JSX.Element

// helpers.ts
export const sessionStatusOf = (
  globalSync: ReturnType<typeof useGlobalSync>,
  permission: ReturnType<typeof usePermission>,
  notification: ReturnType<typeof useNotification>,
  session: Session,
): TaskStatus

// relative-time.ts
export const formatRelativeTime = (
  ts: number | undefined,
  now: number,
  t: (key: string, params?: Record<string, string | number>) => string,
): string
```

**i18n 新增键（本任务负责，en / zh / zht 三文件同步；其余 14 个 locale 由 `language.tsx` 的 `merge` 回退 en，无需改）**：

| key | en | zh | zht |
| --- | --- | --- | --- |
| `time.now` | just now | 刚刚 | 剛剛 |
| `time.minute` | {{count}}m ago | {{count}} 分钟前 | {{count}} 分鐘前 |
| `time.hour` | {{count}}h ago | {{count}} 小时前 | {{count}} 小時前 |
| `time.day` | {{count}}d ago | {{count}} 天前 | {{count}} 天前 |
| `time.week` | {{count}}w ago | {{count}} 周前 | {{count}} 週前 |
| `taskCenter.waiting` | Waiting | 待确认 | 待確認 |

- [ ] **Step 1: 写失败测试**

`packages/app/src/utils/relative-time.test.ts`：

```ts
import { describe, expect, test } from "bun:test"
import { formatRelativeTime } from "./relative-time"

const t = (key: string, p?: Record<string, string | number>) => `${key}:${p?.count ?? ""}`
const now = 1_000_000_000_000

test("relative time buckets", () => {
  expect(formatRelativeTime(now - 30_000, now, t)).toBe("time.now:0")
  expect(formatRelativeTime(now - 5 * 60_000, now, t)).toBe("time.minute:5")
  expect(formatRelativeTime(now - 3 * 3600_000, now, t)).toBe("time.hour:3")
  expect(formatRelativeTime(now - 2 * 86_400_000, now, t)).toBe("time.day:2")
  expect(formatRelativeTime(now - 3 * 7 * 86_400_000, now, t)).toBe("time.week:3")
  expect(formatRelativeTime(undefined, now, t)).toBe("")
  expect(formatRelativeTime(now + 60_000, now, t)).toBe("")
})
```

`packages/app/src/utils/session-title.test.ts`（若文件已存在则在其中追加）：

```ts
test("isDefaultSessionTitle", () => {
  expect(isDefaultSessionTitle("New session - 2026-09-16T06:15:21.718Z")).toBe(true)
  expect(isDefaultSessionTitle("Child session - 2026-09-16T06:15:21.718Z")).toBe(true)
  expect(isDefaultSessionTitle("重构支付回调逻辑")).toBe(false)
  expect(isDefaultSessionTitle(undefined)).toBe(false)
})
```

- [ ] **Step 2: 运行确认失败**

Run: `cd packages/app && bun test ./src/utils/relative-time.test.ts ./src/utils/session-title.test.ts`
Expected: FAIL（模块/导出不存在）

- [ ] **Step 3: 实现三个纯函数与 TaskRow**

`relative-time.ts`：无参数时钟依赖（`now` 由调用方传入，便于测试）。阈值：`< 60s` → `time.now`；`< 60m` → `time.minute`（`Math.floor(min)`，最小 1）；`< 24h` → `time.hour`；`< 7d` → `time.day`；否则 `time.week`。`ts` 为空或未来时间返回 `""`。

`session-title.ts`：追加导出 `isDefaultSessionTitle`，复用文件内已有 `pattern`（`^(New session|Child session) - \d{4}-...Z$`）。

`helpers.ts`：实现 `sessionStatusOf`，把 `sidebar-tasks.tsx:43-54` 与 `task-center.tsx:23-34` 两份重复逻辑合并为一份，并补第四态：

```ts
if (notification.session.unseenHasError(session.id)) return "failed"
const waiting = !!sessionPermissionRequest(...)
if (waiting) return "waiting"
if (globalSync.child(session.directory)[0].session_working(session.id)) return "running"
return "idle"
```

（`failed` 判定放在最前——错误未读时优先级高于运行中，与 `sidebar-items.tsx:291-293` 的 `bg-text-diff-delete-base` 语义一致。）

`task-row.tsx`：单行 flex，`h-9 px-2 rounded-md`，hover `bg-surface-base-hover`；选中态加 `before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-0.5 before:rounded-full` + `style={{ background: ... }}`，`before` 颜色取 `props.modeColor() ?? "var(--border-strong-base)"`。内容顺序（对齐原型 `.trow`）：

1. 状态点 `size-1.5 rounded-full shrink-0`：`running` → `bg-text-interactive-base animate-pulse`；`waiting` → `bg-surface-warning-strong`；`failed` → `bg-text-diff-delete-base`；`idle` → `bg-border-strong-base`。
2. 标题 `text-ui-caption text-text-strong truncate flex-1 min-w-0`。
3. `waitingBadge()` 为真时追加徽标 `text-ui-xs px-1 rounded border` 黄色语义（复用 `sidebar-items.tsx` 现有等待样式；`rg "surface-warning" packages/app/src/pages/layout/sidebar-items.tsx` 取准确类名）。
4. 分支 `branch()` 有值时 `Icon name="branch" size="small"` + `text-ui-xs text-text-weak shrink-0 max-w-[120px] truncate`。
5. 相对时间 `text-ui-xs text-text-weak shrink-0`（`updated()` 为空则不渲染）。
6. `±` 统计：`additions()+deletions() > 0` 时渲染 `text-ui-xs tabular-nums shrink-0`，`+N` 用 `text-[var(--icon-diff-add-base)]`、`-N` 用 `text-[var(--icon-diff-delete-base)]`（与 `sidebar-items.tsx:336-343` 一致）。

颜色 token 必须先从 `sidebar-items.tsx` 已存在的用法照抄，禁止臆造新 token 名。

- [ ] **Step 4: 运行测试确认通过**

Run: `cd packages/app && bun test ./src/utils/relative-time.test.ts ./src/utils/session-title.test.ts`
Expected: PASS（2 用例）

- [ ] **Step 5: i18n 落键 + parity**

在 `en.ts` / `zh.ts` / `zht.ts` 按上表加入 6 个键（扁平字符串键，插入到 `sidebar.*` / `taskCenter.*` 附近的字典段）。在 `packages/app/src/i18n/parity.test.ts` 的 `keys` 数组里追加 `"time.now"`、`"taskCenter.waiting"`（该测试断言每个 locale 都有定义且 ≠ en，追加后需确认 `zht` 等 locale 已翻译——本任务只在 3 个文件加键，其余 locale 缺失会令该断言失败，因此**这两个键必须写进全部 17 个 locale 文件**，未翻译的 locale 用 en 文案占位）。

Run: `cd packages/app && bun test ./src/i18n/parity.test.ts`
Expected: PASS 1（若失败说明有 locale 缺键，补齐）

- [ ] **Step 6: 全量验证 + Commit**

Run: `cd packages/app && bun run typecheck` → 0 error
Run: `cd packages/app && bun test --preload ./happydom.ts ./src` → 失败集合不扩大
Run: `bunx oxlint packages/app/src/components/session/task-row.tsx packages/app/src/utils/relative-time.ts packages/app/src/pages/layout/helpers.ts packages/app/src/utils/session-title.ts` → 0 error

```bash
git add packages/app/src/components/session/task-row.tsx packages/app/src/utils/relative-time.ts packages/app/src/utils/relative-time.test.ts packages/app/src/utils/session-title.ts packages/app/src/utils/session-title.test.ts packages/app/src/pages/layout/helpers.ts packages/app/src/i18n/ packages/app/src/i18n/parity.test.ts
git commit -m "feat(task): shared TaskRow with status, branch, relative time and diff stats"
```

---

## Task 3: 侧栏去 workspace 外壳，改「项目 → 任务」分组

**Files:**
- Modify: `packages/app/src/pages/layout.tsx`（`SidebarPanel` 2136-2373 重写：删头部 2159-2216、删 `workspacePanelExpanded` 门控 2252、删 `DragDropProvider`/`SortableProvider`/`DragOverlay`/`ConstrainDragXAxis` 嵌套 2268-2338；新增分组头与 segmented）
- Modify: `packages/app/src/pages/layout.tsx:103-117`（store 删 `workspacePanelExpanded`）+ `context/layout.tsx` 无需改
- Modify: `packages/app/src/context/layout.tsx`（Persist bump `layout.v7` → `layout.v8`，`migrateLayoutStore` 清除废弃键——注意 `workspacePanelExpanded` 属于 `layout.page.v1`，bump 为 `layout.page.v2`）
- Modify: `packages/app/src/pages/layout/sidebar-tasks.tsx`（`ProjectTaskList` 删内部组头 66-84，改用 `TaskRow`；删本地 `statusOf` 改调 `sessionStatusOf`）
- Modify: `packages/app/src/pages/layout/helpers.ts`（若 `sortedRootSessionsFrom` 签名需带 store 则同步）
- Modify: `packages/app/src/components/session/task-row.tsx`（若分组头需要复用其样式，可在此抽 `TaskGroupHeader`）
- Modify: `packages/app/src/pages/layout/sidebar-project.tsx`（`ProjectSidebarContext` 保持；`ContextMenu` 全套动作迁到分组头 `⋯` `DropdownMenu`，保留全部 `data-action` 属性）
- Test: `packages/app/e2e/layout.spec.ts`（新增：分组头存在、`⋯` 菜单可达 12 个动作、文件树视图「返回任务」）

**Interfaces:**
- Consumes: Task 2 的 `TaskRow` / `sessionStatusOf` / `formatRelativeTime`；`ProjectSidebarContext`（`sidebar-project.tsx:13-34`，12 个动作原样）；`layout.sidebarView.current()/set()`；`TaskFilter`（`sidebar-tasks.tsx:16`）；`useArchivedSessions`（`sidebar-tasks.tsx:120-145`）。
- Produces: 侧栏结构契约（Task 4/6/10 依赖）——顶部 `Segmented(任务|文件)` + 右侧 `[搜索][新建][⋯]`；任务视图 = `TaskFilterBar` + 项目分组（`分组头(▾ 名称 N 任务 ⋯)` → `TaskRow[]`）；文件视图 = `[← 返回任务] [仅变更/全部]` + `SidebarFiles`。

- [ ] **Step 1: 写失败 e2e**

`packages/app/e2e/layout.spec.ts` 追加：

```ts
test("侧栏分组结构与项目菜单可达", async ({ page }) => {
  await enterZenOffice(page)
  const sidebar = page.getByRole("navigation").first()
  // 侧栏第一行必须是 segmented，不能是「工作区 项目数」头部
  expect(await sidebar.locator('text=工作区').count()).toBe(0)
  expect(await sidebar.getByRole("button", { name: /Tasks|任务/ }).count()).toBeGreaterThan(0)
  expect(await sidebar.getByRole("button", { name: /Files|文件/ }).count()).toBeGreaterThan(0)
  // 文件视图 → 返回任务
  await sidebar.getByRole("button", { name: /Files|文件/ }).first().click()
  expect(await page.getByText(/返回任务|Back to tasks/).count()).toBeGreaterThan(0)
  await sidebar.getByRole("button", { name: /Tasks|任务/ }).first().click()
  // 分组头 + ⋯ 菜单
  const dots = sidebar.getByRole("button", { name: /项目菜单|Project menu/ })
  expect(await dots.count()).toBeGreaterThan(0)
  await dots.first().click()
  for (const label of [/编辑|Edit/, /关闭|Close/, /移动到模式|Move to mode/]) {
    expect(await page.getByRole("menuitem", { name: label }).count()).toBeGreaterThan(0)
  }
  await page.keyboard.press("Escape")
})
```

- [ ] **Step 2: 运行确认失败**

Run: `cd packages/app && bun test:e2e --grep "侧栏分组结构"`
Expected: FAIL（`text=工作区` 计数 > 0；无 `项目菜单` 按钮）

- [ ] **Step 3: 重写 `SidebarPanel` 头部与列表嵌套**

1. 新头部（替换 2159-2241 整块，即 `shrink-0 py-3 px-1` 头 + 现 segmented 行）：

```tsx
<div class="shrink-0 px-2 pt-2.5 pb-2 flex flex-col gap-2">
  <div class="flex items-center gap-1">
    <div class="flex items-center gap-0.5 rounded-md bg-surface-raised-base border border-border-weak-base p-0.5">
      <button classList={{ "px-2.5 py-1 rounded-[5px] text-ui-caption transition-colors": true,
        "bg-text-interactive-base text-background-base": layout.sidebarView.current() === "tasks",
        "text-text-weak hover:text-text-base": layout.sidebarView.current() !== "tasks" }}
        onClick={() => layout.sidebarView.set("tasks")}>{language.t("sidebar.view.tasks")}</button>
      <button /* tree 同理 */>{language.t("sidebar.view.files")}</button>
    </div>
    <div class="ml-auto flex items-center gap-0.5">
      {/* 搜索：复用 session-header 里的 ⌘K 入口命令 */}
      <IconButton icon="search" variant="ghost" size="small" aria-label={language.t("sidebar.search")} onClick={() => command.trigger("file.open")} />
      <IconButton icon="plus" variant="ghost" size="small" aria-label={language.t("sidebar.newTask")} onClick={() => { firstProject() ? navigateToNewSession(firstProject()) : layout.projectPicker.show() }} />
      <IconButton icon="dot-grid" variant="ghost" size="small" aria-label={language.t("sidebar.menu.toggle")} /* 打开全局项目菜单 */ />
    </div>
  </div>
</div>
```

`bg-text-interactive-base` 若不存在，改用最接近的强调色 token（先 `rg -- "--color-.*interactive" packages/ui/src/styles/` 确认；不得臆造）。

2. **TaskFilterBar**（`sidebar-tasks.tsx:90-118`）按原型改为纯文字行（原型 `.sb-filters`：`font-size:var(--fs-sm); color:var(--text-3)`，active 仅 `color:var(--text); font-weight:550`，**无 pill 背景**）：`flex items-center gap-3 px-3 pb-1 text-ui-sm`，active `text-text-strong font-medium`，inactive `text-text-weak hover:text-text-base`。追加第 5 个筛选项 `projects`（仅首页需要时再启用，见 Task 6；侧栏保持 4 项）。

3. **删 workspace 外壳**：删除 2252 的 `<Show when={store.workspacePanelExpanded}>` 门控（列表常驻）、2268-2338 的 `DragDropProvider` + `DragDropSensors` + `ConstrainDragXAxis` + `SortableProvider` + `SortableProject` + `DragOverlay` 整块、以及 `store.workspacePanelExpanded` 字段与头部 2187-2204 的对应 IconButton/Tooltip。`layout.page.v1` → `layout.page.v2`，`migrateLayoutStore` 中删除 `workspacePanelExpanded`。

4. **新的分组列表**（替换上述整块）：外层 `flex-1 min-h-0 overflow-y-auto no-scrollbar px-2 pb-3`，`For` 遍历 `projectList()`，每组：

```tsx
<div class="mt-1">
  <div class="group flex items-center gap-1.5 px-2 py-1.5 rounded-md hover:bg-surface-base-hover">
    <button aria-label="展开/折叠" onClick={() => toggle(project.worktree)}>
      <Icon name={expanded ? "chevron-down" : "chevron-right"} size="small" />
    </button>
    <Icon name="folder" size="small" class="shrink-0 text-icon-base" />
    <span class="text-ui-caption text-text-strong font-medium truncate flex-1 min-w-0">{name}</span>
    <span class="text-ui-xs text-text-weak shrink-0">{language.t("sidebar.project.count", { count })}</span>
    <DropdownMenu>
      <DropdownMenu.Trigger as={IconButton} icon="dot-grid" variant="ghost" size="small"
        aria-label={language.t("sidebar.projectMenu")} class="opacity-0 group-hover:opacity-100 focus-visible:opacity-100" />
      <DropdownMenu.Portal><DropdownMenu.Content>{/* 见第 5 步 */}</DropdownMenu.Content></DropdownMenu.Portal>
    </DropdownMenu>
  </div>
  <Show when={expanded}>
    <div class="flex flex-col gap-0.5">{tasks}</div>
  </Show>
</div>
```

5. **`⋯` 菜单内容**：把 `sidebar-project.tsx:200-299` `ContextMenu.Content` 里的**全部**条目迁移为 `DropdownMenu.Item`（`ContextMenu`/`ContextMenu.Sub` → `DropdownMenu`/`DropdownMenu.Sub`），**逐条保留 `data-action` 属性**（`project-workspaces-toggle`、`project-clear-notifications`、`project-close-menu`）与 `disabled` 条件，复用现有 i18n 键（`common.edit`、`common.close`、`workspace.new`、`sidebar.workspaces.enable/disable`、`sidebar.project.clearNotifications`、`workspace.type.local/sandbox`）。原硬编码中文改为 i18n 键 `sidebar.project.moveToMode`（移动 到模式 / Move to mode / 移動到模式）、`sidebar.project.currentMode`（当前 / Current / 目前）。**动作映射核对表（逐条打勾）**：`showEditProjectDialog`、`closeProject`、`moveProjectToMode`、`toggleProjectWorkspaces`、`createWorkspace`、`openWorkspace`、`navigateToNewSession`、`showRenameWorkspaceDialog`、`showResetWorkspaceDialog`、`showDeleteWorkspaceDialog`、`clear`（清通知）——11 条动作 + 本地/沙箱分支判定，缺一条即任务未完成。
   迁完后可删除 `sidebar-project.tsx` 内的 `ContextMenu` 用法（文件保留，`ProjectIcon`/`ProjectDragOverlay`/`ProjectSidebarContext` 仍在用；`ProjectCard`/`SortableProject` 若变为 0 引用则一并删除）。

6. **`ProjectTaskList`**（`sidebar-tasks.tsx:18-88`）：删除内部组头 66-71（`folder` + 文件名 + 计数，与外层分组头重复）、删除本地 `statusOf`（43-54，改调 `sessionStatusOf(globalSync, permission, notification, session)`，`notification` 由 `useNotification()` 取）；行渲染改 `TaskRow`：

```tsx
<TaskRow title={...} status={() => sessionStatusOf(...)}
  branch={() => globalSync.child(session.directory)[0].vcs?.branch}
  updated={() => session.time?.updated}
  additions={() => session.summary?.additions ?? 0}
  deletions={() => session.summary?.deletions ?? 0}
  waitingBadge={() => status() === "waiting"}
  selected={() => params.id === session.id}
  modeColor={() => appModeConfig(layout.mode.projectMode(session.directory))?.color}
  onClick={() => navigateTo(session.directory, session.id)} />
```

`title` 用 Task 2 的 `isDefaultSessionTitle`：默认标题时显示 `language.t("workspace.header.untitled")` 兜底文案（键已在 `en.ts:1430` 存在），否则 `session.title`。
`dirs`（30-40）与 `stores`（41）两个 memo 保持（rows 数据源依赖）；仅删组头与重复的 `statusOf`。

7. **移动端抽屉**：`sidebarContent(true)` 走同一 `SidebarPanel`，`mobile` 分支保持 `flex-1 min-w-0 max-w-full`；`SidebarContent` 的 `expanded={() => true}` 不变。`layout.sidebar.opened()` 相关分支（`layout.tsx:291`、`2113`、`2137`、`sidebar-items.tsx:268,493`）**不动**——Review Focus 5。

8. **空态**：项目列表为空时渲染居中空态（`sidebar.empty.title` / `sidebar.empty.description`，`en.ts:849-850` 已有）+ 一个 `打开项目` 主按钮（`command.project.open`）。

- [ ] **Step 4: 运行 e2e 确认通过**

Run: `cd packages/app && bun test:e2e --grep "侧栏分组结构"`
Expected: PASS

- [ ] **Step 5: 全量验证 + Commit**

Run: `cd packages/app && bun run typecheck` → 0 error
Run: `cd packages/app && bun test --preload ./happydom.ts ./src` → 失败集合不扩大
Run: `cd packages/app && bun test ./src/i18n/parity.test.ts` → PASS
Run: `bunx oxlint packages/app/src/pages/layout.tsx packages/app/src/pages/layout/sidebar-tasks.tsx packages/app/src/pages/layout/sidebar-project.tsx packages/app/src/pages/layout/helpers.ts packages/app/src/context/layout.tsx packages/app/e2e/layout.spec.ts` → 0 error

```bash
git add packages/app/src/pages/layout.tsx packages/app/src/pages/layout/sidebar-tasks.tsx packages/app/src/pages/layout/sidebar-project.tsx packages/app/src/pages/layout/helpers.ts packages/app/src/context/layout.tsx packages/app/src/i18n/ packages/app/e2e/layout.spec.ts
git commit -m "feat(sidebar): replace workspace panel with grouped project-task list"
```

---

## Task 4: Side Pane tab 不折行 + 折叠按钮

**Files:**
- Modify: `packages/app/src/pages/session/session-side-panel.tsx:209-240`（`aside` 加 `@container`；tab 按钮 `shrink-0 whitespace-nowrap`；标签在窄宽度下隐藏；尾部加折叠按钮）
- Modify: `packages/app/src/i18n/en.ts`、`zh.ts`、`zht.ts`
- Test: `packages/app/e2e/layout.spec.ts`

**Interfaces:**
- Consumes: `layout.sidePane.toggle()/opened()/setTab()`（`context/layout.tsx:876-908`）；`tabsList`（`session-side-panel.tsx:196-207`）；`layout.sidePane.width()` clamp `Math.min(width, innerWidth*0.6)`（193-194）。
- Produces: tab 条在 `320px` 最小宽下不折行——380px 容器查询阈值以下只显示图标。

**i18n 新增键**：`sidePane.collapse`（折叠侧栏 / Collapse side pane / 摺疊側欄）、`sidePane.expand`（展开侧栏 / Expand side pane / 展開側欄）。仅 `en/zh/zht` 三文件（不纳入 parity 定向键，避免扩到 17 文件）。

- [ ] **Step 1: 写失败 e2e**

```ts
test("Side Pane tab 标签不折行", async ({ page }) => {
  await enterZenOffice(page)
  await page.getByRole("button", { name: /Toggle side pane|切换 Side Pane/ }).first().click()
  const tabs = page.locator('[data-component="side-pane-frame"] button').filter({ hasText: /预览|Preview|终端|Terminal|文件|Files|Git|审查|Review|上下文|Context/ })
  const boxes = await tabs.allBoundingBoxes()
  expect(boxes.length).toBeGreaterThanOrEqual(6)
  for (const b of boxes) expect(b.height).toBeLessThan(40)   // 折行会 >40px
  // 收窄到 ResizeHandle 下限 320，仍不折行
  await page.setViewportSize({ width: 1100, height: 900 })
  await page.waitForTimeout(400)
  for (const b of await tabs.allBoundingBoxes()) expect(b.height).toBeLessThan(40)
  await page.setViewportSize({ width: 1600, height: 900 })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `cd packages/app && bun test:e2e --grep "Side Pane tab"`
Expected: FAIL（320px 宽度下按钮高度 > 40）

- [ ] **Step 3: 实现**

1. `aside`（209-215）class 追加 `@container`。
2. tab 条容器（224-240）：`flex items-center gap-0.5 h-9 px-1.5 border-b border-border-weak-base shrink-0` → 追加 `overflow-x-auto no-scrollbar`。
3. 每个 tab 按钮 class 追加 `shrink-0 whitespace-nowrap`；图标 `shrink-0`；**标签**包一层 `<span class="hidden @min-[380px]:inline-block whitespace-nowrap">`，使容器 <380px 时只显示图标。
4. 尾部加折叠按钮：`<IconButton icon="layout-right" variant="ghost" size="small" aria-label={language.t("sidePane.collapse")} aria-expanded={layout.sidePane.opened()} onClick={layout.sidePane.toggle} class="ml-auto shrink-0" />`（原型 `.sp-tabs .collapse` 位于 tab 条最右）。
5. `layout.sidePane.width()` 下限不变（ResizeHandle `min={320}`），保持现状。

- [ ] **Step 4: 运行 e2e 确认通过**

Run: `cd packages/app && bun test:e2e --grep "Side Pane tab"`
Expected: PASS

- [ ] **Step 5: 全量验证 + Commit**

Run: `cd packages/app && bun run typecheck` → 0 error；`bunx oxlint packages/app/src/pages/session/session-side-panel.tsx packages/app/e2e/layout.spec.ts` → 0 error；单测失败集合不扩大。

```bash
git add packages/app/src/pages/session/session-side-panel.tsx packages/app/src/i18n/ packages/app/e2e/layout.spec.ts
git commit -m "fix(side-pane): tab labels stop wrapping at narrow widths; add collapse button"
```

---

## Task 5: WorkspaceHeader 精炼

**Files:**
- Modify: `packages/app/src/components/session/workspace-header.tsx`（整文件重写布局：39-136）
- Modify: `packages/app/src/i18n/en.ts`、`zh.ts`、`zht.ts`

**Interfaces:**
- Consumes: `sessionTitle` / `isDefaultSessionTitle`（Task 2）；`globalSync.child(dir)[0].vcs?.branch`；`ModelSelectorPopover`（`components/dialog-select-model.tsx:98`）；`layout.sidePane.toggle()`；`sessionLayout.view().terminal.opened()`；`ProjectSidebarContext` 无关。
- Produces: 单行 36px header：`标题 | 项目/分支 pill | 模型 pill(限宽) | 执行档 | spacer | 终端 | Side Pane | 更多`。

**i18n 新增键**：`workspace.header.variant.default/low/medium/high/max`（默认/低/中/高/高+ ↔ Default/Low/Medium/High/Max ↔ 預設/低/中/高/高+）、`workspace.header.projectBranch`（`{{project}} / {{branch}}` ↔ `{{project}} / {{branch}}`）。仅 3 文件。

- [ ] **Step 1: 实现（无失败测试前置，视觉任务；以 e2e 断言兜底）**

在 `packages/app/e2e/layout.spec.ts` 追加一条最小断言，先跑一次确认现状基线：

```ts
test("WorkspaceHeader 单行且不溢出", async ({ page }) => {
  await enterZenOffice(page)
  const box = await page.locator('[data-component="workspace-header"]').first().boundingBox()
  expect(box.height).toBeLessThanOrEqual(40)
  // 模型 pill 不得超出 header 右缘
  const header = await page.locator('[data-component="workspace-header"]').first().boundingBox()
  const model = await page.locator('[data-component="workspace-model"]').first().boundingBox()
  expect(model.x + model.width).toBeLessThanOrEqual(header.x + header.width)
})
```

- [ ] **Step 2: 运行确认现状**

Run: `cd packages/app && bun test:e2e --grep "WorkspaceHeader"`
Expected: 现状下 `data-component` 不存在 → FAIL（先确认失败，再实现）

- [ ] **Step 3: 重写 WorkspaceHeader**

1. 根（39）追加 `data-component="workspace-header"`，保持 `h-10 px-3`（40px = 原型 36px 的 4px 节奏近似，属已记录偏差）。
2. 标题（43-45）：`max-w-[280px]` → `max-w-[240px]`；文案改为 `isDefaultSessionTitle(session()?.title) ? language.t("workspace.header.untitled") : session()?.title`。
3. 目录 pill（46-48）改为 `项目名 / 分支`：`{language.t("workspace.header.projectBranch", { project: dirName(), branch: globalSync.child(directory())[0].vcs?.branch ?? "" })}`，`max-w-[180px]` 保持；`branch` 为空时只显示项目名。
4. 模型 pill（50-65）：`triggerProps.class` 的 `max-w-[200px]` → `max-w-[150px]`，追加 `data-component="workspace-model"` 与 `truncate`。
5. 执行档 `Select`（66-83）：硬编码 `默认/低/中/高/高+` 改 `language.t("workspace.header.variant." + x)`；`class` 追加 `max-w-[120px]`。
6. 顺序按原型 `.wshead`：`pulse dot | 标题 | pill | 模型 | 执行档 | flex-1 | 终端 toggle | Side Pane toggle | 更多菜单`。
7. 「更多」菜单项（102-136）保持（fileTree/git toggle、copyPath/copyTitle）。

- [ ] **Step 4: 运行 e2e 确认通过**

Run: `cd packages/app && bun test:e2e --grep "WorkspaceHeader"`
Expected: PASS

- [ ] **Step 5: 全量验证 + Commit**

Run: `cd packages/app && bun run typecheck` → 0 error；`bunx oxlint packages/app/src/components/session/workspace-header.tsx packages/app/e2e/layout.spec.ts` → 0 error；单测失败集合不扩大。

```bash
git add packages/app/src/components/session/workspace-header.tsx packages/app/src/i18n/ packages/app/e2e/layout.spec.ts
git commit -m "feat(workspace-header): project/branch pill, bounded model pill, i18n variant labels"
```

---

## Task 6: 首页任务中心信息密度

**Files:**
- Modify: `packages/app/src/pages/task-center.tsx`（69-131 重写）
- Modify: `packages/app/src/pages/layout/sidebar-tasks.tsx`（`TaskFilterBar` 加 `variant: "pill" | "underline"` 与 `extraTabs` 参数，供侧栏与首页共用）
- Modify: `packages/app/src/i18n/en.ts`、`zh.ts`、`zht.ts`

**Interfaces:**
- Consumes: Task 2 的 `TaskRow`/`sessionStatusOf`/`formatRelativeTime`；`sortedRootSessionsFrom`（`helpers.ts:32-41`）；`useArchivedSessions`（`sidebar-tasks.tsx:120-145`）；`layout.projects.list()`；`layout.projectPicker.show()`；`command.trigger("file.open")`。
- Produces: 首页五标签（最近/运行中/待确认/已归档/项目）+ 搜索框 + 卡片式任务行 + 虚线「从项目或本地目录开始」行。

**i18n 新增键**（3 文件）：`taskCenter.search`（搜索任务、项目或会话 / Search tasks, projects or sessions / 搜尋任務、專案或對話）、`taskCenter.recent`（最近/Recent/最近）、`taskCenter.running`（运行中/Running/執行中）、`taskCenter.waiting`（已在 Task 2 加，勿重复）、`taskCenter.archived`（已归档/Archived/已歸檔）、`taskCenter.projects`（项目/Projects/專案）、`taskCenter.fromProject`（从项目或本地目录开始 / Start from a project or local folder / 從專案或本機資料夾開始）。

- [ ] **Step 1: 写失败 e2e**

```ts
test("首页任务中心信息密度", async ({ page }) => {
  await page.goto("/")
  expect(await page.getByRole("button", { name: /搜索任务|Search tasks/ }).count()).toBeGreaterThan(0)
  for (const t of [/最近|Recent/, /运行中|Running/, /待确认|Waiting/, /已归档|Archived/, /项目|Projects/]) {
    expect(await page.getByRole("tab", { name: t }).count()).toBeGreaterThan(0)
  }
  // 虚线起始行
  expect(await page.getByText(/从项目或本地目录|Start from a project/).count()).toBeGreaterThan(0)
})
```

- [ ] **Step 2: 运行确认失败**

Run: `cd packages/app && bun test:e2e --grep "首页任务中心"`
Expected: FAIL（无搜索按钮、tab 只有 4 个 pill 且 role 不是 tab）

- [ ] **Step 3: 实现**

1. `TaskFilterBar` 扩展：`variant?: "pill" | "underline"`（默认 `"pill"` 保持侧栏现状）、`tabs?: Array<{ id: TaskFilter | "projects"; labelKey: string; count?: number }>`（默认保持现有 4 项 pill）。underline 样式按原型 `#home-tabs`：`flex gap-4 border-b border-border-weak-base text-ui-caption`，每项 `pb-1.5 -mb-px border-b-2 border-transparent`，active `text-text-strong font-medium border-text-interactive-base`，inactive `text-text-weak hover:text-text-base`；`role="tab"` + `aria-selected`。
2. `task-center.tsx` 容器（69-70）：`mx-auto max-w-3xl px-6 py-10 flex flex-col gap-6` → `max-w-[860px] px-10 py-7 flex flex-col gap-4`（左对齐，原型 `padding:28px 40px`）。
3. 顶部行（原型 `.hrow`）：`h1 任务(text-ui-xl font-semibold)` + 搜索框（`flex items-center gap-1.5 rounded-md border border-border-weak-base bg-surface-raised-base px-3 py-1.5 min-w-[220px]`，`aria-label={language.t("taskCenter.search")}`，`onClick={() => command.trigger("file.open")}`）+ `flex-1` + `新建任务` 主按钮 + `打开项目` 次按钮。
4. 任务卡列表（98-129）：外层 `flex flex-col gap-2.5`；每卡 `rounded-lg border border-border-weak-base bg-background-panel` + 内嵌 `TaskRow`（`p-2`），复用 Task 2 的 `TaskRow`，补 `branch`/`updated`/`waitingBadge`/`modeColor`。
5. 列表尾部虚线行（原型 `.new-task-row`）：`rounded-lg border border-dashed border-border-strong-base px-4 py-3 text-ui-caption text-text-weak hover:text-text-base hover:border-border-interactive-base cursor-pointer flex items-center gap-2`，文案 `language.t("taskCenter.fromProject")`，点击 `layout.projectPicker.show()`。
6. `projects` 标签页内容：`grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3`，每项目卡显示名称 + 任务数 + `vcs?.branch` + 最近活跃相对时间；末位虚线卡「打开本地目录」（复用 `command.project.open`）。
7. 删除本地 `statusOf`（23-34），改调 `sessionStatusOf`。

- [ ] **Step 4: 运行 e2e 确认通过**

Run: `cd packages/app && bun test:e2e --grep "首页任务中心"`
Expected: PASS

- [ ] **Step 5: 全量验证 + Commit**

Run: `cd packages/app && bun run typecheck` → 0 error；`bunx oxlint packages/app/src/pages/task-center.tsx packages/app/src/pages/layout/sidebar-tasks.tsx packages/app/e2e/layout.spec.ts` → 0 error；单测失败集合不扩大。

```bash
git add packages/app/src/pages/task-center.tsx packages/app/src/pages/layout/sidebar-tasks.tsx packages/app/src/i18n/ packages/app/e2e/layout.spec.ts
git commit -m "feat(task-center): search, five underline tabs, project grid and dashed starter row"
```

---

## Task 7: 会话标题去时间戳

**Files:**
- Modify: `packages/app/src/components/session/workspace-header.tsx`（若 Task 5 已改，则仅确认）
- Modify: `packages/app/src/pages/layout/sidebar-tasks.tsx`、`packages/app/src/pages/task-center.tsx`、`packages/app/src/pages/layout/sidebar-items.tsx`（标题显示位统一走 `displaySessionTitle`）
- Create: `packages/app/src/utils/session-title.ts`（若 Task 2 未建）

**Interfaces:**
- Consumes: `isDefaultSessionTitle`（Task 2）、`sessionTitle`（既有）、`language.t("workspace.header.untitled")`（`en.ts:1430` 已存在）。
- Produces: `displaySessionTitle(title: string | undefined, fallback: string): string` — 默认标题时返回 `fallback`，否则原样返回。

- [ ] **Step 1: 写失败测试**

```ts
test("displaySessionTitle falls back for default titles", () => {
  expect(displaySessionTitle("New session - 2026-09-16T06:15:21.718Z", "Untitled task")).toBe("Untitled task")
  expect(displaySessionTitle("重构支付回调逻辑", "Untitled task")).toBe("重构支付回调逻辑")
  expect(displaySessionTitle(undefined, "Untitled task")).toBe("Untitled task")
})
```

- [ ] **Step 2: 运行确认失败 → Step 3: 实现 → Step 4: 运行确认通过**

Run: `cd packages/app && bun test ./src/utils/session-title.test.ts`
Expected: 先 FAIL（导出缺失）后 PASS。

实现：`displaySessionTitle = (title, fallback) => (title && !isDefaultSessionTitle(title) ? title : fallback)`。四处调用点（workspace-header、sidebar-tasks 行标题、task-center 行标题、sidebar-items 的 `sessionTitle()` 调用 164/302）统一替换。

- [ ] **Step 5: 全量验证 + Commit**

Run: `cd packages/app && bun run typecheck` → 0 error；单测失败集合不扩大；`bunx oxlint` 改动文件 0 error。

```bash
git add packages/app/src/utils/session-title.ts packages/app/src/utils/session-title.test.ts packages/app/src/components/session/workspace-header.tsx packages/app/src/pages/layout/sidebar-tasks.tsx packages/app/src/pages/task-center.tsx packages/app/src/pages/layout/sidebar-items.tsx
git commit -m "fix(session): show friendly placeholder instead of timestamp default titles"
```

---

## Task 8: Titlebar 克制化

**Files:**
- Modify: `packages/app/src/components/titlebar.tsx`（左簇 193-297 重排；home 按钮 254-264 删除并把「回首页」并入 Logo；右簇 305-322）
- Modify: `packages/app/src/components/theme-scheme-toggle.tsx:8`（硬编码中文 → i18n）
- Modify: `packages/app/src/components/cache-usage-panel.tsx:50-58`（`min-w-[96px]` 文字触发器 → 纯图标触发器 + 保留 popover）
- Modify: `packages/app/src/components/memory-evolution-panel.tsx:212-220`（同上）
- Modify: `packages/app/src/i18n/en.ts`、`zh.ts`、`zht.ts`

**Interfaces:**
- Consumes: `ModeSwitchButton`（`mode-switch.tsx`，`aria-label={language.t("mode.switch.ariaLabel")}`）；`goModeHome`（`titlebar.tsx` 内，`navigate("/")`）；`layout.mode.hasSelected()`；`windowsControlsBaseWidth = 138`（`titlebar.tsx:45`）。
- Produces: 左簇 = `nav ‹› | Logo(点击=回首页) | 模式切换 | 搜索框`；右簇 = `缓存(图标) | 记忆进化(图标) | 主题 | 设置 | 数据库 | caption`。

**i18n 新增键**（3 文件）：`command.home.open`（打开首页 / Open home / 開啟首頁）、`theme.toggle.dark`（切换为深色模式 / Switch to dark mode / 切換為深色模式）、`theme.toggle.light`（切换为浅色模式 / Switch to light mode / 切換為淺色模式）。
**顺带移除**：`titlebar.tsx:254,259` 两处硬编码 `模式首页`（按钮删除后自然消失）。

- [ ] **Step 1: 写失败 e2e**

```ts
test("Titlebar 结构：Logo 与模式切换相邻，工具区纯图标", async ({ page }) => {
  await page.goto("/")
  // Logo 可点击回首页（不再需要单独的「模式首页」按钮）
  expect(await page.getByLabel("模式首页").count()).toBe(0)
  const left = page.locator('header').first()
  const mode = await left.getByLabel(/切换工作模式|Switch work mode/).first().boundingBox()
  const logo = await left.getByRole("link").first().boundingBox()
  expect(mode.x - logo.x).toBeLessThan(400)   // 模式切换在左侧簇，不再靠右
  // 右侧工具不再出现整段中文文字按钮
  const right = page.locator("#NovaWay-titlebar-right").first()
  expect(await right.getByRole("button").first().evaluate((el) => el.textContent?.trim().length ?? 0)).toBeLessThanOrEqual(1)
})
```

- [ ] **Step 2: 运行确认失败 → Step 3: 实现**

Run: `cd packages/app && bun test:e2e --grep "Titlebar 结构"`
Expected: FAIL（`模式首页` 计数 1；模式切换 x 远大于 400；右侧按钮含长文本）

实现：
1. **Logo 承担回首页**（原型 `<div class="logo" onclick="go('home')">`）：`titlebar.tsx:253` 的 `Mark` 包一层 `<button onClick={goModeHome} aria-label={language.t("command.home.open")} title={language.t("command.home.open")}>`；**删除** 254-264 整个 home `Button` + `Tooltip`。
2. **模式切换左移**：把 CENTER 簇（299-303）的 `ModeSwitchButton` 移到左簇 Logo 之后，`ml-1`；CENTER 簇留空或改为 spacer（保持 grid 三列结构不破）。
3. **右簇图标化**：`CacheUsagePanel` / `MemoryEvolutionPanel` 触发器改为 `IconButton`（图标分别沿用各自 popover 现有主图标；`min-w-[96px]` 与内联渐变整段删除），保留各自的 `DropdownMenu`/popover 内容不变；`ThemeSchemeToggle` 已经是图标，仅把 `titlebar.tsx` 里 `theme-scheme-toggle.tsx:8` 的三元硬编码改为 `language.t(isDark() ? "theme.toggle.dark" : "theme.toggle.light")`（同用于 `title`、`Tooltip value`、`aria-label` 三处）。
4. **顺序**：右簇 `缓存 | 记忆进化 | 主题 | 设置 | 数据库 | caption`；`Show when={settings.general.showDatabase()}` 条件保留。
5. 搜索框（`#NovaWay-titlebar-search`，295）**保留**（Global Constraints 记录的有意偏差），位置紧随模式切换。

- [ ] **Step 4: 运行 e2e 确认通过**

Run: `cd packages/app && bun test:e2e --grep "Titlebar 结构"`
Expected: PASS

- [ ] **Step 5: 全量验证 + Commit**

Run: `cd packages/app && bun run typecheck` → 0 error；单测失败集合不扩大；`bunx oxlint packages/app/src/components/titlebar.tsx packages/app/src/components/theme-scheme-toggle.tsx packages/app/src/components/cache-usage-panel.tsx packages/app/src/components/memory-evolution-panel.tsx packages/app/e2e/layout.spec.ts` → 0 error

```bash
git add packages/app/src/components/titlebar.tsx packages/app/src/components/theme-scheme-toggle.tsx packages/app/src/components/cache-usage-panel.tsx packages/app/src/components/memory-evolution-panel.tsx packages/app/src/i18n/ packages/app/e2e/layout.spec.ts
git commit -m "feat(titlebar): mode switch beside logo, icon-only utility cluster"
```

---

## Task 9: 死代码清理 + 触碰文件的硬编码中文收口

**Files:**
- Delete: `packages/app/src/pages/layout/sidebar-workspace.tsx`（0 引用）
- Delete: `packages/app/src/pages/layout/inline-editor.tsx`（0 引用）
- Modify: `packages/app/src/pages/layout/sidebar-items.tsx`（若 `NewSessionItem`/`SessionSkeleton` 删完上面两文件后 0 引用则一并删除；`SessionItem`、`ProjectIcon`、`getProjectAvatarSource` 仍活）
- Modify: `packages/app/src/context/layout.tsx`（删 `sidePanelWidth` memo，870-875，0 引用）
- Modify: `packages/app/src/components/dialog-confirm.tsx:45,59`、`components/dialog-usage-exceeded.tsx:29`、`components/dialog-settings.tsx:114,118`（**仅这几处**用户可见的硬编码中文 → i18n）
- Modify: `packages/app/src/i18n/en.ts`、`zh.ts`、`zht.ts`

**Interfaces:**
- Produces: 无新增公共接口；仅删除。`sidebar-items.tsx` 删除 `NewSessionItem`/`SessionSkeleton` 前必须 `rg -n "NewSessionItem|SessionSkeleton" packages/` 确认 0 命中。

- [ ] **Step 1: 确认 0 引用**

Run: `rg -n "sidebar-workspace|inline-editor|NewSessionItem|SessionSkeleton|sidePanelWidth" packages/ --glob '!**/node_modules/**'`
Expected: 仅这些文件自身命中；若有外部引用，停止并在报告里说明。

- [ ] **Step 2: 删除与抽取**

1. 删除两个死文件。
2. 删除 `sidebar-items.tsx` 中 0 引用的 `NewSessionItem`（476）与 `SessionSkeleton`（520），以及随之失效的 import。
3. 删除 `context/layout.tsx:870-875` 的 `sidePanelWidth` memo（含注释）。
4. 四处硬编码中文提取为 i18n 键：`common.cancel`、`common.confirm`（若 `common.rename/archive/delete/open/close/reset/edit` 已存在，确认 `cancel`/`confirm` 是否已在 `en.ts`；已存在则直接用，勿新建重复键）、`dialog.usageExceeded.doNotShow`、`settings.tabs.pet`、`settings.tabs.notifications`。

- [ ] **Step 3: 全量验证**

Run: `cd packages/app && bun run typecheck` → 0 error
Run: `cd packages/app && bun test --preload ./happydom.ts ./src` → 失败集合不扩大
Run: `cd packages/app && bun test ./src/i18n/parity.test.ts` → PASS
Run: `bunx oxlint packages/app/src/pages/layout/ packages/app/src/context/layout.tsx packages/app/src/components/dialog-confirm.tsx packages/app/src/components/dialog-settings.tsx packages/app/src/components/dialog-usage-exceeded.tsx` → 0 error

- [ ] **Step 4: Commit**

```bash
git add -u packages/app/src/pages/layout/sidebar-workspace.tsx packages/app/src/pages/layout/inline-editor.tsx packages/app/src/pages/layout/sidebar-items.tsx packages/app/src/context/layout.tsx packages/app/src/components/dialog-confirm.tsx packages/app/src/components/dialog-settings.tsx packages/app/src/components/dialog-usage-exceeded.tsx packages/app/src/i18n/
git commit -m "chore(app): remove dead sidebar files, sidePanelWidth and hardcode Chinese labels"
```

---

## Task 10: 全量验证与截图矩阵

**Files:**
- Modify: `packages/app/e2e/layout.spec.ts`（若前序任务漏断言则补齐）
- Modify: `packages/app/e2e/office.spec.ts`（若 Titlebar 结构改动导致 `切换工作模式` 选择器失效则修正）

**Interfaces:** 无。收尾任务，只跑验证。

- [ ] **Step 1: 全量静态与单测**

Run: `bun typecheck`（仓库根）→ 全部包 0 error
Run: `cd packages/app && bun test --preload ./happydom.ts ./src` → 598 pass / 6 fail / 1 error（失败集合逐项核对与基线一致）
Run: `cd packages/app && bun test ./src/i18n/parity.test.ts` → PASS
Run: `bunx oxlint packages/app/src/` → 0 error（若全仓 `bun lint` 因 `XYMT-AUTO/` 报错，以定向 oxlint 为准）

- [ ] **Step 2: e2e 全量**

Run: `cd packages/app && bun test:e2e`
Expected: 全部 pass（`todo.spec.ts` 为 `test.fixme()` 占位，允许 skip）；`office.spec.ts` 若因模式切换位置改动失败，按「先跑一次确认失败原因」再改选择器。

- [ ] **Step 3: 截图矩阵（人工核对）**

启动 dev（后端 4096 已在跑，不要动）：
```bash
bun dev:desktop          # 或 bun --cwd packages/app dev
```
用 CDP 脚本截图（`C:\Users\13428\AppData\Local\Temp\cdp-shot.mjs`，连 127.0.0.1:9222），逐屏与原型比对：
1. 首页（`/`）↔ 原型 `screen-home`：搜索框、5 个 underline tab、卡片任务行（状态点/分支/相对时间/±统计/待确认徽标）、虚线起始行、左对齐 40px。
2. 会话页四 frame ↔ 原型 `screen-session`：侧栏 segmented + 过滤 + 项目分组；单行 WorkspaceHeader；六 tab Side Pane；底部 Terminal frame。
3. 明/暗两态各截一次（`theme('dark')`/`('light')`），确认无 Aurora 残留、状态色语义正确。
4. 断点：`1600×1000`、`1280×800`（xl 以下侧栏抽屉）、`768×900`（md 以下 Side Pane/终端降级）。
5. 记录截图到 `C:\Users\13428\AppData\Local\Temp\` 并在报告里列出路径。

- [ ] **Step 4: 报告**

列出：每个任务的 commit SHA、e2e 通过数、单测数字、截图路径、以及所有有意偏差（标题栏搜索框保留、`WorkspaceHeader` 40px vs 原型 36px、`side()` min 240 vs 244）。提醒用户：`docs/superpowers/plans/*.md` 与本计划文档为 untracked，需一并 commit；是否推送由用户决定。

---

## 自查记录（Self-Review）

- **规格覆盖**：§3 四 frame + 4px 间隙 → Task 1；§3 Sidebar 280/min/max + Side Pane 360/60vw → Task 1（min 240）+ Task 4；§4 侧栏整列切换/两层项目→任务/状态点/分支/相对时间/±统计/待确认徽标/模式色条/文件树 → Task 2 + Task 3；§5 单行 WorkspaceHeader/六 tabs/终端双形态/正交开关 → Task 4 + Task 5（开关语义在 Plan B 已落地）；§7 Titlebar 与首页任务中心 → Task 6 + Task 8；§8 状态迁移（若删 store 字段）→ Task 3 的 `layout.page.v2` bump。
- **不覆盖项（已记录，不进本轮）**：Composer dock 化（规格 §5 未要求具体样式）、后端 per-session diff 聚合端点（规格 §8 跟进项）、后端自动标题生成（本次只做前端显示兜底）、悬浮桌宠/移动端抽屉机制（规格排除项）、Pulse/Office 结构（规格仅随 token 收敛）、全仓 2110 处硬编码中文（本轮只收 4 处 + 触碰文件）。
- **类型一致性**：`TaskStatus`（Task 2 定义）被 Task 3/5/6 共用；`sessionStatusOf` 签名在 Task 2 定义、Task 3 调用；`displaySessionTitle` 在 Task 7 定义、Task 5/7 调用——Task 5 若先于 Task 7 执行，须按 Task 2 的 `isDefaultSessionTitle` 直接实现，Task 7 再统一收口（两步等价，不冲突）。
- **Review Focus 落点**：1→Task 1 e2e 几何断言；2→Task 3 动作映射核对表（11 条）；3→Task 2 单一 `sessionStatusOf`；4→Task 2 `TaskRow.modeColor` + Task 3 调用 `projectMode`；5→Task 3 第 7 步显式保留 `layout.sidebar.opened()` 分支。
- **步骤可执行性**：每个 e2e 步骤都给了完整断言代码与「先跑确认失败」的步骤；每个 token/类名不确定处都给了 `rg` 确认指令而非猜测值。
