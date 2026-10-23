import fs from "node:fs/promises"
import path from "node:path"
import { createHash } from "node:crypto"
import type { Loaded } from "./schema"

/**
 * Cheap content fingerprint for an installed extension directory.
 *
 * Used to answer "did this install actually change on disk?" without reading
 * every file: we hash each file's relative path + size + mtime. That matches
 * what a reinstall/upgrade changes and stays fast on marketplace trees with
 * hundreds of files.
 */
export const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", ".cache", ".turbo", "coverage"])

export type Fingerprint = {
  files: number
  bytes: number
  hash: string
}

async function walk(root: string, relative = "", acc: string[] = []) {
  let entries
  try {
    entries = await fs.readdir(path.join(root, relative), { withFileTypes: true })
  } catch {
    return acc
  }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue
    const next = relative ? path.join(relative, entry.name) : entry.name
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      await walk(root, next, acc)
      continue
    }
    if (!entry.isFile()) continue
    const stat = await fs.stat(path.join(root, next)).catch(() => undefined)
    if (!stat) continue
    acc.push(`${next.replaceAll("\\", "/")}:${stat.size}:${Math.round(stat.mtimeMs)}`)
  }
  return acc
}

export async function fingerprint(root: string): Promise<Fingerprint> {
  const parts = await walk(root)
  parts.sort()
  const hash = createHash("sha256").update(parts.join("\n")).digest("hex").slice(0, 16)
  const bytes = parts.reduce((total, line) => total + Number(line.split(":").at(-2) ?? 0), 0)
  return { files: parts.length, bytes, hash }
}

export type InstallRecord = {
  name: string
  root: string
  version?: string
  installs: Array<{ hash: string; version?: string; at: number; files: number; bytes: number }>
}

/** Keep a bounded history so a bad upgrade can be traced back to the install it replaced. */
export const MAX_INSTALLS = 5

export function record(
  previous: InstallRecord | undefined,
  loaded: Loaded,
  print: Fingerprint,
  now = Date.now(),
): InstallRecord {
  const base: InstallRecord = previous ?? { name: loaded.name, root: loaded.root, installs: [] }
  const installs = [...base.installs]
  if (installs.at(-1)?.hash !== print.hash) {
    installs.push({
      hash: print.hash,
      ...(loaded.manifest.version ? { version: loaded.manifest.version } : {}),
      at: now,
      files: print.files,
      bytes: print.bytes,
    })
  }
  return {
    name: loaded.name,
    root: loaded.root,
    ...(loaded.manifest.version ? { version: loaded.manifest.version } : {}),
    installs: installs.slice(-MAX_INSTALLS),
  }
}

export function previous(history: InstallRecord | undefined) {
  if (!history || history.installs.length < 2) return undefined
  return history.installs.at(-2)
}

export * as ExtensionPackage from "./package"
