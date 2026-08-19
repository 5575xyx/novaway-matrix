import {
  createLarkChannel,
  type LarkChannel,
  type LarkChannelError,
  type NormalizedMessage,
  type SendOptions,
} from "@larksuiteoapi/node-sdk"

export type FeishuReplyRoute = {
  directory: string
  sessionID: string
  questionRequestID?: string
  questions?: ReadonlyArray<{
    header?: string
    question?: string
    multiple?: boolean
    custom?: boolean
    options: ReadonlyArray<{
      label: string
      description: string
    }>
  }>
}

export type FeishuMessageHandler = (message: NormalizedMessage) => void | Promise<void>

export type FeishuReplyClientOptions = {
  appId: string
  appSecret: string
  userId?: string
  onMessage: FeishuMessageHandler
  onError?: (error: LarkChannelError) => void
}

type SharedConnection = {
  key: string
  appId: string
  appSecret: string
  channel?: LarkChannel
  started: boolean
  connecting?: Promise<void>
  clients: Set<FeishuReplyClient>
  userId?: string
}

const sharedConnections = new Map<string, SharedConnection>()

function credentialKey(appId: string, appSecret: string) {
  return `${appId.trim()}\n${appSecret.trim()}`
}

async function ensureSharedStarted(shared: SharedConnection) {
  if (shared.connecting) return shared.connecting
  shared.connecting = (async () => {
    const channel = createLarkChannel({
      appId: shared.appId,
      appSecret: shared.appSecret,
      transport: "websocket",
      policy: {
        dmMode: "open",
        requireMention: false,
      },
      safety: {
        dedup: { ttl: 5_000 },
      },
      includeRawEvent: true,
      source: "novaway-office",
    })

    channel.on("message", (message) => {
      if (!shared.userId) {
        const primary = shared.clients.values().next().value
        if (primary) void primary.handleChannelMessage(message)
        return
      }
      for (const client of shared.clients) {
        void client.handleChannelMessage(message)
      }
    })
    channel.on("error", (error) => {
      for (const client of shared.clients) {
        client.handleChannelError(error)
      }
    })

    shared.channel = channel
    try {
      await channel.connect()
      shared.started = true
    } catch (error) {
      shared.channel = undefined
      shared.started = false
      throw error
    } finally {
      shared.connecting = undefined
    }
  })()
  return shared.connecting
}

export class FeishuReplyClient {
  readonly routes = new Map<string, FeishuReplyRoute>()
  private shared?: SharedConnection
  private messageHandler?: FeishuMessageHandler
  private errorHandler?: (error: LarkChannelError) => void

  get userId() {
    return this.shared?.userId
  }

  get isStarted() {
    return this.shared?.started ?? false
  }

  async start(options: FeishuReplyClientOptions) {
    const key = credentialKey(options.appId, options.appSecret)
    let shared = sharedConnections.get(key)
    if (!shared) {
      shared = {
        key,
        appId: options.appId,
        appSecret: options.appSecret,
        started: false,
        clients: new Set(),
      }
      sharedConnections.set(key, shared)
    }
    this.shared = shared
    this.messageHandler = options.onMessage
    this.errorHandler = options.onError
    if (options.userId?.trim()) shared.userId = options.userId.trim()
    shared.clients.add(this)
    if (!shared.started) {
      await ensureSharedStarted(shared)
    }
  }

  async stop() {
    const shared = this.shared
    this.shared = undefined
    this.messageHandler = undefined
    this.errorHandler = undefined
    this.routes.clear()
    if (!shared) return
    shared.clients.delete(this)
    if (shared.clients.size > 0) return
    sharedConnections.delete(shared.key)
    if (shared.channel && shared.started) {
      await shared.channel.disconnect().catch(() => {})
    }
    shared.started = false
    shared.channel = undefined
  }

  setUserId(userId: string) {
    if (!this.shared) return
    this.shared.userId = userId.trim() || undefined
  }

  handleChannelMessage(message: NormalizedMessage) {
    if (this.shared?.userId && message.senderId !== this.shared.userId) return
    void Promise.resolve(this.messageHandler?.(message)).catch((error) => {
      console.error("[feishu] shared channel message handler failed", error)
    })
  }

  handleChannelError(error: LarkChannelError) {
    this.errorHandler?.(error)
  }

  async send(userId: string, text: string, route?: FeishuReplyRoute, options?: SendOptions) {
    if (!this.shared?.started || !this.shared.channel) return undefined
    const result = await this.shared.channel.send(userId, { text }, options)
    if (route) this.routes.set(result.messageId, route)
    return result.messageId
  }
}
