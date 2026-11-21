import type { State } from "./policy"

const phaseOrder = ["intake", "grill-me", "design", "plan", "implementation", "review", "verification", "delivery", "completed", "blocked"]
const verificationRank: Record<string, number> = { not_required: 0, pending: 1, unverified: 2, passed: 3, failed: 4 }
const deliveryRank: Record<string, number> = { not_started: 0, in_progress: 1, completed: 2, blocked: 3 }

export type MergeResult = { merged: State; conflicted: boolean; conflicts: string[] }

/** Conservative three-way merge for clients that resumed a stale workflow state. */
export function merge(base: State, local: State, remote: State): MergeResult {
  const conflicts: string[] = []
  if (local.route !== base.route && remote.route !== base.route && local.route !== remote.route) conflicts.push("route")
  const route = conflicts.includes("route") ? remote.route : local.route !== base.route ? local.route : remote.route
  const localPhase = phaseOrder.indexOf(local.phase), remotePhase = phaseOrder.indexOf(remote.phase)
  const phase = localPhase >= remotePhase ? local.phase : remote.phase
  if (local.phase !== base.phase && remote.phase !== base.phase && local.phase !== remote.phase) conflicts.push("phase")
  const merged: State = {
    ...remote,
    route,
    phase,
    routeLocked: local.routeLocked || remote.routeLocked,
    escalationReason: local.escalationReason ?? remote.escalationReason,
    questionCalls: Math.max(local.questionCalls, remote.questionCalls),
    questionBudget: Math.max(local.questionBudget, remote.questionBudget),
    verificationStatus: verificationRank[local.verificationStatus] >= verificationRank[remote.verificationStatus] ? local.verificationStatus : remote.verificationStatus,
    deliveryStatus: deliveryRank[local.deliveryStatus] >= deliveryRank[remote.deliveryStatus] ? local.deliveryStatus : remote.deliveryStatus,
    updatedAt: new Date(Math.max(local.updatedAt.getTime(), remote.updatedAt.getTime())),
    revision: Math.max(local.revision ?? 0, remote.revision ?? 0),
  }
  return { merged, conflicted: conflicts.length > 0, conflicts }
}
