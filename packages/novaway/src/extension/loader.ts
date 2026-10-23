import fs from "node:fs/promises"
import path from "node:path"
import { parse as parseJsonc } from "jsonc-parser"
import { Schema } from "effect"
import * as ManifestSchema from "./schema"
import type { Loaded, Manifest } from "./schema"

const MANIFEST_FILES = [".claude-plugin/plugin.json", "plugin.json", "extension.json", "manifest.json"]

async function exists(target: string) {
  try {
    await fs.access(target)
    return true
  } catch {
    return false
  }
}

async function readManifest(root: string): Promise<{ manifest: Manifest; error?: string }> {
  for (const relative of MANIFEST_FILES) {
    const file = path.join(root, relative)
    if (!(await exists(file))) continue
    try {
      const text = await fs.readFile(file, "utf8")
      const raw = parseJsonc(text) as Record<string, unknown>
      return { manifest: Schema.decodeUnknownSync(ManifestSchema.Manifest)(raw) as Manifest }
    } catch (error) {
      return {
        manifest: { name: path.basename(root) },
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }
  return { manifest: { name: path.basename(root) } }
}

async function implicit(root: string) {
  for (const name of ["commands", "agents", "skills", "hooks", "tools"]) {
    if (await exists(path.join(root, name))) return true
  }
  if (await exists(path.join(root, "SKILL.md"))) return true
  return false
}

async function children(root: string) {
  try {
    const entries = await fs.readdir(root, { withFileTypes: true })
    return entries
      .filter((entry) => entry.isDirectory())
      .filter((entry) => !["node_modules", ".git", "dist", "build", ".cache"].includes(entry.name))
      .map((entry) => path.join(root, entry.name))
  } catch {
    return []
  }
}

/**
 * Walk a root and collect extension directories. Marketplaces add an extra
 * `plugins/<name>` level, so we allow up to three levels and stop at the first
 * directory that looks like an extension.
 */
async function discover(root: string, depth = 0): Promise<string[]> {
  if (!(await exists(root))) return []
  if (depth === 0) {
    const nested = await Promise.all((await children(root)).map((child) => discover(child, 1)))
    return nested.flat()
  }
  for (const relative of MANIFEST_FILES) {
    if (await exists(path.join(root, relative))) return [root]
  }
  if (await implicit(root)) return [root]
  if (depth >= 3) return []
  const nested = await Promise.all((await children(root)).map((child) => discover(child, depth + 1)))
  return nested.flat()
}

export type Roots = {
  config: string
  home: string
  directory: string
  worktree: string
}

export function roots(input: Roots) {
  const result: Array<{ root: string; source: Loaded["source"] }> = []
  const add = (root: string, source: Loaded["source"]) => {
    if (!root) return
    if (result.some((item) => item.root === root)) return
    result.push({ root, source })
  }
  add(path.join(input.config, "extensions"), "user")
  add(path.join(input.config, "plugins"), "user")
  // Desktop installs marketplace packages here (zip and git alike). Without
  // this root, marketplace installs are invisible to the core registry.
  add(path.join(input.config, "marketplace"), "plugin")
  add(path.join(input.home, ".novaway", "extensions"), "user")
  add(path.join(input.home, ".claude", "plugins"), "claude")
  add(path.join(input.directory, ".novaway", "extensions"), "project")
  add(path.join(input.directory, ".novaway", "plugins"), "project")
  add(path.join(input.directory, ".claude", "plugins"), "claude")
  if (input.worktree && input.worktree !== input.directory) {
    add(path.join(input.worktree, ".novaway", "extensions"), "project")
    add(path.join(input.worktree, ".claude", "plugins"), "project")
  }
  return result
}

export async function scan(input: Roots & { disabled?: string[] }): Promise<Loaded[]> {
  const disabled = new Set(input.disabled ?? [])
  const seen = new Set<string>()
  const result: Loaded[] = []
  for (const { root, source } of roots(input)) {
    for (const dir of await discover(root)) {
      const key = path.resolve(dir)
      if (seen.has(key)) continue
      seen.add(key)
      const { manifest, error } = await readManifest(dir)
      result.push({
        name: manifest.name || path.basename(dir),
        root: dir,
        source,
        manifest,
        enabled: !disabled.has(manifest.name || path.basename(dir)),
        ...(error ? { error } : {}),
      })
    }
  }
  return result.sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Cached scan.
 *
 * `scan()` is called from the tool registry, skill discovery and the hook
 * service, which all run per instance bootstrap. Walking every marketplace
 * directory three times is measurable on cold start, so cache the result and
 * invalidate it when any root's mtime changes (install/uninstall/update).
 */
type CacheEntry = {
  signature: string
  disabled: string
  at: number
  value: Loaded[]
}

let cache: CacheEntry | undefined
const CACHE_TTL_MS = 5_000

async function rootSignature(input: Roots) {
  const parts = await Promise.all(
    roots(input).map(async ({ root, source }) => {
      const stat = await fs.stat(root).catch(() => undefined)
      return `${source}:${root}:${stat ? Number(stat.mtimeMs) : 0}`
    }),
  )
  return parts.join("|")
}

export async function scanCached(input: Roots & { disabled?: string[] }): Promise<Loaded[]> {
  const disabledKey = [...(input.disabled ?? [])].sort().join(",")
  const signature = `${await rootSignature(input)}#${disabledKey}`
  if (cache && cache.signature === signature && Date.now() - cache.at < CACHE_TTL_MS) return cache.value
  const value = await scan(input)
  cache = { signature, disabled: disabledKey, at: Date.now(), value }
  return value
}

/** Drop the cached scan result (used by reload / tests). */
export function invalidateCache() {
  cache = undefined
}

export function resolve(root: string, relative: string) {
  return path.resolve(root, relative)
}

export * as ExtensionLoader from "./loader"
