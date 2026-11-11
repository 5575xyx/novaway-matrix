/**
 * 派发调度：两条规则，一条都不许少。
 *
 *   1. **一个子代理一次只答一个 ask。**
 *      子代理是一段对话，两条指令同时进去，它的转录顺序就由网络决定，而脚本假设的是发出顺序。
 *      所以同一 actor 的 ask 排队，严格 FIFO。
 *   2. **全局最多 N 个 ask 在飞。**
 *      N 是 run 自己的上界。它低于 provider 的上界，因为一次 run 很容易同时开 20 个 ask，
 *      而 20 个并发请求通常只会换来一片 429。
 *
 * 为什么这两条要写在一起：只做 (1)，扇出 50 个文件就有 50 个并发；只做 (2)，同一个子代理的
 * 指令会乱序答完。分开做会漏掉「等 A 答完才能开始 B，但 A 占着一个全局名额」这种交错。
 *
 * 排队**不**是隐藏语义：脚本没 await 就是并发，调度器只决定它们真正开始的先后，不改变结果。
 */

/** 一个待执行的任务。`actorKey` 为空表示不受单代理串行约束（world-read / report 不走这里）。 */
interface Job {
  readonly actorKey: string
  readonly run: () => Promise<unknown>
  readonly resolve: (value: unknown) => void
  readonly reject: (error: unknown) => void
}

export class AskScheduler {
  private readonly queues = new Map<string, Job[]>()
  private readonly busy = new Set<string>()
  private inFlight = 0

  constructor(private readonly maxConcurrency: number) {
    if (!Number.isFinite(maxConcurrency) || maxConcurrency < 1) {
      throw new Error(`maxConcurrency 必须是 >= 1 的有限数，收到 ${maxConcurrency}`)
    }
  }

  /** 当前在飞的数量。测试与事件用。 */
  get running(): number {
    return this.inFlight
  }

  /** 当前排队的任务数。 */
  get queued(): number {
    let total = 0
    for (const queue of this.queues.values()) total += queue.length
    return total
  }

  /**
   * 排队并执行。返回的 promise 与任务的 promise 同命运。
   *
   * 入队时**立刻**尝试泵一次：若这个 actor 空闲且全局还有名额，任务就在本轮微任务里起步，
   * 而不是等下一次事件。这让「串行脚本」的时序与直接 await 一致。
   */
  enqueue(actorKey: string, run: () => Promise<unknown>): Promise<unknown> {
    return new Promise<unknown>((resolve, reject) => {
      const job: Job = { actorKey, run, resolve, reject }
      const queue = this.queues.get(actorKey)
      if (queue) queue.push(job)
      else this.queues.set(actorKey, [job])
      this.pump()
    })
  }

  /**
   * 尝试把排队的东西放出去。
   *
   * 遍历顺序是 Map 的插入顺序，也就是「actor 第一次有任务时的顺序」。它给了一个直观的性质：
   * 早出现的子代理先拿到名额。不追求严格公平——公平调度会让「第一个子代理答完之前先给
   * 第二个子代理腾位置」这种反常行为出现，而用户看到的是「为什么我的第一批没跑」。
   */
  private pump(): void {
    if (this.inFlight >= this.maxConcurrency) return
    for (const [key, queue] of this.queues) {
      if (this.inFlight >= this.maxConcurrency) return
      if (this.busy.has(key)) continue
      const job = queue.shift()
      if (!job) continue
      if (queue.length === 0) this.queues.delete(key)

      this.busy.add(key)
      this.inFlight += 1
      // 用 Promise.resolve().then 而不是直接调用：任务的同步抛出也走拒绝路径，且
      // 让 pump 的调用点不会在「刚起步就失败」的情况下重入。
      Promise.resolve()
        .then(job.run)
        .then(
          (value) => {
            this.release(key)
            job.resolve(value)
          },
          (error) => {
            this.release(key)
            job.reject(error)
          },
        )
    }
  }

  private release(actorKey: string): void {
    this.busy.delete(actorKey)
    this.inFlight -= 1
    this.pump()
  }
}
