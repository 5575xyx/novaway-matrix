import { describe, expect, test } from "bun:test"
import { shouldQueueFollowup } from "./session-followup"

describe("shouldQueueFollowup", () => {
  test("idle: neither mode queues", () => {
    // 空闲时两种模式没有区别，都要立刻发出去。
    expect(shouldQueueFollowup({ mode: "queue", live: false })).toBe(false)
    expect(shouldQueueFollowup({ mode: "steer", live: false })).toBe(false)
  })

  test("running + queue queues", () => {
    expect(shouldQueueFollowup({ mode: "queue", live: true })).toBe(true)
  })

  test("running + steer sends immediately", () => {
    // 这条是这次修复的核心：默认模式下发送必须走 steer，
    // 而不是像以前那样"设置写着引导、行为却是排队"。
    expect(shouldQueueFollowup({ mode: "steer", live: true })).toBe(false)
  })
})
