import { Context, Effect, Layer } from "effect"
import { desc, eq } from "drizzle-orm"
import { Database } from "@/storage/db"
import { TeamAcceptanceTable, TeamVerificationTable } from "./run.sql"
import { sanitizeOptional } from "./evidence"

/**
 * 验收与验证。
 *
 * 核心不变量（见设计文档 §6.2 / §19.2）：
 * 1. 成员报告只是**声明**；任务的通过状态只由 `record()` 写入；
 * 2. 每条验证绑定代码快照（`snapshot_id`）与验证器版本；
 * 3. 没有验证记录 = `unverified`，**永远不折算成 `pass`**；
 * 4. 验证记录的快照与当前快照不一致 = `stale`，按未验证计数。
 */

export type AcceptanceKind = "test" | "diff" | "file" | "rubric" | "human"
export type Outcome = "pass" | "fail" | "unverified"

export type Acceptance = {
  id: string
  runID: string
  taskID?: string
  specID: string
  version: number
  text: string
  kind: AcceptanceKind
  expected?: string
  verifier?: Record<string, unknown>
  owner?: string
}

export type Verification = {
  id: string
  acceptanceID: string
  runID: string
  attempt: number
  snapshotID: string
  verifierVersion: string
  /** 验证器自己出错时也写 unverified：验不了不等于失败，更不等于通过。 */
  outcome: Outcome
  measured?: string
  evidenceRef?: string
  at: number
}

/** 单条验收的有效状态：验证缺失 → unverified；快照不一致 → stale。 */
export type EffectiveOutcome = Outcome | "stale"

export type Line = {
  acceptance: Acceptance
  outcome: EffectiveOutcome
  verification?: Verification
}

export type Summary = {
  lines: Line[]
  pass: number
  fail: number
  unverified: number
  stale: number
  /** 未验证 + 过期，二者都不能算通过。 */
  unresolved: number
  /** 未解决项占比，用于决定交付措辞是否要降级。 */
  ratio: number
  /** 是否允许宣称「已完成」；低于阈值且无 fail 才行。 */
  deliverable: boolean
  /** 交付措辞的档位：complete / partial / failed。 */
  verdict: "complete" | "partial" | "failed"
}

export const UNVERIFIED_THRESHOLD = 0.3

/**
 * 纯函数：给定验收项、验证记录与当前快照，算出每条的有效状态与汇总。
 *
 * 不依赖数据库，便于单测覆盖「不折叠」这条硬规则。
 */
export function summarize(
  acceptances: readonly Acceptance[],
  verifications: readonly Verification[],
  currentSnapshot: string,
): Summary {
  const byAcceptance = new Map<string, Verification[]>()
  for (const item of verifications) {
    const list = byAcceptance.get(item.acceptanceID) ?? []
    list.push(item)
    byAcceptance.set(item.acceptanceID, list)
  }

  const lines: Line[] = acceptances.map((acceptance) => {
    // 同一验收项取最近一次（attempt 最大、时间最晚）的验证结果。
    const latest = (byAcceptance.get(acceptance.id) ?? [])
      .slice()
      .sort((a, b) => (a.attempt === b.attempt ? b.at - a.at : b.attempt - a.attempt))[0]
    if (!latest) return { acceptance, outcome: "unverified" as EffectiveOutcome }
    // 代码变了，旧证据不再代表当前产物。
    if (latest.snapshotID !== currentSnapshot) {
      return { acceptance, outcome: "stale" as EffectiveOutcome, verification: latest }
    }
    return { acceptance, outcome: latest.outcome as EffectiveOutcome, verification: latest }
  })

  const pass = lines.filter((line) => line.outcome === "pass").length
  const fail = lines.filter((line) => line.outcome === "fail").length
  const unverified = lines.filter((line) => line.outcome === "unverified").length
  const stale = lines.filter((line) => line.outcome === "stale").length
  const unresolved = unverified + stale
  const total = lines.length
  const ratio = total === 0 ? 1 : unresolved / total

  const verdict: Summary["verdict"] = fail > 0 ? "failed" : ratio > UNVERIFIED_THRESHOLD ? "partial" : "complete"

  return {
    lines,
    pass,
    fail,
    unverified,
    stale,
    unresolved,
    ratio,
    deliverable: verdict === "complete",
    verdict,
  }
}

export interface Interface {
  readonly register: (input: {
    runID: string
    taskID?: string
    specID: string
    text: string
    kind: AcceptanceKind
    expected?: string
    verifier?: Record<string, unknown>
    owner?: string
  }) => Effect.Effect<Acceptance>
  readonly list: (runID: string) => Effect.Effect<Acceptance[]>
  readonly record: (input: {
    acceptanceID: string
    snapshotID: string
    verifierVersion: string
    outcome: Outcome
    measured?: string
    evidenceRef?: string
    attempt?: number
  }) => Effect.Effect<Verification>
  readonly verifications: (runID: string) => Effect.Effect<Verification[]>
  /** 汇总：`currentSnapshot` 缺省时取最近一条验证的快照。 */
  readonly summary: (input: { runID: string; currentSnapshot?: string }) => Effect.Effect<Summary>
}

export class Service extends Context.Service<Service, Interface>()("@NovaWay/TeamVerification") {}

const acceptanceId = () => "acc_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 7)
const verificationId = () => "ver_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 7)

const toAcceptance = (row: typeof TeamAcceptanceTable.$inferSelect): Acceptance => ({
  id: row.id,
  runID: row.run_id,
  taskID: row.task_id ?? undefined,
  specID: row.spec_id,
  version: row.version,
  text: row.text,
  kind: row.kind as AcceptanceKind,
  expected: row.expected ?? undefined,
  verifier: row.verifier ?? undefined,
  owner: row.owner ?? undefined,
})

const toVerification = (row: typeof TeamVerificationTable.$inferSelect): Verification => ({
  id: row.id,
  acceptanceID: row.acceptance_id,
  runID: row.run_id,
  attempt: row.attempt,
  snapshotID: row.snapshot_id,
  verifierVersion: row.verifier_version,
  outcome: row.outcome as Verification["outcome"],
  // 读取时再脱敏一遍：写入前就有脱敏，但旧行是在这条规则之前落库的。
  measured: sanitizeOptional(row.measured ?? undefined),
  evidenceRef: sanitizeOptional(row.evidence_ref ?? undefined),
  at: row.at,
})

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const register: Interface["register"] = Effect.fn("TeamVerification.register")(function* (input) {
      const acceptance: Acceptance = {
        id: acceptanceId(),
        runID: input.runID,
        taskID: input.taskID,
        specID: input.specID,
        version: 1,
        text: input.text,
        kind: input.kind,
        expected: input.expected,
        verifier: input.verifier,
        owner: input.owner,
      }
      yield* Effect.sync(() =>
        Database.use((db) =>
          db
            .insert(TeamAcceptanceTable)
            .values({
              id: acceptance.id,
              run_id: acceptance.runID,
              task_id: acceptance.taskID ?? null,
              spec_id: acceptance.specID,
              version: acceptance.version,
              text: acceptance.text,
              kind: acceptance.kind,
              expected: acceptance.expected ?? null,
              verifier: acceptance.verifier ?? null,
              owner: acceptance.owner ?? null,
            })
            .run(),
        ),
      )
      return acceptance
    })

    const list: Interface["list"] = Effect.fn("TeamVerification.list")(function* (runID) {
      const rows = yield* Effect.sync(() =>
        Database.use((db) =>
          db
            .select()
            .from(TeamAcceptanceTable)
            .where(eq(TeamAcceptanceTable.run_id, runID))
            .orderBy(TeamAcceptanceTable.time_created)
            .all(),
        ),
      )
      return rows.map(toAcceptance)
    })

    const record: Interface["record"] = Effect.fn("TeamVerification.record")(function* (input) {
      const rows = yield* Effect.sync(() =>
        Database.use((db) =>
          db.select().from(TeamAcceptanceTable).where(eq(TeamAcceptanceTable.id, input.acceptanceID)).all(),
        ),
      )
      const row = rows[0]
      if (!row) return yield* Effect.die(new Error("acceptance not found: " + input.acceptanceID))
      const verification: Verification = {
        id: verificationId(),
        acceptanceID: input.acceptanceID,
        runID: row.run_id,
        attempt: input.attempt ?? 0,
        snapshotID: input.snapshotID,
        verifierVersion: input.verifierVersion,
        outcome: input.outcome,
        // 验证器原样输出，可能带着凭据与 URL：入库前脱敏（§11.3）。
        measured: sanitizeOptional(input.measured),
        evidenceRef: sanitizeOptional(input.evidenceRef),
        at: Date.now(),
      }
      yield* Effect.sync(() =>
        Database.use((db) =>
          db
            .insert(TeamVerificationTable)
            .values({
              id: verification.id,
              acceptance_id: verification.acceptanceID,
              run_id: verification.runID,
              attempt: verification.attempt,
              snapshot_id: verification.snapshotID,
              verifier_version: verification.verifierVersion,
              outcome: verification.outcome,
              measured: verification.measured ?? null,
              evidence_ref: verification.evidenceRef ?? null,
              at: verification.at,
            })
            .run(),
        ),
      )
      return verification
    })

    const verifications: Interface["verifications"] = Effect.fn("TeamVerification.verifications")(function* (runID) {
      const rows = yield* Effect.sync(() =>
        Database.use((db) =>
          db
            .select()
            .from(TeamVerificationTable)
            .where(eq(TeamVerificationTable.run_id, runID))
            .orderBy(desc(TeamVerificationTable.at))
            .all(),
        ),
      )
      return rows.map(toVerification)
    })

    const summary: Interface["summary"] = Effect.fn("TeamVerification.summary")(function* (input) {
      const acceptances = yield* list(input.runID)
      const records = yield* verifications(input.runID)
      // 未指定当前快照时，用最近一条验证的快照；没有任何验证时用空串哨兵，
      // 这样每条验收都会落成 unverified，而不是被误判为通过。
      const snapshot = input.currentSnapshot ?? records[0]?.snapshotID ?? ""
      return summarize(acceptances, records, snapshot)
    })

    return Service.of({ register, list, record, verifications, summary })
  }),
)

export const defaultLayer = layer
