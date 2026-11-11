/**
 * NDJSON 线协议：沙箱子进程与父进程之间的传输编码。
 *
 * 本文件是**唯一真源**，描述每种消息的形状。子进程那一侧（child-bootstrap.ts 里的字符串）
 * 是它的手写镜像——那段代码以字符串形态内嵌进入口文件运行，无法 import 本模块，所以两处
 * 必须一起改。父进程这一侧直接 import 这些类型，桥接代码因此有严格类型。
 *
 * 方向约定：
 *   child → parent：create-actor（即发即忘）/ request（ask、world-read，需应答）/
 *                   event（log、phase-entered、report）/ complete
 *   parent → child：response（应答 request）
 *
 * 为什么 create-actor 不走 request/response：脚本里 `const r = agent("x")` 必须**同步**拿到句柄。
 * 子进程没法为一次同步返回等一个 round-trip，所以它同步造一个 child-local 句柄（local#N）并
 * 即发即忘一条 create-actor。父进程按 stdio 的 FIFO 顺序，在处理任何引用该句柄的 ask 之前
 * 完成 local→engine 的映射——父进程的 create-actor 处理是纯同步的。
 */

import type { WorldReadOp } from "../analysis/sites"

/** 跨边界的错误形态。 */
export interface WireError {
  name: string
  message: string
  code?: string
  stack?: string
}

// ————————————————————————————————————————————————————————————————
// child → parent
// ————————————————————————————————————————————————————————————————

/** 同步创建 actor：即发即忘。 */
export interface CreateActorMessage {
  kind: "create-actor"
  localId: string
  siteId: string
  name?: unknown
  persona?: unknown
}

/** 需应答的宿主调用。 */
export interface RequestMessage {
  kind: "request"
  id: string
  type: "ask" | "world-read"
  siteId: string
  /** ask 专属：child-local 句柄。 */
  actor?: string
  /** ask 专属：指令正文。 */
  instructions?: string
  /** world-read 专属。 */
  op?: WorldReadOp
  /** world-read 专属：位置实参数组，本层原样透传。 */
  args?: unknown[]
}

/**
 * 即发即忘的事件，按 type 判别。三种都不需要应答，但耐久性不同：log 丢了只是丢一行闲话；
 * report 丢了是丢一条发现，所以事件通道的 FIFO 顺序对 report 是承重的——父进程 journal 的
 * 就是到达的东西。phase-entered 同样承重：「先进 B 再派发 B 里的 ask」是时间线点灯的依据。
 */
export type EventMessage =
  | { kind: "event"; type: "log"; message: string }
  | { kind: "event"; type: "report"; siteId: string; item: unknown }
  | { kind: "event"; type: "phase-entered"; name: string }

/** 脚本执行终结。 */
export interface CompleteMessage {
  kind: "complete"
  ok: boolean
  value?: unknown
  error?: WireError
}

export type ChildMessage = CreateActorMessage | RequestMessage | EventMessage | CompleteMessage

// ————————————————————————————————————————————————————————————————
// parent → child
// ————————————————————————————————————————————————————————————————

/** 对一次 request 的应答。 */
export interface ResponseMessage {
  kind: "response"
  id: string
  ok: boolean
  value?: unknown
  error?: WireError
}

export type ParentMessage = ResponseMessage

/**
 * 子进程的初始载荷。作为 JSON 字面量内嵌在入口文件里，不经 argv：Windows 的命令行上限是
 * 32,767 字符，编译后的脚本一过约 18 KB 就 `spawn ENAMETOOLONG`。
 */
export interface ChildPayload {
  /** 降级后的 async 函数体；唯一自由标识符是 __host。 */
  lowered: string
  /** 本次 run 的实参，注入沙箱成为只读全局 args。 */
  args?: Record<string, unknown>
}

/** 判断一条入站消息是不是本协议认识的东西。父进程用它把「协议坏了」和「消息不认识」分开。 */
export function isChildMessage(value: unknown): value is ChildMessage {
  if (!value || typeof value !== "object") return false
  const kind = (value as { kind?: unknown }).kind
  return kind === "create-actor" || kind === "request" || kind === "event" || kind === "complete"
}
