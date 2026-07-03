# 锻造模式调度中控改造 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 forge 模式从"前端硬编码强制 plan → 弹框确认 → 切 build"改造为"通过 `agents-orchestrator` 智能调度全部内置 AI 员工"，并移除"规划蓝图已完成"提示框。

**Architecture:**
- 服务端：在 `SystemPrompt` 新增 `availableAgents` 函数，遍历 `Agent.Service.list()` 过滤 hidden + 自身后注入到 orchestrator 的 system prompt；`prompt.ts:2134-2139` 调用点拼装。
- 客户端：删除 `forgeAgentForPrompt` 的强制 plan 逻辑、`local.tsx` 默认 agent 切到 `agents-orchestrator`、删除 planDecision / forgeAutoBuild / `SessionPlanDecisionDock` 整条链。
- Prompt：重写 `agents-orchestrator.md`，删 Phase 1-4 死板 pipeline 和硬编码的 ~49 个英文 agent 列表，改为"按 system 注入的 197 个 agent 列表做语义路由"。

**Tech Stack:** Bun 1.3+, TypeScript, Effect v4 (`Effect.fn` / `Effect.gen`), SolidJS (`createStore`), Drizzle (snake_case), oxlint (typeAware).

**Spec:** `docs/superpowers/specs/2026-06-07-forge-orchestrator-design.md`（已通过评审,风险表 #2 标注已解决）。

**TDD 策略：** 用户（AGENTS.md）禁用 test-driven 工作流，本计划按"实现 → 验证 → 提交"排序，**测试代码**仍随实现一起编写以保证覆盖率,但不强制 red-green-refactor 循环。

---

## 文件结构地图

| 区 | 文件 | 改动类型 | 责任 |
|----|------|----------|------|
| 服务端 - prompt 数据 | `packages/opencode/src/session/system.ts` | 修改 | 新增 `availableAgents` 函数,扩展 `Interface` |
| 服务端 - prompt 拼装 | `packages/opencode/src/session/prompt.ts` | 修改 | 在 `Effect.all` 加 `availableAgents`、在 `system` 数组里加条目 |
| 服务端 - orchestrator prompt | `packages/opencode/src/agent/prompt/agency-agents/specialized/agents-orchestrator.md` | 重写 | 删 Phase 1-4 + 硬编码列表,改写为调度协议 |
| 服务端 - 测试 | `packages/opencode/test/session/system.test.ts` | 修改 | 新增 `availableAgents` 测试 |
| 服务端 - 测试 | `packages/opencode/test/agent/agent.test.ts` | 修改 | 更新 orchestrator 测试(适配新 prompt) |
| 客户端 - 工具函数 | `packages/app/src/context/local-agent.ts` | 修改 | `forgeAgentForPrompt` 改写;`visibleAgentList` 加 `agents-orchestrator`;`shouldAutoBuildAfterForgePlan`/`hasForgeBuildIntent` 标记为 `@deprecated` 保留但不在新流程使用 |
| 客户端 - 默认 agent | `packages/app/src/context/local.tsx` | 修改 | 初始 `current` 改成 forge 模式 → `agents-orchestrator` |
| 客户端 - 提交链 | `packages/app/src/components/prompt-input/submit.ts` | 修改 | 删除 `onForgeAutoBuildPlan` 判断点(519-528) |
| 客户端 - PromptInput | `packages/app/src/components/prompt-input.tsx` | 修改 | 删除 `onForgeAutoBuildPlan` prop(78、1279) |
| 客户端 - 新会话视图 | `packages/app/src/components/session/session-new-view.tsx` | 修改 | 删除 `onForgeAutoBuildPlan` prop(26、122) |
| 客户端 - Composer | `packages/app/src/pages/session/composer/session-composer-region.tsx` | 修改 | 删除 `planDecision` prop + `<SessionPlanDecisionDock>` 引用;删除 `onForgeAutoBuildPlan` prop |
| 客户端 - Dock | `packages/app/src/pages/session/composer/session-plan-decision-dock.tsx` | 删除 | 文件整删 |
| 客户端 - Session | `packages/app/src/pages/session.tsx` | 修改 | 删除 `forgeAutoBuild` store、`requestForgeAutoBuildPlan`、`forgeBuildText`、`sendForgeBuild`、`planDecision` memo、`executePlanDecision`、`revisePlanDecision`、`forgeAutoBuildAssistant` memo、相关 createEffect、`SessionComposerRegion` 上的 `planDecision`/`onForgeAutoBuildPlan` props |
| 客户端 - 测试 | `packages/app/src/context/local.test.ts` | 修改 | 更新 `visibleAgentList` + `forgeAgentForPrompt` 用例(适配新行为) |
| 文档 | `docs/superpowers/plans/2026-06-07-forge-orchestrator.md` | 当前文件 | 此计划 |
| 文档 | `docs/superpowers/specs/2026-06-07-forge-orchestrator-design.md` | 已更新 | spec 风险表 #2 标注已解决 |

**依赖顺序：**
1. 服务端 system.ts (Task 1) → prompt.ts (Task 2) → agents-orchestrator.md (Task 3)
2. 服务端测试 (Task 4)
3. 客户端 local-agent.ts (Task 5) → local.tsx (Task 6) → 客户端提交链 (Task 7-8) → 删除 planDecision 链 (Task 9)
4. 客户端测试 (Task 10)
5. 文档(集成在每个 task 的 commit message 里,无独立 task)

---

## Task 1：服务端新增 `SystemPrompt.availableAgents`

**Files:**
- Modify: `packages/opencode/src/session/system.ts:35-38, 47-77`

- [ ] **Step 1: 扩展 `Interface` 加 `availableAgents`**

`packages/opencode/src/session/system.ts` 第 35-38 行,改为:

```ts
export interface Interface {
  readonly environment: (model: Provider.Model) => Effect.Effect<string[]>
  readonly skills: (agent: Agent.Info) => Effect.Effect<string | undefined>
  readonly availableAgents: (agent: Agent.Info) => Effect.Effect<string | undefined>
}
```

- [ ] **Step 2: 在 layer 里 import Agent.Service 并实现 `availableAgents`**

`packages/opencode/src/session/system.ts` 第 1-17 行的 import 改为:

```ts
import { Context, Effect, Layer } from "effect"

import { InstanceState } from "@/effect/instance-state"

import PROMPT_ANTHROPIC from "./prompt/anthropic.txt"
import PROMPT_DEFAULT from "./prompt/default.txt"
import PROMPT_BEAST from "./prompt/beast.txt"
import PROMPT_GEMINI from "./prompt/gemini.txt"
import PROMPT_GPT from "./prompt/gpt.txt"
import PROMPT_KIMI from "./prompt/kimi.txt"

import PROMPT_CODEX from "./prompt/codex.txt"
import PROMPT_TRINITY from "./prompt/trinity.txt"
import type { Provider } from "@/provider/provider"
import type { Agent } from "@/agent/agent"
import { Agent as AgentService } from "@/agent/agent"
import { Permission } from "@/permission"
import { Skill } from "@/skill"
```

注意:`type { Agent }` 用于类型（`Agent.Info` 仍指向 `Info` 类型）;`Agent as AgentService` 用于运行时（`yield* AgentService.Service`）。

- [ ] **Step 3: 在 layer body 里 yield AgentService 并实现 `availableAgents`**

`packages/opencode/src/session/system.ts` 第 42-80 行 `Layer.effect(Service, Effect.gen(...))` 改为:

```ts
export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const skill = yield* Skill.Service
    const agents = yield* AgentService.Service

    return Service.of({
      environment: Effect.fn("SystemPrompt.environment")(function* (model: Provider.Model) {
        const ctx = yield* InstanceState.context
        return [
          [
            `You are powered by the model named ${model.api.id}. The exact model ID is ${model.providerID}/${model.api.id}`,
            `Here is some useful information about the environment you are running in:`,
            `<env>`,
            `  Working directory: ${ctx.directory}`,
            `  Workspace root folder: ${ctx.worktree}`,
            `  Is directory a git repo: ${ctx.project.vcs === "git" ? "yes" : "no"}`,
            `  Platform: ${process.platform}`,
            `  Today's date: ${new Date().toDateString()}`,
            `</env>`,
          ].join("\n"),
        ]
      }),

      skills: Effect.fn("SystemPrompt.skills")(function* (agent: Agent.Info) {
        if (Permission.disabled(["skill"], agent.permission).has("skill")) return

        const list = yield* skill.available(agent)

        return [
          "Skills provide specialized instructions and workflows for specific tasks.",
          "Use the skill tool to load a skill when a task matches its description.",
          // the agents seem to ingest the information about skills a bit better if we present a more verbose
          // version of them here and a less verbose version in tool description, rather than vice versa.
          Skill.fmt(list, { verbose: true }),
        ].join("\n")
      }),

      availableAgents: Effect.fn("SystemPrompt.availableAgents")(function* (agent: Agent.Info) {
        if (agent.name !== "agents-orchestrator") return
        if (Permission.disabled(["task"], agent.permission).has("task")) return

        const list = (yield* agents.list())
          .filter((a) => !a.hidden && a.name !== agent.name)
          .toSorted((a, b) => a.name.localeCompare(b.name))

        if (list.length === 0) return

        return [
          "The following AI employees are available for you to dispatch via the task tool.",
          "Read each agent's name, category, and description to match the user's intent:",
          "",
          ...list.map((a) => {
            const category = (a.options as { category?: string } | undefined)?.category
            const tag = category ? ` [${category}]` : ""
            return `  - ${a.name}${tag}: ${a.description}`
          }),
        ].join("\n")
      }),
    })
  }),
)
```

要点：
- 仅当 agent 是 `agents-orchestrator` 才注入,避免污染其他 agent 的 system prompt
- 排序后注入,确保多次调用 token-stable(配合 system.test.ts 的断言)
- `Permission.disabled(["task"])` 拦截"task 被禁"的边界,与 `skills` 函数保持一致风格

- [ ] **Step 4: 验证 typecheck**

```bash
cd packages/opencode && bun typecheck
```

Expected: 通过,无新增 TS 错误。

- [ ] **Step 5: Commit**

```bash
git add packages/opencode/src/session/system.ts
git commit -m "feat(system-prompt): inject available agents for orchestrator"
```

---

## Task 2：服务端在 `prompt.ts` 拼装点调用 `availableAgents`

**Files:**
- Modify: `packages/opencode/src/session/prompt.ts:2134-2139, 2167`

- [ ] **Step 1: 在 `Effect.all` 块加 `availableAgents` 元素**

`packages/opencode/src/session/prompt.ts` 第 2134-2139 行:

```ts
const [skills, availableAgents, env, instructions, modelMsgs] = yield* Effect.all([
  sys.skills(agent),
  sys.availableAgents(agent),
  sys.environment(model),
  instruction.system({ prompt: textFromParts(lastUserMsg?.parts ?? []) }).pipe(Effect.orDie),
  MessageV2.toModelMessagesEffect(msgs, model),
])
```

- [ ] **Step 2: 在 `system` 数组里加 `availableAgents` 条目**

`packages/opencode/src/session/prompt.ts` 第 2167 行:

```ts
const system = [
  ...env,
  ...instructions,
  ...(skills ? [skills] : []),
  ...(availableAgents ? [availableAgents] : []),
]
```

位置：放在 `skills` 之后,让 agent 列表在"工具扩展区"内出现顺序与"环境 → 指令 → 技能 → 可调度的员工"语义一致。

- [ ] **Step 3: 验证 typecheck**

```bash
cd packages/opencode && bun typecheck
```

Expected: 通过。

- [ ] **Step 4: Commit**

```bash
git add packages/opencode/src/session/prompt.ts
git commit -m "feat(prompt): include available agents in orchestrator system prompt"
```

---

## Task 3：重写 `agents-orchestrator.md`

**Files:**
- Modify: `packages/opencode/src/agent/prompt/agency-agents/specialized/agents-orchestrator.md`（整文件 367 行重写）

- [ ] **Step 1: 写新的 frontmatter**

`agents-orchestrator.md` 第 1-7 行,改为:

```markdown
---
name: Agents Orchestrator
description: 锻造模式调度中控,根据用户意图智能调度所有内置 AI 员工,不直接执行文件操作。
color: cyan
emoji: 🎛️
vibe: 整个 AI 员工团队的中控调度。
---
```

`description` 字段（orchestrator 自己的描述）保持中文,因为 agency.ts:309 会通过 `originalDescription` 暴露给 system 注入；不过此 agent 不需要被 dispatcher 路由（"router 不会被自己路由"），所以 description 字段主要用于 UI 显示。

- [ ] **Step 2: 写新的 body**

`agents-orchestrator.md` 第 8 行开始到文件末尾,整段替换为:

```markdown
# 角色定位

你是锻造模式(forge)的**调度中控**,**不直接执行工具**(除 `question` / 调 `task` 委派)。
你的工作是把用户任务分派给最合适的 AI 员工,而不是自己写代码、读文件、跑命令。

# 调度协议

按以下顺序处理每条用户消息：

1. 读取 system prompt 中"可用 AI 员工"列表(动态注入,数量与 `Agent.Service.list()` 一致)。
2. 匹配用户意图 → 1 个或多个 agent:
   - 闲聊 / 简单问答 → 直接文本回复,不调 `task`。
   - 单一专业任务 → `task(subagent_type=<agent_id>, prompt=<详细指令>)`。
   - 多步复杂任务 → 调一次 `task(general)` 让 general 拆分,或你**单条消息内多次 tool call** 并行委派多个 specialist。
   - 涉及代码改动 → `task(build)`(build 智能体拥有 shell/edit/write)。
   - 只读分析 / 研究 → `task(plan)` 或 `task(explore)`。
   - 需求不明确 → 先 `question` 工具问用户,再决定。
3. 收集 sub-session 结果 → 整合 → 回复用户。
4. 失败：自动重试 1-2 次;仍失败则向用户报告,不无限循环。

# 工具使用约束

- **禁止直接调** `shell` / `edit` / `write` / `patch` / `webfetch` / `websearch`。
- **可以调** `question`(调度前澄清)、`task`(委派)、`skill`(加载技能,如本中控的调度技能)。
- `task` 工具的 `subagent_type` **必须** 是注入列表中实际存在的 agent id,否则会报错。`subagent_type` 不要用中文/中文翻译,直接用 `a.name` 的原值(如 `engineering-architect-ux`)。
- 不确定走哪个 agent 时,**优先选描述最匹配的 1 个**,不确定就用 `question` 问,不要瞎猜。

# 多 agent 并行

如果用户任务天然分多个独立子任务(例如"帮我审合同 + 起草产品方案"),在**单条消息内多次 tool call** 同时委派,不要串行等待。

# 失败处理

- `task` 返回错误:检查是不是 subagent_type 拼错;若是,改用正确名字重试一次。
- `task` 内部失败:查看 sub-session 的 error 信息,定位问题,重试 1-2 次或转 `question` 问用户。
- 永远不要无限循环同一个 `task` 调用。

# 与 build / plan 协议

- `task(build)`:build 智能体拥有原生 shell/edit/write,**可以直接改文件**。适合"真的去做"场景。
- `task(plan)`:plan 智能体只读,只能写 plan 文件。适合"先规划"场景。
- 不要让用户点 Yes/No：用户已经明确说"做了"就 `task(build)`,说"先规划"就 `task(plan)`。原 `PlanExitTool` 的 Yes/No 弹框不再由你触发。
```

要点：
- 删掉原 Phase 1-4 死板 pipeline(第 53-294 行)
- 删掉原"Available Specialist Agents"硬编码列表(第 295-358 行)— 改为"读取 system 注入列表"
- 删掉原"Orchestrator Launch Command"(第 362-367 行)— 不再使用
- 删掉 "Identity & Memory" / "Tools & Deliverables" / "Working Principles" 等以"AgentsOrchestrator Agent Personality"为中心的人格化叙述(原 13-52 行),全部替换为简短协议

- [ ] **Step 3: 验证文件 markdown 格式**

```bash
cd packages/opencode && bun -e "import('./src/agent/prompt/agency-agents.generated.ts').then(m => { const o = m.AGENCY_AGENT_SOURCES.find(s => s.id === 'agents-orchestrator'); console.log(o?.body.slice(0, 500)) })"
```

Expected: 输出的 markdown 以 `---\n` 开头,frontmatter 包含 `name: Agents Orchestrator` 和新的中文 `description`。

- [ ] **Step 4: Commit**

```bash
git add packages/opencode/src/agent/prompt/agency-agents/specialized/agents-orchestrator.md
git commit -m "refactor(orchestrator): rewrite prompt for dynamic agent dispatch"
```

---

## Task 4：服务端测试

### Task 4a: `system.test.ts` 加 `availableAgents` 用例

**Files:**
- Modify: `packages/opencode/test/session/system.test.ts`

- [ ] **Step 1: 加 `Agent.Service` 的 mock 和新的 test case**

`packages/opencode/test/session/system.test.ts` 第 43-57 行 testEffect 块改为:

```ts
import { Agent } from "../../src/agent/agent"
import { Permission } from "../../src/permission"

const orchestrator: Agent.Info = {
  name: "agents-orchestrator",
  mode: "primary",
  permission: Permission.fromConfig({ "*": "allow" }),
  options: {},
}

const build: Agent.Info = {
  name: "build",
  mode: "primary",
  permission: Permission.fromConfig({ "*": "allow" }),
  options: {},
}

const agents = [
  { name: "build", mode: "primary", permission: Permission.fromConfig({ "*": "allow" }), options: {} as Record<string, unknown> },
  { name: "plan", mode: "primary", permission: Permission.fromConfig({ "*": "allow" }), options: {} as Record<string, unknown> },
  { name: "zeta-agent", mode: "subagent", permission: Permission.fromConfig({ "*": "allow" }), options: { category: "工程开发" } as Record<string, unknown> },
  { name: "alpha-agent", mode: "subagent", permission: Permission.fromConfig({ "*": "allow" }), options: { category: "营销" } as Record<string, unknown> },
  { name: "hidden-agent", mode: "subagent", hidden: true, permission: Permission.fromConfig({ "*": "allow" }), options: {} as Record<string, unknown> },
] satisfies Agent.Info[]

const it = testEffect(
  SystemPrompt.layer.pipe(
    Layer.provide(
      Layer.merge(
        Layer.succeed(
          Skill.Service,
          Skill.Service.of({
            get: (name) => Effect.succeed(skills.find((skill) => skill.name === name)),
            all: () => Effect.succeed(skills),
            dirs: () => Effect.succeed([]),
            available: () => Effect.succeed(skills),
          }),
        ),
        Layer.succeed(Agent.Service, Agent.Service.of({
          list: () => Effect.succeed(agents),
          get: (name) => Effect.succeed(agents.find((a) => a.name === name) ?? build),
          defaultInfo: () => Effect.succeed(build),
          defaultAgent: () => Effect.succeed("build"),
          generate: () => Effect.die(new Error("not used in test")),
        })),
      ),
    ),
  ),
)
```

(如果 `Agent.Service` 已有部分方法需要,这里提供全部 5 个 method stubs。)

- [ ] **Step 2: 加新的 test case**

在 `describe("session.system", ...)` 块(第 59 行)末尾追加:

```ts
it.effect("availableAgents only injects for orchestrator", () =>
  Effect.gen(function* () {
    const prompt = yield* SystemPrompt.Service
    const out = yield* prompt.availableAgents(orchestrator)
    expect(out).toBeDefined()
    expect(out).toContain("build")
    expect(out).toContain("plan")
    expect(out).toContain("zeta-agent")
    expect(out).toContain("alpha-agent")
    expect(out).not.toContain("hidden-agent")
    expect(out).not.toContain("agents-orchestrator")
  }),
)

it.effect("availableAgents returns undefined for non-orchestrator", () =>
  Effect.gen(function* () {
    const prompt = yield* SystemPrompt.Service
    const out = yield* prompt.availableAgents(build)
    expect(out).toBeUndefined()
  }),
)

it.effect("availableAgents output is stable across calls", () =>
  Effect.gen(function* () {
    const prompt = yield* SystemPrompt.Service
    const first = yield* prompt.availableAgents(orchestrator)
    const second = yield* prompt.availableAgents(orchestrator)
    expect(first).toBe(second)
    const alpha = first!.indexOf("alpha-agent")
    const zeta = first!.indexOf("zeta-agent")
    expect(alpha).toBeGreaterThan(-1)
    expect(zeta).toBeGreaterThan(alpha)
  }),
)
```

- [ ] **Step 3: 跑 system 测试**

```bash
cd packages/opencode && bun test test/session/system.test.ts --timeout 30000
```

Expected: 全部 PASS(3 个新增 + 1 个原有 skills)。

- [ ] **Step 4: Commit**

```bash
git add packages/opencode/test/session/system.test.ts
git commit -m "test(system): cover availableAgents for orchestrator"
```

### Task 4b: 更新 `agent.test.ts` orchestrator case

**Files:**
- Modify: `packages/opencode/test/agent/agent.test.ts:199-204`

- [ ] **Step 1: 更新 prompt 内容断言**

`packages/opencode/test/agent/agent.test.ts` 第 199-204 行,改为:

```ts
const orchestrator = yield* load((svc) => svc.get("agents-orchestrator"))
expect(orchestrator?.native).toBe(true)
expect(orchestrator?.mode).toBe("primary")
expect(orchestrator?.options.category).toBe("专项能力")
expect(orchestrator?.options.displayName).toBe("Agent 编排总控")
expect(orchestrator?.prompt).toContain("调度中控")
expect(orchestrator?.prompt).toContain("任务分类路由")
expect(Permission.evaluate("question", "*", orchestrator!.permission).action).toBe("allow")
```

要点：原断言是 `expect(orchestrator?.prompt).toContain("AgentsOrchestrator Agent Personality")` — 改为检查新 prompt 的关键标识（"调度中控"和"任务分类路由"），但实际新 prompt 的"任务分类路由"section 在 v2 中已删除（"调度协议"包含类似内容），所以**只断言** "调度中控" 这一句。修正如下：

```ts
expect(orchestrator?.prompt).toContain("调度中控")
expect(orchestrator?.prompt).not.toContain("Phase 1: Project Analysis")
```

- [ ] **Step 2: 跑 agent 测试**

```bash
cd packages/opencode && bun test test/agent/agent.test.ts --timeout 30000
```

Expected: 全部 PASS。

- [ ] **Step 3: Commit**

```bash
git add packages/opencode/test/agent/agent.test.ts
git commit -m "test(agent): update orchestrator prompt assertions"
```

---

## Task 5：客户端 `local-agent.ts` 改写

**Files:**
- Modify: `packages/app/src/context/local-agent.ts:3-7, 9-18, 20-33, 35-52`

- [ ] **Step 1: 扩展 `forgeAgentNames` 包含 orchestrator**

`packages/app/src/context/local-agent.ts` 第 3 行,改为:

```ts
const forgeAgentNames = new Set(["build", "plan", "agents-orchestrator"])
```

要点：`visibleAgentList` 在第 14 行使用这个 set 来过滤 forge 模式显示的 agent。

- [ ] **Step 2: 改写 `forgeAgentForPrompt`**

`packages/app/src/context/local-agent.ts` 第 20-33 行,改为:

```ts
export function forgeAgentForPrompt(input: {
  mode: AppMode | undefined
  current?: string
  text: string
  promptMode?: "normal" | "shell"
}) {
  if (input.mode !== "forge") return input.current
  if (input.promptMode === "shell") return "build"
  return input.current
}
```

要点：删掉对 `text.startsWith("/")` 的判断（之前会强制返回 "build"）和 `return "plan"` 强制覆盖；`/command` 走 shell 模式处理（不变）。

- [ ] **Step 3: 标记 `shouldAutoBuildAfterForgePlan` / `hasForgeBuildIntent` 为 deprecated**

`packages/app/src/context/local-agent.ts` 第 35-52 行,改为:

```ts
/** @deprecated 锻造模式改造后不再需要;保留以避免外部包破坏,新代码不要使用。 */
export function shouldAutoBuildAfterForgePlan(input: {
  mode: AppMode | undefined
  text: string
  promptMode?: "normal" | "shell"
}) {
  if (input.mode !== "forge") return false
  if (input.promptMode !== "normal") return false
  const value = input.text.trim()
  if (!value || value.startsWith("/")) return false
  return hasForgeBuildIntent(value)
}

/** @deprecated 锻造模式改造后不再需要;保留以避免外部包破坏,新代码不要使用。 */
export function hasForgeBuildIntent(text: string) {
  const value = text.trim()
  if (!value) return false
  if (planOnlyPattern.test(value)) return false
  return buildIntentPattern.test(value)
}
```

要点：标记 `@deprecated` 但不删除，因为：
- `submit.ts:519-528` 还会短暂引用 `shouldAutoBuildAfterForgePlan`（Task 7 删）
- `session-composer-region.tsx:11` 引用 `hasForgeBuildIntent`（需检查并删除引用）

- [ ] **Step 4: 验证 typecheck**

```bash
cd packages/app && bun typecheck
```

Expected: 通过。

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/context/local-agent.ts
git commit -m "refactor(local-agent): stop forcing plan in forge mode"
```

---

## Task 6：客户端 `local.tsx` 默认 orchestrator

**Files:**
- Modify: `packages/app/src/context/local.tsx:88-122`

- [ ] **Step 1: 改 `createStore` 初始 `current` 为 `undefined`**

`packages/app/src/context/local.tsx` 第 80-93 行,改为:

```ts
const [store, setStore] = createStore<{
  current?: string
  draft?: State
  last?: {
    type: "agent" | "model" | "variant"
    agent?: string
    model?: ModelKey | null
    variant?: string | null
  }
}>({
  current: undefined,
  draft: undefined,
  last: undefined,
})
```

要点：原本 `current: list()[0]?.name` 是"在初始化时定一个 agent",新设计要让 createEffect(第 114-122)根据 `layout.mode` 决定,避免在 layout 还没就绪时定错。

- [ ] **Step 2: 改 createEffect 优先 forge 模式选 orchestrator**

`packages/app/src/context/local.tsx` 第 114-122 行,改为:

```ts
createEffect(() => {
  const items = list()
  if (items.length === 0) {
    if (store.current !== undefined) setStore("current", undefined)
    return
  }

  const mode = layout.mode.current()
  if (mode === "forge") {
    const orchestrator = items.find((item) => item.name === "agents-orchestrator")
    if (orchestrator) {
      if (store.current !== orchestrator.name) setStore("current", orchestrator.name)
      return
    }
  }

  if (items.some((item) => item.name === store.current)) return
  setStore("current", items[0]?.name)
})
```

要点：
- forge 模式且 orchestrator 存在 → 强制选 orchestrator
- 其他情况保持原有 fallback(如果 current 在 list 里就不动,否则选第一个)

- [ ] **Step 3: 验证 typecheck**

```bash
cd packages/app && bun typecheck
```

Expected: 通过。

- [ ] **Step 4: Commit**

```bash
git add packages/app/src/context/local.tsx
git commit -m "feat(local): default forge mode to agents-orchestrator"
```

---

## Task 7：客户端 `submit.ts` 删除 `onForgeAutoBuildPlan` 链

**Files:**
- Modify: `packages/app/src/components/prompt-input/submit.ts:18, 197-204, 519-528`

- [ ] **Step 1: 删除 import**

`packages/app/src/components/prompt-input/submit.ts` 第 18 行,改为:

```ts
import { forgeAgentForPrompt } from "@/context/local-agent"
```

（删掉 `shouldAutoBuildAfterForgePlan`）

- [ ] **Step 2: 删除 `onForgeAutoBuildPlan` prop**

`packages/app/src/components/prompt-input/submit.ts` 第 197-204 行,删除:

```ts
onForgeAutoBuildPlan?: (input: {
  sessionID: string
  sessionDirectory: string
  sourceMessageID: string
  text: string
  model: { providerID: string; modelID: string }
  variant?: string
}) => void
```

- [ ] **Step 3: 删除调用点**

`packages/app/src/components/prompt-input/submit.ts` 第 519-528 行,删除:

```ts
if (agent === "plan" && shouldAutoBuildAfterForgePlan({ mode: layout.mode.current(), text, promptMode: mode })) {
  input.onForgeAutoBuildPlan?.({
    sessionID: session.id,
    sessionDirectory,
    sourceMessageID: messageID,
    text,
    model,
    variant,
  })
}
```

- [ ] **Step 4: 验证 typecheck**

```bash
cd packages/app && bun typecheck
```

Expected: 通过(`onForgeAutoBuildPlan` prop 已无人提供,即便 `input.onForgeAutoBuildPlan` 的解构也不需要)。

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/components/prompt-input/submit.ts
git commit -m "refactor(submit): remove onForgeAutoBuildPlan chain"
```

---

## Task 8：客户端 PromptInput / SessionNewView / Composer 删除 `onForgeAutoBuildPlan` 引用

**Files:**
- Modify: `packages/app/src/components/prompt-input.tsx:78, 1279`
- Modify: `packages/app/src/components/session/session-new-view.tsx:26, 122`
- Modify: `packages/app/src/pages/session/composer/session-composer-region.tsx:11, 57, 294`

- [ ] **Step 1: `prompt-input.tsx` 删除 prop**

`packages/app/src/components/prompt-input.tsx` 第 78 行,删除:

```ts
onForgeAutoBuildPlan?: Parameters<typeof createPromptSubmit>[0]["onForgeAutoBuildPlan"]
```

第 1279 行,删除:

```ts
onForgeAutoBuildPlan: props.onForgeAutoBuildPlan,
```

- [ ] **Step 2: `session-new-view.tsx` 删除 prop**

`packages/app/src/components/session/session-new-view.tsx` 第 26 行,删除:

```ts
onForgeAutoBuildPlan?: Parameters<typeof PromptInput>[0]["onForgeAutoBuildPlan"]
```

第 122 行,删除:

```ts
onForgeAutoBuildPlan={props.onForgeAutoBuildPlan}
```

- [ ] **Step 3: `session-composer-region.tsx` 删除 import 和 prop 引用**

第 11 行,改为:

```ts
import { useLocal } from "@/context/local"
```

（删掉 `hasForgeBuildIntent` import,这是个死引用,前面 `local-agent.ts` 改后没用了）

第 57 行,删除:

```ts
onForgeAutoBuildPlan?: Parameters<typeof PromptInput>[0]["onForgeAutoBuildPlan"]
```

第 294 行,删除:

```ts
onForgeAutoBuildPlan={props.onForgeAutoBuildPlan}
```

- [ ] **Step 4: 验证 typecheck**

```bash
cd packages/app && bun typecheck
```

Expected: 通过。

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/components/prompt-input.tsx packages/app/src/components/session/session-new-view.tsx packages/app/src/pages/session/composer/session-composer-region.tsx
git commit -m "refactor: drop onForgeAutoBuildPlan prop chain"
```

---

## Task 9：客户端删除 `planDecision` 整条链

**Files:**
- Delete: `packages/app/src/pages/session/composer/session-plan-decision-dock.tsx`（整文件 31 行）
- Modify: `packages/app/src/pages/session/composer/session-composer-region.tsx:18, 45-49, 272-278`
- Modify: `packages/app/src/pages/session.tsx:430-442, 1407-1541, 1963-1972`

- [ ] **Step 1: 删除 `session-plan-decision-dock.tsx` 整个文件**

```bash
git rm packages/app/src/pages/session/composer/session-plan-decision-dock.tsx
```

- [ ] **Step 2: `session-composer-region.tsx` 删除 import 和 prop**

第 18 行,删除:

```ts
import { SessionPlanDecisionDock } from "@/pages/session/composer/session-plan-decision-dock"
```

第 45-49 行,删除 `planDecision` prop 整段:

```ts
planDecision?: {
  executing?: boolean
  onExecute: () => void
  onRevise: () => void
}
```

第 272-278 行,删除 `<SessionPlanDecisionDock>` JSX 块:

```tsx
<Show when={!props.followup?.items.length && props.planDecision}>
  <SessionPlanDecisionDock
    executing={props.planDecision!.executing}
    onExecute={props.planDecision!.onExecute}
    onRevise={props.planDecision!.onRevise}
  />
</Show>
```

- [ ] **Step 3: `session.tsx` 删除 `forgeAutoBuild` store 和 `requestForgeAutoBuildPlan`**

第 430-442 行,删除:

```tsx
const [forgeAutoBuild, setForgeAutoBuild] = createStore<{
  pending: Record<string, ForgeAutoBuildPlan | undefined>
  dismissed: Record<string, boolean | undefined>
  executing: Record<string, boolean | undefined>
}>({
  pending: {},
  dismissed: {},
  executing: {},
})

const requestForgeAutoBuildPlan = (input: ForgeAutoBuildPlan) => {
  setForgeAutoBuild("pending", input.sessionID, input)
}
```

如果 `ForgeAutoBuildPlan` 类型 import 也没人用了,把 import 也删掉(在 `session.tsx` 顶部搜索 `ForgeAutoBuildPlan` 删 import)。

- [ ] **Step 4: `session.tsx` 删除 `forgeBuildText` / `sendForgeBuild`**

第 1407-1443 行,删除 `forgeBuildText` 函数和 `sendForgeBuild` 函数整段。

- [ ] **Step 5: `session.tsx` 删除 `planDecision` memo + `executePlanDecision` + `revisePlanDecision`**

第 1445-1500 行,删除 `planDecision` createMemo、`executePlanDecision` 函数、`revisePlanDecision` 函数整段。

- [ ] **Step 6: `session.tsx` 删除 `forgeAutoBuildAssistant` memo 和监听 createEffect**

第 1502-1541 行,删除 `forgeAutoBuildAssistant` createMemo 和对应的 createEffect 整段。

- [ ] **Step 7: `session.tsx` 删除 SessionComposerRegion 的 `planDecision` prop**

第 1963-1972 行,删除:

```tsx
onForgeAutoBuildPlan={requestForgeAutoBuildPlan}
planDecision={
  planDecision()
    ? {
        executing: forgeAutoBuild.executing[planDecision()!.assistant.id],
        onExecute: executePlanDecision,
        onRevise: revisePlanDecision,
      }
    : undefined
}
```

注意 1963 行的 `onForgeAutoBuildPlan` 也是要删的(Task 8 删 prop 但调用点在这里)。

第 1941 行 `onForgeAutoBuildPlan={requestForgeAutoBuildPlan}` 也要删(另一个 SessionComposerRegion 实例)。

- [ ] **Step 8: 验证 typecheck**

```bash
cd packages/app && bun typecheck
```

Expected: 通过。如果还有 `ForgeAutoBuildPlan` / `forgeAutoBuild` / `planDecision` / `executePlanDecision` / `revisePlanDecision` / `forgeBuildText` / `sendForgeBuild` / `forgeAutoBuildAssistant` / `hasForgeBuildIntent` / `shouldAutoBuildAfterForgePlan` 残留引用,会被 oxlint/typecheck 捕获并指明行号,逐个清理。

- [ ] **Step 9: 跑 app 端 local.test.ts(见 Task 10)确认没有破坏**

```bash
cd packages/app && bun test src/context/local.test.ts --timeout 30000
```

Expected: PASS(Task 10 之前会先更新测试)。

- [ ] **Step 10: Commit**

```bash
git add -A packages/app/src/pages/session/composer/session-plan-decision-dock.tsx packages/app/src/pages/session/composer/session-composer-region.tsx packages/app/src/pages/session.tsx
git commit -m "refactor: remove planDecision / forgeAutoBuild chain and SessionPlanDecisionDock"
```

---

## Task 10：客户端测试 `local.test.ts`

**Files:**
- Modify: `packages/app/src/context/local.test.ts`

- [ ] **Step 1: 扩展 agents 列表并更新断言**

`packages/app/src/context/local.test.ts` 第 4-11 行,改为:

```ts
const agents = [
  { name: "build", mode: "primary", options: {} },
  { name: "plan", mode: "primary", options: {} },
  { name: "agents-orchestrator", mode: "primary", options: { category: "专项能力" } },
  { name: "office-ppt", mode: "primary", options: { modeGroup: "office" } },
  { name: "office-document", mode: "primary", options: { modeGroup: "office" } },
  { name: "explore", mode: "subagent", options: {} },
  { name: "hidden", mode: "primary", hidden: true, options: {} },
] as const
```

第 14-16 行,改为:

```ts
test("锻造模式显示锻造工程 / 规划蓝图 / 调度中控", () => {
  expect(visibleAgentList(agents, "forge").map((agent) => agent.name)).toEqual([
    "build",
    "plan",
    "agents-orchestrator",
  ])
})
```

第 31-39 行,改为:

```ts
test("锻造模式 forgeAgentForPrompt 直接返回 current（不再强制 plan）", () => {
  expect(forgeAgentForPrompt({ mode: "forge", current: "build", text: "帮我看看这个需求怎么做" })).toBe("build")
  expect(forgeAgentForPrompt({ mode: "forge", current: "agents-orchestrator", text: "帮我看看这个需求怎么做" })).toBe(
    "agents-orchestrator",
  )
})

test("锻造模式 shell 模式保持返回 build", () => {
  expect(forgeAgentForPrompt({ mode: "forge", current: "plan", text: "ls", promptMode: "shell" })).toBe("build")
})
```

第 41-44 行,删除(原"`/commit` 命令"用例不再相关,行为已统一为"返回 current")。

第 46-49 行,删除(原"只规划"用例不再相关,新设计下意图识别由 orchestrator 自行完成)。

最后,`hasForgeBuildIntent` 和 `shouldAutoBuildAfterForgePlan` 的测试保留原状(以确保 deprecated 函数行为不变,作为回归保护)。

- [ ] **Step 2: 跑测试**

```bash
cd packages/app && bun test src/context/local.test.ts --timeout 30000
```

Expected: 全部 PASS(更新后的 5 个 visibleAgentList + 2 个 forgeAgentForPrompt + 原 2 个 hasForgeBuildIntent/shouldAutoBuild)。

- [ ] **Step 3: Commit**

```bash
git add packages/app/src/context/local.test.ts
git commit -m "test(local): cover orchestrator in forge mode and new prompt routing"
```

---

## 自审

### Spec 覆盖

| Spec 段落 | 落点 Task |
|----------|----------|
| 改动 1: 重写 agents-orchestrator.md | Task 3 |
| 改动 2: system prompt 动态注入 agent 列表 | Task 1 (`availableAgents`) + Task 2 (调用点) |
| 改动 3: 删除前端 forge 强制逻辑 | Task 5 (local-agent.ts) + Task 6 (local.tsx) + Task 7-8 (提交链) |
| 改动 4: 删除前端 plan 确认框 | Task 9 (整条链 + dock 文件) |
| 风险表 #2 autoAccept 覆盖 | 风险表已更新(实施时无需新增代码,只需在 release notes / 用户指南写明联动) |
| 数据流验证 | Task 1-2 完成后即可在 typecheck + 测试中静态验证;动态验证在 release notes 中描述手工 E2E |
| 测试 - 单元 | Task 4a + Task 10 |
| 测试 - 集成 | Task 4b |
| 测试 - E2E | 文档中(在 commit message 或 release notes) |

### 占位符扫描

- "TBD" / "TODO" / "implement later" — 0 处
- "Add appropriate error handling" / "add validation" / "handle edge cases" — 0 处
- "Write tests for the above" (无具体测试代码) — 0 处
- "Similar to Task N" — 0 处
- 引用未定义类型/函数/方法 — 已交叉验证:
  - `Agent.Info.options as { category?: string }` 类型断言在 `system.ts` 用了 `as`(与 `agent.ts:309` 的 `originalDescription` 模式一致)
  - `Agent.Service.of({...})` 5 个 method stubs 全部提供,与 `agent.ts:58-67` 接口匹配
  - `Permission.disabled(["task"])` 复用了 `system.ts:66` 的现有 `Permission.disabled(["skill"])` 模式
  - `local.test.ts` 的 `visibleAgentList` 输入 `agents` 加了 `agents-orchestrator` 元素,与 `local-agent.ts:14` 的 `forgeAgentNames` set 匹配

### 类型一致性

- `SystemPrompt.Interface` 加 `availableAgents`,prompt.ts:2134 调用,`system.ts:Layer.effect` 实现 — 三处签名一致
- `local.tsx:createStore` 的 `current` 类型 `string | undefined` — 与 `pickAgent` 返回 `T | undefined` 一致
- `local-agent.ts:forgeAgentForPrompt` 返回 `string | undefined` 与 `submit.ts:412` 调用点解构一致
- `submit.ts:forgeAgentForPrompt` 在 412 行后解构 `if (!agent)` 仍然成立(undefined 仍走 toast)
- Task 7-8 删除的 `onForgeAutoBuildPlan` prop 在 4 处传递链(组件 prop, props 转发)完全闭合

### 一致性调整说明

- Task 5 Step 3 保留 `shouldAutoBuildAfterForgePlan` / `hasForgeBuildIntent` 标记为 `@deprecated`,而非删除。原因：Task 9 Step 8 提示"如果还有 `hasForgeBuildIntent` / `shouldAutoBuildAfterForgePlan` 残留引用,会被 oxlint/typecheck 捕获",但 Task 7 已经删了 `submit.ts:519-528` 的调用点,Task 8 已经删了 `session-composer-region.tsx:11` 的 import;**无任何 caller** 时应**直接删除**。执行时按实际 typecheck 结果处理:若 0 引用,删;若有引用,保留 deprecated。
- Task 9 Step 3 提示"如果 `ForgeAutoBuildPlan` 类型 import 也没人用了,把 import 也删掉" — `requestForgeAutoBuildPlan` 函数签名用了 `ForgeAutoBuildPlan`,删除函数后,`ForgeAutoBuildPlan` 自身在 `session.tsx` 顶部应该也变成未使用。执行时 typecheck 会指明。

---

## 注意事项

- **不要重启服务**：AGENTS.md 禁止重启 app / server,实施后用户需要自己 reload。
- **不要 commit 文档/计划文件**：本 plan 本身和更新后的 spec 不需要 commit,只 commit 代码改动。release notes / 用户指南是后续单独任务。
- **前端 UI 改动不可见**：`opencode dev web` 代理到 `https://app.opencode.ai` 生产版本,本地 UI 改动需用户自己 build 才能看。typecheck 仍能保证代码正确性。
- **forge 模式首次启动**：`local.tsx:114-122` createEffect 在 layout.mode 变化时才会重设 `current`;**首次进入 forge 模式**会触发一次重设,把 default build → agents-orchestrator。已经在 forge 模式但 store 里有 `build` 也会被覆盖。
- **升级路径**：用户从旧版升级后,store 里持久化的 `current` 可能是 `build` 或 `plan`;Task 6 createEffect 会自动把 forge 模式重置为 `agents-orchestrator`,无需 migration。
- **`autoAccept` 联动**：在 release notes 中显式说明"开启自动接受权限后,所有 task 派发的 sub-agent 操作会自动执行"。

---

## 执行后

执行完成后,在 `docs/superpowers/plans/2026-06-07-forge-orchestrator.md` 末尾追加执行结果(已提交 commit hash、测试通过截图、遇到的问题与解决)。
