import { describe, expect, test } from "bun:test"
import { aggregateArtifact, transition } from "../../src/powersnexus/state"
import type { ArtifactSnapshot } from "../../src/powersnexus/bridge-schema"

const artifact: ArtifactSnapshot = {
  protocolVersion: "1.0",
  powersnexusVersion: "6.1.0",
  changeName: "react-todo",
  level: "L2",
  phase: "needs_plan",
  status: "ready",
  revision: 12,
  artifactDigest: "a".repeat(64),
  requirements: [{ id: "REQ-1", module: "todo" }],
  tasks: [{ id: "TASK-1", title: "实现待办", status: "pending" }],
  blockers: [],
  nextAction: "create_plan",
  delivery: null,
  updatedAt: "2026-07-17T00:00:00.000Z",
}

describe("PowersNexus 工作流状态", () => {
  test("Bridge 工件与绑定聚合为独立 WorkflowSnapshot", () => {
    const snapshot = aggregateArtifact(artifact, {
      id: "pnb_test",
      projectID: "project-test",
      projectRoot: "C:\\repo",
      worktree: "C:\\repo",
      powersnexusDigest: "b".repeat(64),
      profile: "web",
    })

    expect(snapshot.phase).toBe("needs_plan")
    expect(snapshot.status).toBe("idle")
    expect(snapshot.requirements[0].status).toBe("planned")
    expect(snapshot.tasks[0].requirementIDs).toEqual([])
    expect(snapshot.nextAction).toEqual({ action: "create_plan", label: "创建实施计划", automatic: true })
    expect(snapshot.powersnexusDigest).toBe("b".repeat(64))
  })

  test("blocker 和未分类 level 优先于 Bridge phase", () => {
    const unclassified = aggregateArtifact({ ...artifact, level: null }, {
      id: "pnb_test",
      projectID: "project-test",
      projectRoot: "C:\\repo",
      worktree: "C:\\repo",
      powersnexusDigest: "b".repeat(64),
    })
    expect(unclassified.phase).toBe("needs_classification")

    const blocked = aggregateArtifact(
      {
        ...artifact,
        blockers: [{ code: "AUTH_REQUIRED", message: "需要授权", recoverable: true, recoveryActions: ["授权"] }],
      },
      {
        id: "pnb_test",
        projectID: "project-test",
        projectRoot: "C:\\repo",
        worktree: "C:\\repo",
        powersnexusDigest: "b".repeat(64),
      },
    )
    expect(blocked.phase).toBe("blocked")
    expect(blocked.status).toBe("blocked")
  })

  test("确定性转换覆盖分类、实施、验证、修复和归档主链", () => {
    expect(transition("uninitialized", "user.requirement")).toBe("needs_classification")
    expect(transition("needs_classification", "classification.completed", "L1")).toBe("ready_to_implement")
    expect(transition("needs_classification", "classification.completed", "L3")).toBe("needs_specification")
    expect(transition("ready_to_implement", "authorization.local")).toBe("implementing")
    expect(transition("verifying", "step.failed")).toBe("repairing")
    expect(transition("repairing", "patch.completed")).toBe("ready_to_verify")
    expect(transition("verifying", "delivery.passed")).toBe("ready_to_archive")
    expect(transition("ready_to_archive", "archive.approved")).toBe("archiving")
    expect(transition("archiving", "archive.completed")).toBe("completed")
    expect(transition("implementing", "unrecoverable.error")).toBe("blocked")
    expect(transition("needs_plan", "archive.completed")).toBe("needs_plan")
  })
})
