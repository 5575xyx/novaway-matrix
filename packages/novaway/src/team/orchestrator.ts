import { Cause, Context, Effect, Exit, Layer, Option } from "effect"
import { Service as TeamLedgerService, defaultLayer as ledgerLayer } from "./ledger"
import { Service as TeamOpLogService, defaultLayer as opLogLayer } from "./op-log"
import { summarize as attributeUsage } from "./attribution"
import { depsOf, normalize, stillValid, versions, type Dep } from "./artifacts"
import { classify, type Failure, type FailureKind } from "./failure"
import { Service as TeamRunService, defaultLayer as runLayer, isTerminal, type RunState, type RunTeam } from "./run"
import { describe as describeAddressing, type Problem } from "./roster"
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
  /** 本次派发实际消耗；`cost` 只在提供方权威回报时有值。 */
  usage?: { tokens?: number; cost?: number }
  done?: boolean
  /**
   * 这次回复读不出报告（§8.4）：值是一句结构性的原因，不是模型原文。
   *
   * 有它就说明「这一轮不算数」，调度器会重新问一次，并且**不消耗业务额度** ——
   * 格式问题不是「没做到」，混进 business 计数会让用户看到错误的失败原因。
   */
  malformed?: string
}

export type VerificationResult = {
  outcome: "pass" | "fail" | "unverified"
  measured?: string
  evidenceRef?: string
  verifierVersion?: string
  /** 结论复用自同一快照上的另一次验证；界面与事件都要标出来（§19.1）。 */
  reused?: boolean
  /** 验证针对的代码快照；缺省用调度器传入的当前快照。 */
  snapshotID?: string
  /**
   * 这次验证实际消耗的 token 与成本。
   *
   * 验证不在派发的预占里，但它是真金白银：不记账的话，预算上限只约束队长，
   * 而「验证器是否 affordable」就变成了没有人回答的问题（§7.1）。
   */
  usage?: { tokens?: number; cost?: number }
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

/**
 * 零进展上限（§9）。一次队长调用 30 分钟毫无结果，基本只有一种解释：它挂住了。
 *
 * 这不是「跑得久就算超时」：只要模型还在推进（工具调用、流式输出），会话会持续给信号；
 * 这里挡住的是**完全没有进展**。真正的成本控制是运行级的 `budget.wallMs`，
 * 它管「值不值得继续花钱」，这里只管「还活着吗」。
 */
export const DEFAULT_DISPATCH_TIMEOUT_MS = 30 * 60_000

/** 验证是一次单轮判断，比队长快得多；同样的理由，只是上限更短。 */
export const DEFAULT_VERIFY_TIMEOUT_MS = 10 * 60_000

export type Dispatcher = (input: DispatchInput) => Effect.Effect<Report, unknown>
export type Verifier = (input: VerifyInput) => Effect.Effect<VerificationResult, unknown>

/**
 * 寻址失败的一项（§9）：某个该接活的人已经接不了。
 *
 * 判定与措辞都归名册模块（`team/roster`）：调度器只负责「有人接不了 → 这一轮不派发」，
 * 不重新定义什么叫归档。
 */
export type AddressingProblem = Problem

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
  /**
   * 当前代码快照，验证结果与它绑定。
   *
   * 给了目录就取那个目录的 HEAD —— 每个团队必须拿**自己**副本的快照：
   * 两队并行时共用一个快照，后一队的「通过」会被判成过期，重做到轮次用尽。
   * 不给目录是合并后的重验：由调用方决定看哪个目录（集成目录）。
   */
  snapshot: (directory?: string) => Effect.Effect<string>
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
  /** 格式重试上限（§7.2）：读不出报告的回复最多重问几次，与业务额度分开计数。 */
  maxFormatRetries?: number
  /**
   * 单次队长调用的零进展上限（§9）。缺省 30 分钟。
   *
   * 超时按「这一轮没有交付」处理：团队记 `failed`，裁决是 `timeout`，
   * 事件里带结构化原因 —— 与「没有做到」区分开，用户才知道该重试还是该改要求。
   */
  dispatchTimeoutMs?: number
  /** 单次验证调用的零进展上限；超时记为 `unverified`，不是 `fail`。 */
  verifyTimeoutMs?: number
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
  /**
   * 寻址校验（§9）：派发前确认这个团队名册里的人现在还能接活。
   *
   * 返回非空即「这一轮不派发」，团队按失败处理并列出问题成员。**不跳过、不静默改派**：
   * 悄悄换一个人接着干，会让「谁做了什么」这件事在事后无法回答。
   * 不提供 = 不做这项校验（临时团队的成员是会话，本来就不在员工库里）。
   */
  addressing?: (team: RunTeam) => Effect.Effect<readonly AddressingProblem[]>
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
        /** 复用同快照结论（§19.1）：事件里也标出来，回放不能把它当成新验证。 */
        reused?: boolean
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
              ...(entry.reused ? { reused: true } : {}),
            },
          })
          return saved
        })

      const cap = { tokens: run.budget?.tokens ?? 0 }
      /**
       * 给验收与收尾留的额度（§7.1 第 4 条）：派发只能花掉批准额度的 85%。
       *
       * 验证不在派发的预占里，但它确实花钱。把批准的额度全部分给成员，
       * 验证再花就必然越过用户批准的上限 —— 那不是「预算硬上限」，只是「派发硬上限」。
       * 留出的是**派发额度**，不是另一种上限：用户看到的 `cap` 仍是批准值。
       */
      const DISPATCH_SHARE = 0.85
      const dispatchCap = { tokens: cap.tokens === 0 ? 0 : Math.max(1, Math.floor(cap.tokens * DISPATCH_SHARE)) }
      const reserveTokens = input.reserveTokens ?? 4000
      const maxRounds = input.maxRounds ?? 3
      const maxBusiness = input.maxBusinessAttempts ?? 6
      const maxFormat = input.maxFormatRetries ?? 3
      const dispatchTimeout = input.dispatchTimeoutMs ?? DEFAULT_DISPATCH_TIMEOUT_MS
      const verifyTimeout = input.verifyTimeoutMs ?? DEFAULT_VERIFY_TIMEOUT_MS

      /**
       * 一次验证的落点：有结论 / 没结论。
       *
       * 「没结论」有两种来源 —— 验证器报错、验证器超时 —— 它们都不进 `pass`，
       * 也都不是 `fail`。收成一个类型，是为了让主循环与合并后重验用同一套判定，
       * 不至于一处超时、另一处就一直挂着。
       */
      type Settled =
        | { kind: "result"; value: VerificationResult }
        | { kind: "no-conclusion"; failure: Failure }
      const settleVerify = (
        exit: Exit.Exit<Option.Option<VerificationResult>, unknown>,
        fallback: FailureKind,
      ): Settled => {
        if (Exit.isFailure(exit)) return { kind: "no-conclusion", failure: classify(exit.cause, fallback) }
        if (Option.isNone(exit.value))
          return {
            kind: "no-conclusion",
            failure: { kind: "timeout", message: "验证超过 " + verifyTimeout + " ms 没有结论" },
          }
        return { kind: "result", value: exit.value.value }
      }

      /**
       * 墙钟上限（§7.3）：只在轮次与派发批次之间检查。
       *
       * 一次派发已经在跑时中断它，只会留下半成品与重复副作用；「超过即停」停的是
       * **新的**派发。按本次执行计时（恢复不继承上一次的墙钟），token 上限则是累计的 ——
       * 两个上限回答的问题不同：一个问「这次跑了多久」，一个问「一共花了多少」。
       *
       * 缺省（未写 `wallMs`）= 不限；显式 `0` = 一分钟都不给，立刻停 ——
       * 「没写」与「写了 0」必须能分开，否则测试与用户都没法确定它到底管不管。
       */
      const wallStart = Date.now()
      const wallMs = run.budget?.wallMs
      const costCap = run.budget?.cost
      /**
       * 硬上限到期了就说清楚是哪一条（§7.3）。
       *
       * 成本与墙钟的语义刻意一致：成本只在调用**返回后**才有权威值（调用前无法预占），
       * 所以它停的也是新派发，而不是掐断正在跑的模型调用。缺省 = 不限，显式 `0` = 立刻停。
       */
      const limitHit = () =>
        Effect.gen(function* () {
          if (wallMs !== undefined && Date.now() - wallStart >= wallMs)
            return { reason: "墙钟超出上限（" + wallMs + " ms）", wallMs }
          if (costCap !== undefined) {
            const current = yield* ledger.usage({ runID: input.runID })
            if (current.settledCost >= costCap)
              return { reason: "成本超出上限（" + costCap + "）", cost: costCap }
          }
          return undefined
        })
      const stopForLimit = (current: RunTeam[], limit: { reason: string; wallMs?: number; cost?: number }) =>
        Effect.gen(function* () {
          for (const team of current) {
            if (team.phase === "queued" || team.phase === "rework")
              yield* runs.updateTeam({ id: team.id, phase: "exceeded" })
          }
          yield* runs.appendEvent({
            runID: input.runID,
            kind: "budget.exceeded",
            payload: limit,
          })
        })
      const acceptances = yield* verification.list(input.runID)
      const attempts = { ...run.attempts }

      yield* runs.update({
        runID: input.runID,
        state: "running",
        phase: "executing",
        startedAt: run.startedAt ?? Date.now(),
      })

      /**
       * 从 blocked 再次执行 = 显式重试（§8.1 的「处理 → running」）。
       *
       * 把失败过的团队放回队列：它们当初失败的往往正是阻塞的原因（名册被归档、权限被拒、
       * 一次临时错误），用户修好后再点一次应当重试，而不是带着 `failed` 直接再判一次 `blocked`。
       * `delivered` 不重跑（已经交付的结论仍然成立），`exceeded` 也不重跑（再跑要先加预算）。
       */
      if (run.state === "blocked") {
        const retry = (yield* runs.teams(input.runID)).filter((team) => team.phase === "failed")
        for (const team of retry) yield* runs.updateTeam({ id: team.id, phase: "queued" })
        if (retry.length > 0)
          yield* runs.appendEvent({
            runID: input.runID,
            kind: "unblocked",
            payload: { teams: retry.map((team) => team.id) },
          })
      }

      let rounds = 0
      // 打回意见按团队保存，下一轮派发时随任务一起下发。
      const feedback = new Map<string, string[]>()

      const cancelled = () => input.signal?.aborted === true
      /**
       * 取消信号变成「可以被 race 的中断」。
       *
       * 只靠循环检查点是不够的：一次派发已经在跑时，检查点根本没机会执行 ——
       * 用户点了停止，编排器还要等队长调用自己结束（最坏是零进展上限 30 分钟）。
       * 这里让在途派发与信号赛跑：信号先到就打断这次派发，收尾仍走三段式。
       */
      const stopSignal = Effect.callback<never>((resume) => {
        const signal = input.signal
        if (!signal) return resume(Effect.never)
        if (signal.aborted) return resume(Effect.interrupt)
        const onAbort = () => resume(Effect.interrupt)
        signal.addEventListener("abort", onAbort, { once: true })
        return Effect.sync(() => signal.removeEventListener("abort", onAbort))
      })

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
          usage: { reserved: usage.reserved, settled: usage.settled, cost: usage.settledCost },
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
       * 全局阻塞（§8.1 / §4.4）：所有剩余团队都在等一个不会到来的依赖。
       *
       * 与 `failed` 的区别：没有谁做错，只是有上游永远交付不了。团队保持 `queued`，
       * 依赖修好后用户可以再次执行（`blocked → running`）。事件与状态里只留结构
       * （团队 id、在等哪几个下标）—— 不把目标、brief 或提示词搬进日志。
       */
      const finishBlocked = Effect.fn("TeamOrchestrator.blocked")(function* (current: RunTeam[]) {
        const waiting = current
          .filter((team) => team.phase === "queued")
          .map((team) => ({
            teamID: team.id,
            waitingOn: team.dependsOn.filter((dep) => current[dep]?.phase !== "delivered"),
          }))
        yield* runs.appendEvent({
          runID: input.runID,
          kind: "blocked",
          payload: { round: rounds, teams: waiting },
        })
        const usage = yield* ledger.usage({ runID: input.runID, cap })
        const summary = yield* verification.summary({ runID: input.runID })
        yield* runs.update({
          runID: input.runID,
          state: "blocked",
          phase: null,
          attempts: { ...attempts },
          usage: {
            reserved: usage.reserved,
            settled: usage.settled,
            unknown: usage.unknown,
            cost: usage.settledCost,
            cap: usage.cap,
            overrun: usage.overrun,
          },
          // 原因里只写坐标：用户要能一眼看出是谁在等谁，而不是去翻提示词。
          error:
            "所有剩余团队都在等待不会到来的依赖：" +
            waiting.map((item) => item.teamID + " 等待 " + item.waitingOn.join("、")).join("；"),
          terminalReason: "blocked",
        })
        return {
          state: "blocked" as const,
          rounds,
          summary,
          teams: current.map((team) => ({ teamID: team.id, phase: team.phase, verdict: team.verdict })),
        }
      })

      /**
       * 验证消耗入账。
       *
       * 验证器不经过派发预占，但花的钱是真的；不记的话，预算上限管不到它（§7.1）。
       * 归属记到团队上：验证是「这支队的交付是否成立」的成本，不是另一个人的。
       * `kind: "verification"` 让「验证开销占比」算得出来（§12）：归属仍是团队，
       * 但花在哪件事上不再靠猜。
       */
      const chargeVerification = (teamID: string, result: VerificationResult) =>
        (result.usage?.tokens ?? 0) > 0 || (result.usage?.cost ?? 0) > 0
          ? ledger
              .record({
                runID: input.runID,
                actor: teamID,
                kind: "verification",
                tokens: result.usage?.tokens ?? 0,
                ...(result.usage?.cost !== undefined ? { cost: result.usage.cost } : {}),
              })
              .pipe(Effect.asVoid, Effect.catchCause(() => Effect.void))
          : Effect.void

      /** 本轮派发被寻址校验拦下的团队（§9）：收尾时要说清楚，而不是只留一条事件。 */
      const addressingFailed: Array<{ teamID: string; problems: readonly AddressingProblem[] }> = []

      /** 单团队一轮：寻址 → 预占 → 派发 → 验证 → 判定。失败不影响其他团队。 */
      const attempt = (team: RunTeam, round: number) =>
        Effect.gen(function* () {
          /**
           * 寻址（§9）：名册里的人接不了活，这一轮就一轮都不派。
           *
           * 放在预占之前：人都派不出去，没有理由先占住额度。团队按失败处理而不是
           * 「排队等下次」，因为等下去名册也不会自己好起来 —— 要么人恢复，要么由人改派。
           */
          const addressed = input.addressing ? yield* input.addressing(team) : []
          if (addressed.length > 0) {
            addressingFailed.push({ teamID: team.id, problems: addressed })
            yield* runs.updateTeam({
              id: team.id,
              phase: "failed",
              verdict: { verdict: "addressing_failed", members: addressed },
            })
            yield* runs.appendEvent({
              runID: input.runID,
              kind: "team.addressing_failed",
              payload: { teamID: team.id, round, reason: describeAddressing(addressed), members: addressed },
            })
            return
          }

          const teamLines = acceptances.filter((acceptance) => acceptance.owner === team.id)

          /**
           * 派发 + 结算。格式读不出来时**重新问一次**（§8.4）：
           *
           * - 每次都真的跑了一轮队长，所以每次都要预占与结算（钱是花掉的）；
           * - 但格式问题不消耗业务额度，只加 `attempts.formatRetry`；
           * - 连续读不出超过上限，才按「格式错误」判这一队失败 —— 原因是格式，不是没做到。
           */
          let report: Report | undefined
          while (!report) {
            const reservation = yield* Effect.exit(
              ledger.reserve({ runID: input.runID, actor: team.id, tokens: reserveTokens, cap: dispatchCap }),
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
              Effect.raceFirst(
                input
                  .dispatch({
                    team,
                    round,
                    acceptance: teamLines,
                    feedback: feedback.get(team.id),
                  })
                  // 零进展上限（§9）：挂住的调用不会一直占着这次运行。
                  .pipe(Effect.timeoutOption(dispatchTimeout)),
                // 停止请求同样能打断在途派发（见 stopSignal）。
                stopSignal,
              ),
            )

            if (Exit.isFailure(dispatched)) {
              yield* ledger.settle({ id: reservation.value.id, tokens: 0 })
              // 被取消打断不是团队的失败：事件里不该留下一条「团队做错了什么」，
              // 收尾交给三段式取消（finishCancelled 会把未交付的团队记成 cancelled）。
              if (cancelled()) return
              const failure = classify(dispatched.cause)
              yield* runs.updateTeam({ id: team.id, phase: "failed", verdict: { verdict: failure.kind } })
              yield* runs.appendEvent({
                runID: input.runID,
                kind: "team.failed",
                payload: { teamID: team.id, round, kind: failure.kind, message: failure.message },
              })
              return
            }

            // 超时也是「没有交付」，但它不是模型的判定：单独一种裁决，别混进 unknown。
            if (Option.isNone(dispatched.value)) {
              yield* ledger.settle({ id: reservation.value.id, tokens: 0 })
              if (cancelled()) return
              yield* runs.updateTeam({ id: team.id, phase: "failed", verdict: { verdict: "timeout", timeoutMs: dispatchTimeout } })
              yield* runs.appendEvent({
                runID: input.runID,
                kind: "team.failed",
                payload: { teamID: team.id, round, kind: "timeout", reason: "timeout", timeoutMs: dispatchTimeout },
              })
              return
            }

            const next = dispatched.value.value
            yield* ledger.settle({
              id: reservation.value.id,
              tokens: next.usage?.tokens,
              ...(next.usage?.cost !== undefined ? { cost: next.usage.cost } : {}),
            })
            if (!next.malformed) {
              report = next
              break
            }

            attempts.formatRetry += 1
            // 计数落库：重启恢复后不能把已经用掉的格式重试重新送一遍。
            yield* runs.update({ runID: input.runID, attempts: { ...attempts } })
            yield* runs.appendEvent({
              runID: input.runID,
              kind: "team.format_retry",
              payload: { teamID: team.id, round, attempt: attempts.formatRetry, max: maxFormat, reason: next.malformed },
            })
            if (attempts.formatRetry >= maxFormat) {
              yield* runs.updateTeam({
                id: team.id,
                phase: "failed",
                verdict: { verdict: "format", reason: next.malformed, attempts: attempts.formatRetry },
              })
              yield* runs.appendEvent({
                runID: input.runID,
                kind: "team.failed",
                payload: {
                  teamID: team.id,
                  round,
                  reason: "format",
                  message: next.malformed,
                  attempts: attempts.formatRetry,
                },
              })
              return
            }
          }
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
              const failure = classify(committed.cause, "commit")
              yield* runs.updateTeam({ id: team.id, phase: "failed", verdict: { verdict: "commit" } })
              yield* runs.appendEvent({
                runID: input.runID,
                kind: "team.failed",
                payload: { teamID: team.id, round, reason: "commit", kind: failure.kind, message: failure.message },
              })
              return
            }
          }
          // 没有副本的团队在自己的工作区里跑：快照也要取那里，才和 `verify` 一致。
          const snapshot = yield* input.snapshot(team.worktree ?? run.directory)
          /**
           * 验证没给出结论（验证器出错 / 超时）。
           *
           * 结论只能是 `unverified`：不是「没做到」，更不是「通过」。事件里带上结构化原因，
           * 回放与门禁才分得清「产品有问题」和「验证器坏了」。
           */
          const recordUnverified = (acceptance: Acceptance, failure: Failure) =>
            Effect.gen(function* () {
              yield* recordVerification({
                acceptanceID: acceptance.id,
                snapshotID: snapshot,
                verifierVersion: failure.kind === "timeout" ? "verifier-timeout" : "verifier-error",
                outcome: "unverified",
                measured: failure.message,
                attempt: round,
                owner: team.id,
              })
              yield* runs.appendEvent({
                runID: input.runID,
                kind: "verification.failed",
                payload: { acceptanceID: acceptance.id, attempt: round, kind: failure.kind, teamID: team.id },
              })
            })

          for (const acceptance of teamLines) {
            const result = yield* Effect.exit(
              input.verify({ acceptance, report, team, round }).pipe(Effect.timeoutOption(verifyTimeout)),
            )
            const settled = settleVerify(result, "verifier")
            if (settled.kind === "no-conclusion") {
              yield* recordUnverified(acceptance, settled.failure)
              continue
            }
            const value = settled.value
            yield* chargeVerification(team.id, value)
            yield* recordVerification({
              acceptanceID: acceptance.id,
              snapshotID: value.snapshotID ?? snapshot,
              verifierVersion: value.verifierVersion ?? "v1",
              outcome: value.outcome,
              measured: value.measured,
              evidenceRef: value.evidenceRef,
              ...(value.reused ? { reused: true } : {}),
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
        // 墙钟 / 成本用尽：不再开新一轮，也不再派发任何团队。
        const limit = yield* limitHit()
        if (limit) {
          yield* stopForLimit(teams, limit)
          exceeded = true
          break
        }
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
          // 一批派发之前再查一次：一轮里可能有多个依赖链批次，不能等轮末才停。
          const limit = yield* limitHit()
          if (limit) {
            yield* stopForLimit(teams, limit)
            exceeded = true
            break
          }
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
              const failure = classify(committed.cause, "commit")
              yield* runs.appendEvent({
                runID: input.runID,
                kind: "integration.commit_failed",
                payload: { kind: failure.kind, message: failure.message },
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
              const notes = [
                "合并冲突：" +
                  (outcome.files.length > 0 ? outcome.files.join("、") : "（未列出文件）") +
                  "。请与上游团队协调后重新交付，不要覆盖别人的改动。",
              ]
              feedback.set(conflicted.id, notes)
              yield* runs.updateTeam({ id: conflicted.id, phase: "rework" })
              // 打回也要进事件：只有 team.conflict 的话，事后回放看不出「谁被退回了、
              // 拿到了什么意见」，而这正是下一轮重做的依据。
              yield* runs.appendEvent({
                runID: input.runID,
                kind: "team.rework",
                payload: {
                  teamID: conflicted.id,
                  round: rounds,
                  reason: "integration-conflict",
                  notes,
                  files: outcome.files,
                  attempts: attempts.business,
                },
              })
            }
            yield* runs.appendEvent({
              runID: input.runID,
              kind: "team.conflict",
              payload: { team: outcome.team, files: outcome.files, round: rounds },
            })
            // 打回写的是库里的阶段，本地 `teams` 还是打回前的样子。不刷新的话，
            // 下一轮开头「rework → queued」的扫描会漏掉它，那一轮就空转过去 ——
            // 轮次照常消耗，冲突团队却一次都没被重新派发。
            teams = yield* runs.teams(input.runID)
            continue
          }
          break
        }
        if (attempts.business >= maxBusiness) {
          exceeded = true
          break
        }
        // 还有团队在跑 / 等下一轮返工：它们会带来新状态，继续下一轮。
        if (teams.some((team) => team.phase === "running" || team.phase === "rework")) continue
        // 所有团队都已有结论（交付 / 失败 / 超限）：走正常结算。
        if (teams.every((team) => team.phase === "delivered" || team.phase === "failed" || team.phase === "exceeded"))
          break
        // 剩下的团队只能是在等依赖，而那些依赖不会自己好起来（上游失败了 / 依赖成环）。
        // 再转几轮也只会把轮次烧光，最后报成一句「没有团队产出可交付结果」，
        // 看不出真正原因 —— §8.1：这时是全局 `blocked`，不是 `failed`。
        if (!teams.some((team) => team.phase === "queued")) break
        // 有结果不明的工具操作时先交给人核对副作用：`needs_review` 比 `blocked` 更要紧。
        if ((yield* ops.needsReview(input.runID)).length > 0) break
        return yield* finishBlocked(teams)
      }

      // 集成已经在循环里做过（全部交付时）；这里只记录最终结果。
      // 失败不算「跑完」—— 冲突要么返工要么由人接手，绝不能落进 done。
      if (integration && Exit.isFailure(integration)) {
        const failure = classify(integration.cause)
        yield* runs.appendEvent({
          runID: input.runID,
          kind: "integration.failed",
          payload: { kind: failure.kind, message: failure.message },
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
          const recordResult = (acceptance: Acceptance, settled: Settled, fallbackVersion: string, teamID: string) =>
            Effect.gen(function* () {
              if (settled.kind === "no-conclusion") {
                // 重验没有结论：同样是 unverified，带上它是超时还是验证器坏了。
                yield* recordVerification({
                  acceptanceID: acceptance.id,
                  snapshotID: snapshot,
                  verifierVersion: settled.failure.kind === "timeout" ? "verifier-timeout" : "verifier-error",
                  outcome: "unverified",
                  measured: settled.failure.message,
                  attempt: rounds + 1,
                  owner: teamID,
                })
                yield* runs.appendEvent({
                  runID: input.runID,
                  kind: "verification.failed",
                  payload: { acceptanceID: acceptance.id, attempt: rounds + 1, kind: settled.failure.kind, teamID },
                })
                return
              }
              const value = settled.value
              yield* chargeVerification(teamID, value)
              yield* recordVerification({
                acceptanceID: acceptance.id,
                snapshotID: value.snapshotID ?? snapshot,
                verifierVersion: value.verifierVersion ?? fallbackVersion,
                outcome: value.outcome,
                measured: value.measured,
                evidenceRef: value.evidenceRef,
                ...(value.reused ? { reused: true } : {}),
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
              const merged = yield* Effect.exit(
                input.verifyMerged({ acceptance, snapshotID: snapshot }).pipe(Effect.timeoutOption(verifyTimeout)),
              )
              // 全局验收不属于任何团队：成本记在运行上（actor 用 runID），
              // 免得把「合并后才验的那几条」摊给某一支队。
              yield* recordResult(acceptance, settleVerify(merged, "verifier"), "merged", input.runID)
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
            const recheck = yield* Effect.exit(
              input.verify({ acceptance, report, team, round: rounds + 1 }).pipe(Effect.timeoutOption(verifyTimeout)),
            )
            yield* recordResult(acceptance, settleVerify(recheck, "verifier"), "v1", team.id)
          }
        })

      let mergeSnapshot = yield* input.snapshot()
      let mergeReworked = false
      for (;;) {
        // 收尾阶段也可能很长（重验、返工、再集成）：取消在这里同样要生效，
        // 否则用户点停止之后还要等它把这一整段跑完。
        if (cancelled()) return yield* finishCancelled(yield* runs.teams(input.runID))
        /**
         * 超限之后不再返工。
         *
         * 合并后的返工本质上也是一次派发：预算/墙钟已经用完却在这里又派一轮，
         * 等于把硬上限变成建议。已经在主循环因超限停下的（`exceeded`）直接进入结算；
         * 收尾阶段的验证也可能把成本推过上限，同样在这里刹住。
         */
        if (!exceeded) {
          const spent = yield* limitHit()
          if (spent) {
            yield* stopForLimit(yield* runs.teams(input.runID), spent)
            exceeded = true
            break
          }
        }
        if (exceeded) break
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
        // 已经超限的团队不返工：它们连一次派发都没拿到额度，再派一轮只会
        // 反复撞同一个上限，把「预算不足」写成一串没有意义的失败记录。
        const starved = teams.some((team) => team.phase === "exceeded")
        if (mergeReworked || starved || responsible.size === 0 || attempts.business >= maxBusiness) break

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
            const failure = classify(committed.cause, "commit")
            yield* runs.appendEvent({
              runID: input.runID,
              kind: "integration.commit_failed",
              payload: { kind: failure.kind, message: failure.message },
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

      // 最后一刻的取消同样算数：不能让它被下面的最终结算覆盖成 done / partial。
      if (cancelled()) return yield* finishCancelled(yield* runs.teams(input.runID))

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
          cost: usage.settledCost,
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
              : addressingFailed.length > 0
                ? describeAddressing(addressingFailed.flatMap((item) => item.problems))
                : "没有团队产出可交付结果"
            : state === "exceeded"
              ? "尝试次数或预算超限"
              : state === "partial" && integrationBroken
                ? "集成冲突：团队已交付，但合并后的代码尚未验证"
                : state === "partial" && addressingFailed.length > 0
                  ? "部分团队未能派发：" + describeAddressing(addressingFailed.flatMap((item) => item.problems))
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
          addressing: addressingFailed.length,
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
