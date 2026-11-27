import type { Event } from "@novaway/sdk/v2/client"

type QueuedEvent = { directory: string; payload: Event; chunks?: string[] }

/** Compact adjacent packets only. A snapshot/removal is an ordering boundary, not a reason to discard its tail. */
export function createStreamEventQueue() {
  let pending: QueuedEvent[] = []

  return {
    push(directory: string, payload: Event) {
      const last = pending.at(-1)
      if (last?.directory === directory) {
        const previous = last.payload
        if (payload.type === "message.part.delta" && previous.type === "message.part.delta") {
          const a = previous.properties
          const b = payload.properties
          if (a.sessionID === b.sessionID && a.messageID === b.messageID && a.partID === b.partID && a.field === b.field) {
            const chunks = (last.chunks ??= [a.delta])
            chunks.push(b.delta)
            return
          }
        }
        if (
          (payload.type === "lsp.updated" && previous.type === "lsp.updated") ||
          (payload.type === "message.part.updated" && previous.type === "message.part.updated" &&
            payload.properties.part.sessionID === previous.properties.part.sessionID &&
            payload.properties.part.messageID === previous.properties.part.messageID &&
            payload.properties.part.id === previous.properties.part.id)
        ) {
          last.payload = payload
          return
        }
      }
      pending.push({ directory, payload })
    },
    take(): readonly QueuedEvent[] {
      const events = pending
      pending = []
      for (const event of events) {
        const { payload, chunks } = event
        if (chunks && payload.type === "message.part.delta") {
          event.payload = { ...payload, properties: { ...payload.properties, delta: chunks.join("") } }
          event.chunks = undefined
        }
      }
      return events
    },
  }
}

const scheduleTimeout = (callback: () => void, delay: number) => {
  const timer = setTimeout(callback, delay)
  return () => clearTimeout(timer)
}

/** Record activity without cancelling and reallocating the watchdog on every SSE packet. */
export function createStreamHeartbeat(input: {
  timeoutMs: number
  onTimeout: () => void
  now?: () => number
  schedule?: (callback: () => void, delay: number) => () => void
}) {
  const now = input.now ?? Date.now
  const schedule = input.schedule ?? scheduleTimeout
  let lastActivity = now()
  let cancel: (() => void) | undefined
  const remaining = () => input.timeoutMs - (now() - lastActivity)
  const expired = () => remaining() <= 0
  const arm = () => {
    cancel = schedule(() => {
      cancel = undefined
      if (expired()) input.onTimeout()
      else arm()
    }, Math.min(input.timeoutMs, Math.max(1, remaining())))
  }
  return {
    received() {
      lastActivity = now()
      if (!cancel) arm()
    },
    expired,
    stop() {
      cancel?.()
      cancel = undefined
    },
  }
}
