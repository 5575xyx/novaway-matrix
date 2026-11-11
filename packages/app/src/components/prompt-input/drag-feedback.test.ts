import { describe, expect, test } from "bun:test"
import { createDragFeedback } from "./drag-feedback"

describe("prompt drag feedback", () => {
  test("clears feedback after dragover heartbeat stops", () => {
    const states: ("image" | "@mention" | null)[] = []
    const callbacks: (() => void)[] = []
    const feedback = createDragFeedback(
      (type) => states.push(type),
      (callback) => {
        callbacks.push(callback)
        return callbacks.length
      },
      () => {},
    )

    feedback.activate("image")
    callbacks[0]?.()

    expect(states).toEqual(["image", null])
  })

  test("resets feedback immediately and cancels its timeout", () => {
    const states: ("image" | "@mention" | null)[] = []
    const canceled: unknown[] = []
    const feedback = createDragFeedback(
      (type) => states.push(type),
      () => 1,
      (timer) => canceled.push(timer),
    )

    feedback.activate("@mention")
    feedback.reset()

    expect(states).toEqual(["@mention", null])
    expect(canceled).toEqual([1])
  })
})
