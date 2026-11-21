export type InstallRevision = {
  version?: string
  source: string
  installedAt: number
  files: number
  bytes: number
}

export const MARKET_TYPES = [
  "workbench",
  "agents",
  "skills",
  "mcp",
  "tools",
  "commands",
  "theme",
  "other",
  "providers",
  "office",
  "interceptors",
] as const

export const MARKET_CATEGORIES = [
  "office",
  "product",
  "productivity",
  "development",
  "design",
  "security",
  "data",
  "research",
  "writing",
  "communication",
  "marketing",
  "automation",
  "workflow",
  "testing",
  "devops",
  "education",
  "media",
  "finance",
  "other",
] as const

const MARKET_CATEGORY_LABELS: Record<string, string> = {
  office: "办公",
  product: "产品",
  productivity: "效率",
  development: "开发",
  design: "设计",
  security: "安全",
  data: "数据",
  research: "研究",
  writing: "写作",
  communication: "沟通",
  marketing: "营销",
  automation: "自动化",
  workflow: "工作流",
  testing: "测试",
  devops: "运维",
  education: "教育",
  media: "媒体",
  finance: "金融",
  other: "其他",
}

export function marketCategoryLabel(value: string): string {
  return MARKET_CATEGORY_LABELS[value.trim().toLowerCase()] ?? value
}
export type MarketType = (typeof MARKET_TYPES)[number]

export type MarketTypeSource = {
  marketTypes?: string[]
  capabilities?: string[]
  categories?: string[]
}

/** Normalize manifest/catalog contributions into the marketplace's user-facing type filters. */
export function marketTypesOf(entry: MarketTypeSource): MarketType[] {
  const result: MarketType[] = []
  const add = (value: string) => {
    if (value === "surfaces" || value === "previewers" || value === "ui") value = "theme"
    if (!MARKET_TYPES.includes(value as MarketType)) return
    if (!result.includes(value as MarketType)) result.push(value as MarketType)
  }

  for (const value of entry.marketTypes ?? []) add(value)
  for (const value of entry.capabilities ?? []) add(value)
  if (result.length === 0) result.push("other")
  return MARKET_TYPES.filter((value) => result.includes(value))
}

export type InstalledPackage = {
  name: string
  kind: "zip" | "git"
  version?: string
  source: string
  /** 安装时用的 git ref / 子目录 / 校验和：升级时按原样重放安装。 */
  ref?: string
  subdir?: string
  sha256?: string
  sourceId?: string
  permissions?: string[]
  dependencies?: Record<string, string>
  conflicts?: string[]
  root: string
  files: number
  bytes: number
  installedAt: number
  previous?: InstallRevision
}

const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : 0)

/** Compact byte counts for the hover title: 950 B, 12.3 KB, 4.5 MB. */
export function compactBytes(value: number): string {
  const size = num(value)
  if (size <= 0) return "0 B"
  if (size < 1_024) return `${Math.round(size)} B`
  if (size < 1_024 * 1_024) return `${(size / 1_024).toFixed(1)} KB`
  return `${(size / (1_024 * 1_024)).toFixed(1)} MB`
}

export function formatDate(value: number, locale: string): string {
  const at = num(value)
  if (at <= 0) return "—"
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(at))
}

/**
 * What changed since the previous install, e.g. `v1.2 → v1.3` or `reinstalled`.
 *
 * Returns undefined for first-time installs (nothing to compare) and for
 * refreshes that carry no previous revision — the UI then shows no tag rather
 * than an empty "updated from".
 */
export function updateLabel(pkg: InstalledPackage): string | undefined {
  const previous = pkg.previous
  if (!previous) return undefined
  if (previous.version && pkg.version && previous.version !== pkg.version) {
    return `${previous.version} → ${pkg.version}`
  }
  if (previous.version && !pkg.version) return `${previous.version} → —`
  if (!previous.version && pkg.version) return `→ ${pkg.version}`
  return "reinstalled"
}

/** Hover text: when the package was replaced and how large the old copy was. */
export function updateTitle(pkg: InstalledPackage, locale: string): string | undefined {
  const previous = pkg.previous
  if (!previous) return undefined
  return [
    `previous ${previous.version ?? "(no version)"}`,
    formatDate(previous.installedAt, locale),
    `${previous.files} files`,
    compactBytes(previous.bytes),
    `source: ${previous.source}`,
  ].join(" · ")
}

/** Numeric segment comparison, enough for `1.2.0` style versions. */
function compare(a: string, b: string): number {
  const left = a.split(/[.-]/).map((part) => (/^\d+$/.test(part) ? Number(part) : part))
  const right = b.split(/[.-]/).map((part) => (/^\d+$/.test(part) ? Number(part) : part))
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const l = left[i]
    const r = right[i]
    if (l === undefined) return -1
    if (r === undefined) return 1
    if (l === r) continue
    if (typeof l === "number" && typeof r === "number") return l < r ? -1 : 1
    return String(l).localeCompare(String(r))
  }
  return 0
}

/**
 * True when the catalog offers a newer version than the one installed.
 *
 * Only meaningful when both sides carry a version; a package without version
 * metadata gets no "update" hint instead of a false positive.
 */
export function updateAvailable(installed: InstalledPackage | undefined, catalogVersion?: string): boolean {
  if (!installed?.version || !catalogVersion) return false
  return compare(installed.version, catalogVersion) < 0
}
