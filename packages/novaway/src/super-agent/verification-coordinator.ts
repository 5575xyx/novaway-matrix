import { Effect } from "effect"
import type { Interface as SuperAgentStoreInterface, StoredSuperAgentRun } from "./store"
import { VerifierRegistry } from "./verification"
import { verificationOutcomeAt } from "./validity"
import { canCompleteRun } from "./state"
import type { Verification } from "./types"

/**
 * An explicit artifact verifier may be the first durable record of a side
 * effect after a crash.  In that case the operation is deliberately left in
 * `unknown`/`needs_review` and the task graph can still be pending.  Once the
 * human supplies criterion-scoped passing evidence for that exact task, the
 * evidence is the recovery decision: promote the task to succeeded rather
 * than allowing a passed verification to coexist with an unfinished graph.
 *
 * This is intentionally narrow.  Evidence must be linked to the task and to
 * a passing verification; unscoped evidence never changes task state.
 */
function taskIDsSettledByEvidence(
  evidence: readonly { id: string; taskID?: string; acceptanceIDs?: readonly string[] }[],
  verifications: readonly { outcome: string; acceptanceID: string; evidenceIDs?: readonly string[] }[],
) {
  const passingEvidence = new Set(
    verifications
      .filter((verification) => verification.outcome === "pass")
      .flatMap((verification) => verification.evidenceIDs ?? []),
  )
  const taskIDs = new Set<string>()
  for (const item of evidence) {
    if (item.taskID && passingEvidence.has(item.id)) taskIDs.add(item.taskID)
  }
  return taskIDs
}

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
          const validity = verificationOutcomeAt(previous, evidence)
          const newerEvidence = evidence.some(
            (item) =>
              item.capturedAt > previous.createdAt &&
              (item.acceptanceIDs === undefined || item.acceptanceIDs.includes(criterion.id)),
          )
          // Failed/unverified/stale results must be re-evaluated after repair.
          // Even a previous pass is not reusable once newer criterion-scoped
          // evidence exists.
          if (validity.outcome === "pass" && !newerEvidence) {
            verifications.push(previous)
            continue
          }
        }
        const result = yield* Effect.promise(() => verifier.verify({ runID: run.id, criterion, evidence }))
        const verification: Verification = {
          id: previous
            ? `${run.id}:verification:${criterion.id}:${verifier.id}:retry:${Date.now()}:${verifications.length}`
            : `${run.id}:verification:${criterion.id}:${verifier.id}`,
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
      let verificationRun = verifying.run
      if (passed) {
        const settledTaskIDs = taskIDsSettledByEvidence(evidence, verifications)
        const now = Date.now()
        const promoted = verificationRun.graph.nodes.map((task) =>
          settledTaskIDs.has(task.id) && !["succeeded", "completed"].includes(task.status)
            ? {
                ...task,
                status: "succeeded" as const,
                updatedAt: now,
                output: task.output ?? { verifiedEvidence: true },
              }
            : task,
        )
        if (promoted.some((task, index) => task !== verificationRun.graph.nodes[index])) {
          const updated = yield* store.updateGraph(
            verificationRun.id,
            { ...verificationRun.graph, nodes: promoted },
            verificationRun.graph.version,
          )
          if (updated) {
            verificationRun = updated
            yield* store.appendEvent({
              runID: verificationRun.id,
              type: "tasks_settled_by_verification",
              at: now,
              payload: { taskIDs: [...settledTaskIDs] },
            })
          }
        }
      }
      const completionGuard = canCompleteRun(
        { ...verificationRun, status: "verifying" },
        verifications,
      )
      const completed = passed && completionGuard.ok
      const finalStatus = completed ? "completed" : "needs_review"
      const final = yield* store.transitionWithEvent(run.id, finalStatus, {
        type: completed ? "run_completed" : "completion_rejected",
        at: Date.now(),
        payload: completed
          ? { summary: input.summary }
          : { reason: completionGuard.reason ?? "required verification did not pass" },
      })
      if (!final) return yield* Effect.fail(new Error(`run not found: ${run.id}`))
      return { run: final.run, verifications, completed }
    })
  }
}
