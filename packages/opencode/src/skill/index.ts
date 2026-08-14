import path from "path"
import { pathToFileURL, fileURLToPath } from "url"
import matter from "gray-matter"
import { Effect, Layer, Context, Schema } from "effect"
import { NamedError } from "@opencode-ai/core/util/error"
import type { Agent } from "@/agent/agent"
import { Bus } from "@/bus"
import { InstanceState } from "@/effect/instance-state"
import { Global } from "@opencode-ai/core/global"
import { Permission } from "@/permission"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Config } from "@/config/config"
import { ConfigMarkdown } from "@/config/markdown"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { Glob } from "@opencode-ai/core/util/glob"
import * as Log from "@opencode-ai/core/util/log"
import { Discovery } from "./discovery"
import CUSTOMIZE_NOVAWAY_SKILL_BODY from "./prompt/customize-novaway.md" with { type: "text" }
import OFFICE_COMMUNICATION_SKILL_BODY from "./prompt/office-communication.md" with { type: "text" }
import OFFICE_DATA_SKILL_BODY from "./prompt/office-data.md" with { type: "text" }
import OFFICE_DESIGN_SKILL_BODY from "./prompt/office-design.md" with { type: "text" }
import OFFICE_DOCUMENT_SKILL_BODY from "./prompt/office-document.md" with { type: "text" }
import OFFICE_KNOWLEDGE_SKILL_BODY from "./prompt/office-knowledge.md" with { type: "text" }
import OFFICE_MEETING_SKILL_BODY from "./prompt/office-meeting.md" with { type: "text" }
import OFFICE_PPT_SKILL_BODY from "./prompt/office-ppt/SKILL.md" with { type: "text" }
import OFFICE_TASK_SKILL_BODY from "./prompt/office-task.md" with { type: "text" }
import OFFICE_WEB_SKILL_BODY from "./prompt/office-web.md" with { type: "text" }
import FIND_SKILLS_BODY from "./prompt/find-skills.md" with { type: "text" }
import SKILL_CREATOR_BODY from "./prompt/skill-creator.md" with { type: "text" }
import WXGZH_OPS_BODY from "./prompt/wxgzh-ops/SKILL.md" with { type: "text" }
import XIAOHONGSHU_OPS_BODY from "./prompt/xiaohongshu-ops/SKILL.md" with { type: "text" }
import { isRecord } from "@/util/record"
import { ensureSkillExtracted } from "./skill-assets"

const log = Log.create({ service: "skill" })
const CLAUDE_EXTERNAL_DIR = ".claude"
const AGENTS_EXTERNAL_DIR = ".agents"
const EXTERNAL_SKILL_PATTERN = "skills/**/SKILL.md"
const NOVAWAY_SKILL_PATTERN = "{skill,skills}/**/SKILL.md"
const SKILL_PATTERN = "**/SKILL.md"

// Built-in skill that ships with novaway. The model's intuition for what a
// novaway.json should look like is often wrong, and novaway hard-fails on
// invalid config, so users hit cryptic startup errors. Loading this skill
// when the model is asked to touch novaway's own config files gives it the
// actual schemas instead of guesses.
const CUSTOMIZE_NOVAWAY_SKILL_NAME = "customize-novaway"
const CUSTOMIZE_NOVAWAY_SKILL_DESCRIPTION =
  "Use ONLY when the user is editing or creating novaway's own configuration: novaway.json, novaway.jsonc, files under .novaway/, or files under ~/.config/novaway/. Also use when creating or fixing novaway agents, subagents, skills, plugins, MCP servers, or permission rules. Do not use for the user's own application code, or for any project that is not configuring novaway itself."

function builtInSkillFromMarkdown(input: string) {
  const md = matter(input)
  const name = typeof md.data.name === "string" ? md.data.name : undefined
  if (!name) throw new Error("Built-in skill markdown must define a name")
  return {
    name,
    ...(typeof md.data.description === "string" ? { description: md.data.description } : {}),
    content: md.content.trimStart(),
  }
}

// Built-in skills whose SKILL.md references auxiliary files on disk (Python scripts,
// Chrome extensions, etc.). Maps skill name → relative path under prompt/ directory.
const BUILT_IN_SKILL_DIRS: Record<string, string> = {
  "wxgzh-ops": "wxgzh-ops",
  "xiaohongshu-ops": "xiaohongshu-ops",
}

/** Compute the filesystem source path to a built-in skill's directory. */
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const SKILL_PROMPT_DIR = path.join(__dirname, "prompt")

function builtInSkillSourcePath(skillName: string): string | undefined {
  const rel = BUILT_IN_SKILL_DIRS[skillName]
  if (!rel) return undefined
  return path.join(SKILL_PROMPT_DIR, rel)
}

const resolveSkillLocation = Effect.fnUntraced(function* (
  skillName: string,
  fsys: AppFileSystem.Interface,
  global: Global.Interface,
) {
  const sourcePath = builtInSkillSourcePath(skillName)
  if (!sourcePath) return "<built-in>"
  const exists = yield* fsys.isDir(sourcePath)
  if (exists) return sourcePath
  const extracted = yield* ensureSkillExtracted(skillName, fsys, global)
  return extracted ?? "<built-in>"
})

const BUILT_IN_SKILLS = [
  {
    name: CUSTOMIZE_NOVAWAY_SKILL_NAME,
    description: CUSTOMIZE_NOVAWAY_SKILL_DESCRIPTION,
    content: CUSTOMIZE_NOVAWAY_SKILL_BODY,
  },
  {
    name: "office-document",
    description:
      "Use when NovaWay office mode needs AI document writing, rewriting, review, reports, plans, PRD drafts, weekly/monthly reports, or structured Markdown deliverables.",
    content: OFFICE_DOCUMENT_SKILL_BODY,
  },
  {
    name: "office-data",
    description:
      "Use when NovaWay office mode needs CSV/Excel data cleaning, pivot analysis, trend attribution, chart recommendations, or evidence-backed analysis reports.",
    content: OFFICE_DATA_SKILL_BODY,
  },
  {
    name: "office-design",
    description:
      "Use when NovaWay office mode needs posters, social covers, visual assets, brand palettes, icon drafts, or executable visual specs.",
    content: OFFICE_DESIGN_SKILL_BODY,
  },
  {
    name: "office-ppt",
    description:
      "Use when NovaWay office mode needs AI PPT outlines, page-by-page content, presentation storylines, speaker notes, visual suggestions, proposals, or project reports.",
    content: OFFICE_PPT_SKILL_BODY,
  },
  {
    name: "office-meeting",
    description:
      "Use when NovaWay office mode needs meeting minutes, decisions, action items, owners, deadlines, risks, or follow-up emails.",
    content: OFFICE_MEETING_SKILL_BODY,
  },
  {
    name: "office-knowledge",
    description:
      "Use when NovaWay office mode needs knowledge-base summaries, document comparison, source indexing, FAQ generation, or reusable project knowledge.",
    content: OFFICE_KNOWLEDGE_SKILL_BODY,
  },
  {
    name: "office-task",
    description:
      "Use when NovaWay office mode needs task breakdown, priorities, execution plans, weekly plans, risk boards, dependencies, or follow-up cadence.",
    content: OFFICE_TASK_SKILL_BODY,
  },
  {
    name: "office-web",
    description:
      "Use when NovaWay office mode needs HTML dashboards, project tracker pages, customer tools, data pages, or single-page demo sites.",
    content: OFFICE_WEB_SKILL_BODY,
  },
  {
    name: "office-communication",
    description:
      "Use when NovaWay office mode needs emails, replies, internal notices, collaboration messages, bilingual business communication, or tone rewriting.",
    content: OFFICE_COMMUNICATION_SKILL_BODY,
  },
  builtInSkillFromMarkdown(FIND_SKILLS_BODY),
  builtInSkillFromMarkdown(SKILL_CREATOR_BODY),
  builtInSkillFromMarkdown(WXGZH_OPS_BODY),
  builtInSkillFromMarkdown(XIAOHONGSHU_OPS_BODY),
]

export const Info = Schema.Struct({
  name: Schema.String,
  description: Schema.optional(Schema.String),
  location: Schema.String,
  content: Schema.String,
  builtIn: Schema.optional(Schema.Boolean),
})
export type Info = Schema.Schema.Type<typeof Info>

const Issue = Schema.StructWithRest(
  Schema.Struct({
    message: Schema.String,
    path: Schema.Array(Schema.String),
  }),
  [Schema.Record(Schema.String, Schema.Unknown)],
)

function isSkillFrontmatter(data: unknown): data is { name: string; description?: string } {
  return (
    isRecord(data) &&
    typeof data.name === "string" &&
    (data.description === undefined || typeof data.description === "string")
  )
}

export const InvalidError = NamedError.create("SkillInvalidError", {
  path: Schema.String,
  message: Schema.optional(Schema.String),
  issues: Schema.optional(Schema.Array(Issue)),
})

export const NameMismatchError = NamedError.create("SkillNameMismatchError", {
  path: Schema.String,
  expected: Schema.String,
  actual: Schema.String,
})

type State = {
  skills: Record<string, Info>
  dirs: Set<string>
}

type DiscoveryState = {
  matches: string[]
  dirs: string[]
}

type ScanState = {
  matches: Set<string>
  dirs: Set<string>
}

export interface Interface {
  readonly get: (name: string) => Effect.Effect<Info | undefined>
  readonly all: () => Effect.Effect<Info[]>
  readonly dirs: () => Effect.Effect<string[]>
  readonly available: (agent?: Agent.Info) => Effect.Effect<Info[]>
  /** Rediscover and reload skills from disk for the current instance. */
  readonly reload: () => Effect.Effect<Info[]>
}

const add = Effect.fnUntraced(function* (state: State, match: string, bus: Bus.Interface) {
  const md = yield* Effect.tryPromise({
    try: () => ConfigMarkdown.parse(match),
    catch: (err) => err,
  }).pipe(
    Effect.catch(
      Effect.fnUntraced(function* (err) {
        const message = ConfigMarkdown.FrontmatterError.isInstance(err)
          ? err.data.message
          : `Failed to parse skill ${match}`
        const { Session } = yield* Effect.promise(() => import("@/session/session"))
        yield* bus.publish(Session.Event.Error, { error: new NamedError.Unknown({ message }).toObject() })
        log.error("failed to load skill", { skill: match, err })
        return undefined
      }),
    ),
  )

  if (!md) return

  if (!isSkillFrontmatter(md.data)) return

  if (state.skills[md.data.name]) {
    log.warn("duplicate skill name", {
      name: md.data.name,
      existing: state.skills[md.data.name].location,
      duplicate: match,
    })
  }

  state.dirs.add(path.dirname(match))
  state.skills[md.data.name] = {
    name: md.data.name,
    description: md.data.description,
    location: match,
    content: md.content,
  }
})

const scan = Effect.fnUntraced(function* (
  state: ScanState,
  root: string,
  pattern: string,
  opts?: { dot?: boolean; scope?: string },
) {
  const matches = yield* Effect.tryPromise({
    try: () =>
      Glob.scan(pattern, {
        cwd: root,
        absolute: true,
        include: "file",
        symlink: true,
        dot: opts?.dot,
      }),
    catch: (error) => error,
  }).pipe(
    Effect.catch((error) => {
      if (!opts?.scope) return Effect.die(error)
      log.error(`failed to scan ${opts.scope} skills`, { dir: root, error })
      return Effect.succeed([] as string[])
    }),
  )

  for (const match of matches) {
    state.matches.add(match)
    state.dirs.add(path.dirname(match))
  }
})

const discoverSkills = Effect.fnUntraced(function* (
  config: Config.Interface,
  discovery: Discovery.Interface,
  fsys: AppFileSystem.Interface,
  global: Global.Interface,
  disableExternalSkills: boolean,
  disableClaudeCodeSkills: boolean,
  directory: string,
  worktree: string,
) {
  const state: ScanState = { matches: new Set(), dirs: new Set() }

  const externalDirs: string[] = []
  if (!disableExternalSkills) {
    if (!disableClaudeCodeSkills) externalDirs.push(CLAUDE_EXTERNAL_DIR)
    externalDirs.push(AGENTS_EXTERNAL_DIR)

    for (const dir of externalDirs) {
      const root = path.join(global.home, dir)
      if (!(yield* fsys.isDir(root))) continue
      yield* scan(state, root, EXTERNAL_SKILL_PATTERN, { dot: true, scope: "global" })
    }

    const upDirs = yield* fsys
      .up({ targets: externalDirs, start: directory, stop: worktree })
      .pipe(Effect.catch(() => Effect.succeed([] as string[])))

    for (const root of upDirs) {
      yield* scan(state, root, EXTERNAL_SKILL_PATTERN, { dot: true, scope: "project" })
    }
  }

  const configDirs = yield* config.directories()
  // Always include the current instance .novaway paths so skills written after
  // first config load (e.g. evolution apply + hot reload) are still discoverable.
  const roots = new Set<string>(configDirs)
  roots.add(path.join(directory, ".novaway"))
  if (worktree && worktree !== directory) roots.add(path.join(worktree, ".novaway"))
  for (const dir of roots) {
    if (!(yield* fsys.isDir(dir))) continue
    yield* scan(state, dir, NOVAWAY_SKILL_PATTERN)
  }

  const cfg = yield* config.get()
  for (const item of cfg.skills?.paths ?? []) {
    const expanded = item.startsWith("~/") ? path.join(global.home, item.slice(2)) : item
    const dir = path.isAbsolute(expanded) ? expanded : path.join(directory, expanded)
    if (!(yield* fsys.isDir(dir))) {
      log.warn("skill path not found", { path: dir })
      continue
    }

    yield* scan(state, dir, SKILL_PATTERN)
  }

  for (const url of cfg.skills?.urls ?? []) {
    const pulledDirs = yield* discovery.pull(url)
    for (const dir of pulledDirs) {
      yield* scan(state, dir, SKILL_PATTERN)
    }
  }

  return {
    matches: Array.from(state.matches),
    dirs: Array.from(state.dirs),
  }
})

const loadSkills = Effect.fnUntraced(function* (state: State, discovered: DiscoveryState, bus: Bus.Interface) {
  yield* Effect.forEach(discovered.matches, (match) => add(state, match, bus), {
    concurrency: "unbounded",
    discard: true,
  })

  log.info("init", { count: Object.keys(state.skills).length })
})

export class Service extends Context.Service<Service, Interface>()("@opencode/Skill") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const discovery = yield* Discovery.Service
    const config = yield* Config.Service
    const bus = yield* Bus.Service
    const fsys = yield* AppFileSystem.Service
    const global = yield* Global.Service
    const flags = yield* RuntimeFlags.Service
    const discovered = yield* InstanceState.make(
      Effect.fn("Skill.discovery")(function* (ctx) {
        return yield* discoverSkills(
          config,
          discovery,
          fsys,
          global,
          flags.disableExternalSkills,
          flags.disableClaudeCodeSkills,
          ctx.directory,
          ctx.worktree,
        )
      }),
    )
    const state = yield* InstanceState.make(
      Effect.fn("Skill.state")(function* () {
        const s: State = { skills: {}, dirs: new Set() }
        // Register the built-in skill BEFORE disk discovery so a user-disk
        // skill with the same name can override it.
        for (const skill of BUILT_IN_SKILLS) {
          const location = yield* resolveSkillLocation(skill.name, fsys, global)
          s.skills[skill.name] = { ...skill, location, builtIn: true }
        }
        yield* loadSkills(s, yield* InstanceState.get(discovered), bus)
        return s
      }),
    )

    const get = Effect.fn("Skill.get")(function* (name: string) {
      const s = yield* InstanceState.get(state)
      return s.skills[name]
    })

    const all = Effect.fn("Skill.all")(function* () {
      const s = yield* InstanceState.get(state)
      return Object.values(s.skills)
    })

    const dirs = Effect.fn("Skill.dirs")(function* () {
      return (yield* InstanceState.get(discovered)).dirs
    })

    const available = Effect.fn("Skill.available")(function* (agent?: Agent.Info) {
      const s = yield* InstanceState.get(state)
      const list = Object.values(s.skills).toSorted((a, b) => a.name.localeCompare(b.name))
      if (!agent) return list
      return list.filter((skill) => Permission.evaluate("skill", skill.name, agent.permission).action !== "deny")
    })

    const reload = Effect.fn("Skill.reload")(function* () {
      yield* InstanceState.invalidate(discovered)
      const nextDiscovered = yield* InstanceState.get(discovered)
      yield* InstanceState.invalidate(state)
      const next = yield* InstanceState.get(state)
      log.info("reload", {
        count: Object.keys(next.skills).length,
        matches: nextDiscovered.matches.length,
      })
      return Object.values(next.skills).toSorted((a, b) => a.name.localeCompare(b.name))
    })

    return Service.of({ get, all, dirs, available, reload })
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(Discovery.defaultLayer),
  Layer.provide(Config.defaultLayer),
  Layer.provide(Bus.layer),
  Layer.provide(AppFileSystem.defaultLayer),
  Layer.provide(Global.layer),
  Layer.provide(RuntimeFlags.defaultLayer),
)

export function fmt(list: Info[], opts: { verbose: boolean }) {
  const described = list.filter((skill) => skill.description !== undefined)
  if (described.length === 0) return "No skills are currently available."
  if (opts.verbose) {
    return [
      "<available_skills>",
      ...described
        .toSorted((a, b) => a.name.localeCompare(b.name))
        .flatMap((skill) => [
          "  <skill>",
          `    <name>${skill.name}</name>`,
          `    <description>${skill.description}</description>`,
          `    <location>${pathToFileURL(skill.location).href}</location>`,
          "  </skill>",
        ]),
      "</available_skills>",
    ].join("\n")
  }

  return [
    "## Available Skills",
    ...described
      .toSorted((a, b) => a.name.localeCompare(b.name))
      .map((skill) => `- **${skill.name}**: ${skill.description}`),
  ].join("\n")
}

export * as Skill from "."
