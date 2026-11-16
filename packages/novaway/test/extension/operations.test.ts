import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import * as Operations from "../../src/extension/operations"

async function tmp() {
  return fs.mkdtemp(path.join(os.tmpdir(), "novaway-ops-"))
}

describe("marketplace operations", () => {
  test("persists lifecycle and completion metadata", async () => {
    const data = await tmp()
    const started = await Operations.start({ operationType: "install", packageId: "com.example.demo", version: "1.0.0" }, data)
    expect(started.phase).toBe("queued")
    await Operations.update(started.operationId, { phase: "staging", progress: 50 }, data)
    const completed = await Operations.update(started.operationId, { phase: "completed", progress: 100 }, data)
    expect(completed).toMatchObject({ operationId: started.operationId, phase: "completed", progress: 100 })
    expect(completed?.finishedAt).toBeNumber()
    expect(await Operations.get(started.operationId, data)).toMatchObject({ phase: "completed" })
  })
  test("persists the shared installation, activation, consumer and cleanup matrix", async () => {
    const data = await tmp()
    const started = await Operations.start({ operationType: "update", packageId: "com.example.demo" }, data)
    const phases: Operations.OperationPhase[] = [
      "staging",
      "validating",
      "draining",
      "cleanup-pending",
      "replacing",
      "activating",
      "completed",
    ]
    for (const phase of phases) {
      const current = await Operations.update(started.operationId, { phase }, data)
      expect(current).toMatchObject({ phase })
      expect(current?.installationStatus).toBeString()
      expect(current?.activationStatus).toBeString()
      expect(current?.consumerStatus).toBeString()
      expect(current?.cleanupStatus).toBeString()
      expect(current?.disposeStatus).toBeString()
      expect(current?.requiresRestart).toBe(false)
    }
    const completed = await Operations.get(started.operationId, data)
    expect(completed).toMatchObject({
      phase: "completed",
      installationStatus: "installed",
      activationStatus: "active",
      consumerStatus: "usable",
      cleanupStatus: "completed",
      disposeStatus: "completed",
    })
  })

  test("exposes restart-required and disposal states to every client", async () => {
    const data = await tmp()
    const enabled = await Operations.start(
      { operationType: "enable", packageId: "com.example.restart", requiresRestart: true },
      data,
    )
    const pending = await Operations.update(enabled.operationId, { phase: "completed" }, data)
    expect(pending).toMatchObject({
      phase: "completed",
      activationStatus: "disabled-pending-restart",
      consumerStatus: "undiscovered",
      requiresRestart: true,
    })

    const disabled = await Operations.start({ operationType: "disable", packageId: "com.example.dispose" }, data)
    const draining = await Operations.update(disabled.operationId, { phase: "draining" }, data)
    expect(draining).toMatchObject({
      activationStatus: "draining",
      consumerStatus: "registered",
      cleanupStatus: "pending",
      disposeStatus: "pending",
    })
    const disposed = await Operations.update(disabled.operationId, { phase: "cleanup-pending" }, data)
    expect(disposed).toMatchObject({ activationStatus: "cleanup-pending", cleanupStatus: "pending" })
  })

  test("marks interrupted operations recoverable after a crash", async () => {
    const data = await tmp()
    const started = await Operations.start({ operationType: "rollback", packageId: "com.example.demo" }, data)
    const recovered = await Operations.recover(data)
    expect(recovered).toContainEqual(
      expect.objectContaining({
        operationId: started.operationId,
        phase: "failed",
        errorCode: "MARKETPLACE_OPERATION_INTERRUPTED",
      }),
    )
    expect((await Operations.recover(data)).filter((item) => item.operationId === started.operationId)).toHaveLength(1)
  })
})
