import { describe, expect } from "bun:test"
import { Cause, Duration, Effect, Exit, Layer, Option } from "effect"
import { CrossSpawnSpawner } from "@novaway/core/cross-spawn-spawner"
import { Bus } from "../../src/bus"
import { Permission } from "../../src/permission"
import { InstanceBootstrap } from "../../src/project/bootstrap-service"
import { InstanceStore } from "../../src/project/instance-store"
import { SessionID, MessageID } from "../../src/session/schema"
import { testEffect } from "../lib/effect"

/**
 * 计划模式的「只读边界」回归网。
 *
 * 这里刻意用**生产同款规则集**（`{ "*": "allow" }`，与 `agent.ts` 的默认规则一致），
 * 而不是空规则集：
 *
 * - 计划模式的拒绝必须发生在规则集**之前**（permission 层的 plan 白名单）；
 *   空规则集会让一切都卡在「没人回」上，看起来都像被拦，反而掩盖判定顺序。
 * - 带上 `"*": "allow"` 才等于线上真实条件：规则集放行一切，计划模式若没兜住，
 *   写命令就是**静默执行** —— 正是本次线上 Bug 的形态。
 *
 * 断言一律按业务语义写死（"计划模式应当拒绝写命令"），不迁就当前实现：
 * 修复后这些用例作为长期回归网保留。
 */

const bus = Bus.layer
const noopBootstrap = Layer.succeed(InstanceBootstrap.Service, InstanceBootstrap.Service.of({ run: Effect.void }))
const env = Layer.mergeAll(
  Permission.layer.pipe(Layer.provide(bus)),
  bus,
  CrossSpawnSpawner.defaultLayer,
  InstanceStore.defaultLayer.pipe(Layer.provide(noopBootstrap)),
)
const it = testEffect(env)

const sessionID = SessionID.make("ses_plan_regression")
const messageID = MessageID.make("msg_plan_regression")

/** 生产默认规则集：agent 的 permission 里就是 `"*": "allow"`（见 agent.ts defaults）。 */
const allowAllRuleset: Permission.Ruleset = [{ permission: "*", pattern: "*", action: "allow" }]

type AskInput = {
  permission: string
  mode?: Permission.Mode
  patterns?: readonly string[]
  metadata?: Record<string, unknown>
  ruleset?: Permission.Ruleset
}

type Outcome = Option.Option<Exit.Exit<void, Permission.Error>>

/** 有界等待：`None` 说明卡在交互式询问上 —— 对"应当拒绝"而言这同样是没被拦住。 */
const ask = (input: AskInput) =>
  Effect.gen(function* () {
    const svc = yield* Permission.Service
    const patterns = [...(input.patterns ?? ["*"])]
    return yield* svc
      .ask({
        sessionID,
        permission: input.permission,
        patterns,
        always: patterns,
        metadata: input.metadata ?? {},
        tool: { messageID, callID: "call_plan_regression" },
        ruleset: input.ruleset ?? allowAllRuleset,
        ...(input.mode ? { mode: input.mode } : {}),
      })
      .pipe(Effect.exit, Effect.timeoutOption(Duration.millis(500)))
  })

const expectDenied = (out: Outcome) => {
  // 允许「超时」也算失败信号吗？不算：None 表示还在等人点，计划模式并没有裁决。
  expect(Option.isSome(out)).toBe(true)
  if (!Option.isSome(out)) return
  expect(Exit.isFailure(out.value)).toBe(true)
  if (!Exit.isFailure(out.value)) return
  expect(Cause.pretty(out.value.cause)).toContain("PermissionDeniedError")
}

const expectAllowed = (out: Outcome) => {
  expect(Option.isSome(out)).toBe(true)
  if (!Option.isSome(out)) return
  expect(Exit.isSuccess(out.value)).toBe(true)
}

const denialText = (out: Outcome) => {
  if (!Option.isSome(out) || !Exit.isFailure(out.value)) return ""
  return Cause.pretty(out.value.cause)
}

describe("plan mode read-only boundary", () => {
  it.instance("plan mode refuses mutating bash commands", () =>
    Effect.gen(function* () {
      const out = yield* ask({ mode: "plan", permission: "bash", patterns: ["rm -rf src"] })
      expectDenied(out)
      // 拒绝必须说清「计划模式只允许只读命令」，否则模型只会换个写法继续试。
      expect(denialText(out)).toMatch(/read-only shell commands/i)
    }),
  )

  it.instance("plan mode allows read-only bash commands", () =>
    Effect.gen(function* () {
      for (const command of ["git status", "ls -la", "cat package.json"]) {
        expectAllowed(yield* ask({ mode: "plan", permission: "bash", patterns: [command] }))
      }
    }),
  )

  it.instance("plan mode refuses powershell commands that write", () =>
    Effect.gen(function* () {
      expectDenied(
        yield* ask({ mode: "plan", permission: "powershell", patterns: ["Remove-Item -Recurse src"] }),
      )
    }),
  )

  it.instance("plan mode refuses tools outside the read-only whitelist", () =>
    Effect.gen(function* () {
      // 这些权限名在 agent 默认规则里命中 `"*": "allow"`：计划模式若不自己裁决，
      // 就是静默执行 —— 真点鼠标、真建定时任务、真写库。
      for (const permission of ["computer", "cron", "database"]) {
        expectDenied(yield* ask({ mode: "plan", permission, patterns: ["*"] }))
      }
    }),
  )
})
