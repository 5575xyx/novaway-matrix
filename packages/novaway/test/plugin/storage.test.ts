import { describe, expect, test } from "bun:test"
import { Database as Sqlite } from "bun:sqlite"
import { drizzle } from "drizzle-orm/bun-sqlite"
import { migrate } from "drizzle-orm/bun-sqlite/migrator"
import { readFileSync, readdirSync } from "fs"
import path from "path"
import { isPluginError } from "@novaway/plugin-api"
import { PluginStorage } from "@/plugin/storage"

/**
 * §14.3 第 7 步的验收：
 * - 迁移能在空库和「已经有旧表的库」上跑，并且重放不报错；
 * - 插件 KV 的越权写入被拒。
 *
 * 迁移部分自己读 `migration/` 目录，和 `test/storage/workspace-time-migration.test.ts` 同一套做法：
 * 用运行时的 `Database.Client()` 测不了「旧库」——那个库路径是进程级的，一个测试进程只能有一个。
 * CRUD 部分则走运行时那份内存库（preload 里 `NOVAWAY_DB=:memory:`），因为它测的是存储层的行为，
 * 不是 DDL。
 */

const target = "20261105000001_plugin_host"

function journal(dir = path.join(import.meta.dirname, "../../migration")) {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      name: entry.name,
      timestamp: Number(entry.name.split("_")[0]),
      sql: readFileSync(path.join(dir, entry.name, "migration.sql"), "utf-8"),
    }))
    .sort((a, b) => a.timestamp - b.timestamp)
}

function open() {
  const sqlite = new Sqlite(":memory:")
  sqlite.run("PRAGMA foreign_keys = ON")
  return { sqlite, db: drizzle({ client: sqlite }) }
}

function tables(sqlite: Sqlite) {
  return sqlite
    .query<{ name: string }, []>(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`)
    .all()
    .map((row) => row.name)
}

/**
 * 主键列按 pk 序号排出来：复合主键「是不是那几列、顺序对不对」是这次迁移唯一要证明的结构。
 *
 * 参数必须传给 `.all(...)` 而不是 `query(sql, params)`——后者的数组被 bun 静默忽略，
 * 结果是空表而不是报错，断言会假绿。
 */
function primaryKeys(sqlite: Sqlite, table: string) {
  return sqlite
    .query<{ name: string; pk: number }, [string]>(`SELECT name, pk FROM pragma_table_info(?)`)
    .all(table)
    .filter((row) => row.pk > 0)
    .sort((a, b) => a.pk - b.pk)
    .map((row) => row.name)
}

const created = ["plugin_kv", "plugin_migration", "plugin_state"]

/** 越权的证据是错误分类，不是文本：拿 `code` 断言，改措辞不会把用例弄红。 */
function reject(run: () => unknown) {
  try {
    run()
  } catch (error) {
    if (isPluginError(error)) return error
    throw error
  }
  throw new Error("预期抛 storage_conflict，实际没抛")
}

describe("迁移（§12.1）", () => {
  test("空库：三张表建出来，且主键是复合键", () => {
    const { sqlite, db } = open()
    migrate(db, journal())
    expect(tables(sqlite).filter((name) => created.includes(name))).toEqual(created)
    expect(primaryKeys(sqlite, "plugin_state")).toEqual(["plugin_id", "scope", "instance_key"])
    expect(primaryKeys(sqlite, "plugin_kv")).toEqual(["plugin_id", "namespace", "key"])
    expect(primaryKeys(sqlite, "plugin_migration")).toEqual(["plugin_id", "namespace", "version"])
  })

  test("旧库：先跑到我这一步之前，再补齐——旧表不受影响", () => {
    const entries = journal()
    const index = entries.findIndex((entry) => entry.name === target)
    expect(index).toBeGreaterThan(0)

    const { sqlite, db } = open()
    migrate(db, entries.slice(0, index))
    expect(tables(sqlite).some((name) => created.includes(name))).toBe(false)
    sqlite.run(
      `INSERT INTO project (id, worktree, vcs, name, time_created, time_updated, sandboxes) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ["project_1", "/tmp/project", "git", "project", 1, 1, "[]"],
    )

    expect(() => migrate(db, entries.slice(index))).not.toThrow()
    expect(tables(sqlite).filter((name) => created.includes(name))).toEqual(created)
    expect(sqlite.query(`SELECT id FROM project WHERE id = ?`).get("project_1")).toEqual({ id: "project_1" })
  })

  test("instance-identity migration preserves existing state without assigning it to an arbitrary project", () => {
    const entries = journal()
    const index = entries.findIndex((entry) => entry.name === "20261108000000_plugin_instance_identity")
    expect(index).toBeGreaterThan(0)
    const { sqlite, db } = open()
    migrate(db, entries.slice(0, index))
    sqlite.run(
      `INSERT INTO plugin_state (plugin_id, scope, source, enabled, status, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
      ["existing", "project", "/old/plugin", 0, "failed", 42],
    )
    migrate(db, entries.slice(index))
    expect(sqlite.query(`SELECT plugin_id, instance_key, enabled, status, updated_at FROM plugin_state`).all()).toEqual([
      { plugin_id: "existing", instance_key: "", enabled: 0, status: "failed", updated_at: 42 },
    ])
  })

  test("重复执行：对同一个库再放一遍全量 journal 不报错、不重复建表", () => {
    const { sqlite, db } = open()
    migrate(db, journal())
    const before = tables(sqlite)
    expect(() => migrate(db, journal())).not.toThrow()
    expect(tables(sqlite)).toEqual(before)
    expect(tables(sqlite).filter((name) => created.includes(name))).toEqual(created)
  })
})

describe("plugin_state（§10.1 / §4.9）", () => {
  test("project plugin state is isolated between directory instances", () => {
    PluginStorage.save({ pluginID: "instance-split", scope: "project", instanceKey: "/left", source: "same-plugin" })
    PluginStorage.save({ pluginID: "instance-split", scope: "project", instanceKey: "/right", source: "same-plugin" })
    PluginStorage.setEnabled("instance-split", "project", false, "/left")
    PluginStorage.setStatus("instance-split", "project", "failed", undefined, "/left")

    expect(PluginStorage.get("instance-split", "project", "/left")).toMatchObject({ enabled: 0, status: "failed" })
    expect(PluginStorage.get("instance-split", "project", "/right")).toMatchObject({
      enabled: 1,
      status: "installed",
    })
    expect(PluginStorage.listForInstance("/left").filter((row) => row.plugin_id === "instance-split")).toHaveLength(1)
    expect(PluginStorage.listForInstance("/right").filter((row) => row.plugin_id === "instance-split")).toHaveLength(1)
    PluginStorage.uninstall("instance-split", false)
  })

  test("同一插件的 global 与 project 两行互相独立（§10.5）", () => {
    PluginStorage.save({ pluginID: "acme", scope: "global", source: "acme@1.0.0" })
    PluginStorage.save({ pluginID: "acme", scope: "project", source: "acme@1.0.0" })

    PluginStorage.setEnabled("acme", "global", false)
    expect(PluginStorage.get("acme", "global")?.enabled).toBe(0)
    expect(PluginStorage.get("acme", "project")?.enabled).toBe(1)

    PluginStorage.setStatus("acme", "project", "failed", { code: "activation_failed", message: "boom", at: 5 })
    expect(PluginStorage.get("acme", "project")?.status).toBe("failed")
    expect(PluginStorage.get("acme", "global")?.status).toBe("installed")
    expect(PluginStorage.list("global").map((row) => row.plugin_id)).toEqual(["acme"])
  })

  test("再写入不清空未传的列：分批写同一行的任何一方都不该抹掉别人的数据", () => {
    PluginStorage.save({
      pluginID: "batched",
      scope: "global",
      source: "batched@1.0.0",
      fingerprint: "sha256:abc",
      overrides: ["builtin.knowledge"],
    })
    PluginStorage.save({ pluginID: "batched", scope: "global", source: "batched@1.1.0", version: "1.1.0" })

    const hit = PluginStorage.get("batched", "global")
    expect(hit?.version).toBe("1.1.0")
    expect(hit?.fingerprint).toBe("sha256:abc")
    expect(hit?.overrides).toEqual(["builtin.knowledge"])
  })

  test("installed_at 只在第一次写入落地：排序键 2 不能随更新漂移", () => {
    const first = PluginStorage.save({ pluginID: "stable", scope: "global", source: "stable@1.0.0" })
    const again = PluginStorage.save({ pluginID: "stable", scope: "global", source: "stable@1.0.0" })
    expect(again.installed_at).toBe(first.installed_at)
  })

  test("install_order 发出去的号比现存所有行都大：新装的排在后面，卸载最大号后槽位回收", () => {
    const a = PluginStorage.nextInstallOrder()
    PluginStorage.save({ pluginID: "order_a", scope: "global", source: "a", installOrder: a })
    const b = PluginStorage.nextInstallOrder()
    expect(b).toBe(a + 1)

    PluginStorage.save({ pluginID: "order_b", scope: "global", source: "b", installOrder: b })
    PluginStorage.uninstall("order_b", false)
    // 回收的是刚腾出来的最大号，不是 a：现存行里最大的还是 a，所以新实例仍然排在 a 之后。
    expect(PluginStorage.nextInstallOrder()).toBe(b)
    PluginStorage.save({
      pluginID: "order_c",
      scope: "global",
      source: "c",
      installOrder: PluginStorage.nextInstallOrder(),
    })
    expect(
      PluginStorage.list()
        .filter((row) => row.plugin_id.startsWith("order_"))
        .map((row) => row.plugin_id),
    ).toEqual(["order_a", "order_c"])
    PluginStorage.uninstall("order_a", false)
    PluginStorage.uninstall("order_c", false)
  })

  test("session lifecycle state is not persisted", () => {
    const error = reject(() => PluginStorage.save({ pluginID: "ephemeral", scope: "session", source: "ephemeral" }))
    expect(error.code).toBe("storage_conflict")
    expect(PluginStorage.list("session")).toEqual([])
  })

  test("list 按 install_order 升序（§4.9 排序键 2）", () => {
    const base = PluginStorage.nextInstallOrder()
    PluginStorage.save({ pluginID: "late", scope: "builtin", source: "late", installOrder: base + 1 })
    PluginStorage.save({ pluginID: "early", scope: "builtin", source: "early", installOrder: base })
    expect(PluginStorage.list("builtin").map((row) => row.plugin_id)).toEqual(["early", "late"])
    PluginStorage.uninstall("late", false)
    PluginStorage.uninstall("early", false)
  })

  test("save can explicitly clear an old error after successful activation", () => {
    PluginStorage.save({
      pluginID: "clear-error",
      scope: "global",
      source: "clear-error",
      lastError: { code: "activation_failed", message: "old", at: 1 },
    })
    PluginStorage.save({ pluginID: "clear-error", scope: "global", source: "clear-error", lastError: null })
    expect(PluginStorage.get("clear-error", "global")?.last_error).toBeNull()
    PluginStorage.uninstall("clear-error", false)
  })

  test("setStatus 不带错误就清掉 last_error：修好的插件不该继续显示旧故障", () => {
    PluginStorage.save({ pluginID: "recovering", scope: "global", source: "recovering" })
    PluginStorage.setStatus("recovering", "global", "failed", { code: "transport", message: "L1 崩了", at: 1 })
    expect(PluginStorage.get("recovering", "global")?.last_error?.code).toBe("transport")

    PluginStorage.setStatus("recovering", "global", "active")
    const hit = PluginStorage.get("recovering", "global")
    expect(hit?.last_error).toBeNull()
    expect(hit?.activated_at).toBeNumber()
  })

  test("uninstall 跨 scope 删状态与台账；purge 才动 KV", () => {
    PluginStorage.save({ pluginID: "bye", scope: "global", source: "bye" })
    PluginStorage.save({ pluginID: "bye", scope: "project", source: "bye" })
    PluginStorage.markMigration("bye", "bye", 1)
    PluginStorage.openKv({ pluginID: "bye", declared: "bye" }).set("keep", 1)

    PluginStorage.uninstall("bye", false)
    expect(PluginStorage.list().filter((row) => row.plugin_id === "bye")).toEqual([])
    expect(PluginStorage.appliedMigrations("bye", "bye")).toEqual([])
    expect(PluginStorage.openKv({ pluginID: "bye", declared: "bye" }).get("keep")).toBe(1)

    PluginStorage.uninstall("bye", true)
    expect(PluginStorage.openKv({ pluginID: "bye", declared: "bye" }).get("keep")).toBeUndefined()
  })
})

describe("plugin_kv 越权（§5.4）", () => {
  test("未声明的 namespace 直接抛 storage_conflict：写不进去也读不出来", () => {
    const error = reject(() => PluginStorage.openKv({ pluginID: "acme", declared: "acme", namespace: "acme_backup" }))
    expect(error.code).toBe("storage_conflict")
    expect(error.pluginID).toBe("acme")
    expect(error.contributionID).toBe("acme_backup")
    expect(error.message).toMatch(/storage\.namespace/)
  })

  test("默认 namespace：manifest 没声明时用 default，而不是随便一个都能写", () => {
    const store = PluginStorage.openKv({ pluginID: "quiet" })
    expect(store.namespace).toBe("default")
    store.set("n", { a: 1 })
    expect(store.get("n")).toEqual({ a: 1 })
    expect(() => PluginStorage.openKv({ pluginID: "quiet", namespace: "declared" })).toThrow(/storage.namespace/)
    store.clear()
  })

  test("A 的句柄读不到 B 的键，即使 key 同名", () => {
    PluginStorage.openKv({ pluginID: "left", declared: "left" }).set("shared", "mine")
    const right = PluginStorage.openKv({ pluginID: "right", declared: "right" })
    expect(right.get("shared")).toBeUndefined()
    right.set("shared", "theirs")
    expect(PluginStorage.openKv({ pluginID: "left", declared: "left" }).get("shared")).toBe("mine")
    PluginStorage.uninstall("left", true)
    PluginStorage.uninstall("right", true)
  })

  test("同键不同 namespace 不互相覆盖", () => {
    const a = PluginStorage.openKv({ pluginID: "multi", declared: "multi" })
    const b = PluginStorage.openKv({ pluginID: "multi", declared: "multi_cache" })
    a.set("k", "one")
    b.set("k", "two")
    expect(a.get("k")).toBe("one")
    expect(b.get("k")).toBe("two")
    expect(a.clear()).toBe(1)
    expect(b.entries().map((entry) => entry.key)).toEqual(["k"])
    b.clear()
  })

  test("值原样回来：对象、数组、null 与 undefined 的区分", () => {
    const store = PluginStorage.openKv({ pluginID: "values", declared: "values" })
    store.set("object", { nested: [1, 2] })
    store.set("array", [1, 2])
    store.set("null", null)
    store.set("dropped", undefined)
    expect(store.get("object")).toEqual({ nested: [1, 2] })
    expect(store.get("array")).toEqual([1, 2])
    expect(store.get("null")).toBeNull()
    // 写 undefined 等于写 null：KV 没有「存了个 undefined」和「没存」两种可区分状态，
    // 靠 remove/get 的 undefined 判断存在性，不靠值。
    expect(store.get("dropped")).toBeNull()
    expect(store.remove("dropped")).toBe(true)
    expect(store.remove("dropped")).toBe(false)
    store.clear()
  })

  test("重复 set 覆盖同一个键，entries 按 key 升序（诊断页要稳定顺序）", () => {
    const store = PluginStorage.openKv({ pluginID: "sorted", declared: "sorted" })
    for (const key of ["beta", "alpha", "gamma"]) store.set(key, key)
    store.set("alpha", "updated")
    expect(store.entries().map((entry) => entry.key)).toEqual(["alpha", "beta", "gamma"])
    expect(store.get("alpha")).toBe("updated")
    store.clear()
  })
})

describe("plugin_migration 台账（§12.2）", () => {
  test("按版本升序记，重复 mark 幂等", () => {
    PluginStorage.markMigration("ledger", "ledger", 2)
    PluginStorage.markMigration("ledger", "ledger", 1)
    PluginStorage.markMigration("ledger", "ledger", 2)
    expect(PluginStorage.appliedMigrations("ledger", "ledger")).toEqual([1, 2])
  })

  test("namespace 之间互不可见：迁移账本也是隔离单位", () => {
    PluginStorage.markMigration("split", "one", 1)
    expect(PluginStorage.appliedMigrations("split", "two")).toEqual([])
    PluginStorage.uninstall("split", false)
  })
})
