import { afterEach, describe, expect, test } from "bun:test"
import { Database as BunDatabase } from "bun:sqlite"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { connectString as oracleConnectString, splitTable } from "@/database/drivers/oracle"
import { hasTopLevelOrderBy, wrapForPageDialect } from "@/database/drivers/sql"
import { configFor as sqlserverConfig, connectionKey as sqlserverKey } from "@/database/drivers/sqlserver"
import type { ResolvedConnection } from "@/database/drivers/types"
import { importLegacyDbxConnections, mapLegacy } from "@/database/import-dbx"
import { listConnections, resolveConnection } from "@/database/store"

const temps: string[] = []
async function tempDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "novaway-dialect-"))
  temps.push(dir)
  return dir
}
afterEach(async () => {
  while (temps.length) await fs.rm(temps.pop()!, { recursive: true, force: true }).catch(() => undefined)
})

const local = (patch: Partial<ResolvedConnection> = {}): ResolvedConnection => ({
  id: "c1",
  name: "demo",
  type: "postgres",
  ...patch,
})

describe("dialect pagination", () => {
  test("limit dialect keeps the derived-table wrapper", () => {
    expect(wrapForPageDialect("select * from users", 10, 20)).toBe(
      "SELECT * FROM (select * from users) AS __novaway_page LIMIT 10 OFFSET 20",
    )
  })

  test("oracle uses OFFSET/FETCH inside a derived table", () => {
    expect(wrapForPageDialect("select * from users order by id", 10, 5, "fetch")).toBe(
      "SELECT * FROM (select * from users order by id) __novaway_page OFFSET 5 ROWS FETCH NEXT 10 ROWS ONLY",
    )
  })

  test("sql server appends OFFSET/FETCH and keeps the user ORDER BY", () => {
    expect(wrapForPageDialect("select * from users order by id", 10, 5, "top")).toBe(
      "select * from users order by id OFFSET 5 ROWS FETCH NEXT 10 ROWS ONLY",
    )
  })

  test("sql server injects a dummy ORDER BY when there is none at the top level", () => {
    expect(wrapForPageDialect("select * from users", 10, 0, "top")).toBe(
      "select * from users ORDER BY (SELECT NULL) OFFSET 0 ROWS FETCH NEXT 10 ROWS ONLY",
    )
    expect(wrapForPageDialect("select * from (select top 5 * from t order by id) x", 10, 0, "top")).toContain(
      "ORDER BY (SELECT NULL)",
    )
  })

  test("hasTopLevelOrderBy ignores ORDER BY inside parens and strings", () => {
    expect(hasTopLevelOrderBy("select * from t order by id")).toBe(true)
    expect(hasTopLevelOrderBy("select * from (select * from t order by id) x")).toBe(false)
    expect(hasTopLevelOrderBy("select 'order by' as txt from t")).toBe(false)
  })

  test("clamps limit and offset to sane values", () => {
    expect(wrapForPageDialect("select 1", 0, -5, "top")).toBe(
      "select 1 ORDER BY (SELECT NULL) OFFSET 0 ROWS FETCH NEXT 1 ROWS ONLY",
    )
  })
})

describe("sqlserver connection config", () => {
  test("maps host, port, credentials and tls", () => {
    const config = sqlserverConfig(
      local({ type: "sqlserver", host: "db.lan", port: 1433, database: "app", user: "sa", password: "pw", ssl: true }),
    )
    expect(config.server).toBe("db.lan")
    expect(config.options?.port).toBe(1433)
    expect(config.options?.database).toBe("app")
    expect(config.options?.encrypt).toBe(true)
    expect(config.options?.trustServerCertificate).toBe(true)
    expect(config.authentication).toEqual({ type: "default", options: { userName: "sa", password: "pw" } })
  })

  test("falls back to localhost:1433 with tls off", () => {
    const config = sqlserverConfig(local({ type: "sqlserver" }))
    expect(config.server).toBe("127.0.0.1")
    expect(config.options?.port).toBe(1433)
    expect(config.options?.encrypt).toBe(false)
    expect(sqlserverKey(local({ type: "sqlserver" }))).toBe("127.0.0.1|1433||")
  })
})

describe("oracle connection string", () => {
  test("builds an easy connect descriptor from host, port and service", () => {
    expect(oracleConnectString(local({ type: "oracle", host: "ora.lan", port: 1521, database: "ORCLPDB1" }))).toBe(
      "ora.lan:1521/ORCLPDB1",
    )
  })

  test("adds tcps when ssl is on", () => {
    expect(oracleConnectString(local({ type: "oracle", host: "ora.lan", database: "ORCL", ssl: true }))).toBe(
      "tcps://ora.lan:1521/ORCL",
    )
  })

  test("passes through descriptors typed into the host field", () => {
    expect(oracleConnectString(local({ type: "oracle", host: "(DESCRIPTION=(ADDRESS=...))" }))).toBe(
      "(DESCRIPTION=(ADDRESS=...))",
    )
    expect(oracleConnectString(local({ type: "oracle", host: "//ora.lan:1521/ORCL" }))).toBe("//ora.lan:1521/ORCL")
  })

  test("splits schema qualified table names", () => {
    expect(splitTable("HR.EMPLOYEES")).toEqual({ owner: "HR", name: "EMPLOYEES" })
    expect(splitTable("employees")).toEqual({ owner: undefined, name: "employees" })
  })
})

describe("legacy dbx import", () => {
  test("maps dbx config fields onto the native connection shape", () => {
    expect(
      mapLegacy(
        {
          name: "local mysql",
          driver_profile: "mysql",
          host: "127.0.0.1",
          port: "3307",
          database: "app",
          username: "root",
          ssl: true,
        },
        "s3cret",
      ),
    ).toEqual({
      name: "local mysql",
      type: "mysql",
      host: "127.0.0.1",
      port: 3307,
      database: "app",
      user: "root",
      password: "s3cret",
      file: undefined,
      ssl: true,
      db: undefined,
      httpPath: undefined,
    })
  })

  test("sqlite keeps the file path and drops network fields", () => {
    const input = mapLegacy({ name: "demo", db_type: "sqlite3", connection_string: "C:/data/app.db", host: "h" })
    expect(input?.type).toBe("sqlite")
    expect(input?.file).toBe("C:/data/app.db")
    expect(input?.host).toBeUndefined()
    expect(input?.user).toBeUndefined()
  })

  test("redis keeps the logical database index", () => {
    const input = mapLegacy({ name: "cache", db_type: "redis", host: "redis.lan", db: "2" })
    expect(input?.type).toBe("redis")
    expect(input?.db).toBe(2)
    expect(input?.database).toBeUndefined()
  })

  test("rejects unknown types and missing names", () => {
    expect(mapLegacy({ name: "x", db_type: "duckdb" })).toBeUndefined()
    expect(mapLegacy({ db_type: "mysql" })).toBeUndefined()
  })
})

describe("legacy dbx import from sqlite", () => {
  test("imports once, keeps the stored password and never overwrites existing names", async () => {
    const dir = await tempDir()
    const legacy = path.join(dir, "dbx.db")
    const root = path.join(dir, "database")

    const db = new BunDatabase(legacy, { create: true })
    db.run("CREATE TABLE connections (id TEXT PRIMARY KEY, config_json TEXT)")
    db.run("CREATE TABLE connection_secrets (connection_id TEXT, key TEXT, secret TEXT)")
    db.run("INSERT INTO connections (id, config_json) VALUES (?, ?)", [
      "legacy-1",
      JSON.stringify({ name: "local_mysql", db_type: "mysql", host: "127.0.0.1", port: 3306, database: "app" }),
    ])
    db.run("INSERT INTO connection_secrets (connection_id, key, secret) VALUES (?, ?, ?)", [
      "legacy-1",
      "password",
      "hunter2",
    ])
    db.run("INSERT INTO connections (id, config_json) VALUES (?, ?)", [
      "legacy-2",
      JSON.stringify({ name: "existing", db_type: "postgres", host: "pg.lan" }),
    ])
    db.close()

    const { saveConnection } = await import("@/database/store")
    await saveConnection({ name: "existing", type: "sqlite", file: "/tmp/keep.db" }, root)

    expect(await importLegacyDbxConnections(legacy, root)).toBe(1)
    const after = await listConnections(root)
    expect(after.map((item) => item.name).sort()).toEqual(["existing", "local_mysql"])

    const imported = after.find((item) => item.name === "local_mysql")!
    const resolved = await resolveConnection(imported.id, root)
    expect(resolved?.password).toBe("hunter2")
    expect(resolved?.host).toBe("127.0.0.1")
    expect(after.find((item) => item.name === "existing")?.type).toBe("sqlite")

    // 标记文件存在，第二次导入是空操作
    expect(await importLegacyDbxConnections(legacy, root)).toBe(0)
  })
})
