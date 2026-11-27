import { expect, test } from "@playwright/test"
import { resolve } from "node:path"

function workspaceRootSlug() {
  return Buffer.from(resolve(process.cwd(), "..", ".."), "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")
}

test.describe("专家中心", () => {
  test("手动发起先创建普通对话，不由前端猜测协作模式", async ({ page }) => {
    const sessionID = "session-manual-launch"
    let createBody: Record<string, unknown> | undefined
    await page.route("**/*", async (route) => {
      const request = route.request()
      const url = new URL(request.url())
      const json = (value: unknown) =>
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(value) })
      if (url.pathname === "/team/profile") return json([])
      if (url.pathname === "/team" && request.method() === "GET") return json([])
      if (url.pathname === "/kernel/capabilities")
        return json({ features: [{ id: "team_orchestration", enabled: true }] })
      if (url.pathname === "/run" && request.method() === "GET") return json([])
      if (url.pathname === "/session" && request.method() === "POST") {
        createBody = JSON.parse(request.postData() ?? "{}") as Record<string, unknown>
        return json({ id: sessionID })
      }
      return route.continue()
    })

    await page.goto(`/${workspaceRootSlug()}/session`, { waitUntil: "commit", timeout: 60_000 })
    const sidebar = page.locator('[data-component="sidebar-nav-desktop"]')
    await expect(sidebar).toBeVisible({ timeout: 60_000 })
    await sidebar.getByRole("button", { name: /Teams|团队/ }).click()
    await expect(page.getByText(/Expert center|专家中心/)).toBeVisible({ timeout: 15_000 })

    const create = page.waitForRequest(
      (request) => new URL(request.url()).pathname === "/session" && request.method() === "POST",
    )
    await page.locator('[data-action="workbench-manual-launch"]').click()
    await create
    await expect.poll(() => createBody).toBeTruthy()
    expect(createBody?.title).toBeTruthy()
    expect(createBody?.teamMode).toBeUndefined()
    expect(createBody?.teamIDs).toBeUndefined()
  })

  test("空运行中心明确引导用户回到主助手，而不是要求先建团队", async ({ page }) => {
    await page.route("**/*", async (route) => {
      const request = route.request()
      const url = new URL(request.url())
      const json = (value: unknown) =>
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(value) })
      if (url.pathname === "/team/profile") return json([])
      if (url.pathname === "/team" && request.method() === "GET") return json([])
      if (url.pathname === "/kernel/capabilities")
        return json({ features: [{ id: "team_orchestration", enabled: true }] })
      if (url.pathname === "/run" && request.method() === "GET") return json([])
      return route.continue()
    })

    await page.goto(`/${workspaceRootSlug()}/session`, { waitUntil: "commit", timeout: 60_000 })
    const sidebar = page.locator('[data-component="sidebar-nav-desktop"]')
    await expect(sidebar).toBeVisible({ timeout: 60_000 })
    await sidebar.getByRole("button", { name: /Teams|团队/ }).click()
    await expect(page.getByText(/Expert center|专家中心/)).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole("region", { name: /Teams|团队/ }).getByRole("main")).toContainText(
      /直接描述目标即可|Describe the goal directly/,
    )
    await expect(page.locator('[data-action="workbench-manual-launch"]')).toHaveCount(1)
  })

  test("专家中心：常见视口保持可用，并可直接创建专家供团队模板选择", async ({ page }) => {
    test.setTimeout(120_000)
    const employees: Array<Record<string, unknown>> = []
    const teams: Array<Record<string, unknown>> = []
    await page.route("**/*", async (route) => {
      const request = route.request()
      const url = new URL(request.url())
      const json = (value: unknown) =>
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(value) })
      if (url.pathname === "/team/profile" && request.method() === "POST") {
        const payload = request.postDataJSON()
        const profile = {
          id: "profile-growth",
          name: payload.name,
          captainMember: payload.captain,
          memberCount: payload.members.length,
          memberPreview: [{ name: employees[0]?.name, role: "captain" }],
          capabilities: [],
          autoEligible: false,
          version: 1,
          updatedAt: 0,
        }
        teams.push(profile)
        return json(profile)
      }
      if (url.pathname === "/team/profile") return json(teams)
      if (url.pathname === "/expert-center/teams") return json(teams)
      if (url.pathname === "/expert-center/experts")
        return json(
          employees.map((employee) => ({
            id: employee.id,
            name: employee.name,
            capabilities: employee.skills,
            available: !employee.archived,
          })),
        )
      if (url.pathname === "/team" && request.method() === "GET") return json([])
      if (url.pathname === "/team/employee" && request.method() === "GET") return json(employees)
      if (url.pathname === "/team/employee" && request.method() === "POST") {
        const payload = JSON.parse(request.postData() ?? "{}") as Record<string, unknown>
        const employee = {
          id: "employee-growth-planner",
          name: payload.name,
          job: payload.job,
          model: payload.model,
          skills: payload.skills,
          prompt: payload.prompt,
          tier: payload.tier,
          archived: false,
        }
        employees.push(employee)
        return json(employee)
      }
      if (url.pathname === "/kernel/capabilities")
        return json({ features: [{ id: "team_orchestration", enabled: true }] })
      if (url.pathname === "/run" && request.method() === "GET") return json([])
      return route.continue()
    })

    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto(`/${workspaceRootSlug()}/session`, { waitUntil: "commit", timeout: 60_000 })
    const sidebar = page.locator('[data-component="sidebar-nav-desktop"]')
    await expect(sidebar).toBeVisible({ timeout: 60_000 })
    await sidebar.getByRole("button", { name: /Teams|团队/ }).click()
    const region = page.getByRole("region", { name: /Teams|团队/ })
    await expect(region).toBeVisible({ timeout: 15_000 })
    await expect(region.getByRole("main")).toContainText(/直接描述目标即可|Describe the goal directly/)

    // 768px 以下应用外壳会把团队页收进移动侧栏，当前面板本身没有可测宽度；
    // 在实际可见的窄桌面分栏中验证容器查询，避免把外壳过渡态误报成专家中心溢出。
    for (const viewport of [1280, 1440]) {
      await page.setViewportSize({ width: viewport, height: 900 })
      await expect(region).toBeVisible()
      const metrics = await region.evaluate((element) => ({
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
      }))
      expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1)
      await expect(region.locator('[data-action="workbench-open-executors"]')).toHaveCount(1)
    }

    await region.locator('[data-action="workbench-open-executors"]').click()
    await expect(page.getByText(/Experts and expert teams|专家与专家团/).first()).toBeVisible({ timeout: 15_000 })
    const directory = region.locator('[data-component="expert-directory"]')
    for (const viewport of [1280, 1440]) {
      await page.setViewportSize({ width: viewport, height: 900 })
      await expect.poll(() => directory.evaluate((node) => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(1)
    }
    await page.locator('[data-action="expert-directory-manage"]').click()
    await expect(page.locator('[data-component="executor-management"]')).toBeVisible()
    await expect(page.locator('[data-action="executor-management-teams"]')).toBeVisible()
    await expect(page.locator('[data-action="executor-management-experts"]')).toBeVisible()
    await expect(page.locator('[data-action="executor-management-profiles"]')).toBeVisible()
    await page.getByRole("button", { name: /Experts and expert teams|专家与专家团/ }).click()
    await expect(page.locator('[data-action="expert-directory-add-expert"]')).toBeVisible()
    await page.locator('[data-action="expert-directory-add-expert"]').click()
    const employeeDialog = page.getByRole("dialog", { name: /Add expert|添加专家/ })
    await expect(employeeDialog).toBeVisible()
    const employeeName = employeeDialog.getByRole("textbox", { name: /Employee name|员工名称/ })
    await expect(employeeName).toBeFocused()
    await employeeName.fill("增长策划")
    await employeeDialog.getByPlaceholder(/技能覆盖|Skill overrides/i).fill("用户洞察, SEO")
    await employeeDialog.getByPlaceholder(/职责补充|Extra duty/i).fill("负责增长方案和复盘")
    await employeeDialog.getByRole("combobox", { name: /Execution tier|执行档位/ }).selectOption("standard")
    const createEmployee = page.waitForRequest(
      (request) => new URL(request.url()).pathname === "/team/employee" && request.method() === "POST",
    )
    await employeeName.press("Enter")
    const employeeRequest = await createEmployee
    const employeeBody = JSON.parse(employeeRequest.postData() ?? "{}") as Record<string, unknown>
    expect(employeeBody.name).toBe("增长策划")
    expect(employeeBody.skills).toEqual(["用户洞察", "SEO"])
    expect(employeeBody.prompt).toBe("负责增长方案和复盘")
    expect(employeeBody.tier).toBe("standard")
    await expect(employeeDialog).toBeHidden()
    await expect(page.locator('[data-executor-kind="expert"]').filter({ hasText: "增长策划" })).toBeVisible()

    await page.locator('[data-action="expert-directory-create-team"]').click()
    const profileDialog = page.getByRole("dialog", { name: /Create expert team|创建专家团/ })
    const teamName = profileDialog.getByRole("textbox", { name: /Name|模板名称/, exact: true })
    await expect(teamName).toBeFocused()
    await teamName.fill("增长研究团")
    await profileDialog.getByRole("checkbox", { name: "增长策划" }).check()
    await profileDialog.getByRole("combobox", { name: /Captain|队长/ }).selectOption("employee-growth-planner")
    const createTeam = page.waitForRequest(
      (request) => new URL(request.url()).pathname === "/team/profile" && request.method() === "POST",
    )
    await profileDialog.getByRole("button", { name: /Create template|创建模板/ }).click()
    expect((await createTeam).postDataJSON()).toMatchObject({
      name: "增长研究团",
      captain: "employee-growth-planner",
      members: [{ employeeID: "employee-growth-planner" }],
    })
    await expect(profileDialog).toBeHidden()
    await expect(page.locator('[data-executor-kind="team"]').filter({ hasText: "增长研究团" })).toBeVisible()
  })
})
