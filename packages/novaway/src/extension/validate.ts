import fs from "node:fs/promises"
import path from "node:path"
import type { Loaded, Manifest } from "./schema"
import { contributions, CONVENTIONAL } from "./schema"

export type Issue = {
  severity: "error" | "warning"
  code: string
  message: string
}

const SEMVER = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/

async function exists(target: string) {
  try {
    await fs.access(target)
    return true
  } catch {
    return false
  }
}

export function parseVersion(value: string | undefined) {
  if (!value) return undefined
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(value.replace(/^v/, ""))
  if (!match) return undefined
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) }
}

export function compareVersion(a: string, b: string) {
  const left = parseVersion(a)
  const right = parseVersion(b)
  if (!left || !right) return undefined
  if (left.major !== right.major) return left.major - right.major
  if (left.minor !== right.minor) return left.minor - right.minor
  return left.patch - right.patch
}

type Version = { major: number; minor: number; patch: number }

function compare(a: Version, b: Version) {
  if (a.major !== b.major) return a.major - b.major
  if (a.minor !== b.minor) return a.minor - b.minor
  return a.patch - b.patch
}

/** Satisfies a small subset of semver ranges: `1.2.3`, `>=1.2.3`, `^1.2.3`, `~1.2.3`, `*`. */
export function satisfies(version: string, range: string): boolean | undefined {
  const current = parseVersion(version)
  if (!current) return undefined
  const trimmed = range.trim()
  if (!trimmed || trimmed === "*") return true
  const match = /^(>=|>|<=|<|\^|~|=)?\s*(.+)$/.exec(trimmed)
  if (!match) return undefined
  const operator = match[1] ?? "="
  const wanted = parseVersion(match[2]!)
  if (!wanted) return undefined
  const cmp = compare(current, wanted)
  switch (operator) {
    case ">=":
      return cmp >= 0
    case ">":
      return cmp > 0
    case "<=":
      return cmp <= 0
    case "<":
      return cmp < 0
    case "^":
      // ^1.2.3 → >=1.2.3 <2.0.0 ; ^0.2.3 → >=0.2.3 <0.3.0
      if (cmp < 0) return false
      return wanted.major === 0 ? current.major === 0 && current.minor === wanted.minor : current.major === wanted.major
    case "~":
      return cmp >= 0 && current.major === wanted.major && current.minor === wanted.minor
    default:
      return cmp === 0
  }
}

/** Check the `engines.novaway` range against the running version. */
export function checkEngine(range: string | undefined, current: string): Issue | undefined {
  if (!range) return undefined
  const ok = satisfies(current, range)
  if (ok === undefined) {
    return { severity: "warning", code: "engine-unparsed", message: `cannot parse engines.novaway "${range}"` }
  }
  if (ok) return undefined
  return {
    severity: "error",
    code: "engine-mismatch",
    message: `requires novaWay ${range}, running ${current}`,
  }
}

/** Dependencies reference other extension names; flag missing or disabled ones. */
export function checkDependencies(manifest: Manifest, all: readonly Loaded[]): Issue[] {
  const byName = new Map(all.map((item) => [item.name, item]))
  const issues: Issue[] = []
  for (const [name, range] of Object.entries(manifest.dependencies ?? {})) {
    const found = byName.get(name)
    if (!found) {
      issues.push({ severity: "error", code: "dependency-missing", message: `missing extension dependency "${name}"` })
      continue
    }
    if (!found.enabled) {
      issues.push({ severity: "warning", code: "dependency-disabled", message: `dependency "${name}" is disabled` })
    }
    const version = found.manifest.version
    if (version && SEMVER.test(version) && range && range !== "*") {
      const ok = satisfies(version, range)
      if (ok === false) {
        issues.push({
          severity: "warning",
          code: "dependency-version",
          message: `dependency "${name}" ${version} does not satisfy ${range}`,
        })
      }
    }
  }
  return issues
}

const OPTIONAL_PATHS = new Set<string>([
  ...CONVENTIONAL.commands,
  ...CONVENTIONAL.agents,
  ...CONVENTIONAL.skills,
  ...CONVENTIONAL.tools,
])

/** Contribution paths must exist; missing ones are warnings, not hard failures. */
export async function checkPaths(loaded: Loaded): Promise<Issue[]> {
  const issues: Issue[] = []
  for (const item of contributions(loaded)) {
    if (item.kind === "mcp") continue
    // Conventional paths are best-effort: a package that only ships skills/
    // must not be flagged for a missing commands/ directory.
    if (OPTIONAL_PATHS.has(item.path)) continue
    const target = path.resolve(loaded.root, item.path)
    if (await exists(target)) continue
    issues.push({
      severity: "warning",
      code: "contribution-missing",
      message: `${item.kind} path not found: ${item.path}`,
    })
  }
  return issues
}

export async function validate(loaded: Loaded, all: readonly Loaded[], currentVersion: string): Promise<Issue[]> {
  const issues: Issue[] = []
  if (loaded.manifest.version && !SEMVER.test(loaded.manifest.version)) {
    issues.push({
      severity: "warning",
      code: "version-format",
      message: `version "${loaded.manifest.version}" is not semver`,
    })
  }
  const engine = checkEngine(loaded.manifest.engines?.novaway, currentVersion)
  if (engine) issues.push(engine)
  issues.push(...checkDependencies(loaded.manifest, all))
  issues.push(...(await checkPaths(loaded)))
  if (loaded.manifest.manifestVersion !== undefined && loaded.manifest.manifestVersion > 1) {
    issues.push({
      severity: "warning",
      code: "manifest-version",
      message: `manifestVersion ${loaded.manifest.manifestVersion} is newer than supported (1)`,
    })
  }
  return issues
}

export * as ExtensionValidate from "./validate"
