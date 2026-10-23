import path from "path"
import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { Question } from "../question"
import { Session } from "@/session/session"
import { MessageV2 } from "../session/message-v2"
import { Provider } from "@/provider/provider"
import { InstanceState } from "@/effect/instance-state"
import { MessageID, PartID } from "../session/schema"
import EXIT_DESCRIPTION from "./plan-exit.txt"
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
            lastUser?.info.role === "user" && lastUser.info.model ? lastUser.info.model : yield* provider.defaultModel()

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
