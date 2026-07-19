import { expect } from "bun:test"
import path from "node:path"
import { NodeFileSystem } from "@effect/platform-node"
import { AppProcess } from "@opencode-ai/core/process"
import { Bus } from "../../src/bus"
import { InstanceState } from "../../src/effect/instance-state"
import { Effect, FileSystem, Layer } from "effect"
import { testEffect } from "../lib/effect"
import { TestInstance } from "../fixture/fixture"
import { loadBundled } from "../../src/powersnexus/bundled"
import { PowersNexusVersion } from "../../src/powersnexus/version-service"
import { PowersNexusWorkflow } from "../../src/powersnexus/service"
import { Session } from "../../src/session/session"
import { Todo } from "../../src/session/todo"

const it = testEffect(Layer.mergeAll(NodeFileSystem.layer, AppProcess.defaultLayer, Bus.layer))
const resources = path.resolve(import.meta.dir, "../../../desktop/resources")

it.instance("创建 binding 后使用固定 digest 的 Bridge 聚合真实工件快照", () =>
  Effect.gen(function* () {
    const tmp = yield* TestInstance
    const instance = yield* InstanceState.context
    const fs = yield* FileSystem.FileSystem
    const change = path.join(instance.worktree, ".novaway", "powersnexus", "changes", "react-todo")
    yield* fs.makeDirectory(path.join(change, "delta-specs", "todo"), { recursive: true })
    yield* fs.writeFileString(path.join(change, "proposal.md"), "REQ-101\n")
    yield* fs.writeFileString(path.join(change, "design.md"), "REQ-101\n")
    yield* fs.writeFileString(path.join(change, "tasks.md"), "- [x] [TASK-101] 实现 REQ-101\n")
    yield* fs.writeFileString(
      path.join(change, "delta-specs", "todo", "spec.md"),
      "## ADDED Requirements\n\n### REQ-101: Todo\n",
    )
    const bundled = yield* loadBundled({
      resourceRoot: path.join(resources, "powersnexus-baselines"),
      publicKeyPath: path.join(resources, "powersnexus-release-public-key.pem"),
      dataRoot: path.join(tmp.directory, "data"),
      novaWayVersion: "1.15.4",
    })
    const versionLayer = Layer.mock(PowersNexusVersion.Service, {
      select: () => Effect.succeed(bundled),
      status: () =>
        Effect.succeed({
          policy: "bundled" as const,
          active: bundled,
          bundled,
          installed: [bundled],
          activationDeferred: false,
        }),
    })
    const sessionLayer = Session.defaultLayer
    const todoLayer = Todo.defaultLayer
    const workflowLayer = PowersNexusWorkflow.layer.pipe(
      Layer.provide(versionLayer),
      Layer.provide(sessionLayer),
      Layer.provide(AppProcess.defaultLayer),
      Layer.provide(Bus.layer),
      Layer.provide(todoLayer),
      Layer.provide(NodeFileSystem.layer),
    )
    yield* Effect.gen(function* () {
      const workflow = yield* PowersNexusWorkflow.Service
      const sessions = yield* Session.Service
      const todo = yield* Todo.Service
      const binding = yield* workflow.create({ changeName: "react-todo", level: "L2" })
      const snapshot = yield* workflow.inspect("react-todo")

      expect(binding.powersnexusDigest).toBe(bundled.digest)
      expect(snapshot.bindingID).toBe(binding.id)
      expect(snapshot.phase).toBe("needs_traceability")
      expect(snapshot.requirements).toEqual([
        { id: "REQ-101", module: "todo", status: "planned", implementationFiles: [], testFiles: [] },
      ])
      expect(snapshot.tasks[0]).toMatchObject({ id: "TASK-101", title: "实现 REQ-101", status: "completed" })
      expect((yield* workflow.status())?.artifactDigest).toBe(snapshot.artifactDigest)
      expect((yield* workflow.list()).map((item) => item.changeName)).toEqual(["react-todo"])

      const sessionID = (yield* sessions.create({ title: "PowersNexus 根 Session" })).id
      const bound = yield* workflow.bind({
        changeName: "react-todo",
        sessionID,
        expectedRevision: binding.revision,
        handoff: false,
      })
      expect(bound.rootSessionID).toBe(sessionID)
      expect(bound.powersnexusDigest).toBe(binding.powersnexusDigest)
      expect(yield* workflow.capsule(sessionID)).toMatchObject({
        bindingID: binding.id,
        changeName: "react-todo",
        phase: "needs_traceability",
        revision: snapshot.revision,
        artifactDigest: snapshot.artifactDigest,
        worktree: instance.worktree,
        powersnexusDigest: binding.powersnexusDigest,
      })
      const synchronized = yield* workflow.inspect("react-todo")
      expect(yield* todo.get(sessionID)).toEqual([
        { content: "[TASK-101] 实现 REQ-101", status: "completed", priority: "medium" },
      ])
      yield* todo.update({
        sessionID,
        todos: [{ content: "[TASK-101] 实现 REQ-101", status: "pending", priority: "medium" }],
      })
      expect((yield* workflow.inspect("react-todo")).tasks[0]?.status).toBe("pending")
      expect(yield* fs.readFileString(path.join(change, "tasks.md"))).toContain("- [ ] [TASK-101]")
      expect(synchronized.tasks[0]?.status).toBe("completed")
      const conflict = yield* Effect.exit(
        workflow.bind({
          changeName: "react-todo",
          sessionID: (yield* sessions.create({ title: "PowersNexus 其他 Session" })).id,
          expectedRevision: bound.revision,
          handoff: false,
        }),
      )
      expect(conflict._tag).toBe("Failure")
      const handoffSessionID = (yield* sessions.create({ title: "PowersNexus Handoff Session" })).id
      const handed = yield* workflow.bind({
        changeName: "react-todo",
        sessionID: handoffSessionID,
        expectedRevision: bound.revision,
        handoff: true,
      })
      expect(handed.rootSessionID).toBe(handoffSessionID)
      expect(handed.powersnexusDigest).toBe(binding.powersnexusDigest)
      expect(yield* workflow.capsule(sessionID)).toBeUndefined()
      expect(yield* workflow.capsule(handoffSessionID)).toMatchObject({ bindingID: binding.id })

      const unsupported = yield* Effect.exit(
        workflow.action("react-todo", {
          actionID: "action-create-plan-001",
          expectedRevision: snapshot.revision,
          bindingID: binding.id,
          action: "create_plan",
          input: {},
        }),
      )
      expect(unsupported._tag).toBe("Failure")
    }).pipe(Effect.provide(Layer.mergeAll(workflowLayer, sessionLayer, todoLayer)))
  }),
  { git: true },
)
