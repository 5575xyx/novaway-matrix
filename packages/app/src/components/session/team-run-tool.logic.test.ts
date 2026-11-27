import { describe, expect, test } from "bun:test"
import {
  normalizeTeamRunState,
  teamRunApprovalLabelKey,
  teamRunExecutor,
  teamRunIsTerminal,
  teamRunIsWaitingForUser,
  teamRunPolicy,
  teamRunPolicyLabelKey,
  teamRunStateLabelKey,
} from "./team-run-tool.logic"

describe("team run chat summary", () => {
  test("normalizes historical and terminal states for the collapsed row", () => {
    expect(normalizeTeamRunState("waiting_approval")).toBe("awaiting_approval")
    expect(normalizeTeamRunState("completed")).toBe("done")
    expect(normalizeTeamRunState("pending")).toBe("queued")
    expect(normalizeTeamRunState("not-a-state")).toBe("unknown")
    expect(teamRunIsTerminal("completed")).toBe(true)
    expect(teamRunIsTerminal("needs_review")).toBe(false)
  })

  test("keeps single experts distinct from reusable expert teams", () => {
    expect(teamRunExecutor({ expert: "researcher" })).toBe("expert")
    expect(teamRunExecutor({ team: "release-team" })).toBe("team")
    expect(teamRunExecutor({ expert: "", team: "release-team" })).toBe("team")
  })

  test("defaults to a conservative read-only policy before run metadata arrives", () => {
    expect(teamRunPolicy({})).toBe("read-only")
    expect(teamRunPolicy({ allowWrites: true })).toBe("write")
    expect(teamRunPolicy({ allowWrites: true, readOnly: true })).toBe("read-only")
    expect(teamRunPolicyLabelKey("read-only")).toBe("team.run.tool.policy.readOnly")
    expect(teamRunPolicyLabelKey("write")).toBe("team.run.tool.policy.write")
  })

  test("surfaces the approval boundary without treating review as completion", () => {
    expect(teamRunIsWaitingForUser("waiting_for_approval")).toBe(true)
    expect(teamRunApprovalLabelKey({ state: "awaiting_approval", policy: "write" })).toBe(
      "team.run.tool.approval.waiting",
    )
    expect(teamRunApprovalLabelKey({ state: "needs_review", policy: "write" })).toBe("team.run.tool.approval.review")
    expect(teamRunApprovalLabelKey({ state: "running", policy: "read-only" })).toBe("team.run.tool.approval.auto")
    expect(teamRunStateLabelKey("partial")).toBe("team.run.tool.state.partial")
  })
})
