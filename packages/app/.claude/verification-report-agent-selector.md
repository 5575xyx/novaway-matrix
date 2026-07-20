# 验证报告：forge 模式 Plan/Build 智能体选择器

生成时间：2026-07-10

## 改动文件

- `packages/app/src/components/session/session-new-view.tsx`

## 关键实现位置

1. **引入依赖**（第 10-11 行）
   - 新增 `useLayout` 与 `useLocal` 的导入。

2. **获取上下文**（第 38-39 行）
   - 调用 `useLayout()` 与 `useLocal()`。

3. **派生状态**（第 88-93 行）
   - `isForge`：判断 `layout.mode.current() === "forge"`。
   - `currentAgent`：若当前 agent 不是 `"plan"` 或 `"build"`，则默认视为 `"build"`。

4. **选择器 JSX**（第 124-158 行）
   - 仅当 `isForge()` 为真时，在 `PromptInput` 上方渲染两个水平排列的卡片。
   - Plan/Build 分别对应 `"plan"` 与 `"build"`。
   - 标题与描述使用 `language.t("session.new.agentSelector.{plan|build}.{title|description}")`。
   - 颜色使用 agent 对应的 CSS 变量：`--icon-agent-plan-base` / `--icon-agent-build-base`。
   - 激活态边框与背景色会随 agent 颜色变化；非激活态有 hover 效果。
   - 点击卡片调用 `local.agent.set(agent.name)`。

## 验证结果

- `bun typecheck`（packages/app 目录）：通过，无错误。
- `bun lint packages/app/src/components/session/session-new-view.tsx`：通过，无错误（仅报告文件内既有未使用变量 warning，非本次引入）。

## 兼容性说明

- 组件导出 `NewSessionView` 与 props 签名保持不变。
- 未引入新依赖。
- i18n 键 `session.new.agentSelector.*` 已在所有语言文件中存在，无需新增。
