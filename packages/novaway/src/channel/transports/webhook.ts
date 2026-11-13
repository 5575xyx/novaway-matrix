import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"

export type WebhookRequest = {
  method: string
  url: URL
  headers: IncomingMessage["headers"]
  body: string
}

export type WebhookReply = { status?: number; body?: string; contentType?: string }

/**
 * Minimal HTTP receiver for providers that push events (DingTalk/WeCom).
 *
 * It only exists when a port is configured, so the default channel setup opens
 * no socket. The handler decides status codes; transport errors become a 500 so
 * the provider retries instead of silently dropping the event.
 */
export class WebhookReceiver {
  private server?: Server
  private listening?: Promise<void>

  constructor(
    private readonly options: {
      host: string
      port: number
      path: string
      handle: (request: WebhookRequest) => Promise<WebhookReply>
      onError?: (error: unknown) => void
    },
  ) {}

  start() {
    if (this.listening) return this.listening
    this.listening = new Promise<void>((resolve, reject) => {
      this.server = createServer((request, response) => {
        void this.dispatch(request, response)
      })
      this.server.once("error", reject)
      this.server.listen(this.options.port, this.options.host, () => resolve())
    })
    return this.listening
  }

  async stop() {
    const server = this.server
    this.server = undefined
    this.listening = undefined
    if (!server) return
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }

  private async dispatch(request: IncomingMessage, response: ServerResponse) {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`)
    if (url.pathname !== this.options.path) {
      response.writeHead(404).end()
      return
    }
    try {
      const body = await readBody(request)
      const reply = await this.options.handle({
        method: request.method ?? "GET",
        url,
        headers: request.headers,
        body,
      })
      response.writeHead(reply.status ?? 200, { "content-type": reply.contentType ?? "text/plain" })
      response.end(reply.body ?? "")
    } catch (error) {
      this.options.onError?.(error)
      response.writeHead(500).end()
    }
  }
}

function readBody(request: IncomingMessage) {
  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = []
    request.on("data", (chunk: Buffer) => chunks.push(chunk))
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")))
    request.on("error", reject)
  })
}
