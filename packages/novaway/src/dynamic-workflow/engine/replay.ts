/**
 * 恢复规划：把一份 journal 变成引擎需要的「已经发生过什么」。
 *
 * 这里只做纯计算（不读库、不碰驱动），所以它可以被单测钉死，而不用起一次 run。
 *
 * 三个数必须从 journal 里恢复，否则恢复出来的 run 会和第一次生命对不上：
 *   1. **每个站点已经到过几次**（ordinal 的下一号）。不从 journal 接着数，新实例会与旧行撞键。
 *   2. **每个子代理已经答过几轮**（actorSeq 的下一号）。它决定排队顺序与界面上的「第几次」。
 *   3. **第一次生命里节点结算的先后**。缓存结算必须按这个顺序释放，否则 fan-out 的完成顺序
 *      一变，下游脚本看到的东西就变了——甚至会让后续实例撞上不同的输入。
 */

import type { ActorRef, InstanceRef, NodeStatus } from "./types"

/** `ask#3@2`。实例在 journal 里就是靠它定位的。 */
export function instanceKey(instance: InstanceRef): string {
  return `${instance.siteId}@${instance.ordinal}`
}

/** 一个已落 journal 的节点，按恢复视角看。 */
export interface ReplayNode {
  readonly siteId: string
  readonly ordinal: number
  readonly status: NodeStatus
  readonly inputHash: string
  readonly result?: unknown
  readonly failure?: unknown
  readonly actor?: ActorRef
  readonly actorSeq?: number
}

/** 第一次生命里的事件，只需要 `type` 与 `payload`。 */
export interface ReplayEvent {
  readonly sequence: number
  readonly type: string
  readonly payload: unknown
}

export interface ReplayPlan {
  /** 已经结算过的实例 → 缓存答案。命中就不再调驱动。 */
  readonly settled: ReadonlyMap<
    string,
    {
      readonly status: "completed" | "failed"
      readonly result?: unknown
      readonly failure?: unknown
      readonly inputHash: string
      /** 这个 ask 在该子代理序列里的位置。重放时据此把序号接着数下去。 */
      readonly actorSeq?: number
    }
  >
  /** 落过 journal 但没结算的实例。重跑时复用同一行，不重新插入。 */
  readonly running: ReadonlySet<string>
  /** 站点 → 已到过的次数。下一个实例从 +1 开始。 */
  readonly ordinals: ReadonlyMap<string, number>
  /**
   * `actor#1@2` → 上次生命里建过的那个子代理。
   *
   * 恢复时脚本会重新执行 `agent(...)`，这一句必须**复用**旧行而不是再插一条：唯一键会撞，
   * 而且只有复用才能把上次的会话接回来（子代理才记得它之前说过什么）。
   */
  readonly actors: ReadonlyMap<
    string,
    { readonly name?: string; readonly sessionID?: string; readonly persona?: unknown }
  >
  /** `actor#1@2` → 已经答过几轮。 */
  readonly actorSeqs: ReadonlyMap<string, number>
  /** 第一次生命里实例**首次**结算的顺序。缓存结算按它释放。 */
  readonly settleOrder: readonly string[]
}

export function buildReplayPlan(input: {
  nodes: ReadonlyArray<ReplayNode>
  events: ReadonlyArray<ReplayEvent>
  /**
   * 已建的子代理。必须单独给：只从 ask 节点推的话，**建了但还没被 ask 过**的子代理会漏掉，
   * 恢复后新建的 agent() 就会与它撞 ordinal。
   */
  actors?: ReadonlyArray<{
    readonly actor: ActorRef
    readonly name?: string
    readonly sessionID?: string
    readonly persona?: unknown
  }>
}): ReplayPlan {
  const settled = new Map<
    string,
    { status: "completed" | "failed"; result?: unknown; failure?: unknown; inputHash: string; actorSeq?: number }
  >()
  const running = new Set<string>()
  const ordinals = new Map<string, number>()
  const actors = new Map<string, { name?: string; sessionID?: string; persona?: unknown }>()
  const actorSeqs = new Map<string, number>()

  for (const record of input.actors ?? []) {
    const label = `${record.actor.siteId}@${record.actor.ordinal}`
    actors.set(label, {
      ...(record.name ? { name: record.name } : {}),
      ...(record.sessionID ? { sessionID: record.sessionID } : {}),
      ...(record.persona !== undefined ? { persona: record.persona } : {}),
    })
  }
  for (const node of input.nodes) {
    const key = instanceKey(node)
    ordinals.set(node.siteId, Math.max(ordinals.get(node.siteId) ?? 0, node.ordinal))
    if (node.status === "running") running.add(key)
    else
      settled.set(key, {
        status: node.status,
        inputHash: node.inputHash,
        ...(node.result !== undefined ? { result: node.result } : {}),
        ...(node.failure !== undefined ? { failure: node.failure } : {}),
        ...(node.actorSeq !== undefined ? { actorSeq: node.actorSeq } : {}),
      })
    if (node.actor) {
      const label = `${node.actor.siteId}@${node.actor.ordinal}`
      if (node.actorSeq !== undefined) actorSeqs.set(label, Math.max(actorSeqs.get(label) ?? 0, node.actorSeq))
    }
  }

  // 结算顺序只认第一次出现：重放时缓存按同一顺序释放，看起来就与第一次生命一样。
  const order: string[] = []
  const seen = new Set<string>()
  for (const event of [...input.events].sort((a, b) => a.sequence - b.sequence)) {
    if (event.type !== "node-settled") continue
    const instance = (event.payload as { instance?: InstanceRef } | undefined)?.instance
    if (!instance) continue
    const key = instanceKey(instance)
    if (seen.has(key)) continue
    seen.add(key)
    order.push(key)
  }

  // 事件里没留下顺序（老 run / 事件通道坏了）时，按节点行数补一个稳定顺序：
  // 至少保证「已结算的全部都在队列里」，而不是让缓存永远等不到释放。
  for (const key of settled.keys()) if (!seen.has(key)) order.push(key)

  return {
    settled,
    running,
    ordinals,
    actors,
    actorSeqs,
    settleOrder: order,
  }
}
