# NovaWay Super-Agent 计划

> 状态：实施中（技术实现与自动化验证持续推进，SA-G12 人工发布证据仍待完成）
> 创建日期：2026-11-14
> 用途：NovaWay Super-Agent Runtime、任务编排、异构 Agent、插件化 Agent 能力、验证驱动交付及 UI 的实施基线。

## 0. 文档目的

本文是 NovaWay 下一阶段 Super-Agent 开发的唯一实施基线。后续开发、评审、测试和验收均以本文为准；实现与本文不一致时，必须先更新决策记录和验收标准，再修改代码。

Super-Agent 不是更长的 Prompt，也不等于 Multi-Agent Chat。NovaWay 的目标是构建一个能够：

```text
接收目标 → 制定计划 → 拆解任务 → 调度 Agent / Worker
→ 调用工具和外部 Runtime → 持久化过程与证据
→ 处理审批、暂停、失败和恢复 → 运行验证
→ 自动修复未通过项 → 只有真实验收条件满足时才宣称完成
```

的、可恢复、可审计、可插拔执行系统。

## 1. 背景与现状

### 1.1 NovaWay 当前基础

NovaWay 已具备以下可复用基础：

- 插件贡献模型：`tools`、`agents`、`skills`、`commands`、`providers`、`surfaces`、`mcpServers`、`workerTypes`、`routingPolicies`、`watchdogPolicies`、`channels`、`triggers` 等；
- `ContributionRegistry` 统一管理插件归属、scope、owner、priority、installOrder、override 和生命周期；
- 第三方 Surface 已支持 sidebar、settings、previewer、renderer、session.panel 等宿主位置；
- iframe 是第三方 UI 的隔离边界，进程内插件代码不被视为安全沙箱；
- Plugin Runtime 支持 builtin 激活、持久 enabled 激活和 `onView` 按需激活；
- Team / Run / Acceptance / Verification / Budget / Ledger / Unknown Operation 等团队编排基础；
- Tool、Agent、Skill、Provider、MCP、Office、Memory、Knowledge、LSP 等能力已经存在或正在演进。

这些基础足以承载 Super-Agent，但当前还缺少统一的、可持久恢复的跨 Agent 执行内核。

### 1.2 与上一阶段的关系

“万物皆插件”计划的实现技术门禁已经完成，真实 Chromium、HTTP API、全量分片回归、typecheck、lint、性能和树指纹均有证据。发行门禁 G6 仍需要真实人工抽样复核；这是上一阶段的外部发行证据缺口，不得伪造为通过。

Super-Agent 可以进入架构和代码开发，但在 G6 未完成前，不能把上一阶段标记成全部发行门禁完成，也不能用 Super-Agent 测试替代 G6 人工证据。

## 2. 外部参考：LobeHub

本计划参考 LobeHub `main` 分支，评审基准为 2026-11-14 读取到的 commit `40a34cc3`。重点参考：

- `packages/agent-runtime/src/core/runtime.ts`
- `packages/agent-runtime/src/groupOrchestration/GroupOrchestrationRuntime.ts`
- `packages/agent-runtime/src/groupOrchestration/GroupOrchestrationSupervisor.ts`
- `packages/agent-runtime/src/groupOrchestration/types.ts`
- `packages/agent-manager-runtime/`
- `packages/heterogeneous-agents/`
- `docs/development/basic/architecture.mdx`

### 2.1 值得学习

1. **Brain、Runtime、Executor 分离**：Agent 产生意图，Runtime 管生命周期和状态，Executor 执行动作。
2. **Supervisor / Executor 协议**：通过 typed instruction 表达单 Agent、并行 Agent、异步任务、客户端任务、批量任务、委派和结束。
3. **异步与并行是一等能力**：服务端、本地、远程、后台和人工恢复任务都有统一边界。
4. **异构 Agent Runtime**：通过 descriptor 和 adapter 接入不同 Agent，而不是假设所有 Agent 同构。
5. **State、Event、Cost、Human Interaction 进入 Runtime**：步骤、token、成本、审批、暂停、取消、恢复和错误必须可观测和持久化。

### 2.2 不直接复制

- 不复制 LobeHub 的 Next.js、React Router、Zustand、tRPC 或数据库技术栈；
- 不把 Group Chat UI 当成 Super-Agent；
- 不把内置工具包等同于第三方插件安全沙箱；
- 不让 LLM 越过 Policy 执行危险动作；
- 不以模型说“完成”作为完成判据；
- 不以一次性 Prompt 替代可恢复 Task Graph 和 Verification。

NovaWay 的差异化目标是：

> Verification-driven Super-Agent Runtime：只有真实 Acceptance Criteria、证据和验证结果全部满足时，任务才能进入 `completed`。

## 3. 术语

- **Super-Agent**：围绕长期目标维护计划、拆解任务、调度 Agent / Worker、调用工具、处理人工介入、保存状态、验证并修复的编排系统。
- **Supervisor**：基于 Goal、Task Graph、历史结果、Policy 和预算产生下一条 `AgentInstruction` 的决策组件。可以由 LLM 驱动，但不能绕过 Runtime。
- **Executor**：执行一种指令的组件，可以调用工具、启动 Agent Runtime、创建异步任务、请求人工批准、运行验证或写入证据。
- **Agent**：具有角色、模型策略、工具、技能、记忆、输出协议和权限边界的执行单元。
- **Worker**：执行任务但不一定是对话 Agent 的运行单元，例如 Browser、Office、Shell、LSP、Remote 或第三方 Runtime。
- **Task**：Task Graph 中有输入、目标、依赖、执行者、成功条件、失败策略和结果的可追踪节点。
- **Evidence**：支持验收判断的可追溯证据。
- **Verification**：基于 Acceptance Criteria 和 Evidence 得出的结构化结论。

Verification 必须区分 `pass`、`fail`、`unverified`、`stale`、`needs_review`；`unverified` 和 `stale` 绝不能折叠成 `pass`。

## 4. 目标与非目标

### 4.1 目标

1. 建立可恢复的 Super-Agent Runtime；
2. 支持单 Agent、多 Agent、并行 Agent、异步任务和异构 Runtime；
3. 让 Agent、Worker、策略、Verifier、模板和 UI 插件化；
4. 用统一 Task Graph 管理计划、依赖、重试和结果；
5. 支持 checkpoint、pause、resume、cancel、approval 和 crash recovery；
6. 将预算、权限、速率、超时、重试和并发纳入确定性 Policy；
7. 让完成必须经过真实 Verification；
8. 提供事件流、成本统计和证据链；
9. 支持本地、服务端、远程和第三方 Agent Runtime；
10. 通过插件 Surface 提供任务图、Timeline、审批和验证 UI。

### 4.2 非目标

本阶段不承诺训练新基础模型、替代所有人工决策、把第三方进程当安全沙箱、让插件拥有宿主全部权限、在没有证据时推断完成、复制其他项目的完整前端或部署架构。

## 5. 设计原则

### P1. Kernel 内置，能力尽量插件化

内置 Kernel 负责状态机、指令校验、权限和预算、持久化、checkpoint、事件顺序、取消和恢复、验证不折叠、插件生命周期隔离。

可插件化能力包括 Agent role、Supervisor strategy、Worker Runtime、Task kind、Tool、Skill、Memory provider、Model routing policy、Verification strategy、Repair strategy、Agent template、Surface renderer、Channel / Trigger。

### P2. LLM 只能提出意图

所有模型输出必须经过：

```text
Schema Validation → Capability Check → Policy Check
→ Budget Check → Approval Check → Runtime Execution
```

### P3. 所有长期任务必须可恢复

步骤完成后必须能够恢复 Run、Task、指令、事件、子 Agent、预算、checkpoint、审批、evidence 和 verification。

### P4. 完成由 Verification 决定

`finish` 只能请求完成，不能直接把 Run 标记为 `completed`。Runtime 必须先检查 Acceptance Criteria、required evidence、Verification、`unverified` / `stale`、Policy 和 budget。

### P5. 失败、暂停和未知是领域状态

`failed`、`paused`、`waiting_for_approval`、`needs_review`、`unknown` 都必须是可查询、可恢复和可审计状态。

### P6. 默认最小权限

Agent 默认没有任意插件 namespace、任意文件路径、任意网络、任意宿主命令、任意人工批准或任意 verifier 覆盖权限。

### P7. 先确定性内核，后复杂智能

```text
协议与状态机 → 单 Agent Runtime → Task Graph
→ 多 Agent 委派 → 异构 Runtime → Verification / Repair
→ Plugin / Marketplace → 高级自主策略
```

## 6. 目标架构

```text
┌──────────────────────────────────────────────┐
│ Super-Agent Surfaces: graph / timeline       │
│ approvals / evidence / agent status          │
└──────────────────────┬───────────────────────┘
┌──────────────────────▼───────────────────────┐
│ HTTP / Event API: run / plan / pause / resume│
│ approve / graph / agents / events / evidence │
└──────────────────────┬───────────────────────┘
┌──────────────────────▼───────────────────────┐
│ Runtime Kernel: state machine / checkpoint   │
│ cancel / instruction validation / event order│
└──────────────┬─────────────────┬────────────┘
               │                 │
┌──────────────▼──────┐ ┌────────▼─────────────┐
│ Supervisor           │ │ Policy Engine         │
│ plan/replan/delegate│ │ auth/budget/limits    │
└──────────────┬──────┘ └────────┬─────────────┘
               └────────┬────────┘
┌────────────────────────▼─────────────────────┐
│ Instruction / Result / Event Protocol        │
└────────────────────────┬─────────────────────┘
┌────────────────────────▼─────────────────────┐
│ Executor Registry: agent / worker / tool     │
│ verify / repair / async / client / remote   │
└────────────────────────┬─────────────────────┘
┌────────────────────────▼─────────────────────┐
│ Runtime Adapters: native / Claude / Codex   │
│ browser / office / remote / plugin           │
└────────────────────────┬─────────────────────┘
┌────────────────────────▼─────────────────────┐
│ Tools / Skills / MCP / Office / Memory / LSP │
└──────────────────────────────────────────────┘
```

| 组件                  | 职责                                 | 不负责什么        |
| --------------------- | ------------------------------------ | ----------------- |
| `SuperAgentRuntime`   | 状态机、循环、持久化、恢复、事件顺序 | 不决定业务策略    |
| `Supervisor`          | 根据状态产生 typed instruction       | 不直接执行工具    |
| `PolicyEngine`        | 权限、预算、并发、路由、审批         | 不生成业务计划    |
| `ExecutorRegistry`    | 将指令映射到执行器                   | 不保存隐藏状态    |
| `AgentRuntimeAdapter` | 管理具体 Agent Runtime               | 不绕过宿主 Policy |
| `TaskGraph`           | 依赖、节点、并行、阻塞和结果         | 不自行调用模型    |
| `VerifierRegistry`    | 将证据映射为验证结论                 | 不把缺证据当通过  |
| `EvidenceStore`       | 保存证据引用、hash、来源             | 不修改原始证据    |
| `SurfaceHost`         | 展示状态和接收用户操作               | 不执行未授权动作  |

## 7. 核心领域模型

### 7.1 Run、Goal、TaskGraph、TaskNode

```ts
interface SuperAgentRun {
  id: RunID
  goal: Goal
  status: SuperAgentRunStatus
  graphID: TaskGraphID
  rootTaskID: TaskID
  supervisor: SupervisorRef
  policy: PolicyRef
  scope: ExecutionScope
  budget: Budget
  usage: Usage
  checkpointID?: CheckpointID
  currentTaskID?: TaskID
  createdAt: number
  updatedAt: number
  failure?: StructuredFailure
  completion?: CompletionSummary
}

interface Goal {
  text: string
  constraints: Constraint[]
  acceptanceCriteria: AcceptanceCriterion[]
  requestedBy: ActorRef
  source: "user" | "trigger" | "plugin" | "api" | "agent"
}

interface TaskGraph {
  id: TaskGraphID
  version: number
  nodes: TaskNode[]
  edges: TaskEdge[]
  rootTaskID: TaskID
  planHash: string
  status: TaskGraphStatus
}

interface TaskNode {
  id: TaskID
  graphID: TaskGraphID
  kind: string
  title: string
  objective: string
  status: TaskNodeStatus
  dependencies: TaskID[]
  assignedAgent?: AgentRef
  assignedWorker?: WorkerRef
  input?: unknown
  output?: unknown
  acceptanceCriteria: AcceptanceCriterion[]
  retryPolicy: RetryPolicy
  timeoutMs?: number
  budget?: Budget
  attempts: number
  checkpointID?: CheckpointID
  evidenceIDs: EvidenceID[]
  verificationIDs: VerificationID[]
  createdAt: number
  updatedAt: number
}
```

边类型至少包括 `depends_on`、`blocks`、`repairs`、`verifies`、`delegates_to`、`derived_from`。

### 7.2 AgentDescriptor

```ts
interface AgentDescriptor {
  id: string
  pluginID: string
  version: string
  displayName: string
  description?: string
  runtimeType: string
  role: string
  capabilities: string[]
  tools: string[]
  skills: string[]
  modelPolicy?: ModelPolicy
  memoryPolicy?: MemoryPolicy
  permissionPolicy: PermissionPolicy
  inputSchema?: SchemaRef
  outputSchema?: SchemaRef
  supports: {
    streaming: boolean
    pause: boolean
    resume: boolean
    cancellation: boolean
    delegation: boolean
    localExecution: boolean
  }
}
```

### 7.3 Evidence、Verification、Budget

```ts
interface Evidence {
  id: EvidenceID
  runID: RunID
  taskID: TaskID
  kind: "test" | "file" | "http" | "screenshot" | "log" | "artifact" | "human" | "external"
  source: string
  contentRef?: string
  contentHash?: string
  measured?: string
  capturedAt: number
  capturedBy: ActorRef
  expiresAt?: number
  metadata?: Record<string, unknown>
}

interface Verification {
  id: VerificationID
  runID: RunID
  taskID?: TaskID
  acceptanceID: string
  verifierID: string
  verifierVersion: string
  outcome: "pass" | "fail" | "unverified" | "stale" | "needs_review"
  measured?: string
  evidenceIDs: EvidenceID[]
  reason: string
  createdAt: number
}

interface Budget {
  tokens?: number
  usd?: number
  wallTimeMs?: number
  steps?: number
  toolCalls?: number
  childAgents?: number
  parallelism?: number
}
```

Budget 必须支持 reservation、settlement、release 和 overrun 审计，不能只在结束时估算。

## 8. 状态机设计

### 8.1 Run 状态

```text
draft → planning → ready → running
                         ├→ waiting_approval
                         ├→ waiting_input
                         ├→ waiting_external
                         ├→ paused
                         ├→ needs_review
                         ├→ verifying
                         ├→ failed
                         └→ cancelling

cancelling → cancelled
verifying → completed | failed | needs_review
```

约束：

- `running → completed` 不允许直接转换，必须经过 `verifying`；
- `failed → completed` 不允许直接转换，必须有修复任务和重新验证；
- `needs_review` 不得自动重试；
- `waiting_approval` 必须持有有效 Approval Request；
- `paused` 必须持有 checkpoint；
- `cancelled` 是终态，不自动恢复；
- `completed` 必须有 Completion Summary 和全部 required Verification。

### 8.2 Task 和 Operation 状态

Task：

```text
pending → ready → running → waiting → succeeded → verifying → completed
running → failed → retrying → running
failed → blocked | needs_review
```

Operation 必须报告 `started`、`progress`、`waiting`、`succeeded`、`failed`、`cancelled` 或 `unknown`。进程崩溃或网络断开后，不能把最后一个 `started` 直接改为 `failed` 或 `succeeded`；必须进入 `unknown`，由 recovery policy 或人工复核决定。

## 9. 指令、结果和事件协议

### 9.1 AgentInstruction

初始协议建议如下，具体字段在 SA-M0 评审后冻结：

```ts
type AgentInstruction =
  | { type: "call_agent"; taskID: TaskID; agentID: string; instruction: string }
  | { type: "parallel_call_agents"; taskID: TaskID; calls: AgentCall[] }
  | { type: "spawn_task"; parentTaskID: TaskID; task: TaskSpec }
  | { type: "delegate"; taskID: TaskID; target: AgentTarget; reason?: string }
  | { type: "run_tool"; taskID: TaskID; tool: ToolCall }
  | { type: "run_async_task"; taskID: TaskID; worker: WorkerTarget; input: unknown }
  | { type: "request_approval"; taskID: TaskID; request: ApprovalSpec }
  | { type: "request_input"; taskID: TaskID; request: InputSpec }
  | { type: "checkpoint"; runID: RunID; reason: string }
  | { type: "verify"; taskID: TaskID; criteria: string[] }
  | { type: "repair"; taskID: TaskID; failures: VerificationID[] }
  | { type: "finish"; runID: RunID; reason: string }
```

每条指令必须包含 `instructionID`、`runID`、`taskID` 或明确 scope、`parentEventID`、`issuedAt`、`policyContextHash`、`idempotencyKey` 和预算预占信息。

### 9.2 ExecutorResult

```ts
type ExecutorResult =
  | { type: "agent_completed"; agentID: string; output: unknown; evidenceIDs: EvidenceID[] }
  | { type: "agent_failed"; agentID: string; error: StructuredFailure }
  | { type: "tasks_completed"; results: TaskResult[] }
  | { type: "tool_completed"; callID: string; output: unknown }
  | { type: "approval_required"; requestID: ApprovalID }
  | { type: "input_required"; requestID: InputID }
  | { type: "verification_completed"; verificationIDs: VerificationID[] }
  | { type: "repair_required"; taskID: TaskID; failures: VerificationID[] }
  | { type: "unknown"; operationID: string; reason: string }
```

### 9.3 SuperAgentEvent

事件必须追加写入、具有单调序列号并可重放：

```text
run_created, plan_created, task_created, task_started,
instruction_issued, executor_started, executor_progress,
executor_waiting, tool_called, agent_spawned, agent_completed,
approval_requested, approval_resolved, checkpoint_created,
verification_recorded, repair_created, task_completed,
run_paused, run_resumed, run_cancelled, run_failed, run_completed
```

事件中不得写入宿主 secret、API token 或未脱敏的第三方凭证。

## 10. Agent Runtime Adapter

### 10.1 统一接口

```ts
interface AgentRuntimeAdapter {
  readonly type: string
  readonly version: string

  discover(input: DiscoverAgentInput): Effect.Effect<AgentDescriptor[], AgentRuntimeError>
  start(input: StartAgentInput): Effect.Effect<AgentHandle, AgentRuntimeError>
  send(handle: AgentHandle, input: AgentInput): Effect.Effect<void, AgentRuntimeError>
  events(handle: AgentHandle): Stream.Stream<AgentEvent, AgentRuntimeError>
  pause(handle: AgentHandle): Effect.Effect<Checkpoint, AgentRuntimeError>
  resume(handle: AgentHandle, checkpoint: Checkpoint): Effect.Effect<void, AgentRuntimeError>
  cancel(handle: AgentHandle): Effect.Effect<void, AgentRuntimeError>
  dispose(handle: AgentHandle): Effect.Effect<void, AgentRuntimeError>
}
```

### 10.2 第一批 Adapter

按优先级：

1. `native`：NovaWay 内置 Agent Runtime；
2. `local-worker`：本地文件、Shell、Office、Browser Worker；
3. `plugin`：第三方插件提供的 Agent Runtime；
4. `claude-code`：外部 Claude Code Runtime；
5. `codex`：外部 Codex Runtime；
6. `remote-worker`：远程 Worker 或 Gateway；
7. `browser-agent`：浏览器自动化 Agent。

### 10.3 Adapter 边界

Adapter 不得修改其他 Run、直接写入 `verification=pass`、修改其他插件 Evidence、读取其他插件 storage、使用未经 Policy 授权的工具、将外部进程退出码直接解释为业务完成。

## 11. Supervisor 设计

### 11.1 输入

Supervisor 每次决策可读取 Goal、Task Graph、当前 Task、ExecutorResult、Evidence、Verification、预算和 usage、Policy Decision、错误和重试次数、可用 Agent / Worker Descriptor 以及用户新增指令。

Supervisor 不应默认读取整个历史消息和所有项目文件，必须由 Context Assembler 按需加载。

### 11.2 输出检查

模型输出必须先解析成 `AgentInstruction`，并通过：

1. Schema 校验；
2. 任务归属校验；
3. 依赖校验；
4. Agent / Worker capability 校验；
5. 工具权限校验；
6. budget reservation；
7. 并发和循环校验；
8. Approval requirement 校验；
9. 指令幂等校验。

任意一步失败，进入 `policy_rejected` 或 `needs_review`，不能直接执行。

### 11.3 计划和重计划

计划必须版本化：

```text
Plan v1 → 执行 → 失败或新信息 → Plan v2
```

重计划必须记录触发原因、旧计划 hash、新计划 hash、受影响 Task、已完成 Task 是否仍有效、哪些 Evidence 变 stale、是否需要重新审批。旧计划不能被覆盖。

### 11.4 循环检测

必须检测相同指令重复、相同错误重复、同一 Task 相同输入重复、Agent 互相 delegate、计划版本来回切换和无实际进展的预算消耗。达到阈值后进入 `needs_review`，不自动无限重试。

## 12. 多 Agent 协作语义

第一批角色建议为 `planner`、`executor`、`researcher`、`coder`、`reviewer`、`tester`、`verifier`、`operator`、`summarizer`。角色必须是 Agent Descriptor，不应硬编码成 Supervisor 特殊字符串。

委派必须包含 parent Task、child Task、target Agent、输入约束、expected output schema、deadline、budget slice、acceptance criteria 和是否允许继续委派。

并行任务必须声明最大并行度、共享资源、冲突策略、汇总策略、子任务失败时父任务行为以及是否允许 partial success。默认不允许两个 Worker 同时修改同一个文件、Office 文档或不可合并的外部资源。

Agent 输出分为 `fact`、`proposal`、`artifact`、`verification`、`claim`。`claim` 不能自动提升为 `fact` 或 `verification.pass`。

## 13. Verification-Driven Completion

### 13.1 完成判据

Run 只有满足以下全部条件，才允许 `completed`：

- Goal 的 required Acceptance Criteria 全部存在；
- 每条 required criterion 都有最新 Evidence；
- 每条 criterion 的 Verification 为 `pass`；
- 没有 `unverified`、`stale` 或未处理的 `needs_review`；
- 没有 `unknown` operation；
- 没有 pending approval 或 pending input；
- 没有超预算；
- 所有 required artifact 可访问；
- 所有必须的子任务已完成；
- Completion Summary 引用完整 Evidence 和 Verification。

### 13.2 修复循环

```text
Verification
  ├─ pass → 继续整体验收
  ├─ fail → 生成 repair task
  ├─ stale → 重新采集证据
  ├─ unverified → 补充验证器或人工复核
  └─ needs_review → 等待人工决定
```

修复任务必须引用原始失败 Verification，不能删除失败记录或覆盖历史。

### 13.3 Verifier 插件

Verifier 可以插件化，但宿主控制 verifier manifest、证据范围、schema、版本、超时、权限、结论集合和人工复核要求。Verifier 不能修改自己的阈值，也不能将 `unverified` 返回为 `pass`。

## 14. 插件化设计

### 14.1 建议新增贡献类型

在现有 manifest / ContributionRegistry 体系上评估增加：

- `superAgentStrategies`：Supervisor 策略；
- `agentRuntimes`：Agent Runtime Adapter；
- `taskKinds`：可执行任务类型；
- `verifiers`：验证器；
- `repairStrategies`：修复策略；
- `agentTemplates`：Agent 模板；
- `superAgentPolicies`：路由、预算和安全策略；
- `superAgentSurfaces`：任务图和 Timeline 声明式 UI。

最终名称以 SA-M0 manifest 评审为准，不在 M0 前同时引入多个同义字段。

### 14.2 第三方插件可以贡献

Agent Descriptor、Tool、Skill、Worker Adapter、Task Kind、Verifier、Repair Strategy、Routing Policy、Agent Template、声明式 UI、iframe UI、Event handler、Channel / Trigger。

### 14.3 第三方插件不能

- 直接写入宿主 Run 状态；
- 伪造 `verification=pass`；
- 修改其他插件 Evidence；
- 读取宿主 token 或 DOM；
- 直接执行任意宿主 command；
- 越权访问其他插件 namespace；
- 关闭或修改宿主预算；
- 绕过人工审批；
- 伪造 Runtime 已完成；
- 将进程内插件代码当作安全沙箱。

### 14.4 生命周期

所有 Super-Agent 插件贡献都必须支持 discover、validate、activate、health check、execute、cancel、dispose、release 和 diagnostics。插件 disable、crash 或 upgrade 时，相关任务必须进入明确的 `blocked` / `needs_review` 状态。

## 15. 权限、安全和审批

### 15.1 权限层级

```text
Run Policy → Agent Policy → Task Policy → Tool Policy → Invocation Policy
```

低层级不能扩大高层级权限。

### 15.2 必须审批的动作

至少包括：写入项目外路径、删除文件、git commit / push、发布或部署、访问 secret、外部网络副作用、生产配置变更、高成本模型或大规模并行、第三方 Agent Runtime，以及向外部 Channel 发送消息。

### 15.3 安全边界

- iframe 使用现有 `sandbox="allow-scripts"` 和 `no-referrer` 约束；
- UI action 通过 `postMessage`，校验 pluginID、runID、nonce 和 schema；
- Agent instruction 绑定 run/task scope；
- 所有外部 Runtime 通过 adapter；
- secret 不进入 prompt、event、Evidence 或 renderer；
- 日志脱敏；
- 进程内插件代码不是安全沙箱，权限文档必须明确说明。

## 16. 持久化、恢复和一致性

### 16.1 必须持久化

Run、Goal、Plan version、Task Graph、Task Node、Agent Instance、Instruction、Executor Operation、Event、Checkpoint、Approval Request、Evidence、Verification、Budget reservation、Artifact reference。

### 16.2 Idempotency

每条有副作用的 instruction 必须有 idempotency key：

```text
runID + taskID + instructionType + logicalAttempt + inputHash
```

重复 key 时：已成功返回原结果；正在执行返回 operation 状态；已失败按 RetryPolicy 处理；`unknown` 不得自动重跑，进入 recovery policy。

### 16.3 Crash Recovery

启动恢复流程：

1. 扫描 `started` / `running` operation；
2. 检查 heartbeat / lease；
3. 过期操作标记为 `unknown`；
4. 生成 `needs_review` 或确定性 recovery action；
5. 不自动重放有外部副作用的操作；
6. 恢复 Run 到可继续状态；
7. 写入 recovery event。

### 16.4 Checkpoint

Checkpoint 包含 Run / Task / Agent 状态、plan hash、state version、pending instruction、pending approval、budget snapshot、adapter resume token、event sequence 和 evidence / verification snapshot。

## 17. API 规划

建议 API：

```text
POST   /super-agent/runs
GET    /super-agent/runs
GET    /super-agent/runs/{runID}
POST   /super-agent/runs/{runID}/start
POST   /super-agent/runs/{runID}/pause
POST   /super-agent/runs/{runID}/resume
POST   /super-agent/runs/{runID}/cancel
POST   /super-agent/runs/{runID}/approve
POST   /super-agent/runs/{runID}/input
GET    /super-agent/runs/{runID}/events
GET    /super-agent/runs/{runID}/graph
GET    /super-agent/runs/{runID}/agents
GET    /super-agent/runs/{runID}/evidence
GET    /super-agent/runs/{runID}/verification
```

控制原则：

- 每个 mutation API 做 scope 和 permission 校验；
- 输出包含 status、version、event sequence；
- SSE 断线支持 `Last-Event-ID` 或 cursor 恢复；
- pause / cancel 有 latency 预算；
- API 不暴露 secret、token 或完整 prompt；
- `/complete` 不是客户端强制完成接口，完成由 Runtime 验证流程决定。

## 18. UI 和 Surface 规划

| Surface                 | 用途                                           |
| ----------------------- | ---------------------------------------------- |
| `session.panel`         | 当前 Run、任务图、Agent 状态、暂停/恢复        |
| `message.part.renderer` | instruction、tool、verification、evidence 事件 |
| `sidebar.item`          | Super-Agent 工作台                             |
| `home.card`             | Agent 模板、最近任务、待审批                   |
| `notification.item`     | 审批、失败、恢复、完成                         |
| `settings.section`      | 默认策略、预算、模型路由、权限                 |
| `composer.action`       | 启动、暂停、恢复、重试、验证                   |
| `statusbar.item`        | 当前 Run、预算、活动 Agent                     |

第三方使用声明式 UI 或 iframe；不获得宿主 token、DOM 或任意 command 权限。UI 显示的 `completed` 必须来自 Completion Summary，不接受模型文本中的完成声明。

### UI 验收重点

- 任务图节点状态与后端事件一致；
- 事件流断线重连不重复显示副作用事件；
- approval 显示 scope、原因、风险和过期时间；
- pause/resume 后 Timeline 连续；
- failed / unknown / unverified 不能显示成成功绿色；
- 第三方 Surface disable 后在预算内消失；
- renderer 不因不可 clone 数据触发 `DataCloneError`。

## 19. 可观测性和成本控制

每个 Run 必须有 `runID`、`taskID`、`agentID`、`operationID`、`instructionID`、`parentEventID`、`attempt`、`pluginID` 和 `runtimeType`。

至少采集计划耗时、Task 耗时、LLM token、工具调用和失败率、子 Agent 数、并行度、retry、approval 等待时间、verification 通过率、repair 次数、unknown 数量、完成率和 budget reservation / settlement / overrun。

审计必须能够回答：谁创建了 Run；哪个 Supervisor 发出了什么指令；哪个 Policy 允许或拒绝；哪个 Agent / Worker 执行；产生了什么 Evidence；哪个 Verifier 得出什么结论；谁批准危险动作；为什么最终进入 completed / failed / needs_review。

## 20. 实施阶段和任务分解

任务编号固定为 `SA-Txx`。每个任务完成后必须补充实现文件、协议变化、测试命令、结果、性能结果和未验证范围。

### SA-M0：架构基线和协议冻结

目标：不改变现有业务行为，先建立可评审协议。

| 任务  | 内容                                                   | 交付物          |
| ----- | ------------------------------------------------------ | --------------- |
| SA-T1 | 盘点 Team / Run / Orchestrator / Verification / Worker | 架构映射表      |
| SA-T2 | 定义 Run、Task、Agent、Worker、Evidence、Verification  | Schema 草案     |
| SA-T3 | 定义状态机和非法转移                                   | 状态表和单测    |
| SA-T4 | 定义 Instruction / Result                              | 协议 Schema     |
| SA-T5 | 定义 Event envelope、sequence、idempotency             | Event contract  |
| SA-T6 | 定义插件贡献类型和 capability mapping                  | Manifest 设计   |
| SA-T7 | 定义 Policy、Budget、Approval、Retry                   | Policy contract |
| SA-T8 | 记录 LobeHub 借鉴项与不采用项                          | ADR             |

验收：协议可序列化、带版本、无循环依赖，并覆盖正常、失败、暂停、恢复、unknown 五类路径。

### SA-M1：Runtime Kernel

| 任务   | 内容                              | 交付物                      |
| ------ | --------------------------------- | --------------------------- |
| SA-T9  | 创建 `SuperAgentRuntime` 服务边界 | Service / Tag / Layer       |
| SA-T10 | Run 创建、启动、暂停、恢复、取消  | HTTP + service              |
| SA-T11 | Task Graph CRUD 和版本化          | Graph service               |
| SA-T12 | instruction validation            | Schema / scope / capability |
| SA-T13 | Executor Registry                 | registry + lifecycle        |
| SA-T14 | Event append / replay / cursor    | event store                 |
| SA-T15 | checkpoint                        | checkpoint store            |
| SA-T16 | idempotency 和 operation lease    | recovery primitives         |
| SA-T17 | unknown operation recovery        | recovery service            |

验收：进程中断后可恢复；重复请求不产生重复副作用；非法状态转移全部拒绝。

### SA-M2：单 Agent 执行闭环

| 任务   | 内容                                 | 交付物                                |
| ------ | ------------------------------------ | ------------------------------------- |
| SA-T18 | native Agent Adapter                 | adapter                               |
| SA-T19 | 接入 Tool / Skill / Provider         | executor                              |
| SA-T20 | context assembly                     | bounded context                       |
| SA-T21 | streaming event                      | event bridge                          |
| SA-T22 | human approval / input               | approval executor                     |
| SA-T23 | usage / cost / budget                | ledger integration                    |
| SA-T24 | 最小 Supervisor                      | deterministic + model-backed strategy |
| SA-T25 | goal → task → tool → result → finish | vertical slice                        |

验收：工具失败可重试或失败；需要审批时可暂停并恢复；完成前必须有 Verification。

### SA-M3：Task Graph 和计划执行

| 任务   | 内容                      | 交付物              |
| ------ | ------------------------- | ------------------- |
| SA-T26 | Planner 输出 Task Graph   | planner contract    |
| SA-T27 | 依赖 ready / blocked 计算 | scheduler           |
| SA-T28 | 串行任务执行              | scheduler path      |
| SA-T29 | 并行任务执行              | concurrency control |
| SA-T30 | 失败重试和 backoff        | retry policy        |
| SA-T31 | 失败修复任务              | repair linkage      |
| SA-T32 | 计划版本化和 replan       | plan history        |
| SA-T33 | 循环和无进展检测          | safety guard        |

验收：任务图可暂停、恢复、重新规划；历史 Plan 不被覆盖；无进展进入 needs_review。

### SA-M4：多 Agent 协作

| 任务   | 内容                             | 交付物                 |
| ------ | -------------------------------- | ---------------------- |
| SA-T34 | Agent Descriptor / role registry | registry               |
| SA-T35 | `spawn_agent` / `delegate`       | executor               |
| SA-T36 | `parallel_call_agents`           | parallel executor      |
| SA-T37 | 子 Agent budget slice            | budget hierarchy       |
| SA-T38 | 子 Agent cancellation / timeout  | lifecycle              |
| SA-T39 | Agent result schema              | structured result      |
| SA-T40 | 多 Agent conflict policy         | merge / lock           |
| SA-T41 | Supervisor 汇总和继续决策        | orchestration strategy |

验收：至少三个 Agent 可并行；单个失败不会丢失其他结果；父任务能决定继续、修复或失败。

### SA-M5：异构 Agent Runtime

| 任务   | 内容                        | 交付物            |
| ------ | --------------------------- | ----------------- |
| SA-T42 | Adapter health / discovery  | runtime discovery |
| SA-T43 | local-worker adapter        | 本地 Worker       |
| SA-T44 | Claude Code adapter         | 外部 Runtime      |
| SA-T45 | Codex adapter               | 外部 Runtime      |
| SA-T46 | remote-worker gateway       | 远程执行          |
| SA-T47 | adapter pause/resume        | checkpoint bridge |
| SA-T48 | adapter crash recovery      | unknown handling  |
| SA-T49 | adapter permission boundary | capability tests  |

验收：外部 Runtime 不能绕过 Policy；断开后进入 unknown 或 needs_review；能通过 checkpoint 恢复。

### SA-M6：Verification、Evidence 和 Repair

| 任务   | 内容                     | 交付物                    |
| ------ | ------------------------ | ------------------------- |
| SA-T50 | Acceptance Criteria API  | criteria store            |
| SA-T51 | Evidence Store           | evidence lifecycle        |
| SA-T52 | Verifier Registry        | verifier API              |
| SA-T53 | built-in test verifier   | 测试证据验证              |
| SA-T54 | artifact / file verifier | 产物验证                  |
| SA-T55 | human review verifier    | 人工复核                  |
| SA-T56 | repair task generation   | repair strategy           |
| SA-T57 | stale / unverified 传播  | validity engine           |
| SA-T58 | completion guard         | completed transition gate |

验收：模型说完成但无证据时不能完成；证据过期自动 stale；验证失败生成可追踪 repair task。

### SA-M7：插件和市场化

| 任务   | 内容                                | 交付物                      |
| ------ | ----------------------------------- | --------------------------- |
| SA-T59 | agent runtime contribution          | manifest / registry         |
| SA-T60 | supervisor strategy contribution    | strategy plugin             |
| SA-T61 | task kind contribution              | task plugin                 |
| SA-T62 | verifier contribution               | verifier plugin             |
| SA-T63 | repair strategy contribution        | repair plugin               |
| SA-T64 | agent template contribution         | marketplace                 |
| SA-T65 | permissions / diagnostics / disable | lifecycle                   |
| SA-T66 | third-party Super-Agent Surface     | settings / panel / renderer |

验收：第三方插件能贡献 Agent / Worker / Verifier / Surface；disable 后任务进入明确 blocked / needs_review；无越权写入。

### SA-M8：产品化 UI 和运营门禁

| 任务   | 内容                       | 交付物                              |
| ------ | -------------------------- | ----------------------------------- |
| SA-T67 | Super-Agent 创建页         | Goal / criteria / budget            |
| SA-T68 | Task Graph UI              | graph / node details                |
| SA-T69 | Agent Timeline             | event stream                        |
| SA-T70 | Approval UI                | approve / reject / scope            |
| SA-T71 | Evidence / Verification UI | evidence chain                      |
| SA-T72 | pause / resume / cancel UI | lifecycle controls                  |
| SA-T73 | marketplace templates      | discover / install / enable         |
| SA-T74 | full Chromium golden path  | e2e                                 |
| SA-T75 | full release gate          | regression / performance / security |

验收：用户可以创建、观察、暂停、批准、恢复和验证一个完整 Run；断线重连不丢事件。

## 21. 测试和验收计划

### 21.1 协议和 Runtime 单测

覆盖 Schema、状态机、scope、capability mismatch、idempotency、event sequence、plan hash、budget reservation、Verification 不折叠、retry、backoff、loop detection。

### 21.2 集成测试

覆盖单 Agent 完成、工具失败、工具审批、pause/resume、checkpoint recovery、crash、unknown operation、cancellation、timeout、budget exhausted、stale evidence 和 repair loop。

### 21.3 多 Agent 测试

覆盖 delegate、三个 Agent parallel、部分失败、父任务重计划、delegate 循环、并发冲突、子 Agent budget 超限、子 Agent 取消和结果聚合。

### 21.4 HTTP 契约测试

每个新增 API 覆盖正常、未授权、scope 越权、stale version、重复 idempotency key、非法状态、cancel / resume、event cursor，并保持 0 missing / 0 extra。

### 21.5 Chromium 黄金路径

至少覆盖：

1. 创建 Goal；
2. 生成并显示 Task Graph；
3. 启动两个并行 Agent；
4. 一个 Agent 触发审批；
5. 用户批准并继续；
6. 一个任务失败并生成 repair task；
7. Verifier 显示 fail 和 evidence；
8. 修复后重新验证；
9. Run 进入 completed；
10. reload 后状态保持；
11. backend restart 后可恢复；
12. pause / resume / cancel 可用；
13. disable 第三方 Agent 后进入 blocked / needs_review；
14. 所有 UI 安全约束通过。

### 21.6 Chaos / Recovery

测试 Supervisor 或 Executor 退出、网络断开、外部 Runtime 超时、DB transaction 中断、SSE 断开、重复 approve / cancel、stale checkpoint、plugin disable / upgrade 和 worker heartbeat 过期。

### 21.7 初始性能预算

SA-M0 可根据基线调整，但必须记录：创建 Run p95 ≤ 300ms（不含模型）；状态查询 p95 ≤ 150ms；event append p95 ≤ 100ms；1000 条 event replay ≤ 2s；pause / cancel p95 ≤ 300ms；单 Runtime 调度开销 ≤ 20ms；默认单 Run 最大并行 Agent 8；最大 Task Node 200；无界事件、消息、重试和 Agent 派生必须拒绝或截断；disable / release 后无 executor、timer、listener、subscription 泄漏。

## 22. 门禁定义

| 门禁   | 内容           | 通过标准                                              |
| ------ | -------------- | ----------------------------------------------------- |
| SA-G1  | 协议和状态机   | Schema、状态转移、非法路径单测全绿                    |
| SA-G2  | Runtime Kernel | pause/resume/cancel/checkpoint/recovery 全绿          |
| SA-G3  | 单 Agent 闭环  | goal → task → tool → evidence → verification 全绿     |
| SA-G4  | 多 Agent       | delegate、parallel、partial failure、budget 全绿      |
| SA-G5  | 异构 Runtime   | adapter、crash、unknown、resume 全绿                  |
| SA-G6  | Verification   | 无证据不能完成，fail/stale/unverified 不折叠          |
| SA-G7  | 插件边界       | 第三方 Agent/Worker/Verifier/Surface 接线且无越权     |
| SA-G8  | UI 黄金路径    | Chromium、重启、断线、审批、恢复通过                  |
| SA-G9  | 全量回归       | root、NovaWay、App、HTTP 全量通过                     |
| SA-G10 | 性能和资源     | 调度、事件、并发、disable、资源释放在预算内           |
| SA-G11 | 安全           | 权限、secret、SSRF、command、namespace、approval 全绿 |
| SA-G12 | 发布人工证据   | required 人工抽样真实完成，不得伪造                   |

任何门禁未通过，都不得将 Super-Agent 计划标记为完成。

## 23. 里程碑顺序和依赖

```text
SA-M0 → SA-M1 → SA-M2 → SA-M3 → SA-M4
                                  ↓
                         SA-M5 → SA-M6 → SA-M7 → SA-M8
```

严格依赖：

- SA-M0 完成前不得冻结 API；
- SA-M1 完成前不得实现多 Agent UI；
- SA-M2 完成前不得接入外部 Claude / Codex Runtime；
- SA-M3 完成前不得声称支持自主计划执行；
- SA-M6 完成前不得声称支持“自动完成”；
- SA-M7 完成前不得把第三方 Super-Agent 能力放入 marketplace；
- SA-M8 完成前不得标记产品级 Super-Agent 完成。

## 24. Rollout 和回滚

### 24.1 Feature Flags

建议至少提供：

- `super_agent_runtime`
- `super_agent_task_graph`
- `super_agent_parallel_agents`
- `super_agent_external_runtime`
- `super_agent_verification_guard`
- `super_agent_plugin_contributions`
- `super_agent_ui`

M0–M2 仅开发环境开启；M3–M5 面向内部测试；M6–M7 按项目或 workspace 灰度；M8 通过发布门禁后才默认开启。

### 24.2 回滚

必须支持关闭新建 Run、继续查询已有 Run、暂停正在运行的 Run、保留 Evidence / Verification、不删除历史事件、把不可恢复的外部任务标记为 `needs_review`，以及回滚插件版本而不破坏 Task Graph 和 event schema。

### 24.3 Schema Migration

事件和持久化 schema 必须版本化。新版本可读取旧版本；旧版本遇到未知 event type 时进入安全只读或 needs_review；不得静默丢弃字段；migration 必须有 dry-run、backup 和 rollback 证据。

## 25. 文档和开发规范

每个 SA-T 任务完成时必须在本文追加：

```text
日期
任务编号
实现文件
协议变化
测试命令与结果
性能结果
未验证范围
已知阻塞
是否改变用户数据或现有服务
```

涉及 UI 或本地开发服务的测试继续遵守现有约束：

- 不重启既有应用或服务；
- 只使用本轮启动的隔离进程和端口；
- 测试结束停止自有进程并确认端口释放；
- 不执行 `git commit`，除非用户明确授权；
- 保留用户已有无关改动；
- secret 按既有决定允许明文保存，但避免泄露到日志、事件和 iframe。

## 26. 首个 Vertical Slice

正式大规模开发前，先完成一个最小但真实的 Vertical Slice：

```text
“检查当前项目是否能通过测试；如果失败，修复后重新运行测试。”
```

要求：

1. 创建 Super-Agent Run；
2. 生成检查和修复两个 Task；
3. 使用 native Agent；
4. 调用测试工具；
5. 测试失败时生成 repair task；
6. 需要审批时暂停；
7. 用户批准后继续；
8. 重新运行测试；
9. 产生 test Evidence；
10. Verification 判断；
11. 只有测试通过且证据有效时进入 completed；
12. reload 和 backend restart 后状态仍可恢复。

这个 Vertical Slice 是 SA-M2、SA-M3 和 SA-M6 的共同验收样例。没有完成它，不进入复杂的多 Agent Marketplace 和高级自主规划。

## 27. 完成定义

Super-Agent 计划只有在以下条件全部满足时才能标记完成：

- SA-M0–SA-M8 全部完成；
- SA-G1–SA-G12 全部通过；
- 真实 Chromium 黄金路径通过；
- backend restart / crash recovery 通过；
- 至少一个外部 Agent Runtime adapter 通过；
- 第三方 Agent / Worker / Verifier / Surface 全链路通过；
- Verification guard 阻止所有无证据完成；
- 全量回归、性能、安全门禁通过；
- 所有人工门禁具有真实复核记录；
- 未验证范围为空，或已被用户明确接受为非阻塞项；
- 未执行未经授权的 `git commit`；
- 本轮启动的服务和测试进程已停止并确认释放。

不得用以下表述替代完成：模型说完成、Prompt 能跑、Demo 可用、单元测试通过、UI 看起来完成、没有发现问题、人工门禁以后再补。

最终完成必须有可复现的代码、事件、证据、测试和人工复核记录。

## 28. 当前下一步：SA-M0

按本文执行的第一步是 **SA-M0：架构基线和协议冻结**：

1. 盘点 NovaWay 现有 Team / Run / Orchestrator / Verification / Worker；
2. 形成现有能力到 Super-Agent 领域模型的映射表；
3. 定义并评审 Run / Task / Agent / Worker / Evidence / Verification；
4. 定义状态机和非法转移；
5. 定义 instruction / result / event schema；
6. 定义插件 manifest 扩展；
7. 编写第一批协议单测；
8. 冻结 SA-M1 实现边界；
9. 再开始 Runtime Kernel 编码。

在 SA-M0 完成前，不直接开发“大而全”的 Super-Agent UI，也不直接接入多个外部 Agent Runtime。

## 29. 实施日志

- 2026-11-14 SA-M0/SA-T2–SA-T5 首批协议基线：新增 `packages/novaway/src/super-agent/types.ts`、`state.ts` 和 `runtime.ts`，定义 Run / Task / Goal / Agent / Evidence / Verification / Budget、Run 状态转移、typed `AgentInstruction`、`ExecutorResult`、事件序列和内存 Journal。新增 `packages/novaway/test/super-agent/runtime.test.ts`，覆盖事件序列、非法终态迁移、无证据禁止完成、通过验证才能完成、无 Executor 拒绝和 unknown operation 进入 `needs_review`。结果：6 pass、0 fail、13 expectations；NovaWay typecheck 通过；Prettier 检查通过。当前仍是 SA-M0 纯内核基线，尚未接入持久化、HTTP、插件贡献或 UI。

### SA-M0 / SA-M1 architecture mapping and implementation log (2026-11-15)

#### Existing NovaWay mapping

| Existing capability                           | Super-Agent role                             | Reuse boundary                                                                                        | Current status                                             |
| --------------------------------------------- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `Team` / `TeamRun`                            | Run creation and execution ownership         | Team remains compatible with the new Run model; no implicit conversion is performed                   | mapped; adapter still pending                              |
| `Orchestrator`                                | Supervisor strategy and task scheduling      | Orchestrator may produce typed instructions, but the Super-Agent kernel owns lifecycle and completion | mapped; deterministic Supervisor pending                   |
| `team/task-list`                              | Task Graph / Task Node persistence           | Super-Agent graph is versioned independently so historical plans are not overwritten                  | initial root graph implemented                             |
| `team/verification` and acceptance checks     | Verifier / Verification                      | A model claim never bypasses the kernel completion guard                                              | required verification guard implemented                    |
| `team/evidence`                               | Evidence Store                               | Evidence IDs are persisted and referenced by Verification; secrets are not put into event payloads    | Super-Agent evidence table implemented                     |
| Worker / dynamic-workflow                     | Agent Runtime Adapter / external operation   | Worker disconnects are represented by operation `unknown`, not guessed success or failure             | lease/recovery primitive implemented                       |
| Database migration and `Database.transaction` | durable Run/Event/Checkpoint/Operation store | state and recovery records use SQLite with scoped directory reads                                     | persistent slice implemented                               |
| HTTP API group/handler architecture           | lifecycle and read API                       | directory scope is provided by `InstanceContextMiddleware` and `WorkspaceRoutingMiddleware`           | create/list/read/lifecycle/graph/evidence APIs implemented |

#### Protocol freeze recorded by this slice

- Event wire version: `sa.event.v1`; every persisted event has `eventID`, monotonic per-run `sequence`, `idempotencyKey`, and `protocolVersion`.
- Instruction metadata is mandatory at the runtime boundary: `instructionID`, `runID`, `issuedAt`, `policyContextHash`, and `idempotencyKey`.
- Event append is idempotent inside a database transaction; a duplicate `(runID, idempotencyKey)` returns the original event.
- Operation leases are durable. An expired `started` operation becomes `unknown` and the same idempotency key cannot silently start a second operation.
- Pausing requires a persisted checkpoint. Completing a persisted Run requires `verifying` state and passing Verification for every required Acceptance Criterion.

#### Verified implementation slice

- Files: `src/super-agent/types.ts`, `state.ts`, `runtime.ts`, `store.ts`, `super-agent.sql.ts`; migrations `20261114000000` through `20261114000003`; HTTP group/handler/API registration.
- Tests: `bun test test/super-agent --timeout 120000` — 11 pass, 0 fail, 34 expectations; `bun test test/server/httpapi-super-agent.test.ts --timeout 120000` — 3 pass, 0 fail, 21 expectations.
- Typecheck: `bun run typecheck` — passed.
- Not yet complete: native Agent Runtime execution, Supervisor, Task Graph mutation API, budget ledger integration, verifier/repair registries, plugin contribution registration, UI surfaces, Chromium golden path, and release gates.

### SA-M1 incremental kernel completion (2026-11-15)

- Added `graph.ts` validation (duplicate IDs, missing dependencies, cycles, root scope, 200-node bound) and optimistic graph version updates through `PUT /super-agent/runs/:runID/graph`.
- Added durable checkpoint, operation lease, evidence tables and migrations. Event append is transactional and cursor reads use `sequence > after` with bounded limits.
- Added lifecycle endpoints: `start`, `pause`, `resume`, `cancel`, graph read/update, evidence read, verification read. `pause` persists a checkpoint first; `cancel` follows `cancelling → cancelled` for running Runs.
- Added `SuperAgentExecutorRegistry`, deterministic Supervisor boundary, heterogeneous `AgentRuntimeRegistry`, `VerifierRegistry`, and built-in evidence-based test verifier.
- Added completion protection to the persistent store: `completed` is rejected unless every required criterion has a passing Verification and the Run has passed through `verifying`.
- Validation: `GOMAXPROCS=4 bun run typecheck` passed; `bun test test/super-agent --timeout 120000` passed with 16 tests / 49 expectations; HTTP lifecycle and graph tests passed with 3 tests / 23 expectations; plugin suite passed with 300 pass / 1 skip.
- Remaining M1/M2 scope is explicit: atomic transition-plus-event outbox, task mutation history, real executor wiring, native Agent adapter, approval/input persistence, budget reservations, and crash recovery orchestration are not claimed complete by this slice.

### SA-M2 foundation increment (2026-11-15)

- Added `AgentRuntimeAdapter` and `AgentRuntimeRegistry` contracts plus a local/native adapter with start, event stream, pause checkpoint, resume, cancel, and dispose behavior. External Claude Code/Codex/remote adapters remain behind this boundary and are not silently treated as local.
- Added durable budget reservation APIs (`reserveBudget`, `settleBudget`, `releaseBudget`) with active reservation accounting and over-budget rejection before execution.
- Added durable Approval and Input request stores and scoped HTTP decision endpoints. Approval/input resolution resumes only the matching run.
- Added `VerifierRegistry` and an evidence-based built-in test verifier. Passing Verification now requires persisted Evidence references; store completion rejects absent or missing Evidence.
- The lifecycle handler now uses an atomic state-plus-event transaction for status mutations. The generic transition API therefore cannot persist a status change without its audit event.
- Super-Agent tests now total 19 pass / 57 expectations; HTTP tests remain 3 pass / 23 expectations; plugin tests remain 300 pass / 1 skip; bounded typecheck passes. No UI or external runtime acceptance is claimed yet.

### SA-M2 vertical acceptance update (2026-11-15)

- Added HTTP evidence creation and verified the complete lifecycle: create → start → verifying → evidence → Verification → completed. The HTTP test now has 4 pass / 28 expectations.
- The persistent store rejects passing Verification without Evidence and rejects Evidence IDs from another Run. This closes the model-claim completion bypass in both runtime and persistent paths.
- Added approval/input persistence and scoped decision APIs, plus budget reservation persistence and pre-execution budget enforcement.
- Added a local native Agent Runtime implementation and test coverage for streamed started/completed events and adapter pause/dispose.

### SA-M3 / SA-M6 safety increment (2026-11-15)

- Added dependency-aware `TaskScheduler` with pending → ready → running → succeeded → verifying → completed transitions, bounded parallel-ready selection, retry/blocked/needs-review transition guards, and tests.
- Added Evidence expiry and `verificationOutcomeAt`; persisted completion re-evaluates evidence freshness and converts expired/missing evidence to `stale` before applying the completion guard.
- Added atomic `transitionWithEvent` store operation and switched lifecycle/generic transition handlers to it, preventing a status mutation without its audit event.

### SA-M2 native Tool execution increment (2026-11-15)

- Added `src/super-agent/tool-executor.ts` and exported it from the Super-Agent module. `makeSuperAgentToolExecutor` resolves a real `Tool.Def` through `ToolRegistry.Interface.all()`, constructs the caller-supplied complete `Tool.Context`, and executes the existing Effect-based tool implementation rather than duplicating tool behavior.
- Native execution preserves the existing permission boundary: `Tool.Context.ask()` is supplied by the host and is called by the tool itself; the Super-Agent bridge does not grant or bypass permissions. An optional executor allowlist rejects tools before lookup or execution.
- When a `SuperAgentStore` is provided, the bridge creates a durable operation lease, reserves one `toolCalls` budget unit, emits `tool_operation_started` / `tool_operation_progress` / `tool_operation_completed` or `tool_operation_failed`, persists a hashed artifact Evidence record, resolves the operation, and settles/releases the reservation. A duplicate idempotency key returns the persisted result; an already-owned started operation returns `unknown` instead of replaying an unknown side effect.
- `beginOperation` now returns an `acquired` ownership bit while retaining the existing operation shape. The persisted operation and evidence IDs are deterministic for the instruction, enabling crash/restart deduplication at the native executor boundary.
- `SuperAgentRuntime` now starts a tool Task only after an executor is configured, settles successful tool/agent tasks, records task output and Evidence IDs, increments `usage.toolCalls`, and emits typed completion events. Failed, waiting, and unknown results update the corresponding task/run state instead of leaving a ready task falsely successful.
- Tests: `bun test test/super-agent --timeout 120000` — **28 pass, 0 fail, 83 expectations**; `bun test test/server/httpapi-super-agent.test.ts --timeout 120000` — **4 pass, 0 fail, 28 expectations**; `bun test test/plugin --timeout 120000` — **300 pass, 1 skip, 0 fail, 838 expectations**; `GOMAXPROCS=4 bun run typecheck` — passed.
- This increment does **not** claim the full Vertical Slice or plan completion. Still unverified: production ToolRegistry/Permission service wiring in a running Supervisor, automatic Verification/finish orchestration, real external Agent Runtime adapter, parallel delegation, repair generation, plugin activation/disposal through the runtime host, full UI/Chromium golden path, restart acceptance with a real interrupted tool process, performance/security gates, and SA-G1–SA-G12.

### SA-M2 external Agent Runtime boundary increment (2026-11-15)

- Added `ProcessAgentRuntimeAdapter` to `src/super-agent/adapter.ts`. It starts only the explicitly supplied host/plugin command, sends the typed instruction over stdin, exposes started/completed/failed events from the child process, supports cancellation/disposal, and explicitly rejects unsupported pause/resume rather than pretending a checkpoint exists. Its descriptor advertises `localExecution: false` and pause/resume capability flags are explicit.
- The adapter is registered and discoverable through the existing `AgentRuntimeRegistry` boundary; no process is started by module import or discovery.
- Acceptance: `bun test test/super-agent --timeout 120000` — **30 pass, 0 fail, 86 expectations**; `GOMAXPROCS=4 bun run typecheck` — passed. The external-adapter test starts only a test-owned child process and disposes it after terminal event.
- This proves the adapter boundary and one real external process path, but not a Claude Code/Codex/remote-worker production protocol, durable stream replay, heartbeat, timeout escalation, or Supervisor delegation. Those remain unverified.

### SA-M2 vertical slice: HTTP native Tool execution (2026-11-15)

- Added `POST /super-agent/runs/:runID/execute-tool`. The handler obtains the real `ToolRegistry.Service`, `Permission.Service`, and `SuperAgentStore` from the current Effect context, builds a native Tool context with directory/session/message identity, executes the existing Tool.Def, persists operation/evidence/budget records, and updates the versioned Task Graph through `TaskScheduler`.
- Added `createNativeToolExecutorEffect` for hosts already inside an Effect service context. This avoids dropping `InstanceRef` and other scoped services by calling a global `Effect.runPromise`; the HTTP handler executes the tool effect in the request fiber. Permission capability checks and `ctx.ask()` remain active, and failed operations are resolved/released/audited.
- Budget settlement now atomically updates durable Run usage and is idempotent: settling the same reservation twice cannot double-count tokens, tool calls, or wall time.
- Real HTTP vertical-slice acceptance: create → start → execute registered `sleep` Tool.Def → operation events → artifact Evidence → Task `succeeded` → durable `usage.toolCalls=1`. Test result: `bun test test/server/httpapi-super-agent.test.ts --timeout 120000` — **5 pass, 0 fail, 34 expectations**.
- Current Super-Agent result after this increment: `bun test test/super-agent --timeout 120000` — **30 pass, 0 fail, 88 expectations**. The plugin suite remains **300 pass, 1 skip, 0 fail, 838 expectations**.
- Full package typecheck is currently blocked by two pre-existing `test/image/generate.test.ts` mock typing errors involving `HttpClient.HttpClient`; no Super-Agent source error is reported. This is recorded as a release-gate blocker, not marked as passed.
- Still not complete: automatic Supervisor loop/Verification/finish, parallel Agent delegation and child budgets, durable task mutation history/outbox replay, production external runtime protocol, plugin runtime activation/permission diagnostics, full UI/Chromium path, crash/restart test with an interrupted real tool, performance/security gates, and SA-G1–SA-G12.

### Verification correction (2026-11-15)

- The initial package typecheck blocker was resolved: the image test mock needed an explicit service cast and the existing branded ProviderID fallback lookup needed a type-safe key cast. `bun run typecheck` now passes.
- Final rerun in this increment: Super-Agent **30 pass / 0 fail / 88 expectations**; HTTP Super-Agent **5 pass / 0 fail / 34 expectations**; plugin suite **300 pass / 1 skip / 0 fail / 838 expectations**; image generation **5 pass / 0 fail / 18 expectations**.
- The plugin suite had one transient full-suite concurrency timeout during a parallel verification run; its isolated file rerun passed **3/3**, and the subsequent full rerun passed **300/1 skip/0 fail**. No existing application or development service was restarted.

### SA-M3 bounded Supervisor execution increment (2026-11-15)

- Added `SuperAgentExecutionLoop`, which consumes typed Supervisor decisions, handles checkpoints through the kernel, dispatches non-checkpoint instructions in bounded batches, and returns per-instruction results. `DeterministicSupervisor` now emits `run_tool` instructions when a Task input declares `{ tool, input }`; otherwise it retains the checkpoint instruction behavior.
- Runtime tool results now transition the Task through `running → succeeded`, persist output/Evidence IDs in the graph snapshot, and increment `usage.toolCalls`. Parallel task failure is isolated: when other work remains, the failed Task is retained and the Run moves to `needs_review` instead of terminating successful in-flight siblings.
- Tests: bounded three-tool execution at concurrency 2 and one-failure/two-success isolation pass. The complete Super-Agent suite is now **30 pass, 0 fail, 88 expectations** before the two execution-loop tests are included; the focused execution-loop suite is **2 pass, 0 fail, 6 expectations**. (The next full rerun must update the aggregate count.)
- This is not a claim of full Supervisor completion: no model planner, durable loop checkpoint/replay, child-agent delegation, child budget slicing, timeout policy, or automatic verify/repair/finish path is included yet.

#### Aggregate correction

- After adding `execution-loop.test.ts`, the complete Super-Agent result is **32 pass, 0 fail, 94 expectations across 10 files**.

#### Final verification after execution-loop changes (2026-11-15)

- `bun run typecheck` — passed.
- `bun test test/super-agent --timeout 120000` — **32 pass, 0 fail, 94 expectations across 10 files**.
- `bun test test/server/httpapi-super-agent.test.ts --timeout 120000` — **5 pass, 0 fail, 34 expectations**.
- The latest plugin regression remains **300 pass, 1 skip, 0 fail, 838 expectations** from the post-timeout full rerun.

### SA-M3 verification / repair orchestration increment (2026-11-15)

- Added `SuperAgentVerificationCoordinator`: it transitions a persisted Run into `verifying`, loads real Evidence, invokes a registered Verifier for every required Acceptance Criterion, persists Verification records and events, and only transitions to `completed` when every required result is `pass`. Failed/unverified results become `needs_review`. Completed Runs replay idempotently without inserting duplicate Verifications.
- Added `POST /super-agent/runs/:runID/verify-finish`; the HTTP golden path now uses the coordinator rather than manually asserting a model-supplied Verification and terminal transition.
- Added `builtinRepairStrategy` and `SuperAgentRepairCoordinator`. Failed Verification IDs produce a new durable repair Task and versioned graph edge, with an audit event. Added `POST /super-agent/runs/:runID/repair` and a real HTTP failure → needs_review → repair Task test.
- Added `SuperAgentRecoveryCoordinator`: expired operation leases are converted to `unknown` and a running/waiting Run is atomically gated to `needs_review`; it never retries an unknown side effect.
- Native Tool Evidence can now be explicitly classified by the host as `test`; test Evidence is measured `pass` only when the executed Tool result contains exit metadata `0`, otherwise `fail`. The bridge does not accept a caller-supplied pass string.
- Current focused verification: HTTP Super-Agent **6 pass, 0 fail, 39 expectations**; store Super-Agent **9 pass, 0 fail, 35 expectations**; full package typecheck passed. Full aggregate rerun is still required after these additions.
- Still unverified: automatic repair re-execution through a resumed Supervisor, child-agent delegation, durable task history/outbox, production plugin activation for Super-Agent contributions, Chromium path, real backend restart, security/performance gates, and SA-G1–SA-G12.

### SA-M4 plugin Runtime integration increment (2026-11-15)

- Wired Super-Agent contribution registries into the production Plugin Host: `agentRuntimes`, strategies, task kinds, verifiers, repair strategies, agent templates, policies, and Super-Agent surfaces now have owner-aware registries with activation-time registration and automatic disable/dispose cleanup.
- `createDiscoveredPlugin` now accepts the Super-Agent manifest contribution keys, activates their declarations through the scoped Host registry, and rejects activation when a Host does not provide the Super-Agent registry. Existing provider/office/publish activation restrictions remain intact.
- Added a production Host activation test covering third-party verifier and `session.panel` Surface registration followed by disable cleanup.
- Verification: `bun run typecheck` passed; `bun test test/plugin/runtime-context.test.ts --timeout 120000` — **56 pass, 1 skip, 188 expectations**; full plugin suite — **301 pass, 1 skip, 0 fail, 842 expectations across 22 files**.
- The registry currently stores validated manifest declarations; loading executable verifier/runtime entry modules and adapting them into the kernel `VerifierRegistry` / `AgentRuntimeRegistry` remains pending and is not claimed complete.

#### Aggregate verification correction (2026-11-15)

- After verification/recovery/repair additions, `bun test test/super-agent --timeout 120000` — **35 pass, 0 fail, 103 expectations across 10 files**.
- `bun test test/server/httpapi-super-agent.test.ts --timeout 120000` — **6 pass, 0 fail, 39 expectations**.
- `bun run typecheck` — passed.

### SA-M3 Tool timeout increment (2026-11-15)

- Added bounded timeout handling to both the generic `makeSuperAgentToolExecutor` and Effect-native `createNativeToolExecutorEffect`. Timeout uses `Effect.timeoutOption` so an interrupted Tool cannot escape the request fiber as an unhandled interruption; the timeout path then aborts the Tool context and returns structured `agent_failed` with `code: "tool_timeout"`. Ordinary execution failures remain `tool_failed`.
- Timeout failure closes the durable operation as `failed`, releases its budget reservation, emits the failure event, and does not persist success Evidence. Successful Tool execution and budget settlement remain unchanged.
- Added fixture coverage for both executor paths: the Tool observes the abort signal, timeout code/message are returned, operation status becomes `failed`, reservation release is called, and no Evidence is created.
- Added HTTP acceptance coverage using the registered `sleep` Tool: timeout returns HTTP 200 with `agent_failed/tool_timeout`, Task becomes `failed`, usage does not count a completed Tool call, and Evidence remains empty.
- Verification: `bun run typecheck` passed; `bun test test/super-agent --timeout 120000` — **37 pass, 0 fail, 114 expectations across 10 files**; `bun test test/server/httpapi-super-agent.test.ts --timeout 120000` — **7 pass, 0 fail, 44 expectations**; `bun test test/plugin --timeout 120000` — **301 pass, 1 skip, 0 fail, 842 expectations across 22 files**.
- This increment does not claim full Super-Agent completion. Still unverified: HTTP recovery with a real expired operation, automatic repair re-execution through Supervisor, executable plugin entry loading/adapters, child-agent delegation and child budgets, durable task mutation history/outbox replay, heartbeat/escalation policy, production external runtime protocols, full UI/Chromium golden path, crash/restart acceptance, performance/security gates, and SA-G1–SA-G12.

### SA-M4 child-agent delegation foundation (2026-11-15)

- Added `SuperAgentDelegationCoordinator` and exported it from the Super-Agent module. `call_agent` and `parallel_call_agents` now execute only through a registered `AgentRuntimeAdapter`; no child process or runtime is selected implicitly.
- Each child call reserves one durable `childAgents` budget unit, settles it only after a terminal completed event, and releases the reservation on adapter failure. Parallel calls use independent idempotency and reservation IDs.
- Adapter failures return structured `agent_failed` results. Parallel execution preserves per-child completed/failed outcomes in the failure message instead of discarding successful siblings.
- Added local-adapter acceptance tests for child budget settlement and two-child partial failure. `bun test test/super-agent/delegation.test.ts --timeout 120000` — **2 pass, 0 fail, 8 expectations**; `bun run typecheck` passed.
- This is a delegation boundary increment, not a claim of SA-M4 completion: runtime wiring into the Supervisor/HTTP execution path, persistent child Task Graph nodes, child cancellation/timeout policy, result aggregation into parent Tasks, conflict policy, and three-Agent Chromium acceptance remain pending.

### SA-M6 repair re-execution increment (2026-11-15)

- `builtinRepairStrategy` now preserves the source Task's executable input, including its declared Tool, while adding repair metadata. A generated repair Task can therefore be selected by the deterministic Supervisor instead of becoming a metadata-only dead end.
- Added `SuperAgentRepairCoordinator.execute`. It loads the persisted Run, selects the ready repair Task through `DeterministicSupervisor`, executes it through the supplied `SuperAgentExecutor`, persists the updated Task Graph, and emits `repair_task_executed`. Native executors continue to own operation, Evidence, and budget persistence.
- Added `POST /super-agent/runs/:runID/repair/execute`, which runs a persisted repair Task through the current Effect-native Tool/Permission boundary, persists its new Task status and Evidence, and emits `repair_task_executed`. The route keeps execution inside the request Effect fiber so scoped services are preserved.
- Added HTTP acceptance for failed verification → repair Task creation → repair Tool re-execution → new Evidence and succeeded repair Task. The HTTP Super-Agent suite now reports **7 pass, 0 fail, 48 expectations**; the complete Super-Agent suite remains **40 pass, 0 fail, 126 expectations across 11 files**; `bun run typecheck` passed.
- Added `builtin.artifact` verifier, which evaluates the latest non-test artifact evidence so a repair result can supersede an earlier failed artifact without pretending the old record never existed. `needs_review → verifying` is now an explicit repair-safe transition.
- `POST /super-agent/runs/:runID/repair/execute` now supports `verifyAfter`, `verifierID`, and `summary`. With `verifyAfter: true`, it executes the repair Tool, records fresh Evidence, runs the selected verifier, and transitions the Run to `completed` only through the normal completion guard.
- HTTP acceptance now covers failed verification → repair Task → Tool re-execution → fresh Evidence → artifact Verification → completed Run. The HTTP Super-Agent suite reports **8 pass, 0 fail, 54 expectations**; focused kernel verification/delegation tests report **6 pass, 0 fail, 20 expectations**; `bun run typecheck` passed.
- This closes the automatic repair Evidence → Verification → finish path for the tested artifact verifier. Still pending: retry/backoff policy, persisted task mutation history/outbox replay, test-verifier repair policy, and the Chromium repair path.

### SA-M8 Super-Agent panel product slice (2026-11-15)

- Expanded the built-in `session.panel` Surface at `packages/app/src/pages/session/super-agent-panel.tsx` with Run creation, Acceptance Criteria input, Tool-call budget input, Run detail loading, Task Graph status, Timeline events, Evidence/Verification counts, and lifecycle controls.
- The panel uses the existing HTTP API and workspace directory header; it does not invent client-side completion state. Details are reloaded from persisted Run, Graph, Event, Evidence, and Verification endpoints.
- Formatting validation passed with `bunx prettier --check src/pages/session/super-agent-panel.tsx`; App package typecheck also passed with `cd packages/app && bun run typecheck` after resolving the package's existing catch-message narrowing error in `src/components/settings-app-appearance.tsx`.
- This is the first UI product slice, not the Chromium gate: create/detail/lifecycle controls are implemented, while Approval UI, full graph editing, marketplace template flow, reconnect/reload assertions, backend restart, third-party Surface security, and the complete Chromium golden path remain pending.

### SA-M3 retry/backoff increment (2026-11-15)

- Added durable Task retry timing metadata (`retryAt`) and scheduler retry transitions. A retryable failed Task now moves through `failed → retrying → ready`, honors `backoffMs`, becomes selectable only once the retry time is reached, and refuses retries after `maxAttempts` or when the policy is non-retryable.
- Added scheduler acceptance coverage for delayed readiness and exhausted retry rejection. `bun test test/super-agent/scheduler.test.ts --timeout 120000` — **2 pass, 0 fail, 10 expectations**; `bun run typecheck` passed.
- `SuperAgentRuntime` now automatically schedules a retry after a retryable executor failure, keeps the Run running, emits `task_retry_scheduled`, and uses an attempt-scoped instruction/idempotency key so a retry is not incorrectly replayed as the original instruction.
- Runtime retry dispatch is covered by the execution-loop test. Persisted retry history and retry budget accounting remain pending.

### SA-M2 recovery HTTP acceptance increment (2026-11-15)

- Added an HTTP integration test that inserts a real expired `super_agent_operation` row for a persisted Run, invokes `POST /super-agent/runs/:runID/recover`, and verifies the operation becomes `unknown`, the Run becomes `needs_review`, and `reviewRequired` is true. Recovery does not retry the side effect.
- Final focused verification for this increment: `bun test test/server/httpapi-super-agent.test.ts --timeout 120000` — **8 pass, 0 fail, 52 expectations**; `bun run typecheck` passed.
- Crash/restart remains only partially covered: this validates durable expired-lease recovery through HTTP, not a process restart while a real external Tool/Agent process is executing, heartbeat expiry, or replay after backend reconnection.

### SA-M3 durable event outbox increment (2026-11-15)

- Added `super_agent_event_outbox` with migration `20261114000008_super_agent_outbox`.
- Every persisted Super-Agent event now enters the outbox in the same database transaction as the event append, including lifecycle events written through `transitionWithEvent`.
- Added durable `store.outbox(runID, limit)` and `store.ackOutbox(eventID)` APIs. Pending events survive process restart; acknowledgement records delivery attempts and removes acknowledged records from the pending cursor.
- Store acceptance verifies append → pending outbox → ack → pending cursor behavior. `bun test test/super-agent/store.test.ts --timeout 120000` — **9 pass, 0 fail, 40 expectations**; `bun run typecheck` passed.
- An external publisher/consumer, replay worker, and retry backoff for failed delivery remain pending.

### SA-M3 durable Task mutation history increment (2026-11-15)

- Added `super_agent_task_mutation` with migration `20261114000009_super_agent_task_mutation`.
- Every optimistic `updateGraph` now records changed/new Task nodes with graph version, Task ID, prior status, next status, before snapshot, after snapshot, and timestamp in the same transaction as the graph update.
- Added `store.taskMutations(runID, taskID?, limit)` for ordered history reads. This preserves prior Task snapshots instead of treating the latest Graph as the only state.
- Added `GET /super-agent/runs/:runID/task-mutations` and HTTP acceptance verifying a persisted Repair Task mutation can be queried after re-execution.
- Store acceptance verifies a graph update creates a mutation record and stale graph writers remain rejected. `bun test test/super-agent/store.test.ts --timeout 120000` — **9 pass, 0 fail, 42 expectations**; HTTP suite — **8 pass, 0 fail, 57 expectations**; `bun run typecheck` passed.
- Mutation history replay into a reconstructed Runtime, retention/compaction policy, external outbox publisher/consumer, and delivery retry policy remain pending.

### SA-M5 operation heartbeat increment (2026-11-15)

- Added durable `heartbeatOperation(operationID, leaseMs)` to extend a started operation lease without changing its status or replaying its side effect.
- Generic and Effect-native Tool executors now start a bounded heartbeat timer while a durable Tool operation is running and always clear it on success, failure, timeout, or cleanup.
- HTTP Tool execution accepts an optional `leaseMs`; expiry recovery can therefore distinguish a live heartbeating operation from an abandoned operation.
- Store acceptance covers heartbeat extension followed by expiry recovery at the extended lease. `bun test test/super-agent/store.test.ts --timeout 120000` — **9 pass, 0 fail, 44 expectations**; `bun run typecheck` passed.
- Worker heartbeat health reporting, missed-heartbeat escalation, external Runtime heartbeat protocol, and process-restart acceptance remain pending.

### SA-M3 / SA-M4 replay, outbox delivery, child graph, and UI acceptance increment (2026-11-15)

- Added `replayTaskMutations` validation and unit coverage for ordered graph versions, replacement snapshots, new Task insertion, graph validation failure, Task-ID mismatch, and final graph version. The persisted Store `get` path now replays ordered durable Task snapshots after loading a Run, so restart/reconnect reads exercise the replay path rather than exposing only the latest serialized graph.
- Added `SuperAgentOutboxWorker` with durable publisher/consumer/replay operations. Delivery success acknowledges the outbox record; failure persists diagnostic text, attempt count, and exponential `next_attempt_at` backoff. Migration `20261115000000_super_agent_outbox_delivery` adds retry metadata. A fresh worker can call `replay` after a process restart without losing pending events.
- Child delegation now attempts to persist a `child-agent` Task node linked by a `delegates_to` edge to the parent, updates the child Task on terminal success/failure, and settles the configured child budget slice. Existing adapter-owned lifecycle and disposal behavior remains unchanged; lightweight adapter tests without a durable Store continue to exercise only the runtime boundary.
- Super-Agent plugin contributions with an existing manifest `entry` are now safely resolved inside the plugin root, imported, validated against manifest ID/version, merged into the owner-scoped contribution registry, and disposed with the activation. Missing entry files retain declarative metadata compatibility; traversal and symlink escapes remain rejected by the root boundary.
- The built-in Super-Agent panel now reloads persisted approvals and Task mutation history and exposes approve/reject controls for pending human gates plus mutation-history visualization. App typecheck passes.
- Verification after this increment: backend `bun run typecheck` passed; Super-Agent `46 pass / 0 fail / 156 expectations` across 12 files; HTTP Super-Agent `8 pass / 0 fail / 57 expectations`; plugin suite `301 pass / 1 skip / 0 fail / 842 expectations`; App `bun run typecheck` passed.
- Still not claimed complete: full durable retry history/budget accounting, external heartbeat protocol and escalation, full child parent-result aggregation/conflict policy/HTTP production wiring, executable plugin adapters into kernel registries, graph editing/template marketplace flow, Chromium golden path, real backend/process crash restart, performance/resource/security gates, and SA-G1–SA-G12 evidence.

### SA-M3 / SA-M4 durable retry, heartbeat, child persistence, and graph editing increment (2026-11-15)

- `SuperAgentExecutionLoop` now accepts an optional durable Store. After each step it persists the kernel graph with optimistic versioning, restores the runtime from the persisted snapshot, and records `task_retry_scheduled` in the durable Event/Outbox when a retryable failure enters `ready` with `retryAt`. A restart can therefore reconstruct retry timing from the graph and event history.
- Added optional Agent Runtime heartbeat protocol. Local and Process adapters expose heartbeat checks; delegation sends bounded periodic heartbeats when timeout supervision is active and clears the timer on exit. Process heartbeat distinguishes a disposed handle from a dead process. A test-owned child-process crash test verifies `failed` terminal delivery and disposal.
- Child delegation now has a real Store-backed acceptance: child Task creation, `delegates_to` linkage, terminal output/status mutation, durable mutation records, child budget settlement, and adapter disposal all pass.
- Hardened native Tool permission denial cleanup: denied operations now stop heartbeat timers, resolve the operation as failed, release the budget reservation, and append a failure event instead of leaking an active lease.
- The panel now includes an optimistic-versioned JSON Task Graph editor with persisted reload, plus the Approval and mutation-history surfaces described above.
- Current focused results: Super-Agent `48 pass / 0 fail / 164 expectations`; HTTP `8 pass / 0 fail / 57 expectations`; plugin `302 pass / 1 skip / 0 fail / 845 expectations`; backend and App typechecks pass; App unit suite is currently blocked by an unrelated existing `file-preview-binary-content.test.ts` source-string expectation mismatch. The attempted complete NovaWay test run reached `httpapi-sdk.test.ts` and remained active beyond 600 seconds; only the test-owned process tree was terminated, and no existing application/development service was restarted.
- Remaining release gates are unchanged: real isolated Chromium golden path and backend restart, external process crash/recovery with durable operation replay, full heartbeat escalation diagnostics, complete child parent aggregation/conflict/HTTP wiring, executable adapters into kernel registries, marketplace templates, performance/resource/security measurements, full root/App/HTTP regression, and SA-G1–SA-G12 evidence.

### Verification correction (2026-11-15, current worktree)

- Final focused rerun after durable retry, child persistence, plugin executable loading, heartbeat escalation, and graph editor changes: `bun run typecheck` passed; `bun test test/super-agent --timeout 120000` **49 pass / 0 fail / 168 expectations across 12 files**; `bun test test/server/httpapi-super-agent.test.ts --timeout 120000` **8 pass / 0 fail / 57 expectations**; `bun test test/plugin --timeout 120000` **302 pass / 1 skip / 0 fail / 845 expectations across 22 files**; `cd packages/app && bun run typecheck` passed.
- The application unit run is not accepted as green: `bun test --preload ./happydom.ts ./src` stops at the existing source-contract mismatch in `src/pages/session/file-preview-binary-content.test.ts`, where the test still requires the old `file-tabs.tsx` guard string `!p || file.isExternal(p) || !platform.openInEditor || !server.isLocal() || !connection`, while the current uncommitted application source uses the refactored `openWithApp` guard. This unrelated application change was not overwritten.
- The complete NovaWay `bun test --timeout 120000` run did not produce a terminal summary within 600 seconds and remained in HTTP API tests; the test-owned Bun process tree was explicitly terminated after the timeout. Focused Super-Agent/HTTP/plugin suites remain green. SA-G9 therefore remains open.

### App regression correction (2026-11-15)

- The application source-contract test was stale relative to the already-modified `file-tabs.tsx` editor guard (`openWithApp` now uses `absolute`/`appId` and the external-file branch is `if (file.isExternal(p))`). The test was updated to assert the current behavior without changing the application implementation.
- Complete App unit verification now passes: `bun test --preload ./happydom.ts ./src` — **1226 pass / 0 fail / 5123 expectations across 169 files**. App typecheck remains passed.
- This correction removes the App unit blocker; the complete NovaWay backend suite still needs a non-hanging terminal rerun, and Chromium/backend restart/performance/security/manual gates remain open.

### Isolated Chromium attempt (2026-11-15)

- Started a test-owned NovaWay backend on `127.0.0.1:4199` and Playwright/Vite UI on `127.0.0.1:3321`; no existing application process was restarted or reused. After the run, the backend PID tree was terminated and port 4199 had no LISTENING socket (only normal TCP `TIME_WAIT` entries remained).
- Existing `e2e/plugin-ui-budget.spec.ts` ran in Chromium with 2 tests and both failed before assertions because the fresh isolated workspace did not expose the expected `NovaWay Home` plugin rail item within 20 seconds. This is a precise environment/product blocker for that existing plugin E2E, not Super-Agent acceptance; no Super-Agent Chromium golden path has passed.

### Root regression Office raster concurrency correction (2026-11-15)

- The five Office PNG failures were isolated to concurrent native rasterization pressure rather than Super-Agent behavior. `src/office/raster.ts` now serializes the native `pdf.js`/`@napi-rs/canvas` raster critical section while retaining parallelism for unrelated tests.
- The Office-containing shard was rerun after the lock: **1129 pass / 8 skip / 0 fail / 3169 expectations across 118 files**. The two other completed shards remained green: **1350 pass / 13 skip / 1 todo / 0 fail / 7408 expectations across 117 files** and **816 pass / 6 skip / 0 fail / 16 snapshots / 2458 expectations across 117 files**.
- A further shard containing many HTTP instance tests still stopped producing output at `test/server/httpapi-event.test.ts` under the repository's concurrent test harness and was terminated as a test-owned process. The Office timeout failure itself is corrected, but the complete root run still lacks one stable terminal green result; SA-G9 remains open.

### Activated-plugin parallel Agent Chromium acceptance increment (2026-11-15)

- Added a test-owned project plugin fixture under a temporary workspace. The fixture declares an executable Agent Runtime contribution, and its entry module implements the real adapter boundary (`discover`, `start`, async `events`, cancellation, disposal).
- Chromium discovers the plugin through the real `/plugin` API, enables it through `PATCH /plugin/:id`, creates a Super-Agent Run, invokes the real `POST /super-agent/runs/:runID/delegate` boundary with two parallel child calls, and verifies one child succeeds while the sibling fails. Child Tasks and their terminal states are read from the persisted Run graph. The test then disables the plugin through the real plugin API and verifies a subsequent delegation attempt is blocked because the runtime contribution has been disposed.
- Isolated run: test-owned backend `127.0.0.1:4199`, Vite UI `127.0.0.1:3323`, isolated SQLite, Chromium, one worker: **1 passed / 39.4s**. Backend descendants were stopped afterward, ports were confirmed free, and temporary plugin workspaces were removed after backend shutdown.
- This closes the previously missing activated-plugin parallel/partial-failure/disable Chromium slice. It does not close parent-result aggregation policy, remote runtime protocol, outbox host service, watchdog health policy, performance/security gates, root regression stability, or manual release evidence.

### HTTP child-agent delegation boundary increment (2026-11-15)

- Added `POST /super-agent/runs/:runID/delegate` with typed single-agent and parallel-agent payloads. It resolves executable plugin Agent Runtime adapters through the kernel bridge, uses `SuperAgentDelegationCoordinator`, persists child Tasks and `delegates_to` edges, settles the parent Task, records `agent_delegation_completed`, and preserves partial-failure results as a failed parent result.
- Backend typecheck passed and the existing HTTP Super-Agent suite remains **8 pass / 0 fail / 57 expectations**. The Store-backed kernel delegation suite covers successful child persistence, parallel partial failure, budget settlement, and heartbeat failure diagnostics.
- The full production HTTP acceptance with an activated executable third-party Agent Runtime is still pending; current HTTP tests do not yet activate a real plugin runtime contribution before calling this endpoint. Parent-result aggregation/conflict policy and UI delegation controls also remain open.

### Latest focused evidence after Chromium/recovery increments (2026-11-15)

- `bun run typecheck`: passed.
- `bun test test/super-agent --timeout 120000`: **51 pass / 0 fail / 177 expectations across 12 files**.
- `bun test test/server/httpapi-super-agent.test.ts --timeout 120000`: **8 pass / 0 fail / 57 expectations**.
- `bun test test/server/httpapi-super-agent-restart.test.ts --timeout 120000`: **1 pass / 0 fail / 10 expectations**; backend child process and temporary database were cleaned up.
- `bun test test/plugin --timeout 120000`: **302 pass / 1 skip / 0 fail / 845 expectations across 22 files**.
- Isolated Chromium combined lifecycle/approval, offline reconnect, and repair completion: **3 pass / 55.0s** on test-owned 4199/3321 processes; browser backend restart: **1 pass / 1.0m** on test-owned 4198/3322 processes. All test-owned listeners were released after each run.
- `test/office/document-export.test.ts` by itself passes **14 pass / 0 fail / 49 expectations / 5.40s**; the earlier four-shard root run still had five concurrent Office PNG timeouts, so SA-G9 is not declared green.
- A fresh `bun test test --max-concurrency 1 --timeout 120000` attempt did not reach a terminal summary: it stopped producing output in `test/control-plane/workspace.test.ts` after the instance-disposal log. The test-owned Bun process tree was terminated; no application/development service was touched. SA-G9 remains open, with the prior four-shard evidence (five concurrent Office PNG timeouts) still the precise root-regression result.
- No SA-G1–SA-G12 gate is marked complete by this record. Full parallel-agent Chromium golden path, plugin disable behavior, production external Agent Runtime execution, outbox host service, watchdog health/escalation, performance/security measurements, root regression stability, and required human evidence remain open.

- Added `packages/app/e2e/super-agent-panel.spec.ts` covering a real browser path: open the built-in Super-Agent panel, create a Goal with Acceptance Criteria, reload persisted Run detail, Start, Pause, Resume, and verify the panel reloads after page refresh.
- Ran it with a test-owned backend on `127.0.0.1:4199`, Playwright/Vite on `127.0.0.1:3321`, Chromium, one worker, and no existing-server reuse. Result: **1 passed** in 27.7s. The backend and all test-owned descendants were stopped afterward; port 4199 had no LISTENING socket.
- The first attempt used an isolated backend password while the UI had no credential configured and correctly failed with HTTP 401; that test-owned backend was stopped. The successful rerun intentionally used an isolated unauthenticated backend only on loopback.
- This proves the panel lifecycle slice, not the full golden path: parallel Agents, approval interaction, failed execution → repair → Evidence/Verification → completed, disconnect/reconnect, backend restart, plugin disable, and Chromium resource/performance/security gates remain open.

### Root regression shard evidence (2026-11-15)

- App unit regression is green: **1226 pass / 0 fail / 5123 expectations across 169 files**; App typecheck passes.
- NovaWay regression was executed as four test-owned shards with bounded concurrency. Shards 1, 3, and 4 completed green: shard 1 **1021 pass / 7 skip / 0 fail / 3184 expectations across 119 files**; shard 3 **1394 pass / 5 skip / 1 todo / 0 fail / 7424 expectations across 118 files**; shard 4 **1127 pass / 9 skip / 0 fail / 16 snapshots / 2904 expectations across 118 files**.
- Shard 2 completed with **1121 pass / 29 skip / 5 fail / 3313 expectations across 118 files**; all five failures were the pre-existing Office PNG export tests in `test/office/document-export.test.ts`, each timing out at 120 seconds. No Super-Agent, plugin, or HTTP focused test failed. SA-G9 remains not fully green because of these unrelated Office timeouts.

- Final combined isolated browser rerun (three tests, one worker) covered lifecycle + approval, offline/reconnect, and failed-verification → repair → fresh Evidence/Verification → completed with reload assertions: **3 passed / 55.0s**. The test-owned backend on 4199 and Vite UI on 3321 were terminated afterward and no LISTENING sockets remained.

### Heartbeat diagnostics increment (2026-11-15)

- Child delegation now emits a durable `child_agent_heartbeat_failed` event with parent Task ID, child Task ID, and diagnostic message when the optional adapter heartbeat rejects. The child still transitions to failed, is cancelled/disposed, and its reserved child budget is released.
- Added a Store-backed acceptance with an adapter-owned heartbeat failure. Result: **6 pass / 0 fail / 22 expectations** in `test/super-agent/delegation.test.ts`; complete Super-Agent suite after this change: **51 pass / 0 fail / 177 expectations across 12 files**.
- This is diagnostic/escalation foundation, not a complete production watchdog: missed-heartbeat counters, health dashboards, configurable escalation policy, and host-level monitoring remain open.

### Executable Super-Agent plugin contribution bridge increment (2026-11-15)

- Added `bindExecutableSuperAgentContributions`, which converts executable plugin entry exports into kernel `AgentRuntimeRegistry`, `VerifierRegistry`, and `RepairStrategyRegistry` bindings while leaving manifest-only declarations declarative and safely undispatched. The bindings are disposable and are created inside an HTTP request context, avoiding access to the per-instance plugin host before `InstanceRef` exists.
- HTTP Repair creation/execution and Verify-and-Finish now include executable plugin repair strategies and verifiers alongside the built-in strategies/verifiers. The HTTP route remains policy/state-machine controlled; plugin declarations cannot bypass the kernel registries.
- Added registry acceptance for executable runtime, verifier, and repair contribution binding and disposal. Verification: backend `bun run typecheck` passed; Super-Agent suite **50 pass / 0 fail / 175 expectations across 12 files**; HTTP Super-Agent suite **8 pass / 0 fail / 57 expectations**; plugin suite previously **302 pass / 1 skip / 0 fail / 845 expectations**.
- This closes only the executable Verifier/Repair HTTP bridge. A production AgentRuntime execution endpoint, parent-result aggregation/conflict policy, external outbox publisher service, heartbeat watchdog diagnostics, and full marketplace/plugin-disable golden path remain unverified.

### Chromium repair, reconnect, and backend-restart acceptance increment (2026-11-15)

- Expanded `packages/app/e2e/super-agent-panel.spec.ts` with a real Chromium Repair path. The browser creates a persisted Run, drives the Run through failed Evidence and failed `builtin.test` Verification, transitions to `needs_review`, creates a durable Repair Task, executes the repair through the HTTP boundary, records fresh artifact Evidence, verifies with `builtin.artifact`, and reaches `completed`. The test then reloads the panel and asserts the persisted completed status, Evidence count, Verification outcomes, and Task mutation history.
- The repair test passed with a test-owned backend on `127.0.0.1:4199`, isolated SQLite, Playwright/Vite on `127.0.0.1:3321`, and Chromium: **1 passed / 26.5s**. The backend and descendants were stopped afterward; no 4199/3321 LISTENING sockets remained.
- Added a browser offline/reconnect test. It creates and opens a persisted Run, toggles the browser context offline, attempts a refresh, restores connectivity, refreshes again, and verifies the durable Run detail is available. Isolated Chromium result: **1 passed / 27.1s**; test-owned backend and UI were stopped afterward.
- Added a browser-level backend restart test that starts and owns a Bun backend child process on `127.0.0.1:4198`, uses a temporary SQLite database, persists a Graph mutation, stops the backend process tree, starts the same backend/database again, reloads the Chromium page, and verifies the graph title, graph version, and mutation history. Isolated Chromium result: **1 passed / 1.0m**; the test now uses Windows process-tree cleanup and removes its temporary database. No 4198/3322 LISTENING sockets remained.
- The existing Chromium lifecycle/approval test remains separately verified. These increments close the browser repair, transient reconnect, and backend restart slices, but do **not** close the full golden path: parallel Agents with one failure, plugin disable/recovery, production child-agent HTTP/Supervisor wiring, executable contribution adapters, outbox host publisher wiring, heartbeat diagnostics/watchdog, performance/security/manual evidence, root Office PNG timeout failures, or SA-G1–SA-G12.

### Final focused rerun after outbox idempotency hardening (2026-11-15)

- Backend `bun run typecheck` passed.
- `bun test test/super-agent --timeout 120000`: **49 pass / 0 fail / 169 expectations across 12 files**.
- `bun test test/server/httpapi-super-agent.test.ts --timeout 120000`: **8 pass / 0 fail / 57 expectations**.
- `bun test test/plugin --timeout 120000`: **302 pass / 1 skip / 0 fail / 845 expectations across 22 files**.
- `cd packages/app && bun run typecheck` passed; complete App unit suite remains **1226 pass / 0 fail / 5123 expectations across 169 files**.
- Outbox acknowledgement is idempotent: repeated ack returns the existing acknowledged record without incrementing attempts.

### SA-M4 / SA-M5 / SA-G10–SA-G11 deterministic aggregation, watchdog, host delivery, and release-gate increment (2026-11-15)

- Added `aggregateDelegationOutcomes` in `packages/novaway/src/super-agent/delegation.ts`. Parent results now retain every child outcome, classify mixed outcomes as `child_agent_partial_failure`, classify divergent successful outputs as `child_agent_conflict`, and do not silently select one conflicting child result. The HTTP handler settles a conflict parent task as `needs_review`.
- Added `SuperAgentOutboxHost` in `packages/novaway/src/super-agent/outbox.ts`. It owns a single start/stop timer, discovers all durable runs through `store.listAll()`, drains the durable outbox through the existing retry/ack worker, and is safe against overlapping drains. Added `listAll` to the store contract and implementation.
- Added `SuperAgentWatchdog` and `SuperAgentWatchdogHost` in `packages/novaway/src/super-agent/watchdog.ts`. Heartbeat misses are counted, durably emitted with count/escalation fields, repeated misses escalate the Run to `needs_review`, expired operation leases emit `operation_lease_expired`, and host start/stop owns and releases its timer. Delegation accepts the watchdog boundary.
- Added `packages/novaway/src/super-agent/security.ts`: runtime namespace allowlisting, command injection/path traversal rejection, external URL protocol/credential/private-network checks, and explicit approval capability policy. HTTP delegation passes the activated runtime namespace allowlist into the coordinator.
- Added regression tests in `test/super-agent/watchdog.test.ts` and `test/super-agent/security.test.ts`; updated delegation tests for durable outcome aggregation; added `test/super-agent/performance.test.ts`. Focused results: `bun run typecheck` passed; `bun test test/super-agent --timeout 120000` — **59 pass / 0 fail / 211 expectations across 15 files**. Performance gate sample: create p95 1.23ms, state query p95 2.08ms, event append p95 1.25ms, 1000-event replay 661.09ms; all below the documented budgets. Security tests passed.
- `test/server/httpapi-super-agent-restart.test.ts` now reserves an ephemeral test-owned port instead of fixed `4198`, removing concurrent root-suite port collision risk. Isolated result: **1 pass / 0 fail / 10 expectations**; the test-owned backend processes exited.
- This increment does not mark SA-G10 or SA-G11 complete yet: performance evidence still needs pause/cancel, scheduler overhead, bounded parallelism, and leak checks; security still needs the complete permission/secret/SSRF/command/namespace/approval integration matrix; the host classes still require production host wiring and external consumer evidence. SA-G9 full root regression is currently running and remains open until a terminal green summary is obtained. SA-G12 manual release evidence remains open.
- No existing application/development service was restarted; only test-owned processes were used. No `git commit` was executed.

### Root-equivalent regression and complete Super-Agent Chromium evidence (2026-11-16)

- The originally attempted single root command `bun test test --timeout 120000` did not produce a terminal summary and was stopped as a test-owned process after it stalled during the subprocess-backed HTTP restart portion. This remains recorded as a failed harness attempt, not as green evidence.
- A stable equivalent complete backend regression was then run as four disjoint Bun shards over **476 test files**, excluding only `test/server/httpapi-super-agent-restart.test.ts`, which was run separately with its own ephemeral port. All four shard processes returned zero: **1327 pass / 12 skip / 1 todo / 0 fail / 4337 expectations across 119 files**; **1071 pass / 5 skip / 0 fail / 6048 expectations across 119 files**; **1141 pass / 8 skip / 0 fail / 3386 expectations across 119 files**; **1136 pass / 25 skip / 0 fail / 3086 expectations across 119 files**. Aggregate shard runner result: `ROOT_EQUIVALENT_SHARDS 476 [0, 0, 0, 0]`.
- The excluded backend restart acceptance was rerun separately after changing its test-owned port allocation to an ephemeral port: **1 pass / 0 fail / 10 expectations**. No existing service was touched.
- Complete isolated Playwright Chromium run of `packages/app/e2e/super-agent-panel.spec.ts` with test-owned backend `127.0.0.1:4199`, Vite `127.0.0.1:3323`, isolated SQLite, and one worker: **5 passed / 0 failed / 1.8m**. It covers lifecycle/approval, offline/reconnect, activated executable plugin parallel Agent partial failure plus disable, backend restart/reload, and failed verification → repair → Evidence/Verification → completed. The backend process tree was stopped afterward; no 4199 LISTENING socket remained (only expected TIME_WAIT connections).
- The four-shard result plus separate restart test closes the previously missing stable root-equivalent terminal summary for this environment. The final focused release record also includes NovaWay typecheck, Super-Agent suite, HTTP Super-Agent acceptance (**8 pass / 0 fail / 57 expectations**), plugin regression (**302 pass / 1 skip / 0 fail / 845 expectations**), App typecheck, and App unit regression (**1226 pass / 0 fail / 5123 expectations across 169 files**). SA-G10, SA-G11, and SA-G12 remain open pending the remaining integrated resource/security matrix and required human evidence.

### Scheduler-boundary and corrected performance evidence (2026-11-16)

- Hardened `LocalAgentRuntimeAdapter` and `ProcessAgentRuntimeAdapter` session IDs with a monotonic sequence suffix. Parallel starts in the same millisecond can no longer overwrite a sibling session and leave its event collector waiting forever.
- Bounded `SuperAgentDelegationCoordinator.parallel` to batches of at most eight calls by default, with a policy/input limit capped at eight; HTTP delegation derives the configured limit from child/run budget. Added a test proving a seven-call delegation configured at two never exceeds two active children.
- Corrected the performance benchmark so 1000-event replay timing measures only the replay query, not event creation. Latest focused result: **60 pass / 0 fail / 215 expectations across 15 Super-Agent files**; performance output: create p95 1.50ms, state query p95 2.54ms, event append p95 1.30ms, replay 1000 events 6.93ms, pause/cancel p95 10.24ms, scheduler overhead p95 0.06ms.
- This closes the bounded parallelism and corrected replay measurement implementation slices, but SA-G10 still requires a host-level leak scan in the final release matrix. SA-G9 remains represented by the stable four-shard result plus isolated restart acceptance; SA-G12 manual evidence remains open.
- The security utility now also provides resolved-DNS private-network rejection (`assertExternalURLResolved`); focused security tests remain green. The complete integrated permission/secret/SSRF/command/namespace/approval matrix is still not claimed complete.

### Production instance host integration (2026-11-16)

- Added `packages/novaway/src/super-agent/host-service.ts` and wired `ensureSuperAgentHost` into the Super-Agent HTTP handler path. The first request for an instance starts one directory-scoped outbox publisher and one watchdog worker; subsequent requests reuse them. The outbox publisher emits the typed `super-agent.outbox.published` Bus event, and `registerDisposer` stops both workers when the instance is disposed.
- Host workers are directory-scoped, so an instance cannot publish or watchdog another workspace's Run. Outbox and watchdog host options now support directory filtering.
- Added `test/super-agent/host-service.test.ts`: one host per instance, both workers active, instance disposal stops both timers and removes the registry entry. Result: **1 pass / 0 fail / 7 expectations**. HTTP Super-Agent acceptance remains **8 pass / 0 fail / 57 expectations**; full Super-Agent suite is **61 pass / 0 fail / 224 expectations across 16 files**.
- This closes the production host lifecycle implementation slice, but external Bus consumer delivery, retry/replay acceptance across a real backend restart, and the final host-level active-handle/listener leak scan still require release evidence. SA-G10 and SA-G12 remain open.

### Post-host integration regression attempt (2026-11-16)

- Final isolated Chromium rerun after production host wiring remained green: **5 passed / 0 failed / 2.4m** with backend `4199`, Vite `3323`, isolated SQLite, and one worker. Test-owned backend was stopped and the listener was released.
- The post-host four-shard root-equivalent rerun was not accepted as green: one four-shard attempt hit a Bun 1.3.14 Windows segmentation fault after approximately 181 seconds under the 4-process / high-memory harness; a lower-memory two-shard retry produced **2357 pass / 13 skip / 1 todo / 123 fail / 20 errors across 239 files**, with repeated Bun `BuildMessage: Invalid assignment target` failures in unrelated existing plugin/instance bootstrap paths and loop timeouts. These test-owned processes were stopped. The previously stable pre-host four-shard result remains evidence for the unchanged backend baseline, while the post-host full-regression rerun remains an environment/harness blocker rather than green evidence.
- Focused code verification after the failed harness was clean: `bun run typecheck` passed; resolved-DNS security tests passed **3 / 0 / 16 expectations**; Super-Agent suite remained **61 pass / 0 fail / 224 expectations across 16 files**; HTTP Super-Agent and backend restart acceptance remained green.

### Stable post-host complete backend regression (2026-11-16)

- Re-ran the complete backend regression after production host integration using four disjoint shards, each with an isolated `BUN_RUNTIME_TRANSPILER_CACHE_PATH` and `--max-concurrency 8`. This avoided the Bun 1.3.14 Windows transpiler-cache corruption and high-memory segmentation fault seen in the earlier shared-cache harness.
- All **478** test-file assignments returned zero: shard 0 **1015 pass / 6 skip / 0 fail / 16 snapshots / 5748 expectations across 120 files**; shard 1 **1110 pass / 7 skip / 0 fail / 3244 expectations across 120 files**; shard 2 **1109 pass / 23 skip / 0 fail / 2990 expectations across 119 files**; shard 3 **1449 pass / 14 skip / 1 todo / 0 fail / 4907 expectations across 119 files**. Aggregate result: `ROOT_UNIQUE_CACHE_SHARDS 478 [0, 0, 0, 0]`.
- The earlier failed shared-cache and lower-memory attempts remain recorded as non-green harness attempts; the isolated-cache result is the accepted post-host root-equivalent evidence. The separately run ephemeral-port backend restart test and final Chromium suite are also green.

### Integrated security and resource gate evidence (2026-11-16)

- Security regression matrix passed: permission suites, command semantics, webfetch SSRF behavior, plugin runtime secrets, HTTP plugin boundary, and Super-Agent security policy were executed together. Result: **177 pass / 0 fail / 548 expectations across 10 files**.
- The resource gate now has deterministic evidence for bounded parallel Agent execution, pause/cancel p95, scheduler overhead, outbox/watchdog host disposal, directory isolation, active worker diagnostics, Process Agent disposal, and plugin contribution disposal. No test-owned Bun process or configured test port remained after the run.
- The technical SA-G10 and SA-G11 implementation/evidence slices are now present. The recorded automated leak-scan artifact is `docs/super-agent-resource-leak-evidence-2026-11-16.json`; human release sign-off is still required before those gates can be marked fully passed.

### External outbox consumer delivery increment (2026-11-16)

- Added `createSuperAgentExternalPublisher` in `packages/novaway/src/super-agent/external-publisher.ts`. It delivers each durable outbox event to an external HTTP consumer with `eventID`, `runID`, `sequence`, event type and payload, and sends the event ID as both `idempotency-key` and `x-novaway-event-id`.
- A delivery is successful only after the external consumer returns a 2xx response. Non-2xx responses become durable outbox failures and preserve retry metadata; a fresh worker can replay the pending event after a simulated backend/worker restart.
- `ensureSuperAgentHost` now accepts an external publisher boundary and supports the deployment configuration `NOVAWAY_SUPER_AGENT_OUTBOX_ENDPOINT`. HTTP and private-network exceptions require explicit `NOVAWAY_SUPER_AGENT_OUTBOX_ALLOW_HTTP=1` and `NOVAWAY_SUPER_AGENT_OUTBOX_ALLOW_PRIVATE_NETWORK=1`, preserving the default HTTPS/private-network security policy.
- Added `test/super-agent/external-publisher.test.ts` with a test-owned external HTTP consumer. The consumer intentionally returns **503** on the first delivery, receives the same event ID again after a fresh outbox worker replay, returns **204**, and the durable outbox is then acknowledged and empty. Result: **1 pass / 0 fail / 9 expectations**.
- Full Super-Agent focused suite after this increment: **62 pass / 0 fail / 233 expectations across 17 files**; backend typecheck passes. This is external HTTP consumer delivery/retry/replay evidence, not a claim that SA-G12 human signatures or an independently operated production deployment have been completed.
