import { Cause, Context, Effect, Exit, Layer } from "effect"
import { Service as TeamLedgerService, defaultLayer as ledgerLayer } from "./ledger"
import { Service as TeamOpLogService, defaultLayer as opLogLayer } from "./op-log"
import { Service as TeamRunService, defaultLayer as runLayer, isTerminal, type RunState, type RunTeam } from "./run"
import {
  Service as TeamVerificationService,
  defaultLayer as verificationLayer,
  type Acceptance,
  type Summary,
} from "./verification"

/**
 * 团队编排调度器：只守不变量，不生成内容。
 *
 * 主智能体派发给队长 → 队长分派给成员 → 队长判定交付 → 主智能体再判定 →
 * 不满足就带着「未达标的部分 + 优化建议」打回 → 直到全部满足或到达上限。
 *
 * 调度器负责的部分：
 * - 派发前预占预算，返回后结算（`ledger`）；
 * - 验收结论只来自 `verification.record`，报告里的自述不算；
 * - 尝试次数**共享累计**，换人不重置；
 * - 取消分三段，最后一段 `cancel.settled` 记下已发生的影响；
 * - 恢复前先看操作日志，`unknown` 一律进 `needs_review`。
 */

export type Claim = {
  acceptanceID?: string
  text: string
  evidence?: string
}

export type Artifact = { name: string; version: number; hash?: string }

export type Report = {
  teamID: string
  summary: string
  claims: Claim[]
  artifacts?: Artifact[]
  usage?: { tokens?: number }
  done?: boolean
}

export type VerificationResult = {
  outcome: "pass" | "fail" | "unverified"
  measured?: string
  evidenceRef?: string
  verifierVersion?: string
  /** 验证针对的代码快照；缺省用调度器传入的当前快照。 */
  snapshotID?: string
}

export type DispatchInput = {
  team: RunTeam
  round: number
  acceptance: Acceptance[]
  /** 上一轮主智能体的打回意见：未达标部分 + 优化建议。 */
  feedback?: string[]
}

export type VerifyInput = {
  acceptance: Acceptance
  report: Report
  team: RunTeam
  round: number
}

export type Dispatcher = (input: DispatchInput) => Effect.Effect<Report, unknown>
export type Verifier = (input: VerifyInput) => Effect.Effect<VerificationResult, unknown>

export type Execution = {
  state: RunState
  rounds: number
  summary: Summary
  teams: Array<{ teamID: string; phase: string; verdict?: Record<string, unknown> }>
}

export type Options = {
  runID: string
  dispatch: Dispatcher
  verify: Verifier
  /** 当前代码快照，验证结果与它绑定。 */
  snapshot: () => Effect.Effect<string>
  maxRounds?: number
  maxBusinessAttempts?: number
  concurrency?: number
  /** 每次派发前预占的 token 数，返回后按实际用量结算。 */
  reserveTokens?: number
  /** 合并后的全局验收：有全局验收项时必须提供。 */
  verifyMerged?: (input: { acceptance: Acceptance; snapshotID: string }) => Effect.Effect<VerificationResult, unknown>
  signal?: AbortSignal
}

export interface Interface {
  readonly execute: (options: Options) => Effect.Effect<Execution>
}

export class Service extends Context.Service<Service, Interface>()("@NovaWay/TeamOrchestrator") {}

const message = (cause: Cause.Cause<unknown>) => {
  const error = Cause.squash(cause)
  return error instanceof Error ? error.message : String(error)
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const runs = yield* TeamRunService
    const verification = yield* TeamVerificationService
    const ledger = yield* TeamLedgerService
    const ops = yield* TeamOpLogService

    const execute: Interface["execute"] = Effect.fn("TeamOrchestrator.execute")(function* (input) {
      const run = yield* runs.get(input.runID)
      if (!run) return yield* Effect.die(new Error("run not found: " + input.runID))

      // 未批准的运行不允许派发：Plan 版本与预算必须是用户看过的那一份。
      if (run.state === "awaiting_approval")
        return yield* Effect.die(new Error("run is awaiting approval: " + input.runID))
      if (isTerminal(run.state)) return yield* Effect.die(new Error("run already finished: " + run.state))

      const cap = { tokens: run.budget?.tokens ?? 0 }
      const reserveTokens = input.reserveTokens ?? 4000
      const maxRounds = input.maxRounds ?? 3
      const maxBusiness = input.maxBusinessAttempts ?? 6
      const acceptances = yield* verification.list(input.runID)
      const attempts = { ...run.attempts }

      yield* runs.update({
        runID: input.runID,
        state: "running",
        phase: "executing",
        startedAt: run.startedAt ?? Date.now(),
      })

      let rounds = 0
      // 打回意见按团队保存，下一轮派发时随任务一起下发。
      const feedback = new Map<string, string[]>()

      const cancelled = () => input.signal?.aborted === true

      /** 三段式取消：停止新派发 → 记录在途影响 → 才置终态。 */
      const finishCancelled = Effect.fn("TeamOrchestrator.cancelled")(function* (teams: RunTeam[]) {
        yield* runs.appendEvent({ runID: input.runID, kind: "cancel.requested" })
        for (const team of teams) {
          if (team.phase === "delivered") continue
          yield* runs.updateTeam({ id: team.id, phase: "cancelled" })
        }
        const usage = yield* ledger.usage({ runID: input.runID, cap })
        yield* runs.appendEvent({
          runID: input.runID,
          kind: "cancel.settled",
          payload: { usage, round: rounds },
        })
        const summary = yield* verification.summary({ runID: input.runID })
        yield* runs.update({
          runID: input.runID,
          state: "cancelled",
          phase: null,
          usage: { reserved: usage.reserved, settled: usage.settled },
          endedAt: Date.now(),
          terminalReason: "user-cancelled",
        })
        return {
          state: "cancelled" as const,
          rounds,
          summary,
          teams: teams.map((team) => ({ teamID: team.id, phase: "cancelled" })),
        }
      })

      /** 单团队一轮：预占 → 派发 → 验证 → 判定。失败不影响其他团队。 */
      const attempt = (team: RunTeam, round: number) =>
        Effect.gen(function* () {
          const teamLines = acceptances.filter((acceptance) => acceptance.owner === team.id)
          const reservation = yield* Effect.exit(
            ledger.reserve({ runID: input.runID, actor: team.id, tokens: reserveTokens, cap }),
          )
          if (Exit.isFailure(reservation)) {
            // 预算不足不是团队的错：记 exceeded，让整体结论走「超限」。
            yield* runs.updateTeam({ id: team.id, phase: "exceeded" })
            yield* runs.appendEvent({ runID: input.runID, kind: "budget.exceeded", payload: { teamID: team.id } })
            return
          }

          yield* runs.updateTeam({ id: team.id, phase: "running", roundCaptain: round })
          yield* runs.appendEvent({
            runID: input.runID,
            kind: "team.dispatched",
            payload: { teamID: team.id, round, acceptance: teamLines.length },
          })

          const dispatched = yield* Effect.exit(
            input.dispatch({
              team,
              round,
              acceptance: teamLines,
              feedback: feedback.get(team.id),
            }),
          )

          if (Exit.isFailure(dispatched)) {
            yield* ledger.settle({ id: reservation.value.id, tokens: 0 })
            yield* runs.updateTeam({ id: team.id, phase: "failed" })
            yield* runs.appendEvent({
              runID: input.runID,
              kind: "team.failed",
              payload: { teamID: team.id, round, message: message(dispatched.cause) },
            })
            return
          }

          const report = dispatched.value
          yield* ledger.settle({ id: reservation.value.id, tokens: report.usage?.tokens })
          yield* runs.updateTeam({
            id: team.id,
            report: report as unknown as Record<string, unknown>,
            artifactsOut: report.artifacts,
          })
          yield* runs.appendEvent({
            runID: input.runID,
            kind: "team.reported",
            payload: { teamID: team.id, round, claims: report.claims.length, done: report.done ?? false },
          })

          // 验收结论只来自验证器；成员报告里的 claims 只用来对照。
          const snapshot = yield* input.snapshot()
          for (const acceptance of teamLines) {
            const result = yield* Effect.exit(input.verify({ acceptance, report, team, round }))
            if (Exit.isFailure(result)) {
              // 验证器本身出错 -> 未验证，而不是失败，更不是通过。
              yield* verification.record({
                acceptanceID: acceptance.id,
                snapshotID: snapshot,
                verifierVersion: "verifier-error",
                outcome: "unverified",
                measured: message(result.cause),
                attempt: round,
              })
              continue
            }
            yield* verification.record({
              acceptanceID: acceptance.id,
              snapshotID: result.value.snapshotID ?? snapshot,
              verifierVersion: result.value.verifierVersion ?? "v1",
              outcome: result.value.outcome,
              measured: result.value.measured,
              evidenceRef: result.value.evidenceRef,
              attempt: round,
            })
          }

          const summary = yield* verification.summary({ runID: input.runID, currentSnapshot: snapshot })
          const ids = new Set(teamLines.map((acceptance) => acceptance.id))
          const lines = summary.lines.filter((line) => ids.has(line.acceptance.id))
          const failing = lines.filter((line) => line.outcome !== "pass")

          if (failing.length === 0) {
            yield* runs.updateTeam({
              id: team.id,
              phase: "delivered",
              verdict: { verdict: "complete", pass: lines.length, round },
            })
            yield* runs.appendEvent({
              runID: input.runID,
              kind: "team.delivered",
              payload: { teamID: team.id, round },
            })
            feedback.delete(team.id)
            return
          }

          // 打回：只把未达标的部分与「怎么改」写进意见，下一轮原样下发。
          attempts.business += 1
          const notes = failing.map((line) => {
            const measured = line.verification?.measured
            return "未达标：" + line.acceptance.text + "（" + line.outcome + (measured ? "：" + measured : "") + "）"
          })
          feedback.set(team.id, notes)
          yield* runs.updateTeam({
            id: team.id,
            phase: "rework",
            verdict: { verdict: "rework", failing: failing.length, round },
          })
          yield* runs.appendEvent({
            runID: input.runID,
            kind: "team.rework",
            payload: { teamID: team.id, round, attempts: attempts.business, notes },
          })
        })

      let teams = yield* runs.teams(input.runID)
      let exceeded = false

      while (rounds < maxRounds) {
        if (cancelled()) return yield* finishCancelled(teams)
        rounds += 1
        // 新一轮开始：上一轮的 rework 回到可派发状态。
        for (const team of teams) {
          if (team.phase === "rework") yield* runs.updateTeam({ id: team.id, phase: "queued" })
        }
        yield* runs.update({ runID: input.runID, roundMain: rounds, phase: "executing", attempts: { ...attempts } })

        let progressed = true
        while (progressed) {
          if (cancelled()) return yield* finishCancelled(teams)
          progressed = false
          teams = yield* runs.teams(input.runID)
          const byID = new Map(teams.map((team, index) => [index, team]))
          // 依赖按团队在本次运行中的顺序下标记录；未交付的依赖不算满足。
          const ready = teams.filter((team, index) => {
            if (team.phase !== "queued") return false
            return team.dependsOn.every((dep) => byID.get(dep)?.phase === "delivered")
          })
          if (ready.length === 0) break
          yield* Effect.forEach(ready, (team) => attempt(team, rounds), {
            concurrency: input.concurrency ?? Math.max(1, ready.length),
            discard: true,
          })
          progressed = true
        }

        teams = yield* runs.teams(input.runID)
        if (teams.length > 0 && teams.every((team) => team.phase === "delivered")) break
        if (attempts.business >= maxBusiness) {
          exceeded = true
          break
        }
        // 一个团队都推不动（全部在等依赖 / 等确认）才算 blocked。
        if (teams.some((team) => team.phase === "running")) continue
        if (teams.every((team) => team.phase === "delivered" || team.phase === "failed" || team.phase === "exceeded"))
          break
      }

      // 合并后的重验：快照变了，之前团队的证据一律作废，
      // 必须在最终快照上重新验证（合并后的验收永远是重档，见 §10 / §19.1）。
      const snapshot = yield* input.snapshot()
      teams = yield* runs.teams(input.runID)
      const teamByID = new Map(teams.map((team) => [team.id, team]))

      const recordResult = (
        acceptance: Acceptance,
        result: Exit.Exit<VerificationResult, unknown>,
        fallbackVersion: string,
      ) =>
        verification.record({
          acceptanceID: acceptance.id,
          snapshotID: Exit.isSuccess(result) ? (result.value.snapshotID ?? snapshot) : snapshot,
          verifierVersion: Exit.isSuccess(result)
            ? (result.value.verifierVersion ?? fallbackVersion)
            : "verifier-error",
          outcome: Exit.isSuccess(result) ? result.value.outcome : "unverified",
          measured: Exit.isSuccess(result) ? result.value.measured : message(result.cause),
          evidenceRef: Exit.isSuccess(result) ? result.value.evidenceRef : undefined,
          attempt: rounds + 1,
        })

      for (const acceptance of acceptances) {
        if (!acceptance.owner) {
          if (!input.verifyMerged) {
            yield* verification.record({
              acceptanceID: acceptance.id,
              snapshotID: snapshot,
              verifierVersion: "none",
              outcome: "unverified",
              measured: "未配置合并验收验证器",
              attempt: rounds + 1,
            })
            continue
          }
          const merged = yield* Effect.exit(input.verifyMerged({ acceptance, snapshotID: snapshot }))
          yield* recordResult(acceptance, merged, "merged")
          continue
        }
        const team = teamByID.get(acceptance.owner)
        if (!team) {
          yield* verification.record({
            acceptanceID: acceptance.id,
            snapshotID: snapshot,
            verifierVersion: "none",
            outcome: "unverified",
            measured: "验收归属的团队不在本次运行中",
            attempt: rounds + 1,
          })
          continue
        }
        const report = (team.report as unknown as Report | undefined) ?? {
          teamID: team.id,
          summary: "",
          claims: [],
        }
        const recheck = yield* Effect.exit(input.verify({ acceptance, report, team, round: rounds + 1 }))
        yield* recordResult(acceptance, recheck, "v1")
      }

      const summary = yield* verification.summary({ runID: input.runID, currentSnapshot: snapshot })
      teams = yield* runs.teams(input.runID)
      // 有结果不明的工具操作时，不允许宣称完成——先让人核对副作用。
      const pending = yield* ops.needsReview(input.runID)
      const allDelivered = teams.length > 0 && teams.every((team) => team.phase === "delivered")
      const anyDelivered = teams.some((team) => team.phase === "delivered")
      const anyExceeded = teams.some((team) => team.phase === "exceeded")
      const usage = yield* ledger.usage({ runID: input.runID, cap })

      const state: RunState =
        exceeded || anyExceeded
          ? "exceeded"
          : pending.length > 0
            ? "needs_review"
            : allDelivered && summary.verdict === "complete"
              ? "done"
              : allDelivered && summary.verdict === "partial"
                ? "partial"
                : anyDelivered
                  ? "partial"
                  : "failed"

      yield* runs.update({
        runID: input.runID,
        state,
        phase: null,
        attempts: { ...attempts },
        usage: {
          reserved: usage.reserved,
          settled: usage.settled,
          unknown: usage.unknown,
          cap: usage.cap,
          overrun: usage.overrun,
        },
        mergedVerification: summary as unknown as Record<string, unknown>,
        endedAt: isTerminal(state) ? Date.now() : undefined,
        terminalReason: state,
        error: state === "failed" ? "没有团队产出可交付结果" : state === "exceeded" ? "尝试次数或预算超限" : null,
      })
      yield* runs.appendEvent({
        runID: input.runID,
        kind: "run.settled",
        payload: {
          state,
          rounds,
          attempts,
          pass: summary.pass,
          fail: summary.fail,
          unverified: summary.unverified,
          stale: summary.stale,
          needsReview: pending.length,
        },
      })

      return {
        state,
        rounds,
        summary,
        teams: teams.map((team) => ({ teamID: team.id, phase: team.phase, verdict: team.verdict })),
      }
    })

    return Service.of({ execute })
  }),
)

export const defaultLayer = Layer.suspend(() =>
  layer.pipe(
    Layer.provide(runLayer),
    Layer.provide(verificationLayer),
    Layer.provide(ledgerLayer),
    Layer.provide(opLogLayer),
  ),
)
