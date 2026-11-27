import { afterEach, describe, expect, test } from "bun:test"
import { adaptiveDelay, createAdaptivePoll } from "./adaptive-poll"

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const setVisibility = (state: "visible" | "hidden") => {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state })
  document.dispatchEvent(new Event("visibilitychange"))
}

afterEach(() => {
  setVisibility("visible")
})

describe("adaptiveDelay", () => {
  test("活跃走 fast，空闲走 idle", () => {
    expect(adaptiveDelay(true, { fast: 2000, idle: 20_000 })).toBe(2000)
    expect(adaptiveDelay(false, { fast: 2000, idle: 20_000 })).toBe(20_000)
  })

  test("没有 idle 时空闲期不排拍", () => {
    expect(adaptiveDelay(false, { fast: 2000 })).toBeUndefined()
  })

  test("负数按 0 处理", () => {
    expect(adaptiveDelay(true, { fast: -5 })).toBe(0)
  })
})

describe("createAdaptivePoll", () => {
  test("注册即拉一次，并按 fast 节奏重复", async () => {
    let calls = 0
    const poll = createAdaptivePoll(() => calls++, { fast: 5, active: () => true })
    expect(calls).toBe(1)
    await sleep(30)
    poll.stop()
    expect(calls).toBeGreaterThan(2)
  })

  test("不可见时停表，恢复可见立刻补一次", async () => {
    setVisibility("hidden")
    let calls = 0
    const poll = createAdaptivePoll(() => calls++, { fast: 5, active: () => true })
    expect(calls).toBe(0)
    await sleep(25)
    expect(calls).toBe(0)

    setVisibility("visible")
    expect(calls).toBe(1)
    await sleep(20)
    poll.stop()
    expect(calls).toBeGreaterThan(1)
  })

  test("空闲期不轮询时不排拍", async () => {
    let calls = 0
    const poll = createAdaptivePoll(() => calls++, { fast: 5, active: () => false })
    await sleep(25)
    expect(calls).toBe(1)
    expect(poll.delay()).toBeUndefined()
    poll.stop()
  })

  test("poke 立即拉一次", async () => {
    let calls = 0
    const poll = createAdaptivePoll(() => calls++, { fast: 1000, active: () => false, idle: 1000, immediate: false })
    expect(calls).toBe(0)
    poll.poke()
    expect(calls).toBe(1)
    poll.stop()
  })

  test("stop 幂等且停表后不再回调", async () => {
    let calls = 0
    const poll = createAdaptivePoll(() => calls++, { fast: 5, active: () => true })
    await sleep(12)
    poll.stop()
    const snapshot = calls
    poll.stop()
    poll.poke()
    await sleep(20)
    expect(calls).toBe(snapshot)
  })
})
