import { SessionID } from "@/session/schema"
import { Permission } from "@/permission"
import { Question } from "@/question"
import { SessionV2 } from "@/v2/session"
import { DateTime, Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../../api"
import { notFound } from "../../errors"
import { resolveLocation } from "./location"

export const sessionResourceHandlers = HttpApiBuilder.group(InstanceHttpApi, "v2.session-resource", (handlers) =>
  Effect.gen(function* () {
    const session = yield* SessionV2.Service
    const permission = yield* Permission.Service
    const question = yield* Question.Service

    const get = Effect.fn("V2SessionResourceHttpApi.get")(function* (ctx: { params: { sessionID: SessionID } }) {
      const location = yield* resolveLocation()
      const info = yield* session
        .get(ctx.params.sessionID)
        .pipe(Effect.catchTag("Session.NotFoundError", () => Effect.fail(notFound("Session not found"))))
      return {
        data: {
          id: info.id,
          ...(info.parentID ? { parentID: info.parentID } : {}),
          projectID: info.projectID,
          ...(info.agent ? { agent: info.agent } : {}),
          ...(info.model
            ? {
                model: {
                  id: info.model.id,
                  providerID: info.model.providerID,
                  ...(info.model.variant ? { variant: info.model.variant } : {}),
                },
              }
            : {}),
          cost: info.cost,
          tokens: info.tokens,
          time: {
            created: DateTime.toEpochMillis(info.time.created),
            updated: DateTime.toEpochMillis(info.time.updated),
            ...(info.time.archived ? { archived: DateTime.toEpochMillis(info.time.archived) } : {}),
          },
          title: info.title,
          location: {
            directory: location.directory,
            ...((info.workspaceID ?? location.workspaceID)
              ? { workspaceID: info.workspaceID ?? location.workspaceID }
              : {}),
          },
          ...(info.path ? { subpath: info.path } : {}),
        },
      }
    })

    const permissions = Effect.fn("V2SessionResourceHttpApi.permissions")(function* (ctx: {
      params: { sessionID: string }
    }) {
      const items = yield* permission.list()
      return {
        data: items
          .filter((item) => item.sessionID === ctx.params.sessionID)
          .map((item) => ({
            // Newtype ids are branded strings at runtime; `String()` is only
            // here to satisfy the wire schema's plain `string`.
            // oxlint-disable-next-line no-base-to-string
            id: String(item.id),
            // oxlint-disable-next-line no-base-to-string
            sessionID: String(item.sessionID),
            action: item.permission,
            resources: item.patterns,
            ...(item.always.length ? { save: item.always } : {}),
            ...(Object.keys(item.metadata).length ? { metadata: item.metadata } : {}),
            ...(item.tool
              ? { source: { type: "tool" as const, messageID: item.tool.messageID, callID: item.tool.callID } }
              : {}),
          })),
      }
    })

    const questions = Effect.fn("V2SessionResourceHttpApi.questions")(function* (ctx: {
      params: { sessionID: string }
    }) {
      const items = yield* question.list()
      return {
        data: items
          .filter((item) => item.sessionID === ctx.params.sessionID)
          .map((item) => ({
            // oxlint-disable-next-line no-base-to-string
            id: String(item.id),
            // oxlint-disable-next-line no-base-to-string
            sessionID: String(item.sessionID),
            questions: item.questions.map((entry) => ({
              question: entry.question,
              header: entry.header,
              options: entry.options.map((option) => ({
                label: option.label,
                description: option.description,
              })),
              ...(entry.multiple === undefined ? {} : { multiple: entry.multiple }),
              ...(entry.custom === undefined ? {} : { custom: entry.custom }),
            })),
            ...(item.tool ? { tool: { messageID: item.tool.messageID, callID: item.tool.callID } } : {}),
          })),
      }
    })

    return handlers.handle("get", get).handle("permissions", permissions).handle("questions", questions)
  }),
)
