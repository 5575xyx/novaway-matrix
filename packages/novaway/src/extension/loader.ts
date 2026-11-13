import fs from "node:fs/promises"
import { existsSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { parse as parseJsonc, printParseErrorCode } from "jsonc-parser"
import type { ParseError } from "jsonc-parser"
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

/**
 * 原始 manifest JSON，不做任何 Schema 解码。
 *
 * `readManifest()` 走的是旧 Schema，未声明的字段会被丢掉；而 §13.1 的归一化要把旧字段
 * 原样带进 `manifest.legacy.raw` 才能跑 shadow 对比，所以 host 只能读这一条。
 */
export async function readRawManifest(
  root: string,
): Promise<
  | { file: string; raw?: unknown; error?: string; fingerprint?: { mtimeMs: number; ctimeMs: number; size: number } }
  | undefined
> {
  for (const relative of MANIFEST_FILES) {
    const file = path.join(root, relative)
    if (!(await exists(file))) continue
    try {
      // jsonc-parser 语法错误时不抛异常，只往 errors 里塞：坏文件照样返回结果（常常是 {}），
      // 调用方要能分辨「空清单」和「读坏了」，所以这里把 errors 转成 error。
      const before = await fs.stat(file)
      const bytes = await fs.readFile(file)
      const after = await fs.stat(file)
      const fingerprint = { mtimeMs: before.mtimeMs, ctimeMs: before.ctimeMs, size: before.size }
      const stable =
        before.mtimeMs === after.mtimeMs &&
        before.ctimeMs === after.ctimeMs &&
        before.size === after.size &&
        after.size === bytes.byteLength
      const text = bytes.toString("utf8")
      const errors: ParseError[] = []
      const raw = parseJsonc(text, errors)
      const first = errors[0]
      if (first !== undefined) {
        return {
          file,
          raw,
          ...(stable ? { fingerprint } : {}),
          error: `JSON 语法错误 ${errors.length} 处，首个在第 ${first.offset} 字符（${printParseErrorCode(first.error)}）`,
        }
      }
      return { file, raw, ...(stable ? { fingerprint } : {}) }
    } catch (error) {
      return { file, error: error instanceof Error ? error.message : String(error) }
    }
  }
  return undefined
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
 *
 * Exported for `plugin/host.ts`: it needs the directories plus the raw manifest,
 * which `scan()` collapses into a decoded `Loaded` and cannot hand back.
 */
export async function discover(root: string, depth = 0): Promise<string[]> {
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
  /** Test/release override; an empty string intentionally disables the package root. */
  builtin?: string
}

export function builtinRoot(executablePath = process.execPath) {
  // Compiled single-file releases keep builtin manifests/entries beside the
  // platform binary. Source/dev runs retain the package-relative lookup below.
  // Never infer builtin trust from a project/config directory.
  if (process.env.NOVAWAY_BUILTIN_PLUGINS !== undefined) return process.env.NOVAWAY_BUILTIN_PLUGINS
  const releaseSidecar = path.resolve(path.dirname(executablePath), "../builtin-plugins")
  if (existsSync(releaseSidecar)) return releaseSidecar
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../builtin-plugins")
}

export function roots(input: Roots) {
  const result: Array<{ root: string; source: Loaded["source"] }> = []
  const add = (root: string, source: Loaded["source"]) => {
    if (!root) return
    if (result.some((item) => item.root === root)) return
    result.push({ root, source })
  }
  add(input.builtin ?? builtinRoot(), "builtin")
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
