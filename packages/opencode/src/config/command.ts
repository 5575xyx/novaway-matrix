export * as ConfigCommand from "./command"

import * as Log from "@opencode-ai/core/util/log"
import { Cause, Exit, Schema } from "effect"
import { Glob } from "@opencode-ai/core/util/glob"
import { configEntryNameFromPath } from "./entry-name"
import { InvalidError } from "./error"
import * as ConfigMarkdown from "./markdown"
import { ConfigModelID } from "./model-id"

const log = Log.create({ service: "config" })

export const Info = Schema.Struct({
  template: Schema.String,
  description: Schema.optional(Schema.String),
  agent: Schema.optional(Schema.String),
  model: Schema.optional(ConfigModelID),
  subtask: Schema.optional(Schema.Boolean),
})

export type Info = Schema.Schema.Type<typeof Info>

const decodeInfo = Schema.decodeUnknownExit(Info)

export async function load(dir: string) {
  const result: Record<string, Info> = {}
  // Slash commands + evolution-produced workflows/prompts (activated as commands).
  const scans: Array<{ pattern: string; patterns: string[]; sourceLabel: string }> = [
    {
      pattern: "{command,commands}/**/*.md",
      patterns: ["/.novaway/command/", "/.novaway/commands/", "/command/", "/commands/"],
      sourceLabel: "command",
    },
    {
      pattern: "{workflow,workflows}/**/*.md",
      patterns: ["/.novaway/workflow/", "/.novaway/workflows/", "/workflow/", "/workflows/"],
      sourceLabel: "workflow",
    },
    {
      pattern: "{prompt,prompts}/**/*.md",
      patterns: ["/.novaway/prompt/", "/.novaway/prompts/", "/prompt/", "/prompts/"],
      sourceLabel: "prompt",
    },
  ]

  for (const scan of scans) {
    for (const item of await Glob.scan(scan.pattern, {
      cwd: dir,
      absolute: true,
      dot: true,
      symlink: true,
    })) {
      const md = await ConfigMarkdown.parse(item).catch((err) => {
        log.error(`failed to load ${scan.sourceLabel}`, { path: item, err })
        return undefined
      })
      if (!md) continue

      const name = configEntryNameFromPath(item, scan.patterns)
      if (!name || result[name]) continue

      const description =
        typeof md.data?.description === "string"
          ? md.data.description
          : scan.sourceLabel === "command"
            ? undefined
            : `Evolved ${scan.sourceLabel}: ${name}`

      const config = {
        name,
        ...md.data,
        ...(description ? { description } : {}),
        template: md.content.trim(),
      }
      const parsed = decodeInfo(config, { errors: "all", propertyOrder: "original" })
      if (Exit.isSuccess(parsed)) {
        result[config.name] = parsed.value
        continue
      }
      // Evolution artifacts may be free-form markdown; accept content-only templates.
      if (md.content.trim()) {
        result[name] = {
          template: md.content.trim(),
          description,
        }
        continue
      }
      throw new InvalidError({ path: item, message: Cause.pretty(parsed.cause) }, { cause: Cause.squash(parsed.cause) })
    }
  }
  return result
}
