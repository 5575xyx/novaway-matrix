export * as ConfigCommand from "./command"

import * as Log from "@novaway/core/util/log"
import { Cause, Exit, Schema } from "effect"
import { Glob } from "@novaway/core/util/glob"
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
  // Command/skill model aligned with Claude Code.
  type: Schema.optional(Schema.Literals(["prompt", "action"])),
  aliases: Schema.optional(Schema.mutable(Schema.Array(Schema.String))),
  argumentHint: Schema.optional(Schema.String),
  whenToUse: Schema.optional(Schema.String),
  version: Schema.optional(Schema.String),
  context: Schema.optional(Schema.Literals(["inline", "fork"])),
  allowedTools: Schema.optional(Schema.mutable(Schema.Array(Schema.String))),
  paths: Schema.optional(Schema.mutable(Schema.Array(Schema.String))),
  hooks: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  userInvocable: Schema.optional(Schema.Boolean),
  disableModelInvocation: Schema.optional(Schema.Boolean),
  isHidden: Schema.optional(Schema.Boolean),
  immediate: Schema.optional(Schema.Boolean),
  sensitive: Schema.optional(Schema.Boolean),
  handler: Schema.optional(Schema.String),
})

export type Info = Schema.Schema.Type<typeof Info>

const decodeInfo = Schema.decodeUnknownExit(Info)

export async function load(dir: string) {
  const result: Record<string, Info> = {}
  // Slash commands + evolution-produced workflows/prompts (activated as commands).
  const scans: Array<{ pattern: string; patterns: string[]; sourceLabel: string }> = [
    {
      pattern: "{command,commands}/**/*.md",
      patterns: [
        "/.novaway/command/",
        "/.novaway/commands/",
        "/.claude/command/",
        "/.claude/commands/",
        "/command/",
        "/commands/",
      ],
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
          ...(typeof md.data?.type === "string" ? { type: md.data.type as "prompt" | "action" } : {}),
        }
        continue
      }
      throw new InvalidError({ path: item, message: Cause.pretty(parsed.cause) }, { cause: Cause.squash(parsed.cause) })
    }
  }
  return result
}
