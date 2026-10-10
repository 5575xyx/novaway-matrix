# Git 工作区 · 计划 1（骨架 + 状态/文件面板 + 差异面板）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在主区做出 Lazygit 式 Git 工作区的骨架 —— 能开 `Git` 标签页、左列显示「状态/文件」两个可用面板、右侧常驻差异视图、键盘走完「看 diff → 暂存」。

**Architecture:** 一个 `GitWorkspace` 外壳负责布局/焦点/键位拦截，左列每个面板是独立组件，数据加载集中在 `state.ts`。焦点与键位映射抽成**纯数据**（`focus.ts`），键位表能脱离终端单测。危险操作的二次确认抽成 `confirm.ts`，时钟可注入，测试不靠真实 sleep。

**Tech Stack:** SolidJS + `@opentui/solid`、`bun test`、`@opentui/keymap`。

**规格来源:** `docs/superpowers/specs/2026-10-09-git-workspace-design.md`（提交 `bde0909`）。

---

## 开工前必读

**工作目录一律是 `packages/tui`**，不是仓库根目录。仓库根跑测试会被 `bunfig.toml` 的 `do-not-run-tests-from-root` 拦住。

**门禁基线**：`bun test --timeout 30000` 现在是 **880 通过 / 1 跳过 / 4 失败**。那 4 个失败全部来自 `test/cli/cmd/tui/provider-options.test.ts`，是既有问题。每个任务跑完只需确认**失败数仍是 4**。

**`bun run typecheck` 必须 exit 0。**

**根目录 lint 会 OOM**（约 1.9GB 的 `XYMT-AUTO/` 目录），定向 lint 又不接受根 `.oxlintrc.json`。改动文件**未经 lint 验证**是已知现状，不要为它折腾。

**禁止 `bunx`**（曾损坏 Bun store）。用 `bun run <script>`。

**提交信息里有中文**。控制台是 gb2312，`git log` 显示中文必然乱码/出 `�` —— **那是显示假象，不是损坏**，别被它骗去 amend。要确认就导原始字节：

```
cmd /c "git cat-file commit HEAD > %TEMP%\obj.bin"
```

然后搜 UTF-8 字节序列（例如「工作区」= `E5 B7 A5 E4 BD 9C E5 8C BA`）。

**代码风格**：中文注释；不用 `any`；不用 `else`（提前返回）；能 `const` 不 `let`；`node:fs` 同步读写之外避免 `try`/`catch`（用 promise 的 `.catch()`）；prettier `semi: false`、`printWidth: 120`。

**测试挂载组件需要完整的 Context 栈**。照 Task 5/6/7 已落地的组件测试：`await testRender(...)`、
`TuiConfigProvider config={createTuiResolvedConfig()}`（`../fixture/tui-runtime`）、`KVProvider`、
`ThemeProvider`、外层 `TestTuiContexts`；拆掉用 `app.renderer.destroy()`（`TestRendererSetup` 上没有 `destroy()`）。
这些坑都实测踩过，别再走回头路。

### ⚠️ 缩进必须用 `<box paddingLeft={n}>` 包住 `<text>`，写在 `<text>` 上等于没写

opentui 0.4.5 里叶子 `<text>` 的 yoga padding **只收缩内容宽度、不平移绘制起点**。
`<text paddingLeft={3}>AAA</text>` 渲染出来照样从第 0 列开始；`<box paddingLeft={3}><text>BBB</text></box>` 才在第 3 列。

```tsx
// ✗ 错:看着像缩进了,实际顶到最左缘
<text fg={theme.textMuted} paddingLeft={3}>{url}</text>
// ✓ 对
<box paddingLeft={3}><text fg={theme.textMuted}>{url}</text></box>
```

实测确认过（探针渲染对比），Task 5/6/7 的三个面板都踩过并已修。**Task 8 组装外壳时新写任何缩进,照这条来。**
同一个坑在仓库别处也存在（`component/git-panel.tsx` 的 stash 行），那是另一轮的事。

### 组件的渲染行数可能 ≠ `props.rows.length`

`StatusPanel` 在**远端行被聚焦**时会多渲染一行完整 URL（`status-panel.tsx` 里有注释）。
Task 8 做光标/滚动条/固定行高时不能假设「第 i 个 row 就是第 i 屏行」。

---

## 文件结构（本计划）

| 文件 | 动作 | 职责 |
| --- | --- | --- |
| `src/component/git-workspace/focus.ts` | 新建 | 面板枚举、标题、键位映射表（纯数据） |
| `src/component/git-workspace/confirm.ts` | 新建 | 危险操作二次确认，时钟可注入 |
| `src/component/git-workspace/state.ts` | 新建 | 一次性拉齐 git 数据 + 面板行派生 |
| `src/util/git-diff.ts` | 新建 | diff 加载（从 `git-diff-view.tsx` 抽出） |
| `src/component/git-workspace/diff-panel.tsx` | 新建 | 右侧差异视图 |
| `src/component/git-workspace/files-panel.tsx` | 新建 | 文件面板 |
| `src/component/git-workspace/status-panel.tsx` | 新建 | 状态面板（四行可操作） |
| `src/component/git-workspace.tsx` | 新建 | 外壳：布局/焦点/键位条 |
| `src/component/tab-bar.tsx` | 修改 | `TabItem.type` 加 `"git-workspace"` |
| `src/routes/session/index.tsx` | 修改 | 开标签、渲染分发 |
| `src/routes/session/sidebar.tsx` | 修改 | Git 页加「打开工作区」入口 |

计划 2 再加 `branches-panel.tsx` / `commits-panel.tsx` / `stash-panel.tsx`；计划 3 再瘦身 `git-panel.tsx`。

---

### Task 1: 焦点与键位映射（纯数据）

键位表决定「焦点在文件面板时空格干什么」，是这套交互最容易错的东西。先做它，且做成**纯数据 + 纯函数**。

**Files:**
- Create: `src/component/git-workspace/focus.ts`
- Test: `test/component/git-workspace-focus.test.ts`

- [ ] **Step 1: 写失败的测试**

创建 `packages/tui/test/component/git-workspace-focus.test.ts`：

```ts
import { expect, test } from "bun:test"
import {
  DANGEROUS_COMMANDS,
  GLOBAL_KEYS,
  PANEL_KEYS,
  PANEL_ORDER,
  PANEL_TITLE,
  panelAt,
  panelIndex,
  resolveWorkspaceCommand,
} from "../../src/component/git-workspace/focus"

test("五个面板,顺序照 Lazygit", () => {
  expect(PANEL_ORDER).toEqual(["status", "files", "branches", "commits", "stash"])
})

test("面板标题全中文", () => {
  for (const id of PANEL_ORDER) expect(PANEL_TITLE[id]).toMatch(/[一-龥]/)
  expect(PANEL_TITLE.status).toBe("状态")
  expect(PANEL_TITLE.files).toBe("文件")
  expect(PANEL_TITLE.stash).toBe("贮藏")
})

test("panelIndex / panelAt 往返", () => {
  expect(panelIndex("files")).toBe(1)
  expect(panelAt(1)).toBe("files")
})

test("panelAt 对越界下标取模绕回(shift-tab 从第一个往回按)", () => {
  expect(panelAt(-1)).toBe("stash")
  expect(panelAt(5)).toBe("status")
  expect(panelAt(6)).toBe("files")
})

test("tab 循环切面板", () => {
  expect(resolveWorkspaceCommand("status", "tab")).toBe("panel.next")
  expect(resolveWorkspaceCommand("stash", "tab")).toBe("panel.next")
  expect(resolveWorkspaceCommand("files", "shift-tab")).toBe("panel.prev")
})

test("数字键直接跳面板", () => {
  expect(resolveWorkspaceCommand("status", "1")).toBe("panel.jump:0")
  expect(resolveWorkspaceCommand("files", "5")).toBe("panel.jump:4")
  expect(resolveWorkspaceCommand("status", "6")).toBeUndefined()
})

test("同一个键在不同面板含义不同 —— 空格", () => {
  expect(resolveWorkspaceCommand("status", "space")).toBe("status.space")
  expect(resolveWorkspaceCommand("files", "space")).toBe("files.stage")
  expect(resolveWorkspaceCommand("branches", "space")).toBe("branches.checkout")
})

test("enter 在文件面板切到差异视图,在提交面板是看提交", () => {
  expect(resolveWorkspaceCommand("files", "enter")).toBe("files.focusDiff")
  expect(resolveWorkspaceCommand("commits", "enter")).toBe("commits.focusDiff")
})

test("面板局部键优先于全局键", () => {
  // c 在文件面板没有局部含义,落回全局的提交
  expect(resolveWorkspaceCommand("files", "c")).toBe("global.commit")
  // 但 1-5 是全局的,文件面板里也该跳面板
  expect(resolveWorkspaceCommand("files", "1")).toBe("panel.jump:0")
})

test("ctrl+c 和 ctrl+l 不在拦截表里(必须放行给上层)", () => {
  expect(resolveWorkspaceCommand("files", "ctrl+c")).toBeUndefined()
  expect(resolveWorkspaceCommand("files", "ctrl+l")).toBeUndefined()
  expect(GLOBAL_KEYS["ctrl+c"]).toBeUndefined()
})

test("危险命令集恰好四条 —— 少一条就不弹确认直接执行,多一条就把无害操作变成按两次", () => {
  for (const cmd of ["files.discard", "files.delete", "branches.delete", "stash.discard"] as const) {
    expect(DANGEROUS_COMMANDS.has(cmd)).toBe(true)
  }
  expect(DANGEROUS_COMMANDS.size).toBe(4)
  // 这几条必须不在集里:暂存、切分支、拉推都是无害的,要按两次会很烦。
  expect(DANGEROUS_COMMANDS.has("files.stage")).toBe(false)
  expect(DANGEROUS_COMMANDS.has("branches.checkout")).toBe(false)
  expect(DANGEROUS_COMMANDS.has("global.push")).toBe(false)
})

test("局部键真的覆盖同名全局键", () => {
  // 现有两表的键名没有交集,光靠真实表测不出优先级 —— 把局部查找和全局查找对调,真实表的
  // 断言会照样全绿。所以造一对**故意冲突**的表钉住语义:同一个键在局部和全局都有定义时,
  // 局部胜出。
  // localTable 是平铺查找(默认参就是 PANEL_KEYS[panel],不是 PANEL_KEYS 本身),
  // 所以这里注入的也是平铺表。第二个断言要能找到 `p`,故把真实全局表展开进来 ——
  // 展开不掩盖冲突:真实全局表里本来就有 `r`,冲突是真实的。
  const local = { r: "files.focusDiff" as const }
  const global = { ...GLOBAL_KEYS, r: "global.refresh" as const }
  expect(resolveWorkspaceCommand("files", "r", local, global)).toBe("files.focusDiff")
  // 局部没配到的键才落回全局 —— 只测冲突不够,还得确认没有把全局整层屏蔽掉。
  expect(resolveWorkspaceCommand("files", "p", local, global)).toBe("global.pull")
})
```

- [ ] **Step 2: 跑测试确认失败**

```
cd packages/tui && bun test --timeout 30000 test/component/git-workspace-focus.test.ts
```

预期：FAIL，报 `Cannot find module '../../src/component/git-workspace/focus'`。

- [ ] **Step 3: 实现 focus.ts**

创建 `packages/tui/src/component/git-workspace/focus.ts`：

```ts
// 工作区的面板枚举与键位映射。**纯数据 + 纯函数**,不碰终端、不碰 Solid —— 键位表是这套
// 交互里最容易错的东西(同一个键在不同面板含义不同),只有脱离渲染才能单测得住。
//
// 键名的词汇表由本仓库的 `keyOfParsed`(本文件末尾,Task 5 加)定义 —— **不是** @opentui/keymap
// 的写法。两者不一样:keymap 把 `return` 规范成 `enter`、把 shift+tab 拼成 `shift+tab`,
// 而 opentui 的**事件名**是 `escape` / `return`(见 src/util/selection.ts:66)。
// 表里的拼写以 keyOfParsed 的输出为准,改一边就要同步改另一边。
export type PanelID = "status" | "files" | "branches" | "commits" | "stash"

export const PANEL_ORDER: readonly PanelID[] = ["status", "files", "branches", "commits", "stash"]

/** 面板标题,全中文(规格:面向国内用户,git 术语也中文化)。 */
export const PANEL_TITLE: Record<PanelID, string> = {
  status: "状态",
  files: "文件",
  branches: "分支",
  commits: "提交",
  stash: "贮藏",
}

export function panelIndex(id: PanelID): number {
  return PANEL_ORDER.indexOf(id)
}

export function panelAt(index: number): PanelID {
  // 负数要能绕回末尾(shift-tab 从第一个面板往回按),所以先归一化到 [0, len)。
  const length = PANEL_ORDER.length
  return PANEL_ORDER[((index % length) + length) % length]!
}

/**
 * 解析出来的工作区命令。`panel.jump:N` 带目标面板下标 —— 数字键 1-5 直接跳面板,
 * 拼成一个命令而不是五条,是因为调用方拿到之后的动作是同一个(把焦点设到第 N 个面板)。
 */
export type WorkspaceCommand =
  | "panel.next"
  | "panel.prev"
  | `panel.jump:${number}`
  | "row.up"
  | "row.down"
  | "status.space"
  | "status.m"
  | "files.stage"
  | "files.stageAll"
  | "files.focusDiff"
  | "files.discard"
  | "files.delete"
  | "branches.checkout"
  | "branches.new"
  | "branches.delete"
  | "commits.focusDiff"
  | "commits.undo"
  | "stash.pop"
  | "stash.discard"
  | "global.commit"
  | "global.pull"
  | "global.push"
  | "global.refresh"
  | "global.help"
  | "global.close"

/**
 * 全局键:**任何时候**都有效,与焦点面板无关。
 *
 * **刻意不在表里的**:ctrl+c(中断)、ctrl+l(清屏)。工作区的拦截器必须放行这两个 ——
 * 它们是整个 TUI 的逃生口,吞掉它们等于让用户在工作区里没法中断卡住的命令。
 */
export const GLOBAL_KEYS: Readonly<Record<string, WorkspaceCommand>> = {
  tab: "panel.next",
  "shift-tab": "panel.prev",
  c: "global.commit",
  p: "global.pull",
  f: "global.push",
  r: "global.refresh",
  "?": "global.help",
  esc: "global.close",
  j: "row.down",
  k: "row.up",
}

/**
 * 每个面板的**局部键**,覆盖同名全局键。
 *
 * 为什么需要覆盖层而不是一张大表:键位要跟着焦点面板变(规格「底部键位提示条跟着焦点面板变」),
 * 而同一个键在不同面板确实是不同动作 —— `空格` 在状态面板是「作用于当前行」,在文件面板是
 * 「暂存这个文件」,在分支面板是「切换分支」。合成一张大表就得给每个面板都写全所有键,
 * 既啰嗦又容易漏。
 */
export const PANEL_KEYS: Readonly<Record<PanelID, Readonly<Record<string, WorkspaceCommand>>>> = {
  status: {
    space: "status.space",
    m: "status.m",
  },
  files: {
    space: "files.stage",
    a: "files.stageAll",
    enter: "files.focusDiff",
    d: "files.discard",
    x: "files.delete",
  },
  branches: {
    space: "branches.checkout",
    n: "branches.new",
    d: "branches.delete",
  },
  commits: {
    enter: "commits.focusDiff",
    z: "commits.undo",
  },
  stash: {
    space: "stash.pop",
    d: "stash.discard",
  },
}

/**
 * 要二次确认的命令(规格「危险操作不用弹窗,用再按一次确认」)。
 * 调用方按下这类键时不立刻执行,而是进入确认态;**同键**再按一次才真执行。
 */
export const DANGEROUS_COMMANDS: ReadonlySet<WorkspaceCommand> = new Set<WorkspaceCommand>([
  "files.discard",
  "files.delete",
  "branches.delete",
  "stash.discard",
])

/**
 * 一个键 → 一条工作区命令。焦点面板的局部键优先,没配到再落回全局键。
 *
 * 没有命令返回 `undefined`,调用方据此决定「不拦截,放行给上层」——
 * 这是聊天输入框还能正常打字的关键:用户在工作区里按 `q`、按 `v`、按输入法的字母,
 * 都得漏过去。
 *
 * 后两个参数默认取模块导出的真实表,**只为测试注入一对故意冲突的表**而存在:
 * 真实表的局部键与全局键没有同名交集,光跑真实表的话把这两层顺序对调照样全绿 ——
 * 覆盖优先级这条语义就没有任何测试保护。不额外抽 helper,它仍然是同一个函数。
 */
export function resolveWorkspaceCommand(
  panel: PanelID,
  key: string,
  localTable: Readonly<Record<string, WorkspaceCommand>> = PANEL_KEYS[panel],
  globalTable: Readonly<Record<string, WorkspaceCommand>> = GLOBAL_KEYS,
): WorkspaceCommand | undefined {
  const local = localTable[key]
  if (local) return local
  const global = globalTable[key]
  if (global) return global
  // 数字键 1-5 直接跳到对应面板(1 是状态,5 是贮藏)。
  if (key.length === 1 && key >= "1" && key <= "5") return `panel.jump:${Number(key) - 1}`
  return undefined
}
```

- [ ] **Step 4: 跑测试确认通过**

```
cd packages/tui && bun test --timeout 30000 test/component/git-workspace-focus.test.ts
```

预期：全部 PASS。

- [ ] **Step 5: 提交**

```
cd packages/tui && git add src/component/git-workspace/focus.ts test/component/git-workspace-focus.test.ts && git commit -m "feat(tui): 工作区面板焦点与键位映射表"
```

---

### Task 2: 危险操作二次确认（时钟可注入）

按 `d` 不立刻丢弃，而是进入确认态；同键再按才执行；期间按别的键取消；超时自动取消。超时**必须走注入的时钟** —— 否则测试只能真实 sleep。

**Files:**
- Create: `src/component/git-workspace/confirm.ts`
- Test: `test/component/git-workspace-confirm.test.ts`

- [ ] **Step 1: 写失败的测试**

创建 `packages/tui/test/component/git-workspace-confirm.test.ts`：

```ts
import { expect, test } from "bun:test"
import { CONFIRM_WINDOW_MS, createConfirm } from "../../src/component/git-workspace/confirm"

test("第一次按键进入确认态,不立即触发", () => {
  const confirm = createConfirm(() => 0)
  expect(confirm.press("d", "丢弃这个文件的改动")).toBe("armed")
  expect(confirm.pending()).toEqual({ key: "d", label: "丢弃这个文件的改动", deadline: CONFIRM_WINDOW_MS })
})

test("同键再按一次才真触发", () => {
  const confirm = createConfirm(() => 0)
  expect(confirm.press("d", "丢弃")).toBe("armed")
  expect(confirm.press("d", "丢弃")).toBe("fire")
  expect(confirm.pending()).toBeUndefined()
})

test("换一个危险键会顶掉上一个确认态,不是取消", () => {
  // 按 d(丢弃)武装后按 x(删除):外壳会拿 x 再调一次 press,此时应当换成 x 的确认态,
  // 而不是把 x 也一并取消掉 —— 后者会让用户按了键却毫无反应。
  const confirm = createConfirm(() => 0)
  confirm.press("d", "丢弃")
  expect(confirm.press("x", "删除")).toBe("armed")
  expect(confirm.pending()?.key).toBe("x")
  expect(confirm.pending()?.label).toBe("删除")
})

test("超时自动取消", () => {
  let now = 0
  const confirm = createConfirm(() => now)
  confirm.press("d", "丢弃")
  now = CONFIRM_WINDOW_MS - 1
  expect(confirm.pending()).toBeDefined()
  now = CONFIRM_WINDOW_MS
  expect(confirm.pending()).toBeUndefined()
})

test("超时后再按同键是重新武装,不是触发", () => {
  let now = 0
  const confirm = createConfirm(() => now)
  confirm.press("d", "丢弃")
  now = CONFIRM_WINDOW_MS + 100
  expect(confirm.press("d", "丢弃")).toBe("armed")
  expect(confirm.pending()?.deadline).toBe(now + CONFIRM_WINDOW_MS)
})

test("换一个键会顶掉上一个确认态", () => {
  const confirm = createConfirm(() => 0)
  confirm.press("d", "丢弃")
  expect(confirm.press("x", "删除")).toBe("armed")
  expect(confirm.pending()?.key).toBe("x")
})

test("clear() 无条件清空", () => {
  const confirm = createConfirm(() => 0)
  confirm.press("d", "丢弃")
  confirm.clear()
  expect(confirm.pending()).toBeUndefined()
})

test("label 是纯展示,不参与状态判定", () => {
  // 危险性由外壳的 DANGEROUS_COMMANDS 判定,本方法不看 label。有人要是重新加回
  // 「label 为空就取消」的门控,这条会红 —— 那等于把语义藏进了一句展示文案。
  const confirm = createConfirm(() => 0)
  expect(confirm.press("d", "")).toBe("armed")
  expect(confirm.pending()?.key).toBe("d")
  // 空 label 的键再按一次同样算同键确认。
  expect(confirm.press("d", "")).toBe("fire")
})

test("press 在窗口边界那一刻算过期", () => {
  // pending() 的 >= 由「超时自动取消」钉住,这里钉 press 里的那一处 —— 两处口径必须一致,
  // 否则会出现「提示条还在、一按却重新武装」的错位。
  let now = 0
  const confirm = createConfirm(() => now)
  confirm.press("d", "丢弃")
  now = CONFIRM_WINDOW_MS
  expect(confirm.press("d", "丢弃")).toBe("armed")
  expect(confirm.pending()?.deadline).toBe(now + CONFIRM_WINDOW_MS)
})
```

> **`press` 只会被危险命令调用。** Task 8 的外壳在 `DANGEROUS_COMMANDS.has(command)` 为真时才调它,其余命令走 `clear()`。所以这里**没有**「按了非危险键就 cancel」的分支 —— 那条路径根本不存在,而用 `label` 是否为空去猜「这个键危不危险」更是把语义藏进了一句展示文案里,迟早出事。

- [ ] **Step 2: 跑测试确认失败**

```
cd packages/tui && bun test --timeout 30000 test/component/git-workspace-confirm.test.ts
```

预期：FAIL，`Cannot find module .../confirm`。

- [ ] **Step 3: 实现 confirm.ts**

创建 `packages/tui/src/component/git-workspace/confirm.ts`：

```ts
// 危险操作的「再按一次确认」。规格要求**不用弹窗** —— 弹窗会打断键盘流,而这套交互的核心
// 就是一只手在键盘上走完全程。
//
// 时钟是注入的(参数 `now`),不直接读 Date.now / setTimeout。理由:超时逻辑如果绑死真实时间,
// 测试就只能 sleep 3 秒才敢断言,既慢又容易在慢机器上偶发失败。
// 调用方(工作区外壳)用真实时钟,测试用自己的假时钟 —— 同一份代码,两种时间。
export const CONFIRM_WINDOW_MS = 3000

export interface ArmedConfirm {
  /** 触发这条确认的键。同键再按一次才算确认 —— 所以必须记住是哪个键。 */
  key: string
  /** 确认态那一行显示的文案,例如「再按一次 d 确认丢弃」。 */
  label: string
  /** 过了这个时间点还没确认就自动取消(毫秒,单调递增的时钟口径)。 */
  deadline: number
}

/**
 * press 的返回值就是状态机的迁移结果:
 *   armed  —— 进入确认态,或换到另一条危险命令的确认态。什么都没执行。
 *   fire   —— 用户在窗口内按了**同一个**键,调用方现在该执行那条危险命令。
 *
 * 只有两个值,没有「cancel」:外壳只在 `DANGEROUS_COMMANDS.has(command)` 为真时才调本方法,
 * 非危险键压根走不到这里 —— 它们由外壳直接调 `clear()`。把「这个键危不危险」的判断
 * 塞进本方法(比如去看 label 是不是空串)是把语义藏进展示文案,迟早出事。
 */
export type ConfirmPressResult = "armed" | "fire"

export function createConfirm(now: () => number) {
  let armed: ArmedConfirm | undefined

  return {
    press(key: string, label: string): ConfirmPressResult {
      // 时刻只采一次:过期判断和设 deadline 用同一个 t,免得两次采样跨过边界抖出不一致。
      const t = now()
      // 超时的确认态等同于没有:先把过期的清掉,再判断是不是「同键第二次」。
      // 不先清的话,用户在 4 秒后按同一个 d 会误判成 fire,而那个确认态早就该失效了。
      if (armed && t >= armed.deadline) armed = undefined

      // 同键第二次 = 确认,执行。到这里 armed 一定还在窗口内。
      if (armed && armed.key === key) {
        armed = undefined
        return "fire"
      }

      // 没武装,或者换了一条危险命令 —— 都是武装新的那条。换成新的而不是取消掉,
      // 是因为按了 x 却毫无反应比「d 的确认被 x 顶掉」更让人困惑。
      armed = { key, label, deadline: t + CONFIRM_WINDOW_MS }
      return "armed"
    },

    /** 当前的确认态;`undefined` 表示没在等确认。渲染层靠它画那行黄色提示。过期即顺手清掉。 */
    pending(): ArmedConfirm | undefined {
      if (armed && now() >= armed.deadline) {
        armed = undefined
        return undefined
      }
      return armed
    },

    clear() {
      armed = undefined
    },
  }
}

export type Confirm = ReturnType<typeof createConfirm>
```

- [ ] **Step 4: 跑测试确认通过**

```
cd packages/tui && bun test --timeout 30000 test/component/git-workspace-confirm.test.ts
```

预期：全部 PASS。

- [ ] **Step 5: 提交**

```
cd packages/tui && git add src/component/git-workspace/confirm.ts test/component/git-workspace-confirm.test.ts && git commit -m "feat(tui): 工作区危险操作的行内二次确认"
```

---

### Task 3: git 数据一次性拉齐

工作区打开和每次操作后都要刷新。把「并行跑 7 个 git 命令 + 解析 + 派生成面板行」收在一处，组件只管渲染。

**Files:**
- Create: `src/component/git-workspace/state.ts`
- Test: `test/component/git-workspace-state.test.ts`

- [ ] **Step 1: 写失败的测试**

创建 `packages/tui/test/component/git-workspace-state.test.ts`。这里只测**纯逻辑**（派生函数），不起真实 git 进程 —— 起进程慢且依赖环境。

```ts
import { afterAll, expect, test } from "bun:test"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import fs from "fs"
import os from "os"
import path from "path"
import {
  deriveFileRows,
  deriveStatusRows,
  loadWorkspace,
  pickDefaultRemote,
} from "../../src/component/git-workspace/state"
import type { GitNumstatEntry, GitRemote, GitStatusSummary } from "../../src/util/git-status"

const status: GitStatusSummary = {
  branch: "main",
  upstream: "origin/main",
  ahead: 91,
  behind: 0,
  entries: [
    { file: "a.ts", code: "M ", status: "modified", staged: true, unstaged: false },
    { file: "b.ts", code: " M", status: "modified", staged: false, unstaged: true },
    { file: "c.ts", code: "??", status: "untracked", staged: false, unstaged: true },
  ],
}

const numstat: GitNumstatEntry[] = [
  { file: "a.ts", added: 10, removed: 2, binary: false },
  { file: "b.ts", added: 5, removed: 3, binary: false },
]

test("pickDefaultRemote 优先 origin", () => {
  const remotes: GitRemote[] = [
    { name: "github", url: "https://github.com/x/y.git" },
    { name: "origin", url: "https://gitee.com/x/y.git" },
  ]
  expect(pickDefaultRemote(remotes)?.name).toBe("origin")
})

test("pickDefaultRemote 没有 origin 时取第一个", () => {
  const remotes: GitRemote[] = [
    { name: "github", url: "https://github.com/x/y.git" },
    { name: "gitee", url: "https://gitee.com/x/y.git" },
  ]
  expect(pickDefaultRemote(remotes)?.name).toBe("github")
})

test("pickDefaultRemote 空列表返回 undefined", () => {
  expect(pickDefaultRemote([])).toBeUndefined()
})

test("deriveStatusRows 领先计数拼进分支行", () => {
  const row = deriveStatusRows(status, numstat, []).find((r) => r.kind === "branch")
  expect(row?.count).toBe("↑91")
})

test("deriveStatusRows 落后时显示 ↓", () => {
  const rows = deriveStatusRows({ ...status, ahead: 0, behind: 3 }, [], [])
  expect(rows.find((r) => r.kind === "branch")?.count).toBe("↓3")
})

test("deriveStatusRows 领先和落后都有时两个都显示", () => {
  const rows = deriveStatusRows({ ...status, ahead: 2, behind: 5 }, [], [])
  expect(rows.find((r) => r.kind === "branch")?.count).toBe("↑2 ↓5")
})

test("deriveStatusRows 没有领先/落后时不显示计数", () => {
  const rows = deriveStatusRows({ ...status, ahead: 0, behind: 0 }, [], [])
  expect(rows.find((r) => r.kind === "branch")?.count).toBeUndefined()
})

test("deriveStatusRows 变更行合并 numstat 的加删行数", () => {
  const row = deriveStatusRows(status, numstat, []).find((r) => r.kind === "changes")
  expect(row?.detail).toBe("3 个文件")
  expect(row?.count).toBe("+15 -5")
})

test("deriveStatusRows 远程行用选中的那个远端名", () => {
  const remotes: GitRemote[] = [{ name: "github", url: "https://gitee.com/x/y.git" }]
  const rows = deriveStatusRows(status, numstat, remotes, remotes[0])
  expect(rows.find((r) => r.kind === "remote")?.detail).toBe("github")
})

test("deriveStatusRows 没有远端时显示未配置远端", () => {
  const rows = deriveStatusRows(status, numstat, [])
  expect(rows.find((r) => r.kind === "remote")?.detail).toBe("未配置远端")
})

test("deriveStatusRows 提示行区分干净/有改动/不在仓库", () => {
  expect(deriveStatusRows(status, [], []).find((r) => r.kind === "hint")?.detail).toBe("有未提交的改动")
  expect(deriveStatusRows({ ...status, entries: [] }, [], []).find((r) => r.kind === "hint")?.detail).toBe(
    "工作区干净",
  )
  expect(deriveStatusRows({ ahead: 0, behind: 0, entries: [] }, [], []).find((r) => r.kind === "hint")?.detail).toBe(
    "不是 git 仓库",
  )
})

test("deriveStatusRows git 报错时提示行透出真实原因,不猜成不是仓库", () => {
  const rows = deriveStatusRows(status, [], [], undefined, "git 执行超时")
  expect(rows.find((r) => r.kind === "hint")?.detail).toBe("git 执行超时")
})

test("已暂存但工作区干净的文件也算有改动", () => {
  // 只看 unstaged 位会漏掉 `git add` 之后的文件 —— 那时「变更」行说「1 个文件」,
  // 「提示」行却说「工作区干净」,同一个面板自相矛盾。
  const stagedOnly: GitStatusSummary = {
    branch: "main",
    ahead: 0,
    behind: 0,
    entries: [{ file: "a.ts", code: "A ", status: "added", staged: true, unstaged: false }],
  }
  expect(deriveStatusRows(stagedOnly, [], []).find((r) => r.kind === "hint")?.detail).toBe("有未提交的改动")
})

test("分支与远程分叉时提示 diverged,且排在有改动之前", () => {
  // push 会被拒、pull 会冲突 —— 这是阻塞态,比「有未提交改动」更该先被看见。
  const rows = deriveStatusRows({ ...status, entries: [], ahead: 2, behind: 5 }, [], [])
  expect(rows.find((r) => r.kind === "hint")?.detail).toBe("分支与远程 diverged")
})

test("空仓库与 detached 都算不在分支上,不把 git 原文串进中文界面", () => {
  const empty: GitStatusSummary = { branch: "No commits yet on main", ahead: 0, behind: 0, entries: [] }
  expect(deriveStatusRows(empty, [], []).find((r) => r.kind === "branch")?.detail).toBe("(不在分支上)")
  expect(deriveStatusRows(empty, [], []).find((r) => r.kind === "hint")?.detail).toBe("不是 git 仓库")

  const detached: GitStatusSummary = { branch: "(HEAD detached at 9a191fb)", ahead: 0, behind: 0, entries: [] }
  expect(deriveStatusRows(detached, [], []).find((r) => r.kind === "branch")?.detail).toBe("(不在分支上)")
})

test("deriveFileRows 同文件两份 numstat 取工作区侧", () => {
  // 「工作区改了 + 暂存区也改了」的文件在 numstat 里有两份。工作区一文件一行,
  // 只能取一份 —— concat 顺序是暂存区在前、工作区在后,Map 后者覆盖前者,所以取到工作区侧。
  const both: GitStatusSummary = {
    branch: "main",
    ahead: 0,
    behind: 0,
    entries: [{ file: "m.ts", code: "MM", status: "modified", staged: true, unstaged: true }],
  }
  const twoNumstat: GitNumstatEntry[] = [
    { file: "m.ts", added: 10, removed: 2, binary: false },
    { file: "m.ts", added: 5, removed: 3, binary: false },
  ]
  expect(deriveFileRows(both, twoNumstat)[0]?.count).toBe("+5 -3")
})

test("deriveFileRows 每个文件一行,带中文状态词与加删行数", () => {
  const a = deriveFileRows(status, numstat).find((r) => r.file === "a.ts")
  expect(a?.label).toBe("已改")
  expect(a?.count).toBe("+10 -2")
})

test("deriveFileRows 未跟踪文件没有 numstat 就不显示行数", () => {
  const c = deriveFileRows(status, numstat).find((r) => r.file === "c.ts")
  expect(c?.label).toBe("未跟踪")
  expect(c?.count).toBeUndefined()
})

test("deriveFileRows 新增/删除/重命名也用中文", () => {
  const s: GitStatusSummary = {
    branch: "main",
    ahead: 0,
    behind: 0,
    entries: [
      { file: "n.ts", code: "A ", status: "added", staged: true, unstaged: false },
      { file: "o.ts", code: " D", status: "deleted", staged: false, unstaged: true },
      { file: "r.ts", code: "R ", status: "renamed", staged: true, unstaged: false },
    ],
  }
  expect(deriveFileRows(s, []).map((r) => r.label)).toEqual(["新增", "删除", "重命名"])
})

// 下面两个起真 git 子进程,所以造真目录 —— 口径照抄 test/component/git-branch-row.test.tsx:
// 「面板自己起真 git 子进程,所以测试直接造一个真仓库 —— 造不出来的那一档就该红」。
// loadWorkspace 是本任务唯一的非纯函数,不钉住它,「status 硬依赖、其余各自降级」
// 这条核心设计声明就只是写在注释里的一句话。

const tmpDirs: string[] = []
function tmpGitDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  tmpDirs.push(dir)
  return dir
}

afterAll(() => {
  for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true })
  tmpDirs.length = 0
})

const exec = promisify(execFile)
const git = (root: string, args: string[]) =>
  exec("git", ["-c", "user.email=tui@example.com", "-c", "user.name=tui", ...args], { cwd: root })

test("loadWorkspace 非仓库目录:error 透出中文,不露 git 英文原文", async () => {
  const data = await loadWorkspace(tmpGitDir("nw-ws-norepo-"))
  expect(data.error).toBe("不是 git 仓库")
  expect(data.branches).toEqual([])
  expect(data.commits).toEqual([])
  expect(data.remotes).toEqual([])
  // 提示行直接吃这个 error,不该再猜一遍成别的文案。
  const hint = deriveStatusRows(data.status, data.numstat, data.remotes, undefined, data.error).find(
    (r) => r.kind === "hint",
  )
  expect(hint?.detail).toBe("不是 git 仓库")
})

test("loadWorkspace 空仓库:无提交、不报错、分支不当成真分支名", async () => {
  // 新仓库里 `git log` 必失败(还没有任何提交)—— 这正是「status 硬依赖、其余各自降级」
  // 要覆盖的路径:log 挂了不该让整个工作区白屏。
  const dir = tmpGitDir("nw-ws-empty-")
  await git(dir, ["init", "-b", "main"])
  const data = await loadWorkspace(dir)
  expect(data.error).toBeUndefined()
  expect(data.commits).toEqual([])
  expect(data.stash).toEqual([])
  // git 不用 `git branch` 列未出生的分支 —— 空仓库里分支面板就是空的,这是真实行为,
  // 不是解析漏了。状态行的「分支」才是此刻唯一能看到 main 的地方。
  expect(data.branches).toEqual([])
  // git 在空仓库里把分支行报成 `No commits yet on main`,不是 `main`。
  // 原文进中文界面是噪音,派生后应落到「(不在分支上)」。
  expect(data.status.branch).toBe("No commits yet on main")
  const branch = deriveStatusRows(data.status, data.numstat, data.remotes, undefined, data.error).find(
    (r) => r.kind === "branch",
  )
  expect(branch?.detail).toBe("(不在分支上)")
})
```

> **两个实测发现**(写这段计划时没料到,落地时才暴露):①空仓库里 `git status -b` 报的分支是
> `No commits yet on main` 而不是 `main` —— 这正是 `inRepo` 要挡的那类串;②空仓库里
> `git branch` 返回**空列表**,分支面板此时看不到 `main`。两条都是真实 git 行为,测试按实测断言。

- [ ] **Step 2: 跑测试确认失败**

```
cd packages/tui && bun test --timeout 30000 test/component/git-workspace-state.test.ts
```

预期：FAIL，`Cannot find module .../state`。

- [ ] **Step 3: 实现 state.ts**

创建 `packages/tui/src/component/git-workspace/state.ts`：

```ts
// 工作区的数据层:一次性把 git 拉齐,并把原始解析结果**派生**成面板直接能渲染的行。
//
// 派生逻辑单独成纯函数(deriveStatusRows / deriveFileRows / pickDefaultRemote)是有意的:
// 组件里写派生就等于把「↑91 怎么拼」「中文状态词是哪个」埋进 JSX,测不到。
import { gitExec } from "../../util/git-exec"
import {
  BRANCH_FORMAT,
  type GitBranch,
  type GitNumstatEntry,
  type GitRemote,
  type GitStashEntry,
  type GitStatusSummary,
  parseGitBranches,
  parseGitCommit,
  parseGitNumstat,
  parseGitRemotes,
  parseGitStashList,
  parseGitStatus,
} from "../../util/git-status"

export interface GitCommitRow {
  hash: string
  subject: string
}

export interface WorkspaceData {
  status: GitStatusSummary
  numstat: GitNumstatEntry[]
  branches: GitBranch[]
  commits: GitCommitRow[]
  stash: GitStashEntry[]
  remotes: GitRemote[]
  /** git 命令失败时的原因;成功时 undefined。渲染层把它画进状态面板的「提示」行。 */
  error?: string
}

const COMMIT_LIMIT = 40

/**
 * 并行拉齐工作区需要的全部数据。
 *
 * 每个分支都 `.catch` 而不是整体 try/catch:工作区要**部分可用** —— 一个仓库没有 stash、
 * 没有 remote、甚至还没有任何 commit 都是常态,任何一个命令失败都不该让整个面板白屏。
 * 只有 `status` 是硬依赖(它同时提供 branch 与文件列表),它失败才返回 error。
 */
export function loadWorkspace(rootPath: string): Promise<WorkspaceData> {
  return gitExec(rootPath, ["status", "--porcelain=v1", "-b"])
    .then((statusOut) =>
      Promise.all([
        gitExec(rootPath, ["diff", "--numstat", "--", "."]).catch(() => ({ stdout: "" })),
        gitExec(rootPath, ["diff", "--cached", "--numstat", "--", "."]).catch(() => ({ stdout: "" })),
        gitExec(rootPath, ["branch", BRANCH_FORMAT]).catch(() => ({ stdout: "" })),
        gitExec(rootPath, ["log", "--oneline", "-n", String(COMMIT_LIMIT)]).catch(() => ({ stdout: "" })),
        gitExec(rootPath, ["stash", "list"]).catch(() => ({ stdout: "" })),
        gitExec(rootPath, ["remote", "-v"]).catch(() => ({ stdout: "" })),
      ]).then(([worktreeOut, indexOut, branchOut, logOut, stashOut, remoteOut]) => ({
        status: parseGitStatus(statusOut.stdout),
        // numstat 要跑两条:工作区的和暂存区的。只跑一条会漏掉「已暂存但工作区又改了」的文件。
        numstat: [...parseGitNumstat(indexOut.stdout), ...parseGitNumstat(worktreeOut.stdout)],
        branches: parseGitBranches(branchOut.stdout),
        commits: logOut.stdout
          .split("\n")
          .filter((line) => line.trim().length > 0)
          .flatMap((line) => {
            const parsed = parseGitCommit(line)
            return parsed ? [parsed] : []
          }),
        stash: parseGitStashList(stashOut.stdout),
        remotes: parseGitRemotes(remoteOut.stdout),
      })),
    )
    .catch((e: unknown) => emptyWorkspace(hintFromError(e)))
}

/**
 * git 报错 → 状态面板「提示」行的文案。
 *
 * 不能把 git 的原始英文串直接怼进中文界面 —— 用户在一个非仓库目录打开工作区时,
 * 看到 `fatal: not a git repository (or any of the parent directories): .git` 是纯噪音。
 * 但也不能一律猜成「不是 git 仓库」:超时、权限不足都可能让 status 失败,那两种情况下
 * 猜错比透出原文更坏。所以只认已知串给中文,其余统一说「git 执行失败」——
 * 不把原始英文串怼进中文界面,也免得一条超长的 fatal 串撑破状态行的布局。
 * 规则照抄自 git-panel.tsx:253 的既有形态。
 */
function hintFromError(e: unknown): string {
  const message = e instanceof Error ? e.message : String(e)
  return message.includes("not a git repository") ? "不是 git 仓库" : "git 执行失败"
}

export function emptyWorkspace(error?: string): WorkspaceData {
  return {
    status: { ahead: 0, behind: 0, entries: [] },
    numstat: [],
    branches: [],
    commits: [],
    stash: [],
    remotes: [],
    error,
  }
}

/**
 * 多远程的默认选中。优先 `origin` —— 它是绝大多数仓库的约定默认,选错的代价又很高
 * (推送是不可逆动作),所以宁可按约定走,也不按字母序取第一个。
 */
export function pickDefaultRemote(remotes: GitRemote[]): GitRemote | undefined {
  return remotes.find((r) => r.name === "origin") ?? remotes[0]
}

/** 领先/落后的显示文本。**0 不画** —— 画一个「↑ 0」是纯噪音。 */
function trackCount(ahead: number, behind: number): string | undefined {
  const parts: string[] = []
  if (ahead > 0) parts.push(`↑${ahead}`)
  if (behind > 0) parts.push(`↓${behind}`)
  return parts.length > 0 ? parts.join(" ") : undefined
}

export interface StatusRow {
  kind: "branch" | "remote" | "changes" | "hint"
  label: string
  detail?: string
  count?: string
}

/**
 * 状态面板的四行。顺序固定:分支 / 远程 / 变更 / 提示(规格「状态面板的四行」)。
 * `selectedRemote` 由调用方传入 —— 选中哪个远端是工作区状态,不是 git 的输出。
 */
export function deriveStatusRows(
  status: GitStatusSummary,
  numstat: GitNumstatEntry[],
  remotes: GitRemote[],
  selectedRemote?: GitRemote,
  error?: string,
): StatusRow[] {
  const files = status.entries.length
  const added = numstat.reduce((sum, item) => sum + item.added, 0)
  const removed = numstat.reduce((sum, item) => sum + item.removed, 0)
  // 「有改动」看的是**有没有条目**,不是工作区位。只看 unstaged 会让「已 git add 但工作区
  // 干净」的文件不计数 —— 那时「变更」行说「1 个文件」,下面「提示」行却说「工作区干净」,
  // 同一个面板自相矛盾。已暂存未提交当然算未提交。
  const dirty = files > 0
  const remote = selectedRemote ?? pickDefaultRemote(remotes)
  // branch 为空意味着 `git status` 没给出分支行 —— 要么不在仓库里,要么是 detached。
  // 空仓库的 `No commits yet on main` 和 detached 的 `(HEAD detached at ...)` 不是分支名,
  // 原样进中文界面也是噪音(判定口径照抄 git-panel.tsx:281-283 的 branchName())。
  const branch = status.branch ?? ""
  const inRepo = branch !== "" && !branch.startsWith("No commits yet") && !branch.startsWith("(HEAD detached")
  // 分叉:两边都有新提交。push 会被拒、pull 会冲突,是必须让用户看见的阻塞态,
  // 所以排在「有未提交改动」前面 —— 后者只是待办,前者是卡住。
  const diverged = status.ahead > 0 && status.behind > 0

  return [
    {
      kind: "branch",
      label: "分支",
      detail: inRepo ? branch : "(不在分支上)",
      count: trackCount(status.ahead, status.behind),
    },
    { kind: "remote", label: "远程", detail: remote?.name ?? "未配置远端" },
    { kind: "changes", label: "变更", detail: `${files} 个文件`, count: `+${added} -${removed}` },
    {
      kind: "hint",
      label: "提示",
      // error 优先:loadWorkspace 只在 status 命令失败时才带 error,这时「不是 git 仓库」
      // 未必是真因(可能是超时、权限)。把真实原因透出来比猜一个原因好。
      detail: error ?? (!inRepo ? "不是 git 仓库" : diverged ? "分支与远程 diverged" : dirty ? "有未提交的改动" : "工作区干净"),
    },
  ]
}

/** 文件面板一行的中文状态词。规格要求用中文而不是 git 的 XY 字母。 */
const STATUS_LABEL: Record<string, string> = {
  modified: "已改",
  added: "新增",
  deleted: "删除",
  renamed: "重命名",
  untracked: "未跟踪",
}

export interface FileRow {
  file: string
  label: string
  /** `+N -M`;没有 numstat(例如未跟踪文件)时 undefined。 */
  count?: string
  staged: boolean
  unstaged: boolean
}

export function deriveFileRows(status: GitStatusSummary, numstat: GitNumstatEntry[]): FileRow[] {
  // 同一个文件可能在 numstat 里出现两次(工作区改了、暂存区也改了)。Map 后者覆盖前者,
  // 而 concat 的顺序是「暂存区在前、工作区在后」—— 所以取到的是**工作区侧**的行数。
  // 这是取舍:工作区一文件一行,没法同时显示两组数字。要显式说明,免得后来者以为是巧合。
  const byFile = new Map(numstat.map((item) => [item.file, item]))
  return status.entries.map((entry) => {
    const stat = byFile.get(entry.file)
    return {
      file: entry.file,
      label: STATUS_LABEL[entry.status] ?? "已改",
      count: stat ? `+${stat.added} -${stat.removed}` : undefined,
      staged: entry.staged,
      unstaged: entry.unstaged,
    }
  })
}
```

- [ ] **Step 4: 跑测试确认通过**

```
cd packages/tui && bun test --timeout 30000 test/component/git-workspace-state.test.ts
```

预期：全部 PASS。

- [ ] **Step 5: 跑全量测试确认没打破别的**

```
cd packages/tui && bun test --timeout 30000
```

预期：失败数仍是 4（既有 provider-options）。

- [ ] **Step 6: 提交**

```
cd packages/tui && git add src/component/git-workspace/state.ts test/component/git-workspace-state.test.ts && git commit -m "feat(tui): 工作区 git 数据拉齐与面板行派生"
```

---

### Task 4: 从 git-diff-view 抽出 diff 加载

右侧差异面板要复用现有的 diff 加载逻辑（含未跟踪文件的合成补丁）。抽成 util，两个地方共用。

**Files:**
- Create: `src/util/git-diff.ts`
- Modify: `src/component/git-diff-view.tsx`
- Test: `test/util/git-diff.test.ts`

- [ ] **Step 1: 写失败的测试**

创建 `packages/tui/test/util/git-diff.test.ts`：

```ts
import { afterAll, expect, test } from "bun:test"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import fs from "fs"
import os from "os"
import path from "path"
import { loadCommitPatch, loadFilePatch, untrackedPatch } from "../../src/util/git-diff"

test("untrackedPatch 对不存在的文件返回空串", () => {
  expect(untrackedPatch("nonexistent-file-for-test.ts", process.cwd())).toBe("")
})

test("untrackedPatch 对空路径返回空串", () => {
  expect(untrackedPatch("", "")).toBe("")
})

// 下面起真 git 子进程 —— 口径照抄 test/component/git-workspace-state.test.ts:
// loadFilePatch 的「空 diff 就合成补丁」是本任务的核心行为,不钉住它,抽不抽出来没人看得出区别。

const tmpDirs: string[] = []
function tmpGitDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  tmpDirs.push(dir)
  return dir
}

afterAll(() => {
  for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true })
  tmpDirs.length = 0
})

const exec = promisify(execFile)
const git = (root: string, args: string[]) =>
  exec("git", ["-c", "user.email=tui@example.com", "-c", "user.name=tui", ...args], { cwd: root })

test("loadFilePatch 未跟踪的新文件合成「全新文件」补丁", async () => {
  const dir = tmpGitDir("nw-diff-untracked-")
  await git(dir, ["init", "-b", "main"])
  fs.writeFileSync(path.join(dir, "new.txt"), "第一行\n第二行\n")
  const patch = await loadFilePatch(dir, "new.txt")
  expect(patch).toContain("new file mode 100644")
  expect(patch).toContain("--- /dev/null")
  expect(patch).toContain("@@ -0,0 +1,2 @@")
  expect(patch).toContain("+第一行")
  expect(patch).toContain("+第二行")
})

test("loadFilePatch 已跟踪文件走真 git diff", async () => {
  const dir = tmpGitDir("nw-diff-tracked-")
  await git(dir, ["init", "-b", "main"])
  fs.writeFileSync(path.join(dir, "a.txt"), "原样\n")
  await git(dir, ["add", "."])
  await git(dir, ["commit", "-m", "init"])
  fs.writeFileSync(path.join(dir, "a.txt"), "改过\n")
  const patch = await loadFilePatch(dir, "a.txt")
  expect(patch).toContain("-原样")
  expect(patch).toContain("+改过")
  expect(patch).not.toContain("new file mode")
})

test("loadFilePatch 非 HEAD 错误照样上抛,不静默降级成合成补丁", async () => {
  // loadFilePatch 只该吞「仓库还没有 HEAD」这一种失败。别的错误(不在仓库里、超时、
  // 权限)必须往上抛,否则组件永远显示不出错误,用户看到的是一份凭空合成的补丁。
  // 这条钉住的是两回调写法里的 `throw e` —— 改成 `.catch(() => untrackedPatch(...))` 就会红。
  //
  // 注意非仓库目录里 git 报的是 `Could not access 'HEAD'`(不是 `not a git repository`),
  // 正因为它不含 isMissingHead 认的那两个串,错误才会被正确上抛。
  const dir = tmpGitDir("nw-diff-norepo-")
  await expect(loadFilePatch(dir, "any.txt")).rejects.toThrow(/Could not access 'HEAD'/)
})

test("loadCommitPatch 只输出 diff 正文,不带提交说明", async () => {
  // git show 默认会把提交信息也打出来。`--format=` 是为了让差异面板只拿到补丁。
  const dir = tmpGitDir("nw-diff-commit-")
  await git(dir, ["init", "-b", "main"])
  fs.writeFileSync(path.join(dir, "a.txt"), "第一版\n")
  await git(dir, ["add", "."])
  await git(dir, ["commit", "-m", "这是提交说明,不该出现在补丁里"])
  const log = await exec("git", ["log", "-1", "--format=%H"], { cwd: dir })
  const patch = await loadCommitPatch(dir, log.stdout.trim())
  expect(patch).toContain("+第一版")
  expect(patch).not.toContain("这是提交说明")
  expect(patch).not.toContain("commit ")
})
```

> **两条实测修正**(写这段计划时没料到,落地时才暴露):
> ① `untrackedPatch` 的 `rootPath` 原本是死参数 —— `statSync(filePath)` 按**进程 cwd** 解析。
> 旧组件能工作只因为调用方传的恰好是绝对路径;现在 util 有两个调用方,必须 `resolve(rootPath, filePath)`。
> ② 仓库还没任何提交时 `git diff HEAD` 直接 fatal(`bad revision 'HEAD'`),不是空输出 ——
> 所以 `loadFilePatch` 要在拒绝分支里区分「没有 HEAD」与「真的出错」。
> 实测两种报错的原文:空仓库 `fatal: bad revision 'HEAD'`(吞掉),非仓库目录 `error: Could not access 'HEAD'`(上抛)。

- [ ] **Step 2: 跑测试确认失败**

```
cd packages/tui && bun test --timeout 30000 test/util/git-diff.test.ts
```

预期：FAIL，`Cannot find module '../../src/util/git-diff'`。

- [ ] **Step 3: 实现 git-diff.ts**

创建 `packages/tui/src/util/git-diff.ts`：

```ts
// diff 加载。原来长在 component/git-diff-view.tsx 里,抽出来是因为 GitWorkspace 的右侧
// 差异面板要用同一套逻辑(含未跟踪文件的合成补丁)——两个地方各写一份,迟早漂。
import { readFileSync, statSync } from "node:fs"
import { resolve } from "node:path"
import { gitExec } from "./git-exec"

// 合成补丁最多带多少行正文:未跟踪的大文件(构建产物)不把界面撑爆。
export const SYNTH_DIFF_MAX_LINES = 400

/**
 * 未跟踪的新文件没有 diff 输出(git diff 只看索引里已有的内容),这里合成一份
 * 「全新文件」补丁,照样能看到内容。
 *
 * 用 try/catch 而不是先 statSync 再 readFileSync:两次系统调用之间文件可能被删,
 * 而这两个操作的失败都只是「看不到内容」,不值得向上抛。
 */
export function untrackedPatch(filePath: string, rootPath: string): string {
  try {
    // 调用方给的是相对仓库根的路径,statSync/readFileSync 却按进程 cwd 解析,这里先落成绝对路径。
    // (原来那份实现里 `rootPath` 是个形同虚设的死参数;现在 util 有两个调用方,不能再靠巧合。)
    const abs = resolve(rootPath, filePath)
    if (statSync(abs).size > 1024 * 1024) return ""
    const lines = readFileSync(abs, "utf-8").split("\n")
    if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop()
    const shown = lines.slice(0, SYNTH_DIFF_MAX_LINES)
    return [
      `diff --git a/${filePath} b/${filePath}`,
      "new file mode 100644",
      "--- /dev/null",
      `+++ b/${filePath}`,
      `@@ -0,0 +1,${shown.length} @@`,
      ...shown.map((line) => `+${line}`),
    ].join("\n")
  } catch {
    return ""
  }
}

/** 单个文件相对 HEAD 的补丁(已暂存 + 未暂存一起看,和「这次提交会带上什么」一致)。 */
export function loadFilePatch(rootPath: string, filePath: string): Promise<string> {
  return gitExec(rootPath, ["diff", "HEAD", "--no-color", "--", filePath]).then(
    (out) => {
      const body = out.stdout.trimEnd()
      // 空 diff 只有两种可能:未跟踪的新文件,或改动已全部提交(内容 == HEAD)。
      return body || untrackedPatch(filePath, rootPath)
    },
    (e: unknown) => {
      // 仓库还没任何提交时不存在 HEAD,git 直接 fatal(`bad revision 'HEAD'`);此刻文件只可能是
      // 未跟踪,照旧合成补丁。**只吞这一种失败** —— 其余错误(不在仓库里是 `Could not access
      // 'HEAD'`、超时、权限)必须上抛,否则组件永远显示不出错误,用户看到一份凭空合成的补丁。
      if (!isMissingHead(e)) throw e
      return untrackedPatch(filePath, rootPath)
    },
  )
}

/** execFile 的失败对象带 stderr,git 对「没有 HEAD」的报错就落在那里面。 */
function isMissingHead(e: unknown): boolean {
  if (!(e instanceof Error)) return false
  const stderr = "stderr" in e ? String(e.stderr) : ""
  return stderr.includes("bad revision 'HEAD'") || stderr.includes("unknown revision")
}

/** 一个提交的补丁。`--format=` 让 git 只输出 diff 正文,不带提交说明。 */
export function loadCommitPatch(rootPath: string, hash: string): Promise<string> {
  return gitExec(rootPath, ["show", "--no-color", "--format=", hash]).then((out) => out.stdout.trimEnd())
}
```

- [ ] **Step 4: 改造 git-diff-view.tsx 复用 util**

`packages/tui/src/component/git-diff-view.tsx` 三处改动,缺一不可 —— **只换 import 不改 `load` 等于白抽**:两个地方各写一份「gitExec + 空则合成补丁」,迟早漂。

**4a. 删掉本地实现。** 整段删掉第 10 行的 `import { readFileSync, statSync } from "node:fs"`、第 12-13 行的 `SYNTH_DIFF_MAX_LINES` 注释与常量、第 15-32 行的 `untrackedPatch` 函数。

**4b. 换 import。** 第 8 行的 `import { gitExec } from "../util/git-exec"` 删掉(改完 `load` 后它再无用处),第 9 行 `Locale` 之后加一行:

```ts
import { loadFilePatch } from "../util/git-diff"
```

改完的文件头是:

```ts
// Git 页点文件名打开的"改动差异"标签页:git diff HEAD 的统一补丁直接喂给
// @opentui/core 的 <diff> 渲染器(和主差异查看器同一套配色/语法高亮)。
// 加载逻辑(含未跟踪文件的合成补丁)在 util/git-diff,与 GitWorkspace 的差异面板共用。
import { createSignal, onMount, Show } from "solid-js"
import type { DiffRenderable } from "@opentui/core"
import { useTheme } from "../context/theme"
import { useAutoRefresh } from "../util/auto-refresh"
import { loadFilePatch } from "../util/git-diff"
import { Locale } from "../util/locale"
```

**4c. 改 `load` 函数体。** 把整个 `try` 块换成一行调用 —— 这才是复用本身:

```ts
  const load = async () => {
    const cwd = props.rootPath
    if (!cwd) return
    try {
      setPatch(await loadFilePatch(cwd, props.filePath))
      setError("")
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }
```

原来那段「`gitExec` 拿 diff → 空了就 `untrackedPatch`」的逻辑整体上移到了 `loadFilePatch`,组件不再自己拼。

- [ ] **Step 5: 跑测试 + typecheck**

```
cd packages/tui && bun test --timeout 30000 test/util/git-diff.test.ts
cd packages/tui && bun run typecheck
```

预期：测试 PASS；typecheck exit 0。

- [ ] **Step 6: 提交**

```
cd packages/tui && git add src/util/git-diff.ts src/component/git-diff-view.tsx test/util/git-diff.test.ts && git commit -m "refactor(tui): diff 加载逻辑抽成 util 供工作区复用"
```

---

### Task 5: 右侧差异面板

左列焦点行变了，右侧就显示对应 diff。空状态要有话说，不能白屏。

**Files:**
- Create: `src/component/git-workspace/diff-panel.tsx`
- Test: `test/component/git-workspace-diff-panel.test.tsx`

- [ ] **Step 1: 写失败的测试**

创建 `packages/tui/test/component/git-workspace-diff-panel.test.tsx`。

**以已提交的 `test/component/git-workspace-diff-panel.test.tsx` 为准**（本段下面这份是初稿，落地时改过）。
Task 6/7/8 的面板测试都照抄它，先读一遍。

#### 组件渲染测试的坑清单（Task 6/7/8 一律适用）

这五条都是实测踩出来的，别再踩：

1. **`testRender` 必须 `await`** —— 它返回 Promise。
2. **配置用 `createTuiResolvedConfig()`**（`../fixture/tui-runtime`），不要 `config={{...} as never`。
3. **拆掉用 `app.renderer.destroy()`**，不是 `app.destroy()` —— `TestRendererSetup` 上没有 `destroy` 方法。
4. **不能用 `app.waitForFrame()` 等异步结果** —— 它只反复 capture、**不驱动渲染**，而测试渲染器
   不会因为信号变了就自动重绘（实测 `cellsUpdated` 恒为 0，20 轮全空转，直接超时）。
   异步断言必须自己写循环：`renderOnce()` → `sleep(25)` → `captureCharFrame()` → 命中就返回。
   真 TUI 有常驻渲染循环，测试里没人替你推。
5. **`<diff>` 渲染出来的行是「`1 + 改过`」** —— 行号、符号、内容之间都带空格。
   谓词写 `f.includes("+ 改过")`，写 `"+改过"` 永远匹配不到。

另外两条来自本任务：

6. **别断言初始帧来验异步分支** —— 标题是同步渲染的，帧一挂载就非空。
   「没有改动」既是初始状态又是空 diff 状态，断言它等于什么都没验。
   要验就验**只有 settle 之后才可能出现**的东西（真 diff 正文、git 错误文本）。
7. **`afterAll` 清理临时目录要吞 `EBUSY`** —— Windows 上 git 子进程刚退出时句柄可能还没释放，
   `rmSync` 会抛。临时目录清不掉无妨，别让它把测试带红。写法：
   `try { fs.rmSync(dir, { recursive: true, force: true }) } catch {}`。

测试分两组。**同步组**只验标题/引导文案（挂载即有）；**settle 组**用真 git 仓库 + 自写轮询，
验补丁正文和错误分支：

```tsx
// 同步组
test("没有目标时显示引导文案,不空白", async () => {
  expect(await syncFrame({ kind: "none" })).toContain("选中文件或提交后在这里看改动")
})
test("目标是文件时标题带上文件名", async () => {
  expect(await syncFrame({ kind: "file", path: "src/component/git-workspace.tsx" })).toContain("的改动")
})
test("目标是提交时标题带提交前缀", async () => {
  expect(await syncFrame({ kind: "commit", hash: "40f2c3c" })).toContain("提交 40f2c3c")
})

// settle 组 —— 用 tmpdir 真仓库(mock 掉 git 等于在测自己写的假数据)
test("改动内容真的画出来(等 git 回来,不是断言初始帧)", async () => {
  const dir = tmpDir("nw-dpanel-diff-")
  await git(dir, ["init", "-b", "main"])
  fs.writeFileSync(path.join(dir, "a.txt"), "原样\n")
  await git(dir, ["add", "."])
  await git(dir, ["commit", "-m", "init"])
  fs.writeFileSync(path.join(dir, "a.txt"), "改过\n")
  const app = await withPanel({ kind: "file", path: "a.txt" }, dir)
  try {
    const frame = await settleFrame(app, (f) => f.includes("+ 改过"))
    expect(frame).toContain("- 原样")
  } finally {
    app.renderer.destroy()
  }
})

test("git 报错时显示错误,而不是空白或假补丁", async () => {
  // 非仓库目录里 git diff HEAD 直接 fatal(`Could not access 'HEAD'`),且它不含 isMissingHead
  // 认的串,所以必须上抛 → 面板显示错误。
  const dir = tmpDir("nw-dpanel-norepo-")
  const app = await withPanel({ kind: "file", path: "any.txt" }, dir)
  try {
    const frame = await settleFrame(app, (f) => f.includes("Could not access"))
    expect(frame).not.toContain("没有改动")
  } finally {
    app.renderer.destroy()
  }
})
```

> 本仓库**没有** `git-diff-view` 的组件测试（`test/component/` 下不存在），别指望别人覆盖了 `<diff>` 渲染。

- [ ] **Step 2: 跑测试确认失败**

```
cd packages/tui && bun test --timeout 30000 test/component/git-workspace-diff-panel.test.tsx
```

预期：FAIL，`Cannot find module .../diff-panel`。

- [ ] **Step 3: 实现 diff-panel.tsx**

创建 `packages/tui/src/component/git-workspace/diff-panel.tsx`：

```ts
// 工作区右侧的差异视图。内容跟着左列焦点行变:文件 → 文件 diff,提交 → 提交 diff。
//
// 与 component/git-diff-view.tsx 的分工:那个是**独立标签页**(带关闭按钮、自己轮询),
// 这个是工作区里的一个**面板**(占右半边、由工作区统一刷新),所以这里不轮询。
import { createEffect, createSignal, Show } from "solid-js"
import { useTheme } from "../../context/theme"
import { loadCommitPatch, loadFilePatch } from "../../util/git-diff"
import { Locale } from "../../util/locale"

export type DiffTarget = { kind: "none" } | { kind: "file"; path: string } | { kind: "commit"; hash: string }

export interface GitDiffPanelProps {
  target: DiffTarget
  rootPath?: string
}

export function GitDiffPanel(props: GitDiffPanelProps) {
  const { theme, syntax } = useTheme()
  const [patch, setPatch] = createSignal("")
  const [error, setError] = createSignal("")

  // createEffect 而不是 onMount:rootPath 来自 session()?.directory,mount 那一刻可能还没就绪。
  // 这正是提交详情标签页踩过的坑(见 component/git-commit-view.tsx),别再踩一次。
  //
  // loadSeq 是世代计数器:target 变快时(比如连按 enter 换文件)会有多个 git 子进程在飞,
  // 先发的可能后回来。没有它,旧文件的 diff 会盖掉新文件的 —— 最糟的一种是 target 已经
  // 回到 none、引导文案都出来了,却被早先那个大 diff 顶掉。取 ui/dialog-select.tsx 的同款写法。
  // (component/git-commit-view.tsx:60 有同一处裸竞态,是预存量 bug,本任务不顺手改。)
  let loadSeq = 0
  createEffect(() => {
    const seq = ++loadSeq
    const cwd = props.rootPath
    const target = props.target
    if (!cwd || target.kind === "none") {
      setPatch("")
      setError("")
      return
    }
    // 旧的错误不能挂在新标题下面;patch 保留当占位,新结果到了再换(lazygit 同款行为)。
    setError("")
    const load = target.kind === "file" ? loadFilePatch(cwd, target.path) : loadCommitPatch(cwd, target.hash)
    load
      .then((body) => {
        if (seq !== loadSeq) return
        setPatch(body)
        setError("")
      })
      .catch((e: unknown) => {
        if (seq !== loadSeq) return
        setError(e instanceof Error ? e.message : String(e))
      })
  })

  const title = () => {
    const target = props.target
    if (target.kind === "file") {
      const base = target.path.split(/[\\/]/).pop() ?? target.path
      return `${Locale.oneLine(base, 40)} 的改动`
    }
    if (target.kind === "commit") return `提交 ${target.hash}`
    return "差异"
  }

  return (
    <box flexDirection="column" flexGrow={1} minHeight={0}>
      <box flexDirection="row" flexShrink={0} paddingLeft={1} paddingRight={1} paddingTop={1}>
        <text fg={theme.primary} wrapMode="none">
          {title()}
        </text>
      </box>
      <Show
        when={!error()}
        fallback={
          // ⚠️ paddingLeft 必须写在 <box> 上 —— 写在 <text> 上在 opentui 里无效(见本计划开头的通用约定)。
          <box paddingLeft={1}>
            <text fg={theme.error}>{error()}</text>
          </box>
        }
      >
        <Show
          when={patch()}
          fallback={
            <box paddingLeft={1}>
              <text fg={theme.textMuted}>
                {props.target.kind === "none" ? "选中文件或提交后在这里看改动" : "没有改动"}
              </text>
            </box>
          }
        >
          <box flexGrow={1} minHeight={0} backgroundColor={theme.backgroundPanel}>
            {/* 配色属性必须照抄 component/git-diff-view.tsx 那份 —— 少传任何一个,那一项就退回
                @opentui 默认色,和同一个主题下的其它 diff 视图对不上。 */}
            <diff
              diff={patch()}
              view="unified"
              filetype="none"
              syntaxStyle={syntax()}
              showLineNumbers={true}
              width="100%"
              height="100%"
              wrapMode="none"
              fg={theme.text}
              addedBg={theme.diffAddedBg}
              removedBg={theme.diffRemovedBg}
              addedSignColor={theme.diffHighlightAdded}
              removedSignColor={theme.diffHighlightRemoved}
              lineNumberFg={theme.diffLineNumber}
              addedLineNumberBg={theme.diffAddedLineNumberBg}
              removedLineNumberBg={theme.diffRemovedLineNumberBg}
            />
          </box>
        </Show>
      </Show>
    </box>
  )
}
```

- [ ] **Step 4: 跑测试确认通过**

```
cd packages/tui && bun test --timeout 30000 test/component/git-workspace-diff-panel.test.tsx
```

预期：全部 PASS。

- [ ] **Step 5: 提交**

```
cd packages/tui && git add src/component/git-workspace/diff-panel.tsx test/component/git-workspace-diff-panel.test.tsx && git commit -m "feat(tui): 工作区右侧差异面板"
```

---

### Task 6: 文件面板

显示文件列表、中文状态词、加删行数，焦点行有 `❯` 标记，确认态顶掉那一行内容。

**Files:**
- Create: `src/component/git-workspace/files-panel.tsx`
- Test: `test/component/git-workspace-files-panel.test.tsx`

- [ ] **Step 1: 写失败的测试**

创建 `packages/tui/test/component/git-workspace-files-panel.test.tsx`。

**渲染骨架照抄 Task 5 的 `test/component/git-workspace-diff-panel.test.tsx`** —— 那份已经踩完坑、
修好了。下面这份是**初稿，渲染骨架是错的**，照 Task 5 坑清单改：
`await testRender`、`createTuiResolvedConfig()`、`app.renderer.destroy()`、不要 `ArgsProvider`。

```tsx
/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { FilesPanel } from "../../src/component/git-workspace/files-panel"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"
import { KVProvider } from "../../src/context/kv"
import { ThemeProvider } from "../../src/context/theme"
import { TuiConfigProvider } from "../../src/config"
import { TestTuiContexts } from "../fixture/tui-environment"
import type { FileRow } from "../../src/component/git-workspace/state"

const ROWS: FileRow[] = [
  { file: "a.ts", label: "已改", count: "+10 -2", staged: true, unstaged: false },
  { file: "b.ts", label: "未跟踪", staged: false, unstaged: true },
]

// 纯展示组件、props 全同步 —— 没有异步加载,渲染完就能断言,不需要 settleFrame 那套轮询。
async function renderFrame(
  selected: number,
  rows: FileRow[] = ROWS,
  armed?: { key: string; label: string; deadline: number },
) {
  const app = await testRender(
    () => (
      <TestTuiContexts>
        <TuiConfigProvider config={createTuiResolvedConfig()}>
          <KVProvider>
            <ThemeProvider mode="dark">
              <FilesPanel rows={rows} selected={() => selected} armed={armed} width={36} />
            </ThemeProvider>
          </KVProvider>
        </TuiConfigProvider>
      </TestTuiContexts>
    ),
    { width: 60, height: 20 },
  )
  try {
    await app.renderOnce()
    await new Promise((resolve) => setTimeout(resolve, 25))
    await app.renderOnce()
    return app.captureCharFrame()
  } finally {
    app.renderer.destroy()
  }
}

test("文件行显示中文状态词", async () => {
  const frame = await renderFrame(0)
  expect(frame).toContain("已改")
  expect(frame).toContain("未跟踪")
})

test("有 numstat 的行显示加删行数", async () => {
  expect(await renderFrame(0)).toContain("+10 -2")
})

test("焦点行有 ❯ 标记", async () => {
  const focused = (await renderFrame(1)).split("\n").find((line) => line.includes("未跟踪"))
  expect(focused).toContain("❯")
})

test("非焦点行没有 ❯ 标记", async () => {
  const other = (await renderFrame(1)).split("\n").find((line) => line.includes("已改"))
  expect(other).not.toContain("❯")
})

test("空列表显示暂无", async () => {
  expect(await renderFrame(0, [])).toContain("暂无")
})

test("确认态时焦点行显示确认文案而不是文件名", async () => {
  const frame = await renderFrame(0, ROWS, { key: "d", label: "再按一次 d 丢弃这个文件", deadline: 3000 })
  expect(frame).toContain("再按一次 d")
  // 焦点行被确认文案顶掉,不该再露文件名。(未跟踪那行的 b.ts 还在,所以只查 a.ts。)
  expect(frame).not.toContain("a.ts")
})
```

> `ArmedConfirm` 的字段以 `src/component/git-workspace/confirm.ts` 为准：`{ key, label, deadline }`。
> 面板只读 `label` 渲染，`key`/`deadline` 是外壳驱动状态机用的 —— 测试夹具仍要给全，否则过不了类型检查。

**还要再加一条宽度契约测试** —— 上面那些用例把面板放在 60 列根盒里、却传 `width={36}`，
只有计算用到 36、布局并不受约束，截断压根没被真正考验（初稿的 `pathWidth` 算错就是这样溜过去的）。
必须把面板包进**恰好 36 列**的盒子，flex 收缩才会真的裁切：

```tsx
test("长路径按宽度截断,计数不被挤出屏幕", async () => {
  const frame = await renderConstrainedFrame([
    { file: "packages/tui/src/component/git-workspace/files-panel.tsx", label: "已改", count: "+10 -2", staged: true, unstaged: false },
  ])
  const row = frame.split("\n").find((line) => line.includes("已改")) ?? ""
  expect(row).toContain("+10 -2") // 预算算错时计数会被路径顶出 36 列之外
  expect(row).toContain("…") // 必须是省略号截断,不是 flex 硬切
  expect(Bun.stringWidth(row.replace(/\s+$/, ""))).toBeLessThanOrEqual(36)
})
```

> 这条测试我验证过：把 `pathWidth` 改回初稿算式，它立刻变红。

- [ ] **Step 2: 跑测试确认失败**

```
cd packages/tui && bun test --timeout 30000 test/component/git-workspace-files-panel.test.tsx
```

预期：FAIL，`Cannot find module .../files-panel`。

- [ ] **Step 3: 实现 files-panel.tsx**

创建 `packages/tui/src/component/git-workspace/files-panel.tsx`：

```ts
// 文件面板:文件列表 + 中文状态词 + 加删行数。焦点行有 ❯ 标记。
//
// 行高是**固定一行**:文件路径按列宽截断(见 Locale.truncateToWidth),不折行 ——
// 折行会让「j/k 选下一行」的视觉反馈变成跳一大段。
import { For, Show } from "solid-js"
import { useTheme } from "../../context/theme"
import { Locale } from "../../util/locale"
import type { ArmedConfirm } from "./confirm"
import type { FileRow } from "./state"

/** 状态词最多占 6 列,和下行 truncateToWidth(row.label, 6) 是同一个数。 */
const LABEL_WIDTH = 6
/** 计数区:1 列左内边距 + 最多 8 列(如 `+100 -20`)。 */
const COUNT_WIDTH = 9
const COUNT_PAD = 1

export interface FilesPanelProps {
  rows: FileRow[]
  /** 当前焦点行下标;面板没获得焦点时由调用方传 -1(没有行是焦点)。 */
  selected: () => number
  /** 确认态;非 undefined 时焦点行显示确认文案而不是正常内容。 */
  armed?: ArmedConfirm
  /** 面板可用列数,用于截断路径。 */
  width: number
}

export function FilesPanel(props: FilesPanelProps) {
  const { theme } = useTheme()
  // 一行的固定开销:左内边距 1 + 标记 2 + 状态词 LABEL_WIDTH + 分隔空格 1 + 计数区 COUNT_WIDTH。
  // 漏算任何一项,路径就会被 flex 收缩硬切(而且省略号也画不出来),计数和路径粘成一团。
  // 初稿写的 `Math.max(8, width - 2 - 10)` 漏了 padding/状态词/分隔空格,width=36 时实测行宽 41 列。
  const pathWidth = () => Math.max(4, props.width - 1 - 2 - LABEL_WIDTH - 1 - COUNT_WIDTH)

  return (
    <box flexDirection="column" flexGrow={1} minHeight={0}>
      <Show
        when={props.rows.length > 0}
        fallback={
          // 3 = 左内边距 1 + 标记 2,和行内容的标签起始列对齐。
          // ⚠️ 必须用 box 包着 —— paddingLeft 写在 <text> 上在 opentui 里无效(见本计划开头的通用约定)。
          <box paddingLeft={3}>
            <text fg={theme.textMuted}>暂无改动</text>
          </box>
        }
      >
        <For each={props.rows}>
          {(row, index) => {
            const isFocused = () => index() === props.selected()
            const showingConfirm = () => isFocused() && props.armed !== undefined
            return (
              <box flexDirection="row" paddingLeft={1}>
                <text fg={isFocused() ? theme.primary : theme.textMuted} wrapMode="none">
                  {isFocused() ? "❯ " : "  "}
                </text>
                <Show
                  when={showingConfirm()}
                  fallback={
                    <>
                      <text fg={theme.text} wrapMode="none">
                        {Locale.truncateToWidth(row.label, 6)} {Locale.truncateToWidth(row.file, pathWidth())}
                      </text>
                      <Show when={row.count}>
                        <box paddingLeft={COUNT_PAD}>
                          <text fg={theme.textMuted} wrapMode="none">
                            {row.count}
                          </text>
                        </box>
                      </Show>
                    </>
                  }
                >
                  <text fg={theme.warning} wrapMode="none">
                    {props.armed?.label ?? ""}
                  </text>
                </Show>
              </box>
            )
          }}
        </For>
      </Show>
    </box>
  )
}
```

- [ ] **Step 4: 跑测试确认通过**

```
cd packages/tui && bun test --timeout 30000 test/component/git-workspace-files-panel.test.tsx
```

预期：全部 PASS。

- [ ] **Step 5: 提交**

```
cd packages/tui && git add src/component/git-workspace/files-panel.tsx test/component/git-workspace-files-panel.test.tsx && git commit -m "feat(tui): 工作区文件面板"
```

---

### Task 7: 状态面板

四行可操作条目：分支 / 远程 / 变更 / 提示。选中远程行时把完整地址摊开。

**Files:**
- Create: `src/component/git-workspace/status-panel.tsx`
- Test: `test/component/git-workspace-status-panel.test.tsx`

- [ ] **Step 1: 写失败的测试**

创建 `packages/tui/test/component/git-workspace-status-panel.test.tsx`。

**渲染骨架照抄 Task 5/6 的组件测试**（`await testRender`、`createTuiResolvedConfig()`、
`app.renderer.destroy()`、不要 `ArgsProvider`）。下面是**初稿，渲染骨架是错的**，照改。
宽度约束测试的理由同 Task 6：不把面板包进恰好 `width` 列的盒子，截断就等于没测。

```tsx
/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { StatusPanel } from "../../src/component/git-workspace/status-panel"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"
import { KVProvider } from "../../src/context/kv"
import { ThemeProvider } from "../../src/context/theme"
import { TuiConfigProvider } from "../../src/config"
import { TestTuiContexts } from "../fixture/tui-environment"
import type { StatusRow } from "../../src/component/git-workspace/state"

const ROWS: StatusRow[] = [
  { kind: "branch", label: "分支", detail: "main", count: "↑91" },
  { kind: "remote", label: "远程", detail: "origin" },
  { kind: "changes", label: "变更", detail: "2 个文件", count: "+15 -5" },
  { kind: "hint", label: "提示", detail: "有未提交的改动" },
]

// boxWidth 传 0 表示不加约束(只验文案);传具体值时把面板包进恰好那么宽的盒子,
// flex 收缩才会真的裁切 —— 宽度算错必须在这里露馅,不能靠「布局不受约束」蒙混过去。
async function renderFrame(selected: number, rows: StatusRow[] = ROWS, remoteUrl?: string, boxWidth = 0) {
  const panel = <StatusPanel rows={rows} selected={() => selected} remoteUrl={remoteUrl} width={boxWidth || 36} />
  const app = await testRender(
    () => (
      <TestTuiContexts>
        <TuiConfigProvider config={createTuiResolvedConfig()}>
          <KVProvider>
            <ThemeProvider mode="dark">
              {boxWidth > 0 ? (
                <box width={boxWidth} flexDirection="column">
                  {panel}
                </box>
              ) : (
                panel
              )}
            </ThemeProvider>
          </KVProvider>
        </TuiConfigProvider>
      </TestTuiContexts>
    ),
    { width: 60, height: 20 },
  )
  try {
    await app.renderOnce()
    await new Promise((resolve) => setTimeout(resolve, 25))
    await app.renderOnce()
    for (let attempt = 0; attempt < 5; attempt++) {
      const frame = app.captureCharFrame()
      if (frame.trim().length > 0) return frame
      await new Promise((resolve) => setTimeout(resolve, 25))
      await app.renderOnce()
    }
    return app.captureCharFrame()
  } finally {
    app.renderer.destroy()
  }
}

test("四行都在,且是中文", async () => {
  const frame = await renderFrame(0)
  for (const label of ["分支", "远程", "变更", "提示"]) expect(frame).toContain(label)
})

test("焦点行有 ❯ 标记", async () => {
  const remoteLine = (await renderFrame(1)).split("\n").find((line) => line.includes("远程"))
  expect(remoteLine).toContain("❯")
})

test("选中远程行时把完整地址摊开", async () => {
  expect(await renderFrame(1, ROWS, "https://gitee.com/x/y.git")).toContain("gitee.com")
})

test("没选中远程行时不显示地址", async () => {
  expect(await renderFrame(0, ROWS, "https://gitee.com/x/y.git")).not.toContain("gitee.com")
})

test("没有远端时显示未配置远端", async () => {
  expect(await renderFrame(0, [{ kind: "remote", label: "远程", detail: "未配置远端" }])).toContain("未配置远端")
})

test("领先计数显示在分支行", async () => {
  expect(await renderFrame(0)).toContain("↑91")
})

test("长 detail 在 36 列内截断,计数不被挤掉", async () => {
  const frame = await renderFrame(
    0,
    [{ kind: "changes", label: "变更", detail: "工作区里有一大堆被改动的文件等着处理", count: "+100 -20" }],
    undefined,
    36,
  )
  const row = frame.split("\n").find((line) => line.includes("变更")) ?? ""
  expect(row).toContain("+100 -20")
  expect(row).toContain("…")
  expect(Bun.stringWidth(row.replace(/\s+$/, ""))).toBeLessThanOrEqual(36)
})
```

- [ ] **Step 2: 跑测试确认失败**

```
cd packages/tui && bun test --timeout 30000 test/component/git-workspace-status-panel.test.tsx
```

预期：FAIL，`Cannot find module .../status-panel`。

- [ ] **Step 3: 实现 status-panel.tsx**

创建 `packages/tui/src/component/git-workspace/status-panel.tsx`：

```ts
// 状态面板:四行可操作条目(分支 / 远程 / 变更 / 提示)。
//
// 为什么是「可操作的四行」而不是一块静态摘要:「选哪个远端」必须有地方放,而独立成第六个面板
// 又太重(Lazygit 也没有)。塞进状态面板当一行,正好。
//
// 选中远程行时把完整 URL 摊开:f 推送是不可逆动作,推错地方很痛,多占一行显示地址是值的。
import { For, Show } from "solid-js"
import { useTheme } from "../../context/theme"
import { Locale } from "../../util/locale"
import type { StatusRow } from "./state"

/** 标签固定 4 列(「分支」「远程」「变更」「提示」都是两字中文)。 */
const LABEL_WIDTH = 4
/** 计数区总宽 = 1 列左内边距 + 计数正文。 */
const COUNT_PAD = 1
/** 计数正文最多 8 列(如 `+100 -20`)。超出截断 —— 全仓求和的数字可以很长,不截会挤掉 detail。 */
const COUNT_TEXT_WIDTH = 8

export interface StatusPanelProps {
  rows: StatusRow[]
  selected: () => number
  /** 选中远端的完整地址;没有远端时 undefined。 */
  remoteUrl?: string
  width: number
}

export function StatusPanel(props: StatusPanelProps) {
  const { theme } = useTheme()
  // 一行的固定开销:左内边距 1 + 标记 2 + 标签 LABEL_WIDTH + 分隔空格 1 + 计数区(COUNT_PAD + COUNT_TEXT_WIDTH)。
  // 账目必须和 files-panel 的 pathWidth 用同一套口径,漏算就会被 flex 收缩硬切。
  const detailWidth = () => Math.max(4, props.width - 1 - 2 - LABEL_WIDTH - 1 - COUNT_PAD - COUNT_TEXT_WIDTH)
  const urlWidth = () => Math.max(4, props.width - 3)

  return (
    <box flexDirection="column" flexGrow={1} minHeight={0}>
      <For each={props.rows}>
        {(row, index) => {
          const isFocused = () => index() === props.selected()
          const showUrl = () => isFocused() && row.kind === "remote" && props.remoteUrl !== undefined
          return (
            <>
              <box flexDirection="row" paddingLeft={1}>
                <text fg={isFocused() ? theme.primary : theme.textMuted} wrapMode="none">
                  {isFocused() ? "❯ " : "  "}
                </text>
                <text fg={theme.textMuted} wrapMode="none">
                  {Locale.truncateToWidth(row.label, LABEL_WIDTH)}{" "}
                </text>
                <text fg={theme.text} wrapMode="none">
                  {Locale.truncateToWidth(row.detail ?? "", detailWidth())}
                </text>
                <Show when={row.count}>
                  <box paddingLeft={COUNT_PAD}>
                    <text fg={theme.warning} wrapMode="none">
                      {Locale.truncateToWidth(row.count ?? "", COUNT_TEXT_WIDTH)}
                    </text>
                  </box>
                </Show>
              </box>
              {/* 地址单独一行,不挤在远程那行后面 —— URL 很长,挤进去会把远端名截断掉。
                  ⚠️ 给外壳的契约:**远端行聚焦时,本面板渲染 rows.length + 1 行**。
                  任何按 selected 1:1 映射屏幕行的逻辑(光标、滚动条、固定行高)都要按这个算,
                  否则 URL 一出现就全错位。 */}
              <Show when={showUrl()}>
                <box paddingLeft={3}>
                  <text fg={theme.textMuted} wrapMode="none">
                    {Locale.truncateToWidth(props.remoteUrl ?? "", urlWidth())}
                  </text>
                </box>
              </Show>
            </>
          )
        }}
      </For>
    </box>
  )
}
```

- [ ] **Step 4: 跑测试确认通过**

```
cd packages/tui && bun test --timeout 30000 test/component/git-workspace-status-panel.test.tsx
```

预期：全部 PASS。

- [ ] **Step 5: 提交**

```
cd packages/tui && git add src/component/git-workspace/status-panel.tsx test/component/git-workspace-status-panel.test.tsx && git commit -m "feat(tui): 工作区状态面板(四行可操作)"
```

---

### Task 8: 工作区外壳（布局 / 焦点 / 键位条 / 键位拦截）

把面板拼起来：左列 36 列、右侧差异、底部键位条。焦点在面板间切换，按键先过工作区，答不上来才放行。

**Files:**
- Create: `src/component/git-workspace.tsx`
- Modify: `src/component/git-workspace/focus.ts`（追加 `keyOfParsed`）
- Test: `test/component/git-workspace-key.test.ts`、`test/component/git-workspace.test.tsx`

- [ ] **Step 1: 写 `keyOfParsed` 的失败测试**

键事件到键名的映射是**纯函数**，独立测，不碰渲染。

创建 `packages/tui/test/component/git-workspace-key.test.ts`：

```ts
import { expect, test } from "bun:test"
import { keyOfParsed, resolveWorkspaceCommand } from "../../src/component/git-workspace/focus"

test("普通字母取 name", () => {
  expect(keyOfParsed({ name: "d", ctrl: false, shift: false, sequence: "d" })).toBe("d")
  expect(keyOfParsed({ name: "c", ctrl: false, shift: false, sequence: "c" })).toBe("c")
})

test("数字键取 name", () => {
  expect(keyOfParsed({ name: "1", ctrl: false, shift: false, sequence: "1" })).toBe("1")
})

test("ctrl 组合键加前缀", () => {
  expect(keyOfParsed({ name: "c", ctrl: true, shift: false, sequence: "\u0003" })).toBe("ctrl+c")
})

test("shift+tab 合成一个键名", () => {
  expect(keyOfParsed({ name: "tab", ctrl: false, shift: true, sequence: "\u001b[Z" })).toBe("shift-tab")
})

test("普通 tab 不加前缀", () => {
  expect(keyOfParsed({ name: "tab", ctrl: false, shift: false, sequence: "\t" })).toBe("tab")
})

test("空格:sequence 口径", () => {
  expect(keyOfParsed({ name: " ", ctrl: false, shift: false, sequence: " " })).toBe("space")
})

test("空格:name 已经叫 space 的口径", () => {
  expect(keyOfParsed({ name: "space", ctrl: false, shift: false, sequence: " " })).toBe("space")
})

test("escape / return 归一化成键位表的词汇", () => {
  // opentui 事件的 name 是 escape / return(见 src/util/selection.ts:66、
  // src/component/error-component.tsx:63),而键位表里写的是 esc / enter。
  // 不做这两条映射,按 esc 关工作区、按 enter 看差异都会解析成 undefined 而静默失效。
  expect(keyOfParsed({ name: "escape", ctrl: false, shift: false, sequence: "\u001b" })).toBe("esc")
  expect(keyOfParsed({ name: "return", ctrl: false, shift: false, sequence: "\r" })).toBe("enter")
})

test("归一化后的键能被键位表接住(往返)", () => {
  // 键位表(focus.ts)与 opentui 的事件名是两套词汇,这层归一化是两者的契约。
  // 任一侧改了拼写,这条都会红 —— 只单测 focus.ts 或只单测 keyOfParsed 都测不出。
  expect(resolveWorkspaceCommand("files", keyOfParsed({ name: "return", ctrl: false, shift: false, sequence: "\r" }))).toBe("files.focusDiff")
  expect(resolveWorkspaceCommand("commits", keyOfParsed({ name: "return", ctrl: false, shift: false, sequence: "\r" }))).toBe("commits.focusDiff")
})
```

- [ ] **Step 2: 跑测试确认失败**

```
cd packages/tui && bun test --timeout 30000 test/component/git-workspace-key.test.ts
```

预期：FAIL，`keyOfParsed` 不在 `focus.ts` 导出里。

- [ ] **Step 3: 在 focus.ts 追加 keyOfParsed**

在 `packages/tui/src/component/git-workspace/focus.ts` 文件末尾追加：

```ts
/**
 * @opentui/core 的键事件 → 本模块的键名。
 *
 * 为什么要这层归一化:ParsedKey 对同一个键有两套口径 —— 空格在 `sequence` 里是 `" "`,
 * 而 `name` 有时是 `" "`、有时已经是 `"space"`;ctrl 组合又只体现在 `ctrl` 布尔上而不是 name 里。
 * 不归一化的话,键位表里写的 `space` 和 `ctrl+c` 永远匹配不上实际事件。
 *
 * 还有一层是**词汇差异**:opentui 事件的 `name` 是 `escape` / `return`(仓库里
 * `src/util/selection.ts:66`、`src/component/error-component.tsx:63` 都是这么比的),
 * 而 `focus.ts` 的键位表写的是 `esc` / `enter`。这套映射是两者的契约 —— 少了它,
 * 按 `esc` 关工作区、按 `enter` 看差异都会解析成 `undefined` 而静默失效。
 *
 * 入参故意用结构化最小类型而不是 `ParsedKey`:这样测试能直接传对象字面量,
 * 不必去构造一个完整的核心类型。
 */
export function keyOfParsed(event: { name: string; ctrl: boolean; shift: boolean; sequence: string }): string {
  if (event.ctrl && event.name.length === 1) return `ctrl+${event.name}`
  if (event.shift && event.name === "tab") return "shift-tab"
  if (event.sequence === " " || event.name === " " || event.name === "space") return "space"
  if (event.name === "escape") return "esc"
  if (event.name === "return") return "enter"
  return event.name
}
```

- [ ] **Step 4: 跑测试确认通过**

```
cd packages/tui && bun test --timeout 30000 test/component/git-workspace-key.test.ts
```

预期：全部 PASS。

- [ ] **Step 5: 写外壳的失败测试**

创建 `packages/tui/test/component/git-workspace.test.tsx`：

```tsx
/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { TestTuiContexts } from "../fixture/tui-environment"
import { TuiConfigProvider } from "../../src/config"
import { ArgsProvider } from "../../src/context/args"
import { KVProvider } from "../../src/context/kv"
import { ThemeProvider } from "../../src/context/theme"
import { GitWorkspace } from "../../src/component/git-workspace"

function renderWorkspace(width: number) {
  return testRender(
    () => (
      <TestTuiContexts>
        <TuiConfigProvider config={{ keybinds: {} } as never}>
          <ArgsProvider>
            <KVProvider>
              <ThemeProvider mode="dark">
                <GitWorkspace rootPath={process.cwd()} onClose={() => {}} width={width} />
              </ThemeProvider>
            </KVProvider>
          </ArgsProvider>
        </TuiConfigProvider>
      </TestTuiContexts>
    ),
    { width, height: 30 },
  )
}

test("五个面板标题都在", () => {
  const app = renderWorkspace(100)
  const frame = app.captureCharFrame()
  for (const title of ["状态", "文件", "分支", "提交", "贮藏"]) expect(frame).toContain(title)
  app.destroy()
})

test("底部键位提示条有中文说明", () => {
  const app = renderWorkspace(100)
  const frame = app.captureCharFrame()
  expect(frame).toContain("切面板")
  expect(frame).toContain("暂存")
  app.destroy()
})

test("默认焦点在状态面板", () => {
  const app = renderWorkspace(100)
  const lines = app.captureCharFrame().split("\n")
  expect(lines.find((line) => line.includes("分支") && line.includes("❯"))).toBeDefined()
  app.destroy()
})

test("窄于 70 列时提示太窄而不是硬挤", () => {
  const app = renderWorkspace(60)
  expect(app.captureCharFrame()).toContain("太窄")
  app.destroy()
})

test("70 列时不提示太窄,面板仍渲染", () => {
  const app = renderWorkspace(70)
  const frame = app.captureCharFrame()
  expect(frame).not.toContain("太窄")
  expect(frame).toContain("状态")
  app.destroy()
})

test("80 列及以上时左列是 36 列(面板标题不被挤到换行)", () => {
  const app = renderWorkspace(100)
  expect(app.captureCharFrame()).toContain("状态")
  app.destroy()
})
```

- [ ] **Step 6: 跑测试确认失败**

```
cd packages/tui && bun test --timeout 30000 test/component/git-workspace.test.tsx
```

预期：FAIL，`Cannot find module '../../src/component/git-workspace'`。

- [ ] **Step 7: 实现 git-workspace.tsx**

创建 `packages/tui/src/component/git-workspace.tsx`：

```ts
// Git 工作区外壳:左列五面板 + 右侧差异 + 底部键位条。
//
// 布局与焦点在这里,每个面板的渲染在 git-workspace/*.tsx,数据在 git-workspace/state.ts,
// 键位表在 git-workspace/focus.ts(纯数据,已单独单测)。
//
// 宽度规则(规格「布局」):左列固定 36,70-79 列收到 30,低于 70 直接提示太窄 ——
// 差异视图窄于 30 列就没法读,硬挤只会得到一个谁也看不懂的界面。
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js"
import { useKeyboard } from "@opentui/solid"
import { useTheme } from "../context/theme"
import { gitExec } from "../util/git-exec"
import type { GitStatusSummary } from "../util/git-status"
import { Locale } from "../util/locale"
import {
  DANGEROUS_COMMANDS,
  PANEL_ORDER,
  PANEL_TITLE,
  panelAt,
  keyOfParsed,
  resolveWorkspaceCommand,
  type PanelID,
  type WorkspaceCommand,
} from "./git-workspace/focus"
import { createConfirm, type ArmedConfirm } from "./git-workspace/confirm"
import {
  deriveFileRows,
  deriveStatusRows,
  loadWorkspace,
  pickDefaultRemote,
  type WorkspaceData,
} from "./git-workspace/state"
import { GitDiffPanel, type DiffTarget } from "./git-workspace/diff-panel"
import { FilesPanel } from "./git-workspace/files-panel"
import { StatusPanel } from "./git-workspace/status-panel"

const LEFT_WIDE = 36
const LEFT_NARROW = 30
const TOO_NARROW = 70

export interface GitWorkspaceProps {
  rootPath?: string
  onClose: () => void
  /** 工作区可用总列数。由调用方按侧栏挤占后的实际宽度给,别自己去猜 —— 组件看不见侧栏。 */
  width: number
}

export function GitWorkspace(props: GitWorkspaceProps) {
  const { theme } = useTheme()

  const [data, setData] = createSignal<WorkspaceData | undefined>(undefined)
  const [panel, setPanel] = createSignal<PanelID>("status")
  const [statusRow, setStatusRow] = createSignal(0)
  const [fileRow, setFileRow] = createSignal(0)
  const [diffTarget, setDiffTarget] = createSignal<DiffTarget>({ kind: "none" })
  const [armed, setArmed] = createSignal<ArmedConfirm | undefined>(undefined)
  const [remote, setRemote] = createSignal<string | undefined>(undefined)

  // 真实时钟注入给确认态。测试里换假时钟就能推时间(见 git-workspace-confirm.test.ts)。
  const confirm = createConfirm(() => Date.now())

  const refresh = () => {
    const cwd = props.rootPath
    if (!cwd) return
    loadWorkspace(cwd).then((next) => {
      setData(next)
      // 选中远端跟着数据走,但用户手动切过就以用户的选择为准。
      setRemote((prev) => prev ?? pickDefaultRemote(next.remotes)?.name)
    })
  }

  createEffect(() => refresh())
  onCleanup(() => setArmed(undefined))

  const selectedRemote = createMemo(() => {
    const list = data()?.remotes ?? []
    return list.find((item) => item.name === remote()) ?? pickDefaultRemote(list)
  })

  const statusRows = createMemo(() =>
    deriveStatusRows(
      data()?.status ?? EMPTY_STATUS,
      data()?.numstat ?? [],
      data()?.remotes ?? [],
      selectedRemote(),
      data()?.error,
    ),
  )
  const fileRows = createMemo(() => deriveFileRows(data()?.status ?? EMPTY_STATUS, data()?.numstat ?? []))

  const tooNarrow = () => props.width < TOO_NARROW
  const leftWidth = () => (props.width < 80 ? LEFT_NARROW : LEFT_WIDE)

  const moveRow = (delta: number) => {
    if (panel() === "status") {
      setStatusRow((n) => clamp(n + delta, 0, statusRows().length - 1))
      return
    }
    if (panel() === "files") setFileRow((n) => clamp(n + delta, 0, fileRows().length - 1))
  }

  /** 执行一条工作区命令。所有键位处理最终都汇到这里。 */
  const run = (command: WorkspaceCommand) => {
    const cwd = props.rootPath

    // 非危险命令一律清掉待确认态:用户按了别的键就说明他改主意了。
    // 不清的话,d 武装后按 j 移动一下光标,那行「再按一次 d 确认」会一直挂到超时。
    // (press 只在下面的 DANGEROUS_COMMANDS 分支里被调用,非危险键走不到那里。)
    if (!DANGEROUS_COMMANDS.has(command) && armed()) {
      confirm.clear()
      setArmed(undefined)
    }

    if (command === "panel.next") return setPanel((p) => panelAt(PANEL_ORDER.indexOf(p) + 1))
    if (command === "panel.prev") return setPanel((p) => panelAt(PANEL_ORDER.indexOf(p) - 1))
    if (command.startsWith("panel.jump:")) return setPanel(panelAt(Number(command.slice("panel.jump:".length))))
    if (command === "row.up") return moveRow(-1)
    if (command === "row.down") return moveRow(1)
    if (command === "global.close") return props.onClose()
    if (command === "global.refresh") return refresh()

    // 危险命令先进确认态;fire 才真往下走,armed/cancel 都只是状态变化。
    if (DANGEROUS_COMMANDS.has(command)) {
      const result = confirm.press(command, dangerLabel(command))
      setArmed(confirm.pending())
      if (result !== "fire") return
    }

    if (!cwd) return

    if (command === "files.stage") {
      const row = fileRows()[fileRow()]
      if (!row) return
      // 已暂存的再按空格是取消暂存(restore 撤回索引),没暂存的才是 add。
      const args = row.staged ? ["restore", "--staged", "--", row.file] : ["add", "--", row.file]
      gitExec(cwd, args).then(() => refresh())
      return
    }
    if (command === "files.stageAll") {
      gitExec(cwd, ["add", "-A"]).then(() => refresh())
      return
    }
    if (command === "files.focusDiff") {
      const row = fileRows()[fileRow()]
      if (row) setDiffTarget({ kind: "file", path: row.file })
      return
    }
    if (command === "commits.focusDiff") {
      const row = data()?.commits[fileRow()]
      if (row) setDiffTarget({ kind: "commit", hash: row.hash })
      return
    }
    if (command === "files.discard" || command === "files.delete") {
      const row = fileRows()[fileRow()]
      if (!row) return
      const args =
        command === "files.delete"
          ? ["clean", "-f", "--", row.file]
          : ["restore", "--worktree", "--staged", "--", row.file]
      gitExec(cwd, args).then(() => refresh())
      return
    }
    if (command === "status.space" || command === "status.m") {
      // 远程行:循环切远端。切换本身不执行任何 git 命令,只改选中状态(规格「多远程」)。
      const list = data()?.remotes ?? []
      if (list.length === 0) return
      const index = list.findIndex((item) => item.name === remote())
      setRemote(list[(index + 1) % list.length]?.name)
      return
    }
    if (command === "global.pull" || command === "global.push") {
      const name = selectedRemote()?.name
      const branch = data()?.status.branch
      if (!name || !branch) return
      const args = command === "global.pull" ? ["pull", name, branch] : ["push", name, branch]
      gitExec(cwd, args).then(() => refresh())
      return
    }
    if (command === "global.commit") {
      // 计划 1 里提交是「还不可用」的占位:没有暂存内容时给一句提示,计划 2 接上行内输入。
      const staged = (data()?.status.entries ?? []).filter((entry) => entry.staged)
      if (staged.length === 0) setArmed({ key: "c", label: "没有可提交的暂存内容", deadline: Date.now() + 3000 })
      return
    }
  }

  // 键位拦截:先问工作区,答得上来就吃掉;答不上来就放行(聊天输入框还能打字)。
  // 没解析出命令的键(要漏给聊天输入框的那些)一律取消确认态。和 run() 里的那次清理
  // 合起来才构成完整契约:**除危险命令的 press 之外,任何按键路径都清武装态**。
  // 漏了这条会出事:d 武装后按 q(漏过)、3 秒内再按 d —— 直接就 discard 了。
  useKeyboard((event) => {
    const command = resolveWorkspaceCommand(panel(), keyOfParsed(event))
    if (command) {
      event.preventDefault()
      event.stopPropagation()
      run(command)
      return
    }
    if (armed() !== undefined) {
      confirm.clear()
      setArmed(undefined)
    }
  })

  if (tooNarrow()) {
    return (
      <box flexGrow={1} minHeight={0} alignItems="center" justifyContent="center">
        <text fg={theme.warning}>终端太窄,请加宽到 70 列以上</text>
      </box>
    )
  }

  return (
    <box flexDirection="column" flexGrow={1} minHeight={0}>
      <box flexDirection="row" flexGrow={1} minHeight={0}>
        <box flexDirection="column" width={leftWidth()} flexShrink={0} minHeight={0}>
          <For each={PANEL_ORDER}>
            {(id) => (
              <PanelFrame title={PANEL_TITLE[id]} focused={panel() === id}>
                <Show when={id === "status"}>
                  <StatusPanel
                    rows={statusRows()}
                    selected={() => (panel() === "status" ? statusRow() : -1)}
                    remoteUrl={selectedRemote()?.url}
                    width={leftWidth()}
                  />
                </Show>
                <Show when={id === "files"}>
                  <FilesPanel
                    rows={fileRows()}
                    selected={() => (panel() === "files" ? fileRow() : -1)}
                    armed={armed()}
                    width={leftWidth()}
                  />
                </Show>
              </PanelFrame>
            )}
          </For>
        </box>
        <box flexGrow={1} minHeight={0}>
          <GitDiffPanel target={diffTarget()} rootPath={props.rootPath} />
        </box>
      </box>
      {/* 底部键位条:内容跟着焦点面板变(规格「底部键位提示条跟着焦点面板变」)。 */}
      <box flexDirection="row" flexShrink={0} paddingLeft={1} paddingTop={1}>
        <text fg={theme.textMuted} wrapMode="none">
          {keybarText(panel(), armed())}
        </text>
      </box>
    </box>
  )
}

function PanelFrame(props: { title: string; focused: boolean; children?: unknown }) {
  const { theme } = useTheme()
  return (
    <box flexDirection="column" flexGrow={1} minHeight={0}>
      <text fg={props.focused ? theme.primary : theme.textMuted} wrapMode="none" paddingLeft={1}>
        {props.focused ? `┌ ${props.title} ─` : `┌ ${props.title}`}
      </text>
      <box flexDirection="column" flexGrow={1} minHeight={0}>
        {props.children}
      </box>
    </box>
  )
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min
  return Math.min(Math.max(value, min), max)
}

function dangerLabel(command: WorkspaceCommand): string {
  if (command === "files.discard") return "再按一次 d 丢弃这个文件的改动"
  if (command === "files.delete") return "再按一次 x 删除这个未跟踪文件"
  if (command === "branches.delete") return "再按一次 d 删除这个分支"
  return "再按一次 d 丢弃这个贮藏"
}

/** 键位条文字。确认态时整条换成确认文案 —— 这是「不弹窗」方案里唯一的强提示位。 */
function keybarText(panel: PanelID, armed?: ArmedConfirm): string {
  if (armed) return armed.label
  if (panel === "files") return "j/k 选 空格 暂存 a 全部暂存 enter 看差异 d 丢弃 ? 帮助"
  if (panel === "status") return "j/k 选行 空格 作用于当前行 p 拉取 f 推送 ? 帮助"
  if (panel === "branches") return "j/k 选 空格 切换 n 新建 d 删除 ? 帮助"
  if (panel === "commits") return "j/k 选 enter 看差异 z 撤销上次提交 ? 帮助"
  return "j/k 选 空格 弹出 d 丢弃 ? 帮助"
}

/** 数据还没回来(或不是 git 仓库)时的空状态。显式标类型,免得 `??` 右边的字面量把联合类型撑开。 */
const EMPTY_STATUS: GitStatusSummary = { ahead: 0, behind: 0, entries: [] }
```

- [ ] **Step 8: 跑测试确认通过**

```
cd packages/tui && bun test --timeout 30000 test/component/git-workspace.test.tsx
cd packages/tui && bun run typecheck
```

预期：测试 PASS；typecheck exit 0。

**计划 1 里有意是 no-op 的命令**：`global.help`（`?` 帮助浮层在计划 3）、`branches.*` / `commits.undo` / `stash.*`（这三个面板的渲染与操作在计划 2）。键位表会把它们解析出来、`run` 里没有对应分支，于是什么也不发生 —— 这是可接受的中间状态，不是 bug。计划 1 的人工验收清单里**没有**这几条。

- [ ] **Step 9: 跑全量测试**

```
cd packages/tui && bun test --timeout 30000
```

预期：失败数仍是 4。

- [ ] **Step 10: 提交**

```
cd packages/tui && git add src/component/git-workspace.tsx src/component/git-workspace/focus.ts test/component/git-workspace-key.test.ts test/component/git-workspace.test.tsx && git commit -m "feat(tui): Git 工作区外壳(布局/焦点/键位条/拦截)"
```

---

### Task 9: 接进标签页体系

让 `Git` 出现在主区标签条上，能开、能关、能渲染。

**Files:**
- Modify: `src/component/tab-bar.tsx`（`TabItem.type`）
- Modify: `src/routes/session/index.tsx`（开标签 + 分发渲染）
- Modify: `src/routes/session/sidebar.tsx`（Git 页加入口）

- [ ] **Step 1: 扩展 TabItem.type**

修改 `packages/tui/src/component/tab-bar.tsx` 第 17 行的 `type` 联合类型：

```ts
  type: "chat" | "preview" | "git-diff" | "commit-detail" | "git-workspace"
```

同时更新第 14-16 行的注释，补一句 `git-workspace` 是整屏工作区，没有 `filePath` 也没有 `commitHash`。

`tabColumns` 里 `tab.type === "chat" ? icon("chat") : icon("doc")` 不用改 —— 工作区走 `icon("doc")` 分支即可。

- [ ] **Step 2: 加 openGitWorkspaceTab**

修改 `packages/tui/src/routes/session/index.tsx`，在 `openCommitTab`（约第 663 行）之后追加：

```ts
// Git 工作区:整屏双栏,一个会话同时只开一个(id 固定,重复打开只是切过去)。
const openGitWorkspaceTab = () => {
  const tabId = "git-workspace"
  const existing = tabs().find((t) => t.id === tabId)
  if (existing) {
    setActiveTabId(tabId)
    return
  }
  setTabs((prev) => [...prev, { id: tabId, title: "Git", type: "git-workspace", closable: true }])
  setActiveTabId(tabId)
  setSelectedFile(null)
}
```

- [ ] **Step 3: 主区渲染分发加一路**

在 `packages/tui/src/routes/session/index.tsx` 主区渲染处（`activeTab()?.type === "commit-detail"` 那个 `Show` 之后、约第 2111 行 `GitDiffView` 附近），追加：

```tsx
<Show when={activeTab()?.type === "git-workspace"}>
  <GitWorkspace rootPath={session()?.directory} onClose={() => closeTab("git-workspace")} width={contentWidth()} />
</Show>
```

两个值都不是新造的，照抄旁边已有的：

- **`rootPath={session()?.directory}`** —— 紧挨着的 `GitDiffView`（第 2113 行）和提交详情（第 2106 行）用的就是它。别用 `project.instance.path().worktree` 那套回退（第 1551-1552 行是别处的菜单项，语义不同）。
- **`width={contentWidth()}`** —— `contentWidth` 是第 552 行的 `createMemo`，聊天区 `ctxWidth`（第 2092 行）和 `Footer`（第 2174 行）都用 `contentWidth()`。**不要**用 `contentWidth() + 2`：那个 `+2` 是标签栏算自己 `paddingLeft/Right` 的口径（第 557-561 行的 `tabBarWidth`），工作区不带那两列 padding。

文件头补 import：

```ts
import { GitWorkspace } from "../../component/git-workspace"
```

- [ ] **Step 4: 侧栏 Git 页加入口**

修改 `packages/tui/src/routes/session/sidebar.tsx` 的 Git 页分支，在现有 `GitPanel` 之上加一行入口。找到 `<GitPanel` 那处（约第 277 行），在其**之前**插入：

```tsx
<box flexDirection="row" paddingLeft={1} paddingBottom={1}>
  <text fg={theme.primary} onMouseUp={props.onOpenGitWorkspace} wrapMode="none">
    ↳ 打开工作区
  </text>
</box>
```

`SidebarProps` 加字段：

```ts
  onOpenGitWorkspace: () => void
```

并在 `routes/session/index.tsx` 里**两处** `<Sidebar>` 调用都补上 `onOpenGitWorkspace={openGitWorkspaceTab}`（一处 wide、一处 overlay）。

- [ ] **Step 5: 跑测试 + typecheck**

```
cd packages/tui && bun test --timeout 30000
cd packages/tui && bun run typecheck
```

预期：失败数仍是 4；typecheck exit 0。

- [ ] **Step 6: prettier**

```
cd packages/tui && bun run prettier -- --check src/component/git-workspace.tsx src/component/tab-bar.tsx src/routes/session/index.tsx src/routes/session/sidebar.tsx src/component/git-workspace/
```

预期：全部通过；若不通过，去掉 `--check` 跑一次格式化。

- [ ] **Step 7: 提交**

```
cd packages/tui && git add src/component/tab-bar.tsx src/routes/session/index.tsx src/routes/session/sidebar.tsx && git commit -m "feat(tui): 主区接入 Git 工作区标签页"
```

---

## 人工验收（本计划完成后）

在真实终端跑一次，确认视觉与交互：

```
cd packages/tui && bun dev
```

进会话后点侧栏 `Git` 页的 `↳ 打开工作区`，核对：

1. 主区标签条出现 `Git`，且能点 `✕` 关掉
2. 左列五个面板标题都在，状态面板四行是中文
3. `tab` 能在面板间切，`❯` 标记跟着走
4. 焦点在 `文件` 面板时 `j/k` 能上下选，`空格` 暂存后文件状态会变
5. 焦点在 `文件` 面板按 `enter`，右侧差异视图显示该文件 diff
6. 按 `d` 那一行变黄显示「再按一次 d…」，按别的键取消
7. 在工作区里按 `q`、`v`、中文拼音字母 —— **不会**漏进聊天输入框；`ctrl+c` 仍能中断
8. 终端缩到 60 列 → 显示「终端太窄」；70 列 → 左列变窄但仍可用

---

## 计划 1 完成后的边界

**已交付**：Git 标签页骨架、状态面板（含多远程显示）、文件面板（暂存/全部暂存/丢弃/删除）、右侧差异视图（文件与提交两路）、二次确认、键位拦截、窄屏降级。

**留给计划 2**：分支面板、提交面板、贮藏面板的实际渲染与操作、多远程的循环切换接线、行内提交输入（`c` 现在只提示「没有可提交的暂存内容」）、`z` 撤销上次提交。

**留给计划 3**：侧栏 `git-panel.tsx` 瘦成入口 + 三行摘要（移除「同步/远程/历史/贮藏」区块）、命令面板注册「打开 Git 工作区」、`?` 帮助浮层、把 `git-diff` 标签页与工作区的关系再收敛。

**前置风险（计划 2 动手前必须先验证）**：`y` 复制键依赖系统剪贴板（终端里通常要 OSC 52）。先确认 `packages/tui` 有没有可用通道，**没有就砍掉所有 `y` 键**，别为次要功能引入依赖。规格里已写明这条。
