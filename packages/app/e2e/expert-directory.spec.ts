import { expect, test } from "@playwright/test"

test("目录可在局部加载失败后恢复，并保留搜索和归档规则", async ({ page }) => {
  test.setTimeout(120_000)
  const teamName = "Studio Delivery"
  const expertName = "Morgan"
  let failExperts = true
  await page.addInitScript((directory) => {
    localStorage.setItem(
      `novaway.expert-center.recent:${directory}`,
      JSON.stringify([{ kind: "experts", id: "archived" }]),
    )
  }, "/expert-directory-fixture")
  await page.route("**/expert-center/teams**", (route) =>
    route.fulfill({
      json: [
        { id: "delivery", name: teamName, capabilities: [], memberCount: 1, memberPreview: [], autoEligible: true },
      ],
    }),
  )
  await page.route("**/expert-center/experts**", (route) =>
    failExperts
      ? route.fulfill({ status: 503, json: {} })
      : route.fulfill({
          json: [{ id: "archived", name: expertName, capabilities: ["Newsletter"], available: false }],
        }),
  )
  await page.route(/\/session(?:\?|$)/, (route) =>
    route.request().method() === "POST" ? route.fulfill({ status: 400, json: {} }) : route.continue(),
  )
  await page.goto("/e2e/fixtures/expert-directory.html")
  const teamCard = page.locator('[data-executor-kind="team"]').filter({ hasText: teamName })
  const expertCard = page.locator('[data-executor-kind="expert"]').filter({ hasText: expertName })
  await expect(page.getByRole("alert").filter({ hasText: /Could not load|加载失败/ })).toBeVisible()
  await expect(teamCard).toBeVisible()

  failExperts = false
  await page.getByRole("button", { name: /Retry loading|重新加载/ }).click()
  await expect(expertCard).toBeVisible()
  await expect(page.getByRole("alert").filter({ hasText: /Could not load|加载失败/ })).toHaveCount(0)
  await expect(page.getByRole("heading", { name: /Recently used|最近使用/ })).toHaveCount(0)
  await expect(expertCard.getByRole("button", { name: /Invoke|召唤/ })).toBeDisabled()

  const search = page.getByRole("textbox", { name: /Search by name or skill|按名称或能力搜索/ })
  await search.fill("Delivery handbook")
  await expect(teamCard).toHaveCount(1)
  await expect(expertCard).toHaveCount(0)
  await search.fill("Newsletter")
  await expect(expertCard).toBeVisible()
  await search.fill("unmatchedxyz")
  await page.getByRole("button", { name: /Clear filters|清除筛选/ }).click()
  await expect(search).toHaveValue("")

  await teamCard.getByText(teamName, { exact: true }).click()
  await page
    .getByRole("complementary")
    .getByRole("button", { name: /Invoke|召唤/ })
    .click()
  await expect(page.getByRole("complementary").getByRole("alert")).toHaveText(
    /Unable to create the task conversation|无法创建任务对话/,
  )
})

test("调用单个专家只发送一次创建请求，失败后可以重试", async ({ page }) => {
  const expert = { id: "employee-review", name: "Review specialist", capabilities: [], available: true }
  const requests: { method: string; body: unknown }[] = []
  await page.route("**/expert-center/teams**", (route) => route.fulfill({ json: [] }))
  await page.route("**/expert-center/experts**", (route) => route.fulfill({ json: [expert] }))
  await page.route(/\/session(?:\/|\?|$)/, (route) => {
    if (route.request().method() !== "POST") return route.continue()
    requests.push({ method: "POST", body: route.request().postDataJSON() })
    if (requests.length === 1) return route.fulfill({ status: 400, json: {} })
    return route.fulfill({ json: { id: "ses_expert", employeeID: expert.id, teamMode: "selected", teamIDs: [] } })
  })
  await page.goto("/e2e/fixtures/expert-directory.html")
  const invoke = page
    .locator('[data-executor-kind="expert"]')
    .filter({ hasText: expert.name })
    .getByRole("button", { name: /Invoke|召唤/ })
  await invoke.click()
  expect(requests).toHaveLength(1)
  const launchError = page
    .getByRole("alert")
    .filter({ hasText: /Unable to create the task conversation|无法创建任务对话/ })
  await expect(launchError).toBeVisible()
  expect(requests).toEqual([{ method: "POST", body: { expertID: expert.id, title: expect.any(String) } }])
  await invoke.click()
  await expect(page.getByRole("heading", { name: /Recently used|最近使用/ })).toBeVisible()
  await expect(launchError).toHaveCount(0)
  expect(requests).toHaveLength(2)
  expect(requests[1]).toEqual(requests[0])
})
