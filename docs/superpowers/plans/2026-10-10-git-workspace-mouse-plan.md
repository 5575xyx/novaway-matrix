# Git 工作区鼠标支持 · 实现计划

## 背景

- 规格：`docs/superpowers/specs/2026-10-10-git-workspace-mouse-design.md`（已批准，`01dc292`）。
- 计划 2 的 10 个任务已全部完成。基线：**992 pass / 1 skip / 4 fail**（984 tests / 135 files 之上的
  新增），4 个 fail 恒为 `test/cli/cmd/tui/provider-options.test.ts`，与本计划无关；typecheck exit 0。
- 鼠标在 OpenTUI 与本仓库都是一等公民：`enableMouseMovement` 默认 `true`，测试用
  `createMockMouse(renderer)`（`@opentui/core/testing`）直接给 `click` / `doubleClick` / `scroll` /
  `pressDown` / `release` / `drag`。**不需要开启任何开关，也不需要坐标→行的换算。**

## 已核实的结构事实（照着做，别重新探索）

1. **每个面板的每一行都是独立的 `<box>` renderable**，`<For each={rows}>` 回调里返回
   `<box flexDirection="row" paddingLeft={1}>`（`commits-panel.tsx:38-49`，其余面板同构）。
   所以**逐行挂 `onMouseDown`** 成立，这是仓库既有模式（`error-component.tsx:142`、
   `question.tsx:413`、`sidebar-card.tsx:129`）。**禁止**从 `MouseEvent.x/y` 反推第几行。
2. **面板标题不是独立 renderable** —— 它是 `<box>` 的 opentui 原生 `title` prop
   （`git-workspace.tsx:699-717` 的 `PanelFrame`）。所以「点标题切面板」的正确做法是
   **把 `onMouseDown` 挂在整个 `PanelFrame` 的 `<box>` 上**，点框内任意位置（含标题行）切面板。
   行 handler 与框 handler 都会触发 `focusPanel(id)`，语义一致，不打架。
3. **键位条现在是两个字符串**：`GLOBAL_KEYBAR`（`git-workspace.tsx:742`）与
   `keybarText(args)`（`:752-769`）各渲染成一个 `<text>`（`:678-693`）。
   「点操作文字即触发」要求**把它从字符串改成 item 数组**，每个 item 一个 `<text onMouseDown>`。
4. **差异视图已经有滚动容器**：Task 9 让 `<GitDiffPanel>` 内 `<scrollbox ref={scrollRef}>`，
   外壳持 `let scroll: ScrollBoxRenderable | null`（`git-workspace.tsx:670` 回填），
   已有 `scrollDiffBy` / `scrollDiffPage` 两个函数可直接复用。

## 锁定的设计决策（不要改）

- **单击 = 选中 + 聚焦面板，不执行任何操作。**
- **双击只对「无副作用」的动作生效**：文件行 → 看差异；提交行 → 看差异；分支行 → `git switch`。
  贮藏行的 `pop` 和状态行的按类型分派**不做双击**（有副作用，必须走键位条 + 武装态）。
- **危险操作用武装态**：键位条点一次 → 进 armed，面板内显示确认文案；再点同一处才执行。
  这不需要写新逻辑 —— 键位条点击就是 `run(command)`，`run` 已经有武装判定的分支。
- **鼠标不引入任何新命令**，全部收敛到 `run(command)`。
- **不做 hover 高亮。**
- **双击判定自己实现**：`@opentui/core` 的 `Renderable` props **没有** `onDoubleClick`
  （只有 `onMouseDown`/`onMouseUp`/`onMouseMove`/`onMouseDrag`/`onMouseDragEnd`/
  `onMouseDrop`/`onMouseOver`/`onMouseOut`/`onMouseScroll`）。
  在外壳记「上一次 down 的目标 id + 时间戳」，同一目标 400ms 内第二次 down 判为双击。

## Task 1 —— 双击检测 + 左列行点击 + 面板框点击

1. 在外壳加一个双击判定器（模块级 `let lastClickId: string | null` + `let lastClickAt: number`），
   时间用 `Date.now`，但**通过一个可注入的 `now` 函数**，测试传假时钟（参照 `createConfirm(now)` 的先例）。
2. 每个面板加两个可选回调：`onRowClick?(rowIndex)` 与 `onRowDoubleClick?(rowIndex)`，
   面板只负责「点到了第几行」，不关心命令。挂在外壳传给各面板。
3. 面板框加 `onFrameClick` → `focusPanel(id)`。
4. 外壳收到单击 → `focusPanel(id)` + 选行；收到双击 → 按上面的白名单 `run(默认操作)`。

**验收**：用例见「测试」的 1-5 条。

## Task 2 —— 键位条改成可点

1. `GLOBAL_KEYBAR` 与 `keybarText(args)` 各改成返回 `KeybarItem[]`
   （`{ text: string; command?: WorkspaceCommand; key?: string }`，`key` 用来在 armed 时高亮同一项）。
2. 渲染改成 `<For each={items}>` 每个 item 一个 `<text>`，`command` 非空时挂
   `onMouseDown={() => run(item.command)}`。
3. 显示效果必须和现在**逐字一致**（空格、中文文案都不许变）—— 有测试断言字符串。
   这是最容易引入「看起来一样其实漏了字」的地方。
4. 危险项（`files.discard` / `files.delete` / `branches.delete` / `stash.discard`）点击后
   进 armed，**不执行**；armed 期间再点同一项才执行。已由 `run` 覆盖，但必须有测试钉住。

**验收**：用例见「测试」的 6-9 条。

## Task 3 —— 差异视图鼠标

1. `<scrollbox>` 挂 `onMouseScroll`，按 `event.scroll.direction` 上下调 `scrollDiffBy` /
   `scrollDiffPage`。先例：`routes/session/index.tsx:3413`。
2. `<scrollbox>` 挂 `onMouseDown` → 把该行滚到视口顶部：
   `scroll.scrollTo(clamp(event.y - scroll.origin.y + scroll.scrollTop, 0, scroll.scrollSize - viewport))`。
   ⚠️ clamp 的上下界要**自己算**，不能依赖上游 setter —— 内容比视口短时
   `scrollSize - viewport` 是负数，`Math.min(0, 负数)` 会把 `scrollTop` 变成负数、屏幕大片空白
   （Task 9 已经踩过这个坑，见 `scrollDiffBy` 的注释）。
3. 内容不超出视口时**直接 return**，不碰 `scroll` —— 这时 `scroll` 可能已销毁或为 `null`。

**验收**：用例见「测试」的 10-11 条。

## 测试

harness（`test/component/git-workspace-harness.tsx`）加：

- `ws.mouse` —— `createMockMouse(ws.app.renderer)`
- `ws.cellOf(needle, nth = 0)` —— 从字符帧反查 `needle` 的 `(x, y)`，**中文/全角必须按显示宽度算列**
  （参照该文件已有的 `cellAt` 的 `Intl.Segmenter` 写法，别用 `.length`）

用例（新增文件 `test/component/git-workspace-mouse.test.tsx`）：

1. 点某行 → `❯` 移到被点行，且该面板变当前面板
2. 点另一个面板的框 → 切到那个面板
3. 双击提交行 → 差异视图激活（键位条变成差异段）
4. 双击分支行 → 真的 `git switch`（断言 `git branch --show-current`）
5. 双击贮藏行 → **什么都没发生**（`git stash list` 不变、不崩）
6. 点键位条的「提交」→ 打开提交输入框
7. 点危险项第一次 → 只进 armed（**仓库没变**）、面板内出现确认文案
8. armed 后 3.5s 内再点同一项 → 真的删（断言 `git branch` / `git stash list`）
9. 键位条显示文本和改之前逐字一致（回归钉）
10. 滚轮下滚 → 长差异的可见内容变了；上滚回到第一屏
11. 点差异视图下半部 → 下方内容滚上来；短差异点击**不崩、不出空白**
12. 鼠标操作之后键盘仍然可用（防回归）
13. 点空面板、点面板外空隙、点在边框上 → 不崩、不越界、不改选中行

## 通用约束

- 测试**只能**在 `packages/tui` 下跑：`bun test <文件> --timeout 30000`。
- `bun typecheck`（tsgo）。**不要跑** `bun lint`（OOM）、`bunx oxlint`。
- 提取测试汇总（`Failed to read KV state ... ENOENT` 是**已知噪声**）：
  ```
  bun test --timeout 30000 *> "$env:TEMP\tui.log"; Get-Content -LiteralPath "$env:TEMP\tui.log" | Where-Object { $_ -match '^\s*\d+\s+pass$|^\s*\d+\s+fail$|^\s*\d+\s+skip$|Ran \d+ tests|^\s*\(fail\)' }
  ```
  **不要用带字面括号的正则**（PowerShell 会报「字符串正则表达式错误」）。
- 已知抖动：`git-workspace-actions.test.tsx` 的「分支面板 n:jkd」间歇性超时（单跑 3 次 pass/fail/pass），
  与本计划无关，是「renderer 就绪前派发的键会被丢掉」的既有问题。
- **改代码只用 edit 工具，绝不用 PowerShell `Set-Content` 写文件** —— 已有人踩过：按本机 ANSI 重写，
  中文注释全乱码，只能 `git checkout --` 还原。
- 无 `any`、无 `else`（提前 return）、能 `const` 不 `let`、prettier `semi: false` / `printWidth: 120`、
  中文注释说清「为什么」。
- **只 `git add` 自己改的文件**，逐个列路径，**严禁** `git add .` / `-A`，**不要 amend**，不要 push。
- 工作区有别人的未提交修改（`packages/novaway/*`、`packages/plugin/src/tui.ts`、`docs/superpowers/plans/*`），
  以及 `git-workspace-branches-panel.test.tsx` 曾被并发会话改过 —— 全部不要碰；
  发现不符先 `git diff`，然后**适配，不要覆盖**。
- 控制台 gb2312，`git log` 中文乱码是显示问题。

## 落地记录（2026-10-10，`b7618cc`）

13 条用例全过：`git-workspace-mouse.test.tsx` 13 pass / 0 fail；全套 1002 pass / 4 fail
（仍是既有的 `provider-options.test.ts`）；typecheck 只剩他人未提交的
`packages/plugin/src/tool.ts` 缺 `zod` 依赖那一条，与本计划无关。

**与计划判断不同的两处，都是踩出来的，记给后来人：**

1. **点标题切面板要靠 `stopPropagation` 撑着。** 计划「已核实的结构事实」第 2 条判断
   「行 handler 与框 handler 都会触发 `focusPanel(id)`，语义一致，不打架」—— 这只在单次
   单击下成立。真正的冲突在**双击开差异**那条路径：`PanelFrame` 的 `onMouseDown` 挂在整框上，
   而 opentui 的鼠标事件是冒泡的，于是每次行点击都会冒到框上再走一次 `focusPanel`，而
   `focusPanel` 会顺手 `setDiffFocus(false)`。结果「双击第二次刚把差异模式打开」这件事，
   紧接着就被框这一手关掉了，用户只会以为双击没用。修法：五个面板的行 `onMouseDown`
   一律 `event.stopPropagation()`，原因注释写在 `PanelFrame` 的 `onMouseDown` 上。
2. **滚轮锚点必须在 `<scrollbox>` 内部，差异标题那两行滚不动。** `<GitDiffPanel>` 的标题是
   `paddingTop=1` 的静态标签（`diff-panel.tsx:84`），挂在滚动容器**之外**；只有 diff 正文
   才是滚动区域。所以第 10 条用例的坐标锚点取 diff 正文第一行
   （`cellOf(frame, "line 0")`），不取标题 —— 取标题就是一次「滚了没反应」的假失败。
   顺带核实：`@opentui/core` 的 `ScrollBoxRenderable` **没有原生滚轮处理**
   （`onMouseScroll` 只是个 setter，`chunk-bun-*.js:1322`），所以外壳那个 handler 是
   唯一滚东西的地方，不存在「原生 + handler」双滚。

**其它坑（测试侧）：**

- `createMockMouse` 的 `click` / `doubleClick` / `scroll` **全是 async**，内部 `delayMs`
  默认 10ms 后才把 SGR 序列真正写进 `renderer.stdin`。不 `await` 就读帧，读到的是派发前的
  帧 —— 表现为「点了没反应」。
- **等数据就绪要等具体数据，不能等静态骨架。** 「tab 1-5」「j/k 选」这类键位条在 git 数据
  回来之前就画出来了；拿它们当就绪信号，后续按键会命中还没有行的空面板。改用等具体文件名、
  分支名、`stash@{0}`。
- `pressKey("esc")` 不等于 `pressEscape()`，harness 里后者才真正送出 ESC 序列。
