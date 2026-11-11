import { describe, expect, test } from "bun:test"
import type { TuiPluginApi } from "@novaway/plugin/tui"
import { createPluginRuntime } from "@novaway/tui/plugin/runtime"
import { TuiPluginRuntime } from "@/plugin/tui/runtime"
import type { PluginLoad } from "@/plugin/tui/runtime"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"

function createApi(events: Set<() => void>) {
  return {
    app: { version: "test" },
    attention: { notify: async () => ({ ok: true, notification: false, sound: false }), soundboard: {} },
    keys: { formatSequence: () => "", formatBindings: () => undefined },
    keymap: {},
    mode: { current: () => "", push: () => () => {} },
    route: { register: () => () => {}, navigate() {}, current: { name: "home" } },
    ui: { dialog: {} },
    tuiConfig: { keybinds: {} },
    kv: { get: (_key: string, fallback?: unknown) => fallback, set() {}, ready: true },
    state: { path: { state: "", config: "", worktree: "", directory: "" } },
    theme: {
      current: {},
      selected: "",
      has: () => false,
      set: () => false,
      install: async () => {},
      mode: () => "dark",
      ready: true,
    },
    client: {},
    event: {
      on(_type: string, handler: () => void) {
        events.add(handler)
        return () => {
          events.delete(handler)
        }
      },
    },
    renderer: {
      once() {},
      on() {},
      off() {},
    },
  } as unknown as TuiPluginApi
}

function createExternalPlugin(id: string, plugin: PluginLoad["module"]["tui"]): PluginLoad {
  return {
    options: undefined,
    spec: id,
    target: id,
    retry: false,
    source: "file",
    id,
    module: { id, tui: plugin },
    origin: { spec: id, scope: "local", source: "test" },
    plugin_root: process.cwd(),
    theme_files: [],
  }
}

test("legacy TUI host exports the existing lifecycle API", () => {
  const host = TuiPluginRuntime.createLegacyTuiPluginHost()
  expect(typeof host.start).toBe("function")
  expect(typeof host.dispose).toBe("function")
})

describe("legacy TUI plugin host lifecycle", () => {
  test("deactivate aborts and releases event listeners, timers, and lifecycle callbacks", async () => {
    const events = new Set<() => void>()
    const calls: string[] = []
    let signal: AbortSignal | undefined
    const plugin = createExternalPlugin("host.fixture", async (api) => {
      signal = api.lifecycle.signal
      const timer = setInterval(() => {}, 60_000)
      api.lifecycle.onDispose(() => {
        clearInterval(timer)
        calls.push("timer")
      })
      api.event.on("session.updated", () => {})
      api.lifecycle.onDispose(() => {
        calls.push("callback")
      })
    })
    const host = TuiPluginRuntime.createLegacyTuiPluginHost({
      resolvePlugins: async () => [plugin],
      internalPlugins: () => [],
      touchPluginMeta: async (items) =>
        items.map((item) => ({
          state: "first" as const,
          entry: {
            ...item,
            source: "file" as const,
            first_time: Date.now(),
            last_time: Date.now(),
            time_changed: Date.now(),
            load_count: 1,
            fingerprint: item.target,
          },
        })),
      refreshGitPlugins() {},
    })
    const runtime = createPluginRuntime()

    await host.start({ api: createApi(events), config: createTuiResolvedConfig(), runtime })
    expect(TuiPluginRuntime.list()).toEqual([
      { id: plugin.id, source: "file", spec: plugin.spec, target: plugin.target, enabled: true, active: true },
    ])
    expect(events.size).toBe(1)
    expect(signal?.aborted).toBe(false)

    expect(await TuiPluginRuntime.deactivatePlugin(plugin.id)).toBe(true)

    expect(signal?.aborted).toBe(true)
    expect(events.size).toBe(0)
    expect(calls).toEqual(["callback", "timer"])
    expect(TuiPluginRuntime.list()[0]).toMatchObject({ enabled: false, active: false })
    await host.dispose()
  })

  test("host dispose releases active plugins in reverse activation order", async () => {
    const events = new Set<() => void>()
    const calls: string[] = []
    const plugins = ["host.first", "host.second"].map((id) =>
      createExternalPlugin(id, async (api) => {
        api.lifecycle.onDispose(() => {
          calls.push(id)
        })
      }),
    )
    const host = TuiPluginRuntime.createLegacyTuiPluginHost({
      resolvePlugins: async () => plugins,
      internalPlugins: () => [],
      touchPluginMeta: async (items) =>
        items.map((item) => ({
          state: "first" as const,
          entry: {
            ...item,
            source: "file" as const,
            first_time: Date.now(),
            last_time: Date.now(),
            time_changed: Date.now(),
            load_count: 1,
            fingerprint: item.target,
          },
        })),
      refreshGitPlugins() {},
    })

    await host.start({ api: createApi(events), config: createTuiResolvedConfig(), runtime: createPluginRuntime() })
    await host.dispose()

    expect(calls).toEqual(["host.second", "host.first"])
    expect(TuiPluginRuntime.list()).toEqual([])
  })
})
