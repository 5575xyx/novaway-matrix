import { describe, expect, test } from "bun:test"
import { runComputerLoop, type ComputerAction } from "@/computer/loop"

describe("computer loop", () => {
  test("does not touch the backend while disabled", async () => {
    const calls: string[] = []
    const result = await runComputerLoop({
      enabled: false,
      maxSteps: 4,
      backend: {
        screenshot: async () => {
          calls.push("screenshot")
          return "frame"
        },
        decide: async () => "done" as const,
        approve: async () => true,
        act: async () => {
          calls.push("act")
        },
      },
    })

    expect(result).toEqual({ status: "disabled", steps: 0 })
    expect(calls).toEqual([])
  })

  test("takes screenshots between approved actions and stops at done", async () => {
    const calls: string[] = []
    const actions: ComputerAction[] = [
      { type: "click", x: 10, y: 20 },
      { type: "key", keys: "Enter" },
    ]
    const result = await runComputerLoop({
      enabled: true,
      maxSteps: 5,
      backend: {
        screenshot: async () => {
          calls.push("screenshot")
          return "frame"
        },
        decide: async (_frame, step) => actions[step - 1] ?? "done",
        approve: async (action) => {
          calls.push("approve:" + action.type)
          return true
        },
        act: async (action) => {
          calls.push("act:" + action.type)
        },
      },
    })

    expect(result).toEqual({ status: "completed", steps: 2 })
    expect(calls).toEqual([
      "screenshot",
      "approve:click",
      "act:click",
      "screenshot",
      "approve:key",
      "act:key",
      "screenshot",
    ])
  })

  test("stops on rejected actions and enforces the step limit", async () => {
    const calls: string[] = []
    const backend = {
      screenshot: async () => "frame",
      decide: async () => ({ type: "move", x: 1, y: 2 }) as const,
      approve: async () => {
        calls.push("approve")
        return false
      },
      act: async () => {
        calls.push("act")
      },
    }
    const rejected = await runComputerLoop({ enabled: true, maxSteps: 3, backend })
    expect(rejected).toEqual({ status: "rejected", steps: 0 })
    expect(calls).toEqual(["approve"])

    let count = 0
    const limited = await runComputerLoop({
      enabled: true,
      maxSteps: 2,
      backend: {
        ...backend,
        approve: async () => true,
        act: async () => {
          count++
        },
      },
    })
    expect(limited).toEqual({ status: "max_steps", steps: 2 })
    expect(count).toBe(2)
  })
})
