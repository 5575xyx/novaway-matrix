import type { GitEntry, ZipEntry } from "./marketplace"

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
    result.push({
      name,
      version: text(raw.version) ?? "0.0.0",
      description:
        text(descriptions?.["zh-CN"]) ?? text(descriptions?.en) ?? text(raw.description) ?? text(raw.displayName) ?? "",
      url,
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
    result.push({
      name,
      ...(text(raw.version) ? { version: text(raw.version) } : {}),
      description: text(descriptions?.["zh-CN"]) ?? text(descriptions?.en) ?? text(raw.description) ?? "",
      url,
      ...(ref ? { ref } : {}),
      ...(subdir ? { subdir } : {}),
    })
  }
  return result
}

export * as ExtensionCatalog from "./catalog"
