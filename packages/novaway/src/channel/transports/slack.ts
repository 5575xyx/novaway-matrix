import { createHmac, timingSafeEqual } from "node:crypto"
import type { ChannelTransport, InboundMessage, ReplyTarget } from "../channel"
import { WebhookReceiver } from "./webhook"

// Slack webhook/Web API payloads are external JSON, so read them field by field
// instead of trusting a cast.
function field(source: unknown, key: string): unknown {
  if (typeof source !== "object" || source === null) return undefined
  return Reflect.get(source, key)
}

function stringField(source: unknown, key: string): string | undefined {
  const value = field(source, key)
  return typeof value === "string" ? value : undefined
}

function signature(secret: string, timestamp: string, body: string) {
  return "v0=" + createHmac("sha256", secret).update(`v0:${timestamp}:${body}`).digest("hex")
}

function validSignature(input: { secret: string; timestamp?: string; received?: string; body: string }) {
  if (!input.timestamp || !input.received) return false
  const expected = Buffer.from(signature(input.secret, input.timestamp, input.body))
  const received = Buffer.from(input.received)
  return expected.length === received.length && timingSafeEqual(expected, received)
}

/**
 * Slack adapter over the Events API + Web API.
 *
 * Inbound needs a public HTTPS endpoint Slack can call, so the listener only
 * starts when a port is configured. Requests are verified with the app's signing
 * secret when one is set; bot messages and edits are ignored so a channel cannot
 * answer itself. Outbound uses `chat.postMessage`, threading when the inbound
 * message had a thread root.
 */
export class SlackTransport implements ChannelTransport {
  private handler?: (message: InboundMessage) => void
  private receiver?: WebhookReceiver

  constructor(
    private readonly options: {
      botToken: string
      signingSecret?: string
      host?: string
      port?: number
      path?: string
      onError?: (error: unknown) => void
      fetch?: typeof fetch
    },
  ) {}

  async connect() {
    if (!this.options.port) throw new Error("slack channel needs an inbound port for the Events API")
    this.receiver = new WebhookReceiver({
      host: this.options.host ?? "127.0.0.1",
      port: this.options.port,
      path: this.options.path ?? "/slack",
      handle: async (request) => this.handle(request.headers, request.body),
      ...(this.options.onError ? { onError: this.options.onError } : {}),
    })
    await this.receiver.start()
  }

  async disconnect() {
    await this.receiver?.stop()
    this.receiver = undefined
  }

  async send(target: ReplyTarget, text: string) {
    const response = await (this.options.fetch ?? fetch)("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.options.botToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        channel: target.conversation,
        text,
        ...(target.replyTo ? { thread_ts: target.replyTo } : {}),
      }),
    })
    if (!response.ok) throw new Error(`slack send failed: ${response.status}`)
    const payload: unknown = await response.json()
    if (field(payload, "ok") === false) {
      throw new Error(`slack send failed: ${stringField(payload, "error") ?? "unknown error"}`)
    }
  }

  onMessage(handler: (message: InboundMessage) => void) {
    this.handler = handler
  }

  private async handle(headers: Record<string, string | string[] | undefined>, body: string) {
    const secret = this.options.signingSecret
    if (secret) {
      const header = (name: string) => {
        const value = headers[name]
        return typeof value === "string" ? value : undefined
      }
      if (
        !validSignature({
          secret,
          timestamp: header("x-slack-request-timestamp"),
          received: header("x-slack-signature"),
          body,
        })
      ) {
        return { status: 401, body: "invalid signature" }
      }
    }
    const payload: unknown = JSON.parse(body)
    const challenge = stringField(payload, "challenge")
    if (stringField(payload, "type") === "url_verification" && challenge) {
      return { status: 200, body: JSON.stringify({ challenge }), contentType: "application/json" }
    }
    const event = field(payload, "event")
    // Edits, joins, bot messages and our own replies are not user prompts.
    if (stringField(event, "type") !== "message" || stringField(event, "subtype") || stringField(event, "bot_id")) {
      return { status: 200, body: "" }
    }
    const text = stringField(event, "text")?.trim()
    const conversation = stringField(event, "channel")
    if (!text || !conversation) return { status: 200, body: "" }
    const senderID = stringField(event, "user")
    const messageID = stringField(event, "ts")
    this.handler?.({
      conversation,
      text,
      ...(senderID ? { senderID } : {}),
      ...(messageID ? { messageID } : {}),
    })
    return { status: 200, body: "" }
  }
}
