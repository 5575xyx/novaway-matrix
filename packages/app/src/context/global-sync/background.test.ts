import { expect, test } from "bun:test"
import { createBackgroundQueue } from "./background"

const yieldTasks = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

test("gates work, gives visible resources priority and pauses new work on interaction", async () => {
  const ticks = new Set<() => void>()
  const queue = createBackgroundQueue({
    concurrency: 2,
    schedule(work) {
      const tick = () => {
        ticks.delete(tick)
        work()
      }
      ticks.add(tick)
      return () => ticks.delete(tick)
    },
  })
  const advance = async () => {
    ticks.values().next().value?.()
    await yieldTasks()
  }
  const order: string[] = []
  const releases = new Map<string, () => void>()
  const task = (name: string, priority: number) =>
    queue.run(
      () =>
        new Promise<void>((resolve) => {
          order.push(name)
          releases.set(name, resolve)
        }),
      priority,
    )
  const low = task("page", 3)
  const first = task("statuses", 0)
  const next = task("workspaces", 1)
  await advance()
  expect(order).toEqual([])
  queue.setOpen(true)
  await advance()
  await advance()
  await advance()
  expect(order).toEqual(["statuses", "workspaces"])
  queue.setOpen(false)
  releases.get("statuses")!()
  await first
  await advance()
  expect(order).toEqual(["statuses", "workspaces"])
  queue.setOpen(true)
  await advance()
  expect(order).toEqual(["statuses", "workspaces", "page"])
  queue.dispose()
  releases.get("workspaces")!()
  releases.get("page")!()
  await Promise.all([low, next])
})

test("a rejected task releases its slot and disposal drops queued work", async () => {
  const queue = createBackgroundQueue({
    concurrency: 1,
    schedule(fn) {
      const timer = setTimeout(fn, 0)
      return () => clearTimeout(timer)
    },
  })
  const failed = queue.run(() => {
    throw new Error("offline")
  })
  const next = queue.run(() => 42)
  queue.setOpen(true)
  await expect(failed).rejects.toThrow("offline")
  expect(await next).toBe(42)
  queue.setOpen(false)
  const dropped = queue.run(() => {
    throw new Error("not called")
  })
  queue.dispose()
  expect(await dropped).toBeUndefined()
})
