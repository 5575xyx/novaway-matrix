import { Effect, Option, Schema } from "effect"
import * as Tool from "./tool"
import { Service as TeamService } from "@/team/team"
import { Service as TeamRunService } from "@/team/run"
import { Service as TeamVerificationService } from "@/team/verification"
import { Service as TeamMissionService } from "@/team/mission"
import { Service as TeamProfileService, type Snapshot } from "@/team/profile"
import { of as effectiveOf } from "@/team/effective"
import { Service as SessionService } from "@/session/session"
import { Service as TeamOpLogService } from "@/team/op-log"
import * as TeamDispatchDirectory from "@/team/dispatch-directory"
import { describe as describeRosterProblems, fromLive, problems as rosterProblems } from "@/team/roster"
import { attachMission, prepareWorktree } from "@/team/setup"
import * as TeamSwitch from "@/team/switch"
import * as TeamAutoStart from "@/team/auto-start"
import { Config } from "@/config/config"

/**
 * `team_run`：把一次团队派发登记成运行，并根据风险边界决定是否需要人工确认。
 *
 * 运行阶段要多次调用模型（队长拆解、验证器裁决），它属于后台任务，不应占用
 * 主助手当前这一回合。这里仍只负责「建运行 + 定计划」；安全的只读运行可以
 * 自动批准，涉及写入或外部副作用的运行必须保留人工批准。
 *
 * 会话的 `teamMode` 决定可用团队：
 * - `off`：用户明确要求主助手直接处理，不派发；
 * - `selected`：只接受 `teamIDs` 里的团队或专家团模板，单专家由会话的 `employeeID` 点名；
 * - `auto`：只接受 `autoEligible` 团队或专家团模板，由主助手按任务需要选择。
 */

const AcceptanceInput = Schema.Struct({
  text: Schema.String.annotate({ description: "可验证的验收标准（一句话，能被复核）" }),
  kind: Schema.optional(Schema.Literals(["test", "diff", "file", "rubric", "human"])),
  expected: Schema.optional(Schema.String).annotate({ description: "预期结果；能写具体值就写具体值" }),
})

export const BriefInput = Schema.Struct({
  scope: Schema.optional(Schema.Array(Schema.String)).annotate({
    description: "这次要看/改的范围，每行一条（例如「当前 diff」「src/team」「PR #123」）",
  }),
  files: Schema.optional(Schema.Array(Schema.String)).annotate({ description: "相关文件路径，每行一个" }),
  constraints: Schema.optional(Schema.Array(Schema.String)).annotate({
    description: "硬约束，每行一条（例如「不要改测试」）",
  }),
  context: Schema.optional(Schema.String).annotate({ description: "补充背景，一段话" }),
})

export const TeamRunParameters = Schema.Struct({
  team: Schema.optional(Schema.String).annotate({
    description: "团队或专家团模板 ID/名字；必须出现在本次会话的团队目录里",
  }),
  expert: Schema.optional(Schema.String).annotate({
    description: "单个专家 ID 或名字；必须出现在本次会话的专家目录里。与 team 二选一",
  }),
  goal: Schema.String.annotate({ description: "这一轮要交付什么（面向结果，不写过程）" }),
  brief: Schema.optional(BriefInput).annotate({
    description: "用户给的范围与约束；不填就只按目标派发。写了就原样进队长提示词，不能悄悄丢掉。",
  }),
  acceptance: Schema.optional(Schema.Array(AcceptanceInput)),
  tokens: Schema.optional(Schema.Number).annotate({ description: "预算上限（tokens）；不填用默认值" }),
  missionID: Schema.optional(Schema.String).annotate({
    description: "归入一个持久目标（M-xxx 的 id）；之后每次运行复用同一份工作区与起点",
  }),
  allowWrites: Schema.optional(Schema.Boolean).annotate({
    description: "只有用户明确要求改代码时才设为 true。放宽授权等于改计划：这次运行会停下来等用户批准，不会自己开工。",
  }),
})

export const DEFAULT_TEAM_BUDGET = 200_000

export const TeamRunTool = Tool.define<typeof TeamRunParameters, { runID?: string; state?: string }, never>(
  "team_run",
  Effect.succeed({
    description: [
      "Dispatch a team or a single expert from this session's catalog when the task benefits from expert collaboration.",
      "Pass exactly one of team or expert. Creates a run with a plan and acceptance criteria. Safe read-only runs are approved and started automatically; writes and external side effects always wait for the user's approval.",
      "Runs are read-only unless the user asked for changes; asking for writes (allowWrites) always waits for the user's approval.",
      "If the user stated a scope, file list or hard constraints, pass them in brief: they go into the captain's prompt verbatim.",
      "In Auto mode, do not ask the user to choose first: decide whether the main assistant, one expert, or a team is the best fit and dispatch only when collaboration adds value.",
    ].join(" "),
    parameters: TeamRunParameters,
    capabilities: { concurrencySafe: false },
    execute: (params: Schema.Schema.Type<typeof TeamRunParameters>, ctx: Tool.Context) =>
      Effect.gen(function* () {
        const sessions = Option.getOrUndefined(yield* Effect.serviceOption(SessionService))
        const teams = Option.getOrUndefined(yield* Effect.serviceOption(TeamService))
        const runs = Option.getOrUndefined(yield* Effect.serviceOption(TeamRunService))
        const verification = Option.getOrUndefined(yield* Effect.serviceOption(TeamVerificationService))
        const missions = Option.getOrUndefined(yield* Effect.serviceOption(TeamMissionService))
        const profiles = Option.getOrUndefined(yield* Effect.serviceOption(TeamProfileService))
        if (!sessions || !teams || !runs || !verification) {
          return {
            title: "Team runs unavailable",
            output: "Team orchestration is not enabled in this runtime.",
            metadata: {},
          }
        }

        // 总控开关（§13.1）：正常运行时工具根本不会被注入；这里再挡一次，
        // 是为了「运行中改配置」「绕开注册表直接调用」这两种情况也不放行。
        const config = Option.getOrUndefined(yield* Effect.serviceOption(Config.Service))
        if (config) {
          const cfg = yield* config.get()
          if (!TeamSwitch.enabled(cfg.experimental))
            return { title: "Team orchestration is off", output: TeamSwitch.DISABLED_OUTPUT, metadata: {} }
        }

        const session = yield* sessions.get(ctx.sessionID).pipe(Effect.catch(() => Effect.succeed(undefined)))
        // 工具上下文允许目录为空（很少见）；团队按会话目录归属，这里退回会话自己的目录。
        const directory = ctx.directory ?? session?.directory ?? process.cwd()
        const mode = session?.teamMode ?? "off"
        if (mode === "off") {
          return {
            title: "No team selected",
            output:
              "This session is explicitly set to main-assistant-only mode. Complete the task directly without expert collaboration.",
            metadata: {},
          }
        }

        // This is the same resolver shown by team_list. An ID returned there is
        // therefore accepted here under the same session and workspace policy.
        const catalog = yield* TeamDispatchDirectory.resolve({
          teams,
          ...(profiles ? { profiles } : {}),
          sessions,
          session: session!,
          directory,
          mode,
        })
        const candidates = catalog.teams

        const requestedTeam = params.team?.trim()
        const requestedExpert = params.expert?.trim()
        if ((requestedTeam && requestedExpert) || (!requestedTeam && !requestedExpert))
          return yield* Effect.fail(new Error("Pass exactly one of team or expert."))

        let target: { id: string; name: string }
        let live: Snapshot | undefined
        if (requestedExpert) {
          if (!profiles) return yield* Effect.fail(new Error("Expert directory is not enabled in this runtime."))
          const expertByID = catalog.experts.find((item) => item.id === requestedExpert)
          const expertMatches = expertByID
            ? [expertByID]
            : catalog.experts.filter((item) => item.name === requestedExpert)
          if (expertMatches.length > 1)
            return yield* Effect.fail(
              new Error(
                `Expert name "${requestedExpert}" is ambiguous. Pass an ID: ${expertMatches.map((item) => item.id).join(", ")}.`,
              ),
            )
          const employee = expertMatches[0]
          if (!employee) {
            const available = catalog.experts.map((item) => `${item.id} (${item.name} [${item.job}])`).join(", ")
            return yield* Effect.fail(
              new Error(
                `Unknown or unavailable expert "${requestedExpert}".${available ? ` Available: ${available}.` : " No expert is available in this session."}`,
              ),
            )
          }

          target = { id: `expert:${employee.id}`, name: employee.name }
          live = {
            profileID: target.id,
            name: employee.name,
            version: 1,
            captain: employee.id,
            roster: [
              {
                employee,
                role: "captain",
                order: 0,
                canAutoDispatch: employee.canAutoDispatch,
                effective: effectiveOf({
                  employee,
                  role: "captain",
                  order: 0,
                  canAutoDispatch: employee.canAutoDispatch,
                }),
              },
            ],
          }
        } else {
          const teamByID = candidates.find((item) => item.id === requestedTeam)
          const teamMatches = teamByID ? [teamByID] : candidates.filter((item) => item.name === requestedTeam)
          if (teamMatches.length > 1)
            return yield* Effect.fail(
              new Error(
                `Team name "${requestedTeam}" is ambiguous. Pass an ID: ${teamMatches.map((item) => item.id).join(", ")}.`,
              ),
            )
          const selected = teamMatches[0]
          if (!selected) {
            return yield* Effect.fail(
              new Error(
                candidates.length === 0
                  ? `No team is available for this session (mode: ${mode}).`
                  : `Unknown team "${requestedTeam}". Available: ${candidates.map((item) => `${item.id} (${item.name})`).join(", ")}.`,
              ),
            )
          }
          target = selected
          if (selected.source === "profile") {
            if (!profiles) return yield* Effect.fail(new Error("Expert team profiles are not enabled in this runtime."))
            live = yield* profiles.snapshot(selected.id)
            if (!live) return yield* Effect.fail(new Error(`Team profile "${selected.name}" has no usable roster.`))
            const profileMembers = yield* profiles.members(selected.id)
            const rosterIssues = rosterProblems(
              live,
              yield* profiles.employees(),
              profileMembers.map((member) => member.employeeID),
            )
            if (rosterIssues.length > 0) return yield* Effect.fail(new Error(describeRosterProblems(rosterIssues)))
          } else {
            live = fromLive({ teamID: target.id, name: target.name, members: yield* teams.members(target.id) })
            if (!live)
              return yield* Effect.fail(
                new Error(`Team "${target.name}" has no active members and cannot be dispatched.`),
              )
          }
        }

        // 持久目标（§3.2）：先把目标准备好，再建运行 —— 目标准备失败就不该留下
        // 一个「挂着目标却没工作区」的运行。拒绝就整次失败，不降级成一次性运行。
        let missionWorktree: string | undefined
        if (params.missionID) {
          if (!missions) return yield* Effect.fail(new Error("Mission support is not enabled in this runtime."))
          const attached = yield* attachMission({ missions, runs }, { missionID: params.missionID, directory })
          if (attached.kind === "refused")
            return yield* Effect.fail(new Error(`Cannot attach to mission ${params.missionID}: ${attached.reason}`))
          missionWorktree = attached.worktree
        }

        const budget = { tokens: params.tokens ?? DEFAULT_TEAM_BUDGET }
        const acceptance = params.acceptance ?? []
        const readOnly = !params.allowWrites
        const run = yield* runs.create({
          sessionID: ctx.sessionID,
          directory,
          missionID: params.missionID,
          mode: mode === "auto" ? "auto" : "team",
          goal: params.goal,
          ...(params.brief ? { brief: params.brief } : {}),
          acceptance: [...acceptance],
          budget,
        })
        if (params.missionID)
          yield* runs.appendEvent({
            runID: run.id,
            kind: "mission.attached",
            payload: { missionID: params.missionID, worktree: missionWorktree },
          })

        // 名册快照已经在目标解析阶段冻结：团队复制当前名册，单专家生成一人名册。
        // 运行之后不再读取员工目录，保证改名、归档或岗位变更不影响历史解释。

        // 团队 worktree（§10.1）：成员在独立副本里写，证据绑定提交而不是「用户当时恰好存盘的样子」。
        // 归属目标时从目标工作区切，接着上次做到的地方往下做。
        const worktree = yield* prepareWorktree(
          { runs },
          { runID: run.id, base: missionWorktree ?? directory, name: target.name },
        )
        const row = yield* runs.addTeam({
          runID: run.id,
          profileID: target.id,
          profileVersion: live ? live.version : undefined,
          ...(live ? { rosterSnapshot: live as unknown as Record<string, unknown> } : {}),
          worktree: worktree.kind === "created" ? worktree.worktree.directory : undefined,
        })

        // 验收归到这一队：不归属的验收只会等到合并后重验，团队跑完时没有任何
        // 团队级证据 —— 「谁没做到」就无从回答，打回也打不中。
        const registered: string[] = []
        for (const [index, line] of acceptance.entries()) {
          const created = yield* verification.register({
            runID: run.id,
            specID: `${run.id}:${index}`,
            text: line.text,
            kind: line.kind ?? "rubric",
            expected: line.expected,
            owner: row.id,
          })
          registered.push(created.id)
        }

        // 计划只有一条：选中的团队。版本号从 1 开始，批准绑定这个版本。
        // 授权写进计划里：缺省只读，模型只能在用户明确要求时申请放宽 ——
        // 而放宽要用户自己批准（下面「selected 直接批准」只覆盖只读运行）。
        yield* runs.update({
          runID: run.id,
          plan: {
            teams: [
              {
                name: target.name,
                profileID: target.id,
                profileVersion: live ? live.version : undefined,
                acceptance: registered,
              },
            ],
            policy: { readOnly },
          },
          planVersion: 1,
          // 计划先以待批准状态落库，下面对安全的只读计划立即批准；这样计划版本、
          // 预算和审批事件仍然走同一条状态机，不会因为自动模式而绕过审计。
          state: "awaiting_approval",
        })
        yield* runs.appendEvent({
          runID: run.id,
          kind: "plan.created",
          payload: {
            planVersion: 1,
            team: target.name,
            acceptance: registered.length,
            roster: live ? live.roster.length : 0,
            missionID: params.missionID,
            mode,
            readOnly,
          },
        })

        // `selected` 和 `auto` 的只读派发都属于低风险的执行授权：前者是用户点名，
        // 后者是用户开启了按需协作。两者都可以自动批准；写入或外部副作用仍必须
        // 回到运行页由用户确认，不能因为「自动选人」而扩大权限。
        const needsApproval = !readOnly
        const approval = needsApproval ? "awaiting user approval" : "approved"
        let autoStarted = false
        if (!needsApproval) {
          yield* runs.approve({ runID: run.id, planVersion: 1, budget, by: "main" })
          if (mode === "auto") {
            // 复用 HTTP 执行入口：这里不会复制编排器逻辑，也不会绕过执行前的
            // 审计、结果不明检查、并发锁和 watchdog。没有 HTTP runtime 时由桥接层
            // 保持 no-op，测试仍可验证授权状态。
            autoStarted = yield* TeamAutoStart.start({ runID: run.id, directory })
          }
        }

        return {
          title: `Run ${run.id}`,
          output: [
            `run_id: ${run.id}`,
            `team: ${target.name}`,
            `state: ${approval}`,
            live
              ? `roster: ${live.roster.length} member(s), captain ${live.roster.find((entry) => entry.employee.id === live.captain)?.employee.name ?? live.captain}`
              : "roster: empty — the captain falls back to the default agent",
            worktree.kind === "created"
              ? `worktree: ${worktree.worktree.directory} (isolated; your own checkout is untouched)`
              : `worktree: not created (${worktree.reason}) — members will work in ${directory}`,
            acceptance.length
              ? `acceptance: ${acceptance.length} item(s), passing requires verification records (unverified never counts as pass)`
              : "acceptance: none declared — the run can only end as partial",
            readOnly
              ? "policy: read-only — this run cannot modify the workspace"
              : "policy: writable — the user must approve it before it can touch the workspace",
            needsApproval
              ? "Review and approve it in the Runs page before it can execute."
              : autoStarted
                ? "Approved and started automatically because this run is read-only."
                : "Approved automatically because this run is read-only; it is ready to execute.",
            // 运行是分叉出去的：告诉模型怎么查，而不是让它下次凭记忆下结论。
            "Check progress with team_run_status instead of assuming it finished.",
          ].join("\n"),
          metadata: { runID: run.id, state: needsApproval ? "awaiting_approval" : "running" },
        }
      }).pipe(Effect.orDie),
  }),
)

/**
 * `team_run_status`：主智能体怎么知道「那次运行后来怎么样了」（§13）。
 *
 * 运行是分叉出去的，`team_run` 在计划落库后就返回了句柄；之后用户批准、执行、返工、
 * 合并都发生在别处。没有这个入口，模型只能靠猜 —— 而猜测会变成「已经修好了」这种假汇报。
 *
 * 三条约束：
 * 1. **只答自己发起的运行。** 会话里只能查本会话创建的运行，不提供跨会话检索。
 * 2. **只回结论与计数，不回内容。** 报告原文、命令、路径一概不出：它们可能很长，
 *    也可能夹带不该进日志的东西（与运行页、回放同一条约束）。
 * 3. **说话要跟着状态走。** 「等批准」「正在跑」「需要核对副作用」是三种不同的下一步，
 *    不能都回一句「进行中」。
 */
export const TeamRunStatusParameters = Schema.Struct({
  runID: Schema.optional(Schema.String).annotate({
    description: "The run to inspect. Defaults to the newest run created from this session.",
  }),
})

export const TeamRunStatusTool = Tool.define<typeof TeamRunStatusParameters, { runID?: string; state?: string }, never>(
  "team_run_status",
  Effect.succeed({
    description: [
      "Check a team run started from this session: state, per-team phase, verification counts and whether",
      "any tool operation still needs human review. Returns facts only — never the captain's report text.",
      "Use it instead of assuming a run finished; a run that produced nothing ends as partial, never done.",
    ].join(" "),
    parameters: TeamRunStatusParameters,
    capabilities: { readOnly: true, concurrencySafe: true, idempotent: true },
    execute: (params: Schema.Schema.Type<typeof TeamRunStatusParameters>, ctx: Tool.Context) =>
      Effect.gen(function* () {
        const runs = Option.getOrUndefined(yield* Effect.serviceOption(TeamRunService))
        const verification = Option.getOrUndefined(yield* Effect.serviceOption(TeamVerificationService))
        const opLog = Option.getOrUndefined(yield* Effect.serviceOption(TeamOpLogService))
        if (!runs)
          return {
            title: "Team runs unavailable",
            output: "Team orchestration is not enabled in this runtime.",
            metadata: {},
          }

        const run = params.runID ? yield* runs.get(params.runID) : (yield* runs.list({ sessionID: ctx.sessionID }))[0]
        if (!run)
          return {
            title: "No team run",
            output: params.runID
              ? `No run with id ${params.runID} in this workspace.`
              : "This session has not started a team run yet.",
            metadata: {},
          }
        // 只答本会话发起的运行：跨会话查别人的运行等于让模型读到了不属于它的上下文。
        if (run.sessionID !== ctx.sessionID)
          return {
            title: "No team run",
            output: `Run ${run.id} was not started from this session.`,
            metadata: {},
          }

        const [teams, summary, pending] = yield* Effect.all([
          runs.teams(run.id),
          verification ? verification.summary({ runID: run.id }) : Effect.succeed(undefined),
          opLog ? opLog.needsReview(run.id) : Effect.succeed([]),
        ])

        const next = (() => {
          if (run.state === "awaiting_approval")
            return "The user must approve this run in the Runs page before it starts."
          if (run.state === "planning")
            return "The plan is incomplete: add acceptance criteria before it can be approved."
          if (run.state === "running") return "Still running. Check again later."
          if (run.state === "blocked")
            return "Stopped on a dependency that will not arrive. Re-running it re-queues failed teams."
          if (run.state === "needs_review")
            return "A tool operation has an unknown outcome; verify its side effects before retrying."
          if (run.state === "done") return "Delivered and verified. Merging is a separate step the user decides."
          if (run.state === "partial")
            return "Some acceptance criteria are not verified. Pass never includes unverified items."
          if (run.state === "failed") return "No deliverable result. Read the reason above; do not report success."
          if (run.state === "exceeded") return "Stopped on attempts or budget. A new run needs a new approval."
          if (run.state === "cancelled") return "Cancelled. Nothing is still running."
          return "Closed."
        })()

        return {
          title: `Run ${run.id} · ${run.state}`,
          output: [
            `run_id: ${run.id}`,
            `state: ${run.state}${run.phase ? ` (phase: ${run.phase})` : ""}`,
            `plan_version: ${run.planVersion}${run.approval ? ` (approved for plan ${run.approval.planVersion})` : " (not approved)"}`,
            `teams: ${teams.length}${teams.length ? " — " + teams.map((team) => team.phase).join(", ") : ""}`,
            summary
              ? `acceptance: pass ${summary.pass}, fail ${summary.fail}, unverified ${summary.unverified}, stale ${summary.stale} (verdict: ${summary.verdict})`
              : "acceptance: not recorded",
            `operations_awaiting_review: ${pending.length}`,
            run.error ? `reason: ${run.error}` : "",
            `next: ${next}`,
          ]
            .filter((line) => line !== "")
            .join(String.fromCharCode(10)),
          metadata: { runID: run.id, state: run.state },
        }
      }).pipe(Effect.orDie),
  }),
)
