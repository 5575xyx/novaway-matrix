import { Effect } from "effect"
import { HttpApiBuilder, HttpApiError } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { Service as RunService, canTransition, isTerminal, type TeamRun } from "@/team/run"
import { Service as TeamService } from "@/team/team"
import { expert as expertExecutor, expertCard, team as teamExecutor, teamCard } from "@/team/executor"
import { Session } from "@/session/session"
import { SessionID } from "@/session/schema"
import { Service as ProfileService } from "@/team/profile"
import { Service as AgentService } from "@/agent/agent"
import { Service as VerificationService } from "@/team/verification"
import { Service as OperationLog } from "@/team/op-log"
import * as InstanceState from "@/effect/instance-state"

const userState = (state: string) => {
  if (state === "planning") return "planning" as const
  if (state === "done") return "completed" as const
  if (state === "partial") return "partial" as const
  if (["failed", "exceeded", "cancelled"].includes(state)) return "failed" as const
  if (state === "paused") return "paused" as const
  if (["awaiting_approval", "blocked", "needs_review"].includes(state)) return "needs-you" as const
  return "working" as const
}

const employeeCategory = (name: string, job: string) => {
  const text = `${name} ${job}`.toLocaleLowerCase()
  if (/(运营|增长|营销|渠道|内容|marketing|growth)/.test(text)) return "运营"
  if (/(办公|文档|表格|会议|office|document)/.test(text)) return "办公"
  if (/(产品|设计|体验|竞品|product|design|ux)/.test(text)) return "产品"
  if (/(数据|分析|指标|data|analytics)/.test(text)) return "数据"
  if (/(研究|调研|research)/.test(text)) return "研究"
  if (/(研发|前端|后端|代码|测试|安全|build|code)/.test(text)) return "研发"
  return job === "plan" ? "规划" : job === "build" ? "研发" : "通用"
}

const employeeRole = (job: string) => {
  if (job === "plan") return "规划与协调"
  if (job === "build") return "研发执行"
  if (job === "general") return "通用专家"
  return job
}

const employeeCapabilities = (name: string, job: string, skills?: string[]) => {
  const values = skills?.filter((skill) => skill.trim()).slice(0, 4) ?? []
  if (values.length > 0) return values
  return [employeeCategory(name, job), name].filter((value, index, all) => all.indexOf(value) === index)
}

const employeeDescription = (name: string, job: string, skills?: string[]) => {
  const values = skills?.filter((skill) => skill.trim()).slice(0, 3) ?? []
  if (values.length > 0) return `擅长${values.join("、")}，适合直接交付相关任务。`
  return `专注于${employeeCategory(name, job)}方向，可独立处理${name}相关任务。`
}

const userPhase = (run: TeamRun) => {
  if (["done", "partial", "failed", "exceeded", "cancelled"].includes(run.state)) return "delivering" as const
  if (run.state === "needs_review" || run.phase === "reviewing" || run.phase === "verify-merged")
    return "reviewing" as const
  if (["planning", "awaiting_approval"].includes(run.state)) return "planning" as const
  if (run.phase || run.state === "running") return "working" as const
  return "understanding" as const
}

const taskView = (run: TeamRun) => ({
  id: run.id,
  goal: run.goal,
  state: userState(run.state),
  phase: userPhase(run),
  executor: { mode: run.mode === "auto" ? ("auto" as const) : ("team" as const) },
  artifacts: [],
  updatedAt: run.updatedAt,
})

export const expertCenterHandlers = HttpApiBuilder.group(InstanceHttpApi, "expert-center", (handlers) =>
  Effect.gen(function* () {
    const runs = yield* RunService
    const legacyTeams = yield* TeamService
    const profiles = yield* ProfileService
    const agents = yield* AgentService
    const verification = yield* VerificationService
    const sessions = yield* Session.Service
    const operations = yield* OperationLog

    const tasks = (directory?: string) =>
      Effect.gen(function* () {
        const all = yield* runs.list()
        return all.filter((run) => !directory || run.directory === directory).map(taskView)
      })

    // 统一执行者目录：这里是 Team / Profile / Employee 的唯一用户侧投影边界。
    // 底层模型继续分开保存，以保留运行时团队、可复用模板和员工档案各自的生命周期；
    // 从此之后目录、推荐和会话选择器只消费同一套 canonical executor card。
    const teams = (directory?: string) =>
      Effect.gen(function* () {
        yield* profiles.seed()
        const [list, runtimeTeams] = yield* Effect.all([profiles.list(), legacyTeams.list()])
        const reusableProfiles = yield* Effect.forEach(
          list,
          (profile) =>
            Effect.gen(function* () {
              const roster = yield* profiles.roster(profile.id)
              return teamCard(
                teamExecutor({
                  source: "profile",
                  id: profile.id,
                  name: profile.name,
                  ...(profile.description ? { description: profile.description } : {}),
                  capabilities: [
                    ...new Set(
                      roster
                        .filter((entry) => entry.role !== "captain")
                        .map((entry) => entry.duty?.split("/")[0]?.trim() || entry.employee.name)
                        .filter(Boolean),
                    ),
                  ],
                  scenarios: [],
                  memberCount: roster.length,
                  memberPreview: roster.slice(0, 3).map((entry) => ({ name: entry.employee.name, role: entry.role })),
                  autoEligible: profile.autoEligible,
                }),
              )
            }),
          { concurrency: 1 },
        )
        const liveTeams = yield* Effect.forEach(
          runtimeTeams,
          (team) =>
            Effect.gen(function* () {
              const root = yield* sessions.get(team.rootSessionID).pipe(Effect.catch(() => Effect.succeed(undefined)))
              if (directory && root?.directory !== directory) return undefined
              const members = yield* legacyTeams.members(team.id)
              return teamCard(
                teamExecutor({
                  source: "runtime-team",
                  id: team.id,
                  name: team.name,
                  ...(team.description ? { description: team.description } : {}),
                  capabilities: [...new Set(members.map((member) => member.agent).filter(Boolean))],
                  scenarios: [],
                  memberCount: members.length,
                  memberPreview: members.slice(0, 3).map((member) => ({ name: member.name, role: member.role })),
                  autoEligible: team.autoEligible,
                }),
              )
            }),
          { concurrency: 1 },
        )
        return [...liveTeams.filter((team): team is NonNullable<typeof team> => Boolean(team)), ...reusableProfiles]
      })

    const experts = () =>
      Effect.gen(function* () {
        // 专家和专家团是同一份员工资产的两个投影；首次打开目录时两个请求会并行到达，
        // 因此专家接口也必须独立确保 seed，不能依赖 teams 请求的时序。
        yield* profiles.seed()
        const [list, agentList] = yield* Effect.all([profiles.employees(), agents.list()])
        const agentByName = new Map(agentList.map((agent) => [agent.name, agent]))
        return list.map((employee) => {
          const agent = agentByName.get(employee.job)
          const displayName = agent?.options.displayName
          const category = agent?.options.category
          return expertCard(
            expertExecutor({
              source: "employee",
              id: employee.id,
              name: employee.name,
              role: typeof displayName === "string" && displayName.trim() ? displayName : employeeRole(employee.job),
              category:
                typeof category === "string" && category.trim()
                  ? category
                  : employeeCategory(employee.name, employee.job),
              description: employeeDescription(employee.name, employee.job, employee.skills),
              capabilities: employeeCapabilities(employee.name, employee.job, employee.skills),
              available: !employee.archived,
            }),
          )
        })
      })

    const taskDetail = (run: TeamRun) =>
      Effect.gen(function* () {
        const [acceptances, summary, runTeams] = yield* Effect.all([
          verification.list(run.id),
          verification.summary({ runID: run.id }),
          runs.teams(run.id),
        ])
        const changes = runTeams.flatMap((team) =>
          team.artifactsOut.flatMap((value, index) => {
            if (!value || typeof value !== "object") return []
            const record = value as Record<string, unknown>
            const name = typeof record.name === "string" && record.name.trim() ? record.name : `artifact-${index + 1}`
            const id = typeof record.id === "string" && record.id.trim() ? record.id : `${team.id}:${index}`
            const path = typeof record.path === "string" && record.path.trim() ? record.path : undefined
            const version =
              typeof record.version === "string" || typeof record.version === "number"
                ? String(record.version)
                : undefined
            return [{ id, name, ...(path ? { path } : {}), ...(version ? { version } : {}) }]
          }),
        )
        const verificationStatus =
          run.state === "failed" || run.state === "exceeded" || run.state === "cancelled"
            ? ("failed" as const)
            : acceptances.length === 0
              ? ("pending" as const)
              : summary.verdict === "complete"
                ? ("verified" as const)
                : summary.verdict === "failed"
                  ? ("failed" as const)
                  : ("partial" as const)
        return {
          ...taskView(run),
          summary: run.terminalReason ?? run.error ?? undefined,
          verification: {
            status: verificationStatus,
            passed: summary.pass,
            failed: summary.fail,
            unverified: summary.unverified,
            stale: summary.stale,
          },
          changes,
          artifacts: changes.map(({ id, name, path }) => ({ id, name, ...(path ? { path } : {}) })),
        }
      })

    const requireTask = (taskID: string, directory?: string) =>
      Effect.gen(function* () {
        const run = yield* runs.get(taskID)
        if (!run || (directory && run.directory !== directory)) return yield* Effect.fail(new HttpApiError.NotFound({}))
        return run
      })

    const actionResult = (
      run: TeamRun,
      action: "created" | "approved" | "paused" | "resumed" | "retried" | "decision",
    ) => Effect.succeed({ task: taskView(run), action })

    const resume = (run: TeamRun, action: "resumed" | "retried") =>
      Effect.gen(function* () {
        // Resume never grants approval or resolves an unknown tool outcome.
        const resumable = run.state === "paused" || run.state === "blocked" || run.state === "needs_review"
        if (!resumable || run.phase || run.approval?.planVersion !== run.planVersion)
          return yield* Effect.fail(new HttpApiError.Conflict({}))
        if ((yield* operations.needsReview(run.id)).length > 0) return yield* Effect.fail(new HttpApiError.Conflict({}))
        const updated = yield* runs.update({
          runID: run.id,
          state: "running",
          phase: null,
          terminalReason: null,
          event: { kind: action === "retried" ? "run.retried" : "run.resumed", payload: { from: run.state } },
        })
        if (!updated) return yield* Effect.fail(new HttpApiError.NotFound({}))
        return yield* actionResult(updated, action)
      })

    return handlers
      .handle("overview", (ctx) =>
        Effect.all({
          tasks: tasks(ctx.query.directory),
          teams: teams(ctx.query.directory),
          experts: experts(),
        }),
      )
      .handle("tasks", (ctx) => tasks(ctx.query.directory))
      .handle("task", (ctx) =>
        Effect.gen(function* () {
          const run = yield* runs.get(ctx.params.taskID)
          if (!run || (ctx.query.directory && run.directory !== ctx.query.directory)) {
            return yield* Effect.fail(new HttpApiError.NotFound({}))
          }
          return yield* taskDetail(run)
        }),
      )
      .handle("teams", (ctx) => teams(ctx.query.directory))
      .handle("experts", () => experts())
      .handle("createTask", (ctx) =>
        Effect.gen(function* () {
          const directory = ctx.query.directory
          if (!directory) return yield* Effect.fail(new HttpApiError.BadRequest({}))
          const { sessionID: existingSessionID, employeeID, teamID } = ctx.payload
          if (employeeID && teamID) return yield* Effect.fail(new HttpApiError.BadRequest({}))
          const teamIDs = teamID ? [teamID] : []
          let sessionID: SessionID
          if (existingSessionID) {
            sessionID = SessionID.make(existingSessionID)
            const session = yield* sessions.get(sessionID).pipe(Effect.catch(() => Effect.succeed(undefined)))
            const workspaceID = yield* InstanceState.workspaceID
            if (!session || session.directory !== directory || session.workspaceID !== workspaceID)
              return yield* Effect.fail(new HttpApiError.NotFound({}))
            if (teamID || employeeID) yield* sessions.setTeamMode({ sessionID, mode: "selected", teamIDs })
            if (employeeID) yield* sessions.setEmployeeID({ sessionID, employeeID })
          } else {
            sessionID = (yield* sessions.create({
              title: ctx.payload.goal,
              directory,
              ...(teamID || employeeID ? { teamMode: "selected" as const, teamIDs, employeeID } : {}),
            })).id
          }
          const run = yield* runs.create({
            sessionID,
            directory,
            mode: ctx.payload.mode ?? "auto",
            goal: ctx.payload.goal,
            ...(ctx.payload.brief ? { brief: ctx.payload.brief } : {}),
          })
          yield* runs.appendEvent({
            runID: run.id,
            kind: "expert_center.task.created",
            payload: { mode: run.mode, source: "expert-center" },
          })
          return yield* actionResult(run, "created")
        }),
      )
      .handle("approveTask", (ctx) =>
        Effect.gen(function* () {
          const current = yield* requireTask(ctx.params.taskID, ctx.query.directory)
          if (isTerminal(current.state) || current.phase) return yield* Effect.fail(new HttpApiError.Conflict({}))
          if ((yield* operations.needsReview(current.id)).length > 0)
            return yield* Effect.fail(new HttpApiError.Conflict({}))
          const approved = yield* runs.approve({
            runID: current.id,
            planVersion: ctx.payload.planVersion,
            budget: ctx.payload.budget,
            by: "user",
          })
          if (approved === "stale-plan") return yield* Effect.fail(new HttpApiError.Conflict({}))
          if (!approved) return yield* Effect.fail(new HttpApiError.NotFound({}))
          return yield* actionResult(approved, "approved")
        }),
      )
      .handle("pauseTask", (ctx) =>
        Effect.gen(function* () {
          const run = yield* requireTask(ctx.params.taskID, ctx.query.directory)
          if (run.state === "running" && run.phase) return yield* Effect.fail(new HttpApiError.Conflict({}))
          if (isTerminal(run.state) || !canTransition(run.state, "paused"))
            return yield* Effect.fail(new HttpApiError.Conflict({}))
          if ((yield* operations.needsReview(run.id)).length > 0)
            return yield* Effect.fail(new HttpApiError.Conflict({}))
          const paused = yield* runs.update({
            runID: run.id,
            state: "paused",
            phase: null,
            terminalReason: "user-paused",
            event: { kind: "run.paused", payload: { from: run.state, reason: "user-paused" } },
          })
          if (!paused) return yield* Effect.fail(new HttpApiError.NotFound({}))
          return yield* actionResult(paused, "paused")
        }),
      )
      .handle("resumeTask", (ctx) =>
        Effect.gen(function* () {
          const run = yield* requireTask(ctx.params.taskID, ctx.query.directory)
          return yield* resume(run, "resumed")
        }),
      )
      .handle("retryTask", (ctx) =>
        Effect.gen(function* () {
          const run = yield* requireTask(ctx.params.taskID, ctx.query.directory)
          return yield* resume(run, "retried")
        }),
      )
      .handle("resolveTaskDecision", (ctx) =>
        Effect.gen(function* () {
          const run = yield* requireTask(ctx.params.taskID, ctx.query.directory)
          if (ctx.payload.action === "approve")
            return yield* resume(run, "resumed").pipe(
              Effect.map((result) => ({ ...result, action: "decision" as const })),
            )
          if (run.phase || !canTransition(run.state, "paused")) return yield* Effect.fail(new HttpApiError.Conflict({}))
          if ((yield* operations.needsReview(run.id)).length > 0)
            return yield* Effect.fail(new HttpApiError.Conflict({}))
          const updated = yield* runs.update({
            runID: run.id,
            state: "paused",
            phase: null,
            terminalReason: "decision-dismissed",
            event: {
              kind: "task.decision.dismissed",
              payload: { decisionID: ctx.params.decisionID, note: ctx.payload.note },
            },
          })
          if (!updated) return yield* Effect.fail(new HttpApiError.NotFound({}))
          return yield* actionResult(updated, "decision")
        }),
      )
  }),
)
