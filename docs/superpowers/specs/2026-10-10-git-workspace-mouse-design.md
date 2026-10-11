# Git 工作区鼠标支持 · 设计

## 背景

- 用户反馈：键盘操作不习惯，要鼠标点击。
- 范围（用户已确认）：**只做 Git 工作区**，不做全 TUI 的鼠标补齐。
- 用户已确认：**不做 hover 高亮**。点击反馈靠「选中行的 `❯` 立刻跳到被点的那行」。

这不是从零造轮子。OpenTUI 与本仓库都已有成熟的鼠标支持：

- `@opentui/core` 有 `MouseEvent` 与 `MouseParser`（SGR + X10 两种编码），
  `enableMouseMovement` 默认 `true` —— 鼠标本来就开着。
- 渲染层 props：`onMouseDown` / `onMouseUp` / `onMouseMove` / `onMouseDrag` /
  `onMouseDrop` / `onMouseOver` / `onMouseOut` / `onMouseScroll`。
- 仓库既有先例：`ui/dialog-select.tsx`、`routes/session/question.tsx`（`onMouseDown={() => moveTo(i())}`）、
  `component/error-component.tsx`、`component/sidebar-card.tsx`、
  `component/flow/canvas.tsx`（完整拖拽，`onMouseDown`/`onMouseDrag`/`onMouseDragEnd`/`onMouseUp`）、
  `routes/session/index.tsx`（`onMouseScroll` 读几何判断该不该吃滚轮）。
- 测试：`createMockMouse(renderer)` 直接给 `click` / `doubleClick` / `scroll` / `drag` / `pressDown` / `release`，
  是一等公民。

**前置**：计划 2 的 Task 9（差异视图激活模式）先让差异视图能滚，鼠标的滚轮才有意义。
本设计实施在 Task 9 之后。

## 目标

用鼠标完成 Git 工作区的**全部**操作，不要求记住任何键位。
键盘一条不删，两条路径并行、互不干扰。

## 交互映射

| 鼠标动作 | 等价键盘 | 说明 |
| --- | --- | --- |
| 点面板标题 | 数字 `1`-`5` | 切到该面板 |
| 点面板内某行 | 数字键 + `j`/`k` | 该面板变当前面板 + 选中该行 |
| 双击面板内某行 | `enter` | 执行该行的默认操作 |
| 点底部键位条上的操作文字 | 对应的那个键 | `c` / `n` / `y` / `z` / `m` / `空格` … |
| 差异视图滚轮 | `j`/`k` + `pgup`/`pgdn` | 上下滚动 |
| 点差异视图某行 | — | 光标定位到该行 |

双击的默认操作取各行**键盘 `enter` 的现有分支**，一个都不新增：

- 文件行 → 打开该文件的差异
- 分支行 → `git switch <name>`
- 贮藏行 → `git stash pop <ref>`
- 提交行 → 打开该提交的差异
- 状态行 → 按当前行分派（分支行→切分支面板、远程行→切远端、改动行→加暂存/移出暂存）

## 关键设计决策

1. **单击 = 选中 + 聚焦面板，不执行操作。** 保持「点一下看看，再点一次才做」的节奏，
   避免误触发。危险操作的误触发尤其致命。
2. **双击 = 默认操作。** Windows 桌面习惯，也是把「选中」和「执行」分开的代价最小化。
3. **鼠标不引入任何新命令。** 所有鼠标动作最终都调用 `run(command)`，和键盘走同一条分派。
   这样危险确认、中文提示、git 失败兜底、`hintFromError` 全部自动一致，**不写第二套逻辑**。
4. **危险操作用武装态。** 第一次点 → 进 armed，面板内显示确认文案；3.5s 内再点同一处才执行；
   超时自动取消。复用 `createConfirm` 的 deadline，不新写定时器。
5. **逐行挂处理器，不做坐标换算。** 每行自己是一个 renderable，直接
   `onMouseDown={() => select(rowIndex)}`（`error-component.tsx`、`question.tsx` 的模式）。
   **禁止**自己从 `MouseEvent.x/y` 反推是第几行 —— 宽度算式一改就全错。
6. **不做 hover 高亮。** 每个面板都要加一个 hover 信号，成本中等，收益是「点之前有个预告」。
   点击后 `❯` 立刻跳到被点的那行，反馈已经足够。

## 不做的

- 拖拽选择文本、右键菜单、中间键、跨面板拖拽。
- 行内输入的鼠标定位光标（`Textarea` 自带能力，本版不碰）。
- 全 TUI 其它组件的鼠标补齐（另立设计）。

## 组件改造

| 位置 | 改法 |
| --- | --- |
| 各面板的行 | 行 renderable 挂 `onMouseDown` → `focusPanel(id)` + 选行 |
| 各面板的行（双击） | **自己判定**：`@opentui/core` 的 `Renderable` props 只有
  `onMouseDown`/`onMouseUp`/`onMouseMove`/`onMouseDrag`/`onMouseDragEnd`/`onMouseDrop`/
  `onMouseOver`/`onMouseOut`/`onMouseScroll`，**没有 `onDoubleClick`**。
  在面板层记「上一次 down 的行号 + 时间戳」，同一行 400ms 内第二次 down 判为双击 → `run(默认操作)` |
| 面板标题 | `onMouseDown` → `focusPanel(id)` |
| 底部键位条 | 每个操作项是一个 renderable → `onMouseDown` → `run(command)` |
| 差异视图 | `onMouseScroll` 按方向滚（参照 `routes/session/index.tsx` 的 scrollbox 先例）；`onMouseDown` 定位光标 |

**一个必须先验的前提**：上面「逐行挂处理器」要求每行是独立 renderable。
如果某个面板把整列渲染成**一个** `<text>`（`For` 拼进单元素），要么把行拆成独立 renderable，
要么退回 renderer 的坐标命中。优先拆行 —— 拆行顺带让 `For` 的 diff 更准。

## 测试

harness 加两个导出（`git-workspace-harness.tsx`）：

- `ws.mouse` —— `createMockMouse(ws.app.renderer)`
- `ws.cellOf(needle, nth = 0)` —— 从字符帧反查 `needle` 所在的 `(x, y)` cell 坐标，
  中文/全角字符必须按显示宽度算列（参照既有 `cellAt` 的 `Intl.Segmenter` 写法）

用例：

1. 点行 → `❯` 移到被点行，且该面板变当前面板
2. 点面板标题 → 切面板
3. 双击提交行 → 差异视图激活
4. 双击分支行 → 真的 `git switch`（断言 `git branch --show-current`）
5. 双击贮藏行 → 真的 `git stash pop`（断言 `git stash list` 少一条）
6. 点键位条 → 触发对应命令
7. 危险操作：点一次只出现确认文案、**仓库没变**；3.5s 内再点同一处才真的删
8. 滚轮滚差异视图（向上向下都验）
9. 鼠标操作之后键盘仍然可用（两条路径不互斥，防回归）
10. 点空面板 / 点边框 / 点面板外的空隙 → 不崩、不越界、不改变选中行

## 验收

- 工作区键盘能做的每一件事，鼠标都能做（用例 1-8 覆盖）。
- 键盘路径一条不能坏：现有测试必须全绿。
- 全套 `bun test` 仍是 `N pass / 1 skip / 4 fail`，4 个 fail 恒为
  `test/cli/cmd/tui/provider-options.test.ts`；`bun typecheck` exit 0；prettier 全绿。

## 已知限制

- **连点危险命令会连执行。** 快速点两次键位条上的「撤销上次提交」会 `reset --soft` 两次。
  这和快速按两次 `z` 的风险完全一样，是本仓库既有的键盘行为，**本次不新增保护**，
  记录在此，将来若要修，应该修在键盘路径上（两条路径共享 `run`）。
- 鼠标事件与键盘事件同时到达时没有互斥。同上一条，共享 `run` 后行为一致。
