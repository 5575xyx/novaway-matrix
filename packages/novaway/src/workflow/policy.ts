import { Context, Effect, Layer } from "effect"
import { and, eq } from "drizzle-orm"
import { Database } from "@/storage/db"
import { SessionWorkflowEventTable, SessionWorkflowPolicyTable } from "./policy.sql"
import type { SessionID } from "@/session/schema"

export type Route = "l0" | "l1" | "l2" | "l3" | "l4" | "non-coding"
export type Phase =
  | "intake"
  | "grill-me"
  | "design"
  | "plan"
  | "implementation"
  | "review"
  | "verification"
  | "delivery"
  | "completed"
  | "blocked"
export type VerificationStatus = "not_required" | "pending" | "passed" | "failed" | "unverified"
export type DeliveryStatus = "not_started" | "in_progress" | "completed" | "blocked"

export type State = {
  sessionID: SessionID
  turnID: string
  route: Route
  phase: Phase
  routeLocked: boolean
  escalationReason?: string
  questionCalls: number
  questionBudget: number
  verificationStatus: VerificationStatus
  deliveryStatus: DeliveryStatus
  updatedAt: Date
  revision?: number
}

export type EventType =
  | "turn.started"
  | "route.escalated"
  | "question.consumed"
  | "skill.loaded"
  | "phase.changed"
  | "verification.changed"
  | "delivery.changed"
  | "tool.blocked"
  | "integration.commit"
  | "integration.pull_request"
  | "integration.check"
  | "memory.evidence"

const generateID = (prefix: string) => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`

/** Deterministic first-pass classifier. It biases upward for architecture and safety work. */
export function classify(input: string): { route: Route; questionBudget: number } {
  const text = input.trim().toLowerCase()
  if (!text) return { route: "l1", questionBudget: 1 }
  // Short mechanical edits must win over the broad documentation/non-coding rule
  // (for example, "把按钮文案 typo 改掉" is a codebase change, not a writing request).
  if (
    /(typo|copy|text|config|rename|format|文案|拼写|配置|改名|格式|颜色|spacing|样式)/i.test(text) &&
    text.length < 240
  )
    return { route: "l0", questionBudget: 1 }
  const nonCoding =
    /(readme|documentation|docs|prd|product requirement|运营|方案|调研|总结|翻译|文案|数据分析|report|analysis)/i.test(
      text,
    )
  if (nonCoding && !/(code|coding|bug|fix|implement|实现|修复|代码|功能|开发|test|测试|改掉|修改)/i.test(text))
    return { route: "non-coding", questionBudget: 8 }
  if (
    /(critical infrastructure|security audit|compliance|auth|权限模型|安全审计|核心架构|灾备|data migration|数据迁移|production incident|生产事故)/i.test(
      text,
    )
  )
    return { route: "l4", questionBudget: 8 }
  if (
    /(architecture|architectural|major refactor|重构架构|架构|跨服务|分布式|migration|迁移|deploy|部署|infrastructure|基础设施|schema change|数据库结构)/i.test(
      text,
    )
  )
    return { route: "l3", questionBudget: 8 }
  if (
    /(module|multi-module|cross-module|api|endpoint|integration|plugin|workflow|模块|跨模块|接口|集成|插件|工作流|数据库|中型功能)/i.test(
      text,
    )
  )
    return { route: "l2", questionBudget: 6 }
  return { route: "l1", questionBudget: 1 }
}

function fromRow(row: typeof SessionWorkflowPolicyTable.$inferSelect): State {
  return {
    sessionID: row.session_id as SessionID,
    turnID: row.turn_id,
    route: row.route as Route,
    phase: row.phase as Phase,
    routeLocked: row.route_locked === 1,
    escalationReason: row.escalation_reason ?? undefined,
    questionCalls: row.question_calls,
    questionBudget: row.question_budget,
    verificationStatus: row.verification_status as VerificationStatus,
    deliveryStatus: row.delivery_status as DeliveryStatus,
    updatedAt: row.updated_at,
    revision: row.revision ?? 0,
  }
}

export interface Interface {
  readonly get: (sessionID: SessionID) => Effect.Effect<State | undefined>
  readonly beginTurn: (input: { sessionID: SessionID; turnID: string; text: string }) => Effect.Effect<State>
  readonly consumeQuestion: (sessionID: SessionID) => Effect.Effect<{ allowed: boolean; state: State | undefined }>
  readonly recordSkill: (input: { sessionID: SessionID; name: string }) => Effect.Effect<State | undefined>
  readonly setPhase: (input: { sessionID: SessionID; phase: Phase }) => Effect.Effect<State | undefined>
  readonly setVerification: (input: {
    sessionID: SessionID
    status: VerificationStatus
  }) => Effect.Effect<State | undefined>
  readonly setDelivery: (input: { sessionID: SessionID; status: DeliveryStatus }) => Effect.Effect<State | undefined>
  readonly events: (sessionID: SessionID, limit?: number) => Effect.Effect<readonly Record<string, unknown>[]>
  readonly recordEvidence: (input: {
    sessionID: SessionID
    payload: Record<string, unknown>
  }) => Effect.Effect<State | undefined>
  readonly recordIntegration: (input: {
    sessionID: SessionID
    kind: "commit" | "pull_request" | "check"
    payload: Record<string, unknown>
  }) => Effect.Effect<State | undefined>
  readonly updateState: (input: {
    sessionID: SessionID
    expectedRevision: number
    patch: Partial<Pick<State, "phase" | "route" | "verificationStatus" | "deliveryStatus">>
  }) => Effect.Effect<State, Error>
}

export class Service extends Context.Service<Service, Interface>()("@novaway/WorkflowPolicy") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const emit = Effect.fn("WorkflowPolicy.emit")(function* (input: {
      state: State
      type: EventType
      payload?: Record<string, unknown>
    }) {
      yield* Effect.sync(() =>
        Database.use((db) =>
          db
            .insert(SessionWorkflowEventTable)
            .values({
              id: generateID("wfe"),
              session_id: input.state.sessionID,
              turn_id: input.state.turnID,
              type: input.type,
              route: input.state.route,
              phase: input.state.phase,
              payload: input.payload,
              created_at: new Date(),
            })
            .run(),
        ),
      )
    })

    const read = Effect.fn("WorkflowPolicy.get")(function* (sessionID: SessionID) {
      const rows = yield* Effect.sync(() =>
        Database.use((db) =>
          db
            .select()
            .from(SessionWorkflowPolicyTable)
            .where(eq(SessionWorkflowPolicyTable.session_id, sessionID))
            .limit(1)
            .all(),
        ),
      )
      return rows[0] ? fromRow(rows[0]) : undefined
    })

    const save = Effect.fn("WorkflowPolicy.save")(function* (state: State) {
      const result = yield* Effect.sync(() =>
        Database.use((db) =>
          db
            .update(SessionWorkflowPolicyTable)
            .set({
              turn_id: state.turnID,
              route: state.route,
              phase: state.phase,
              route_locked: state.routeLocked ? 1 : 0,
              escalation_reason: state.escalationReason ?? null,
              question_calls: state.questionCalls,
              question_budget: state.questionBudget,
              verification_status: state.verificationStatus,
              delivery_status: state.deliveryStatus,
              updated_at: state.updatedAt,
              revision: (state.revision ?? 0) + 1,
            })
            .where(
              and(
                eq(SessionWorkflowPolicyTable.session_id, state.sessionID),
                eq(SessionWorkflowPolicyTable.revision, state.revision ?? 0),
              ),
            )
            .run(),
        ),
      )
      return { ...state, revision: (state.revision ?? 0) + 1 }
    })

    const beginTurn = Effect.fn("WorkflowPolicy.beginTurn")(function* (input: {
      sessionID: SessionID
      turnID: string
      text: string
    }) {
      const existing = yield* read(input.sessionID)
      if (existing?.turnID === input.turnID) return existing
      const classified = classify(input.text)
      const now = new Date()
      const state: State = {
        sessionID: input.sessionID,
        turnID: input.turnID,
        route: classified.route,
        phase:
          classified.route === "non-coding" || classified.route === "l0" || classified.route === "l1"
            ? "grill-me"
            : "design",
        routeLocked: true,
        questionCalls: 0,
        questionBudget: classified.questionBudget,
        verificationStatus: classified.route === "l0" ? "not_required" : "pending",
        deliveryStatus: "not_started",
        updatedAt: now,
      }
      yield* Effect.sync(() =>
        Database.use((db) =>
          db
            .insert(SessionWorkflowPolicyTable)
            .values({
              session_id: state.sessionID,
              turn_id: state.turnID,
              route: state.route,
              phase: state.phase,
              route_locked: 1,
              escalation_reason: null,
              question_calls: 0,
              question_budget: state.questionBudget,
              verification_status: state.verificationStatus,
              delivery_status: state.deliveryStatus,
              created_at: now,
              updated_at: now,
              revision: 0,
            })
            .onConflictDoUpdate({
              target: SessionWorkflowPolicyTable.session_id,
              set: {
                turn_id: state.turnID,
                route: state.route,
                phase: state.phase,
                route_locked: 1,
                escalation_reason: null,
                question_calls: 0,
                question_budget: state.questionBudget,
                verification_status: state.verificationStatus,
                delivery_status: state.deliveryStatus,
                updated_at: now,
                revision: 0,
              },
            })
            .run(),
        ),
      )
      yield* emit({ state, type: "turn.started", payload: { textLength: input.text.length } })
      return state
    })

    const consumeQuestion = Effect.fn("WorkflowPolicy.consumeQuestion")(function* (sessionID: SessionID) {
      const result = yield* Effect.sync(() =>
        Database.transaction(
          (db) => {
            const row = db
              .select()
              .from(SessionWorkflowPolicyTable)
              .where(eq(SessionWorkflowPolicyTable.session_id, sessionID))
              .limit(1)
              .all()[0]
            if (!row) return { allowed: true, state: undefined }
            const state = fromRow(row)
            if (state.questionCalls >= state.questionBudget) return { allowed: false, state }
            const updatedAt = new Date()
            db.update(SessionWorkflowPolicyTable)
              .set({ question_calls: state.questionCalls + 1, updated_at: updatedAt })
              .where(eq(SessionWorkflowPolicyTable.session_id, sessionID))
              .run()
            return { allowed: true, state: { ...state, questionCalls: state.questionCalls + 1, updatedAt } }
          },
          { behavior: "immediate" },
        ),
      )
      if (result.allowed && result.state)
        yield* emit({ state: result.state, type: "question.consumed", payload: { call: result.state.questionCalls } })
      return result
    })

    const recordSkill = Effect.fn("WorkflowPolicy.recordSkill")(function* (input: {
      sessionID: SessionID
      name: string
    }) {
      const state = yield* read(input.sessionID)
      if (!state) return undefined
      const heavy = /(?:brainstorming|writing-plans|openspec|red-team)/i.test(input.name)
      const light = /(?:grill-me|using-powersnexus)/i.test(input.name)
      if (heavy && (state.route === "l0" || state.route === "l1")) {
        const next: State = {
          ...state,
          route: "l2",
          phase: "design",
          escalationReason: `heavy skill requested: ${input.name}`,
          questionBudget: Math.max(state.questionBudget, 6),
          verificationStatus: "pending",
          updatedAt: new Date(),
        }
        yield* save(next)
        yield* emit({ state: next, type: "route.escalated", payload: { skill: input.name } })
        return next
      }
      const next =
        light && state.phase === "intake" ? { ...state, phase: "grill-me" as Phase, updatedAt: new Date() } : state
      if (next !== state) yield* save(next)
      yield* emit({ state: next, type: "skill.loaded", payload: { skill: input.name } })
      return next
    })

    const update = Effect.fn("WorkflowPolicy.update")(function* (input: {
      sessionID: SessionID
      mutate: (state: State) => State
      type: EventType
      payload?: Record<string, unknown>
    }) {
      const state = yield* read(input.sessionID)
      if (!state) return undefined
      const next = input.mutate(state)
      yield* save(next)
      yield* emit({ state: next, type: input.type, payload: input.payload })
      return next
    })
    const setPhase = (input: { sessionID: SessionID; phase: Phase }) =>
      update({
        sessionID: input.sessionID,
        mutate: (state) => ({ ...state, phase: input.phase, updatedAt: new Date() }),
        type: "phase.changed",
        payload: { phase: input.phase },
      })
    const setVerification = (input: { sessionID: SessionID; status: VerificationStatus }) =>
      update({
        sessionID: input.sessionID,
        mutate: (state) => ({ ...state, verificationStatus: input.status, updatedAt: new Date() }),
        type: "verification.changed",
        payload: { status: input.status },
      })
    const setDelivery = (input: { sessionID: SessionID; status: DeliveryStatus }) =>
      update({
        sessionID: input.sessionID,
        mutate: (state) => ({ ...state, deliveryStatus: input.status, updatedAt: new Date() }),
        type: "delivery.changed",
        payload: { status: input.status },
      })

    const recordEvidence = Effect.fn("WorkflowPolicy.recordEvidence")(function* (input: {
      sessionID: SessionID
      payload: Record<string, unknown>
    }) {
      const state = yield* read(input.sessionID)
      if (!state) return undefined
      yield* emit({ state, type: "memory.evidence", payload: input.payload })
      return state
    })
    const recordIntegration = Effect.fn("WorkflowPolicy.recordIntegration")(function* (input: {
      sessionID: SessionID
      kind: "commit" | "pull_request" | "check"
      payload: Record<string, unknown>
    }) {
      const state = yield* read(input.sessionID)
      if (!state) return undefined
      const type =
        input.kind === "commit"
          ? ("integration.commit" as const)
          : input.kind === "pull_request"
            ? ("integration.pull_request" as const)
            : ("integration.check" as const)
      yield* emit({ state, type, payload: input.payload })
      return state
    })
    const updateState = Effect.fn("WorkflowPolicy.updateState")(function* (input: {
      sessionID: SessionID
      expectedRevision: number
      patch: Partial<Pick<State, "phase" | "route" | "verificationStatus" | "deliveryStatus">>
    }) {
      const state = yield* read(input.sessionID)
      if (!state) return yield* Effect.fail(new Error("workflow state not found: " + input.sessionID))
      if ((state.revision ?? 0) !== input.expectedRevision)
        return yield* Effect.fail(new Error("workflow state conflict for " + input.sessionID))
      const next = { ...state, ...input.patch, updatedAt: new Date() }
      const saved = yield* save(next)
      yield* emit({
        state: saved,
        type: "phase.changed",
        payload: { source: "shared-state-update", patch: input.patch },
      })
      return saved
    })
    const events = Effect.fn("WorkflowPolicy.events")(function* (sessionID: SessionID, limit = 100) {
      return yield* Effect.sync(() =>
        Database.use((db) =>
          db
            .select()
            .from(SessionWorkflowEventTable)
            .where(eq(SessionWorkflowEventTable.session_id, sessionID))
            .orderBy(SessionWorkflowEventTable.created_at)
            .limit(limit)
            .all()
            .map((item) => ({ ...item })),
        ),
      )
    })

    return {
      get: read,
      beginTurn,
      consumeQuestion,
      recordSkill,
      setPhase,
      setVerification,
      setDelivery,
      recordEvidence,
      recordIntegration,
      updateState,
      events,
    } satisfies Interface
  }),
)

export const defaultLayer = layer
