import type { RunView } from "@novaway/sdk/v2"

export type ExpertCenterTaskState =
  | "planning"
  | "needs-you"
  | "working"
  | "paused"
  | "completed"
  | "partial"
  | "failed"

export type ExpertCenterTaskPhase =
  | "understanding"
  | "planning"
  | "working"
  | "reviewing"
  | "delivering"

export type ArtifactSummaryView = {
  id: string
  name: string
  path?: string
}

export type ExpertCenterTaskView = {
  id: string
  goal: string
  state: ExpertCenterTaskState
  phase: ExpertCenterTaskPhase
  executor: {
    mode: "auto" | "expert" | "team"
    name?: string
    count?: number
  }
  nextAction?: {
    kind: string
    label: string
  }
  summary?: string
  progress?: {
    completed: number
    total: number
  }
  artifacts: ArtifactSummaryView[]
  updatedAt: number
}

const NEEDS_YOU = new Set(["awaiting_approval", "blocked", "paused", "needs_review"])

export const taskState = (run: Pick<RunView, "state">): ExpertCenterTaskState => {
  const state = String(run.state)
  if (state === "planning") return "planning"
  if (state === "done") return "completed"
  if (state === "partial") return "partial"
  if (state === "failed" || state === "exceeded" || state === "cancelled") return "failed"
  if (state === "paused") return "paused"
  if (NEEDS_YOU.has(state)) return "needs-you"
  return "working"
}

export const taskPhase = (run: Pick<RunView, "state" | "phase">): ExpertCenterTaskPhase => {
  const state = String(run.state)
  const phase = String(run.phase ?? "")
  if (state === "done" || state === "partial" || state === "failed" || state === "cancelled") {
    return "delivering"
  }
  if (state === "needs_review" || phase === "verification" || phase === "review") return "reviewing"
  if (state === "planning" || state === "awaiting_approval" || phase === "plan") return "planning"
  if (phase === "dispatch" || phase === "execution" || state === "running") return "working"
  return "understanding"
}

export const taskStateLabelKey = (state: ExpertCenterTaskState) => `expertCenter.state.${state}`
export const taskPhaseLabelKey = (phase: ExpertCenterTaskPhase) => `expertCenter.phase.${phase}`

export const toExpertCenterTaskView = (run: RunView): ExpertCenterTaskView => ({
  id: run.id,
  goal: run.goal,
  state: taskState(run),
  phase: taskPhase(run),
  executor: {
    mode: run.mode === "auto" ? "auto" : "team",
  },
  artifacts: [],
  updatedAt: Number.isFinite(Number(run.updatedAt)) ? Number(run.updatedAt) : 0,
})
