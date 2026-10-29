import { Effect, Option, Schema } from "effect"
import * as Tool from "./tool"
import { Service as TeamService } from "@/team/team"
import { Service as TeamRunService } from "@/team/run"
import { Service as TeamVerificationService } from "@/team/verification"
import { Service as SessionService } from "@/session/session"

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
})

export const DEFAULT_TEAM_BUDGET = 200_000

export const TeamRunTool = Tool.define<typeof TeamRunParameters, { runID?: string; state?: string }, never>(
  "team_run",
  Effect.succeed({
    description: [
      "Dispatch a team from this session's team catalog.",
      "Creates a run with a plan and acceptance criteria, then stops: the user approves and starts it from the Runs page.",
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
        if (!sessions || !teams || !runs || !verification) {
          return {
            title: "Team runs unavailable",
            output: "Team orchestration is not enabled in this runtime.",
            metadata: {},
          }
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

        const budget = { tokens: params.tokens ?? DEFAULT_TEAM_BUDGET }
        const acceptance = params.acceptance ?? []
        const run = yield* runs.create({
          sessionID: ctx.sessionID,
          directory,
          mode: mode === "auto" ? "auto" : "team",
          goal: params.goal,
          acceptance: [...acceptance],
          budget,
        })

        const registered: string[] = []
        for (const [index, line] of acceptance.entries()) {
          const created = yield* verification.register({
            runID: run.id,
            specID: `${run.id}:${index}`,
            text: line.text,
            kind: line.kind ?? "rubric",
            expected: line.expected,
          })
          registered.push(created.id)
        }

        // 计划只有一条：选中的团队。版本号从 1 开始，批准绑定这个版本。
        yield* runs.update({
          runID: run.id,
          plan: { teams: [{ name: target.name, acceptance: registered }] },
          planVersion: 1,
        })
        yield* runs.addTeam({ runID: run.id, rosterSnapshot: { teamID: target.id, name: target.name } })
        yield* runs.appendEvent({
          runID: run.id,
          kind: "plan.created",
          payload: { planVersion: 1, team: target.name, acceptance: registered.length, mode },
        })

        // `selected` 是用户点过名的一次性授权，直接批准，不阻塞对话；
        // `auto` 必须由用户在运行页确认（§4.2 的批准语义）。
        const approval = mode === "auto" ? "awaiting user approval" : "approved"
        if (mode !== "auto") {
          yield* runs.approve({ runID: run.id, planVersion: 1, budget, by: "main" })
        }

        return {
          title: `Run ${run.id}`,
          output: [
            `run_id: ${run.id}`,
            `team: ${target.name}`,
            `state: ${approval}`,
            acceptance.length
              ? `acceptance: ${acceptance.length} item(s), passing requires verification records (unverified never counts as pass)`
              : "acceptance: none declared — the run can only end as partial",
            mode === "auto"
              ? "Ask the user to review and approve it in the Runs page; it will not start on its own."
              : "The user can start it from the Runs page.",
          ].join("\n"),
          metadata: { runID: run.id, state: mode === "auto" ? "awaiting_approval" : "planned" },
        }
      }).pipe(Effect.orDie),
  }),
)
