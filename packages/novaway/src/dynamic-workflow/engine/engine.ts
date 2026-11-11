/**
 * 执行引擎：一次 run 的大脑。
 *
 * 它拥有三样东西，别处都不许再拥有：
 *   - **身份**：站点 ask#3 的第 2 次到达是 ask#3@2。编号只在这里铸造，按到达顺序。
 *   - **顺序**：一个子代理一次只答一个；全局最多 N 个在飞（见 scheduler.ts）。
 *   - **记录**：每件事在发生之前先进 journal。恢复时 journal 就是事实，不是记忆的补充。
 *
 * 它**不**拥有的东西同样重要：怎么调模型、怎么解析结构化输出、怎么读文件、怎么执行命令。
 * 那些全在 WorkflowDriver 后面。这条分界让引擎可以在一份内存 journal + 一个假驱动上被完整
 * 测试，也让恢复时「重放已发生的事」不需要真的再起一次子代理。
 *
 * 错误模型：
 *   - 脚本抛错 → errored。终态，不可恢复（要改就走 amend）。
 *   - 外部打断 → stopped(reason)。可恢复。
 *   - 引擎自己的内部矛盾（未知站点）→ errored，因为那说明协议坏了，重放也救不回来。
 */

import type { WorldReadOp } from "../analysis/sites"
import { inputHash } from "./hash"
import type { ReplayPlan } from "./replay"
import { instanceKey } from "./replay"
import { AskScheduler } from "./scheduler"
import {
  type ActorRef,
  type AskAnswer,
  type InstanceRef,
  type JournalPort,
  type NodeKind,
  type RunEvent,
  type RunId,
  type SessionRef,
  type Settlement,
  type StopReason,
  type WorkflowDriver,
  actorLabel,
  instanceLabel,
  toFailure,
} from "./types"

/**
 * 停止哨兵。race 的另一个分支用它告诉调用点「run 被停了」——用一个模块级的 symbol 而不是
 * 抛错的分支，是因为抛错的 promise 一旦没人 await 就会变成 unhandled rejection，而停止本来
 * 就是一个正常结局。
 */
const ABORTED = Symbol("aborted")

/** 建一个引擎需要的全部东西。 */
export interface EngineConfig {
  readonly runId: RunId
  readonly scriptHash: string
  /** 全局在飞 ask 的上界。 */
  readonly maxConcurrency: number
  readonly driver: WorkflowDriver
  readonly journal: JournalPort
  /** 分析得到的站点全集。子进程发来名单外的站点 id，说明它跑的不是这份脚本。 */
  readonly knownSiteIds: ReadonlySet<string>
  /** 站点 id → 词法阶段。用于给事件与子会话打标签。 */
  readonly sitePhases?: ReadonlyMap<string, string>
  readonly onEvent?: (event: RunEvent) => void
  /** 恢复时给的计划。缺席即第一次生命。 */
  readonly replay?: ReplayPlan
  /** 恢复时继承的已花用量。第一次生命不传。 */
  readonly spentTokens?: number
}

/** 一个已创建的子代理。 */
interface ActorSlot {
  readonly ref: ActorRef
  readonly name?: string
  readonly persona?: unknown
  /** 恢复时从 journal 读到的会话 id。驱动能接上就接上，接不上就新建。 */
  readonly sessionID?: string
  /** 常驻会话。第一次 ask 之前建好，之后复用。 */
  session?: SessionRef
  sessionPending?: Promise<SessionRef>
  seq: number
}

/** 引擎对外暴露的样子：complete / fail / stop 由传输层调用。 */
export class WorkflowEngine {
  private readonly runId: RunId
  private readonly journal: JournalPort
  private readonly driver: WorkflowDriver
  private readonly scheduler: AskScheduler
  private readonly knownSiteIds: ReadonlySet<string>
  private readonly sitePhases: ReadonlyMap<string, string>
  private readonly onEvent?: (event: RunEvent) => void

  /** 站点 → 已经到达几次。ordinal 只从这里来。 */
  private readonly ordinals = new Map<string, number>()
  /** 实例 → 种类。结算时要带进事件，而那时早就不在 appendNode 的调用栈里了。 */
  private readonly kinds = new Map<string, NodeKind>()
  /** 子进程给的 localId → 子代理。 */
  private readonly locals = new Map<string, ActorSlot>()
  /** 站点 → 已经建过几个子代理。 */
  private readonly actorsAtSite = new Map<string, number>()

  /** 恢复计划。同时用来给缓存结算排序。 */
  private readonly replay?: ReplayPlan
  /** 恢复时的结算顺序：key → 名次。缓存结算在同一个微任务里按它排序释放。 */
  private readonly replayOrder: ReadonlyMap<string, number>
  /** 本批次里等着释放的缓存结算。 */
  private pendingReplay: Array<{ order: number; release: () => void }> = []
  private replayFlushScheduled = false

  private readonly abort = new AbortController()
  /** abort 触发时兑现成哨兵。每次 ask / world-read 与驱动 promise race 一次。 */
  private readonly abortGate: Promise<typeof ABORTED>
  private spentTokens = 0
  private settledFlag = false
  private resolveSettled!: (settlement: Settlement) => void
  private readonly settledPromise: Promise<Settlement>

  constructor(config: EngineConfig) {
    this.runId = config.runId
    this.journal = config.journal
    this.driver = config.driver
    this.knownSiteIds = config.knownSiteIds
    this.sitePhases = config.sitePhases ?? new Map()
    this.onEvent = config.onEvent
    this.replay = config.replay
    this.replayOrder = new Map((config.replay?.settleOrder ?? []).map((key, index) => [key, index]))
    this.scheduler = new AskScheduler(config.maxConcurrency)
    // 编号**不**从 journal 接着数，而是从 1 重新数：恢复就是同一份脚本再跑一次，第 k 次到达
    // 站点 S 仍然是 `S#k`——只有重新数，它才能命中 journal 里那一行。真正新的那一次自然接在
    // 后面（1, 2, 3, …, N 被重放到第 N 个之后，第 N+1 个就是新的）。所以计划里的
    // `ordinals` 只是给测试与诊断看的，引擎不用它。子代理同理（见 createActor）。
    this.spentTokens = config.spentTokens ?? 0
    this.settledPromise = new Promise<Settlement>((resolve) => {
      this.resolveSettled = resolve
    })
    this.abortGate = new Promise<typeof ABORTED>((resolve) => {
      this.abort.signal.addEventListener("abort", () => resolve(ABORTED), { once: true })
    })
    this.journal.startRun({
      runId: this.runId,
      scriptHash: config.scriptHash,
      maxConcurrency: config.maxConcurrency,
      status: "running",
    })
    this.emit({ type: "run-started", runId: this.runId, maxConcurrency: config.maxConcurrency })
  }

  /** run 的结算。只兑现一次。 */
  get settled(): Promise<Settlement> {
    return this.settledPromise
  }

  /** 是否已经结算。传输层用它决定还要不要收尾。 */
  get done(): boolean {
    return this.settledFlag
  }

  // ————————————————————————————————————————————————————————————
  // Boundary A：脚本调用的入口
  // ————————————————————————————————————————————————————————————

  /**
   * 建一个子代理，同步返回句柄。
   *
   * 同步是 Boundary A 的硬要求：脚本里 `const r = agent("x")` 之后立刻就能用 r。所以这里只
   * 分配身份、写 journal，真正的会话在第一次 ask 之前才建（ensureSession）——建会话要起一个
   * 真实存在的实体，把它塞进同步路径只会让脚本的起步变慢。
   */
  createActor(siteId: string, name?: unknown, persona?: unknown): string {
    this.assertSite(siteId, "actor")
    const next = (this.actorsAtSite.get(siteId) ?? 0) + 1
    this.actorsAtSite.set(siteId, next)
    const ref: ActorRef = { siteId, ordinal: next }
    const localId = `local#${this.locals.size + 1}`
    const label = typeof name === "string" && name.trim() !== "" ? name.trim() : undefined
    const restored = this.replay?.actors.get(actorLabel(ref))
    const name2 = restored?.name ?? label
    const persona2 = restored ? restored.persona : persona
    const phase = this.sitePhases.get(siteId)
    this.locals.set(localId, {
      ref,
      ...(name2 ? { name: name2 } : {}),
      ...(persona2 !== undefined ? { persona: persona2 } : {}),
      ...(restored?.sessionID ? { sessionID: restored.sessionID } : {}),
      seq: 0,
    })
    if (restored) {
      // 上次生命里已经建过这个子代理：不重插（唯一键会撞），也不重发事件（时间线里已经有了）。
      return localId
    }
    this.journal.appendActor({
      runId: this.runId,
      actor: ref,
      ...(label ? { name: label } : {}),
      ...(persona !== undefined ? { persona } : {}),
      ...(phase ? { phase } : {}),
    })
    this.emit({ type: "actor-created", runId: this.runId, actor: ref, ...(label ? { name: label } : {}) })
    return localId
  }

  /** 派一轮。排队、落 journal、交给驱动。 */
  ask(siteId: string, localId: string, instructions: string): Promise<unknown> {
    this.assertSite(siteId, "ask")
    const slot = this.locals.get(localId)
    if (!slot) {
      return Promise.reject(this.protocolError(`未知的子代理句柄 ${localId}：create-actor 与 ask 之间的顺序被打乱了。`))
    }
    if (this.settledFlag) return Promise.reject(this.stoppedError())

    const instance = this.mintInstance(siteId)
    const hash = inputHash({ siteId, instructions })
    const cached = this.replay?.settled.get(instanceKey(instance))
    if (cached) {
      // 缓存命中：序号照旧往前推，否则同一子代理后续的 live ask 会拿到重复的序号。
      slot.seq = Math.max(slot.seq, cached.actorSeq ?? slot.seq + 1)
      return this.replaySettled(instance, cached, hash)
    }

    const actorSeq = (slot.seq += 1)
    const phase = this.sitePhases.get(siteId)
    this.appendNode({ instance, kind: "ask", hash, phase, slot, actorSeq, input: { instructions } })

    return this.scheduler.enqueue(actorLabel(slot.ref), async () => {
      const session = await this.ensureSession(slot)
      let answer: AskAnswer | typeof ABORTED
      try {
        answer = await Promise.race([
          this.driver.startAsk({
            runId: this.runId,
            instance,
            actor: slot.ref,
            session,
            instructions,
            ...(phase ? { phase } : {}),
            signal: this.abort.signal,
          }),
          this.abortGate,
        ])
      } catch (error) {
        this.failNode(instance, error)
        throw this.askError(instance, error)
      }
      // 驱动不一定理会 signal（它可能正卡在一个不可中断的调用里）。引擎这一侧必须自己
      // 放手：否则停止之后这些 promise 会一直挂着，调用方永远等不到结局。
      if (answer === ABORTED) {
        this.failNode(instance, this.stoppedError())
        throw this.stoppedError()
      }
      this.spentTokens += answer.usage?.tokens ?? 0
      this.settleNode(instance, "completed", answer.text)
      return answer.text
    })
  }

  /**
   * 一次世界读取。
   *
   * **不过调度器**：它不占模型名额（读文件不花 token），而且通常是本地的、快的。把它塞进
   * 同一个闸门会让「等一个 50ms 的 glob」排在一堆 30s 的 ask 后面，而脚本里它就是同步语义。
   * 需要限流的是对模型的并发，不是对磁盘的。
   */
  worldRead(siteId: string, op: WorldReadOp, args: readonly unknown[]): Promise<unknown> {
    this.assertSite(siteId, "world-read")
    if (this.settledFlag) return Promise.reject(this.stoppedError())

    const instance = this.mintInstance(siteId)
    const hash = inputHash({ op, args: [...args] })
    const cached = this.replay?.settled.get(instanceKey(instance))
    if (cached) return this.replaySettled(instance, cached, hash)

    const phase = this.sitePhases.get(siteId)
    this.appendNode({ instance, kind: "world-read", hash, phase, input: { op, args: [...args] } })

    return Promise.race([
      this.driver.executeWorldRead({ runId: this.runId, instance, op, args, signal: this.abort.signal }),
      this.abortGate,
    ]).then(
      (value) => {
        if (value === ABORTED) {
          this.failNode(instance, this.stoppedError())
          throw this.stoppedError()
        }
        this.settleNode(instance, "completed", value)
        return value
      },
      (error) => {
        this.failNode(instance, error)
        throw this.worldReadError(instance, error)
      },
    )
  }

  /** 一条中间结果。即发即忘，但先落 journal 再发给观察者。 */
  report(siteId: string, item: unknown): void {
    this.assertSite(siteId, "report")
    if (this.settledFlag) return
    const instance = this.mintInstance(siteId)
    // 恢复时脚本会重新走到每一处 report。它们上一次生命已经落过库、也发过事件，
    // 再发一遍就是重复的中间结果。序号照常推进，只是不再记、不再发。
    if (this.replay?.settled.has(instanceKey(instance))) return
    this.appendNode({ instance, kind: "report", hash: inputHash(item) })
    this.settleNode(instance, "completed", item)
    this.emit({ type: "report", runId: this.runId, instance, item })
  }

  /** 阶段标记。只发事件：不占站点、不落 journal。 */
  enterPhase(name: string): void {
    this.emit({ type: "phase-entered", runId: this.runId, name })
  }

  /** 进度旁白。同上。 */
  log(message: string): void {
    this.emit({ type: "log", runId: this.runId, message })
  }

  // ————————————————————————————————————————————————————————————
  // 结算
  // ————————————————————————————————————————————————————————————

  /** 脚本正常返回。 */
  complete(value: unknown): void {
    if (this.settledFlag) return
    this.finish({ status: "completed", value, spentTokens: this.spentTokens })
  }

  /** 脚本抛错。 */
  fail(error: unknown): void {
    if (this.settledFlag) return
    this.finish({ status: "errored", error: toFailure(error), spentTokens: this.spentTokens })
  }

  /**
   * 外部停止。在飞 ask 立刻 abort，尚未开始的排队任务不再开始。
   *
   * 这里**不**等待在飞任务收尾：用户点了停止，就不该再等一次模型响应。驱动收到 signal 之后
   * 自己清理。
   */
  stop(reason: StopReason, error?: unknown): void {
    if (this.settledFlag) return
    this.abort.abort()
    this.finish({
      status: "stopped",
      reason,
      ...(error !== undefined ? { error: toFailure(error) } : {}),
      spentTokens: this.spentTokens,
    })
  }

  private finish(settlement: Settlement): void {
    this.settledFlag = true
    this.journal.settleRun({
      runId: this.runId,
      status: settlement.status,
      ...(settlement.status === "stopped" ? { stopReason: settlement.reason } : {}),
      ...(settlement.status === "completed" ? { result: settlement.value } : {}),
      ...("error" in settlement && settlement.error ? { failure: settlement.error } : {}),
      spentTokens: settlement.spentTokens,
    })
    this.emit({ type: "run-settled", runId: this.runId, settlement })
    this.resolveSettled(settlement)
    void this.driver.dispose?.().catch(() => {})
  }

  // ————————————————————————————————————————————————————————————
  // 内部
  // ————————————————————————————————————————————————————————————

  /**
   * 一个从 journal 里拿到的答案。
   *
   * 排序是承重的：恢复时多条并发分支的缓存答案必须按**第一次生命的结算顺序**释放。否则
   * `Promise.all` 之后的下游语句（很多脚本在那里 report）会以另一种顺序执行，report 的
   * ordinal 就漂了，下一次恢复对不上。做法是把同一个微任务里到达的缓存结算攒一批、按序释放：
   * 脚本本身是确定的，同一批到达的恰好就是当初同时完成的那几条。
   */
  private async replaySettled(
    instance: InstanceRef,
    cached: { readonly status: "completed" | "failed"; readonly result?: unknown; readonly failure?: unknown },
    expectedHash: string,
  ): Promise<unknown> {
    const entry = this.replay!.settled.get(instanceKey(instance))!
    if (entry.inputHash !== expectedHash) {
      const error = this.protocolError(
        `恢复时 ${instanceLabel(instance)} 的输入与 journal 不一致（journal ${entry.inputHash}，本次 ${expectedHash}）。脚本内容没变却走到了另一条路径，缓存不能再用。`,
      )
      this.fail(error)
      throw error
    }

    await this.replayTurn(instanceKey(instance))
    this.emit({
      type: "node-settled",
      runId: this.runId,
      instance,
      kind: this.kindOf(instance),
      status: cached.status,
      cached: true,
    })
    if (cached.status === "failed") throw this.rebuildFailure(cached.failure)
    return cached.result
  }

  /** 等这一批缓存结算轮到自己。见 {@link replaySettled} 的排序说明。 */
  private replayTurn(key: string): Promise<void> {
    const order = this.replayOrder.get(key) ?? Number.MAX_SAFE_INTEGER
    return new Promise<void>((release) => {
      this.pendingReplay.push({ order, release })
      if (this.replayFlushScheduled) return
      this.replayFlushScheduled = true
      queueMicrotask(() => {
        this.replayFlushScheduled = false
        const batch = this.pendingReplay
        this.pendingReplay = []
        batch.sort((a, b) => a.order - b.order)
        for (const item of batch) item.release()
      })
    })
  }

  /** 把 journal 里的失败还原成脚本能 catch 的 Error。 */
  private rebuildFailure(failure: unknown): Error {
    const item = (failure ?? {}) as { name?: unknown; message?: unknown; code?: unknown }
    const error = new Error(typeof item.message === "string" ? item.message : "上一次运行里这一步失败了。")
    if (typeof item.name === "string") error.name = item.name
    if (typeof item.code === "string") (error as Error & { code?: string }).code = item.code
    return error
  }

  /** 站点 + 第几次到达。编号只在这里铸造。 */
  private mintInstance(siteId: string): InstanceRef {
    const ordinal = (this.ordinals.get(siteId) ?? 0) + 1
    this.ordinals.set(siteId, ordinal)
    return { siteId, ordinal }
  }

  private appendNode(input: {
    instance: InstanceRef
    kind: NodeKind
    hash: string
    phase?: string
    slot?: ActorSlot
    actorSeq?: number
    input?: unknown
  }): void {
    const { instance } = input
    this.kinds.set(instanceKey(instance), input.kind)
    if (this.replay?.running.has(instanceKey(instance))) {
      // 上一次生命在这条节点上被杀掉。行已经在了，重新打开它，不重插。
      this.journal.reopenNode({ runId: this.runId, instance })
      this.emit({
        type: "node-started",
        runId: this.runId,
        instance,
        kind: input.kind,
        ...(input.phase ? { phase: input.phase } : {}),
      })
      return
    }
    this.journal.appendNode({
      runId: this.runId,
      siteId: instance.siteId,
      ordinal: instance.ordinal,
      kind: input.kind,
      ...(input.phase ? { phase: input.phase } : {}),
      ...(input.slot ? { actor: input.slot.ref } : {}),
      ...(input.actorSeq !== undefined ? { actorSeq: input.actorSeq } : {}),
      inputHash: input.hash,
      ...(input.input !== undefined ? { input: input.input } : {}),
      status: "running",
    })
    this.emit({
      type: "node-started",
      runId: this.runId,
      instance,
      kind: input.kind,
      ...(input.phase ? { phase: input.phase } : {}),
    })
  }

  private settleNode(instance: InstanceRef, status: "completed", result: unknown): void {
    this.journal.settleNode({ runId: this.runId, instance, status, result })
    this.emit({ type: "node-settled", runId: this.runId, instance, kind: this.kindOf(instance), status })
  }

  private failNode(instance: InstanceRef, error: unknown): void {
    this.journal.settleNode({ runId: this.runId, instance, status: "failed", failure: toFailure(error) })
    this.emit({
      type: "node-settled",
      runId: this.runId,
      instance,
      kind: this.kindOf(instance),
      status: "failed",
    })
  }

  /** 实例的种类。缓存重放时也查得到——`appendNode` 在两条路径上都会记。 */
  private kindOf(instance: InstanceRef): NodeKind {
    return this.kinds.get(instanceKey(instance)) ?? "ask"
  }

  /** 第一次 ask 之前建会话；并发到达的 ask 共用同一个 promise，不会建出两个会话。 */
  private async ensureSession(slot: ActorSlot): Promise<SessionRef> {
    if (slot.session !== undefined) return slot.session
    if (!slot.sessionPending) {
      slot.sessionPending = (async () => {
        // 恢复时优先接回上一次的会话：子代理的上下文就在那里。
        if (slot.sessionID && this.driver.attachActorSession) {
          const attached = await this.driver.attachActorSession({
            runId: this.runId,
            actor: slot.ref,
            sessionID: slot.sessionID,
          })
          slot.session = attached
          return attached
        }
        const session = await this.driver.createActorSession({
          runId: this.runId,
          actor: slot.ref,
          ...(slot.name ? { name: slot.name } : {}),
          ...(slot.persona !== undefined ? { persona: slot.persona } : {}),
        })
        slot.session = session
        // 记下来，下次恢复才接得回去。写不进去不影响这一轮。
        try {
          this.journal.recordActorSession({ runId: this.runId, actor: slot.ref, session })
        } catch {
          // journal 是记录者，不该成为执行路径上的单点。
        }
        return session
      })()
    }
    return slot.sessionPending
  }

  private assertSite(siteId: string, kind: string) {
    if (this.knownSiteIds.has(siteId)) return
    throw this.protocolError(
      `子进程报告了一个分析阶段不存在的站点 ${siteId}（${kind}）。这说明沙箱里跑的脚本与提交时分析的不是同一份。`,
    )
  }

  /**
   * 事件先落 journal，再交给观察者。
   *
   * 顺序反过来的话，观察者（UI、日志）看到的东西会比恢复时读到的多——一个在事件发出后、
   * 落库前崩溃的进程会留下「界面显示过、journal 里没有」的阶段与报告。恢复只认 journal，
   * 于是那段历史就凭空消失了。先写后发是唯一能保证两边一致的顺序。
   *
   * 落库失败**不**打断 run：journal 是记录者，不该成为执行路径上的单点。观察者抛错同理。
   */
  private emit(event: RunEvent): void {
    try {
      this.journal.appendEvent({ runId: this.runId, type: event.type, payload: event })
    } catch {
      // journal 自己坏了（比如磁盘满）：run 继续，恢复能力降级。
    }
    try {
      this.onEvent?.(event)
    } catch {
      // 观察者自己的问题不该拖垮 run。
    }
  }

  /** 把驱动抛出的东西包成脚本能看懂的错误。 */
  private askError(instance: InstanceRef, error: unknown): Error {
    return this.wrapFailure("ask", instance, error, "AskFailed")
  }

  private worldReadError(instance: InstanceRef, error: unknown): Error {
    return this.wrapFailure("world-read", instance, error, "WorldReadFailed")
  }

  private wrapFailure(kind: string, instance: InstanceRef, error: unknown, fallbackCode: string): Error {
    const failure = toFailure(error)
    const wrapped = new Error(`${kind} ${instanceLabel(instance)} 失败：${failure.message}`)
    wrapped.name = failure.name
    ;(wrapped as Error & { code?: string }).code = failure.code ?? fallbackCode
    return wrapped
  }

  private protocolError(message: string): Error {
    const error = new Error(message)
    error.name = "WorkflowProtocolError"
    ;(error as Error & { code?: string }).code = "WorkflowProtocolError"
    return error
  }

  private stoppedError(): Error {
    const error = new Error("run 已经结束，这次调用没有执行。")
    error.name = "RunStopped"
    ;(error as Error & { code?: string }).code = "RunStopped"
    return error
  }
}
