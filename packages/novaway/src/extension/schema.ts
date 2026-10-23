import { Schema } from "effect"
import { ConfigMCP } from "@/config/mcp"

/**
 * A single extension manifest. The shape intentionally mirrors Claude Code's
 * `plugin.json` so existing marketplace packages can be consumed directly.
 */
export const Manifest = Schema.Struct({
  name: Schema.String,
  version: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String),
  manifestVersion: Schema.optional(Schema.Number),
  engines: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  main: Schema.optional(Schema.String),
  dependencies: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  contributes: Schema.optional(
    Schema.Struct({
      commands: Schema.optional(Schema.Union([Schema.String, Schema.mutable(Schema.Array(Schema.String))])),
      agents: Schema.optional(Schema.Union([Schema.String, Schema.mutable(Schema.Array(Schema.String))])),
      skills: Schema.optional(Schema.Union([Schema.String, Schema.mutable(Schema.Array(Schema.String))])),
      hooks: Schema.optional(Schema.String),
      mcpServers: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
      tools: Schema.optional(Schema.Union([Schema.String, Schema.mutable(Schema.Array(Schema.String))])),
      outputStyles: Schema.optional(Schema.String),
      lspServers: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
    }),
  ),
  permissions: Schema.optional(
    Schema.Struct({
      tools: Schema.optional(Schema.mutable(Schema.Array(Schema.String))),
      network: Schema.optional(Schema.mutable(Schema.Array(Schema.String))),
      filesystem: Schema.optional(Schema.mutable(Schema.Array(Schema.String))),
    }),
  ),
  // Claude marketplace entries use these top-level contribution keys.
  commands: Schema.optional(Schema.Union([Schema.String, Schema.mutable(Schema.Array(Schema.String))])),
  agents: Schema.optional(Schema.Union([Schema.String, Schema.mutable(Schema.Array(Schema.String))])),
  skills: Schema.optional(Schema.Union([Schema.String, Schema.mutable(Schema.Array(Schema.String))])),
  hooks: Schema.optional(Schema.Union([Schema.String, Schema.Record(Schema.String, Schema.Unknown)])),
  mcpServers: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  tools: Schema.optional(Schema.Union([Schema.String, Schema.mutable(Schema.Array(Schema.String))])),
}).annotate({ identifier: "ExtensionManifest" })
export type Manifest = Schema.Schema.Type<typeof Manifest>

export type Loaded = {
  name: string
  root: string
  source: "builtin" | "user" | "project" | "claude" | "plugin" | "session"
  manifest: Manifest
  enabled: boolean
  /** Error encountered while reading the manifest, if any. */
  error?: string
}

export type Contribution =
  | { kind: "command"; name: string; path: string }
  | { kind: "agent"; name: string; path: string }
  | { kind: "skill"; name: string; path: string }
  | { kind: "hook"; path: string }
  | { kind: "output-style"; path: string }
  | { kind: "mcp"; name: string; config: unknown }
  | { kind: "tool"; path: string }

export function asArray(value: string | string[] | undefined): string[] {
  if (!value) return []
  return Array.isArray(value) ? value : [value]
}

/**
 * Conventional directories.
 *
 * Older marketplace installs (and many Claude plugins) ship `skills/`,
 * `commands/`, `agents/` without declaring them in a manifest. Falling back to
 * these keeps such packages visible in the contribution list.
 */
export const CONVENTIONAL = {
  commands: ["commands"],
  agents: ["agents"],
  skills: ["skills"],
  hooks: ["hooks/hooks.json"],
  tools: ["tools", "tool"],
} as const

export function contributions(loaded: Loaded): Contribution[] {
  const manifest = loaded.manifest
  const contributes = manifest.contributes ?? {}
  const result: Contribution[] = []

  const commands = asArray(contributes.commands ?? manifest.commands)
  const agents = asArray(contributes.agents ?? manifest.agents)
  const skills = asArray(contributes.skills ?? manifest.skills)

  for (const path of commands.length > 0 ? commands : CONVENTIONAL.commands) {
    result.push({ kind: "command", name: loaded.name, path })
  }
  for (const path of agents.length > 0 ? agents : CONVENTIONAL.agents) {
    result.push({ kind: "agent", name: loaded.name, path })
  }
  for (const path of skills.length > 0 ? skills : CONVENTIONAL.skills) {
    result.push({ kind: "skill", name: loaded.name, path })
  }
  for (const path of asArray(contributes.tools ?? manifest.tools)) {
    result.push({ kind: "tool", path })
  }
  if (contributes.hooks) result.push({ kind: "hook", path: contributes.hooks })
  else if (typeof manifest.hooks === "string") result.push({ kind: "hook", path: manifest.hooks })
  if (contributes.outputStyles) result.push({ kind: "output-style", path: contributes.outputStyles })

  const servers = contributes.mcpServers ?? manifest.mcpServers
  for (const [name, config] of Object.entries(servers ?? {})) {
    result.push({ kind: "mcp", name, config })
  }
  return result
}

export const MCPConfig = ConfigMCP.Info
