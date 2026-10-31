import { afterEach, describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Agent } from "@/agent/agent"
import { BackgroundJob } from "@/background/job"
import { Bus } from "@/bus"
import { Config } from "@/config/config"
import { CrossSpawnSpawner } from "@novaway/core/cross-spawn-spawner"
import { Session } from "@/session/session"
import { MessageV2 } from "@/session/message-v2"
import type { SessionPrompt } from "@/session/prompt"
import { MessageID, PartID } from "@/session/schema"
import { SessionRunState } from "@/session/run-state"
import { SessionStatus } from "@/session/status"
import { ModelID, ProviderID } from "@/provider/schema"
import { TaskTool, type TaskPromptOps } from "@/tool/task"
import { Truncate } from "@/tool/truncate"
import { ToolRegistry } from "@/tool/registry"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { defaultLayer as TeamLayer } from "@/team/team"
import { defaultLayer as AgentTaskListLayer } from "@/team/task-list"
import { defaultLayer as AgentMailboxLayer } from "@/team/mailbox"
import { defaultLayer as HookLayer } from "@/hook/service"
import { Service as TeamRun, defaultLayer as TeamRunLayer } from "@/team/run"
import { Service as TeamOpLog, defaultLayer as TeamOpLogLayer } from "@/team/op-log"
import { disposeAllInstances } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

afterEach(async () => {
  await disposeAllInstances()
})

const ref = {
  providerID: ProviderID.make("test"),
  modelID: ModelID.make("test-model"),
}

// 归属只由派发路径写入，所以这里必须把运行与坐标服务一起装上：
// 少了它们，task 只能继承，看不到「按名册指认」这一半。
const layer = Layer.mergeAll(
  Agent.defaultLayer,
  BackgroundJob.defaultLayer,
  Bus.defaultLayer,
  Config.defaultLayer,
  CrossSpawnSpawner.defaultLayer,
  Session.defaultLayer,
  SessionRunState.defaultLayer,
  SessionStatus.defaultLayer,
  Truncate.defaultLayer,
  ToolRegistry.defaultLayer,
  TeamLayer,
  AgentTaskListLayer,
  AgentMailboxLayer,
  HookLayer,
  TeamRunLayer,
  TeamOpLogLayer,
  RuntimeFlags.layer({}),
)

const it = testEffect(layer)

function stubOps(): TaskPromptOps {
  const reply = (input: SessionPrompt.PromptInput): MessageV2.WithParts => {
    const id = MessageID.ascending()
    return {
      info: {
        id,
        role: "assistant",
        parentID: input.messageID ?? MessageID.ascending(),
        sessionID: input.sessionID,
        mode: input.agent ?? "general",
        agent: input.agent ?? "general",
        cost: 0,
        path: { cwd: "/tmp", root: "/tmp" },
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        modelID: ref.modelID,
        providerID: ref.providerID,
        time: { created: Date.now() },
        finish: "stop",
      },
      parts: [{ id: PartID.ascending(), messageID: id, sessionID: input.sessionID, type: "text", text: "done" }],
    }
  }
  return {
    cancel: () => Effect.void,
    resolvePromptParts: (template) => Effect.succeed([{ type: "text" as const, text: template }]),
    prompt: (input) => Effect.sync(() => reply(input)),
    loop: (input) => Effect.succeed(reply({ sessionID: input.sessionID, parts: [] })),
  }
}

/** 根会话 → 队长会话（带员工与运行归属）→ 一次 task 派发。 */
const seed = Effect.fn("TaskAttribution.seed")(function* () {
  const session = yield* Session.Service
  const runs = yield* TeamRun
  const ops = yield* TeamOpLog

  const root = yield* session.create({ title: "根会话" })
  const run = yield* runs.create({ sessionID: root.id, directory: "/tmp", mode: "team", goal: "审查" })
  const team = yield* runs.addTeam({
    runID: run.id,
    profileID: "prof_test",
    rosterSnapshot: {
      profileID: "prof_test",
      name: "审查组",
      version: 1,
      captain: "emp_captain",
      roster: [
        {
          employee: { id: "emp_captain", name: "老周", job: "general", archived: false },
          role: "captain",
          order: 0,
          canAutoDispatch: true,
        },
        {
          employee: { id: "emp_review", name: "小林", job: "general", archived: false },
          role: "worker",
          order: 1,
          canAutoDispatch: true,
        },
      ],
    },
  })
  // 队长会话：父会话是运行根会话，身上带着名册队长的员工身份与运行坐标。
  const captain = yield* session.create(
    { parentID: root.id, title: "队长" },
    { employeeID: "emp_captain", runID: run.id },
  )
  yield* ops.scope({ sessionID: captain.id, runID: run.id, taskID: team.id })

  const user = yield* session.updateMessage({
    id: MessageID.ascending(),
    role: "user",
    sessionID: captain.id,
    agent: "general",
    model: ref,
    time: { created: Date.now() },
  })
  const assistant: MessageV2.Assistant = {
    id: MessageID.ascending(),
    role: "assistant",
    parentID: user.id,
    sessionID: captain.id,
    mode: "build",
    agent: "general",
    cost: 0,
    path: { cwd: "/tmp", root: "/tmp" },
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    modelID: ref.modelID,
    providerID: ref.providerID,
    time: { created: Date.now() },
  }
  yield* session.updateMessage(assistant)
  return { session, captain, assistant, run }
})

describe("tool.task attribution", () => {
  it.instance("a named member dispatch is booked to that person and keeps the run coordinate", () =>
    Effect.gen(function* () {
      const { session, captain, assistant, run } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()

      yield* def.execute(
        { description: "审查下载流程", prompt: "review the download flow", subagent_type: "general", name: "小林" },
        {
          sessionID: captain.id,
          messageID: assistant.id,
          agent: "general",
          abort: new AbortController().signal,
          extra: { promptOps: stubOps() },
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
        },
      )

      const children = yield* session.children(captain.id)
      expect(children).toHaveLength(1)
      // 按名册姓名指认：这次工作记在小林名下，并带着同一次运行的坐标。
      expect(children[0]).toMatchObject({ employeeID: "emp_review", runID: run.id })
    }),
  )

  it.instance("an unnamed dispatch from the captain is unattributed instead of guessing", () =>
    Effect.gen(function* () {
      const { session, captain, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()

      yield* def.execute(
        { description: "临时助手", prompt: "do something small", subagent_type: "general" },
        {
          sessionID: captain.id,
          messageID: assistant.id,
          agent: "general",
          abort: new AbortController().signal,
          extra: { promptOps: stubOps() },
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
        },
      )

      const children = yield* session.children(captain.id)
      expect(children).toHaveLength(1)
      // 队长没写出成员姓名：宁可显示「未归属」，也不把别人的工时挂到队长头上。
      expect(children[0].employeeID).toBeUndefined()
      // 运行坐标仍然继承：未归属不等于和这次运行无关。
      expect(children[0].runID).toBeTruthy()
    }),
  )

  it.instance("a helper spawned by a member inherits the member identity", () =>
    Effect.gen(function* () {
      const { session, captain, assistant, run } = yield* seed()
      const member = yield* session.create(
        { parentID: captain.id, title: "小林" },
        { employeeID: "emp_review", runID: run.id },
      )
      const user = yield* session.updateMessage({
        id: MessageID.ascending(),
        role: "user",
        sessionID: member.id,
        agent: "general",
        model: ref,
        time: { created: Date.now() },
      })
      const memberAssistant: MessageV2.Assistant = {
        ...assistant,
        id: MessageID.ascending(),
        parentID: user.id,
        sessionID: member.id,
      }
      yield* session.updateMessage(memberAssistant)

      const tool = yield* TaskTool
      const def = yield* tool.init()
      yield* def.execute(
        { description: "跑一条命令", prompt: "run it", subagent_type: "general", name: "老周" },
        {
          sessionID: member.id,
          messageID: memberAssistant.id,
          agent: "general",
          abort: new AbortController().signal,
          extra: { promptOps: stubOps() },
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
        },
      )

      const helpers = yield* session.children(member.id)
      expect(helpers).toHaveLength(1)
      // 成员派生出的子代理算这个成员的工时，不会因为名字写成别人就改归属。
      expect(helpers[0]).toMatchObject({ employeeID: "emp_review", runID: run.id })
    }),
  )
})

