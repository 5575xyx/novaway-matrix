import { Effect } from "effect"
import { Session } from "./session"
import { Agent } from "../agent/agent"
import { MessageID, SessionID } from "./schema"
import { deriveSubagentSessionPermission } from "../agent/subagent-permissions"
import { ModelID, ProviderID } from "../provider/schema"
import type { Interface as TeamInterface } from "../team/team"
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
  /** 团队面板里显示的名字；缺省用 title 或 agent+会话后缀。 */
  readonly name?: string
  /**
   * 编排坐标：登记后这个子会话里的有副作用工具调用会带幂等键。
   * 不传则不登记（普通子代理、工作流步骤都没有）。
   */
  readonly scope?: { runID: string; taskID?: string; attempt?: number; readOnly?: boolean }
  /**
   * 子会话的工作目录。团队运行时指向团队 worktree ——
   * 成员看到的是 `HEAD` 的独立副本，而不是用户还没提交的工作区。
   */
  readonly directory?: string
  /**
   * 这次派发记在谁名下（员工库 id）。运行派发队长时由调用方给出；
   * 没给就跟着父会话走 —— 一个人派生出来的助手，工时算这个人的。
   */
  readonly employeeID?: string
}

/**
 * 这一轮子会话实际花了什么（§10.3）。
 *
 * 之前只返回文本，导致上级只能把用量记成 `unknown` —— 「跑了多少」永远是个问号，
 * 预算判断也只能靠预占额。用量来自会话行上的累计值（`step-finish` 折进去的），
 * 比事后扫消息更准，也能覆盖在别的进程里跑完的子会话。
 */
export type RunAgentUsage = {
  readonly cost: number
  readonly tokens: number
}

export type RunAgentResult = {
  readonly text: string
  readonly sessionID: SessionID
  readonly usage: RunAgentUsage
}

export type RunAgent = (input: RunAgentInput) => Effect.Effect<RunAgentResult>

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
  /**
   * 可选的团队服务。传入后，每个派生会话都会登记为当前团队的 worker，
   * 运行期间标记 active、结束后回到 idle，让状态面板能看到真实成员。
   */
  readonly teams?: TeamInterface
  /**
   * 子会话创建后的回调。编排方在这里登记 `scope`，让工具漏斗能算出幂等键；
   * 放在这里而不是 runAgent 调用点，是因为会话 ID 只有创建后才知道。
   */
  readonly onSession?: (input: { sessionID: SessionID; scope: RunAgentInput["scope"] }) => Effect.Effect<void>
  /**
   * 读取某个会话（含其子孙）的累计用量。缺省只读会话自己的行；
   * 编排方可以注入「整棵子树」的读法，把队长派生出的成员开销一起算进来。
   */
  readonly readUsage?: (sessionID: SessionID) => Effect.Effect<RunAgentUsage>
}

/**
 * 构造一个 runAgent 闭包:每次调用派生一个子会话、跑一轮 agent、返回尾部文本。
 * Session/Agent 服务已在 config 中注入,故返回的闭包自身无未决依赖(R = never)。
 */
export function makeRunAgent(config: MakeRunAgentConfig): RunAgent {
  const { ops, sessions, agents, parentSessionID, defaultModel, defaultAgent, teams, onSession } = config
  // 缺省读法：会话行自己记的总量。子会话是新建的，读到的就是这一轮的消耗。
  const readUsage: (sessionID: SessionID) => Effect.Effect<RunAgentUsage> =
    config.readUsage ??
    ((sessionID) =>
      sessions.get(sessionID).pipe(
        Effect.map((info) => ({
          cost: info?.cost ?? 0,
          tokens:
            (info?.tokens?.input ?? 0) +
            (info?.tokens?.output ?? 0) +
            (info?.tokens?.reasoning ?? 0) +
            (info?.tokens?.cache?.read ?? 0) +
            (info?.tokens?.cache?.write ?? 0),
        })),
        Effect.catchCause(() => Effect.succeed({ cost: 0, tokens: 0 })),
      ))
  return (input) =>
    Effect.gen(function* () {
      const parent = yield* sessions.get(parentSessionID).pipe(Effect.catchCause(() => Effect.succeed(undefined)))
      const parentAgent = parent?.agent
        ? yield* agents.get(parent.agent).pipe(Effect.catchCause(() => Effect.succeed(undefined)))
        : undefined

      const agentName = input.agent || defaultAgent
      const next = yield* agents.get(agentName).pipe(Effect.catchCause(() => Effect.succeed(undefined)))
      const resolvedName = next?.name ?? defaultAgent

      // 团队是按根会话登记的；worker 再派生 worker 时也能通过成员表找到同一个团队。
      // 普通使用中如果还没有团队，首次派生 worker 时自动建一个，让状态面板
      // 能看到真实的多代理运行（并行首派也不会重复建队，ensure 是原子的）。
      const resolvedTeam = teams
        ? yield* teams.ofSession(parentSessionID).pipe(Effect.catchCause(() => Effect.succeed(undefined)))
        : undefined
      const team =
        resolvedTeam ??
        (teams && parent && !parent.parentID
          ? yield* teams
              .ensure({
                rootSessionID: parentSessionID,
                name: "自动团队",
                agent: parent.agent ?? defaultAgent,
              })
              .pipe(Effect.catchCause(() => Effect.succeed(undefined)))
          : undefined)

      // 归属：显式的员工身份优先；否则沿用父会话 —— 队长自己的助手不是名册里的
      // 成员，工时算回队长，而不是凭空多出一个「无人」。
      const employeeID = input.employeeID ?? parent?.employeeID
      const child = yield* sessions.create(
        {
          parentID: parentSessionID,
          ...(input.directory ? { directory: input.directory } : {}),
          title: input.title ?? `${resolvedName} (workflow step)`,
          ...(parent?.permissionMode ? { permissionMode: parent.permissionMode } : {}),
          permission: next
            ? deriveSubagentSessionPermission({
                parentSessionPermission: parent?.permission ?? [],
                parentAgent,
                subagent: next,
              })
            : (parent?.permission ?? []),
        },
        {
          ...(employeeID ? { employeeID } : {}),
          ...(input.scope?.runID ? { runID: input.scope.runID } : {}),
        },
      )

      if (onSession && input.scope) {
        yield* onSession({ sessionID: child.id, scope: input.scope }).pipe(Effect.ignore)
      }

      if (teams && team) {
        const preferred = input.name ?? input.title ?? `${resolvedName}-${child.id.slice(-4)}`
        // 成员按名字寻址(面板发消息 / agent_message)；同名会让消息落到旧会话，
        // 所以同一团队里重名时补一个会话后缀。
        const clash = yield* teams.member(team.id, preferred).pipe(Effect.catchCause(() => Effect.succeed(undefined)))
        const name = clash && clash.sessionID !== child.id ? `${preferred} #${child.id.slice(-4)}` : preferred
        yield* teams
          .addMember({
            teamID: team.id,
            sessionID: child.id,
            name,
            agent: resolvedName,
            role: "worker",
          })
          .pipe(Effect.ignore)
      }

      const mark = (status: "active" | "idle") =>
        teams && team
          ? teams.updateMember({ teamID: team.id, sessionID: child.id, status }).pipe(Effect.ignore)
          : Effect.void

      yield* mark("active")

      const model = input.model ?? next?.model ?? defaultModel
      const parts = yield* ops.resolvePromptParts(input.prompt)
      const result = yield* ops
        .prompt({
          messageID: MessageID.ascending(),
          sessionID: child.id,
          model: { modelID: ModelID.make(model.modelID), providerID: ProviderID.make(model.providerID) },
          agent: resolvedName,
          parts,
        })
        .pipe(Effect.ensuring(mark("idle")))
      // 用量必须在这一轮结束后立刻读：再晚一点，同一会话里后续的消耗会混进来。
      const usage = yield* readUsage(child.id)
      return {
        text: result.parts.findLast((item) => item.type === "text")?.text ?? "",
        sessionID: child.id,
        usage,
      } satisfies RunAgentResult
    })
}
