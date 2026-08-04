import { describe, expect, test } from "bun:test"
import { memorySetupState, runMemorySetup } from "./settings-memory-setup-state"

describe("memory setup shared state", () => {
  test("keeps setup progress outside the settings component lifecycle", async () => {
    let finish!: (value: { ok: boolean; steps: Array<{ step: string; status: string; detail?: string }> }) => void
    const task = runMemorySetup(
      (updatePhase) =>
        new Promise((resolve) => {
          finish = resolve
          updatePhase("pulling")
        }),
    )
    expect(task.started).toBe(true)
    expect(memorySetupState.running).toBe(true)
    expect(memorySetupState.phase).toBe("pulling")

    const duplicate = runMemorySetup(async () => ({ ok: true }))
    expect(duplicate.started).toBe(false)
    expect(duplicate.promise).toBe(task.promise)

    finish({ ok: true, steps: [{ step: "pull", status: "ok", detail: "ready" }] })
    await task.promise
    expect(memorySetupState).toMatchObject({
      running: false,
      phase: "",
      log: "OK pull - ready",
    })
  })
})
