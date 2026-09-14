import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION_WRITE from "./todowrite.txt"
import DESCRIPTION_EDIT from "./todoedit.txt"
import { Todo } from "../session/todo"

// Todo.Info is still a zod schema (session/todo.ts). Inline the field shape
// here rather than referencing its `.shape` — the LLM-visible JSON Schema is
// identical, and it removes the last zod dependency from this tool.
const TodoItem = Schema.Struct({
  content: Schema.String.annotate({ description: "Brief description of the task" }),
  status: Schema.String.annotate({
    description: "Current status of the task: pending, in_progress, completed, cancelled",
  }),
  priority: Schema.String.annotate({ description: "Priority level of the task: high, medium, low" }),
  goalId: Schema.optional(Schema.String.annotate({ description: "ID of the goal this todo is associated with" })),
})

export const Parameters = Schema.Struct({
  todos: Schema.mutable(Schema.Array(TodoItem)).annotate({ description: "The updated todo list" }),
})

type Metadata = {
  todos: Todo.Info[]
}

export const TodoWriteTool = Tool.define<typeof Parameters, Metadata, Todo.Service>(
  "todowrite",
  Effect.gen(function* () {
    const todo = yield* Todo.Service

    return {
      description: DESCRIPTION_WRITE,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context<Metadata>) =>
        Effect.gen(function* () {
          yield* ctx.ask({
            permission: "todowrite",
            patterns: ["*"],
            always: ["*"],
            metadata: {},
          })

          yield* todo.update({
            sessionID: ctx.sessionID,
            todos: params.todos,
          })

          return {
            title: `${params.todos.filter((x) => x.status !== "completed").length} todos`,
            output: JSON.stringify(params.todos, null, 2),
            metadata: {
              todos: params.todos,
            },
          }
        }),
    } satisfies Tool.DefWithoutID<typeof Parameters, Metadata>
  }),
)

// 动作到状态值的映射。add/edit/remove 不改状态,显式给 undefined 让索引类型闭合。
const STATUS_BY_ACTION: Record<"add" | "edit" | "complete" | "reopen" | "progress" | "cancel" | "remove", string | undefined> = {
  add: undefined,
  edit: undefined,
  complete: "completed",
  reopen: "pending",
  progress: "in_progress",
  cancel: "cancelled",
  remove: undefined,
}

const MARK: Record<string, string> = {
  pending: "[ ]",
  in_progress: "[>]",
  completed: "[x]",
  cancelled: "[-]",
}

export const TodoEditParameters = Schema.Struct({
  action: Schema.Union([
    Schema.Literal("add"),
    Schema.Literal("edit"),
    Schema.Literal("complete"),
    Schema.Literal("reopen"),
    Schema.Literal("progress"),
    Schema.Literal("cancel"),
    Schema.Literal("remove"),
  ]).annotate({ description: "The single change to apply: add, edit, complete, reopen, progress, cancel or remove" }),
  position: Schema.optional(Schema.Number).annotate({
    description: "0-based index of the item to change, exactly as numbered in the current list. Required for every action except add.",
  }),
  content: Schema.optional(Schema.String).annotate({ description: "New task text. Required for add and edit." }),
  priority: Schema.optional(Schema.Union([Schema.Literal("high"), Schema.Literal("medium"), Schema.Literal("low")])).annotate({
    description: "Priority for a newly added item. Defaults to medium.",
  }),
  goalId: Schema.optional(Schema.String).annotate({ description: "Goal ID to attach a newly added item to." }),
})

export const TodoEditTool = Tool.define<typeof TodoEditParameters, Metadata, Todo.Service>(
  "todoedit",
  Effect.gen(function* () {
    const todo = yield* Todo.Service

    return {
      description: DESCRIPTION_EDIT,
      parameters: TodoEditParameters,
      execute: (params: Schema.Schema.Type<typeof TodoEditParameters>, ctx: Tool.Context<Metadata>) =>
        Effect.gen(function* () {
          yield* ctx.ask({
            permission: "todoedit",
            patterns: ["*"],
            always: ["*"],
            metadata: {},
          })

          const current = yield* todo.get(ctx.sessionID)
          // 越界与缺参在这里拦下,而不是让 updateSingle 抛异常:抛异常会被工具包装层 orDie 变成缺陷,
          // 直接打死会话;返回可读文本则让模型自己改参数重试。
          const rejected = (message: string) => ({
            title: "todoedit",
            output: message,
            metadata: { todos: current } satisfies Metadata,
          })
          const inRange =
            params.position === undefined ||
            (Number.isInteger(params.position) && params.position >= 0 && params.position < current.length)
          const validRange = current.length === 0 ? "no valid position (the list is empty)" : `0..${current.length - 1}`

          if (params.position !== undefined && !inRange)
            return rejected(
              `position ${params.position} is out of range: the current list has ${current.length} item(s), valid range is ${validRange}.`,
            )
          if (params.action !== "add" && params.position === undefined)
            return rejected(
              `action "${params.action}" needs a 0-based position: the current list has ${current.length} item(s), valid range is ${validRange}.`,
            )
          if ((params.action === "add" || params.action === "edit") && !params.content?.trim())
            return rejected(`action "${params.action}" needs non-empty content.`)

          if (params.action === "add") {
            yield* todo.add({
              sessionID: ctx.sessionID,
              content: params.content!.trim(),
              priority: params.priority,
              goalId: params.goalId,
            })
          } else if (params.action === "remove") {
            // remove 不能走 updateSingle:那里只有一个字段可改,空 set 会让 drizzle 抛 "No values to set"。
            yield* todo.remove({ sessionID: ctx.sessionID, position: params.position! })
          } else {
            const status = STATUS_BY_ACTION[params.action]
            yield* todo.updateSingle({
              sessionID: ctx.sessionID,
              position: params.position!,
              ...(status === undefined ? {} : { status }),
              ...(params.action === "edit" ? { content: params.content!.trim() } : {}),
            })
          }

          const next = yield* todo.get(ctx.sessionID)
          const done = next.filter((item) => item.status === "completed").length
          return {
            title: `todoedit: ${params.action}`,
            output: [
              next.map((item, index) => `${index}. ${MARK[item.status] ?? "[ ]"} ${item.content}`).join("\n") || "(no todos)",
              `${done}/${next.length} completed`,
            ].join("\n"),
            metadata: {
              todos: next,
            },
          }
        }),
    } satisfies Tool.DefWithoutID<typeof TodoEditParameters, Metadata>
  }),
)
