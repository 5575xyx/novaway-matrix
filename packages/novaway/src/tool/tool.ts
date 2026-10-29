import { Effect, Schema } from "effect"
import type { JSONSchema7 } from "@ai-sdk/provider"
import type { MessageV2 } from "../session/message-v2"
import type { Permission } from "../permission"
import type { SessionID, MessageID } from "../session/schema"
import * as Truncate from "./truncate"
import { Agent } from "@/agent/agent"

interface Metadata {
  [key: string]: any
}

// TODO: remove this hack
export type DynamicDescription = (agent: Agent.Info) => Effect.Effect<string>

export type Context<M extends Metadata = Metadata> = {
  sessionID: SessionID
  messageID: MessageID
  agent: string
  /** Working directory override (worktree-isolated sessions). */
  directory?: string
  abort: AbortSignal
  callID?: string
  extra?: { [key: string]: unknown }
  messages: MessageV2.WithParts[]
  metadata(input: { title?: string; metadata?: M }): Effect.Effect<void>
  ask(input: Omit<Permission.Request, "id" | "sessionID" | "tool">): Effect.Effect<void>
}

export interface ExecuteResult<M extends Metadata = Metadata> {
  title: string
  metadata: M
  output: string
  attachments?: Omit<MessageV2.FilePart, "id" | "sessionID" | "messageID">[]
}

/**
 * Declarative capability metadata for a tool.
 *
 * These flags let the orchestration layer decide how to schedule tools
 * (read-only tools run concurrently, writers run serially), how much output
 * may be returned, and whether the tool needs a dedicated permission decision.
 * Everything is optional so existing tools keep working unchanged.
 */
export interface Capabilities {
  /** Tool performs no persistent side effects. */
  readOnly?: boolean | ((args: unknown) => boolean)
  /** Tool may run concurrently with other concurrency-safe tools in the same step. */
  concurrencySafe?: boolean | ((args: unknown) => boolean)
  /** Tool performs an irreversible operation (delete/overwrite/send). */
  destructive?: boolean
  /**
   * 同一个调用重做一次与只做一次，最终状态相同。
   *
   * 编排层用它决定「崩溃后能不能自动重跑」：只读工具天然幂等；`write` 这类
   * 「覆盖成同一内容」也算幂等；`bash` 默认不算（可能是 `git push`、发消息、
   * 扣款），只有只读命令的判定能把它临时提升为幂等。
   */
  idempotent?: boolean | ((args: unknown) => boolean)
  /** Maximum bytes kept inline before the output is persisted to disk. */
  maxResultBytes?: number
  /** Validate arguments against the current context. Errors are returned to the model. */
  validateInput?: (args: unknown, ctx: Context) => Effect.Effect<void, Error>
  /** Tool-specific permission decision, evaluated before the generic ruleset. */
  checkPermissions?: (args: unknown, ctx: Context) => Effect.Effect<"allow" | "ask" | "deny">
  /** Behaviour when the user submits a new message while this tool is running. */
  interrupt?: "cancel" | "block"
  /** Defer the full schema until the model searches for it. */
  deferLoading?: boolean
  /** Keep the full schema in the first prompt even when deferred loading is on. */
  alwaysLoad?: boolean
  /** Short phrase used by tool search keyword matching. */
  searchHint?: string
  /** Backwards-compatible tool names. */
  aliases?: string[]
}

export function resolveFlag(
  value: boolean | ((args: unknown) => boolean) | undefined,
  args: unknown,
  fallback: boolean,
) {
  if (value === undefined) return fallback
  if (typeof value === "function") {
    try {
      return value(args)
    } catch {
      return fallback
    }
  }
  return value
}

export function concurrencySafe(def: Pick<Def, "capabilities">, args: unknown) {
  return resolveFlag(def.capabilities?.concurrencySafe, args, false)
}

export function readOnly(def: Pick<Def, "capabilities">, args: unknown) {
  return resolveFlag(def.capabilities?.readOnly, args, false)
}

export function idempotent(def: Pick<Def, "capabilities">, args: unknown) {
  return resolveFlag(def.capabilities?.idempotent, args, false)
}

export function destructive(def: Pick<Def, "capabilities">) {
  return def.capabilities?.destructive === true
}

export function maxResultBytes(def: Pick<Def, "capabilities">) {
  return def.capabilities?.maxResultBytes
}

export interface Def<
  Parameters extends Schema.Decoder<unknown> = Schema.Decoder<unknown>,
  M extends Metadata = Metadata,
> {
  id: string
  description: string
  parameters: Parameters
  jsonSchema?: JSONSchema7
  capabilities?: Capabilities
  execute(args: Schema.Schema.Type<Parameters>, ctx: Context): Effect.Effect<ExecuteResult<M>>
  formatValidationError?(error: unknown): string
}
export type DefWithoutID<
  Parameters extends Schema.Decoder<unknown> = Schema.Decoder<unknown>,
  M extends Metadata = Metadata,
> = Omit<Def<Parameters, M>, "id">

export interface Info<
  Parameters extends Schema.Decoder<unknown> = Schema.Decoder<unknown>,
  M extends Metadata = Metadata,
> {
  id: string
  init: () => Effect.Effect<DefWithoutID<Parameters, M>>
}

type Init<Parameters extends Schema.Decoder<unknown>, M extends Metadata> =
  | DefWithoutID<Parameters, M>
  | (() => Effect.Effect<DefWithoutID<Parameters, M>>)

export type InferParameters<T> =
  T extends Info<infer P, any>
    ? Schema.Schema.Type<P>
    : T extends Effect.Effect<Info<infer P, any>, any, any>
      ? Schema.Schema.Type<P>
      : never
export type InferMetadata<T> =
  T extends Info<any, infer M> ? M : T extends Effect.Effect<Info<any, infer M>, any, any> ? M : never

export type InferDef<T> =
  T extends Info<infer P, infer M>
    ? Def<P, M>
    : T extends Effect.Effect<Info<infer P, infer M>, any, any>
      ? Def<P, M>
      : never

function wrap<Parameters extends Schema.Decoder<unknown>, Result extends Metadata>(
  id: string,
  init: Init<Parameters, Result>,
  truncate: Truncate.Interface,
  agents: Agent.Interface,
) {
  return () =>
    Effect.gen(function* () {
      const toolInfo = typeof init === "function" ? { ...(yield* init()) } : { ...init }
      // Compile the parser closure once per tool init; `decodeUnknownEffect`
      // allocates a new closure per call, so hoisting avoids re-closing it for
      // every LLM tool invocation.
      const decode = Schema.decodeUnknownEffect(toolInfo.parameters)
      const execute = toolInfo.execute
      toolInfo.execute = (args, ctx) => {
        const attrs = {
          "tool.name": id,
          "session.id": ctx.sessionID,
          "message.id": ctx.messageID,
          ...(ctx.callID ? { "tool.call_id": ctx.callID } : {}),
        }
        return Effect.gen(function* () {
          const decoded = yield* decode(args).pipe(
            Effect.mapError((error) =>
              toolInfo.formatValidationError
                ? new Error(toolInfo.formatValidationError(error), { cause: error })
                : new Error(
                    `The ${id} tool was called with invalid arguments: ${error}.\nPlease rewrite the input so it satisfies the expected schema.`,
                    { cause: error },
                  ),
            ),
          )
          yield* toolInfo.capabilities?.validateInput?.(decoded, ctx) ?? Effect.void
          const result = yield* execute(decoded as Schema.Schema.Type<Parameters>, ctx)
          if (result.metadata.truncated !== undefined) {
            return result
          }
          const agent = yield* agents.get(ctx.agent)
          const truncated = yield* truncate.output(
            result.output,
            toolInfo.capabilities?.maxResultBytes ? { maxBytes: toolInfo.capabilities.maxResultBytes } : {},
            agent,
          )
          return {
            ...result,
            output: truncated.content,
            metadata: {
              ...result.metadata,
              truncated: truncated.truncated,
              ...(truncated.truncated && { outputPath: truncated.outputPath }),
            },
          }
        }).pipe(Effect.orDie, Effect.withSpan("Tool.execute", { attributes: attrs }))
      }
      return toolInfo
    })
}

export function define<
  Parameters extends Schema.Decoder<unknown>,
  Result extends Metadata,
  R,
  ID extends string = string,
>(
  id: ID,
  init: Effect.Effect<Init<Parameters, Result>, never, R>,
): Effect.Effect<Info<Parameters, Result>, never, R | Truncate.Service | Agent.Service> & { id: ID } {
  return Object.assign(
    Effect.gen(function* () {
      const resolved = yield* init
      const truncate = yield* Truncate.Service
      const agents = yield* Agent.Service
      return { id, init: wrap(id, resolved, truncate, agents) }
    }),
    { id },
  )
}

export function init<P extends Schema.Decoder<unknown>, M extends Metadata>(
  info: Info<P, M>,
): Effect.Effect<Def<P, M>> {
  return Effect.gen(function* () {
    const init = yield* info.init()
    return {
      ...init,
      id: info.id,
    }
  })
}

export * as Tool from "./tool"
