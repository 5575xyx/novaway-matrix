import { describe, expect, test } from "bun:test"
import { setTimeout as sleep } from "node:timers/promises"
import { SessionRetry } from "../../src/session/retry"
import { StreamWatchdog } from "../../src/session/stream-watchdog"

type Ev = { type: string; toolCallId?: string }

/** 逐个产出事件，每个事件之间可以插入延迟；`closed` 用来断言上游被关闭。 */
async function* source(events: Array<Ev | { wait: number }>, closed?: { value: boolean }) {
  try {
    for (const item of events) {
      if ("wait" in item) {
        await sleep(item.wait)
        continue
      }
      yield item
    }
  } finally {
    if (closed) closed.value = true
  }
}

async function collect(iterable: AsyncIterable<Ev>) {
  const out: Ev[] = []
  for await (const item of iterable) out.push(item)
  return out
}

async function waitUntil(predicate: () => boolean, timeoutMs = 1_000) {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("condition not met before timeout")
    await sleep(10)
  }
}

/** 断言迭代到什么错误为止；返回错误对象，方便逐字段看。 */
async function failure(iterable: AsyncIterable<Ev>) {
  try {
    await collect(iterable)
  } catch (error) {
    return error
  }
  throw new Error("expected the stream to fail")
}

describe("stream-watchdog", () => {
  test("passes events through unchanged", async () => {
    const events = [{ type: "start-step" }, { type: "text-delta" }, { type: "finish-step" }]
    expect(await collect(StreamWatchdog.withWatchdog(source(events), { idleMs: 1_000 }))).toEqual(events)
  })

  test("idleMs <= 0 disables the watchdog", async () => {
    const events = [{ type: "text-delta" }]
    const input = source(events)
    expect(StreamWatchdog.withWatchdog(input, { idleMs: 0 })).toBe(input)
  })

  test("aborts a stream that stays silent", async () => {
    const closed = { value: false }
    const error = await failure(
      StreamWatchdog.withWatchdog(source([{ wait: 500 }, { type: "text-delta" }], closed), { idleMs: 50 }),
    )
    expect(error).toBeInstanceOf(StreamWatchdog.IdleTimeout)
    expect(error instanceof Error && error.message).toContain("no chunks received")
    // 关闭上游是「发出就不等」的：中断时上游可能正卡在 next() 上，
    // await 会把中断一起卡死。所以这里轮询，而不是同步断言。
    await waitUntil(() => closed.value)
  })

  test("keeps waiting while a tool call is outstanding", async () => {
    // 工具执行期间没有事件是正常的：长命令不能被误杀。
    const events: Array<Ev | { wait: number }> = [
      { type: "tool-call", toolCallId: "call-1" },
      { wait: 150 },
      { type: "tool-result", toolCallId: "call-1" },
      { type: "finish-step" },
    ]
    const out = await collect(StreamWatchdog.withWatchdog(source(events), { idleMs: 50 }))
    expect(out.map((item) => item.type)).toEqual(["tool-call", "tool-result", "finish-step"])
  })

  test("resumes the idle timer once the tool result arrives", async () => {
    const events: Array<Ev | { wait: number }> = [
      { type: "tool-call", toolCallId: "call-1" },
      { type: "tool-result", toolCallId: "call-1" },
      { wait: 500 },
      { type: "finish-step" },
    ]
    const error = await failure(StreamWatchdog.withWatchdog(source(events), { idleMs: 50 }))
    expect(error).toBeInstanceOf(StreamWatchdog.IdleTimeout)
  })

  test("rejects a stream that ends without any event", async () => {
    const error = await failure(StreamWatchdog.withWatchdog(source([]), { idleMs: 1_000 }))
    expect(error).toBeInstanceOf(StreamWatchdog.EmptyStream)
  })

  test("rejects a truncated stream with neither content nor finish reason", async () => {
    const error = await failure(StreamWatchdog.withWatchdog(source([{ type: "start-step" }]), { idleMs: 1_000 }))
    expect(error).toBeInstanceOf(StreamWatchdog.IncompleteStream)
  })

  test("accepts a legitimately empty response that still finished", async () => {
    // 例如结构化输出第二轮：没有正文，但有 finish-step。
    const events = [{ type: "start-step" }, { type: "finish-step" }]
    expect(await collect(StreamWatchdog.withWatchdog(source(events), { idleMs: 1_000 }))).toEqual(events)
  })

  test("accepts a stream that errored instead of finishing", async () => {
    const events = [{ type: "start-step" }, { type: "error" }]
    expect(await collect(StreamWatchdog.withWatchdog(source(events), { idleMs: 1_000 }))).toEqual(events)
  })

  test("reports stalls without aborting", async () => {
    const stalls: Array<{ gapMs: number; type: string }> = []
    const events: Array<Ev | { wait: number }> = [{ type: "start-step" }, { wait: 80 }, { type: "finish-step" }]
    await collect(
      StreamWatchdog.withWatchdog(source(events), {
        idleMs: 1_000,
        stallMs: 30,
        onStall: (info) => stalls.push(info),
      }),
    )
    expect(stalls).toHaveLength(1)
    expect(stalls[0]?.type).toBe("finish-step")
    expect(stalls[0]?.gapMs ?? 0).toBeGreaterThanOrEqual(70)
  })

  test("propagates upstream errors unchanged", async () => {
    const boom = new Error("boom")
    const broken = {
      async *[Symbol.asyncIterator]() {
        yield { type: "start-step" }
        throw boom
      },
    }
    expect(await failure(StreamWatchdog.withWatchdog(broken, { idleMs: 1_000 }))).toBe(boom)
  })

  test("watchdog errors are retried as transport failures", () => {
    const idle = new StreamWatchdog.IdleTimeout(90_000)
    // `retryable()` 只读 `error.data.message`，喂一个最小形状就够了。
    const parse = (error: unknown) => ({
      name: "UnknownError",
      data: { message: error instanceof Error ? error.message : String(error) },
    })
    expect(SessionRetry.retryable(parse(idle), "test")).toMatchObject({ kind: "transport" })
    expect(SessionRetry.retryable(parse(new StreamWatchdog.EmptyStream()), "test")).toMatchObject({
      kind: "transport",
    })
    expect(SessionRetry.retryable(parse(new StreamWatchdog.IncompleteStream()), "test")).toMatchObject({
      kind: "transport",
    })
  })
})
