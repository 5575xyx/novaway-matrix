import { Effect, Scope } from "effect"
import { HttpApiBuilder, HttpApiError } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { Service as TeamService, type Member, type Team } from "@/team/team"
import { Service as AgentTaskListService } from "@/team/task-list"
import { Service as AgentMailboxService } from "@/team/mailbox"
import { Service as BackgroundJobService } from "@/background/job"
import { SessionUsage } from "@/session/usage"
import { MessageID, PartID, SessionID } from "@/session/schema"
import { Session } from "@/session/session"
import { SessionPrompt } from "@/session/prompt"

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
    const sessions = yield* Session.Service
    const promptSvc = yield* SessionPrompt.Service
    const scope = yield* Scope.Scope

    const usageFor = Effect.fn("TeamHttpApi.usageFor")(function* (team: Team, members: Member[]) {
      // Usage rolls up the whole descendant tree: a worker's own subagents
      // count towards that worker, root spend counts towards the lead.
      const tree = yield* usage.tree(team.rootSessionID)
      const entries = new Map(tree.sessions.map((entry) => [entry.sessionID as string, entry]))
      // A member should always hang off the root, but keep the roster honest
      // if a session was attached after the fact (or lives in another tree).
      const outside = members.map((member) => member.sessionID).filter((id) => !entries.has(id))
      for (const entry of yield* usage.list(outside)) entries.set(entry.sessionID as string, entry)
      return {
        entries,
        totals: SessionUsage.attribute(
          entries.values(),
          members.map((member) => member.sessionID),
        ),
        total: usageView(SessionUsage.sum(entries.values())),
      }
    })

    /** Shared shape for the session-scoped and workspace-scoped team routes. */
    const detail = Effect.fn("TeamHttpApi.detail")(function* (team: Team) {
      const members = yield* teams.members(team.id)
      const list = yield* tasks.list(team.id)
      const rollup = yield* usageFor(team, members)
      const messages = yield* mailbox.team(team.id)
      const names = new Map(members.map((member) => [member.sessionID as string, member.name]))
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
          usage: usageView(rollup.totals.get(member.sessionID)),
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
        usage: rollup.total,
        messages: messages.map((message) => ({
          id: message.id,
          from: message.fromSessionID,
          fromName: names.get(message.fromSessionID as string),
          to: message.toSessionID,
          toName: message.toSessionID ? names.get(message.toSessionID as string) : undefined,
          broadcast: message.broadcast,
          summary: message.summary,
          content: message.content,
          createdAt: message.createdAt,
          readAt: message.readAt,
        })),
      }
    })

    /** Create a session for an agent and attach it as a worker. */
    const addMember = Effect.fn("TeamHttpApi.addMember")(function* (
      team: Team,
      input: { agent: string; name?: string },
    ) {
      const existing = (yield* teams.members(team.id)).filter((member) => member.role === "worker")
      const label = input.name?.trim() || input.agent
      const clash = existing.some((member) => member.name === label)
      // 成员会话要沿用团队根的权限档位：默认「每次确认」会让被派发的成员
      // 卡在权限弹窗上，团队页永远等不到回复。
      const root = yield* sessions.get(team.rootSessionID).pipe(Effect.catchCause(() => Effect.succeed(undefined)))
      const session = yield* sessions.create({
        parentID: team.rootSessionID,
        title: team.name + " · " + label,
        agent: input.agent,
        ...(root?.permissionMode ? { permissionMode: root.permissionMode } : {}),
        ...(root?.permission ? { permission: root.permission } : {}),
      })
      return yield* teams.addMember({
        teamID: team.id,
        sessionID: session.id,
        name: clash ? label + " #" + session.id.slice(-4) : label,
        agent: input.agent,
        role: "worker",
      })
    })

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
      .handle("listTeams", () =>
        Effect.gen(function* () {
          const list = yield* teams.list()
          return yield* Effect.forEach(
            list,
            (team) =>
              Effect.gen(function* () {
                const members = yield* teams.members(team.id)
                return {
                  id: team.id,
                  name: team.name,
                  description: team.description,
                  rootSessionID: team.rootSessionID,
                  memberCount: members.length,
                  updatedAt: team.updatedAt,
                }
              }),
            { concurrency: 1 },
          )
        }),
      )
      .handle("createTeam", (ctx) =>
        Effect.gen(function* () {
          const name = ctx.payload.name.trim()
          // An empty roster would leave nothing to dispatch to; the page always
          // sends at least one employee.
          if (!name) return yield* Effect.fail(new HttpApiError.BadRequest({}))
          const root = yield* sessions.create({
            title: name,
            agent: ctx.payload.lead?.trim() || undefined,
          })
          const team = yield* teams.create({
            name,
            description: ctx.payload.description?.trim() || undefined,
            rootSessionID: root.id,
          })
          // 根会话就是团队协调者：把它也记进名单，团队页才会显示「协调者」，
          // 用量也会归到它名下。
          yield* teams.addMember({
            teamID: team.id,
            sessionID: root.id,
            name: "team-lead",
            agent: ctx.payload.lead?.trim() || "build",
            role: "lead",
          })
          for (const member of ctx.payload.members) {
            const agent = member.agent?.trim()
            if (!agent) continue
            yield* addMember(team, { agent, name: member.name })
          }
          return yield* detail(team)
        }).pipe(Effect.catchCause(() => Effect.fail(new HttpApiError.BadRequest({})))),
      )
      .handle("teamDetail", (ctx) =>
        Effect.gen(function* () {
          const team = yield* teams.get(ctx.params.teamID)
          if (!team) return yield* Effect.fail(new HttpApiError.NotFound({}))
          return yield* detail(team)
        }).pipe(Effect.catchCause(() => Effect.fail(new HttpApiError.NotFound({})))),
      )
      .handle("removeTeam", (ctx) =>
        Effect.gen(function* () {
          const team = yield* teams.get(ctx.params.teamID)
          if (!team) return yield* Effect.fail(new HttpApiError.NotFound({}))
          const members = yield* teams.members(team.id)
          yield* teams.remove(team.id)
          // 团队页新建的成员会话只为这个团队服务；团队删掉后把 worker 归档，
          // 否则侧栏会留下一串没人用的「团队 · 角色」会话。根会话保留，
          // 它是内核动态组队时也可能复用的真实会话。
          for (const member of members) {
            if (member.role === "lead") continue
            yield* sessions
              .setArchived({ sessionID: member.sessionID, time: Date.now() })
              .pipe(Effect.catchCause(() => Effect.void))
          }
          return true
        }).pipe(Effect.catchCause(() => Effect.fail(new HttpApiError.NotFound({})))),
      )
      .handle("addTeamMember", (ctx) =>
        Effect.gen(function* () {
          const team = yield* teams.get(ctx.params.teamID)
          if (!team) return yield* Effect.fail(new HttpApiError.NotFound({}))
          const agent = ctx.payload.agent?.trim()
          if (!agent) return yield* Effect.fail(new HttpApiError.BadRequest({}))
          yield* addMember(team, { agent, name: ctx.payload.name })
          return yield* detail(team)
        }).pipe(Effect.catchCause(() => Effect.fail(new HttpApiError.BadRequest({})))),
      )
      .handle("removeTeamMember", (ctx) =>
        Effect.gen(function* () {
          const team = yield* teams.get(ctx.params.teamID)
          if (!team) return yield* Effect.fail(new HttpApiError.NotFound({}))
          yield* teams.removeMember({
            teamID: team.id,
            sessionID: SessionID.make(ctx.params.sessionID),
          })
          return true
        }).pipe(Effect.catchCause(() => Effect.fail(new HttpApiError.NotFound({})))),
      )
      .handle("teamMessages", (ctx) =>
        Effect.gen(function* () {
          const team = yield* teams.get(ctx.params.teamID)
          if (!team) return yield* Effect.fail(new HttpApiError.NotFound({}))
          return (yield* detail(team)).messages
        }).pipe(Effect.catchCause(() => Effect.fail(new HttpApiError.NotFound({})))),
      )
      .handle("sendTeamMessage", (ctx) =>
        Effect.gen(function* () {
          const team = yield* teams.get(ctx.params.teamID)
          if (!team) return yield* Effect.fail(new HttpApiError.NotFound({}))
          const content = ctx.payload.content.trim()
          if (!content) return yield* Effect.fail(new HttpApiError.BadRequest({}))

          const members = yield* teams.members(team.id)
          const lead = members.find((member) => member.role === "lead")
          // The page speaks through the lead so the transcript reads like a
          // group chat where one coordinator hands work out.
          const from = (lead?.sessionID ?? team.rootSessionID) as SessionID
          const wanted = ctx.payload.to?.trim()
          const targets = wanted
            ? members.filter((member) => member.name === wanted || member.sessionID === wanted)
            : members.filter((member) => member.role !== "lead")
          if (targets.length === 0) return yield* Effect.fail(new HttpApiError.BadRequest({}))

          for (const target of targets) {
            yield* mailbox.send({
              teamID: team.id,
              fromSessionID: from,
              toSessionID: target.sessionID,
              content,
            })
          }

          // 统一调度：消息同时送进成员会话，让他们真的开始干活，回复再回流群聊。
          // 派发在后台 fiber 里跑，HTTP 请求立即返回，长任务不会卡住页面。
          if (ctx.payload.dispatch !== false) {
            for (const target of targets) {
              const run = promptSvc
                .prompt({
                  sessionID: target.sessionID,
                  messageID: MessageID.ascending(),
                  parts: [{ id: PartID.ascending(), type: "text", text: content }],
                })
                .pipe(
                  Effect.flatMap((message) => {
                    const text = message.parts
                      .flatMap((part) => (part.type === "text" ? [part.text] : []))
                      .join(String.fromCharCode(10))
                      .trim()
                    if (!text) return Effect.void
                    return mailbox
                      .send({
                        teamID: team.id,
                        fromSessionID: target.sessionID,
                        toSessionID: from,
                        summary: "reply from " + target.name,
                        content: text,
                      })
                      .pipe(Effect.asVoid)
                  }),
                  Effect.catchCause((cause) =>
                    mailbox
                      .send({
                        teamID: team.id,
                        fromSessionID: target.sessionID,
                        toSessionID: from,
                        summary: target.name + " failed",
                        content: "[" + target.name + "] could not complete the task: " + String(cause),
                      })
                      .pipe(Effect.asVoid),
                  ),
                )
              yield* run.pipe(Effect.forkIn(scope))
            }
          }
          return true
        }).pipe(Effect.catchCause(() => Effect.fail(new HttpApiError.BadRequest({})))),
      )
  }),
)
