import { NodeHttpServer, NodeServices } from "@effect/platform-node"
import { Flag } from "@novaway/core/flag/flag"
import { describe, expect } from "bun:test"
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
  { disableListenLog: true, disableLogger: true },
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
})
