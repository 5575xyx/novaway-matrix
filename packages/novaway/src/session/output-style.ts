import path from "node:path"
import { ConfigMarkdown } from "@/config/markdown"
import { AppFileSystem } from "@novaway/core/filesystem"
import { Global } from "@novaway/core/global"
import * as ExtensionLoader from "@/extension/loader"
import { contributions as extensionContributions } from "@/extension/schema"
import { Effect } from "effect"

/**
 * Output styles.
 *
 * A style is a markdown file with frontmatter that changes *how* the agent
 * writes, without changing its tools or permissions:
 *
 * ```md
 * ---
 * name: concise
 * description: Short answers, no preamble
 * keep-coding-instructions: true
 * ---
 * Answer in at most three sentences. Never restate the question.
 * ```
 *
 * Resolution order (first match wins): the agent's explicit `outputStyle`,
 * then project, then user. `keep-coding-instructions: false` drops the
 * built-in coding prompt so the style fully replaces it; the default (absent or
 * `true`) keeps the base prompt and appends the style on top.
 */
export type Style = {
  name: string
  description?: string
  body: string
  keepCodingInstructions: boolean
  /** Absolute path, for "where did this come from" in the UI. */
  file: string
}

export const FRONTMATTER_KEYS = ["name", "description", "keep-coding-instructions"] as const

const DIRS = ["output-styles", "outputStyles"] as const

function dirs(directory: string, worktree: string) {
  const roots = new Set(directory.split(path.sep).length > 0 ? [directory, worktree] : [directory])
  return [
    ...[...roots].flatMap((root) => DIRS.map((dir) => path.join(root, ".novaway", dir))),
    ...[...roots].flatMap((root) => DIRS.map((dir) => path.join(root, ".claude", dir))),
    ...DIRS.map((dir) => path.join(Global.Path.config, dir)),
    ...DIRS.map((dir) => path.join(Global.Path.home, ".claude", dir)),
  ]
}

function parseStyle(file: string, data: Record<string, unknown>, content: string): Style {
  const name = typeof data.name === "string" && data.name.trim() ? data.name.trim() : path.basename(file, ".md")
  const keep = data["keep-coding-instructions"]
  return {
    name,
    ...(typeof data.description === "string" ? { description: data.description } : {}),
    body: content.trim(),
    // Absent means "keep": removing the coding prompt by default would silently
    // degrade every style that forgot the flag.
    keepCodingInstructions: keep === undefined ? true : keep === true || keep === "true",
    file,
  }
}

/** Style directories contributed by installed extensions. */
async function contributed(directory: string, worktree: string): Promise<string[]> {
  const loaded = await ExtensionLoader.scanCached({
    config: Global.Path.config,
    home: Global.Path.home,
    directory,
    worktree,
  })
  const roots: string[] = []
  for (const extension of loaded) {
    if (!extension.enabled) continue
    for (const contribution of extensionContributions(extension)) {
      if (contribution.kind !== "output-style") continue
      roots.push(path.resolve(extension.root, contribution.path))
    }
  }
  return roots
}

/** Every style visible from this project, deduplicated by name (first wins). */
export const list = Effect.fn("OutputStyle.list")(function* (input: { directory: string; worktree: string }) {
  const fs = yield* AppFileSystem.Service
  const found = new Map<string, Style>()
  const fromExtensions = yield* Effect.promise(() =>
    contributed(input.directory, input.worktree).catch(() => [] as string[]),
  )
  const roots = [...dirs(input.directory, input.worktree), ...fromExtensions]
  for (const dir of roots) {
    const files = yield* fs
      .glob("*.md", { cwd: dir, absolute: true, include: "file", dot: true })
      .pipe(Effect.catch(() => Effect.succeed([] as string[])))
    for (const file of files.toSorted()) {
      const parsed = yield* Effect.tryPromise({
        try: () => ConfigMarkdown.parse(file),
        catch: () => undefined,
      }).pipe(Effect.catch(() => Effect.succeed(undefined)))
      if (!parsed) continue
      const style = parseStyle(file, parsed.data as Record<string, unknown>, parsed.content)
      if (!style.body || found.has(style.name)) continue
      found.set(style.name, style)
    }
  }
  return [...found.values()].toSorted((a, b) => a.name.localeCompare(b.name))
})

/** Resolve one style by name; `default` means "no style". */
export const resolve = Effect.fn("OutputStyle.resolve")(function* (input: {
  directory: string
  worktree: string
  name: string | undefined
}) {
  const name = input.name?.trim()
  if (!name || name === "default") return undefined
  const styles = yield* list({ directory: input.directory, worktree: input.worktree })
  return styles.find((style) => style.name === name)
})

export * as OutputStyle from "./output-style"
