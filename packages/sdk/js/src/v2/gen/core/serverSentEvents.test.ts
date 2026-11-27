import { describe, expect, test } from "bun:test"
import { createSseClient } from "./serverSentEvents.gen.js"

function responseFrom(chunks: string[]) {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder()
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
        controller.close()
      },
    }),
    { headers: { "Content-Type": "text/event-stream" } },
  )
}

describe("v2 SSE stream decoder", () => {
  test("normalizes CRLF split across reads and emits multiple frames", async () => {
    const received: unknown[] = []
    const events: unknown[] = []
    const client = createSseClient({
      url: "http://localhost/events",
      fetch: (async () => responseFrom(["id: 1\r", "\nevent: update\r\ndata: {\"value\":1}\r\n\r\ndata: {\"value\":2}\n\n"])) as unknown as typeof fetch,
      onSseEvent: (event) => events.push(event),
    })
    for await (const event of client.stream) received.push(event)
    expect(received).toEqual([{ value: 1 }, { value: 2 }])
    expect(events).toEqual([
      { data: { value: 1 }, event: "update", id: "1", retry: 3000 },
      { data: { value: 2 }, event: undefined, id: "1", retry: 3000 },
    ])
  })

  test("parses consecutive single-line JSON data frames", async () => {
    const received: unknown[] = []
    const client = createSseClient({
      url: "http://localhost/events",
      fetch: (async () => responseFrom(['data: {"value":1}\n\ndata: {"value":2}\n\n'])) as unknown as typeof fetch,
    })
    for await (const event of client.stream) received.push(event)
    expect(received).toEqual([{ value: 1 }, { value: 2 }])
  })

  test("joins multiline data and normalizes lone CR line endings", async () => {
    const received: unknown[] = []
    const client = createSseClient({
      url: "http://localhost/events",
      fetch: (async () => responseFrom(["data: first\rdata: second\r\r"])) as unknown as typeof fetch,
    })
    for await (const event of client.stream) received.push(event)
    expect(received).toEqual(["first\nsecond"])
  })
})
