import { Effect, Ref, Scope } from "effect"
import { HttpApiBuilder, HttpApiError } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { Service as RunService, canStart, isTerminal, type TeamRun } from "@/team/run"
import { Service as VerificationService, type Acceptance } from "@/team/verification"
import {
  Service as OrchestratorService,
  type DispatchInput,
  type Report,
  type VerificationResult,
  type VerifyInput,
} from "@/team/orchestrator"
import { TeamVerifier } from "@/team/verifier"
import * as TeamContext from "@/team/context"
import { Service as TeamProfileService, brief as rosterBrief, snapshotFrom } from "@/team/profile"
import { TeamPolicy } from "@/team/policy"
import {
  branch as worktreeBranch,
  commit as commitWorktree,
  head as worktreeHead,
  remove as removeWorktree,
} from "@/team/worktree"
import { attachMission, prepareWorktree } from "@/team/setup"
import * as TeamSwitch from "@/team/switch"
import * as TeamBlockers from "@/team/blockers"
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
import { SessionPrompt } from "@/session/prompt"
import { Session } from "@/session/session"
import { Agent } from "@/agent/agent"
import { Provider } from "@/provider/provider"
import { SessionID } from "@/session/schema"
import { SessionUsage } from "@/session/usage"
import { Service as TeamService } from "@/team/team"
import { Service as TeamOpLogService } from "@/team/op-log"
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
  return {
    reserved: number(Reflect.get(value, "reserved")),
    settled: number(Reflect.get(value, "settled")),
    unknown: number(Reflect.get(value, "unknown")),
    cap: number(Reflect.get(value, "cap")),
    overrun: Reflect.get(value, "overrun") === true,
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

const toRun = (run: TeamRun) => ({
  id: run.id,
  sessionID: run.sessionID,
  directory: run.directory,
  missionID: run.missionID,
  mode: run.mode,
  goal: run.goal,
  state: run.state,
  phase: run.phase,
  planVersion: run.planVersion,
  roundMain: run.roundMain,
  budget: run.budget,
  attempts: run.attempts,
  createdAt: run.createdAt,
  updatedAt: run.updatedAt,
  error: run.error,
  terminalReason: run.terminalReason,
  // 缺省只读：界面要能看出来这次运行会不会改工作区。
  readOnly: TeamPolicy.fromPlan(run.plan).readOnly,
  // 用量归属快照（§10.3）：运行结束后才有，运行中缺失是正常的。
  usage: toUsage(run.usage),
})

/** 从模型输出里取出第一个 JSON 对象；取不到就当作「未验证」，绝不默认通过。 */
const parseJSON = TeamVerifier.parseJSON

export const runHandlers = HttpApiBuilder.group(InstanceHttpApi, "run", (handlers) =>
  Effect.gen(function* () {
    const runs = yield* RunService
    const missions = yield* MissionService
    const verification = yield* VerificationService
    const orchestrator = yield* OrchestratorService
    const promptSvc = yield* SessionPrompt.Service
    const profiles = yield* TeamProfileService
    const sessions = yield* Session.Service
    const agents = yield* Agent.Service
    const provider = yield* Provider.Service
    const teams = yield* TeamService
    const config = yield* ConfigService.Service
    const snapshot = yield* Snapshot.Service
    const scope = yield* Scope.Scope

    const detail = (runID: string) =>
      Effect.gen(function* () {
        const run = yield* runs.get(runID)
        if (!run) return undefined
        const [teams, acceptances, verifications, events] = yield* Effect.all([
          runs.teams(runID),
          verification.list(runID),
          verification.verifications(runID),
          runs.events({ runID }),
        ])
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
            phase: team.phase,
            roundCaptain: team.roundCaptain,
            verdict: team.verdict,
            dependsOn: team.dependsOn ?? [],
            worktree: team.worktree,
            artifacts: artifactsOf(team.artifactsOut),
            context: toContext(team.contextManifest),
          })),
          acceptances: acceptances.map((acceptance) => ({
            id: acceptance.id,
            taskID: acceptance.taskID,
            specID: acceptance.specID,
            version: acceptance.version,
            text: acceptance.text,
            kind: acceptance.kind,
            expected: acceptance.expected,
            owner: acceptance.owner,
          })),
          verifications: verifications.map((item) => ({
            id: item.id,
            acceptanceID: item.acceptanceID,
            attempt: item.attempt,
            snapshotID: item.snapshotID,
            verifierVersion: item.verifierVersion,
            outcome: item.outcome,
            measured: item.measured,
            evidenceRef: item.evidenceRef,
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
              snapshotID: line.verification?.snapshotID,
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
    const ensureWorktree = (base: string, runID: string, name: string) =>
      prepareWorktree({ runs }, { base, runID, name })

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
            brief: ctx.payload.brief as Record<string, unknown> | undefined,
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
            state: run.state === "planning" ? "awaiting_approval" : run.state,
          })
          // 计划里的团队逐个落库，依赖用下标表达。
          const existing = yield* runs.teams(run.id)
          if (existing.length === 0) {
            // 归属持久目标时，团队从目标工作区的 HEAD 起分支：接着上次做到的地方往下做。
            const mission = run.missionID ? yield* missions.get(run.missionID) : undefined
            const base = mission?.worktree ?? run.directory
            for (const team of ctx.payload.teams) {
              // 每个团队一份 worktree：团队成员之间共享，团队之间隔离（§10.1）。
              const worktree = yield* ensureWorktree(base, run.id, team.name)
              yield* runs.addTeam({
                runID: run.id,
                profileID: team.profileID,
                profileVersion: team.profileVersion,
                dependsOn: team.dependsOn ? [...team.dependsOn] : [],
                worktree: worktree.kind === "created" ? worktree.worktree.directory : undefined,
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
          const acceptance = yield* verification.register({
            runID: ctx.params.runID,
            taskID: ctx.payload.taskID,
            specID: ctx.payload.specID,
            text: ctx.payload.text,
            kind: ctx.payload.kind,
            expected: ctx.payload.expected,
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
          const run = yield* requireRun(ctx.params.runID, ctx.query.directory)
          // 未批准不能跑；已经在跑也不能再起一份。
          if (!canStart(run.state, run.phase)) return yield* Effect.fail(new HttpApiError.BadRequest({}))
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
          const opLog = yield* TeamOpLogService
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
            onSession: ({ sessionID, scope }) => (scope ? opLog.scope({ sessionID, ...scope }) : Effect.void),
          })

          // 模板发起时，队长默认用编制里的队长岗位 —— 模板写了谁负责就谁负责。
          // 快照读不回来时退回默认 agent，而不是拿半份名册去派发。
          const teamRows = yield* runs.teams(run.id)
          const roster = snapshotFrom(teamRows[0]?.rosterSnapshot)
          const captainMember = roster?.roster.find((entry) => entry.employee.id === roster.captain)
          const captainJob = captainMember?.employee.job
          const members = roster ? rosterBrief(roster) : []
          const captain = ctx.payload.captain ?? captainJob ?? defaultAgent
          // 只有「实际派发的队长就是名册里的队长」时才敢把工时记在那个人名下：
          // 请求换了一个同岗位的人来当队长，账不能挂回原来那个人（§10.3）。
          const captainEmployeeID = captain === captainJob ? captainMember?.employee.id : undefined
          const verifier = ctx.payload.verifier ?? captain
          const policy = TeamPolicy.fromPlan(run.plan)
          // 团队 worktree 存在时，成员在那里工作，证据也绑定在那里创建时的提交上。
          // 没有 worktree（非 git 仓库、空仓库）则退回实例目录的快照。
          const teamDirectory = teamRows.find((team) => team.worktree)?.worktree
          const instanceSnapshot = snapshot.track().pipe(Effect.catch(() => Effect.succeed(undefined)))
          /**
           * 当前「证据应该绑定在哪」：集成前是团队 worktree 的 HEAD，
           * 集成成功后切到集成 worktree 的 HEAD —— 合并后的结论必须落在合并后的代码上。
           */
          const integrated = yield* Ref.make<string | undefined>(undefined)
          const snapshotOf = Effect.gen(function* () {
            const after = yield* Ref.get(integrated)
            if (after) return yield* Effect.promise(() => worktreeHead(after))
            if (teamDirectory) {
              const sha = yield* Effect.promise(() => worktreeHead(teamDirectory))
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
              // 提示词与清单同源（§6.4）：模型看到的字，就是事后审计的字。
              const context = TeamContext.build({
                goal: run.goal,
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
              const captainRun = yield* runAgent({
                agent: captain,
                ...(teamDirectory ? { directory: teamDirectory } : {}),
                title: "队长 · 第 " + input.round + " 轮",
                scope: { runID: run.id, taskID: input.team.id, attempt: input.round, readOnly: policy.readOnly },
                ...(captainEmployeeID ? { employeeID: captainEmployeeID } : {}),
                prompt: context.prompt,
              })
              const text = captainRun.text
              const parsed = parseJSON(text)
              const claims = Array.isArray(parsed?.claims)
                ? (parsed!.claims as Array<Record<string, unknown>>).map((claim) => ({
                    acceptanceID: typeof claim.acceptanceID === "string" ? claim.acceptanceID : undefined,
                    text: typeof claim.text === "string" ? claim.text : "",
                    evidence: typeof claim.evidence === "string" ? claim.evidence : undefined,
                  }))
                : []
              return {
                teamID: input.team.id,
                // 用量按这次派发的实际消耗结算：不填的话账本只能记成「用量不明」（§7.1）。
                usage: { tokens: captainRun.usage.tokens },
                summary: typeof parsed?.summary === "string" ? parsed.summary : text.slice(0, 500),
                claims,
                artifacts: Array.isArray(parsed?.artifacts)
                  ? (parsed!.artifacts as Array<Record<string, unknown>>).map((artifact, index) => ({
                      name: typeof artifact.name === "string" ? artifact.name : "artifact-" + index,
                      version: typeof artifact.version === "number" ? artifact.version : 1,
                      hash: typeof artifact.hash === "string" ? artifact.hash : undefined,
                    }))
                  : [],
                done: parsed?.done === true,
              } satisfies Report
            })

          // 验证：必须是**另一个会话**的独立判断，且允许回答「未验证」。
          const verify = (input: VerifyInput) =>
            Effect.gen(function* () {
              const snapshotID = (yield* snapshotOf) ?? "unknown"
              const verified = yield* runAgent({
                agent: verifier,
                ...(teamDirectory ? { directory: teamDirectory } : {}),
                title: "验证 · " + input.acceptance.id,
                scope: { runID: run.id, taskID: input.acceptance.id, attempt: input.round, readOnly: policy.readOnly },
                prompt: TeamVerifier.prompt(input.acceptance, input.report),
              })
              const text = verified.text
              // 没有证据的 pass 在这里被降级为 unverified（见 TeamVerifier.interpret）。
              return {
                ...TeamVerifier.interpret(text),
                snapshotID,
                // 验证也要花钱：不计进来的话，预算上限只约束派发，约束不到真相。
                usage: { tokens: verified.usage.tokens },
              } satisfies VerificationResult
            })

          // 全局验收（不归属任何团队）：必须在**合并后**的代码上验证，
          // 否则「每个团队各自通过」会被当成「合起来也通过」。
          const verifyMerged = (input: { acceptance: Acceptance; snapshotID: string }) =>
            Effect.gen(function* () {
              const directory = (yield* Ref.get(integrated)) ?? teamDirectory
              const mergedRun = yield* runAgent({
                agent: verifier,
                ...(directory ? { directory } : {}),
                title: "合并验收 · " + input.acceptance.id,
                scope: { runID: run.id, taskID: input.acceptance.id, attempt: 1, readOnly: policy.readOnly },
                prompt: TeamVerifier.prompt(input.acceptance, {
                  claims: [{ text: "合并后的代码（" + input.snapshotID + "）" }],
                }),
              })
              return {
                ...TeamVerifier.interpret(mergedRun.text),
                snapshotID: input.snapshotID,
                usage: { tokens: mergedRun.usage.tokens },
              } satisfies VerificationResult
            })

          // 后台执行：UI 轮询 run detail；取消走 cancel 接口。
          yield* orchestrator
            .execute({
              runID: run.id,
              dispatch,
              verify,
              commit: commitTeams,
              verifyMerged,
              integrate,
              snapshot: () => snapshotOf.pipe(Effect.map((id) => id ?? "unknown")),
              maxRounds: ctx.payload.maxRounds,
              maxBusinessAttempts: ctx.payload.maxBusinessAttempts,
              reserveTokens: ctx.payload.reserveTokens,
              // 请求没指定并发时用项目级上限；两者都没有就是调度器的默认值（3）。
              concurrency: ctx.payload.concurrency ?? cfg.experimental?.team_concurrency,
            })
            .pipe(
              Effect.catchCause((cause) =>
                Effect.logError("team run failed").pipe(Effect.annotateLogs({ runID: run.id, cause })),
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
            yield* runs.appendEvent({
              runID: run.id,
              kind: "merge.refused",
              payload: { reason: "conflict", branch, files: outcome.files },
            })
            return { merged: false, files: outcome.files, message: outcome.message || "合并冲突，已回退。" }
          }
          if (outcome.kind !== "merged") {
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
          yield* runs.appendEvent({
            runID: run.id,
            kind: "merge.settled",
            payload: { branch: outcome.branch, integration: branch, sha: outcome.sha },
          })
          return { merged: true, branch: outcome.branch, sha: outcome.sha }
        }),
      )
      .handle("cancelRun", (ctx) =>
        Effect.gen(function* () {
          const run = yield* requireRun(ctx.params.runID, ctx.query.directory)
          if (!isTerminal(run.state)) {
            // 三段式：先请求停止，再把已发生的影响写进事件，最后才置 cancelled。
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
