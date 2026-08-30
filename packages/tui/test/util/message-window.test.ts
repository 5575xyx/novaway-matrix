import { describe, expect, test } from "bun:test"
import { expandMessageWindow, messageWindow } from "../../src/util/message-window"

describe("消息窗口", () => {
  test("消息数不超过窗口时,全部可见、没有隐藏", () => {
    expect(messageWindow(0, 60)).toEqual({ offset: 0, hidden: 0 })
    expect(messageWindow(60, 60)).toEqual({ offset: 0, hidden: 0 })
  })

  test("超出时窗口贴着尾部,offset 即隐藏条数", () => {
    expect(messageWindow(100, 60)).toEqual({ offset: 40, hidden: 40 })
    expect(messageWindow(240, 60)).toEqual({ offset: 180, hidden: 180 })
  })

  test("size 被钳到至少 1,不会因为传入 0 把整条列表藏掉", () => {
    expect(messageWindow(100, 0)).toEqual({ offset: 99, hidden: 99 })
  })

  test("扩一段后重新计算,直到 hidden 归零", () => {
    const first = messageWindow(100, 60)
    const size = expandMessageWindow(60)
    const second = messageWindow(100, size)
    expect(second.hidden).toBeLessThan(first.hidden)
    // 100 条封顶,扩两段就见底
    expect(messageWindow(100, expandMessageWindow(size)).hidden).toBe(0)
  })
})
