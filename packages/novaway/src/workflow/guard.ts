import type { Phase } from "./policy"

export type ToolShape = { id: string; workspace?: boolean; readOnly?: boolean }
export type GuardDecision = { allowed: boolean; reason?: string }

/** Deterministic phase gate shared by runtime and tests. Implementation is the only write phase. */
export function checkTool(phase: Phase, tool: ToolShape, verificationTask = false): GuardDecision {
  if (tool.readOnly === true || tool.workspace === false) return { allowed: true }
  if (phase === "implementation") return { allowed: true }
  if (phase === "verification") {
    if (tool.id === "task" && verificationTask) return { allowed: true }
    return { allowed: false, reason: `phase ${phase} permits only read-only tools and the verification subagent` }
  }
  if (["intake", "grill-me", "design", "plan", "review", "delivery"].includes(phase)) {
    if (["question", "skill", "task", "git_status", "git_diff", "git_log", "search", "read"].includes(tool.id)) return { allowed: true }
    return { allowed: false, reason: `phase ${phase} does not permit workspace-mutating tool ${tool.id}` }
  }
  return { allowed: true }
}
