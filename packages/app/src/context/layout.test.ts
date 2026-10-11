import { describe, expect, test } from "bun:test"
import { createRoot, createSignal } from "solid-js"
import { createSessionKeyReader, ensureSessionKey, migrateLayoutStore, pruneSessionKeys } from "./layout"

describe("layout session-key helpers", () => {
  test("couples touch and scroll seed in order", () => {
    const calls: string[] = []
    const result = ensureSessionKey(
      "dir/a",
      (key) => calls.push(`touch:${key}`),
      (key) => calls.push(`seed:${key}`),
    )

    expect(result).toBe("dir/a")
    expect(calls).toEqual(["touch:dir/a", "seed:dir/a"])
  })

  test("reads dynamic accessor keys lazily", () => {
    const seen: string[] = []

    createRoot((dispose) => {
      const [key, setKey] = createSignal("dir/one")
      const read = createSessionKeyReader(key, (value) => seen.push(value))

      expect(read()).toBe("dir/one")
      setKey("dir/two")
      expect(read()).toBe("dir/two")

      dispose()
    })

    expect(seen).toEqual(["dir/one", "dir/two"])
  })
})

describe("pruneSessionKeys", () => {
  test("keeps active key and drops lowest-used keys", () => {
    const drop = pruneSessionKeys({
      keep: "k4",
      max: 3,
      used: new Map([
        ["k1", 1],
        ["k2", 2],
        ["k3", 3],
        ["k4", 4],
      ]),
      view: ["k1", "k2", "k4"],
      tabs: ["k1", "k3", "k4"],
    })

    expect(drop).toEqual(["k1"])
    expect(drop.includes("k4")).toBe(false)
  })

  test("does not prune without keep key", () => {
    const drop = pruneSessionKeys({
      keep: undefined,
      max: 1,
      used: new Map([
        ["k1", 1],
        ["k2", 2],
      ]),
      view: ["k1"],
      tabs: ["k2"],
    })

    expect(drop).toEqual([])
  })
})

test("migrateLayoutStore v7 删除 per-session viewMode 与 previewWidth", () => {
  const out = migrateLayoutStore({
    sessionView: {
      "dir1/s1": { scroll: {}, viewMode: "split", previewWidth: 500, todoCollapsed: true },
      "dir1/s2": { scroll: {} },
    },
    sidebar: { opened: true, width: 344, defaultCollapsedV1: true },
  }) as Record<string, any>

  expect(out.sessionView["dir1/s1"]).toEqual({ scroll: {}, todoCollapsed: true })
  expect(out.sessionView["dir1/s2"]).toEqual({ scroll: {} })
  expect(out.sidebar).toEqual({ opened: true, width: 344, defaultCollapsedV1: true })
})

test("migrateLayoutStore v7 无 sessionView 时不抛错", () => {
  const out = migrateLayoutStore({ sidebar: { opened: false } }) as Record<string, any>
  expect(out.sidebar.opened).toBe(false)
})
