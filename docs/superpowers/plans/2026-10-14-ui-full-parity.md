# 实施计划：NovaWay UI 全面对齐 ZCode（P0 + P1）

设计规格：`docs/superpowers/specs/2026-10-14-ui-full-parity-design.md`
策略：**绞杀者模式**（P0 并存 → P1 逐批换皮 → P2 删旧层），不做大爆炸改名。

## 总览

| 阶段 | 内容                                                                         | 状态                   |
| ---- | ---------------------------------------------------------------------------- | ---------------------- |
| P0   | 引入 ZCode token 层（palette / zcode-tokens / resolve 接线 / colors.txt）    | ✅ `6b97906`           |
| B1   | 基础控件：Button / IconButton / TextField / Select / Switch / Checkbox / Tag | ✅ `6ce7558` `55f7193` |
| B2   | 浮层：DropdownMenu / Popover / Dialog / Toast / Tooltip                      | ✅ `d0b3acf`           |
| B3   | 会话主体：消息时间线 / 气泡 / 工具调用块 / Thinking / Code / Diff            |                        |
| B4   | 输入区：PromptInput 及其子件                                                 |                        |
| B5   | 侧栏与面板：侧栏 / 任务列表 / 文件树 / Side Pane / 终端面板                  |                        |
| B6   | 设置页：settings-\* 全量                                                     |                        |
| B7   | 状态面板 / 首页 / 办公 / Pulse / 其余                                        |                        |
| B8   | 收尾：删旧 token 层、Aurora 装饰、彩色阴影                                   |                        |

## 每批的固定做法

1. 打开 ZCode 对应组件源码（`.worktrees/zcode-ref/packages/ui/src/...`），读它的 class 与几何
2. 把该组件的样式/token 换成 **ZCode 层命名**（P0 已保证工具类可用），几何（高度/圆角/字号/间距）照抄 ZCode
3. JSX 结构保持不变（Solid 不重写成 React），只换皮
4. 验证三件套：`typecheck` → 单测/e2e → CDP 截图与 ZCode 参考并排对照
5. 一个批次一个 commit

## B1 明细（基础控件）

ZCode 基线：`packages/ui/src/components/ui/button.tsx`（cva 变体表）。

| 项     | NovaWay 现状                                           | ZCode                                                                                    |
| ------ | ------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| 圆角   | `var(--radius-lg)` = 12px                              | `rounded-md`(8px) 默认；`xs/icon-xs` → `rounded-sm`；`lg/icon-md/icon-lg` → `rounded-lg` |
| 高度   | small 28 / normal 36 / large 44                        | `h-5`(20, xs) / `h-6`(24, sm) / `h-7`(28, default) / `h-8`(32, lg) / icon 尺寸同档       |
| 内边距 | 12/16/20                                               | `px-2`(8) 默认、`px-2.5`(10, lg)；icon 侧 1.5/2                                          |
| 间距   | 6/8/10                                                 | `gap-1`(4)                                                                               |
| 字号   | `--font-size-*`（11/14/16）                            | `text-ui-base`（= `--ui-font-size` 14，随设置缩放）                                      |
| 变体   | primary / secondary / ghost                            | default / outline / secondary / ghost / destructive / warning / link                     |
| 阴影   | primary/secondary 带多层投影与 `transform: translateY` | **无阴影、无位移**（DESIGN.md：层级靠底色+边框，不用重阴影）                             |
| 过渡   | `transition: all`                                      | `transition-colors`（避免批量非合成动画）                                                |

变体映射（保住 NovaWay 现有 API，内部换皮）：
`primary → default`、`secondary → outline`、`ghost → ghost`；新增 `destructive`。

## 验收（每批）

- 该批组件的截图与 ZCode 参考并排对照
- e2e 全绿（layout / office / todo）
- 该批不再引用旧 token（`--text-strong` / `--border-weak-base` 等）

---

## 进度与遗留（2026-10-14）

### 已完成并验证

| 批次        | 提交                | 验证                                                            |
| ----------- | ------------------- | --------------------------------------------------------------- |
| P0 token 层 | `6b97906`           | CDP 亮/暗 23 个 token 解析正确；零视觉回归；ui 30/30、app 685/6 |
| B1 基础控件 | `6ce7558` `55f7193` | e2e layout 8/8、office 6/6；截图对照                            |
| B2 浮层     | `d0b3acf`           | e2e layout 8/8、office 6/6；截图对照                            |

### 剩余批次的关键约束（决定做法）

旧 token 命名是 **4 级文字层级**（`text-strong` / `text-base` / `text-weak` / `text-weaker`），
ZCode 是 **3 级**（`foreground` / `foreground-subtle` / `foreground-subtlest`）。
因此「旧 token → ZCode token」**不是机械替换**，需要按用途判断（正文用哪一级、元信息用哪一级）。

实测剩余旧 token 出现次数（前 12）：

| 旧 token                              | 次数 | ZCode 候选                                        |
| ------------------------------------- | ---- | ------------------------------------------------- |
| `--text-strong`                       | 84   | `--foreground`                                    |
| `--text-weak`                         | 79   | `--foreground-subtle` 或 `-subtlest`（按用途）    |
| `--border-weak-base`                  | 55   | `--border`                                        |
| `--text-base`                         | 53   | `--foreground` 或 `--foreground-subtle`（按用途） |
| `--background-stronger`               | 26   | `--panel`                                         |
| `--surface-raised-stronger-non-alpha` | 20   | `--popover` / `--card`                            |
| `--surface-base`                      | 18   | `--surface`                                       |
| `--text-weaker`                       | 13   | `--foreground-subtlest`                           |
| `--background-base`                   | 13   | `--background`                                    |
| `--surface-base-active`               | 12   | `--selected`                                      |
| `--icon-strong-base`                  | 11   | `--foreground`                                    |
| `--icon-base`                         | 10   | `--foreground-subtle`                             |

合计约 **440 处**，分布在 `message-part.css`(1312 行)、`session-turn.css`、`session-review.css`、
`basic-tool.css`、`markdown.css`、设置页、侧栏等。

### 两条可选路线

- **路线甲（逐批，慢而稳）**：B3→B8 按原计划一批一提交，每批做截图对照。
- **路线乙（先做全局 token 迁移，快）**：一次性把 440 处按上表映射过去（含按用途判断的 132 处
  文字层级），再回头做几何/密度对齐。收益是"全部颜色与层级立刻统一到 ZCode"，
  风险是 4→3 级压缩在个别位置需要调，靠截图复核兜。
