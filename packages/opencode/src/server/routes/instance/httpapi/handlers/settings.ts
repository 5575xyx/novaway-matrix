import path from "path"
import matter from "gray-matter"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Global } from "@opencode-ai/core/global"
import { Config } from "@/config/config"
import { configEntryNameFromPath } from "@/config/entry-name"
import { ConfigMarkdown } from "@/config/markdown"
import * as InstanceState from "@/effect/instance-state"
import { Skill } from "@/skill"
import { isRecord } from "@/util/record"
import { Effect } from "effect"
import { HttpApiBuilder, HttpApiError } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { markInstanceForDisposal } from "../lifecycle"
import {
  SettingsAgentPayload,
  SettingsImportPayload,
  SettingsMarkdownAsset,
  SettingsProjectInstructionPayload,
  SettingsRulePayload,
  SettingsSkillPayload,
} from "../groups/settings"

const NAME_PATTERN = /^[a-zA-Z0-9_.-]+$/
const ENTRY_NAME_PATTERN = /^[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)*$/
const THEME_COLORS = new Set(["primary", "secondary", "accent", "success", "warning", "error", "info"])

type ImportItem = {
  name: string
  category?: string
  location: string
  status: "imported" | "skipped"
  reason?: string
}

export const settingsHandlers = HttpApiBuilder.group(InstanceHttpApi, "settings", (handlers) =>
  Effect.gen(function* () {
    const config = yield* Config.Service
    const fs = yield* AppFileSystem.Service
    const skill = yield* Skill.Service

    const safeName = (name: string) => {
      const value = name.trim()
      if (!NAME_PATTERN.test(value)) return
      return value
    }

    const safeEntryName = (name: string) => {
      const value = name.trim().replaceAll("\\", "/")
      if (!ENTRY_NAME_PATTERN.test(value)) return
      return value
    }

    const slug = (value: string) => {
      const normalized = value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_.-]+/g, "-")
        .replace(/^-+|-+$/g, "")
      return safeName(normalized) ?? "imported"
    }

    const cleanCategory = (value: string) =>
      value
        .split(/[\\/]+/)
        .map((part) => slug(part))
        .filter(Boolean)
        .join("/")

    const importSource = Effect.fn("SettingsHttpApi.importSource")(function* (source: string) {
      const ctx = yield* InstanceState.context
      const value = source.trim().replace(/^["']|["']$/g, "")
      const resolved = path.isAbsolute(value) ? path.normalize(value) : path.resolve(ctx.directory, value)
      if (!(yield* fs.existsSafe(resolved))) return
      return resolved
    })

    const rootBeforeDirectory = (file: string, names: string[]) => {
      const parts = path.normalize(file).split(/[\\/]+/)
      const index = parts.findLastIndex((part) => names.includes(part.toLowerCase()))
      if (index <= 0) return
      return parts.slice(0, index).join(path.sep)
    }

    const agentSourceRoot = (file: string) =>
      rootBeforeDirectory(file, ["agent", "agents"]) ?? path.dirname(path.dirname(file))

    const skillSourceRoot = (file: string) => rootBeforeDirectory(file, ["skill", "skills"]) ?? path.dirname(file)

    const importCategory = (root: string, file: string, suffix: string) => {
      const relative = path.relative(root, file)
      const dir = path.dirname(relative.endsWith(suffix) ? relative.slice(0, -suffix.length) : relative)
      const parts = dir
        .split(/[\\/]+/)
        .filter(
          (part) =>
            part && part !== "." && part !== "agent" && part !== "agents" && part !== "skills" && part !== "skill",
        )
      return cleanCategory(parts.join("/"))
    }

    const skillCategory = (file: string, dirs: string[]) => {
      const dir = dirs.find((item) => AppFileSystem.contains(item, file))
      if (!dir) return ""
      const parts = path.relative(dir, file).split(/[\\/]+/)
      if (parts[0] !== "skill" && parts[0] !== "skills") return ""
      return cleanCategory(parts.slice(1, -2).join("/"))
    }

    const markdownFiles = Effect.fn("SettingsHttpApi.markdownFiles")(function* (source: string, pattern: string) {
      if (yield* fs.isFile(source)) return [source]
      if (!(yield* fs.isDir(source))) return []
      return yield* fs.glob(pattern, { cwd: source, absolute: true, dot: true, symlink: true }).pipe(Effect.orDie)
    })

    const parseMarkdown = Effect.fn("SettingsHttpApi.parseMarkdown")(function* (file: string) {
      return yield* Effect.tryPromise({
        try: () => ConfigMarkdown.parse(file),
        catch: (error) => error,
      }).pipe(Effect.catch(() => Effect.succeed(undefined)))
    })

    const agentPermissionFromTools = (tools: unknown) => {
      const values =
        typeof tools === "string"
          ? tools.split(",").map((item) => item.trim())
          : Array.isArray(tools)
            ? tools.filter((item): item is string => typeof item === "string")
            : []
      const permission: Record<string, "allow"> = {}
      for (const tool of values) {
        const name = tool.toLowerCase().replace(/[^a-z]/g, "")
        if (name === "read") permission.read = "allow"
        if (name === "write" || name === "edit" || name === "patch") permission.edit = "allow"
        if (name === "webfetch") permission.webfetch = "allow"
        if (name === "websearch") permission.websearch = "allow"
        if (name === "bash") permission.bash = "allow"
        if (name === "grep") permission.grep = "allow"
        if (name === "glob") permission.glob = "allow"
        if (name === "list") permission.list = "allow"
      }
      return permission
    }

    const isValidColor = (value: unknown) =>
      typeof value === "string" && (/^#[0-9a-fA-F]{6}$/.test(value) || THEME_COLORS.has(value))

    const importResult = (items: ImportItem[]) => ({
      imported: items.filter((item) => item.status === "imported").length,
      skipped: items.filter((item) => item.status === "skipped").length,
      items,
    })

    const projectDir = Effect.fn("SettingsHttpApi.projectDir")(function* () {
      return path.join((yield* InstanceState.context).directory, ".novaway")
    })

    const projectRoot = Effect.fn("SettingsHttpApi.projectRoot")(function* () {
      const ctx = yield* InstanceState.context
      return ctx.worktree === "/" ? ctx.directory : ctx.worktree
    })

    const globalDir = Effect.fn("SettingsHttpApi.globalDir")(function* () {
      return Global.Path.config
    })

    const ruleDir = Effect.fn("SettingsHttpApi.ruleDir")(function* (scope: "global" | "project") {
      return path.join(scope === "global" ? yield* globalDir() : yield* projectDir(), "rules")
    })

    const configDirs = Effect.fn("SettingsHttpApi.configDirs")(function* () {
      return yield* config.directories()
    })

    const isEditable = Effect.fn("SettingsHttpApi.isEditable")(function* (file: string) {
      return (yield* configDirs()).some((dir) => AppFileSystem.contains(dir, file))
    })

    const parseAsset = Effect.fn("SettingsHttpApi.parseAsset")(function* (file: string, fallbackName: string) {
      const md = yield* Effect.tryPromise({
        try: () => ConfigMarkdown.parse(file),
        catch: (error) => error,
      }).pipe(Effect.catch(() => Effect.succeed(undefined)))
      if (!md) return
      const data = { ...md.data }
      const name = typeof data.name === "string" ? data.name : fallbackName
      return {
        name,
        location: file,
        editable: yield* isEditable(file),
        data,
        content: md.content,
      }
    })

    const parseSkillFile = Effect.fn("SettingsHttpApi.parseSkillFile")(function* (file: string, dirs: string[]) {
      const md = yield* parseMarkdown(file)
      if (!md) return
      const category = skillCategory(file, dirs)
      const name = typeof md.data.name === "string" ? md.data.name : configEntryNameFromPath(path.dirname(file), [])
      return {
        name,
        location: file,
        editable: dirs.some((dir) => AppFileSystem.contains(dir, file)),
        data: {
          name,
          ...(typeof md.data.display_name === "string" ? { display_name: md.data.display_name } : {}),
          ...(typeof md.data.description === "string" ? { description: md.data.description } : {}),
          ...(category ? { category } : {}),
        },
        content: md.content,
      }
    })

    const listAgents = Effect.fn("SettingsHttpApi.agentList")(function* () {
      const files = yield* Effect.forEach(
        yield* configDirs(),
        (dir) =>
          fs.glob("{agent,agents}/**/*.md", { cwd: dir, absolute: true, dot: true, symlink: true }).pipe(Effect.orDie),
        { concurrency: "unbounded" },
      ).pipe(Effect.map((items) => items.flat()))
      const assets = yield* Effect.forEach(
        files,
        (file) =>
          parseAsset(
            file,
            configEntryNameFromPath(file, ["/.novaway/agent/", "/.novaway/agents/", "/agent/", "/agents/"]),
          ),
        { concurrency: "unbounded" },
      )
      return assets.filter((item) => item !== undefined).toSorted((a, b) => a.name.localeCompare(b.name))
    })

    const listSkills = Effect.fn("SettingsHttpApi.skillList")(function* () {
      const dirs = yield* configDirs()
      const runtime = (yield* skill.all())
        .filter((item) => item.builtIn)
        .map((item) => {
          return {
            name: item.name,
            location: item.location,
            editable: false,
            builtIn: true,
            data: {
              name: item.name,
              ...(item.description ? { description: item.description } : {}),
            },
            content: item.content,
          }
        })

      const diskFiles = yield* Effect.forEach(
        dirs,
        (dir) =>
          fs
            .glob("{skill,skills}/**/SKILL.md", { cwd: dir, absolute: true, dot: true, symlink: true })
            .pipe(Effect.orDie),
        { concurrency: "unbounded" },
      ).pipe(Effect.map((items) => items.flat()))
      const disk = yield* Effect.forEach(diskFiles, (file) => parseSkillFile(file, dirs), { concurrency: "unbounded" })

      return Array.from(
        new Map([...runtime, ...disk.filter((item) => item !== undefined)].map((item) => [item.name, item])).values(),
      ).toSorted((a, b) => a.name.localeCompare(b.name))
    })

    const reload = Effect.fn("SettingsHttpApi.reload")(function* () {
      yield* config.invalidate()
      yield* markInstanceForDisposal(yield* InstanceState.context)
    })

    const ruleFile = Effect.fn("SettingsHttpApi.ruleFile")(function* (scope: "global" | "project", name: string) {
      const dir = yield* ruleDir(scope)
      return path.join(dir, `${name}.md`)
    })

    const listRules = Effect.fn("SettingsHttpApi.ruleList")(function* (scope: "global" | "project") {
      const dir = yield* ruleDir(scope)
      const files = yield* fs
        .glob("*.md", { cwd: dir, absolute: true, dot: true, symlink: true })
        .pipe(Effect.catch(() => Effect.succeed([])))
      const assets = yield* Effect.forEach(files, (file) => parseAsset(file, path.basename(file, ".md")), {
        concurrency: "unbounded",
      })
      return assets.filter((item) => item !== undefined).toSorted((a, b) => a.name.localeCompare(b.name))
    })

    const saveRuleFile = Effect.fn("SettingsHttpApi.ruleSaveFile")(function* (
      scope: "global" | "project",
      name: string,
      payload: typeof SettingsRulePayload.Type,
    ) {
      const file = yield* ruleFile(scope, name)
      yield* fs
        .writeWithDirs(
          file,
          matter.stringify(payload.content.trimEnd() + "\n", {
            ...(payload.description ? { description: payload.description } : {}),
            ...(payload.trigger ? { trigger: payload.trigger } : {}),
          }),
        )
        .pipe(Effect.orDie)
      yield* reload()
      return (yield* parseAsset(file, name))!
    })

    const deleteRuleFile = Effect.fn("SettingsHttpApi.ruleDeleteFile")(function* (
      scope: "global" | "project",
      name: string,
    ) {
      yield* fs.remove(yield* ruleFile(scope, name)).pipe(Effect.orDie)
      yield* reload()
      return true
    })

    const projectInstructionFile = Effect.fn("SettingsHttpApi.projectInstructionFile")(function* () {
      return path.join(yield* projectRoot(), "AGENTS.md")
    })

    const projectInstructionTarget = Effect.fn("SettingsHttpApi.projectInstructionTarget")(function* () {
      const ctx = yield* InstanceState.context
      const matches = yield* fs
        .findUp("AGENTS.md", ctx.directory, ctx.worktree)
        .pipe(Effect.catch(() => Effect.succeed([])))
      return matches[0] ?? (yield* projectInstructionFile())
    })

    const projectInstructionAsset = Effect.fn("SettingsHttpApi.projectInstructionAsset")(function* () {
      const file = yield* projectInstructionTarget()
      const exists = yield* fs.existsSafe(file)
      const content = yield* exists
        ? Effect.tryPromise({
            try: () => Bun.file(file).text(),
            catch: (error) => error,
          }).pipe(Effect.catch(() => Effect.succeed("")))
        : Effect.succeed("")
      return {
        name: "AGENTS.md",
        location: file,
        editable: yield* isEditable(file),
        data: {},
        content,
      }
    })

    const saveProjectInstruction = Effect.fn("SettingsHttpApi.projectInstructionSave")(function* (ctx: {
      payload: typeof SettingsProjectInstructionPayload.Type
    }) {
      const file = yield* projectInstructionTarget()
      yield* fs.writeWithDirs(file, ctx.payload.content.trimEnd() + "\n").pipe(Effect.orDie)
      yield* reload()
      return yield* projectInstructionAsset()
    })

    const saveAgent = Effect.fn("SettingsHttpApi.agentSave")(function* (ctx: {
      params: { name: string }
      payload: typeof SettingsAgentPayload.Type
    }) {
      const name = safeEntryName(ctx.params.name)
      if (!name) return yield* new HttpApiError.BadRequest({})
      const existing = (yield* listAgents()).find((item) => item.name === name && item.editable)
      const file = existing?.location ?? path.join(yield* projectDir(), "agent", `${name}.md`)
      const data = { ...ctx.payload.data }
      delete data.name
      yield* fs.writeWithDirs(file, matter.stringify(ctx.payload.content.trimEnd() + "\n", data)).pipe(Effect.orDie)
      yield* reload()
      return (yield* parseAsset(file, name))!
    })

    const deleteAgent = Effect.fn("SettingsHttpApi.agentDelete")(function* (ctx: { params: { name: string } }) {
      const name = safeEntryName(ctx.params.name)
      if (!name) return yield* new HttpApiError.BadRequest({})
      const asset = (yield* listAgents()).find((item) => item.name === name && item.editable)
      if (!asset) return yield* new HttpApiError.NotFound({})
      yield* fs.remove(asset.location).pipe(Effect.orDie)
      yield* reload()
      return true
    })

    const importAgents = Effect.fn("SettingsHttpApi.agentImport")(function* (ctx: {
      payload: typeof SettingsImportPayload.Type
    }) {
      const source = yield* importSource(ctx.payload.source)
      if (!source) return yield* new HttpApiError.BadRequest({})
      const files = yield* markdownFiles(source, "**/*.md")
      const sourceRoot = (yield* fs.isDir(source)) ? source : agentSourceRoot(source)
      const items = (yield* Effect.forEach(
        files,
        Effect.fnUntraced(function* (file) {
          const md = yield* parseMarkdown(file)
          if (!md || (!md.data.name && !md.data.description)) {
            return {
              name: configEntryNameFromPath(file, []),
              location: file,
              status: "skipped" as const,
              reason: "not-agent",
            }
          }

          const name = slug(typeof md.data.name === "string" ? md.data.name : configEntryNameFromPath(file, []))
          const category = importCategory(sourceRoot, file, ".md")
          const target = path.join(yield* globalDir(), "agent", category, `${name}.md`)
          if (!ctx.payload.overwrite && (yield* fs.existsSafe(target))) {
            return {
              name,
              category: category || undefined,
              location: target,
              status: "skipped" as const,
              reason: "exists",
            }
          }

          const data: Record<string, unknown> = {
            ...md.data,
            mode: typeof md.data.mode === "string" ? md.data.mode : "subagent",
            ...(category ? { category } : {}),
            ...(typeof md.data.name === "string" ? { display_name: md.data.name } : {}),
            ...(Object.keys(agentPermissionFromTools(md.data.tools)).length > 0
              ? {
                  permission: {
                    ...(isRecord(md.data.permission) ? md.data.permission : {}),
                    ...agentPermissionFromTools(md.data.tools),
                  },
                }
              : {}),
            ...(isValidColor(md.data.color) ? { color: md.data.color } : { color: undefined }),
          }
          delete data.name
          delete data.model
          delete data.tools
          if (data.temperature === null) delete data.temperature
          if (data.top_p === null) delete data.top_p
          if (data.color === undefined) delete data.color
          yield* fs.writeWithDirs(target, matter.stringify(md.content.trimEnd() + "\n", data)).pipe(Effect.orDie)
          return { name, category: category || undefined, location: target, status: "imported" as const }
        }),
        { concurrency: "unbounded" },
      )) as ImportItem[]
      if (items.some((item) => item.status === "imported")) yield* reload()
      return importResult(items)
    })

    const saveSkill = Effect.fn("SettingsHttpApi.skillSave")(function* (ctx: {
      params: { name: string }
      payload: typeof SettingsSkillPayload.Type
    }) {
      const name = safeName(ctx.params.name)
      if (!name) return yield* new HttpApiError.BadRequest({})
      const existing = (yield* listSkills()).find((item) => item.name === name && item.editable)
      const file = existing?.location ?? path.join(yield* projectDir(), "skills", name, "SKILL.md")
      yield* fs
        .writeWithDirs(
          file,
          matter.stringify(ctx.payload.content.trimEnd() + "\n", {
            name,
            ...(ctx.payload.description ? { description: ctx.payload.description } : {}),
          }),
        )
        .pipe(Effect.orDie)
      yield* reload()
      return (yield* parseAsset(file, name))!
    })

    const deleteSkill = Effect.fn("SettingsHttpApi.skillDelete")(function* (ctx: { params: { name: string } }) {
      const name = safeName(ctx.params.name)
      if (!name) return yield* new HttpApiError.BadRequest({})
      const asset = (yield* listSkills()).find((item) => item.name === name && item.editable)
      if (!asset) return yield* new HttpApiError.NotFound({})
      yield* fs.remove(asset.location).pipe(Effect.orDie)
      yield* reload()
      return true
    })

    const saveRule = Effect.fn("SettingsHttpApi.ruleSave")(function* (ctx: {
      params: { scope: "global" | "project"; name: string }
      payload: typeof SettingsRulePayload.Type
    }) {
      const name = safeName(ctx.params.name)
      if (!name) return yield* new HttpApiError.BadRequest({})
      return yield* saveRuleFile(ctx.params.scope, name, ctx.payload)
    })

    const deleteRule = Effect.fn("SettingsHttpApi.ruleDelete")(function* (ctx: {
      params: { scope: "global" | "project"; name: string }
    }) {
      const name = safeName(ctx.params.name)
      if (!name) return yield* new HttpApiError.BadRequest({})
      if (!(yield* fs.existsSafe(yield* ruleFile(ctx.params.scope, name)))) return yield* new HttpApiError.NotFound({})
      return yield* deleteRuleFile(ctx.params.scope, name)
    })

    const importSkills = Effect.fn("SettingsHttpApi.skillImport")(function* (ctx: {
      payload: typeof SettingsImportPayload.Type
    }) {
      const source = yield* importSource(ctx.payload.source)
      if (!source) return yield* new HttpApiError.BadRequest({})
      const files = yield* markdownFiles(source, "**/SKILL.md")
      const sourceRoot = (yield* fs.isDir(source)) ? source : skillSourceRoot(source)
      const items = (yield* Effect.forEach(
        files,
        Effect.fnUntraced(function* (file) {
          const md = yield* parseMarkdown(file)
          if (!md || typeof md.data.name !== "string") {
            return {
              name: configEntryNameFromPath(path.dirname(file), []),
              location: file,
              status: "skipped" as const,
              reason: "not-skill",
            }
          }

          const name = slug(md.data.name)
          const category = importCategory(sourceRoot, file, "SKILL.md")
          const target = path.join(yield* globalDir(), "skills", category, name, "SKILL.md")
          if (!ctx.payload.overwrite && (yield* fs.existsSafe(target))) {
            return {
              name,
              category: category || undefined,
              location: target,
              status: "skipped" as const,
              reason: "exists",
            }
          }

          yield* fs
            .writeWithDirs(
              target,
              matter.stringify(md.content.trimEnd() + "\n", {
                name,
                ...(typeof md.data.name === "string" && md.data.name !== name ? { display_name: md.data.name } : {}),
                ...(typeof md.data.display_name === "string" ? { display_name: md.data.display_name } : {}),
                ...(typeof md.data.description === "string" ? { description: md.data.description } : {}),
                ...(category ? { category } : {}),
              }),
            )
            .pipe(Effect.orDie)
          return { name, category: category || undefined, location: target, status: "imported" as const }
        }),
        { concurrency: "unbounded" },
      )) as ImportItem[]
      if (items.some((item) => item.status === "imported")) yield* reload()
      return importResult(items)
    })

    return handlers
      .handle("agentList", listAgents)
      .handle("agentSave", saveAgent)
      .handle("agentDelete", deleteAgent)
      .handle("agentImport", importAgents)
      .handle("skillList", listSkills)
      .handle("skillSave", saveSkill)
      .handle("skillDelete", deleteSkill)
      .handle("skillImport", importSkills)
      .handle("ruleList", (ctx: { params: { scope: "global" | "project" } }) => listRules(ctx.params.scope))
      .handle("ruleSave", saveRule)
      .handle("ruleDelete", deleteRule)
      .handle("projectInstructionGet", projectInstructionAsset)
      .handle("projectInstructionSave", saveProjectInstruction)
  }),
)
