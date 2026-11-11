import { describe, expect, test } from "bun:test"
import {
  createAgentRegistry,
  createCommandRegistry,
  createProviderRegistry,
  createSkillRegistry,
  createToolRegistry,
} from "@/plugin/contributions"
import { createInterceptorRuntime } from "@/plugin/runtime/hooks"
import { createHost, type HostRegistries, type Plugin } from "@/plugin/runtime/host"
import { PluginRuntimeService } from "@/plugin/runtime/service"
import { Effect, Layer, ManagedRuntime } from "effect"
import { provideInstance } from "../fixture/fixture"
import type { Manifest } from "@novaway/plugin-api"

function setup() {
  const registries: HostRegistries = {
    tools: createToolRegistry(),
    agents: createAgentRegistry(),
    skills: createSkillRegistry(),
    commands: createCommandRegistry(),
    interceptors: createInterceptorRuntime(),
  }
  return { host: createHost(registries), registries }
}

const manifest: Manifest = {
  name: "sample",
  apiVersion: 2,
  contributes: { tools: [] },
}

describe("PluginRuntimeHost", () => {
  test("host service keeps registries isolated per directory instance", async () => {
    const readHost = (directory: string) =>
      Effect.gen(function* () {
        const service = yield* PluginRuntimeService.Service
        return yield* service.get
      }).pipe(Effect.provide(PluginRuntimeService.defaultLayer), provideInstance(directory), Effect.scoped)
    const left = await Effect.runPromise(readHost("/tmp/plugin-left"))
    const right = await Effect.runPromise(readHost("/tmp/plugin-right"))
    expect(left).not.toBe(right)
    expect(left.registries.tools).not.toBe(right.registries.tools)
  })

  test("activation is idempotent and deactivation releases contributions and resources", async () => {
    const { host, registries } = setup()
    let activations = 0
    let disposed = 0
    const plugin: Plugin = {
      id: "sample",
      scope: "project",
      manifest,
      root: "/plugins/sample",
      async activate({ registries: current, resources }) {
        activations += 1
        resources.push({ dispose: () => disposed++ })
        current.tools.register(
          { pluginID: "sample", scope: "project" },
          { id: "hello", description: "hello", parameters: { type: "object" }, execute: async () => "ok" },
        )
      },
    }
    await Promise.all([host.activate(plugin), host.activate(plugin)])
    expect(activations).toBe(1)
    expect(host.states()).toMatchObject([{ id: "project:sample", status: "active" }])
    expect(registries.tools.list().map((entry) => entry.name)).toEqual(["sample_hello"])

    host.deactivate("sample")
    expect(disposed).toBe(1)
    expect(registries.tools.list()).toEqual([])
    expect(host.states()).toMatchObject([{ id: "project:sample", status: "disabled" }])

    await host.activate(plugin)
    expect(activations).toBe(2)
    host.dispose()
    expect(disposed).toBe(2)
    expect(registries.tools.list()).toEqual([])
  })

  test("same plugin id in different scopes has independent lifecycle and contributions", async () => {
    const { host, registries } = setup()
    const makePlugin = (scope: "global" | "project"): Plugin => ({
      id: "shared",
      scope,
      manifest: { ...manifest, name: "shared" },
      root: `/plugins/${scope}/shared`,
      async activate({ registries: current }) {
        current.tools.register(
          { pluginID: "shared", scope },
          { id: "tool", description: scope, parameters: { type: "object" }, execute: async () => scope },
        )
      },
    })

    await host.activate(makePlugin("global"))
    await host.activate(makePlugin("project"))
    expect(registries.tools.list().map((entry) => entry.name)).toEqual(["shared_tool", "shared_tool_2"])

    host.deactivate("shared", "project")
    expect(registries.tools.list()).toMatchObject([{ scope: "global", pluginID: "shared" }])
    expect(host.states()).toMatchObject([
      { id: "global:shared", status: "active" },
      { id: "project:shared", status: "disabled" },
    ])

    host.dispose()
    expect(registries.tools.list()).toEqual([])
  })

  test("deactivate without a host instance still releases legacy contributions", () => {
    const { host, registries } = setup()
    registries.tools.register(
      { pluginID: "legacy-plugin", scope: "global" },
      { id: "legacy", description: "legacy", parameters: { type: "object" }, execute: async () => "" },
    )

    host.deactivate("legacy-plugin")

    expect(registries.tools.list()).toEqual([])
    host.dispose()
  })

  test("activation context cannot release contributions owned by another plugin", async () => {
    const { host, registries } = setup()
    const global: Plugin = {
      id: "global-owner",
      scope: "global",
      manifest: { ...manifest, name: "global-owner" },
      root: "/plugins/global-owner",
      async activate({ registries: current }) {
        current.tools.register(
          { pluginID: "ignored", scope: "global" },
          { id: "tool", description: "global", parameters: { type: "object" }, execute: async () => "global" },
        )
      },
    }
    const project: Plugin = {
      id: "project-owner",
      scope: "global",
      manifest: { ...manifest, name: "project-owner" },
      root: "/plugins/project-owner",
      async activate({ registries: current }) {
        current.tools.register(
          { pluginID: "ignored", scope: "global" },
          { id: "tool", description: "project", parameters: { type: "object" }, execute: async () => "project" },
        )
        current.tools.release("global-owner")
      },
    }

    await host.activate(global)
    await host.activate(project)
    host.deactivate("project-owner", "global")
    expect(registries.tools.list()).toMatchObject([{ scope: "global", pluginID: "global-owner" }])
    host.dispose()
    expect(registries.tools.list()).toEqual([])
  })

  test("activates only the selected plugin and ignores late completion after deactivation", async () => {
    const { host, registries } = setup()
    let finish!: () => void
    let receivedSignal: AbortSignal | undefined
    const pending = new Promise<void>((resolve) => {
      finish = resolve
    })
    const plugin: Plugin = {
      id: "slow",
      scope: "project",
      manifest: { ...manifest, name: "slow" },
      root: "/plugins/slow",
      async activate({ registries: current, signal }) {
        receivedSignal = signal
        current.tools.register(
          { pluginID: "slow", scope: "project" },
          { id: "tool", description: "tool", parameters: { type: "object" }, execute: async () => "" },
        )
        await pending
      },
    }

    const activation = host.activate(plugin)
    await Promise.resolve()
    await Promise.resolve()
    host.deactivate("slow")
    expect(receivedSignal?.aborted).toBe(true)
    const reactivation = host.activate({
      ...plugin,
      async activate({ registries: current }) {
        current.tools.register(
          { pluginID: "slow", scope: "project" },
          { id: "tool", description: "tool", parameters: { type: "object" }, execute: async () => "ready" },
        )
      },
    })
    await reactivation
    finish()
    await expect(activation).rejects.toThrow()
    expect(registries.tools.list().map((entry) => entry.name)).toEqual(["slow_tool"])
    expect(host.states()).toMatchObject([{ id: "project:slow", status: "active" }])
    host.dispose()
  })

  test("an aborted activation cannot register late contributions into a replacement activation", async () => {
    const { host, registries } = setup()
    const ready = Promise.withResolvers<void>()
    const resume = Promise.withResolvers<void>()
    const plugin: Plugin = {
      id: "late",
      scope: "project",
      manifest: { ...manifest, name: "late" },
      root: "/plugins/late",
      async activate({ registries: current }) {
        ready.resolve()
        await resume.promise
        current.tools.register(
          { pluginID: "late", scope: "project" },
          { id: "stale", description: "stale", parameters: { type: "object" }, execute: async () => "stale" },
        )
      },
    }
    const pending = host.activate(plugin)
    await ready.promise
    host.deactivate("late", "project")
    await host.activate({
      ...plugin,
      async activate({ registries: current }) {
        current.tools.register(
          { pluginID: "late", scope: "project" },
          { id: "fresh", description: "fresh", parameters: { type: "object" }, execute: async () => "fresh" },
        )
      },
    })
    resume.resolve()
    await expect(pending).rejects.toThrow()
    expect(registries.tools.list().map((entry) => entry.name)).toEqual(["late_fresh"])
    host.dispose()
  })

  test("disabled snapshots reject new calls and an in-flight tool receives the owner abort signal", async () => {
    const { host, registries } = setup()
    const entered = Promise.withResolvers<AbortSignal>()
    const resume = Promise.withResolvers<void>()
    const plugin: Plugin = {
      id: "snapshot", scope: "project", manifest, root: "/plugins/snapshot",
      async activate({ registries: current }) {
        current.tools.register({ pluginID: "snapshot", scope: "project" }, {
          id: "run", description: "run", parameters: { type: "object" },
          async execute(_, ctx) {
            entered.resolve(ctx.abort)
            await resume.promise
            return String(ctx.abort.aborted)
          },
        })
      },
    }
    await host.load(plugin)
    const tool = registries.tools.list()[0]!.item
    const caller = new AbortController()
    const context = { abort: caller.signal } as Parameters<typeof tool.execute>[1]
    const pending = tool.execute({}, context)
    const signal = await entered.promise
    expect(signal.aborted).toBe(false)
    host.deactivate(plugin.id, plugin.scope)
    expect(signal.aborted).toBe(true)
    expect(caller.signal.aborted).toBe(false)
    resume.resolve()
    expect(await pending).toBe("true")
    await expect(tool.execute({}, context)).rejects.toMatchObject({ code: "tool_unavailable" })
    await host.load(plugin)
    await expect(tool.execute({}, context)).rejects.toMatchObject({ code: "tool_unavailable" })
    host.dispose()
  })

  test("cleanup failures remain failed, release all registrations, and block unsafe reactivation", async () => {
    const { host, registries } = setup()
    const cleaned: string[] = []
    const plugin: Plugin = {
      id: "cleanup", scope: "project", manifest, root: "/plugins/cleanup",
      async activate({ resources, registries: current }) {
        resources.push({ dispose() { cleaned.push("first") } })
        resources.push({ dispose() { cleaned.push("broken"); throw new Error("cleanup exploded") } })
        resources.push({ dispose() { cleaned.push("last") } })
        current.tools.register({ pluginID: "cleanup", scope: "project" }, {
          id: "hello", description: "hello", parameters: { type: "object" }, execute: async () => "ok",
        })
      },
    }
    await host.load(plugin)
    expect(() => host.deactivate("cleanup", "project")).toThrow("cleanup exploded")
    expect(cleaned).toEqual(["last", "broken", "first"])
    expect(registries.tools.list()).toEqual([])
    expect(host.state("cleanup", "project")).toMatchObject({ status: "failed", error: { code: "cleanup_failed" } })
    expect(() => host.deactivate("cleanup", "project")).toThrow("cleanup exploded")
    await expect(host.activate(plugin)).rejects.toMatchObject({ code: "cleanup_failed" })
    host.dispose()
  })

  test("D3: ProviderRegistry contributions are instance-scoped and released with the plugin", async () => {
    const base = setup()
    const providers = createProviderRegistry()
    const host = createHost({ ...base.registries, providers })
    const adapter = { id: "acme", name: "Acme", options: { baseURL: "https://example.test/v1" } }
    await host.load({
      id: "builtin.providers", scope: "builtin", manifest: { ...manifest, name: "builtin.providers" }, root: "/plugins/providers",
      async activate({ registries }) {
        registries.providers?.register(adapter)
      },
    })
    expect(providers.list()).toEqual([adapter])
    expect(providers.resolve("acme")).toBe(adapter)
    host.deactivate("builtin.providers", "builtin")
    expect(providers.list()).toEqual([])
    host.dispose()
  })

  test("D8: a project contribution overrides a builtin contribution and release restores it", async () => {
    const { host, registries } = setup()
    const builtinPlugin: Plugin = {
      id: "builtin.knowledge",
      scope: "builtin",
      manifest: { ...manifest, name: "builtin.knowledge" },
      root: "/plugins/builtin.knowledge",
      async activate({ registries: current }) {
        current.tools.register(
          { pluginID: "builtin.knowledge", scope: "builtin", root: "/plugins/builtin.knowledge", overrides: [] },
          { id: "knowledge_search", global: true, description: "builtin knowledge", parameters: { type: "object" }, execute: async () => "builtin" },
        )
      },
    }
    const replacement: Plugin = {
      id: "acme",
      scope: "project",
      manifest: { ...manifest, name: "acme", overrides: ["builtin.knowledge"] },
      root: "/plugins/acme",
      async activate({ registries: current }) {
        current.tools.register(
          { pluginID: "acme", scope: "project", root: "/plugins/acme", overrides: ["builtin.knowledge"] },
          { id: "knowledge_search", description: "replacement knowledge", parameters: { type: "object" }, execute: async () => "replacement" },
        )
      },
    }

    await host.load(builtinPlugin)
    expect(registries.tools.list().map((entry) => entry.name)).toEqual(["knowledge_search"])
    await host.load(replacement)
    expect(registries.tools.list().map((entry) => entry.name)).toEqual(["acme_knowledge_search"])
    expect(await registries.tools.list()[0]!.item.execute({}, { abort: new AbortController().signal } as never)).toBe("replacement")
    host.deactivate("acme", "project")
    expect(registries.tools.list().map((entry) => entry.name)).toEqual(["knowledge_search"])
    expect(await registries.tools.list()[0]!.item.execute({}, { abort: new AbortController().signal } as never)).toBe("builtin")
    host.dispose()
  })

  test("host disposal releases plugins in reverse activation order", async () => {
    const { host } = setup()
    const order: string[] = []
    for (const id of ["dependency", "dependent", "last"]) {
      await host.load({
        id, scope: "project", manifest, root: `/plugins/${id}`,
        async activate({ resources }) {
          resources.push({ dispose() { order.push(id) } })
        },
      })
    }
    host.dispose()
    expect(order).toEqual(["last", "dependent", "dependency"])
    host.dispose()
    expect(order).toHaveLength(3)
  })

  test("host disposal still releases other plugins when one cleanup fails", async () => {
    const { host } = setup()
    let cleaned = false
    for (const id of ["broken", "healthy"]) await host.load({
      id, scope: "project", manifest, root: `/plugins/${id}`,
      async activate({ resources }) {
        resources.push({ dispose() { if (id === "broken") throw new Error("cleanup exploded"); cleaned = true } })
      },
    })
    expect(() => host.dispose()).toThrow("cleanup exploded")
    expect(cleaned).toBe(true)
    expect(host.state("broken", "project")?.status).toBe("failed")
    expect(host.state("healthy", "project")?.status).toBe("disabled")
    host.dispose()
  })

  test("activation failure rolls back registrations and records the error", async () => {
    const { host, registries } = setup()
    let disposed = 0
    const failure = new Error("activation failed")
    const plugin: Plugin = {
      id: "broken",
      scope: "project",
      manifest: { ...manifest, name: "broken" },
      root: "/plugins/broken",
      async activate({ registries: current, resources }) {
        resources.push({ dispose: () => disposed++ })
        current.tools.register(
          { pluginID: "broken", scope: "project" },
          { id: "partial", description: "partial", parameters: { type: "object" }, execute: async () => "" },
        )
        throw failure
      },
    }

    await expect(host.activate(plugin)).rejects.toBe(failure)
    expect(disposed).toBe(1)
    expect(registries.tools.list()).toEqual([])
    expect(host.states()).toMatchObject([{ id: "project:broken", status: "failed", error: failure }])
    host.dispose()
  })
})
