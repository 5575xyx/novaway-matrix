import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core"

export const SuperAgentRunTable = sqliteTable(
  "super_agent_run",
  {
    id: text().primaryKey(),
    directory: text().notNull(),
    goal_json: text({ mode: "json" }).notNull(),
    status: text().notNull(),
    graph_json: text({ mode: "json" }).notNull(),
    graph_version: integer().notNull(),
    budget_json: text({ mode: "json" }).notNull(),
    usage_json: text({ mode: "json" }).notNull(),
    checkpoint_id: text(),
    failure_json: text({ mode: "json" }),
    completion_json: text({ mode: "json" }),
    /** Cross-process worker lease. Only the owner may renew/release it. */
    run_owner: text(),
    run_lease_until: integer(),
    time_created: integer().notNull(),
    time_updated: integer().notNull(),
  },
  (table) => [
    index("super_agent_run_directory_idx").on(table.directory, table.time_updated),
    index("super_agent_run_status_idx").on(table.status),
  ],
)

export const SuperAgentEventTable = sqliteTable(
  "super_agent_event",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    event_id: text().notNull(),
    run_id: text()
      .notNull()
      .references(() => SuperAgentRunTable.id, { onDelete: "cascade" }),
    sequence: integer().notNull(),
    protocol_version: text().notNull(),
    idempotency_key: text(),
    type: text().notNull(),
    payload_json: text({ mode: "json" }).notNull(),
    time_created: integer().notNull(),
  },
  (table) => [
    uniqueIndex("super_agent_event_sequence_idx").on(table.run_id, table.sequence),
    uniqueIndex("super_agent_event_id_idx").on(table.event_id),
    uniqueIndex("super_agent_event_idempotency_idx").on(table.run_id, table.idempotency_key),
    index("super_agent_event_run_idx").on(table.run_id, table.time_created),
  ],
)

export const SuperAgentEventOutboxTable = sqliteTable(
  "super_agent_event_outbox",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    event_id: text().notNull(),
    run_id: text()
      .notNull()
      .references(() => SuperAgentRunTable.id, { onDelete: "cascade" }),
    sequence: integer().notNull(),
    type: text().notNull(),
    payload_json: text({ mode: "json" }).notNull(),
    status: text().notNull(),
    attempts: integer().notNull().default(0),
    next_attempt_at: integer().notNull().default(0),
    last_error: text(),
    time_created: integer().notNull(),
    time_updated: integer().notNull(),
  },
  (table) => [
    uniqueIndex("super_agent_event_outbox_event_idx").on(table.event_id),
    index("super_agent_event_outbox_pending_idx").on(table.run_id, table.status, table.id),
  ],
)
export const SuperAgentTaskMutationTable = sqliteTable(
  "super_agent_task_mutation",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    run_id: text()
      .notNull()
      .references(() => SuperAgentRunTable.id, { onDelete: "cascade" }),
    graph_version: integer().notNull(),
    task_id: text().notNull(),
    from_status: text(),
    to_status: text().notNull(),
    before_json: text({ mode: "json" }),
    after_json: text({ mode: "json" }).notNull(),
    time_created: integer().notNull(),
  },
  (table) => [
    index("super_agent_task_mutation_run_idx").on(table.run_id, table.id),
    index("super_agent_task_mutation_task_idx").on(table.run_id, table.task_id, table.id),
  ],
)

export const SuperAgentCheckpointTable = sqliteTable(
  "super_agent_checkpoint",
  {
    id: text().primaryKey(),
    run_id: text()
      .notNull()
      .references(() => SuperAgentRunTable.id, { onDelete: "cascade" }),
    reason: text().notNull(),
    event_sequence: integer().notNull(),
    state_version: integer().notNull(),
    snapshot_json: text({ mode: "json" }).notNull(),
    time_created: integer().notNull(),
  },
  (table) => [index("super_agent_checkpoint_run_idx").on(table.run_id, table.time_created)],
)

export const SuperAgentApprovalTable = sqliteTable(
  "super_agent_approval",
  {
    id: text().primaryKey(),
    run_id: text()
      .notNull()
      .references(() => SuperAgentRunTable.id, { onDelete: "cascade" }),
    task_id: text().notNull(),
    reason: text().notNull(),
    scope: text().notNull(),
    status: text().notNull(),
    decided_by: text(),
    decision_reason: text(),
    time_expires: integer(),
    time_created: integer().notNull(),
    time_updated: integer().notNull(),
  },
  (table) => [index("super_agent_approval_run_idx").on(table.run_id, table.time_updated)],
)

export const SuperAgentInputTable = sqliteTable(
  "super_agent_input",
  {
    id: text().primaryKey(),
    run_id: text()
      .notNull()
      .references(() => SuperAgentRunTable.id, { onDelete: "cascade" }),
    task_id: text().notNull(),
    prompt: text().notNull(),
    status: text().notNull(),
    answer: text(),
    time_created: integer().notNull(),
    time_updated: integer().notNull(),
  },
  (table) => [index("super_agent_input_run_idx").on(table.run_id, table.time_updated)],
)

export const SuperAgentBudgetReservationTable = sqliteTable(
  "super_agent_budget_reservation",
  {
    id: text().primaryKey(),
    run_id: text()
      .notNull()
      .references(() => SuperAgentRunTable.id, { onDelete: "cascade" }),
    requested_json: text({ mode: "json" }).notNull(),
    settled_json: text({ mode: "json" }),
    status: text().notNull(),
    time_created: integer().notNull(),
    time_updated: integer().notNull(),
  },
  (table) => [index("super_agent_budget_reservation_run_idx").on(table.run_id, table.time_updated)],
)

export const SuperAgentEvidenceTable = sqliteTable(
  "super_agent_evidence",
  {
    id: text().primaryKey(),
    run_id: text()
      .notNull()
      .references(() => SuperAgentRunTable.id, { onDelete: "cascade" }),
    task_id: text().notNull(),
    kind: text().notNull(),
    source: text().notNull(),
    acceptance_ids_json: text({ mode: "json" }),
    content_hash: text(),
    measured: text(),
    time_expires: integer(),
    time_captured: integer().notNull(),
  },
  (table) => [index("super_agent_evidence_run_idx").on(table.run_id, table.time_captured)],
)

export const SuperAgentOperationTable = sqliteTable(
  "super_agent_operation",
  {
    id: text().primaryKey(),
    run_id: text()
      .notNull()
      .references(() => SuperAgentRunTable.id, { onDelete: "cascade" }),
    instruction_id: text().notNull(),
    idempotency_key: text().notNull(),
    status: text().notNull(),
    lease_until: integer().notNull(),
    time_started: integer().notNull(),
    time_updated: integer().notNull(),
    result_json: text({ mode: "json" }),
    reason: text(),
  },
  (table) => [
    uniqueIndex("super_agent_operation_idempotency_idx").on(table.run_id, table.idempotency_key),
    index("super_agent_operation_run_idx").on(table.run_id, table.time_updated),
    index("super_agent_operation_lease_idx").on(table.status, table.lease_until),
  ],
)

export const SuperAgentVerificationTable = sqliteTable(
  "super_agent_verification",
  {
    id: text().primaryKey(),
    run_id: text()
      .notNull()
      .references(() => SuperAgentRunTable.id, { onDelete: "cascade" }),
    task_id: text(),
    acceptance_id: text().notNull(),
    verifier_id: text().notNull(),
    verifier_version: text().notNull(),
    outcome: text().notNull(),
    measured: text(),
    evidence_json: text({ mode: "json" }).notNull(),
    reason: text().notNull(),
    time_created: integer().notNull(),
  },
  (table) => [index("super_agent_verification_run_idx").on(table.run_id, table.time_created)],
)
