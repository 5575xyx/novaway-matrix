import { describe, expect, test } from "bun:test"
import { Supervisor, type ChannelTransport, type InboundMessage } from "@/channel/channel"

function fakeTransport(options: { failConnect?: number } = {}) {
  let handler: ((message: InboundMessage) => void) | undefined
  const sent: Array<{ conversation: string; text: string }> = []
  let connects = 0
  let disconnects = 0
  let failures = options.failConnect ?? 0

  const transport: ChannelTransport = {
    async connect() {
      connects += 1
      if (failures > 0) {
        failures -= 1
        throw new Error("connect refused")
      }
    },
    async disconnect() {
      disconnects += 1
    },
    async send(target, text) {
      sent.push({ conversation: target.conversation, text })
    },
    onMessage(next) {
      handler = next
    },
  }

  return {
    transport,
    sent,
    connects: () => connects,
    disconnects: () => disconnects,
    emit: (message: InboundMessage) => handler?.(message),
  }
}

const noDelay = async () => {}

describe("channel supervisor", () => {
  test("starts channels and reports ready health", async () => {
    const fake = fakeTransport()
    const supervisor = new Supervisor({ delay: noDelay })
    supervisor.add({ name: "feishu-main", kind: "feishu", transport: fake.transport })

    const health = supervisor.health()
    expect(health[0].state).toBe("stopped")
    await supervisor.start()
    expect(fake.connects()).toBe(1)
    expect(supervisor.health()[0].state).toBe("ready")
    expect(supervisor.health()[0].connectedAt).toBeNumber()
  })

  test("routes inbound messages per channel and never to a different channel", async () => {
    const feishu = fakeTransport()
    const telegram = fakeTransport()
    const supervisor = new Supervisor({ delay: noDelay })
    supervisor.add({
      name: "feishu",
      kind: "feishu",
      transport: feishu.transport,
      route: async (message, channel) => {
        await channel.send(`echo:${message.text}`, { conversation: message.conversation })
      },
    })
    supervisor.add({
      name: "telegram",
      kind: "telegram",
      transport: telegram.transport,
      route: async (message) => {
        telegram.sent.push({ conversation: "telegram-route", text: message.text })
      },
    })
    await supervisor.start()

    feishu.emit({ conversation: "chat-1", text: "hello" })
    telegram.emit({ conversation: "chat-2", text: "world" })
    await Promise.resolve()
    await Promise.resolve()

    expect(feishu.sent).toEqual([{ conversation: "chat-1", text: "echo:hello" }])
    expect(telegram.sent).toEqual([{ conversation: "telegram-route", text: "world" }])
  })

  test("drops inbound messages when a channel has no route", async () => {
    const fake = fakeTransport()
    const events: string[] = []
    const supervisor = new Supervisor({ delay: noDelay, onEvent: (event) => events.push(event.type) })
    supervisor.add({ name: "unrouted", kind: "telegram", transport: fake.transport })
    await supervisor.start()

    fake.emit({ conversation: "c", text: "hi" })
    await Promise.resolve()

    expect(supervisor.dropped("unrouted")).toBe(1)
    expect(events).toContain("dropped")
  })

  test("reconnects within the restart budget and then fails terminally", async () => {
    const fake = fakeTransport()
    const events: string[] = []
    const supervisor = new Supervisor({ maxRestarts: 2, delay: noDelay, onEvent: (event) => events.push(event.type) })
    supervisor.add({ name: "flaky", kind: "feishu", transport: fake.transport })
    await supervisor.start()

    expect(await supervisor.reconnect("flaky")).toBe(true)
    expect(supervisor.health()[0].restarts).toBe(1)
    expect(await supervisor.reconnect("flaky")).toBe(true)
    expect(supervisor.health()[0].restarts).toBe(2)
    expect(await supervisor.reconnect("flaky")).toBe(false)
    expect(supervisor.health()[0].state).toBe("ready")
    expect(events.filter((item) => item === "restart")).toHaveLength(2)
  })

  test("start surfaces a connect error and leaves the channel failed", async () => {
    const fake = fakeTransport({ failConnect: 1 })
    const supervisor = new Supervisor({ delay: noDelay })
    supervisor.add({ name: "broken", kind: "wecom", transport: fake.transport })

    await expect(supervisor.start()).rejects.toThrow("connect refused")
    expect(supervisor.health()[0].state).toBe("failed")
    expect(supervisor.health()[0].lastError).toContain("connect refused")
  })

  test("stop disconnects every started channel and rejects duplicate names", async () => {
    const fake = fakeTransport()
    const supervisor = new Supervisor({ delay: noDelay })
    supervisor.add({ name: "a", kind: "feishu", transport: fake.transport })
    expect(() => supervisor.add({ name: "a", kind: "feishu", transport: fake.transport })).toThrow("already registered")

    await supervisor.start()
    await supervisor.stop()
    expect(fake.disconnects()).toBe(1)
    expect(supervisor.health()[0].state).toBe("stopped")
  })

  test("a failing route does not take the channel down", async () => {
    const fake = fakeTransport()
    const supervisor = new Supervisor({ delay: noDelay })
    supervisor.add({
      name: "r",
      kind: "feishu",
      transport: fake.transport,
      route: async () => {
        throw new Error("handler boom")
      },
    })
    await supervisor.start()
    fake.emit({ conversation: "c", text: "hi" })
    await Promise.resolve()
    await Promise.resolve()

    expect(supervisor.health()[0].state).toBe("ready")
    expect(supervisor.health()[0].lastError).toBe("handler boom")
  })
})
