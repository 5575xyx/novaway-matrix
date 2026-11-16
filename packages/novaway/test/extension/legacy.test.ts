import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import * as Legacy from "../../src/extension/legacy"

async function tmp() {
  return fs.mkdtemp(path.join(os.tmpdir(), "novaway-legacy-"))
}

describe("legacy marketplace migration inventory", () => {
  test("preserves old directories and reports same-id conflicts without copying", async () => {
    const config = await tmp()
    const old = path.join(config, "extensions", "old-plugin")
    await fs.mkdir(old, { recursive: true })
    await fs.writeFile(path.join(old, "plugin.json"), JSON.stringify({ name: "old-plugin", version: "1.0.0" }))

    const installed = await Legacy.list(config)
    expect(installed).toContainEqual(expect.objectContaining({ name: "old-plugin", runtime: "legacy", preserved: true }))
    const plan = await Legacy.migrationPlan(installed, new Set(["old-plugin"]))
    expect(plan[0]).toMatchObject({ conflict: "marketplace-id", root: old })
    expect(await fs.access(old).then(() => true, () => false)).toBe(true)
  })
  test("explicit migration moves the live copy and rollback restores it", async () => {
    const config = await tmp()
    const old = path.join(config, "extensions", "migratable")
    await fs.mkdir(path.join(old, "skills"), { recursive: true })
    await fs.writeFile(path.join(old, "plugin.json"), JSON.stringify({ name: "migratable", version: "2.0.0" }))
    await fs.writeFile(path.join(old, "skills", "SKILL.md"), "# legacy")

    const migration = await Legacy.migrate("migratable", config)
    expect(migration.state).toBe("migrated")
    expect(await fs.access(old).then(() => true, () => false)).toBe(false)
    expect(await fs.readFile(path.join(migration.managedRoot, "skills", "SKILL.md"), "utf8")).toBe("# legacy")
    expect(await Legacy.migrations(config)).toHaveLength(1)

    await Legacy.rollbackMigration(migration.migrationId, config)
    expect(await fs.readFile(path.join(old, "plugin.json"), "utf8")).toContain("migratable")
    expect(await fs.access(migration.managedRoot).then(() => true, () => false)).toBe(false)
    expect(await Legacy.migrations(config)).toEqual([])
  })
})
