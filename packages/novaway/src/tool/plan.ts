import path from "path"
import { Effect, Option, Schema } from "effect"
import * as Tool from "./tool"
import { Question } from "../question"
import { Session } from "@/session/session"
import { MessageV2 } from "../session/message-v2"
import { Provider } from "@/provider/provider"
import { InstanceState } from "@/effect/instance-state"
import { MessageID, PartID } from "../session/schema"
import EXIT_DESCRIPTION from "./plan-exit.txt"
import ENTER_DESCRIPTION from "./plan-enter.txt"
import { PlanApproval } from "@/session/plan-approval"
import { Service as MailboxService } from "@/team/mailbox"
import { Service as TeamService } from "@/team/team"

export const Parameters = Schema.Struct({})

export const PlanExitTool = Tool.define(
  "plan_exit",
  Effect.gen(function* () {
    const session = yield* Session.Service
    const question = yield* Question.Service
    const provider = yield* Provider.Service
    const approval = yield* PlanApproval.Service
    const mailbox = yield* MailboxService
    const teams = yield* TeamService

    return {
      description: EXIT_DESCRIPTION,
      parameters: Parameters,
      execute: (_params: {}, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const instance = yield* InstanceState.context
          const info = yield* session.get(ctx.sessionID)
          const plan = path.relative(instance.worktree, Session.plan(info, instance))
          const permissionMode = yield* session.permissionModeOf(ctx.sessionID)
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
              yield* new Question.RejectedError()
            }
          } else {
            const answers = yield* question.ask({
              sessionID: ctx.sessionID,
              questions: [
                {
                  question: `Plan at ${plan} is complete. Would you like to leave plan mode and start implementing?`,
                  header: "Plan Approval",
                  custom: false,
                  options: [
                    { label: "Yes", description: "Leave plan mode and start implementing the plan" },
                    { label: "No", description: "Stay in plan mode and continue refining the plan" },
                  ],
                },
              ],
              tool: ctx.callID ? { messageID: ctx.messageID, callID: ctx.callID } : undefined,
            })

            if (answers[0]?.[0] === "No") yield* new Question.RejectedError()
          }

          if (permissionMode === "plan") {
            yield* session.setPermissionMode({ sessionID: ctx.sessionID, mode: undefined })
          }

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
            text: `The plan at ${plan} has been approved. Continue implementing the plan.`,
            synthetic: true,
          } satisfies MessageV2.TextPart)

          return {
            title: "Leaving plan mode",
            output: "The plan was approved. Plan mode is off; continue using Creova.",
            metadata: {},
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
