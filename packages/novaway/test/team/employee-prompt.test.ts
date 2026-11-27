import { describe, expect, test } from "bun:test"
import * as EmployeePromptAssembler from "@/team/employee-prompt"
import type { RosterEntry } from "@/team/profile"

const entry: RosterEntry = {
  employee: {
    id: "emp_1",
    name: "安全审查",
    job: "general",
    prompt: "只检查安全问题。",
    skills: ["security", "evidence"],
    archived: false,
  },
  role: "worker",
  order: 1,
  canAutoDispatch: true,
}

const assignment = {
  assignmentID: "run_1:team_1:1:call_1",
  dispatchID: "dispatch:run_1:team_1:1:call_1",
  runID: "run_1",
  taskID: "team_1",
  attempt: 1,
  employeeID: "emp_1",
}

describe("EmployeePromptAssembler", () => {
  test("includes immutable dispatch coordinates and a frozen manifest", () => {
    const result = EmployeePromptAssembler.build({
      entry,
      prompt: "检查这次变更。",
      assignment,
      worktree: "/tmp/worktree",
      readOnly: true,
      permissionSnapshot: [{ permission: "bash", action: "deny" }],
    })

    expect(result.prompt).toContain("Assignment ID: " + assignment.assignmentID)
    expect(result.prompt).toContain("Dispatch ID: " + assignment.dispatchID)
    expect(result.prompt).toContain("Write policy: read-only")
    expect(result.prompt).toContain("检查这次变更。")
    expect(result.manifest).toMatchObject({
      ...assignment,
      agent: "general",
      worktree: "/tmp/worktree",
      readOnly: true,
    })
    expect(result.manifest.promptHash).toMatch(/^sha256:/)
    expect(result.manifest.skillManifestHash).toMatch(/^sha256:/)
    expect(result.manifest.permissionHash).toMatch(/^sha256:/)
  })

  test("freezes skill requirements and output contract in the manifest hash", () => {
    const first = EmployeePromptAssembler.build({
      entry,
      prompt: "检查这次变更。",
      assignment,
      skillManifest: [
        {
          name: "security",
          version: "1.2.0",
          contentHash: "sha256:security",
          requiredTools: ["read"],
          permissionRequirements: ["workspace.read"],
          outputContract: { evidence: "required" },
          compatibility: "nova>=1",
        },
      ],
    })
    const second = EmployeePromptAssembler.build({
      entry,
      prompt: "检查这次变更。",
      assignment,
      skillManifest: [
        {
          name: "security",
          version: "1.2.1",
          contentHash: "sha256:security",
          requiredTools: ["read"],
          permissionRequirements: ["workspace.read"],
          outputContract: { evidence: "required" },
          compatibility: "nova>=1",
        },
      ],
    })
    expect(first.manifest.skillManifest).toMatchObject([{ version: "1.2.0", requiredTools: ["read"] }])
    expect(first.manifest.skillManifestHash).not.toBe(second.manifest.skillManifestHash)
  })

  test("changes the prompt hash when the assignment contract changes", () => {
    const first = EmployeePromptAssembler.build({ entry, prompt: "检查 A。", assignment })
    const second = EmployeePromptAssembler.build({ entry, prompt: "检查 B。", assignment })
    expect(first.manifest.promptHash).not.toBe(second.manifest.promptHash)
    expect(first.manifest.skillManifestHash).toBe(second.manifest.skillManifestHash)
  })
})
