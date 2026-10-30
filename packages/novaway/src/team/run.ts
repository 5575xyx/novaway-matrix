import { Context, Effect, Layer } from "effect"
import { desc, eq } from "drizzle-orm"
import { Database } from "@/storage/db"
import type { SessionID } from "@/session/schema"
import { TeamRunEventTable, TeamRunTable, TeamRunTeamTable } from "./run.sql"

/**
 * 一次团队编排的持久化与状态机。
 *
 * 两条纪律：
 * 1. **状态与阶段分开**：`state` 是生命周期（能否继续推进、是否为终态），
 *    `phase` 只是给界面看的聚合阶段，不能拿 phase 做判断。
 * 2. **事件日志只追加**：运行过程的可审计性来自这里，任何改状态都要留下事件。
 */

export type RunState =
  | "planning"
  | "awaiting_approval"
  | "running"
  | "blocked"
  | "paused"
  | "done"
  | "partial"
  | "failed"
  | "exceeded"
  | "cancelled"
  | "needs_review"

export const TERMINAL_STATES: readonly RunState[] = ["done", "partial", "failed", "exceeded", "cancelled"]

export const isTerminal = (state: RunState) => TERMINAL_STATES.includes(state)

/**
 * 是否允许对这次运行启动执行。
 *
 * `running` 同时表示「已批准、等执行」与「正在执行」。靠 `phase` 区分：
 * 编排执行期间一定会写 phase，结束时清空。不区分的话，重复点击会把同一次运行
 * 派发两遍 —— 事件、账本、团队状态都会翻倍，而且两轮互相覆盖。
 */
export function canStart(state: RunState, phase: RunPhase | undefined): boolean {
  if (isTerminal(state)) return false
  if (state === "awaiting_approval") return false
  if (state === "running" && phase) return false
  return true
}

export type RunPhase = "executing" | "reviewing" | "reworking" | "merging" | "verify-merged"

export type Attempts = { business: number; formatRetry: number }

export type Budget = { tokens?: number; cost?: number; wallMs?: number }

export type Plan = {
  teams: ReadonlyArray<{
    profileID?: string
    profileVersion?: number
    name: string
    scope?: readonly string[]
    acceptance?: readonly string[]
    dependsOn?: readonly number[]
  }>
  notes?: string
  /**
   * 运行策略（§11.1）。缺省只读：审查运行不能改工作区，放宽要在计划里显式写出来。
   * 放在计划里而不是单独的字段，是为了让「改策略」等同于「改计划」—— 必须重新批准。
   */
  policy?: { readOnly?: boolean }
}

export type Approval = {
  planVersion: number
  approvedAt: number
  approvedBudget: Budget
  approvedBy: "user" | "main"
}

export type TeamRun = {
  id: string
  sessionID: SessionID
  directory: string
  /** 属于哪个持久目标（§3.2）；临时任务为空。 */
  missionID?: string
  mode: "team" | "auto"
  goal: string
  brief?: Record<string, unknown>
  acceptance?: unknown[]
  plan?: Plan
  planVersion: number
  approval?: Approval
  state: RunState
  phase?: RunPhase
  roundMain: number
  attempts: Attempts
  budget?: Budget
  usage?: Record<string, unknown>
  mergedVerification?: Record<string, unknown>
  startedAt?: number
  endedAt?: number
  error?: string
  terminalReason?: string
  createdAt: number
  updatedAt: number
}

export type RunEvent = {
  id: string
  runID: string
  seq: number
  at: number
  kind: string
  payload?: Record<string, unknown>
  leaseEpoch?: number
}

export type RunTeam = {
  id: string
  runID: string
  profileID?: string
  profileVersion?: number
  phase: string
  roundCaptain: number
  report?: Record<string, unknown>
  verdict?: Record<string, unknown>
  worktree?: string
  rosterSnapshot?: Record<string, unknown>
  dependsOn: number[]
  artifactsOut: unknown[]
  usage?: Record<string, unknown>
  createdAt: number
  updatedAt: number
}

/** 允许的状态迁移；终态不可再离开，`needs_review` 复核后可以回到 running。 */
const TRANSITIONS: Record<RunState, readonly RunState[]> = {
  planning: ["awaiting_approval", "running", "cancelled", "failed"],
  awaiting_approval: ["running", "cancelled", "failed", "paused"],
  // `awaiting_approval`：已批准但还没开工的运行可以撤回批准 —— 改了计划里的授权
  // 就等于换了一份计划，旧的批准不能再顶用（§11.1）。已经开始的运行不进这条路径。
  running: [
    "awaiting_approval",
    "blocked",
    "paused",
    "done",
    "partial",
    "failed",
    "exceeded",
    "cancelled",
    "needs_review",
  ],
  blocked: ["running", "paused", "failed", "exceeded", "cancelled", "needs_review"],
  paused: ["running", "cancelled", "failed"],
  done: [],
  partial: [],
  failed: [],
  exceeded: [],
  cancelled: [],
  needs_review: ["running", "partial", "failed", "cancelled"],
}

export class InvalidTransition extends Error {
  constructor(
    readonly from: RunState,
    readonly to: RunState,
  ) {
    super(`invalid run transition: ${from} -> ${to}`)
  }
}

export function canTransition(from: RunState, to: RunState): boolean {
  return TRANSITIONS[from].includes(to)
}

export interface Interface {
  readonly create: (input: {
    sessionID: SessionID
    directory: string
    missionID?: string
    mode: "team" | "auto"
    goal: string
    brief?: Record<string, unknown>
    acceptance?: unknown[]
    budget?: Budget
  }) => Effect.Effect<TeamRun>
  readonly get: (runID: string) => Effect.Effect<TeamRun | undefined>
  readonly list: (input?: { sessionID?: SessionID; missionID?: string }) => Effect.Effect<TeamRun[]>
  readonly update: (input: {
    runID: string
    state?: RunState
    phase?: RunPhase | null
    plan?: Plan
    planVersion?: number
    approval?: Approval
    budget?: Budget
    usage?: Record<string, unknown>
    mergedVerification?: Record<string, unknown>
    roundMain?: number
    attempts?: Attempts
    error?: string | null
    terminalReason?: string | null
    startedAt?: number
    endedAt?: number
  }) => Effect.Effect<TeamRun | undefined>
  readonly approve: (input: {
    runID: string
    planVersion: number
    budget: Budget
    by: Approval["approvedBy"]
  }) => Effect.Effect<TeamRun | "stale-plan" | undefined>
  readonly appendEvent: (input: {
    runID: string
    kind: string
    payload?: Record<string, unknown>
    leaseEpoch?: number
  }) => Effect.Effect<RunEvent>
  readonly events: (input: { runID: string; afterSeq?: number }) => Effect.Effect<RunEvent[]>
  readonly addTeam: (input: {
    runID: string
    profileID?: string
    profileVersion?: number
    rosterSnapshot?: Record<string, unknown>
    dependsOn?: number[]
    worktree?: string
  }) => Effect.Effect<RunTeam>
  readonly teams: (runID: string) => Effect.Effect<RunTeam[]>
  readonly updateTeam: (input: {
    id: string
    phase?: string
    roundCaptain?: number
    report?: Record<string, unknown>
    verdict?: Record<string, unknown>
    artifactsOut?: unknown[]
    usage?: Record<string, unknown>
  }) => Effect.Effect<RunTeam | undefined>
}

export class Service extends Context.Service<Service, Interface>()("@NovaWay/TeamRun") {}

const generateId = (prefix: string) =>
  prefix + "_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 7)

const toRun = (row: typeof TeamRunTable.$inferSelect): TeamRun => ({
  id: row.id,
  sessionID: row.session_id,
  directory: row.directory,
  missionID: row.mission_id ?? undefined,
  mode: row.mode as TeamRun["mode"],
  goal: row.goal,
  brief: row.brief ?? undefined,
  acceptance: row.acceptance ?? undefined,
  plan: (row.plan as Plan | null) ?? undefined,
  planVersion: row.plan_version,
  approval: (row.approval as Approval | null) ?? undefined,
  state: row.state as RunState,
  phase: (row.phase as RunPhase | null) ?? undefined,
  roundMain: row.round_main,
  attempts: row.attempts ?? { business: 0, formatRetry: 0 },
  budget: (row.budget as Budget | null) ?? undefined,
  usage: row.usage ?? undefined,
  mergedVerification: row.merged_verification ?? undefined,
  startedAt: row.started_at ?? undefined,
  endedAt: row.ended_at ?? undefined,
  error: row.error ?? undefined,
  terminalReason: row.terminal_reason ?? undefined,
  createdAt: row.time_created,
  updatedAt: row.time_updated,
})

const toEvent = (row: typeof TeamRunEventTable.$inferSelect): RunEvent => ({
  id: row.id,
  runID: row.run_id,
  seq: row.seq,
  at: row.at,
  kind: row.kind,
  payload: row.payload ?? undefined,
  leaseEpoch: row.lease_epoch ?? undefined,
})

const toTeam = (row: typeof TeamRunTeamTable.$inferSelect): RunTeam => ({
  id: row.id,
  runID: row.run_id,
  profileID: row.profile_id ?? undefined,
  profileVersion: row.profile_version ?? undefined,
  phase: row.phase,
  roundCaptain: row.round_captain,
  report: row.report ?? undefined,
  verdict: row.verdict ?? undefined,
  worktree: row.worktree ?? undefined,
  rosterSnapshot: row.roster_snapshot ?? undefined,
  dependsOn: (row.depends_on as number[] | null) ?? [],
  artifactsOut: (row.artifacts_out as unknown[] | null) ?? [],
  usage: row.usage ?? undefined,
  createdAt: row.time_created,
  updatedAt: row.time_updated,
})

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const get: Interface["get"] = Effect.fn("TeamRun.get")(function* (runID) {
      const row = yield* Effect.sync(() =>
        Database.use((db) => db.select().from(TeamRunTable).where(eq(TeamRunTable.id, runID)).all()),
      )
      return row[0] ? toRun(row[0]) : undefined
    })

    const create: Interface["create"] = Effect.fn("TeamRun.create")(function* (input) {
      const now = Date.now()
      const run: TeamRun = {
        id: generateId("run"),
        sessionID: input.sessionID,
        directory: input.directory,
        missionID: input.missionID,
        mode: input.mode,
        goal: input.goal,
        brief: input.brief,
        acceptance: input.acceptance,
        planVersion: 0,
        state: "planning",
        roundMain: 0,
        attempts: { business: 0, formatRetry: 0 },
        budget: input.budget,
        createdAt: now,
        updatedAt: now,
      }
      yield* Effect.sync(() =>
        Database.use((db) =>
          db
            .insert(TeamRunTable)
            .values({
              id: run.id,
              session_id: run.sessionID,
              directory: run.directory,
              mission_id: run.missionID ?? null,
              mode: run.mode,
              goal: run.goal,
              brief: run.brief ?? null,
              acceptance: (run.acceptance as unknown[] | undefined) ?? null,
              plan_version: 0,
              state: run.state,
              round_main: 0,
              attempts: run.attempts,
              budget: run.budget ?? null,
              time_created: now,
              time_updated: now,
            })
            .run(),
        ),
      )
      yield* appendEvent({ runID: run.id, kind: "run.created", payload: { mode: run.mode, goal: run.goal } })
      return run
    })

    const list: Interface["list"] = Effect.fn("TeamRun.list")(function* (input) {
      const rows = yield* Effect.sync(() =>
        Database.use((db) =>
          input?.sessionID
            ? db
                .select()
                .from(TeamRunTable)
                .where(eq(TeamRunTable.session_id, input.sessionID))
                .orderBy(desc(TeamRunTable.time_created))
                .all()
            : input?.missionID
              ? db
                  .select()
                  .from(TeamRunTable)
                  .where(eq(TeamRunTable.mission_id, input.missionID))
                  .orderBy(desc(TeamRunTable.time_created))
                  .all()
              : db.select().from(TeamRunTable).orderBy(desc(TeamRunTable.time_created)).all(),
        ),
      )
      return rows.map(toRun)
    })

    const appendEvent: Interface["appendEvent"] = Effect.fn("TeamRun.appendEvent")(function* (input) {
      const event = yield* Effect.sync(() =>
        Database.transaction(
          (tx) => {
            const last = tx
              .select()
              .from(TeamRunEventTable)
              .where(eq(TeamRunEventTable.run_id, input.runID))
              .orderBy(desc(TeamRunEventTable.seq))
              .all()[0]
            const next: RunEvent = {
              id: generateId("evt"),
              runID: input.runID,
              seq: (last?.seq ?? 0) + 1,
              at: Date.now(),
              kind: input.kind,
              payload: input.payload,
              leaseEpoch: input.leaseEpoch,
            }
            tx.insert(TeamRunEventTable)
              .values({
                id: next.id,
                run_id: next.runID,
                seq: next.seq,
                at: next.at,
                kind: next.kind,
                payload: next.payload ?? null,
                lease_epoch: next.leaseEpoch ?? null,
              })
              .run()
            return next
          },
          { behavior: "immediate" },
        ),
      )
      return event
    })

    const update: Interface["update"] = Effect.fn("TeamRun.update")(function* (input) {
      const existing = yield* get(input.runID)
      if (!existing) return undefined
      if (input.state && input.state !== existing.state) {
        if (!canTransition(existing.state, input.state)) {
          return yield* Effect.die(new InvalidTransition(existing.state, input.state))
        }
      }
      const nextState = input.state ?? existing.state
      const now = Date.now()
      yield* Effect.sync(() =>
        Database.use((db) =>
          db
            .update(TeamRunTable)
            .set({
              ...(input.state ? { state: input.state } : {}),
              ...(input.phase !== undefined ? { phase: input.phase } : {}),
              ...(input.plan ? { plan: input.plan } : {}),
              ...(input.planVersion !== undefined ? { plan_version: input.planVersion } : {}),
              ...(input.approval ? { approval: input.approval } : {}),
              ...(input.budget ? { budget: input.budget } : {}),
              ...(input.usage !== undefined ? { usage: input.usage } : {}),
              ...(input.mergedVerification !== undefined ? { merged_verification: input.mergedVerification } : {}),
              ...(input.roundMain !== undefined ? { round_main: input.roundMain } : {}),
              ...(input.attempts ? { attempts: input.attempts } : {}),
              ...(input.error !== undefined ? { error: input.error } : {}),
              ...(input.terminalReason !== undefined ? { terminal_reason: input.terminalReason } : {}),
              ...(input.startedAt !== undefined ? { started_at: input.startedAt } : {}),
              ...(input.endedAt !== undefined ? { ended_at: input.endedAt } : {}),
              time_updated: now,
            })
            .where(eq(TeamRunTable.id, input.runID))
            .run(),
        ),
      )
      if (input.state && input.state !== existing.state) {
        yield* appendEvent({
          runID: input.runID,
          kind: "run.state",
          payload: {
            from: existing.state,
            to: nextState,
            ...(input.terminalReason ? { reason: input.terminalReason } : {}),
          },
        })
      }
      return yield* get(input.runID)
    })

    const approve: Interface["approve"] = Effect.fn("TeamRun.approve")(function* (input) {
      const run = yield* get(input.runID)
      if (!run) return undefined
      // 计划改过版本，之前的批准不再代表当前计划。
      if (run.planVersion !== input.planVersion) return "stale-plan" as const
      return yield* update({
        runID: input.runID,
        state: "running",
        approval: {
          planVersion: input.planVersion,
          approvedAt: Date.now(),
          approvedBudget: input.budget,
          approvedBy: input.by,
        },
        budget: input.budget,
        startedAt: run.startedAt ?? Date.now(),
      })
    })

    const events: Interface["events"] = Effect.fn("TeamRun.events")(function* (input) {
      const rows = yield* Effect.sync(() =>
        Database.use((db) => {
          const all = db
            .select()
            .from(TeamRunEventTable)
            .where(eq(TeamRunEventTable.run_id, input.runID))
            .orderBy(TeamRunEventTable.seq)
            .all()
          return all.filter((row) => row.seq > (input.afterSeq ?? 0))
        }),
      )
      return rows.map(toEvent)
    })

    const addTeam: Interface["addTeam"] = Effect.fn("TeamRun.addTeam")(function* (input) {
      const now = Date.now()
      const team: RunTeam = {
        id: generateId("rt"),
        runID: input.runID,
        profileID: input.profileID,
        profileVersion: input.profileVersion,
        phase: "queued",
        roundCaptain: 0,
        rosterSnapshot: input.rosterSnapshot,
        dependsOn: input.dependsOn ?? [],
        artifactsOut: [],
        worktree: input.worktree,
        createdAt: now,
        updatedAt: now,
      }
      yield* Effect.sync(() =>
        Database.use((db) =>
          db
            .insert(TeamRunTeamTable)
            .values({
              id: team.id,
              run_id: team.runID,
              profile_id: team.profileID ?? null,
              profile_version: team.profileVersion ?? null,
              phase: team.phase,
              round_captain: 0,
              roster_snapshot: team.rosterSnapshot ?? null,
              depends_on: team.dependsOn,
              artifacts_out: team.artifactsOut,
              worktree: team.worktree ?? null,
              time_created: now,
              time_updated: now,
            })
            .run(),
        ),
      )
      yield* appendEvent({
        runID: input.runID,
        kind: "team.added",
        payload: { teamID: team.id, profileID: team.profileID, dependsOn: team.dependsOn },
      })
      return team
    })

    const teams: Interface["teams"] = Effect.fn("TeamRun.teams")(function* (runID) {
      const rows = yield* Effect.sync(() =>
        Database.use((db) =>
          db
            .select()
            .from(TeamRunTeamTable)
            .where(eq(TeamRunTeamTable.run_id, runID))
            .orderBy(TeamRunTeamTable.time_created)
            .all(),
        ),
      )
      return rows.map(toTeam)
    })

    const updateTeam: Interface["updateTeam"] = Effect.fn("TeamRun.updateTeam")(function* (input) {
      yield* Effect.sync(() =>
        Database.use((db) =>
          db
            .update(TeamRunTeamTable)
            .set({
              ...(input.phase ? { phase: input.phase } : {}),
              ...(input.roundCaptain !== undefined ? { round_captain: input.roundCaptain } : {}),
              ...(input.report !== undefined ? { report: input.report } : {}),
              ...(input.verdict !== undefined ? { verdict: input.verdict } : {}),
              ...(input.artifactsOut !== undefined ? { artifacts_out: input.artifactsOut } : {}),
              ...(input.usage !== undefined ? { usage: input.usage } : {}),
              time_updated: Date.now(),
            })
            .where(eq(TeamRunTeamTable.id, input.id))
            .run(),
        ),
      )
      const rows = yield* Effect.sync(() =>
        Database.use((db) => db.select().from(TeamRunTeamTable).where(eq(TeamRunTeamTable.id, input.id)).all()),
      )
      return rows[0] ? toTeam(rows[0]) : undefined
    })

    return Service.of({ create, get, list, update, approve, appendEvent, events, addTeam, teams, updateTeam })
  }),
)

export const defaultLayer = layer
