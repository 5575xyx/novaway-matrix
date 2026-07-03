import { describe, expect, test } from "bun:test"
import { hasSkillPermission, withAgentSkills } from "./settings-agent-config"

describe("withAgentSkills", () => {
  test("recognizes explicitly allowed skill permissions", () => {
    expect(
      hasSkillPermission("skill-a", [
        { permission: "skill", pattern: "*", action: "deny" },
        { permission: "skill", pattern: "skill-a", action: "allow" },
      ]),
    ).toBe(true)
  })

  test("does not expose denied or ask-only skills as callable", () => {
    expect(
      hasSkillPermission("skill-a", [
        { permission: "skill", pattern: "*", action: "allow" },
        { permission: "skill", pattern: "skill-a", action: "deny" },
      ]),
    ).toBe(false)
    expect(hasSkillPermission("skill-a", [])).toBe(false)
  })

  test("includes all current skills and marks removed skills as denied", () => {
    const result = withAgentSkills(
      {
        permission: {
          skill: {
            "*": "deny",
            "skill-a": "allow",
            "skill-b": "allow",
            "skill-c": "allow",
          },
        },
      },
      ["skill-a"],
      ["skill-b"],
    )

    const skill = (result["permission"] as { skill: Record<string, string> }).skill
    expect(skill).toEqual({
      "*": "deny",
      "skill-a": "allow",
      "skill-b": "allow",
      "skill-c": "deny",
    })
  })

  test("preserves other permission fields alongside skill", () => {
    const result = withAgentSkills(
      {
        permission: {
          skill: { "*": "deny", "skill-a": "allow" },
          bash: { read: "allow" },
          edit: "deny",
        },
      },
      ["skill-a"],
      [],
    )

    const permission = result["permission"] as { skill: Record<string, string>; bash: unknown; edit: string }
    expect(permission.bash).toEqual({ read: "allow" })
    expect(permission.edit).toBe("deny")
    expect(permission.skill).toEqual({ "*": "deny", "skill-a": "allow" })
  })

  test("handles empty current permission", () => {
    const result = withAgentSkills({}, ["skill-a"], ["skill-b"])

    expect(result["permission"]).toEqual({
      skill: {
        "*": "deny",
        "skill-a": "allow",
        "skill-b": "allow",
      },
    })
  })

  test("handles current permission without skill field", () => {
    const result = withAgentSkills({ permission: { bash: { read: "allow" } } }, ["skill-a"], [])

    const permission = result["permission"] as { skill: Record<string, string>; bash: unknown }
    expect(permission.skill).toEqual({ "*": "deny", "skill-a": "allow" })
    expect(permission.bash).toEqual({ read: "allow" })
  })

  test("cleanAgentConfig strips null values from the result", () => {
    const result = withAgentSkills(
      {
        description: "test",
        temperature: null,
        top_p: 0.5,
        permission: { skill: { "*": "deny", "skill-a": "allow" } },
      },
      ["skill-a"],
      [],
    )

    expect(result["description"]).toBe("test")
    expect("temperature" in result).toBe(false)
    expect(result["top_p"]).toBe(0.5)
  })

  test("result marks removed skills as denied so config merge overrides previous allow", () => {
    const result = withAgentSkills(
      { permission: { skill: { "*": "deny", "skill-a": "allow", "skill-b": "allow" } } },
      ["skill-a"],
      [],
    )

    const skills = (result["permission"] as { skill: Record<string, unknown> }).skill
    expect(skills["skill-a"]).toBe("allow")
    expect(skills["skill-b"]).toBe("deny")
  })

  test("serialized result keeps denied removed skills", () => {
    const result = withAgentSkills(
      { permission: { skill: { "*": "deny", "skill-a": "allow", "skill-b": "allow" } } },
      ["skill-a"],
      [],
    )

    const serialized = JSON.parse(JSON.stringify(result))
    expect((serialized as { permission: { skill: Record<string, string> } }).permission.skill).toEqual({
      "*": "deny",
      "skill-a": "allow",
      "skill-b": "deny",
    })
  })
})
