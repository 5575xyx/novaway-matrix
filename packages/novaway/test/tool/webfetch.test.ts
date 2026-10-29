import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { FetchHttpClient } from "effect/unstable/http"
import { Agent } from "../../src/agent/agent"
import { Truncate } from "@/tool/truncate"
import { upgradeProtocol, WebFetchTool } from "../../src/tool/webfetch"
import { SessionID, MessageID } from "../../src/session/schema"
import { Tool } from "@/tool/tool"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.mergeAll(FetchHttpClient.layer, Truncate.defaultLayer, Agent.defaultLayer))

const ctx = {
  sessionID: SessionID.make("ses_test"),
  messageID: MessageID.make("msg_message"),
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
}

const withFetch = <A, E, R>(
  fetch: (req: Request) => Response | Promise<Response>,
  fn: (url: URL) => Effect.Effect<A, E, R>,
) =>
  Effect.acquireUseRelease(
    Effect.sync(() => Bun.serve({ port: 0, fetch })),
    (server) => fn(server.url),
    (server) => Effect.sync(() => server.stop(true)),
  )

const exec = Effect.fn("WebFetchToolTest.exec")(function* (args: Tool.InferParameters<typeof WebFetchTool>) {
  const info = yield* WebFetchTool
  const tool = yield* info.init()
  return yield* tool.execute(args, ctx)
})

const execWith = Effect.fn("WebFetchToolTest.execWith")(function* (
  context: typeof ctx,
  args: Tool.InferParameters<typeof WebFetchTool>,
) {
  const info = yield* WebFetchTool
  const tool = yield* info.init()
  return yield* tool.execute(args, context)
})

describe("tool.webfetch", () => {
  it.instance("returns image responses as file attachments", () =>
    Effect.gen(function* () {
      const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
      yield* withFetch(
        () => new Response(bytes, { status: 200, headers: { "content-type": "IMAGE/PNG; charset=binary" } }),
        (url) =>
          Effect.gen(function* () {
            const result = yield* exec({ url: new URL("/image.png", url).toString(), format: "markdown" })
            expect(result.output).toBe("Image fetched successfully")
            expect(result.attachments).toBeDefined()
            expect(result.attachments?.length).toBe(1)
            expect(result.attachments?.[0].type).toBe("file")
            expect(result.attachments?.[0].mime).toBe("image/png")
            expect(result.attachments?.[0].url.startsWith("data:image/png;base64,")).toBe(true)
            expect(result.attachments?.[0]).not.toHaveProperty("id")
            expect(result.attachments?.[0]).not.toHaveProperty("sessionID")
            expect(result.attachments?.[0]).not.toHaveProperty("messageID")
          }),
      )
    }),
  )

  it.instance("keeps svg as text output", () =>
    withFetch(
      () =>
        new Response('<svg xmlns="http://www.w3.org/2000/svg"><text>hello</text></svg>', {
          status: 200,
          headers: { "content-type": "image/svg+xml; charset=UTF-8" },
        }),
      (url) =>
        Effect.gen(function* () {
          const result = yield* exec({ url: new URL("/image.svg", url).toString(), format: "html" })
          expect(result.output).toContain("<svg")
          expect(result.attachments).toBeUndefined()
        }),
    ),
  )

  it.instance("keeps text responses as text output", () =>
    withFetch(
      () =>
        new Response("hello from webfetch", {
          status: 200,
          headers: { "content-type": "text/plain; charset=utf-8" },
        }),
      (url) =>
        Effect.gen(function* () {
          const result = yield* exec({ url: new URL("/file.txt", url).toString(), format: "text" })
          expect(result.output).toBe("hello from webfetch")
          expect(result.attachments).toBeUndefined()
        }),
    ),
  )

  it.instance("extracts text from html without scripts or styles", () =>
    withFetch(
      () =>
        new Response(
          "<html><head><style>.hidden{}</style><script>alert('x')</script></head><body>Hello <b>world</b></body></html>",
          {
            status: 200,
            headers: { "content-type": "text/html; charset=utf-8" },
          },
        ),
      (url) =>
        Effect.gen(function* () {
          const result = yield* exec({ url: new URL("/page.html", url).toString(), format: "text" })
          expect(result.output).toBe("Hello world")
          expect(result.attachments).toBeUndefined()
        }),
    ),
  )

  it.instance("serves a repeated fetch from the session cache", () =>
    Effect.gen(function* () {
      let hits = 0
      yield* withFetch(
        () => {
          hits++
          return new Response("cached body", { status: 200, headers: { "content-type": "text/plain" } })
        },
        (url) =>
          Effect.gen(function* () {
            const target = new URL("/cached.txt", url).toString()
            const first = yield* exec({ url: target, format: "text" })
            const second = yield* exec({ url: target, format: "text" })
            expect(first.output).toBe("cached body")
            expect(second.output).toBe("cached body")
            expect((second.metadata as Record<string, unknown>).cached).toBe(true)
            expect(hits).toBe(1)
          }),
      )
    }),
  )

  it.instance("caches per format and per session", () =>
    Effect.gen(function* () {
      let hits = 0
      yield* withFetch(
        () => {
          hits++
          return new Response("<b>hi</b>", { status: 200, headers: { "content-type": "text/html" } })
        },
        (url) =>
          Effect.gen(function* () {
            const target = new URL("/split.html", url).toString()
            yield* exec({ url: target, format: "text" })
            // Different format → different key → a real fetch.
            yield* exec({ url: target, format: "html" })
            expect(hits).toBe(2)

            // Different session → separate cache entry.
            const other = { ...ctx, sessionID: SessionID.make("ses_other") }
            yield* execWith(other, { url: target, format: "text" })
            expect(hits).toBe(3)
          }),
      )
    }),
  )

  it.instance("falls back to the page itself when no secondary model is available", () =>
    withFetch(
      () => new Response("page body", { status: 200, headers: { "content-type": "text/plain" } }),
      (url) =>
        Effect.gen(function* () {
          const result = yield* exec({ url: new URL("/p.txt", url).toString(), prompt: "summarize" })
          expect(result.output).toBe("page body")
          expect((result.metadata as Record<string, unknown>).processed).toBe(false)
        }),
    ),
  )

  it.instance("reports a cross-host redirect instead of following it", () =>
    withFetch(
      (req) => {
        const target = new URL(req.url)
        if (target.pathname === "/start") {
          return new Response(null, { status: 302, headers: { location: "https://example.com/landing" } })
        }
        return new Response("should not be fetched", { status: 200 })
      },
      (url) =>
        Effect.gen(function* () {
          const result = yield* exec({ url: new URL("/start", url).toString(), format: "text" })
          expect(result.output).toContain("REDIRECT DETECTED")
          expect(result.output).toContain("https://example.com/landing")
          expect((result.metadata as Record<string, unknown>).redirect).toBe("https://example.com/landing")
        }),
    ),
  )

  it.instance("follows redirects that stay on the same host", () =>
    withFetch(
      (req) => {
        const target = new URL(req.url)
        if (target.pathname === "/old") {
          return new Response(null, { status: 302, headers: { location: "/new" } })
        }
        return new Response("moved body", { status: 200, headers: { "content-type": "text/plain" } })
      },
      (url) =>
        Effect.gen(function* () {
          const result = yield* exec({ url: new URL("/old", url).toString(), format: "text" })
          expect(result.output).toBe("moved body")
        }),
    ),
  )

  it.instance("keeps localhost on http while upgrading public http URLs", () =>
    Effect.gen(function* () {
      expect(upgradeProtocol("http://localhost:3000/x")).toBe("http://localhost:3000/x")
      expect(upgradeProtocol("http://127.0.0.1:8080/x")).toBe("http://127.0.0.1:8080/x")
      expect(upgradeProtocol("http://example.com/a")).toBe("https://example.com/a")
    }),
  )
})
