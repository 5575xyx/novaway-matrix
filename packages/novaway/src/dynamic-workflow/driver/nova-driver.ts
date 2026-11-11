/**
 * 生产驱动：把引擎的三次调用接到本仓真实的服务上。
 *
 * 与 `makeRunAgent` 的关系值得说清楚。那个函数是**一次性**的：每次调用新建一个子会话、跑一轮
 * prompt、返回文本，然后会话就没人再用了。工作流的 actor 需要相反的形状——**建一次会话，问很多轮**，
 * 因为「它记得上一句」正是 `agent()` 的全部意义。所以这里不复用它，而是直接组合它内部的三件事：
 * `sessions.create` → 每轮 `ops.prompt({ sessionID })` → 读用量。
 *
 * 另一条分界：**权限只在这里定一次**。子会话拿到的规则是「父会话规则 + 子代理派生规则」，
 * 与 `task` 派发的子代理完全一致。运行期不再弹权限窗——用户在确认窗里已经批准过这次 run。
 */

import { Effect } from "effect"
import { AppFileSystem } from "@novaway/core/filesystem"
import { Git } from "@/git"
import { Ripgrep } from "@/file/ripgrep"
import { Session } from "@/session/session"
import { SessionPrompt } from "@/session/prompt"
import { Agent } from "@/agent/agent"
import { MessageID, SessionID } from "@/session/schema"
import { ModelID, ProviderID } from "@/provider/schema"
import { deriveSubagentSessionPermission } from "@/agent/subagent-permissions"
import { EffectBridge } from "@/effect/bridge"
import type { AskAnswer, AskRequest, CreateActorRequest, WorldReadRequest, WorkflowDriver } from "../engine/types"
import { executeWorldRead as runWorldRead } from "./world"

/** 派发给子会话的 prompt 操作（来自 `ctx.extra.promptOps`，即 `TaskPromptOps`）。 */
export interface DriverPromptOps {
  resolvePromptParts(template: string): Effect.Effect<SessionPrompt.PromptInput["parts"]>
  prompt(input: SessionPrompt.PromptInput): Effect.Effect<{ parts: ReadonlyArray<{ type: string; text?: string }> }>
  cancel?(sessionID: SessionID): Effect.Effect<void>
}

/** 建一个生产驱动需要的全部输入。 */
export interface NovaDriverOptions {
  readonly runId: string
  readonly parentSessionID: SessionID
  /** 父会话的 agent 名。子会话缺省继承它。 */
  readonly parentAgent: string
  /** 父会话的模型。子会话缺省用它。 */
  readonly defaultModel: { readonly providerID: string; readonly modelID: string }
  /** 工作目录（工作区根）。world-read 的相对路径以它为基准。 */
  readonly cwd: string
  readonly ops: DriverPromptOps
  /** 子会话用的 agent。缺省 `general`——它有不小的工具面，但没有派生能力。 */
  readonly childAgent?: string
}

/** 子会话标题。带上 run 与 actor，用户在看会话列表时能认出来。 */
function titleOf(options: NovaDriverOptions, input: CreateActorRequest): string {
  const label = input.name ? ` ${input.name}` : ""
  return `工作流${label}（${input.actor.siteId}）· ${options.runId.slice(-6)}`
}

/**
 * 构造驱动。
 *
 * 返回的是 Promise 风格的 `WorkflowDriver`：引擎那一侧是纯 TS / Promise，不认识 Effect。
 * 所有 Effect 都在这里经 `EffectBridge` 落到已经捕获好的运行上下文里，所以调用点不需要
 * 再持有任何服务。
 */
export const makeNovaDriver = (options: NovaDriverOptions) =>
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    const agents = yield* Agent.Service
    const fs = yield* AppFileSystem.Service
    const rg = yield* Ripgrep.Service
    const git = yield* Git.Service
    const bridge = yield* EffectBridge.make()

    const parent = yield* sessions.get(options.parentSessionID).pipe(Effect.catchCause(() => Effect.succeed(undefined)))
    const childAgentName = options.childAgent ?? "general"
    const childAgent = yield* agents.get(childAgentName).pipe(Effect.catchCause(() => Effect.succeed(undefined)))
    const parentAgentInfo = parent?.agent
      ? yield* agents.get(parent.agent).pipe(Effect.catchCause(() => Effect.succeed(undefined)))
      : undefined

    const permission = childAgent
      ? deriveSubagentSessionPermission({
          parentSessionPermission: parent?.permission ?? [],
          parentAgent: parentAgentInfo,
          subagent: childAgent,
        })
      : (parent?.permission ?? [])

    // 会话的用量是**累计**的，而引擎要的是「这一轮花了多少」。记下每个会话上次读到的数，
    // 每次只交差值。恢复时要先给接回来的会话打一次底，否则第二段生命的第一轮会把上一段
    // 的账又算一遍。
    const seenTokens = new Map<string, number>()
    const seenCost = new Map<string, number>()

    const usageSince = async (sessionID: SessionID) => {
      const total = await bridge.promise(readUsage(sessions, sessionID))
      const lastTokens = seenTokens.get(sessionID) ?? 0
      const lastCost = seenCost.get(sessionID) ?? 0
      seenTokens.set(sessionID, total.tokens)
      seenCost.set(sessionID, total.cost)
      return { tokens: Math.max(0, total.tokens - lastTokens), cost: Math.max(0, total.cost - lastCost) }
    }

    const driver: WorkflowDriver = {
      async createActorSession(input) {
        const info = await bridge.promise(
          sessions.create({
            parentID: options.parentSessionID,
            title: titleOf(options, input),
            ...(options.cwd ? { directory: options.cwd } : {}),
            ...(parent?.permissionMode ? { permissionMode: parent.permissionMode } : {}),
            permission,
          }),
        )
        return info.id
      },

      async startAsk(input: AskRequest): Promise<AskAnswer> {
        const sessionID = input.session as SessionID
        const parts = await bridge.promise(options.ops.resolvePromptParts(input.instructions))
        const result = await bridge.promise(
          options.ops.prompt({
            sessionID,
            messageID: MessageID.ascending(),
            agent: childAgent?.name ?? childAgentName,
            model: {
              providerID: ProviderID.make(options.defaultModel.providerID),
              modelID: ModelID.make(options.defaultModel.modelID),
            },
            parts,
          }),
        )
        const text = [...result.parts].reverse().find((part) => part.type === "text")?.text ?? ""
        return { text, usage: await usageSince(sessionID) }
      },

      async attachActorSession(input) {
        const sessionID = input.sessionID as SessionID
        const existing = await bridge.promise(
          sessions.get(sessionID).pipe(Effect.catchCause(() => Effect.succeed(undefined))),
        )
        // 会话被删了（或者来自另一个库）：退回到新建，而不是把一轮发进不存在的会话。
        if (!existing) return driver.createActorSession({ runId: input.runId, actor: input.actor })
        const total = await bridge.promise(readUsage(sessions, sessionID))
        seenTokens.set(sessionID, total.tokens)
        seenCost.set(sessionID, total.cost)
        return sessionID
      },

      async executeWorldRead(input: WorldReadRequest) {
        return await bridge.promise(runWorldRead({ cwd: options.cwd, fs, rg, git }, input.op, input.args))
      },

      async dispose() {
        // 没有常驻资源：子会话留在会话列表里（用户可以回看子代理做了什么），
        // 订阅与进程都由各自的层自己收拾。
      },
    }

    return { driver, cancel: options.ops.cancel }
  })

/** 读一个会话的累计用量。读不到就是 0——用量是统计，不该让 run 失败。 */
function readUsage(sessions: Session.Interface, sessionID: SessionID) {
  return sessions.get(sessionID).pipe(
    Effect.map((info) => ({
      tokens:
        (info?.tokens?.input ?? 0) +
        (info?.tokens?.output ?? 0) +
        (info?.tokens?.reasoning ?? 0) +
        (info?.tokens?.cache?.read ?? 0) +
        (info?.tokens?.cache?.write ?? 0),
      cost: info?.cost ?? 0,
    })),
    Effect.catchCause(() => Effect.succeed({ tokens: 0, cost: 0 })),
  )
}
