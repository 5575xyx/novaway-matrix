import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { InstanceState } from "@/effect/instance-state"
import { TempFiles } from "@/session/temp-files"

const Parameters = Schema.Struct({
  action: Schema.Literals(["list", "clean"]),
  /** clean 时只清理这些相对路径；不传表示清理全部可安全删除的临时文件。 */
  paths: Schema.optional(Schema.Array(Schema.String)),
})

/**
 * 临时文件清理工具。
 *
 * 模型在任务收尾时调用 `clean`，把本轮写出来的一次性脚本/探针删掉。
 * 只删除「工具新建 + 命名明确像临时文件 + 内容未改过」的文件，
 * 源码与用户改过的文件一律跳过。
 */
type Metadata = {
  count?: number
  files?: string[]
  removed?: string[]
  skipped?: { path: string; reason: string }[]
}

export const TempFilesTool = Tool.define<typeof Parameters, Metadata, never>(
  "cleanup_temp_files",
  Effect.gen(function* () {
    return {
      description: [
        "List or delete temporary files created by this agent in the current session.",
        "Only files created by tools whose names look temporary (tmp-*, temp-*, scratch-*, *.tmp/.bak/.orig/.rej) are tracked.",
        "Files modified after creation are never deleted automatically. Call this at the end of a task to clean up probes and one-off scripts.",
      ].join(" "),
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const instance = yield* InstanceState.context
          const worktree = instance.worktree === "/" ? instance.directory : instance.worktree
          if (params.action === "list") {
            const files = yield* Effect.promise(() => TempFiles.list(ctx.sessionID))
            return {
              title: `${files.length} temp files`,
              metadata: { count: files.length, files: files.map((file) => file.relative) },
              output:
                files.length === 0
                  ? "No temporary files tracked in this session."
                  : files
                      .map(
                        (file) => `- ${file.relative} (${file.tool}, ${Math.max(1, Math.round(file.size / 1024))}KB)`,
                      )
                      .join("\n"),
            }
          }

          const result = yield* Effect.promise(() =>
            TempFiles.clean({
              sessionID: ctx.sessionID,
              worktree,
              paths: params.paths?.map((item) => `${worktree}/${item}`),
            }),
          )
          const lines = [
            `removed: ${result.removed.length}`,
            ...result.removed.map((path) => `  - ${path}`),
            ...(result.skipped.length > 0
              ? ["skipped:", ...result.skipped.map((item) => `  - ${item.path} (${item.reason})`)]
              : []),
          ]
          return {
            title: `Cleaned ${result.removed.length} temp files`,
            metadata: { removed: result.removed, skipped: result.skipped },
            output: lines.join("\n"),
          }
        }),
    }
  }),
)
