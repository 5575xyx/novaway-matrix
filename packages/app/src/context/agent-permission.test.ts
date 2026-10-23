import { describe, expect, test } from "bun:test"
import { agentForPermission, isCoherent, permissionForAgent } from "./agent-permission"

describe("agent / permission coherence", () => {
  test("picking the planner agent turns on the read-only gate", () => {
    expect(permissionForAgent("plan", "default")).toBe("plan")
    expect(permissionForAgent("plan", "acceptEdits")).toBe("plan")
    expect(permissionForAgent("plan", "bypassPermissions")).toBe("plan")
    // Already coherent: leave the gate alone.
    expect(permissionForAgent("plan", "plan")).toBeUndefined()
  })

  test("picking a build-capable agent lifts the read-only gate", () => {
    expect(permissionForAgent("build", "plan")).toBe("default")
    expect(permissionForAgent("office-ppt", "plan")).toBe("default")
    // Nothing to change outside plan mode.
    expect(permissionForAgent("build", "acceptEdits")).toBeUndefined()
    expect(permissionForAgent("build", "bypassPermissions")).toBeUndefined()
  })

  test("picking the read-only gate switches the role to planner", () => {
    expect(agentForPermission("plan", "build")).toBe("plan")
    expect(agentForPermission("plan", undefined)).toBe("plan")
    expect(agentForPermission("plan", "plan")).toBeUndefined()
  })

  test("leaving the read-only gate returns to the builder", () => {
    expect(agentForPermission("default", "plan")).toBe("build")
    expect(agentForPermission("acceptEdits", "plan")).toBe("build")
    expect(agentForPermission("bypassPermissions", "plan")).toBe("build")
    expect(agentForPermission("default", "build")).toBeUndefined()
  })

  test("coherence check", () => {
    expect(isCoherent("plan", "plan")).toBe(true)
    expect(isCoherent("build", "plan")).toBe(false)
    expect(isCoherent("build", "default")).toBe(true)
    expect(isCoherent(undefined, "default")).toBe(true)
  })
})
