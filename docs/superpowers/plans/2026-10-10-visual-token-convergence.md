# 视觉体系收敛（Aurora → 语义克制）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按已批准规格（`docs/superpowers/specs/2026-10-10-desktop-layout-ui-redesign-design.md` §6/§7）移除 Aurora 装饰体系、建立 `text-ui-*` 字阶与 `--ui-font-size` 界面字号能力、收敛圆角/深度/模式色铺底、命令面板对齐菜单规范。

**Architecture:** 纯样式层改造，不动布局结构与状态模型（那在 Plan B `2026-10-10-layout-structure-redesign.md`）。字阶采用「`--ui-font-size` 单点驱动 + Tailwind v4 `@theme` 生成 `text-ui-*` 类」；存量 `text-N-*` 排版类与 `--font-size-base/small` 保持静态值不动（避免影响对话正文/代码/终端），新字阶只对新组件与显式迁移处生效。

**Tech Stack:** CSS（`packages/ui/src/styles`）、SolidJS（`packages/app`）、Tailwind v4 CSS-first `@theme`、bun test / Playwright。

**范围排除**（归 Plan B，本计划勿碰）：`mode-home.tsx` 首页装饰与 CTA 按钮、`mode-switch.tsx` 模式切换按钮形态、titlebar 结构、任何布局结构调整。

**验证环**（每个任务完成后至少跑 `bun lint`；任务 6 做完整验证）：`bun lint` → `bun typecheck` → `cd packages/app && bun run test:unit`。

---

## File Structure

| 文件                                               | 动作 | 职责                                                                                   |
| -------------------------------------------------- | ---- | -------------------------------------------------------------------------------------- |
| `packages/ui/src/styles/theme.css`                 | 修改 | 新增 `--ui-font-size` 与 `--font-size-ui-*` 六档；删 `--shadow-aurora`/`--shadow-glow` |
| `packages/ui/src/styles/tailwind/index.css`        | 修改 | `@theme` 生成 `text-ui-*` 类；补 `--font-weight-semibold/bold`                         |
| `packages/ui/src/styles/utilities.css`             | 修改 | 删 Aurora 装饰类与死代码排版类块；补 `text-13-*` 缺失定义                              |
| `packages/app/src/context/settings.tsx`            | 修改 | `createEffect` 把 `appearance.fontSize` 写入 `--ui-font-size`                          |
| `packages/app/src/components/settings-general.tsx` | 修改 | 外观分节挂「界面字号」滑块                                                             |
| `packages/app/src/i18n/zh.ts` / `en.ts`            | 修改 | 新增字号设置文案 key                                                                   |
| `packages/app/src/pages/layout.tsx`                | 修改 | 根容器去 tech-radial/aurora-overlay；主区去 glass；`rounded-tl-[16px]`→`rounded-tl-lg` |
| `packages/app/src/components/titlebar.tsx`         | 修改 | 去 `titlebar-gradient-border` 类                                                       |
| `packages/app/src/index.css`                       | 修改 | 删 active-glow/titlebar 渐变/模式色铺底/装饰圆角覆盖                                   |
| `packages/ui/src/components/dialog.css`            | 修改 | 命令面板圆角 `radius-xl`→`radius-lg`                                                   |

---

### Task 1: `text-ui-*` 字阶与 `--ui-font-size` 界面字号能力

**Files:**

- Modify: `packages/ui/src/styles/theme.css:22`（字体层级区后）
- Modify: `packages/ui/src/styles/tailwind/index.css:43-49`
- Modify: `packages/ui/src/styles/utilities.css:124`（text-14 区之前）
- Modify: `packages/app/src/context/settings.tsx:284`（appearance 定义之后、init `return` 之前）
- Modify: `packages/app/src/components/settings-general.tsx:636-639`（AppearanceSection 的 SettingsList 内）
- Modify: `packages/app/src/i18n/zh.ts`、`packages/app/src/i18n/en.ts`

- [ ] **Step 1: theme.css 新增 UI 字阶基准**

在 `packages/ui/src/styles/theme.css` 的 `--font-size-6x-large: 48px;`（L22）之后插入：

```css
/* NovaWay UI 字阶基准 — 由设置 → 通用 → 外观 → 界面字号驱动（12–16px） */
--ui-font-size: 14px;
--font-size-ui-xl: calc(var(--ui-font-size) + 4px);
--font-size-ui-lg: calc(var(--ui-font-size) + 2px);
--font-size-ui-base: var(--ui-font-size);
--font-size-ui-caption: calc(var(--ui-font-size) - 1px);
--font-size-ui-sm: calc(var(--ui-font-size) - 2px);
--font-size-ui-xs: calc(var(--ui-font-size) - 4px);
```

- [ ] **Step 2: tailwind `@theme` 注册 `text-ui-*` 与缺失字重**

在 `packages/ui/src/styles/tailwind/index.css` 的 `@theme` 块内，将 L43-49：

```css
--text-sm: var(--font-size-small);
--text-base: var(--font-size-base);
--text-lg: var(--font-size-large);
--text-xl: var(--font-size-x-large);

--font-weight-regular: var(--font-weight-regular);
--font-weight-medium: var(--font-weight-medium);
```

替换为：

```css
--text-sm: var(--font-size-small);
--text-base: var(--font-size-base);
--text-lg: var(--font-size-large);
--text-xl: var(--font-size-x-large);

/* UI 字阶：新组件一律用 text-ui-*，禁用 text-sm/base 与任意字号 */
--text-ui-xl: var(--font-size-ui-xl);
--text-ui-xl--line-height: var(--line-height-large);
--text-ui-lg: var(--font-size-ui-lg);
--text-ui-lg--line-height: var(--line-height-large);
--text-ui-base: var(--font-size-ui-base);
--text-ui-base--line-height: var(--line-height-large);
--text-ui-caption: var(--font-size-ui-caption);
--text-ui-caption--line-height: var(--line-height-large);
--text-ui-sm: var(--font-size-ui-sm);
--text-ui-sm--line-height: var(--line-height-normal);
--text-ui-xs: var(--font-size-ui-xs);
--text-ui-xs--line-height: var(--line-height-large);

--font-weight-regular: var(--font-weight-regular);
--font-weight-medium: var(--font-weight-medium);
--font-weight-semibold: var(--font-weight-semibold);
--font-weight-bold: var(--font-weight-bold);
```

（`--*: initial` 已清空 Tailwind 默认，补 `semibold/bold` 后 `font-semibold`/`font-bold` 类才存在，供与 `text-ui-*` 组合字重。）

- [ ] **Step 3: 修复 `text-13-*` 未定义 bug（51 处引用悬空）**

在 `packages/ui/src/styles/utilities.css` 的 `/* BASE (14px) 排版 */` 注释（L124）之前插入（与既有 `text-12-*` 同构，13px = `--font-size-small`）：

```css
/* 13PX 排版（补齐历史遗留：app 中 51 处 text-13-* 此前无定义） */
.text-13-regular {
  font-family: var(--font-family-sans);
  font-size: var(--font-size-small);
  font-style: normal;
  font-weight: var(--font-weight-regular);
  line-height: var(--line-height-large);
  letter-spacing: var(--letter-spacing-normal);
}

.text-13-medium {
  font-family: var(--font-family-sans);
  font-size: var(--font-size-small);
  font-style: normal;
  font-weight: var(--font-weight-medium);
  line-height: var(--line-height-large);
  letter-spacing: var(--letter-spacing-normal);
}

.text-13-semibold {
  font-family: var(--font-family-sans);
  font-size: var(--font-size-small);
  font-style: normal;
  font-weight: var(--font-weight-semibold);
  line-height: var(--line-height-large);
  letter-spacing: var(--letter-spacing-normal);
}

.text-13-mono {
  font-family: var(--font-family-mono);
  font-feature-settings: var(--font-feature-settings-mono);
  font-size: var(--font-size-small);
  font-style: normal;
  font-weight: var(--font-weight-regular);
  line-height: var(--line-height-large);
  letter-spacing: var(--letter-spacing-normal);
}
```

- [ ] **Step 4: settings context 把字号写入 CSS 变量**

`packages/app/src/context/settings.tsx`：确认顶部从 `solid-js` 导入了 `createEffect`（若无则加入 import）。在 `appearance` 对象定义结束（L284 `},` 之后）与 `return {` 之间插入：

```ts
// 界面字号 → 全局 CSS 变量（text-ui-* 字阶由它派生）
createEffect(() => {
  document.documentElement.style.setProperty("--ui-font-size", `${settings.appearance.fontSize()}px`)
})
```

若 `settings` 命名（context 自身的返回对象引用）在该作用域不可直接引用，则改用在 init 顶部先取 getter 的形式：

```ts
const fontSize = withFallback(() => store.appearance?.fontSize, defaultSettings.appearance.fontSize)
createEffect(() => {
  document.documentElement.style.setProperty("--ui-font-size", `${fontSize()}px`)
})
```

并保持 `appearance.fontSize` 的对外 getter 不变。以 typecheck 通过为准选择其一。

- [ ] **Step 5: i18n 新增文案**

`packages/app/src/i18n/zh.ts`（`settings.general.section.appearance` 键附近）：

```ts
  "settings.general.appearance.fontSize.title": "界面字号",
  "settings.general.appearance.fontSize.description": "调整菜单、侧栏与控件的文字大小；代码与终端字号独立设置",
```

`packages/app/src/i18n/en.ts`（同位置）：

```ts
  "settings.general.appearance.fontSize.title": "Interface size",
  "settings.general.appearance.fontSize.description": "Adjust text size for menus, sidebar and controls; code and terminal fonts are independent",
```

（`i18n/parity.test.ts` 会校验 zh/en key 对齐——两边必须同时加。）

- [ ] **Step 6: 外观分节挂字号滑块**

`packages/app/src/components/settings-general.tsx` 的 `AppearanceSection` 中，在 colorScheme 的 `</SettingsList>`（L637）之前追加：

```tsx
<SettingsRow
  title={language.t("settings.general.appearance.fontSize.title")}
  description={language.t("settings.general.appearance.fontSize.description")}
>
  <div class="flex items-center gap-3" data-action="settings-font-size">
    <input
      type="range"
      min="12"
      max="16"
      step="1"
      class="w-44 accent-[var(--button-primary-base)]"
      value={settings.appearance.fontSize()}
      onInput={(e) => settings.appearance.setFontSize(Number(e.currentTarget.value))}
    />
    <span class="text-13-medium text-text-weak tabular-nums w-9 text-right">{settings.appearance.fontSize()}</span>
  </div>
</SettingsRow>
```

- [ ] **Step 7: 验证**

Run: `bun lint`
Expected: 通过（无新增告警）

Run: `bun typecheck`
Expected: 通过

Run: `bun run --cwd packages/app test:unit`
Expected: PASS（重点看 `src/i18n/parity.test.ts`）

- [ ] **Step 8: 手动验证字号链路**

1. 终端 A（`packages/novaway`）：`bun run --conditions=browser ./src/index.ts serve --port 4096`
2. 终端 B（`packages/app`）：`bun dev -- --port 4444`
3. 打开 `http://localhost:4444` → 设置 → 通用 → 外观：拖动「界面字号」滑块，数值标签即时更新；DevTools 检查 `document.documentElement` 的 `--ui-font-size` 为滑块值；刷新页面后滑块值保留（持久化到 settings store）。
4. 在 Console 执行 `getComputedStyle(document.documentElement).getPropertyValue('--font-size-ui-xl')` 应返回 `calc(...)` 展开后的 px 值（18px @14 基准 / 20px @16 基准）。

- [ ] **Step 9: Commit**

```bash
git add packages/ui/src/styles/theme.css packages/ui/src/styles/tailwind/index.css packages/ui/src/styles/utilities.css packages/app/src/context/settings.tsx packages/app/src/components/settings-general.tsx packages/app/src/i18n/zh.ts packages/app/src/i18n/en.ts
git commit -m "feat(ui): add text-ui-* type scale driven by --ui-font-size + settings slider"
```

---

### Task 2: 移除 Aurora 装饰（radial 背景 / 毛玻璃 / glow / 渐变描边）

**Files:**

- Modify: `packages/ui/src/styles/utilities.css:451-473,508-580,583-601,616-628,682-686`
- Modify: `packages/app/src/pages/layout.tsx:2439,2543`
- Modify: `packages/app/src/index.css:208-216,282-301,333-360`
- Modify: `packages/app/src/components/titlebar.tsx:179`

- [ ] **Step 1: 删除 utilities.css 中的装饰类与动画**

`packages/ui/src/styles/utilities.css` 删除以下整块（行号为当前值，按类名定位更稳）：

- `@keyframes aurora-flow`（L451-461）与 `@keyframes aurora-pulse`（L463-473）
- `.tech-gradient-light` / `.tech-gradient-dark`（L508-514，全仓无引用）
- `.tech-radial-light` + `::before`（L516-540）、`.tech-radial-dark` + `::before`（L542-566）
- `.aurora-overlay` + `::after`（L569-580）
- `.glass`（L583-591）与 `.glass-dark`（L593-601）——含 L422-436 处的重复定义（同名类搜到两处定义时两处都删；执行前跑 Step 3 的引用检查）
- `.gradient-border` / `.gradient-border-inner`（L616-628，全仓无引用）
- `.shadow-glow` / `.shadow-glow-hover`（L682-686）

- [ ] **Step 2: 删除 theme.css 中无引用的 aurora 阴影变量**

`packages/ui/src/styles/theme.css` 删除 L63-64：

```css
--shadow-glow: 0 0 20px rgba(99, 102, 241, 0.3);
--shadow-aurora: 0 8px 32px rgba(31, 38, 135, 0.08), 0 2px 8px rgba(20, 184, 166, 0.06);
```

- [ ] **Step 3: 引用残留检查（先跑，确认后再继续删）**

Run（仓库根）：

```powershell
Get-ChildItem -Path packages -Recurse -Include *.ts,*.tsx,*.css -Exclude *.d.ts | Select-String -Pattern 'tech-radial|aurora-overlay|aurora-flow|aurora-pulse|tech-gradient|shadow-glow|shadow-aurora|gradient-border-inner' | Select-Object Path, LineNumber, Line
```

Expected: 除本计划将要修改的 `layout.tsx` / `titlebar.tsx` / `utilities.css` / `theme.css` 自身定义外**零命中**。若出现额外引用文件，逐处把类名从 `class` 串中移除后再删定义（保留 `page-transition` 等功能性类）。

- [ ] **Step 4: layout.tsx 根容器去 Aurora**

`packages/app/src/pages/layout.tsx:2439`，将：

```tsx
      class="relative tech-radial-light dark:tech-radial-dark flex-1 min-h-0 min-w-0 flex flex-col select-none [&_input]:select-text [&_textarea]:select-text [&_[contenteditable]]:select-text aurora-overlay"
```

替换为：

```tsx
      class="relative bg-background-base flex-1 min-h-0 min-w-0 flex flex-col select-none [&_input]:select-text [&_textarea]:select-text [&_[contenteditable]]:select-text"
```

- [ ] **Step 5: layout.tsx 主区去毛玻璃**

`packages/app/src/pages/layout.tsx:2543`，将：

```tsx
                  "size-full overflow-x-hidden flex flex-col items-start border-t border-border-weak-base glass dark:glass-dark page-transition": true,
```

替换为：

```tsx
                  "size-full overflow-x-hidden flex flex-col items-start border-t border-border-weak-base bg-background-base page-transition": true,
```

（`page-transition` 是功能性过渡，规格 §6 要求保留。）

- [ ] **Step 6: titlebar 去渐变描边**

1. `packages/app/src/components/titlebar.tsx:179`：class 串中移除 `titlebar-gradient-border`（保留 `backdrop-blur-md` 等其余类）：

```tsx
      class="h-[50px] shrink-0 bg-background-base/90 backdrop-blur-md relative overflow-hidden"
```

2. `packages/app/src/index.css` 删除 L282-301 整块（`.titlebar-gradient-border` 及其 `::after`）。

- [ ] **Step 7: index.css 删 active-glow 与模式色辉光**

`packages/app/src/index.css`：

1. 删除 `@keyframes active-glow`（L208-216）。
2. L343-360 的 `.project-card.active::before, .project-card.active-indicator::before` 改为无辉光的静态标识条（模式色点缀保留、去渐变/去发光/去动画）：

```css
.project-card.active::before,
.project-card.active-indicator::before {
  content: "";
  position: absolute;
  left: 0;
  top: 50%;
  transform: translateY(-50%);
  width: 4px;
  height: 60%;
  background: var(--novaway-mode-color, var(--border-strong-base));
  border-radius: 0 4px 4px 0;
}
```

3. L333-336 的 `.project-card:hover` 去模式色辉光，改中性阴影：

```css
.project-card:hover {
  box-shadow: var(--shadow-card-hover);
}
```

（`transform: translateY(-2px)` 一并移除——规格深度收敛要求常态克制；`transition` 保留。）

4. L362-364 的 `.project-icon-default` 去模式色 inset：

```css
.project-icon-default {
  box-shadow: inset 0 0 0 1px var(--border-weak-base);
}
```

- [ ] **Step 8: 删除死代码 sidebar-rail**

`packages/app/src/index.css` 删除 L366-370（`[data-component="sidebar-rail"]`）——全仓无组件引用该 data-component。

- [ ] **Step 9: 验证**

Run: `bun lint && bun typecheck`
Expected: 通过

Run（残留复查）:

```powershell
Get-ChildItem -Path packages -Recurse -Include *.ts,*.tsx,*.css | Select-String -Pattern 'tech-radial|aurora-overlay|active-glow|titlebar-gradient-border|shadow-aurora|\bglass\b|dark:glass-dark'
```

Expected: 零命中

- [ ] **Step 10: Commit**

```bash
git add packages/ui/src/styles/utilities.css packages/ui/src/styles/theme.css packages/app/src/pages/layout.tsx packages/app/src/components/titlebar.tsx packages/app/src/index.css
git commit -m "feat(ui): remove Aurora decorations (radial bg, glass overlay, glow, gradient borders)"
```

---

### Task 3: 圆角层级与深度收敛

**Files:**

- Modify: `packages/app/src/pages/layout.tsx:2544`
- Modify: `packages/app/src/index.css:330,372-391,515`（行号随 Task 2 删行有偏移，按选择器定位）

- [ ] **Step 1: 主区装饰性大圆角 16px → 8px**

`packages/app/src/pages/layout.tsx:2544`，将：

```tsx
                  "xl:border-l xl:rounded-tl-[16px]": showSidebar() && store.workspaceSidebarExpanded,
```

替换为：

```tsx
                  "xl:border-l xl:rounded-tl-lg": showSidebar() && store.workspaceSidebarExpanded,
```

（`@theme` 中 `--radius-lg: 0.5rem` = 8px，即规格的「面板 16px → 8px」。）

- [ ] **Step 2: 删除按模式覆盖 main 圆角的装饰规则**

`packages/app/src/index.css` 删除以下整块（Task 2 后行号约 340-354，按选择器定位）：

```css
[data-app-mode="zen"] main {
  border-top-left-radius: 28px;
}

[data-app-mode="spark"] main {
  border-top-left-radius: 10px;
}

[data-app-mode="pulse"] main {
  border-top-left-radius: 20px;
}

[data-app-mode="future"] main {
  border-top-left-radius: 34px;
}
```

- [ ] **Step 3: 既有卡片/输入面板圆角对齐 8px**

`packages/app/src/index.css`：

1. `.project-card`（原 L328-331）：`border-radius: 12px;` → `border-radius: 8px;`
2. `.composer-floating`（原 L391 附近）：`border-radius: 16px;` → `border-radius: 8px;`
3. `.project-grid-card`（原 L515 附近）：`border-radius: 16px;` → `border-radius: 8px;`

- [ ] **Step 4: 验证视觉一致性**

手动（`http://localhost:4444`，双 dev server 见 Task 1 Step 8）：

- 侧栏展开时主区左上角为 8px 小圆角，无毛玻璃、无渐变描边
- 明/暗两态切换（titlebar 主题按钮）背景为纯 `--background-base`，无径向渐变
- 项目卡 hover 无模式色辉光、无上浮
- `bun lint && bun typecheck` 通过

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/pages/layout.tsx packages/app/src/index.css
git commit -m "feat(ui): converge radii to 8px panels and remove per-mode decorative corners"
```

---

### Task 4: 命令面板对齐菜单规范

**Files:**

- Modify: `packages/ui/src/components/dialog.css:50-53`

- [ ] **Step 1: 面板圆角 radius-xl → radius-lg**

`packages/ui/src/components/dialog.css` L50-53 附近，将：

```css
border-radius: var(--radius-xl);
```

替换为：

```css
border-radius: var(--radius-lg);
```

（仅 Dialog content 面板这一处——`drawer.css`/`dialog` 其它选择器不动；`--radius-xl` 现值 10px，规格菜单规范为 rounded-lg = 8px。背景 `--surface-raised-stronger-non-alpha` 与阴影 `--shadow-lg-border-base` 已是语义 token，无需改。）

- [ ] **Step 2: 确认菜单族圆角一致性**

Run:

```powershell
Get-ChildItem -Path packages\ui\src\components -Include dropdown-menu.css,context-menu.css,hover-card.css,list.css -Recurse | Select-String -Pattern 'border-radius'
```

Expected: 行/项级圆角为 `var(--radius-md)`（6px）或更小，面板级为 `radius-lg/xl`——记录不一致处；仅当面板级 > 8px 时对齐到 `var(--radius-lg)`，行级一律不动。

- [ ] **Step 3: 验证**

Run: `bun lint && bun typecheck`
Expected: 通过

手动：`Ctrl/Cmd+K` 打开命令面板——面板 8px 圆角、语义背景、激活行高亮正常；下拉菜单（右上设置齿轮旁）同样正常。

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/components/dialog.css
git commit -m "feat(ui): align command palette to menu spec (8px radius)"
```

---

### Task 5: 全量验证与回归

**Files:** 无修改（验证任务）

- [ ] **Step 1: 静态检查**

Run（仓库根）:

```bash
bun lint
bun typecheck
```

Expected: 均通过

- [ ] **Step 2: 单测**

Run:

```bash
bun run --cwd packages/app test:unit
```

Expected: PASS（含 `i18n/parity.test.ts`、`theme-preload.test.ts`）

- [ ] **Step 3: e2e 回归**

Run:

```bash
bun run --cwd packages/app test:e2e
```

Expected: `office.spec.ts` 6 个测试全 PASS（本计划不改首页，不应有破坏；若失败先确认是否为环境性失败——需后端 4096 + web 3000 就绪）。

- [ ] **Step 4: 手动清单（规格 §9）**

双 dev server 起后（`packages/novaway` 4096 + `packages/app` 4444），逐项打勾：

- [ ] 桌面宽度（≥1280）明/暗两态：根背景纯色、titlebar 底边无渐变线、主区无毛玻璃
- [ ] 抽查 2 套主题（titlebar 主题按钮循环）：语义 token 正常、无残留 Aurora 类报错（Console 无 CSS 404）
- [ ] 断点 xl 以下侧栏抽屉、md 以下右栏隐藏——行为与改造前一致
- [ ] 设置 → 通用 → 外观：字号滑块 12–16 全程生效并持久化
- [ ] 命令面板、下拉菜单、Toast（触发一次会话操作）圆角与阴影符合菜单规范
- [ ] 侧栏项目卡 hover/选中：中性阴影 + 静态模式色条，无呼吸 glow

- [ ] **Step 5: 汇总提交（若有清单项返工）**

每个返工点修复后单独 commit，信息格式 `fix(ui): <问题描述>`。

---

## 自查记录（Self-Review）

- **规格覆盖**：§6 移除项全部落位（radial L2439、overlay L2439、active-glow、titlebar 渐变、模式色铺底见 index.css 各步、16px→8px Task 3）；`text-ui-*` 字阶 + `--ui-font-size` = Task 1；表面三层级/4px/深度收敛 = Task 2/3 的 token 化替换；§7 命令面板菜单规范 = Task 4；§6 收敛保留项（5 模式变量机制、39 主题、page-transition）在各删除步骤中显式保留。§6「实现路径」提到的 `modeStyle` 注入点本身保留（点缀变量供侧栏色条等使用），其铺底消费在 Task 2 Step 7 收敛。
- **占位符**：无 TBD/TODO；所有样式步骤给出完整 CSS/TSX 块与确切选择器。
- **类型一致性**：`settings.appearance.fontSize()/setFontSize()` 与 `context/settings.tsx:269-272` 现有签名一致；i18n key 两语言同名成对。
- **已知边界**：存量 `text-N-*` 类与对话正文/代码/终端字号保持静态（规格要求内容字号独立）；`text-ui-*` 的全站迁移在 Plan B 新组件中落地，故本计划滑块的可见生效面为设置页自身及采用新字阶的组件——此为规格「UI 层禁用内置字号」终态的分阶段实现，已在此说明。
