import { Agent } from "@/agent/agent"
import { Provider } from "@/provider/provider"
import { generateObject, generateText, type ModelMessage } from "ai"
import { InstanceStore } from "@/project/instance-store"
import { Project } from "@/project/project"
import { InstanceRef } from "@/effect/instance-ref"
import { AppFileSystem } from "@novaway/core/filesystem"
import { Global } from "@novaway/core/global"
import path from "node:path"
import { randomUUID } from "node:crypto"
import { BackgroundJob } from "@/background/job"
import { TempFiles } from "@/session/temp-files"
import { Bus } from "@/bus"
import { Command } from "@/command"
import { Permission } from "@/permission"
import { PermissionID } from "@/permission/schema"
import { SessionShare } from "@/share/session"
import { Session } from "@/session/session"
import { Service as TeamProfileService } from "@/team/profile"
import { SessionCompaction } from "@/session/compaction"
import { MessageV2 } from "@/session/message-v2"
import { SessionPrompt } from "@/session/prompt"
import { SessionRevert } from "@/session/revert"
import { SessionRunState } from "@/session/run-state"
import { SessionStatus } from "@/session/status"
import { Service as PlanApprovalService } from "@/session/plan-approval"
import { Service as DocumentReviewService } from "@/session/document-review"
import * as InstanceState from "@/effect/instance-state"
import { SessionSummary } from "@/session/summary"
import { SessionPortability } from "@/session/portability"
import { Todo } from "@/session/todo"
import { MessageID, PartID, SessionID } from "@/session/schema"
import { NamedError } from "@novaway/core/util/error"
import { Cause, Effect, Option, Schema, Scope } from "effect"
import * as Stream from "effect/Stream"
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { HttpApiBuilder, HttpApiError, HttpApiSchema } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { notFound } from "../errors"
import {
  CommandPayload,
  CreatePayload,
  DiffQuery,
  ForkPayload,
  InitPayload,
  ListQuery,
  MessagesQuery,
  PermissionResponsePayload,
  PlanApprovalReplyPayload,
  DocumentReviewReplyPayload,
  TempFileCleanPayload,
  PromptPayload,
  RevertPayload,
  RevertPreviewPayload,
  ShellPayload,
  SummarizePayload,
  UpdatePayload,
} from "../groups/session"
import * as SessionError from "./session-errors"

const tryParseJson = (text: string) =>
  Effect.try({
    try: () => JSON.parse(text) as unknown,
    catch: () => new HttpApiError.BadRequest({}),
  })

export const sessionHandlers = HttpApiBuilder.group(InstanceHttpApi, "session", (handlers) =>
  Effect.gen(function* () {
    const session = yield* Session.Service
    const provider = yield* Provider.Service
    const shareSvc = yield* SessionShare.Service
    const portability = yield* SessionPortability.Service
    const promptSvc = yield* SessionPrompt.Service
    const revertSvc = yield* SessionRevert.Service
    const compactSvc = yield* SessionCompaction.Service
    const runState = yield* SessionRunState.Service
    const agentSvc = yield* Agent.Service
    const permissionSvc = yield* Permission.Service
    const statusSvc = yield* SessionStatus.Service
    const backgroundSvc = yield* BackgroundJob.Service
    const todoSvc = yield* Todo.Service
    const summary = yield* SessionSummary.Service
    const bus = yield* Bus.Service
    const scope = yield* Scope.Scope

    const list = Effect.fn("SessionHttpApi.list")(function* (ctx: { query: typeof ListQuery.Type }) {
      return yield* session.list({
        directory: ctx.query.scope === "project" ? undefined : ctx.query.directory,
        scope: ctx.query.scope,
        path: ctx.query.path,
        roots: ctx.query.roots,
        start: ctx.query.start,
        search: ctx.query.search,
        limit: ctx.query.limit,
      })
    })

    const status = Effect.fn("SessionHttpApi.status")(function* () {
      return Object.fromEntries(yield* statusSvc.list())
    })

    const requireSession = Effect.fn("SessionHttpApi.requireSession")(function* (sessionID: SessionID) {
      return yield* SessionError.mapStorageNotFound(session.get(sessionID))
    })

    const requireProjectSession = Effect.fn("SessionHttpApi.requireProjectSession")(function* (sessionID: SessionID) {
      const current = yield* requireSession(sessionID)
      if (current.scope === "global") return yield* new HttpApiError.BadRequest({})
      return current
    })

    const get = Effect.fn("SessionHttpApi.get")(function* (ctx: { params: { sessionID: SessionID } }) {
      return yield* requireSession(ctx.params.sessionID)
    })

    const children = Effect.fn("SessionHttpApi.children")(function* (ctx: { params: { sessionID: SessionID } }) {
      yield* requireSession(ctx.params.sessionID)
      return yield* session.children(ctx.params.sessionID)
    })

    const todo = Effect.fn("SessionHttpApi.todo")(function* (ctx: { params: { sessionID: SessionID } }) {
      yield* requireSession(ctx.params.sessionID)
      return yield* todoSvc.get(ctx.params.sessionID)
    })

    const diff = Effect.fn("SessionHttpApi.diff")(function* (ctx: {
      params: { sessionID: SessionID }
      query: typeof DiffQuery.Type
    }) {
      const current = yield* requireSession(ctx.params.sessionID)
      if (current.scope === "global") return yield* new HttpApiError.BadRequest({})
      return yield* summary.diff({ sessionID: ctx.params.sessionID, messageID: ctx.query.messageID })
    })

    const messages = Effect.fn("SessionHttpApi.messages")(function* (ctx: {
      params: { sessionID: SessionID }
      query: typeof MessagesQuery.Type
    }) {
      if (ctx.query.before && ctx.query.limit === undefined) return yield* new HttpApiError.BadRequest({})
      if (ctx.query.before) {
        const before = ctx.query.before
        yield* Effect.try({
          try: () => MessageV2.cursor.decode(before),
          catch: () => new HttpApiError.BadRequest({}),
        })
      }
      yield* requireSession(ctx.params.sessionID)
      if (ctx.query.limit === undefined || ctx.query.limit === 0) {
        return yield* SessionError.mapStorageNotFound(session.messages({ sessionID: ctx.params.sessionID }))
      }

      const page = yield* SessionError.mapStorageNotFound(
        MessageV2.page({
          sessionID: ctx.params.sessionID,
          limit: ctx.query.limit,
          before: ctx.query.before,
        }),
      )
      if (!page.cursor) return page.items

      const request = yield* HttpServerRequest.HttpServerRequest
      // toURL() honors the Host + x-forwarded-proto headers, so the Link
      // header echoes the real origin instead of a hard-coded localhost.
      const url = Option.getOrElse(HttpServerRequest.toURL(request), () => new URL(request.url, "http://localhost"))
      url.searchParams.set("limit", ctx.query.limit.toString())
      url.searchParams.set("before", page.cursor)
      return HttpServerResponse.jsonUnsafe(page.items, {
        headers: {
          "Access-Control-Expose-Headers": "Link, X-Next-Cursor",
          Link: `<${url.toString()}>; rel="next"`,
          "X-Next-Cursor": page.cursor,
        },
      })
    })

    const message = Effect.fn("SessionHttpApi.message")(function* (ctx: {
      params: { sessionID: SessionID; messageID: MessageID }
    }) {
      return yield* SessionError.mapStorageNotFound(
        MessageV2.get({ sessionID: ctx.params.sessionID, messageID: ctx.params.messageID }),
      )
    })

    const create = Effect.fn("SessionHttpApi.create")(function* (ctx: { payload?: typeof CreatePayload.Type }) {
      const { expertID, ...input } = ctx.payload ?? {}
      if (expertID === undefined) return yield* shareSvc.create(ctx.payload)

      const instance = yield* InstanceState.context
      if (
        instance.scope !== "project" ||
        input.parentID ||
        (input.teamMode !== undefined && input.teamMode !== "selected") ||
        input.teamIDs?.length
      ) {
        return yield* new HttpApiError.BadRequest({})
      }
      const profiles = yield* TeamProfileService
      const employees = yield* profiles.employees()
      if (!employees.some((employee) => employee.id === expertID && !employee.archived)) {
        return yield* new HttpApiError.BadRequest({})
      }
      return yield* shareSvc.create({ ...input, teamMode: "selected", teamIDs: [], employeeID: expertID })
    })

    const createGlobal = Effect.fn("SessionHttpApi.createGlobal")(function* (ctx: { payload?: Session.CreateParams }) {
      const current = yield* InstanceState.context
      if (current.scope !== "global") return yield* new HttpApiError.BadRequest({})
      if (ctx.payload?.workspaceID) return yield* new HttpApiError.BadRequest({})

      // "Work outside project" flow: create a real, app-owned
      // directory and start an ordinary project session rooted there. The
      // directory is private to this conversation; it is not a user project
      // and is never attached to a selected workspace.
      const directory = path.join(Global.Path.data, "global-chat", "sessions", randomUUID())
      const fs = yield* AppFileSystem.Service
      yield* fs
        .makeDirectory(directory, { recursive: true })
        .pipe(Effect.mapError(() => new HttpApiError.BadRequest({})))
      const projects = yield* Project.Service
      const project = yield* projects.globalChat().pipe(Effect.mapError(() => new HttpApiError.BadRequest({})))
      const instances = yield* InstanceStore.Service
      const instance = yield* instances
        .load({ directory, worktree: directory, project, scope: "project" })
        .pipe(Effect.mapError(() => new HttpApiError.BadRequest({})))
      return yield* shareSvc.create(ctx.payload).pipe(
        Effect.provideService(InstanceRef, instance),
        Effect.mapError(() => new HttpApiError.BadRequest({})),
      )
    })

    const createRaw = Effect.fn("SessionHttpApi.createRaw")(function* (ctx: {
      request: HttpServerRequest.HttpServerRequest
    }) {
      const body = yield* Effect.orDie(ctx.request.text)
      if (body.trim().length === 0) return yield* create({})

      const json = yield* tryParseJson(body)
      const payload = yield* Schema.decodeUnknownEffect(CreatePayload)(json).pipe(
        Effect.mapError(() => new HttpApiError.BadRequest({})),
      )
      return yield* create({ payload })
    })

    const createGlobalRaw = Effect.fn("SessionHttpApi.createGlobalRaw")(function* (ctx: {
      request: HttpServerRequest.HttpServerRequest
    }) {
      const body = yield* Effect.orDie(ctx.request.text)
      if (body.trim().length === 0) return yield* createGlobal({})

      const json = yield* tryParseJson(body)
      const payload = yield* Schema.decodeUnknownEffect(Session.CreateInput)(json).pipe(
        Effect.mapError(() => new HttpApiError.BadRequest({})),
      )
      return yield* createGlobal({ payload })
    })

    const remove = Effect.fn("SessionHttpApi.remove")(function* (ctx: { params: { sessionID: SessionID } }) {
      yield* requireSession(ctx.params.sessionID)
      yield* SessionError.mapStorageNotFound(session.remove(ctx.params.sessionID))
      return true
    })

    const update = Effect.fn("SessionHttpApi.update")(function* (ctx: {
      params: { sessionID: SessionID }
      payload: typeof UpdatePayload.Type
    }) {
      const current = yield* requireSession(ctx.params.sessionID)
      if (
        current.scope === "global" &&
        (ctx.payload.cwd !== undefined || ctx.payload.teamMode !== undefined || ctx.payload.teamIDs !== undefined)
      ) {
        return yield* new HttpApiError.BadRequest({})
      }
      if (ctx.payload.title !== undefined) {
        yield* session.setTitle({ sessionID: ctx.params.sessionID, title: ctx.payload.title })
      }
      if (ctx.payload.permission !== undefined) {
        yield* session.setPermission({
          sessionID: ctx.params.sessionID,
          permission: Permission.merge(current.permission ?? [], ctx.payload.permission),
        })
      }
      if (ctx.payload.permissionMode !== undefined) {
        const before = current.permissionMode
        if (ctx.payload.permissionMode === "plan") {
          // Preserve the explicit value. If the session inherited its mode,
          // leaving plan mode will restore that inherited state.
          if (before !== "plan") {
            yield* session.setPlanReturnMode({ sessionID: ctx.params.sessionID, mode: before })
          }
        } else {
          // A manual mode change is an explicit choice to leave the plan; it
          // must not leave a stale return target for the next plan cycle.
          yield* session.setPlanReturnMode({ sessionID: ctx.params.sessionID, mode: undefined })
        }
        yield* session.setPermissionMode({
          sessionID: ctx.params.sessionID,
          mode: ctx.payload.permissionMode,
        })
      }
      if (ctx.payload.model !== undefined) {
        // 换模型：内核下一步就用它（见 SessionPrompt.run 的逐步解析）。
        yield* session.setModel({
          sessionID: ctx.params.sessionID,
          model: ctx.payload.model,
        })
      }
      if (ctx.payload.cwd !== undefined) {
        // `requireSession` above already ruled out "not found", so every failure
        // here means "that path is not a usable directory".
        const moved = yield* session.setDirectory({ sessionID: ctx.params.sessionID, directory: ctx.payload.cwd }).pipe(
          Effect.as(true),
          Effect.catch(() => Effect.succeed(false)),
        )
        if (!moved) yield* Effect.fail(new HttpApiError.BadRequest({}))
      }
      if (ctx.payload.employeeID !== undefined) {
        yield* session.setEmployeeID({ sessionID: ctx.params.sessionID, employeeID: ctx.payload.employeeID })
      }
      if (ctx.payload.teamMode !== undefined) {
        // `selected` 没给 ID 等于「选了空集」，会让目录注入变成空列表 —— 直接拒绝，
        // 而不是让用户的点击悄无声息地失效。
        if (ctx.payload.teamMode === "selected" && !ctx.payload.teamIDs?.length && !ctx.payload.employeeID) {
          yield* Effect.fail(new HttpApiError.BadRequest({}))
        }
        yield* session.setTeamMode({
          sessionID: ctx.params.sessionID,
          mode: ctx.payload.teamMode,
          teamIDs: ctx.payload.teamIDs,
        })
      } else if (ctx.payload.teamIDs !== undefined && current.teamMode === "selected") {
        yield* session.setTeamMode({
          sessionID: ctx.params.sessionID,
          mode: "selected",
          teamIDs: ctx.payload.teamIDs,
        })
      }
      if (ctx.payload.time?.archived !== undefined) {
        yield* session.setArchived({ sessionID: ctx.params.sessionID, time: ctx.payload.time.archived })
      }
      return yield* requireSession(ctx.params.sessionID)
    })

    const fork = Effect.fn("SessionHttpApi.fork")(function* (ctx: {
      params: { sessionID: SessionID }
      payload?: typeof ForkPayload.Type
    }) {
      yield* requireProjectSession(ctx.params.sessionID)
      return yield* SessionError.mapStorageNotFound(
        session.fork({ sessionID: ctx.params.sessionID, messageID: ctx.payload?.messageID }),
      )
    })

    const forkRaw = Effect.fn("SessionHttpApi.forkRaw")(function* (ctx: {
      params: { sessionID: SessionID }
      request: HttpServerRequest.HttpServerRequest
    }) {
      const body = yield* Effect.orDie(ctx.request.text)
      if (body.trim().length === 0) return yield* fork({ params: ctx.params })

      const json = yield* tryParseJson(body)
      const payload = yield* Schema.decodeUnknownEffect(ForkPayload)(json).pipe(
        Effect.mapError(() => new HttpApiError.BadRequest({})),
      )
      return yield* fork({ params: ctx.params, payload })
    })

    const abort = Effect.fn("SessionHttpApi.abort")(function* (ctx: { params: { sessionID: SessionID } }) {
      yield* promptSvc.cancel(ctx.params.sessionID)
      return true
    })

    // 只暴露「这条会话发起的」后台任务：子代理 job 的 parentSessionId 是父会话，
    // 后台命令的 sessionId 就是当前会话。别的会话/项目的 job 一概不可见、不可停。
    const ownsBackgroundJob = (job: BackgroundJob.Info, sessionID: SessionID) =>
      job.metadata?.parentSessionId === sessionID || job.metadata?.sessionId === sessionID

    const tempFiles = Effect.fn("SessionHttpApi.tempFiles")(function* (ctx: { params: { sessionID: SessionID } }) {
      yield* requireProjectSession(ctx.params.sessionID)
      return (yield* Effect.promise(() => TempFiles.list(ctx.params.sessionID))).map((file) => ({
        path: file.path,
        relative: file.relative,
        tool: file.tool,
        createdAt: file.createdAt,
        size: file.size,
      }))
    })

    const planApproval = Effect.fn("SessionHttpApi.planApproval")(function* (ctx: {
      params: { sessionID: SessionID }
    }) {
      yield* requireProjectSession(ctx.params.sessionID)
      const service = yield* PlanApprovalService
      const list = yield* service.list()
      return list
        .filter((item) => item.sessionID === ctx.params.sessionID || item.parentID === ctx.params.sessionID)
        .map((item) => ({
          id: item.id as string,
          sessionID: item.sessionID as string,
          parentID: (item.parentID ?? undefined) as string | undefined,
          messageID: (item.messageID ?? undefined) as string | undefined,
          plan: item.plan,
          title: item.title,
          createdAt: item.createdAt,
        }))
        .filter((item) => item !== undefined)
    })

    const planApprovalReply = Effect.fn("SessionHttpApi.planApprovalReply")(function* (ctx: {
      params: { sessionID: SessionID; requestID: string }
      payload: typeof PlanApprovalReplyPayload.Type
    }) {
      yield* requireProjectSession(ctx.params.sessionID)
      const service = yield* PlanApprovalService
      const ok = yield* service.reply({
        id: ctx.params.requestID as never,
        approved: ctx.payload.approved,
        ...(ctx.payload.execution ? { execution: ctx.payload.execution } : {}),
        ...(ctx.payload.feedback ? { feedback: ctx.payload.feedback } : {}),
      })
      return ok
    })

    const documentReview = Effect.fn("SessionHttpApi.documentReview")(function* (ctx: {
      params: { sessionID: SessionID }
    }) {
      yield* requireProjectSession(ctx.params.sessionID)
      const service = yield* DocumentReviewService
      const list = yield* service.list(ctx.params.sessionID)
      return list.map((item) => ({
        id: item.id as string,
        sessionID: item.sessionID as string,
        messageID: (item.messageID ?? undefined) as string | undefined,
        path: item.path,
        kind: item.kind,
        title: item.title,
        version: item.version,
        summary: item.summary,
        highlights: [...item.highlights],
        questions: [...item.questions],
        lines: item.lines,
        createdAt: item.createdAt,
      }))
    })

    const documentReviewReply = Effect.fn("SessionHttpApi.documentReviewReply")(function* (ctx: {
      params: { sessionID: SessionID; requestID: string }
      payload: typeof DocumentReviewReplyPayload.Type
    }) {
      yield* requireProjectSession(ctx.params.sessionID)
      const service = yield* DocumentReviewService
      const feedback = ctx.payload.feedback?.trim()
      return yield* service.reply({
        id: ctx.params.requestID as never,
        decision: ctx.payload.decision,
        ...(feedback ? { feedback } : {}),
      })
    })

    const tempFilesClean = Effect.fn("SessionHttpApi.tempFilesClean")(function* (ctx: {
      params: { sessionID: SessionID }
      payload: typeof TempFileCleanPayload.Type
    }) {
      yield* requireProjectSession(ctx.params.sessionID)
      const instance = yield* InstanceState.context
      const worktree = instance.worktree === "/" ? instance.directory : instance.worktree
      return yield* Effect.promise(() =>
        TempFiles.clean({
          sessionID: ctx.params.sessionID,
          worktree,
          paths: ctx.payload.paths ? Array.from(ctx.payload.paths) : undefined,
        }),
      )
    })

    const background = Effect.fn("SessionHttpApi.background")(function* (ctx: { params: { sessionID: SessionID } }) {
      yield* requireProjectSession(ctx.params.sessionID)
      // The panel is per session: show history from earlier runs too, since a
      // restart otherwise makes finished subagents vanish from the list.
      const jobs = yield* backgroundSvc.list({ includePersisted: true })
      return jobs.filter((job) => ownsBackgroundJob(job, ctx.params.sessionID))
    })

    const backgroundCancel = Effect.fn("SessionHttpApi.backgroundCancel")(function* (ctx: {
      params: { sessionID: SessionID; jobID: string }
    }) {
      yield* requireProjectSession(ctx.params.sessionID)
      const job = yield* backgroundSvc.get(ctx.params.jobID)
      if (!job || !ownsBackgroundJob(job, ctx.params.sessionID)) {
        return yield* notFound("Background job not found")
      }
      return (yield* backgroundSvc.cancel(job.id)) ?? null
    })

    const init = Effect.fn("SessionHttpApi.init")(function* (ctx: {
      params: { sessionID: SessionID }
      payload: typeof InitPayload.Type
    }) {
      yield* requireProjectSession(ctx.params.sessionID)
      yield* promptSvc
        .command({
          sessionID: ctx.params.sessionID,
          messageID: ctx.payload.messageID,
          model: `${ctx.payload.providerID}/${ctx.payload.modelID}`,
          command: Command.Default.INIT,
          arguments: "",
        })
        .pipe(Effect.mapError(() => new HttpApiError.BadRequest({})))
      return true
    })

    // share/unshare errors aren't all client-induced — storage and network
    // failures from SessionShare are real possibilities. Map to a typed 500
    // (matches the legacy route behavior which routed any failure through
    // ErrorMiddleware → NamedError.Unknown 500) instead of blanket-mapping
    // every failure to a 400 BadRequest.
    const exportSession = Effect.fn("SessionHttpApi.exportSession")(function* (ctx: {
      params: { sessionID: SessionID }
      query: { redact?: boolean }
    }) {
      yield* requireProjectSession(ctx.params.sessionID)
      return yield* portability
        .export({ sessionID: ctx.params.sessionID, redact: ctx.query.redact })
        .pipe(Effect.catchTag("NotFoundError", () => Effect.fail(notFound("Session not found"))))
    })

    const importSession = Effect.fn("SessionHttpApi.importSession")(function* (ctx: {
      payload: { data: SessionPortability.Bundle }
    }) {
      const instance = yield* InstanceState.context
      if (instance.scope === "global") return yield* new HttpApiError.BadRequest({})
      return yield* portability.import(ctx.payload.data)
    })

    const share = Effect.fn("SessionHttpApi.share")(function* (ctx: { params: { sessionID: SessionID } }) {
      const current = yield* requireSession(ctx.params.sessionID)
      if (current.scope === "global") return yield* new HttpApiError.BadRequest({})
      yield* shareSvc.share(ctx.params.sessionID).pipe(Effect.mapError(() => new HttpApiError.InternalServerError({})))
      return yield* requireSession(ctx.params.sessionID)
    })

    const unshare = Effect.fn("SessionHttpApi.unshare")(function* (ctx: { params: { sessionID: SessionID } }) {
      const current = yield* requireSession(ctx.params.sessionID)
      if (current.scope === "global") return yield* new HttpApiError.BadRequest({})
      yield* shareSvc
        .unshare(ctx.params.sessionID)
        .pipe(Effect.mapError(() => new HttpApiError.InternalServerError({})))
      return yield* requireSession(ctx.params.sessionID)
    })

    const suggestions = Effect.fn("SessionHttpApi.suggestions")(function* (ctx: { params: { sessionID: SessionID } }) {
      const historyMessages = yield* SessionError.mapStorageNotFound(
        session.messages({ sessionID: ctx.params.sessionID }),
      )
      const assistantIndex = historyMessages.findLastIndex((message) => message.info.role === "assistant")
      if (assistantIndex < 0) return []
      const assistant = historyMessages[assistantIndex]!
      if (assistant.info.role !== "assistant" || assistant.info.time.completed === undefined || assistant.info.error)
        return []
      const user = historyMessages.slice(0, assistantIndex).findLast((message) => message.info.role === "user")
      if (!user || user.info.role !== "user" || user.info.id !== assistant.info.parentID) return []
      const model = yield* provider
        .getModel(assistant.info.providerID, assistant.info.modelID)
        .pipe(Effect.catch(() => Effect.fail(new HttpApiError.BadRequest({}))))
      const language = yield* provider
        .getLanguage(model)
        .pipe(Effect.catch(() => Effect.fail(new HttpApiError.BadRequest({}))))
      const text = (parts: readonly MessageV2.Part[]) =>
        parts
          .filter((part): part is MessageV2.TextPart => part.type === "text")
          .map((part) => part.text)
          .join("\n")
          .trim()
      const question = text(user.parts)
      const answer = text(assistant.parts)
      if (!question || !answer) return []
      const Output = Schema.Struct({ suggestions: Schema.Array(Schema.String) })
      const messages: ModelMessage[] = [
        {
          role: "system",
          content:
            "根据最近一轮用户问题和 AI 完整答复，提出 2 到 4 个自然、具体、彼此不同的下一步问题。问题必须贴合当前内容，不要重复已回答的问题，不要虚构事实；若没有自然的后续问题则返回空数组。只生成用户能直接点击发送的问题，使用与上下文一致的语言。若以普通文本返回，请只输出 JSON 字符串数组，不要输出 Markdown 或其他文字。",
        },
        {
          role: "user",
          content: `<question>\n${question.slice(-5000)}\n</question>\n<answer>\n${answer.slice(-8000)}\n</answer>`,
        },
      ]
      const parseTextSuggestions = (raw: string) => {
        const match = raw.match(/\[[\s\S]*\]/)
        if (!match) return []
        try {
          const parsed: unknown = JSON.parse(match[0])
          return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : []
        } catch {
          return []
        }
      }
      const result = yield* Effect.tryPromise(async () => {
        try {
          const value = await generateObject({
            model: language,
            temperature: 0.35,
            maxOutputTokens: 300,
            schema: Object.assign(Schema.toStandardSchemaV1(Output), Schema.toStandardJSONSchemaV1(Output)),
            messages,
          })
          return value.object.suggestions
        } catch {
          // Some lightweight/custom models do not implement structured output.
          // Retry as plain JSON so the feature still works with those models.
          const value = await generateText({
            model: language,
            temperature: 0.35,
            maxOutputTokens: 300,
            messages,
          })
          return parseTextSuggestions(value.text)
        }
      }).pipe(Effect.catch(() => Effect.succeed([] as string[])))
      return result
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, 4)
    })

    const summarize = Effect.fn("SessionHttpApi.summarize")(function* (ctx: {
      params: { sessionID: SessionID }
      payload: typeof SummarizePayload.Type
    }) {
      yield* revertSvc.cleanup(yield* requireProjectSession(ctx.params.sessionID))
      const messages = yield* SessionError.mapStorageNotFound(session.messages({ sessionID: ctx.params.sessionID }))
      const defaultAgent = yield* agentSvc.defaultAgent()
      const currentAgent = messages.findLast((message) => message.info.role === "user")?.info.agent ?? defaultAgent

      yield* compactSvc.create({
        sessionID: ctx.params.sessionID,
        agent: currentAgent,
        model: {
          providerID: ctx.payload.providerID,
          modelID: ctx.payload.modelID,
        },
        auto: ctx.payload.auto ?? false,
        instructions: ctx.payload.instructions,
      })
      yield* promptSvc.loop({ sessionID: ctx.params.sessionID })
      return true
    })

    const prompt = Effect.fn("SessionHttpApi.prompt")(function* (ctx: {
      params: { sessionID: SessionID }
      payload: typeof PromptPayload.Type
    }) {
      const current = yield* requireSession(ctx.params.sessionID)
      if (
        current.scope === "global" &&
        (ctx.payload.goalExecution !== undefined ||
          ctx.payload.parts.some((part) => part.type !== "text") ||
          ctx.payload.system !== undefined ||
          ctx.payload.tools !== undefined ||
          ctx.payload.format !== undefined ||
          ctx.payload.autoMode !== undefined)
      ) {
        return yield* new HttpApiError.BadRequest({})
      }
      const message = yield* promptSvc
        .prompt({
          ...ctx.payload,
          sessionID: ctx.params.sessionID,
        })
        .pipe(Effect.mapError(() => new HttpApiError.BadRequest({})))
      return HttpServerResponse.stream(Stream.make(JSON.stringify(message)).pipe(Stream.encodeText), {
        contentType: "application/json",
      })
    })

    const promptAsync = Effect.fn("SessionHttpApi.promptAsync")(function* (ctx: {
      params: { sessionID: SessionID }
      payload: typeof PromptPayload.Type
    }) {
      const current = yield* requireSession(ctx.params.sessionID)
      if (
        current.scope === "global" &&
        (ctx.payload.goalExecution !== undefined ||
          ctx.payload.parts.some((part) => part.type !== "text") ||
          ctx.payload.system !== undefined ||
          ctx.payload.tools !== undefined ||
          ctx.payload.format !== undefined ||
          ctx.payload.autoMode !== undefined)
      ) {
        return yield* new HttpApiError.BadRequest({})
      }
      yield* promptSvc.prompt({ ...ctx.payload, sessionID: ctx.params.sessionID }).pipe(
        Effect.catchCause((cause) =>
          Effect.gen(function* () {
            yield* Effect.logError("prompt_async failed").pipe(
              Effect.annotateLogs({ sessionID: ctx.params.sessionID, cause }),
            )
            yield* bus.publish(Session.Event.Error, {
              sessionID: ctx.params.sessionID,
              error: new NamedError.Unknown({ message: Cause.pretty(cause) }).toObject(),
            })
          }),
        ),
        Effect.forkIn(scope, { startImmediately: true }),
      )
      return HttpApiSchema.NoContent.make()
    })

    /**
     * 继续任务：把意外中断的那一轮接着做完。
     *
     * 与 promptAsync 一样异步执行（流式事件已经通过 SSE 推送，不需要在这里等结果），
     * 失败时把错误发到会话事件里，界面才会重新出现"继续"入口。
     */
    const resume = Effect.fn("SessionHttpApi.resume")(function* (ctx: { params: { sessionID: SessionID } }) {
      const current = yield* requireSession(ctx.params.sessionID)
      if (current.scope === "global") return yield* new HttpApiError.BadRequest({})
      yield* promptSvc.resume(ctx.params.sessionID).pipe(
        Effect.catchCause((cause) =>
          Effect.gen(function* () {
            yield* Effect.logError("session_resume failed").pipe(
              Effect.annotateLogs({ sessionID: ctx.params.sessionID, cause }),
            )
            yield* bus.publish(Session.Event.Error, {
              sessionID: ctx.params.sessionID,
              error: new NamedError.Unknown({ message: Cause.pretty(cause) }).toObject(),
            })
          }),
        ),
        Effect.forkIn(scope, { startImmediately: true }),
      )
      return HttpApiSchema.NoContent.make()
    })

    const command = Effect.fn("SessionHttpApi.command")(function* (ctx: {
      params: { sessionID: SessionID }
      payload: typeof CommandPayload.Type
    }) {
      yield* requireProjectSession(ctx.params.sessionID)
      return yield* promptSvc
        .command({ ...ctx.payload, sessionID: ctx.params.sessionID })
        .pipe(
          Effect.catchCause((cause) =>
            Effect.logError("session.command failure").pipe(
              Effect.annotateLogs({ cause }),
              Effect.andThen(Effect.fail(new HttpApiError.BadRequest({}))),
            ),
          ),
        )
    })

    const shell = Effect.fn("SessionHttpApi.shell")(function* (ctx: {
      params: { sessionID: SessionID }
      payload: typeof ShellPayload.Type
    }) {
      yield* requireProjectSession(ctx.params.sessionID)
      return yield* SessionError.mapBusy(promptSvc.shell({ ...ctx.payload, sessionID: ctx.params.sessionID }))
    })

    const revert = Effect.fn("SessionHttpApi.revert")(function* (ctx: {
      params: { sessionID: SessionID }
      payload: typeof RevertPayload.Type
    }) {
      yield* requireProjectSession(ctx.params.sessionID)
      return yield* SessionError.mapBusy(revertSvc.revert({ sessionID: ctx.params.sessionID, ...ctx.payload }))
    })

    const revertPreview = Effect.fn("SessionHttpApi.revertPreview")(function* (ctx: {
      params: { sessionID: SessionID }
      payload: typeof RevertPreviewPayload.Type
    }) {
      yield* requireProjectSession(ctx.params.sessionID)
      return yield* revertSvc.preview({ sessionID: ctx.params.sessionID, messageID: ctx.payload.messageID })
    })

    const unrevert = Effect.fn("SessionHttpApi.unrevert")(function* (ctx: { params: { sessionID: SessionID } }) {
      yield* requireProjectSession(ctx.params.sessionID)
      return yield* SessionError.mapBusy(revertSvc.unrevert({ sessionID: ctx.params.sessionID }))
    })

    const permissionRespond = Effect.fn("SessionHttpApi.permissionRespond")(function* (ctx: {
      params: { sessionID: SessionID; permissionID: PermissionID }
      payload: typeof PermissionResponsePayload.Type
    }) {
      yield* requireProjectSession(ctx.params.sessionID)
      yield* permissionSvc.reply({ requestID: ctx.params.permissionID, reply: ctx.payload.response })
      return true
    })

    const deleteMessage = Effect.fn("SessionHttpApi.deleteMessage")(function* (ctx: {
      params: { sessionID: SessionID; messageID: MessageID }
    }) {
      yield* requireProjectSession(ctx.params.sessionID)
      yield* SessionError.mapBusy(runState.assertNotBusy(ctx.params.sessionID))
      yield* session.removeMessage(ctx.params)
      return true
    })

    const deletePart = Effect.fn("SessionHttpApi.deletePart")(function* (ctx: {
      params: { sessionID: SessionID; messageID: MessageID; partID: PartID }
    }) {
      yield* requireProjectSession(ctx.params.sessionID)
      yield* session.removePart(ctx.params)
      return true
    })

    const updatePart = Effect.fn("SessionHttpApi.updatePart")(function* (ctx: {
      params: { sessionID: SessionID; messageID: MessageID; partID: PartID }
      payload: typeof MessageV2.Part.Type
    }) {
      yield* requireProjectSession(ctx.params.sessionID)
      const payload = ctx.payload as MessageV2.Part
      if (
        payload.id !== ctx.params.partID ||
        payload.messageID !== ctx.params.messageID ||
        payload.sessionID !== ctx.params.sessionID
      ) {
        return yield* new HttpApiError.BadRequest({})
      }
      return yield* session.updatePart(payload)
    })

    return handlers
      .handleRaw("globalCreate", createGlobalRaw)
      .handle("list", list)
      .handle("status", status)
      .handle("get", get)
      .handle("children", children)
      .handle("todo", todo)
      .handle("diff", diff)
      .handle("messages", messages)
      .handle("message", message)
      .handleRaw("create", createRaw)
      .handle("remove", remove)
      .handle("update", update)
      .handleRaw("fork", forkRaw)
      .handle("abort", abort)
      .handle("tempFiles", tempFiles)
      .handle("planApproval", planApproval)
      .handle("planApprovalReply", planApprovalReply)
      .handle("documentReview", documentReview)
      .handle("documentReviewReply", documentReviewReply)
      .handle("tempFilesClean", tempFilesClean)
      .handle("background", background)
      .handle("backgroundCancel", backgroundCancel)
      .handle("init", init)
      .handle("exportSession", exportSession)
      .handle("importSession", importSession)
      .handle("share", share)
      .handle("unshare", unshare)
      .handle("summarize", summarize)
      .handle("suggestions", suggestions)
      .handle("prompt", prompt)
      .handle("promptAsync", promptAsync)
      .handle("resume", resume)
      .handle("command", command)
      .handle("shell", shell)
      .handle("revert", revert)
      .handle("revertPreview", revertPreview)
      .handle("unrevert", unrevert)
      .handle("permissionRespond", permissionRespond)
      .handle("deleteMessage", deleteMessage)
      .handle("deletePart", deletePart)
      .handle("updatePart", updatePart)
  }),
)
