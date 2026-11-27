import { describe, expect, test } from "bun:test"
import { createRoot, createSignal } from "solid-js"
import {
  DEFAULT_SIDE_PANE_STATE,
  createSessionKeyReader,
  ensureSessionKey,
  migrateLayoutStore,
  pruneSessionKeys,
  reduceSidePane,
  workbenchModeFromAgent,
  APP_MODES,
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
    const s: SidePaneState = {
      opened: true,
      tabs: ["preview", "terminal", "review"],
      activeTab: "terminal",
      dynamic: {},
    }
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

  test("close clears file hosts and tree state but keeps other panel tabs", () => {
    const s: SidePaneState = {
      opened: true,
      tabs: ["preview", "terminal", "office"],
      activeTab: "preview",
      dynamic: {},
      tree: true,
      secondary: { tab: "office", axis: "right", ratio: 0.5 },
    }
    expect(reduceSidePane(s, { type: "close" })).toEqual({
      opened: false,
      tabs: ["terminal"],
      activeTab: "terminal",
      dynamic: {},
      tree: false,
      secondary: undefined,
    })
  })

  test("close also repairs stale state when the pane is already collapsed", () => {
    const s: SidePaneState = {
      opened: false,
      tabs: ["preview", "terminal"],
      activeTab: "preview",
      dynamic: {},
      tree: true,
    }

    expect(reduceSidePane(s, { type: "close" })).toEqual({
      opened: false,
      tabs: ["terminal"],
      activeTab: "terminal",
      dynamic: {},
      tree: false,
    })
  })

  test("removing the workspace host also clears its file tree", () => {
    const s: SidePaneState = {
      opened: true,
      tabs: ["preview", "terminal"],
      activeTab: "preview",
      dynamic: {},
      tree: true,
    }

    expect(reduceSidePane(s, { type: "remove", tab: "preview" })).toEqual({
      opened: true,
      tabs: ["terminal"],
      activeTab: "terminal",
      dynamic: {},
      tree: false,
    })
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

describe("reduceSidePane split panes", () => {
  test("opens a file tab on the side without touching the primary tab list", () => {
    const s: SidePaneState = { opened: true, tabs: ["preview"], activeTab: "preview", dynamic: {} }
    expect(reduceSidePane(s, { type: "openSecondary", tab: "file:///a.ts", axis: "right" })).toEqual({
      opened: true,
      tabs: ["preview"],
      activeTab: "preview",
      dynamic: {},
      secondary: { tab: "file:///a.ts", axis: "right", ratio: 0.5 },
    })
  })

  test("adds a builtin panel to the strip and moves the primary off an occupied tab", () => {
    const s: SidePaneState = { opened: true, tabs: ["preview", "terminal"], activeTab: "terminal", dynamic: {} }
    const next = reduceSidePane(s, { type: "openSecondary", tab: "terminal", axis: "below" })
    expect(next.tabs).toEqual(["preview", "terminal"])
    expect(next.activeTab).toBe("preview")
    expect(next.secondary).toEqual({ tab: "terminal", axis: "below", ratio: 0.5 })
  })

  test("keeps the ratio when the split is reopened on another axis", () => {
    const s: SidePaneState = {
      opened: true,
      tabs: ["preview"],
      activeTab: "preview",
      dynamic: {},
      secondary: { tab: "file:///a.ts", axis: "right", ratio: 0.3 },
    }
    const next = reduceSidePane(s, { type: "openSecondary", tab: "file:///b.ts", axis: "below" })
    expect(next.secondary).toEqual({ tab: "file:///b.ts", axis: "below", ratio: 0.3 })
  })

  test("clamps the ratio to a usable range", () => {
    const s: SidePaneState = {
      opened: true,
      tabs: ["preview"],
      activeTab: "preview",
      dynamic: {},
      secondary: { tab: "file:///a.ts", axis: "right", ratio: 0.5 },
    }
    const wide = reduceSidePane(s, { type: "setSecondaryRatio", ratio: 0.95 })
    expect(wide.secondary?.ratio).toBe(0.85)
    const narrow = reduceSidePane(s, { type: "setSecondaryRatio", ratio: 0.01 })
    expect(narrow.secondary?.ratio).toBe(0.15)
  })

  test("closing a tab rendered in the secondary pane collapses the split", () => {
    const s: SidePaneState = {
      opened: true,
      tabs: ["preview", "terminal"],
      activeTab: "preview",
      dynamic: {},
      secondary: { tab: "terminal", axis: "right", ratio: 0.5 },
    }
    expect(reduceSidePane(s, { type: "remove", tab: "terminal" }).secondary).toBeUndefined()
    expect(reduceSidePane(s, { type: "closeSecondary" }).secondary).toBeUndefined()
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
    expect(out.sidePane).toEqual({
      opened: false,
      tabs: ["terminal"],
      activeTab: "terminal",
      width: 400,
      dynamic: {},
      tree: false,
      treeWidth: 260,
    })
  })

  test("falls back to an empty pane for illegal legacy values", () => {
    const out = migrateLayoutStore({ sidePane: { tab: "context" } }) as { sidePane: MigratedSidePane }
    expect(out.sidePane).toEqual({
      opened: true,
      tabs: ["preview"],
      activeTab: "preview",
      width: 360,
      dynamic: {},
      tree: false,
      treeWidth: 260,
    })

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

  test("keeps a valid split pane and clamps its ratio", () => {
    const out = migrateLayoutStore({
      sidePane: {
        opened: true,
        tabs: ["preview"],
        activeTab: "preview",
        dynamic: {},
        secondary: { tab: "file:///a.ts", axis: "below", ratio: 0.95 },
      },
    }) as { sidePane: MigratedSidePane }
    expect(out.sidePane.secondary).toEqual({ tab: "file:///a.ts", axis: "below", ratio: 0.85 })
  })

  test("drops a split that duplicates the active tab or has no tab", () => {
    const same = migrateLayoutStore({
      sidePane: {
        opened: true,
        tabs: ["preview"],
        activeTab: "preview",
        dynamic: {},
        secondary: { tab: "preview", axis: "right", ratio: 0.5 },
      },
    }) as { sidePane: MigratedSidePane }
    expect(same.sidePane.secondary).toBeUndefined()

    const empty = migrateLayoutStore({
      sidePane: {
        opened: true,
        tabs: ["preview"],
        activeTab: "preview",
        dynamic: {},
        secondary: { tab: "", axis: "right", ratio: 0.5 },
      },
    }) as { sidePane: MigratedSidePane }
    expect(empty.sidePane.secondary).toBeUndefined()
  })

  test("clears stale tree state when the stored workspace host is gone", () => {
    const out = migrateLayoutStore({
      sidePane: {
        opened: true,
        tabs: ["terminal"],
        activeTab: "terminal",
        dynamic: {},
        tree: true,
      },
    }) as { sidePane: SidePaneState }

    expect(out.sidePane.tree).toBe(false)
  })

  test("leaves stores without a sidePane key untouched", () => {
    const sidebar = { opened: true, width: 344, defaultCollapsedV1: true }
    const out = migrateLayoutStore({ sidebar }) as Record<string, unknown>
    expect(out.sidebar).toBe(sidebar)
    expect(out.sidePane).toBeUndefined()
  })
})

test("fresh sidePane default is expanded with empty tabs", () => {
  expect(DEFAULT_SIDE_PANE_STATE).toEqual({ opened: true, tabs: [], activeTab: null, dynamic: {}, tree: false })
})

describe("migrateLayoutStore mode", () => {
  test("drops the retired 运营 (pulse) mode so the switcher falls back to unselected", () => {
    const out = migrateLayoutStore({
      mode: {
        current: "pulse",
        hasSelected: true,
        projects: { "/a": "pulse", "/b": "zen" },
      },
    }) as { mode: { current?: string; hasSelected: boolean; projects: Record<string, string> } }

    expect(out.mode.current).toBeUndefined()
    expect(out.mode.hasSelected).toBe(false)
    expect(out.mode.projects).toEqual({ "/b": "zen" })
  })

  test("drops the retired 创意 (spark) / 探索 (future) modes", () => {
    for (const retired of ["spark", "future"]) {
      const out = migrateLayoutStore({
        mode: {
          current: retired,
          hasSelected: true,
          projects: { "/a": retired, "/b": "forge" },
        },
      }) as { mode: { current?: string; hasSelected: boolean; projects: Record<string, string> } }

      expect(out.mode.current).toBeUndefined()
      expect(out.mode.hasSelected).toBe(false)
      expect(out.mode.projects).toEqual({ "/b": "forge" })
    }
  })

  test("keeps a still-valid mode untouched", () => {
    const mode = { current: "forge", hasSelected: true, projects: { "/a": "forge" } }
    const out = migrateLayoutStore({ mode }) as { mode: unknown }
    expect(out.mode).toEqual(mode)
  })
})

describe("plugin workbench mode metadata", () => {
  test("keeps only the host kernel mode in static configuration", () => {
    expect(APP_MODES.map((mode) => mode.id)).toEqual(["forge"])
  })

  test("does not synthesize Zen from a legacy office group", () => {
    expect(
      workbenchModeFromAgent({
        mode: "primary",
        options: { modeGroup: "office" },
      }),
    ).toMatchObject({ id: "office", group: "office" })
  })

  test("exposes the office workbench from a plugin agent", () => {
    expect(
      workbenchModeFromAgent({
        mode: "primary",
        options: {
          modeGroup: "office",
          workbench: { id: "zen", name: "办公模式", shortName: "办公" },
        },
      }),
    ).toMatchObject({ id: "zen", name: "办公工作台", shortName: "办公" })
  })

  test("creates a dynamic mode for another plugin workbench", () => {
    expect(
      workbenchModeFromAgent({
        mode: "primary",
        options: {
          modeGroup: "short-drama",
          workbench: { id: "short-drama", name: "短剧生成", shortName: "短剧" },
        },
      }),
    ).toMatchObject({ id: "short-drama", name: "短剧生成", shortName: "短剧" })
  })
})
