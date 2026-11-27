import { expect, test } from "@playwright/test"
import { resolve } from "node:path"

const directory = resolve(process.cwd(), "..", "..")
const backend = () => `http://127.0.0.1:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`
const workspaceSlug = () =>
  Buffer.from(directory, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")

type ToolFixture = {
  runID: string
  state: string
  readOnly: boolean
  input?: Record<string, unknown>
  output?: string
}

function fixtureMessages(sessionID: string, fixture: ToolFixture) {
  const created = Date.now()
  const userID = `msg-user-team-run-${created}`
  const assistantID = `msg-assistant-team-run-${created}`
  return [
    {
      info: {
        id: userID,
        sessionID,
        role: "user",
        time: { created },
        agent: "creova",
        model: { providerID: "fixture", modelID: "fixture" },
      },
      parts: [
        {
          id: `part-text-${created}`,
          sessionID,
          messageID: userID,
          type: "text",
          text: "请检查当前实现",
        },
      ],
    },
    {
      info: {
        id: assistantID,
        sessionID,
        role: "assistant",
        time: { created },
        parentID: userID,
        modelID: "fixture",
        providerID: "fixture",
        agent: "creova",
        path: { cwd: directory, root: directory },
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      },
      parts: [
        {
          id: `part-team-run-${created}`,
          sessionID,
          messageID: assistantID,
          type: "tool",
          callID: `call-team-run-${created}`,
          tool: "team_run",
          state: {
            status: fixture.state === "running" ? "running" : "completed",
            input: fixture.input ?? { team: "代码审查团", goal: "检查当前实现" },
            output: fixture.output ?? "协作运行结果",
            metadata: { runID: fixture.runID, state: fixture.state, readOnly: fixture.readOnly },
            time: { start: created, end: created + 100 },
          },
        },
      ],
    },
  ]
}

async function openTeamRun(page: import("@playwright/test").Page, fixture: ToolFixture, triggerTimeout = 20_000) {
  const created = await page.request.post(`${backend()}/session`, {
    headers: { "x-novaway-directory": directory },
    data: { title: `Team run fixture ${fixture.runID}` },
  })
  expect(created.status()).toBe(200)
  const body = await created.json()
  const sessionID = body.id ?? body.data?.id
  expect(typeof sessionID).toBe("string")

  await page.route(`**/session/${sessionID}/message**`, async (route) => {
    if (route.request().method() !== "GET") return route.continue()
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(fixtureMessages(sessionID, fixture)),
    })
  })

  await page.goto(`/${workspaceSlug()}/session/${sessionID}`)
  await expect(page.locator('[data-component="tool-trigger"]')).toBeVisible({ timeout: triggerTimeout })
  return sessionID
}

function detail(fixture: ToolFixture) {
  return {
    run: {
      id: fixture.runID,
      state: fixture.state,
      phase: fixture.state === "done" ? "delivered" : "executing",
      goal: "检查当前实现",
      readOnly: fixture.readOnly,
    },
    teams: [{ id: `${fixture.runID}-team`, profileID: "profile-review", phase: "executing", members: [] }],
    assignments: [{ status: "running", objective: "检查当前实现", employeeID: "reviewer" }],
  }
}

test("聊天内 team_run：默认只显示子代理摘要，名册和原始报告保持折叠", async ({ page }) => {
  const fixture: ToolFixture = {
    runID: `run-collapsed-${Date.now()}`,
    state: "done",
    readOnly: true,
  }
  await page.route(`**/run/${fixture.runID}*`, async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(detail(fixture)) })
  })

  await openTeamRun(page, fixture)
  const trigger = page.locator('[data-component="tool-trigger"]')
  await expect(page.locator('[data-component="team-run-tool"]')).toHaveCount(0)
  await trigger.click()
  const tool = page.locator('[data-component="team-run-tool"]')
  await expect(tool).toContainText(/只读|read-only/)
  await expect(tool).toContainText(/自动批准|auto-approved/)
  await expect(tool.locator('[data-slot="team-run-roster"]')).toHaveCount(0)
  await expect(tool.locator('[data-component="tool-output"]')).toHaveCount(0)
  await tool.locator('[data-action="team-run-toggle-roster"]').click()
  await expect(tool.locator('[data-slot="team-run-roster"]')).toBeVisible()
})

test("聊天内 team_run：写入运行显示等待用户确认", async ({ page }) => {
  const fixture: ToolFixture = {
    runID: `run-approval-${Date.now()}`,
    state: "awaiting_approval",
    readOnly: false,
    input: { team: "代码修改团", goal: "修复重试逻辑", allowWrites: true },
  }
  await page.route(`**/run/${fixture.runID}*`, async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(detail(fixture)) })
  })

  await openTeamRun(page, fixture)
  await page.locator('[data-component="tool-trigger"]').click()
  const tool = page.locator('[data-component="team-run-tool"]')
  await expect(tool).toContainText(/等待确认|waiting for approval/)
  await expect(tool).toContainText(/写入受保护|writes guarded/)
  await expect(tool).toContainText(/等待你的确认|waiting for your approval/)
  await expect(tool.locator('[data-slot="team-run-approval"]')).toHaveAttribute("data-approval", "attention")
})

test("聊天内 team_run：运行轮询会把进行中更新为完成", async ({ page }) => {
  const fixture: ToolFixture = {
    runID: `run-poll-${Date.now()}`,
    state: "running",
    readOnly: true,
  }
  let calls = 0
  await page.route(`**/run/${fixture.runID}*`, async (route) => {
    calls += 1
    const current = calls === 1 ? fixture : { ...fixture, state: "done" }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(detail(current)),
    })
  })

  await openTeamRun(page, fixture)
  await expect(page.locator('[data-slot="basic-tool-tool-status"]')).toContainText(/执行中|running/, { timeout: 5_000 })
  await expect(page.locator('[data-slot="basic-tool-tool-status"]')).toContainText(/已完成|completed/, {
    timeout: 8_000,
  })
  expect(calls).toBeGreaterThanOrEqual(2)
})

test("聊天内 team_run：失败与部分完成状态不会降级成成功", async ({ page }) => {
  test.setTimeout(150_000)
  for (const state of ["partial", "failed"] as const) {
    const fixture: ToolFixture = {
      runID: `run-${state}-${Date.now()}`,
      state,
      readOnly: true,
    }
    await page.route(`**/run/${fixture.runID}*`, async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(detail(fixture)) })
    })

    await openTeamRun(page, fixture, 55_000)
    await page.locator('[data-component="tool-trigger"]').click()
    const tool = page.locator('[data-component="team-run-tool"]')
    await expect(tool.locator('[data-slot="team-run-state"]')).toHaveAttribute("data-state", state)
    await expect(tool).toContainText(state === "partial" ? /部分完成|partially completed/ : /执行失败|failed/)
  }
})
