import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core"
import type { PluginErrorCode, PluginScope, PluginStatus } from "@novaway/plugin-api"

/**
 * 插件宿主的三张内核表（§12.1）。
 *
 * 主键是 `(plugin_id, scope, instance_key)`：项目插件还必须按目录实例隔离，
 * 不能让两个项目里同名插件的启停、错误或权限互相覆盖。global/builtin 的 instance_key 为空串。
 *
 * `session` scope 的行不落库（§12.1 最后一句），只在内存；列里保留这个取值是为了让
 * `PluginScope` 类型能直接标在列上，不用到处再窄化一次。
 */

/** §5.5 的错误模型落到行上：诊断页要能分类，不能只有一段人话。 */
export type PluginErrorRecord = { code: PluginErrorCode; message: string; at: number }

/** 已批准的权限（§10.7）：形状由 capability 侧决定，内核只负责原样存回去。 */
export type PluginPermissions = Record<string, unknown>

export const PluginStateTable = sqliteTable(
  "plugin_state",
  {
    plugin_id: text().notNull(),
    scope: text().$type<PluginScope>().notNull(),
    /** InstanceState 的 canonical directory；global/builtin 使用空串。 */
    instance_key: text().notNull().default(""),
    /** 安装来源（npm spec / git spec / 本地路径 / 内置名）；§13.1 的三个适配器也写这里。 */
    source: text().notNull(),
    root: text(),
    version: text(),
    /** 内容哈希：变了就要重算贡献（§12.1）。 */
    fingerprint: text(),
    enabled: integer().notNull().default(1),
    status: text().$type<PluginStatus>().notNull().default("installed"),
    /** 排序键第 2 位（§4.9）；`installed_at` 是它的来源，这里存的是实际生效序号。 */
    install_order: integer(),
    overrides: text({ mode: "json" }).$type<string[]>(),
    permissions: text({ mode: "json" }).$type<PluginPermissions>(),
    last_error: text({ mode: "json" }).$type<PluginErrorRecord>(),
    activated_at: integer(),
    installed_at: integer(),
    updated_at: integer().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.plugin_id, table.scope, table.instance_key] }),
    index("plugin_state_status_idx").on(table.status),
  ],
)

/**
 * 插件自己的 KV。
 *
 * `plugin_id` 是**边界**，不是查询条件：存储层绑定了 pluginID 之后，插件无法把它作为参数
 * 传进来（§5.4「写入时校验 namespace 属于当前插件」）。越权路径只剩 namespace 一个，
 * 所以 `storage.ts` 用 manifest 声明的 `storage.namespace` 收口。
 */
export const PluginKvTable = sqliteTable(
  "plugin_kv",
  {
    plugin_id: text().notNull(),
    namespace: text().notNull().default("default"),
    key: text().notNull(),
    value: text().notNull(),
    updated_at: integer().notNull(),
    // (plugin_id, namespace, key)：namespace 进主键，两个 namespace 下同键不互相覆盖。
  },
  (table) => [primaryKey({ columns: [table.plugin_id, table.namespace, table.key] })],
)

/** 插件自带 SQL 迁移的执行账本（§12.2）：激活前按序执行，失败即 `failed`。 */
export const PluginMigrationTable = sqliteTable(
  "plugin_migration",
  {
    plugin_id: text().notNull(),
    namespace: text().notNull(),
    version: integer().notNull(),
    applied_at: integer().notNull(),
  },
  (table) => [primaryKey({ columns: [table.plugin_id, table.namespace, table.version] })],
)
