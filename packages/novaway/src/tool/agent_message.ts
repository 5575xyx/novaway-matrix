import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { Service as TeamService } from "@/team/team"
import { Service as AgentMailboxService } from "@/team/mailbox"
import { Service as BackgroundJobService } from "@/background/job"
import type { SessionID, MessageID } from "@/session/schema"
import { PlanApproval } from "@/session/plan-approval"

export const AgentMessageParameters = Schema.Struct({
  to: Schema.String.annotate({ description: "Recipient: teammate name, session id, or * for broadcast" }),
  message: Schema.String.annotate({ description: "Plain text message" }),
  summary: Schema.optional(Schema.String).annotate({ description: "5-10 word preview" }),
  mode: Schema.optional(Schema.Literals(["queue", "interrupt"])).annotate({
    description: "queue delivers at the next tool round; interrupt cancels the running turn first",
  }),
})

/**
 * Structured protocol messages.
 *
 * A subagent asks for plan approval with `plan_approval_request`; the lead
 * answers with `plan_approval_response`. Both travel through `agent_message`
 * so a lead can coordinate without a bespoke tool.
 */
function protocolMessage(content: string): Record<string, unknown> | undefined {
  const trimmed = content.trim()
  if (!trimmed.startsWith("{")) return undefined
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>
    const type = typeof parsed.type === "string" ? parsed.type : ""
    if (!type.startsWith("plan_approval")) return undefined
    return parsed
  } catch {
    return undefined
  }
}

type Metadata = {
  teamID?: string
  sessionID?: string
  state?: string
  requestID?: string
  resolved?: boolean
}

type PromptOps = {
  prompt: (input: any) => Effect.Effect<unknown>
}

function text(from: SessionID, message: string) {
  return [`<agent-message from="${from}">`, message, "</agent-message>"].join("\n")
}

export const AgentMessageTool = Tool.define<
  typeof AgentMessageParameters,
  Metadata,
  TeamService | AgentMailboxService | BackgroundJobService | PlanApproval.Service
>(
  "agent_message",
  Effect.gen(function* () {
    const teams = yield* TeamService
    const mailbox = yield* AgentMailboxService
    const background = yield* BackgroundJobService
    const approval = yield* PlanApproval.Service

    const deliver = Effect.fn("AgentMessage.deliver")(function* (input: {
      target: SessionID
      from: SessionID
      content: string
      mode: "queue" | "interrupt"
      ops?: PromptOps
    }) {
      const job = yield* background.get(input.target)
      const running = job?.status === "running"

      if (running && input.mode === "interrupt") {
        yield* background.cancel(input.target)
      }

      if (running && input.mode !== "interrupt") return "queued"
      if (!input.ops) return "queued"

      yield* input.ops
        .prompt({
          sessionID: input.target,
          messageID: ("msg_" +
            Date.now().toString(36) +
            Math.random().toString(36).slice(2, 8)) as unknown as MessageID,
          parts: [{ type: "text", synthetic: true, text: text(input.from, input.content) }],
        })
        .pipe(Effect.ignore, Effect.forkDetach)
      return "delivered"
    })

    return {
      description:
        "Send a message to another agent. Running agents receive it at their next tool round; idle agents are resumed.",
      parameters: AgentMessageParameters,
      capabilities: { concurrencySafe: false },
      execute: (params: Schema.Schema.Type<typeof AgentMessageParameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const team = yield* teams.ofSession(ctx.sessionID)
          const mode = params.mode ?? "queue"
          const ops = ctx.extra?.promptOps as PromptOps | undefined

          if (params.to === "*") {
            if (!team) return { title: "No team", output: "Broadcast requires a team.", metadata: {} }
            const members = (yield* teams.members(team.id)).filter((member) => member.sessionID !== ctx.sessionID)
            const delivered: string[] = []
            for (const member of members) {
              yield* mailbox.send({
                teamID: team.id,
                fromSessionID: ctx.sessionID,
                toSessionID: member.sessionID,
                summary: params.summary,
                content: params.message,
              })
              const state = yield* deliver({
                target: member.sessionID,
                from: ctx.sessionID,
                content: params.message,
                mode,
                ops,
              })
              delivered.push(`${member.name}:${state}`)
            }
            return {
              title: "Broadcast sent",
              output: `Broadcast to ${delivered.length} agents.\n${delivered.join("\n")}`,
              metadata: { teamID: team.id },
            }
          }

          // Structured reply: resolve a pending plan approval instead of
          // queuing a chat message.
          const protocol = protocolMessage(params.message)
          if (protocol?.type === "plan_approval_response") {
            const requestID = typeof protocol.request_id === "string" ? protocol.request_id : undefined
            if (!requestID) {
              return { title: "Invalid response", output: "plan_approval_response needs request_id.", metadata: {} }
            }
            const ok = yield* approval.reply({
              id: requestID as never,
              approved: protocol.approve === true || protocol.approve === "true",
              ...(typeof protocol.feedback === "string" ? { feedback: protocol.feedback } : {}),
            })
            return {
              title: ok ? "Plan approved" : "Plan request not found",
              output: ok
                ? `Plan request ${requestID} resolved (${protocol.approve === true ? "approved" : "rejected"}).`
                : `No pending plan request ${requestID}.`,
              metadata: { requestID, resolved: ok },
            }
          }

          const member = team ? yield* teams.member(team.id, params.to) : undefined
          const target = (member?.sessionID ?? params.to) as SessionID

          yield* mailbox.send({
            teamID: team?.id ?? "default",
            fromSessionID: ctx.sessionID,
            toSessionID: target,
            summary: params.summary,
            content: params.message,
          })
          const state = yield* deliver({ target, from: ctx.sessionID, content: params.message, mode, ops })
          return {
            title: `Message to ${params.to}`,
            output: `Message ${state} for ${member?.name ?? params.to}.`,
            metadata: { sessionID: target, state },
          }
        }).pipe(Effect.orDie),
    }
  }),
)
