import path from "path"
import { fileURLToPath, pathToFileURL } from "url"
import npa from "npm-package-arg"
import semver from "semver"
import { Filesystem } from "@/util/filesystem"
import { Process } from "@/util/process"
import { isRecord } from "@/util/record"
import { Npm } from "@novaway/core/npm"
import { InstallationVersion } from "@novaway/core/installation/version"

// Old npm package names for plugins that are now built-in
export const DEPRECATED_PLUGIN_PACKAGES = ["opencode-openai-codex-auth", "opencode-copilot-auth"]

export function isDeprecatedPlugin(spec: string) {
  return DEPRECATED_PLUGIN_PACKAGES.some((pkg) => spec.includes(pkg))
}

function parse(spec: string) {
  try {
    return npa(spec)
  } catch {}
}

export function parsePluginSpecifier(spec: string) {
  const hit = parse(spec)
  if (hit?.type === "alias" && !hit.name) {
    const sub = (hit as npa.AliasResult).subSpec
    if (sub?.name) {
      const version = !sub.rawSpec || sub.rawSpec === "*" ? "latest" : sub.rawSpec
      return { pkg: sub.name, version }
    }
  }
  if (!hit?.name) return { pkg: spec, version: "" }
  if (hit.raw === hit.name) return { pkg: hit.name, version: "latest" }
  return { pkg: hit.name, version: hit.rawSpec }
}

export type PluginSource = "file" | "npm"
export type PluginKind = "server" | "tui"
type PluginMode = "strict" | "detect"

export type PluginPackage = {
  dir: string
  pkg: string
  json: Record<string, unknown>
}

export type PluginEntry = {
  spec: string
  source: PluginSource
  target: string
  pkg?: PluginPackage
  entry?: string
}

const INDEX_FILES = ["index.ts", "index.tsx", "index.js", "index.mjs", "index.cjs"]

export function pluginSource(spec: string): PluginSource {
  if (isPathPluginSpec(spec)) return "file"
  return "npm"
}

export function isGitPluginSpec(spec: string) {
  const hit = parse(spec)
  if (hit?.type !== "git") return false
  const values = [hit.gitRange, hit.rawSpec, hit.fetchSpec].filter(
    (value): value is string => typeof value === "string",
  )
  return !values.some((value) => /^(?:git\+)?file:/i.test(value))
}

function resolveExportPath(raw: string, dir: string) {
  if (raw.startsWith("file://")) return fileURLToPath(raw)
  if (path.isAbsolute(raw)) return raw
  return path.resolve(dir, raw)
}

function isAbsolutePath(raw: string) {
  return path.isAbsolute(raw) || /^[A-Za-z]:[\\/]/.test(raw)
}

function extractExportValue(value: unknown): string | undefined {
  if (typeof value === "string") return value
  if (!isRecord(value)) return undefined
  for (const key of ["import", "default"]) {
    const nested = value[key]
    if (typeof nested === "string") return nested
  }
  return undefined
}

function packageMain(pkg: PluginPackage) {
  const value = pkg.json.main
  if (typeof value !== "string") return
  const next = value.trim()
  if (!next) return
  return next
}

function resolvePackageFile(spec: string, raw: string, kind: string, pkg: PluginPackage) {
  const resolved = resolveExportPath(raw, pkg.dir)
  const root = Filesystem.resolve(pkg.dir)
  const next = Filesystem.resolve(resolved)
  if (!Filesystem.contains(root, next)) {
    throw new Error(`Plugin ${spec} resolved ${kind} entry outside plugin directory`)
  }
  return next
}

function resolvePackagePath(spec: string, raw: string, kind: PluginKind, pkg: PluginPackage) {
  return pathToFileURL(resolvePackageFile(spec, raw, kind, pkg)).href
}

function resolvePackageEntrypoint(spec: string, kind: PluginKind, pkg: PluginPackage) {
  const exports = pkg.json.exports
  if (isRecord(exports)) {
    const raw = extractExportValue(exports[`./${kind}`])
    if (raw) return resolvePackagePath(spec, raw, kind, pkg)
  }

  if (kind !== "server") return
  const main = packageMain(pkg)
  if (!main) return
  return resolvePackagePath(spec, main, kind, pkg)
}

function targetPath(target: string) {
  if (target.startsWith("file://")) return fileURLToPath(target)
  if (path.isAbsolute(target)) return target
}

async function resolveDirectoryIndex(dir: string) {
  for (const name of INDEX_FILES) {
    const file = path.join(dir, name)
    if (await Filesystem.exists(file)) return file
  }
}

async function resolveTargetDirectory(target: string) {
  const file = targetPath(target)
  if (!file) return
  const stat = await Filesystem.statAsync(file)
  if (!stat?.isDirectory()) return
  return file
}

async function resolvePluginEntrypoint(spec: string, target: string, kind: PluginKind, pkg?: PluginPackage) {
  const source = pluginSource(spec)
  const hit =
    pkg ?? (source === "npm" ? await readPluginPackage(target) : await readPluginPackage(target).catch(() => undefined))
  if (!hit) return target

  const entry = resolvePackageEntrypoint(spec, kind, hit)
  if (entry) return entry

  const dir = await resolveTargetDirectory(target)

  if (kind === "tui") {
    if (source === "file" && dir) {
      const index = await resolveDirectoryIndex(dir)
      if (index) return pathToFileURL(index).href
    }

    if (source === "npm") return
    if (dir) return

    return target
  }

  if (dir && isRecord(hit.json.exports)) {
    if (source === "file") {
      const index = await resolveDirectoryIndex(dir)
      if (index) return pathToFileURL(index).href
    }

    return
  }

  return target
}

export function isPathPluginSpec(spec: string) {
  return spec.startsWith("file://") || spec.startsWith(".") || isAbsolutePath(spec)
}

export async function resolvePathPluginTarget(spec: string) {
  const raw = spec.startsWith("file://") ? fileURLToPath(spec) : spec
  const file = path.isAbsolute(raw) || /^[A-Za-z]:[\\/]/.test(raw) ? raw : path.resolve(raw)
  const stat = await Filesystem.statAsync(file)
  if (!stat?.isDirectory()) {
    if (spec.startsWith("file://")) return spec
    return pathToFileURL(file).href
  }

  if (await Filesystem.exists(path.join(file, "package.json"))) {
    return pathToFileURL(file).href
  }

  const index = await resolveDirectoryIndex(file)
  if (index) return pathToFileURL(index).href

  throw new Error(`Plugin directory ${file} is missing package.json or index file`)
}

export async function checkPluginCompatibility(target: string, NovaWayVersion: string, pkg?: PluginPackage) {
  if (!semver.valid(NovaWayVersion) || semver.major(NovaWayVersion) === 0) return
  const hit = pkg ?? (await readPluginPackage(target).catch(() => undefined))
  if (!hit) return
  const engines = hit.json.engines
  if (!isRecord(engines)) return
  const range = engines.NovaWay
  if (typeof range !== "string") return
  if (!semver.satisfies(NovaWayVersion, range)) {
    throw new Error(`Plugin requires NovaWay ${range} but running ${NovaWayVersion}`)
  }
}

// Plugin sources we want to fall back to when the primary git URL is unreachable.
// Keys are the bare plugin name (matches npa.name from DEFAULT_GLOBAL_PLUGINS).
// Order matters: each URL is tried until one succeeds.
export const PLUGIN_FALLBACK_URLS: Record<string, string[]> = {
  PowersNexus: ["git+https://gitee.com/nova-way/powersnexus.git"],
}

function extractPluginName(spec: string): string | undefined {
  const hit = parse(spec)
  return hit?.name ?? undefined
}

function extractGitHost(spec: string): string | undefined {
  const hit = parse(spec)
  if (hit?.type !== "git") return
  const url = typeof hit.gitRange === "string" ? hit.gitRange : hit.rawSpec
  if (typeof url !== "string") return
  try {
    return new URL(url).host
  } catch {
    return
  }
}

function buildFallbackSpec(spec: string, fallbackUrl: string): string {
  const name = extractPluginName(spec) ?? spec
  const ref = parse(spec)?.gitCommittish
  return `${name}@${fallbackUrl}${ref ? `#${ref}` : ""}`
}

function gitRemote(spec: string) {
  const hit = parse(spec)
  if (hit?.type !== "git" || !hit.fetchSpec) return
  return {
    url: hit.fetchSpec,
    ref: hit.gitCommittish ?? "HEAD",
  }
}

const gitRefreshes = new Map<string, Promise<GitRefreshResult>>()

export type GitRefreshResult =
  | { state: "unchanged"; revision: string }
  | { state: "updated"; revision: string; directory: string }
  | { state: "offline" | "failed"; error: unknown }

const gitRefreshManager = new Map<string, Promise<GitRefreshResult>>()

export function startGitPluginRefresh(
  specs: Iterable<string>,
  options: {
    timeoutMs?: number
    kind?: PluginKind
    onResult?: (spec: string, result: GitRefreshResult) => void
  } = {},
) {
  const tasks: Promise<GitRefreshResult>[] = []
  for (const spec of new Set(specs)) {
    if (!isGitPluginSpec(spec)) continue
    const task = gitRefreshManager.get(spec) ?? refreshGitPlugin(spec, options)
    gitRefreshManager.set(spec, task)
    tasks.push(task)
    void task.then(
      (result) => options.onResult?.(spec, result),
      () => {},
    )
  }
  return tasks
}

export async function waitForGitPluginRefresh(timeoutMs = 5000) {
  const tasks = [...gitRefreshManager.values()]
  if (!tasks.length) return
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, timeoutMs)
    void Promise.allSettled(tasks).then(() => {
      clearTimeout(timer)
      resolve()
    })
  })
}
async function localGitRevision(directory: string, timeout: number) {
  const result = await Process.text(["git", "-C", directory, "rev-parse", "HEAD"], {
    timeout,
    nothrow: true,
  })
  if (result.code === 0) {
    const revision = result.text.trim()
    if (revision) return revision
  }

  let current = directory
  for (let i = 0; i < 5; i++) {
    const lockFile = path.join(current, "package-lock.json")
    const lock = await Filesystem.readJson<{ packages?: Record<string, { resolved?: string; version?: string }> }>(lockFile).catch(
      () => undefined,
    )
    if (lock?.packages) {
      const relative = path.relative(current, directory).split(path.sep).join("/")
      const item = lock.packages[relative]
      const source = `${item?.resolved ?? ""} ${item?.version ?? ""}`
      const revision = source.match(/#([0-9a-f]{7,40})(?:$|[?#])/i)?.[1]
      if (revision) return revision
    }
    const parent = path.dirname(current)
    if (parent === current) break
    current = parent
  }
}

async function remoteGitRevision(spec: string, timeout: number) {
  const remote = gitRemote(spec)
  if (!remote) throw new Error(`Plugin ${spec} is not a remote Git plugin`)
  const result = await Process.text(["git", "ls-remote", remote.url, remote.ref], {
    timeout,
    nothrow: true,
  })
  if (result.code !== 0) {
    throw new Process.RunFailedError(
      ["git", "ls-remote", remote.url, remote.ref],
      result.code,
      result.stdout,
      result.stderr,
    )
  }
  const revision = result.text.trim().split(/\s+/, 1)[0]
  if (!revision) throw new Error(`Git remote ${remote.url} returned no revision for ${remote.ref}`)
  return revision
}

export function gitPluginRemote(spec: string) {
  return gitRemote(spec)
}

async function resolveGitTarget(spec: string) {
  try {
    const result = await Npm.add(spec)
    return { spec, directory: result.directory }
  } catch (primaryError) {
    const name = extractPluginName(spec)
    const failedHost = extractGitHost(spec)
    for (const url of name ? PLUGIN_FALLBACK_URLS[name] ?? [] : []) {
      if (failedHost) {
        try {
          if (new URL(url).host === failedHost) continue
        } catch {}
      }
      const candidate = buildFallbackSpec(spec, url)
      try {
        const result = await Npm.add(candidate)
        return { spec: candidate, directory: result.directory }
      } catch {}
    }
    throw primaryError
  }
}

async function validateGitPluginTarget(spec: string, target: string, kind: PluginKind) {
  const pkg = await readPluginPackage(target)
  const entry = resolvePackageEntrypoint(spec, kind, pkg)
  if (!entry) throw new Error(`Plugin ${spec} does not expose a ${kind} entrypoint`)
  await checkPluginCompatibility(target, InstallationVersion, pkg)
  const mod = await import(entry)
  if (!isRecord(mod)) throw new TypeError(`Plugin ${spec} module is empty`)
  if (readV1Plugin(mod, spec, kind, "detect")) return
  const valid = Object.values(mod).some((value) => {
    if (typeof value === "function") return true
    return isRecord(value) && typeof value[kind] === "function"
  })
  if (!valid) throw new TypeError(`Plugin ${spec} has no valid ${kind} export`)
}

export async function refreshGitPlugin(
  spec: string,
  options: { timeoutMs?: number; kind?: PluginKind } = {},
): Promise<GitRefreshResult> {
  if (!isGitPluginSpec(spec)) return { state: "failed", error: new Error(`Plugin ${spec} is not a remote Git plugin`) }
  const key = spec
  const existing = gitRefreshes.get(key)
  if (existing) return existing

  const task = (async (): Promise<GitRefreshResult> => {
    const timeout = options.timeoutMs ?? 8000
    try {
      const current = await resolveGitTarget(spec)
      const local = await localGitRevision(current.directory, timeout)
      const remote = await remoteGitRevision(current.spec, timeout)
      if (local && local === remote) return { state: "unchanged", revision: remote }
      const updated = await Npm.add(current.spec, { update: true })
      if (options.kind) await validateGitPluginTarget(current.spec, updated.directory, options.kind)
      return { state: "updated", revision: remote, directory: updated.directory }
    } catch (error) {
      return { state: "offline", error }
    }
  })()
  gitRefreshes.set(key, task)
  try {
    return await task
  } finally {
    if (gitRefreshes.get(key) === task) gitRefreshes.delete(key)
  }
}

export async function resolvePluginTarget(spec: string) {
  if (isPathPluginSpec(spec)) return resolvePathPluginTarget(spec)
  const primary = parse(spec)
  const pkg = primary?.name && primary.raw === primary.name ? `${primary.name}@latest` : spec

  try {
    const result = await Npm.add(pkg)
    return result.directory
  } catch (primaryError) {
    const name = extractPluginName(spec)
    const fallbacks = name ? PLUGIN_FALLBACK_URLS[name] : undefined

    // Skip fallbacks that point to the same host we already failed on (likely same network failure).
    const failedHost = extractGitHost(spec)

    for (const url of fallbacks ?? []) {
      if (failedHost) {
        try {
          if (new URL(url).host === failedHost) continue
        } catch {
          // ignore unparseable fallback URLs
        }
      }
      try {
        const candidate = buildFallbackSpec(spec, url)
        const result = await Npm.add(candidate)
        return result.directory
      } catch {
        // try next fallback
      }
    }

    throw primaryError
  }
}

export async function readPluginPackage(target: string): Promise<PluginPackage> {
  const file = target.startsWith("file://") ? fileURLToPath(target) : target
  const stat = await Filesystem.statAsync(file)
  const dir = stat?.isDirectory() ? file : path.dirname(file)
  const pkg = path.join(dir, "package.json")
  const json = await Filesystem.readJson<Record<string, unknown>>(pkg)
  return { dir, pkg, json }
}

export async function createPluginEntry(spec: string, target: string, kind: PluginKind): Promise<PluginEntry> {
  const source = pluginSource(spec)
  const pkg =
    source === "npm" ? await readPluginPackage(target) : await readPluginPackage(target).catch(() => undefined)
  const entry = await resolvePluginEntrypoint(spec, target, kind, pkg)
  return {
    spec,
    source,
    target,
    pkg,
    entry,
  }
}

export function readPackageThemes(spec: string, pkg: PluginPackage) {
  const field = pkg.json["oc-themes"]
  if (field === undefined) return []
  if (!Array.isArray(field)) {
    throw new TypeError(`Plugin ${spec} has invalid oc-themes field`)
  }

  const list = field.map((item) => {
    if (typeof item !== "string") {
      throw new TypeError(`Plugin ${spec} has invalid oc-themes entry`)
    }

    const raw = item.trim()
    if (!raw) {
      throw new TypeError(`Plugin ${spec} has empty oc-themes entry`)
    }
    if (raw.startsWith("file://") || isAbsolutePath(raw)) {
      throw new TypeError(`Plugin ${spec} oc-themes entry must be relative: ${item}`)
    }

    return resolvePackageFile(spec, raw, "oc-themes", pkg)
  })

  return Array.from(new Set(list))
}

export function readPluginId(id: unknown, spec: string) {
  if (id === undefined) return
  if (typeof id !== "string") throw new TypeError(`Plugin ${spec} has invalid id type ${typeof id}`)
  const value = id.trim()
  if (!value) throw new TypeError(`Plugin ${spec} has an empty id`)
  return value
}

export function readV1Plugin(
  mod: Record<string, unknown>,
  spec: string,
  kind: PluginKind,
  mode: PluginMode = "strict",
) {
  const value = mod.default
  if (!isRecord(value)) {
    if (mode === "detect") return
    throw new TypeError(`Plugin ${spec} must default export an object with ${kind}()`)
  }
  if (mode === "detect" && !("id" in value) && !("server" in value) && !("tui" in value)) return

  const server = "server" in value ? value.server : undefined
  const tui = "tui" in value ? value.tui : undefined
  if (server !== undefined && typeof server !== "function") {
    throw new TypeError(`Plugin ${spec} has invalid server export`)
  }
  if (tui !== undefined && typeof tui !== "function") {
    throw new TypeError(`Plugin ${spec} has invalid tui export`)
  }
  if (server !== undefined && tui !== undefined) {
    throw new TypeError(`Plugin ${spec} must default export either server() or tui(), not both`)
  }
  if (kind === "server" && server === undefined) {
    throw new TypeError(`Plugin ${spec} must default export an object with server()`)
  }
  if (kind === "tui" && tui === undefined) {
    throw new TypeError(`Plugin ${spec} must default export an object with tui()`)
  }

  return value
}

export async function resolvePluginId(
  source: PluginSource,
  spec: string,
  target: string,
  id: string | undefined,
  pkg?: PluginPackage,
) {
  if (source === "file") {
    if (id) return id
    throw new TypeError(`Path plugin ${spec} must export id`)
  }
  if (id) return id
  const hit = pkg ?? (await readPluginPackage(target))
  if (typeof hit.json.name !== "string" || !hit.json.name.trim()) {
    throw new TypeError(`Plugin package ${hit.pkg} is missing name`)
  }
  return hit.json.name.trim()
}
