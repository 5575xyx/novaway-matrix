import { pluginError, type PluginScope, type PluginStatus } from "@novaway/plugin-api"
import { Database } from "@/storage/db"
import { and, asc, eq, or, sql } from "drizzle-orm"
import {
  PluginKvTable,
  PluginMigrationTable,
  PluginStateTable,
  type PluginErrorRecord,
  type PluginPermissions,
} from "./state.sql"

/**
 * 插件宿主的存储层（§12、§14.3 第 7 步）。
 *
 * 这一层只回答三个问题：实例状态存在哪、插件的 KV 怎么隔离、插件自带的迁移记在哪。
 * 状态机怎么迁移是 Host（第 4 步）的规则，插件 SQL 怎么执行是激活链路（第 8 步之后）的事，
 * 这里只给它记台账。
 *
 * 全部同步走 `Database.use`，和仓库里其它读 `*.sql.ts` 的模块一致：启停是「点了就要生效」
 * 的动作，包一层 Effect 只会让 `/plugin` 路由和 Host 各写一遍同样的拆装逻辑。
 */

export type State = typeof PluginStateTable.$inferSelect

type Db = Parameters<Parameters<typeof Database.use>[0]>[0]

export type Save = {
  pluginID: string
  scope: PluginScope
  /** Canonical directory for project instances; empty for global/builtin. */
  instanceKey?: string
  source: string
  root?: string | null
  version?: string | null
  fingerprint?: string | null
  enabled?: boolean
  status?: PluginStatus
  installOrder?: number | null
  overrides?: string[] | null
  permissions?: PluginPermissions | null
  lastError?: PluginErrorRecord | null
  activatedAt?: number | null
  installedAt?: number | null
}

/** `updated_at` 由这一层统一盖：漏一次，诊断页的「最后变更时间」就永远骗人。 */
function stamp() {
  return Date.now()
}

/**
 * 未显式传入的字段沿用旧值：状态行会被 Host、`/plugin`、激活链路分批写，
 * 每次写入都清空未传字段的话，后写的一方会把前一方刚落的 fingerprint 抹掉。
 */
function row(input: Save, existing: State | undefined) {
  const at = stamp()
  const enabled = input.enabled ?? (existing === undefined ? true : existing.enabled === 1)
  return {
    plugin_id: input.pluginID,
    scope: input.scope,
    instance_key: input.instanceKey ?? "",
    source: input.source,
    root: input.root ?? existing?.root ?? null,
    version: input.version ?? existing?.version ?? null,
    fingerprint: input.fingerprint ?? existing?.fingerprint ?? null,
    enabled: enabled ? 1 : 0,
    status: input.status ?? existing?.status ?? ("installed" satisfies PluginStatus),
    install_order: input.installOrder ?? existing?.install_order ?? null,
    overrides: input.overrides ?? existing?.overrides ?? null,
    permissions: input.permissions ?? existing?.permissions ?? null,
    last_error: input.lastError === undefined ? (existing?.last_error ?? null) : input.lastError,
    activated_at: input.activatedAt ?? existing?.activated_at ?? null,
    // 排序键第 2 位（§4.9）：只有第一次写入才算「装上的时间」，之后不随更新漂移。
    installed_at: input.installedAt ?? existing?.installed_at ?? at,
    updated_at: at,
  }
}

function identity(pluginID: string, scope: PluginScope, instanceKey = "") {
  return and(
    eq(PluginStateTable.plugin_id, pluginID),
    eq(PluginStateTable.scope, scope),
    eq(PluginStateTable.instance_key, instanceKey),
  )
}

function find(db: Db, pluginID: string, scope: PluginScope, instanceKey = "") {
  return db.select().from(PluginStateTable).where(identity(pluginID, scope, instanceKey)).get()
}

/** 写入或覆盖一个实例的状态行，返回落库后的行。 */
export function save(input: Save): State {
  if (input.scope === "session") {
    throw pluginError("storage_conflict", "session 插件生命周期状态只保留在 Host 内存，不写 plugin_state", {
      pluginID: input.pluginID,
    })
  }
  return Database.use((db) => {
    const next = row(input, find(db, input.pluginID, input.scope, input.instanceKey))
    db.insert(PluginStateTable)
      .values(next)
      .onConflictDoUpdate({
        target: [PluginStateTable.plugin_id, PluginStateTable.scope, PluginStateTable.instance_key],
        set: next,
      })
      .run()
    return next
  })
}

export function get(pluginID: string, scope: PluginScope, instanceKey = ""): State | undefined {
  return Database.use((db) => find(db, pluginID, scope, instanceKey))
}

/**
 * 某个 scope 之下的全部实例（不给 scope 就是全量）。
 *
 * `session` scope 不落库（§12.1 最后一句），所以这里查不到它：内存里那份由 Host 自己带着，
 * 拼装在 Host 侧做，不在这层假装两边是一张表。
 */
export function list(scope?: PluginScope): State[] {
  return Database.use((db) =>
    db
      .select()
      .from(PluginStateTable)
      .where(scope === undefined ? undefined : eq(PluginStateTable.scope, scope))
      .orderBy(asc(PluginStateTable.install_order))
      .all(),
  )
}

/** Global/builtin state plus only the requested project's state. */
export function listForInstance(instanceKey: string): State[] {
  return Database.use((db) =>
    db
      .select()
      .from(PluginStateTable)
      .where(
        or(
          and(eq(PluginStateTable.scope, "project"), eq(PluginStateTable.instance_key, instanceKey)),
          and(
            eq(PluginStateTable.instance_key, ""),
            or(eq(PluginStateTable.scope, "global"), eq(PluginStateTable.scope, "builtin")),
          ),
        ),
      )
      .orderBy(asc(PluginStateTable.install_order))
      .all(),
  )
}

export function setEnabled(pluginID: string, scope: PluginScope, enabled: boolean, instanceKey = ""): void {
  Database.use((db) =>
    db
      .update(PluginStateTable)
      .set({ enabled: enabled ? 1 : 0, updated_at: stamp() })
      .where(identity(pluginID, scope, instanceKey))
      .run(),
  )
}

/**
 * 状态与错误一起写（§10.1 每个非 `disabled` 状态都答得出「为什么」），分开调用必有一半忘带错误。
 *
 * 传 error 表示「就是这次失败导致的这个状态」；不传则清掉 `last_error`——从 `failed`
 * 回到 `installed` 却留着旧错误，诊断页会把已修好的插件说成坏的。
 */
export function setStatus(
  pluginID: string,
  scope: PluginScope,
  status: PluginStatus,
  error?: PluginErrorRecord,
  instanceKey = "",
): void {
  Database.use((db) =>
    db
      .update(PluginStateTable)
      .set({
        status,
        last_error: error ?? null,
        activated_at: status === "active" ? stamp() : undefined,
        updated_at: stamp(),
      })
      .where(identity(pluginID, scope, instanceKey))
      .run(),
  )
}

/**
 * 排序键第 2 位（§4.9）：发出去的号比当前所有实例都大，所以新装的永远排在后面。
 *
 * 卸载掉最大号之后这个槽会被回收——只要不发比现存行小的号就行，回收空槽不影响现存行的相对顺序。
 */
export function nextInstallOrder(): number {
  return Database.use((db) => {
    const max = db
      .select({ value: sql<number | null>`max(${PluginStateTable.install_order})` })
      .from(PluginStateTable)
      .get()
    return (max?.value ?? 0) + 1
  })
}

/**
 * 卸载：状态行与迁移台账跨 scope 一起删（卸载是插件级动作，不是实例级），
 * KV 只在 `purge` 时删——§11 表格里「重装后配置还在」靠的就是这个开关。
 */
export function uninstall(pluginID: string, purge: boolean): void {
  Database.use((db) => {
    db.delete(PluginStateTable).where(eq(PluginStateTable.plugin_id, pluginID)).run()
    db.delete(PluginMigrationTable).where(eq(PluginMigrationTable.plugin_id, pluginID)).run()
    if (purge) db.delete(PluginKvTable).where(eq(PluginKvTable.plugin_id, pluginID)).run()
  })
}

export type KvEntry = { key: string; value: unknown; updatedAt: number }

/**
 * 绑定到一个 (pluginID, namespace) 的 KV 句柄（§5.4）。
 *
 * 越权写入被拒靠的是**句柄不接受 pluginID 参数**：调用它的人只有拿到别人 pluginID 才能越界，
 * 而 pluginID 是宿主在构造 context 时绑定的（第 8 步）。剩下的越权路径只有 namespace，
 * 所以 namespace 必须在 manifest 的 `contributes.storage.namespace`（§7.4）里声明过。
 * 两个方向都封住，才谈得上「A 插件读不到 B 插件的键」。
 */
export type Kv = {
  readonly namespace: string
  get(key: string): unknown
  set(key: string, value: unknown): void
  remove(key: string): boolean
  entries(): KvEntry[]
  clear(): number
}

export function openKv(input: { pluginID: string; declared?: string; namespace?: string }): Kv {
  const allowed = input.declared ?? "default"
  const namespace = input.namespace ?? allowed
  if (namespace !== allowed) {
    throw pluginError(
      "storage_conflict",
      `namespace "${namespace}" 未在 manifest 的 storage.namespace 声明（当前是 "${allowed}"）`,
      {
        pluginID: input.pluginID,
        contributionID: namespace,
      },
    )
  }
  const bound = and(eq(PluginKvTable.plugin_id, input.pluginID), eq(PluginKvTable.namespace, namespace))
  return {
    namespace,
    get(key) {
      return Database.use((db) => {
        const hit = db
          .select()
          .from(PluginKvTable)
          .where(and(bound, eq(PluginKvTable.key, key)))
          .get()
        return hit === undefined ? undefined : decode(hit.value)
      })
    },
    set(key, value) {
      const text = encode(value)
      Database.use((db) =>
        db
          .insert(PluginKvTable)
          .values({ plugin_id: input.pluginID, namespace, key, value: text, updated_at: stamp() })
          .onConflictDoUpdate({
            target: [PluginKvTable.plugin_id, PluginKvTable.namespace, PluginKvTable.key],
            set: { value: text, updated_at: stamp() },
          })
          .run(),
      )
    },
    remove(key) {
      // 这个 drizzle 驱动的 `run()` 不带 `changes`，所以先查再删：多一次读，换来「删没删掉」可判定。
      return Database.use((db) => {
        const hit = db
          .select({ id: PluginKvTable.plugin_id })
          .from(PluginKvTable)
          .where(and(bound, eq(PluginKvTable.key, key)))
          .get()
        if (hit === undefined) return false
        db.delete(PluginKvTable)
          .where(and(bound, eq(PluginKvTable.key, key)))
          .run()
        return true
      })
    },
    entries() {
      return Database.use((db) =>
        db
          .select()
          .from(PluginKvTable)
          .where(bound)
          .orderBy(asc(PluginKvTable.key))
          .all()
          .map((hit) => ({ key: hit.key, value: decode(hit.value), updatedAt: hit.updated_at })),
      )
    },
    clear() {
      return Database.use((db) => {
        const count = db
          .select({ value: sql<number>`count(*)` })
          .from(PluginKvTable)
          .where(bound)
          .get()
        const removed = count?.value ?? 0
        if (removed > 0) db.delete(PluginKvTable).where(bound).run()
        return removed
      })
    },
  }
}

/** 迁移台账（§12.2）：跑过的不重跑、失败的查得到。执行 SQL 在激活链路里接。 */
export function appliedMigrations(pluginID: string, namespace: string): number[] {
  return Database.use((db) =>
    db
      .select()
      .from(PluginMigrationTable)
      .where(and(eq(PluginMigrationTable.plugin_id, pluginID), eq(PluginMigrationTable.namespace, namespace)))
      .orderBy(asc(PluginMigrationTable.version))
      .all()
      .map((hit) => hit.version),
  )
}

/** 幂等：重放同一个版本号不改 `applied_at`，免得一次崩溃让「什么时候迁移的」变成噪音。 */
export function markMigration(pluginID: string, namespace: string, version: number): void {
  Database.use((db) =>
    db
      .insert(PluginMigrationTable)
      .values({ plugin_id: pluginID, namespace, version, applied_at: stamp() })
      .onConflictDoNothing()
      .run(),
  )
}

function encode(value: unknown) {
  return JSON.stringify(value === undefined ? null : value)
}

function decode(text: string) {
  return JSON.parse(text) as unknown
}

export * as PluginStorage from "./storage"
