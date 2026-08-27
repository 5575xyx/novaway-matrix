import { Effect } from "effect"
import { Session } from "./session"
import { Agent } from "../agent/agent"
import { MessageID, SessionID } from "./schema"
import { deriveSubagentSessionPermission } from "../agent/subagent-permissions"
import type { SessionPrompt } from "./prompt"
import type { MessageV2 } from "./message-v2"

// 共享执行原语:程序化跑一轮 agent(派生子会话)。
// 供组合工作流执行引擎 (workflow/executor) 与子代理编排 (orchestrator) 复用,
// 镜像 tool/task.ts 的 runTask 流程 —— sessions.create({parentID}) →
// ops.prompt({...}) → 取尾部 text part。
//
// 引擎不静态依赖 SessionPrompt,而是接收注入的 runAgent 回调,避免层循环。
// makeRunAgent 由调用方(工具的 ctx.extra.promptOps,或 HTTP handler 里的
// SessionPrompt.Service)构造后传给引擎;Session/Agent 服务由调用方在其上下文
// 中解析后作为参数注入,使返回的 runAgent 自身无未决依赖。

export interface RunAgentInput {
  /** 子代理类型名(agent name);未知则回退到 defaultAgent。 */
  readonly agent: string
  /** 发给子代理的提示词(已插值)。 */
  readonly prompt: string
  /** 覆盖模型;缺省用子代理自身模型或 defaultModel。 */
  readonly model?: { readonly providerID: string; readonly modelID: string }
  /** 子会话标题。 */
  readonly title?: string
}

export type RunAgent = (input: RunAgentInput) => Effect.Effect<string>

/** promptOps 中执行 runAgent 所需的最小子集(来自 SessionPrompt.Service)。 */
export interface RunAgentPromptOps {
  resolvePromptParts(template: string): Effect.Effect<SessionPrompt.PromptInput["parts"]>
  prompt(input: SessionPrompt.PromptInput): Effect.Effect<MessageV2.WithParts>
}

export interface MakeRunAgentConfig {
  /** 注入的 prompt 操作(通常来自 ctx.extra.promptOps 或 SessionPrompt.Service)。 */
  readonly ops: RunAgentPromptOps
  /** 已解析的会话服务。 */
  readonly sessions: Session.Interface
  /** 已解析的 agent 服务。 */
  readonly agents: Agent.Interface
  /** 父会话 ID —— 子会话挂在其下。 */
  readonly parentSessionID: SessionID
  /** 缺省模型(通常取自当前 assistant 消息)。 */
  readonly defaultModel: { readonly providerID: string; readonly modelID: string }
  /** 当 step/task 未指定 agent 时使用的回退 agent 名。 */
  readonly defaultAgent: string
}

/**
 * 构造一个 runAgent 闭包:每次调用派生一个子会话、跑一轮 agent、返回尾部文本。
 * Session/Agent 服务已在 config 中注入,故返回的闭包自身无未决依赖(R = never)。
 */
export function makeRunAgent(config: MakeRunAgentConfig): RunAgent {
  const { ops, sessions, agents, parentSessionID, defaultModel, defaultAgent } = config
  return (input) =>
    Effect.gen(function* () {
      const parent = yield* sessions.get(parentSessionID).pipe(Effect.catchCause(() => Effect.succeed(undefined)))
      const parentAgent = parent?.agent
        ? yield* agents.get(parent.agent).pipe(Effect.catchCause(() => Effect.succeed(undefined)))
        : undefined

      const agentName = input.agent || defaultAgent
      const next = yield* agents.get(agentName).pipe(Effect.catchCause(() => Effect.succeed(undefined)))
      const resolvedName = next?.name ?? defaultAgent

      const child = yield* sessions.create({
        parentID: parentSessionID,
        title: input.title ?? `${resolvedName} (workflow step)`,
        permission: next
          ? deriveSubagentSessionPermission({
              parentSessionPermission: parent?.permission ?? [],
              parentAgent,
              subagent: next,
            })
          : (parent?.permission ?? []),
      })

      const model = input.model ?? next?.model ?? defaultModel
      const parts = yield* ops.resolvePromptParts(input.prompt)
      const result = yield* ops.prompt({
        messageID: MessageID.ascending(),
        sessionID: child.id,
        model: { modelID: model.modelID, providerID: model.providerID },
        agent: resolvedName,
        parts,
      })
      return result.parts.findLast((item) => item.type === "text")?.text ?? ""
    })
}
