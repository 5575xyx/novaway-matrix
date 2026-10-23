import { createHash } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import * as Log from "@novaway/core/util/log"
import type { Loaded } from "./schema"
import { compareVersion, parseVersion } from "./validate"

const log = Log.create({ service: "extension.lock" })

/**
 * Installed-extension ledger.
 *
 * Records what was loaded last time (version + content hash), so the UI can say
 * "this extension was upgraded / downgraded / edited" and so a broken install
 * can be spotted without diffing every file. The ledger is advisory: deleting
 * it only loses change history, never an install.
 */
export type Entry = {
  name: string
  version?: string
  root: string
  source: Loaded["source"]
  hash: string
  /** Unix ms of the first time this exact hash was seen. */
  seenAt: number
}

export type Ledger = {
  version: 1
  updatedAt: number
  entries: Record<string, Entry>
}

export type Change = "added" | "removed" | "upgraded" | "downgraded" | "changed" | "unchanged"

export type Diff = {
  name: string
  change: Change
  from?: Entry
  to?: Entry
}

export const EMPTY: Ledger = { version: 1, updatedAt: 0, entries: {} }

export function file(configDir: string) {
  return path.join(configDir, "extensions.lock.json")
}

/** Stable hash over the parts that determine behaviour. Paths are excluded. */
export function hash(loaded: Loaded) {
  const manifest = loaded.manifest
  const payload = JSON.stringify({
    name: manifest.name,
    version: manifest.version ?? null,
    description: manifest.description ?? null,
    manifestVersion: manifest.manifestVersion ?? null,
    contributes: manifest.contributes ?? null,
    commands: manifest.commands ?? null,
    agents: manifest.agents ?? null,
    skills: manifest.skills ?? null,
    hooks: manifest.hooks ?? null,
    mcpServers: manifest.mcpServers ?? null,
    tools: manifest.tools ?? null,
    dependencies: manifest.dependencies ?? null,
    engines: manifest.engines ?? null,
  })
  return createHash("sha256").update(payload).digest("hex").slice(0, 16)
}

export function entry(loaded: Loaded, seenAt = Date.now()): Entry {
  return {
    name: loaded.name,
    ...(loaded.manifest.version ? { version: loaded.manifest.version } : {}),
    root: loaded.root,
    source: loaded.source,
    hash: hash(loaded),
    seenAt,
  }
}

export function build(loaded: readonly Loaded[], previous: Ledger = EMPTY): Ledger {
  const now = Date.now()
  const entries: Record<string, Entry> = {}
  for (const item of loaded) {
    const next = entry(item, now)
    const before = previous.entries[item.name]
    // Keep the original seenAt while the content hash is unchanged, so the UI
    // can show "installed N days ago" instead of "just now" on every boot.
    entries[item.name] = before && before.hash === next.hash ? { ...next, seenAt: before.seenAt } : next
  }
  return { version: 1, updatedAt: now, entries }
}

export function diff(previous: Ledger, current: Ledger): Diff[] {
  const names = new Set([...Object.keys(previous.entries), ...Object.keys(current.entries)])
  const result: Diff[] = []
  for (const name of names) {
    const from = previous.entries[name]
    const to = current.entries[name]
    if (!from) {
      if (to) result.push({ name, change: "added", to })
      continue
    }
    if (!to) {
      result.push({ name, change: "removed", from })
      continue
    }
    if (from.hash === to.hash && from.version === to.version) {
      result.push({ name, change: "unchanged", from, to })
      continue
    }
    const bothParsed = parseVersion(from.version) && parseVersion(to.version)
    const order = bothParsed ? compareVersion(to.version!, from.version!) : undefined
    if (order !== undefined && order > 0) result.push({ name, change: "upgraded", from, to })
    else if (order !== undefined && order < 0) result.push({ name, change: "downgraded", from, to })
    else result.push({ name, change: "changed", from, to })
  }
  return result.sort((a, b) => a.name.localeCompare(b.name))
}

export async function read(configDir: string): Promise<Ledger> {
  try {
    const text = await fs.readFile(file(configDir), "utf8")
    const raw = JSON.parse(text) as unknown
    if (!raw || typeof raw !== "object") return EMPTY
    const ledger = raw as Ledger
    if (ledger.version !== 1 || typeof ledger.entries !== "object" || ledger.entries === null) return EMPTY
    return ledger
  } catch {
    return EMPTY
  }
}

export async function write(configDir: string, ledger: Ledger) {
  try {
    await fs.mkdir(configDir, { recursive: true })
    await fs.writeFile(file(configDir), JSON.stringify(ledger, null, 2))
  } catch (error) {
    // The ledger is advisory; never fail a reload because it could not persist.
    log.warn("failed to write extension ledger", { error: String(error) })
  }
}

export * as ExtensionLock from "./lock"
