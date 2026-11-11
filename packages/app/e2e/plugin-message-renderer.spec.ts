import { expect, test } from "@playwright/test"
import { resolve } from "node:path"

const directory = resolve(process.cwd(), "..", "..")
const workspaceSlug = () =>
  Buffer.from(directory, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
const backend = () => `http://127.0.0.1:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`

function fixtureMessages(sessionID: string) {
  const created = Date.now()
  const userID = `msg-user-${created}`
  const assistantID = `msg-assistant-${created}`
  const partID = `part-tool-${created}`
  return [
    {
      info: {
        id: userID,
        sessionID,
        role: "user",
        time: { created },
        agent: "build",
        model: { providerID: "fixture", modelID: "fixture" },
      },
      parts: [
        {
          id: `part-text-${created}`,
          sessionID,
          messageID: userID,
          type: "text",
          text: "Run the renderer fixture",
        },
      ],
    },
    {
      info: {
        id: assistantID,
        sessionID,
        role: "assistant",
        time: { created, completed: created + 1 },
        parentID: userID,
        modelID: "fixture",
        providerID: "fixture",
        mode: "build",
        agent: "build",
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
          tool: "bash",
          state: {
            status: "completed",
            input: { command: "printf renderer-fixture" },
            output: "renderer-fixture",
            title: "renderer fixture",
            metadata: {},
            time: { start: created, end: created + 1 },
          },
        },
      ],
    },
  ]
}

test("active message.part.renderer renders a tool result and disappears when disabled", async ({ page }) => {
  const created = await page.request.post(`${backend()}/session`, {
    headers: { "x-novaway-directory": directory },
    data: { title: "Plugin renderer browser fixture" },
  })
  expect(created.status()).toBe(200)
  const createdBody = await created.json()
  const sessionID = createdBody.id ?? createdBody.data?.id
  expect(typeof sessionID).toBe("string")

  await page.route(`**/session/${sessionID}/message**`, async (route) => {
    if (route.request().method() !== "GET") return route.continue()
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(fixtureMessages(sessionID)),
    })
  })

  await page.goto(`/${workspaceSlug()}/session/${sessionID}`)
  const renderer = page.locator('[data-slot="plugin-message-part-renderer"]')
  await expect(renderer).toBeVisible({ timeout: 20_000 })
  await expect(renderer).toHaveAttribute("data-renderer-id", "novaway.fixture-tool-result")
  await expect(renderer).toContainText("renderer-fixture")

  const disabled = await page.request.patch(`${backend()}/plugin/novaway-ui`, {
    headers: { "x-novaway-directory": directory },
    data: { enabled: false, scope: "builtin" },
  })
  expect(disabled.status()).toBe(200)

  await page.reload()
  await expect(page.locator('[data-slot="plugin-message-part-renderer"]')).toHaveCount(0)
  await expect(page.locator('[data-component="tool-part-wrapper"]')).toHaveCount(1)

  const enabled = await page.request.patch(`${backend()}/plugin/novaway-ui`, {
    headers: { "x-novaway-directory": directory },
    data: { enabled: true, scope: "builtin" },
  })
  expect(enabled.status()).toBe(200)
})
