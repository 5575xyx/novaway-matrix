export type TeamRunState =
  | "queued"
  | "planning"
  | "running"
  | "awaiting_approval"
  | "needs_review"
  | "done"
  | "partial"
  | "failed"
  | "exceeded"
  | "cancelled"
  | "unknown"

const STATES = new Set<TeamRunState>([
  "queued",
  "planning",
  "running",
  "awaiting_approval",
  "needs_review",
  "done",
  "partial",
  "failed",
  "exceeded",
  "cancelled",
])

/** The run API has had a few historical spellings; keep the chat row stable across them. */
export function normalizeTeamRunState(value: unknown): TeamRunState {
  if (typeof value !== "string") return "unknown"
  if (value === "waiting_approval" || value === "waiting_for_approval") return "awaiting_approval"
  if (value === "completed" || value === "succeeded" || value === "success") return "done"
  if (value === "pending" || value === "waiting") return "queued"
  return STATES.has(value as TeamRunState) ? (value as TeamRunState) : "unknown"
}

export function teamRunExecutor(input: { expert?: unknown; team?: unknown }): "expert" | "team" {
  return typeof input.expert === "string" && input.expert.length > 0 ? "expert" : "team"
}

export function teamRunStateLabelKey(state: TeamRunState) {
  return `team.run.tool.state.${state}` as const
}

export function teamRunIsTerminal(value: unknown) {
  return ["done", "partial", "failed", "exceeded", "cancelled"].includes(normalizeTeamRunState(value))
}

export function teamRunIsWaitingForUser(value: unknown) {
  const state = normalizeTeamRunState(value)
  return state === "awaiting_approval" || state === "needs_review"
}

export function teamRunPolicy(input: { allowWrites?: unknown; readOnly?: unknown }) {
  // The persisted run is authoritative. Before it exists, team_run's conservative
  // default is read-only; this prevents a missing metadata field from looking approved.
  if (input.readOnly === true) return "read-only" as const
  if (input.readOnly === false || input.allowWrites === true) return "write" as const
  return "read-only" as const
}

export function teamRunPolicyLabelKey(policy: ReturnType<typeof teamRunPolicy>) {
  return policy === "write" ? "team.run.tool.policy.write" : "team.run.tool.policy.readOnly"
}

export function teamRunApprovalLabelKey(input: { state: unknown; policy: ReturnType<typeof teamRunPolicy> }) {
  const state = normalizeTeamRunState(input.state)
  if (state === "awaiting_approval") return "team.run.tool.approval.waiting"
  if (state === "needs_review") return "team.run.tool.approval.review"
  return input.policy === "read-only" ? "team.run.tool.approval.auto" : "team.run.tool.approval.guarded"
}
