import { describe, expect, test } from "bun:test"
import { WorkflowEngine } from "../../src/dynamic-workflow/engine/engine"
import { MemoryJournal } from "../../src/dynamic-workflow/engine/memory-journal"
import { inputHash } from "../../src/dynamic-workflow/engine/hash"
import { AskScheduler } from "../../src/dynamic-workflow/engine/scheduler"
import type {
  AskAnswer,
  AskRequest,
  CreateActorRequest,
  RunEvent,
  WorldReadRequest,
  WorkflowDriver,
} from "../../src/dynamic-workflow/engine/types"

// 引擎是整条管线里唯一「有状态」的部分，也是恢复能力的所在。这些用例用一个假驱动把它
// 完全圈住：不起子进程、不调模型，只检查身份、顺序、记录这三件事。

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const tick = () => new Promise<void>((resolve) => setImmediate(resolve))

/** 假驱动：每次 ask 握着一个 deferred，测试自己决定什么时候答。 */
class FakeDriver implements WorkflowDriver {
  readonly actors: CreateActorRequest[] = []
  readonly asks: AskRequest[] = []
  readonly reads: WorldReadRequest[] = []
  readonly pending: Array<{ request: AskRequest; deferred: ReturnType<typeof deferred<AskAnswer>> }> = []
  disposed = false

  async createActorSession(input: CreateActorRequest) {
    this.actors.push(input)
    return { session: `session-${input.actor.siteId}-${input.actor.ordinal}` }
  }

  startAsk(input: AskRequest) {
    const gate = deferred<AskAnswer>()
    this.asks.push(input)
    this.pending.push({ request: input, deferred: gate })
    return gate.promise
  }

  async executeWorldRead(input: WorldReadRequest) {
    this.reads.push(input)
    return { op: input.op, args: input.args }
  }

  async dispose() {
    this.disposed = true
  }

  /** 答掉第 n 个还没答的 ask。 */
  answer(index: number, text: string, tokens = 0) {
    const entry = this.pending[index]
    if (!entry) throw new Error(`没有第 ${index} 个待答的 ask`)
    this.pending.splice(index, 1)
    entry.deferred.resolve({ text, usage: { tokens } })
  }

  rejectAsk(index: number, error: unknown) {
    const entry = this.pending[index]
    if (!entry) throw new Error(`没有第 ${index} 个待答的 ask`)
    this.pending.splice(index, 1)
    entry.deferred.reject(error)
  }
}

function build(options: { maxConcurrency?: number; sites?: string[] } = {}) {
  const driver = new FakeDriver()
  const journal = new MemoryJournal()
  const events: RunEvent[] = []
  const engine = new WorkflowEngine({
    runId: "run-1",
    scriptHash: "hash",
    maxConcurrency: options.maxConcurrency ?? 8,
    driver,
    journal,
    knownSiteIds: new Set(options.sites ?? ["actor#1", "ask#1", "world-read#1", "report#1"]),
    sitePhases: new Map([["ask#1", "评审"]]),
    onEvent: (event) => events.push(event),
  })
  return { driver, journal, engine, events }
}

describe("WorkflowEngine / 身份", () => {
  test("同一个 agent() 站点的两次调用得到两个子代理；句柄互不相同", () => {
    const { engine, driver, journal } = build()
    const first = engine.createActor("actor#1", "reviewer")
    const second = engine.createActor("actor#1", "reviewer")
    expect(first).not.toBe(second)
    expect(journal.get("run-1")!.actors.map((actor) => `${actor.actor.siteId}@${actor.actor.ordinal}`)).toEqual([
      "actor#1@1",
      "actor#1@2",
    ])
    expect(driver.actors).toEqual([])
  })

  test("ordinal 按到达顺序铸造，站点之间互不干扰", async () => {
    const { engine, driver, journal } = build()
    const handle = engine.createActor("actor#1")
    const a = engine.ask("ask#1", handle, "一")
    const b = engine.ask("ask#1", handle, "二")
    const c = engine.ask("ask#1", handle, "三")
    await tick()
    driver.answer(0, "A")
    await tick()
    driver.answer(0, "B")
    await tick()
    driver.answer(0, "C")
    expect(await Promise.all([a, b, c])).toEqual(["A", "B", "C"])
    expect(journal.nodesAt("run-1", "ask#1").map((node) => node.ordinal)).toEqual([1, 2, 3])
  })

  test("未知站点是协议损坏，直接拒绝而不是硬着头皮跑", () => {
    const { engine } = build()
    expect(() => engine.createActor("actor#9")).toThrow(/分析阶段不存在/)
  })

  test("未知子代理句柄给出可读的协议错误", async () => {
    const { engine } = build()
    await expect(engine.ask("ask#1", "local#99", "x")).rejects.toThrow(/未知的子代理句柄/)
  })
})

describe("WorkflowEngine / 顺序", () => {
  test("同一个子代理严格串行：前一个答完之前，后一个不会发出去", async () => {
    const { engine, driver } = build()
    const handle = engine.createActor("actor#1")
    const first = engine.ask("ask#1", handle, "一")
    const second = engine.ask("ask#1", handle, "二")
    await tick()
    expect(driver.asks).toHaveLength(1)
    driver.answer(0, "A")
    await tick()
    expect(driver.asks).toHaveLength(2)
    driver.answer(0, "B")
    expect(await Promise.all([first, second])).toEqual(["A", "B"])
  })

  test("不同子代理并行：全局名额够用时互不等待", async () => {
    const { engine, driver } = build({ maxConcurrency: 4 })
    const a = engine.createActor("actor#1")
    const b = engine.createActor("actor#1")
    const first = engine.ask("ask#1", a, "甲")
    const second = engine.ask("ask#1", b, "乙")
    await tick()
    expect(driver.asks).toHaveLength(2)
    driver.answer(0, "A")
    driver.answer(0, "B")
    expect(await Promise.all([first, second])).toEqual(["A", "B"])
  })

  test("全局上限生效：满了之后排队，有人答完才放行", async () => {
    const { engine, driver } = build({ maxConcurrency: 2 })
    const handles = [engine.createActor("actor#1"), engine.createActor("actor#1"), engine.createActor("actor#1")]
    const all = handles.map((handle, index) => engine.ask("ask#1", handle, `第${index}轮`))
    await tick()
    expect(driver.asks).toHaveLength(2)
    driver.answer(0, "A")
    await tick()
    expect(driver.asks).toHaveLength(3)
    driver.answer(0, "B")
    driver.answer(0, "C")
    expect(await Promise.all(all)).toEqual(["A", "B", "C"])
  })

  test("一个子代理失败不会卡住同一代理后面的 ask", async () => {
    const { engine, driver } = build()
    const handle = engine.createActor("actor#1")
    const first = engine.ask("ask#1", handle, "一")
    // 立刻接住拒绝：否则它会在断言挂上之前变成 unhandled rejection。
    const failure = first.then(
      () => undefined,
      (error: unknown) => error as Error,
    )
    const second = engine.ask("ask#1", handle, "二")
    await tick()
    driver.rejectAsk(0, new Error("模型挂了"))
    await tick()
    expect(driver.asks).toHaveLength(2)
    driver.answer(0, "B")
    expect((await failure)?.message).toContain("ask ask#1@1 失败：模型挂了")
    expect(await second).toBe("B")
  })

  test("会话只建一次：同一个子代理的多轮 ask 共用一个 session", async () => {
    const { engine, driver } = build()
    const handle = engine.createActor("actor#1", "reviewer")
    const first = engine.ask("ask#1", handle, "一")
    const second = engine.ask("ask#1", handle, "二")
    await tick()
    driver.answer(0, "A")
    await tick()
    driver.answer(0, "B")
    await Promise.all([first, second])
    expect(driver.actors).toHaveLength(1)
    expect(driver.asks[0]!.session).toEqual(driver.asks[1]!.session)
  })
})

describe("WorkflowEngine / 记录", () => {
  test("ask 落一行 running → completed，带站点、序号、阶段、actorSeq 与输入指纹", async () => {
    const { engine, driver, journal } = build()
    const handle = engine.createActor("actor#1")
    const pending = engine.ask("ask#1", handle, "看这片 diff")
    await tick()
    const before = journal.nodesAt("run-1", "ask#1")[0]!
    expect(before.status).toBe("running")
    expect(before.kind).toBe("ask")
    expect(before.phase).toBe("评审")
    expect(before.actor).toEqual({ siteId: "actor#1", ordinal: 1 })
    expect(before.actorSeq).toBe(1)
    expect(before.inputHash).toBe(inputHash({ siteId: "ask#1", instructions: "看这片 diff" }))
    driver.answer(0, "结果")
    await pending
    const after = journal.nodesAt("run-1", "ask#1")[0]!
    expect(after.status).toBe("completed")
    expect(after.result).toBe("结果")
  })

  test("同一站点的第二行 actorSeq 递增", async () => {
    const { engine, driver, journal } = build()
    const handle = engine.createActor("actor#1")
    const a = engine.ask("ask#1", handle, "一")
    const b = engine.ask("ask#1", handle, "二")
    await tick()
    driver.answer(0, "A")
    await tick()
    driver.answer(0, "B")
    await Promise.all([a, b])
    expect(journal.nodesAt("run-1", "ask#1").map((node) => node.actorSeq)).toEqual([1, 2])
  })

  test("失败的 ask 记 failed 与结构化的原因", async () => {
    const { engine, driver, journal } = build()
    const handle = engine.createActor("actor#1")
    const pending = engine.ask("ask#1", handle, "一").catch(() => undefined)
    await tick()
    driver.rejectAsk(0, Object.assign(new Error("限流"), { code: "RateLimited" }))
    await pending
    const node = journal.nodesAt("run-1", "ask#1")[0]!
    expect(node.status).toBe("failed")
    expect(node.failure).toMatchObject({ message: "限流", code: "RateLimited" })
  })

  test("world-read 不占用模型名额：并发上限为 1 时仍然立刻执行", async () => {
    const { engine, driver } = build({ maxConcurrency: 1 })
    const results = await Promise.all([
      engine.worldRead("world-read#1", "glob", ["**/*.ts"]),
      engine.worldRead("world-read#1", "read", ["a.ts"]),
    ])
    expect(results).toHaveLength(2)
    expect(driver.reads.map((read) => read.op)).toEqual(["glob", "read"])
  })

  test("report 立刻结算并落 journal，不进调度器", () => {
    const { engine, journal, events } = build()
    engine.report("report#1", { file: "a.ts", count: 2 })
    const node = journal.nodesAt("run-1", "report#1")[0]!
    expect(node.status).toBe("completed")
    expect(node.result).toEqual({ file: "a.ts", count: 2 })
    expect(events.filter((event) => event.type === "report")).toHaveLength(1)
  })

  test("journal 拒绝同一个实例落两次", async () => {
    const { engine, driver, journal } = build()
    const handle = engine.createActor("actor#1")
    const pending = engine.ask("ask#1", handle, "一")
    await tick()
    expect(() =>
      journal.appendNode({
        runId: "run-1",
        siteId: "ask#1",
        ordinal: 1,
        kind: "ask",
        inputHash: "x",
        status: "running",
      }),
    ).toThrow(/journal 重复/)
    driver.answer(0, "A")
    await pending
  })
})

describe("WorkflowEngine / 结算", () => {
  test("complete 结算 completed，带上脚本的返回值与累计用量", async () => {
    const { engine, driver, journal, events } = build()
    const handle = engine.createActor("actor#1")
    const pending = engine.ask("ask#1", handle, "一")
    await tick()
    driver.answer(0, "A", 42)
    await pending
    engine.complete({ done: true })
    const settlement = await engine.settled
    expect(settlement.status).toBe("completed")
    expect(settlement).toMatchObject({ value: { done: true }, spentTokens: 42 })
    expect(journal.get("run-1")!.status).toBe("completed")
    expect(events.at(-1)!.type).toBe("run-settled")
  })

  test("fail 结算 errored，终态不可恢复", async () => {
    const { engine, journal } = build()
    engine.fail(Object.assign(new Error("脚本炸了"), { code: "Boom" }))
    const settlement = await engine.settled
    expect(settlement).toMatchObject({ status: "errored" })
    expect(journal.get("run-1")!.failure).toMatchObject({ message: "脚本炸了", code: "Boom" })
  })

  test("stop 结算 stopped 并带上原因", async () => {
    const { engine, journal, driver } = build()
    engine.stop("user")
    expect(await engine.settled).toMatchObject({ status: "stopped", reason: "user" })
    expect(journal.get("run-1")!.stopReason).toBe("user")
    expect(driver.disposed).toBe(true)
  })

  test("stop 会中断在飞的 ask：signal 触发", async () => {
    const { engine, driver } = build()
    const handle = engine.createActor("actor#1")
    const pending = engine.ask("ask#1", handle, "一").catch(() => undefined)
    await tick()
    expect(driver.asks[0]!.signal.aborted).toBe(false)
    engine.stop("user")
    expect(driver.asks[0]!.signal.aborted).toBe(true)
    await pending
  })

  test("结算只发生一次：先到的赢", async () => {
    const { engine } = build()
    engine.complete("先")
    engine.fail(new Error("后"))
    engine.stop("user")
    expect(await engine.settled).toMatchObject({ status: "completed", value: "先" })
  })

  test("结算之后的调用被拒绝，而不是静默排队", async () => {
    const { engine } = build()
    const handle = engine.createActor("actor#1")
    engine.complete("done")
    await expect(engine.ask("ask#1", handle, "太晚了")).rejects.toThrow(/已经结束/)
  })
})

describe("AskScheduler", () => {
  test("同一个 key 串行、不同 key 并行、上限生效", async () => {
    const scheduler = new AskScheduler(2)
    const gates = [deferred<string>(), deferred<string>(), deferred<string>()]
    const started: string[] = []
    const run = (index: number) => () => {
      started.push(`job${index}`)
      return gates[index]!.promise
    }
    const promises = [scheduler.enqueue("a", run(0)), scheduler.enqueue("a", run(1)), scheduler.enqueue("b", run(2))]
    await tick()
    expect(started).toEqual(["job0", "job2"])
    expect(scheduler.running).toBe(2)
    expect(scheduler.queued).toBe(1)
    gates[0]!.resolve("0")
    await tick()
    expect(started).toEqual(["job0", "job2", "job1"])
    gates[1]!.resolve("1")
    gates[2]!.resolve("2")
    expect(await Promise.all(promises)).toEqual(["0", "1", "2"])
  })

  test("任务同步抛出也走拒绝路径，不会卡住队列", async () => {
    const scheduler = new AskScheduler(1)
    const failing = scheduler.enqueue("a", () => {
      throw new Error("炸在开头")
    })
    const ok = scheduler.enqueue("a", async () => "fine")
    await expect(failing).rejects.toThrow("炸在开头")
    expect(await ok).toBe("fine")
  })

  test("上限必须有限且 >= 1", () => {
    expect(() => new AskScheduler(0)).toThrow(/maxConcurrency/)
    expect(() => new AskScheduler(Number.NaN)).toThrow(/maxConcurrency/)
  })
})
