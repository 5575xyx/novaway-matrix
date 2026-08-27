import type { NovawayClient } from "@novaway/sdk-v2-latest/v2"

// checkpoint / goal / workflow 这几个后端组已在服务端注册,但生成的类型化 SDK
// 尚未包含它们的方法。NovawayClient 本身没有通用的 get/post/patch/delete——
// 这些低层方法位于内部 hey-api 客户端 (_client) 上,以 { url, body } 调用,
// 返回 { data, error }。这里取出该客户端直连这些路由。
type RawClient = {
  get: (opts: { url: string }) => Promise<{ data?: unknown; error?: unknown }>
  post: (opts: { url: string; body?: unknown }) => Promise<{ data?: unknown; error?: unknown }>
  patch: (opts: { url: string; body?: unknown }) => Promise<{ data?: unknown; error?: unknown }>
  delete: (opts: { url: string }) => Promise<{ data?: unknown; error?: unknown }>
}

function raw(client: NovawayClient): RawClient {
  return (client as any)._client
}

// ---- 检查点 ----
export type CheckpointItem = {
  id: string
  sessionId: string
  name: string
  reason?: string
  tags: string[]
  createdAt: string
  updatedAt: string
}

export const checkpointApi = {
  async list(client: NovawayClient, sessionID: string): Promise<CheckpointItem[]> {
    const res = await raw(client).get({ url: `/session/${sessionID}/checkpoints` })
    if (res.error) return []
    return (res.data as CheckpointItem[]) ?? []
  },
  async create(client: NovawayClient, sessionID: string, name: string, reason?: string): Promise<boolean> {
    const res = await raw(client).post({ url: `/session/${sessionID}/checkpoints`, body: { name, reason } })
    return !res.error
  },
  async restore(client: NovawayClient, checkpointID: string): Promise<boolean> {
    const res = await raw(client).post({ url: `/checkpoints/${checkpointID}/restore` })
    return !res.error
  },
  async remove(client: NovawayClient, checkpointID: string): Promise<boolean> {
    const res = await raw(client).delete({ url: `/checkpoints/${checkpointID}` })
    return !res.error
  },
}

// ---- 目标 ----
export type GoalStatus = "pending" | "in_progress" | "completed" | "cancelled"
export type GoalItem = {
  id: string
  title: string
  description?: string
  status: GoalStatus
  priority: "high" | "medium" | "low"
  progress: number
  tags: string[]
  createdAt: string
}

export const goalApi = {
  async list(client: NovawayClient, sessionID: string): Promise<GoalItem[]> {
    const res = await raw(client).get({ url: `/session/${sessionID}/goals` })
    if (res.error) return []
    return (res.data as GoalItem[]) ?? []
  },
  async create(client: NovawayClient, sessionID: string, title: string, priority: "high" | "medium" | "low" = "medium"): Promise<boolean> {
    const res = await raw(client).post({ url: `/session/${sessionID}/goals`, body: { title, priority } })
    return !res.error
  },
  async updateStatus(client: NovawayClient, goalID: string, status: GoalStatus): Promise<boolean> {
    const res = await raw(client).patch({ url: `/goals/${goalID}`, body: { status } })
    return !res.error
  },
}

// ---- 工作流(执行引擎已接活:start 触发真实多步子代理编排,UI 轮询 run 状态)----
export type WorkflowStatus = "draft" | "running" | "paused" | "completed" | "failed"
export type WorkflowRunStatus = "pending" | "running" | "completed" | "failed"
export type WorkflowState = {
  currentStep: string
  completedSteps: string[]
  outputs: Record<string, unknown>
  startedAt?: string
  completedAt?: string
}
export type WorkflowItem = {
  id: string
  name: string
  description?: string
  status: WorkflowStatus
  steps: Array<{ id: string; name: string; type: string }>
  state?: WorkflowState | null
  createdAt: string
}
export type WorkflowRunItem = {
  id: string
  workflowId: string
  sessionId: string
  status: WorkflowRunStatus
  state?: WorkflowState | null
  error?: string
  startedAt?: string
  completedAt?: string
  createdAt: string
}
export type WorkflowTemplateItem = {
  id: string
  name: string
  description: string
  steps: number
}

export const workflowApi = {
  async list(client: NovawayClient, sessionID: string): Promise<WorkflowItem[]> {
    const res = await raw(client).get({ url: `/session/${sessionID}/workflows` })
    if (res.error) return []
    return (res.data as WorkflowItem[]) ?? []
  },
  async create(client: NovawayClient, sessionID: string, name: string): Promise<boolean> {
    const res = await raw(client).post({ url: `/session/${sessionID}/workflows`, body: { name, steps: [] } })
    return !res.error
  },
  async listTemplates(client: NovawayClient): Promise<WorkflowTemplateItem[]> {
    const res = await raw(client).get({ url: `/workflow-templates` })
    if (res.error) return []
    return (res.data as WorkflowTemplateItem[]) ?? []
  },
  async createFromTemplate(client: NovawayClient, sessionID: string, template: string, name?: string): Promise<boolean> {
    const res = await raw(client).post({
      url: `/session/${sessionID}/workflows/from-template`,
      body: { template, ...(name ? { name } : {}) },
    })
    return !res.error
  },
  async listRuns(client: NovawayClient, workflowID: string): Promise<WorkflowRunItem[]> {
    const res = await raw(client).get({ url: `/workflows/${workflowID}/runs` })
    if (res.error) return []
    return (res.data as WorkflowRunItem[]) ?? []
  },
  async start(client: NovawayClient, workflowID: string): Promise<boolean> {
    const res = await raw(client).post({ url: `/workflows/${workflowID}/start` })
    return !res.error
  },
  async remove(client: NovawayClient, workflowID: string): Promise<boolean> {
    const res = await raw(client).delete({ url: `/workflows/${workflowID}` })
    return !res.error
  },
}

// ---- 编排(多代理协调:按依赖拓扑并发派生子代理,结果在任务间传递)----
export type OrchestratorPlanStatus = "draft" | "running" | "completed" | "failed"
export type OrchestratorTaskStatus = "pending" | "running" | "completed" | "failed"
export type OrchestratorTaskItem = {
  id: string
  name: string
  type: "agent" | "tool" | "skill"
  config: Record<string, unknown>
  dependencies: string[]
  status: OrchestratorTaskStatus
  result?: unknown
  error?: string
}
export type OrchestratorPlanItem = {
  id: string
  sessionId: string
  name: string
  tasks: OrchestratorTaskItem[]
  status: OrchestratorPlanStatus
  error?: string
  createdAt: string
  updatedAt: string
}

export const orchestratorApi = {
  async list(client: NovawayClient, sessionID: string): Promise<OrchestratorPlanItem[]> {
    const res = await raw(client).get({ url: `/session/${sessionID}/orchestrator/plans` })
    if (res.error) return []
    return (res.data as OrchestratorPlanItem[]) ?? []
  },
  async get(client: NovawayClient, planID: string): Promise<OrchestratorPlanItem | undefined> {
    const res = await raw(client).get({ url: `/orchestrator/plans/${planID}` })
    if (res.error) return undefined
    return res.data as OrchestratorPlanItem
  },
  async create(
    client: NovawayClient,
    sessionID: string,
    name: string,
    tasks: Array<Pick<OrchestratorTaskItem, "name" | "type" | "config" | "dependencies">>,
  ): Promise<boolean> {
    const res = await raw(client).post({
      url: `/session/${sessionID}/orchestrator/plans`,
      body: { name, tasks },
    })
    return !res.error
  },
  async execute(client: NovawayClient, planID: string): Promise<boolean> {
    const res = await raw(client).post({ url: `/orchestrator/plans/${planID}/execute` })
    return !res.error
  },
  async remove(client: NovawayClient, planID: string): Promise<boolean> {
    const res = await raw(client).delete({ url: `/orchestrator/plans/${planID}` })
    return !res.error
  },
}
