import type { GitEntry, ZipEntry } from "./marketplace"

/** NovaWay 官方 catalog 中归一化后的条目。 */
export type NovaWayEntry = {
  packageId: string
  sourceId?: string
  name: string
  displayName?: string
  displayNameI18n?: Record<string, string>
  icon?: string
  screenshots?: string[]
  version: string
  description?: string
  longDescription?: string
  author?: string
  license?: string
  url: string
  sha256: string
  kind: "zip" | "git"
  ref?: string
  subdir?: string
  keywords?: string[]
  categories?: string[]
  repository?: string
  runtimeTargets: string[]
  capabilities: string[]
  marketTypes?: string[]
  permissions?: string[]
  dependencies?: Record<string, string>
  conflicts?: string[]
  releaseNotes?: string
  compatibility?: {
    minNovaWayApi?: string
    maxNovaWayApi?: string
    manifestVersion?: number
    requiresRestart?: boolean
  }
}

export const NOVAWAY_MARKETPLACE_REPOSITORY = "https://gitee.com/NovaWay-AI/novaway-plugins"
export const NOVAWAY_MARKETPLACE_URLS = [
  "https://gitee.com/NovaWay-AI/novaway-plugins/raw/main/catalog/index.json",
] as const

/**
 * NovaWay 官方目录只接受 HTTPS artifact 和完整 SHA-256。
 * 目录是远端不可信输入，不能因为字段看起来像合法条目就放宽校验。
 */
function officialEntries(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  if (typeof value !== "object" || value === null) return []
  const entries = (value as { entries?: unknown }).entries
  return Array.isArray(entries) ? entries : []
}

/**
 * 将 NovaWay 原生目录映射为旧 Extension 安装器可消费的形状，同时保留
 * runtime、capability 和权限信息，供后续统一市场 DTO 迁移使用。
 */
export function parseNovaWay(value: unknown): NovaWayEntry[] {
  const result: NovaWayEntry[] = []
  const seen = new Set<string>()
  for (const item of officialEntries(value)) {
    if (typeof item !== "object" || item === null) continue
    const raw = item as Record<string, unknown>
    const packageId = text(raw.packageId)
    const name = text(raw.name) ?? packageId
    const version = text(raw.version)
    const runtimeTargets = strings(raw.runtimeTargets)
    const capabilities = strings(raw.capabilities)
    if (!packageId || !name || !version || runtimeTargets.length === 0 || capabilities.length === 0) continue
    if (!/^[a-z0-9]+([.-][a-z0-9]+)*$/.test(packageId)) continue
    const artifacts = Array.isArray(raw.artifacts) ? raw.artifacts : []
    const artifact = artifacts.find((candidate) => {
      if (typeof candidate !== "object" || candidate === null) return false
      const entry = candidate as Record<string, unknown>
      return (
        (entry.type === "github-release" || entry.type === "archive" || entry.type === "git") &&
        typeof entry.url === "string" &&
        /^https:\/\//i.test(entry.url) &&
        typeof entry.sha256 === "string" &&
        /^[a-f0-9]{64}$/i.test(entry.sha256)
      )
    }) as Record<string, unknown> | undefined
    if (!artifact) continue
    const identity = `${packageId}@${version}`
    if (seen.has(identity)) continue
    seen.add(identity)
    const keywords = uniqueStrings([...(strings(raw.categories) ?? []), ...(strings(raw.tags) ?? [])])
    const compatibility = record(raw.compatibility)
    result.push({
      packageId,
      name,
      ...(text(raw.displayName) ? { displayName: text(raw.displayName) } : {}),
      ...(stringRecord(raw.displayNameI18n) ? { displayNameI18n: stringRecord(raw.displayNameI18n) } : {}),
      ...(remoteAsset(raw.icon) ? { icon: remoteAsset(raw.icon) } : {}),
      ...(remoteAssets(raw.screenshots).length > 0 ? { screenshots: remoteAssets(raw.screenshots) } : {}),
      version,
      url: artifact.url as string,
      sha256: (artifact.sha256 as string).toLowerCase(),
      kind: artifact.type === "git" ? "git" : "zip",
      ...(text(raw.description) ? { description: text(raw.description) } : {}),
      ...(text(raw.longDescription) ? { longDescription: text(raw.longDescription) } : {}),
      ...(text(raw.author) ? { author: text(raw.author) } : {}),
      ...(text(raw.license) ? { license: text(raw.license) } : {}),
      ...(text(artifact.ref) ? { ref: text(artifact.ref) } : {}),
      ...(text(artifact.subdir) ? { subdir: text(artifact.subdir) } : {}),
      ...(keywords.length > 0 ? { keywords } : {}),
      ...(strings(raw.categories).length > 0 ? { categories: uniqueStrings(strings(raw.categories)) } : {}),
      ...(text(raw.repository) ? { repository: text(raw.repository) } : {}),
      runtimeTargets,
      capabilities,
      ...(strings(raw.marketTypes).length > 0 ? { marketTypes: uniqueStrings(strings(raw.marketTypes)) } : {}),
      ...(strings(raw.permissions).length > 0 ? { permissions: strings(raw.permissions) } : {}),
      ...(stringRecord(raw.dependencies) ? { dependencies: stringRecord(raw.dependencies) } : {}),
      ...(strings(raw.conflicts).length > 0 ? { conflicts: strings(raw.conflicts) } : {}),
      ...(text(raw.releaseNotes) ? { releaseNotes: text(raw.releaseNotes) } : {}),
      ...(compatibility
        ? {
            compatibility: {
              ...(text(compatibility.minNovaWayApi) ? { minNovaWayApi: text(compatibility.minNovaWayApi) } : {}),
              ...(text(compatibility.maxNovaWayApi) ? { maxNovaWayApi: text(compatibility.maxNovaWayApi) } : {}),
              ...(typeof compatibility.manifestVersion === "number"
                ? { manifestVersion: compatibility.manifestVersion }
                : {}),
              ...(typeof compatibility.requiresRestart === "boolean"
                ? { requiresRestart: compatibility.requiresRestart }
                : {}),
            },
          }
        : {}),
    })
  }
  return result
}

function strings(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .map((item) => item.trim())
}

function stringRecord(value: unknown): Record<string, string> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined
  const result: Record<string, string> = {}
  for (const [key, item] of Object.entries(value)) {
    if (typeof item !== "string" || item.trim() === "") return undefined
    result[key] = item.trim()
  }
  return result
}

function uniqueStrings(value: string[]) {
  return [...new Set(value)]
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined
}

/**
 * Marketplace catalogs.
 *
 * Two sources are supported:
 * - ZCode: zip packages with a sha256 per entry.
 * - Claude: git repositories (whole repo or a subdirectory).
 *
 * Parsing is defensive: these are third-party documents and a malformed entry
 * must never break the whole catalog.
 */

export const ZCODE_MARKETPLACE_URLS = ["https://cdn-zcode.z.ai/zcode/official-plugin/marketplace.json"] as const

export const CLAUDE_MARKETPLACE_URLS = [
  "https://cdn.jsdelivr.net/gh/anthropics/claude-plugins-official@main/.claude-plugin/marketplace.json",
  "https://ghproxy.net/https://raw.githubusercontent.com/anthropics/claude-plugins-official/main/.claude-plugin/marketplace.json",
  "https://raw.githubusercontent.com/anthropics/claude-plugins-official/main/.claude-plugin/marketplace.json",
] as const

export const CLAUDE_MARKETPLACE_REPO = "https://github.com/anthropics/claude-plugins-official.git"

const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : undefined)

/** Only remote HTTPS assets may cross from a catalog into the UI. */
function remoteAsset(value: unknown): string | undefined {
  const candidate = text(value)
  if (!candidate) return undefined
  try {
    return new URL(candidate).protocol === "https:" ? candidate : undefined
  } catch {
    return undefined
  }
}

function remoteAssets(value: unknown): string[] {
  return Array.isArray(value) ? value.map(remoteAsset).filter((item): item is string => Boolean(item)) : []
}

function i18n(value: unknown) {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined
}

function plugins(value: unknown): unknown[] {
  if (typeof value !== "object" || value === null) return []
  const list = (value as { plugins?: unknown }).plugins
  return Array.isArray(list) ? list : []
}

export function parseZcode(value: unknown): ZipEntry[] {
  const result: ZipEntry[] = []
  const seen = new Set<string>()
  for (const item of plugins(value)) {
    if (typeof item !== "object" || item === null) continue
    const raw = item as Record<string, unknown>
    const name = text(raw.name)
    if (!name || seen.has(name)) continue
    const source = raw.source
    if (typeof source !== "object" || source === null) continue
    const url = text((source as Record<string, unknown>).url)
    if (!url) continue
    seen.add(name)

    const names = i18n(raw.displayName_i18n)
    const descriptions = i18n(raw.description_i18n)
    const author =
      typeof raw.author === "object" && raw.author !== null ? (raw.author as Record<string, unknown>) : undefined
    const categories = strings(raw.category ? [raw.category] : raw.categories)
    const componentTypes = uniqueStrings(
      strings(raw.componentTypes).map((value) => {
        const normalized = value.toLowerCase()
        return (
          {
            skill: "skills",
            agent: "agents",
            command: "commands",
            tool: "tools",
            connector: "mcp",
            surface: "theme",
            previewer: "theme",
            ui: "theme",
          }[normalized] ?? value
        )
      }),
    )
    result.push({
      name,
      ...(text(raw.displayName) ? { displayName: text(raw.displayName) } : {}),
      ...(stringRecord(names) ? { displayNameI18n: stringRecord(names) } : {}),
      version: text(raw.version) ?? "0.0.0",
      description:
        text(descriptions?.["zh-CN"]) ?? text(descriptions?.en) ?? text(raw.description) ?? text(raw.displayName) ?? "",
      url,
      ...(text(author?.name) ? { author: text(author?.name) } : {}),
      ...(remoteAsset(raw.icon) ? { icon: remoteAsset(raw.icon) } : {}),
      ...(remoteAssets(raw.screenshots).length > 0 ? { screenshots: remoteAssets(raw.screenshots) } : {}),
      ...(categories.length > 0 ? { categories } : {}),
      ...(componentTypes.length > 0 ? { marketTypes: componentTypes } : {}),
      ...(text((source as Record<string, unknown>).sha256)
        ? { sha256: text((source as Record<string, unknown>).sha256) }
        : {}),
      ...(Array.isArray(raw.keywords)
        ? { keywords: raw.keywords.filter((tag): tag is string => typeof tag === "string") }
        : {}),
      // Keep display fields in the description when there is no description.
      ...(text(names?.["zh-CN"]) && !descriptions?.["zh-CN"]
        ? { description: text(names?.["zh-CN"]) + (author ? ` (${text(author.name) ?? ""})` : "") }
        : {}),
    })
  }
  return result
}

export function parseClaude(value: unknown): GitEntry[] {
  const result: GitEntry[] = []
  const seen = new Set<string>()
  for (const item of plugins(value)) {
    if (typeof item !== "object" || item === null) continue
    const raw = item as Record<string, unknown>
    const name = text(raw.name)
    if (!name || seen.has(name)) continue

    const source = raw.source
    let url: string | undefined
    let ref: string | undefined
    let subdir: string | undefined
    if (typeof source === "string") {
      if (/^https?:|^git@/.test(source)) url = source
      else {
        url = CLAUDE_MARKETPLACE_REPO
        subdir = source.replace(/^\.\//, "")
      }
    } else if (typeof source === "object" && source !== null) {
      const record = source as Record<string, unknown>
      url = text(record.url) ?? text(record.repo)
      ref = text(record.ref) ?? text(record.branch)
      subdir = text(record.path) ?? text(record.subdir)
      if (url && !/^https?:|^git@/.test(url)) url = undefined
    }
    if (!url) continue
    seen.add(name)

    const descriptions = i18n(raw.description_i18n)
    const names = i18n(raw.displayName_i18n ?? raw.display_name_i18n)
    const author =
      typeof raw.author === "object" && raw.author !== null ? (raw.author as Record<string, unknown>) : undefined
    const categories = strings(raw.category ? [raw.category] : raw.categories)
    result.push({
      name,
      ...(text(raw.displayName) ? { displayName: text(raw.displayName) } : {}),
      ...(stringRecord(names) ? { displayNameI18n: stringRecord(names) } : {}),
      ...(text(raw.version) ? { version: text(raw.version) } : {}),
      description: text(descriptions?.["zh-CN"]) ?? text(descriptions?.en) ?? text(raw.description) ?? "",
      url,
      ...(text(author?.name) ? { author: text(author?.name) } : {}),
      ...(remoteAsset(raw.icon) ? { icon: remoteAsset(raw.icon) } : {}),
      ...(remoteAssets(raw.screenshots).length > 0 ? { screenshots: remoteAssets(raw.screenshots) } : {}),
      ...(categories.length > 0 ? { categories } : {}),
      ...(ref ? { ref } : {}),
      ...(subdir ? { subdir } : {}),
    })
  }
  return result
}

export * as ExtensionCatalog from "./catalog"
