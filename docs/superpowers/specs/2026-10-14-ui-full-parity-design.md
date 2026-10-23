# NovaWay UI 全面对齐 ZCode 设计系统（P0 + P1）

日期：2026-10-14 · 状态：执行中 · 决策：用户确认 NovaWay 是**独立产品**，目标是把整个 UI 对齐

## 1. 范围与真相

|           | NovaWay                        | ZCode / FreeCodeZ        |
| --------- | ------------------------------ | ------------------------ |
| UI 文件   | 279 个 tsx（app 147 + ui 132） | 654 个 tsx（`ui/src`）   |
| UI 代码量 | 74,515 行                      | 56,950 行（`ui/src`）    |
| 框架      | **SolidJS + Kobalte**          | **React + shadcn/Radix** |
| token     | 575 个（opencode 命名）        | 165 个（ZCode 语义命名） |

**两棵树的 token 命名几乎完全不相交（仅 2 个同名）。** 因此这不是"改几个值"，而是**换一整套设计系统**。

参考源（两份都可读，优先 upstream）：

- 上游 ZCode：`novaway-coder/.worktrees/zcode-ref`（gitignore，只读）
- 用户提供的 fork：`E:\AImoney\FreeCodeZ-main`（React，同样以 ZCode 3.15.1 为基线）

**能做什么、不能做什么（关键前提）**

| 层               | 可达成度         | 说明                                                              |
| ---------------- | ---------------- | ----------------------------------------------------------------- |
| CSS / token      | **1:1 逐字移植** | 纯 CSS，与框架无关                                                |
| 组件外观/几何    | **高保真重写**   | class 可照抄，代码必须用 Solid 重写                               |
| 组件代码         | **不可搬运**     | React/Radix → Solid/Kobalte，API 不一一对应                       |
| ZCode 独有功能面 | **不在本轮**     | 工作流画布/插件市场/轨迹查看器/CUA/bots 等 NovaWay 没有，属造功能 |

## 2. 策略：绞杀者模式（strangler fig），不做大爆炸改名

**不**一次性 rename 全仓 token（约 2500 处，中途两套命名并存难维护）。改为：

1. **P0 并存**：把 ZCode 的 token 层**整套加进来**（ZCode 的名字 + ZCode 的值），与现有 NovaWay token **并存**。现有界面零影响。
2. **P1 逐批迁移**：按组件分批换皮。每批做法固定：
   - 打开 ZCode 对应组件源码，抄它的 class，把 JSX 改写成 Solid
   - 该组件同时迁移到 ZCode token 命名
   - 截图对照 + e2e 回归
3. **P2 收尾**：全部迁移完后，删除旧 token 层与 Aurora 遗留。

这样每一步都可交付、可回退，且**迁移期间界面不会坏**。

## 3. P0：token 层（本案）

### 3.1 要移植的东西

ZCode `packages/ui/src/styles.css`（2053 行）中的：

| 块                 | 行      | 内容                                           |
| ------------------ | ------- | ---------------------------------------------- |
| `@theme`           | 137–307 | 全部语义 token（`--color-*`）+ 字阶 + 动效变量 |
| `.dark`            | 308–460 | 深色主题覆盖                                   |
| `.theme-zai-light` | 461–605 | Zai 浅色（正式浅色体验）                       |
| `.theme-zai-dark`  | 606–760 | Zai 深色                                       |

### 3.2 依赖缺口：Tailwind 默认色板

ZCode 的 token 引用了 Tailwind 默认色板（`--color-neutral-50`、`--color-sky-500`、`--color-red-600`…），因为它 `@import "tailwindcss"` 完整引入。

**NovaWay 在 `packages/ui/src/styles/tailwind/colors.css` 开头写了 `--color-*: initial;` 把整套清空**，只保留自己的映射。所以 P0 必须**补回 ZCode 用到的色板刻度**（neutral / sky / red / green / yellow / amber / teal / violet / rose / indigo / cyan / fuchsia / slate / white / black）。

### 3.3 主题切换机制差异

|      | NovaWay                               | ZCode                                          |
| ---- | ------------------------------------- | ---------------------------------------------- |
| 浅色 | `:root`                               | `.theme-zai-light`（默认 `:root` 为 fallback） |
| 深色 | `@media (prefers-color-scheme: dark)` | `.dark` 类                                     |

**NovaWay 沿用现有机制**（`@media` + 现有主题上下文），不引入 `.dark` 类切换，避免动到主题系统。Zai Light/Dark 的值合并进 NovaWay 的浅/深色块。

### 3.4 P0 不做的事

- 不改现有 575 个 token 的**名**（P1 逐批迁）
- 不动 `script/tailwind.ts` 生成物
- 不引入 ZCode 的功能面 token（`--color-workflow-*` 等）—— NovaWay 没有工作流画布

## 4. P1：逐批换皮（批次划分）

按"用户可见路径"分批，每批自带 e2e 与截图验收。

| 批次 | 范围                                                                                         | 文件量（估） |
| ---- | -------------------------------------------------------------------------------------------- | ------------ |
| B1   | 基础控件：Button / IconButton / Input / TextField / Select / Switch / Checkbox / Tag / Badge | ~25          |
| B2   | 浮层：DropdownMenu / Popover / Dialog / Toast / Tooltip / Kobalte 包装层                     | ~25          |
| B3   | 会话主体：消息时间线、气泡、工具调用块、Thinking、Code block、Diff                           | ~40          |
| B4   | 输入区：PromptInput 及其子件（附件、mention、popover、工具栏）                               | ~30          |
| B5   | 侧栏与面板：侧栏、任务列表、文件树、Side Pane、终端面板                                      | ~35          |
| B6   | 设置页：全部 settings-\*                                                                     | ~25          |
| B7   | 状态面板 / 首页 / 办公 / Pulse / 其余                                                        | ~60          |
| B8   | 收尾：删旧 token 层、Aurora 装饰、彩色阴影                                                   | 全局         |

## 5. 验收

| #   | 断言                                                                                  |
| --- | ------------------------------------------------------------------------------------- |
| U1  | P0 后现有界面**零视觉回归**（亮/暗截图逐像素对比，仅允许 token 值变动带来的预期差异） |
| U2  | P0 后 `packages/app` + `packages/ui` typecheck 通过、单测与 e2e 与基线一致            |
| U3  | ZCode 语义 token 在 DOM 上可取到正确计算值（CDP 抽查 10 个）                          |
| U4  | B1–B8 每批：该批组件截图与 ZCode 参考并排对照；e2e 全绿                               |
| U5  | 最终：全仓无旧 token（`bg-background-base` 等）残留；无 Aurora 装饰类                 |

## 6. 风险

| 风险                                                | 处置                                                              |
| --------------------------------------------------- | ----------------------------------------------------------------- |
| 两套 token 并存导致新代码用错                       | P0 起在 `theme.css` 顶部写明"新代码一律用 ZCode 层"，批次内清干净 |
| 色板补回后 Tailwind 类爆炸（多出几千个类）          | 只补 ZCode 实际引用的刻度，不整包引入                             |
| 深色主题机制不同（`@media` vs `.dark`）导致取值错位 | 保持 NovaWay 机制，只搬值；CDP 抽验亮暗两套                       |
| 74k 行 UI 的迁移量大、周期长                        | 绞杀者模式，每批独立可交付；不做大爆炸                            |
