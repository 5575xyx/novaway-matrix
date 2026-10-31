import { NodeHttpServer, NodeServices } from "@effect/platform-node"
import { Flag } from "@novaway/core/flag/flag"
import { SessionTable } from "@/session/session.sql"
import { SessionID } from "@/session/schema"
import { Database } from "@/storage/db"
import { describe, expect } from "bun:test"
import { eq } from "drizzle-orm"
import { Config, Effect, Layer } from "effect"
import { HttpClient, HttpClientRequest, HttpRouter, HttpServer } from "effect/unstable/http"
import * as Socket from "effect/unstable/socket/Socket"
import { HttpApiApp } from "../../src/server/routes/instance/httpapi/server"
import { resetDatabase } from "../fixture/db"
import { tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

// 团队接口走的是生产路由树：mission 的编号/起点/状态与 run 的目标校验都在 HTTP 边界上，
// 只测 service 会漏掉「参数被序列化成什么、拒绝时返回什么状态码」这一层。
const testStateLayer = Layer.effectDiscard(
  Effect.gen(function* () {
    const originalWorkspaces = Flag.NOVAWAY_EXPERIMENTAL_WORKSPACES
    Flag.NOVAWAY_EXPERIMENTAL_WORKSPACES = true
    yield* Effect.promise(() => resetDatabase())
    yield* Effect.addFinalizer(() =>
      Effect.promise(async () => {
        Flag.NOVAWAY_EXPERIMENTAL_WORKSPACES = originalWorkspaces
        await resetDatabase()
      }),
    )
  }),
)

const servedRoutes: Layer.Layer<never, Config.ConfigError, HttpServer.HttpServer> = HttpRouter.serve(
  HttpApiApp.routes,
  { disableListenLog: true },
)

const httpApiServerLayer = servedRoutes.pipe(
  Layer.provide(Socket.layerWebSocketConstructorGlobal),
  Layer.provideMerge(NodeHttpServer.layerTest),
  Layer.provideMerge(NodeServices.layer),
)

const it = testEffect(Layer.mergeAll(testStateLayer, httpApiServerLayer))

const directoryHeader = (dir: string) => HttpClientRequest.setHeader("x-opencode-directory", dir)

const send = (request: HttpClientRequest.HttpClientRequest, body?: unknown) =>
  Effect.gen(function* () {
    // `bodyJson(body)` 返回的是 request → Effect，所以要显式把请求喂进去再执行。
    const ready = body === undefined ? request : yield* HttpClientRequest.bodyJson(body)(request)
    return yield* HttpClient.execute(ready)
  })

const post = (dir: string, path: string, body?: unknown) =>
  send(HttpClientRequest.post(path).pipe(directoryHeader(dir), HttpClientRequest.setUrlParam("directory", dir)), body)

const get = (dir: string, path: string, param?: string) =>
  HttpClient.execute(
    HttpClientRequest.get(path).pipe(
      directoryHeader(dir),
      param ? HttpClientRequest.setUrlParam("directory", param) : (request) => request,
    ),
  )

const patch = (dir: string, path: string, body: unknown) =>
  send(HttpClientRequest.patch(path).pipe(directoryHeader(dir), HttpClientRequest.setUrlParam("directory", dir)), body)

const del = (dir: string, path: string) =>
  HttpClient.execute(
    HttpClientRequest.delete(path).pipe(directoryHeader(dir), HttpClientRequest.setUrlParam("directory", dir)),
  )

describe("team HttpApi", () => {
  it.live("creates, lists and updates a mission; the diff says why it cannot be computed yet", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped({ git: true })

      const created = yield* post(dir, "/team/mission", { directory: dir, goal: "把下载流程改好" })
      expect(created.status).toBe(200)
      const mission = (yield* created.json) as {
        id: string
        number: number
        label: string
        status: string
        baseSHA?: string
        runCount: number
      }
      // 编号只给人看；起点在建目标时就冻结。
      expect(mission.label).toBe("M-001")
      expect(mission.status).toBe("active")
      expect(mission.baseSHA).toBeTruthy()
      expect(mission.runCount).toBe(0)

      const listed = yield* get(dir, "/team/mission", dir)
      expect(listed.status).toBe(200)
      expect(((yield* listed.json) as Array<{ id: string }>).map((item) => item.id)).toContain(mission.id)

      // 别的目录看不到这个目标：列表按目录过滤，不是「全局一张表随便看」。
      const other = yield* tmpdirScoped({ git: true })
      const elsewhere = yield* get(other, "/team/mission", other)
      expect(yield* elsewhere.json).toEqual([])
      // 按 id 直取也一样：知道 id 不等于有权读写。
      expect((yield* get(other, `/team/mission/${mission.id}`, other)).status).toBe(404)
      expect((yield* get(other, `/team/mission/${mission.id}/diff`, other)).status).toBe(404)
      expect((yield* patch(other, `/team/mission/${mission.id}`, { status: "abandoned" })).status).toBe(404)

      const detail = yield* get(dir, `/team/mission/${mission.id}`)
      expect(detail.status).toBe(200)
      expect((yield* detail.json) as { goal: string }).toMatchObject({ goal: "把下载流程改好" })

      // 还没有工作区时，差异返回原因而不是「0 个文件」。
      const diff = yield* get(dir, `/team/mission/${mission.id}/diff`)
      expect(diff.status).toBe(200)
      expect((yield* diff.json) as { files: unknown[]; skippedReason?: string }).toMatchObject({
        files: [],
        untracked: [],
        truncated: false,
        skippedReason: "目标还没有工作区",
      })

      const updated = yield* patch(dir, `/team/mission/${mission.id}`, { status: "done" })
      expect(updated.status).toBe(200)
      expect((yield* updated.json) as { status: string }).toMatchObject({ status: "done" })

      expect((yield* get(dir, "/team/mission/mis_missing")).status).toBe(404)
    }),
  )

  it.live("refuses to attach a run to a mission that is missing, finished or in another directory", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped({ git: true })
      const created = yield* post(dir, "/team/mission", { directory: dir, goal: "长期目标" })
      const mission = (yield* created.json) as { id: string }

      const body = (missionID: string, directory: string) => ({
        sessionID: "ses_team_http",
        directory,
        mode: "team" as const,
        goal: "一次运行",
        missionID,
      })

      // 目标不存在 / 目标属于别的目录 / 目标已结束：三种情况都不能悄悄降级成「不带目标的运行」。
      expect((yield* post(dir, "/run", body("mis_missing", dir))).status).toBe(400)
      const other = yield* tmpdirScoped({ git: true })
      expect((yield* post(dir, "/run", body(mission.id, other))).status).toBe(400)

      yield* patch(dir, `/team/mission/${mission.id}`, { status: "done" })
      expect((yield* post(dir, "/run", body(mission.id, dir))).status).toBe(400)
    }),
  )

  it.live("merge is only offered for terminal runs with a verified delivery", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped({ git: true })

      const created = yield* post(dir, "/run", {
        sessionID: "ses_team_http",
        directory: dir,
        mode: "team",
        goal: "一次性运行",
      })
      expect(created.status).toBe(200)
      const run = (yield* created.json) as {
        run: { id: string; state: string }
        blockers: unknown[]
        teams: Array<{ context?: unknown }>
      }
      expect(run.run.state).toBe("planning")
      // 还没派发：既没有阻塞，也没有上下文清单 —— 空数组与缺字段是「确实没有」，
      // 不是「接口没实现」。
      expect(run.blockers).toEqual([])
      expect(run.teams).toEqual([])

      // 别的目录里既看不到这次运行，也拿这个 id 做不了任何事。
      const other = yield* tmpdirScoped({ git: true })
      expect(yield* (yield* get(other, "/run", other)).json).toEqual([])
      expect((yield* get(other, `/run/${run.run.id}`, other)).status).toBe(404)
      expect((yield* get(other, `/run/${run.run.id}/events`, other)).status).toBe(404)
      expect((yield* post(other, `/run/${run.run.id}/cancel`)).status).toBe(404)

      // 还在计划中的运行没有可交付物：合并没有意义，直接拒绝。
      expect((yield* post(dir, `/run/${run.run.id}/merge`)).status).toBe(400)

      const cancelled = yield* post(dir, `/run/${run.run.id}/cancel`)
      expect(cancelled.status).toBe(200)

      // 取消也是终态，但它不是「已验证交付」：返回原因，不假装合并成功。
      const merged = yield* post(dir, `/run/${run.run.id}/merge`)
      expect(merged.status).toBe(200)
      expect((yield* merged.json) as { merged: boolean; message?: string }).toMatchObject({
        merged: false,
        message: expect.stringContaining("cancelled"),
      })

      expect((yield* post(dir, "/run/run_missing/merge")).status).toBe(404)
    }),
  )

  it.live("widening the policy is explicit, bumps the plan and withdraws the approval it replaces", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped({ git: true })
      const created = yield* post(dir, "/run", {
        sessionID: "ses_policy",
        directory: dir,
        mode: "team",
        goal: "改点东西",
      })
      const run = (yield* created.json) as { run: { id: string; readOnly: boolean; planVersion: number } }
      // 缺省只读：想改工作区必须由人写出来。
      expect(run.run.readOnly).toBe(true)

      const widened = yield* post(dir, `/run/${run.run.id}/policy`, { readOnly: false })
      expect(widened.status).toBe(200)
      const afterWiden = (yield* widened.json) as {
        run: { readOnly: boolean; state: string; planVersion: number }
      }
      expect(afterWiden.run.readOnly).toBe(false)
      expect(afterWiden.run.planVersion).toBe(run.run.planVersion + 1)
      // 授权属于计划：改了就回到待批准，不能拿着旧批准直接开工。
      expect(afterWiden.run.state).toBe("awaiting_approval")

      const approved = yield* post(dir, `/run/${run.run.id}/approve`, {
        planVersion: afterWiden.run.planVersion,
        budget: { tokens: 1000 },
      })
      expect(approved.status).toBe(200)
      expect(((yield* approved.json) as { run: { state: string } }).run.state).toBe("running")

      // 批准后还没开工，仍可以改回只读；同样要作废刚才的批准。
      const narrowed = yield* post(dir, `/run/${run.run.id}/policy`, { readOnly: true })
      expect(narrowed.status).toBe(200)
      expect((yield* narrowed.json) as { run: { readOnly: boolean; state: string } }).toMatchObject({
        run: { readOnly: true, state: "awaiting_approval" },
      })

      // 别的目录不能改这次运行的授权。
      const other = yield* tmpdirScoped({ git: true })
      expect((yield* post(other, `/run/${run.run.id}/policy`, { readOnly: false })).status).toBe(404)

      // 已经结束的运行不再谈授权：换授权要开新的运行。
      expect((yield* post(dir, `/run/${run.run.id}/cancel`)).status).toBe(200)
      expect((yield* post(dir, `/run/${run.run.id}/policy`, { readOnly: false })).status).toBe(400)
    }),
  )

  it.live("a template run waits for approval instead of getting stuck in planning", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped({ git: true })
      // 模板列表接口会顺带播种内置审查团队。
      const profiles = (yield* (yield* get(dir, "/team/profile", dir)).json) as Array<{ id: string }>
      expect(profiles.length).toBeGreaterThan(0)

      const created = yield* post(dir, "/run", {
        sessionID: "ses_template",
        directory: dir,
        mode: "team",
        goal: "审查这次改动",
        profileID: profiles[0].id,
        acceptance: [{ text: "没有高危问题" }],
      })
      expect(created.status).toBe(200)
      const detail = (yield* created.json) as {
        run: { state: string; planVersion: number; readOnly: boolean }
        teams: unknown[]
      }
      // 计划已经建好：此刻该等批准。停在 `planning` 的话界面没有批准按钮，运行就卡死了。
      expect(detail.run.state).toBe("awaiting_approval")
      expect(detail.run.planVersion).toBe(1)
      // 模板发起也只能是只读 —— 想改工作区仍要显式放宽。
      expect(detail.run.readOnly).toBe(true)
      expect(detail.teams.length).toBe(1)
    }),
  )

  it.live("adds a person, then archives and restores them without losing the row", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped({ git: true })
      type Employee = {
        id: string
        name: string
        job: string
        prompt?: string
        skills?: string[]
        tier?: string
        archived: boolean
      }

      const created = yield* post(dir, "/team/employee", {
        directory: dir,
        name: "  小林  ",
        job: "build",
        prompt: "负责构建与依赖问题。",
        skills: ["build"],
      })
      expect(created.status).toBe(200)
      const employee = (yield* created.json) as Employee
      // 名字前后空格会混进名册与提示词，落库前就剪掉。
      expect(employee.name).toBe("小林")
      expect(employee.job).toBe("build")
      expect(employee.archived).toBe(false)

      const listed = (yield* (yield* get(dir, "/team/employee", dir)).json) as Employee[]
      expect(listed.map((item) => item.id)).toContain(employee.id)

      // 归档不是删除：人还在列表里，只是标了 archived，供「恢复」使用。
      const archived = yield* patch(dir, `/team/employee/${employee.id}`, { archived: true })
      expect(archived.status).toBe(200)
      expect((yield* archived.json) as Employee).toMatchObject({ name: "小林", archived: true })
      const stillThere = (yield* (yield* get(dir, "/team/employee", dir)).json) as Employee[]
      expect(stillThere.find((item) => item.id === employee.id)?.archived).toBe(true)

      const restored = yield* patch(dir, `/team/employee/${employee.id}`, { archived: false })
      expect((yield* restored.json) as Employee).toMatchObject({ archived: false })

      // 改名不会碰岗位；没传的字段保持原样。
      const renamed = yield* patch(dir, `/team/employee/${employee.id}`, { name: "林" })
      expect((yield* renamed.json) as Employee).toMatchObject({ name: "林", job: "build" })

      // 覆盖项留空就是清掉：生成的 SDK 里没有 null，清空只能靠空串 / 空数组。
      const fine = yield* patch(dir, `/team/employee/${employee.id}`, {
        prompt: "  ",
        skills: [],
        tier: "fast",
      })
      const cleared = (yield* fine.json) as Employee
      expect(cleared.tier).toBe("fast")
      expect(cleared.prompt).toBeUndefined()
      expect(cleared.skills).toBeUndefined()

      // 名字或岗位被清空是误用，不是合法修改。
      expect((yield* post(dir, "/team/employee", { directory: dir, name: "  ", job: "build" })).status).toBe(400)
      expect((yield* patch(dir, `/team/employee/${employee.id}`, { name: "" })).status).toBe(400)
      expect((yield* patch(dir, "/team/employee/emp_missing", { name: "不存在" })).status).toBe(404)
    }),
  )

  it.live("edits a template in place: rename, swap the captain, replace the roster", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped({ git: true })
      type Detail = {
        profile: {
          id: string
          name: string
          description?: string
          captainMember: string
          autoEligible: boolean
          version: number
          memberCount: number
        }
        members: Array<{ employeeID: string; role: string; duty?: string; order: number }>
      }
      const first = (yield* (yield* post(dir, "/team/employee", { directory: dir, name: "甲", job: "review" })).json) as {
        id: string
      }
      const second = (yield* (yield* post(dir, "/team/employee", { directory: dir, name: "乙", job: "review" })).json) as {
        id: string
      }
      const third = (yield* (yield* post(dir, "/team/employee", { directory: dir, name: "丙", job: "review" })).json) as {
        id: string
      }

      const created = (yield* (
        yield* post(dir, "/team/profile", {
          directory: dir,
          name: "两人组",
          description: "旧描述",
          captain: first.id,
          members: [{ employeeID: first.id }, { employeeID: second.id, duty: "只看测试" }],
        })
      ).json) as Detail
      expect(created.profile.version).toBe(1)

      // 改名：没传的字段保持原样，版本 +1。
      const renamed = (yield* (
        yield* patch(dir, `/team/profile/${created.profile.id}`, { name: "三人组", autoEligible: true })
      ).json) as Detail
      expect(renamed.profile).toMatchObject({
        name: "三人组",
        description: "旧描述",
        captainMember: first.id,
        autoEligible: true,
        version: 2,
        memberCount: 2,
      })

      // 只换队长：名册行的 role 跟着走，顺序不变。
      const swapped = (yield* (
        yield* patch(dir, `/team/profile/${created.profile.id}`, { captain: second.id })
      ).json) as Detail
      expect(swapped.profile.captainMember).toBe(second.id)
      expect(swapped.profile.version).toBe(3)
      expect(swapped.members.map((member) => [member.employeeID, member.role])).toEqual([
        [first.id, "worker"],
        [second.id, "captain"],
      ])

      // 整表替换：顺序即 order，被删掉的人不在名册里。
      const replaced = (yield* (
        yield* patch(dir, `/team/profile/${created.profile.id}`, {
          description: "  ",
          members: [{ employeeID: third.id, duty: "安全" }, { employeeID: second.id }],
        })
      ).json) as Detail
      expect(replaced.profile.description).toBeUndefined()
      expect(replaced.profile.version).toBe(4)
      expect(replaced.members.map((member) => [member.employeeID, member.order, member.role])).toEqual([
        [third.id, 0, "worker"],
        [second.id, 1, "captain"],
      ])

      // 空补丁不算修改：版本不动。
      const untouched = (yield* (yield* patch(dir, `/team/profile/${created.profile.id}`, {})).json) as Detail
      expect(untouched.profile.version).toBe(4)

      // 拒绝写错的修改，而不是写进库再让运行时才发现。
      expect((yield* patch(dir, `/team/profile/${created.profile.id}`, { name: "  " })).status).toBe(400)
      expect((yield* patch(dir, `/team/profile/${created.profile.id}`, { captain: "emp_missing" })).status).toBe(400)
      expect(
        (yield* patch(dir, `/team/profile/${created.profile.id}`, {
          members: [
            { employeeID: third.id },
            { employeeID: third.id },
          ],
        })).status,
      ).toBe(400)
      expect((yield* patch(dir, "/team/profile/prof_missing", { name: "不存在" })).status).toBe(404)
    }),
  )

  it.live("metrics aggregate the recent runs and say what they cannot compute", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped({ git: true })
      const other = yield* tmpdirScoped({ git: true })
      type Metrics = {
        window: { runs: number; eventsCovered: number; from?: number; to?: number }
        states: Array<{ state: string; runs: number }>
        tokens: { settled: number; unknown: number; covered: number; overrunRuns: number }
        rounds: Array<{ round: number; runs: number }>
        rework: { total: number; top: Array<{ reason: string; count: number }> }
        attempts: { dispatched: number; failed: number; failureRate?: number }
        blockers: { runs: number; rate?: number; byKind: Array<{ kind: string; count: number }> }
        unavailable: Array<{ metric: string; reason: string }>
      }

      const profiles = (yield* (yield* get(dir, "/team/profile", dir)).json) as Array<{ id: string }>
      const profile = profiles[0]
      // 两次运行：一次团体、一次带计划里同一个团队 —— 指标按目录取样。
      const first = (yield* (
        yield* post(dir, "/run", {
          sessionID: "ses_metrics_a",
          directory: dir,
          mode: "team",
          goal: "第一次",
          profileID: profile.id,
          acceptance: [{ text: "没有高危问题" }],
        })
      ).json) as { run: { id: string } }
      yield* post(dir, "/run", {
        sessionID: "ses_metrics_b",
        directory: dir,
        mode: "team",
        goal: "第二次",
        profileID: profile.id,
        acceptance: [{ text: "没有高危问题" }],
      })

      const response = yield* get(dir, "/run/metrics", dir)
      // `/run/metrics` 是字面路径，不能被 `/run/:runID` 抢走当成一次运行的详情。
      expect(response.status).toBe(200)
      const metrics = (yield* response.json) as Metrics
      expect(metrics.window.runs).toBe(2)
      // 还没执行 ⇒ 没有派发事件 ⇒ 不给失败率，而不是 0%。
      expect(metrics.attempts.failureRate).toBeUndefined()
      expect(metrics.states).toEqual([{ state: "awaiting_approval", runs: 2 }])
      expect(metrics.tokens.covered).toBe(0)
      // 算不出来的指标要说出来，不编数字。
      expect(metrics.unavailable.map((item) => item.metric)).toContain("验证开销占比")

      // 取样窗口可以被请求收窄，且不会跨目录混进来。
      const one = (yield* (yield* get(dir, "/run/metrics?limit=1", dir)).json) as Metrics
      expect(one.window.runs).toBe(1)
      const elsewhere = (yield* (yield* get(other, "/run/metrics", other)).json) as Metrics
      expect(elsewhere.window.runs).toBe(0)

      // 按团队过滤：同一个目录里用别的模板查，查不到这两次运行。
      const filtered = (yield* (
        yield* get(dir, `/run/metrics?teamID=${profile.id}`, dir)
      ).json) as Metrics
      expect(filtered.window.runs).toBe(2)
      const missing = (yield* (yield* get(dir, "/run/metrics?teamID=prof_missing", dir)).json) as Metrics
      expect(missing.window.runs).toBe(0)
      expect(first.run.id).toBeTruthy()
    }),
  )

  it.live("replay explains the decision chain and keeps unverified out of pass", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped({ git: true })
      type Replay = {
        source: string
        steps: Array<{ seq: number; kind: string; teamID?: string; acceptanceID?: string; outcome?: string }>
        conclusion: {
          state: string
          verdict: string
          deliverable: boolean
          lines: Array<{ acceptanceID: string; outcome: string }>
          counts: { pass: number; fail: number; unverified: number; stale: number }
          evidence: string
          notes: string[]
        }
      }

      const profiles = (yield* (yield* get(dir, "/team/profile", dir)).json) as Array<{ id: string }>
      const created = (yield* (
        yield* post(dir, "/run", {
          sessionID: "ses_replay",
          directory: dir,
          mode: "team",
          goal: "审查",
          profileID: profiles[0].id,
          acceptance: [{ text: "没有高危问题" }],
        })
      ).json) as { run: { id: string } }
      const runID = created.run.id

      // 刚建好的运行：事件有（plan.created 等），但还没有任何验证结论。
      const initial = (yield* (yield* get(dir, `/run/${runID}/replay`, dir)).json) as Replay
      expect(initial.source).toBe("events")
      expect(initial.steps.length).toBeGreaterThan(0)
      // 验收项存在但没有验证记录 → unverified，绝不计入 pass。
      expect(initial.conclusion.counts).toEqual({ pass: 0, fail: 0, unverified: 1, stale: 0 })
      expect(initial.conclusion.deliverable).toBe(false)
      expect(initial.conclusion.lines[0].outcome).toBe("unverified")
      // 事件里没有任何 pass，就不该声称「证据来自验证表」式的错话。
      expect(initial.conclusion.evidence).toBe("complete")

      // 查不到的运行是 404，而不是一条空链。
      expect((yield* get(dir, "/run/run_missing/replay", dir)).status).toBe(404)
    }),
  )

  it.live("the team page can flip one orchestration switch without dropping the other", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped({ git: true })

      // 总控面板分两次写：关开关、再改并发。项目配置是深合并，后一次不能把前一次抹掉。
      expect((yield* patch(dir, "/config", { experimental: { team_orchestration: false } })).status).toBe(200)
      expect((yield* patch(dir, "/config", { experimental: { team_concurrency: 2 } })).status).toBe(200)

      const config = (yield* (yield* get(dir, "/config")).json) as {
        experimental?: { team_orchestration?: boolean; team_concurrency?: number }
      }
      expect(config.experimental?.team_orchestration).toBe(false)
      expect(config.experimental?.team_concurrency).toBe(2)
    }),
  )

  it.live("a new session picks up the project's default team mode, sub-sessions do not", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped({ git: true })
      type SessionInfo = { id: string; parentID?: string; teamMode?: string; teamIDs?: string[] }

      expect((yield* patch(dir, "/config", { experimental: { team_default_mode: "auto" } })).status).toBe(200)

      const created = yield* post(dir, "/session", {})
      expect(created.status).toBe(200)
      // 默认模式只决定「新会话的初始值」：写进库，选择器读它。
      expect((yield* created.json) as SessionInfo).toMatchObject({ teamMode: "auto" })

      // 显式选择永远优先，包括「不选」。
      const explicit = yield* post(dir, "/session", { teamMode: "off" })
      expect((yield* explicit.json) as SessionInfo).toMatchObject({ teamMode: "off" })

      // 子会话不继承：团队内派生会话、子代理能不能派发由父会话的编排决定。
      const parent = (yield* created.json) as SessionInfo
      const child = yield* post(dir, "/session", { parentID: parent.id })
      expect((yield* child.json) as SessionInfo).toMatchObject({ parentID: parent.id })
      expect(((yield* child.json) as SessionInfo).teamMode).toBeUndefined()

      // 指定团队：配置里的名单直接写进会话，选择器与内核读到同一份。
      expect(
        (yield* patch(dir, "/config", { experimental: { team_default_mode: "selected", team_default_ids: ["t1"] } }))
          .status,
      ).toBe(200)
      expect((yield* (yield* post(dir, "/session", {})).json) as SessionInfo).toMatchObject({
        teamMode: "selected",
        teamIDs: ["t1"],
      })

      // 总控关闭后默认值失效：写一个 auto 进库只会让界面显示「Auto」却什么也不注入。
      expect((yield* patch(dir, "/config", { experimental: { team_orchestration: false } })).status).toBe(200)
      expect(((yield* (yield* post(dir, "/session", {})).json) as SessionInfo).teamMode).toBeUndefined()
    }),
  )

  it.live("the run list can be narrowed to one team's runs", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped({ git: true })
      const profiles = (yield* (yield* get(dir, "/team/profile", dir)).json) as Array<{ id: string }>
      const profile = profiles[0]
      expect(profile).toBeTruthy()

      const created = yield* post(dir, "/run", {
        sessionID: "ses_list",
        directory: dir,
        mode: "team",
        goal: "按团队筛运行",
        profileID: profile.id,
        acceptance: [{ text: "能列出这次运行" }],
      })
      expect(created.status).toBe(200)
      const runID = ((yield* created.json) as { run: { id: string } }).run.id

      const mine = (yield* (yield* get(dir, `/run?teamID=${profile.id}`, dir)).json) as Array<{ id: string }>
      expect(mine.map((run) => run.id)).toContain(runID)

      // 别的团队查不到它：过滤按计划里的团队算，不是在结果里做模糊匹配。
      const other = (yield* (yield* get(dir, "/run?teamID=team_elsewhere", dir)).json) as Array<{ id: string }>
      expect(other.map((run) => run.id)).not.toContain(runID)

      // 同目录不传 teamID 仍然看得到全部。
      const all = (yield* (yield* get(dir, "/run", dir)).json) as Array<{ id: string }>
      expect(all.map((run) => run.id)).toContain(runID)
    }),
  )

  it.live("only an abandoned mission can give its workspace back", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped({ git: true })
      const created = yield* post(dir, "/team/mission", { directory: dir, goal: "要放弃的目标" })
      const mission = (yield* created.json) as { id: string }

      // 跑一次让目标工作区建起来：没有工作区时清理没什么可做。
      const run = yield* post(dir, "/run", {
        sessionID: "ses_cleanup",
        directory: dir,
        mode: "team",
        goal: "一次运行",
        missionID: mission.id,
      })
      expect(run.status).toBe(200)
      const runID = ((yield* run.json) as { run: { id: string } }).run.id
      const prepared = (yield* (yield* get(dir, `/team/mission/${mission.id}`)).json) as { worktree?: string }
      expect(prepared.worktree).toBeTruthy()

      // 活跃目标不能清：下一次运行还要从这份工作区接着做。
      const active = (yield* (yield* del(dir, `/team/mission/${mission.id}/worktree`)).json) as {
        removed: boolean
        reason?: string
      }
      expect(active.removed).toBe(false)
      expect(active.reason).toContain("已放弃")

      // 结束运行并放弃目标之后才轮得到清理。
      expect((yield* post(dir, `/run/${runID}/cancel`)).status).toBe(200)
      yield* patch(dir, `/team/mission/${mission.id}`, { status: "abandoned" })
      const removed = (yield* (yield* del(dir, `/team/mission/${mission.id}/worktree`)).json) as {
        removed: boolean
      }
      expect(removed.removed).toBe(true)
      const after = (yield* (yield* get(dir, `/team/mission/${mission.id}`)).json) as { worktree?: string | null }
      // 记录跟着目录一起消失：界面上不能再显示一个不存在的路径。
      expect(after.worktree).toBeFalsy()

      // 别的目录里连清理也看不到。
      const other = yield* tmpdirScoped({ git: true })
      expect((yield* del(other, `/team/mission/${mission.id}/worktree`)).status).toBe(404)
    }),
  )

  it.live("per-person usage counts only attributed sessions and cannot be written by the client", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped({ git: true })
      const created = yield* post(dir, "/team/employee", { directory: dir, name: "小林", job: "review" })
      const employee = (yield* created.json) as { id: string }

      type Usage = {
        totals: { tokens: number; cost: number; sessions: number }
        runs: Array<{ runID: string; tokens: number; cost: number; sessions: number; lastAt: number }>
        unattributed: { tokens: number; cost: number; sessions: number }
        outsideRuns: { tokens: number; cost: number; sessions: number }
        lastUsedAt?: number
      }

      const before = (yield* (yield* get(dir, `/team/employee/${employee.id}/usage`, dir)).json) as Usage
      // 没有用量是「确认为 0」，不是缺字段；未归属也明说为 0。
      expect(before).toMatchObject({
        totals: { tokens: 0, cost: 0, sessions: 0 },
        runs: [],
        unattributed: { tokens: 0, cost: 0, sessions: 0 },
        outsideRuns: { tokens: 0, cost: 0, sessions: 0 },
      })

      // 归属不是客户端可写的字段：建会话时带上也会被丢掉。
      const sessionInfo = (body: Record<string, unknown> = {}) =>
        Effect.gen(function* () {
          const response = yield* post(dir, "/session", body)
          return (yield* response.json) as { id: string; employeeID?: string; runID?: string }
        })
      const spoofed = yield* sessionInfo({ employeeID: employee.id, runID: "run_fake" })
      expect(spoofed.employeeID).toBeUndefined()
      expect(spoofed.runID).toBeUndefined()

      // 模拟派发路径写入的归属会话：两条记在小林名下（含她派生的子代理），
      // 一条是同运行的验证（未归属），还有一条属于别的运行。
      const mine = yield* sessionInfo()
      const helper = yield* sessionInfo()
      const verify = yield* sessionInfo()
      const elsewhere = yield* sessionInfo()
      const set = (
        id: string,
        values: { employee_id?: string; run_id?: string; tokens_input?: number; tokens_output?: number; cost?: number },
      ) => Database.use((db) => db.update(SessionTable).set(values).where(eq(SessionTable.id, SessionID.make(id))).run())
      set(mine.id, { employee_id: employee.id, run_id: "run_1", tokens_input: 100, tokens_output: 20, cost: 0.5 })
      set(helper.id, { employee_id: employee.id, run_id: "run_1", tokens_input: 30, cost: 0.25 })
      set(verify.id, { run_id: "run_1", tokens_input: 10 })
      set(elsewhere.id, { run_id: "run_2", tokens_input: 999 })

      const usage = (yield* (yield* get(dir, `/team/employee/${employee.id}/usage`, dir)).json) as Usage
      expect(usage.totals).toEqual({ tokens: 150, cost: 0.75, sessions: 2 })
      expect(usage.runs).toHaveLength(1)
      expect(usage.runs[0]).toMatchObject({ runID: "run_1", tokens: 150, cost: 0.75, sessions: 2 })
      // 同一次运行里没人认领的会话单列；别的运行的未归属不混进来。
      expect(usage.unattributed).toEqual({ tokens: 10, cost: 0, sessions: 1 })
      expect(usage.outsideRuns).toEqual({ tokens: 0, cost: 0, sessions: 0 })
      expect(typeof usage.lastUsedAt).toBe("number")

      // 员工是全局身份，别的目录里读到的也是同一个人、同一份用量 ——
      // 归属跟着人走，不因为从哪个工作区发起请求而改变。
      const other = yield* tmpdirScoped({ git: true })
      const elsewhereUsage = (yield* (yield* get(other, `/team/employee/${employee.id}/usage`, other)).json) as Usage
      expect(elsewhereUsage.totals).toEqual({ tokens: 150, cost: 0.75, sessions: 2 })

      expect((yield* get(dir, "/team/employee/emp_missing/usage", dir)).status).toBe(404)
    }),
  )
})
