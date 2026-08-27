import type { NovawayClient } from "@novaway/sdk-v2-latest/v2"

// NovawayClient 是生成的类型化包装类，本身没有通用的 get/post 方法——
// 这些低层方法位于内部的 hey-api 客户端 (_client) 上。这里取出该客户端，
// 以 { url, body } 形式调用后端已注册但尚未生成类型的路由。
function raw(client: NovawayClient): {
  get: (opts: { url: string }) => Promise<{ data?: unknown; error?: unknown }>
  post: (opts: { url: string; body?: unknown; headers?: Record<string, string> }) => Promise<{ data?: unknown; error?: unknown }>
} {
  return (client as any)._client
}

// 记忆相关类型
export type MemoryReviewStatus = {
  pending: number
  applied: number
  dismissed: number
  total: number
  latest?: number
  source: {
    all: number
    explicit: number
    background: number
    compaction: number
    "session-end": number
  }
  sourceByStatus: {
    pending: { all: number; explicit: number; background: number; compaction: number; "session-end": number }
    applied: { all: number; explicit: number; background: number; compaction: number; "session-end": number }
    dismissed: { all: number; explicit: number; background: number; compaction: number; "session-end": number }
  }
}

export type MemoryReviewCandidate = {
  id: string
  projectID?: string
  sessionID?: string
  target: "memory" | "user"
  scope: "global" | "project" | "session"
  domain: "general" | "coding" | "office" | "personal" | "research" | "ops"
  kind?: "episodic" | "semantic" | "preference" | "goal" | "decision" | "relationship" | "lesson" | "procedure"
  entities?: Array<{ name: string; type?: string }>
  content: string
  summary?: string
  tags: Array<string>
  importance: number
  confidence: number
  factKey?: string
  operation: "add" | "update" | "archive" | "confirm"
  reason: string
  sourceMessageID?: string
  status: "pending" | "applied" | "dismissed"
  time: { created: number; updated: number; applied?: number }
}

// 进化相关类型
export type EvolutionStatus = {
  pending: number
  applied: number
  dismissed: number
  total: number
  latest?: number
  source: {
    all: number
    background: number
    "session-end": number
  }
  sourceByStatus: {
    pending: { all: number; background: number; "session-end": number }
    applied: { all: number; background: number; "session-end": number }
    dismissed: { all: number; background: number; "session-end": number }
  }
}

export type EvolutionCandidate = {
  id: string
  projectID?: string
  sessionID?: string
  kind: "skill" | "agent" | "workflow" | "prompt" | "tool" | "project" | "strategy" | "habit" | "knowledge"
  domain: "general" | "coding" | "office" | "personal" | "research" | "ops"
  target: string
  title: string
  content: string
  contentFormat: "content" | "unified_diff"
  reason: string
  tags: Array<string>
  expectedOutcomes?: Array<string>
  sourceMessageID?: string
  status: "pending" | "applied" | "dismissed"
  validationStatus: "pending" | "validated" | "failed"
  validationNote?: string
  time: { created: number; updated: number; applied?: number }
}

// 辅助函数：安全转换数值
function toNumber(value: number | string): number {
  if (typeof value === "number") return value
  return 0
}

// 记忆API封装
export const memoryApi = {
  async reviewStatus(client: NovawayClient): Promise<MemoryReviewStatus | null> {
    try {
      const res = await raw(client).get({
        url: "/memory/review/status",
      })
      return res.data as MemoryReviewStatus
    } catch {
      return null
    }
  },

  async listReviewCandidates(
    client: NovawayClient,
    params: { status?: string; limit?: number },
  ): Promise<MemoryReviewCandidate[]> {
    try {
      const query = new URLSearchParams()
      if (params.status) query.set("status", params.status)
      if (params.limit) query.set("limit", String(params.limit))
      const url = `/memory/review/candidate${query.toString() ? `?${query.toString()}` : ""}`
      const res = await raw(client).get({ url })
      return (res.data as MemoryReviewCandidate[]) ?? []
    } catch {
      return []
    }
  },

  async applyReviewCandidate(
    client: NovawayClient,
    params: { candidateID: string; scope?: string },
  ): Promise<boolean> {
    try {
      await raw(client).post({
        url: `/memory/review/candidate/${params.candidateID}/apply`,
        body: { scope: params.scope ?? "project" },
        headers: { "Content-Type": "application/json" },
      })
      return true
    } catch {
      return false
    }
  },

  async dismissReviewCandidate(client: NovawayClient, candidateID: string): Promise<boolean> {
    try {
      await raw(client).post({
        url: `/memory/review/candidate/${candidateID}/dismiss`,
      })
      return true
    } catch {
      return false
    }
  },
}

// 进化API封装
export const evolutionApi = {
  async status(client: NovawayClient): Promise<EvolutionStatus | null> {
    try {
      const res = await raw(client).get({
        url: "/evolution/status",
      })
      return res.data as EvolutionStatus
    } catch {
      return null
    }
  },

  async listCandidates(
    client: NovawayClient,
    params: { status?: string; limit?: number },
  ): Promise<EvolutionCandidate[]> {
    try {
      const query = new URLSearchParams()
      if (params.status) query.set("status", params.status)
      if (params.limit) query.set("limit", String(params.limit))
      const url = `/evolution/candidate${query.toString() ? `?${query.toString()}` : ""}`
      const res = await raw(client).get({ url })
      return (res.data as EvolutionCandidate[]) ?? []
    } catch {
      return []
    }
  },

  async applyFileCandidate(client: NovawayClient, candidateID: string): Promise<boolean> {
    try {
      await raw(client).post({
        url: `/evolution/candidate/${candidateID}/apply-file`,
      })
      return true
    } catch {
      return false
    }
  },

  async dismissCandidate(client: NovawayClient, candidateID: string): Promise<boolean> {
    try {
      await raw(client).post({
        url: `/evolution/candidate/${candidateID}/dismiss`,
      })
      return true
    } catch {
      return false
    }
  },

  async dryRunCandidate(client: NovawayClient, candidateID: string): Promise<any> {
    try {
      const res = await raw(client).get({
        url: `/evolution/candidate/${candidateID}/dry-run`,
      })
      return res.data
    } catch {
      return null
    }
  },
}
