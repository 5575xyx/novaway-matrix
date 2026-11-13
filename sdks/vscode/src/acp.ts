import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"

/**
 * Minimal ACP client used by the VS Code extension.
 *
 * It spawns `novaway acp` and speaks the JSON-RPC dialect directly instead of
 * pulling the ACP SDK into the extension bundle. Only the methods this client
 * advertises are handled; unknown server requests are rejected, so an agent can
 * never silently assume filesystem or terminal access.
 */

type Pending = {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
}

export type PermissionOption = { optionId: string; name?: string; kind?: string }

export type AcpHandlers = {
  onText(text: string): void
  onTool?(title: string): void
  onLog?(line: string): void
  /** Return the option id to select, or undefined to cancel. */
  onPermission?(input: { title: string; options: PermissionOption[] }): Promise<string | undefined>
}

export type AcpClientOptions = AcpHandlers & {
  command: string
  args?: string[]
  cwd: string
  env?: NodeJS.ProcessEnv
}

export class AcpClient {
  private child?: ChildProcessWithoutNullStreams
  private pending = new Map<number, Pending>()
  private buffer = ""
  private nextID = 1
  private sessionID?: string

  constructor(private readonly options: AcpClientOptions) {}

  get session() {
    return this.sessionID
  }

  async start() {
    const child = spawn(this.options.command, this.options.args ?? ["acp"], {
      cwd: this.options.cwd,
      env: { ...process.env, ...this.options.env },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    })
    this.child = child
    child.stdout.setEncoding("utf8")
    child.stdout.on("data", (chunk: string) => this.consume(chunk))
    child.stderr.setEncoding("utf8")
    child.stderr.on("data", (chunk: string) => this.options.onLog?.(chunk.trimEnd()))
    child.on("error", (error) => this.failAll(error))
    child.on("exit", (code, signal) => {
      this.failAll(new Error(`novaway acp exited (${code ?? signal ?? "unknown"})`))
    })

    await this.request("initialize", {
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } },
    })
    const session = (await this.request("session/new", { cwd: this.options.cwd, mcpServers: [] })) as {
      sessionId?: string
    }
    if (!session?.sessionId) throw new Error("ACP session/new returned no sessionId")
    this.sessionID = session.sessionId
  }

  async prompt(text: string) {
    if (!this.sessionID) throw new Error("ACP session is not started")
    const result = (await this.request("session/prompt", {
      sessionId: this.sessionID,
      prompt: [{ type: "text", text }],
    })) as { stopReason?: string }
    return result?.stopReason ?? "end_turn"
  }

  stop() {
    this.failAll(new Error("ACP session stopped by client"))
    this.child?.kill()
    this.child = undefined
    this.sessionID = undefined
  }

  private consume(chunk: string) {
    this.buffer += chunk
    let index = this.buffer.indexOf("\n")
    while (index !== -1) {
      const line = this.buffer.slice(0, index).trim()
      this.buffer = this.buffer.slice(index + 1)
      if (line) this.handle(line)
      index = this.buffer.indexOf("\n")
    }
  }

  private handle(line: string) {
    let message: Record<string, unknown>
    try {
      message = JSON.parse(line)
    } catch {
      this.options.onLog?.(`invalid ACP message: ${line}`)
      return
    }

    const id = message.id
    const method = message.method
    if (typeof method === "string") {
      if (id !== undefined && id !== null) {
        void this.handleRequest(id as number | string, method, message.params)
      } else {
        void this.handleNotification(method, message.params)
      }
      return
    }

    if (typeof id === "number") {
      const pending = this.pending.get(id)
      if (!pending) return
      this.pending.delete(id)
      const error = message.error as { message?: string } | undefined
      if (error) pending.reject(new Error(error.message ?? "ACP request failed"))
      else pending.resolve(message.result)
    }
  }

  private async handleRequest(id: number | string, method: string, params: unknown) {
    if (method === "session/request_permission") {
      const request = params as { toolCall?: { title?: string }; options?: PermissionOption[] }
      const options = request.options ?? []
      const selected = this.options.onPermission
        ? await this.options.onPermission({ title: request.toolCall?.title ?? "Tool call", options })
        : options.find((option) => (option.kind ?? "").startsWith("allow"))?.optionId
      this.write({
        jsonrpc: "2.0",
        id,
        result: selected
          ? { outcome: { outcome: "selected", optionId: selected } }
          : { outcome: { outcome: "cancelled" } },
      })
      return
    }

    this.write({
      jsonrpc: "2.0",
      id,
      error: { code: -32601, message: `unsupported client method: ${method}` },
    })
  }

  private async handleNotification(method: string, params: unknown) {
    if (method !== "session/update") return
    const update = (params as { update?: Record<string, unknown> })?.update
    if (!update) return
    if (update.sessionUpdate === "agent_message_chunk") {
      const content = update.content as { type?: string; text?: string } | undefined
      if (content?.type === "text" && content.text) this.options.onText(content.text)
      return
    }
    if (update.sessionUpdate === "tool_call" || update.sessionUpdate === "tool_call_update") {
      const title = typeof update.title === "string" ? update.title : undefined
      if (title) this.options.onTool?.(title)
    }
  }

  private request(method: string, params: unknown) {
    const id = this.nextID++
    return new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.write({ jsonrpc: "2.0", id, method, params })
    })
  }

  private write(message: unknown) {
    const child = this.child
    if (!child || child.stdin.destroyed) throw new Error("ACP process is not running")
    child.stdin.write(JSON.stringify(message) + "\n")
  }

  private failAll(error: Error) {
    for (const pending of this.pending.values()) pending.reject(error)
    this.pending.clear()
  }
}
