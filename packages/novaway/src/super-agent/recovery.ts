import { Effect } from "effect"
import type { Interface as SuperAgentStoreInterface, StoredSuperAgentRun } from "./store"
import type { SuperAgentOperation } from "./types"

export type SuperAgentRecoveryResult = {
  run?: StoredSuperAgentRun
  operations: readonly SuperAgentOperation[]
  reviewRequired: boolean
}

/** Converts expired execution leases into explicit unknown work and gates the Run for review. */
export class SuperAgentRecoveryCoordinator {
  constructor(private readonly store: SuperAgentStoreInterface) {}

  recover(runID: string, at = Date.now()) {
    const store = this.store
    return Effect.gen(function* () {
      const operations = yield* store.recoverExpiredOperations(runID, at)
      const run = yield* store.get(runID)
      if (!run || operations.length === 0) return { run, operations, reviewRequired: false }
      const transitioned =
        run.status === "running" || run.status === "waiting_external"
          ? yield* store.transitionWithEvent(run.id, "needs_review", {
              type: "operation_unknown",
              at,
              payload: { operationIDs: operations.map((operation) => operation.id) },
            })
          : undefined
      return {
        run: transitioned?.run ?? run,
        operations,
        reviewRequired: true,
      }
    })
  }
}
