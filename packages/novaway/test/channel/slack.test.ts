import { describe, expect, test } from "bun:test"
import { SlackTransport } from "@/channel/transports/slack"

function fakeFetch(responses: Array<{ status?: number; body: unknown }>) {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init })
    const next = responses.shift() ?? { body: { ok: true } }
    return new Response(JSON.stringify(next.body), { status: next.status ?? 200 })
  }) as typeof globalThis.fetch
  return { fetch, calls }
}

describe("slack transport", () => {
  test("posts to chat.postMessage with the bot token and thread", async () => {
    const fake = fakeFetch([{ body: { ok: true } }])
    const transport = new SlackTransport({ botToken: "xoxb-test", fetch: fake.fetch })

    await transport.send({ conversation: "C123", replyTo: "1700000000.000100" }, "hello")

    expect(fake.calls).toHaveLength(1)
    expect(fake.calls[0].url).toBe("https://slack.com/api/chat.postMessage")
    expect(fake.calls[0].init?.method).toBe("POST")
    expect(fake.calls[0].init?.headers).toEqual({
      authorization: "Bearer xoxb-test",
      "content-type": "application/json",
    })
    expect(JSON.parse(String(fake.calls[0].init?.body))).toEqual({
      channel: "C123",
      text: "hello",
      thread_ts: "1700000000.000100",
    })
  })

  test("surfaces Slack API errors instead of reporting success", async () => {
    const fake = fakeFetch([{ body: { ok: false, error: "channel_not_found" } }])
    const transport = new SlackTransport({ botToken: "xoxb-test", fetch: fake.fetch })

    await expect(transport.send({ conversation: "C404" }, "hello")).rejects.toThrow("channel_not_found")
  })

  test("requires an inbound port because Slack pushes events over HTTP", async () => {
    const transport = new SlackTransport({ botToken: "xoxb-test" })
    await expect(transport.connect()).rejects.toThrow("inbound port")
  })
})
