import { createHash } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import { Global } from "@novaway/core/global"
import * as Log from "@novaway/core/util/log"
import { run } from "@/util/process"
import { hasGit } from "@/util/git"
import { extractArchive, fetchArchive, probeArchive, type ArchiveProbe } from "./archive"
import * as Generation from "./generation"

const log = Log.create({ service: "extension.marketplace" })

/**
 * Marketplace installs for the core kernel.
 *
 * The desktop app used to own this (Electron main process), which meant Web and
 * TUI builds could browse the store but never install anything. Everything that
 * does not need a browser -- fetching a manifest, verifying a checksum,
 * extracting a zip, shallow-cloning git -- lives here so any frontend can call
 * the same HTTP routes.
 */

/** Metadata written next to an install so we can list/uninstall it later. */
export const RECORD_FILE = ".novaway-install.json"

export const MAX_DOWNLOAD_BYTES = 64 * 1024 * 1024
export const MAX_EXTRACT_FILES = 5_000

/** A superseded install, kept so "upgraded from v1.2" survives a reinstall. */
export type Revision = {
  version?: string
  source: string
  installedAt: number
  files: number
  bytes: number
}

/** Bounded: a long-lived extension should not grow an unbounded record file. */
export const MAX_HISTORY = 5

export type Record = {
  name: string
  kind: "zip" | "git"
  version?: string
  source: string
  ref?: string
  subdir?: string
  sha256?: string
  /** git 通道记录的提交哈希；没有 git 的机器上归档通道拿不到，会为空。 */
  revision?: string
  /** 归档通道记录的 ETag，用来判断远端分支头有没有动。 */
  etag?: string
  installedAt: number
  history?: Revision[]
}

export type Installed = Record & {
  root: string
  files: number
  bytes: number
  /** The install this one replaced, if the package was reinstalled. */
  previous?: Revision
}

/** One zip-packaged marketplace entry. */
export type ZipEntry = {
  name: string
  version?: string
  description?: string
  url: string
  sha256?: string
  keywords?: string[]
}

/** One git-packaged marketplace entry (whole repo or a subdirectory). */
export type GitEntry = {
  name: string
  version?: string
  description?: string
  url: string
  ref?: string
  subdir?: string
}

export function root(config = Global.Path.config) {
  return path.join(config, "marketplace")
}

function safeSegment(value: string) {
  const cleaned = value.replace(/[^A-Za-z0-9._@-]/g, "_").replace(/^\.+/, "_")
  return cleaned.slice(0, 120) || "extension"
}

async function exists(target: string) {
  try {
    await fs.access(target)
    return true
  } catch {
    return false
  }
}

function within(parent: string, child: string) {
  const base = path.resolve(parent)
  const target = path.resolve(child)
  return target === base || target.startsWith(base + path.sep)
}

/** Remove a directory, retrying on Windows where handles linger briefly. */
async function removeDirectory(target: string) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await fs.rm(target, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 })
    if (!(await exists(target))) return true
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
  return !(await exists(target))
}

export async function download(url: string, signal?: AbortSignal): Promise<Buffer> {
  if (!/^https?:\/\//i.test(url)) throw new Error("unsupported download url")
  const response = await fetch(url, { signal, redirect: "follow" })
  if (!response.ok) throw new Error(`download failed: ${response.status} ${response.statusText}`)
  const length = Number(response.headers.get("content-length") ?? 0)
  if (length > MAX_DOWNLOAD_BYTES) throw new Error(`download too large: ${length} bytes`)
  const buffer = Buffer.from(await response.arrayBuffer())
  if (buffer.byteLength > MAX_DOWNLOAD_BYTES) throw new Error(`download too large: ${buffer.byteLength} bytes`)
  return buffer
}

export function digest(data: Buffer) {
  return createHash("sha256").update(data).digest("hex")
}

export function verify(data: Buffer, expected: string | undefined) {
  if (!expected) return
  const actual = digest(data)
  if (actual.toLowerCase() !== expected.trim().toLowerCase()) {
    throw new Error(`checksum mismatch: expected ${expected}, got ${actual}`)
  }
}

/** Fetch a JSON manifest, trying each URL in order and returning the first that parses. */
export async function manifest(urls: readonly string[], signal?: AbortSignal): Promise<unknown> {
  let lastError: unknown
  for (const url of urls) {
    try {
      const response = await fetch(url, { signal, redirect: "follow" })
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
      return JSON.parse(await response.text()) as unknown
    } catch (error) {
      lastError = error
      log.warn("marketplace manifest failed", { url, error: String(error) })
    }
  }
  throw lastError instanceof Error ? lastError : new Error("no marketplace manifest reachable")
}

export type ExtractResult = { files: number; bytes: number }

function rejectUnsafe(name: string) {
  if (name.startsWith("/") || /^[A-Za-z]:/.test(name)) throw new Error(`zip entry has absolute path: ${name}`)
  if (name.split("/").some((segment) => segment === "..")) throw new Error(`zip entry escapes root: ${name}`)
  if (name.includes("\u0000")) throw new Error(`zip entry has a null byte: ${name}`)
}

/**
 * Extract a zip into `target`.
 *
 * Entries are validated before writing: absolute paths, `..` segments and
 * symlinks are rejected, and the total file count is capped. Zip authors are
 * third parties, so treat every entry as hostile input.
 */
export async function extract(buffer: Buffer, target: string): Promise<ExtractResult> {
  const { default: JSZip } = await import("jszip")
  const zip = await JSZip.loadAsync(buffer)
  const entries = Object.values(zip.files)
  if (entries.length > MAX_EXTRACT_FILES) throw new Error(`zip has too many entries: ${entries.length}`)

  let files = 0
  let bytes = 0
  for (const entry of entries) {
    const name = entry.name.replaceAll("\\", "/")
    if (entry.dir) continue
    // JSZip silently normalises `../x` to `x` on load and exposes the authored
    // name separately. Validate both: the authored name catches a hostile
    // archive, the normalised name catches anything JSZip rewrote.
    const original = ((entry as unknown as { unsafeOriginalName?: string }).unsafeOriginalName ?? name).replaceAll(
      "\\",
      "/",
    )
    rejectUnsafe(original)
    rejectUnsafe(name)
    const destination = path.join(target, name)
    if (!within(target, destination)) throw new Error(`zip entry escapes root: ${name}`)
    const content = await entry.async("nodebuffer")
    await fs.mkdir(path.dirname(destination), { recursive: true })
    await fs.writeFile(destination, content)
    files += 1
    bytes += content.byteLength
  }
  return { files, bytes }
}

const PACKAGE_MARKERS = new Set([
  "plugin.json",
  "extension.json",
  "manifest.json",
  "SKILL.md",
  ".claude-plugin",
  ".novaway",
])

/**
 * Marketplace zips usually wrap everything in a single top-level directory.
 * Return that directory so manifests at `<pkg>/plugin.json` are found.
 */
export async function unwrap(target: string) {
  const entries = await fs.readdir(target, { withFileTypes: true }).catch(() => [])
  const visible = entries.filter((entry) => !entry.name.startsWith("."))
  if (visible.length !== 1 || !visible[0]!.isDirectory()) return target
  const nested = path.join(target, visible[0]!.name)
  const files = await fs.readdir(nested).catch(() => [])
  if (!files.some((file) => PACKAGE_MARKERS.has(file))) return target
  for (const file of files) {
    await fs.rename(path.join(nested, file), path.join(target, file))
  }
  await fs.rm(nested, { recursive: true, force: true }).catch(() => {})
  return target
}

/**
 * Snapshot the install we are about to replace.
 *
 * Called before the directory is removed, because after that the size is gone.
 * A reinstall with an identical version still records a revision: what matters
 * for rollback is "what was here before", not semantic versioning.
 */
async function previousRevision(dir: string): Promise<Revision | undefined> {
  const record = await readRecord(dir)
  if (!record) return undefined
  const size = await measure(dir)
  return {
    ...(record.version ? { version: record.version } : {}),
    source: record.source,
    installedAt: record.installedAt,
    ...size,
  }
}

/** Normalise either an `Installed` row or an already-built revision. */
function toRevision(value: Installed | Revision): Revision {
  return {
    ...(value.version ? { version: value.version } : {}),
    source: value.source,
    installedAt: value.installedAt,
    files: "files" in value ? value.files : 0,
    bytes: "bytes" in value ? value.bytes : 0,
  }
}

function withHistory(record: Record, previous: Revision | undefined, base: Revision[] | undefined): Record {
  if (!previous) return { ...record, ...(base?.length ? { history: base } : {}) }
  return { ...record, history: [...(base ?? []), previous].slice(-MAX_HISTORY) }
}

/**
 * Other directories holding an install of the same package.
 *
 * A versioned install lives in `name@version`, so upgrading writes a new
 * directory. Without this, an upgrade would leave the old copy behind and the
 * extension loader would register the same commands twice.
 */
async function sameNameInstalls(config: string, name: string, keep: string): Promise<Installed[]> {
  const all = await list(config)
  return all.filter((item) => item.name === name && path.resolve(item.root) !== path.resolve(keep))
}

async function writeRecord(dir: string, record: Record) {
  await fs.writeFile(path.join(dir, RECORD_FILE), JSON.stringify(record, null, 2))
}

export async function readRecord(dir: string): Promise<Record | undefined> {
  try {
    const raw = JSON.parse(await fs.readFile(path.join(dir, RECORD_FILE), "utf8")) as Record
    if (!raw || typeof raw !== "object" || typeof raw.name !== "string") return undefined
    return raw
  } catch {
    return undefined
  }
}

async function measure(dir: string): Promise<{ files: number; bytes: number }> {
  let files = 0
  let bytes = 0
  const walk = async (current: string) => {
    const entries = await fs.readdir(current, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (entry.name === ".git" || entry.name === "node_modules") continue
      const target = path.join(current, entry.name)
      if (entry.isDirectory()) {
        await walk(target)
        continue
      }
      if (!entry.isFile()) continue
      const stat = await fs.stat(target).catch(() => undefined)
      if (!stat) continue
      files += 1
      bytes += stat.size
    }
  }
  await walk(dir)
  return { files, bytes }
}

export type InstallZipInput = {
  name: string
  version?: string
  url: string
  sha256?: string
  signal?: AbortSignal
  config?: string
}

/** 同一目标目录同时只允许一个安装：后台自动安装和市场按钮可能撞在一起。 */
const installLocks = new Map<string, Promise<unknown>>()

async function withInstallLock<T>(target: string, task: () => Promise<T>): Promise<T> {
  const prior = installLocks.get(target) ?? Promise.resolve()
  const next = prior.catch(() => undefined).then(task)
  installLocks.set(target, next)
  try {
    return await next
  } finally {
    if (installLocks.get(target) === next) installLocks.delete(target)
  }
}

export function installZip(input: InstallZipInput): Promise<Installed> {
  const config = input.config ?? Global.Path.config
  const name = safeSegment(input.name)
  const target = path.join(root(config), input.version ? `${name}@${safeSegment(input.version)}` : name)
  return withInstallLock(target, () => installZipUnlocked(input, target))
}

async function installZipUnlocked(input: InstallZipInput, target: string): Promise<Installed> {
  const config = input.config ?? Global.Path.config
  const name = safeSegment(input.name)

  const buffer = await download(input.url, input.signal)
  verify(buffer, input.sha256)

  const siblings = await sameNameInstalls(config, input.name, target)
  const replaced = (await previousRevision(target)) ?? siblings.toSorted((a, b) => b.installedAt - a.installedAt)[0]
  const carried = (await readRecord(target))?.history ?? siblings.find((item) => item.previous)?.history
  await removeDirectory(target)
  await fs.mkdir(target, { recursive: true })
  try {
    await extract(buffer, target)
    await unwrap(target)
    const record = withHistory(
      {
        name: input.name,
        kind: "zip",
        ...(input.version ? { version: input.version } : {}),
        source: input.url,
        ...(input.sha256 ? { sha256: input.sha256 } : {}),
        installedAt: Date.now(),
      },
      replaced,
      carried,
    )
    await writeRecord(target, record)
    // Retire the version this install replaces, now that the new one is on disk.
    for (const sibling of siblings) await removeDirectory(sibling.root)
    Generation.bump()
    const size = await measure(target)
    log.info("installed zip extension", { name, version: input.version, root: target })
    return { ...record, root: target, ...size, ...(replaced ? { previous: toRevision(replaced) } : {}) }
  } catch (error) {
    await removeDirectory(target)
    throw error
  }
}

export type InstallGitInput = {
  name: string
  url: string
  ref?: string
  subdir?: string
  version?: string
  /** 归档下载通道可校验的摘要（git 通道忽略）。 */
  sha256?: string
  signal?: AbortSignal
  config?: string
  timeout?: number
}

/** 浅克隆：GitHub 在国内经常直连不通，先走镜像再直连。 */
async function cloneRepository(input: InstallGitInput, target: string) {
  const candidates = input.url.startsWith("https://github.com/")
    ? [`https://ghproxy.net/${input.url}`, input.url]
    : [input.url]

  let lastError: unknown
  for (const url of candidates) {
    try {
      const args = ["clone", "--depth", "1"]
      if (input.ref && input.ref !== "HEAD") args.push("--branch", input.ref)
      args.push(url, target)
      const result = await run(["git", ...args], { timeout: input.timeout ?? 240_000, abort: input.signal })
      if (result.code !== 0) throw new Error(result.stderr.toString().trim() || `git clone failed (${result.code})`)
      return
    } catch (error) {
      lastError = error
      await removeDirectory(target)
    }
  }
  throw lastError instanceof Error ? lastError : new Error("git clone failed")
}

/**
 * 没有 git：下载仓库归档并解包（GitHub codeload / Gitee archive）。
 *
 * 指定 `subdir` 时只解出那个子树 —— 否则 ppt-master 这种仓库要落上万文件、
 * 几十 MB，而扩展实际只用 `skills/`。返回值就是扩展根目录。
 */
async function checkoutArchive(input: InstallGitInput, target: string): Promise<{ root: string; etag?: string }> {
  const archive = await fetchArchive(input.url, input.ref, input.signal)
  verify(archive.buffer, input.sha256)
  await extractArchive(archive.buffer, target, input.subdir ? { prefix: input.subdir } : {})
  return { root: target, ...(archive.etag ? { etag: archive.etag } : {}) }
}

/** 本地克隆的 HEAD；目录不是仓库时返回 undefined。 */
async function cloneRevision(target: string): Promise<string | undefined> {
  const result = await run(["git", "-C", target, "rev-parse", "HEAD"], { timeout: 20_000 }).catch(() => undefined)
  if (!result || result.code !== 0) return undefined
  const revision = result.stdout.toString().trim()
  return revision || undefined
}

export function installGit(input: InstallGitInput): Promise<Installed> {
  const config = input.config ?? Global.Path.config
  const name = safeSegment(input.name)
  const ref = (input.ref || "HEAD").replace(/[^A-Za-z0-9._/-]/g, "_")
  const target = path.join(root(config), `${name}@${safeSegment(ref)}`)
  return withInstallLock(target, () => installGitUnlocked(input, target, config))
}

async function installGitUnlocked(input: InstallGitInput, target: string, config: string): Promise<Installed> {
  if (!/^https?:\/\//i.test(input.url) && !/^git@/.test(input.url)) throw new Error("unsupported git url")

  const siblings = await sameNameInstalls(config, input.name, target)
  const replaced = (await previousRevision(target)) ?? siblings.toSorted((a, b) => b.installedAt - a.installedAt)[0]
  const carried = (await readRecord(target))?.history ?? siblings.find((item) => item.previous)?.history
  await removeDirectory(target)
  await fs.mkdir(path.dirname(target), { recursive: true })

  // 有 git 就浅克隆（保留完整仓库语义）；没有就退回托管平台的归档下载。
  // 干净机器上后者是唯一能走通的路，两者装出来的文件树是一样的。
  let installed: string
  let revision: string | undefined
  let etag: string | undefined
  if (await hasGit()) {
    await cloneRepository(input, target)
    installed = input.subdir ? path.join(target, input.subdir) : target
    if (!within(target, installed)) {
      await removeDirectory(target)
      throw new Error(`subdir escapes repository: ${input.subdir}`)
    }
    if (!(await exists(installed))) {
      await removeDirectory(target)
      throw new Error(`subdir not found: ${input.subdir}`)
    }
    revision = await cloneRevision(target)
  } else {
    log.info("git unavailable, installing from repository archive", { name: input.name, url: input.url })
    try {
      // 归档通道直接解出 subdir，所以扩展根目录就是 target。
      const archive = await checkoutArchive(input, target)
      installed = archive.root
      etag = archive.etag
    } catch (error) {
      await removeDirectory(target)
      throw error
    }
  }

  const record: Record = {
    name: input.name,
    kind: "git",
    ...(input.version ? { version: input.version } : {}),
    source: input.url,
    ...(input.ref ? { ref: input.ref } : {}),
    ...(input.subdir ? { subdir: input.subdir } : {}),
    ...(revision ? { revision } : {}),
    ...(etag ? { etag } : {}),
    installedAt: Date.now(),
  }
  const withRev = withHistory(record, replaced, carried)
  await writeRecord(installed, withRev)
  Generation.bump()
  for (const sibling of siblings) await removeDirectory(sibling.root)
  const size = await measure(installed)
  log.info("installed git extension", { name: input.name, ref: input.ref, root: installed })
  return { ...withRev, root: installed, ...size, ...(replaced ? { previous: toRevision(replaced) } : {}) }
}

/**
 * Infer a record from a directory name for installs that predate the record
 * file (the desktop app used to write packages without one). Without this,
 * previously installed packages are invisible to `list()` / `remove()`.
 */
function inferRecord(dir: string): Record | undefined {
  const base = path.basename(dir)
  if (!base || base.startsWith(".")) return undefined
  const at = base.lastIndexOf("@")
  const name = at > 0 ? base.slice(0, at) : base
  const version = at > 0 ? base.slice(at + 1) : undefined
  if (!name) return undefined
  return {
    name,
    kind: "zip",
    ...(version ? { version } : {}),
    source: "legacy",
    installedAt: 0,
  }
}

export async function list(config = Global.Path.config): Promise<Installed[]> {
  const base = root(config)
  const entries = await fs.readdir(base, { withFileTypes: true }).catch(() => [])
  const result: Installed[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const dir = path.join(base, entry.name)
    const record = (await readRecord(dir)) ?? inferRecord(dir)
    if (!record) continue
    const previous = record.history?.at(-1)
    result.push({ ...record, root: dir, ...(await measure(dir)), ...(previous ? { previous } : {}) })
  }
  return result.sort((a, b) => a.name.localeCompare(b.name))
}

export async function remove(nameOrRoot: string, config = Global.Path.config) {
  const base = root(config)
  await fs.mkdir(base, { recursive: true })
  const target = within(base, nameOrRoot) ? path.resolve(nameOrRoot) : path.join(base, safeSegment(nameOrRoot))
  if (target === path.resolve(base) || !within(base, target)) {
    throw new Error("invalid marketplace directory")
  }
  if (!(await exists(target))) return false
  const ok = await removeDirectory(target)
  if (ok) {
    Generation.bump()
    log.info("removed marketplace extension", { root: target })
  }
  return ok
}

/** 一条已安装扩展的「有没有新版本」结论。 */
export type UpdateState = "current" | "outdated" | "unknown"

export type UpdateStatus = {
  name: string
  root: string
  kind: "zip" | "git"
  ref?: string
  state: UpdateState
  /** 本地记录的版本标识（git 是提交哈希，归档是 ETag）。 */
  revision?: string
  /** 远端当前标识。 */
  available?: string
  checkedAt: number
  error?: string
}

/**
 * 远端探测的注入点。
 *
 * 默认实现要联网（git ls-remote / 归档 HEAD）；测试用假的，避免依赖网络。
 */
export type UpdateProbe = {
  localRevision: (dir: string) => Promise<string | undefined>
  remoteRevision: (source: string, ref: string) => Promise<string | undefined>
  archive: (source: string, ref: string | undefined, etag: string) => Promise<ArchiveProbe>
}

function remoteGitSpec(source: string, ref: string) {
  return ["git", "ls-remote", source, ref]
}

function makeProbe(timeoutMs: number): UpdateProbe {
  return {
    localRevision: cloneRevision,
    remoteRevision: async (source, ref) => {
      if (!(await hasGit())) return undefined
      const result = await run(remoteGitSpec(source, ref), { timeout: timeoutMs }).catch(() => undefined)
      if (!result || result.code !== 0) return undefined
      const revision = result.stdout.toString().trim().split(/\s+/, 1)[0]
      return revision || undefined
    },
    archive: (source, ref, etag) => probeArchive(source, ref, etag, undefined, timeoutMs),
  }
}

/**
 * 检查已安装扩展有没有官方更新。
 *
 * 两条通道：
 * - 浅克隆安装（有 `.git`）：`git ls-remote` 比对提交哈希，最准确；
 * - 归档安装（干净机器上没 git）：用安装时记下的 ETag 发条件请求，304 = 没变。
 *   镜像不透传条件请求时返回 `unknown`，不猜。
 *
 * 没有远端标识的老安装（本功能之前装的）返回 `unknown`，重新安装一次就会补上。
 */
export async function updates(
  config = Global.Path.config,
  options: { probe?: UpdateProbe; timeoutMs?: number; installed?: Installed[] } = {},
): Promise<UpdateStatus[]> {
  const probe = options.probe ?? makeProbe(options.timeoutMs ?? 8_000)
  // 调用方通常刚算过 `list()`（要遍历文件统计体积）；复用一次，别重复扫目录。
  const list_ = options.installed ?? (await list(config))
  return Promise.all(
    list_.map(async (item): Promise<UpdateStatus> => {
      const base = {
        name: item.name,
        root: item.root,
        kind: item.kind,
        ...(item.ref ? { ref: item.ref } : {}),
        checkedAt: Date.now(),
      }
      if (item.kind !== "git") return { ...base, state: "unknown" }
      const ref = item.ref ?? "HEAD"
      try {
        if (item.etag) {
          const result = await probe.archive(item.source, ref, item.etag)
          return {
            ...base,
            state: result.state,
            revision: item.etag,
            ...(result.etag ? { available: result.etag } : {}),
          }
        }
        const local = item.revision ?? (await probe.localRevision(item.root))
        if (!local) return { ...base, state: "unknown" }
        const remote = await probe.remoteRevision(item.source, ref)
        if (!remote) return { ...base, state: "unknown", revision: local }
        return {
          ...base,
          state: remote === local ? "current" : "outdated",
          revision: local,
          available: remote,
        }
      } catch (error) {
        return { ...base, state: "unknown", error: String(error).slice(0, 300) }
      }
    }),
  )
}

/**
 * 按安装记录重新装一遍（升级）。
 *
 * 用记录里的 source/ref/subdir/version 重放安装流程，所以不需要调用方知道来源；
 * 装完是同一个目标目录，旧的会被 `sameNameInstalls` 清掉。
 */
export async function reinstall(nameOrRoot: string, config = Global.Path.config): Promise<Installed> {
  const base = root(config)
  const target = within(base, nameOrRoot) ? path.resolve(nameOrRoot) : path.join(base, safeSegment(nameOrRoot))
  const record = await readRecord(target)
  if (!record) throw new Error("找不到这个扩展的安装记录：" + nameOrRoot)
  if (record.kind === "zip") {
    return installZip({
      name: record.name,
      url: record.source,
      config,
      ...(record.version ? { version: record.version } : {}),
      ...(record.sha256 ? { sha256: record.sha256 } : {}),
    })
  }
  return installGit({
    name: record.name,
    url: record.source,
    config,
    ...(record.ref ? { ref: record.ref } : {}),
    ...(record.subdir ? { subdir: record.subdir } : {}),
    ...(record.version ? { version: record.version } : {}),
  })
}

export * as ExtensionMarketplace from "./marketplace"
