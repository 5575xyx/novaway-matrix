import { describe, expect, test } from "bun:test"
import { createMemo, createRoot, createSignal } from "solid-js"
import { setMessageJump, subscribeMessageJump } from "../../src/util/message-jump"

// 开一个 reactive root 并跑 fn,返回释放函数。createRoot 不会自动销毁,必须手动 dispose。
function openRoot(fn: (dispose: () => void) => void) {
  let dispose: (() => void) | undefined
  createRoot((d) => {
    dispose = d
    fn(d)
  })
  return () => dispose?.()
}

// Solid 的 effect 走微任务调度,轮询等条件成立;返回 false 表示条件始终没出现。
async function until(check: () => boolean, ticks = 30) {
  for (let i = 0; i < ticks; i++) {
    if (check()) return true
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  return check()
}

describe("消息列表跳转订阅", () => {
  test("点击后触发一次,连点同一条消息也能再次触发", async () => {
    const calls: string[] = []
    const close = openRoot(() => subscribeMessageJump((messageID) => calls.push(messageID)))

    try {
      expect(calls).toEqual([])

      setMessageJump({ messageID: "m1", nonce: 1 })
      expect(await until(() => calls.length === 1)).toBe(true)

      // 连点同一条:nonce 不同即视为新的一次请求。
      setMessageJump({ messageID: "m1", nonce: 2 })
      expect(await until(() => calls.length === 2)).toBe(true)

      expect(calls).toEqual(["m1", "m1"])
    } finally {
      close()
      setMessageJump(null)
    }
  })

  // 回归:原来这里是个裸 createEffect,会把 handler 内部读到的 messages()/窗口偏移
  // 一并登记成依赖。会话同步一更新消息列表就重跑一次,于是一次点击之后视图被反复拉回
  // 同一条消息。现在依赖只挂在 messageJump 上。
  test("会话同步更新消息列表不会重复触发跳转", async () => {
    const calls: string[] = []
    let setMessages: (next: string[]) => void = () => {}
    let readVisible: () => string[] = () => []

    const close = openRoot(() => {
      const [source, setSource] = createSignal<string[]>([])
      setMessages = setSource
      const mem = createMemo(() => source().slice())
      readVisible = () => mem()
      readVisible()

      // handler 内部读 memo,模拟 jumpToMessage 里读 messages()/windowOffset()。
      subscribeMessageJump((messageID) => {
        readVisible()
        calls.push(messageID)
      })
    })

    try {
      setMessageJump({ messageID: "m1", nonce: 1 })
      expect(await until(() => calls.length === 1)).toBe(true)
      expect(calls).toEqual(["m1"])

      // 模拟会话同步:消息列表连续重算多次。
      for (let i = 0; i < 5; i++) setMessages(["m1", "m2", "m3", `m${i}`])
      expect(readVisible()).toEqual(["m1", "m2", "m3", "m4"])

      // 如果依赖没挂住,第二次调用会在这里出现。
      expect(await until(() => calls.length > 1)).toBe(false)
      expect(calls).toEqual(["m1"])
    } finally {
      close()
      setMessageJump(null)
    }
  })

  test("卸载后不再响应跳转请求", async () => {
    const calls: string[] = []
    const close = openRoot(() => subscribeMessageJump((messageID) => calls.push(messageID)))

    setMessageJump({ messageID: "m1", nonce: 1 })
    expect(await until(() => calls.length === 1)).toBe(true)

    close()
    setMessageJump({ messageID: "m2", nonce: 2 })
    expect(await until(() => calls.length > 1)).toBe(false)
    expect(calls).toEqual(["m1"])

    setMessageJump(null)
  })
})
