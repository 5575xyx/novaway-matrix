import { expect, test } from "@playwright/test"
import http from "node:http"

test.use({ channel: "chrome", video: "off", trace: "off" })

type Entry = {
  id: string
  target: "memory"
  scope: "global" | "project" | "session"
  domain: string
  content: string
  summary?: string
  tags: string[]
  importance: number
  confidence: number
  version: number
  source: string
  time: { created: number; updated: number }
}

function seedEntries(): Entry[] {
  const now = Date.now()
  const make = (id: string, scope: Entry["scope"], summary: string, ageMin: number): Entry => ({
    id,
    target: "memory",
    scope,
    domain: "general",
    content: `${summary} 的详细内容`,
    summary,
    tags: [],
    importance: 0.8,
    confidence: 0.9,
    version: 1,
    source: "manual",
    time: { created: now - ageMin * 60_000, updated: now - ageMin * 60_000 },
  })
  return [
    make("g1", "global", "偏好简洁回复", 30),
    make("g2", "global", "使用中文交流", 90),
    make("p1", "project", "本项目用 Bun 跑测试", 10),
    make("p2", "project", "提交前跑 typecheck", 40),
    make("p3", "session", "当前会话临时上下文", 5),
  ]
}

const zeroCounts = { all: 0, background: 0, "session-end": 0 }
const reviewStatus = {
  pending: 0,
  applied: 0,
  dismissed: 0,
  total: 0,
  source: { all: 0, explicit: 0, background: 0, compaction: 0, "session-end": 0 },
  sourceByStatus: { pending: zeroCounts, applied: zeroCounts, dismissed: zeroCounts },
}
const evolutionStatus = {
  pending: 1,
  applied: 0,
  dismissed: 0,
  total: 1,
  source: { all: 1, background: 1, "session-end": 0 },
  sourceByStatus: {
    pending: { all: 1, background: 1, "session-end": 0 },
    applied: zeroCounts,
    dismissed: zeroCounts,
  },
}

function startMock() {
  const state = {
    config: {
      memory: { enabled: true, global_enabled: true, project_enabled: true, review_enabled: true, auto_apply: true },
      evolution: { enabled: true },
      dream: {},
      goal: {},
      permission_auto: {},
      skills: {},
      sandbox: {},
      arena: {},
      computer: {},
      channels: {},
      experimental: { computer_control: true },
    } as Record<string, unknown>,
    entries: seedEntries(),
    patches: [] as Array<Record<string, unknown>>,
    deletes: [] as string[],
    jobs: [
      {
        id: "job1",
        type: "learning.memory",
        status: "completed",
        started_at: Date.now() - 60_000,
        output: "candidates: 2",
        metadata: { trigger: "correction", outcome: "candidates", candidateCount: 2 },
      },
      {
        id: "job2",
        type: "learning.evolution",
        status: "error",
        started_at: Date.now() - 120_000,
        error: "Learning failed at memory-inference",
        metadata: { trigger: "interval", stage: "memory-inference" },
      },
    ],
  }
  const sse = new Set<http.ServerResponse>()

  const send = (res: http.ServerResponse, body: unknown, status = 200) => {
    const payload = JSON.stringify(body)
    res.writeHead(status, {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    })
    res.end(payload)
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost")
    const path = url.pathname
    const method = req.method ?? "GET"

    if (method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
        "Access-Control-Allow-Headers": "content-type,x-novaway-directory,authorization",
      })
      res.end()
      return
    }

    if (path === "/global/event") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "Access-Control-Allow-Origin": "*",
      })
      res.write(": connected\n\n")
      sse.add(res)
      const ping = setInterval(() => res.write(": ping\n\n"), 5_000)
      res.on("close", () => {
        clearInterval(ping)
        sse.delete(res)
      })
      return
    }

    if (path === "/global/config" && method === "GET") return send(res, state.config)
    if (path === "/global/config" && method === "PATCH") {
      let raw = ""
      req.on("data", (chunk) => (raw += chunk))
      req.on("end", () => {
        const body = raw ? JSON.parse(raw) : {}
        state.patches.push(body)
        state.config = { ...state.config, ...body }
        send(res, state.config)
      })
      return
    }
    if (path === "/config") return send(res, state.config)
    if (path === "/project") return send(res, [])
    if (path === "/provider") return send(res, { all: [], connected: [], default: {} })
    if (path === "/path") return send(res, { state: "", config: "", worktree: "", directory: "", home: "" })
    if (path === "/global/health") return send(res, { healthy: true, version: "0.0.0-e2e" })

    if (path === "/memory" && method === "GET") return send(res, state.entries)
    if (path.startsWith("/memory/") && method === "DELETE") {
      const id = decodeURIComponent(path.slice("/memory/".length))
      state.deletes.push(id)
      state.entries = state.entries.filter((entry) => entry.id !== id)
      return send(res, { ok: true })
    }
    if (path === "/memory/learning/history") return send(res, state.jobs)
    if (path === "/memory/review/status") return send(res, reviewStatus)
    if (path === "/memory/review/candidate") return send(res, [])
    if (path === "/memory/relations") return send(res, [])
    if (path === "/memory/embedding/status")
      return send(res, { ready: false, cliInstalled: false, daemonRunning: false, hasEmbedModel: false })

    if (path === "/evolution/status") return send(res, evolutionStatus)
    if (path === "/evolution/candidate") return send(res, [])

    return send(res, {})
  })

  return new Promise<{ url: string; state: typeof state; close: () => Promise<void> }>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      const port = typeof address === "object" && address ? address.port : 0
      resolve({
        url: `http://127.0.0.1:${port}`,
        state,
        close: () =>
          new Promise<void>((done) => {
            for (const res of sse) res.destroy()
            server.closeAllConnections()
            server.close(() => done())
          }),
      })
    })
  })
}

test("memory settings simplified layout: toggles persist, cards count/expand/clear, history", async ({
  page,
}, testInfo) => {
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  const mock = await startMock()
  try {
    const dir = "/tmp/demo-project"
    await page.goto(
      `/e2e/fixtures/settings-memory.html?server=${encodeURIComponent(mock.url)}&dir=${encodeURIComponent(dir)}`,
    )

    const root = page.locator('[data-component="memory-settings"]')
    await expect(root).toBeVisible()
    await expect(root).toContainText("记忆行为")
    await expect(root).toContainText("自动技能抽取")
    await expect(root).toContainText("Goal 自主执行")
    await expect(root).toContainText("Arena 多模型竞技")

    // 自动技能抽取 → 配置 PATCH 持久化
    const autoSkill = page.getByRole("switch", { name: "自动技能抽取" })
    await expect(autoSkill).toBeVisible()
    await page
      .locator("[data-row-hover]")
      .filter({ hasText: "自动技能抽取" })
      .first()
      .locator('[data-slot="switch-control"]')
      .click()
    await expect
      .poll(() => mock.state.patches.some((patch) => (patch.evolution as { auto_skill?: boolean })?.auto_skill))
      .toBe(true)

    // 两个范围开关默认开启
    const globalToggle = page.locator('[data-action="toggle-global"] input')
    const projectToggle = page.locator('[data-action="toggle-project"] input')
    await expect(globalToggle).toBeChecked()
    await expect(projectToggle).toBeChecked()

    // 卡片计数：全局 2 条，项目（含会话）3 条
    const globalCard = page.locator('[data-component="memory-card-global"]')
    const projectCard = page.locator('[data-component="memory-card-project"]')
    await expect(globalCard).toContainText("2 个记忆文件")
    await expect(projectCard).toContainText("3 个记忆文件")
    await expect(projectCard).toContainText("demo-project")
    await page.screenshot({ path: testInfo.outputPath("memory-settings.png"), fullPage: true })

    // 关闭全局记忆 → PATCH 写盘 global_enabled=false
    await page.locator('[data-action="toggle-global"] [data-slot="switch-control"]').click()
    await expect.poll(() => mock.state.patches.length).toBeGreaterThan(0)
    const lastPatch = mock.state.patches.at(-1)
    expect(lastPatch?.memory?.global_enabled).toBe(false)
    await expect(globalToggle).not.toBeChecked()

    // 展开全局卡片，列出 2 条
    await page.locator('[data-action="expand-memory-card-global"]').click()
    const globalList = page.locator('[data-slot="memory-card-global-list"]')
    await expect(globalList).toBeVisible()
    await expect(globalList).toContainText("偏好简洁回复")
    await expect(globalList).toContainText("使用中文交流")

    // 清空全局记忆 → 确认弹窗 → 删除两条 → 计数归零
    await page.locator('[data-action="clear-memory-card-global"]').click()
    const confirm = page.getByRole("button", { name: "删除", exact: true })
    await expect(confirm).toBeVisible()
    await confirm.click()
    await expect.poll(() => mock.state.deletes.length).toBe(2)
    await expect(globalCard).toContainText("0 个记忆文件")
    await page.screenshot({ path: testInfo.outputPath("memory-settings-cleared.png"), fullPage: true })

    // 学习运行记录折叠区：展开后显示已完成与失败两条
    await page.locator('[data-action="toggle-history"]').click()
    await expect(page.getByText("学习运行记录", { exact: false }).first()).toBeVisible()
    await expect(page.getByText("失败阶段：memory-inference")).toBeVisible()
    await expect(page.getByText("触发：correction")).toBeVisible()

    // 进化折叠区：待确认候选计数
    await expect(page.locator('[data-action="toggle-evolution"]')).toContainText("1 个待确认候选")

    expect(errors).toEqual([])
  } finally {
    await mock.close()
  }
})
