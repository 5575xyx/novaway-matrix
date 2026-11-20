import { canTransitionRun, isTerminalRunStatus, type SuperAgentRun, type SuperAgentRunStatus } from "./types"

export class InvalidRunTransition extends Error {
  constructor(
    readonly from: SuperAgentRunStatus,
    readonly to: SuperAgentRunStatus,
  ) {
    super(`invalid Super-Agent run transition: ${from} -> ${to}`)
  }
}

export function transitionRun(run: SuperAgentRun, status: SuperAgentRunStatus, now = Date.now()): SuperAgentRun {
  if (run.status === status) return { ...run, updatedAt: now }
  if (!canTransitionRun(run.status, status)) throw new InvalidRunTransition(run.status, status)
  if (status === "paused" && !run.checkpointID) throw new Error(`run ${run.id} cannot pause without a checkpoint`)
  return { ...run, status, updatedAt: now }
}

export function assertMutableRun(run: SuperAgentRun) {
  if (isTerminalRunStatus(run.status)) throw new Error(`run ${run.id} is terminal: ${run.status}`)
}

export function assertTaskExists(run: SuperAgentRun, taskID: string) {
  const task = run.graph.nodes.find((node) => node.id === taskID)
  if (!task) throw new Error(`task not found: ${taskID}`)
  return task
}

export function readyTasks(run: SuperAgentRun, at = Date.now()) {
  return run.graph.nodes.filter((task) => {
    if (task.status !== "pending" && task.status !== "ready") return false
    if (task.retryAt !== undefined && task.retryAt > at) return false
    return task.dependencies.every((dependency) => {
      const parent = run.graph.nodes.find((candidate) => candidate.id === dependency)
      return parent?.status === "completed" || parent?.status === "succeeded"
    })
  })
}

export function canCompleteRun(
  run: SuperAgentRun,
  verifications: readonly { outcome: string; acceptanceID: string; evidenceIDs?: readonly string[] }[],
) {
  if (run.status !== "verifying") return { ok: false, reason: "run is not verifying" }
  const required = run.goal.acceptanceCriteria.filter((criterion) => criterion.required)
  const byCriterion = new Map(verifications.map((verification) => [verification.acceptanceID, verification]))
  for (const criterion of required) {
    const verification = byCriterion.get(criterion.id)
    if (!verification) return { ok: false, reason: `missing verification: ${criterion.id}` }
    if (verification.outcome !== "pass") return { ok: false, reason: `${criterion.id} is ${verification.outcome}` }
    if (!verification.evidenceIDs || verification.evidenceIDs.length === 0)
      return { ok: false, reason: `${criterion.id} has no evidence` }
  }
  return { ok: true as const }
}
