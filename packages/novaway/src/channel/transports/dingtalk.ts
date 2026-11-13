import { createHmac, timingSafeEqual } from "node:crypto"
import type { ChannelTransport, InboundMessage, ReplyTarget } from "../channel"
import { WebhookReceiver } from "./webhook"

type DingTalkPayload = {
  msgId?: string
  msgtype?: string
  conversationId?: string
  conversationType?: string
  senderId?: string
  senderStaffId?: string
  senderNick?: string
  sessionWebhook?: string
  text?: { content?: string }
}

function sign(timestamp: string, secret: string) {
  return createHmac("sha256", secret).update(`${timestamp}\n${secret}`).digest("base64")
}

function validSignature(input: { timestamp?: string; signature?: string; secret: string }) {
  if (!input.timestamp || !input.signature) return false
  const expected = Buffer.from(sign(input.timestamp, input.secret))
  const received = Buffer.from(input.signature)
  return expected.length === received.length && timingSafeEqual(expected, received)
}

/**
 * DingTalk adapter.
 *
 * Outbound uses a group robot webhook (with optional signing). Inbound needs an
 * outgoing robot callback, so a listener is only started when a port is set;
 * `sessionWebhook` in the payload carries the reply target for that conversation.
 */
export class DingTalkTransport implements ChannelTransport {
  private handler?: (message: InboundMessage) => void
  private receiver?: WebhookReceiver
  private readonly sessions = new Map<string, string>()

  constructor(
    private readonly options: {
      webhook?: string
      signSecret?: string
      host?: string
      port?: number
      path?: string
      onError?: (error: unknown) => void
    },
  ) {}

  async connect() {
    if (!this.options.webhook && !this.options.port) {
      throw new Error("dingtalk channel needs a webhook or an inbound port")
    }
    if (!this.options.port) return
    this.receiver = new WebhookReceiver({
      host: this.options.host ?? "127.0.0.1",
      port: this.options.port,
      path: this.options.path ?? "/dingtalk",
      handle: async (request) => this.handle(request.headers, request.body),
      ...(this.options.onError ? { onError: this.options.onError } : {}),
    })
    await this.receiver.start()
  }

  async disconnect() {
    await this.receiver?.stop()
    this.receiver = undefined
    this.sessions.clear()
  }

  async send(target: ReplyTarget, text: string) {
    const endpoint = this.sessions.get(target.conversation) ?? this.options.webhook
    if (!endpoint) throw new Error(`dingtalk has no reply target for ${target.conversation}`)
    const body = JSON.stringify({ msgtype: "text", text: { content: text } })
    if (endpoint === this.options.webhook && this.options.signSecret) {
      const timestamp = String(Date.now())
      const signature = sign(timestamp, this.options.signSecret)
      const url = new URL(endpoint)
      url.searchParams.set("timestamp", timestamp)
      url.searchParams.set("sign", signature)
      await postJson(url.toString(), body)
      return
    }
    await postJson(endpoint, body)
  }

  onMessage(handler: (message: InboundMessage) => void) {
    this.handler = handler
  }

  private async handle(headers: Record<string, string | string[] | undefined>, body: string) {
    const secret = this.options.signSecret
    if (secret) {
      const header = (name: string) => {
        const value = headers[name]
        return typeof value === "string" ? value : undefined
      }
      if (!validSignature({ timestamp: header("timestamp"), signature: header("sign"), secret })) {
        return { status: 401, body: "invalid signature" }
      }
    }
    const payload = JSON.parse(body) as DingTalkPayload
    if (payload.msgtype && payload.msgtype !== "text") return { status: 200, body: "" }
    const text = payload.text?.content?.trim()
    const conversation = payload.conversationId
    if (!text || !conversation) return { status: 200, body: "" }
    if (payload.sessionWebhook) this.sessions.set(conversation, payload.sessionWebhook)
    this.handler?.({
      conversation,
      text,
      ...((payload.senderStaffId ?? payload.senderId) ? { senderID: payload.senderStaffId ?? payload.senderId } : {}),
      ...(payload.msgId ? { messageID: payload.msgId } : {}),
    })
    return { status: 200, body: JSON.stringify({ msgtype: "text", text: { content: "" } }) }
  }
}

async function postJson(url: string, body: string) {
  const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body })
  if (!response.ok) throw new Error(`dingtalk send failed: ${response.status}`)
}
