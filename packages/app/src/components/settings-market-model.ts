export type InstallRevision = {
  version?: string
  source: string
  installedAt: number
  files: number
  bytes: number
}

export type InstalledPackage = {
  name: string
  kind: "zip" | "git"
  version?: string
  source: string
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
