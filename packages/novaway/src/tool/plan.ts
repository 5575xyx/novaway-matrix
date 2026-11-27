import path from "path"
import { Effect, Option, Schema } from "effect"
import * as Tool from "./tool"
import { Session } from "@/session/session"
import { MessageV2 } from "../session/message-v2"
import { Provider } from "@/provider/provider"
import { InstanceState } from "@/effect/instance-state"
import { AppFileSystem } from "@novaway/core/filesystem"
import { MessageID, PartID } from "../session/schema"
import EXIT_DESCRIPTION from "./plan-exit.txt"
import ENTER_DESCRIPTION from "./plan-enter.txt"
import { PlanApproval } from "@/session/plan-approval"
import { Service as MailboxService } from "@/team/mailbox"
import { Service as TeamService } from "@/team/team"
import { PlanExecution } from "@/session/plan-execution"
import { Goal } from "@/session/goal"
import { SuperAgentStore } from "@/super-agent"
import { Service as ToolRegistryService } from "./registry"
import { Service as WorkflowPolicyService } from "@/workflow/policy"
import { ClientCapabilities } from "@/effect/client-capabilities"

export const Parameters = Schema.Struct({})

export const PlanExitTool = Tool.define(
  "plan_exit",
  Effect.gen(function* () {
    const session = yield* Session.Service
    const provider = yield* Provider.Service
    const approval = yield* PlanApproval.Service
    const mailbox = yield* MailboxService
    const teams = yield* TeamService
    const files = yield* AppFileSystem.Service
    const superAgent = Option.getOrUndefined(yield* Effect.serviceOption(SuperAgentStore))
    const goals = Option.getOrUndefined(yield* Effect.serviceOption(Goal.Service))
    const toolRegistry = Option.getOrUndefined(yield* Effect.serviceOption(ToolRegistryService))
    // 可选：只有装了 workflow 策略的宿主才有 phase 概念。最小 layer 组合（测试、
    // 嵌入方）跑不到它，就不去改 phase，其它行为完全不变。
    const workflowPolicy = Option.getOrUndefined(yield* Effect.serviceOption(WorkflowPolicyService))
    // 客户端能渲染什么由能力协商决定，不看客户端名字（见 effect/client-capabilities）。
    // 最小 layer（测试、嵌入方）没有它，那就按"能渲染"处理。
    const capabilities = Option.getOrUndefined(yield* Effect.serviceOption(ClientCapabilities.Service))

    return {
      description: EXIT_DESCRIPTION,
      parameters: Parameters,
      execute: (_params: {}, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const instance = yield* InstanceState.context
          const info = yield* session.get(ctx.sessionID)
          const plan = path.relative(instance.worktree, Session.plan(info, instance))
          const planText = yield* files.readFileStringSafe(Session.plan(info, instance)).pipe(
            Effect.map((value) => value ?? ""),
            Effect.orElseSucceed(() => ""),
          )
          const planPreview = planText.trim().slice(0, 12_000)
          const permissionMode = yield* session.permissionModeOf(ctx.sessionID)
          let executeInGoalMode = false
          let executeAsLongTask = false
          let interactiveGoalID: string | undefined
          let approvalRequestID: string | undefined
          if (permissionMode !== "plan" && permissionMode !== "unattended") {
            return {
              title: "Plan mode is not active",
              output: "Plan mode is not active. Continue under the current permission mode.",
              metadata: {},
            }
          }
          // 无人值守：没人来点"开始实施"。计划是模型自己写的，它调用 plan_exit
          // 就是它自己的决定 —— 直接当作通过，继续往下走。
          if (permissionMode === "unattended") {
            // no-op: 跳过下面的交互式确认
          } else if (info.parentID) {
            const team = yield* teams.ofSession(ctx.sessionID).pipe(Effect.catch(() => Effect.succeed(undefined)))
            const lead = team ? (yield* teams.members(team.id)).find((member) => member.role === "lead") : undefined
            const to = lead?.name ?? info.parentID
            yield* mailbox
              .send({
                teamID: team?.id ?? "default",
                fromSessionID: ctx.sessionID,
                toSessionID: info.parentID,
                summary: `plan approval: ${plan}`,
                content: JSON.stringify({ type: "plan_approval_request", plan, to }),
              })
              .pipe(Effect.ignore)

            const decision = yield* approval.request({
              sessionID: ctx.sessionID,
              parentID: info.parentID,
              messageID: ctx.messageID,
              plan,
            })
            if (!decision.approved) {
              return {
                title: "继续完善计划",
                output: decision.feedback
                  ? `The plan remains active. The user requested these changes: ${decision.feedback}`
                  : "The plan remains active. Continue refining it based on the user's feedback.",
                metadata: {
                  approvalState: "continue",
                  ...(decision.feedback ? { feedback: decision.feedback } : {}),
                  plan,
                  planText: planPreview,
                },
              }
            }
            executeInGoalMode = decision.execution === "goal"
            executeAsLongTask = decision.execution === "long_task"
            if (executeInGoalMode) {
              const goalService = goals
              if (!goalService)
                return yield* Effect.die(new Error("Interactive goal execution is unavailable in this session."))
              const goal = yield* goalService.create({
                sessionId: ctx.sessionID,
                title: `执行计划：${plan}`,
                description: planText,
                status: "in_progress",
                successCriteria: ["完成计划文件中的全部实施步骤", "运行计划中要求的验证并提供可复核证据"],
                executionConfig: { maxIterations: 20, verifier: "agent", mode: "interactive" },
              })
              interactiveGoalID = goal.id
            }
          } else if (capabilities && !capabilities.has("question") && !capabilities.has("plan")) {
            // 客户端既渲染不了交互提问、也没有计划审批 UI（典型是 ACP/纯文本通道）：
            // 弹一个没人能点的三选一，只会让整轮挂在这里等人点一个不存在的按钮。
            // 让模型继续规划，把计划写在回复里交给人看。
            return {
              title: "Plan approval requires an interactive client",
              output:
                "Plan approval requires an interactive client; keep planning and report the plan in your message.",
              metadata: {},
            }
          } else {
            // 主会话和子代理统一走 PlanApproval：审批是计划领域的专用交互，
            // 不能再复用 question 工具，否则聊天区会显示一张英文问卷卡，
            // 而不是计划文档审批卡。
            const decision = yield* approval.request({
              sessionID: ctx.sessionID,
              messageID: ctx.messageID,
              plan,
              title: "计划审批",
              onPending: (pending) => {
                approvalRequestID = pending.id
                return ctx.metadata({
                  title: "等待计划审批",
                  metadata: {
                    approvalState: "pending",
                    requestID: pending.id,
                    plan,
                    planText: planPreview,
                  },
                })
              },
            })
            yield* ctx.metadata({
              title: decision.approved ? "计划已批准" : "继续完善计划",
              metadata: {
                approvalState: decision.approved ? "approved" : "continue",
                ...(approvalRequestID ? { requestID: approvalRequestID } : {}),
                plan,
                planText: planPreview,
                ...(decision.feedback ? { feedback: decision.feedback } : {}),
                ...(decision.execution ? { execution: decision.execution } : {}),
              },
            })
            if (!decision.approved) {
              return {
                title: "继续完善计划",
                output: decision.feedback
                  ? `The plan remains active. The user requested these changes: ${decision.feedback}`
                  : "The plan remains active. Continue refining it based on the user's feedback.",
                metadata: {
                  approvalState: "continue",
                  ...(decision.feedback ? { feedback: decision.feedback } : {}),
                  plan,
                  planText: planPreview,
                },
              }
            }
            executeInGoalMode = decision.execution === "goal"
            executeAsLongTask = decision.execution === "long_task"
            if (executeInGoalMode) {
              const goalService = goals
              if (!goalService)
                return yield* Effect.die(new Error("Interactive goal execution is unavailable in this session."))
              const goal = yield* goalService.create({
                sessionId: ctx.sessionID,
                title: `执行计划：${plan}`,
                description: planText,
                status: "in_progress",
                successCriteria: ["完成计划文件中的全部实施步骤", "运行计划中要求的验证并提供可复核证据"],
                executionConfig: { maxIterations: 20, verifier: "agent", mode: "interactive" },
              })
              interactiveGoalID = goal.id
            }
          }

          const returnMode = yield* session.planReturnModeOf(ctx.sessionID)
          if (permissionMode === "plan") {
            yield* session.setPermissionMode({ sessionID: ctx.sessionID, mode: returnMode })
            yield* session.setPlanReturnMode({ sessionID: ctx.sessionID, mode: undefined })
          }

          // 走到这里就等于“审批通过”：继续完善计划在上面已正常返回，不会进入实施分支；
          // 无人值守是自动通过；普通目标会创建 interactive Goal；长期任务会启动 durable runner。
          // 用户的第一个动作通常是"照计划改文件"。这里先把 phase 前推到 implementation，
          // 让本轮后续的工具调用不被门禁误拦；下一轮 `beginTurn` 会按这条合成消息重新
          // 分类成 grill-me，那一侧由 `SessionPrompt.run` 在 beginTurn 之后同样覆盖
          // （见 prompt.ts 的 `approvedByPlanExit`）—— 两处缺一不可。
          // 策略服务是软依赖：没装 workflow 的宿主没有 phase 概念，跳过即可。
          if (workflowPolicy) {
            yield* workflowPolicy.setPhase({ sessionID: ctx.sessionID, phase: "implementation" })
          }

          const goalRun = executeAsLongTask
            ? !superAgent || !toolRegistry
              ? yield* Effect.die(new Error("Goal execution is unavailable in this session."))
              : yield* PlanExecution.launchApprovedPlan({
                  sessionID: ctx.sessionID,
                  directory: info.directory,
                  planPath: plan,
                  planText,
                  sessions: session,
                  store: superAgent,
                  provider,
                  toolRegistry,
                })
            : undefined

          const messages = yield* session.messages({ sessionID: ctx.sessionID }).pipe(Effect.orDie)
          const lastUser = messages.findLast((item) => item.info.role === "user" && item.info.model)
          const model =
            lastUser?.info.role === "user" && lastUser.info.model
              ? lastUser.info.model
              : provider
                ? yield* provider.defaultModel()
                : yield* Effect.die(new Error("plan_enter requires a session model"))

          const msg: MessageV2.User = {
            id: MessageID.ascending(),
            sessionID: ctx.sessionID,
            role: "user",
            time: { created: Date.now() },
            agent: lastUser?.info.role === "user" ? lastUser.info.agent : "creova",
            model,
          }
          yield* session.updateMessage(msg)
          yield* session.updatePart({
            id: PartID.ascending(),
            messageID: msg.id,
            sessionID: ctx.sessionID,
            type: "text",
            text: goalRun
              ? `The approved plan at ${plan} was handed to the persistent goal runner. It will implement and verify the plan in the background; do not duplicate the work in this session.`
              : executeInGoalMode
                ? `The approved plan at ${plan} was attached to an interactive goal. Continue implementing it toward the goal and keep the user involved.`
                : `The plan at ${plan} has been approved. Continue implementing the plan.`,
            synthetic: true,
          } satisfies MessageV2.TextPart)

          return {
            title: goalRun
              ? "Starting long-running task"
              : executeInGoalMode
                ? "Starting goal-driven execution"
                : "Leaving plan mode",
            output: goalRun
              ? `The approved plan is now running as a persistent long-running task with verification. run_id: ${goalRun.runID}`
              : executeInGoalMode
                ? `The approved plan is now running with an interactive goal. goal_id: ${interactiveGoalID ?? "unknown"}`
                : "The plan was approved. Plan mode is off; continue using the selected permission mode.",
            metadata: {
              approvalState: "approved",
              ...(approvalRequestID ? { requestID: approvalRequestID } : {}),
              plan,
              planText: planPreview,
              ...(goalRun
                ? { goalID: goalRun.goalID, runID: goalRun.runID, execution: "long_task", executionMode: "durable" }
                : executeInGoalMode
                  ? { goalID: interactiveGoalID, execution: "goal", executionMode: "interactive", maxIterations: 20 }
                  : { execution: "standard" }),
            },
          }
        }).pipe(Effect.orDie),
    }
  }),
)

export const EnterParameters = Schema.Struct({})

/**
 * Enter plan permission mode while retaining the current agent.
 */
export const PlanEnterTool = Tool.define<typeof EnterParameters, { agent?: string }, Session.Service>(
  "plan_enter",
  Effect.gen(function* () {
    const session = yield* Session.Service
    // The loop always has a user turn with a model by the time a tool runs; the
    // provider is only a fallback, so keep the dependency optional.
    const provider = Option.getOrUndefined(yield* Effect.serviceOption(Provider.Service))

    return {
      description: ENTER_DESCRIPTION,
      parameters: EnterParameters,
      capabilities: { concurrencySafe: false },
      execute: (_params: Schema.Schema.Type<typeof EnterParameters>, ctx: Tool.Context<{ agent?: string }>) =>
        Effect.gen(function* () {
          yield* ctx.ask({
            permission: "plan_enter",
            patterns: ["*"],
            always: ["*"],
            metadata: {},
          })

          if ((yield* session.permissionModeOf(ctx.sessionID)) === "plan") {
            return {
              title: "Already in plan mode",
              output: "Plan mode is already active. Continue with read-only research and planning.",
              metadata: {},
            }
          }

          const messages = yield* session.messages({ sessionID: ctx.sessionID }).pipe(Effect.orDie)
          const lastUser = messages.findLast((item) => item.info.role === "user" && item.info.model)

          const model =
            lastUser?.info.role === "user" && lastUser.info.model
              ? lastUser.info.model
              : provider
                ? yield* provider.defaultModel()
                : yield* Effect.die(new Error("plan_enter requires a session model"))
          // Preserve the session's explicit value, not only the effective value.
          // An inherited mode must remain inherited after plan mode ends.
          const info = yield* session.get(ctx.sessionID)
          const previousMode = info.permissionMode
          yield* session.setPlanReturnMode({ sessionID: ctx.sessionID, mode: previousMode })
          yield* session.setPermissionMode({ sessionID: ctx.sessionID, mode: "plan" })
          const msg: MessageV2.User = {
            id: MessageID.ascending(),
            sessionID: ctx.sessionID,
            role: "user",
            time: { created: Date.now() },
            agent: ctx.agent ?? "creova",
            model,
          }
          yield* session.updateMessage(msg)
          yield* session.updatePart({
            id: PartID.ascending(),
            messageID: msg.id,
            sessionID: ctx.sessionID,
            type: "text",
            text: "Plan permission mode is active. Explore read-only and write an implementation plan; do not modify project files until the permission mode changes.",
            synthetic: true,
          } satisfies MessageV2.TextPart)

          return {
            title: "Entered plan mode",
            output: "Plan permission mode is active. Continue with read-only research and planning.",
            metadata: { agent: ctx.agent ?? "creova" },
          }
        }).pipe(Effect.orDie),
    }
  }),
)
