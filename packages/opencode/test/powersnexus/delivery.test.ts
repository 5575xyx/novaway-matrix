import { expect } from "bun:test"
import path from "node:path"
import { NodeFileSystem } from "@effect/platform-node"
import { AppProcess } from "@opencode-ai/core/process"
import { BackgroundJob } from "../../src/background/job"
import { Bus } from "../../src/bus"
import { InstanceState } from "../../src/effect/instance-state"
import { loadBundled } from "../../src/powersnexus/bundled"
import { PowersNexusDelivery } from "../../src/powersnexus/delivery"
import { PowersNexusBrowserQa } from "../../src/powersnexus/browser-qa"
import { PowersNexusRunner } from "../../src/powersnexus/runner"
import { PowersNexusWorkflow } from "../../src/powersnexus/service"
import { PowersNexusVersion } from "../../src/powersnexus/version-service"
import { Session } from "../../src/session/session"
import { Todo } from "../../src/session/todo"
import { Effect, FileSystem, Layer } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.mergeAll(NodeFileSystem.layer, AppProcess.defaultLayer, BackgroundJob.defaultLayer, Bus.layer))
const resources = path.resolve(import.meta.dir, "../../../desktop/resources")

function prepareChange(
  fs: FileSystem.FileSystem,
  worktree: string,
  changeName: string,
  argv: string[],
) {
  return Effect.gen(function* () {
    const change = path.join(worktree, ".novaway", "powersnexus", "changes", changeName)
    yield* fs.makeDirectory(path.join(change, "delta-specs", "sample"), { recursive: true })
    yield* fs.makeDirectory(path.join(worktree, "src"), { recursive: true })
    yield* fs.makeDirectory(path.join(worktree, "test"), { recursive: true })
    yield* fs.writeFileString(path.join(worktree, "src", "sample.ts"), "export const sample = true\n")
    yield* fs.writeFileString(path.join(worktree, "test", "sample.test.ts"), "// REQ-201\n")
    yield* fs.writeFileString(path.join(change, "proposal.md"), "REQ-201\n")
    yield* fs.writeFileString(path.join(change, "design.md"), "REQ-201\n")
    yield* fs.writeFileString(path.join(change, "tasks.md"), "- [x] [TASK-201] 完成交付 REQ-201\n")
    yield* fs.writeFileString(path.join(change, "cross-reference.md"), "REQ-201\n")
    yield* fs.writeFileString(
      path.join(change, "traceability.md"),
      "| Requirement | Task | Implementation | Test | Status |\n| --- | --- | --- | --- | --- |\n| REQ-201 | TASK-201 | src/sample.ts | test/sample.test.ts | ✅ completed |\n",
    )
    yield* fs.writeFileString(
      path.join(change, "delta-specs", "sample", "spec.md"),
      "## ADDED Requirements\n\n### REQ-201: Sample\n",
    )
    yield* fs.writeFileString(
      path.join(change, "delivery.json"),
      JSON.stringify({
        schemaVersion: "1",
        profile: "library",
        steps: [{ id: "build", argv, cwd: ".", timeoutMs: 30_000, status: "pending" }],
      }),
    )
    return change
  })
}

it.instance("全部步骤通过后计算指纹并由 Bridge 写入 verify 证据", () =>
  Effect.gen(function* () {
    const tmp = yield* TestInstance
    const instance = yield* InstanceState.context
    const fs = yield* FileSystem.FileSystem
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
    const busLayer = Bus.layer
    const workflowLayer = PowersNexusWorkflow.layer.pipe(
      Layer.provide(versionLayer),
      Layer.provide(sessionLayer),
      Layer.provide(AppProcess.defaultLayer),
      Layer.provideMerge(busLayer),
      Layer.provide(Todo.defaultLayer),
      Layer.provide(NodeFileSystem.layer),
    )
    const runnerLayer = PowersNexusRunner.layer.pipe(
      Layer.provide(BackgroundJob.defaultLayer),
      Layer.provide(AppProcess.defaultLayer),
      Layer.provide(NodeFileSystem.layer),
      Layer.provide(busLayer),
    )
    const deliveryLayer = PowersNexusDelivery.layer.pipe(
      Layer.provide(runnerLayer),
      Layer.provide(workflowLayer),
      Layer.provide(
        Layer.mock(PowersNexusBrowserQa.Service, {
          run: () =>
            Effect.succeed([
              {
                scenarioID: "delivery-browser",
                viewport: "desktop",
                url: "http://127.0.0.1:4173",
                title: "交付页面",
                screenshots: [],
                consoleErrors: [],
                failedNetwork: [],
                accessibility: '- main "交付页面"',
                overflow: false,
                focusVisible: true,
                blank: false,
                missingText: [],
                passed: true,
                evidenceFiles: [".novaway/powersnexus/changes/delivery-success/proposal.md"],
              },
            ]),
        }),
      ),
      Layer.provide(NodeFileSystem.layer),
    )
    yield* Effect.gen(function* () {
      const workflow = yield* PowersNexusWorkflow.Service
      const runner = yield* PowersNexusRunner.Service
      const delivery = yield* PowersNexusDelivery.Service
      const processService = yield* AppProcess.Service
      const sessions = yield* Session.Service
      yield* fs.writeFileString(path.join(instance.worktree, "package.json"), "{}\n")
      const successChange = yield* prepareChange(
        fs,
        instance.worktree,
        "delivery-success",
        [process.execPath, "-e", "console.log('verified')"],
      )
      const successBinding = yield* workflow.create({ changeName: "delivery-success", level: "L2" })
      const rootSessionID = (yield* sessions.create({ title: "交付撤销测试" })).id
      yield* workflow.bind({
        changeName: "delivery-success",
        sessionID: rootSessionID,
        expectedRevision: successBinding.revision,
        handoff: false,
      })
      const before = yield* workflow.inspect("delivery-success")
      expect(before.phase).toBe("ready_to_verify")
      const started = yield* delivery.start({
        bindingID: successBinding.id,
        expectedRevision: before.revision,
        worktree: instance.worktree,
        evidenceFiles: ["package.json"],
        browserQa: {
          scenarios: [{ id: "delivery-browser", url: "http://127.0.0.1:4173" }],
        },
        steps: [
          { id: "build", argv: [process.execPath, "-e", "console.log('verified')"], cwd: instance.worktree },
        ],
      })
      expect((yield* runner.wait(started.runID, 30_000)).info?.status).toBe("completed")
      const successRun = yield* runner.get(started.runID)
      expect(successRun.run?.status).toBe("passed")
      expect(successRun.run?.fingerprint).toMatch(/^[a-f0-9]{64}$/)
      const deliveryArtifact = JSON.parse(yield* fs.readFileString(path.join(successChange, "delivery.json")))
      expect(deliveryArtifact.verifiedAt).toBeString()
      expect(deliveryArtifact.deliveryFingerprint.digest).toBe(successRun.run?.fingerprint)
      const evidence = yield* runner.evidence({ bindingID: successBinding.id })
      expect(evidence.run.id).toBe(started.runID)
      expect(evidence.files).toContain("package.json")
      expect(evidence.files).toContain(".novaway/powersnexus/changes/delivery-success/proposal.md")
      expect(evidence.files).toContain(`.novaway/powersnexus/runs/${started.runID}/browser-qa.json`)
      expect(evidence.steps[0]?.evidence_digest).toMatch(/^[a-f0-9]{64}$/)
      expect((yield* workflow.inspect("delivery-success")).phase).toBe("ready_to_archive")
      expect((yield* workflow.invalidateDelivery(rootSessionID))?.phase).toBe("ready_to_verify")
      expect((yield* runner.get(started.runID)).run?.error_code).toBe("DELIVERY_FINGERPRINT_INVALID")
      expect((yield* workflow.inspect("delivery-success")).phase).toBe("ready_to_verify")

      const failedChange = yield* prepareChange(
        fs,
        instance.worktree,
        "delivery-failure",
        [process.execPath, "-e", "process.exit(7)"],
      )
      const failedBinding = yield* workflow.create({ changeName: "delivery-failure", level: "L2" })
      const failedBefore = yield* workflow.inspect("delivery-failure")
      const failed = yield* delivery.start({
        bindingID: failedBinding.id,
        expectedRevision: failedBefore.revision,
        worktree: instance.worktree,
        evidenceFiles: ["package.json"],
        steps: [{ id: "build", argv: [process.execPath, "-e", "process.exit(7)"], cwd: instance.worktree }],
      })
      expect((yield* runner.wait(failed.runID, 30_000)).info?.status).toBe("error")
      expect((yield* runner.get(failed.runID)).run).toMatchObject({ status: "failed", fingerprint: null })
      const failedArtifact = JSON.parse(yield* fs.readFileString(path.join(failedChange, "delivery.json")))
      expect(failedArtifact.verifiedAt).toBeUndefined()
      expect((yield* workflow.inspect("delivery-failure")).phase).toBe("ready_to_verify")

      const archiveChange = yield* prepareChange(
        fs,
        instance.worktree,
        "delivery-archive",
        [process.execPath, "-e", "console.log('archive-ready')"],
      )
      const archiveStepIDs = ["build", "test", "integration", "package"]
      yield* fs.writeFileString(
        path.join(archiveChange, "delivery.json"),
        JSON.stringify({
          schemaVersion: "1",
          profile: "library",
          steps: archiveStepIDs.map((id) => ({
            id,
            argv: [process.execPath, "-e", "console.log('archive-ready')"],
            cwd: ".",
            timeoutMs: 30_000,
            status: "pending",
          })),
        }),
      )
      const archiveBinding = yield* workflow.create({ changeName: "delivery-archive", level: "L2" })
      const archiveBefore = yield* workflow.inspect("delivery-archive")
      const archiveRun = yield* delivery.start({
        bindingID: archiveBinding.id,
        expectedRevision: archiveBefore.revision,
        worktree: instance.worktree,
        evidenceFiles: [
          ".novaway/powersnexus/changes/delivery-archive/delta-specs/sample/spec.md",
          "package.json",
          "src/sample.ts",
          "test/sample.test.ts",
        ],
        steps: archiveStepIDs.map((id) => ({
          id,
          argv: [process.execPath, "-e", "console.log('archive-ready')"],
          cwd: instance.worktree,
          timeoutMs: 30_000,
        })),
      })
      expect((yield* runner.wait(archiveRun.runID, 30_000)).info?.status).toBe("completed")
      const archiveReady = yield* workflow.inspect("delivery-archive")
      const check = yield* processService.run(
        ChildProcess.make(process.execPath, [bundled.cliPath, "check", "delivery", "delivery-archive"], {
          cwd: instance.worktree,
          extendEnv: true,
          stdin: "ignore",
          stdout: "pipe",
          stderr: "pipe",
        }),
      )
      expect({
        exitCode: check.exitCode,
        stdout: check.stdout.toString("utf8"),
        stderr: check.stderr.toString("utf8"),
      }).toMatchObject({ exitCode: 0 })
      const archived = yield* workflow.archive({
        bindingID: archiveBinding.id,
        actionID: "archive-action-001",
        expectedRevision: archiveReady.revision,
      })
      expect(archived.replayed).toBe(false)
      expect(yield* fs.exists(archived.archivePath)).toBe(true)
      expect(
        yield* workflow.archive({
          bindingID: archiveBinding.id,
          actionID: "archive-action-001",
          expectedRevision: archiveReady.revision,
        }),
      ).toEqual({ ...archived, replayed: true })
      expect((yield* workflow.list()).some((item) => item.id === archiveBinding.id)).toBe(false)
    }).pipe(Effect.provide(Layer.mergeAll(deliveryLayer, runnerLayer, workflowLayer, sessionLayer, busLayer)))
  }),
  { git: true },
)
