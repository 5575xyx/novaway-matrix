import { afterEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Database } from "bun:sqlite"
import { listConnections, removeConnection, resolveConnection, saveConnection } from "@/database/store"
import { decryptSecret } from "@/database/secrets"
import { query as sqliteQuery, listTables, describeTable } from "@/database/drivers/sqlite"
import { tokenizeCommand, flatten } from "@/database/drivers/redis"
import { parseCommand, parseLiteral, toTable } from "@/database/drivers/mongodb"
import { pageable, wrapForPage, capRows } from "@/database/drivers/sql"

const temps: string[] = []
async function tempDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "novaway-db-"))
  temps.push(dir)
  return dir
}
afterEach(async () => {
  // Windows 下 sqlite 文件句柄释放有延迟，清理失败不影响断言结果。
  while (temps.length) await fs.rm(temps.pop()!, { recursive: true, force: true }).catch(() => undefined)
})

describe("connection store", () => {
  test("saves and lists connections without leaking the password", async () => {
    const root = await tempDir()
    const saved = await saveConnection(
      { name: "local", type: "sqlite", file: "/tmp/demo.db", password: "secret" },
      root,
    )
    expect(saved.hasPassword).toBe(true)
    expect(JSON.stringify(saved)).not.toContain("secret")

    const list = await listConnections(root)
    expect(list).toHaveLength(1)
    expect(list[0].name).toBe("local")

    const resolved = await resolveConnection("local", root)
    expect(resolved?.password).toBe("secret")
  })

  test("keeps the stored password when saving without one", async () => {
    const root = await tempDir()
    await saveConnection({ name: "a", type: "postgres", password: "p1" }, root)
    await saveConnection({ name: "a", type: "postgres", host: "db.internal" }, root)
    const resolved = await resolveConnection("a", root)
    expect(resolved?.password).toBe("p1")
    expect(resolved?.host).toBe("db.internal")
  })

  test("an empty password clears the secret", async () => {
    const root = await tempDir()
    await saveConnection({ name: "a", type: "mysql", password: "p1" }, root)
    const saved = await saveConnection({ name: "a", type: "mysql", password: "" }, root)
    expect(saved.hasPassword).toBe(false)
  })

  test("removes connections", async () => {
    const root = await tempDir()
    await saveConnection({ name: "a", type: "sqlite", file: "/tmp/x.db" }, root)
    expect(await removeConnection("a", root)).toBe(true)
    expect(await listConnections(root)).toHaveLength(0)
  })

  test("decrypt rejects a tampered payload", async () => {
    const root = await tempDir()
    await saveConnection({ name: "a", type: "mysql", password: "p1" }, root)
    const file = path.join(root, "connections.json")
    const raw = JSON.parse(await fs.readFile(file, "utf8"))
    raw.connections[0].secret = raw.connections[0].secret.slice(0, -4) + "AAAA"
    await fs.writeFile(file, JSON.stringify(raw))
    const resolved = await resolveConnection("a", root)
    expect(resolved?.password).toBe("")
  })

  test("encrypts SSH password, key contents and passphrase", async () => {
    const root = await tempDir()
    const saved = await saveConnection(
      {
        name: "tunnel",
        type: "postgres",
        host: "127.0.0.1",
        ssh: {
          enabled: true,
          host: "jump.example.com",
          user: "root",
          password: "ssh-pass",
          privateKey: "-----BEGIN KEY-----secret-----END KEY-----",
          passphrase: "key-pass",
        },
      },
      root,
    )
    expect(saved.sshEnabled).toBe(true)
    expect(saved.sshHost).toBe("jump.example.com")

    const raw = await fs.readFile(path.join(root, "connections.json"), "utf8")
    expect(raw).not.toContain("ssh-pass")
    expect(raw).not.toContain("BEGIN KEY")
    expect(raw).not.toContain("key-pass")

    const resolved = await resolveConnection("tunnel", root)
    expect(resolved?.ssh?.password).toBe("ssh-pass")
    expect(resolved?.ssh?.privateKey).toContain("BEGIN KEY")
    expect(resolved?.ssh?.passphrase).toBe("key-pass")
  })

  test("supports every dbx-style connection type", async () => {
    const root = await tempDir()
    const types = [
      "postgres",
      "mysql",
      "mariadb",
      "sqlite",
      "rqlite",
      "redis",
      "mongodb",
      "clickhouse",
      "starrocks",
      "doris",
    ] as const
    for (const type of types) await saveConnection({ name: type, type }, root)
    expect((await listConnections(root)).map((item) => item.type).sort()).toEqual([...types].sort())
  })
})

describe("sql paging helpers", () => {
  test("wraps plain selects", () => {
    expect(pageable("select * from users")).toBe(true)
    expect(wrapForPage("select * from users", 10, 20)).toBe(
      "SELECT * FROM (select * from users) AS __novaway_page LIMIT 10 OFFSET 20",
    )
  })

  test("does not wrap when a limit or multiple statements exist", () => {
    expect(pageable("select * from users limit 5")).toBe(false)
    expect(pageable("select 1; select 2")).toBe(false)
    expect(pageable("delete from users")).toBe(false)
  })

  test("caps rows and reports truncation", () => {
    expect(capRows([1, 2, 3], 2)).toEqual({ rows: [1, 2], truncated: true })
    expect(capRows([1], 2)).toEqual({ rows: [1], truncated: false })
  })
})

describe("redis helpers", () => {
  test("tokenizes quoted commands", () => {
    expect(tokenizeCommand('SET key "a b"')).toEqual(["SET", "key", "a b"])
    expect(tokenizeCommand("GET foo")).toEqual(["GET", "foo"])
  })

  test("flattens arrays and objects", () => {
    expect(flatten(["a", "b"])).toEqual({ columns: ["value"], rows: [["a"], ["b"]] })
    expect(flatten({ role: "master" })).toEqual({ columns: ["key", "value"], rows: [["role", "master"]] })
  })
})

describe("sqlite driver", () => {
  async function fixture() {
    const dir = await tempDir()
    const file = path.join(dir, "demo.db")
    const db = new Database(file)
    db.exec("create table users (id integer primary key, name text not null, note text)")
    db.exec("insert into users (name, note) values ('alice', 'a|b'), ('bob', null)")
    db.close()
    return { file }
  }

  test("returns structured rows", async () => {
    const { file } = await fixture()
    const result = await sqliteQuery(
      { id: "x", name: "x", type: "sqlite", file },
      "select id, name from users order by id",
      {
        limit: 10,
        offset: 0,
      },
    )
    expect(result.columns).toEqual(["id", "name"])
    expect(result.rows).toEqual([
      [1, "alice"],
      [2, "bob"],
    ])
    expect(result.truncated).toBe(false)
  })

  test("paginates with offset", async () => {
    const { file } = await fixture()
    const result = await sqliteQuery({ id: "x", name: "x", type: "sqlite", file }, "select id from users order by id", {
      limit: 1,
      offset: 1,
    })
    expect(result.rows).toEqual([[2]])
  })

  test("keeps pipe characters in cells", async () => {
    const { file } = await fixture()
    const result = await sqliteQuery(
      { id: "x", name: "x", type: "sqlite", file },
      "select note from users order by id",
      {
        limit: 10,
        offset: 0,
      },
    )
    expect(result.rows[0]).toEqual(["a|b"])
  })

  test("reports affected rows for writes", async () => {
    const { file } = await fixture()
    const result = await sqliteQuery(
      { id: "x", name: "x", type: "sqlite", file },
      "update users set note = 'x' where id = 1",
      { limit: 10, offset: 0 },
    )
    expect(result.affected).toBe(1)
  })

  test("lists tables and columns", async () => {
    const { file } = await fixture()
    const connection = { id: "x", name: "x", type: "sqlite" as const, file }
    expect(await listTables(connection)).toEqual([{ name: "users", kind: "table" }])
    const columns = await describeTable(connection, "users")
    expect(columns.map((c) => c.name)).toEqual(["id", "name", "note"])
    expect(columns[0].primary).toBe(true)
    expect(columns[1].nullable).toBe(false)
  })
})

describe("mongodb command parser", () => {
  test("parses find with limit", () => {
    expect(parseCommand('db.users.find({ status: "active" }).limit(20)')).toEqual({
      op: "find",
      collection: "users",
      filter: { status: "active" },
      limit: 20,
    })
  })

  test("parses counts, aggregates and metadata commands", () => {
    expect(parseCommand("db.users.countDocuments({ age: { $gt: 18 } })")).toEqual({
      op: "count",
      collection: "users",
      filter: { age: { $gt: 18 } },
    })
    expect(parseCommand("db.orders.aggregate([{ $match: { paid: true } }])")).toEqual({
      op: "aggregate",
      collection: "orders",
      pipeline: [{ $match: { paid: true } }],
    })
    expect(parseCommand("show collections").op).toBe("collections")
    expect(parseCommand("show dbs").op).toBe("databases")
  })

  test("accepts single quotes, unquoted keys and trailing commas", () => {
    expect(parseLiteral("{ status: 'active', age: { $gt: 18 }, tags: ['a', 'b'], }")).toEqual({
      status: "active",
      age: { $gt: 18 },
      tags: ["a", "b"],
    })
  })

  test("rejects unsupported commands", () => {
    expect(() => parseCommand("db.users.drop()")).toThrow()
    expect(() => parseCommand("eval('process.exit()')")).toThrow()
  })

  test("turns documents into a union of columns", () => {
    expect(
      toTable([
        { _id: 1, name: "a" },
        { _id: 2, email: "b@example.com" },
      ]),
    ).toEqual({
      columns: ["_id", "name", "email"],
      rows: [
        [1, "a", null],
        [2, null, "b@example.com"],
      ],
    })
  })
})
