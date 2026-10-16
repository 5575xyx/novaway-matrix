import { describe, expect, test } from "bun:test"
import { createRoot, createSignal } from "solid-js"
import {
  DEFAULT_SIDE_PANE_STATE,
  createSessionKeyReader,
  ensureSessionKey,
  migrateLayoutStore,
  pruneSessionKeys,
  reduceSidePane,
  type SidePaneState,
} from "./layout"

type MigratedSidePane = SidePaneState & { width: number }

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

test("migrateLayoutStore v7 删除 per-session viewMode、previewWidth 与 todoCollapsed", () => {
  const out = migrateLayoutStore({
    sessionView: {
      "dir1/s1": { scroll: {}, viewMode: "split", previewWidth: 500, todoCollapsed: true },
      "dir1/s2": { scroll: {} },
    },
    sidebar: { opened: true, width: 344, defaultCollapsedV1: true },
  }) as { sessionView: Record<string, unknown>; sidebar: Record<string, unknown> }

  expect(out.sessionView["dir1/s1"]).toEqual({ scroll: {} })
  expect(out.sessionView["dir1/s2"]).toEqual({ scroll: {} })
  expect(out.sidebar).toEqual({ opened: true, width: 344, defaultCollapsedV1: true })
})

test("migrateLayoutStore v7 无 sessionView 时不抛错", () => {
  const out = migrateLayoutStore({ sidebar: { opened: false } }) as Record<string, any>
  expect(out.sidebar.opened).toBe(false)
})

describe("migrateLayoutStore fileTree", () => {
  test("drops legacy fileTree state after seeding review.panelOpened", () => {
    const out = migrateLayoutStore({ fileTree: { opened: true, width: 260, tab: "review" } }) as Record<string, unknown>
    expect("fileTree" in out).toBe(false)
  })
})

describe("migrateLayoutStore git", () => {
  test("drops legacy git panel state", () => {
    const out = migrateLayoutStore({ git: { opened: true, width: 300 } }) as Record<string, unknown>
    expect("git" in out).toBe(false)
  })
})

describe("reduceSidePane", () => {
  test("toggle never creates or switches tabs", () => {
    const s: SidePaneState = { opened: true, tabs: ["review"], activeTab: "review", dynamic: {} }
    expect(reduceSidePane(s, { type: "toggle" })).toEqual({ ...s, opened: false })
  })

  test("removing last tab collapses the pane", () => {
    const s: SidePaneState = { opened: true, tabs: ["preview"], activeTab: "preview", dynamic: {} }
    expect(reduceSidePane(s, { type: "remove", tab: "preview" })).toEqual({
      opened: false,
      tabs: [],
      activeTab: null,
      dynamic: {},
    })
  })

  test("add activates an existing tab instead of duplicating", () => {
    const s: SidePaneState = { opened: false, tabs: ["review"], activeTab: "review", dynamic: {} }
    const next = reduceSidePane(s, { type: "add", tab: "review" })
    expect(next.tabs).toEqual(["review"])
    expect(next.opened).toBe(true)
  })

  test("add appends a new tab and activates it", () => {
    const s: SidePaneState = { opened: true, tabs: ["preview"], activeTab: "preview", dynamic: {} }
    expect(reduceSidePane(s, { type: "add", tab: "terminal" })).toEqual({
      opened: true,
      tabs: ["preview", "terminal"],
      activeTab: "terminal",
      dynamic: {},
    })
  })

  test("remove falls back to a neighbouring tab", () => {
    const s: SidePaneState = { opened: true, tabs: ["preview", "terminal", "review"], activeTab: "terminal", dynamic: {} }
    expect(reduceSidePane(s, { type: "remove", tab: "terminal" })).toEqual({
      opened: true,
      tabs: ["preview", "review"],
      activeTab: "review",
      dynamic: {},
    })
  })

  test("setActive expands without changing tabs", () => {
    const s: SidePaneState = { opened: false, tabs: ["preview", "terminal"], activeTab: "preview", dynamic: {} }
    expect(reduceSidePane(s, { type: "setActive", tab: "terminal" })).toEqual({
      opened: true,
      tabs: ["preview", "terminal"],
      activeTab: "terminal",
      dynamic: {},
    })
  })

  test("close keeps tabs and only collapses the container", () => {
    const s: SidePaneState = { opened: true, tabs: ["preview", "terminal"], activeTab: "preview", dynamic: {} }
    expect(reduceSidePane(s, { type: "close" })).toEqual({ ...s, opened: false })
  })

  test("move reorders tabs without touching the active one", () => {
    const s: SidePaneState = { opened: true, tabs: ["preview", "terminal", "review"], activeTab: "review", dynamic: {} }
    expect(reduceSidePane(s, { type: "move", from: 0, to: 2 })).toEqual({
      opened: true,
      tabs: ["terminal", "review", "preview"],
      activeTab: "review",
      dynamic: {},
    })
  })
})

describe("migrateLayoutStore sidePane", () => {
  test("migrates legacy single tab and maps removed tabs", () => {
    expect(migrateLayoutStore({ sidePane: { opened: true, tab: "files", width: 320 } })).toMatchObject({
      sidePane: { opened: true, tabs: ["review"], activeTab: "review", width: 320, dynamic: {} },
    })
    const git = migrateLayoutStore({ sidePane: { opened: true, tab: "git", width: 320 } }) as {
      sidePane: SidePaneState
    }
    expect(git.sidePane.tabs).toEqual(["preview"])
  })

  test("keeps a legal legacy tab and drops the removed tab field", () => {
    const out = migrateLayoutStore({ sidePane: { opened: false, tab: "terminal", width: 400 } }) as {
      sidePane: MigratedSidePane
    }
    expect(out.sidePane).toEqual({ opened: false, tabs: ["terminal"], activeTab: "terminal", width: 400, dynamic: {} })
  })

  test("falls back to an empty pane for illegal legacy values", () => {
    const out = migrateLayoutStore({ sidePane: { tab: "context" } }) as { sidePane: MigratedSidePane }
    expect(out.sidePane).toEqual({ opened: true, tabs: ["preview"], activeTab: "preview", width: 360, dynamic: {} })

    const broken = migrateLayoutStore({ sidePane: { opened: "yes", tab: "nope", width: "wide" } }) as {
      sidePane: MigratedSidePane
    }
    expect(broken.sidePane.opened).toBe(true)
    expect(broken.sidePane.tabs).toEqual([])
    expect(broken.sidePane.activeTab).toBeNull()
  })

  test("repairs a stored tabs list with duplicates and a dangling activeTab", () => {
    const out = migrateLayoutStore({
      sidePane: { opened: true, tabs: ["preview", "preview", "review"], activeTab: "git", width: 320 },
    }) as { sidePane: MigratedSidePane }
    expect(out.sidePane.tabs).toEqual(["preview", "review"])
    expect(out.sidePane.activeTab).toBe("preview")
  })

  test("leaves stores without a sidePane key untouched", () => {
    const sidebar = { opened: true, width: 344, defaultCollapsedV1: true }
    const out = migrateLayoutStore({ sidebar }) as Record<string, unknown>
    expect(out.sidebar).toBe(sidebar)
    expect(out.sidePane).toBeUndefined()
  })
})

test("fresh sidePane default is expanded with empty tabs", () => {
  expect(DEFAULT_SIDE_PANE_STATE).toEqual({ opened: true, tabs: [], activeTab: null, dynamic: {} })
})
