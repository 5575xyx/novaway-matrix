import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { InstanceState } from "@/effect/instance-state"
import { detect } from "@/verify/detect"
import { run } from "@/verify/runner"

const Parameters = Schema.Struct({
  action: Schema.Literals(["list", "run"]),
  /** list 之后用返回的 id 指定要跑哪一条。 */
  id: Schema.optional(Schema.String),
  /** 只跑某一类：test / e2e / typecheck / lint / build。 */
  kind: Schema.optional(Schema.Literals(["test", "e2e", "typecheck", "lint", "build"])),
  timeout_ms: Schema.optional(Schema.Number),
})

/**
 * 项目验证（E2E / 测试 / 类型检查 / Lint / 构建）。
 *
 * 计划做完后跑一遍，用结果决定是继续修还是交付 —— 这正是"自己验证自己"的关键一步。
 * 命令来自项目现有脚本，不内置任何框架。
 */
type Metadata = {
  count?: number
  commands?: unknown
  ok?: boolean
  exit?: number | null
  passed?: number
  failed?: number
  skipped?: number
  failures?: string[]
  durationMs?: number
  command?: string
}

export const VerifyTool = Tool.define<typeof Parameters, Metadata, never>(
  "run_verification",
  Effect.gen(function* () {
    return {
      description: [
        "Run the project's own verification commands (tests, e2e, typecheck, lint, build).",
        "Use action=list first to see what is available, then action=run with an id (or kind) to execute it.",
        "Always run verification before claiming a task is complete; report failures with the failing case names.",
      ].join(" "),
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const instance = yield* InstanceState.context
          const commands = yield* Effect.promise(() => detect(instance.directory))

          if (params.action === "list") {
            return {
              title: `${commands.length} verification commands`,
              metadata: {
                count: commands.length,
                commands,
                ok: undefined,
                exit: undefined,
                passed: undefined,
                failed: undefined,
                skipped: undefined,
                failures: [] as string[],
                durationMs: undefined,
                command: undefined,
              },
              output:
                commands.length === 0
                  ? "No verification commands detected. Add a test/lint/typecheck script to package.json (or the language equivalent)."
                  : commands.map((item) => `- ${item.id} [${item.kind}] ${item.command}  (${item.source})`).join("\n"),
            }
          }

          const target = params.id
            ? commands.find((item) => item.id === params.id)
            : commands.find((item) => item.kind === (params.kind ?? "test"))
          if (!target) {
            return yield* Effect.fail(
              new Error(
                params.id
                  ? `Unknown verification id: ${params.id}. Available: ${commands.map((item) => item.id).join(", ") || "(none)"}`
                  : `No ${params.kind ?? "test"} command detected. Available: ${commands.map((item) => item.id).join(", ") || "(none)"}`,
              ),
            )
          }

          yield* ctx.ask({
            permission: "shell",
            patterns: [target.command],
            always: ["*"],
            metadata: { description: target.label, command: target.command },
          })

          const result = yield* Effect.promise(() =>
            run({
              command: target.command,
              cwd: instance.directory,
              timeoutMs: params.timeout_ms,
              signal: ctx.abort,
            }),
          )

          return {
            title: `${target.label}: ${result.summary}`,
            metadata: {
              count: commands.length,
              commands,
              ok: result.ok,
              exit: result.exitCode,
              passed: result.passed,
              failed: result.failed,
              skipped: result.skipped,
              failures: result.failures,
              durationMs: result.durationMs,
              command: target.command,
            },
            output: [
              `command: ${target.command}`,
              `result: ${result.ok ? "passed" : "failed"} (${result.summary}, ${result.durationMs}ms)`,
              ...(result.failures.length > 0
                ? ["", "failing cases:", ...result.failures.map((item) => `- ${item}`)]
                : []),
              "",
              "<verification_output>",
              result.output,
              "</verification_output>",
            ].join("\n"),
          }
        }).pipe(Effect.orDie),
    }
  }),
)
