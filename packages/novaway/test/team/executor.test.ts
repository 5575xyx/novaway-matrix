import { describe, expect, it } from "bun:test"
import { expert, expertCard, team, teamCard } from "@/team/executor"

describe("unified executor model", () => {
  it("normalizes runtime teams and reusable profiles to one team identity", () => {
    const runtime = team({
      source: "runtime-team",
      id: "team-live",
      name: "当前团队",
      capabilities: ["build"],
      scenarios: [],
      memberCount: 1,
      memberPreview: [{ name: "成员", role: "worker" }],
      autoEligible: true,
    })
    const profile = team({
      source: "profile",
      id: "profile-review",
      name: "审查团",
      capabilities: ["review"],
      scenarios: [],
      memberCount: 2,
      memberPreview: [{ name: "队长", role: "captain" }],
      autoEligible: false,
    })

    expect(runtime.kind).toBe("team")
    expect(profile.kind).toBe("team")
    expect(teamCard(runtime)).toMatchObject({ id: "team-live", name: "当前团队", autoEligible: true })
    expect(teamCard(profile)).toMatchObject({ id: "profile-review", name: "审查团", autoEligible: false })
  })

  it("keeps direct employees in the same executor model without exposing source metadata", () => {
    const employee = expert({
      source: "employee",
      id: "employee-review",
      name: "审查专家",
      role: "review",
      available: true,
    })

    expect(employee.kind).toBe("expert")
    expect(expertCard(employee)).toEqual({
      id: "employee-review",
      name: "审查专家",
      role: "review",
      available: true,
    })
    expect(expertCard(employee)).not.toHaveProperty("source")
  })
})
