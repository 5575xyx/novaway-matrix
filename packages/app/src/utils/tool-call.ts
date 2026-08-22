import type { ServerConnection } from "@/context/server"

export async function callTool({
  server,
  directory,
  toolId,
  arguments: args,
}: {
  server: ServerConnection.Any
  directory?: string
  toolId: string
  arguments?: Record<string, unknown>
}) {
  const http = "http" in server ? server.http : undefined
  if (!http) throw new Error("Unsupported server connection type")

  const url = new URL(`${http.url.replace(/\/+$/, "")}/experimental/tool/call`)
  if (directory) url.searchParams.set("directory", directory)

  const headers: Record<string, string> = {
    "content-type": "application/json",
  }
  if (http.password) {
    headers.authorization = `Basic ${btoa(`${http.username ?? "NovaWay"}:${http.password}`)}`
  }

  const response = await fetch(url.toString(), {
    method: "POST",
    headers,
    body: JSON.stringify({
      toolId,
      arguments: args ?? {},
    }),
  })

  const text = await response.text()
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    data = text
  }

  if (!response.ok) {
    const message = typeof data === "object" && data !== null && "error" in data ? String(data.error) : text
    throw new Error(message || `Tool call failed with status ${response.status}`)
  }

  return data
}
