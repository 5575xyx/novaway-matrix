import { afterEach, describe, expect, test } from "bun:test"
import { Context } from "effect"
import { HttpApiApp } from "../../src/server/routes/instance/httpapi/server"
import { DynamicWorkflowPaths } from "../../src/server/routes/instance/httpapi/groups/dynamic-workflow"
import { SqliteJournal } from "../../src/dynamic-workflow/engine/sqlite-journal"
import { fnv1a } from "../../src/dynamic-workflow/engine/hash"
import * as registry from "../../src/dynamic-workflow/runtime/registry"
import * as Log from "@novaway/core/util/log"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, tmpdir } from "../fixture/fixture"

void Log.init({ print: false })

// 只读接口的三条承诺：按目录收窄、缺省限量、不存在的 run 是 404。
// 这里直接往库里写一次「上一个进程留下的」运行，再从 HTTP 读回来——
// 这正是界面在重启之后会遇到的情形。

const context = Context.empty() as Context.Context<unknown>

function request(route: string, directory: string, query?: Record<string, string>, method = "GET") {
  const url = new URL(`http://localhost${route}`)
  for (const [key, value] of Object.entries(query ?? {})) url.searchParams.set(key, value)
  return HttpApiApp.webHandler().handler(
    new Request(url, { method, headers: { "x-novaway-directory": directory } }),
    context,
  )
}

let seq = 0
/** 落一次已完成的 run：两条节点、一个子代理、两条事件。 */
function seed(input: { cwd: string; status?: "completed" | "stopped"; name?: string }) {
  const runId = `dwfrun-http-${Date.now()}-${(seq += 1)}`
  const scriptText = `const r = agent()${String.fromCharCode(10)}return await r.ask<string>("hi")`
  const journal = new SqliteJournal({ cwd: input.cwd, scriptText, ...(input.name ? { name: input.name } : {}) })
  journal.startRun({ runId, scriptHash: fnv1a(scriptText), maxConcurrency: 3, status: "running" })
  journal.appendActor({ runId, actor: { siteId: "actor#1", ordinal: 1 }, name: "审阅者" })
  journal.recordActorSession({ runId, actor: { siteId: "actor#1", ordinal: 1 }, session: "ses_child_http" })
  journal.appendNode({
    runId,
    siteId: "ask#1",
    ordinal: 1,
    kind: "ask",
    actor: { siteId: "actor#1", ordinal: 1 },
    actorSeq: 1,
    inputHash: "h1",
    status: "running",
  })
  journal.settleNode({ runId, instance: { siteId: "ask#1", ordinal: 1 }, status: "completed", result: "答案" })
  journal.appendNode({ runId, siteId: "report#1", ordinal: 1, kind: "report", inputHash: "h2", status: "running" })
  journal.settleNode({
    runId,
    instance: { siteId: "report#1", ordinal: 1 },
    status: "completed",
    result: { verdict: "ok" },
  })
  journal.appendEvent({ runId, type: "run-started", payload: { runId } })
  journal.appendEvent({ runId, type: "report", payload: { item: { verdict: "ok" } } })
  if (input.status === "stopped") journal.settleRun({ runId, status: "stopped", stopReason: "user", spentTokens: 7 })
  else journal.settleRun({ runId, status: "completed", result: { verdict: "ok" }, spentTokens: 7 })
  return runId
}

afterEach(async () => {
  registry.reset()
  await disposeAllInstances()
  await resetDatabase()
})

describe("dynamic-workflow HttpApi", () => {
  test("列出当前目录的 run，别的目录看不见", async () => {
    await using tmp = await tmpdir({ git: true })
    await using other = await tmpdir({ git: true })
    const mine = seed({ cwd: tmp.path, name: "这次" })
    seed({ cwd: other.path, name: "别人的" })

    const response = await request(DynamicWorkflowPaths.runs, tmp.path)
    expect(response.status).toBe(200)
    const rows = (await response.json()) as Array<{ runId: string; name?: string }>
    expect(rows.map((row) => row.runId)).toEqual([mine])
    expect(rows[0]!.name).toBe("这次")
  })

  test("run 详情带上进度与可恢复标记", async () => {
    await using tmp = await tmpdir({ git: true })
    const runId = seed({ cwd: tmp.path, status: "stopped", name: "停下的" })

    const response = await request(DynamicWorkflowPaths.run.replace(":runId", runId), tmp.path)
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      runId: string
      status: string
      resumable: boolean
      live: boolean
      spentTokens: number
      progress: { nodes: { total: number; completed: number; reports: number }; actors: number; events: number }
    }
    expect(body).toMatchObject({ runId, status: "stopped", resumable: true, live: false, spentTokens: 7 })
    expect(body.progress.nodes).toMatchObject({ total: 2, completed: 2, reports: 1 })
    expect(body.progress.actors).toBe(1)
    expect(body.progress.events).toBe(2)
  })

  test("节点按 kind 过滤，结果默认不取", async () => {
    await using tmp = await tmpdir({ git: true })
    const runId = seed({ cwd: tmp.path })
    const route = DynamicWorkflowPaths.nodes.replace(":runId", runId)

    const reports = (await (await request(route, tmp.path, { kinds: "report" })).json()) as Array<{
      siteId: string
      result?: unknown
    }>
    expect(reports.map((node) => node.siteId)).toEqual(["report#1"])
    expect(reports[0]!.result).toBeUndefined()

    const withResult = (await (await request(route, tmp.path, { withResult: "true" })).json()) as Array<{
      siteId: string
      result?: unknown
    }>
    expect(withResult).toHaveLength(2)
    expect(withResult.find((node) => node.siteId === "report#1")!.result).toEqual({ verdict: "ok" })
  })

  test("子代理与事件都读得到，事件能从序号往后翻", async () => {
    await using tmp = await tmpdir({ git: true })
    const runId = seed({ cwd: tmp.path })

    const actors = (await (
      await request(DynamicWorkflowPaths.actors.replace(":runId", runId), tmp.path)
    ).json()) as Array<{ siteId: string; ordinal: number; name?: string; sessionID?: string }>
    expect(actors).toEqual([{ siteId: "actor#1", ordinal: 1, name: "审阅者", sessionID: "ses_child_http" }])

    const eventsRoute = DynamicWorkflowPaths.events.replace(":runId", runId)
    const all = (await (await request(eventsRoute, tmp.path)).json()) as Array<{ sequence: number; type: string }>
    expect(all.map((event) => event.type)).toEqual(["run-started", "report"])

    const after = (await (await request(eventsRoute, tmp.path, { after: "1" })).json()) as Array<{ sequence: number }>
    expect(after.map((event) => event.sequence)).toEqual([2])
  })

  test("跨目录要看全部时明确传 all=true", async () => {
    await using tmp = await tmpdir({ git: true })
    await using other = await tmpdir({ git: true })
    const mine = seed({ cwd: tmp.path })
    const theirs = seed({ cwd: other.path })

    const rows = (await (await request(DynamicWorkflowPaths.runs, tmp.path, { all: "true" })).json()) as Array<{
      runId: string
    }>
    const runIds = rows.map((row) => row.runId)
    expect(runIds).toContain(mine)
    expect(runIds).toContain(theirs)
  })

  test("不存在的 run 是 404，而不是空对象", async () => {
    await using tmp = await tmpdir({ git: true })
    const response = await request(DynamicWorkflowPaths.run.replace(":runId", "dwfrun-nope"), tmp.path)
    expect(response.status).toBe(404)
    const body = (await response.json()) as { data?: { message?: string } }
    expect(body.data?.message).toContain("dwfrun-nope")
  })

  test("停一个已经结束的 run：不报错，只是说没有可停的", async () => {
    await using tmp = await tmpdir({ git: true })
    const runId = seed({ cwd: tmp.path, status: "stopped" })
    const response = await request(DynamicWorkflowPaths.stop.replace(":runId", runId), tmp.path, undefined, "POST")
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ requested: false })
  })

  test("在跑的 run：live 为真，stop 会真的把停止请求递出去", async () => {
    await using tmp = await tmpdir({ git: true })
    const runId = seed({ cwd: tmp.path })
    // 登记表里有它 = 这个进程正在跑它。停止把手只存在于这一侧。
    const stopped: string[] = []
    const entry = registry.register({
      runId,
      name: "在跑的",
      scriptText: "return 1",
      phaseNames: [],
      siteIds: [],
    })
    entry.stop = (reason) => {
      stopped.push(reason)
    }

    const detail = (await (await request(DynamicWorkflowPaths.run.replace(":runId", runId), tmp.path)).json()) as {
      live: boolean
      resumable: boolean
    }
    expect(detail.live).toBe(true)
    expect(detail.resumable).toBe(false)

    const response = await request(DynamicWorkflowPaths.stop.replace(":runId", runId), tmp.path, undefined, "POST")
    expect(await response.json()).toEqual({ requested: true })
    expect(stopped).toEqual(["user"])
  })
})
