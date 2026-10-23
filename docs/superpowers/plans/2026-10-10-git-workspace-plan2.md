# Git 工作区 · 计划 2 —— 三个空面板 + 差异激活模式 + 行内输入

## 背景

- 规格：`docs/superpowers/specs/2026-10-09-git-workspace-design.md`（已批准，`bde0909`）。
  本文所有需求引用都是这份规格的行号。
- 计划 1：`docs/superpowers/plans/2026-10-09-git-workspace-plan1.md`，9 个任务已全部完成并推送。
  它的「开工前必读」「最终整体审查」「计划 1 完成后的边界」是本文范围与约定的依据。
- 当前基线：**907 pass / 1 skip / 4 fail（912 tests / 128 files）**。4 个失败恒为既有的
  `test/cli/cmd/tui/provider-options.test.ts`，与本计划无关；typecheck exit 0；prettier 干净。

## 目标

计划 1 做完了骨架：布局、焦点、键位、文件面板、状态面板、差异视图（跟随、不能滚）。
本计划把剩下三个空面板做出来，并补上「差异视图获得焦点后能滚」和三处行内输入。

做完之后：

1. 分支 / 提交 / 贮藏面板渲染真实数据，能选行、能操作。
2. 在文件 / 提交 / 分支面板按 `enter`，焦点转到右侧差异视图：`j`/`k`/`↑`/`↓` 滚动、
   `pgup`/`pgdn` 翻页、`esc` 退回左列；数字 `1`-`5` 在此时不响应（规格 L115）。
3. `c` 提交、`n` 新建分支、添加远程 —— 三处共用同一个行内输入组件（规格 L141）。
4. `y` 复制（文件路径 / 完整提交哈希，规格 L64/L73）、`z` 撤销上次提交（规格 L75）、
   `m` 切换远端（规格 L50/L147）、状态面板 `空格` 按当前行分派（规格 L49-51）。

## 不在本计划（留给计划 3）

- `?` 帮助弹窗（规格 L117-119）。**本版不做**，Task 10 从键位条删掉 `? 帮助` ——
  印一个按了没反应的键，比不印更糟。
- `git-panel.tsx` 旧标签页瘦身与删除、侧栏「同步」按钮并入后的清理、
  `git-diff-view.tsx` 与 `util/git-diff.ts` 的进一步合并。
- 操作级撤销栈（Lazygit 那个大 `z`）。规格 L75 已明确排除。

## 通用约定（每个任务都适用，计划 1 已验证，照抄即可）

1. 跑测试：**只能在 `packages/tui` 下** `bun test --timeout 30000`。根目录跑会被
   `bunfig.toml` 的 `do-not-run-tests-from-root` 拦住。`test/cli/**` 是另一个测试集，单独跑。
2. typecheck：`bun typecheck`（tsgo，别用 tsc）。lint：根目录 `bun lint` 会 OOM，
   改动文件未经 lint 验证是已知现状，靠 typecheck + 测试 + 人工核对兜底。
3. 代码规范：无 `any`、无 `else`（提前 return）、能 `const` 不 `let`、dot 记法不拆构。
   prettier：`semi: false`、`printWidth: 120`。注释用中文，风格照抄同目录现有文件。
4. **opentui 测试五坑**：
   - `testRender(...)` 必须 `await`；
   - 必须传 `createTuiResolvedConfig()`（`test/fixture/tui-runtime.ts`），不要 `as never` 硬塞；
   - 拆除要 `app.renderer.destroy()`；
   - `waitForFrame()` **不驱动渲染** —— 用 `testRender` 的 `width/height` 选项 +
     `renderer.captureCharFrame()` 断言字符；
   - `paddingLeft` 等布局属性**必须写在 `<box>` 上，写在 `<text>` 上无效**。
5. 渲染断言先例：`test/component/git-workspace.test.tsx` 用固定 width + `captureCharFrame`，
   断言 36 列布局契约。新面板的宽度算式**必须和这个契约同步**：左列固定 36 列（`LEFT_WIDE`），
   70-79 列时 30 列；面板框吃掉左右各 1 列，所以传给面板的 `width` 是 `leftWidth() - 2`。
6. **加共享组件新属性前，先 `git grep '<Component'` 全仓查所有渲染点，并把新属性设为必选** ——
   计划 1 踩过「只改了一个渲染点」的坑，可选属性会让漏改静默通过。
7. 时间不直接读 `Date.now` / `setTimeout`；先例：`createConfirm(now)`，`now` 由外壳注入
   （真机 `Date.now`，测试传假时钟）。
8. 中文界面不要透出 git 原始英文串，走 `hintFromError`（`state.ts:88`）。

## 文件地图

| 文件                                             | 本计划做什么                                      |
| ------------------------------------------------ | ------------------------------------------------- |
| `src/component/git-workspace/focus.ts`           | 补 `y` / 分支 `enter` / 差异模式键位与命令联合    |
| `src/component/git-workspace/state.ts`           | 提交行加完整哈希；分支列表并入远程；分支行派生    |
| `src/util/git-diff.ts`                           | 新增 `loadBranchPatch`                            |
| `src/component/git-workspace/branches-panel.tsx` | **新建** 分支面板                                 |
| `src/component/git-workspace/commits-panel.tsx`  | **新建** 提交面板                                 |
| `src/component/git-workspace/stash-panel.tsx`    | **新建** 贮藏面板                                 |
| `src/component/git-workspace/inline-input.tsx`   | **新建** 行内输入组件（三处共用）                 |
| `src/component/git-workspace/diff-panel.tsx`     | 滚动容器（`scrollRef`）                           |
| `src/component/git-workspace.tsx`                | 接线：三面板、行内输入、差异激活模式、`y`、键位条 |
| `test/component/git-workspace-*.test.ts(x)`      | 对应测试                                          |

---

## Task 1 —— 键位表补齐

**写代码前先看清已有实现，避免重复造**：`1`-`5` 跳面板**已经支持**
（`focus.ts:148-149`，`resolveWorkspaceCommand` 末尾处理数字键）；`?` → `global.help`
**已经在** `GLOBAL_KEYS`（`focus.ts:75`）。本任务只补缺口。

### 1. 补 `WorkspaceCommand` 联合

```ts
  | "branches.focusDiff"
  | "files.copyPath"
  | "commits.copyHash"
  | "diff.scrollUp"
  | "diff.scrollDown"
  | "diff.pageUp"
  | "diff.pageDown"
  | "diff.exit"
```

### 2. 补 `PANEL_KEYS`

- `files`：加 `y: "files.copyPath"`
- `branches`：加 `enter: "branches.focusDiff"`
- `commits`：加 `y: "commits.copyHash"`

### 3. 新增差异模式键位表

```ts
/**
 * 差异视图获得焦点时的键位(规格 L113-115):滚动 / 翻页 / 退回。
 *
 * 单独一张表而不是复用 GLOBAL_KEYS:差异模式里 `esc` 是「退回左列」不是「关工作区」,
 * `j`/`k` 是滚动不是移动行,数字键一律不响应。混在一张表里就得到处加分支判断。
 */
export const DIFF_KEYS: Readonly<Record<string, WorkspaceCommand>> = {
  j: "diff.scrollDown",
  k: "diff.scrollUp",
  down: "diff.scrollDown",
  up: "diff.scrollUp",
  pageup: "diff.pageUp",
  pagedown: "diff.pageDown",
  esc: "diff.exit",
}

/**
 * 差异模式下的按键解析。数字键**显式返回 undefined**(规格 L115:此时不响应) ——
 * `resolveWorkspaceCommand` 对数字键会给出 `panel.jump`,直接复用会违反规格,所以走这张表。
 */
export function resolveDiffCommand(key: string): WorkspaceCommand | undefined {
  if (key.length === 1 && key >= "1" && key <= "5") return undefined
  return DIFF_KEYS[key]
}
```

### 4. 测试（`test/component/git-workspace-focus.test.ts` 追加，别动已有用例）

- `resolveWorkspaceCommand("files", "y") === "files.copyPath"`
- `resolveWorkspaceCommand("branches", "enter") === "branches.focusDiff"`
- `resolveWorkspaceCommand("commits", "y") === "commits.copyHash"`
- `resolveDiffCommand` 对 `j` / `k` / `up` / `down` / `pageup` / `pagedown` / `esc` 各自返回对应命令
- `resolveDiffCommand("1")` 到 `resolveDiffCommand("5")` 全部是 `undefined`
- `resolveDiffCommand("c")` 是 `undefined`（差异模式下提交键不该生效）
- 既有断言保持：数字 `1`-`5` 在**面板模式**下返回 `panel.jump:0..4`，`"6"` / `"0"` 是 `undefined`

### ⚠️ 动手前先做的一步验证

`keyOfParsed` 对方向键 / 翻页键是**直接透传 `event.name`**（`focus.ts:190`），上面假设箭头键
`name` 是 `up` / `down`、翻页是 `pageup` / `pagedown`。

**这条已经验证过，结论成立**（Task 1 实施时确认）：直接读 `ParsedKey.name` 判方向 / 翻页
的唯一先例是 `src/component/error-component.tsx:84-87`（`evt.name === "up" / "down" / "pageup" / "pagedown"`），
`src/keymap.tsx:116-117` 的别名表把 `pgup`/`pgdown` 归一到 `pageup`/`pagedown`。
所以 `DIFF_KEYS` 的键名就是 `up` / `down` / `pageup` / `pagedown`。
**注意**：`src/util/selection.ts`、`diff-viewer.tsx`、`dialog-select.tsx` **不是**先例 ——
前者的 `:66` 是 esc 判断，后两个走的是 `@opentui/keymap` 层（`key: "j,down"` 这种），
不直接读 `ParsedKey.name`，口径不一样。测试断言仍建议用
`keyOfParsed({ name, ctrl: false, shift: false, sequence })` 构造输入，不要硬编码字面量。

验收：`bun test test/component/git-workspace-focus.test.ts --timeout 30000` 全绿。

---

## Task 2 —— 数据层：完整哈希、远程分支、分支行派生

### 2.1 提交行带完整哈希

现在 `state.ts:61-67` 用 `git log --oneline` + `parseGitCommit`，只拿到短哈希；
复制完整哈希（规格 L73）需要新格式。**不要改 `src/util/git-status.ts`** ——
`parseGitCommit` 被 `git-panel.tsx` 共用，那是计划 3 的事。

```ts
const COMMIT_FORMAT = "--format=%H|%h|%s"

/**
 * 一条 `--format=%H|%h|%s` 的输出。拆三段:复制用完整哈希(`%H`),显示用短哈希(`%h`),
 * 主题用 `%s`。
 *
 * 主题里可以出现 `|`,所以余下的段落必须全部并进 subject。**JS 的 `split("|", 3)` 是截断语义**
 * (`"a|b|c|d".split("|", 3)` → `["a","b","c"]`,`d` 直接丢掉),不是 Go `SplitN` 那种
 * 「余下留到最后一段」—— 所以必须 `split("|")` 再 `slice(2).join("|")` 自己拼回来。
 */
export function parseCommitRows(output: string): GitCommitRow[] {
  return output
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .flatMap((line) => {
      const parts = line.split("|")
      if (parts.length < 3) return []
      return [{ full: parts[0]!, hash: parts[1]!, subject: parts.slice(2).join("|") }]
    })
}
```

**Task 2 实施时的两处更正（已验证，以此为准）**：

1. 上面的 `split` 写法就是更正结果。任务书初稿写的 `split("|", 3)` 会把主题里 `|` 之后的内容
   整段丢掉（TDD 红用例抓到），已改成 `split("|")` + `slice(2).join("|")`。
2. `trackCount` **不在 `locale.ts`**，它是 `state.ts` 里未导出的私有函数；`deriveBranchRows`
   同在 `state.ts`，直接用本地那个，不要 import。

`GitCommitRow` 加 `full: string`。`loadWorkspace` 里把
`gitExec(rootPath, ["log", "--oneline", "-n", String(COMMIT_LIMIT)])`
换成 `["log", COMMIT_FORMAT, "-n", String(COMMIT_LIMIT)]`，`commits` 字段改用 `parseCommitRows`。

### 2.2 远程分支并入分支列表

`git branch --format=...` 只列本地分支，但规格 L69 要「本地与远程分支同列显示」。
把分支查询改成 `gitExec(rootPath, ["branch", "-a", BRANCH_FORMAT])`：
`-a` 把 `remotes/origin/main` 也列进来，`%(refname:short)` 自动剥掉 `refs/remotes/` 前缀，
正好得到规格要的 `origin/main` 形式；`%(upstream:track)` 对远程分支是空串，ahead/behind 自然是 0。

**不要改 `BRANCH_FORMAT` 的格式串** —— 它是解析契约（`BRANCH_LINE`），
改格式就是改解析器。

**Task 2 实施时已实测确认（以此为准）**：`git branch -a --format=<BRANCH_FORMAT>` 的真实输出是
` |feature|` / `*|main|[ahead 1]` / ` |origin/feature|` / ` |origin/main|` —— 远程分支行与
本地行格式完全一致，`parseGitBranches` **不改正则**就正确解析成
`{ name: "origin/main", current: false, ahead: 0, behind: 0 }`。detached 哨兵名的真实字面是
`"(HEAD detached)"`（`startsWith("(HEAD detached")` 能命中）。

### 2.3 分支行派生

```ts
export interface BranchRow {
  name: string
  current: boolean
  count?: string
}

export function deriveBranchRows(branches: GitBranch[]): BranchRow[] {
  return branches.map((branch) => ({
    name: branch.name,
    current: branch.current,
    // 领先/落后每个分支都画:`%(upstream:track)` 是按行取的,远程分支没有上游,自然是 0 不画。
    // 当前分支的 ↑N 和状态面板分支行重复是故意的 —— 两处回答的是不同问题(全局 vs 这一行)。
    count: trackCount(branch.ahead, branch.behind),
  }))
}
```

**贮藏与提交都不写派生函数**：`GitStashEntry`（`{ ref, message }`）和 `GitCommitRow`
本身已经是行。为它们各写一个纯搬字段的 `derive*Rows` 是 no-op，只会造出两个真相源
（计划 1 对派生函数的定位是「把 git 原始输出翻成可渲染的行」，见 `state.ts:1-5`）。

### 2.4 分支差异

在 `src/util/git-diff.ts` 末尾追加：

```ts
/**
 * 分支相对当前分支的差异(规格 L90)。
 *
 * 用三点 `cur...name`:它取的是「name 独有的改动」,正是「这个分支比当前多做了什么」。
 * 两点 `cur..name` 会把当前分支独有的提交也画进来 —— 那部分噪音会把差异撑得没法定位。
 * 返回空串而不是 undefined,和 loadFilePatch / loadCommitPatch 的口径一致,
 * 调用方(diff-panel)按「空串 = 无内容」统一处理。
 */
export function loadBranchPatch(rootPath: string, name: string, current?: string): Promise<string> {
  if (!current || current === name || current.startsWith("(HEAD detached")) return Promise.resolve("")
  return gitExec(rootPath, ["diff", "--no-color", `${current}...${name}`]).then((out) => out.stdout.trimEnd())
}
```

`(HEAD detached)` 是 `parseGitBranches` 为 detached 状态造的哨兵名（`git-status.ts:166`），
它不是引用，喂给 `git diff` 必然报错。

### 2.5 测试

- `parseCommitRows`：正常两行；主题里带 `|`（三段不被切散）；空串与不足三段的行被丢弃。
- `deriveBranchRows`：有上游差异的行带 `↑N ↓N`；ahead/behind 都 0 的行 `count` 是 `undefined`；
  `current` 原样传递。
- `loadBranchPatch`：用 `test/fixture/fixture.ts` 的 `tmpdir` 建真仓库，两个分支各一个提交，
  断言差异里**只有**那个分支独有的文件（负向断言：当前分支的文件不在里面）；
  `current === name` 返回 `""`；`(HEAD detached)` 返回 `""`。
  真 git 临时仓库的脚手架先例：`test/component/git-branch-row.test.tsx`。

验收：新增测试 + `bun test test/component/git-workspace-state.test.ts --timeout 30000` 全绿。

---

## Task 3 —— 三个面板渲染组件

全照 `files-panel.tsx` 的体例：固定行高、行首 `❯ ` 焦点标记、`Locale.truncateToWidth` 截断、
空态用 `fallback`、宽度算式写成显式常量并在注释里对账。

### 3.1 `branches-panel.tsx`

```tsx
// 分支面板:本地与远程分支同列(规格 L69),当前分支标 ●。
// 远程分支保留 git 原本的 `origin/main` 形式,不译成中文 —— 它是要喂给 git 的真实引用。
import { For, Show } from "solid-js"
import { useTheme } from "../../context/theme"
import { Locale } from "../../util/locale"
import type { ArmedConfirm } from "./confirm"
import type { BranchRow } from "./state"

export interface BranchesPanelProps {
  rows: BranchRow[]
  selected: () => number
  /** 确认态;非 undefined 时焦点行显示确认文案而不是分支名。 */
  armed?: ArmedConfirm
  width: number
}

export function BranchesPanel(props: BranchesPanelProps) {
  const { theme } = useTheme()
  // 一行固定开销:左内边距 1 + 标记 2,剩下全给分支名(可能带 ↑N ↓N 计数)。
  const nameWidth = () => Math.max(4, props.width - 1 - 2)

  return (
    <box flexDirection="column" flexGrow={1} minHeight={0}>
      <Show
        when={props.rows.length > 0}
        fallback={
          <box paddingLeft={3}>
            <text fg={theme.textMuted}>（暂无）</text>
          </box>
        }
      >
        <For each={props.rows}>
          {(row, index) => {
            const isFocused = () => index() === props.selected()
            const showingConfirm = () => isFocused() && props.armed !== undefined
            return (
              <box flexDirection="row" paddingLeft={1}>
                {/* 当前分支的 ● 优先于焦点标记:切完分支焦点还在这一行,两个标记抢一格会互相挤掉。 */}
                <text fg={row.current ? theme.primary : isFocused() ? theme.primary : theme.textMuted} wrapMode="none">
                  {row.current ? "● " : isFocused() ? "❯ " : "  "}
                </text>
                <Show
                  when={showingConfirm()}
                  fallback={
                    <text fg={row.current ? theme.primary : theme.text} wrapMode="none">
                      {Locale.truncateToWidth(row.name, nameWidth())}
                    </text>
                  }
                >
                  <text fg={theme.warning} wrapMode="none">
                    {Locale.truncateToWidth(props.armed?.label ?? "", props.width - 3)}
                  </text>
                </Show>
                <Show when={row.count}>
                  <box paddingLeft={1}>
                    <text fg={theme.textMuted} wrapMode="none">
                      {row.count}
                    </text>
                  </box>
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

`（暂无）` 是全角括号，和规格 L80 的字面文案一致（贮藏面板同样用全角）。
`Locale.truncateToWidth` 的用法与参数顺序照 `files-panel.tsx:66`。

### 3.2 `commits-panel.tsx`

```tsx
// 提交面板:短哈希 + 提交主题(规格 L74)。完整哈希在剪贴板里,画进来太占宽。
import { For, Show } from "solid-js"
import { useTheme } from "../../context/theme"
import { Locale } from "../../util/locale"
import type { GitCommitRow } from "./state"

const HASH_WIDTH = 8

export interface CommitsPanelProps {
  rows: GitCommitRow[]
  selected: () => number
  width: number
}

export function CommitsPanel(props: CommitsPanelProps) {
  const { theme } = useTheme()
  const subjectWidth = () => Math.max(4, props.width - 1 - 2 - HASH_WIDTH - 1)

  return (
    <box flexDirection="column" flexGrow={1} minHeight={0}>
      <Show
        when={props.rows.length > 0}
        fallback={
          <box paddingLeft={3}>
            <text fg={theme.textMuted}>（暂无提交）</text>
          </box>
        }
      >
        <For each={props.rows}>
          {(row, index) => {
            const isFocused = () => index() === props.selected()
            return (
              <box flexDirection="row" paddingLeft={1}>
                <text fg={isFocused() ? theme.primary : theme.textMuted} wrapMode="none">
                  {isFocused() ? "❯ " : "  "}
                </text>
                <text fg={isFocused() ? theme.primary : theme.text} wrapMode="none">
                  {row.hash} {Locale.truncateToWidth(row.subject, subjectWidth())}
                </text>
              </box>
            )
          }}
        </For>
      </Show>
    </box>
  )
}
```

短哈希是 git 给的 `%h`，长度可能不足 8（浅仓库），所以 `HASH_WIDTH` 是**最坏情况的上限**，
截断按它算，宁可少画一列，也不要让主题顶破右边框。

### 3.3 `stash-panel.tsx`

```tsx
// 贮藏面板:`stash@{0}` + 说明(规格 L79)。空时显示（暂无）。
import { For, Show } from "solid-js"
import { useTheme } from "../../context/theme"
import { Locale } from "../../util/locale"
import type { ArmedConfirm } from "./confirm"
import type { GitStashEntry } from "../../util/git-status"

export interface StashPanelProps {
  rows: GitStashEntry[]
  selected: () => number
  armed?: ArmedConfirm
  width: number
}
```

行结构与 `BranchesPanel` 同构（标记 2 列 + ref + 主题），ref 用 `Locale.truncateToWidth(ref, 12)`
后接说明，空态 `（暂无）`，确认态同 `BranchesPanel` 的 `showingConfirm` 分支。
**不要**把 ref 和说明合成一个 `<text>` 再用空格分隔 —— 两者都要独立截断，合起来截会把
`stash@{0}` 截断成 `stash@{`，而 ref 是喂给 `git stash pop` 的引用，截断就没意义了。

### 3.4 测试

每个面板一个测试文件（`test/component/git-workspace-branches-panel.test.tsx` 等），
照 `test/component/git-workspace-test.tsx` 的脚手架：固定 width 渲染 + `captureCharFrame`。

- 分支面板：三行（含一个 `current: true`、一个带 `count: "↑3 ↓1"`）→ 断言字符帧里
  有 `●`、有焦点标记、截断后的长分支名不撑破 36 列；空数组 → 断言 `（暂无）`。
- 提交面板：哈希 + 主题两行对齐；长主题被截断；空数组 → `（暂无提交）`。
- 贮藏面板：ref 完整可见（`stash@{0}` 不被截）；确认态时焦点行显示确认文案而不是 ref；空 → `（暂无）`。
- 三个面板都断言**36 列契约**：面板渲染在最宽 36 列的容器里，字符帧的每行不超出宽度。

验收：三个新测试文件 + 既有渲染测试全绿。

---

## Task 4 —— 行内输入组件（`inline-input.tsx`）

三处共用：提交信息、新建分支、添加远程（规格 L141）。差别只在标题、占位符和回调。

### 4.1 技术选型（先读先例，别自己发明）

`src/ui/dialog-prompt.tsx` 是本仓库唯一已验证的文本输入实现，照抄它的三件事：

1. **用 `<textarea height={1} wrapMode="none">`**，`ref` 类型 `TextareaRenderable`
   （`import { TextareaRenderable } from "@opentui/core"`）。不要改写成 `<input>`：
   `<input>` 的 ref 类名在类型定义里未必是 `TextareaRenderable`，换掉会引入新未知量，
   而 `textarea` + `height={1}` + `wrapMode="none"` 已经是仓库里跑通的路子。
2. **挂载后聚焦要隔一帧**：`onMount` 里 `setTimeout(() => textarea.focus(), 1)`，
   并先判 `textarea.isDestroyed`（`dialog-prompt.tsx:49-57`）。直接 `focus()` 可能早于
   renderable 挂到 renderer 上，焦点丢了用户只能看到空占位符。
3. **键位走 keymap 层，不走 `onSubmit`**：`onSubmit` 的事件类型是**空接口**
   （`node_modules/@opentui/core/renderables/Textarea.d.ts` 的 `SubmitEvent`），
   拿不到文本，还得靠 ref 反查；而且它是否触发依赖 keymap 的输入绑定配置
   （`input_submit` / `input_newline`，见 `test/cli/tui/dialog-prompt.test.tsx:99-101`）。
   keymap 层是确定性的。**keymap 的键名词汇和 opentui 事件名不一样**：
   keymap 把 `return` 规范成 `enter`、`shift+tab` 拼成 `shift+tab`
   （见 `focus.ts:4-6` 的注释），所以绑定写 `enter` / `esc`，**不是** `return` / `escape`。

### 4.2 代码

```tsx
// 行内输入:在左列底部展开一行,enter 确认 / esc 取消。
// 提交信息、新建分支、添加远程三处共用(规格 L141),差别只在标题和回调。
// 不用弹窗组件:弹窗会打断键盘流,而这套交互的核心就是单手走完全程(见 confirm.ts 头注释)。
import { TextareaRenderable } from "@opentui/core"
import { createSignal, onMount } from "solid-js"
import { useTheme } from "../../context/theme"
import { useBindings } from "../../keymap"
import { Locale } from "../../util/locale"

export interface InlineInputProps {
  /** 行首的标签,例如「提交信息」。 */
  title: string
  placeholder?: string
  initialValue?: string
  /** 面板内容可用宽度(已扣左右各 1 列边框)。 */
  width: number
  /** 内容为空时不触发(空提交信息、空分支名、空远端地址都没有意义)。 */
  onConfirm: (value: string) => void
  onCancel: () => void
}

const TITLE_WIDTH = 8

export function InlineInput(props: InlineInputProps) {
  const { theme } = useTheme()
  const [target, setTarget] = createSignal<TextareaRenderable>()
  let input: TextareaRenderable

  const submit = () => {
    // 去空格再判空:纯空格提交会被 git 当成合法参数(带一个空标题),行为难解释。
    const value = input.plainText.trim()
    if (value.length === 0) return
    props.onConfirm(value)
  }

  // 键位用 keymap 层而不是 textarea 的 onSubmit,理由见本文件头注释(SubmitEvent 是空接口)。
  // target + enabled + priority:1 的组合照 dialog-prompt.tsx:33-47 —— priority 1 保证
  // 这一层赢过全局托管输入层,否则 enter 会被当成换行吃下去。
  useBindings(() => ({
    // ⚠️ 必须传 signal 本身,不是 target() —— UseBindingsTarget 的类型是
    // () => Renderable | null | undefined,传值直接 typecheck 失败。
    // 已落地代码把信号命名为 textareaTarget,避免 `target: target` 这种自指写法。
    target: target,
    enabled: target() !== undefined,
    priority: 1,
    bindings: [
      { key: "enter", desc: "确认", group: "行内输入", cmd: submit },
      { key: "esc", desc: "取消", group: "行内输入", cmd: props.onCancel },
    ],
  }))

  onMount(() => {
    setTimeout(() => {
      if (!input || input.isDestroyed) return
      input.focus()
    }, 1)
    input.gotoLineEnd()
  })

  return (
    <box flexDirection="row" flexShrink={0} paddingLeft={1} gap={1} paddingTop={1}>
      <text fg={theme.primary} wrapMode="none">
        {Locale.truncateToWidth(props.title, TITLE_WIDTH)}：
      </text>
      <textarea
        height={1}
        wrapMode="none"
        width={Math.max(8, props.width - 1 - TITLE_WIDTH - 2)}
        initialValue={props.initialValue}
        placeholder={props.placeholder}
        placeholderColor={theme.textMuted}
        textColor={theme.text}
        focusedTextColor={theme.text}
        cursorColor={theme.primary}
        ref={(val: TextareaRenderable) => {
          input = val
          setTarget(val)
        }}
      />
    </box>
  )
}
```

`gotoLineEnd()` 与 `height={1}` 的组合：光标从 0 位开始也能用，但如果有 `initialValue`
（本版没有用到，留着 prop 以防后续补「改提交信息」），光标停在行尾才符合直觉。

### 4.3 规格偏差（要知会用户）

规格 L139 写「内容过长自动换行」。本实现是**单行不换行**（`height={1}` + `wrapMode="none"`）：
「左列底部展开**一行**」和「自动换行」本身矛盾，单行更贴近 L139 的形态描述。
**验收时如果用户认为必须真换行**，把 `height` 改成 2 并删掉 `wrapMode="none"` ——
一行改动，其余逻辑不受影响。

### 4.4 测试

`test/component/git-workspace-inline-input.test.tsx`。**照抄 `test/cli/tui/dialog-prompt.test.tsx`
的整套 harness**，那是仓库里唯一能驱动文本输入的脚手架：

- `createDefaultOpenTuiKeymap(renderer)` + `createTuiResolvedConfig(...)` + `registerNovaWayKeymap`
  - `onCleanup(off)`；
- 外层 `<TestTuiContexts directory paths>`（`test/fixture/tui-environment.ts`）里套
  `<NovaWayKeymapProvider>` → `<TuiConfigProvider>` → `<KVProvider>` → `<ThemeProvider mode="dark">`；
- `await testRender(() => <Harness />, { kittyKeyboard: true })`（`kittyKeyboard: true` 必须有，
  否则方向键 / enter 的解析和真机不一致）；
- `test/cli/**` 的 fixture 路径是 `../../fixture/...`，`test/component/**` 是 `../fixture/...`，
  搬文件时改一层；
- 等焦点：`await wait(() => app.renderer.currentFocusedEditor instanceof TextareaRenderable)`，
  `wait` 的写法见该文件第 14-20 行；
- 拆掉：`app.renderer.destroy()`。

用例：

1. **enter 提交**：`mockInput.pressKey("a")` / `pressKey("b")` / `pressEnter()` →
   `onConfirm` 收到 `"ab"`，断言 `textarea.plainText === "ab"`。
2. **esc 取消**：`mockInput.pressKey("q", { shift: true })` 之类构造 esc 前先确认按键名；
   取消后 `onConfirm` 没被调用，`onCancel` 被调用。
3. **空内容不提交**：直接 `pressEnter()` → `onConfirm` 没被调用（`submit` 里的 trim 判空）。
4. **首帧渲染**：字符帧里有标题标签和冒号（用 `captureCharFrame` 断言）。

### 4.5 已验证的两个不确定点（Task 4 实施时已落实，以此为准）

1. **esc 的键名：写 `esc` 即可**。`src/keymap.tsx:113-118` 的 `KEY_ALIASES` 把 `esc` → `escape`、
   `enter` → `return`、`pgup` → `pageup`、`pgdown` → `pagedown`，由 `registerKeyAliases` 在
   `registerNovaWayKeymap`（约 218 行）注册成 `appendBindingExpander`，**在注册阶段**就展开。
   所以 `esc` 与 `escape` 命中同一个键位，**不需要绑两份**。同理 enter 写 `enter`。
   旁证：`focus.ts` 的 `keyOfParsed` 注释与 `test/component/git-workspace-key.test.ts`。
2. **`useBindings` 的 `target` 必须传 signal（函数），不是值**。依据
   `@opentui/keymap/src/solid/index.d.ts:10-14`：`Layer.target` 被 `Omit` 掉后按函数类型重新加回。
   计划初稿写的 `target: target()` 是 bug。已落地代码与 `dialog-prompt.tsx:34` 逐字一致。

另外三个实施时才查清的事实：

- `TextareaRenderable` 的 `plainText` / `traits` / `gotoLineEnd(options?)` / `focus()` / `isDestroyed`
  全部真实存在（分别在 `EditBufferRenderable.d.ts` 与 `Renderable.d.ts`），无需变通。
  计划 4.1 第 3 条对 `SubmitEvent` 是空接口的判断准确（`Textarea.d.ts:12-13`）。
- **按键后不需要 `await app.flush()`**。`mockInput` 派发 + keymap 派发 + 命令回调在这一层是同步的，
  断言的是 `plainText` 和 JS 数组而不是渲染帧，多余的 `await` 只是拖慢测试。
- `test/fixture/providers.tsx` 的 `ThemeTestProviders` **不含 `NovaWayKeymapProvider`**，
  任何要用 `useBindings` 的组件都测不了它 —— 文本输入类测试必须自建 provider 链，别复用那个便捷封装。
- fixture 扩展名是 **`tui-environment.tsx`**，不是 `.ts`。

验收：新增测试全绿，且用例 1 不是靠 `onSubmit` 兜底通过的（确认绑定真的命中）。

---

## Task 5 —— 外壳接线：三个面板渲染

本任务只做**渲染**（数据出来、能选行、不越界），操作在 Task 6-8。
拆开是有意的：渲染接线涉及游标信号、clamp、`For`/`Show` 布局，是纯结构改动；
混进操作逻辑会让单测一次测两件东西，红了不知道红在哪。

### 5.1 新信号与派生

```ts
const [branchRow, setBranchRow] = createSignal(0)
const [stashRow, setStashRow] = createSignal(0)

const branchRows = createMemo(() => deriveBranchRows(data()?.branches ?? []))
const commitRows = createMemo(() => data()?.commits ?? [])
const stashRows = createMemo(() => data()?.stash ?? [])
```

**提交面板继续复用 `fileRow`**（计划 1 已经这么做，见 `git-workspace.tsx:147` 注释）。
提交和文件共用一个游标不优雅，但两者的行数不同、面板不同时显示，复用不会互相影响；
换成独立 `commitRow` 要多写一个信号 + 一个 clamp effect，收益只有整齐。留着，计划 3 一起收拾。

### 5.2 `moveRow` 与 clamp

`moveRow` 加两个分支（保持无 `else` 的提前 return 风格）：

```ts
if (panel() === "branches") return setBranchRow((n) => clamp(n + delta, 0, branchRows().length - 1))
if (panel() === "commits") return setFileRow((n) => clamp(n + delta, 0, commitRows().length - 1))
```

再补两个 clamp effect，照抄 `git-workspace.tsx:149-156` 的两段：

```ts
createEffect(() => {
  const max = Math.max(0, branchRows().length - 1)
  if (branchRow() > max) setBranchRow(max)
})
createEffect(() => {
  const max = Math.max(0, stashRows().length - 1)
  if (stashRow() > max) setStashRow(max)
})
```

`clamp` 已经处理 `max < min`（空列表时 `0 - 1 = -1 < 0`，`clamp` 返回 0），所以空面板按
`j` 不会出负数 —— 这个行为别改，它是空面板能按 `j` 而不崩的前提。

### 5.3 渲染

在 `git-workspace.tsx:328-335` 的 `<Show when={id === "files"}>` 之后，同样用 `Show` 追加分支 /
提交 / 贮藏三块（**必须 `Show`，不能用条件表达式**：计划 1 已确认裸 `if` 在 `For` 里会
把 `PanelFrame` 挤成只有一个子节点）。三块都传 `width={leftWidth() - 2}`：

```tsx
<Show when={id === "branches"}>
  <BranchesPanel
    rows={branchRows()}
    selected={() => (panel() === "branches" ? branchRow() : -1)}
    width={leftWidth() - 2}
  />
</Show>
<Show when={id === "commits"}>
  <CommitsPanel
    rows={commitRows()}
    selected={() => (panel() === "commits" ? fileRow() : -1)}
    width={leftWidth() - 2}
  />
</Show>
<Show when={id === "stash"}>
  <StashPanel
    rows={stashRows()}
    selected={() => (panel() === "stash" ? stashRow() : -1)}
    width={leftWidth() - 2}
  />
</Show>
```

`selected` 是函数 `() => number`，非当前面板返回 `-1` —— 和 `FilesPanel` 的口径一致
（`-1` 意味着没有任何行带焦点标记），否则切走焦点后旧面板还亮着一行。

### 5.4 测试

`test/component/git-workspace.test.tsx` 追加用例（**不要新建文件**，那里已经有
`GitWorkspace` 的完整脚手架和 36 列契约断言）。用真 git 临时仓库当 `rootPath`
（`test/fixture/fixture.ts` 的 `tmpdir`，脚手架先例 `test/component/git-branch-row.test.tsx`）：

1. 一个仓库，准备：两个提交、两个分支、一个 stash（`git stash` 前先 `git add` + 改动）。
2. 固定 width（≥80 列）渲染，`captureCharFrame` 断言：当前分支名出现且带 `●`、
   提交短哈希出现、`stash@{0}` 出现。
3. 按 `4`（`panel.jump:3` = 提交面板）→ 断言焦点标记移到提交行。
4. **空仓库**（`git init` 后不提交）：断言字符帧里有 `（暂无提交）`，并且不崩、
   布局仍是 36 列。
5. **断言非当前面板的旧焦点不残留**：切到提交面板后再看分支面板，分支行不应该带焦点标记。

验收：新用例 + 既有 `git-workspace.test.tsx` 全绿；`bun typecheck` exit 0。

### 5.5 Task 5 实施时补记的三件事（以此为准）

1. **5.2 漏了 stash 分支**（已补）：贮藏面板同样要能选行，`moveRow` 必须有
   `panel() === "stash"` 分支。计划初稿只给了 `branches` 和 `commits` 两个 —— 少了贮藏，
   贮藏面板就只能在第一行空转。属移动光标，不是操作逻辑，所以归本任务。
2. **`fileRow` 复用的已知冲突（留给计划 3）**：既有的 clamp effect 用 `fileRows().length - 1`
   夹 `fileRow`，而提交面板也复用 `fileRow`。文件表只有 1 行、提交表有 40 行时，用户在提交面板
   选到第 5 行，一次后台 refresh 就会把它夹回 0 —— **提交选中行被文件表长度误夹**。
   `moveRow` 已按各自的表算上限，clamp 的分流留给计划 3（换独立 `commitRow`）一起收拾。
   这条要记着，否则用户会看到「我刚选的那行怎么跳回去了」。
3. **`armed` 还没传给分支 / 贮藏面板**：`run()` 里 `branches.delete` / `stash.discard`
   已经是 `DANGEROUS_COMMANDS`，按了会 `setArmed`，但 Task 5 不传 `armed`，所以确认文案
   目前**只显示在底部键位条**，面板内不显示。Task 7 必须顺手补 `armed={armed()}`，
   否则用户看不出「再按一次确认的是哪一行」。

---

## Task 6 —— 外壳接线：状态行分派 + 基础操作 + 测试脚手架

### 6.1 先建共享测试脚手架（Task 7-10 都会用）

**✅ 前置探针不需要了**（Task 5 实施时推翻了本节的假设）：
`test/component/git-workspace-clamp.test.tsx` **就是**「挂载 GitWorkspace + 注入按键 + 读字符帧」
的完整先例，写法是 `renderer.keyInput.emit("keypress", new KeyEvent(...))` + 轮询帧；
实测数字键 `3` / `4` 能穿透 keymap 层进到 `useKeyboard`（TuiKeybind 没有数字键绑定）。
所以可以直接照抄它沉淀成 `test/component/git-workspace-harness.ts`，不必再写探针验证可行性。

> 原计划这里写「本仓库目前没有任何先例，先写探针，打不通就停下来问用户」。那个前提不成立，
> 保留这段说明是为了记录为什么不再需要探针 —— 别再去重复验证一遍。

把脚手架沉淀成 `test/component/git-workspace-harness.ts`（直接照抄 `git-workspace-clamp.test.tsx`
的挂载与按键写法）：

```ts
/**
 * GitWorkspace 的测试挂载器。provider 栈照抄 test/cli/tui/dialog-prompt.test.tsx:
 * 全套都要(NovaWayKeymapProvider 给 useBindings 用,KVProvider 需要 state/kv.json 存在),
 * 少一层就报 context 缺失。
 */
export async function mountWorkspace(options: { root: string; width?: number; onClose?: () => void })
```

导出 `{ app, pressKey, frame, cleanup }`：`pressKey(name, { ctrl?, shift? })` 内部
`app.mockInput.pressKey(...)` 后再 `waitForFrame()`；`frame()` 返回 `captureCharFrame()`；
`cleanup()` 调 `app.renderer.destroy()`。

**断言异步 git 结果一律用轮询**（`wait(() => <读 git 输出判断>, 3000)`，写法照抄
`dialog-prompt.test.tsx:14-20`），**不要用固定 `sleep`** —— 仓库里 `test/AGENTS.md` 明确禁止。

### 6.2 行内输入的状态（先声明，Task 8 才用）

```ts
/** 行内输入的三种触发来源(规格 L141:三处共用同一个组件)。 */
type InlineInputRequest = { kind: "commit" } | { kind: "branch-new" } | { kind: "remote-add" }

const [inlineInput, setInlineInput] = createSignal<InlineInputRequest | undefined>(undefined)

/** 打开左列底部的行内输入。开输入框是明确的「改主意」:任何待确认态到此作废。 */
const openInput = (request: InlineInputRequest) => {
  confirm.clear()
  setArmed(undefined)
  setInlineInput(request)
}
```

放在 `armed` 信号后面（`git-workspace.tsx:57` 附近）。Task 8 会把它接上 `<InlineInput>`；
在 Task 8 之前它只是设了一个没人读的信号，typecheck 照样过。

**差异激活模式的状态也在这里一起声明** —— Task 6.4 的 `focusPanel` 就要调它，
声明晚了 `run` 闭包里找不到这个绑定：

```ts
const [diffFocus, setDiffFocus] = createSignal(false)
```

### 6.3 切换远端

把 `git-workspace.tsx:238-245` 那段 `status.space || status.m` 替换成（两个命令分开，
因为它们不再是同一个动作）：

```ts
const switchRemote = () => {
  const list = data()?.remotes ?? []
  if (list.length === 0) return openInput({ kind: "remote-add" })
  // 切换本身不执行任何 git 命令,只改选中状态(规格 L147):推送/拉取时才用它。
  const index = list.findIndex((item) => item.name === remote())
  setRemote(list[(index + 1) % list.length]?.name)
}

if (command === "status.m") return switchRemote()
if (command === "status.space") {
  // 空格按当前行分派(规格 L49-51):分支行跳面板、远程行切远端、变更行全暂存/全取消。
  // 「提示」行(spec L52)不做任何事 —— 空格落在这一行时静默,而不是报一条没用的提示。
  const row = statusRows()[statusRow()]
  if (!row) return
  if (row.kind === "branch") return focusPanel("branches")
  if (row.kind === "remote") return switchRemote()
  if (row.kind === "changes") {
    // 有未暂存改动就全暂存,一个都没有就全取消 —— 同一个键在两种状态下互为逆操作(规格 L51)。
    const unstaged = (data()?.status.entries ?? []).some((entry) => entry.unstaged)
    return unstaged ? runGit(["add", "-A"]) : runGit(["restore", "--staged", "--", "."])
  }
}
```

无远端时**不提示**而是直接开输入框：规格 L56 就是这么要求的，「未配置远端」这一行本来
就是给一个可点（可按键）的入口。

### 6.4 基础操作

`focusPanel` / `switchRemote` / `dangerTarget` 这类 helper 统一放在 `run` **之前**
（和 `moveRow` 挨着），`run` 里的分支只留一两行 —— 计划 1 已经确认 `run` 是这套交互
唯一的汇聚点，长到一个函数里读不下去。

```ts
const focusPanel = (id: PanelID) => {
  // 切面板同时退出差异激活模式(Task 9):两个面板不能同时「有焦点」,
  // 否则差异模式下 tab 之后 j/k 还在滚动差异而不是移动行。
  setDiffFocus(false)
  setPanel(id)
}

if (command === "branches.checkout") {
  const row = branchRows()[branchRow()]
  if (!row || row.name.startsWith("(HEAD")) return // detached 的哨兵行不是引用,切过去必然报错
  // 远程分支(带 /)也直接 switch:git 会给它建一个本地跟踪分支。失败时 runGit 写提示行,
  // 不比我们自己判一遍本地是否已存在更糟 —— 而自己判就有两套真相源。
  return runGit(["switch", row.name])
}
if (command === "branches.new") return openInput({ kind: "branch-new" })
if (command === "commits.undo") {
  if ((data()?.commits.length ?? 0) === 0) return
  // 规格 L75:只回退最近一次提交到暂存区,不做 Lazygit 那种操作级撤销栈。
  return runGit(["reset", "--soft", "HEAD~1"])
}
if (command === "stash.pop") {
  const row = stashRows()[stashRow()]
  if (!row) return
  return runGit(["stash", "pop", row.ref])
}
```

`focusPanel` 也顺手用于 `panel.jump`：把 `git-workspace.tsx:181` 改成
`if (command.startsWith("panel.jump:")) return focusPanel(panelAt(Number(command.slice(7))))`。

### 6.5 测试

用 6.1 的脚手架，**每个用例一个真 git 临时仓库**（脚手架先例 `test/component/git-branch-row.test.tsx`）：

1. **status.space 分派**：三个子用例 —— 选中分支行按 ` ` 后焦点在分支面板；
   两个远端（`git remote add` 加一个假的本地路径远端）选中远程行按 ` ` 后 status 行的远端名变了；
   选中变更行按 ` ` 后 `git status --porcelain` 显示全部 staged。
2. **commits.undo**：三个提交，按 `4` 再按 `z`，轮询 `git log --oneline` 从 3 条变 2 条，
   且 `git status` 显示之前的改动回到暂存区。
3. **stash.pop**：造一个 stash，按 `5` 再按 ` `，轮询 `git stash list` 变空、工作区有该改动。
4. **branches.checkout**：两个分支，按 `3` + `j` 移到另一行 + ` `，轮询 `git branch --show-current`。
5. **branches.new**：按 `n` → 断言字符帧出现「新分支」标题（此时还没接 `<InlineInput>`，
   Task 8 才补这个断言，所以本用例只断言信号不崩；**Task 8 会升级成端到端**）。

验收：新用例全绿 + `bun typecheck` exit 0。**探针打不通就走 6.1 的分支，先问用户。**

---

## Task 7 —— 危险操作扩展到分支与贮藏

### 7.1 目标联合

`ArmedConfirm` 的 `target` 只有一个，但「这一行确认的是文件、分支还是贮藏」必须跟着命令一起
存下来 —— 否则 `d` 在分支面板武装后，文件面板也会亮出黄条（计划 1 已经踩过「armed 画错行」的坑）。

```ts
/** 危险操作拍板的目标。三种形状合成一个联合,联合成员的判别键就是面板归属。 */
type ArmedTarget = { file: string } | { branch: string } | { ref: string }
```

`confirm` 与 `armed` 的泛型跟着改：

```ts
const confirm = createConfirm<ArmedTarget>(() => Date.now())
const [armed, setArmed] = createSignal<ArmedConfirm<ArmedTarget> | undefined>(undefined)
```

### 7.2 拍板与拒绝

替换 `git-workspace.tsx:192-200` 那段：

```ts
/**
 * 危险操作的「不许做」前置检查。返回非空文案就写进提示行 ——
 * 静默拒绝会让人以为按了没生效然后去按别的键,比提示更糟。
 *
 * 当前分支的删除在这里挡,而不是让 git 报错:git 会拒绝,但 hintFromError 只会翻译成
 * 一句「git 执行失败」,用户看不出到底为什么不能删。
 */
const blockedDanger = (command: WorkspaceCommand): string | undefined => {
  if (command !== "branches.delete") return undefined
  const row = branchRows()[branchRow()]
  if (!row) return undefined
  if (row.current || row.name.startsWith("(HEAD")) return "当前分支不能删除"
}

/** 目标在武装瞬间拍板(计划 1 已有这条理由:武装到 fire 之间列表可能被后台刷新换掉)。 */
const dangerTarget = (command: WorkspaceCommand): ArmedTarget | undefined => {
  if (command === "files.discard" || command === "files.delete") {
    const row = fileRows()[fileRow()]
    return row ? { file: row.file } : undefined
  }
  if (command === "branches.delete") {
    const row = branchRows()[branchRow()]
    return row && !row.current ? { branch: row.name } : undefined
  }
  if (command === "stash.discard") {
    const row = stashRows()[stashRow()]
    return row ? { ref: row.ref } : undefined
  }
  return undefined
}
```

危险分支里：

```ts
if (DANGEROUS_COMMANDS.has(command)) {
  const blocked = blockedDanger(command)
  if (blocked) return setActionHint(blocked)
  const target = dangerTarget(command)
  const result = confirm.press(command, dangerLabel(command), target)
  setArmed(confirm.pending())
  if (result !== "fire") return
}
```

`DANGEROUS_COMMANDS` 已经含 `branches.delete` / `stash.discard`（`focus.ts:120-125`），
`dangerLabel` 已有这两个分支（`git-workspace.tsx:400`），都不用动。

### 7.3 armed 的分派（别把文件的黄条画到分支面板上）

```ts
/** 只把「属于这个面板」的确认态交给对应面板渲染;联合的判别键就是面板归属。 */
const armedFor = (kind: "file" | "branch" | "ref") => {
  const current = armed()
  const target = current?.target
  return target && kind in target ? current : undefined
}
```

**这一处会改掉 Task 5 写的内容**：

- `<FilesPanel armed={armed()}>` → `armed={armedFor("file")}`
- `<BranchesPanel ... armed={armedFor("branch")}>`
- `<StashPanel ... armed={armedFor("ref")}>`

### 7.4 fire 的执行

```ts
if (command === "branches.delete" || command === "stash.discard") {
  // 和 files.* 同理:按武装时拍下的目标执行,不重读选中行。
  const target = confirm.takeFiredTarget()
  if (!target) return
  if (command === "branches.delete") {
    if ("branch" in target) runGit(["branch", "-D", target.branch])
    return
  }
  if ("ref" in target) runGit(["stash", "drop", target.ref])
}
```

### 7.5 测试

1. 分支面板按 `d` → 字符帧出现「再按一次 d 删除这个分支」；再按 `d` → 轮询 `git branch` 该分支消失。
2. 贮藏面板按 `d` → 出现确认文案 → 再按 `d` → `git stash list` 变短。
3. **当前分支不能删**：在当前分支按 `d` → 提示行出现「当前分支不能删除」，且没进确认态
   （断言字符帧里没有「再按一次」）。
4. **armed 隔离**：切到分支面板按 `d`（只武装，不 fire），断言**文件面板的行里没有**确认文案；
   反向再验一次（文件面板武装 `d`，分支面板行不含确认文案）。
5. **3 秒超时**：用假时钟（`createConfirm` 的 `now` 注入）验证 `armed` 自动清掉。

---

## Task 8 —— 行内输入接线（提交 / 新建分支 / 添加远程）

### 8.1 渲染

在 `PANEL_ORDER` 的 `<For>` 之后、`PanelFrame` 那列的底部（`git-workspace.tsx:338` 之后）：

```tsx
<Show when={inlineInput() !== undefined}>
  <InlineInput
    title={inputSpec().title}
    placeholder={inputSpec().placeholder}
    width={leftWidth() - 2}
    onConfirm={confirmInput}
    onCancel={() => setInlineInput(undefined)}
  />
</Show>
```

```ts
const inputSpec = createMemo(() => {
  const kind = inlineInput()?.kind
  if (kind === "commit") return { title: "提交信息", placeholder: "" }
  if (kind === "branch-new") return { title: "新分支", placeholder: "" }
  return { title: "远端地址", placeholder: "git@host:org/repo.git" }
})
```

标题只取 `inputSpec()` 而不是 `inlineInput()?.kind` 内联三元 —— `createMemo` 保证三种来源
共用同一份文案表，不会出现「提交输入框的占位符写成了分支名」这种错配。

### 8.2 确认回调

```ts
const confirmInput = (value: string) => {
  const kind = inlineInput()?.kind
  // 先关输入框再跑命令:提交失败时若输入框还开着、文案还在,用户会以为「还没提交」而重按 enter,
  // 而那时输入框已经关了,行为不一致。关框是无副作用的,先做。
  setInlineInput(undefined)
  if (kind === "commit") return runGit(["commit", "-m", value])
  if (kind === "branch-new") return runGit(["branch", value])
  // 添加远程没有「目标远端」的概念,固定叫 origin:没有远端才会走到这里(见 switchRemote),
  // 所以 origin 一定空闲,不需要查重名。
  return runGit(["remote", "add", "origin", value])
}
```

### 8.3 提交键

替换 `git-workspace.tsx:254-265` 那段占位：

```ts
if (command === "global.commit") {
  // 两种情况都要有回音:早先版本只在没暂存内容时提示,已暂存时按 c 毫无反应 ——
  // 用户照提示暂存完,按下去却什么都没有,比不放这个键还糟(计划 1 审查时已修过一次)。
  if (!(data()?.status.entries ?? []).some((entry) => entry.staged)) {
    return setActionHint("没有可提交的暂存内容")
  }
  return openInput({ kind: "commit" })
}
```

### 8.4 测试（把 Task 6 的用例 5 升级成端到端）

1. **提交**：暂存一个文件 → 按 `c` → 字符帧出现「提交信息」→ `pressKey` 打几个字符 →
   `pressEnter()` → 轮询 `git log -1 --format=%s` 等于输入的内容。
2. **空暂存按 c**：字符帧出现「没有可提交的暂存内容」，且没有输入框。
3. **新建分支**：按 `n` → 打字 → enter → 轮询 `git branch --list` 含新分支。
4. **添加远程**：无远端仓库，选中远程行按 ` ` → 出现「远端地址」→ 输入一个假地址 → enter →
   轮询 `git remote -v` 出现 `origin`。
5. **esc 取消**：按 `n` 后按 esc → 输入框消失、没建新分支、可以再按 `n` 重新打开。
6. **打字不误触发命令**：打开输入框后输入 `jkd`（分支名就叫这个）→ enter → 新分支叫 `jkd`，
   且期间没有触发移动光标或进入确认态。这条是行内输入最容易回退的地方，必须有测试。

---

## Task 9 —— 差异激活模式（滚动 / 翻页 / 退回）

### 9.1 `diff-panel.tsx`：加 branch 目标 + 滚动容器

```ts
export type DiffTarget =
  | { kind: "none" }
  | { kind: "file"; path: string }
  | { kind: "commit"; hash: string }
  | { kind: "branch"; name: string }

export interface GitDiffPanelProps {
  target: DiffTarget
  rootPath?: string
  /** 当前分支名。分支差异用它做基准(`cur...name` 的三点差异,见 loadBranchPatch)。 */
  currentBranch?: string
  /** 滚动容器。外壳在差异激活模式下按 j/k/pgup/pgdn 调它,面板自己不动。 */
  scrollRef?: (el: ScrollBoxRenderable | null) => void
}
```

`ScrollBoxRenderable` 从 `@opentui/core` 引入。`load` 的三分支：

```ts
const load =
  target.kind === "file"
    ? loadFilePatch(cwd, target.path)
    : target.kind === "commit"
      ? loadCommitPatch(cwd, target.hash)
      : loadBranchPatch(cwd, target.name, props.currentBranch)
```

标题加一支：`if (target.kind === "branch") return \`分支 ${Locale.truncateToWidth(target.name, 32)}\``。

### 9.2 滚动 API（⚠️ 动手前先读类型定义）

**本计划只给意图，不给 getter 名** —— `scrollBy` / `scrollTop` / 视口高度的确切 API
要看 `node_modules/@opentui/core/renderables/ScrollBox.d.ts`（仓库里没有现成的滚动先例，
计划 1 不需要滚动所以没暴露过这个坑）。意图是：

- `j` 下移 1 行，`k` 上移 1 行；
- `pgdn` 下翻一屏，`pgup` 上翻一屏，**一屏 = 视口高度（行数）**，不要写死 10；
- 越界要 clamp：`scrollTop` 不能超过 `scrollHeight - 视口高度`。若 API 自带 clamp 就用它的，
  没有就自己算；
- 若没有 `scrollBy`，就改写成 `el.scrollTop = clamp(el.scrollTop + n, 0, max)`。

外壳里：

```ts
let scroll: ScrollBoxRenderable | undefined

const scrollBy = (lines: number) => {
  // 没有滚动容器时静默:差异还没选中任何目标(diffTarget 是 none)时按 j/k 不该报错。
  if (!scroll) return
  ...
}
const scrollPage = () => scroll?.视口高度 ?? 0
```

### 9.3 外壳接线

`diffFocus` 信号已在 6.2 声明（`focusPanel` 要用它）。这里把三个 `focusDiff`
命令都改成「设目标 + 进激活模式」：

```ts
if (command === "files.focusDiff") {
  const row = fileRows()[fileRow()]
  if (row) {
    setDiffTarget({ kind: "file", path: row.file })
    setDiffFocus(true)
  }
  return
}
if (command === "commits.focusDiff") {
  const row = commitRows()[fileRow()]
  if (row) {
    setDiffTarget({ kind: "commit", hash: row.hash })
    setDiffFocus(true)
  }
  return
}
if (command === "branches.focusDiff") {
  const row = branchRows()[branchRow()]
  if (row) {
    setDiffTarget({ kind: "branch", name: row.name })
    setDiffFocus(true)
  }
  return
}
```

（顺带修掉计划 1 遗留的 bug：`commits.focusDiff` 原本读 `data()?.commits[fileRow()]`，
用了**文件**面板的游标。）

滚动命令与退回：

```ts
if (command === "diff.scrollUp") return scrollBy(-1)
if (command === "diff.scrollDown") return scrollBy(1)
if (command === "diff.pageUp") return scrollBy(-scrollPage())
if (command === "diff.pageDown") return scrollBy(scrollPage())
if (command === "diff.exit") return setDiffFocus(false)
```

`panel.next` / `panel.prev` 改用 `focusPanel`（Task 6.4 已定义），保证 tab 同时退出差异模式。
`GitDiffPanel` 的调用点补两个 prop：`currentBranch={data()?.status.branch}` 和
`scrollRef={(el) => (scroll = el)}`。

### 9.4 键位拦截重写

替换 `git-workspace.tsx:286-298` 的 `useKeyboard`：

```ts
useKeyboard((event) => {
  // 行内输入开着:任何按键一律放行给输入框(包括 esc —— esc 由 InlineInput 自己的 keymap
  // 层处理,外壳不插手)。**这里绝不能调 resolveWorkspaceCommand**:否则打字会顺手触发命令
  // (d 会进确认态、j 会移动光标),输入框就成了按键地雷。
  if (inlineInput() !== undefined) return

  // 差异激活模式:走自己的键位表,esc 是退回左列不是关工作区,数字键一律不响应(规格 L115)。
  if (diffFocus()) {
    const command = resolveDiffCommand(keyOfParsed(event))
    if (command) {
      event.preventDefault()
      event.stopPropagation()
      run(command)
      return
    }
    return
  }

  const command = resolveWorkspaceCommand(panel(), keyOfParsed(event))
  if (command) {
    event.preventDefault()
    event.stopPropagation()
    run(command)
    return
  }
  // 没解析出命令的键一律取消确认态(计划 1 的契约:除危险命令的 press 之外,任何按键都清武装态)。
  if (armed() !== undefined) {
    confirm.clear()
    setArmed(undefined)
  }
})
```

### 9.5 测试

1. **进入与退回**：文件面板选中一个有 diff 的文件按 `enter` → 按 `j` 后**文件行不再移动**
   （反向断言：断言焦点行还是同一个），按 `esc` 后 `j` 重新移动行。
2. **滚动真的发生**：用一个足够长的 diff（造一个大改动）→ 按 5 次 `j` → 字符帧内容变化
   （断言第一屏独有的文本消失了）。这是本任务唯一的「真」验证，不能只测命令解析。
3. **翻页**：按 `pgdn` 后字符帧的偏移量大于单次 `j`（断言不是 1 行）。
4. **数字键不响应**：差异模式下按 `1` → 焦点仍在差异视图（断言文件面板的焦点标记没被切走）。
5. **tab 退出**：差异模式下按 `tab` → 进下一个面板，`j` 恢复移动行。
6. **分支差异**：分支面板按 `enter` → 右侧标题是「分支 xxx」，内容是该分支独有的改动
   （和 Task 2 的 `loadBranchPatch` 断言互补：那边测函数，这边测接上没）。

---

## Task 10 —— 复制、键位条收敛、收尾

### 10.1 `y` 复制

复制通道**已经确认满足**：`src/clipboard.ts` 的 `writeOsc52`（OSC 52 + tmux/screen passthrough）。
不需要引入任何剪贴板依赖 —— 规格 L64 那个前置条件的检查在这一版已经完成，`y` 保留。

```ts
if (command === "files.copyPath") {
  const row = fileRows()[fileRow()]
  if (!row) return
  return copyToClipboard(row.file, "已复制路径")
}
if (command === "commits.copyHash") {
  const row = commitRows()[fileRow()]
  if (!row) return
  return copyToClipboard(row.full, "已复制提交哈希")
}

/**
 * 走 OSC 52 写系统剪贴板。成功也写提示行:复制是不可见的动作,没有回音用户会以为没生效。
 * 失败同样要写 —— 剪贴板写入失败(某些终端不支持 OSC 52)时静默,用户会去检查是不是哈希错了。
 */
const copyToClipboard = async (text: string, done: string) => {
  const ok = await writeOsc52(text)
  setActionHint(ok ? done : "剪贴板不可用")
}
```

⚠️ 动手前先确认 `writeOsc52` 的实际签名（`src/clipboard.ts`）：如果它同步返回布尔，去掉
`await`；如果它已经自己弹 toast，就不用再写提示行。**以源码为准，别按上面的假设改。**
另外 `src/context/clipboard.tsx` 有 `useClipboard()`：如果那个 context 在 GitWorkspace 的作用域
里可用且更高层，优先用 context 而不是裸 util。

`diff` 视图里**不做** `y`（规格 L64/L73 只定义了文件路径与提交哈希两处；复制整段 diff 文本
不在规格里，不加范围）。

### 10.2 键位条收敛

全局段：

```ts
const GLOBAL_KEYBAR = "tab 1-5 切面板 p 拉取 f 推送 c 提交 r 刷新"
```

焦点段按优先级重写（**删掉 `? 帮助`** —— 本版不做帮助弹窗，印一个按了没反应的键比不印更糟）：

```ts
/**
 * 键位条的焦点段。四种互斥状态按优先级从上到下 ——
 * 越靠上的越是「正在等一个具体动作」的状态,越该占掉整条提示位。
 * 顺序反了会打架:确认态开着却显示面板键位,用户按下去会发现不是他想的那个动作。
 */
function keybarText(args: {
  armed?: ArmedConfirm
  input?: InlineInputRequest
  diffFocus: boolean
  panel: PanelID
  hasRows: boolean
}): string {
  if (args.armed) return args.armed.label
  if (args.input) return "enter 提交 esc 取消"
  if (args.diffFocus) return "j/k 滚动 pgup/pgdn 翻页 esc 退回"
  // 列表为空时不印 j/k:空面板按 j 是空转,印一个按键提示只会让人觉得界面卡了。
  const move = args.hasRows ? "j/k 选 " : ""
  if (args.panel === "status") return `${move}空格 作用于当前行 m 切换远端`
  if (args.panel === "files") return `${move}空格 暂存 a 全部暂存 enter 看差异 y 复制路径 d 丢弃 x 删除`
  if (args.panel === "branches") return `${move}空格 切换 n 新建 enter 看差异 d 删除`
  if (args.panel === "commits") return `${move}enter 看差异 y 复制哈希 z 撤销上次提交`
  return `${move}空格 弹出 d 丢弃`
}
```

调用点把四个参数都传进去：

```ts
const hasRows = () => {
  const panelId = panel()
  if (panelId === "status") return statusRows().length > 0
  if (panelId === "files") return fileRows().length > 0
  if (panelId === "branches") return branchRows().length > 0
  if (panelId === "commits") return commitRows().length > 0
  return stashRows().length > 0
}

keybarText({
  armed: armed(),
  input: inlineInput(),
  diffFocus: diffFocus(),
  panel: panel(),
  hasRows: hasRows(),
})
```

`keybarText` 从函数改成对象入参是有意的：三种「等待态」叠在一起时（确认态 + 输入框 + 差异模式）
需要一个确定性的优先级，散在调用点的三元表达式写起来像但读不出优先级。

### 10.3 测试

1. **y 复制路径**：文件面板按 `y` → 字符帧出现「已复制路径」；失败分支（mock 掉
   `writeOsc52` 让它返回失败）→ 出现「剪贴板不可用」。复制了**什么**用
   `expect.spyOn` 断言传入 `writeOsc52` 的字符串等于该文件路径 / 完整哈希（40 位）。
2. **空面板不印 j/k**：空仓库的提交面板 → 字符帧里没有 `j/k 选`，但有 `z 撤销上次提交`。
3. **键位条三种模式**：分别断言确认态文案、`enter 提交 esc 取消`、`j/k 滚动 pgup/pgdn 翻页 esc 退回`。
4. **不再有 `? 帮助`**：断言字符帧里不含 `帮助`（这条是防回归：有人手痒把帮助加回来但没实现）。

### 10.4 收尾

1. 全套：`bun test --timeout 30000`（`packages/tui` 下）→ 目标仍是 907 pass / 1 skip / 4 fail，
   **加上本计划的新增用例**；那 4 个 `provider-options.test.ts` 失败是既有的，不修不追。
   如果总数变了（比如有测试从 pass 变 fail），必须能指到具体是哪条、为什么。
2. `bun typecheck` exit 0。
3. prettier：`./script/format.ts`（仓库根目录）。
4. 人工验收（这些真机交互没有自动化测试，用户必须在终端过一遍）：
   - [ ] 分支面板列出本地 **与远程** 分支，当前分支带 `●`
   - [ ] 分支面板空格切换分支成功；detached 行按空格无反应
   - [ ] 分支面板 `n` 开输入框，enter 建分支后列表刷新出新分支
   - [ ] 分支面板 `d` 二次确认删掉非当前分支；当前分支按 `d` 提示「当前分支不能删除」
   - [ ] 提交面板 `enter` 看该提交 diff；`y` 复制的是 40 位完整哈希（粘出来核对）
   - [ ] 提交面板 `z` 撤销上次提交，改动回到暂存区
   - [ ] 贮藏面板空格弹出、`d` 二次确认丢弃；贮藏为空时显示 `（暂无）`
   - [ ] 文件面板 `enter` 进入滚动模式；此时按 `1`-`5` 无反应；`esc` 回到左列
   - [ ] 状态面板选中变更行按空格：有未暂存 → 全暂存；再无未暂存 → 全取消
   - [ ] 状态面板选中远程行按空格循环切远端；选中分支行按空格跳到分支面板
   - [ ] `c` 在有暂存内容时开提交框、enter 提交成功；没有暂存内容时提示「没有可提交的暂存内容」
   - [ ] 键位条在普通 / 确认 / 输入 / 差异四种状态下分别显示对应提示，且不再出现「帮助」

---

## 执行顺序与已知风险

顺序：`1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10`。依赖关系：

- Task 6 的 6.2 声明了 Task 8 才用的 `inlineInput` 信号（先声明、后接线，每步都能 typecheck）；
- Task 7 的 7.3 会**改掉 Task 5 写的** `armed={armed()}`，别忘；
- Task 9 的 9.3 依赖 Task 6 的 `focusPanel`；
- Task 10 依赖前面全部。

**四个必须先验证再动手的点**（都写在对应任务里，这里汇总，避免被埋在正文里）：

| #   | 点                                            | 在哪个任务 | 打不通怎么办                                                                                           |
| --- | --------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------ |
| 1   | `keyOfParsed` 对方向键 / 翻页键的 `name`      | Task 1     | ✅ **已验证（Task 1 完成时）**：就是 `up`/`down`/`pageup`/`pagedown`，依据 `error-component.tsx:84-87` |
| 2   | `mockInput.pressKey` 能不能驱动 `useKeyboard` | Task 6     | **停下来问用户**，不要偷偷降级成纯表驱动测试                                                           |
| 3   | `writeOsc52` 的实际签名                       | Task 10    | 以源码为准；优先用 context 的高层 API                                                                  |
| 4   | `ScrollBox` 的滚动 API                        | Task 9     | 读类型定义按实际 API 改写                                                                              |

另外两条**规格偏差**，交付时要跟用户说明（不是 bug，是取舍）：

- 行内输入是**单行不换行**（规格 L139 的「内容过长自动换行」与「展开一行」自相矛盾）；
- `?` 帮助弹窗本版不做，已从键位条删掉（规格 L117-119），留给计划 3。
