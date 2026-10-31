/**
 * 仓库归档下载：没有 git 时的安装通道。
 *
 * 市场里的 git 条目原本一律 `git clone --depth 1`。干净机器（尤其 Windows）
 * 常常没有 git，于是一个只需要几个文件的技能装不上，报错还只是 `spawn ENOENT`。
 * 这里改用托管平台的归档下载（GitHub codeload / Gitee archive），
 * 拿到的是同一个提交树，只是没有 `.git` 目录 —— 对「装扩展」这件事没有差别。
 */
import fs from "node:fs/promises"
import path from "node:path"
import * as Log from "@novaway/core/util/log"
import * as CoreGithub from "@novaway/core/util/github"

const log = Log.create({ service: "extension.archive" })

/** 仓库归档比单包大（带模板素材的仓库动辄几十 MB），单独放宽上限。 */
export const MAX_ARCHIVE_BYTES = 512 * 1024 * 1024

/**
 * GitHub 加速前缀。
 *
 * 国内直连 `codeload.github.com` 经常连不上；这些前缀把 `github.com/...` 的
 * 归档地址代理一遍。顺序：先直连（海外用户最快），再逐个镜像。
 * 配置见 `@novaway/core/util/github`。
 */
export function githubMirrors(): string[] {
  return CoreGithub.githubMirrors()
}

/**
 * 由仓库地址推出归档下载地址。
 *
 * 返回多个候选是因为 `ref` 可能是分支、标签或提交哈希，托管平台的 URL 形态不同；
 * 调用方按顺序尝试，第一个成功的就用。GitHub 的候选后面还会追加镜像前缀版本
 * （见 `mirrored`），保证被墙时也能装上。
 */
export function archiveUrls(url: string, ref?: string): string[] {
  const normalized = url
    .replace(/\.git$/i, "")
    .replace(/\/+$/, "")
    .replace(/^git\+/, "")

  const github = normalized.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)$/i)
  if (github) {
    const owner = github[1]
    const repo = github[2]
    const target = (ref ?? "").trim()
    // 归档后缀：HEAD / 提交哈希 / refs/heads|x、refs/tags|x。
    let suffixes: string[]
    if (!target || target === "HEAD" || target === "main" || target === "master") suffixes = ["HEAD"]
    else if (/^[0-9a-f]{7,40}$/i.test(target)) suffixes = [target]
    else suffixes = ["refs/heads/" + target, "refs/tags/" + target]

    const codeload = (suffix: string) => "https://codeload.github.com/" + owner + "/" + repo + "/zip/" + suffix
    const canonical = (suffix: string) => "https://github.com/" + owner + "/" + repo + "/archive/" + suffix + ".zip"
    const mirrors = (suffix: string) => githubMirrors().map((prefix) => prefix + canonical(suffix))

    // 直连优先（海外用户最快）；被墙时按顺序试镜像。
    return [...suffixes.map(codeload), ...suffixes.map(canonical), ...suffixes.flatMap(mirrors)]
  }

  const gitee = normalized.match(/^https?:\/\/gitee\.com\/([^/]+)\/([^/]+)$/i)
  if (gitee) {
    const segment = !ref || ref === "HEAD" ? "master" : ref
    return ["https://gitee.com/" + gitee[1] + "/" + gitee[2] + "/repository/archive/" + segment + ".zip"]
  }

  return []
}

export type ArchiveFetch = { url: string; buffer: Buffer; etag?: string }

/** 单个候选地址的等待上限：被墙的域名不能让整次安装卡几分钟。 */
export const CANDIDATE_TIMEOUT_MS = 60_000

/** 依次尝试候选地址，返回第一个下载成功的归档。 */
export async function fetchArchive(url: string, ref?: string, signal?: AbortSignal): Promise<ArchiveFetch> {
  const candidates = archiveUrls(url, ref)
  if (candidates.length === 0) {
    throw new Error("这个仓库地址不支持归档下载，且本机没有 git：" + url)
  }
  let lastError: unknown
  for (const candidate of candidates) {
    try {
      // 每个候选单独计时：镜像一个个试过去，总耗时要有上界。
      const timeout = AbortSignal.timeout(CANDIDATE_TIMEOUT_MS)
      const combined = signal ? AbortSignal.any([signal, timeout]) : timeout
      const response = await fetch(candidate, { signal: combined, redirect: "follow" })
      if (!response.ok) throw new Error(candidate + " -> " + response.status + " " + response.statusText)
      const length = Number(response.headers.get("content-length") ?? 0)
      if (length > MAX_ARCHIVE_BYTES) throw new Error("归档过大：" + length + " bytes")
      const buffer = Buffer.from(await response.arrayBuffer())
      if (buffer.byteLength > MAX_ARCHIVE_BYTES) throw new Error("归档过大：" + buffer.byteLength + " bytes")
      const etag = response.headers.get("etag") ?? undefined
      log.info("downloaded repository archive", { url, ref, archive: candidate, bytes: buffer.byteLength })
      return { url: candidate, buffer, ...(etag ? { etag } : {}) }
    } catch (error) {
      lastError = error
      // 用户主动取消不算失败，别继续试镜像。
      if (signal?.aborted) break
      log.warn("repository archive failed", { url, ref, archive: candidate, error: String(error) })
    }
  }
  throw lastError instanceof Error ? lastError : new Error("repository archive unavailable")
}

export type ArchiveProbe = { state: "current" | "outdated" | "unknown"; etag?: string }

/**
 * 检查仓库归档是否有新提交。
 *
 * 托管平台的归档支持 `If-None-Match`：304 说明分支头没动（最省流量的判断方式），
 * 200 且 ETag 不同说明有新提交。镜像不一定透传条件请求，所以「200 但没有 ETag」
 * 一律当「不确定」，不误报有更新。
 */
export async function probeArchive(
  url: string,
  ref: string | undefined,
  etag: string,
  signal?: AbortSignal,
  timeoutMs = CANDIDATE_TIMEOUT_MS,
): Promise<ArchiveProbe> {
  let lastError: unknown
  const candidates = archiveUrls(url, ref)
  // 整个探测共用一份时间预算：被墙时逐个镜像试过去也不能让「打开市场」等太久。
  const perCandidate = Math.max(1_500, Math.floor(timeoutMs / Math.max(candidates.length, 1)))
  for (const candidate of candidates) {
    try {
      const timeout = AbortSignal.timeout(perCandidate)
      const combined = signal ? AbortSignal.any([signal, timeout]) : timeout
      const response = await fetch(candidate, {
        method: "HEAD",
        headers: { "if-none-match": etag },
        signal: combined,
        redirect: "follow",
      })
      if (response.status === 304) return { state: "current", etag }
      if (!response.ok) throw new Error(candidate + " -> " + response.status + " " + response.statusText)
      const next = response.headers.get("etag") ?? undefined
      if (!next) return { state: "unknown" }
      return next === etag ? { state: "current", etag } : { state: "outdated", etag: next }
    } catch (error) {
      if (signal?.aborted) break
      lastError = error
    }
  }
  log.warn("archive probe failed", { url, ref, error: String(lastError) })
  return { state: "unknown" }
}

/**
 * 仓库归档总是一层 `<repo>-<ref>/` 目录，去掉它才能让 `subdir` 对上。
 *
 * 与市场 zip 的 `unwrap` 不同：这里不需要判断「是不是包」，托管平台的打包规则是固定的。
 */
export async function unwrapSingleRoot(target: string) {
  const entries = await fs.readdir(target, { withFileTypes: true }).catch(() => [])
  const visible = entries.filter((entry) => !entry.name.startsWith("."))
  if (visible.length !== 1) return target
  const root = visible[0]
  if (!root || !root.isDirectory()) return target
  const nested = path.join(target, root.name)
  for (const entry of await fs.readdir(nested).catch(() => [])) {
    await fs.rename(path.join(nested, entry), path.join(target, entry))
  }
  await fs.rm(nested, { recursive: true, force: true }).catch(() => {})
  return target
}

/** 归档里的文件数上限：带素材模板的仓库动辄上万文件，比单包宽松得多。 */
export const MAX_ARCHIVE_FILES = 120_000

function rejectUnsafe(name: string) {
  if (name.startsWith("/") || /^[A-Za-z]:/.test(name)) throw new Error(`archive entry has absolute path: ${name}`)
  if (name.split("/").some((segment) => segment === "..")) throw new Error(`archive entry escapes root: ${name}`)
  if (name.includes("\u0000")) throw new Error(`archive entry has a null byte: ${name}`)
}

/**
 * 解包仓库归档。
 *
 * 两点与普通市场 zip 不同：
 * - 归档总有一层 `<repo>-<ref>/`，这里统一剥掉；
 * - 指定 `prefix`（subdir）时只解出那个子树 —— ppt-master 这类仓库整个解包要上万文件、
 *   几十 MB，而我们其实只要 `skills/`。
 */
export async function extractArchive(
  buffer: Buffer,
  target: string,
  options: { prefix?: string; maxFiles?: number } = {},
): Promise<{ files: number; bytes: number }> {
  const { default: JSZip } = await import("jszip")
  const zip = await JSZip.loadAsync(buffer)
  const entries = Object.values(zip.files).filter((entry) => !entry.dir)
  if (entries.length > (options.maxFiles ?? MAX_ARCHIVE_FILES)) {
    throw new Error("archive has too many entries: " + entries.length)
  }

  const names = entries.map((entry) => entry.name.replaceAll("\\", "/"))
  const first = names[0]?.split("/")[0]
  const sharedRoot = first && names.every((name) => name === first || name.startsWith(first + "/")) ? first : undefined

  let prefix: string | undefined
  if (options.prefix) {
    const sub = options.prefix.replace(/^\.?\//, "").replace(/\/+$/, "")
    prefix = sub ? (sharedRoot ? sharedRoot + "/" + sub + "/" : sub + "/") : undefined
  }

  const base = path.resolve(target)
  let files = 0
  let bytes = 0
  for (const entry of entries) {
    const name = entry.name.replaceAll("\\", "/")
    rejectUnsafe(name)
    let relative = sharedRoot ? name.slice(sharedRoot.length + 1) : name
    if (prefix) {
      if (!name.startsWith(prefix)) continue
      relative = name.slice(prefix.length)
    }
    if (!relative) continue
    const destination = path.resolve(target, relative)
    if (destination !== base && !destination.startsWith(base + path.sep)) {
      throw new Error("archive entry escapes root: " + name)
    }
    const content = await entry.async("nodebuffer")
    await fs.mkdir(path.dirname(destination), { recursive: true })
    await fs.writeFile(destination, content)
    files += 1
    bytes += content.byteLength
  }
  if (files === 0) throw new Error("archive has no files" + (options.prefix ? " under " + options.prefix : ""))
  return { files, bytes }
}
