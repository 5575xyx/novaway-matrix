import { expect, test } from "@playwright/test"

const DIRECTORY = "E:/code-editor-e2e"
const FILE_PATH = "src/example.ts"
const ORIGINAL = "export const value = 1\nexport const other = 2\n"
const REPLACEMENT = "export const value = 42"

const slug = Buffer.from(DIRECTORY, "utf8")
  .toString("base64")
  .replace(/\+/g, "-")
  .replace(/\//g, "_")
  .replace(/=+$/, "")

const apiPort = process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"

const model = {
  id: "mock-model",
  providerID: "mock-provider",
  api: { id: "mock", url: "", npm: "" },
  name: "Mock model",
  capabilities: {
    temperature: true,
    reasoning: false,
    attachment: false,
    toolcall: false,
    input: { text: true, audio: false, image: false, video: false, pdf: false },
    output: { text: true, audio: false, image: false, video: false, pdf: false },
    interleaved: false,
  },
}

const provider = {
  id: "mock-provider",
  name: "Mock provider",
  source: "config" as const,
  env: [],
  options: {},
  models: { "mock-model": model },
}

function json(route: import("@playwright/test").Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) })
}

async function openCodeFile(page: import("@playwright/test").Page) {
  await page.goto(`/${slug}/session`, { waitUntil: "domcontentloaded" })
  await expect(page.locator('[data-component="sidebar-nav-desktop"]')).toBeVisible({ timeout: 30_000 })
  const files = page.getByRole("menuitem", { name: /^(Workspace files|工作区文件)$/ }).first()
  const input = page.getByPlaceholder(/Search (?:workspace )?files|搜索(?:工作区)?文件/).first()
  if (!(await input.isVisible())) {
    await page.getByRole("button", { name: /Add panel tab|新增面板标签/ }).first().click()
    await files.click()
  }
  await expect(input).toBeVisible({ timeout: 15_000 })
  await expect(page.locator('[data-action="side-pane-file-tree-close"]')).toHaveCount(0)
  await expect(page.locator('[data-action="workspace-file-changed-only"]')).toBeVisible()
  await input.fill("example.ts")
  const row = page.getByRole("treeitem").filter({ hasText: "example.ts" }).first()
  await expect(row).toBeVisible({ timeout: 15_000 })
  await row.click()
  await expect(page.locator('[data-component="file-preview-header"]')).toBeVisible({ timeout: 15_000 })
  const editor = page.locator('[data-component="code-editor"]')
  await expect(editor).toBeVisible({ timeout: 15_000 })
  await editor.locator(".cm-content").click()
  await expect(page.locator(".cm-tooltip-autocomplete")).toBeVisible({ timeout: 5_000 })
  await page.keyboard.press("Escape")
}

test("代码编辑器运行时：AI 修改、撤销重做、自动保存和冲突保护", async ({ page }) => {
  let diskContent = ORIGINAL
  let writeCount = 0
  let promptCount = 0
  let messageCount = 0

  await page.route("**/*", async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (!(["127.0.0.1", "localhost"] as string[]).includes(url.hostname) || url.port !== apiPort) {
      return route.continue()
    }

    if (url.pathname === "/global/config" || url.pathname === "/config") return json(route, {})
    if (url.pathname === "/project") return json(route, [])
    if (url.pathname === "/path") return json(route, { directory: DIRECTORY, home: DIRECTORY, state: "", config: "", worktree: "" })
    if (url.pathname === "/provider") {
      return json(route, { all: [provider], default: {}, connected: ["mock-provider"] })
    }
    if (url.pathname === "/app/agents" || url.pathname === "/agent") {
      return json(route, [
        {
          name: "build",
          mode: "primary",
          model: { providerID: "mock-provider", modelID: "mock-model" },
          permission: [],
          options: {},
        },
      ])
    }
    if (url.pathname === "/plugin/contributions") return json(route, [])
    if (url.pathname === "/mcp/status") return json(route, {})
    if (url.pathname === "/lsp/status") return json(route, [])
    if (url.pathname === "/session" && request.method() === "GET") return json(route, [])
    if (url.pathname === "/api/fs/find") {
      return json(route, { data: [{ path: FILE_PATH, type: "file" }] })
    }
    if (url.pathname === "/file" && request.method() === "GET") {
      if (url.searchParams.get("path") === "src") {
        return json(route, [
          {
            name: "example.ts",
            path: FILE_PATH,
            absolute: `${DIRECTORY}/${FILE_PATH}`,
            type: "file",
            ignored: false,
          },
        ])
      }
      return json(route, [
        { name: "src", path: "src", absolute: `${DIRECTORY}/src`, type: "directory", ignored: false },
      ])
    }
    if (url.pathname === "/file/content") return json(route, { type: "text", content: diskContent })
    if (url.pathname === "/file/write" && request.method() === "POST") {
      diskContent = JSON.parse(request.postData() ?? "{}").content ?? diskContent
      writeCount++
      return json(route, true)
    }
    if (url.pathname === "/lsp/diagnostics") return json(route, {})
    if (url.pathname === "/lsp/document-symbols") return json(route, [])
    if (url.pathname === "/lsp/definition") return json(route, [])
    if (url.pathname === "/session" && request.method() === "POST") return json(route, { id: "inline-session" })
    if (url.pathname === "/session/inline-session/prompt_async") {
      promptCount++
      return route.fulfill({ status: 204, body: "" })
    }
    if (url.pathname === "/session/inline-session/message") {
      messageCount++
      return json(route, [
        {
          info: {
            id: "assistant-1",
            role: "assistant",
            time: { created: 1, completed: 2 },
          },
          parts: [{ type: "text", text: `\n\`\`\`ts\n${REPLACEMENT}\n\`\`\`\n` }],
        },
      ])
    }
    if (url.pathname === "/session/inline-session" && request.method() === "DELETE") return json(route, true)
    return route.continue()
  })

  await openCodeFile(page)
  const editor = page.locator('[data-component="code-editor"]')
  await expect(editor.locator(".cm-content")).toContainText("export const value = 1")

  // Select the first line and open the same floating action menu users operate in the app.
  const content = editor.locator(".cm-content")
  await content.click()
  await page.keyboard.press("Control+Home")
  await page.keyboard.press("Shift+ArrowDown")
  await editor.dispatchEvent("mouseup", { clientX: 240, clientY: 180 })
  await expect(page.locator("[data-file-selection-menu]")).toBeVisible()
  await page.locator("[data-file-selection-menu] textarea").fill("把数字改成 42")
  await page.locator('[data-action="file-ai-inline-edit"]').click()

  await expect.poll(() => promptCount, { timeout: 15_000 }).toBe(1)
  await expect.poll(() => messageCount, { timeout: 15_000 }).toBeGreaterThan(0)
  await expect(editor.locator(".cm-content")).toContainText(REPLACEMENT)
  await expect.poll(() => writeCount, { timeout: 15_000 }).toBeGreaterThan(0)

  // Exercise the actual CodeMirror keyboard path wired to text-history.
  await content.click()
  await page.keyboard.press("Control+Z")
  await expect(editor.locator(".cm-content")).toContainText("export const value = 1")
  await page.keyboard.press("Control+Shift+Z")
  await expect(editor.locator(".cm-content")).toContainText(REPLACEMENT)

  // Typing and undo must use the app's save-aware history exactly once;
  // CodeMirror's internal history must not create a second undo transaction.
  await content.click()
  await page.keyboard.press("Control+End")
  await page.keyboard.type("!")
  await expect(editor.locator(".cm-content")).toContainText("other = 2!")
  await page.keyboard.press("Control+Z")
  await expect(editor.locator(".cm-content")).not.toContainText("other = 2!")

  // A changed disk baseline must show the real conflict dialog instead of overwriting it.
  diskContent = "export const value = 999\nexport const other = 2\n"
  await content.click()
  await page.keyboard.press("End")
  await page.keyboard.type(" // local")
  await expect(page.getByRole("dialog")).toContainText(/文件已被外部修改|File changed externally/, { timeout: 15_000 })
  expect(diskContent).toContain("999")
})

test("代码编辑器运行时：可以取消进行中的 AI 修改", async ({ page }) => {
  let promptStarted = false
  let releasePrompt: (() => void) | undefined
  let abortCount = 0
  let writeCount = 0
  let diskContent = ORIGINAL
  const promptReleased = new Promise<void>((resolve) => {
    releasePrompt = resolve
  })

  await page.route("**/*", async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (!(["127.0.0.1", "localhost"] as string[]).includes(url.hostname) || url.port !== apiPort) {
      return route.continue()
    }

    if (url.pathname === "/global/config" || url.pathname === "/config") return json(route, {})
    if (url.pathname === "/project") return json(route, [])
    if (url.pathname === "/path") {
      return json(route, { directory: DIRECTORY, home: DIRECTORY, state: "", config: "", worktree: "" })
    }
    if (url.pathname === "/provider") return json(route, { all: [provider], default: {}, connected: ["mock-provider"] })
    if (url.pathname === "/app/agents" || url.pathname === "/agent") {
      return json(route, [
        {
          name: "build",
          mode: "primary",
          model: { providerID: "mock-provider", modelID: "mock-model" },
          permission: [],
          options: {},
        },
      ])
    }
    if (url.pathname === "/plugin/contributions") return json(route, [])
    if (url.pathname === "/mcp/status") return json(route, {})
    if (url.pathname === "/lsp/status") return json(route, [])
    if (url.pathname === "/session" && request.method() === "GET") return json(route, [])
    if (url.pathname === "/api/fs/find") return json(route, { data: [{ path: FILE_PATH, type: "file" }] })
    if (url.pathname === "/file" && request.method() === "GET") {
      if (url.searchParams.get("path") === "src") {
        return json(route, [
          {
            name: "example.ts",
            path: FILE_PATH,
            absolute: `${DIRECTORY}/${FILE_PATH}`,
            type: "file",
            ignored: false,
          },
        ])
      }
      return json(route, [{ name: "src", path: "src", absolute: `${DIRECTORY}/src`, type: "directory", ignored: false }])
    }
    if (url.pathname === "/file/content") return json(route, { type: "text", content: diskContent })
    if (url.pathname === "/file/write" && request.method() === "POST") {
      diskContent = JSON.parse(request.postData() ?? "{}").content ?? diskContent
      writeCount++
      return json(route, true)
    }
    if (url.pathname === "/lsp/diagnostics") return json(route, {})
    if (url.pathname === "/lsp/document-symbols") return json(route, [])
    if (url.pathname === "/lsp/definition") return json(route, [])
    if (url.pathname === "/session" && request.method() === "POST") return json(route, { id: "cancel-session" })
    if (url.pathname === "/session/cancel-session/prompt_async") {
      promptStarted = true
      await promptReleased
      return route.fulfill({ status: 204, body: "" })
    }
    if (url.pathname === "/session/cancel-session/abort") {
      abortCount++
      releasePrompt?.()
      return json(route, true)
    }
    if (url.pathname === "/session/cancel-session" && request.method() === "DELETE") return json(route, true)
    return route.continue()
  })

  await openCodeFile(page)
  const editor = page.locator('[data-component="code-editor"]')
  const content = editor.locator(".cm-content")
  await content.click()
  await page.keyboard.press("Control+Home")
  await page.keyboard.press("Shift+ArrowDown")
  await editor.dispatchEvent("mouseup", { clientX: 240, clientY: 180 })
  await expect(page.locator("[data-file-selection-menu]")).toBeVisible()
  await page.locator("[data-file-selection-menu] textarea").fill("等待期间取消这次修改")
  await page.locator('[data-action="file-ai-inline-edit"]').click()

  await expect.poll(() => promptStarted, { timeout: 15_000 }).toBe(true)
  await expect(page.locator("[data-file-inline-edit-progress]")).toBeVisible()
  await page.locator("[data-file-inline-edit-progress] button").click()
  await expect.poll(() => abortCount, { timeout: 15_000 }).toBe(1)
  await expect(page.locator("[data-file-inline-edit-progress]")).toHaveCount(0, { timeout: 15_000 })
  await expect(editor.locator(".cm-content")).toContainText("export const value = 1")
  expect(writeCount).toBe(0)
})
