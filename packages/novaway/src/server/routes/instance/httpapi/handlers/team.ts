import { Cause, Effect, Scope } from "effect"
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
import { Provider } from "@/provider/provider"
import { ModelID, ProviderID } from "@/provider/schema"
import { describeFailure, modelNotice, pickDispatchModel, type DispatchModel } from "@/team/model-fallback"
import type { Model as TeamModel } from "@/team/effective"
import { formatModel, parseModel } from "@/team/effective"

/** 领域模型 → 线上形状（`provider/model`）；没有选择就是 `undefined`，不要编一个默认值。 */
const modelRef = (model: TeamModel | undefined) => formatModel(model)

/**
 * `provider/model` → 领域模型。
 *
 * `undefined` = 没传（不改），`""` = 清掉（回到上层默认），格式不对也返回 undefined，
 * 由调用方决定是拒绝还是忽略 —— 这里不替调用方猜。
 */
const readModel = (text: string | undefined): TeamModel | null | undefined => {
  if (text === undefined) return undefined
  const trimmed = text.trim()
  if (!trimmed) return null
  return parseModel(trimmed)
}

/** 传了非空模型但格式不对：明确拒绝，不把拼写错误悄悄当成「没改」。 */
const malformedModel = (text: string | undefined) => text !== undefined && text.trim().length > 0 && !parseModel(text)

/** 会话里要落的模型结构（与 `Session.create` 的 `model` 参数一致）。 */
const sessionModel = (model: TeamModel | undefined) =>
  model ? { id: ModelID.make(model.modelID), providerID: ProviderID.make(model.providerID) } : undefined

/** `Session.setModel` 的形状：会话更新用 `modelID`，创建用 `id`。 */
const patchedModel = (model: TeamModel | undefined) =>
  model ? { providerID: model.providerID, modelID: model.modelID } : undefined

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
    const providers = yield* Provider.Service
    const scope = yield* Scope.Scope

    /**
     * 派发前先确认成员的模型还在。
     *
     * 成员会话会记住它创建时用的模型；网关目录换代后那个 id 可能已经不存在，
     * 于是每一次派发都死在 `ProviderModelNotFoundError` 上 —— 对用户来说就是
     * 「这支队突然不能用了」，而聊天里只看到一串 `Cause([Die(...)])`。
     * 可用的顺序（会话记住的 → 默认模型）与提示文案都在 `team/model-fallback`，
     * 这里只负责问 provider「这个模型还在不在」。
     */
    const modelUsable = (model: DispatchModel) =>
      providers.getModel(model.providerID as never, model.modelID as never).pipe(
        Effect.map(() => true),
        Effect.catchTag("ProviderModelNotFoundError", () => Effect.succeed(false)),
        Effect.catchCause(() => Effect.succeed(false)),
      )

    const dispatchModel = Effect.fn("TeamHttpApi.dispatchModel")(function* (
      sessionID: SessionID,
      /** 用户为这个成员选的模型：成员覆盖 → 团队默认。 */
      preferred?: DispatchModel | undefined,
    ) {
      const session = yield* sessions.get(sessionID).pipe(Effect.catchCause(() => Effect.succeed(undefined)))
      const pinned: DispatchModel | undefined = session?.model
        ? { providerID: session.model.providerID, modelID: session.model.id }
        : undefined
      const pinnedUsable = pinned ? yield* modelUsable(pinned) : false
      const preferredUsable = preferred ? yield* modelUsable(preferred) : false
      const fallback = yield* providers.defaultModel().pipe(Effect.catchCause(() => Effect.succeed(undefined)))
      return pickDispatchModel({
        ...(preferred ? { preferred, preferredUsable } : {}),
        ...(pinned ? { pinned } : {}),
        pinnedUsable,
        ...(fallback ? { fallback } : {}),
      })
    })

    /** 同一个成员的同一次回退只说一次（避免每条回复都念一遍）。 */
    const fallbackSeen = new Map<string, string>()
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
          autoEligible: team.autoEligible,
          model: modelRef(team.model),
        },
        members: members.map((member) => ({
          sessionID: member.sessionID,
          name: member.name,
          agent: member.agent,
          role: member.role,
          status: member.status,
          currentTaskID: member.currentTaskID,
          worktreePath: member.worktreePath,
          model: modelRef(member.model),
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
      input: { agent: string; name?: string; model?: TeamModel },
    ) {
      const existing = (yield* teams.members(team.id)).filter((member) => member.role === "worker")
      const label = input.name?.trim() || input.agent
      const clash = existing.some((member) => member.name === label)
      // 成员会话语义上属于这支队：先按「自己的选择 → 团队默认」定模型，
      // 创建时就写进会话，点进成员会话看到的与群聊里派发的才是同一个。
      const effective = input.model ?? team.model
      // 成员会话要沿用团队根的权限档位：默认「每次确认」会让被派发的成员
      // 卡在权限弹窗上，团队页永远等不到回复。
      const root = yield* sessions.get(team.rootSessionID).pipe(Effect.catchCause(() => Effect.succeed(undefined)))
      const session = yield* sessions.create({
        parentID: team.rootSessionID,
        title: team.name + " · " + label,
        agent: input.agent,
        ...(effective ? { model: sessionModel(effective)! } : {}),
        ...(root?.permissionMode ? { permissionMode: root.permissionMode } : {}),
        ...(root?.permission ? { permission: root.permission } : {}),
      })
      return yield* teams.addMember({
        teamID: team.id,
        sessionID: session.id,
        name: clash ? label + " #" + session.id.slice(-4) : label,
        agent: input.agent,
        role: "worker",
        // 只记成员自己的覆盖；跟随团队的那部分留空，团队换模型时跟着换。
        ...(input.model ? { model: input.model } : {}),
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
              autoEligible: team.autoEligible,
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
                  // 群聊头像最多叠三个：列表里的头像是「认脸」，不是完整名册。
                  members: members.slice(0, 3).map((member) => ({
                    name: member.name,
                    agent: member.agent,
                    role: member.role,
                  })),
                  autoEligible: team.autoEligible,
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
          if (malformedModel(ctx.payload.model)) return yield* Effect.fail(new HttpApiError.BadRequest({}))
          const model = readModel(ctx.payload.model)
          const root = yield* sessions.create({
            title: name,
            agent: ctx.payload.lead?.trim() || undefined,
            ...(model ? { model: sessionModel(model)! } : {}),
          })
          const team = yield* teams.create({
            name,
            description: ctx.payload.description?.trim() || undefined,
            rootSessionID: root.id,
            ...(model ? { model } : {}),
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
            if (malformedModel(member.model)) return yield* Effect.fail(new HttpApiError.BadRequest({}))
            const override = readModel(member.model) || undefined
            yield* addMember(team, { agent, name: member.name, ...(override ? { model: override } : {}) })
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
      .handle("updateTeam", (ctx) =>
        Effect.gen(function* () {
          const team = yield* teams.get(ctx.params.teamID)
          if (!team) return yield* Effect.fail(new HttpApiError.NotFound({}))
          // 只把显式给出的字段写下去：`undefined` 表示「不改」，不能当成清空。
          const name = ctx.payload.name?.trim()
          const description = ctx.payload.description?.trim()
          if (ctx.payload.name !== undefined && !name) return yield* Effect.fail(new HttpApiError.BadRequest({}))
          if (malformedModel(ctx.payload.model)) return yield* Effect.fail(new HttpApiError.BadRequest({}))
          const model = readModel(ctx.payload.model)
          const updated = yield* teams.update({
            teamID: team.id,
            ...(name ? { name } : {}),
            ...(description !== undefined ? { description } : {}),
            ...(ctx.payload.autoEligible !== undefined ? { autoEligible: ctx.payload.autoEligible } : {}),
            ...(model !== undefined ? { model } : {}),
          })
          if (!updated) return yield* Effect.fail(new HttpApiError.NotFound({}))
          // 团队默认模型变了：没有单独选择的成员会话跟着换，避免「团队页显示 A、
          // 点进去的成员会话还在用 B」。自己有选择的成员保持不动。
          if (model !== undefined) {
            for (const member of yield* teams.members(team.id)) {
              if (member.model) continue
              yield* sessions
                .setModel({ sessionID: member.sessionID, model: patchedModel(updated.model) ?? null })
                .pipe(Effect.catchCause(() => Effect.void))
            }
          }
          return yield* detail(updated)
        }).pipe(Effect.catchCause(() => Effect.fail(new HttpApiError.BadRequest({})))),
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
          if (malformedModel(ctx.payload.model)) return yield* Effect.fail(new HttpApiError.BadRequest({}))
          const model = readModel(ctx.payload.model) || undefined
          yield* addMember(team, { agent, name: ctx.payload.name, ...(model ? { model } : {}) })
          return yield* detail(team)
        }).pipe(Effect.catchCause(() => Effect.fail(new HttpApiError.BadRequest({})))),
      )
      .handle("updateTeamMember", (ctx) =>
        Effect.gen(function* () {
          const team = yield* teams.get(ctx.params.teamID)
          if (!team) return yield* Effect.fail(new HttpApiError.NotFound({}))
          const sessionID = SessionID.make(ctx.params.sessionID)
          const member = yield* teams.member(team.id, ctx.params.sessionID)
          if (!member) return yield* Effect.fail(new HttpApiError.NotFound({}))
          if (malformedModel(ctx.payload.model)) return yield* Effect.fail(new HttpApiError.BadRequest({}))
          const model = readModel(ctx.payload.model)
          const updated = yield* teams.updateMember({
            teamID: team.id,
            sessionID,
            ...(model !== undefined ? { model } : {}),
          })
          if (!updated) return yield* Effect.fail(new HttpApiError.NotFound({}))
          // 会话也要同步：成员会话是「这个人干活的地方」，模型不能和团队页显示的分叉。
          if (model !== undefined) {
            yield* sessions
              .setModel({ sessionID, model: patchedModel(updated.model ?? team.model) ?? null })
              .pipe(Effect.catchCause(() => Effect.void))
          }
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
              const run = Effect.gen(function* () {
                // 用户显式选过的模型优先；成员没选就跟随团队默认，
                // 两样都没有才轮到这个会话自己记住的模型。
                const picked = yield* dispatchModel(target.sessionID, target.model ?? team.model)
                if (!picked) return yield* Effect.fail("没有可用的模型")
                return yield* promptSvc
                  .prompt({
                    sessionID: target.sessionID,
                    messageID: MessageID.ascending(),
                    model: {
                      providerID: ProviderID.make(picked.model.providerID),
                      modelID: ModelID.make(picked.model.modelID),
                    },
                    parts: [{ id: PartID.ascending(), type: "text", text: content }],
                  })
                  .pipe(
                    Effect.flatMap((message) => {
                      const text = message.parts
                        .flatMap((part) => (part.type === "text" ? [part.text] : []))
                        .join(String.fromCharCode(10))
                        .trim()
                      if (!text) return Effect.void
                      // 回退模型是这次回复的事实之一：写在回复里，事后可解释。
                      const notice = modelNotice(fallbackSeen, target.sessionID, picked)
                      return mailbox
                        .send({
                          teamID: team.id,
                          fromSessionID: target.sessionID,
                          toSessionID: from,
                          summary: "reply from " + target.name,
                          content: notice + text,
                        })
                        .pipe(Effect.asVoid)
                    }),
                  )
              }).pipe(
                Effect.catchCause((cause) =>
                  mailbox
                    .send({
                      teamID: team.id,
                      fromSessionID: target.sessionID,
                      toSessionID: from,
                      summary: target.name + " failed",
                      content: "[" + target.name + "] 没能完成这次任务：" + describeFailure(Cause.squash(cause)),
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
