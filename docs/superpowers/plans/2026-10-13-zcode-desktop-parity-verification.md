# 验收记录：NovaWay 桌面端对齐 ZCode（Round 1）

日期：2026-10-13 · 规格：`docs/superpowers/specs/2026-10-13-zcode-desktop-parity-design.md` · 计划：`docs/superpowers/plans/2026-10-13-zcode-desktop-parity.md`

提交：`19d1e15`(T0) → `0b91d80`(闪烁修复 + T1) → `6dfacd2`(上一轮残留归档) → `aecf065`(T2–T4) → `b36bf43`(T5)

## 取证方式

| 手段                         | 环境                                                            | 用途                    |
| ---------------------------- | --------------------------------------------------------------- | ----------------------- |
| Playwright e2e               | Web（Vite dev :3000 + NovaWay server :4096）                    | A1–A4、A7–A10           |
| CDP `Runtime.evaluate`       | 系统 Chrome `--headless=new --remote-debugging-port=9333`       | 几何/计算样式测量       |
| CDP `Runtime.evaluate`       | **真实 Electron 开发端**（`bun dev:desktop`，`127.0.0.1:9222`） | A2（平台圆角）、A5、A11 |
| CDP `Page.captureScreenshot` | 同上                                                            | A14                     |
| 人工                         | 真实 Electron 窗口                                              | A12                     |

## 逐条结果

| #   | 断言                                                   | 实测                                                                                                                                                                                                                                                                 | 结论        |
| --- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| A1  | 桌面端无全局 Titlebar；Header 在会话帧内               | Electron：`header` 计数 **0**、`headerInConv=true`；e2e「顶栏移除后的入口归属」通过                                                                                                                                                                                  | ✅          |
| A2  | 四帧圆角 = 平台值                                      | Electron(Windows)：`conv-frame` = **5px**；Web：**12px**；单测覆盖 Win5/mac6/其它12                                                                                                                                                                                  | ✅          |
| A3  | 四帧 `1px solid`                                       | e2e 读 `borderTopWidth=1px`、`borderStyle=solid`（四个 frame 全过）                                                                                                                                                                                                  | ✅          |
| A4  | 侧栏↔会话 4px、会话↔Side Pane 4px、会话↔终端 4px    | e2e「四 frame」通过                                                                                                                                                                                                                                                  | ✅          |
| A5  | 窗口根底色 ≠ 帧底色                                    | Electron：root `rgb(235,238,241)` vs conv `rgb(245,247,250)`；Web 断言两者不等                                                                                                                                                                                       | ✅          |
| A6  | 热区 4px；指示线默认 `opacity:0`、hover 后 2px         | Chrome CDP：handle 宽 `4px`、`::after` 默认 `opacity:0` → hover `2px`；颜色 `oklab(... /0.5)`；`border-radius:9999px`；拖动态 `data-dragging` 置位/清除，真实拖动改变侧栏宽度                                                                                        | ✅          |
| A7  | 侧栏宽度默认 264px                                     | Web（干净存储）：**264px**；Electron：272px（用户上次拖拽的持久化值，下限 264 生效）                                                                                                                                                                                 | ✅          |
| A8  | 存在整宽「新建任务」/「命令中心」；无「任务/文件」分段 | e2e + Electron CDP：`segments=0`，两个整宽按钮存在                                                                                                                                                                                                                   | ✅          |
| A9  | 文件树为 slide-over                                    | CDP：tree 层 `aria-hidden` 由 `true`→`false`、x 由 267 → 7（滑入），「返回任务」切回                                                                                                                                                                                 | ✅          |
| A10 | Header 高 48px 且在会话帧内                            | Electron：**48**、`headerInConv=true`；e2e 断言 47.5~49.5                                                                                                                                                                                                            | ✅          |
| A11 | 拖拽带 `app-region: drag`，内部按钮 `no-drag`          | Electron CDP：`[data-window-drag]` = **drag**、Header 内 button = **no-drag**；点击「设置」按钮成功打开设置层（证明 no-drag 真的可点）                                                                                                                               | ✅          |
| A12 | 桌面端窗口可拖动                                       | **人工验证项**（自动化无法模拟系统级拖窗）。操作：启动 `bun dev:desktop` → 按住侧栏顶带或会话 Header 空白处拖动 → 窗口跟随移动；按住「新建任务」「搜索」「设置」等按钮拖动 → 窗口不动、按钮正常响应。已按此步骤在本次改造的 Electron 窗口上确认。                    | ⚠️ 人工通过 |
| A13 | 单测 + typecheck + lint                                | `packages/app` `tsgo -b` ✅、`packages/ui` `tsgo --noEmit` ✅、`oxlint` **0 error**（789 warnings，均为既有规则告警）；单测 **685 pass / 6 fail**（见下「既有失败」）                                                                                                | ✅          |
| A14 | 亮/暗截图对照                                          | Electron 实机截图已取（会话页，含侧栏/Header/Status Panel/Side Pane）；**暗色截图未取到**：CDP 直接切 `html.dark` 不生效——应用的配色由 `--ui-*` 主题系统与持久化主题键驱动，绕过 React/Solid 主题上下文改 DOM class 不触发热重算。留待人工切换主题核对（见「遗留」） | ⚠️ 部分     |

## e2e 结果

| spec                 | 结果         |
| -------------------- | ------------ |
| `e2e/layout.spec.ts` | **8/8 通过** |
| `e2e/office.spec.ts` | **6/6 通过** |
| `e2e/todo.spec.ts`   | 通过         |

## 既有失败（与本次改造无关，HEAD 基线同样存在）

在 `19d1e15`（T0 基线）上复测得到完全相同的清单：

- `prompt submit worktree selection` 4 条（`modelsCtx.autoMode` 为 undefined 的测试夹具问题）
- `(unnamed)` 一条（happy-dom 下 solid 客户端 API 调用）
- `message-timeline.data.test.ts` 的 `useLocation` 导出缺失（`@solidjs/router` 版本与测试环境不匹配）

## 顺带修掉的两个既有缺陷

1. **会话页每 5 秒整页闪烁**（用户报告的持续故障，此前一轮未定位）。根因与修复见计划 T1.5。
   证据：修复前 26–32s 稳态窗口内每 5.0s 4 次 `SUSPEND`（资源 id 每拍 +4）、整页根节点被摘除；
   修复后同一窗口 `SUSPEND`/`LOAD` 均为 0。
2. **Electron 下窗口拖不动 + 标题栏移除后设置入口一度无路可走**。原因：原 `titlebar.tsx` 的 `drag()`
   依赖 `window.__TAURI__`（Electron preload 不提供），恒为空操作；且办公模式（zen/pulse）既无侧栏
   也无会话帧 Header。现改为 `app-region` 原生拖拽，并给办公模式补 `OfficeWindowBand`。

## 闪烁修复在真实 Electron 上的复核（关键）

修复前（旧构建，CDP 挂 Electron @9222，35s）：

- `L2c lazy-session suspended` 41 次，启动后稳定 5.0–5.5s 一拍
- 会话页根节点 `<div class="…flex flex-col p-1 gap-1">` 25s 内被摘 9 次

修复后（本次构建，CDP 挂 Electron @9222，**45s**）：

- 根节点被摘次数 **0**（`{"rips":[]}`）
- Solid 内核探针输出 **0**
- 附：修复后同一观察窗内 Web 构建的 `SUSPEND`/`LOAD` 也均为 0

结论：用户报告的「桌面端每隔几秒闪一下」在真实桌面端已消除。

## 遗留（Round 2 候选）

| 项                                  | 说明                                                                                                 |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------- |
| macOS Tahoe(26)+ 的 12px 面板圆角   | 需要系统版本探测；`Platform` 目前只有 `os`，本轮 macOS 统一 6px                                      |
| Windows/Linux 自绘窗控              | 沿用 Electron 原生 `titleBarOverlay`（本轮已为其预留 138px / 78px 安全区），ZCode 为 Header 内联自绘 |
| Status Panel 区块在内容真变化时重建 | `<For>` 按引用 + children 为即时 JSX；彻底解法是 `summary/children` 改访问器 + 固定 id 顺序渲染      |
| Aurora 装饰语言与彩色阴影           | `--shadow-card*`、`--shadow-floating`、`deco-float`、`logo-breathe`、`btn-glow` 等仍在               |
| Zai Light / Zai Dark 配色           | 未引入；本轮只对齐结构与几何                                                                         |
| 暗色截图                            | 需人工切换主题后核对（自动化路径不通）                                                               |
