import { describe, expect, test } from "bun:test"
import { SqliteJournal } from "../../src/dynamic-workflow/engine/sqlite-journal"
import { MemoryJournal } from "../../src/dynamic-workflow/engine/memory-journal"
import { buildReplayPlan } from "../../src/dynamic-workflow/engine/replay"
import {
  listRuns,
  readActors,
  readEvents,
  readNode,
  readNodes,
  readRun,
  summarizeRun,
} from "../../src/dynamic-workflow/journal/read"

// 两个 journal 实现必须记录同样的东西。这里对同一组操作跑一遍，逐字段比对——
// 「内存里能恢复、数据库里恢复不了」是最难在生产上定位的一类 bug。

let counter = 0
const freshRunId = () => `dwftest-${Date.now()}-${counter++}`

const script = ['phase("评审")', 'const a = await r.ask("x")', "report(a)", "return a"].join("\n")

function makeSqlite(runId: string, cwd = "/tmp/dwf-journal") {
  return new SqliteJournal({ cwd, scriptText: script, parentSessionID: "ses_dwf" })
}

/** 同一组操作分别喂给两个实现。 */
function play(journal: MemoryJournal | SqliteJournal, runId: string) {
  journal.startRun({ runId, scriptHash: "hash-1", maxConcurrency: 4, status: "running" })
  journal.appendActor({ runId, actor: { siteId: "actor#1", ordinal: 1 }, name: "审阅者" })
  journal.appendNode({
    runId,
    siteId: "ask#1",
    ordinal: 1,
    kind: "ask",
    actor: { siteId: "actor#1", ordinal: 1 },
    actorSeq: 1,
    inputHash: "ih-ask",
    input: { instructions: "看一眼" },
    status: "running",
  })
  journal.appendEvent({ runId, type: "node-started", payload: { siteId: "ask#1", ordinal: 1 } })
  journal.settleNode({ runId, instance: { siteId: "ask#1", ordinal: 1 }, status: "completed", result: "答" })
  journal.appendEvent({ runId, type: "node-settled", payload: { siteId: "ask#1", ordinal: 1 } })
  journal.appendNode({
    runId,
    siteId: "report#1",
    ordinal: 1,
    kind: "report",
    inputHash: "ih-report",
    status: "running",
  })
  journal.settleNode({ runId, instance: { siteId: "report#1", ordinal: 1 }, status: "completed", result: { ok: true } })
  journal.settleRun({ runId, status: "completed", result: { ok: true }, spentTokens: 11 })
}

describe("SQLite journal / 写入", () => {
  test("写进去的都能读回来", () => {
    const runId = freshRunId()
    const journal = makeSqlite(runId)
    play(journal, runId)

    const header = readRun(runId)!
    expect(header.status).toBe("completed")
    expect(header.scriptHash).toBe("hash-1")
    expect(header.scriptText).toBe(script)
    expect(header.spentTokens).toBe(11)
    expect(header.maxConcurrency).toBe(4)
    expect(header.result).toEqual({ ok: true })

    const nodes = readNodes(runId, { limit: 10, withResult: true })
    expect(nodes.map((node) => `${node.siteId}@${node.ordinal}`)).toEqual(["ask#1@1", "report#1@1"])
    expect(nodes[0]!.status).toBe("completed")
    expect(nodes[0]!.result).toBe("答")
    expect(nodes[0]!.actor).toEqual({ siteId: "actor#1", ordinal: 1 })
    expect(nodes[0]!.actorSeq).toBe(1)

    expect(readActors(runId).map((actor) => actor.name)).toEqual(["审阅者"])
    expect(readEvents(runId, { limit: 50 }).map((event) => event.type)).toEqual(["node-started", "node-settled"])
  })

  test("事件序号从 1 起连续递增，换一个 journal 实例也接着数", () => {
    const runId = freshRunId()
    const first = makeSqlite(runId)
    first.startRun({ runId, scriptHash: "h", maxConcurrency: 2, status: "running" })
    expect(first.appendEvent({ runId, type: "a", payload: {} })).toBe(1)
    expect(first.appendEvent({ runId, type: "b", payload: {} })).toBe(2)

    // 新实例（模拟进程重启）必须从库里读到的最大值接着数，而不是从 1 重来。
    const second = makeSqlite(runId)
    expect(second.appendEvent({ runId, type: "c", payload: {} })).toBe(3)
    expect(readEvents(runId, { limit: 10 }).map((event) => event.sequence)).toEqual([1, 2, 3])
  })

  test("同一实例重复落行会被拒绝，错误里带实例名", () => {
    const runId = freshRunId()
    const journal = makeSqlite(runId)
    journal.startRun({ runId, scriptHash: "h", maxConcurrency: 1, status: "running" })
    const record = {
      runId,
      siteId: "ask#1",
      ordinal: 1,
      kind: "ask" as const,
      inputHash: "x",
      status: "running" as const,
    }
    journal.appendNode(record)
    expect(() => journal.appendNode(record)).toThrow(/ask#1@1/)
  })

  test("结算一个不存在的节点会抛错，而不是静默什么都不做", () => {
    const runId = freshRunId()
    const journal = makeSqlite(runId)
    journal.startRun({ runId, scriptHash: "h", maxConcurrency: 1, status: "running" })
    expect(() => journal.settleNode({ runId, instance: { siteId: "ask#9", ordinal: 1 }, status: "completed" })).toThrow(
      /ask#9@1/,
    )
  })

  test("reopenNode 把上次没跑完的节点改回 running", () => {
    const runId = freshRunId()
    const journal = makeSqlite(runId)
    journal.startRun({ runId, scriptHash: "h", maxConcurrency: 1, status: "running" })
    journal.appendNode({ runId, siteId: "ask#1", ordinal: 1, kind: "ask", inputHash: "x", status: "running" })
    journal.settleNode({
      runId,
      instance: { siteId: "ask#1", ordinal: 1 },
      status: "failed",
      failure: { name: "E", message: "m" },
    })
    expect(readNode(runId, { siteId: "ask#1", ordinal: 1 })!.status).toBe("failed")
    journal.reopenNode({ runId, instance: { siteId: "ask#1", ordinal: 1 } })
    expect(readNode(runId, { siteId: "ask#1", ordinal: 1 })!.status).toBe("running")
  })

  test("记录子会话 id；非字符串的会话身份静默忽略", () => {
    const runId = freshRunId()
    const journal = makeSqlite(runId)
    journal.startRun({ runId, scriptHash: "h", maxConcurrency: 1, status: "running" })
    journal.appendActor({ runId, actor: { siteId: "actor#1", ordinal: 1 } })
    journal.appendActor({ runId, actor: { siteId: "actor#1", ordinal: 2 } })
    journal.recordActorSession({ runId, actor: { siteId: "actor#1", ordinal: 1 }, session: "ses_child" })
    journal.recordActorSession({ runId, actor: { siteId: "actor#1", ordinal: 2 }, session: { not: "a string" } })
    const actors = readActors(runId)
    expect(actors[0]!.sessionID).toBe("ses_child")
    expect(actors[1]!.sessionID).toBeUndefined()
  })

  test("超过上限的记录换成截断说明，而不是半截 JSON", () => {
    const runId = freshRunId()
    const journal = new SqliteJournal({ cwd: "/tmp", scriptText: "x" }, 64)
    journal.startRun({ runId, scriptHash: "h", maxConcurrency: 1, status: "running" })
    journal.appendNode({ runId, siteId: "report#1", ordinal: 1, kind: "report", inputHash: "x", status: "running" })
    journal.settleNode({
      runId,
      instance: { siteId: "report#1", ordinal: 1 },
      status: "completed",
      result: { blob: "x".repeat(500) },
    })
    expect(readNode(runId, { siteId: "report#1", ordinal: 1 })!.result).toEqual({
      truncated: true,
      reason: "超过 64 字节",
    })
  })
})

describe("SQLite journal / 与内存实现等价", () => {
  test("同一组操作，两边记录的行与顺序一致", () => {
    const memoryRun = freshRunId()
    const sqliteRun = freshRunId()
    const memory = new MemoryJournal()
    const sqlite = makeSqlite(sqliteRun)
    play(memory, memoryRun)
    play(sqlite, sqliteRun)

    const fromMemory = memory.get(memoryRun)!
    const fromSqlite = readNodes(sqliteRun, { limit: 10, withResult: true })
    expect(
      fromSqlite.map((node) => `${node.siteId}@${node.ordinal}:${node.status}:${JSON.stringify(node.result)}`),
    ).toEqual(
      fromMemory.nodes.map((node) => `${node.siteId}@${node.ordinal}:${node.status}:${JSON.stringify(node.result)}`),
    )
    expect(readEvents(sqliteRun, { limit: 10 }).map((event) => event.type)).toEqual(
      fromMemory.events.map((event) => event.type),
    )
  })
})

describe("journal 读侧", () => {
  test("listRuns 按更新时间倒序，可按 cwd 过滤", () => {
    const cwd = `/tmp/dwf-list-${Date.now()}`
    const a = freshRunId()
    const b = freshRunId()
    const other = freshRunId()
    for (const [runId, dir] of [
      [a, cwd],
      [b, cwd],
      [other, "/tmp/dwf-elsewhere"],
    ] as const) {
      const journal = new SqliteJournal({ cwd: dir, scriptText: "x", ...(runId === b ? { name: "有名字" } : {}) })
      journal.startRun({ runId, scriptHash: "h", maxConcurrency: 3, status: "running" })
      journal.settleRun({ runId, status: "stopped", stopReason: "user", spentTokens: 2 })
    }
    const rows = listRuns({ cwd, limit: 10 })
    expect(rows.map((row) => row.runId)).toEqual([b, a])
    expect(rows[0]!.name).toBe("有名字")
    expect(rows[0]!.stopReason).toBe("user")
    expect(rows[0]!.spentTokens).toBe(2)
  })

  test("readEvents 支持按序号往后翻页", () => {
    const runId = freshRunId()
    const journal = makeSqlite(runId)
    journal.startRun({ runId, scriptHash: "h", maxConcurrency: 1, status: "running" })
    for (let index = 0; index < 5; index += 1) journal.appendEvent({ runId, type: `e${index}`, payload: {} })
    expect(readEvents(runId, { limit: 2 }).map((event) => event.sequence)).toEqual([1, 2])
    expect(readEvents(runId, { after: 3, limit: 10 }).map((event) => event.sequence)).toEqual([4, 5])
  })

  test("summarizeRun 让数据库数，报告与在跑的分开算", () => {
    const runId = freshRunId()
    const journal = makeSqlite(runId)
    journal.startRun({ runId, scriptHash: "h", maxConcurrency: 2, status: "running" })
    journal.appendActor({ runId, actor: { siteId: "actor#1", ordinal: 1 } })
    // 三个已完成（其中一个是报告）、一个失败、一个还在跑。
    for (const [siteId, kind, status] of [
      ["ask#1", "ask", "completed"],
      ["ask#2", "ask", "failed"],
      ["ask#3", "ask", "running"],
      ["report#1", "report", "completed"],
    ] as const) {
      journal.appendNode({ runId, siteId, ordinal: 1, kind, inputHash: "h", status: "running" })
      if (status !== "running") journal.settleNode({ runId, instance: { siteId, ordinal: 1 }, status })
    }
    for (let index = 0; index < 3; index += 1) journal.appendEvent({ runId, type: "e", payload: {} })

    expect(summarizeRun(runId)).toEqual({
      nodes: { total: 4, completed: 2, failed: 1, running: 1, reports: 1 },
      actors: 1,
      events: 3,
    })
    // 不存在的 run 是零，而不是抛错——界面在列表里点到一条刚被清掉的历史时就是这样。
    expect(summarizeRun("dwf-missing-run")).toEqual({
      nodes: { total: 0, completed: 0, failed: 0, running: 0, reports: 0 },
      actors: 0,
      events: 0,
    })
  })

  test("节点与事件都带着落行时间，画时间线不必再查一次", () => {
    const runId = freshRunId()
    const journal = makeSqlite(runId)
    journal.startRun({ runId, scriptHash: "h", maxConcurrency: 1, status: "running" })
    journal.appendNode({ runId, siteId: "ask#1", ordinal: 1, kind: "ask", inputHash: "h", status: "running" })
    journal.settleNode({ runId, instance: { siteId: "ask#1", ordinal: 1 }, status: "completed", result: "x" })
    journal.appendEvent({ runId, type: "node-settled", payload: {} })

    const node = readNodes(runId, { limit: 5 })[0]!
    expect(node.timeCreated).toBeGreaterThan(0)
    // 结算会推进 time_updated：两者的差就是这一步的耗时。
    expect(node.timeUpdated).toBeGreaterThanOrEqual(node.timeCreated)
    expect(readEvents(runId, { limit: 5 })[0]!.timeCreated).toBeGreaterThan(0)
  })
})

describe("恢复规划", () => {
  test("从节点与事件还原出缓存、未完成、编号上限与结算顺序", () => {
    const plan = buildReplayPlan({
      nodes: [
        {
          siteId: "ask#1",
          ordinal: 1,
          status: "completed",
          inputHash: "h1",
          result: "A",
          actor: { siteId: "actor#1", ordinal: 1 },
          actorSeq: 1,
        },
        {
          siteId: "ask#1",
          ordinal: 2,
          status: "failed",
          inputHash: "h2",
          failure: { name: "E", message: "坏" },
          actor: { siteId: "actor#1", ordinal: 1 },
          actorSeq: 2,
        },
        {
          siteId: "ask#1",
          ordinal: 3,
          status: "running",
          inputHash: "h3",
          actor: { siteId: "actor#1", ordinal: 1 },
          actorSeq: 3,
        },
        { siteId: "actor#1", ordinal: 2, status: "running", inputHash: "h4" },
      ],
      actors: [
        { actor: { siteId: "actor#1", ordinal: 1 } },
        { actor: { siteId: "actor#1", ordinal: 2 }, name: "复核者", sessionID: "ses_2" },
      ],
      events: [
        { sequence: 1, type: "run-started", payload: {} },
        // 先跑完的是第 2 个实例：恢复时缓存必须按这个顺序释放。
        { sequence: 2, type: "node-settled", payload: { instance: { siteId: "ask#1", ordinal: 2 } } },
        { sequence: 3, type: "node-settled", payload: { instance: { siteId: "ask#1", ordinal: 1 } } },
        { sequence: 4, type: "node-settled", payload: { instance: { siteId: "ask#1", ordinal: 1 } } },
      ],
    })

    expect([...plan.settled.keys()].sort()).toEqual(["ask#1@1", "ask#1@2"])
    expect(plan.settled.get("ask#1@1")!.result).toBe("A")
    expect(plan.settled.get("ask#1@2")!.actorSeq).toBe(2)
    expect([...plan.running].sort()).toEqual(["actor#1@2", "ask#1@3"])
    expect(plan.ordinals.get("ask#1")).toBe(3)
    expect([...plan.actors.keys()].sort()).toEqual(["actor#1@1", "actor#1@2"])
    expect(plan.actors.get("actor#1@2")).toEqual({ name: "复核者", sessionID: "ses_2" })
    expect(plan.actorSeqs.get("actor#1@1")).toBe(3)
    // 去重后的首次结算顺序。
    expect(plan.settleOrder).toEqual(["ask#1@2", "ask#1@1"])
  })
})
