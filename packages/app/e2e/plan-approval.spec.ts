import { expect, test } from "@playwright/test"
import { resolve } from "node:path"

const directory = resolve(process.cwd(), "..", "..")
const backend = () => `http://127.0.0.1:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`
const workspaceSlug = () =>
  Buffer.from(directory, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")

function fixtureMessages(sessionID: string, requestID: string) {
  const created = Date.now()
  const userID = `msg-user-${created}`
  const assistantID = `msg-assistant-${created}`
  const partID = `part-plan-${created}`
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
          text: "请先制定实施计划",
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
        mode: "plan",
        agent: "creova",
        path: { cwd: directory, root: directory },
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      },
      parts: [
        {
          id: partID,
          sessionID,
          messageID: assistantID,
          type: "tool",
          callID: `call-${created}`,
          tool: "plan_exit",
          state: {
            status: "running",
            input: {},
            title: "等待计划审批",
            metadata: {
              approvalState: "pending",
              requestID,
              plan: ".novaway/plans/e2e.md",
              planText: "# E2E 计划\n\n1. 调查现状\n2. 实施修改\n3. 验证结果",
            },
            time: { start: created },
          },
        },
      ],
    },
  ]
}

async function openApproval(page: import("@playwright/test").Page, requestID: string) {
  const created = await page.request.post(`${backend()}/session`, {
    headers: { "x-novaway-directory": directory },
    data: { title: "Plan approval browser fixture", permissionMode: "plan" },
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
      body: JSON.stringify(fixtureMessages(sessionID, requestID)),
    })
  })

  await page.goto(`/${workspaceSlug()}/session/${sessionID}`)
  const card = page.locator('[data-component="plan-approval-card"]')
  await expect(card).toBeVisible({ timeout: 20_000 })
  await expect(card).toContainText(".novaway/plans/e2e.md")
  return { card, sessionID }
}

test("计划审批：批准并开始执行恢复普通权限挡位", async ({ page }) => {
  const requestID = `plan-e2e-standard-${Date.now()}`
  const calls: unknown[] = []
  await page.route("**/plan-approval/**", async (route) => {
    calls.push(route.request().postDataJSON())
    await route.fulfill({ status: 200, contentType: "application/json", body: "true" })
  })

  const { card } = await openApproval(page, requestID)
  await card.getByRole("button", { name: /批准并开始执行|Approve and start execution/ }).click()
  await expect(card).toHaveAttribute("data-state", "approved")
  await expect(card.locator('[data-slot="plan-approval-card-preview"]')).toHaveCount(0)
  await expect(card.getByRole("button", { name: /审阅计划文件|Review plan file/ })).toBeVisible()
  await expect.poll(() => calls.length).toBe(1)
  expect(calls).toEqual([{ approved: true, execution: "standard" }])
})

test("计划审批：审阅计划文件打开右侧文件面板", async ({ page }) => {
  const requestID = `plan-e2e-review-${Date.now()}`
  const { card } = await openApproval(page, requestID)

  await card.getByRole("button", { name: /审阅计划文件|Review plan file/ }).click()

  await expect(page.locator('[data-component="side-pane-frame"]')).toHaveAttribute("data-open", "true")
  await expect(page.locator('[data-component="side-pane-file-tab"]').filter({ hasText: "e2e.md" })).toBeVisible()
})

test("计划审批：普通目标使用 goal 执行参数", async ({ page }) => {
  const requestID = `plan-e2e-goal-${Date.now()}`
  const calls: unknown[] = []
  await page.route("**/plan-approval/**", async (route) => {
    calls.push(route.request().postDataJSON())
    await route.fulfill({ status: 200, contentType: "application/json", body: "true" })
  })

  const { card } = await openApproval(page, requestID)
  await card.getByRole("button", { name: /批准并以目标驱动执行|Approve and run with goal-driven execution/ }).click()
  await expect(card).toHaveAttribute("data-state", "approved")
  await expect.poll(() => calls.length).toBe(1)
  expect(calls).toEqual([{ approved: true, execution: "goal" }])
})

test("计划审批：长期任务使用 long_task 执行参数", async ({ page }) => {
  const requestID = `plan-e2e-long-task-${Date.now()}`
  const calls: unknown[] = []
  await page.route("**/plan-approval/**", async (route) => {
    calls.push(route.request().postDataJSON())
    await route.fulfill({ status: 200, contentType: "application/json", body: "true" })
  })

  const { card } = await openApproval(page, requestID)
  await card.getByRole("button", { name: /批准并启动长期任务|Approve and start a long-running task/ }).click()
  await expect(card).toHaveAttribute("data-state", "approved")
  await expect.poll(() => calls.length).toBe(1)
  expect(calls).toEqual([{ approved: true, execution: "long_task" }])
})

test("计划审批：继续完善计划先填写调整意见再提交", async ({ page }) => {
  const requestID = `plan-e2e-continue-${Date.now()}`
  const calls: unknown[] = []
  await page.route("**/plan-approval/**", async (route) => {
    calls.push(route.request().postDataJSON())
    await route.fulfill({ status: 200, contentType: "application/json", body: "true" })
  })

  const { card } = await openApproval(page, requestID)
  await card.getByRole("button", { name: /继续完善计划|Continue planning/ }).click()
  const feedback = card.locator("textarea")
  await expect(feedback).toBeVisible()
  await feedback.fill("请补充第二阶段的验收标准")
  await card.getByRole("button", { name: /确认并继续完善|Confirm and continue planning/ }).click()
  await expect(card).toHaveAttribute("data-state", "continue")
  await expect(card.locator('[data-slot="plan-approval-card-preview"]')).toHaveCount(0)
  await expect(card.getByRole("button", { name: /审阅计划文件|Review plan file/ })).toBeVisible()
  await expect.poll(() => calls.length).toBe(1)
  expect(calls).toEqual([{ approved: false, feedback: "请补充第二阶段的验收标准" }])
})
