import { Effect, Option, Schema } from "effect"
import * as Tool from "./tool"
import { Service as TeamService } from "@/team/team"
import { Service as TeamRunService } from "@/team/run"
import { Service as TeamVerificationService } from "@/team/verification"
import { Service as TeamMissionService } from "@/team/mission"
import { Service as SessionService } from "@/session/session"
import { fromLive } from "@/team/roster"
import { attachMission, prepareWorktree } from "@/team/setup"
import * as TeamSwitch from "@/team/switch"
import { Config } from "@/config/config"

/**
 * `team_run`：把一次团队派发登记成运行，然后**停在这里等人批准**。
 *
 * 为什么不在工具里直接执行：运行阶段要多次调用模型（队长拆解、验证器裁决），
 * 它属于后台任务，不该占用工具调用这一个回合；更重要的是，§4.2 要求
 * 「Auto 模式必须显式批准后才能派发」。工具只负责「建运行 + 定计划」，
 * 批准与执行由用户在运行页完成 —— 这一步不能由主智能体代劳。
 *
 * 会话的 `teamMode` 决定可用团队（§4.2）：
 * - `off`：不派发，直接告诉模型去请用户选择；
 * - `selected`：只接受 `teamIDs` 里的团队，且计划可以直接批准（不阻塞用户）；
 * - `auto`：只接受 `autoEligible` 团队，计划必须等用户批准。
 */

const AcceptanceInput = Schema.Struct({
  text: Schema.String.annotate({ description: "可验证的验收标准（一句话，能被复核）" }),
  kind: Schema.optional(Schema.Literals(["test", "diff", "file", "rubric", "human"])),
  expected: Schema.optional(Schema.String).annotate({ description: "预期结果；能写具体值就写具体值" }),
})

export const TeamRunParameters = Schema.Struct({
  team: Schema.String.annotate({ description: "团队 ID 或名字；必须出现在本次会话的团队目录里" }),
  goal: Schema.String.annotate({ description: "这一轮要交付什么（面向结果，不写过程）" }),
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
      "Dispatch a team from this session's team catalog.",
      "Creates a run with a plan and acceptance criteria, then stops: the user starts it, and approves it first unless it is a read-only run of a team they picked.",
      "Runs are read-only unless the user asked for changes; asking for writes (allowWrites) always waits for the user's approval.",
      "Works only when the user picked a team (or Auto) for this session; otherwise tell the user to choose one.",
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
              "This session has no team catalog: the user has not selected a team. " +
              "Ask the user to pick a team (or Auto) at the composer before dispatching.",
            metadata: {},
          }
        }

        // 目录过滤：Auto 只看 autoEligible，selected 只看用户点过的那几个。
        // 目录是本工具的唯一授权来源 —— 名字对不上就是整次派发失败，不静默改派。
        const wanted = new Set(mode === "selected" ? (session?.teamIDs ?? []) : [])
        const candidates: Array<{ id: string; name: string }> = []
        for (const team of yield* teams.list()) {
          if (mode === "selected" && !wanted.has(team.id)) continue
          if (mode === "auto" && !team.autoEligible) continue
          const root = yield* sessions.get(team.rootSessionID).pipe(Effect.catch(() => Effect.succeed(undefined)))
          // 团队属于它的根会话目录；跨项目的同名团队不能被「猜」到。
          if (root && root.directory !== directory) continue
          candidates.push({ id: team.id, name: team.name })
        }

        const target = candidates.find((team) => team.id === params.team || team.name === params.team)
        if (!target) {
          return yield* Effect.fail(
            new Error(
              candidates.length === 0
                ? `No team is available for this session (mode: ${mode}).`
                : `Unknown team "${params.team}". Available: ${candidates.map((team) => team.name).join(", ")}.`,
            ),
          )
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
          acceptance: [...acceptance],
          budget,
        })
        if (params.missionID)
          yield* runs.appendEvent({
            runID: run.id,
            kind: "mission.attached",
            payload: { missionID: params.missionID, worktree: missionWorktree },
          })

        // 名册快照（§5.2）：把**当前**的团队复制进运行。之后成员变动不影响这次运行，
        // 队长与成员职责也都从这份快照读 —— 否则派发时只剩一个默认 agent。
        const live = fromLive({ teamID: target.id, name: target.name, members: yield* teams.members(target.id) })

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
          // 有计划就应当等批准：停在没有按钮可点的 `planning` 等于把运行卡死。
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

        // `selected` 是用户点过名的一次性授权，只读运行直接批准，不阻塞对话；
        // `auto` 必须由用户在运行页确认（§4.2 的批准语义）。
        // 申请写权限也一律要批准：点名团队不等于把人家的仓库交出去。
        const needsApproval = mode === "auto" || !readOnly
        const approval = needsApproval ? "awaiting user approval" : "approved"
        if (!needsApproval) {
          yield* runs.approve({ runID: run.id, planVersion: 1, budget, by: "main" })
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
              ? "Ask the user to review and approve it in the Runs page; it will not start on its own."
              : "The user can start it from the Runs page.",
          ].join("\n"),
          metadata: { runID: run.id, state: needsApproval ? "awaiting_approval" : "planned" },
        }
      }).pipe(Effect.orDie),
  }),
)
