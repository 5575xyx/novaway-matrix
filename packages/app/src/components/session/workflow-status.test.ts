import { describe, expect, test } from "bun:test"
import { mergeWorkflowState, patchFrom, type WorkflowState } from "./workflow-status"

const state = (input: Partial<WorkflowState> = {}): WorkflowState => ({
  route: "l1",
  phase: "grill-me",
  verificationStatus: "pending",
  deliveryStatus: "not_started",
  revision: 2,
  ...input,
})

describe("workflow state conflict merge", () => {
  test("preserves a local field when the remote side did not change it", () => {
    const base = state()
    const local = state({ phase: "design" })
    const remote = state({ revision: 3 })
    const merged = mergeWorkflowState(base, local, remote)

    expect(merged.phase).toBe("design")
    expect(patchFrom(remote, merged)).toEqual({ phase: "design" })
  })

  test("does not move a workflow backwards after a conflict", () => {
    const base = state({ phase: "design" })
    const local = state({ phase: "grill-me" })
    const remote = state({ phase: "verification", revision: 3 })
    const merged = mergeWorkflowState(base, local, remote)

    expect(merged.phase).toBe("verification")
    expect(patchFrom(remote, merged)).toEqual({})
  })

  test("keeps the remote value for an actual route conflict", () => {
    const base = state()
    const local = state({ route: "l2" })
    const remote = state({ route: "l3", revision: 3 })
    const merged = mergeWorkflowState(base, local, remote)

    expect(merged.route).toBe("l3")
    expect(patchFrom(remote, merged)).toEqual({})
  })
})
