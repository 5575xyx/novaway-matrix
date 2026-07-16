import { Effect, Option, Schema } from "effect"
import { Memory } from "@/memory/service"
import { MemorySchema } from "@/memory/schema"
import { Session } from "@/session/session"
import * as Tool from "./tool"

const Parameters = Schema.Struct({
  action: Schema.Literals(["add", "read", "search", "replace", "remove"]),
  target: Schema.optional(MemorySchema.Target).annotate({
    description: "memory 保存项目长期事实；user 保存用户画像、偏好和工作方式。",
  }),
  content: Schema.optional(Schema.String).annotate({
    description: "add 或 replace 时写入的记忆内容。",
  }),
  id: Schema.optional(MemorySchema.MemoryID).annotate({
    description: "replace 或 remove 时要修改的记忆 ID。",
  }),
  query: Schema.optional(Schema.String).annotate({
    description: "search 时使用的关键词。",
  }),
  scope: Schema.optional(MemorySchema.Scope).annotate({
    description: "global 跨项目可用，project 仅当前项目可用，session 仅当前会话可用。",
  }),
})

export const MemoryTool = Tool.define(
  "memory",
  Effect.gen(function* () {
    const sessions = yield* Session.Service

    return {
      description: [
        "Persist and recall durable memory across sessions.",
        "Save only stable facts, user preferences, project conventions, and decisions that will help future work.",
        "Do not save transient task state, secrets, credentials, temporary errors, or facts likely to become stale soon.",
      ].join(" "),
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const memory = Option.getOrUndefined(yield* Effect.serviceOption(Memory.Service))
          if (!memory) throw new Error("Memory service is not available")
          const session = yield* sessions.get(ctx.sessionID).pipe(Effect.orDie)
          if (params.action === "add") {
            if (!params.content?.trim()) throw new Error("content is required for memory add")
            const item = yield* memory.add({
              projectID: session.projectID,
              sessionID: ctx.sessionID,
              target: params.target ?? "memory",
              scope: params.scope ?? "project",
              content: params.content,
              source: "tool",
              originMessageID: ctx.messageID,
              createdBy: ctx.agent,
            })
            return {
              title: `Saved memory ${item.id}`,
              output: JSON.stringify(item, null, 2),
              metadata: { id: item.id as MemorySchema.MemoryID | undefined, action: "add", count: 1 },
            }
          }

          if (params.action === "replace") {
            if (!params.id) throw new Error("id is required for memory replace")
            if (!params.content?.trim()) throw new Error("content is required for memory replace")
            const item = yield* memory.update({ id: params.id, content: params.content })
            return {
              title: item ? `Updated memory ${item.id}` : "Memory not found",
              output: JSON.stringify(item ?? { error: "not found" }, null, 2),
              metadata: { id: params.id as MemorySchema.MemoryID | undefined, action: "replace", count: item ? 1 : 0 },
            }
          }

          if (params.action === "remove") {
            if (!params.id) throw new Error("id is required for memory remove")
            const removed = yield* memory.remove(params.id)
            return {
              title: removed ? `Removed memory ${params.id}` : "Memory not found",
              output: JSON.stringify({ removed }, null, 2),
              metadata: {
                id: params.id as MemorySchema.MemoryID | undefined,
                action: "remove",
                count: removed ? 1 : 0,
              },
            }
          }

          const items = yield* memory.list({
            projectID: session.projectID,
            target: params.target,
            scope: params.scope,
            search: params.action === "search" ? params.query : undefined,
            limit: 20,
          })
          return {
            title: params.action === "search" ? "Memory search results" : "Memory entries",
            output: JSON.stringify(items, null, 2),
            metadata: {
              id: undefined as MemorySchema.MemoryID | undefined,
              action: params.action,
              count: items.length,
            },
          }
        }).pipe(Effect.orDie),
    }
  }),
)
