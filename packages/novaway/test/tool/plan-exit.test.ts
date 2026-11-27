import { describe, expect } from "bun:test"
import { Cause, Effect, Exit, Layer } from "effect"
import { AppFileSystem } from "@novaway/core/filesystem"
import { CrossSpawnSpawner } from "@novaway/core/cross-spawn-spawner"
import { Agent } from "@/agent/agent"
import { BackgroundJob } from "@/background/job"
import { Bus } from "@/bus"
import { Question } from "@/question"
import { Provider } from "@/provider/provider"
import { PlanApproval } from "@/session/plan-approval"
import { MessageV2 } from "@/session/message-v2"
import { MessageID, SessionID } from "@/session/schema"
import { Session } from "@/session/session"
import { Storage } from "@/storage/storage"
import { SyncEvent } from "@/sync"
import { Truncate } from "@/tool/truncate"
import { Service as MailboxService } from "@/team/mailbox"
import { Service as TeamService } from "@/team/team"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { PlanExitTool } from "@/tool/plan"
import { provideInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import type { Tool } from "@/tool/tool"
import * as Log from "@novaway/core/util/log"

void Log.init({ print: false })

/**
 * `plan_exit` 的执行级回归 —— 用户可观测行为的最终证明。
 *
 * 这里不断言"某函数被调用过"，而是断言**会话状态真的改了**：
 * 权限档位是否回到进入计划模式之前、选择「继续规划」是否什么都没动、
 * 非计划档位调用是否是无害 no-op。
 *
 * Question / Provider / Mailbox / Team 用 `Layer.mock` 挡掉（它们只在交互分支里
 * 被用到，真实的等待弹窗在单测里没法走），Session / PlanApproval / AppFileSystem
 * 走真实现 —— 断言落在真实服务状态上，不是断言 mock。
 */

const model = { providerID: "test" as never, modelID: "test-model" as never }

type Captured = {
  questions: ReadonlyArray<{
    question: string
    header: string
    custom?: boolean
    options: ReadonlyArray<{ label: string; description?: string }>
  }>
}

const asked: Captured[] = []
/** 下一次 `question.ask` 返回的答案（模拟用户点哪一项）。 */
let answer: string[] = []

const questionLayer = Layer.mock(Question.Service, {
  ask: (input: Captured) =>
    Effect.sync(() => {
      asked.push(input)
      return [answer] as never
    }),
})

const planApprovalLayer = Layer.mock(PlanApproval.Service, {
  request: (input: { onPending?: (pending: PlanApproval.Pending) => Effect.Effect<void> }) =>
    Effect.gen(function* () {
      if (input.onPending) {
        yield* input.onPending({
          id: "plan-test-request" as PlanApproval.RequestID,
          sessionID: "ses_plan_test" as SessionID,
          plan: ".novaway/plans/test.md",
          createdAt: Date.now(),
        })
      }
      const choice = answer[0]
      return {
        approved: choice !== "Continue planning",
        ...(answer[1] ? { feedback: answer[1] } : {}),
        ...(choice === "Execute in goal mode" ? { execution: "goal" as const } : { execution: "standard" as const }),
      }
    }),
  reply: () => Effect.succeed(true),
  list: () => Effect.succeed([]),
  clear: () => Effect.void,
})

const providerLayer = Layer.mock(Provider.Service, {
  defaultModel: () => Effect.succeed(model),
})

// 只有 `info.parentID` 存在时才会碰邮箱/团队；这里用不到，但要满足工具 init 的依赖。
const mailboxLayer = Layer.mock(MailboxService, {})
const teamLayer = Layer.mock(TeamService, {})

const layer = Layer.mergeAll(
  Session.layer.pipe(
    Layer.provide(Bus.layer),
    Layer.provide(Storage.defaultLayer),
    Layer.provide(SyncEvent.defaultLayer),
    Layer.provide(RuntimeFlags.layer({ experimentalWorkspaces: false })),
    Layer.provide(BackgroundJob.defaultLayer),
  ),
  Bus.layer,
  planApprovalLayer,
  AppFileSystem.defaultLayer,
  CrossSpawnSpawner.defaultLayer,
  Truncate.defaultLayer,
  Agent.defaultLayer,
  questionLayer,
  providerLayer,
  mailboxLayer,
  teamLayer,
)
const it = testEffect(layer)

const context = (sessionID: SessionID) =>
  ({
    sessionID,
    messageID: MessageID.make("msg_plan_exit"),
    callID: "",
    agent: "creova",
    abort: AbortSignal.any([]),
    messages: [],
    metadata: () => Effect.void,
    ask: () => Effect.void,
  }) as unknown as Tool.Context

/** 建一个会话 + 一条带模型的用户消息（`plan_exit` 要从中取 model 起下一轮）。 */
const setup = (input: { mode?: "plan" | "default"; returnMode?: "acceptEdits" } = {}) =>
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    const chat = yield* sessions.create({
      title: "Plan exit",
      permission: [],
      ...(input.mode ? { permissionMode: input.mode } : {}),
    })
    if (input.mode === "plan" && input.returnMode) {
      yield* sessions.setPlanReturnMode({ sessionID: chat.id, mode: input.returnMode })
    }
    yield* sessions.updateMessage({
      id: MessageID.ascending(),
      sessionID: chat.id,
      role: "user",
      time: { created: Date.now() },
      agent: "creova",
      model,
    } satisfies MessageV2.User)
    const info = yield* PlanExitTool
    const tool = yield* info.init()
    return { chat, tool, sessions }
  })

/** `info.init()` 产出的是 `DefWithoutID`（带 execute、不带 id），所以这里按结构收。 */
type Runnable = {
  execute: (args: {}, ctx: Tool.Context) => Effect.Effect<Tool.ExecuteResult<Record<string, unknown>>>
}

const run = (tool: Runnable, sessionID: SessionID) =>
  Effect.gen(function* () {
    return yield* tool.execute({}, context(sessionID))
  })

describe("tool.plan_exit", () => {
  it.instance(
    "Start execution leaves plan mode and restores the previous permission mode",
    () =>
      Effect.gen(function* () {
        asked.length = 0
        answer = ["Start execution"]
        const { chat, tool, sessions } = yield* setup({ mode: "plan", returnMode: "acceptEdits" })

        const result = yield* run(tool, chat.id)

        expect(result.title).toBe("Leaving plan mode")
        expect(result.metadata).toMatchObject({ execution: "standard" })
        // 用户可观测的核心：档位真的回去了，不是"计划模式永久粘住"。
        expect(yield* sessions.permissionModeOf(chat.id)).toBe("acceptEdits")
        // 用掉的返回档位必须清掉，否则下次进计划模式会带出上一次的旧值。
        expect(yield* sessions.planReturnModeOf(chat.id)).toBeUndefined()

        // 专用计划审批服务负责渲染计划卡；主会话不再调用 question 工具。
        expect(asked).toHaveLength(0)
      }).pipe(provideInstance(process.cwd())),
    30_000,
  )

  it.instance(
    "Start execution clears an inherited plan mode without an explicit return mode",
    () =>
      Effect.gen(function* () {
        asked.length = 0
        answer = ["Start execution"]
        const { chat, tool, sessions } = yield* setup({ mode: "plan" })

        const result = yield* run(tool, chat.id)

        expect(result.title).toBe("Leaving plan mode")
        // 没有显式 return mode 时必须用 null 清除，而不是把 undefined 写入 session patch。
        expect(yield* sessions.permissionModeOf(chat.id)).toBeUndefined()
        expect(yield* sessions.planReturnModeOf(chat.id)).toBeUndefined()
        expect(asked).toHaveLength(0)
      }).pipe(provideInstance(process.cwd())),
    30_000,
  )

  it.instance(
    "Continue planning changes nothing",
    () =>
      Effect.gen(function* () {
        asked.length = 0
        answer = ["Continue planning", "请补充第二阶段的验收标准"]
        const { chat, tool, sessions } = yield* setup({ mode: "plan", returnMode: "acceptEdits" })

        const result = yield* run(tool, chat.id)

        expect(result.title).toBe("继续完善计划")
        expect(result.metadata).toMatchObject({ approvalState: "continue", feedback: "请补充第二阶段的验收标准" })
        expect(result.output).toContain("请补充第二阶段的验收标准")
        // “继续完善计划”是有效的审批回复，不应被渲染成工具失败。
        expect(Exit.isFailure(yield* Effect.exit(Effect.succeed(result)))).toBe(false)
        // 档位和返回档位都不能被动过。
        expect(yield* sessions.permissionModeOf(chat.id)).toBe("plan")
        expect(yield* sessions.planReturnModeOf(chat.id)).toBe("acceptEdits")
      }).pipe(provideInstance(process.cwd())),
    30_000,
  )

  it.instance(
    "is a no-op when the session is not in plan mode",
    () =>
      Effect.gen(function* () {
        asked.length = 0
        answer = ["Start execution"]
        const { chat, tool, sessions } = yield* setup({ mode: "default" })

        const result = yield* run(tool, chat.id)

        expect(result.title).toBe("Plan mode is not active")
        // 恒注册的代价必须可控：非计划档位下不许弹确认、不许改档位。
        expect(asked).toHaveLength(0)
        // 档位原样保留（这里显式给了 default），绝不能被"没开计划模式"的调用改掉。
        expect(yield* sessions.permissionModeOf(chat.id)).toBe("default")
        // 也不该往会话里插"计划已批准"的合成消息（会误导模型开始实施）。
        const messages = yield* sessions.messages({ sessionID: chat.id })
        expect(messages.filter((item) => item.info.role === "user")).toHaveLength(1)
      }).pipe(provideInstance(process.cwd())),
    30_000,
  )

  it.instance(
    "Execute in goal mode fails loudly when no goal runner is wired",
    () =>
      Effect.gen(function* () {
        asked.length = 0
        answer = ["Execute in goal mode"]
        const { chat, tool } = yield* setup({ mode: "plan", returnMode: "acceptEdits" })

        const exit = yield* run(tool, chat.id).pipe(Effect.exit)

        // 不能静默降级成普通实施 —— 用户明确选了 goal，就得让他看见失败。
        expect(Exit.isFailure(exit)).toBe(true)
        const text = Exit.isFailure(exit) ? Cause.pretty(exit.cause) : ""
        expect(text).toMatch(/Goal execution is unavailable/i)
      }).pipe(provideInstance(process.cwd())),
    30_000,
  )
})
