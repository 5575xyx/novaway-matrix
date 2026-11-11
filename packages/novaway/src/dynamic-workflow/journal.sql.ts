/**
 * 四张表：一次 run 的全部事实。
 *
 * 为什么不用现有的 `workflow` / `workflow_run`：那两张表存的是「步骤配置 + 一份 state JSON」，
 * 语义是 DAG 快照。恢复需要的是**逐节点 journal**——哪个实例已经跑完、它的结果是什么、
 * 事件按什么顺序发生。把两者混在一张表里，恢复时会多出第二个真相。`dwf_` 前缀让它们
 * 互不干扰，旧的 workflow 工具照常工作。
 *
 * 窄行的理由（`result_json` 之外几乎都是定长字段）：所有读取都按
 * `(run_id, site_id, ordinal)` 或 `(run_id, sequence)` 走索引，任何一张表都不做全表加载。
 */

import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core"

export const RunTable = sqliteTable(
  "dwf_run",
  {
    id: text().primaryKey(),
    parent_session_id: text(),
    cwd: text().notNull(),
    name: text(),
    script_text: text().notNull(),
    /** `fnv1a(scriptText)`。恢复前必须与当前脚本一致，否则缓存答案会张冠李戴。 */
    script_hash: text().notNull(),
    script_path: text(),
    args_json: text(),
    tool_call_id: text(),
    /** 从哪次 run 恢复来的。`NULL` 表示这是第一次生命。 */
    resumed_from: text(),
    caps_max_concurrency: integer().notNull(),
    spent_tokens: integer().notNull().default(0),
    /** `running | completed | errored | stopped`。 */
    status: text().notNull(),
    stop_reason: text(),
    result_json: text(),
    failure_json: text(),
    time_created: integer().notNull(),
    time_updated: integer().notNull(),
  },
  (table) => [
    index("dwf_run_cwd_idx").on(table.cwd, table.time_updated),
    index("dwf_run_session_idx").on(table.parent_session_id, table.time_updated),
  ],
)

export const ActorTable = sqliteTable(
  "dwf_actor",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    run_id: text()
      .notNull()
      .references(() => RunTable.id, { onDelete: "cascade" }),
    site_id: text().notNull(),
    ordinal: integer().notNull(),
    name: text(),
    persona_json: text(),
    /** 常驻子会话。恢复时复用同一个会话，子代理才「记得」上一轮。 */
    session_id: text(),
    resolved_model: text(),
    time_created: integer().notNull(),
  },
  (table) => [uniqueIndex("dwf_actor_site_idx").on(table.run_id, table.site_id, table.ordinal)],
)

export const NodeTable = sqliteTable(
  "dwf_node",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    run_id: text()
      .notNull()
      .references(() => RunTable.id, { onDelete: "cascade" }),
    site_id: text().notNull(),
    ordinal: integer().notNull(),
    /** `ask | world-read | report`。 */
    kind: text().notNull(),
    actor_site_id: text(),
    actor_ordinal: integer(),
    /** 这个 ask 在该子代理序列里排第几。与 `ordinal` 不是一回事：后者是站点到达次数。 */
    actor_seq: integer(),
    phase_name: text(),
    input_hash: text().notNull(),
    input_json: text(),
    /** `running | completed | failed`。 */
    status: text().notNull(),
    result_json: text(),
    error_json: text(),
    stats_json: text(),
    time_created: integer().notNull(),
    time_updated: integer().notNull(),
  },
  (table) => [
    uniqueIndex("dwf_node_instance_idx").on(table.run_id, table.site_id, table.ordinal),
    index("dwf_node_kind_idx").on(table.run_id, table.kind),
  ],
)

export const EventTable = sqliteTable(
  "dwf_event",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    run_id: text()
      .notNull()
      .references(() => RunTable.id, { onDelete: "cascade" }),
    /** 一次 run 内从 1 起连续递增。回放的顺序键。 */
    sequence: integer().notNull(),
    type: text().notNull(),
    payload_json: text().notNull(),
    time_created: integer().notNull(),
  },
  (table) => [uniqueIndex("dwf_event_seq_idx").on(table.run_id, table.sequence)],
)
