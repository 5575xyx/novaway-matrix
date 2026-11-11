import { describe, expect, test } from "bun:test"
import { WorkflowEngine } from "../../src/dynamic-workflow/engine/engine"
import { MemoryJournal } from "../../src/dynamic-workflow/engine/memory-journal"
import { buildReplayPlan, type ReplayPlan } from "../../src/dynamic-workflow/engine/replay"
import type {
  AskAnswer,
  AskRequest,
  CreateActorRequest,
  RunEvent,
  WorldReadRequest,
  WorkflowDriver,
} from "../../src/dynamic-workflow/engine/types"

// 恢复 = 同一份脚本再跑一次，journal 回答已经发生过的事。
// 这些用例只用内存 journal + 假驱动：恢复的正确性全在「谁被重放、谁被真的执行」上，
// 与存储载体无关（载体那一半由 journal.test.ts 负责）。

const SITE_IDS = new Set(["actor#1", "ask#1", "world-read#1", "report#1"])

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

class RecordingDriver implements WorkflowDriver {
  readonly asks: AskRequest[] = []
  readonly attached: string[] = []
  readonly created: CreateActorRequest[] = []
  readonly pending: Array<{ text: string; gate: ReturnType<typeof deferred<AskAnswer>> }> = []

  constructor(private readonly behaviour: "answer" | "explode" = "answer") {}

  async createActorSession(input: CreateActorRequest) {
    if (this.behaviour === "explode") throw new Error("缓存命中时不该新建会话")
    this.created.push(input)
    return `session-${input.actor.siteId}-${input.actor.ordinal}`
  }

  async attachActorSession(input: { actor: { siteId: string; ordinal: number }; sessionID: string }) {
    this.attached.push(input.sessionID)
    return input.sessionID
  }

  startAsk(input: AskRequest) {
    if (this.behaviour === "explode") throw new Error("缓存命中时不该调用驱动")
    this.asks.push(input)
    const gate = deferred<AskAnswer>()
    this.pending.push({ text: input.instructions, gate })
    return gate.promise
  }

  async executeWorldRead(input: WorldReadRequest) {
    return { op: input.op, args: input.args }
  }

  answer(text: string) {
    const entry = this.pending.shift()
    if (!entry) throw new Error("没有待答的 ask")
    entry.gate.resolve({ text })
  }
}

const tick = () => new Promise<void>((resolve) => setImmediate(resolve))

function makeEngine(input: {
  runId: string
  driver: WorkflowDriver
  journal: MemoryJournal
  replay?: ReplayPlan
  events?: RunEvent[]
}) {
  return new WorkflowEngine({
    runId: input.runId,
    scriptHash: "hash",
    maxConcurrency: 4,
    driver: input.driver,
    journal: input.journal,
    knownSiteIds: SITE_IDS,
    ...(input.replay ? { replay: input.replay } : {}),
    ...(input.events ? { onEvent: (event: RunEvent) => input.events!.push(event) } : {}),
  })
}

function planFrom(journal: MemoryJournal, runId: string): ReplayPlan {
  const run = journal.get(runId)!
  return buildReplayPlan({ nodes: run.nodes, events: run.events, actors: run.actors })
}

/** 第一次生命：跑一个 ask，答掉，然后被杀掉。 */
async function firstLife(journal: MemoryJournal, runId = "run-1") {
  const driver = new RecordingDriver()
  const engine = makeEngine({ runId, driver, journal })
  const local = engine.createActor("actor#1", "审阅者")
  const pending = engine.ask("ask#1", local, "同一句指令")
  await tick()
  driver.answer("第一次的答案")
  expect(await pending).toBe("第一次的答案")
  engine.stop("user")
  await engine.settled
  return { driver, engine, local }
}

describe("恢复 / 缓存重放", () => {
  test("已完成的 ask 不再调驱动，直接拿到上次的答案", async () => {
    const journal = new MemoryJournal()
    await firstLife(journal)
    const plan = planFrom(journal, "run-1")

    const driver = new RecordingDriver("explode")
    const events: RunEvent[] = []
    const engine = makeEngine({ runId: "run-1", driver, journal, replay: plan, events })

    const local = engine.createActor("actor#1", "审阅者")
    const value = await engine.ask("ask#1", local, "同一句指令")

    expect(value).toBe("第一次的答案")
    expect(driver.asks).toHaveLength(0)
    expect(events.some((event) => event.type === "node-settled" && event.cached === true)).toBe(true)
    engine.stop("user")
    await engine.settled
  })

  test("子代理不重复落行，会话被接回上一次那个", async () => {
    const journal = new MemoryJournal()
    await firstLife(journal)
    const plan = planFrom(journal, "run-1")
    expect(journal.get("run-1")!.actors).toHaveLength(1)

    const driver = new RecordingDriver()
    const engine = makeEngine({ runId: "run-1", driver, journal, replay: plan })
    const local = engine.createActor("actor#1", "审阅者")
    // 缓存那一条根本不需要会话，所以只看新的一轮：它必须接回旧会话，而不是新建一个。
    expect(await engine.ask("ask#1", local, "同一句指令")).toBe("第一次的答案")
    const next = engine.ask("ask#1", local, "换一句")
    await tick()

    expect(journal.get("run-1")!.actors).toHaveLength(1)
    expect(driver.created).toHaveLength(0)
    expect(driver.attached).toEqual(["session-actor#1-1"])
    driver.answer("第二次的答案")
    expect(await next).toBe("第二次的答案")
    engine.stop("user")
    await engine.settled
  })

  test("缓存之后的新 ask 接着编号，并真的走驱动", async () => {
    const journal = new MemoryJournal()
    await firstLife(journal)
    const plan = planFrom(journal, "run-1")

    const driver = new RecordingDriver()
    const engine = makeEngine({ runId: "run-1", driver, journal, replay: plan })
    const local = engine.createActor("actor#1", "审阅者")

    expect(await engine.ask("ask#1", local, "同一句指令")).toBe("第一次的答案")
    const next = engine.ask("ask#1", local, "换一句")
    await tick()
    // 编号接着上次数：新实例是 ask#1@2，actorSeq 也是 2。
    expect(driver.asks).toHaveLength(1)
    expect(driver.asks[0]!.instance).toEqual({ siteId: "ask#1", ordinal: 2 })
    driver.answer("第二次的答案")
    expect(await next).toBe("第二次的答案")
    engine.stop("user")
    await engine.settled
  })

  test("上次失败的 ask 重放成同样的拒绝，脚本仍然可以 catch", async () => {
    const journal = new MemoryJournal()
    const driver = new RecordingDriver()
    const engine = makeEngine({ runId: "run-1", driver, journal })
    const local = engine.createActor("actor#1")
    // 第一次生命：驱动拒绝了这一轮，引擎把节点记成 failed。
    engine.ask("ask#1", local, "会失败").catch(() => undefined)
    await tick()
    journal.settleNode({
      runId: "run-1",
      instance: { siteId: "ask#1", ordinal: 1 },
      status: "failed",
      failure: { name: "AskFailed", message: "模型拒绝了", code: "AskFailed" },
    })
    engine.stop("user")
    await engine.settled

    const plan = planFrom(journal, "run-1")
    const driver2 = new RecordingDriver("explode")
    const engine2 = makeEngine({ runId: "run-1", driver: driver2, journal, replay: plan })
    const local2 = engine2.createActor("actor#1")
    const error = await engine2.ask("ask#1", local2, "会失败").then(
      () => undefined,
      (value: unknown) => value as Error,
    )
    expect(error?.message).toBe("模型拒绝了")
    expect((error as Error & { code?: string }).code).toBe("AskFailed")
    expect(driver2.asks).toHaveLength(0)
    engine2.stop("user")
    await engine2.settled
  })

  test("输入与 journal 对不上时，整次 run 记为 errored 而不是拿错答案", async () => {
    const journal = new MemoryJournal()
    await firstLife(journal)
    const plan = planFrom(journal, "run-1")

    const driver = new RecordingDriver("explode")
    const engine = makeEngine({ runId: "run-1", driver, journal, replay: plan })
    const local = engine.createActor("actor#1", "审阅者")
    const error = await engine.ask("ask#1", local, "改过的指令").then(
      () => undefined,
      (value: unknown) => value as Error,
    )
    expect(error?.name).toBe("WorkflowProtocolError")
    const settlement = await engine.settled
    expect(settlement.status).toBe("errored")
  })

  test("world-read 的缓存答案同样复用", async () => {
    const journal = new MemoryJournal()
    const driver = new RecordingDriver()
    const engine = makeEngine({ runId: "run-1", driver, journal })
    expect(await engine.worldRead("world-read#1", "glob", ["*.ts"])).toEqual({ op: "glob", args: ["*.ts"] })
    engine.stop("user")
    await engine.settled

    const plan = planFrom(journal, "run-1")
    let calls = 0
    const driver2 = new RecordingDriver()
    driver2.executeWorldRead = async (request) => {
      calls += 1
      return request
    }
    const engine2 = makeEngine({ runId: "run-1", driver: driver2, journal, replay: plan })
    expect(await engine2.worldRead("world-read#1", "glob", ["*.ts"])).toEqual({ op: "glob", args: ["*.ts"] })
    expect(calls).toBe(0)
    engine2.stop("user")
    await engine2.settled
  })
})
