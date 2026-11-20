import type { State } from "./policy"

export type WorkflowEvent = {
  type?: string
  route?: string
  phase?: string
  payload?: unknown
}

export type WorkflowMetrics = {
  sessionID: string
  route: State["route"] | undefined
  phase: State["phase"] | undefined
  routeDistribution: Record<string, number>
  phaseDistribution: Record<string, number>
  escalationCount: number
  questionCalls: number
  questionBudget: number
  questionMisuseCount: number
  blockedToolCount: number
  verification: { status: State["verificationStatus"] | undefined; passed: number; failed: number; unverified: number }
  delivery: { status: State["deliveryStatus"] | undefined; completed: number; blocked: number }
  phaseTransitions: number
  firstEventAt?: string
  lastEventAt?: string
}

/** Derive dashboard metrics from the durable state/event stream. Unknown events are ignored. */
export function summarize(sessionID: string, state: State | undefined, events: readonly WorkflowEvent[]): WorkflowMetrics {
  const routeDistribution: Record<string, number> = {}
  const phaseDistribution: Record<string, number> = {}
  let escalationCount = 0
  let questionCalls = 0
  let questionMisuseCount = 0
  let blockedToolCount = 0
  let phaseTransitions = 0
  let passed = 0
  let failed = 0
  let unverified = 0
  let completed = 0
  let blocked = 0
  for (const event of events) {
    if (event.route) routeDistribution[event.route] = (routeDistribution[event.route] ?? 0) + 1
    if (event.phase) phaseDistribution[event.phase] = (phaseDistribution[event.phase] ?? 0) + 1
    if (event.type === "route.escalated") escalationCount++
    if (event.type === "question.consumed") questionCalls++
    if (event.type === "phase.changed") phaseTransitions++
    if (event.type === "tool.blocked") blockedToolCount++
    const payload = event.payload && typeof event.payload === "object" ? event.payload as Record<string, unknown> : undefined
    if (payload?.reason === "naked-question" || event.type === "question.misused") questionMisuseCount++
    if (event.type === "verification.changed") {
      if (payload?.status === "passed") passed++
      if (payload?.status === "failed") failed++
      if (payload?.status === "unverified") unverified++
    }
    if (event.type === "delivery.changed") {
      if (payload?.status === "completed") completed++
      if (payload?.status === "blocked") blocked++
    }
  }
  return {
    sessionID,
    route: state?.route,
    phase: state?.phase,
    routeDistribution,
    phaseDistribution,
    escalationCount,
    questionCalls: state?.questionCalls ?? questionCalls,
    questionBudget: state?.questionBudget ?? 0,
    questionMisuseCount,
    blockedToolCount,
    verification: { status: state?.verificationStatus, passed, failed, unverified },
    delivery: { status: state?.deliveryStatus, completed, blocked },
    phaseTransitions,
    ...(events[0] && "created_at" in events[0] ? { firstEventAt: String((events[0] as any).created_at) } : {}),
    ...(events.at(-1) && "created_at" in events.at(-1)! ? { lastEventAt: String((events.at(-1) as any).created_at) } : {}),
  }
}
