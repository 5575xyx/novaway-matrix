# 锻造模式调度中控改造设计

**日期**：2026-06-07
**状态**：待评审
**范围**：仅 forge 模式；涉及服务端 1 个文件重写 + 1 个文件新增，前端 4 个文件改动

## 目标

将 forge 模式从"前端硬编码强制 plan → 弹框确认 → 切 build"改造为"通过 `agents-orchestrator` 智能调度全部 197 个 AI 员工"。

改造后：

- 用户在 forge 模式输入任何消息，默认由 `agents-orchestrator` 接收
- orchestrator 按 system prompt 注入的 agent 列表智能匹配，自主决定直接回复 / 调 `task` 委派 / 调 `question` 澄清
- 移除前端硬编码的"规划蓝图已完成"提示框

## 非目标

- 不新增 agent
- 不动 opencode 服务端核心（agent 加载机制、prompt 主循环、task 工具）
- 不改 mode 系统（zen/spark/pulse/future 保持不变）
- 不改其他模式行为
- 不重写 `task` 工具的权限弹窗（`ctx.ask` 行为保留）
- 不提供向后兼容

## 探索结论

### 现有"锻造"强制逻辑

| 文件                                                                     | 行        | 作用                                                               |
| ------------------------------------------------------------------------ | --------- | ------------------------------------------------------------------ |
| `packages/app/src/context/local-agent.ts`                                | 20-33     | `forgeAgentForPrompt` 强制非 `/` 开头输入走 plan                   |
| `packages/app/src/context/local-agent.ts`                                | 35-45     | `shouldAutoBuildAfterForgePlan` 触发自动 build                     |
| `packages/app/src/pages/session.tsx`                                     | 430-438   | `forgeAutoBuild` store                                             |
| `packages/app/src/pages/session.tsx`                                     | 1445-1500 | `planDecision` memo + `executePlanDecision` + `revisePlanDecision` |
| `packages/app/src/pages/session.tsx`                                     | 1407-1443 | `forgeBuildText` 合成 build 提示词 + `sendForgeBuild`              |
| `packages/app/src/pages/session/composer/session-composer-region.tsx`    | 272-278   | `<SessionPlanDecisionDock>` 渲染                                   |
| `packages/app/src/pages/session/composer/session-plan-decision-dock.tsx` | 全文      | "规划蓝图已完成"提示框                                             |

### opencode 原生调度机制（可复用）

| 机制                                         | 位置                                            | 作用                                                                                                      |
| -------------------------------------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `task` 工具                                  | `packages/opencode/src/tool/task.ts:103`        | primary agent 委派任务给任意 agent（包括 primary 和 subagent）                                            |
| `task_status` 工具                           | `packages/opencode/src/tool/task_status.ts`     | 轮询 / 阻塞后台任务                                                                                       |
| `question` 工具                              | `packages/opencode/src/tool/question.ts`        | 需求澄清（所有 primary 默认 `allow`）                                                                     |
| `subagent_type` 参数                         | `task.ts:139`                                   | `agent.get(params.subagent_type)`，**任意 agent 名均可**                                                  |
| `SystemPrompt.skills`                        | `packages/opencode/src/session/system.ts:65-77` | system prompt 注入 skill 列表的模式可复用                                                                 |
| `Permission.deriveSubagentSessionPermission` | `subagent-permissions.ts:17-34`                 | subagent 默认 `task: "deny"`，orchestrator 作为 primary 可调 task 委派 subagent；subagent 不能再嵌套 task |

### 已存在的 `agents-orchestrator`

| 属性   | 值                                                                                    | 位置                                         |
| ------ | ------------------------------------------------------------------------------------- | -------------------------------------------- |
| ID     | `agents-orchestrator`                                                                 | `packages/opencode/src/agent/agency.ts:5-12` |
| Mode   | `primary`                                                                             | `agency.ts:292`                              |
| 显示名 | "Agent 编排总控"                                                                      | `agency.ts:38`                               |
| 分类   | "专项能力"                                                                            | `agency.ts:23`                               |
| 权限   | `*` allow + `question: "allow"`（继承 `defaults` 的 `*: allow`）                      | `agency.ts:297-303`                          |
| Prompt | `packages/opencode/src/agent/prompt/agency-agents/specialized/agents-orchestrator.md` | 367 行                                       |

### `agents-orchestrator` 当前 prompt 的 3 个问题

1. **调度范围硬编码**：第 295-358 行 `Available Specialist Agents` 列出约 49 个英文名，不是 197 个
2. **命名空间不一致**：列的是 `ArchitectUX`，实际 ID 是 `engineering-architect-ux`，`task` 工具调用对不上名字
3. **工作流模板太死板**：Phase 1-4 强约束 PM→ArchitectUX→Dev↔QA→Integration，简单任务"帮我查一下合同"也被套上完整 pipeline

### AI 员工加载路径

```
.novaway/agent/**/*.md                    (用户自定义)
  ↓ Glob.scan
ConfigAgent.load(dir)                     (config/agent.ts:105)
  ↓ mergeDeep
config.agent                              (config.ts:656)
  ↓
agent.ts:455-482 加载到 agents 字典
  +
agency.ts:286 加载 AGENCY_AGENT_SOURCES (197 个)
  ↓
agents.list() / agents.get(name)          (服务接口)
```

## 设计

### 改动 1：重写 `agents-orchestrator.md`

**位置**：`packages/opencode/src/agent/prompt/agency-agents/specialized/agents-orchestrator.md`

**新 prompt 结构**（要点，详细内容在实现时由 writing-plans 拆分）：

```markdown
---
name: Agents Orchestrator
description: 锻造模式调度中控。通过 task 工具智能调度所有可用 AI 员工，不直接执行文件操作。
color: cyan
emoji: 🎛️
vibe: 整个 AI 员工团队的中控调度。
---

# 角色定位

你是锻造模式的调度中控，**不直接执行工具**（除 `question` / 调 `task` 委派），只负责把用户任务分派给最合适的 AI 员工。

# 调度协议

1. 收到用户消息
2. 读 system prompt 注入的"可用 AI 员工列表"（见下文 `availableAgents`）
3. 按 description 语义匹配 1 个或多个 agent
4. 调 `task(subagent_type=<agent_id>, prompt=...)` 委派
5. 多个 agent 并行时，**单条消息内多次 tool call**
6. 收集结果，向用户回复

# 任务分类路由

| 任务类型                   | 处理方式                                  |
| -------------------------- | ----------------------------------------- |
| 闲聊 / 简单问答            | 直接回复，不调 `task`                     |
| 单一专业任务（如"审合同"） | `task(<匹配的专业 agent>)`                |
| 多步复杂任务               | `task(general)` 拆分并行                  |
| 涉及代码改动               | `task(build)`（build 智能体可直接改文件） |
| 需要先规划后实施           | `task(plan)` → 用户确认 → `task(build)`   |
| 只读分析 / 研究            | `task(plan)` 或 `task(explore)`           |
| 需求不明确                 | `question` 工具问用户澄清                 |

# 与 build / plan 协议

- `task(build)`：build 智能体拥有全部原生工具（shell/edit/write），可直接改文件
- `task(plan)`：plan 智能体只读，只能写入 plan 文件；适合"先规划"场景
- `task(plan_exit)` 工具会弹 Yes/No 让用户确认切 build——若用户已明确要"做了"，直接 `task(build)` 即可

# 失败处理

- 任务失败：自动重试 1-2 次
- 仍失败：向用户报告，不无限循环
- 不确定走哪个 agent：优先选描述最匹配的 1 个，不确定就用 `question` 问

# 工具使用约束

- 不直接调 `shell` / `edit` / `write` / `patch`
- `question` 工具可在调度前澄清（避免浪费 sub-session）
- `task` 工具的 `subagent_type` 必须是上面注入的 agent 列表中的名字，否则会报错
```

**关键变化**：

- 删掉第 53-108 行的 Phase 1-4 死板 pipeline
- 删掉第 295-358 行的"Available Specialist Agents"硬编码列表
- 新增"调度协议"和"任务分类路由"两节

### 改动 2：system prompt 动态注入 agent 列表

**位置**：`packages/opencode/src/session/system.ts:35-77`

**新增** `availableAgents` 函数（接口扩展在 `system.ts:37`，实现在 system.ts body 内）：

```ts
availableAgents: Effect.fn("SystemPrompt.availableAgents")(function* (agent: Agent.Info) {
  if (agent.name !== "agents-orchestrator") return
  const list = (yield* Agent.Service.list()).filter((a) => !a.hidden && a.name !== agent.name)
  if (list.length === 0) return
  return [
    "The following agents are available for you to dispatch via the task tool.",
    "Read each agent's description to match user intent:",
    "",
    ...list.map((a) => {
      const category = a.options?.category ? `[${a.options.category}]` : ""
      return `  - ${a.name} ${category}: ${a.description}`
    }),
  ].join("\n")
})
```

**对接**：`packages/opencode/src/session/prompt.ts:2134-2139` 是 `sys.skills(agent)` 和 `sys.environment(model)` 现有拼装点，`availableAgents` 需在此处加入。

### 改动 3：删除前端 forge 强制逻辑

**位置 A**：`packages/app/src/context/local-agent.ts:20-33`

```ts
export function forgeAgentForPrompt(input: {
  mode: AppMode | undefined
  current?: string
  text: string
  promptMode?: "normal" | "shell"
}) {
  if (input.mode !== "forge") return input.current
  if (input.promptMode === "shell") return "build"
  if (input.text.startsWith("/")) return input.current
  return input.current // 关键改动：不再强制 plan
}
```

**位置 B**：`packages/app/src/context/local.tsx:90`

```ts
const [store, setStore] = createStore<{
  current?: string
  draft?: State
  ...
}>({
  current: undefined as string | undefined,  // 改前是 list()[0]?.name
  ...
})
```

并在 `local.tsx:114-122` 的 `createEffect` 中添加：当 `layout.mode.current() === "forge"` 时 `setStore("current", "agents-orchestrator")`。

### 改动 4：删除前端 plan 确认框

**位置 A**：删除 `packages/app/src/pages/session/composer/session-plan-decision-dock.tsx`（整个文件）

**位置 B**：`packages/app/src/pages/session/composer/session-composer-region.tsx:272-278` 删除 `<SessionPlanDecisionDock>` 引用及其 props

**位置 C**：`packages/app/src/pages/session.tsx`

- 删除 `forgeAutoBuild` store（430-438）
- 删除 `requestForgeAutoBuildPlan`（440-442）
- 删除 `forgeBuildText`（1407-1414）
- 删除 `sendForgeBuild`（1416-1443）
- 删除 `planDecision` memo（1445-1463）
- 删除 `executePlanDecision`（1465-1490）
- 删除 `revisePlanDecision`（1492-1500）
- 删除 `forgeAutoBuildAssistant` memo（1502-1511）
- 删除 `createEffect` 监听 forge auto build（1513-1541）
- 删除 `SessionComposerRegion` 的 `planDecision` prop（1964-1972）

### 数据流（用户在 forge 模式问"帮我审合同"）

```
1. 用户在 forge 模式输入框输入"帮我审合同"
2. 前端 usePrompt 拿到 prompt
3. local.tsx 的 current = "agents-orchestrator"（layout.mode === "forge" 决定）
4. submit.ts:412 forgeAgentForPrompt({mode:"forge", current:"agents-orchestrator", text:"帮我审合同"})
   → 返回 "agents-orchestrator"（不再强制 plan）
5. submit.ts:426 draft.agent = "agents-orchestrator"
6. submit.ts:596 sendFollowupDraft → 服务端 session.prompt
7. 服务端 prompt.ts:1154 agents.get("agents-orchestrator")
8. prompt.ts:1186 userMessage.info.agent = "agents-orchestrator"
9. prompt.ts:2041 agents.get("agents-orchestrator") → 加载新 ORCHESTRATOR_PROMPT
10. system prompt 拼装：PROMPT_DEFAULT + ORCHESTRATOR_PROMPT + availableAgents 列表 + skills + environment
11. orchestrator LLM 推理 → 读到 197 个 agent 列表 → 匹配"legal-compliance-checker"
12. orchestrator 调 task(subagent_type="legal-compliance-checker", prompt="审这份合同...")
13. task.ts:128 ctx.ask 弹"是否允许"（保留 opencode 原生权限弹窗）
14. 用户授权 → task.ts:139 agent.get("legal-compliance-checker") → sub-session 创建
15. legal-compliance-checker 执行审查
16. 结果返回 orchestrator → orchestrator 整合 → 回复用户
```

## 风险与缓解

| 风险                                                            | 影响                                                                                    | 缓解                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 197 个 agent 全部注入 system prompt，token 成本上升             | 每次对话多消耗约 2-4K token                                                             | 注入时只保留 `id + category + description`（不含 prompt）                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `task` 工具的 `ctx.ask` 弹窗（`task.ts:128`）在频繁调度时 UX 差 | 用户每次都要点"允许"                                                                    | **已解决**：开启"自动接受权限"按钮（`packages/app/src/context/permission.tsx`）即可消除弹窗。证据链：`permission/index.ts:189` 把 `ctx.ask` 桥接为 `permission.asked` 事件；`packages/app/src/context/permission-auto-respond.ts:41-50` 的 `autoRespondsPermission` 沿 `sessionLineage`（`session.sql.ts:25` `parent_id`）检查所有祖先 session 的 `autoAccept` 标记；`task.ts:154-169` 创建的 sub-session 带 `parentID: ctx.sessionID`，自然落入会话链。实施时需在 release notes 和"用户指南"中显式说明此联动 |
| orchestrator 路由识别错误                                       | 用户体验受损                                                                            | 1) description 模板统一为"内置{分类} AI 员工..."，路由稳定；2) 不确定时优先用 `question` 问                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 用户自定义 agent 的 description 写得不规范                      | 路由失败                                                                                | 在 spec 文档配套用户指南，给出 description 编写规范                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 涉及代码改动的任务，orchestrator 不会自动改文件                 | 与原 build 行为差异                                                                     | prompt 明确指引涉及代码改动走 `task(build)`；原有 build 智能体不变                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 现有 `agents-orchestrator` 用户的对话（如果有）行为变化         | 数据迁移                                                                                | 同一 agent 名字，已存消息不受影响；行为差异在 release notes 说明                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `availableAgents` 在 prompt.ts 中的调用点                       | 已定位 `prompt.ts:2134-2139` 是 `sys.skills` 现有拼装点，`availableAgents` 在此加入即可 | 无                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 用户的 `default_agent` config 设为 `build` 时，forge 模式优先   | 与设计冲突                                                                              | `local.tsx:90` 强制 forge 模式 current 为 `agents-orchestrator`，覆盖 default_agent                                                                                                                                                                                                                                                                                                                                                                                                                           |

## 测试

### 单元测试

| 覆盖点                                                                                 | 文件                                                 |
| -------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `forgeAgentForPrompt` 改后行为：forge 模式非命令输入返回 current（不再 plan）          | `packages/app/src/context/local.test.ts`             |
| `local.tsx` 初始 current：forge 模式 → `agents-orchestrator`，其他模式 → 原行为        | 新增 `packages/app/src/context/local.test.ts`        |
| `SystemPrompt.availableAgents`：orchestrator agent 注入列表，其他 agent 注入 undefined | 新增 `packages/opencode/test/session/system.test.ts` |

### 集成测试

| 覆盖点                                                                                           | 文件                                                              |
| ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| `agents-orchestrator` 加载新 prompt，prompt 包含 4 节（角色定位/调度协议/任务分类路由/工具约束） | `packages/opencode/test/agent/agent.test.ts:199` 现有 case 需更新 |
| `agents.list()` 过滤 hidden 后的数量                                                             | `packages/opencode/test/agent/agent.test.ts`                      |

### E2E（手动 / Playwright）

| 场景                                          | 步骤                                                                        |
| --------------------------------------------- | --------------------------------------------------------------------------- |
| forge 模式问"审合同"                          | 1) 切到 forge 模式 2) 输入"审合同" 3) 检查 sub-session 创建 4) 检查结果返回 |
| forge 模式问"你好"                            | 1) 切到 forge 模式 2) 输入"你好" 3) 检查无 sub-session 创建，直接回复       |
| forge 模式不显示"规划蓝图已完成"提示框        | 1) 切到 forge 模式 2) 输入任意消息 3) 完成对话 4) 检查 UI 无 dock 提示框    |
| forge 模式默认 agent 是 `agents-orchestrator` | 1) 切到 forge 模式 2) 检查底部 agent 选 `agents-orchestrator`               |

## 迁移

按 AGENTS.md 强制破坏性更改策略，不提供向后兼容：

- **现有 forge 模式用户**：
  - 不再看到"规划蓝图已完成，请确认下一步"提示框
  - 对话不再自动走 plan → 弹框 → build
  - 由 orchestrator 智能路由
- **现有 `agents-orchestrator` 用户**（如果之前调过）：
  - 同一 agent 名字，已存消息不受影响
  - 行为变化：从死板 Phase 1-4 改为智能调度
- **文档**：
  - 更新 `packages/app/AGENTS.md`：删除对 `forgeAgentForPrompt` / `SessionPlanDecisionDock` 的引用
  - 写一份 release notes，说明 forge 模式新行为
  - 写一份"AI 员工 description 编写规范"文档，引导用户写好自定义 agent 的 description

## 交付物

- [ ] `packages/opencode/src/agent/prompt/agency-agents/specialized/agents-orchestrator.md` 重写
- [ ] `packages/opencode/src/session/system.ts` 新增 `availableAgents`
- [ ] `packages/opencode/src/session/prompt.ts` 调用 `availableAgents` 拼装 system prompt
- [ ] `packages/opencode/test/agent/agent.test.ts` 更新相关 case
- [ ] `packages/opencode/test/session/system.test.ts` 新增（可选）
- [ ] `packages/app/src/context/local-agent.ts` `forgeAgentForPrompt` 改写
- [ ] `packages/app/src/context/local.tsx` 初始 current 逻辑
- [ ] `packages/app/src/context/local.test.ts` 新增 / 更新
- [ ] `packages/app/src/pages/session.tsx` 删除 planDecision 相关
- [ ] `packages/app/src/pages/session/composer/session-composer-region.tsx` 删除 dock 引用
- [ ] `packages/app/src/pages/session/composer/session-plan-decision-dock.tsx` 删除
- [ ] `packages/app/AGENTS.md` 更新（如果有引用）
- [ ] 用户指南：AI 员工 description 编写规范
- [ ] Release notes

## 后续（不在本设计范围）

- orchestrator session 的 permission 配置（是否在 forge 模式启动时**默认开启** autoAccept，而非依赖用户手动点）
- 其他模式（zen / spark / pulse / future）的统一调度
- `agents-orchestrator` prompt 调优（基于实际使用数据）
