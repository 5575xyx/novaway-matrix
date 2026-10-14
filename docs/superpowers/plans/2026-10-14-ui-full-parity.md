# 实施计划：NovaWay UI 全面对齐 ZCode（P0 + P1）

设计规格：`docs/superpowers/specs/2026-10-14-ui-full-parity-design.md`
策略：**绞杀者模式**（P0 并存 → P1 逐批换皮 → P2 删旧层），不做大爆炸改名。

## 总览

| 阶段 | 内容 | 状态 |
| --- | --- | --- |
| P0 | 引入 ZCode token 层（palette / zcode-tokens / resolve 接线 / colors.txt） | ✅ `6b97906` |
| B1 | 基础控件：Button / IconButton / Input / TextField / Select / Switch / Checkbox / Tag / Badge | 进行中 |
| B2 | 浮层：DropdownMenu / Popover / Dialog / Toast / Tooltip | |
| B3 | 会话主体：消息时间线 / 气泡 / 工具调用块 / Thinking / Code / Diff | |
| B4 | 输入区：PromptInput 及其子件 | |
| B5 | 侧栏与面板：侧栏 / 任务列表 / 文件树 / Side Pane / 终端面板 | |
| B6 | 设置页：settings-* 全量 | |
| B7 | 状态面板 / 首页 / 办公 / Pulse / 其余 | |
| B8 | 收尾：删旧 token 层、Aurora 装饰、彩色阴影 | |

## 每批的固定做法

1. 打开 ZCode 对应组件源码（`.worktrees/zcode-ref/packages/ui/src/...`），读它的 class 与几何
2. 把该组件的样式/token 换成 **ZCode 层命名**（P0 已保证工具类可用），几何（高度/圆角/字号/间距）照抄 ZCode
3. JSX 结构保持不变（Solid 不重写成 React），只换皮
4. 验证三件套：`typecheck` → 单测/e2e → CDP 截图与 ZCode 参考并排对照
5. 一个批次一个 commit

## B1 明细（基础控件）

ZCode 基线：`packages/ui/src/components/ui/button.tsx`（cva 变体表）。

| 项 | NovaWay 现状 | ZCode |
| --- | --- | --- |
| 圆角 | `var(--radius-lg)` = 12px | `rounded-md`(8px) 默认；`xs/icon-xs` → `rounded-sm`；`lg/icon-md/icon-lg` → `rounded-lg` |
| 高度 | small 28 / normal 36 / large 44 | `h-5`(20, xs) / `h-6`(24, sm) / `h-7`(28, default) / `h-8`(32, lg) / icon 尺寸同档 |
| 内边距 | 12/16/20 | `px-2`(8) 默认、`px-2.5`(10, lg)；icon 侧 1.5/2 |
| 间距 | 6/8/10 | `gap-1`(4) |
| 字号 | `--font-size-*`（11/14/16） | `text-ui-base`（= `--ui-font-size` 14，随设置缩放） |
| 变体 | primary / secondary / ghost | default / outline / secondary / ghost / destructive / warning / link |
| 阴影 | primary/secondary 带多层投影与 `transform: translateY` | **无阴影、无位移**（DESIGN.md：层级靠底色+边框，不用重阴影） |
| 过渡 | `transition: all` | `transition-colors`（避免批量非合成动画） |

变体映射（保住 NovaWay 现有 API，内部换皮）：
`primary → default`、`secondary → outline`、`ghost → ghost`；新增 `destructive`。

## 验收（每批）

- 该批组件的截图与 ZCode 参考并排对照
- e2e 全绿（layout / office / todo）
- 该批不再引用旧 token（`--text-strong` / `--border-weak-base` 等）
