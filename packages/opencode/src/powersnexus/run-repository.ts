import * as Database from "@/storage/db"
import { and, asc, desc, eq } from "@/storage/db"
import { Effect, Schema } from "effect"
import { PowersNexusRunStepTable, PowersNexusRunTable, type RunStatus, type StepStatus } from "./run.sql"

export type Run = typeof PowersNexusRunTable.$inferSelect
export type RunStep = typeof PowersNexusRunStepTable.$inferSelect

export class RunRepositoryError extends Schema.TaggedErrorClass<RunRepositoryError>()(
  "PowersNexusRunRepositoryError",
  { code: Schema.String, message: Schema.String },
) {}

function wrap<A>(run: () => A, message: string) {
  return Effect.try({
    try: run,
    catch: (cause) =>
      new RunRepositoryError({
        code: "INTERNAL_WORKFLOW_ERROR",
        message: cause instanceof Error ? cause.message : message,
      }),
  })
}

export const make = Effect.fn("PowersNexus.RunRepository.make")(function* () {
  const createRun = (input: typeof PowersNexusRunTable.$inferInsert) =>
    wrap(
      () => Database.use((db) => db.insert(PowersNexusRunTable).values(input).returning().get()),
      "创建 PowersNexus run 失败",
    )

  const createSteps = (steps: Array<typeof PowersNexusRunStepTable.$inferInsert>) =>
    wrap(
      () => {
        if (steps.length === 0) return []
        return Database.use((db) => db.insert(PowersNexusRunStepTable).values(steps).returning().all())
      },
      "创建 PowersNexus run steps 失败",
    )

  const getRun = (id: string) =>
    wrap(
      () => Database.use((db) => db.select().from(PowersNexusRunTable).where(eq(PowersNexusRunTable.id, id)).get()),
      "读取 PowersNexus run 失败",
    )

  const listRuns = (bindingID: string) =>
    wrap(
      () =>
        Database.use((db) =>
          db
            .select()
            .from(PowersNexusRunTable)
            .where(eq(PowersNexusRunTable.binding_id, bindingID))
            .orderBy(desc(PowersNexusRunTable.time_created))
            .all(),
        ),
      "列出 PowersNexus run 失败",
    )

  const listSteps = (runID: string) =>
    wrap(
      () =>
        Database.use((db) =>
          db
            .select()
            .from(PowersNexusRunStepTable)
            .where(eq(PowersNexusRunStepTable.run_id, runID))
            .orderBy(asc(PowersNexusRunStepTable.sequence))
            .all(),
        ),
      "读取 PowersNexus steps 失败",
    )

  const updateRun = (id: string, values: Partial<Omit<typeof PowersNexusRunTable.$inferInsert, "id">>) =>
    wrap(
      () =>
        Database.use((db) =>
          db
            .update(PowersNexusRunTable)
            .set({ ...values, time_updated: Date.now() })
            .where(eq(PowersNexusRunTable.id, id))
            .returning()
            .get(),
        ),
      "更新 PowersNexus run 失败",
    )

  const updateStep = (id: string, values: Partial<Omit<typeof PowersNexusRunStepTable.$inferInsert, "id">>) =>
    wrap(
      () =>
        Database.use((db) =>
          db
            .update(PowersNexusRunStepTable)
            .set({ ...values, time_updated: Date.now() })
            .where(eq(PowersNexusRunStepTable.id, id))
            .returning()
            .get(),
        ),
      "更新 PowersNexus step 失败",
    )

  const cancelRunningSteps = (runID: string) =>
    wrap(
      () => {
        const now = Date.now()
        return Database.use((db) =>
          db
            .update(PowersNexusRunStepTable)
            .set({ status: "cancelled" satisfies StepStatus, time_ended: now, time_updated: now })
            .where(
              and(
                eq(PowersNexusRunStepTable.run_id, runID),
                eq(PowersNexusRunStepTable.status, "running"),
              ),
            )
            .returning()
            .all(),
        )
      },
      "取消 PowersNexus 运行步骤失败",
    )

  const recoverInterrupted = () =>
    wrap(
      () => {
        const now = Date.now()
        return Database.transaction((db) => {
          db
            .update(PowersNexusRunStepTable)
            .set({ status: "cancelled" satisfies StepStatus, time_ended: now, time_updated: now })
            .where(eq(PowersNexusRunStepTable.status, "running"))
            .run()
          return db
            .update(PowersNexusRunTable)
            .set({
              status: "interrupted" satisfies RunStatus,
              error_code: "RUN_INTERRUPTED",
              time_ended: now,
              time_updated: now,
            })
            .where(eq(PowersNexusRunTable.status, "running"))
            .returning()
            .all()
        })
      },
      "恢复中断的 PowersNexus run 失败",
    )

  const invalidateFingerprints = (bindingID: string) =>
    wrap(
      () => {
        const now = Date.now()
        return Database.use((db) =>
          db
            .update(PowersNexusRunTable)
            .set({
              status: "failed" satisfies RunStatus,
              fingerprint: null,
              error_code: "DELIVERY_FINGERPRINT_INVALID",
              time_updated: now,
            })
            .where(and(eq(PowersNexusRunTable.binding_id, bindingID), eq(PowersNexusRunTable.status, "passed")))
            .returning()
            .all(),
        )
      },
      "使 PowersNexus 交付指纹失效失败",
    )

  return {
    createRun,
    createSteps,
    getRun,
    listRuns,
    listSteps,
    updateRun,
    updateStep,
    cancelRunningSteps,
    recoverInterrupted,
    invalidateFingerprints,
  }
})

export * as PowersNexusRunRepository from "./run-repository"
