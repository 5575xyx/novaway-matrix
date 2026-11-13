import { createDecipheriv, createHash } from "node:crypto"
import type { ChannelTransport, InboundMessage, ReplyTarget } from "../channel"
import { WebhookReceiver } from "./webhook"

const API = "https://qyapi.weixin.qq.com/cgi-bin"

function signature(token: string, timestamp: string, nonce: string, encrypted: string) {
  return createHash("sha1").update([token, timestamp, nonce, encrypted].sort().join("")).digest("hex")
}

function decrypt(aesKey: string, encrypted: string) {
  const key = Buffer.from(aesKey + "=", "base64")
  if (key.length !== 32) throw new Error("wecom aes_key must be 43 characters")
  const decipher = createDecipheriv("aes-256-cbc", key, key.subarray(0, 16))
  decipher.setAutoPadding(false)
  const padded = Buffer.concat([decipher.update(encrypted, "base64"), decipher.final()])
  const pad = padded[padded.length - 1]
  if (pad < 1 || pad > 32) throw new Error("wecom payload padding is invalid")
  const plain = padded.subarray(0, padded.length - pad)
  const length = plain.readUInt32BE(16)
  return plain.subarray(20, 20 + length).toString("utf8")
}

function tag(xml: string, name: string) {
  const cdata = new RegExp(`<${name}><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${name}>`).exec(xml)
  if (cdata) return cdata[1]
  return new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(xml)?.[1]
}

/**
 * WeCom (企业微信) adapter.
 *
 * Outbound uses the app message API with a cached access token. Inbound is the
 * callback endpoint: the 43-char AES key decrypts the event and the callback
 * token verifies it. `MsgId` is de-duplicated because WeCom retries on timeout.
 */
export class WeComTransport implements ChannelTransport {
  private handler?: (message: InboundMessage) => void
  private receiver?: WebhookReceiver
  private token?: { value: string; expiresAt: number }
  private readonly seen = new Set<string>()

  constructor(
    private readonly options: {
      corpId: string
      corpSecret: string
      agentId: string
      callbackToken?: string
      aesKey?: string
      host?: string
      port?: number
      path?: string
      onError?: (error: unknown) => void
    },
  ) {}

  async connect() {
    await this.accessToken()
    if (!this.options.port) return
    if (!this.options.callbackToken || !this.options.aesKey) {
      throw new Error("wecom inbound needs callback_token and aes_key")
    }
    this.receiver = new WebhookReceiver({
      host: this.options.host ?? "127.0.0.1",
      port: this.options.port,
      path: this.options.path ?? "/wecom",
      handle: async (request) => this.handle(request.method, request.url, request.body),
      ...(this.options.onError ? { onError: this.options.onError } : {}),
    })
    await this.receiver.start()
  }

  async disconnect() {
    await this.receiver?.stop()
    this.receiver = undefined
    this.seen.clear()
  }

  async send(target: ReplyTarget, text: string) {
    const token = await this.accessToken()
    const response = await fetch(`${API}/message/send?access_token=${encodeURIComponent(token)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        touser: target.conversation,
        msgtype: "text",
        agentid: Number(this.options.agentId),
        text: { content: text },
      }),
    })
    const payload = (await response.json()) as { errcode?: number; errmsg?: string }
    if (!response.ok || (payload.errcode ?? 0) !== 0) {
      throw new Error(`wecom send failed: ${payload.errmsg ?? response.status}`)
    }
  }

  onMessage(handler: (message: InboundMessage) => void) {
    this.handler = handler
  }

  private async accessToken() {
    if (this.token && this.token.expiresAt > Date.now()) return this.token.value
    const url = `${API}/gettoken?corpid=${encodeURIComponent(this.options.corpId)}&corpsecret=${encodeURIComponent(this.options.corpSecret)}`
    const response = await fetch(url)
    const payload = (await response.json()) as {
      errcode?: number
      errmsg?: string
      access_token?: string
      expires_in?: number
    }
    if (!payload.access_token) throw new Error(`wecom gettoken failed: ${payload.errmsg ?? response.status}`)
    this.token = {
      value: payload.access_token,
      expiresAt: Date.now() + Math.max(60, (payload.expires_in ?? 7200) - 60) * 1000,
    }
    return this.token.value
  }

  private verify(query: URLSearchParams, encrypted: string) {
    const expected = signature(
      this.options.callbackToken!,
      query.get("timestamp") ?? "",
      query.get("nonce") ?? "",
      encrypted,
    )
    if (expected !== query.get("msg_signature")) throw new Error("wecom signature mismatch")
  }

  private async handle(method: string, url: URL, body: string) {
    if (method === "GET") {
      const echo = url.searchParams.get("echostr")
      if (!echo) return { status: 400, body: "missing echostr" }
      this.verify(url.searchParams, echo)
      return { status: 200, body: decrypt(this.options.aesKey!, echo) }
    }
    const encrypted = tag(body, "Encrypt")
    if (!encrypted) return { status: 400, body: "missing payload" }
    this.verify(url.searchParams, encrypted)
    const message = decrypt(this.options.aesKey!, encrypted)
    if (tag(message, "MsgType") !== "text") return { status: 200, body: "" }
    const id = tag(message, "MsgId")
    const text = tag(message, "Content")?.trim()
    const sender = tag(message, "FromUserName")
    if (!text || !sender) return { status: 200, body: "" }
    if (id) {
      if (this.seen.has(id)) return { status: 200, body: "" }
      this.seen.add(id)
      if (this.seen.size > 500) this.seen.delete(this.seen.values().next().value!)
    }
    this.handler?.({
      conversation: sender,
      text,
      senderID: sender,
      ...(id ? { messageID: id } : {}),
    })
    return { status: 200, body: "" }
  }
}
