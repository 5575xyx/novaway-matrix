import type { NormalizedMessage } from "@larksuiteoapi/node-sdk"
import { FeishuReplyClient } from "@/office/feishu"
import type { ChannelTransport, InboundMessage, ReplyTarget } from "../channel"

/**
 * Feishu/Lark adapter over the existing office reply client.
 *
 * The office client owns one websocket per app credential and fans messages out
 * to every attached client, so wrapping it keeps a single connection even when
 * several channels share the same app.
 */
export class FeishuTransport implements ChannelTransport {
  private readonly client = new FeishuReplyClient()
  private handler?: (message: InboundMessage) => void

  constructor(private readonly options: { appId: string; appSecret: string; userId?: string }) {}

  async connect() {
    await this.client.start({
      appId: this.options.appId,
      appSecret: this.options.appSecret,
      ...(this.options.userId ? { userId: this.options.userId } : {}),
      onMessage: (message) => this.emit(message),
    })
  }

  async disconnect() {
    await this.client.stop()
  }

  async send(target: ReplyTarget, text: string) {
    await this.client.send(
      target.conversation,
      text,
      undefined,
      target.replyTo ? { replyTo: target.replyTo, replyInThread: true } : undefined,
    )
  }

  onMessage(handler: (message: InboundMessage) => void) {
    this.handler = handler
  }

  private emit(message: NormalizedMessage) {
    this.handler?.({
      conversation: message.chatId,
      text: message.content,
      senderID: message.senderId,
      messageID: message.messageId,
    })
  }
}
