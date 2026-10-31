import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Service as TeamService, defaultLayer as TeamLayer } from "@/team/team"
import { Service as TaskListService, defaultLayer as TaskListLayer } from "@/team/task-list"
import { Service as OpLogService, defaultLayer as OpLogLayer } from "@/team/op-log"
import { defaultLayer as HookLayer } from "@/hook/service"
import { defaultLayer as TruncateLayer } from "@/tool/truncate"
import { defaultLayer as AgentLayer } from "@/agent/agent"
import { TaskCreateTool, TaskListTool } from "@/tool/agent_task"
import * as Tool from "@/tool/tool"
import { MessageID, SessionID } from "@/session/schema"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.mergeAll(TeamLayer, TaskListLayer, OpLogLayer, HookLayer, TruncateLayer, AgentLayer) as never)

const context = (sessionID: SessionID): Tool.Context => ({
  sessionID,
  messageID: MessageID.make("msg_task_board"),
  agent: "build",
  directory: "/tmp/task-board",
  abort: new AbortController().signal,
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
})

const captain = SessionID.make("ses_run_captain")
const leader = SessionID.make("ses_session_lead")

describe("task board inside a run", () => {
  it.instance("puts the task on the run's team board instead of asking for a session team", () =>
    Effect.gen(function* () {
      const ops = yield* OpLogService
      const tasks = yield* TaskListService
      // 运行坐标里记着的 taskID 就是 `team_run_team.id`（派发时写进去的）。
      yield* ops.scope({ sessionID: captain, runID: "run_board", taskID: "rt_team_a", attempt: 1, readOnly: true })

      const create = yield* (yield* TaskCreateTool).init()
      const created = yield* create.execute({ subject: "补 refund 边界用例", description: "覆盖全额与部分退款" }, context(captain))

      // 以前这里只会回「先建团队」—— 运行里的子会话不属于任何会话临时团队。
      expect(created.metadata.teamID).toBe("rt_team_a")
      const board = yield* tasks.list("rt_team_a")
      expect(board.map((task) => task.subject)).toEqual(["补 refund 边界用例"])
      // 运行坐标写进 metadata：看板要能按运行把任务捞回来（§5.5）。
      expect(board[0].metadata.runID).toBe("run_board")

      // 会话临时团队的看板不受影响：运行里的任务不串到别处。
      expect(yield* tasks.list("t_session")).toEqual([])
    }),
  )

  it.instance("falls back to the session team when there is no run scope", () =>
    Effect.gen(function* () {
      const teams = yield* TeamService
      const tasks = yield* TaskListService
      const team = yield* teams.create({ name: "会话团队", rootSessionID: leader })

      const create = yield* (yield* TaskCreateTool).init()
      const created = yield* create.execute({ subject: "会话里的任务", description: "不属于任何运行" }, context(leader))
      expect(created.metadata.teamID).toBe(team.id)
      const board = yield* tasks.list(team.id)
      expect(board[0].metadata.runID).toBeUndefined()

      // 不在任何团队里的会话仍然得到原来的提示，而不是被塞进一个隐形的板子。
      const list = yield* (yield* TaskListTool).init()
      const orphan = yield* list.execute({}, context(SessionID.make("ses_no_team")))
      expect(orphan.title).toBe("No team")
    }),
  )

  it.instance("a member session inherited the same coordinate, so it writes to the same board", () =>
    Effect.gen(function* () {
      const ops = yield* OpLogService
      const tasks = yield* TaskListService
      const member = SessionID.make("ses_run_member")
      const scope = { runID: "run_board", taskID: "rt_team_a", attempt: 2, readOnly: true }
      yield* ops.scope({ sessionID: captain, ...scope })
      // `task` 工具派发成员时会把父会话的坐标拷过来（readOnly 后门同理）。
      yield* ops.scope({ sessionID: member, ...scope })

      const create = yield* (yield* TaskCreateTool).init()
      const created = yield* create.execute({ subject: "成员自己记一笔", description: "跟在队长同一块板上" }, context(member))
      expect(created.metadata.teamID).toBe("rt_team_a")
      // 和队长同一块板：成员不需要（也不该）有自己的看板。
      expect((yield* tasks.list("rt_team_a")).map((task) => task.subject)).toContain("成员自己记一笔")
    }),
  )
})
