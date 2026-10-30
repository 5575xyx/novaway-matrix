/**
 * 流空闲看门狗。
 *
 * 为什么需要：供应商 SDK 的请求超时只覆盖「建立连接 + 拿到响应头」，不覆盖响应体。
 * 代理把连接静默掐掉、或者返回 200 但根本不是一个 SSE 流时，`for await` 会一直
 * 挂着 —— 会话表现为「永远在思考」，用户既看不到进度也没法重试。
 *
 * 与 CC 的差异（`services/api/claude.ts` 的 STREAM_IDLE_TIMEOUT_MS）：
 * CC 的工具在流之外并发执行，所以可以无脑按「90 秒没有 chunk 就中止」；
 * 我们的工具在 `streamText` 的 `fullStream` 内部同步执行，长命令跑着的时候
 * 本来就不会有 chunk。直接照搬会把 `bun test` 这类命令误杀。
 * 因此这里按**未完成的工具调用**把计时器挂起：模型在思考（没有在跑工具）时
 * 才受空闲上限约束，工具执行期间由工具自己的 timeout 负责。
 *
 * 实现上刻意不用 async generator：生成器被中断时只能先把眼前的 `await` 走完，
 * 那会让「用户点停止」等到下一次超时才生效。这里手写迭代器，`return()` 能
 * 立刻结束正在等待的 `next()`。
 */

/** 默认空闲上限（对齐 CC 的 `CLAUDE_STREAM_IDLE_TIMEOUT_MS`，90 秒）。 */
export const DEFAULT_IDLE_MS = 90_000

/** 相邻两个事件的间隔超过这个值时记一条 stall 日志（不中止）。 */
export const DEFAULT_STALL_MS = 30_000

/** 只依赖 `type`，不绑定 AI SDK 的具体事件联合类型。 */
export type Event = { type: string; toolCallId?: string }

export class IdleTimeout extends Error {
  constructor(readonly idleMs: number) {
    super(`Stream idle timeout - no chunks received for ${Math.round(idleMs / 1000)}s`)
    this.name = "StreamIdleTimeoutError"
  }
}

/** 流一个事件都没吐就结束了：典型是代理返回 200 + 非 SSE 正文。 */
export class EmptyStream extends Error {
  constructor() {
    super("Stream ended without receiving any events")
    this.name = "StreamEmptyError"
  }
}

/** 有事件但既没有内容也没有结束原因：流中途被截断。 */
export class IncompleteStream extends Error {
  constructor() {
    super("Stream ended before producing any content or finish reason")
    this.name = "StreamIncompleteError"
  }
}

export type Options = {
  /** ≤ 0 表示关闭看门狗。 */
  idleMs: number
  /** 相邻事件间隔超过此值记一条 stall；≤ 0 关闭。 */
  stallMs?: number
  onStall?: (input: { gapMs: number; type: string }) => void
}

const TERMINAL = new Set(["finish-step", "finish", "error", "abort"])
const CONTENT = new Set(["text-delta", "reasoning-delta", "tool-call", "tool-result", "file", "source"])
const SETTLED = new Set(["tool-result", "tool-error", "tool-output-denied"])

export function withWatchdog<T extends Event>(source: AsyncIterable<T>, options: Options): AsyncIterable<T> {
  if (options.idleMs <= 0) return source
  const idleMs = options.idleMs
  const stallMs = options.stallMs ?? DEFAULT_STALL_MS

  return {
    [Symbol.asyncIterator]() {
      const upstream = source[Symbol.asyncIterator]()
      // 已经发出 tool-call 但还没拿到结果的调用。非空表示「模型在等工具」，
      // 此时没有 chunk 是正常的，暂停空闲计时。
      const pending = new Set<string>()
      const stats = { events: 0, content: 0, terminal: false, last: Date.now() }
      // 正在等待的 next() 的结束入口：超时或 return() 用它立刻结束等待。
      let stop: ((error?: unknown) => void) | undefined
      let closed = false

      const close = () => {
        if (closed) return
        closed = true
        stop?.()
        stop = undefined
        // 上游也要关掉，否则 HTTP 连接会挂到进程退出。不等它：中断场景下它可能
        // 本身就在等一个永远不会来的 chunk，await 会把中断一起卡住。
        void Promise.resolve(upstream.return?.()).catch(() => {})
      }

      const awaitNext = () =>
        new Promise<IteratorResult<T>>((resolve, reject) => {
          let settled = false
          const settle = (finish: () => void) => {
            if (settled) return
            settled = true
            stop = undefined
            clearTimeout(timer)
            finish()
          }
          stop = (error) =>
            settle(() => (error === undefined ? resolve({ done: true, value: undefined }) : reject(error)))
          const timer = pending.size > 0 ? undefined : setTimeout(() => stop?.(new IdleTimeout(idleMs)), idleMs)
          upstream.next().then(
            (result) => settle(() => resolve(result)),
            (error) => settle(() => reject(error)),
          )
        })

      const observe = (event: T) => {
        const now = Date.now()
        if (stallMs > 0 && stats.events > 0 && now - stats.last > stallMs)
          options.onStall?.({ gapMs: now - stats.last, type: event.type })
        stats.last = now
        stats.events++
        if (TERMINAL.has(event.type)) stats.terminal = true
        if (CONTENT.has(event.type)) stats.content++
        if (event.type === "tool-call" && event.toolCallId) pending.add(event.toolCallId)
        else if (SETTLED.has(event.type) && event.toolCallId) pending.delete(event.toolCallId)
      }

      return {
        async next(): Promise<IteratorResult<T>> {
          if (closed) return { done: true, value: undefined }
          const result = await awaitNext().catch((error) => {
            close()
            throw error
          })
          if (result.done) {
            closed = true
            if (stats.events === 0) throw new EmptyStream()
            if (!stats.terminal && stats.content === 0) throw new IncompleteStream()
            return { done: true, value: undefined }
          }
          observe(result.value)
          return result
        },
        async return(): Promise<IteratorResult<T>> {
          close()
          return { done: true, value: undefined }
        },
      }
    },
  }
}

export * as StreamWatchdog from "./stream-watchdog"
