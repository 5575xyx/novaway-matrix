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

          // Subagents have no human watching them: the lead decides instead of
          // an interactive prompt. The request goes out as a message so it
          // shows up in the lead's transcript, and we block on the reply.
          if (info.parentID) {
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
                  question: `Plan at ${plan} is complete. Would you like to switch to the build agent and start implementing?`,
                  header: "Build Agent",
                  custom: false,
                  options: [
                    { label: "Yes", description: "Switch to build agent and start implementing the plan" },
                    { label: "No", description: "Stay with plan agent to continue refining the plan" },
                  ],
                },
              ],
              tool: ctx.callID ? { messageID: ctx.messageID, callID: ctx.callID } : undefined,
            })

            if (answers[0]?.[0] === "No") yield* new Question.RejectedError()
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
            agent: "build",
            model,
          }
          yield* session.updateMessage(msg)
          yield* session.updatePart({
            id: PartID.ascending(),
            messageID: msg.id,
            sessionID: ctx.sessionID,
            type: "text",
            text: `The plan at ${plan} has been approved, you can now edit files. Execute the plan`,
            synthetic: true,
          } satisfies MessageV2.TextPart)

          return {
            title: "Switching to build agent",
            output: "User approved switching to build agent. Wait for further instructions.",
            metadata: {},
          }
        }).pipe(Effect.orDie),
    }
  }),
)

export const EnterParameters = Schema.Struct({})

/**
 * Enter plan mode (CC `EnterPlanMode`). Switching agents is done the same way
 * `plan_exit` leaves it: append a synthetic user message carrying the agent
 * name, so the next step of the loop resolves `plan` from `lastUser.agent`.
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

          const messages = yield* session.messages({ sessionID: ctx.sessionID }).pipe(Effect.orDie)
          const lastUser = messages.findLast((item) => item.info.role === "user" && item.info.model)
          if (lastUser?.info.role === "user" && lastUser.info.agent === "plan") {
            return {
              title: "Already in plan mode",
              output: "This session is already running the plan agent. Explore read-only and write the plan file.",
              metadata: { agent: "plan" },
            }
          }

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
            agent: "plan",
            model,
          }
          yield* session.updateMessage(msg)
          yield* session.updatePart({
            id: PartID.ascending(),
            messageID: msg.id,
            sessionID: ctx.sessionID,
            type: "text",
            text: "Switched to plan mode. Explore the codebase read-only and write an implementation plan; do not modify project files until the plan is approved.",
            synthetic: true,
          } satisfies MessageV2.TextPart)

          return {
            title: "Entered plan mode",
            output:
              "Entered plan mode. Explore the codebase, ask clarifying questions if needed, and write the plan to the plan file. Call plan_exit when the plan is ready for approval.",
            metadata: { agent: "plan" },
          }
        }).pipe(Effect.orDie),
    }
  }),
)
