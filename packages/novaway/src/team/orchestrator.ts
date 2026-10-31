import { Cause, Context, Effect, Exit, Layer } from "effect"
import { Service as TeamLedgerService, defaultLayer as ledgerLayer } from "./ledger"
import { Service as TeamOpLogService, defaultLayer as opLogLayer } from "./op-log"
import { summarize as attributeUsage } from "./attribution"
import { depsOf, normalize, stillValid, versions, type Dep } from "./artifacts"
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
  /**
   * 这次验证实际消耗的 token。
   *
   * 验证不在派发的预占里，但它是真金白银：不记账的话，预算上限只约束队长，
   * 而「验证器是否 affordable」就变成了没有人回答的问题（§7.1）。
   */
  usage?: { tokens?: number }
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

/**
 * 集成结果（§10.2）。判定由集成方给出，编排器只认结论：
 * 只有 `merged` 才能进入合并后的重验；冲突必须让运行停下来等人，而不是「先当成功」。
 */
export type IntegrationOutcome =
  | { kind: "merged"; sha: string; merged: string[]; directory?: string; branch?: string }
  | { kind: "conflict"; team: string; files: string[]; message: string }
  | { kind: "skipped"; reason: string }
  | { kind: "failed"; message: string }

export type Integrator = () => Effect.Effect<IntegrationOutcome>

/** 缺省并发：同时派发的团队数（§4.5）。 */
export const DEFAULT_CONCURRENCY = 3

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
  /**
   * 把团队工作区里未提交的改动落成提交（§10.1）。
   *
   * 必须在取快照之前调用：`git merge` 只认提交，验证也只认提交。成员写完却没提交时，
   * 验证会对着旧 `HEAD` 得出「通过」，而集成合不到任何东西。
   * 失败时调用方应当让该团队失败 —— 无法复验的交付不能算通过。
   */
  commit?: () => Effect.Effect<void, unknown>
  maxRounds?: number
  maxBusinessAttempts?: number
  /** 同时派发的团队数上限；缺省 3（§4.5），超出的团队排队等下一批。 */
  concurrency?: number
  /** 每次派发前预占的 token 数，返回后按实际用量结算。 */
  reserveTokens?: number
  /**
   * 串行集成：团队全部交付后、合并重验之前调用。
   * 提供时，集成结果决定后续重验跑在哪份代码上（见 handlers/run.ts 的快照切换）。
   */
  integrate?: Integrator
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
      // 同一运行不能同时跑两份：事件序号会打乱、账本会被重复预占、团队状态互相覆盖。
      if (run.state === "running" && run.phase)
        return yield* Effect.die(new Error("run already executing: " + run.phase))

      /**
       * 记一条验证结论，并同时写进事件流（§5.6 的 `verification.recorded`）。
       *
       * 设计原文把验证列为事件类型，而此前只有验证表 —— 表和事件各说一半，
       * 回放决策链时就必须再去猜「这条结论是第几轮得出的」。事件里只带结构字段，
       * 不带 `measured` 全文（那是给人看的原文，可能很长）。
       */
      const recordVerification = (entry: {
        acceptanceID: string
        snapshotID: string
        verifierVersion: string
        outcome: "pass" | "fail" | "unverified"
        measured?: string
        evidenceRef?: string
        attempt: number
        /** 这条验收归谁：团队 id，或全局验收时为运行 id。 */
        owner?: string
      }) =>
        Effect.gen(function* () {
          const saved = yield* verification.record(entry)
          yield* runs.appendEvent({
            runID: input.runID,
            kind: "verification.recorded",
            payload: {
              acceptanceID: entry.acceptanceID,
              attempt: entry.attempt,
              outcome: entry.outcome,
              snapshotID: entry.snapshotID,
              verifierVersion: entry.verifierVersion,
              ...(entry.owner ? { owner: entry.owner } : {}),
              ...(entry.evidenceRef ? { hasEvidence: true } : {}),
            },
          })
          return saved
        })

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

      /**
       * 验证消耗入账。
       *
       * 验证器不经过派发预占，但花的钱是真的；不记的话，预算上限管不到它（§7.1）。
       * 归属记到团队上：验证是「这支队的交付是否成立」的成本，不是另一个人的。
       */
      const chargeVerification = (teamID: string, result: VerificationResult) =>
        result.usage?.tokens && result.usage.tokens > 0
          ? ledger.record({ runID: input.runID, actor: teamID, tokens: result.usage.tokens }).pipe(
              Effect.asVoid,
              Effect.catchCause(() => Effect.void),
            )
          : Effect.void

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
          // 产物版本由内容决定（§8.6）：下游记下自己依赖的**具体版本**，
          // 上游一变，下游的「通过」就不是现在这件事的结论了。
          const artifacts = normalize(report.artifacts)
          yield* runs.updateTeam({
            id: team.id,
            report: report as unknown as Record<string, unknown>,
            artifactsOut: artifacts,
          })
          yield* runs.appendEvent({
            runID: input.runID,
            kind: "team.reported",
            payload: { teamID: team.id, round, claims: report.claims.length, done: report.done ?? false },
          })

          // 验收结论只来自验证器；成员报告里的 claims 只用来对照。
          // 先把工作区里的改动落成提交：快照与集成都只认提交。
          if (input.commit) {
            const committed = yield* Effect.exit(input.commit())
            if (Exit.isFailure(committed)) {
              yield* runs.updateTeam({ id: team.id, phase: "failed" })
              yield* runs.appendEvent({
                runID: input.runID,
                kind: "team.failed",
                payload: { teamID: team.id, round, reason: "commit", message: message(committed.cause) },
              })
              return
            }
          }
          const snapshot = yield* input.snapshot()
          for (const acceptance of teamLines) {
            const result = yield* Effect.exit(input.verify({ acceptance, report, team, round }))
            if (Exit.isFailure(result)) {
              // 验证器本身出错 -> 未验证，而不是失败，更不是通过。
              yield* recordVerification({
                acceptanceID: acceptance.id,
                snapshotID: snapshot,
                verifierVersion: "verifier-error",
                outcome: "unverified",
                measured: message(result.cause),
                attempt: round,
                owner: team.id,
              })
              continue
            }
            yield* chargeVerification(team.id, result.value)
            yield* recordVerification({
              acceptanceID: acceptance.id,
              snapshotID: result.value.snapshotID ?? snapshot,
              verifierVersion: result.value.verifierVersion ?? "v1",
              outcome: result.value.outcome,
              measured: result.value.measured,
              evidenceRef: result.value.evidenceRef,
              attempt: round,
              owner: team.id,
            })
          }

          const summary = yield* verification.summary({ runID: input.runID, currentSnapshot: snapshot })
          const ids = new Set(teamLines.map((acceptance) => acceptance.id))
          const lines = summary.lines.filter((line) => ids.has(line.acceptance.id))
          const failing = lines.filter((line) => line.outcome !== "pass")

          if (failing.length === 0) {
            // 记录这一版结论所依赖的上游产物版本；没有产物时 deps 为空（也就不会被失效传播）。
            const all = yield* runs.teams(input.runID)
            const upstream = versions(all.map((item, index) => ({ index, artifacts: item.artifactsOut })))
            const deps = depsOf({ deps: team.dependsOn, upstream })
            yield* runs.updateTeam({
              id: team.id,
              phase: "delivered",
              verdict: { verdict: "complete", pass: lines.length, round, deps },
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
            payload: {
              teamID: team.id,
              round,
              attempts: attempts.business,
              notes,
              // 结构化一份「哪条验收没过」：指标里的「驳回原因 TopN」据此统计，
              // 不靠解析上面那句给人看的中文。
              failed: failing.map((line) => ({ text: line.acceptance.text, outcome: line.outcome })),
            },
          })
        })

      /** 从裁决里读回下游依赖的上游版本（逐字段校验，坏数据当作没有依赖）。 */
      const depsFrom = (verdict: Record<string, unknown> | undefined): Dep[] => {
        const raw: unknown = verdict ? Reflect.get(verdict, "deps") : undefined
        if (!Array.isArray(raw)) return []
        const out: Dep[] = []
        for (const item of raw) {
          if (item === null || typeof item !== "object") continue
          const teamID: unknown = Reflect.get(item, "teamID")
          const name: unknown = Reflect.get(item, "name")
          const version: unknown = Reflect.get(item, "version")
          if (typeof teamID !== "number" || typeof name !== "string" || typeof version !== "string") continue
          out.push({ teamID, name, version })
        }
        return out
      }

      /**
       * 下游失效（§8.6）：上游产物版本变了，依赖它的「通过」立即作废。
       *
       * 把失效的团队退回 `rework`：它们的证据绑定的是旧产物，重验才有意义。
       * 只扫 `delivered` 的团队 —— 还在跑的团队本来就会在新一轮里看到最新产物。
       */
      const invalidate = (current: RunTeam[]) =>
        Effect.gen(function* () {
          const upstream = versions(current.map((team, index) => ({ index, artifacts: team.artifactsOut })))
          let count = 0
          for (const team of current) {
            if (team.phase !== "delivered") continue
            const deps = depsFrom(team.verdict)
            if (deps.length === 0) continue
            const verdict = stillValid(deps, upstream)
            if (verdict.valid) continue
            yield* runs.updateTeam({ id: team.id, phase: "rework" })
            // 重跑时必须说明「为什么」：不告诉队长上游变了，它会以为自己在重复劳动。
            feedback.set(
              team.id,
              verdict.broken.map(
                (dep) => "上游产物已更新（团队 " + dep.teamID + " 的 " + dep.name + "），请基于最新版本重新确认结论。",
              ),
            )
            yield* runs.appendEvent({
              runID: input.runID,
              kind: "team.invalidated",
              payload: { teamID: team.id, broken: verdict.broken },
            })
            count += 1
          }
          return count
        })

      let teams = yield* runs.teams(input.runID)
      let exceeded = false
      /** 最后一次集成尝试；冲突且轮次用尽时，它就是最终结论的依据。 */
      let integration: Exit.Exit<IntegrationOutcome> | undefined
      /** 集成前的提交是否失败过（失败则最终验证对着的不是团队写下的代码）。 */
      let commitBroken = false

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
          // 上游产物变了 → 下游的旧结论作废；退回 rework 的团队在下一轮重新派发。
          if ((yield* invalidate(teams)) > 0) teams = yield* runs.teams(input.runID)
          const byID = new Map(teams.map((team, index) => [index, team]))
          // 依赖按团队在本次运行中的顺序下标记录；未交付的依赖不算满足。
          const ready = teams.filter((team) => {
            if (team.phase !== "queued") return false
            return team.dependsOn.every((dep) => byID.get(dep)?.phase === "delivered")
          })
          if (ready.length === 0) break
          // 并发上限（§4.5）：缺省 3，超出的团队排队。不设上限时十个团队会同时烧钱，
          // 而同一个 worktree 上的写操作本来也要排队 —— 并发的好处抵不过成本。
          yield* Effect.forEach(ready, (team) => attempt(team, rounds), {
            concurrency: Math.max(1, Math.min(ready.length, input.concurrency ?? DEFAULT_CONCURRENCY)),
            discard: true,
          })
          progressed = true
        }

        teams = yield* runs.teams(input.runID)
        // 全部交付 → 先集成。冲突不落进「完成」：把冲突团队退回去，带上文件清单进入下一轮。
        if (teams.length > 0 && teams.every((team) => team.phase === "delivered")) {
          // 集成前提交：交付之后到集成之间还可能有改动（收尾脚本、格式化），
          // 合并的必须是磁盘上的最终内容。
          if (input.commit) {
            const committed = yield* Effect.exit(input.commit())
            if (Exit.isFailure(committed)) {
              // 提交失败意味着集成会合到旧内容：那之后的「通过」不能算交付。
              commitBroken = true
              yield* runs.appendEvent({
                runID: input.runID,
                kind: "integration.commit_failed",
                payload: { message: message(committed.cause) },
              })
            }
          }
          if (!input.integrate) break
          const attempt = yield* Effect.exit(input.integrate())
          integration = attempt
          if (Exit.isSuccess(attempt) && attempt.value.kind === "conflict") {
            const outcome = attempt.value
            // `integrate()` 给的是团队名（profileID ?? id），这里换回团队行。
            const conflicted = teams.find((team) => (team.profileID ?? team.id) === outcome.team)
            if (conflicted) {
              feedback.set(conflicted.id, [
                "合并冲突：" +
                  (outcome.files.length > 0 ? outcome.files.join("、") : "（未列出文件）") +
                  "。请与上游团队协调后重新交付，不要覆盖别人的改动。",
              ])
              yield* runs.updateTeam({ id: conflicted.id, phase: "rework" })
            }
            yield* runs.appendEvent({
              runID: input.runID,
              kind: "team.conflict",
              payload: { team: outcome.team, files: outcome.files, round: rounds },
            })
            continue
          }
          break
        }
        if (attempts.business >= maxBusiness) {
          exceeded = true
          break
        }
        // 一个团队都推不动（全部在等依赖 / 等确认）才算 blocked。
        if (teams.some((team) => team.phase === "running")) continue
        if (teams.every((team) => team.phase === "delivered" || team.phase === "failed" || team.phase === "exceeded"))
          break
      }

      // 集成已经在循环里做过（全部交付时）；这里只记录最终结果。
      // 失败不算「跑完」—— 冲突要么返工要么由人接手，绝不能落进 done。
      if (integration && Exit.isFailure(integration)) {
        yield* runs.appendEvent({
          runID: input.runID,
          kind: "integration.failed",
          payload: { message: message(integration.cause) },
        })
      } else if (integration) {
        const outcome = integration.value
        yield* runs.appendEvent({
          runID: input.runID,
          kind: "integration." + outcome.kind,
          payload: {
            ...(outcome.kind === "merged"
              ? { sha: outcome.sha, merged: outcome.merged, directory: outcome.directory, branch: outcome.branch }
              : {}),
            ...(outcome.kind === "conflict" ? { team: outcome.team, files: outcome.files } : {}),
            ...(outcome.kind === "skipped" ? { reason: outcome.reason } : {}),
            ...(outcome.kind === "failed" ? { message: outcome.message } : {}),
          },
        })
      }
      // 集成没成功时，后面在「未合并的快照」上得出的通过结论不具备可交付性。
      // 提交失败同理：集成合到的是旧内容，最终验证对着的不是团队写下的代码。
      let integrationBroken =
        commitBroken ||
        (!!integration &&
          (Exit.isFailure(integration) || integration.value.kind === "conflict" || integration.value.kind === "failed"))

      // 合并后的重验：快照变了，之前团队的证据一律作废，
      // 必须在最终快照上重新验证（合并后的验收永远是重档，见 §10 / §19.1）。
      //
      // 重验失败时，把责任团队退回重做**一次**：重验是重档、代价高，不能每轮都跑；
      // 但「合并后才暴露的问题」正是返工该发生的地方。第二次仍失败就照实记 partial。
      const recheckAll = (snapshot: string, teamByID: Map<string, RunTeam>) =>
        Effect.gen(function* () {
          const recordResult = (
            acceptance: Acceptance,
            result: Exit.Exit<VerificationResult, unknown>,
            fallbackVersion: string,
            teamID: string,
          ) =>
            Effect.gen(function* () {
              if (Exit.isSuccess(result)) yield* chargeVerification(teamID, result.value)
              yield* recordVerification({
                acceptanceID: acceptance.id,
                snapshotID: Exit.isSuccess(result) ? (result.value.snapshotID ?? snapshot) : snapshot,
                verifierVersion: Exit.isSuccess(result)
                  ? (result.value.verifierVersion ?? fallbackVersion)
                  : "verifier-error",
                outcome: Exit.isSuccess(result) ? result.value.outcome : "unverified",
                measured: Exit.isSuccess(result) ? result.value.measured : message(result.cause),
                evidenceRef: Exit.isSuccess(result) ? result.value.evidenceRef : undefined,
                attempt: rounds + 1,
                owner: teamID,
              })
            })

          for (const acceptance of acceptances) {
            if (!acceptance.owner) {
              if (!input.verifyMerged) {
                yield* recordVerification({
                  acceptanceID: acceptance.id,
                  snapshotID: snapshot,
                  verifierVersion: "none",
                  outcome: "unverified",
                  measured: "未配置合并验收验证器",
                  attempt: rounds + 1,
                  owner: input.runID,
                })
                continue
              }
              const merged = yield* Effect.exit(input.verifyMerged({ acceptance, snapshotID: snapshot }))
              // 全局验收不属于任何团队：成本记在运行上（actor 用 runID），
              // 免得把「合并后才验的那几条」摊给某一支队。
              yield* recordResult(acceptance, merged, "merged", input.runID)
              continue
            }
            const team = teamByID.get(acceptance.owner)
            if (!team) {
              yield* recordVerification({
                acceptanceID: acceptance.id,
                snapshotID: snapshot,
                verifierVersion: "none",
                outcome: "unverified",
                measured: "验收归属的团队不在本次运行中",
                attempt: rounds + 1,
                owner: input.runID,
              })
              continue
            }
            const report = (team.report as unknown as Report | undefined) ?? {
              teamID: team.id,
              summary: "",
              claims: [],
            }
            const recheck = yield* Effect.exit(input.verify({ acceptance, report, team, round: rounds + 1 }))
            yield* recordResult(acceptance, recheck, "v1", team.id)
          }
        })

      let mergeSnapshot = yield* input.snapshot()
      let mergeReworked = false
      for (;;) {
        const snapshot = mergeSnapshot
        teams = yield* runs.teams(input.runID)
        const teamByID = new Map(teams.map((team) => [team.id, team]))

        yield* recheckAll(snapshot, teamByID)
        const merged = yield* verification.summary({ runID: input.runID, currentSnapshot: snapshot })

        // 最新结论不是 pass、且有归属团队的验收项 → 这些团队需要重做。
        const responsible = new Map<string, { notes: string[]; failed: Array<{ text: string; outcome: string }> }>()
        for (const line of merged.lines) {
          if (!line.acceptance.owner || line.outcome === "pass") continue
          const entry = responsible.get(line.acceptance.owner) ?? { notes: [], failed: [] }
          entry.notes.push("合并后重验未通过：" + line.acceptance.text + "（" + line.outcome + "）")
          entry.failed.push({ text: line.acceptance.text, outcome: line.outcome })
          responsible.set(line.acceptance.owner, entry)
        }
        if (mergeReworked || responsible.size === 0 || attempts.business >= maxBusiness) break

        // 只重试一次：责任团队退回、重跑、提交、重新集成，然后在新快照上再验一遍。
        mergeReworked = true
        for (const [teamID, entry] of responsible) {
          feedback.set(teamID, entry.notes)
          yield* runs.updateTeam({ id: teamID, phase: "queued" })
          yield* runs.appendEvent({
            runID: input.runID,
            kind: "team.rework",
            payload: { teamID, reason: "merged-verification", notes: entry.notes, failed: entry.failed },
          })
        }
        rounds += 1
        for (const teamID of responsible.keys()) {
          const team = (yield* runs.teams(input.runID)).find((item) => item.id === teamID)
          if (team) yield* attempt(team, rounds)
        }
        // 合并的必须是磁盘上的最终内容：返工后同样先提交再集成。
        if (input.commit) {
          const committed = yield* Effect.exit(input.commit())
          if (Exit.isFailure(committed)) {
            commitBroken = true
            yield* runs.appendEvent({
              runID: input.runID,
              kind: "integration.commit_failed",
              payload: { message: message(committed.cause) },
            })
          }
        }
        integration = input.integrate ? yield* Effect.exit(input.integrate()) : integration
        integrationBroken =
          commitBroken ||
          (!!integration &&
            (Exit.isFailure(integration) ||
              integration.value.kind === "conflict" ||
              integration.value.kind === "failed"))
        mergeSnapshot = yield* input.snapshot()
      }

      const snapshot = mergeSnapshot
      const summary = yield* verification.summary({ runID: input.runID, currentSnapshot: snapshot })
      teams = yield* runs.teams(input.runID)
      // 有结果不明的工具操作时，不允许宣称完成——先让人核对副作用。
      const pending = yield* ops.needsReview(input.runID)
      const allDelivered = teams.length > 0 && teams.every((team) => team.phase === "delivered")
      const anyDelivered = teams.some((team) => team.phase === "delivered")
      const anyExceeded = teams.some((team) => team.phase === "exceeded")
      const usage = yield* ledger.usage({ runID: input.runID, cap })
      // 用量归属（§10.3）：总量回答「花了多少」，归属回答「谁花的」。
      const attribution = attributeUsage({ entries: yield* ledger.entries(input.runID), teams })

      const state: RunState =
        exceeded || anyExceeded
          ? "exceeded"
          : pending.length > 0
            ? "needs_review"
            : integrationBroken
              ? anyDelivered
                ? "partial"
                : "failed"
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
          byActor: attribution.byActor,
          byJob: attribution.byJob,
        },
        mergedVerification: summary as unknown as Record<string, unknown>,
        endedAt: isTerminal(state) ? Date.now() : undefined,
        terminalReason: state,
        error:
          state === "failed"
            ? integrationBroken
              ? "集成未完成，团队结果不构成可交付"
              : "没有团队产出可交付结果"
            : state === "exceeded"
              ? "尝试次数或预算超限"
              : state === "partial" && integrationBroken
                ? "集成冲突：团队已交付，但合并后的代码尚未验证"
                : null,
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
          integration: integration ? (Exit.isSuccess(integration) ? integration.value.kind : "failed") : "none",
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
