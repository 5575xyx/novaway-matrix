import { expect, test } from "@playwright/test"
import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { resolve } from "node:path"

const backendURL = "http://127.0.0.1:4096"
const providerID = "e2e-office-mock"

const artifactMarkdown = `# 办公产物

## 第 1 页：客户提案

布局：强调
视觉：大标题、主题色强调、右侧价值卡片。
主文案：
- 标题：客户提案
- 核心价值：降低运营成本，提升交付效率
- 下一步：进入试点
演讲备注：
- 用一句话说明方案价值。

## 第 2 页：落地路径

布局：流程
视觉：三段流程节点与连接线。
主文案：
- 第一阶段：现状盘点
- 第二阶段：试点上线
- 第三阶段：规模推广
演讲备注：
- 说明每阶段的责任人和验收标准。

# 可沉淀记忆/可进化建议

- 可沉淀记忆：用户偏好客户提案使用价值导向结构。
- 可进化建议：后续可默认补充财务测算和风险页。
- 需要用户确认：是否需要加入试点周期。
`

async function jsonFetch(url: string, init: RequestInit) {
  const response = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  })
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} ${await response.text()}`)
  return response
}

async function configureMockProvider(baseURL: string) {
  await jsonFetch(`${backendURL}/auth/${providerID}`, {
    method: "PUT",
    body: JSON.stringify({ type: "api", key: "test" }),
  })
  await jsonFetch(`${backendURL}/global/config`, {
    method: "PATCH",
    body: JSON.stringify({
      config: {
        provider: {
          [providerID]: {
            npm: "@ai-sdk/openai-compatible",
            name: "E2E Office Mock",
            options: { baseURL },
            models: {
              "mock-model": {
                name: "Mock Model",
                modalities: { input: [], output: ["text"] },
              },
            },
          },
        },
        model: `${providerID}/mock-model`,
      },
    }),
  })
}

function startMockServer(): Promise<Server> {
  return new Promise((resolveServer) => {
    const server = createServer((request, response) => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1")
      if (url.pathname.endsWith("/chat/completions")) {
        let body = ""
        request.on("data", (chunk) => {
          body += chunk
        })
        request.on("end", () => {
          response.writeHead(200, { "Content-Type": "application/json" })
          response.end(
            JSON.stringify({
              id: "mock-completion",
              object: "chat.completion",
              choices: [
                {
                  index: 0,
                  message: { role: "assistant", content: artifactMarkdown },
                  finish_reason: "stop",
                },
              ],
            }),
          )
        })
        return
      }
      response.writeHead(404, { "Content-Type": "application/json" })
      response.end(JSON.stringify({ error: "not found" }))
    })
    server.listen(0, "127.0.0.1", () => resolveServer(server))
  })
}

function base64UrlEncode(value: string) {
  return Buffer.from(value, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "")
}

async function waitForArtifact(sessionID: string, workspaceRoot: string) {
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    const response = await fetch(
      `${backendURL}/session/${sessionID}/message?${new URLSearchParams({ directory: workspaceRoot })}`,
    )
    if (response.ok) {
      const payload = (await response.json()) as { data?: Array<{ parts?: Array<{ type?: string; text?: string }> }> }
      const messages = payload.data ?? []
      const text = messages
        .flatMap((message) => message.parts ?? [])
        .filter((part) => part.type === "text")
        .map((part) => part.text ?? "")
        .join("\n")
      if (text.includes("# 办公产物")) return
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 1_000))
  }
  throw new Error("后端未在 60 秒内产出办公产物")
}

test("后端生成办公产物后浏览器可加载并导出 PPTX", async ({ page }) => {
  const server = await startMockServer()
  const address = server.address() as AddressInfo
  const baseURL = `http://127.0.0.1:${address.port}/v1`
  await configureMockProvider(baseURL)

  const workspaceRoot = resolve(process.cwd(), "..", "..")
  const sessionQuery = new URLSearchParams({ directory: workspaceRoot }).toString()

  try {
    const createResponse = await jsonFetch(`${backendURL}/session?${sessionQuery}`, {
      method: "POST",
      body: JSON.stringify({
        title: "E2E 客户提案",
        agent: "office-ppt",
        model: { id: "mock-model", providerID },
      }),
    })
    const createPayload = (await createResponse.json()) as { id?: string; data?: { id?: string } }
    const sessionID = createPayload.data?.id ?? createPayload.id
    if (!sessionID) throw new Error("创建会话失败：未返回 sessionID")

    await jsonFetch(`${backendURL}/session/${sessionID}/prompt_async?${sessionQuery}`, {
      method: "POST",
      body: JSON.stringify({
        agent: "office-ppt",
        model: { providerID, modelID: "mock-model" },
        parts: [{ type: "text", text: "快速模式：直接生成 2 页客户提案 PPT，使用占位符，不要追问" }],
      }),
    })
    await waitForArtifact(sessionID, workspaceRoot)

    const slug = base64UrlEncode(workspaceRoot)
    await page.goto("/")
    await page.getByRole("button", { name: /禅意模式/ }).click()
    await expect(page.getByText("NovaWay 办公助手")).toBeVisible()
    await page.goto(`/${slug}/session/${sessionID}?office=ppt&pptTemplate=pptx-swiss-grid`)

    await expect(page.getByRole("heading", { name: "办公产物" })).toBeVisible({ timeout: 30_000 })
    const exportButton = page.getByRole("button", { name: "导出 PPTX" })
    await expect(exportButton).toBeVisible({ timeout: 30_000 })
    await exportButton.click()
    await expect(page.getByText("办公文件已导出", { exact: false })).toBeVisible({ timeout: 30_000 })
  } finally {
    await fetch(`${backendURL}/auth/${providerID}`, { method: "DELETE" }).catch(() => undefined)
    await jsonFetch(`${backendURL}/global/config`, {
      method: "PATCH",
      body: JSON.stringify({ config: { provider: { [providerID]: null }, model: null } }),
    }).catch(() => undefined)
    await new Promise((resolveClose) => server.close(resolveClose))
  }
})
