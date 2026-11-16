import { randomUUID } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import { Global } from "@novaway/core/global"
import * as ExtensionLoader from "./loader"

export type LegacyInstalled = {
  name: string
  version?: string
  root: string
  runtime: "legacy"
  source: "legacy-extension"
  preserved: true
  conflict?: "marketplace-id"
}

export type Migration = {
  migrationId: string
  name: string
  version?: string
  legacyRoot: string
  managedRoot: string
  backupRoot: string
  migratedAt: number
  state: "migrated" | "rolledback"
}

type StoredMigrations = { version: 1; migrations: Migration[] }
const MIGRATION_FILE = "marketplace-legacy-migrations.json"
const BACKUP_DIRECTORY = ".legacy-backups"

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function safeSegment(value: string) {
  return value.replace(/[^A-Za-z0-9._@-]/g, "_").replace(/^\.+/, "_").slice(0, 120) || "legacy"
}

function migrationFile(config: string) {
  return path.join(config, MIGRATION_FILE)
}

async function readMigrations(config: string): Promise<Migration[]> {
  try {
    const parsed = JSON.parse(await fs.readFile(migrationFile(config), "utf8")) as StoredMigrations
    return parsed?.version === 1 && Array.isArray(parsed.migrations) ? parsed.migrations : []
  } catch {
    return []
  }
}

async function writeMigrations(config: string, migrations: Migration[]) {
  await fs.mkdir(config, { recursive: true })
  const target = migrationFile(config)
  const temporary = `${target}.tmp-${process.pid}-${Date.now()}`
  await fs.writeFile(temporary, JSON.stringify({ version: 1, migrations } satisfies StoredMigrations, null, 2), "utf8")
  await fs.rename(temporary, target).catch(async (error) => {
    await fs.rm(temporary, { force: true }).catch(() => undefined)
    throw error
  })
}

function within(parent: string, child: string) {
  const base = path.resolve(parent)
  const target = path.resolve(child)
  return target === base || target.startsWith(base + path.sep)
}

/**
 * Inventory old extension directories without copying or rewriting them.
 * Migration is deliberately explicit: this report is read-only and source
 * changes never remove an existing legacy package.
 */
export async function list(config = Global.Path.config): Promise<LegacyInstalled[]> {
  const roots = [path.join(config, "extensions"), path.join(config, "plugins")]
  const seen = new Set<string>()
  const result: LegacyInstalled[] = []
  for (const root of roots) {
    for (const directory of await ExtensionLoader.discover(root)) {
      const resolved = path.resolve(directory)
      if (seen.has(resolved)) continue
      seen.add(resolved)
      const raw = await ExtensionLoader.readRawManifest(directory)
      const value = raw?.raw && typeof raw.raw === "object" ? (raw.raw as Record<string, unknown>) : {}
      const name = text(value.name) ?? path.basename(directory)
      result.push({
        name,
        ...(text(value.version) ? { version: text(value.version) } : {}),
        root: directory,
        runtime: "legacy",
        source: "legacy-extension",
        preserved: true,
      })
    }
  }
  return result.sort((a, b) => a.name.localeCompare(b.name) || a.root.localeCompare(b.root))
}

export async function migrationPlan(
  installed: readonly LegacyInstalled[],
  marketplaceIds: ReadonlySet<string>,
): Promise<LegacyInstalled[]> {
  return installed.map((item) => (marketplaceIds.has(item.name) ? { ...item, conflict: "marketplace-id" } : item))
}

export async function migrations(config = Global.Path.config) {
  return readMigrations(config)
}

/**
 * Explicitly adopt a legacy directory into the managed marketplace root.
 *
 * The original directory is moved to a private physical backup and copied to a
 * normal marketplace directory, so the legacy loader no longer sees two live
 * copies of the same plugin. Nothing is discarded: rollback moves the backup
 * back to its original path. Same-ID marketplace installs are rejected unless
 * the caller first resolves that conflict explicitly.
 */
export async function migrate(nameOrRoot: string, config = Global.Path.config): Promise<Migration> {
  const existing = await readMigrations(config)
  const already = existing.find((item) => item.name === nameOrRoot || item.legacyRoot === path.resolve(nameOrRoot))
  if (already) return already
  const legacy = (await list(config)).find(
    (item) => item.name === nameOrRoot || path.resolve(item.root) === path.resolve(nameOrRoot),
  )
  if (!legacy) throw new Error(`找不到 legacy 扩展：${nameOrRoot}`)
  const marketplace = path.join(config, "marketplace")
  const live = (await fs.readdir(marketplace, { withFileTypes: true }).catch(() => []))
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => entry.name)
  if (live.some((entry) => entry === legacy.name || entry.startsWith(`${safeSegment(legacy.name)}@`))) {
    throw new Error(`marketplace 已存在同 ID 插件：${legacy.name}`)
  }

  const migrationId = randomUUID()
  const backupRoot = path.join(config, BACKUP_DIRECTORY, `${safeSegment(legacy.name)}-${migrationId}`)
  const managedRoot = path.join(marketplace, `${safeSegment(legacy.name)}@legacy`)
  if (!within(path.join(config, "extensions"), legacy.root) && !within(path.join(config, "plugins"), legacy.root)) {
    throw new Error("legacy 扩展目录不在受支持的 legacy 根目录内")
  }
  await fs.mkdir(path.dirname(backupRoot), { recursive: true })
  await fs.mkdir(marketplace, { recursive: true })
  let moved = false
  try {
    await fs.rename(legacy.root, backupRoot)
    moved = true
    await fs.cp(backupRoot, managedRoot, { recursive: true, dereference: true })
    const manifest = await ExtensionLoader.readRawManifest(managedRoot)
    const raw = manifest?.raw && typeof manifest.raw === "object" ? (manifest.raw as Record<string, unknown>) : {}
    await fs.writeFile(
      path.join(managedRoot, ".novaway-install.json"),
      JSON.stringify(
        {
          name: legacy.name,
          kind: "zip",
          ...(legacy.version ? { version: legacy.version } : {}),
          source: `legacy://${legacy.root}`,
          installedAt: Date.now(),
          ...(text(raw.version) ? { version: text(raw.version) } : {}),
        },
        null,
        2,
      ),
    )
    const migration: Migration = {
      migrationId,
      name: legacy.name,
      ...(legacy.version ? { version: legacy.version } : {}),
      legacyRoot: legacy.root,
      managedRoot,
      backupRoot,
      migratedAt: Date.now(),
      state: "migrated",
    }
    await writeMigrations(config, [...existing, migration])
    return migration
  } catch (error) {
    await fs.rm(managedRoot, { recursive: true, force: true }).catch(() => undefined)
    if (moved) await fs.rename(backupRoot, legacy.root).catch(() => undefined)
    throw error
  }
}

export async function rollbackMigration(migrationId: string, config = Global.Path.config): Promise<Migration> {
  const stored = await readMigrations(config)
  const migration = stored.find((item) => item.migrationId === migrationId)
  if (!migration) throw new Error(`找不到 legacy 迁移：${migrationId}`)
  if (!within(path.join(config, BACKUP_DIRECTORY), migration.backupRoot)) throw new Error("invalid legacy backup path")
  if (!within(path.join(config, "marketplace"), migration.managedRoot)) throw new Error("invalid managed plugin path")
  if (!(await fs.stat(migration.backupRoot).catch(() => undefined))) throw new Error("legacy 备份文件已不存在")
  await fs.rm(migration.managedRoot, { recursive: true, force: true })
  await fs.mkdir(path.dirname(migration.legacyRoot), { recursive: true })
  await fs.rename(migration.backupRoot, migration.legacyRoot)
  const next = stored.filter((item) => item.migrationId !== migrationId)
  await writeMigrations(config, next)
  return { ...migration, state: "rolledback" }
}
