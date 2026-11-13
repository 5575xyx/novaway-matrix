import { describe, expect, test } from "bun:test"
import { InstanceRef } from "@/effect/instance-ref"
import type { ToolContribution } from "@novaway/plugin-api"
import { Context, Effect, Schema } from "effect"
import type * as Tool from "@/tool/tool"
import { adaptTool } from "@/plugin/runtime/tool"

const parameters = {
  type: "object",
  properties: { value: { type: "string" } },
  required: ["value"],
  additionalProperties: false,
} as const

function context(): Tool.Context {
  return {
    sessionID: "ses_1" as Tool.Context["sessionID"],
    messageID: "msg_1" as Tool.Context["messageID"],
    agent: "build",
    directory: "/project",
    abort: new AbortController().signal,
    messages: [],
    metadata: () => Effect.void,
    ask: () => Effect.void,
  }
}

describe("plugin tool adapter", () => {
  test("metadata and permission callbacks retain the caller's Effect context", async () => {
    const RequestID = Context.Reference<string>("plugin-test/RequestID", { defaultValue: () => "missing" })
    const seen: string[] = []
    const ctx = context()
    ctx.metadata = () =>
      Effect.gen(function* () {
        seen.push(`metadata:${yield* RequestID}`)
      })
    ctx.ask = () =>
      Effect.gen(function* () {
        seen.push(`ask:${yield* RequestID}`)
      })
    const tool = adaptTool({
      name: "demo_context",
      contribution: {
        id: "context",
        description: "Context propagation",
        parameters,
        execute: async (_, api) => {
          await api.metadata({ title: "working" })
          await api.ask({ permission: "plugin", patterns: ["*"], always: ["*"], metadata: {} })
          return "ok"
        },
      },
    })
    await Effect.runPromise(tool.execute({ value: "ok" }, ctx).pipe(Effect.provideService(RequestID, "request-1")))
    expect(seen).toEqual(["metadata:request-1", "ask:request-1"])
  })

  test("maps schema, conservative safety defaults, execution context, and result", async () => {
    const seen: { args?: unknown; ctx?: Parameters<ToolContribution["execute"]>[1] } = {}
    const contribution: ToolContribution = {
      id: "example",
      description: "Example tool",
      parameters,
      execute: async (args, ctx) => {
        seen.args = args
        seen.ctx = ctx
        return {
          title: "Done",
          output: "result",
          attachments: [{ type: "file", mime: "text/plain", url: "file:///result.txt", filename: "result.txt" }],
        }
      },
    }
    const tool = adaptTool({ name: "demo_example", contribution })
    const args = { value: "ok" }
    const result = await Effect.runPromise(
      tool
        .execute(args, context())
        .pipe(
          Effect.provideService(InstanceRef, { directory: "/project", worktree: "/worktree", project: {} as never }),
        ),
    )

    expect(Schema.decodeUnknownSync(tool.parameters)(args)).toEqual(args)
    expect(tool.capabilities).toMatchObject({
      readOnly: false,
      concurrencySafe: false,
      destructive: true,
      idempotent: false,
      maxResultBytes: 20_000,
      deferLoading: false,
    })
    expect(seen.args).toBe(args)
    expect(seen.ctx).toMatchObject({
      sessionID: "ses_1",
      messageID: "msg_1",
      agent: "build",
      directory: "/project",
    })
    expect(result).toEqual({
      title: "Done",
      output: "result",
      metadata: {},
      attachments: [
        {
          type: "file",
          mime: "text/plain",
          url: "file:///result.txt",
          filename: "result.txt",
        },
      ],
    })
  })

  test("maps explicit safety settings and string results", async () => {
    const tool = adaptTool({
      name: "demo_example",
      contribution: {
        id: "example",
        description: "Example tool",
        parameters,
        safety: { readOnly: true, concurrencySafe: true, destructive: false, idempotent: true, interrupt: "abort" },
        execute: async () => "ok",
      },
    })

    expect(tool.capabilities).toMatchObject({
      readOnly: true,
      concurrencySafe: true,
      destructive: false,
      idempotent: true,
      interrupt: "cancel",
    })
    expect(await Effect.runPromise(tool.execute({ value: "ok" }, context()))).toEqual({
      title: "",
      output: "ok",
      metadata: {},
    })
  })
})
