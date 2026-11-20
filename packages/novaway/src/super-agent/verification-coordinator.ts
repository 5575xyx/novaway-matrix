import { Effect } from "effect"
import type { Interface as SuperAgentStoreInterface, StoredSuperAgentRun } from "./store"
import { VerifierRegistry } from "./verification"
import type { Verification } from "./types"

export type VerificationRunResult = {
  run: StoredSuperAgentRun
  verifications: readonly Verification[]
  completed: boolean
}

/** Runs registered verifiers against persisted Evidence and closes the Run only when every required criterion passes. */
export class SuperAgentVerificationCoordinator {
  constructor(
    private readonly store: SuperAgentStoreInterface,
    private readonly verifiers: VerifierRegistry,
  ) {}

  verifyAndFinish(input: { runID: string; verifierID: string; summary: string }) {
    const store = this.store
    const verifiers = this.verifiers
    return Effect.gen(function* () {
      const run = yield* store.get(input.runID)
      if (!run) return yield* Effect.fail(new Error(`run not found: ${input.runID}`))
      if (run.status === "completed") {
        return {
          run,
          verifications: yield* store.verifications(run.id),
          completed: true,
        }
      }
      const verifying =
        run.status === "verifying"
          ? { run }
          : yield* store.transitionWithEvent(run.id, "verifying", {
              type: "verification_started",
              at: Date.now(),
              payload: { verifierID: input.verifierID },
            })
      if (!verifying) return yield* Effect.fail(new Error(`run not found: ${run.id}`))
      const evidence = yield* store.evidences(run.id)
      const existing = yield* store.verifications(run.id)
      const verifier = verifiers.resolve(input.verifierID)
      if (!verifier) return yield* Effect.fail(new Error(`verifier not found: ${input.verifierID}`))
      const verifications: Verification[] = []
      for (const criterion of run.goal.acceptanceCriteria.filter((item) => item.required)) {
        const previous = existing.find((item) => item.acceptanceID === criterion.id && item.verifierID === verifier.id)
        if (previous) {
          verifications.push(previous)
          continue
        }
        const result = yield* Effect.promise(() => verifier.verify({ runID: run.id, criterion, evidence }))
        const verification: Verification = {
          id: `${run.id}:verification:${criterion.id}:${verifier.id}`,
          runID: run.id,
          acceptanceID: criterion.id,
          verifierID: verifier.id,
          verifierVersion: verifier.version,
          outcome: result.outcome,
          evidenceIDs: result.evidenceIDs,
          reason: result.reason,
          ...(result.measured ? { measured: result.measured } : {}),
          createdAt: Date.now(),
        }
        yield* store.verification(verification)
        yield* store.appendEvent({
          runID: run.id,
          type: "verification_recorded",
          at: verification.createdAt,
          payload: { verificationID: verification.id, outcome: verification.outcome },
        })
        verifications.push(verification)
      }
      const passed = verifications.every((item) => item.outcome === "pass")
      const finalStatus = passed ? "completed" : "needs_review"
      const final = yield* store.transitionWithEvent(run.id, finalStatus, {
        type: passed ? "run_completed" : "completion_rejected",
        at: Date.now(),
        payload: passed ? { summary: input.summary } : { reason: "required verification did not pass" },
      })
      if (!final) return yield* Effect.fail(new Error(`run not found: ${run.id}`))
      return { run: final.run, verifications, completed: passed }
    })
  }
}
