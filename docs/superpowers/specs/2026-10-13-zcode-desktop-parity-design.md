# NovaWay 桌面端对齐 ZCode 设计（外壳 / 侧栏 / Header）

日期：2026-10-13 · 状态：已批准（用户选择「方案 B」）· 范围：Round 1（结构层），不含 token 全量迁移

## 1. 背景

NovaWay 桌面端（`packages/desktop` + `packages/app` + `packages/ui`）此前按「prototype-alignment」轮次做过布局改造，但对照物是自绘原型而非 ZCode 真实源码。本次直接以 ZCode 源码为唯一权威参考重做外壳。

参考仓库：`https://github.com/zai-org/ZCode`（Apache-2.0，v3.15.1），本地只读克隆在 `novaway-coder/.worktrees/zcode-ref`（`.worktrees` 已在 `.gitignore`）。

**权威依据（按优先级）**

| 文件                                                 | 用途                                                         |
| ---------------------------------------------------- | ------------------------------------------------------------ |
| `DESIGN.md`（630 行）                                | 设计规则唯一真源：字阶、圆角、间距、层级、组件、动效         |
| `docs/design/workspace-independent-panels.md`        | 桌面外壳 / 多面板 / 拖拽热区的逐条规格与验收                 |
| `packages/ui/src/styles.css`                         | token 值真源（`@theme` + `.dark` + `.theme-zai-light/dark`） |
| `packages/ui/src/app-shell/WorkspaceShellLayout.tsx` | 分栏比例、侧栏宽度、拖拽带、Header 归属                      |
| `packages/ui/src/WorkspaceSidebar.tsx`               | 侧栏信息架构与 footer                                        |
| `packages/ui/src/WorkspaceHeaderSections/*`          | Header 左右两区结构                                          |

**技术栈差异（决定「对齐设计语言、不搬代码」）**

|          | ZCode                      | NovaWay                                                                 |
| -------- | -------------------------- | ----------------------------------------------------------------------- |
| 框架     | React 19 + shadcn/radix    | SolidJS + Kobalte                                                       |
| Tailwind | v4                         | v4（`packages/ui/src/styles/tailwind/*`，由 `script/tailwind.ts` 生成） |
| 桌面壳   | Electron 42 + `app-region` | Electron 42 + `app-region`                                              |

## 2. 目标与非目标

### 目标（Round 1）

让 NovaWay 桌面端在**结构、层级、几何**上与 ZCode 一致：

1. 取消全局不透明标题栏，窗口 chrome 下沉到侧栏顶带 + 会话帧内 Header
2. 四面板按平台圆角 + 窗口根底色分层 + 4px 帧间距 + 规格化拖拽热区
3. 侧栏收敛为 264px 规格、顶部拖拽带、整宽新建/命令中心入口、文件树 slide-over、footer 归位
4. Header 统一 `h-12`、左标题右操作、承载窗口拖拽区

### 非目标（Round 2+，本轮明确不做）

- 全仓 token 迁移（`--color-*` 语义面命名、Aurora 装饰语言清理、彩色阴影收敛）
- 引入 Zai Light / Zai Dark 配色主题（黑白 brand）
- 菜单 / 浮层 / 对话框 / toast 的浮层语言统一（除被本次改动的 header 内浮层）
- macOS Tahoe(26)+ 的 12px 圆角（需要操作系统版本探测，见 §4.2 已知限制）
- Windows/Linux 自绘窗控（ZCode 把窗控做进 Header；NovaWay 继续用 Electron 原生 `titleBarOverlay`）

## 3. 现状差距（实测）

| #   | 现状                                                                                                           | ZCode                                                                                     | 影响            |
| --- | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | --------------- |
| 1   | `layout.tsx` 渲染全局 `Titlebar`（`h-[50px]`、`bg-background-base/90`、不透明），会话内容整体下移 50px         | 无全局标题栏；侧栏顶部 `h-12` 拖拽带；`WorkspaceHeader` 在会话帧内                        | 结构性          |
| 2   | 四 frame：`rounded-lg`(8px) + `border-border-weak-base` + `bg-background-stronger`                             | 按平台圆角（Win5/mac6/Linux12/Web12）+ `border-border` + `bg-background`                  | 观感            |
| 3   | 窗口根无色差：`bg-background-base` 到处一样，4px 间隙看不出来                                                  | 根 `bg-background-win-alt`（比面板深），间隙成为可视线                                    | 观感            |
| 4   | `resize-handle`：8px 热区、1px `#b8c8dc` 常显线、hover 3px 硬编码蓝 `#2563eb`                                  | 4px 热区、2px `foreground-subtlest/50`、默认隐藏、hover/focus/drag 显示、按圆角内缩、圆头 | 观感 + 触摸精度 |
| 5   | `sidebar.width` 默认 280、`min=240`、`max=30%`                                                                 | 默认 = min = 264、max 容器 50%、键盘步进 16px                                             | 几何            |
| 6   | 侧栏顶部是四个 icon-only 按钮挤一行 + 「任务/文件」分段控件                                                    | `h-12` 拖拽带 → 整宽新建任务 → 整宽命令中心搜索行（带快捷键） → 任务树 → footer           | 结构 + IA       |
| 7   | 文件树是侧栏内的**分段切换**（同一列替换任务列表）                                                             | 文件树是侧栏内的**整层 slide-over**（`translate-x`，可返回）                              | 结构            |
| 8   | 会话帧内 `WorkspaceHeader` 在桌面端返回 `null`；`SessionHeader` 是纯 Portal，内容挂到全局 Titlebar 的两个 slot | `WorkspaceHeader` 是会话帧内真实 header（`h-12`、左标题右操作、整体可拖拽）               | 结构性          |
| 9   | Electron 下**窗口无法拖动**：`drag()` 依赖 `window.__TAURI__`（Electron preload 不提供），且无 `app-region`    | 每个拖拽带用 `[app-region:drag]`                                                          | 功能性缺陷      |
| 10  | 侧栏顶部菜单组（模式/主题/数据库/设置）竖排带边框卡片                                                          | footer 承载主题/语言/设置/用量/登录                                                       | IA              |

> 第 9 条是本轮顺带修掉的既有功能缺陷：`packages/desktop/src/preload/index.ts` 只暴露 `setTitlebar`，`titlebar.tsx` 的 `currentDesktopWindow()?.startDragging?.()` 恒为 `undefined`。

## 4. 设计决策（NovaWay 适配）

参考是 React + ZCode token 命名，NovaWay 是 Solid + opencode token 命名，因此逐条给出**决策**，而不是直接翻译。

### 4.1 Token 映射（Round 1 只用这些）

| ZCode                                            | NovaWay                                            | 说明                                                                                                                                                              |
| ------------------------------------------------ | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bg-background`（面板/页面）                     | `bg-background-base`                               | 帧表面                                                                                                                                                            |
| `bg-background-win-alt`（窗口根，Win/Linux/Web） | `bg-background-weak`                               | 明暗两套里都恰好是「比 base 更远离文字」的一档（浅色更暗 / 深色更亮）                                                                                             |
| `bg-background-alt`（窗口根，macOS）             | `bg-background-weak`                               | **偏离**：ZCode 用半透明是为了让 macOS vibrancy 透出；NovaWay Electron 不开 vibrancy（`backgroundColor` 不透明），半透明会混出灰块。统一用 `weak`，在代码注释标注 |
| `border-border`（帧/分隔线）                     | `border-border-base`                               | `--border-base`                                                                                                                                                   |
| `border-border/50`（Header 分隔线）              | `border-border-weaker-base`                        | 现有最弱一档，避免新增 `color-mix` 工具类                                                                                                                         |
| `text-foreground-subtlest`（拖拽指示线）         | `text-text-weaker`                                 | 现有第三层文字色                                                                                                                                                  |
| `bg-hover` / `bg-selected`                       | `bg-surface-base-hover` / `bg-surface-base-active` | 已有一一对应                                                                                                                                                      |
| `text-ui-*` 字阶                                 | `text-ui-*`                                        | **已对齐**，无需改动                                                                                                                                              |
| `--radius-xl/2xl`                                | 不引入                                             | Round 1 用内联平台圆角变量，见 §4.2                                                                                                                               |

> 不新增 token、不改 `script/tailwind.ts` 生成物。

### 4.2 平台圆角

新建 `packages/app/src/utils/workspace-chrome.ts`：

```ts
export function workspacePanelRadiusPx(os: Platform["os"]): number {
  if (os === "windows") return 5
  if (os === "macos") return 6
  return 12 // linux / web / 未知
}
```

外壳根节点写入 CSS 变量 `--workspace-panel-radius`，四帧用 `rounded-[var(--workspace-panel-radius)]`。

**已知限制（写进代码注释并在本文件记录）**：ZCode 在 macOS Tahoe(26)+ 用 12px，需要 `IPlatformService.getDesktopWindowChromeState` 查询系统版本。NovaWay 的 `Platform` 只有 `os`，没有系统版本；本轮 macOS 统一 6px（旧版本行为），Tahoe 提升留待 Round 2 接 preload。

### 4.3 窗口根与四帧几何

```
窗口根  bg-background-weak
  └ 4px 外留白（桌面）/ 0（手机）
      └ 侧栏帧 (264px)  ┃4px┃  主列
                                  ├ 会话帧（Header h-12 + 内容）
                                  ┃4px┃
                                  ├ 终端帧（可选）
                                  └ 与右侧 Side Pane 帧 ┃4px┃
```

- 四帧统一：`bg-background-base` + `border border-border-base` + 平台圆角
- 帧间距 4px，间隙由 resize handle 承载（透明热区）
- Side Pane 关闭时不保留间距
- 手机（`<768px`）保持现有抽屉/单列路径不变

### 4.4 拖拽热区（resize handle）

改 `packages/ui/src/components/resize-handle.css`：

| 项     | 现状                            | 目标                                                                 |
| ------ | ------------------------------- | -------------------------------------------------------------------- |
| 热区   | 8px / `translateX(±50%)`        | 4px，落在帧间距内                                                    |
| 指示线 | 常显 1px `#b8c8dc`              | 默认 `opacity: 0`；hover / `:focus-visible` / `[data-dragging]` 显示 |
| 线宽   | 1px → hover 3px                 | 恒 2px                                                               |
| 颜色   | `#b8c8dc` / `#2563eb`（硬编码） | `color-mix(in oklab, var(--text-weaker) 50%, transparent)`           |
| 端点   | 直角、贴满                      | 两端按 `--workspace-panel-radius` 内缩、`border-radius: 9999px`      |

需给 `resize-handle.tsx` 增加拖动期间 `data-dragging` 标记（`onMouseDown` 置位、`mouseup` 清除），否则「拖动态显示」无法满足。

### 4.5 侧栏

| 项       | 目标                                                                                                          |
| -------- | ------------------------------------------------------------------------------------------------------------- |
| 宽度     | 默认 264、min 264、max 容器 50%、键盘步进 16px                                                                |
| 顶部     | `h-12` 拖拽带（`[app-region:drag]`），左端保留 Logo（点击回首页）+ 移动端汉堡菜单                             |
| 第一行   | 整宽「新建任务」主按钮                                                                                        |
| 第二行   | 整宽「命令中心」ghost 行：`size-4` 搜索图标 + 文案 + 右侧快捷键 `text-ui-xs text-text-weaker`                 |
| 中部     | 项目 → 任务树（保留现有实现与过滤条）                                                                         |
| 文件树   | **slide-over**：`absolute inset-0` + `translate-x-full/0` + `transition-transform duration-200`，顶部返回按钮 |
| 底部     | footer：模式切换 / 主题 / 数据库 / 设置，`pl-4 pr-3`                                                          |
| 分段控件 | **删除**「任务/文件」分段（被 slide-over 取代）                                                               |

**决策：`layout.sidebarView` 持久化结构不动**（`"tasks" | "tree"`），只是从「分段按钮」改为「文件树 slide-over 开关」，避免破坏 `layout.v8` 及其测试。

**决策：入口落点**

| 入口                 | 落点                                    | 理由                                               |
| -------------------- | --------------------------------------- | -------------------------------------------------- |
| 首页（Logo）         | 侧栏拖拽带左端                          | ZCode 的 `WindowsTopLeftLogo` 先例；不新增独立入口 |
| 模式切换             | 侧栏 footer 首行                        | ZCode 无对应物，属 NovaWay 自有能力，放全局入口区  |
| 命令中心（搜索）     | 侧栏第二行整宽行                        | 对齐 ZCode                                         |
| 导航前进/后退        | 不进 UI，保留 `mod+[` / `mod+]` command | ZCode 无全局 nav                                   |
| 主题 / 数据库 / 设置 | 侧栏 footer                             | 取代原顶部竖排菜单卡片                             |

### 4.6 Header

新建真实 Header（会话帧内），替换「桌面端返回 null + Portal 到 Titlebar」的实现：

| 区   | 内容                                                                                             |
| ---- | ------------------------------------------------------------------------------------------------ |
| 容器 | `h-12 shrink-0 border-b border-border-weaker-base flex items-center gap-2 p-2 [app-region:drag]` |
| 左   | 运行指示点（working）→ 会话标题 → 工作区分支胶囊（`text-ui-xs`，带浮层）→ 模型选择器             |
| 右   | 状态胶囊 → 在编辑器中打开 → 终端开关 → Side Pane 开关 → 更多菜单                                 |
| 交互 | 所有按钮 `[app-region:no-drag]`                                                                  |

- **Web 端**：`WorkspaceHeader` 现在 web 也渲染（`h-10`）；统一为 `h-12`，e2e 的 `≤40px` 断言需更新为 `≤48px`。
- **`session.tsx` 顶部的 `<SessionHeader />`** 在桌面端与 Header 重复，需移除；其 Portal 内容（搜索框、状态胶囊、打开方式、Side Pane 开关）迁移到新 Header。搜索入口改为 Header 内搜索按钮（`command.trigger("file.open")`）。
- 变量名冲突提示：`session.tsx` 的 `isDesktop()` 是**媒体查询**（`min-width: 768px`），`platform.platform === "desktop"` 才是**运行平台**。新 Header 的平台判断一律用后者，并在注释里点明，避免再次混用。

### 4.7 移交 Round 2 的遗留

- `packages/ui/src/styles/theme.css` 的 Aurora 装饰（渐变、`deco-float`、`logo-breathe`、`btn-glow`、`card-lift-hover`）与彩色阴影家族 `--shadow-card*` / `--shadow-floating`
- 菜单 / 浮层 / 对话框 / toast 的 `bg-menu`、`rounded-lg` 壳 + `rounded-md` 项语言
- 全仓 `rounded-lg/xl/full` 的圆角层级规整
- Zai Light / Zai Dark 主题与黑白 brand

## 5. 验收标准（可量化，逐条可测）

| #   | 断言                                                                                    | 方法                                                |
| --- | --------------------------------------------------------------------------------------- | --------------------------------------------------- |
| A1  | 桌面端会话页不再有全局 Titlebar；Header 位于会话帧内                                    | e2e 几何（`workspace-header` 是 `conv-frame` 后代） |
| A2  | 四帧圆角 = 平台值（web=12px、windows=5px、macos=6px）                                   | e2e 读 `getComputedStyle().borderRadius`            |
| A3  | 四帧 `borderStyle = solid`、`borderTopWidth = 1px`                                      | e2e                                                 |
| A4  | 侧栏帧与会话帧横向间距 4px；会话帧与 Side Pane 4px；会话帧与终端帧纵向 4px              | e2e（保留现有断言）                                 |
| A5  | 窗口根底色 ≠ 帧底色（亮暗两套都成立）                                                   | CDP 读 computed 值                                  |
| A6  | 拖拽热区宽/高 4px；指示线默认 `opacity: 0`、hover 后 2px                                | e2e（新增）                                         |
| A7  | 侧栏宽度默认 264px                                                                      | e2e + 单测                                          |
| A8  | 侧栏存在整宽「新建任务」与「命令中心」两行；不存在「任务/文件」分段按钮                 | e2e 文案断言                                        |
| A9  | 文件树为 slide-over：点击后侧栏内层 `translate-x` 由 `full` → `0`，返回按钮可回任务列表 | e2e 读 transform                                    |
| A10 | Header 高 = 48px，且位于会话帧内                                                        | e2e 几何                                            |
| A11 | Header 内按钮 computed `app-region` = `no-drag`；拖拽带 = `drag`                        | CDP（Electron）                                     |
| A12 | 桌面端窗口可拖动                                                                        | **人工验证**（无法自动化），结果记入验证记录        |
| A13 | 单测 + typecheck + lint 通过                                                            | `bun test` / `tsgo -b` / `oxlint`                   |
| A14 | 亮/暗两套截图与 ZCode 参考并排对照                                                      | CDP `Page.captureScreenshot`                        |

## 6. 前置条件：恢复可验证基线（必须先做）

实测：**当前工作树 8/8 e2e 全红**。根因是 `packages/app/vite.config.ts` 里遗留的闪烁诊断配置

```
optimizeDeps: { exclude: ["solid-js", "solid-js/web", "solid-js/store", "solid-js/h", "solid-js/html"] }
```

导致 `vite` 预打包直接报 `The entry point "solid-js" cannot be marked as external` 并退出，web dev server 起不来，e2e 全部 `ERR_CONNECTION_REFUSED`。

该配置与 `packages/app/src/utils/flicker-diag.tsx`、六层 Suspense 探针、`res-audit` 打点同属上一轮「排查每几秒闪烁」的诊断脚手架（用户已决定不再排查该问题）。

**因此 T0 = 拆除诊断脚手架并恢复基线**，否则本轮任何改动都无验证手段。拆除/保留范围见实施计划 T0。

## 7. 风险与回滚

| 风险                                                          | 处置                                                                    |
| ------------------------------------------------------------- | ----------------------------------------------------------------------- |
| 移除 Titlebar 后 Portal slot 不存在，Header 内容丢失          | T2 先建新 Header 并迁移内容，T3 再删 Titlebar；两步之间功能不缺失       |
| `app-region: drag` 覆盖导致按钮点不动                         | 交互元素显式 `[app-region:no-drag]`；A11 用 CDP 断言；T3 后人工拖拽验证 |
| 帧背景 `stronger → base` 让消息区对比不足                     | T1 后截图对比（亮/暗）；如对比不足则只保留根底色分层、帧背景回退        |
| e2e 断言按旧结构写死（Titlebar 结构、header ≤40px、分段按钮） | 归入 T5 统一改；改断言前先记录现状红/绿                                 |
| macOS Tahoe 圆角不达标                                        | 记录为已知限制，Round 2 接系统版本                                      |

回滚：每个任务一个 commit，任务内改动用 `git checkout <task-commit>~1 -- <files>` 单独回退。
