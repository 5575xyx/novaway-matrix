import { existsSync } from "node:fs"
import * as nodePath from "node:path"
import { Effect, Ref, Scope } from "effect"
import { HttpApiBuilder, HttpApiError } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { Service as RunService, canStart, isTerminal, type RunTeam, type TeamRun } from "@/team/run"
import { Service as VerificationService, type Acceptance } from "@/team/verification"
import {
  Service as OrchestratorService,
  type DispatchInput,
  type Report,
  type VerificationResult,
  type VerifyInput,
} from "@/team/orchestrator"
import { TeamVerifier } from "@/team/verifier"
import { TeamReport } from "@/team/report"
import * as TeamContext from "@/team/context"
import { Service as TeamProfileService, brief as rosterBrief, snapshotFrom } from "@/team/profile"
import * as TeamRoster from "@/team/roster"
import { TeamPolicy } from "@/team/policy"
import {
  affectedTests,
  branch as worktreeBranch,
  changedFiles,
  commit as commitWorktree,
  head as worktreeHead,
  remove as removeWorktree,
} from "@/team/worktree"
import { attachMission, prepareWorktree } from "@/team/setup"
import * as TeamSwitch from "@/team/switch"
import * as TeamBlockers from "@/team/blockers"
import * as TeamMetrics from "@/team/metrics"
import * as TeamReplay from "@/team/replay"
import { Config as ConfigService } from "@/config/config"
import {
  forkPoint,
  integrate as integrateWorktrees,
  integrateInto,
  mergeInto,
  remove as removeIntegration,
} from "@/team/integration"
import { Service as MissionService } from "@/team/mission"
import { normalize as normalizeArtifacts } from "@/team/artifacts"
import { makeRunAgent, type RunAgentPromptOps } from "@/session/agent-step"
import * as TeamEffective from "@/team/effective"
import { SessionPrompt } from "@/session/prompt"
import { Session } from "@/session/session"
import { Agent } from "@/agent/agent"
import { Provider } from "@/provider/provider"
import { SessionID } from "@/session/schema"
import { SessionUsage } from "@/session/usage"
import { Service as TeamService } from "@/team/team"
import { Service as TeamOpLogService } from "@/team/op-log"
import { Service as AgentTaskListService } from "@/team/task-list"
import { Service as TeamLedgerService } from "@/team/ledger"
import * as TeamDenials from "@/team/denials"
import * as TeamCommandVerifier from "@/team/command-verifier"
import * as TeamEconomy from "@/team/economy"
import * as TeamStructure from "@/team/structure"
import * as TeamRecovery from "@/team/recovery"
import { Snapshot } from "@/snapshot"

const number = (value: unknown, fallback = 0) => (typeof value === "number" ? value : fallback)

/**
 * 把落库的用量快照读成响应结构。
 *
 * 快照是由运行时自己写的，但仍按不可信输入逐字段校验：旧版本运行、手改过的库
 * 都可能缺字段。缺就是缺，不用默认值编造「花了 0」。
 */
const toUsage = (value: Record<string, unknown> | undefined) => {
  if (!value) return undefined
  const rawActors: unknown = Reflect.get(value, "byActor")
  const rawJobs: unknown = Reflect.get(value, "byJob")
  const cost: unknown = Reflect.get(value, "cost")
  return {
    reserved: number(Reflect.get(value, "reserved")),
    settled: number(Reflect.get(value, "settled")),
    unknown: number(Reflect.get(value, "unknown")),
    cap: number(Reflect.get(value, "cap")),
    overrun: Reflect.get(value, "overrun") === true,
    // 老运行没有成本数据：缺就是缺，不编一个「花了 0」。
    ...(typeof cost === "number" && Number.isFinite(cost) ? { cost } : {}),
    ...(Array.isArray(rawActors)
      ? {
          byActor: rawActors.flatMap((item: unknown) => {
            if (!item || typeof item !== "object") return []
            const actor: unknown = Reflect.get(item, "actor")
            const teamID: unknown = Reflect.get(item, "teamID")
            if (typeof actor !== "string" || typeof teamID !== "string") return []
            const employeeID: unknown = Reflect.get(item, "employeeID")
            const job: unknown = Reflect.get(item, "job")
            const basis: unknown = Reflect.get(item, "basis")
            return [
              {
                actor,
                teamID,
                ...(typeof employeeID === "string" ? { employeeID } : {}),
                ...(typeof job === "string" ? { job } : {}),
                committed: number(Reflect.get(item, "committed")),
                basis: typeof basis === "string" ? basis : "team",
              },
            ]
          }),
        }
      : {}),
    ...(Array.isArray(rawJobs)
      ? {
          byJob: rawJobs.flatMap((item: unknown) => {
            if (!item || typeof item !== "object") return []
            const job: unknown = Reflect.get(item, "job")
            if (typeof job !== "string") return []
            return [{ job, committed: number(Reflect.get(item, "committed")) }]
          }),
        }
      : {}),
  }
}

/**
 * 把落库的上下文清单读成响应结构（§6.4）。
 *
 * 同样逐字段校验：清单是运行时写的，但读的时候不能假设它一定完整。
 * `brief` 是整段提示词，界面用不到 —— 它属于「需要完整复盘时才会读」的那一列。
 */
const toContext = (value: Record<string, unknown> | undefined) => {
  if (!value) return undefined
  const rawAcceptance: unknown = Reflect.get(value, "acceptance")
  const rawFeedback: unknown = Reflect.get(value, "feedback")
  const rawOmitted: unknown = Reflect.get(value, "omitted")
  const rosterVersion: unknown = Reflect.get(value, "rosterVersion")
  return {
    acceptance: Array.isArray(rawAcceptance)
      ? rawAcceptance.flatMap((item: unknown) => {
          if (!item || typeof item !== "object") return []
          const id: unknown = Reflect.get(item, "id")
          if (typeof id !== "string") return []
          return [{ id, version: number(Reflect.get(item, "version")) }]
        })
      : [],
    ...(typeof rosterVersion === "string" ? { rosterVersion } : {}),
    feedback: Array.isArray(rawFeedback) ? rawFeedback.filter((item: unknown) => typeof item === "string") : [],
    omitted: Array.isArray(rawOmitted)
      ? rawOmitted.flatMap((item: unknown) => {
          if (!item || typeof item !== "object") return []
          const kind: unknown = Reflect.get(item, "kind")
          const reason: unknown = Reflect.get(item, "reason")
          if (typeof kind !== "string") return []
          return [{ kind, count: number(Reflect.get(item, "count")), reason: typeof reason === "string" ? reason : "" }]
        })
      : [],
    truncated: Reflect.get(value, "truncated") === true,
    builtAt: number(Reflect.get(value, "builtAt")),
  }
}

/** 只回传名字与版本：产物的完整内容留在库里，界面不需要也不该展示它。 */
const artifactsOf = (value: unknown) => {
  const list = normalizeArtifacts(value).map((artifact) => ({ name: artifact.name, version: artifact.version }))
  return list.length > 0 ? list : undefined
}

const toRun = (run: TeamRun) => {
  // 老运行存的是自由 JSON：只回传认得的字段，不把脏数据带进响应。
  const brief = TeamContext.normalizeBrief(run.brief)
  return {
    id: run.id,
    sessionID: run.sessionID,
    directory: run.directory,
    missionID: run.missionID,
    mode: run.mode,
    goal: run.goal,
    ...(brief ? { brief } : {}),
    state: run.state,
    phase: run.phase,
    planVersion: run.planVersion,
    roundMain: run.roundMain,
    budget: run.budget,
    attempts: run.attempts,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    startedAt: run.startedAt,
    endedAt: run.endedAt,
    error: run.error,
    terminalReason: run.terminalReason,
    // 缺省只读：界面要能看出来这次运行会不会改工作区。
    readOnly: TeamPolicy.fromPlan(run.plan).readOnly,
    // 用量归属快照（§10.3）：运行结束后才有，运行中缺失是正常的。
    usage: toUsage(run.usage),
    // 合并是独立动作：`done` 不能替它说话（§3.2）。
    mergeState: run.mergeState,
    mergedAt: run.mergedAt,
  }
}

/** 从模型输出里取出第一个 JSON 对象；取不到就当作「未验证」，绝不默认通过。 */

export const runHandlers = HttpApiBuilder.group(InstanceHttpApi, "run", (handlers) =>
  Effect.gen(function* () {
    const runs = yield* RunService
    const missions = yield* MissionService
    const verification = yield* VerificationService
    const ledger = yield* TeamLedgerService
    const orchestrator = yield* OrchestratorService
    const promptSvc = yield* SessionPrompt.Service
    const profiles = yield* TeamProfileService
    const sessions = yield* Session.Service
    const agents = yield* Agent.Service
    const provider = yield* Provider.Service
    const teams = yield* TeamService
    const config = yield* ConfigService.Service
    const opLog = yield* TeamOpLogService
    const taskList = yield* AgentTaskListService

    /**
     * 重启恢复（§8.5）：每个工作区只做一次。
     *
     * 只恢复本进程启动之前就没有更新的运行 —— 本进程正在跑的运行一定在被写时间戳，
     * 不会被误判成遗留。失败只记日志：恢复是补救，不该让看板打不开。
     */
    const recovered = new Set<string>()
    /**
     * 本进程里正在跑的编排器（§8.5）：`cancel` 靠它把停止请求送到真正在干活的那个循环。
     *
     * 只有控制器不够：编排器只在循环检查点看信号，一次卡住的队长调用会让「停止」
     * 等满零进展上限（30 分钟）。`sessions` 记下这次运行派生过的会话 —— 队长、验证器、
     * 成员，取消时逐个打断，在途的模型调用才会真的停下。
     *
     * 只覆盖本进程：重启后的遗留运行由恢复流程处理成 `paused`；别的进程里在跑的运行
     * 不该由这份内存表假装能停 —— 没有控制器时 `cancel` 退回「直接置终态」的老路。
     */
    const executions = new Map<string, { controller: AbortController; sessions: Set<SessionID> }>()
    const recoverStale = (directory: string | undefined) =>
      Effect.gen(function* () {
        const key = directory ?? "*"
        if (recovered.has(key)) return
        recovered.add(key)
        yield* TeamRecovery.recover({ directory }).pipe(
          Effect.catchCause((cause) => Effect.logWarning("team recovery failed", { cause })),
        )
      })
    const snapshot = yield* Snapshot.Service
    const scope = yield* Scope.Scope

    const detail = (runID: string) =>
      Effect.gen(function* () {
        const run = yield* runs.get(runID)
        if (!run) return undefined
        const [teams, acceptances, verifications, events, unknownOps] = yield* Effect.all([
          runs.teams(runID),
          verification.list(runID),
          verification.verifications(runID),
          runs.events({ runID }),
          opLog.needsReview(runID),
        ])
        // 任务板（§5.5）：运行内创建的任务挂在这个运行团队上，看板才有「做到哪一步」可看。
        const boards = yield* Effect.forEach(teams, (team) => taskList.list(team.id), { concurrency: 1 })
        const tasksOf = new Map(teams.map((team, index) => [team.id, boards[index] ?? []]))
        const summary = yield* verification.summary({ runID })
        return {
          run: toRun(run),
          // 阻塞与拒绝要出现在看板上，而不是只躺在事件日志里等人去翻（§11.2）。
          blockers: TeamBlockers.from(events).map((blocker) => ({
            ...blocker,
            swappable: TeamBlockers.swappable(blocker.kind),
          })),
          teams: teams.map((team) => ({
            id: team.id,
            profileID: team.profileID,
            // 记录的是复制那一刻的版本，不是模板现在的版本：模板是复制，不是绑定。
            profileVersion: team.profileVersion,
            phase: team.phase,
            roundCaptain: team.roundCaptain,
            verdict: team.verdict,
            dependsOn: team.dependsOn ?? [],
            worktree: team.worktree,
            // 范围是这次团队被允许写的地方（§11.1）：界面要能回答「它为什么被拦」。
            ...(team.scope?.length ? { scope: team.scope } : {}),
            artifacts: artifactsOf(team.artifactsOut),
            context: toContext(team.contextManifest),
            // 任务板只回这四项：看板要的是一次能扫完的进度，不是任务的全文。
            tasks: (tasksOf.get(team.id) ?? []).map((task) => ({
              id: task.id,
              subject: task.subject,
              status: task.status,
              ...(task.ownerSessionID ? { owner: task.ownerSessionID } : {}),
            })),
          })),
          acceptances: acceptances.map((acceptance) => {
            // 命令原文不出接口：它常带凭据，与 hook 命令同一条约束。
            const command = TeamCommandVerifier.normalize(acceptance.verifier)
            return {
              id: acceptance.id,
              taskID: acceptance.taskID,
              specID: acceptance.specID,
              version: acceptance.version,
              text: acceptance.text,
              kind: acceptance.kind,
              expected: acceptance.expected,
              owner: acceptance.owner,
              ...(command ? { verifier: { kind: command.kind, timeoutMs: command.timeoutMs } } : {}),
            }
          }),
          // 待核对的操作（§8.5）：只回结构与时间，不回传参数原文 —— 参数里常有命令与凭据。
          needsReview: unknownOps.map((op) => ({
            // 只回结构：id 是复核用的句柄，参数原文（命令/路径/凭据）仍然不出接口。
            id: op.id,
            tool: op.tool,
            outcome: op.outcome,
            ...(op.taskID ? { taskID: op.taskID } : {}),
            ...(op.sessionID ? { sessionID: op.sessionID } : {}),
            startedAt: op.startedAt,
          })),
          // 拒绝在本次运行内保持有效（§11.2）：回传工具名与说明，不回传动作原文。
          denials: TeamDenials.list(runID).map((denial) => ({
            tool: denial.tool,
            ...(denial.reason ? { reason: denial.reason } : {}),
            at: denial.at,
          })),
          verifications: verifications.map((item) => ({
            id: item.id,
            acceptanceID: item.acceptanceID,
            attempt: item.attempt,
            snapshotID: item.snapshotID,
            verifierVersion: item.verifierVersion,
            outcome: item.outcome,
            measured: item.measured,
            suggestion: item.suggestion,
            evidenceRef: item.evidenceRef,
            ...(item.reused ? { reused: true } : {}),
            tier: item.tier,
            tierReason: item.tierReason,
            at: item.at,
          })),
          summary: {
            pass: summary.pass,
            fail: summary.fail,
            unverified: summary.unverified,
            stale: summary.stale,
            unresolved: summary.unresolved,
            ratio: summary.ratio,
            deliverable: summary.deliverable,
            verdict: summary.verdict,
            lines: summary.lines.map((line) => ({
              acceptanceID: line.acceptance.id,
              text: line.acceptance.text,
              outcome: line.outcome,
              measured: line.verification?.measured,
              suggestion: line.verification?.suggestion,
              snapshotID: line.verification?.snapshotID,
              tier: line.verification?.tier,
              tierReason: line.verification?.tierReason,
            })),
          },
        }
      })

    /**
     * 建团队 worktree；建不成不算失败，但必须留下原因。
     *
     * 不是 git 仓库或是空仓库时，成员只能在工作区里跑 —— 这会让证据跟着用户的
     * 未提交改动漂移，所以要看得到 `worktree.skipped` 事件，而不是猜。
     *
     * 规则与事件在 `setup.prepareWorktree`：会话里的 `team_run` 也走同一份实现，
     * 两条发起路径的隔离行为才不会一边一个样。
     */
    const ensureWorktree = (base: string, runID: string, name: string, ordinal?: number) =>
      prepareWorktree({ runs }, { base, runID, name, ordinal })

    /**
     * 按 id 取运行，并核对它属于请求的工作区。
     *
     * 运行表是全局的（一个数据目录一张表），而界面按 `x-opencode-directory` 分项目；
     * 不核对目录的话，A 项目拿到的 id 能在 B 项目里被读取、批准、甚至合并 ——
     * 合并改的是 `run.directory` 里的仓库，跨目录操作就是改别人的项目。
     * 目录没带时不拦（历史客户端的兼容路径），带了就必须一致。
     */
    const requireRun = (runID: string, directory?: string) =>
      Effect.gen(function* () {
        const run = yield* runs.get(runID)
        if (!run) return yield* Effect.fail(new HttpApiError.NotFound({}))
        if (directory && run.directory !== directory) return yield* Effect.fail(new HttpApiError.NotFound({}))
        return run
      })

    return handlers
      .handle("listRuns", (ctx) =>
        Effect.gen(function* () {
          // 打开看板是重启后最先发生的事：先把上一个进程留下的运行收拾成 paused / needs_review，
          // 否则它们会永远显示「正在跑」，也永远点不动「继续」（§8.5）。
          yield* recoverStale(ctx.query.directory)
          const all = yield* runs.list()
          // 只列本工作区的运行：运行表是全局的，目录过滤在这里做，不在数据库。
          const directory = ctx.query.directory
          const teamID = ctx.query.teamID
          return (
            all
              .filter((run) => !directory || run.directory === directory)
              // 按计划里的团队过滤：`profileID` 记的是发起时那支团队。没有计划的运行
              // （还没生成计划）不属于任何团队，按团队筛时不出现。
              .filter((run) => !teamID || (run.plan?.teams ?? []).some((team) => team.profileID === teamID))
              .map(toRun)
          )
        }),
      )
      .handle("runReplay", (ctx) =>
        Effect.gen(function* () {
          const run = yield* requireRun(ctx.params.runID, ctx.query.directory)
          const [events, acceptances, verifications] = yield* Effect.all([
            runs.events({ runID: run.id }),
            verification.list(run.id),
            verification.verifications(run.id),
          ])
          // 回放是纯函数：事件 + 验证表 → 决策链与它的依据。这里不做任何补全，
          // 缺什么就在 `notes` 里说出来（旧运行没有验证事件时尤其如此）。
          return TeamReplay.replay({
            state: run.state,
            events,
            acceptances,
            verifications,
          })
        }),
      )
      .handle("runMetrics", (ctx) =>
        Effect.gen(function* () {
          // 取样窗口：最近 N 次运行（默认 30，最多 100）。指标回答「最近怎么样」，
          // 不替代归档；窗口太小会误导，太大则每次都扫一遍事件流。
          const requested = ctx.query.limit === undefined ? 30 : Math.floor(ctx.query.limit)
          const limit = Number.isFinite(requested) ? Math.min(Math.max(requested, 1), 100) : 30
          const directory = ctx.query.directory
          const teamID = ctx.query.teamID
          const all = yield* runs.list()
          const window = all
            .filter((run) => !directory || run.directory === directory)
            .filter((run) => !teamID || (run.plan?.teams ?? []).some((team) => team.profileID === teamID))
            .slice(0, limit)
          const samples = yield* Effect.forEach(
            window,
            (run) =>
              Effect.gen(function* () {
                const events = yield* runs.events({ runID: run.id })
                const entries = yield* ledger.entries(run.id)
                return {
                  run: {
                    id: run.id,
                    state: run.state,
                    roundMain: run.roundMain,
                    attempts: run.attempts,
                    ...(run.usage ? { usage: run.usage } : {}),
                    createdAt: run.createdAt,
                  },
                  // 只把种类与结构字段交给聚合函数；响应里不出现 payload 原文，
                  // 事件里可能带着命令与路径。
                  events: events.map((event) => ({ kind: event.kind, payload: event.payload })),
                  // 账本只带用途、状态与金额：`actor` 不进指标（不排名，§12.1）。
                  ledger: entries.map((entry) => ({
                    ...(entry.kind ? { kind: entry.kind } : {}),
                    state: entry.state,
                    settled: entry.settledTokens,
                    reserved: entry.reservedTokens,
                  })),
                }
              }),
            { concurrency: 1 },
          )
          return TeamMetrics.report(samples)
        }),
      )
      .handle("createRun", (ctx) =>
        Effect.gen(function* () {
          /**
           * 持久目标（§3.2）：先在**建运行之前**把它准备好。
           *
           * 目标工作区是这次运行的起点，准备失败就不该留下一个「挂着目标却没工作区」的运行；
           * 同一目标也不允许两个运行同时跑 —— 它们会抢同一份工作区和同一个分支。
           * 规则本身在 `setup.attachMission`，和会话里的 `team_run` 共用一份。
           */
          const missionID = ctx.payload.missionID
          let missionWorktree: string | undefined
          if (missionID) {
            const attached = yield* attachMission({ missions, runs }, { missionID, directory: ctx.payload.directory })
            if (attached.kind === "refused") return yield* Effect.fail(new HttpApiError.BadRequest({}))
            missionWorktree = attached.worktree
          }

          const run = yield* runs.create({
            sessionID: SessionID.make(ctx.payload.sessionID),
            directory: ctx.payload.directory,
            missionID,
            mode: ctx.payload.mode,
            goal: ctx.payload.goal,
            brief: ctx.payload.brief,
            acceptance: ctx.payload.acceptance as unknown[] | undefined,
            budget: ctx.payload.budget,
          })
          if (missionID)
            yield* runs.appendEvent({
              runID: run.id,
              kind: "mission.attached",
              payload: { missionID, worktree: missionWorktree },
            })
          // 团队 worktree 从目标工作区的 HEAD 切：本次运行看到的是「上次做到哪」。
          const worktreeBase = missionWorktree ?? run.directory
          // 模板发起：名册在这一刻被复制进运行，之后再改模板也不影响它。
          if (ctx.payload.profileID) {
            const snapshot = yield* profiles.snapshot(ctx.payload.profileID)
            if (!snapshot) return yield* Effect.fail(new HttpApiError.BadRequest({}))
            yield* runs.update({
              runID: run.id,
              plan: {
                teams: [
                  {
                    name: snapshot.name,
                    profileID: snapshot.profileID,
                    profileVersion: snapshot.version,
                  },
                ],
                // 策略与计划绑在一起：想放开写操作就得改计划、重新批准。
                policy: { readOnly: ctx.payload.readOnly ?? true },
              },
              planVersion: 1,
              // 模板发起等于计划已经建好：此刻应当等批准，而不是停在没有按钮可点的 `planning`。
              state: "awaiting_approval",
            })
            const worktree = yield* ensureWorktree(worktreeBase, run.id, snapshot.name)
            yield* runs.addTeam({
              runID: run.id,
              profileID: snapshot.profileID,
              profileVersion: snapshot.version,
              rosterSnapshot: snapshot as unknown as Record<string, unknown>,
              worktree: worktree.kind === "created" ? worktree.worktree.directory : undefined,
            })
            yield* runs.appendEvent({
              runID: run.id,
              kind: "plan.created",
              payload: {
                planVersion: 1,
                profileID: snapshot.profileID,
                profileVersion: snapshot.version,
                roster: snapshot.roster.length,
              },
            })
          }
          const teamID = (yield* runs.teams(run.id))[0]?.id
          for (const line of (ctx.payload.acceptance ?? []) as Array<Record<string, unknown>>) {
            if (typeof line?.text !== "string") continue
            yield* verification.register({
              runID: run.id,
              specID: typeof line.specID === "string" ? line.specID : run.id,
              text: line.text,
              kind: (typeof line.kind === "string" ? line.kind : "rubric") as Acceptance["kind"],
              expected: typeof line.expected === "string" ? line.expected : undefined,
              // 模板发起的运行只有一队，把验收默认归给它，否则永远落在全局重验。
              owner: typeof line.owner === "string" ? line.owner : teamID,
            })
          }
          return (yield* detail(run.id))!
        }),
      )
      .handle("runDetail", (ctx) =>
        Effect.gen(function* () {
          // 直接点开某次运行的详情（刷新页面、从会话跳转）也要先恢复一次。
          yield* recoverStale(ctx.query.directory)
          const run = yield* requireRun(ctx.params.runID, ctx.query.directory)
          const found = yield* detail(run.id)
          if (!found) return yield* Effect.fail(new HttpApiError.NotFound({}))
          return found
        }),
      )
      .handle("setRunPlan", (ctx) =>
        Effect.gen(function* () {
          const run = yield* requireRun(ctx.params.runID, ctx.query.directory)
          // 计划变了，版本号必须变：旧批准自动失效。
          const nextVersion = run.planVersion + 1
          yield* runs.update({
            runID: run.id,
            plan: {
              teams: ctx.payload.teams,
              notes: ctx.payload.notes,
              policy: { readOnly: ctx.payload.readOnly ?? true },
            },
            planVersion: nextVersion,
            // 计划变了，旧批准同时失效（§13.1）：把还没开工的运行退回「等批准」，
            // 而不是留一个「看起来已批准、其实批的不是这一版」的状态。
            state: run.state === "planning" || (run.state === "running" && !run.phase) ? "awaiting_approval" : run.state,
          })
          // 计划里的团队逐个落库，依赖用下标表达。
          const existing = yield* runs.teams(run.id)
          if (existing.length === 0) {
            // 归属持久目标时，团队从目标工作区的 HEAD 起分支：接着上次做到的地方往下做。
            const mission = run.missionID ? yield* missions.get(run.missionID) : undefined
            const base = mission?.worktree ?? run.directory
            for (const [index, team] of ctx.payload.teams.entries()) {
              // 每个团队一份 worktree：团队成员之间共享，团队之间隔离（§10.1）。
              // 带上团队序号：中文队名的 slug 会退化成同一个 `team`，分支名必须靠序号区分。
              const worktree = yield* ensureWorktree(base, run.id, team.name, index)
              // 计划里点了模板，就在这一刻把模板复制成快照（§5.2）：之后改模板不影响
              // 这次运行，派发时也才有「该派给谁」可对账（§9）。
              const roster = team.profileID ? yield* profiles.snapshot(team.profileID) : undefined
              // 计划点了不存在的模板：现在拒绝还能说清是哪一步错了，等到派发时
              // 只剩一句「寻址失败」。
              if (team.profileID && !roster) return yield* Effect.fail(new HttpApiError.BadRequest({}))
              yield* runs.addTeam({
                runID: run.id,
                profileID: team.profileID,
                // 记的是**复制下来那一版**，不是计划里写的版本：两者不一致时，
                // 快照才是这次运行真正用的名册。
                profileVersion: roster?.version ?? team.profileVersion,
                ...(roster ? { rosterSnapshot: roster as unknown as Record<string, unknown> } : {}),
                dependsOn: team.dependsOn ? [...team.dependsOn] : [],
                worktree: worktree.kind === "created" ? worktree.worktree.directory : undefined,
                // 范围随团队行一起落库（§11.1）：派发与工具拦截读的是团队行，
                // 不是某一版计划 —— 计划改版不会重建团队行。
                ...(team.scope?.length ? { scope: [...team.scope] } : {}),
              })
            }
          }
          yield* runs.appendEvent({
            runID: run.id,
            kind: "plan.updated",
            payload: { planVersion: nextVersion, teams: ctx.payload.teams.length },
          })
          return (yield* detail(run.id))!
        }),
      )
      .handle("addRunAcceptance", (ctx) =>
        Effect.gen(function* () {
          yield* requireRun(ctx.params.runID, ctx.query.directory)
          // 命令类验收只对 `test` 成立：其它类型没有「退出码」这个判定标准。
          // 不接收就明确拒绝，而不是悄悄退回模型验证 —— 用户会以为跑的是命令。
          if (ctx.payload.verifier && ctx.payload.kind !== "test")
            return yield* Effect.fail(new HttpApiError.BadRequest({}))
          const command = TeamCommandVerifier.normalize(ctx.payload.verifier)
          const acceptance = yield* verification.register({
            runID: ctx.params.runID,
            taskID: ctx.payload.taskID,
            specID: ctx.payload.specID,
            text: ctx.payload.text,
            kind: ctx.payload.kind,
            expected: ctx.payload.expected,
            ...(command ? { verifier: command as unknown as Record<string, unknown> } : {}),
            owner: ctx.payload.owner,
          })
          return {
            id: acceptance.id,
            taskID: acceptance.taskID,
            specID: acceptance.specID,
            version: acceptance.version,
            text: acceptance.text,
            kind: acceptance.kind,
            expected: acceptance.expected,
            owner: acceptance.owner,
            ...(command ? { verifier: { kind: command.kind, timeoutMs: command.timeoutMs } } : {}),
          }
        }),
      )
      .handle("approveRun", (ctx) =>
        Effect.gen(function* () {
          yield* requireRun(ctx.params.runID, ctx.query.directory)
          const approved = yield* runs.approve({
            runID: ctx.params.runID,
            planVersion: ctx.payload.planVersion,
            budget: ctx.payload.budget,
            by: ctx.payload.by ?? "user",
          })
          if (approved === "stale-plan") return yield* Effect.fail(new HttpApiError.Conflict({}))
          if (!approved) return yield* Effect.fail(new HttpApiError.NotFound({}))
          return (yield* detail(ctx.params.runID))!
        }),
      )
      .handle("setRunPolicy", (ctx) =>
        Effect.gen(function* () {
          const run = yield* requireRun(ctx.params.runID, ctx.query.directory)
          // 只能在批准之前、或批准后还没开工（`running` 且没有 phase）时改授权。
          // 已经派发出去的运行按当时的授权继续：中途放宽会让同一个运行时紧时松，
          // 证据也就没法解释；要换授权就取消后重开。
          const editable =
            run.state === "planning" || run.state === "awaiting_approval" || (run.state === "running" && !run.phase)
          if (!editable) return yield* Effect.fail(new HttpApiError.BadRequest({}))

          const nextVersion = run.planVersion + 1
          const teams = run.plan?.teams ?? []
          yield* runs.update({
            runID: run.id,
            // 版本号必须变：旧批准因此自动失效，用户要按新授权重新批准。
            plan: {
              teams: [...teams],
              ...(run.plan?.notes ? { notes: run.plan.notes } : {}),
              policy: { readOnly: ctx.payload.readOnly },
            },
            planVersion: nextVersion,
            state: "awaiting_approval",
          })
          yield* runs.appendEvent({
            runID: run.id,
            kind: "plan.policy",
            payload: { readOnly: ctx.payload.readOnly, planVersion: nextVersion },
          })
          return (yield* detail(run.id))!
        }),
      )
      .handle("executeRun", (ctx) =>
        Effect.gen(function* () {
          /**
           * 请求体可以不带：界面上的「执行」就是一个空 POST（payload 声明成
           * `[Null, 选项结构]`，空请求体解成 `null`）。那几个旋钮全是可选的，
           * 不该挡住那一次点击。
           */
          const options = ctx.payload ?? {}
          // 直接点「执行」而不经列表时，也要先把上次遗留的运行定性 —— 否则它会以
          // `running + 过期 phase` 被 `canStart` 拒绝，永远续不上。
          yield* recoverStale(ctx.query.directory)
          const run = yield* requireRun(ctx.params.runID, ctx.query.directory)
          // 未批准不能跑；已经在跑也不能再起一份。
          if (!canStart(run.state, run.phase)) return yield* Effect.fail(new HttpApiError.BadRequest({}))
          // 还有结果不明的工具操作时不能续跑（§8.5）：先复核副作用，再决定要不要重试。
          // 带着未知项开跑，等于用猜测覆盖已经发生的事 —— 重复扣款、重复推送都从这里来。
          if ((yield* opLog.needsReview(run.id)).length > 0)
            return yield* Effect.fail(new HttpApiError.BadRequest({}))
          /**
           * 批准必须匹配**当前**这一版计划（§13.1）。
           *
           * 批准在库里是 `approval.planVersion`；计划一改版本号就变，旧批准不再代表它。
           * 少了这一条，「先批准 → 再改计划 → 执行」就会拿着一份旧批准的预算跑一份
           * 没人批准过的计划，而界面上看不出来。
           */
          if (!run.approval || run.approval.planVersion !== run.planVersion)
            return yield* Effect.fail(new HttpApiError.BadRequest({}))
          // 总控开关关闭时不可被调用（§13.1）：浏览、改计划、取消都可以，唯独不能开始新的执行。
          const cfg = yield* config.get()
          if (!TeamSwitch.enabled(cfg.experimental)) return yield* Effect.fail(new HttpApiError.BadRequest({}))

          // 默认模型与会话里的 assistant 一致，避免团队用另一个模型产出无法解释的结果。
          const msgs = yield* sessions
            .messages({ sessionID: run.sessionID })
            .pipe(Effect.catchCause(() => Effect.succeed([])))
          const lastAssistant = [...msgs].reverse().find((item) => item.info.role === "assistant")
          const defaultModel =
            lastAssistant && lastAssistant.info.role === "assistant"
              ? { providerID: lastAssistant.info.providerID, modelID: lastAssistant.info.modelID }
              : yield* provider.defaultModel()
          const defaultAgent = yield* agents.defaultAgent()
          const sessionUsage = yield* SessionUsage.Service

          const ops: RunAgentPromptOps = {
            resolvePromptParts: (template) => promptSvc.resolvePromptParts(template),
            prompt: (input) => promptSvc.prompt(input).pipe(Effect.orDie),
          }
          /**
           * 这次运行派生过的会话（队长、验证器、成员）。
           *
           * 取消要能打断在途的模型调用，就必须知道它们在哪个会话里跑：
           * 只发 AbortSignal 的话，编排器得等调用自己结束才能走到检查点。
           */
          const liveSessions = new Set<SessionID>()
          const runAgent = makeRunAgent({
            ops,
            sessions,
            agents,
            parentSessionID: run.sessionID,
            defaultModel,
            defaultAgent,
            teams,
            /**
             * 用量按**整棵子树**读：队长自己是一层，成员是队长用 `task` 派生的子会话，
             * 再往下还有成员自己的子代理。只读队长那一行，会把成员的开销整个漏掉 ——
             * 账本记的就不是「这次运行花了多少」，而是「队长自己花了多少」。
             */
            readUsage: (sessionID) =>
              sessionUsage.tree(sessionID).pipe(
                Effect.map((tree) => ({ cost: tree.total.cost, tokens: tree.total.tokens.total })),
                Effect.catchCause(() => Effect.succeed({ cost: 0, tokens: 0 })),
              ),
            // 子会话一创建就登记编排坐标；之后它跑的任何有副作用工具都会带幂等键。
            // 同时记进本次运行的活动会话表，取消时用得上。
            onSession: ({ sessionID, scope }) =>
              Effect.gen(function* () {
                liveSessions.add(sessionID)
                if (scope) yield* opLog.scope({ sessionID, ...scope })
              }),
          })

          // 模板发起时，队长默认用编制里的队长岗位 —— 模板写了谁负责就谁负责。
          //
          // 名册按**团队**读，不按运行读（§8.3.1）：A 团队的队长与 B 团队无关，
          // 拿第一队的名册去派所有队，等于替别的团队改派了人。
          const teamRows = yield* runs.teams(run.id)
          const rosterOf = (team: (typeof teamRows)[number] | undefined) => snapshotFrom(team?.rosterSnapshot)
          const captainOf = (team: (typeof teamRows)[number] | undefined) => {
            const roster = rosterOf(team)
            const member = roster?.roster.find((entry) => entry.employee.id === roster.captain)
            return {
              roster,
              entry: member,
              job: member?.employee.job,
              members: roster ? rosterBrief(roster) : [],
              // 只有「实际派发的队长就是名册里的队长」时才敢把工时记在那个人名下：
              // 请求换了一个同岗位的人来当队长，账不能挂回原来那个人（§10.3）。
              employeeID: member?.employee.id,
            }
          }
          /**
           * 策略按团队算（§11.1）：只读是运行级的，路径范围是团队级的。
           * 基准目录与派发目录一致 —— 范围里写的是相对仓库根的路径，
           * 换个基准就等于换了一条规则。
           */
          const policyFor = (team: { scope?: readonly string[] } | undefined, directory?: string) =>
            TeamPolicy.fromPlan(run.plan, team, directory ?? run.directory)
          // 团队 worktree 存在时，成员在那里工作，证据也绑定在那里创建时的提交上。
          // 没有 worktree（非 git 仓库、空仓库）则退回实例目录的快照。
          /**
           * 每个团队 worktree 的起点提交（§19.1）。
           *
           * 建 worktree 时事件里记了 `baseSHA`；目标复用的工作区没有本次事件，
           * 退回目标自己的固定起点。两者都拿不到时按「没有事实」处理 ——
           * 不能拿 0 个文件当「没改过」。
           */
          const mission = run.missionID ? yield* missions.get(run.missionID) : undefined
          const worktreeBases = new Map<string, string>()
          for (const event of yield* runs.events({ runID: run.id })) {
            if (event.kind !== "worktree.created") continue
            const directory = Reflect.get(event.payload ?? {}, "directory")
            const baseSHA = Reflect.get(event.payload ?? {}, "baseSHA")
            if (typeof directory === "string" && typeof baseSHA === "string") worktreeBases.set(directory, baseSHA)
          }
          const baseOf = (team: { worktree?: string }) => {
            if (!team.worktree) return undefined
            const recorded = worktreeBases.get(team.worktree)
            if (recorded) return recorded
            return mission?.worktree === team.worktree ? mission.baseSHA : undefined
          }
          /**
           * 同一轮里改动清单是固定的：多条验收共享一次 `git diff`，不逐条重复读。
           * 键里带 `round`，下一轮成员再写文件时不会拿到上一轮的旧清单。
           */
          const changeCache = new Map<string, Promise<string[] | undefined>>()
          const changesOf = (team: RunTeam, round: number) => {
            const base = baseOf(team)
            const directory = team.worktree
            if (!base || !directory) return undefined
            const key = directory + "|" + base + "|" + round
            const cached = changeCache.get(key)
            if (cached) return cached
            const pending = changedFiles({ directory, baseSHA: base })
            changeCache.set(key, pending)
            return pending
          }
          /**
           * 验证档位（§19.1）：由调度器按事实判定，成员怎么描述自己都不影响。
           *
           * 事实全部来自仓库：改了几个文件、跨不跨模块、有没有动锁文件 / 迁移、
           * 能不能按约定找到受影响测试、这条验收有没有可执行命令。
           * 读不到改动清单时退回团队声明的范围；仍为空就说明「没有事实」，
           * 规则会按保守路径走，而不是把它当成「只改了一个文件」。
           */
          const tierOf = (acceptance: Acceptance, team: RunTeam, round: number) =>
            Effect.gen(function* () {
              const directory = team.worktree
              const pending = changesOf(team, round)
              const changed = pending ? yield* Effect.promise(() => pending) : undefined
              const paths = changed ?? team.scope ?? []
              const affected =
                changed && changed.length > 0 && directory
                  ? yield* Effect.promise(() => affectedTests({ directory, paths: changed }))
                  : []
              const facts: TeamEconomy.Facts = {
                kind: acceptance.kind,
                paths: paths.length,
                crossModule: TeamEconomy.crossModule(paths),
                irreversible: TeamEconomy.irreversibleChange(paths),
                hasAffectedTests: affected.length > 0,
                hasCommand: TeamCommandVerifier.normalize(acceptance.verifier) !== undefined,
              }
              return { decision: TeamEconomy.classify(facts), changed: changed ?? [] }
            })
          const teamDirectory = teamRows.find((team) => team.worktree)?.worktree
          const instanceSnapshot = snapshot.track().pipe(Effect.catch(() => Effect.succeed(undefined)))
          /**
           * 当前「证据应该绑定在哪」：集成前是团队 worktree 的 HEAD，
           * 集成成功后切到集成 worktree 的 HEAD —— 合并后的结论必须落在合并后的代码上。
           */
          const integrated = yield* Ref.make<string | undefined>(undefined)
          const snapshotOf = (directory?: string) =>
            Effect.gen(function* () {
              const after = yield* Ref.get(integrated)
              if (after) return yield* Effect.promise(() => worktreeHead(after))
              if (directory) {
                const sha = yield* Effect.promise(() => worktreeHead(directory))
                if (sha) return sha
              }
              return yield* instanceSnapshot
            })

          /**
           * 把团队 worktree 里的改动落成提交（§10.1）。
           *
           * 写操作发生在磁盘上，而快照与集成只认提交：不提交的话，验证对着旧 `HEAD`，
           * 集成也合不到任何改动。所以「交付」在代码里的定义是「改动已经在一个提交里」。
           * 任一团队提交失败就整体失败：无法复验的交付不能算通过。
           */
          const commitTeams = () =>
            Effect.gen(function* () {
              const rows = yield* runs.teams(run.id)
              for (const team of rows) {
                const directory = team.worktree
                if (!directory) continue
                const result = yield* Effect.promise(() =>
                  commitWorktree({
                    directory,
                    message: "team " + (team.profileID ?? team.id) + " (run " + run.id + ")",
                  }),
                )
                if (result.kind === "committed") {
                  yield* runs.appendEvent({
                    runID: run.id,
                    kind: "worktree.committed",
                    payload: { teamID: team.id, sha: result.sha, files: result.files },
                  })
                  continue
                }
                if (result.kind === "failed") return yield* Effect.fail(new Error(team.id + "：" + result.message))
              }
            })

          /**
           * 串行集成（§10.2）：把各团队的 worktree 分支按顺序合到一个独立分支。
           * 合进用户的分支是用户的动作，运行只负责「合到一起还成立吗」。
           */
          const integrate = () =>
            Effect.gen(function* () {
              const rows = yield* runs.teams(run.id)
              const worktrees = rows.flatMap((team) => (team.worktree ? [team.worktree] : []))
              if (worktrees.length === 0) return { kind: "skipped" as const, reason: "本次运行没有团队 worktree" }
              const branches = yield* Effect.forEach(
                worktrees,
                (directory) => Effect.promise(() => worktreeBranch(directory)),
                { concurrency: 1 },
              )
              const named = rows.flatMap((team, index) => {
                const branch = branches[index]
                return team.worktree && branch ? [{ name: team.profileID ?? team.id, branch }] : []
              })
              if (named.length === 0) return { kind: "skipped" as const, reason: "团队 worktree 不在任何分支上" }
              // 归属持久目标：合并进目标工作区，下一次运行从这里继续；
              // 一次性任务：另建集成分支，运行结束后由用户决定合并或清理。
              const mission = run.missionID ? yield* missions.get(run.missionID) : undefined
              if (mission?.worktree) {
                const readiness = yield* missions.prepare(mission.id)
                if (readiness.kind === "skipped") return { kind: "skipped" as const, reason: readiness.reason }
                const directory = readiness.mission.worktree
                if (!directory) return { kind: "skipped" as const, reason: "目标工作区不可用" }
                const outcome = yield* Effect.promise(() => integrateInto({ directory, teams: named }))
                if (outcome.kind === "merged") yield* Ref.set(integrated, outcome.directory)
                return outcome
              }
              const baseSHA = yield* Effect.promise(() =>
                forkPoint(
                  run.directory,
                  named.map((team) => team.branch),
                ),
              )
              if (!baseSHA) return { kind: "skipped" as const, reason: "找不到团队分支与仓库的分岔点" }
              const outcome = yield* Effect.promise(() =>
                integrateWorktrees({ base: run.directory, baseSHA, runID: run.id, teams: named }),
              )
              if (outcome.kind === "merged") yield* Ref.set(integrated, outcome.directory)
              return outcome
            })

          // 队长派发：任务 + 验收 + 上一轮打回意见，要求结构化回报。
          const dispatch = (input: DispatchInput) =>
            Effect.gen(function* () {
              const {
                roster,
                entry: captainEntry,
                job: captainJob,
                members,
                employeeID: captainEmployeeID,
              } = captainOf(input.team)
              // 只有「实际派发的队长就是名册里的队长」时才敢把工时记在那个人名下（§10.3）。
              const captain = options.captain ?? captainJob ?? defaultAgent
              const attributed = captain === captainJob ? captainEmployeeID : undefined
              // 提示词与清单同源（§6.4）：模型看到的字，就是事后审计的字。
              // `run.brief` 是用户声明的范围与约束（§5.3）：不喂进去，用户写了等于没写。
              const declared = TeamContext.normalizeBrief(run.brief)
              const context = TeamContext.build({
                goal: run.goal,
                ...(declared ? { brief: declared } : {}),
                acceptance: input.acceptance.map((acceptance) => ({
                  id: acceptance.id,
                  version: acceptance.version,
                  text: acceptance.text,
                  expected: acceptance.expected,
                })),
                members,
                feedback: input.feedback ?? [],
                ...(roster ? { rosterVersion: String(roster.version) } : {}),
              })
              // 最近一份清单落库给界面看；逐轮历史进事件，只留摘要不复制整段提示词。
              yield* runs.updateTeam({
                id: input.team.id,
                contextManifest: context.manifest as unknown as Record<string, unknown>,
              })
              yield* runs.appendEvent({
                runID: run.id,
                kind: "context.manifest",
                payload: {
                  teamID: input.team.id,
                  round: input.round,
                  acceptance: context.manifest.acceptance.length,
                  feedback: context.manifest.feedback.length,
                  ...(context.manifest.rosterVersion ? { rosterVersion: context.manifest.rosterVersion } : {}),
                  omitted: context.manifest.omitted,
                  truncated: context.manifest.truncated,
                },
              })
              // 每个团队在自己的 worktree 里干活（§10.1）：拿第一队的目录派所有队，
              // 等于让两个团队在同一份文件上互相踩。没有 worktree（非 git 仓库）就退回
              // 会话默认目录，绝不借用别的团队的。
              const dispatchDirectory = input.team.worktree
              /**
               * 名册里写的岗位说明与模型要真的用上（§5.4 / §11.1）。
               *
               * 只有「实际派发的队长就是名册里的队长」时才套用：用户点名换了人，
               * 拿原来那个人的岗位说明和模型去跑，等于把活派给了另一个人还挂着旧名字。
               */
              const person = attributed ? captainEntry : undefined
              const captainModel = TeamEffective.parseModel(person?.employee.model)
              const captainRun = yield* runAgent({
                agent: captain,
                ...(dispatchDirectory ? { directory: dispatchDirectory } : {}),
                title: "队长 · 第 " + input.round + " 轮",
                scope: {
                  runID: run.id,
                  taskID: input.team.id,
                  attempt: input.round,
                  readOnly: policyFor(input.team, dispatchDirectory).readOnly,
                  ...(input.team.scope?.length
                    ? { paths: input.team.scope, root: dispatchDirectory ?? run.directory }
                    : {}),
                },
                ...(attributed ? { employeeID: attributed } : {}),
                ...(captainModel ? { model: captainModel } : {}),
                // 队长可以派活：子代理默认禁 `task`，而派给名册里的人正是队长的职责。
                // 成员拿不到这条 —— 派生权限只继承 deny，不会把队长的放行传下去。
                permission: [{ permission: "task", pattern: "*", action: "allow" }],
                prompt: TeamEffective.compose(person, context.prompt),
              })
              const text = captainRun.text
              const usage = { tokens: captainRun.usage.tokens, cost: captainRun.usage.cost }
              const read = TeamReport.parse(text)
              if (!read.ok)
                return {
                  teamID: input.team.id,
                  // 用量按这次派发的实际消耗结算：不填的话账本只能记成「用量不明」（§7.1）。
                  usage,
                  // 读不出来时字段留空：调度器看到 `malformed` 会重问，不会拿这份空报告去验证。
                  summary: "",
                  claims: [],
                  malformed: read.reason,
                } satisfies Report
              return {
                teamID: input.team.id,
                usage,
                ...read.report,
              } satisfies Report
            })

          /**
           * 命令类验收（§6.2 / §19.1）：退出码就是结论，不经过模型。
           *
           * 三条口径：
           * - 命令只从验收项自己的 `verifier` 读（受控配置），成员报告里写的命令一概不认；
           * - 在团队 worktree / 集成目录里跑，副作用落在可以整体丢弃的副本上；
           * - 同一快照上已有确定性结论时直接复用，并标 `reused`，不伪装成新验证。
           */
          const commandVerify = (input: { acceptance: Acceptance; directory: string | undefined; snapshotID: string }) =>
            Effect.gen(function* () {
              const spec = TeamCommandVerifier.normalize(input.acceptance.verifier)
              if (!spec) return undefined
              const version = TeamCommandVerifier.VERSION
              const cached = yield* verification.reusable({
                acceptanceID: input.acceptance.id,
                snapshotID: input.snapshotID,
                verifierVersion: version,
              })
              const base = {
                snapshotID: input.snapshotID,
                verifierVersion: version,
                // 命令验收没有模型调用：不产生 token 与成本。
                usage: {},
              }
              if (cached)
                return {
                  ...base,
                  outcome: cached.outcome,
                  ...(cached.measured ? { measured: cached.measured } : {}),
                  ...(cached.evidenceRef ? { evidenceRef: cached.evidenceRef } : {}),
                  reused: true,
                } satisfies VerificationResult
              if (!input.directory)
                return {
                  ...base,
                  outcome: "unverified" as const,
                  measured: "没有可执行验收的工作区",
                } satisfies VerificationResult
              const result = yield* Effect.promise(() =>
                TeamCommandVerifier.execute({ directory: input.directory!, spec }),
              )
              return { ...base, ...TeamCommandVerifier.interpret(result) } satisfies VerificationResult
            })

          /**
           * 验证器：缺省用队长的岗位，但必须是一个**独立判断**。
           *
           * 按团队取（§8.3.1）：两队各有各的队长岗位，用一个运行级的默认值会让
           * 后一队被前一队的岗位验，证据就解释不通了。
           */
          const verifierFor = (team?: (typeof teamRows)[number]) =>
            options.verifier ?? options.captain ?? captainOf(team).job ?? defaultAgent

          // 验证：必须是**另一个会话**的独立判断，且允许回答「未验证」。
          const verify = (input: VerifyInput) =>
            Effect.gen(function* () {
              // 证据绑定这个团队自己的目录（§10.1）：验别人的快照等于验了个不相干的东西。
              // 没有 worktree 时不借用别的团队的目录，退回这次运行的默认快照。
              const teamWorktree = input.team.worktree
              const snapshotID = (yield* snapshotOf(teamWorktree)) ?? "unknown"
              // 档位先于验证方式：轻档可以做结构校验，中 / 重档照常走命令或模型。
              const tier = yield* tierOf(input.acceptance, input.team, input.round)
              const spec = TeamCommandVerifier.normalize(input.acceptance.verifier)
              /**
               * 轻档结构校验（§19.1）。
               *
               * 只对 `file` / `diff` 生效：这两类验收的证据本身就是「某个位置」，
               * 存在性与改动归属可以机械判断。`rubric` / `human` / `test` 已被
               * `economy.classify` 抬到中档，不会走到这里 —— 拿格式合规冒充语义成立
               * 正是这条规则要防的事。
               */
              if (!spec && tier.decision.tier === "light" && (input.acceptance.kind === "file" || input.acceptance.kind === "diff")) {
                const directory = teamWorktree ?? run.directory
                return {
                  ...TeamStructure.interpret({
                    acceptance: input.acceptance,
                    report: input.report,
                    changed: tier.changed,
                    exists: (relative) => existsSync(nodePath.join(directory, relative)),
                  }),
                  snapshotID,
                  usage: {},
                  tier: tier.decision.tier,
                  tierReason: tier.decision.reason,
                } satisfies VerificationResult
              }
              // 有命令就用命令验：同样的代码、同样的命令，答案不该由一次模型判断决定。
              const command = yield* commandVerify({
                acceptance: input.acceptance,
                directory: teamWorktree,
                snapshotID,
              })
              if (command)
                return { ...command, tier: tier.decision.tier, tierReason: tier.decision.reason } satisfies VerificationResult
              const verified = yield* runAgent({
                agent: verifierFor(input.team),
                ...(teamWorktree ? { directory: teamWorktree } : {}),
                title: "验证 · " + input.acceptance.id,
                scope: {
                  runID: run.id,
                  taskID: input.acceptance.id,
                  attempt: input.round,
                  readOnly: policyFor(input.team, teamWorktree ?? run.directory).readOnly,
                },
                prompt: TeamVerifier.prompt(input.acceptance, input.report),
              })
              const text = verified.text
              // 没有证据的 pass 在这里被降级为 unverified（见 TeamVerifier.interpret）。
              return {
                ...TeamVerifier.interpret(text),
                snapshotID,
                // 验证也要花钱：不计进来的话，预算上限只约束派发，约束不到真相。
                usage: { tokens: verified.usage.tokens, cost: verified.usage.cost },
                tier: tier.decision.tier,
                tierReason: tier.decision.reason,
              } satisfies VerificationResult
            })

          // 全局验收（不归属任何团队）：必须在**合并后**的代码上验证，
          // 否则「每个团队各自通过」会被当成「合起来也通过」。
          const verifyMerged = (input: { acceptance: Acceptance; snapshotID: string }) =>
            Effect.gen(function* () {
              const directory = (yield* Ref.get(integrated)) ?? teamDirectory
              // 合并后的全局验收永远是重档（§19.1）：合并会引入任何一支团队都没验过的组合。
              const tier = TeamEconomy.classify({
                kind: input.acceptance.kind,
                paths: 0,
                merged: true,
                hasCommand: TeamCommandVerifier.normalize(input.acceptance.verifier) !== undefined,
              })
              // 合并后的命令验收跑在集成目录上：团队各自通过不代表合起来还通过。
              const command = yield* commandVerify({
                acceptance: input.acceptance,
                directory,
                snapshotID: input.snapshotID,
              })
              if (command)
                return { ...command, tier: tier.tier, tierReason: tier.reason } satisfies VerificationResult
              const mergedRun = yield* runAgent({
                agent: verifierFor(undefined),
                ...(directory ? { directory } : {}),
                title: "合并验收 · " + input.acceptance.id,
                scope: {
                  runID: run.id,
                  taskID: input.acceptance.id,
                  attempt: 1,
                  readOnly: policyFor(undefined, directory ?? run.directory).readOnly,
                },
                prompt: TeamVerifier.prompt(input.acceptance, {
                  claims: [{ text: "合并后的代码（" + input.snapshotID + "）" }],
                }),
              })
              return {
                ...TeamVerifier.interpret(mergedRun.text),
                snapshotID: input.snapshotID,
                usage: { tokens: mergedRun.usage.tokens, cost: mergedRun.usage.cost },
                tier: tier.tier,
                tierReason: tier.reason,
              } satisfies VerificationResult
            })

          /**
           * 寻址校验（§9）：这个团队名册里的人，现在还能不能接活。
           *
           * 名册宣称有来源（快照或模板）却读不回来，同样算失败：那说明这份运行已经没有
           * 可信的「该派给谁」，退回默认 agent 就是静默改派给别人。
           * 什么都没有的团队（只有名字、没有编制的计划团队）不参与对账 —— 它们本来
           * 就没有名册可对。
           */
          const addressing = (team: (typeof teamRows)[number]) =>
            Effect.gen(function* () {
              const roster = rosterOf(team)
              if (!roster)
                return team.rosterSnapshot || team.profileID ? [{ reason: "unreadable" as const }] : []
              return TeamRoster.problems(roster, yield* profiles.employees())
            })

          /**
           * 取消要能真的停住编排器（§8.5 / §9）。
           *
           * 此前 `cancel` 只把库里的状态改成 `cancelled`：在跑的编排器并不知道，
           * 它会继续派发、继续花钱，最后用自己的结算把 `cancelled` 覆盖掉 ——
           * 用户点了「停止」，看板上却照样跑完。这里把信号接上：
           * `cancel` 只发停止请求，收尾（三段式）由编排器做，因为只有它知道
           * 已经发生了哪些影响。
           */
          // `canStart` 看的是库里的 `phase`，而写 `phase` 发生在执行开始之后 —— 两个并发请求
          // 可以同时通过它。本进程里已经有执行时就拒绝：两个编排器驱动同一次运行会双倍派发、
          // 双倍记账，还会互相覆盖状态。登记放在这里（紧接着 fork），中间没有可以让出的点。
          if (executions.has(run.id)) return yield* Effect.fail(new HttpApiError.BadRequest({}))
          const controller = new AbortController()
          const execution = { controller, sessions: liveSessions }
          executions.set(run.id, execution)
          yield* orchestrator
            .execute({
              runID: run.id,
              dispatch,
              verify,
              addressing,
              commit: commitTeams,
              verifyMerged,
              integrate,
              signal: controller.signal,
              // 快照按团队取：两队并行时共用一个快照，会把这个团队的「通过」判成过期。
              snapshot: (directory?: string) =>
                snapshotOf(directory ?? teamDirectory).pipe(Effect.map((id) => id ?? "unknown")),
              maxRounds: options.maxRounds,
              maxBusinessAttempts: options.maxBusinessAttempts,
              reserveTokens: options.reserveTokens,
              // 请求没指定并发时用项目级上限；两者都没有就是调度器的默认值（3）。
              concurrency: options.concurrency ?? cfg.experimental?.team_concurrency,
              // 零进展上限：请求 > 项目配置 > 调度器默认。验证比队长短，但同一个值足够 ——
              // 它挡的是「挂住」，不是「慢」。
              ...(options.callTimeoutMs ?? cfg.experimental?.team_call_timeout_ms
                ? {
                    dispatchTimeoutMs: options.callTimeoutMs ?? cfg.experimental?.team_call_timeout_ms,
                    verifyTimeoutMs: options.callTimeoutMs ?? cfg.experimental?.team_call_timeout_ms,
                  }
                : {}),
            })
            .pipe(
              Effect.catchCause((cause) =>
                Effect.logError("team run failed").pipe(Effect.annotateLogs({ runID: run.id, cause })),
              ),
              // 跑完就摘掉：留下的控制器会让下一次「取消」发到一个已经结束的运行上。
              Effect.ensuring(
                Effect.sync(() => {
                  if (executions.get(run.id) === execution) executions.delete(run.id)
                }),
              ),
              Effect.forkIn(scope, { startImmediately: true }),
            )

          const current = yield* runs.get(run.id)
          return toRun(current ?? run)
        }),
      )
      .handle("removeRunWorktrees", (ctx) =>
        Effect.gen(function* () {
          const run = yield* requireRun(ctx.params.runID, ctx.query.directory)
          // 运行还没结束就删工作区，等于把成员脚下的地板抽走。
          if (!isTerminal(run.state)) return yield* Effect.fail(new HttpApiError.BadRequest({}))
          const rows = yield* runs.teams(run.id)
          const results: Array<{ directory: string; removed: boolean; error?: string }> = []

          for (const team of rows) {
            if (!team.worktree) continue
            const directory = team.worktree
            const branch = yield* Effect.promise(() => worktreeBranch(directory))
            const removed = yield* Effect.promise(() => removeWorktree({ base: run.directory, directory, branch }))
            results.push(
              removed.ok ? { directory, removed: true } : { directory, removed: false, error: removed.error },
            )
          }

          // 集成 worktree 单独清理：它的分支是「可交付物」，删之前用户应当先合并或明确放弃。
          const merged = (yield* runs.events({ runID: run.id }))
            .filter((event) => event.kind === "integration.merged")
            .at(-1)
          const integration = merged?.payload
          const directory = typeof integration?.directory === "string" ? integration.directory : undefined
          const branch = typeof integration?.branch === "string" ? integration.branch : undefined
          // 目标的工作区跟着目标走，不跟着某次运行走：清理运行不能把长期工作区删掉。
          const mission = run.missionID ? yield* missions.get(run.missionID) : undefined
          const owned = directory && mission?.worktree === directory ? undefined : directory
          if (owned) {
            const removed = yield* Effect.promise(() =>
              removeIntegration({ base: run.directory, directory: owned, branch }),
            )
            results.push(
              removed.ok
                ? { directory: owned, removed: true }
                : { directory: owned, removed: false, error: removed.error },
            )
          } else if (directory) {
            results.push({ directory, removed: false, error: "属于持久目标的工作区，请按目标管理" })
          }

          yield* runs.appendEvent({
            runID: run.id,
            kind: "worktree.removed",
            payload: {
              removed: results.filter((item) => item.removed).length,
              failed: results.filter((item) => !item.removed).length,
            },
          })
          return results
        }),
      )
      .handle("mergeRun", (ctx) =>
        Effect.gen(function* () {
          const run = yield* requireRun(ctx.params.runID, ctx.query.directory)
          // 还在跑的运行没有「可交付物」：合并一个还会变的目录没有意义。
          if (!isTerminal(run.state)) return yield* Effect.fail(new HttpApiError.BadRequest({}))
          // 有交付物才谈得上合并：失败 / 超时 / 取消的运行即使留着分支，也不是「做完的代码」。
          if (run.state !== "done" && run.state !== "partial") {
            yield* runs.appendEvent({
              runID: run.id,
              kind: "merge.refused",
              payload: { reason: "no-deliverable", state: run.state },
            })
            return { merged: false, message: `这次运行没有已验证的交付（状态：${run.state}），不提供合并。` }
          }
          /**
           * 已经合过了就不再合一次。
           *
           * `git merge` 在「已经包含」时返回 0；照常往下走，界面会再报一次
           * 「已合并到 xxx，提交 yyy」—— 把上一次的动作说成这一次的，那个 sha 也
           * 不对应任何新动作。看板问的是「合没合」，答案就在运行自己的字段里。
           */
          if (run.mergeState === "merged") {
            const settled = (yield* runs.events({ runID: run.id }))
              .filter((event) => event.kind === "merge.settled")
              .at(-1)
            const mergedBranch = typeof settled?.payload?.branch === "string" ? settled.payload.branch : undefined
            const mergedSha = typeof settled?.payload?.sha === "string" ? settled.payload.sha : undefined
            return {
              merged: true,
              alreadyMerged: true,
              ...(mergedBranch ? { branch: mergedBranch } : {}),
              ...(mergedSha ? { sha: mergedSha } : {}),
              message: "这次运行已经合并过了，没有发生新的合并。",
            }
          }

          const merged = (yield* runs.events({ runID: run.id }))
            .filter((event) => event.kind === "integration.merged")
            .at(-1)
          // 目标运行合并的是目标分支：它包含该目标历次运行的累计结果，而不只是这一次。
          const mission = run.missionID ? yield* missions.get(run.missionID) : undefined
          const branch =
            mission?.branch ?? (typeof merged?.payload?.branch === "string" ? merged.payload.branch : undefined)
          if (!branch) {
            // 没有集成分支时不说「合并成功」，也不猜用户想合什么。
            const message = "这次运行没有可合并的集成分支（集成未完成或已清理）。"
            yield* runs.appendEvent({ runID: run.id, kind: "merge.refused", payload: { reason: "no-integration" } })
            return { merged: false, message }
          }

          const outcome = yield* Effect.promise(() => mergeInto({ base: run.directory, branch }))
          if (outcome.kind === "conflict") {
            // 失败的结论也要落库：否则刷新后看板只会显示「未合并」，
            // 用户看不出「上次试过、冲突退回了」。
            yield* runs.update({ runID: run.id, mergeState: "merge_failed" })
            yield* runs.appendEvent({
              runID: run.id,
              kind: "merge.refused",
              payload: { reason: "conflict", branch, files: outcome.files },
            })
            return { merged: false, files: outcome.files, message: outcome.message || "合并冲突，已回退。" }
          }
          if (outcome.kind !== "merged") {
            yield* runs.update({ runID: run.id, mergeState: "merge_failed" })
            yield* runs.appendEvent({
              runID: run.id,
              kind: "merge.refused",
              payload: { reason: outcome.kind, files: outcome.kind === "dirty" ? outcome.files : undefined },
            })
            return {
              merged: false,
              files: outcome.kind === "dirty" ? outcome.files : undefined,
              message:
                outcome.kind === "dirty"
                  ? "工作区还有未提交的改动，先提交或暂存再合并。"
                  : outcome.message || "合并失败。",
            }
          }

          // 合并成功就是这次运行与用户分支之间的连接点：把提交记下来，
          // 之后问「这次运行到底合了什么」有唯一答案。
          yield* runs.update({ runID: run.id, mergeState: "merged", mergedAt: Date.now() })
          yield* runs.appendEvent({
            runID: run.id,
            kind: "merge.settled",
            payload: { branch: outcome.branch, integration: branch, sha: outcome.sha },
          })
          return { merged: true, branch: outcome.branch, sha: outcome.sha }
        }),
      )
      .handle("clearRunDenials", (ctx) =>
        Effect.gen(function* () {
          const run = yield* requireRun(ctx.params.runID, ctx.query.directory)
          // 用户的显式放行：之后同一个动作会重新询问，而不是一辈子被拒。
          return { cleared: TeamDenials.clear(run.id) }
        }),
      )
      .handle("cancelRun", (ctx) =>
        Effect.gen(function* () {
          const run = yield* requireRun(ctx.params.runID, ctx.query.directory)
          if (!isTerminal(run.state)) {
            /**
             * 本进程正在跑它：只发停止请求。
             *
             * 三段式的收尾（记录已发生的影响、结算、置终态）必须由编排器做：
             * 只有它知道这一轮派发到了哪一步。这里直接改状态的话，编排器随后的结算
             * 会把 `cancelled` 覆盖掉 —— 那正是「点了停止却照样跑完」的成因。
             */
            const execution = executions.get(run.id)
            if (execution) {
              execution.controller.abort()
              /**
               * 光发信号不够：编排器只在循环检查点看它，一次在途的队长调用会一直
               * 挂着（最坏是零进展上限 30 分钟），用户点了停止却要等半小时。
               * 打断这次运行派生过的会话，在途的模型调用才会真的停下；派发因此
               * 立刻以中断结束，三段式收尾照旧由编排器完成。
               *
               * 这一步放在请求之外：请求一结束它的 fiber 就会被回收，而会话收尾
               * 还在路上 —— 挂在请求作用域里的取消动作会变成半途而废的中断。
               */
              yield* Effect.forEach(
                [...execution.sessions],
                // 会话可能已经结束（runner 不在），失败不该让「取消」这个动作本身报错。
                (sessionID) => promptSvc.cancel(sessionID).pipe(Effect.catchCause(() => Effect.void)),
                { discard: true },
              ).pipe(Effect.forkIn(scope, { startImmediately: true }))
              return (yield* detail(run.id))!
            }
            // 没有在跑的编排器（进程重启后的遗留、或状态卡住）：直接收尾。
            yield* runs.appendEvent({ runID: run.id, kind: "cancel.requested" })
            const usage = yield* runs.get(run.id)
            yield* runs.appendEvent({
              runID: run.id,
              kind: "cancel.settled",
              payload: { usage: usage?.usage ?? {}, round: run.roundMain },
            })
            yield* runs.update({
              runID: run.id,
              state: "cancelled",
              phase: null,
              endedAt: Date.now(),
              terminalReason: "user-cancelled",
            })
          }
          return (yield* detail(run.id))!
        }),
      )
      /**
       * 复核一条「结果不明」的工具操作（§8.5）。
       *
       * `needs_review` 不能是一条死路：人核对完副作用之后要能把结论写回去，
       * 否则「这个工具到底执行了没有」在系统里永远没有答案，运行也永远回不到可续跑的状态。
       * 复核本身不重放任何调用：`succeeded` 让同键调用永远跳过，`abandoned` 才允许下一次真的执行。
       */
      .handle("reviewRunOp", (ctx) =>
        Effect.gen(function* () {
          // 先定性遗留运行：`started` 得先变 `unknown`，复核的才是同一批记录。
          yield* recoverStale(ctx.query.directory)
          const run = yield* requireRun(ctx.params.runID, ctx.query.directory)
          const ops = yield* opLog.list(run.id)
          const op = ops.find((item) => item.id === ctx.params.opID)
          if (!op) return yield* Effect.fail(new HttpApiError.NotFound({}))
          // 已有结论的事实不能被复核改写：这不是「修正历史」的接口。
          if (op.outcome !== "unknown" && op.outcome !== "started")
            return yield* Effect.fail(new HttpApiError.BadRequest({}))
          const reviewed = yield* opLog.review({ runID: run.id, id: op.id, verdict: ctx.payload.verdict })
          if (!reviewed) return yield* Effect.fail(new HttpApiError.NotFound({}))
          // 只记结构：工具名与结论，不记参数原文（里面常有命令与凭据）。
          yield* runs.appendEvent({
            runID: run.id,
            kind: "op.reviewed",
            payload: { opID: op.id, tool: op.tool, verdict: ctx.payload.verdict },
          })
          // 最后一项复核完 → 不再是「待核对」：回到 paused，等用户点继续。
          // 停在 needs_review 会让看板一直显示「还有结果不明的操作」，与事实不符。
          if (run.state === "needs_review" && (yield* opLog.needsReview(run.id)).length === 0) {
            yield* runs.update({
              runID: run.id,
              state: "paused",
              error: null,
              terminalReason: "reviewed",
            })
          }
          return (yield* detail(run.id))!
        }),
      )
      .handle("runEvents", (ctx) =>
        Effect.gen(function* () {
          // 事件流同样按目录核对：未知 id 返回 404，而不是「空列表」。
          yield* requireRun(ctx.params.runID, ctx.query.directory)
          const events = yield* runs.events({ runID: ctx.params.runID })
          return events.map((event) => ({
            seq: event.seq,
            at: event.at,
            kind: event.kind,
            payload: event.payload,
          }))
        }),
      )
  }),
)
