import type { ToolContribution } from "@novaway/plugin-api"
import { Effect, JsonSchema, SchemaRepresentation, type Schema as EffectSchema } from "effect"
import { InstanceRef } from "@/effect/instance-ref"
import type * as Tool from "@/tool/tool"

export function adaptTool(input: { name: string; contribution: ToolContribution }): Tool.Def {
  const document = JsonSchema.fromSchemaDraft07(input.contribution.parameters as JsonSchema.JsonSchema)
  const parameters = SchemaRepresentation.toSchema<EffectSchema.Decoder<unknown>>(
    SchemaRepresentation.fromJsonSchemaDocument(document),
  )
  const safety = input.contribution.safety
  return {
    id: input.name,
    description: input.contribution.description,
    parameters,
    jsonSchema: input.contribution.parameters as Tool.Def["jsonSchema"],
    capabilities: {
      readOnly: safety?.readOnly ?? false,
      concurrencySafe: safety?.concurrencySafe ?? false,
      destructive: safety?.destructive ?? true,
      idempotent: safety?.idempotent ?? false,
      maxResultBytes: safety?.maxResultBytes ?? 20_000,
      deferLoading: safety?.deferLoading ?? false,
      ...(safety?.searchHint === undefined ? {} : { searchHint: safety.searchHint }),
      ...(safety?.interrupt === undefined
        ? {}
        : { interrupt: safety.interrupt === "abort" ? "cancel" : safety.interrupt }),
    },
    execute: (args, context) =>
      Effect.gen(function* () {
        const instance = yield* InstanceRef
        const services = yield* Effect.context<never>()
        const run = Effect.runPromiseWith(services)
        const directory = context.directory ?? instance?.directory ?? ""
        const worktree = instance?.worktree ?? directory
        const result = yield* Effect.tryPromise({
          try: () => input.contribution.execute(args, {
            sessionID: context.sessionID,
            messageID: context.messageID,
            agent: context.agent,
            directory,
            worktree,
            abort: context.abort,
            metadata: (value) => run(context.metadata(value)).then(() => undefined),
            ask: (value) => run(context.ask({ ...value, metadata: value.metadata ?? {} })),
          }),
          catch: (error) => error instanceof Error ? error : new Error(String(error)),
        }).pipe(Effect.orDie)
        return result
      }).pipe(
        Effect.map((result) =>
          typeof result === "string"
            ? { title: "", output: result, metadata: {} }
            : {
                title: result.title ?? "",
                output: result.output,
                metadata: result.metadata ?? {},
                attachments: result.attachments?.map((item) => ({
                  type: "file" as const,
                  mime: item.mime,
                  url: item.url,
                  filename: item.filename,
                })),
              },
        ),
      ),
  }
}

export * as PluginToolRuntime from "./tool"
