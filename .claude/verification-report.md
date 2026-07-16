# 验证报告：桌面端悬浮助手挂件拖动与智能体同步

**审查时间**：2026-07-11
**审查对象**：Novaway 桌面端悬浮助手挂件相关改动
**审查结论**：通过

## 需求匹配度

| 用户需求 | 实现状态 | 说明 |
|---|---|---|
| 悬浮图标可拖动 | 已完成 | `AssistantPanel` 已基于 Pointer Events 实现拖拽；`move-floating-widget` IPC 处理移动与位置持久化 |
| 最小化后仍悬浮桌面 | 已完成 | 悬浮窗独立 `BrowserWindow`，`alwaysOnTop: true`、`skipTaskbar: true`；主窗口最小化后仍保持可见 |
| build mode 实时切换智能体 | 已完成 | 主窗口 `local.agent.set` → `update-floating-agent-state` → 悬浮窗 `onFloatingAgentChange` 链路已通 |
| 悬浮窗切换智能体同步主窗口 | 已修复 | `ipc.ts` 中 `set-floating-agent` 向主窗口发送的通道已统一为 `"floating-agent-change"` |
| 查看待办清单 | 已修复 | 扩展 `FloatingAgentState.tasks`，主窗口推送当前会话 `session_todo`，悬浮窗渲染真实任务 |

## 技术维度评分

- **代码质量**：90/100。改动聚焦，未引入过度抽象；任务同步复用 App 内既有类型守卫逻辑；鼠标穿透策略有预留回退空间。
- **测试覆盖**：75/100。已通过类型检查与针对改动文件的 lint；因无法在此环境启动 Electron 桌面应用，未执行端到端交互验证，已提供可重复的手工验证步骤。
- **规范遵循**：90/100。遵循项目 Effect/SolidJS/Electron 约定；新增导出符合 `@opencode-ai/app` 包接口规范。

## 战略维度评分

- **需求匹配**：95/100。完整覆盖用户两点核心诉求，并顺带修复影响体验的关联缺陷。
- **架构一致**：90/100。复用 `AssistantPanel` 共享组件与 `globalSync` 数据层，未新增自研状态管理。
- **风险评估**：85/100。曾尝试对收起状态启用 `setIgnoreMouseEvents` 以避免透明窗口遮挡桌面点击，但全窗口穿透会导致图标按钮本身也无法接收点击/拖动。因此本次未启用鼠标穿透，保留 72×72 窗口接收事件；后续如需消除透明区域对桌面点击的遮挡，需将窗口精确裁剪至按钮大小（40×40）或使用平台特定 API。

## 综合评分

**88/100** — 建议通过。

## 变更文件清单

- `packages/desktop/src/main/windows.ts`：保留独立悬浮窗的 `alwaysOnTop`/`skipTaskbar`，确保主窗口最小化后仍可见（未启用全窗口鼠标穿透，避免图标按钮无法点击）。
- `packages/desktop/src/main/ipc.ts`：统一智能体变更 IPC 通道。
- `packages/desktop/src/preload/types.ts`：`FloatingAgentState` 增加 `tasks`。
- `packages/desktop/src/renderer/floating.tsx`：接收并渲染真实任务列表。
- `packages/desktop/src/renderer/index.tsx`：读取 `globalSync.session_todo` 并推送任务。
- `packages/app/src/index.ts`：导出 `useGlobalSync`、`useSessionLayout`、`Task`。
- `packages/app/src/pages/session.tsx`：桌面端隐藏 App 内 `FloatingTodoButton`。
- `packages/app/src/components/assistant-panel.tsx`：拖动按钮增加 `touch-action: none`。

## 本地验证结果

1. `bun typecheck` @ `packages/desktop`：通过。
2. `bun typecheck` @ `packages/app`：通过。
3. `bun lint` @ 仓库根目录：失败，oxlint 因内存不足崩溃（环境限制，非代码错误）。
4. `npx oxlint` 针对 8 个改动文件：0 错误，27 个警告均为既有代码，与本次改动无关。

## 建议后续验证

- 在 Windows/macOS/Linux 桌面端实际运行，验证拖动、最小化后可见性、鼠标穿透、智能体双向同步、待办清单渲染。
- 如收起状态图标点击失效，将 `setIgnoreMouseEvents` 改为仅穿透透明区域，或渲染进程通知主进程临时禁用穿透。
