import { afterEach, describe, expect, test } from "bun:test"
import { createFrameBatch } from "./frame-batch"

const globals = globalThis as unknown as {
  requestAnimationFrame?: (callback: () => void) => number
  cancelAnimationFrame?: (handle: number) => void
}

const restore = { raf: globals.requestAnimationFrame, caf: globals.cancelAnimationFrame }

function installFrames() {
  const queue = new Map<number, () => void>()
  let next = 1
  globals.requestAnimationFrame = (callback) => {
    const handle = next++
    queue.set(handle, callback)
    return handle
  }
  globals.cancelAnimationFrame = (handle) => queue.delete(handle)
  return {
    pending: () => queue.size,
    tick: () => {
      const callbacks = [...queue.values()]
      queue.clear()
      for (const callback of callbacks) callback()
    },
  }
}

afterEach(() => {
  if (restore.raf) globals.requestAnimationFrame = restore.raf
  else delete globals.requestAnimationFrame
  if (restore.caf) globals.cancelAnimationFrame = restore.caf
  else delete globals.cancelAnimationFrame
})

describe("createFrameBatch", () => {
  test("keeps event order and flushes once per frame", () => {
    const frames = installFrames()
    const batches: number[][] = []
    const batch = createFrameBatch<number>((items) => batches.push(items))

    batch.push(1)
    batch.push(2)
    batch.push(3)

    expect(batches).toEqual([])
    expect(frames.pending()).toBe(1)
    frames.tick()
    expect(batches).toEqual([[1, 2, 3]])
  })

  test("schedules a new frame after flushing", () => {
    const frames = installFrames()
    const batches: number[][] = []
    const batch = createFrameBatch<number>((items) => batches.push(items))

    batch.push(1)
    frames.tick()
    batch.push(2)
    frames.tick()

    expect(batches).toEqual([[1], [2]])
  })

  test("cancel drops queued events", () => {
    const frames = installFrames()
    const batches: number[][] = []
    const batch = createFrameBatch<number>((items) => batches.push(items))

    batch.push(1)
    batch.cancel()
    frames.tick()

    expect(batches).toEqual([])
    expect(frames.pending()).toBe(0)
  })
})
