import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { TeamRunTool } from "../../src/tool/team-run"
import { Service as TeamService, defaultLayer as TeamLayer } from "@/team/team"
import { Service as TeamRunService, defaultLayer as RunLayer } from "@/team/run"
import { Service as VerificationService, defaultLayer as VerificationLayer } from "@/team/verification"
import { Service as MissionService, defaultLayer as MissionLayer } from "@/team/mission"
import { Session } from "@/session/session"
import { SessionID, MessageID } from "@/session/schema"
import { Truncate } from "@/tool/truncate"
import { Agent } from "@/agent/agent"
import { defaultLayer as PlanApprovalLayer } from "@/session/plan-approval"
import { CrossSpawnSpawner } from "@novaway/core/cross-spawn-spawner"
import { tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(
  Layer.mergeAll(
    TeamLayer,
    RunLayer,
    VerificationLayer,
    MissionLayer,
    Truncate.defaultLayer,
    Agent.defaultLayer,
    PlanApprovalLayer,
    Session.defaultLayer,
    CrossSpawnSpawner.defaultLayer,
  ),
)

const runIDOf = (metadata: { runID?: string }) => {
  const runID = metadata.runID
  if (!runID) throw new Error("team_run 没有返回 run_id")
  return runID
}

const ctx = (sessionID: SessionID, directory: string) => ({
  sessionID,
  messageID: MessageID.make("msg_team_run"),
  agent: "build",
  directory,
  abort: new AbortController().signal,
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
})

/**
 * 聊天里派发的运行，必须和界面发起的运行是**同一种**运行：
 * 有名册（队长/成员）、有自己的 worktree、验收归这一队。
 */
describe("team_run tool", () => {
  it.instance(
    "copies the live roster, isolates the workspace and owns the acceptance",
    () =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const teams = yield* TeamService
        const runs = yield* TeamRunService
        const verification = yield* VerificationService
        const dir = yield* tmpdirScoped({ git: true })

        const session = yield* sessions.create({ title: "lead", teamMode: "selected", directory: dir })
        const team = yield* teams.create({ name: "支付改造", rootSessionID: session.id })
        yield* teams.addMember({
          teamID: team.id,
          sessionID: SessionID.make("ses_member_a"),
          name: "小明",
          agent: "build",
          role: "lead",
        })
        yield* teams.addMember({
          teamID: team.id,
          sessionID: SessionID.make("ses_member_b"),
          name: "小红",
          agent: "plan",
        })
        yield* sessions.setTeamMode({ sessionID: session.id, mode: "selected", teamIDs: [team.id] })

        const tool = yield* TeamRunTool
        const def = yield* tool.init()
        const result = yield* def.execute(
          { team: "支付改造", goal: "把支付重试补上", acceptance: [{ text: "重试三次后放弃" }] },
          ctx(session.id, dir),
        )

        const runID = runIDOf(result.metadata)
        expect(runID).toBeTruthy()
        const run = yield* runs.get(runID)
        // selected 是用户点名的授权：直接批准，但执行仍由用户在运行页启动。
        expect(run?.state).toBe("running")
        expect(run?.approval?.approvedBy).toBe("main")

        const rows = yield* runs.teams(runID)
        expect(rows.length).toBe(1)
        // 名册被复制进运行：队长是 lead，成员按顺序带上岗位。
        const snapshot = rows[0].rosterSnapshot
        expect(snapshot).toBeTruthy()
        expect(snapshot?.captain).toBe("ses_member_a")
        expect(Array.isArray(snapshot?.roster) ? snapshot.roster.length : 0).toBe(2)
        // 工作区隔离：不是「在用户目录里跑」。
        expect(rows[0].worktree).toBeTruthy()
        expect(rows[0].worktree).not.toBe(dir)

        // 验收归属这一队 —— 否则团队跑完时没有任何团队级证据。
        const acceptances = yield* verification.list(runID)
        expect(acceptances.length).toBe(1)
        expect(acceptances[0].owner).toBe(rows[0].id)

        const events = yield* runs.events({ runID })
        expect(events.map((event) => event.kind)).toContain("worktree.created")
        expect(events.find((event) => event.kind === "plan.created")?.payload?.roster).toBe(2)
        // 工具要如实说明隔离与名册，不能只说「创建了运行」。
        expect(result.output).toContain("roster: 2 member(s)")
        expect(result.output).toContain("worktree: ")
      }),
    { timeout: 30_000 },
  )

  it.instance(
    "a run outside a repository says so instead of pretending to be isolated",
    () =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const teams = yield* TeamService
        const runs = yield* TeamRunService
        const dir = yield* tmpdirScoped()

        const session = yield* sessions.create({ title: "lead", teamMode: "selected", directory: dir })
        const team = yield* teams.create({ name: "审查", rootSessionID: session.id })
        yield* teams.addMember({
          teamID: team.id,
          sessionID: SessionID.make("ses_member_c"),
          name: "小明",
          agent: "build",
          role: "lead",
        })
        yield* sessions.setTeamMode({ sessionID: session.id, mode: "selected", teamIDs: [team.id] })

        const tool = yield* TeamRunTool
        const def = yield* tool.init()
        const result = yield* def.execute({ team: "审查", goal: "看看代码" }, ctx(session.id, dir))

        const runID = runIDOf(result.metadata)
        const rows = yield* runs.teams(runID)
        expect(rows[0].worktree).toBeUndefined()
        const events = yield* runs.events({ runID })
        expect(events.find((event) => event.kind === "worktree.skipped")?.payload?.reason).toContain("git 仓库")
        expect(result.output).toContain("worktree: not created")
      }),
    { timeout: 30_000 },
  )

  it.instance(
    "asking for writes turns the plan writable but leaves the approval to the user",
    () =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const teams = yield* TeamService
        const runs = yield* TeamRunService
        const dir = yield* tmpdirScoped({ git: true })

        const session = yield* sessions.create({ title: "lead", teamMode: "selected", directory: dir })
        const team = yield* teams.create({ name: "改代码", rootSessionID: session.id })
        yield* teams.addMember({
          teamID: team.id,
          sessionID: SessionID.make("ses_member_e"),
          name: "小明",
          agent: "build",
          role: "lead",
        })
        yield* sessions.setTeamMode({ sessionID: session.id, mode: "selected", teamIDs: [team.id] })

        const tool = yield* TeamRunTool
        const def = yield* tool.init()
        // 点名团队是「用哪个团队」的授权，不是「可以改我的仓库」的授权。
        const result = yield* def.execute(
          { team: "改代码", goal: "修掉重试 bug", allowWrites: true },
          ctx(session.id, dir),
        )

        const runID = runIDOf(result.metadata)
        const run = yield* runs.get(runID)
        expect(run?.plan?.policy?.readOnly).toBe(false)
        // 放宽必须等人批准：selected 模式的自动批准只覆盖只读运行。
        expect(run?.state).toBe("awaiting_approval")
        expect(run?.approval).toBeUndefined()
        expect(result.output).toContain("policy: writable")
      }),
    { timeout: 30_000 },
  )

  it.instance(
    "attaching to a mission reuses its workspace and refuses a foreign one",
    () =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const teams = yield* TeamService
        const missions = yield* MissionService
        const runs = yield* TeamRunService
        const dir = yield* tmpdirScoped({ git: true })

        const mission = yield* missions.create({ directory: dir, goal: "长期目标" })
        const session = yield* sessions.create({ title: "lead", teamMode: "selected", directory: dir })
        const team = yield* teams.create({ name: "长期团队", rootSessionID: session.id })
        yield* teams.addMember({
          teamID: team.id,
          sessionID: SessionID.make("ses_member_d"),
          name: "小明",
          agent: "build",
          role: "lead",
        })
        yield* sessions.setTeamMode({ sessionID: session.id, mode: "selected", teamIDs: [team.id] })

        const tool = yield* TeamRunTool
        const def = yield* tool.init()
        const result = yield* def.execute(
          { team: "长期团队", goal: "接着做", missionID: mission.id },
          ctx(session.id, dir),
        )

        const run = yield* runs.get(runIDOf(result.metadata))
        expect(run?.missionID).toBe(mission.id)
        // 目标工作区是起点：团队 worktree 从它切，而不是从会话目录切。
        const prepared = yield* missions.prepare(mission.id)
        expect(prepared.kind === "ready" && prepared.mission.worktree).toBeTruthy()

        // 目标结束之后不允许再挂：不能悄悄当成一次性运行。
        yield* missions.setStatus({ missionID: mission.id, status: "done" })
        const refused = yield* Effect.exit(
          def.execute({ team: "长期团队", goal: "再来一次", missionID: mission.id }, ctx(session.id, dir)),
        )
        expect(refused._tag).toBe("Failure")
      }),
    { timeout: 30_000 },
  )
})
