import { afterAll, describe, expect, spyOn, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { prepareWorkflow } from "../../src/dynamic-workflow"
import { MemoryJournal } from "../../src/dynamic-workflow/engine/memory-journal"
import type { AskAnswer, AskRequest, WorldReadRequest, WorkflowDriver } from "../../src/dynamic-workflow/engine/types"
import { runWorkflow, defaultMaxConcurrency } from "../../src/dynamic-workflow/runtime/harness"

// 这是整条管线唯一「真的跑起来」的地方：编译 → 降级 → 写入口文件 → 起子进程 → NDJSON →
// 引擎 → journal → 结算。假驱动让模型那一侧可预测，其余全是真的（包括 vm context 与进程边界）。

const runtimeDir = mkdtempSync(path.join(os.tmpdir(), "novaway-dwf-test-"))
afterAll(() => rmSync(runtimeDir, { recursive: true, force: true }))

/** 立刻答，回答里带上收到的指令，便于断言顺序。 */
class EchoDriver implements WorkflowDriver {
  readonly asks: AskRequest[] = []
  readonly reads: WorldReadRequest[] = []
  readonly created: string[] = []
  readonly answer: (input: AskRequest) => AskAnswer

  constructor(
    answer: (input: AskRequest) => AskAnswer = (input) => ({
      text: `echo:${input.instructions}`,
      usage: { tokens: 10 },
    }),
  ) {
    this.answer = answer
  }

  async createActorSession(input: { actor: { siteId: string; ordinal: number }; name?: string }) {
    this.created.push(`${input.actor.siteId}@${input.actor.ordinal}:${input.name ?? ""}`)
    return { session: this.created.length }
  }

  async startAsk(input: AskRequest) {
    this.asks.push(input)
    return this.answer(input)
  }

  async executeWorldRead(input: WorldReadRequest) {
    this.reads.push(input)
    if (input.op === "glob") return ["a.ts", "b.ts"]
    if (input.op === "read") return `// ${String(input.args[0])}`
    return null
  }
}

function run(script: string, options: { driver?: EchoDriver; timeoutMs?: number; maxConcurrency?: number } = {}) {
  const prepared = prepareWorkflow(script)
  expect(prepared.diagnostics).toEqual([])
  expect(prepared.ok).toBe(true)
  const journal = new MemoryJournal()
  const driver = options.driver ?? new EchoDriver()
  return runWorkflow({
    prepared,
    driver,
    journal,
    runtimeDir,
    ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
    ...(options.maxConcurrency ? { maxConcurrency: options.maxConcurrency } : {}),
  }).then((result) => ({ result, journal, driver }))
}

describe("defaultMaxConcurrency", () => {
  test("falls back to a finite worker count when the runtime reports invalid parallelism", () => {
    const availableParallelism = spyOn(os, "availableParallelism").mockReturnValue(Number.NaN)
    try {
      const count = defaultMaxConcurrency()
      expect(Number.isFinite(count)).toBe(true)
      expect(count).toBeGreaterThanOrEqual(4)
      expect(count).toBeLessThanOrEqual(16)
    } finally {
      availableParallelism.mockRestore()
    }
  })
})

describe("runWorkflow / 端到端", () => {
  test("脚本跑完，返回值原样回到结算里", async () => {
    const { result } = await run(`
      const names = await files.glob("**/*.ts")
      return { count: names.length, names }
    `)
    expect(result.settlement).toMatchObject({
      status: "completed",
      value: { count: 2, names: ["a.ts", "b.ts"] },
    })
  })

  test("world-read 真的过了线：驱动的参数与 journal 的行都对得上", async () => {
    const { result, journal, driver } = await run(`
      const text = await files.read("a.ts")
      return text
    `)
    expect(result.settlement.status).toBe("completed")
    expect(driver.reads).toHaveLength(1)
    expect(driver.reads[0]!.op).toBe("read")
    expect(driver.reads[0]!.args).toEqual(["a.ts"])
    const node = journal.nodesAt(result.runId, "world-read#1")[0]!
    expect(node.status).toBe("completed")
    expect(node.result).toBe("// a.ts")
  })

  test("agent + ask 走一个常驻会话，答案回到脚本里", async () => {
    const { result, journal, driver } = await run(`
      const r = agent("reviewer", { system: "你是评审员" })
      const first = await r.ask("第一问")
      const second = await r.ask("第二问")
      return [first, second]
    `)
    expect(result.settlement).toMatchObject({ status: "completed", value: ["echo:第一问", "echo:第二问"] })
    expect(driver.created).toEqual(["actor#1@1:reviewer"])
    // 两个 ask 是**两个不同的站点**（各自的调用点），所以都是 @1；但在这个子代理的序列里
    // 它们排第 1 和第 2。站点身份与队列位置是两件事，这里正好把它们分开钉住。
    const asks = ["ask#1", "ask#2"].flatMap((siteId) => journal.nodesAt(result.runId, siteId))
    expect(asks.map((node) => `${node.siteId}@${node.ordinal}`)).toEqual(["ask#1@1", "ask#2@1"])
    expect(asks.map((node) => node.actorSeq)).toEqual([1, 2])
    expect(result.settlement.spentTokens).toBe(20)
  })

  test("Promise.all 扇出：三个 ask 并发派出，结果按位置回来", async () => {
    const driver = new EchoDriver((input) => ({ text: input.instructions.toUpperCase(), usage: { tokens: 1 } }))
    const { result } = await run(
      `
      const r = agent("fan")
      const out = await Promise.all([r.ask("a"), r.ask("b"), r.ask("c")])
      return out
      `,
      { driver, maxConcurrency: 4 },
    )
    expect(result.settlement).toMatchObject({ status: "completed", value: ["A", "B", "C"] })
  })

  test("脚本抛错 → errored，异常信息过界", async () => {
    const { result } = await run(`
      await files.glob("**/*.ts")
      throw new Error("我拒绝继续")
    `)
    expect(result.settlement.status).toBe("errored")
    expect(result.settlement).toMatchObject({ error: { message: "我拒绝继续" } })
  })

  test("驱动拒绝 → 脚本可以 catch，run 仍然是 completed", async () => {
    const driver = new EchoDriver(() => {
      throw Object.assign(new Error("模型限流"), { code: "RateLimited" })
    })
    const { result } = await run(
      `
      const r = agent("x")
      try {
        await r.ask("试试")
        return "不该到这里"
      } catch (error) {
        return { caught: (error as { code?: string }).code ?? "无" }
      }
      `,
      { driver },
    )
    expect(result.settlement).toMatchObject({ status: "completed", value: { caught: "RateLimited" } })
  })

  test("永不兑现的 promise → ScriptStalled，而不是永远挂着", async () => {
    const { result } = await run(`
      await new Promise(() => {})
      return "不该到这里"
    `)
    expect(result.settlement.status).toBe("errored")
    expect(result.settlement).toMatchObject({ error: { name: "ScriptStalled" } })
  })

  test("同步死循环 → 超时按 interrupted 结算（只有进程边界拦得住它）", async () => {
    const { result } = await run(`while (true) {}`, { timeoutMs: 800 })
    expect(result.settlement).toMatchObject({ status: "stopped", reason: "interrupted" })
  }, 20_000)
})

describe("runWorkflow / 沙箱边界", () => {
  test("脚本里没有 process / require / fetch：编译期就挡掉，运行期也真的没有", async () => {
    // 编译期：没有 ambient @types，这三个名字根本不存在。
    expect(prepareWorkflow("process.exit(1)").diagnostics[0]!.message).toContain("Cannot find name 'process'")
    expect(prepareWorkflow('require("fs")').diagnostics[0]!.message).toContain("Cannot find name 'require'")
    expect(prepareWorkflow('fetch("http://x")').diagnostics[0]!.message).toContain("Cannot find name 'fetch'")

    // 运行期：即便绕过类型检查从 globalThis 上找，cell 里也没有。
    const { result } = await run(`
      const scope = globalThis as unknown as Record<string, unknown>
      return [typeof scope.process, typeof scope.require, typeof scope.fetch]
    `)
    expect(result.settlement).toMatchObject({ status: "completed", value: ["undefined", "undefined", "undefined"] })
  })

  test("Date.now / new Date() / Math.random 在运行期抛错", async () => {
    for (const expression of ["Date.now()", "new Date()", "Math.random()"]) {
      const { result } = await run(`return ${expression}`)
      expect(result.settlement.status).toBe("errored")
    }
  })

  test("report 到达父进程的顺序就是脚本里的顺序", async () => {
    const { result, journal } = await run(`
      report({ i: 1 })
      report({ i: 2 })
      await files.glob("*")
      report({ i: 3 })
      return "ok"
    `)
    expect(result.settlement.status).toBe("completed")
    const reports = ["report#1", "report#2", "report#3"].flatMap((siteId) => journal.nodesAt(result.runId, siteId))
    expect(reports.map((node) => (node.result as { i: number }).i)).toEqual([1, 2, 3])
  })

  test("phase 与 log 不占站点、不落节点，但会发成事件", async () => {
    const prepared = prepareWorkflow('phase("开工")\nlog("进度")\nreturn 1')
    expect(prepared.siteIds).toEqual([])
    const events: string[] = []
    await runWorkflow({
      prepared,
      driver: new EchoDriver(),
      runtimeDir,
      onEvent: (event) => events.push(event.type),
    })
    expect(events).toContain("phase-entered")
    expect(events).toContain("log")
  })

  test("脚本语法错误在降级前就被拦住，不会起子进程", async () => {
    const prepared = prepareWorkflow("const = 1")
    expect(prepared.ok).toBe(false)
    await expect(runWorkflow({ prepared, driver: new EchoDriver(), runtimeDir })).rejects.toThrow(/L1:C7/)
  })
})
