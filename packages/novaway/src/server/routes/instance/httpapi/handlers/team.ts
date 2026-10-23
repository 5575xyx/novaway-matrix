import { Effect } from "effect"
import { HttpApiBuilder, HttpApiError } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { Service as TeamService } from "@/team/team"
import { Service as AgentTaskListService } from "@/team/task-list"
import { Service as AgentMailboxService } from "@/team/mailbox"
import { Service as BackgroundJobService } from "@/background/job"
import { SessionUsage } from "@/session/usage"
import { SessionID } from "@/session/schema"

/** Flatten an accounting value into the wire shape shared by members and tasks. */
function usageView(value: SessionUsage.Value | undefined) {
  if (!value) return undefined
  return {
    cost: value.cost,
    input: value.tokens.input,
    output: value.tokens.output,
    reasoning: value.tokens.reasoning,
    cacheRead: value.tokens.cacheRead,
    cacheWrite: value.tokens.cacheWrite,
    total: value.tokens.total,
  }
}

export const teamHandlers = HttpApiBuilder.group(InstanceHttpApi, "team", (handlers) =>
  Effect.gen(function* () {
    const teams = yield* TeamService
    const tasks = yield* AgentTaskListService
    const mailbox = yield* AgentMailboxService
    const background = yield* BackgroundJobService
    const usage = yield* SessionUsage.Service

    return handlers
      .handle("overview", (ctx) =>
        Effect.gen(function* () {
          const sessionID = SessionID.make(ctx.params.sessionID)
          const team = yield* teams.ofSession(sessionID)
          if (!team) return { members: [], tasks: [] }
          const members = yield* teams.members(team.id)
          const list = yield* tasks.list(team.id)
          // Usage rolls up the whole descendant tree: a worker's own subagents
          // count towards that worker, root spend counts towards the lead.
          const tree = yield* usage.tree(team.rootSessionID)
          const entries = new Map(tree.sessions.map((entry) => [entry.sessionID as string, entry]))
          // A member should always hang off the root, but keep the roster honest
          // if a session was attached after the fact (or lives in another tree).
          const outside = members.map((member) => member.sessionID).filter((id) => !entries.has(id))
          for (const entry of yield* usage.list(outside)) entries.set(entry.sessionID as string, entry)

          const totals = SessionUsage.attribute(
            entries.values(),
            members.map((member) => member.sessionID),
          )

          return {
            team: {
              id: team.id,
              name: team.name,
              description: team.description,
              rootSessionID: team.rootSessionID,
            },
            members: members.map((member) => ({
              sessionID: member.sessionID,
              name: member.name,
              agent: member.agent,
              role: member.role,
              status: member.status,
              currentTaskID: member.currentTaskID,
              worktreePath: member.worktreePath,
              usage: usageView(totals.get(member.sessionID)),
            })),
            tasks: list.map((task) => ({
              id: task.id,
              subject: task.subject,
              status: task.status,
              ownerSessionID: task.ownerSessionID,
              blockedBy: task.blockedBy,
              activeForm: task.activeForm,
              usage: usageView(SessionUsage.readMark(task.metadata.usage)),
            })),
            usage: usageView(SessionUsage.sum(entries.values())),
          }
        }),
      )
      .handle("message", (ctx) =>
        Effect.gen(function* () {
          const sessionID = SessionID.make(ctx.params.sessionID)
          const team = yield* teams.ofSession(sessionID)
          const member = team ? yield* teams.member(team.id, ctx.payload.to) : undefined
          const target = (member?.sessionID ?? ctx.payload.to) as SessionID
          yield* mailbox.send({
            teamID: team?.id ?? "default",
            fromSessionID: sessionID,
            toSessionID: target,
            summary: ctx.payload.summary,
            content: ctx.payload.message,
          })
          if (ctx.payload.mode === "interrupt") {
            yield* background.cancel(target)
          }
          return true
        }).pipe(Effect.catchCause(() => Effect.fail(new HttpApiError.BadRequest({})))),
      )
  }),
)
