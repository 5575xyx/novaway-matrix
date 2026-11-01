import { describe, expect } from "bun:test"
import { Effect, Fiber } from "effect"
import { Service, defaultLayer } from "@/tool/lock"
import { testEffect } from "../lib/effect"

// 真实时钟：这里要观察的是「谁先拿到锁」，TestClock 不会推动彼此交错的睡眠。
const it = testEffect(defaultLayer)

describe("tool lock", () => {
  it.live("a writer on the same key waits for the one in front of it", () =>
    Effect.gen(function* () {
      const lock = yield* Service
      const order: string[] = []

      const first = yield* Effect.forkScoped(
        Effect.gen(function* () {
          const release = yield* lock.acquire("run:1:task:rt_1", "write")
          order.push("a-start")
          yield* Effect.sleep("40 millis")
          order.push("a-end")
          yield* release
        }),
      )
      yield* Effect.sleep("10 millis")
      const second = yield* Effect.forkScoped(
        Effect.gen(function* () {
          const release = yield* lock.acquire("run:1:task:rt_1", "write")
          order.push("b-start")
          yield* release
        }),
      )
      yield* Fiber.join(first)
      yield* Fiber.join(second)

      // 同一队的两名成员：第二个人必须等第一个人写完。
      expect(order).toEqual(["a-start", "a-end", "b-start"])
    }),
  )

  it.live("writers on different keys never wait for each other", () =>
    Effect.gen(function* () {
      const lock = yield* Service
      const order: string[] = []

      const first = yield* Effect.forkScoped(
        Effect.gen(function* () {
          const release = yield* lock.acquire("run:1:task:rt_1", "write")
          order.push("team1-start")
          yield* Effect.sleep("40 millis")
          order.push("team1-end")
          yield* release
        }),
      )
      yield* Effect.sleep("10 millis")
      const second = yield* Effect.forkScoped(
        Effect.gen(function* () {
          const release = yield* lock.acquire("run:1:task:rt_2", "write")
          order.push("team2-start")
          yield* release
        }),
      )
      yield* Fiber.join(first)
      yield* Fiber.join(second)

      // 两个团队各有一份 worktree：没有理由排队。
      expect(order).toEqual(["team1-start", "team2-start", "team1-end"])
    }),
  )

  it.live("readers share the key, and a writer waits until they are done", () =>
    Effect.gen(function* () {
      const lock = yield* Service
      const order: string[] = []
      const read = (name: string) =>
        Effect.gen(function* () {
          const release = yield* lock.acquire("session:ses_a", "read")
          order.push(name + "-start")
          yield* Effect.sleep("30 millis")
          order.push(name + "-end")
          yield* release
        })

      const r1 = yield* Effect.forkScoped(read("r1"))
      const r2 = yield* Effect.forkScoped(read("r2"))
      yield* Effect.sleep("10 millis")
      const w = yield* Effect.forkScoped(
        Effect.gen(function* () {
          const release = yield* lock.acquire("session:ses_a", "write")
          order.push("w-start")
          yield* release
        }),
      )
      yield* Fiber.join(r1)
      yield* Fiber.join(r2)
      yield* Fiber.join(w)

      // 两个读可以重叠；写必须等两个读都结束。
      expect(order.slice(0, 2).sort()).toEqual(["r1-start", "r2-start"])
      expect(order.at(-1)).toBe("w-start")
      expect(order.indexOf("w-start")).toBeGreaterThan(order.indexOf("r1-end"))
      expect(order.indexOf("w-start")).toBeGreaterThan(order.indexOf("r2-end"))
    }),
  )
})
