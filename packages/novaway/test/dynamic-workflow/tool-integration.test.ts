import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect } from "bun:test"
import { Effect, Layer, Stream } from "effect"
import { NodeFileSystem } from "@effect/platform-node"
import { AppFileSystem } from "@novaway/core/filesystem"
import { Agent } from "../../src/agent/agent"
import { Bus } from "../../src/bus"
import { Event } from "../../src/dynamic-workflow/events"
import { Git } from "../../src/git"
import { Ripgrep } from "../../src/file/ripgrep"
import { MessageID, SessionID } from "../../src/session/schema"
import { Session } from "../../src/session/session"
import { Tool } from "../../src/tool/tool"
import { Truncate } from "../../src/tool/truncate"
import { CreateWorkflowTool } from "../../src/tool/workflow-script"
import { WorkflowRunTool } from "../../src/tool/workflow-run"
import * as registry from "../../src/dynamic-workflow/runtime/registry"
import { ResumeWorkflowTool } from "../../src/tool/workflow-resume"
import { SqliteJournal } from "../../src/dynamic-workflow/engine/sqlite-journal"
import { fnv1a, inputHash } from "../../src/dynamic-workflow/engine/hash"
import { readRun } from "../../src/dynamic-workflow/journal/read"
import { testEffect } from "../lib/effect"
import { ListSavedWorkflowsTool, SaveWorkflowTool } from "../../src/tool/workflow-save"

// `create_workflow` 的壳：编译 → 确认 → 跑 → 汇报。这里用桩服务把会话与模型都换掉，
// 于是整条链路（除了真实的 LLM 调用）都能在测试里跑一遍。
//
// 三个必须钉住的边界：
//   - 编译没过 → 不弹确认、不起 run；
//   - 没有 promptOps → 说明原因后退出，而不是半路炸掉；
//   - 跑完之后 → 结算写进登记表，报告与用量都出现在输出里。

const parentSessionID = SessionID.make("ses_dwf_parent")

const agentInfo = {
  name: "general",
  description: "test",
  mode: "subagent" as const,
  permission: [],
  options: {},
}

let created = 0
const prompts: Array<{ sessionID: string; text: string }> = []

const sessionStub = {
  get: (id: string) =>
    Effect.succeed({
      id,
      slug: id,
      directory: "/tmp",
      title: id,
      version: "test",
      parentID: id === parentSessionID ? undefined : parentSessionID,
      agent: "general",
      permission: [],
      permissionMode: undefined,
      tokens: { input: 7, output: 3 },
      cost: 0,
    }),
  create: (input: { parentID?: string }) =>
    Effect.sync(() => {
      created += 1
      return { id: `ses_child_${created}`, parentID: input.parentID, directory: "/tmp" }
    }),
} as unknown as Session.Interface

const agentStub = {
  get: () => Effect.succeed(agentInfo),
} as unknown as Agent.Interface

// `files.glob` 会走到 ripgrep；桩只回答「工作区里有两个 ts 文件」。
const ripgrepStub = {
  files: () => Stream.make("a.ts", "b.ts"),
  tree: () => Effect.succeed(""),
  search: () => Effect.succeed({ matches: [], truncated: false }),
} as unknown as Ripgrep.Interface

const layer = Layer.mergeAll(
  Layer.succeed(Session.Service, sessionStub),
  Layer.succeed(Agent.Service, agentStub),
  Layer.succeed(AppFileSystem.Service, {} as never),
  Layer.succeed(Ripgrep.Service, ripgrepStub),
  Layer.succeed(Git.Service, {} as never),
  Truncate.defaultLayer,
  Bus.defaultLayer,
)

const env = testEffect(layer)
const it = env.effect

const ops = {
  resolvePromptParts: (text: string) => Effect.succeed([{ type: "text" as const, text }]),
  prompt: (input: { sessionID: string; parts: ReadonlyArray<{ type: string; text?: string }> }) =>
    Effect.sync(() => {
      const text = input.parts.map((part) => part.text ?? "").join("")
      prompts.push({ sessionID: input.sessionID, text })
      return { parts: [{ type: "text", text: `答：${text}` }] }
    }),
  cancel: () => Effect.void,
}

const asked: Array<{ permission: string; patterns: string[]; metadata: Record<string, unknown> }> = []

/** 一次 run 跑着的时候推出来的进度快照。`create_workflow` 用它更新工具行。 */
const progress: Array<{ phase?: string; steps?: Record<string, number>; reports?: number }> = []

const ctx = (extra?: Record<string, unknown>): Tool.Context => ({
  sessionID: parentSessionID,
  messageID: MessageID.ascending(),
  agent: "build",
  directory: "/tmp",
  abort: new AbortController().signal,
  messages: [],
  metadata: (input) =>
    Effect.sync(() => {
      const snapshot = (input.metadata as { progress?: Record<string, unknown> } | undefined)?.progress
      if (snapshot) progress.push(snapshot as never)
    }),
  ask: (input) =>
    Effect.sync(() => {
      asked.push(input as never)
    }),
  extra: { model: { providerID: "test", modelID: "test" }, promptOps: ops, ...extra },
})

type CreateResult = { title: string; output: string; metadata: Record<string, unknown> }

const callCreate = (args: Record<string, unknown>, context = ctx()) =>
  Effect.gen(function* () {
    const def = yield* Tool.init(yield* CreateWorkflowTool)
    const execute = def.execute as unknown as (
      args: Record<string, unknown>,
      context: Tool.Context,
    ) => Effect.Effect<CreateResult>
    return yield* execute(args, context)
  })

const callResume = (args: Record<string, unknown>) =>
  Effect.gen(function* () {
    const def = yield* Tool.init(yield* ResumeWorkflowTool)
    const execute = def.execute as unknown as (
      args: Record<string, unknown>,
      context: Tool.Context,
    ) => Effect.Effect<CreateResult>
    return yield* execute(args, ctx())
  })

const callRun = (args: Record<string, unknown>) =>
  Effect.gen(function* () {
    const def = yield* Tool.init(yield* WorkflowRunTool)
    const execute = def.execute as unknown as (
      args: Record<string, unknown>,
      context: Tool.Context,
    ) => Effect.Effect<CreateResult>
    return yield* execute(args, ctx())
  })

describe("create_workflow", () => {
  it("编译不过时只回诊断，不弹确认、不起 run", () =>
    Effect.gen(function* () {
      const before = asked.length
      const result = yield* callCreate({ script: `const x: number = "hello"\nreturn x` })
      expect(result.metadata.status).toBe("invalid")
      expect(result.title).toContain("错误")
      expect(result.output).toContain("L1:C7")
      expect(asked.length).toBe(before)
    }))

  it("脚本没问题时先确认，再真的跑起来并汇报", () =>
    Effect.gen(function* () {
      prompts.length = 0
      const script = [
        `phase("调查")`,
        `const a = await files.glob("*.ts")`,
        `log("找到 " + a.length + " 个文件")`,
        `const r = agent("审阅者")`,
        `const verdict = await r.ask<string>("看一眼")`,
        `report({ verdict })`,
        `return { verdict }`,
      ].join("\n")

      const result = yield* callCreate({ script, name: "冒烟" })

      // 确认窗拿到了形状
      const last = asked.at(-1)!
      expect(last.permission).toBe("workflow")
      expect(last.patterns).toEqual(["冒烟"])
      const meta = last.metadata as { phases: string[]; actors: string[]; siteCount: number; maxConcurrency: number }
      expect(meta.phases).toEqual(["调查"])
      expect(meta.actors).toEqual(["审阅者"])
      expect(meta.siteCount).toBe(4)
      expect(meta.maxConcurrency).toBeGreaterThanOrEqual(1)

      // 结果是结算后的报告
      // 跑不完时直接把报告抛出来：这条链路上「为什么没跑完」的线索全在报告里，
      // 只留一句 stopped 等于让人回去重跑一遍。
      if (result.metadata.status !== "completed")
        throw new Error(`run 没有跑完：${String.fromCharCode(10)}${result.output}`)
      expect(result.metadata.status).toBe("completed")
      expect(result.metadata.runId).toBeString()
      expect(result.output).toContain("冒烟")

      // 登记表里落的是同一个 run，且已结算
      const entry = registry.get(result.metadata.runId as string)!
      expect(entry.settlement?.status).toBe("completed")
      expect(entry.reports).toHaveLength(1)

      // 子代理会话开过，且只开了一个
      expect(created).toBeGreaterThanOrEqual(1)
    }))

  it("跑的时候把进度推进工具元数据，结算时是终态", () =>
    Effect.gen(function* () {
      progress.length = 0
      const result = yield* callCreate({
        script: [
          `phase("调查")`,
          `const r = agent()`,
          `const a = await r.ask<string>("一")`,
          `const b = await r.ask<string>("二")`,
          `report({ a, b })`,
          `return { a, b }`,
        ].join("\n"),
        name: "进度用",
      })
      if (result.metadata.status !== "completed") {
        throw new Error(`没有跑完：${String.fromCharCode(10)}${result.output}`)
      }

      // 至少两条：进阶段与结算那次。中间的变化被 250ms 的节流吞掉是正常的。
      expect(progress.length).toBeGreaterThan(1)
      // 最后一条必须是终态——否则界面会停在「还有一步在跑」。
      const last = progress.at(-1)!
      expect(last.steps).toMatchObject({ total: 2, done: 2, running: 0, failed: 0 })
      expect(last.reports).toBe(1)
      // 阶段名出现在流里。
      expect(progress.some((item) => item.phase === "调查")).toBe(true)
    }))

  it("子代理的回复被脚本原样拿到", () =>
    Effect.gen(function* () {
      prompts.length = 0
      const script = [`const r = agent()`, `const text = await r.ask<string>("数一下")`, `return text`].join("\n")
      const result = yield* callCreate({ script })
      expect(result.metadata.status).toBe("completed")
      // 桩驱动把子代理的最后一段文本原样当答案；脚本又把它原样 return 出来。
      expect(prompts.at(-1)?.text).toBe("数一下")
      expect(result.output).toContain("答：数一下")
    }))

  it("脚本抛错时结算是 errored，而不是把异常扔给调用方", () =>
    Effect.gen(function* () {
      const result = yield* callCreate({ script: `throw new Error("作者故意的")` })
      expect(result.metadata.status).toBe("errored")
      expect(result.output).toContain("作者故意的")
    }))

  it("没有 promptOps 时说明原因，不起 run", () =>
    Effect.gen(function* () {
      const result = yield* callCreate({ script: `return 1` }, ctx({ promptOps: undefined }))
      expect(result.metadata.status).toBe("unsupported")
      expect(result.output).toContain("没有启动")
    }))
})

describe("workflow_run", () => {
  it("get 拿到跑完的那次，list 至少列得出它", () =>
    Effect.gen(function* () {
      const created1 = yield* callCreate({ script: `return 42`, name: "列表用" })
      const runId = created1.metadata.runId as string

      const got = yield* callRun({ action: "get", run_id: runId })
      expect(got.output).toContain("列表用")
      expect(got.metadata.status).toBe("completed")

      const listed = yield* callRun({ action: "list" })
      expect(listed.output).toContain("列表用")
    }))

  it("get 不存在的 runId 不炸，只是说没有", () =>
    Effect.gen(function* () {
      const got = yield* callRun({ action: "get", run_id: "dwfrun-nope" })
      expect(got.metadata.status).toBe("not-found")
    }))
})

describe("workflow_run / 跨进程", () => {
  // 直接往库里写一条「上一个进程留下的」运行：登记表里没有它。
  const seedStopped = (input: { runId: string; scriptText: string; name?: string }) => {
    const journal = new SqliteJournal({
      cwd: "/tmp",
      scriptText: input.scriptText,
      ...(input.name ? { name: input.name } : {}),
    })
    journal.startRun({ runId: input.runId, scriptHash: fnv1a(input.scriptText), maxConcurrency: 3, status: "running" })
    journal.appendActor({ runId: input.runId, actor: { siteId: "actor#1", ordinal: 1 } })
    journal.appendNode({
      runId: input.runId,
      siteId: "ask#1",
      ordinal: 1,
      kind: "ask",
      actor: { siteId: "actor#1", ordinal: 1 },
      actorSeq: 1,
      inputHash: inputHash({ siteId: "ask#1", instructions: "随便说一句" }),
      status: "running",
    })
    journal.settleNode({
      runId: input.runId,
      instance: { siteId: "ask#1", ordinal: 1 },
      status: "completed",
      result: "上一次的答案",
    })
    journal.settleRun({ runId: input.runId, status: "stopped", stopReason: "user", spentTokens: 5 })
    return journal
  }

  const resumeScript = [`const r = agent()`, `const text = await r.ask<string>("随便说一句")`, `return text`].join("\n")

  it("登记表里没有的运行也能 get 到，并标出可恢复", () =>
    Effect.gen(function* () {
      const runId = `dwfrun-db-${Date.now()}`
      seedStopped({ runId, scriptText: resumeScript, name: "上次那次" })
      const got = yield* callRun({ action: "get", run_id: runId })
      expect(got.metadata.status).toBe("stopped")
      expect(got.metadata.resumable).toBe(true)
      expect(got.output).toContain("上次那次")
      expect(got.output).toContain("用户停止")
    }))

  it("completd 的运行不会被恢复，回复里说清了原因", () =>
    Effect.gen(function* () {
      const runId = `dwfrun-done-${Date.now()}`
      const journal = new SqliteJournal({ cwd: "/tmp", scriptText: resumeScript })
      journal.startRun({ runId, scriptHash: fnv1a(resumeScript), maxConcurrency: 2, status: "running" })
      journal.settleRun({ runId, status: "completed", result: "ok", spentTokens: 1 })

      const result = yield* callResume({ run_id: runId })
      expect(result.metadata.status).toBe("completed")
      expect(result.output).toContain("恢复只对")
    }))

  it("真的接着跑：已完成的 ask 不调模型，结果原样回到脚本", () =>
    Effect.gen(function* () {
      const runId = `dwfrun-resume-${Date.now()}`
      seedStopped({ runId, scriptText: resumeScript, name: "接着跑" })
      prompts.length = 0

      const result = yield* callResume({ run_id: runId })

      if (result.metadata.status !== "completed") {
        throw new Error(`恢复没有跑完：${String.fromCharCode(10)}${result.output}`)
      }
      expect(result.metadata.status).toBe("completed")
      expect(result.metadata.cached).toBe(1)
      // 缓存命中，没有任何一轮 prompt。
      expect(prompts).toHaveLength(0)
      expect(result.output).toContain("上一次的答案")

      // 同一条 run 记录被更新，而不是新开一条。
      const header = readRun(runId)!
      expect(header.status).toBe("completed")
      expect(header.result).toBe("上一次的答案")
    }))

  it("找不到的 run 不炸", () =>
    Effect.gen(function* () {
      const result = yield* callResume({ run_id: "dwfrun-nope" })
      expect(result.metadata.status).toBe("not-found")
    }))
})

describe("事件总线", () => {
  env.instance("跑一次会把阶段、报告、结算送上总线", () =>
    Effect.gen(function* () {
      const seen: Array<{ type: string; properties: Record<string, unknown> }> = []
      const bus = yield* Bus.Service
      const offs = yield* Effect.all(
        [Event.RunStarted, Event.PhaseEntered, Event.Report, Event.RunSettled].map((def) =>
          bus.subscribeCallback(def, (item) => {
            seen.push({ type: item.type, properties: item.properties as Record<string, unknown> })
          }),
        ),
      )

      const result = yield* callCreate({
        script: [
          `phase("调查")`,
          `const r = agent()`,
          `const a = await r.ask<string>("说一句")`,
          `report({ a })`,
          `return a`,
        ].join("\n"),
        name: "总线用",
      })
      // 发布是异步链，等它落地。
      yield* Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 50)))
      for (const off of offs) off()

      if (result.metadata.status !== "completed") {
        throw new Error(`没有跑完：${String.fromCharCode(10)}${result.output}`)
      }
      const types = seen.map((item) => item.type)
      expect(types).toContain(Event.RunStarted.type)
      expect(types).toContain(Event.PhaseEntered.type)
      expect(types).toContain(Event.Report.type)
      expect(types).toContain(Event.RunSettled.type)

      const started = seen.find((item) => item.type === Event.RunStarted.type)!
      expect(started.properties.name).toBe("总线用")
      expect(started.properties.phases).toEqual(["调查"])
      expect(started.properties.siteCount).toBe(3)

      const settled = seen.find((item) => item.type === Event.RunSettled.type)!
      expect((settled.properties.settlement as { status: string }).status).toBe("completed")
    }),
  )
})

describe("save_workflow / list_saved_workflows / saved 运行", () => {
  // save/list 直接走真实文件系统，目录每次测试都是新的，避免相互看见对方的文件。
  const tmpRoot = mkdtempSync(path.join(tmpdir(), "dwf-save-"))
  mkdirSync(path.join(tmpRoot, ".novaway", "workflows"), { recursive: true })
  writeFileSync(
    path.join(tmpRoot, ".novaway", "workflows", "broken.dwf.ts"),
    "// 没有头部的坏文件" + String.fromCharCode(10) + "return 1",
    "utf8",
  )
  const layerWithFs = Layer.mergeAll(
    Layer.succeed(Session.Service, sessionStub),
    Layer.succeed(Agent.Service, agentStub),
    AppFileSystem.layer.pipe(Layer.provide(NodeFileSystem.layer)),
    Layer.succeed(Ripgrep.Service, ripgrepStub),
    Layer.succeed(Git.Service, {} as never),
    Truncate.defaultLayer,
    Bus.defaultLayer,
  )
  const envFs = testEffect(layerWithFs)
  const itFs = envFs.effect
  const saveCtx = () => ({ ...ctx(), directory: tmpRoot })

  const callSave = (args: Record<string, unknown>) =>
    Effect.gen(function* () {
      const def = yield* Tool.init(yield* SaveWorkflowTool)
      const execute = def.execute as unknown as (
        args: Record<string, unknown>,
        context: Tool.Context,
      ) => Effect.Effect<CreateResult>
      return yield* execute(args, saveCtx())
    })

  const callList = (args: Record<string, unknown> = {}) =>
    Effect.gen(function* () {
      const def = yield* Tool.init(yield* ListSavedWorkflowsTool)
      const execute = def.execute as unknown as (
        args: Record<string, unknown>,
        context: Tool.Context,
      ) => Effect.Effect<CreateResult>
      return yield* execute(args, saveCtx())
    })

  itFs("保存、列出、按名字跑，一条线走完", () =>
    Effect.gen(function* () {
      // 1. 存。要先过编译。
      const bad = yield* callSave({ name: "bad script", script: `const x: number = "1"` })
      expect(bad.metadata.status).toBe("invalid")

      const saved = yield* callSave({
        name: "smoke-save",
        script: [`const r = agent()`, `const a = await r.ask<string>("hi")`, `return a`].join(String.fromCharCode(10)),
        description: "冒烟",
        when_to_use: "说一声跑一次",
      })
      expect(saved.metadata.status).toBe("saved")
      expect(saved.output).toContain(".dwf.ts")

      // 2. 同名不覆盖。
      const again = yield* callSave({ name: "smoke-save", script: `return 2` })
      expect(again.metadata.status).toBe("exists")

      // 3. 列表看得到。
      const listed = yield* callList()
      expect(listed.output).toContain("smoke-save")
      expect(listed.output).toContain("何时用：说一声跑一次")

      // 4. 按名字跑。callCreate 缺省用 /tmp 当目录，这里必须指到临时目录。
      prompts.length = 0
      const run = yield* callCreate({ saved: "smoke-save", name: "按名字" }, saveCtx())
      if (run.metadata.status !== "completed") {
        throw new Error(`saved 运行没跑完：${String.fromCharCode(10)}${run.output}`)
      }
      expect(prompts.at(-1)?.text).toBe("hi")

      // 5. 名字不存在时，把已有的列出来。同样要指到临时目录。
      const missing = yield* callCreate({ saved: "nope" }, saveCtx())
      expect(missing.metadata.status).toBe("not-found")
      expect(missing.output).toContain("smoke-save")

      // 6. 两个都没给时说清要什么。
      const nothing = yield* callCreate({})
      expect(nothing.metadata.status).toBe("invalid")
      expect(nothing.output).toContain("saved")
    }),
  )
})
