/**
 * Channel abstraction and supervision.
 *
 * A channel is one messaging transport (Feishu today; Telegram/DingTalk/WeCom
 * later). Everything that can fail lives behind `ChannelTransport`, so routing,
 * restart policy and health can be tested without a real bot token.
 *
 * Three boundaries:
 * 1. Inbound messages are routed by channel name. An unrouted channel drops the
 *    message and records a counter — never guesses a default handler.
 * 2. A restart only reconnects; it does not replay messages. Replaying an inbound
 *    message would execute a user action twice.
 * 3. Health is explicit: `ready` requires a completed connect, and `failed` is
 *    terminal until someone calls `start` again.
 */

export type InboundMessage = {
  /** Stable per-transport conversation key (chat id, thread id, ...). */
  conversation: string
  text: string
  senderID?: string
  /** Provider message id, useful for de-duplication by the router. */
  messageID?: string
}

export type ReplyTarget = { conversation: string; replyTo?: string }

export type ChannelTransport = {
  connect(): Promise<void>
  disconnect(): Promise<void>
  send(target: ReplyTarget, text: string): Promise<void>
  /** The transport calls this once per inbound message. */
  onMessage(handler: (message: InboundMessage) => void): void
}

export type ChannelState = "stopped" | "connecting" | "ready" | "restarting" | "failed"

export type ChannelHealth = {
  name: string
  kind: string
  state: ChannelState
  restarts: number
  lastError?: string
  connectedAt?: number
}

export type Route = (message: InboundMessage, channel: ChannelHandle) => Promise<void>

export type ChannelHandle = {
  name: string
  kind: string
  send(text: string, target?: ReplyTarget): Promise<void>
  status(): ChannelHealth
}

type Entry = {
  name: string
  kind: string
  transport: ChannelTransport
  route?: Route
  state: ChannelState
  restarts: number
  lastError?: string
  connectedAt?: number
  dropped: number
}

export type SupervisorOptions = {
  maxRestarts?: number
  /** Injectable so tests don't need real time. Defaults to a growing backoff. */
  delay?: (attempt: number) => Promise<void>
  onEvent?: (
    event:
      | { type: "connected"; name: string }
      | { type: "disconnected"; name: string; error?: string }
      | { type: "restart"; name: string; attempt: number }
      | { type: "failed"; name: string; error: string }
      | { type: "dropped"; name: string },
  ) => void
}

const defaultDelay = (attempt: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, Math.min(1_000 * 2 ** attempt, 30_000)))

export class Supervisor {
  private entries = new Map<string, Entry>()
  private readonly maxRestarts: number
  private readonly delay: (attempt: number) => Promise<void>

  constructor(private readonly options: SupervisorOptions = {}) {
    this.maxRestarts = Math.max(0, options.maxRestarts ?? 3)
    this.delay = options.delay ?? defaultDelay
  }

  add(input: { name: string; kind: string; transport: ChannelTransport; route?: Route }) {
    if (!input.name.trim()) throw new Error("channel name must not be empty")
    if (this.entries.has(input.name)) throw new Error(`channel already registered: ${input.name}`)
    const entry: Entry = {
      name: input.name,
      kind: input.kind,
      transport: input.transport,
      route: input.route,
      state: "stopped",
      restarts: 0,
      dropped: 0,
    }
    this.entries.set(input.name, entry)
    input.transport.onMessage((message) => this.dispatch(entry, message))
    return this.handle(entry)
  }

  /** Connect every registered channel, or just the named one. */
  async start(name?: string) {
    const entries = name ? [this.entry(name)] : [...this.entries.values()]
    await Promise.all(entries.map((entry) => this.connect(entry)))
  }

  /** Stop every channel; errors are recorded but never thrown on shutdown. */
  async stop() {
    await Promise.all(
      [...this.entries.values()].map(async (entry) => {
        if (entry.state === "stopped") return
        try {
          await entry.transport.disconnect()
        } catch (error) {
          entry.lastError = reason(error)
        }
        entry.state = "stopped"
        entry.connectedAt = undefined
        this.options.onEvent?.({ type: "disconnected", name: entry.name })
      }),
    )
  }

  health(): ChannelHealth[] {
    return [...this.entries.values()].map((entry) => ({
      name: entry.name,
      kind: entry.kind,
      state: entry.state,
      restarts: entry.restarts,
      ...(entry.lastError ? { lastError: entry.lastError } : {}),
      ...(entry.connectedAt ? { connectedAt: entry.connectedAt } : {}),
    }))
  }

  /** Number of inbound messages dropped because no route was registered. */
  dropped(name: string) {
    return this.entry(name).dropped
  }

  async send(name: string, text: string, target?: ReplyTarget) {
    await this.entry(name).transport.send(target ?? { conversation: "default" }, text)
  }

  private entry(name: string) {
    const entry = this.entries.get(name)
    if (!entry) throw new Error(`unknown channel: ${name}`)
    return entry
  }

  private handle(entry: Entry): ChannelHandle {
    return {
      name: entry.name,
      kind: entry.kind,
      send: (text, target) => entry.transport.send(target ?? { conversation: "default" }, text),
      status: () => ({
        name: entry.name,
        kind: entry.kind,
        state: entry.state,
        restarts: entry.restarts,
        ...(entry.lastError ? { lastError: entry.lastError } : {}),
        ...(entry.connectedAt ? { connectedAt: entry.connectedAt } : {}),
      }),
    }
  }

  private async connect(entry: Entry) {
    entry.state = "connecting"
    try {
      await entry.transport.connect()
      entry.state = "ready"
      entry.connectedAt = Date.now()
      entry.lastError = undefined
      this.options.onEvent?.({ type: "connected", name: entry.name })
    } catch (error) {
      entry.state = "failed"
      entry.lastError = reason(error)
      this.options.onEvent?.({ type: "failed", name: entry.name, error: entry.lastError })
      throw error
    }
  }

  private async dispatch(entry: Entry, message: InboundMessage) {
    if (!entry.route) {
      entry.dropped += 1
      this.options.onEvent?.({ type: "dropped", name: entry.name })
      return
    }
    if (entry.state !== "ready") {
      entry.dropped += 1
      this.options.onEvent?.({ type: "dropped", name: entry.name })
      return
    }
    try {
      await entry.route(message, this.handle(entry))
    } catch (error) {
      // A failed handler must not take the transport down; the message is already
      // consumed, so retrying it here would duplicate the user's action.
      entry.lastError = reason(error)
      this.options.onEvent?.({ type: "disconnected", name: entry.name, error: entry.lastError })
    }
  }

  /**
   * Reconnect a channel. `reconnect` is exposed separately from `start` so a
   * health check can trigger it without resetting the restart budget.
   */
  async reconnect(name: string) {
    const entry = this.entry(name)
    if (entry.restarts >= this.maxRestarts) {
      // Refusing a reconnect must not kill a channel that is still connected.
      entry.lastError = "restart budget exhausted"
      this.options.onEvent?.({ type: "failed", name: entry.name, error: entry.lastError })
      return false
    }
    entry.state = "restarting"
    entry.restarts += 1
    this.options.onEvent?.({ type: "restart", name: entry.name, attempt: entry.restarts })
    await this.delay(entry.restarts - 1)
    try {
      await entry.transport.disconnect().catch(() => {})
      await entry.transport.connect()
      entry.state = "ready"
      entry.connectedAt = Date.now()
      entry.lastError = undefined
      this.options.onEvent?.({ type: "connected", name: entry.name })
      return true
    } catch (error) {
      entry.state = "failed"
      entry.lastError = reason(error)
      this.options.onEvent?.({ type: "failed", name: entry.name, error: entry.lastError })
      return false
    }
  }
}

function reason(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

export * as Channel from "./channel"
