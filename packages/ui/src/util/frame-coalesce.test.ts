import { afterEach, describe, expect, test } from "bun:test"
import { createFrameCoalescer } from "./frame-coalesce"

const globals = globalThis as unknown as {
  requestAnimationFrame?: (cb: () => void) => number
  cancelAnimationFrame?: (handle: number) => void
}

const restore = { raf: globals.requestAnimationFrame, caf: globals.cancelAnimationFrame }

function installFrames() {
  const queue = new Map<number, () => void>()
  let next = 1
  globals.requestAnimationFrame = (cb) => {
    const handle = next++
    queue.set(handle, cb)
    return handle
  }
  globals.cancelAnimationFrame = (handle) => {
    queue.delete(handle)
  }
  return {
    pending: () => queue.size,
    tick: () => {
      const callbacks = [...queue.values()]
      queue.clear()
      for (const cb of callbacks) cb()
    },
  }
}

function removeFrames() {
  delete globals.requestAnimationFrame
  delete globals.cancelAnimationFrame
}

afterEach(() => {
  if (restore.raf) globals.requestAnimationFrame = restore.raf
  else delete globals.requestAnimationFrame
  if (restore.caf) globals.cancelAnimationFrame = restore.caf
  else delete globals.cancelAnimationFrame
})

describe("createFrameCoalescer", () => {
  test("同一帧内多次 push 只应用最后一个值", () => {
    const frames = installFrames()
    const applied: number[] = []
    const coalescer = createFrameCoalescer<number>((value) => applied.push(value))

    coalescer.push(1)
    coalescer.push(2)
    coalescer.push(3)

    expect(applied).toEqual([])
    expect(frames.pending()).toBe(1)

    frames.tick()
    expect(applied).toEqual([3])
  })

  test("每帧结束后可以继续调度下一帧", () => {
    const frames = installFrames()
    const applied: number[] = []
    const coalescer = createFrameCoalescer<number>((value) => applied.push(value))

    coalescer.push(1)
    frames.tick()
    coalescer.push(2)
    frames.tick()

    expect(applied).toEqual([1, 2])
  })

  test("flush 立刻应用挂起值且不重复应用", () => {
    const frames = installFrames()
    const applied: number[] = []
    const coalescer = createFrameCoalescer<number>((value) => applied.push(value))

    coalescer.push(7)
    coalescer.flush()
    expect(applied).toEqual([7])

    frames.tick()
    expect(applied).toEqual([7])
    expect(frames.pending()).toBe(0)
  })

  test("flush 在没有挂起值时什么都不做", () => {
    installFrames()
    const applied: number[] = []
    const coalescer = createFrameCoalescer<number>((value) => applied.push(value))

    coalescer.flush()
    expect(applied).toEqual([])
  })

  test("cancel 丢弃挂起值并取消调度", () => {
    const frames = installFrames()
    const applied: number[] = []
    const coalescer = createFrameCoalescer<number>((value) => applied.push(value))

    coalescer.push(1)
    coalescer.cancel()
    expect(frames.pending()).toBe(0)

    frames.tick()
    expect(applied).toEqual([])
  })

  test("没有 rAF 时退化为同步应用", () => {
    removeFrames()
    const applied: number[] = []
    const coalescer = createFrameCoalescer<number>((value) => applied.push(value))

    coalescer.push(1)
    coalescer.push(2)

    expect(applied).toEqual([1, 2])
  })
})
