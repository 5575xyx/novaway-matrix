import { describe, expect } from "bun:test"
import { Cause, Duration, Effect, Exit, Layer, Option } from "effect"
import { AppFileSystem } from "@novaway/core/filesystem"
import { Global } from "@novaway/core/global"
import { CrossSpawnSpawner } from "@novaway/core/cross-spawn-spawner"
import { Bus } from "../../src/bus"
import { InstanceState } from "../../src/effect/instance-state"
import { Permission } from "../../src/permission"
import { InstanceBootstrap } from "../../src/project/bootstrap-service"
import { InstanceStore } from "../../src/project/instance-store"
import { RuntimeFlags } from "../../src/effect/runtime-flags"
import { BackgroundJob } from "../../src/background/job"
import { Session } from "../../src/session/session"
import { SessionID, MessageID } from "../../src/session/schema"
import { Storage } from "../../src/storage/storage"
import { SyncEvent } from "../../src/sync"
import path from "node:path"
import { provideInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

/**
 * 计划模式拒绝时必须给模型**可操作**的说明，而不是一句"失败"。
 *
 * 这是线上事故的第二现场：模型拿到笼统的拒绝，就会依次试用
 * `edit → office_document_edit → bash`，十轮之后计划一个字节也没落盘。
 * 所以这里的断言是"文案里必须出现会话计划文件的绝对路径 + 下一步动作"，
 * 而不只是"被拒了"。
 *
 * 与 `plan-mode-regression.test.ts` 的分工：那份只测权限边界本身（不需要会话），
 * 这份需要一个真实会话行来验证拒绝文案里的计划路径。
 */

const noopBootstrap = Layer.succeed(InstanceBootstrap.Service, InstanceBootstrap.Service.of({ run: Effect.void }))
const env = Layer.mergeAll(
  Permission.layer.pipe(Layer.provide(Bus.layer)),
  Session.layer.pipe(
    Layer.provide(Bus.layer),
    Layer.provide(Storage.defaultLayer),
    Layer.provide(SyncEvent.defaultLayer),
    Layer.provide(RuntimeFlags.layer({ experimentalWorkspaces: false })),
    Layer.provide(BackgroundJob.defaultLayer),
  ),
  AppFileSystem.defaultLayer,
  Bus.layer,
  CrossSpawnSpawner.defaultLayer,
  InstanceStore.defaultLayer.pipe(Layer.provide(noopBootstrap)),
)
const it = testEffect(env)

const messageID = MessageID.make("msg_plan_guidance")

/** 生产默认规则集：`"*": "allow"`（见 agent.ts defaults）。 */
const allowAllRuleset: Permission.Ruleset = [{ permission: "*", pattern: "*", action: "allow" }]

type AskInput = {
  sessionID: SessionID
  permission: string
  patterns?: readonly string[]
  metadata?: Record<string, unknown>
}

type Outcome = Option.Option<Exit.Exit<void, Permission.Error>>

const ask = (input: AskInput) =>
  Effect.gen(function* () {
    const svc = yield* Permission.Service
    const patterns = [...(input.patterns ?? ["*"])]
    return yield* svc
      .ask({
        sessionID: input.sessionID,
        permission: input.permission,
        patterns,
        always: patterns,
        metadata: input.metadata ?? {},
        tool: { messageID, callID: "call_plan_guidance" },
        ruleset: allowAllRuleset,
        mode: "plan",
      })
      .pipe(Effect.exit, Effect.timeoutOption(Duration.millis(500)))
  })

/** 拒绝错误本身（成功/超时返回 undefined）。`Cause.squash` 同时覆盖 fail 与 die。 */
const refusal = (out: Outcome) => {
  if (!Option.isSome(out) || !Exit.isFailure(out.value)) return undefined
  return Cause.squash(out.value.cause) as { _tag?: string; message?: string } | undefined
}

/** 拒绝文案；成功/超时返回空串。 */
const denial = (out: Outcome) => refusal(out)?.message ?? ""

const beforeEach = Effect.gen(function* () {
  const sessions = yield* Session.Service
  const chat = yield* sessions.create({ title: "Plan guidance", permission: [], permissionMode: "plan" })
  const instance = yield* InstanceState.context
  return { chat, instance, plan: Session.plan(chat, instance) }
})

describe("plan mode denial guidance", () => {
  it.instance(
    "writing a project file points at the session plan and the next step",
    () =>
      Effect.gen(function* () {
        const { chat, instance } = yield* beforeEach
        const target = path.join(instance.worktree, "src", "index.ts")

        const out = yield* ask({
          sessionID: chat.id,
          permission: "edit",
          patterns: [path.relative(instance.worktree, target)],
          metadata: { filepath: target },
        })

        expect(Option.isSome(out)).toBe(true)
        if (!Option.isSome(out)) return
        expect(Exit.isFailure(out.value)).toBe(true)
        expect(refusal(out)?._tag).toBe("PermissionDeniedError")
        const text = denial(out)
        // 1) 唯一可写的那个文件，得是**本次会话**的计划文件绝对路径。
        expect(text).toContain(Session.plan(chat, instance))
        // 2) 下一步动作必须点名 plan_exit，否则模型不知道该怎么收尾。
        expect(text).toContain("plan_exit")
        // 3) 反向：不回声被拒的那个路径。拒绝文案只该说"允许写哪里"，
        //    说"你被拒的是 <worktree>/src/index.ts" 除了噪音没任何用处，
        //    还会在会话记录被转发/粘贴时泄露用户的目录结构（含用户名等）。
        expect(text).not.toContain(target)
        expect(text).not.toContain(path.relative(instance.worktree, target))
      }).pipe(provideInstance(process.cwd())),
    30_000,
  )

  it.instance(
    "a non-markdown file inside the plan directory is still refused",
    () =>
      Effect.gen(function* () {
        const { chat, instance } = yield* beforeEach
        const target = path.join(instance.worktree, ".novaway", "plans", "notes.txt")

        const out = yield* ask({
          sessionID: chat.id,
          permission: "edit",
          patterns: [path.relative(instance.worktree, target)],
          metadata: { filepath: target },
        })

        expect(denial(out)).toContain("Plan mode is read-only")
      }).pipe(provideInstance(process.cwd())),
    30_000,
  )

  it.instance(
    "a writing shell command explains the read-only boundary",
    () =>
      Effect.gen(function* () {
        const { chat } = yield* beforeEach

        const out = yield* ask({ sessionID: chat.id, permission: "bash", patterns: ["git push"] })

        expect(refusal(out)?._tag).toBe("PermissionDeniedError")
        expect(denial(out)).toMatch(/read-only shell commands/i)
      }).pipe(provideInstance(process.cwd())),
    30_000,
  )

  it.instance(
    "writing the session plan file is allowed without a prompt",
    () =>
      Effect.gen(function* () {
        const { chat, instance, plan } = yield* beforeEach

        const out = yield* ask({
          sessionID: chat.id,
          permission: "edit",
          patterns: [path.relative(instance.worktree, plan)],
          metadata: { filepath: plan },
        })

        expect(Option.isSome(out)).toBe(true)
        if (!Option.isSome(out)) return
        expect(Exit.isSuccess(out.value)).toBe(true)
      }).pipe(provideInstance(process.cwd())),
    30_000,
  )

  it.instance(
    "git is graded by action: history reads pass, writes are refused",
    () =>
      Effect.gen(function* () {
        const { chat } = yield* beforeEach

        // `tool/git.ts:126` 只在**写动作**上 ask `"git"`，只读动作根本不过权限层
        // （见 `test/workflow-guard.test.ts` 那侧的 `git_status` 断言）。所以这里
        // 锁两个方向：按动作分级不能误伤 `git status` 这类读操作，而 push/commit
        // 必须拒 —— 这也正是"把 git 整类拒掉"没被采纳的原因。
        for (const action of ["status", "diff", "log"]) {
          const out = yield* ask({ sessionID: chat.id, permission: "git", patterns: [action] })
          expect(Option.isSome(out)).toBe(true)
          if (!Option.isSome(out)) continue
          expect(Exit.isSuccess(out.value)).toBe(true)
        }
        // `config` 不在 `SAFE_GIT` 里：`git config core.hooksPath` 是持久化代码执行入口。
        for (const action of ["push", "commit", "checkout", "config"]) {
          const out = yield* ask({ sessionID: chat.id, permission: "git", patterns: [action] })
          expect(refusal(out)?._tag).toBe("PermissionDeniedError")
        }
        // 空 patterns 不能因为 `every` 在空数组上恒真而被放行。
        const empty = yield* ask({ sessionID: chat.id, permission: "git", patterns: [] })
        expect(refusal(empty)?._tag).toBe("PermissionDeniedError")
      }).pipe(provideInstance(process.cwd())),
    30_000,
  )

  it.instance(
    "external_directory is left to the ruleset, not decided by plan mode",
    () =>
      Effect.gen(function* () {
        const { chat } = yield* beforeEach

        // 全局计划目录在工作区之外，写它会先 ask `external_directory`。
        // 计划模式在这一层拒掉 = 合法的全局计划也写不进去，所以必须交给规则集
        // （默认 `"*": "ask"`，用户仍能把关）。
        const out = yield* ask({ sessionID: chat.id, permission: "external_directory", patterns: ["/tmp/*"] })
        expect(Option.isSome(out)).toBe(true)
        if (!Option.isSome(out)) return
        expect(Exit.isSuccess(out.value)).toBe(true)
      }).pipe(provideInstance(process.cwd())),
    30_000,
  )

  it.instance(
    "the data-directory plan file is writable too",
    () =>
      Effect.gen(function* () {
        const { chat } = yield* beforeEach

        // 计划目录有两个：`<planRoot>/.novaway/plans` 与 `Global.Path.data/plans`。
        // 后者在工作区之外，更容易被"只看项目内"的判定误杀 —— 但它同样必须可写，
        // 否则全局计划一个字节也落不了盘。
        const dataPlans = path.join(Global.Path.data, "plans", "1700000000000-global.md")
        const out = yield* ask({
          sessionID: chat.id,
          permission: "edit",
          patterns: [dataPlans],
          metadata: { filepath: dataPlans },
        })

        expect(Option.isSome(out)).toBe(true)
        if (!Option.isSome(out)) return
        expect(Exit.isSuccess(out.value)).toBe(true)
      }).pipe(provideInstance(process.cwd())),
    30_000,
  )

  it.instance(
    "a shell one-liner that rewrites git config is refused",
    () =>
      Effect.gen(function* () {
        const { chat } = yield* beforeEach

        // `git config core.hooksPath /tmp/evil` 不写工作区，却是持久化的代码执行入口：
        // 之后的任何 git 操作都会跑攻击者的 hook。它必须被当成"会写盘的命令"。
        const out = yield* ask({
          sessionID: chat.id,
          permission: "bash",
          patterns: ["git config core.hooksPath /tmp/evil"],
        })

        expect(refusal(out)?._tag).toBe("PermissionDeniedError")
      }).pipe(provideInstance(process.cwd())),
    30_000,
  )

  it.instance(
    "read-only tools stay in the normal flow",
    () =>
      Effect.gen(function* () {
        const { chat } = yield* beforeEach
        for (const permission of ["read", "grep", "glob"]) {
          const out = yield* ask({ sessionID: chat.id, permission, patterns: ["*"] })
          expect(Option.isSome(out)).toBe(true)
          if (!Option.isSome(out)) continue
          expect(Exit.isSuccess(out.value)).toBe(true)
        }
      }).pipe(provideInstance(process.cwd())),
    30_000,
  )
})
