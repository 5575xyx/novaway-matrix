import { describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { drizzle } from "drizzle-orm/bun-sqlite"
import { migrate } from "drizzle-orm/bun-sqlite/migrator"
import { readFileSync, readdirSync } from "fs"
import path from "path"

const target = "20261106000000_session_scope"

function migrations() {
  return readdirSync(path.join(import.meta.dirname, "../../migration"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      name: entry.name,
      timestamp: Number(entry.name.split("_")[0]),
      sql: readFileSync(path.join(import.meta.dirname, "../../migration", entry.name, "migration.sql"), "utf-8"),
    }))
    .sort((a, b) => a.timestamp - b.timestamp)
}

describe("session scope migration", () => {
  test("marks existing sessions as project scoped", () => {
    const sqlite = new Database(":memory:")
    const db = drizzle({ client: sqlite })
    const entries = migrations()
    const index = entries.findIndex((entry) => entry.name === target)

    expect(index).toBeGreaterThan(0)

    migrate(db, entries.slice(0, index))
    sqlite.run(
      "INSERT INTO project (id, worktree, vcs, name, time_created, time_updated, sandboxes) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ["project_1", "/tmp/project", "git", "project", 1, 1, "[]"],
    )
    sqlite.run(
      "INSERT INTO session (id, project_id, slug, directory, title, version, time_created, time_updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      ["session_1", "project_1", "session", "/tmp/project", "title", "1", 1, 1],
    )

    migrate(db, entries.slice(index))

    expect(sqlite.query("SELECT scope FROM session WHERE id = ?").get("session_1")).toEqual({ scope: "project" })
  })
})
