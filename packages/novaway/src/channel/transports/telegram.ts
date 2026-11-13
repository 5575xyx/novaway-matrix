import type { ChannelTransport, InboundMessage, ReplyTarget } from "../channel"

type TelegramUpdate = {
  update_id: number
  message?: {
    message_id: number
    text?: string
    chat: { id: number | string }
    from?: { id: number | string }
  }
}

type TelegramResponse<T> = { ok: boolean; result?: T; description?: string }

/**
 * Telegram Bot API adapter using long polling.
 *
 * Polling is deliberate: it needs no public URL, so enabling a channel does not
 * open a port. `getUpdates` is acknowledged with an offset before dispatch, so a
 * crash cannot replay an already handled message.
 */
export class TelegramTransport implements ChannelTransport {
  private controller?: AbortController
  private polling?: Promise<void>
  private handler?: (message: InboundMessage) => void
  private offset = 0

  constructor(
    private readonly options: {
      token: string
      baseUrl?: string
      pollTimeoutSeconds?: number
      onError?: (error: unknown) => void
    },
  ) {}

  async connect() {
    await this.call("getMe", {})
    this.controller = new AbortController()
    this.polling = this.poll(this.controller.signal).catch((error) => {
      if (this.controller?.signal.aborted) return
      this.options.onError?.(error)
    })
  }

  async disconnect() {
    this.controller?.abort()
    await this.polling
    this.controller = undefined
    this.polling = undefined
  }

  async send(target: ReplyTarget, text: string) {
    await this.call("sendMessage", {
      chat_id: target.conversation,
      text,
      ...(target.replyTo ? { reply_to_message_id: Number(target.replyTo) } : {}),
    })
  }

  onMessage(handler: (message: InboundMessage) => void) {
    this.handler = handler
  }

  private async poll(signal: AbortSignal) {
    while (!signal.aborted) {
      const updates = await this.call<TelegramUpdate[]>(
        "getUpdates",
        {
          offset: this.offset,
          timeout: this.options.pollTimeoutSeconds ?? 30,
          allowed_updates: ["message"],
        },
        signal,
      )
      for (const update of updates) {
        this.offset = Math.max(this.offset, update.update_id + 1)
        const message = update.message
        if (!message?.text) continue
        this.handler?.({
          conversation: String(message.chat.id),
          text: message.text,
          ...(message.from ? { senderID: String(message.from.id) } : {}),
          messageID: String(message.message_id),
        })
      }
    }
  }

  private async call<T>(method: string, body: Record<string, unknown>, signal?: AbortSignal) {
    const base = this.options.baseUrl ?? "https://api.telegram.org"
    const response = await fetch(`${base}/bot${this.options.token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      ...(signal ? { signal } : {}),
    })
    const payload = (await response.json()) as TelegramResponse<T>
    if (!payload.ok) throw new Error(`telegram ${method} failed: ${payload.description ?? response.status}`)
    return payload.result as T
  }
}
