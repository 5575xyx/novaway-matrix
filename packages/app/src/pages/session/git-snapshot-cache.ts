/**
 * `/git` 快照的共享读取层。
 *
 * 为什么要共享：服务端一次 snapshot 要并发跑 7 个 git 子进程（status、两次
 * `diff --numstat`、branch、remote、stash、log）。客户端原本有 5 个互不相干的
 * 5s 轮询（prompt 输入框的分支按钮、Git 源代码管理、状态面板的 git 区、左栏变更
 * 清单、右侧文件树），同一目录下就会变成每 5s 35 个 git 进程，空闲聊天时机器
 * 也一直在起进程 —— Windows 上叠加 Defender 扫描，表现就是周期性卡顿。
 *
 * 这里做两件事，且只做这两件：
 * 1. **单飞**：同一 key 的并发请求合并成一次。
 * 2. **短 TTL**：TTL 内的重复读取直接复用结果，让多个轮询相位不同的调用方
 *    收敛成每个窗口一次真实请求。
 *
 * TTL 不会让数据比原来更旧：调用方本来就是 5s 轮询，TTL 取小于轮询间隔的值，
 * 语义上等价于「这一次轮询复用了上一次的结果」。用户主动操作（stage/commit/…）
 * 用的是接口直接返回的快照，不走这里。
 */

export type GitSnapshotResult<T> = { data?: T }

type Entry<T> = {
  at: number
  data?: T
  error?: unknown
  inflight?: Promise<GitSnapshotResult<T>>
}

/** 略小于 5s 轮询间隔：相位不同的调用方落在同一窗口内时只发一次请求。 */
const DEFAULT_MAX_AGE_MS = 4_000

const entries = new Map<string, Entry<unknown>>()

export function gitSnapshotKey(url: string, directory: string) {
  return `${url}\u0000${directory}`
}

export function readGitSnapshot<T>(input: {
  key: string
  load: () => Promise<GitSnapshotResult<T>>
  maxAgeMs?: number
}): Promise<GitSnapshotResult<T>> {
  const maxAge = input.maxAgeMs ?? DEFAULT_MAX_AGE_MS
  const cached = entries.get(input.key) as Entry<T> | undefined

  if (cached?.inflight) return cached.inflight
  if (cached && Date.now() - cached.at < maxAge) {
    if (cached.error !== undefined) return Promise.reject(cached.error)
    return Promise.resolve({ data: cached.data })
  }

  const entry: Entry<T> = { at: cached?.at ?? 0, data: cached?.data }
  const request = input.load().then(
    (result) => {
      entry.at = Date.now()
      entry.data = result.data
      entry.error = undefined
      entry.inflight = undefined
      return result
    },
    (error: unknown) => {
      entry.at = Date.now()
      entry.error = error
      entry.inflight = undefined
      throw error
    },
  )
  entry.inflight = request
  entries.set(input.key, entry as Entry<unknown>)
  // 共享的 promise 可能没有第二个消费者，这里挂一个空 catch，避免未处理的 rejection。
  void request.catch(() => undefined)
  return request
}

/**
 * 目录最近一次「有文件动静」的时间。
 *
 * git 快照本身没有服务端推送，但工作区的写入是有的（`file.watcher.updated`）。
 * 用写入打点判断"现在值不值得快轮询"：代理正在改文件时 5s 一问能及时反映变更，
 * 空闲时没必要每 5s 起 7 个 git 子进程 —— 降到 20s，且窗口不可见时完全不跑。
 */
const activity = new Map<string, number>()

/** 测试与「切换服务器」时清空，避免拿到另一台服务器的快照。 */
export function clearGitSnapshotCache(key?: string) {
  if (key === undefined) {
    entries.clear()
    activity.clear()
    return
  }
  entries.delete(key)
  activity.delete(key)
}

export function noteGitActivity(key: string, at = Date.now()) {
  activity.set(key, at)
  // 有写入的目录立刻把节拍换成 fast：否则当前那一拍还挂在 idle 上（最长 20s），
  // 面板刚改完的文件要等半分钟才反映出来。
  const poll = polls.get(key)
  if (!poll || poll.subs.size === 0) return
  const entry = entries.get(key)
  if (!entry || at - entry.at >= poll.fast) void fetchShared(poll)
  scheduleShared(poll)
}

export function gitActivityRecent(key: string, windowMs = 30_000, now = Date.now()) {
  const at = activity.get(key)
  return at !== undefined && now - at < windowMs
}

/**
 * 每个目录**一个**轮询器，多个消费方共享。
 *
 * 只做 TTL 复用是不够的：5 个消费方各自计时，空档相位迟早错开，20s 内还是会打满 5 次
 * 请求（35 个 git 子进程）。这里把定时器也收成一份，请求结果广播给所有订阅者：
 *
 * - 有写入打点（`noteGitActivity`）→ `fast`；完全空闲 → `idle`；
 * - 窗口不可见 → 停表，回到前台补一次；
 * - 订阅者全部退订 → 拆掉定时器与监听，不留空转。
 */
type Subscriber = { onResult: (data: unknown) => void; onError: (error: unknown) => void }

type SharedPoll = {
  key: string
  load: () => Promise<GitSnapshotResult<unknown>>
  fast: number
  idle: number
  maxAgeMs?: number
  subs: Set<Subscriber>
  timer?: ReturnType<typeof setTimeout>
  /** 当前这一拍用的间隔；`undefined` = 没排拍。 */
  wait?: number
  inflight?: Promise<void>
  stopVisibility?: () => void
}

const polls = new Map<string, SharedPoll>()

const docVisible = () => (typeof document === "undefined" ? true : document.visibilityState === "visible")

function broadcast(poll: SharedPoll, result: GitSnapshotResult<unknown>) {
  for (const sub of [...poll.subs]) sub.onResult(result.data)
}

function broadcastError(poll: SharedPoll, error: unknown) {
  for (const sub of [...poll.subs]) sub.onError(error)
}

function fetchShared(poll: SharedPoll) {
  // 单飞要在这一层做：多个订阅方各自触发时，底层缓存返回的是同一个 promise，
  // 每人都挂一次广播就会把同一份结果重复推给所有订阅者。
  if (poll.inflight) return poll.inflight
  const request = readGitSnapshot({ key: poll.key, load: poll.load, maxAgeMs: poll.maxAgeMs })
    .then(
      (result) => broadcast(poll, result),
      (error: unknown) => broadcastError(poll, error),
    )
    .finally(() => {
      poll.inflight = undefined
    })
  poll.inflight = request
  return request
}

function scheduleShared(poll: SharedPoll) {
  if (poll.subs.size === 0 || !docVisible()) return
  const wait = gitActivityRecent(poll.key) ? poll.fast : poll.idle
  if (poll.timer !== undefined) {
    // 已经按更快（更短）的节奏排着就保留原拍：代理连续写文件时每写一次都重排，
    // 定时器会被一直往后推，反而永远不触发。
    if (poll.wait !== undefined && poll.wait <= wait) return
    clearTimeout(poll.timer)
    poll.timer = undefined
  }
  poll.wait = wait
  poll.timer = setTimeout(
    () => {
      poll.timer = undefined
      poll.wait = undefined
      void fetchShared(poll)
      scheduleShared(poll)
    },
    Math.max(0, wait),
  )
}

function teardown(poll: SharedPoll) {
  if (poll.timer !== undefined) clearTimeout(poll.timer)
  poll.timer = undefined
  poll.wait = undefined
  poll.stopVisibility?.()
  poll.stopVisibility = undefined
  polls.delete(poll.key)
}

export function subscribeGitSnapshot<T>(input: {
  key: string
  load: () => Promise<GitSnapshotResult<T>>
  /** 有文件写入时的间隔（毫秒）。 */
  fast: number
  /** 完全空闲时的间隔（毫秒）。 */
  idle: number
  /** 共享缓存的最长复用时间；让调用方能按自己的节拍决定要不要复用。 */
  maxAgeMs?: number
  onResult: (data: T | undefined) => void
  onError: (error: unknown) => void
}): { poke: () => void; stop: () => void } {
  let poll = polls.get(input.key)
  if (!poll) {
    poll = {
      key: input.key,
      load: input.load as () => Promise<GitSnapshotResult<unknown>>,
      fast: input.fast,
      idle: input.idle,
      maxAgeMs: input.maxAgeMs,
      subs: new Set(),
    }
    polls.set(input.key, poll)
    if (typeof document !== "undefined") {
      const onVisibility = () => {
        if (!poll) return
        if (!docVisible()) {
          if (poll.timer !== undefined) clearTimeout(poll.timer)
          poll.timer = undefined
          return
        }
        void fetchShared(poll)
        scheduleShared(poll)
      }
      document.addEventListener("visibilitychange", onVisibility)
      poll.stopVisibility = () => document.removeEventListener("visibilitychange", onVisibility)
    }
  }
  const shared = poll
  const sub: Subscriber = {
    onResult: (data) => input.onResult(data as T | undefined),
    onError: input.onError,
  }
  shared.subs.add(sub)
  void fetchShared(shared)
  scheduleShared(shared)

  return {
    poke: () => {
      if (shared.subs.size === 0) return
      void fetchShared(shared)
      scheduleShared(shared)
    },
    stop: () => {
      shared.subs.delete(sub)
      if (shared.subs.size === 0) teardown(shared)
    },
  }
}
