import { describe, expect, test } from "bun:test"
import { createEnterBaseline, ENTER_STAGGER_MAX_INDEX, ENTER_STAGGER_STEP } from "../../src/ui/enter"

// 阶梯入场的基线判定。这是 C0 的核心风险点:消息列表是窗口化的
// (util/message-window.ts,MESSAGE_WINDOW_INITIAL = 60),向上滚动补载时历史消息会
// **重新挂载** —— 入场动画若挂在 mount 上,补载一次就整屏闪一次。
// 这里把「谁算真正的新消息」单独拎成纯函数:不依赖时钟、不依赖渲染,只依赖 id。

describe("createEnterBaseline", () => {
  test("首次挂载时已在集合里的消息不入场(补载的历史消息不会整屏闪)", () => {
    const baseline = createEnterBaseline(["m1", "m2", "m3"])
    expect(baseline.delayFor("m1")).toBeUndefined()
    expect(baseline.delayFor("m2")).toBeUndefined()
    expect(baseline.delayFor("m3")).toBeUndefined()
  })

  test("基线之后才出现的消息才入场,按入场序号递增延迟", () => {
    const baseline = createEnterBaseline(["m1"])
    expect(baseline.delayFor("m2")).toBe(0)
    expect(baseline.delayFor("m3")).toBe(ENTER_STAGGER_STEP)
    expect(baseline.delayFor("m4")).toBe(2 * ENTER_STAGGER_STEP)
  })

  test("延迟封顶:入场序号再大也不会被无限往后推", () => {
    const baseline = createEnterBaseline([])
    for (let i = 0; i < 40; i++) baseline.delayFor(`m${i}`)
    // 封顶档 = MAX_INDEX 步。40ms × 8 = 320ms —— 第 9 张及以后的卡一起入场,
    // 不会让打开长会话时最新的那条消息压着 1 秒多的黑边等。
    expect(baseline.delayFor("last")).toBe(ENTER_STAGGER_MAX_INDEX * ENTER_STAGGER_STEP)
    expect(ENTER_STAGGER_STEP * ENTER_STAGGER_MAX_INDEX).toBeLessThanOrEqual(400)
  })

  test("同一条消息重复求值结果不变(重渲染不会二次计数)", () => {
    const baseline = createEnterBaseline([])
    const first = baseline.delayFor("m1")
    expect(baseline.delayFor("m1")).toBe(first)
    // 序号只被真正的新消息推进
    expect(baseline.delayFor("m2")).toBe(ENTER_STAGGER_STEP)
  })

  test("会话首次挂载时消息还没到(基线为空)→ 之后到达的每条都入场", () => {
    const baseline = createEnterBaseline([])
    expect(baseline.delayFor("m1")).toBe(0)
    expect(baseline.delayFor("m2")).toBe(ENTER_STAGGER_STEP)
  })

  test("基线里的历史消息后来再被挂载一次仍然不入场", () => {
    // 这就是补载窗口那条路径:同一条历史消息第二次出现在 <For> 里。
    const baseline = createEnterBaseline(["old"])
    expect(baseline.delayFor("old")).toBeUndefined()
    expect(baseline.delayFor("old")).toBeUndefined()
  })

  test("每次调用返回独立基线(换会话重建 Session 时不会串上一场会话的序号)", () => {
    const first = createEnterBaseline([])
    expect(first.delayFor("a")).toBe(0)
    expect(first.delayFor("b")).toBe(ENTER_STAGGER_STEP)
    const second = createEnterBaseline(["a"])
    expect(second.delayFor("a")).toBeUndefined()
    expect(second.delayFor("b")).toBe(0)
  })
})
