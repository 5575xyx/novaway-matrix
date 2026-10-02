import { describe, expect, test } from "bun:test"
import { createRoot, createSignal } from "solid-js"
import {
  createEnterBaseline,
  createEnterBaselineStore,
  ENTER_STAGGER_MAX_INDEX,
  ENTER_STAGGER_STEP,
} from "../../src/ui/enter"

// 阶梯入场的基线判定。这是 C0 的核心风险点:消息列表是窗口化的
// (util/message-window.ts,MESSAGE_WINDOW_INITIAL = 60),向上滚动补载时历史消息会
// **重新挂载** —— 入场动画若挂在 mount 上,补载一次就整屏闪一次。
// 这里把「谁算真正的新消息」单独拎成纯函数:不依赖时钟、不依赖渲染,只依赖 id。
//
// 还有第二个会整屏重挂的通道(D4 的视图切换 + 标签切换),见下面 createEnterBaselineStore 那组。

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

  test("同一代里重复求值给同一个答案(流式重渲染不会掐掉正在进行的淡入)", () => {
    // 这一条是**刻意**不做 one-shot 的原因:enterDelay 是 JSX 属性,表达式依赖 props.message,
    // 流式期间消息对象每次更新都是新身份,同一条消息会被问上几十次。若第二次就返回 undefined,
    // ui/card.ts 的 setter 会把它当成「取消入场」,正在进行的 150ms 淡入当场消失。
    const baseline = createEnterBaseline([])
    expect(baseline.delayFor("m1")).toBe(0)
    expect(baseline.delayFor("m1")).toBe(0)
    expect(baseline.delayFor("m1")).toBe(0)
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

describe("createEnterBaselineStore", () => {
  // store 住在组件体里(createEffect/on),所以要一个 reactive owner;dispose 只为不漏警告。
  function mount(input: { known: () => string[]; resetOn: () => unknown }) {
    let dispose = () => {}
    let baseline: () => { delayFor(id: string): number | undefined } = () => {
      throw new Error("还没挂上")
    }
    createRoot((disposeRoot) => {
      dispose = disposeRoot
      baseline = createEnterBaselineStore({
        known: input.known,
        resetOn: input.resetOn,
      })
    })
    return { baseline, dispose }
  }

  test("重挂通道翻转后,当时已知的消息全部退回「不入场」,阶梯序号归零", () => {
    // 这就是「切回气泡视图时整屏卡片重播阶梯入场」的修法:那两个 Show 是当场销毁旧视图、
    // 建出新视图,新实例不知道「这些卡早就亮过了」—— 用重建基线把这件事说出来。
    // known 模拟「此刻会话里有哪些消息」:它必须随消息到达一起变,否则重建出来的基线里
    // 根本没有那条消息(那正是生产里 known = messages().map(id) 的样子)。
    const known = ["a", "b"]
    const [view, setView] = createSignal("bubble")
    const { baseline, dispose } = mount({ known: () => known, resetOn: view })
    try {
      // 首屏之后到达的消息领延迟。
      expect(baseline().delayFor("c")).toBe(0)
      known.push("c")
      // 切换视图 → 重建基线:c 与已知的 a/b 一样都不入场。
      setView("flow")
      expect(baseline().delayFor("c")).toBeUndefined()
      expect(baseline().delayFor("a")).toBeUndefined()
      // 切换之后才到的消息重新从第 0 档开始。
      expect(baseline().delayFor("d")).toBe(0)
      // 再切一次仍然如此(可重复,不靠「只转一次」)。
      known.push("d")
      setView("bubble")
      expect(baseline().delayFor("d")).toBeUndefined()
    } finally {
      dispose()
    }
  })

  test("重挂通道没翻转时基线保持不动(窗口补载那条老路不受影响)", () => {
    const known = ["a"]
    const [view, setView] = createSignal("bubble")
    const { baseline, dispose } = mount({ known: () => known, resetOn: view })
    try {
      expect(baseline().delayFor("b")).toBe(0)
      known.push("b")
      setView("bubble")
      expect(baseline().delayFor("b")).toBe(0)
      expect(baseline().delayFor("c")).toBe(ENTER_STAGGER_STEP)
    } finally {
      dispose()
    }
  })

  test("重挂通道一次翻两个来源(视图 + 标签)也照样重建", () => {
    const known = ["a"]
    const [state, setState] = createSignal({ view: "bubble", tab: "chat" })
    const { baseline, dispose } = mount({
      known: () => known,
      resetOn: () => `${state().view}/${state().tab}`,
    })
    try {
      expect(baseline().delayFor("b")).toBe(0)
      known.push("b")
      setState({ view: "flow", tab: "chat" })
      expect(baseline().delayFor("b")).toBeUndefined()
      // 标签那一路同样会重挂消息子树,所以它也算一个来源。
      known.push("e")
      expect(baseline().delayFor("e")).toBe(0)
      setState({ view: "bubble", tab: "file" })
      expect(baseline().delayFor("e")).toBeUndefined()
    } finally {
      dispose()
    }
  })
})
