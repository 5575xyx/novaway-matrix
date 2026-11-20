import { expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import fs from "node:fs/promises"
import path from "node:path"
import { Agent } from "@/agent/agent"
import { Permission } from "@/permission"
import { PluginHost } from "@/plugin/host"
import { createAgentRegistry, createCommandRegistry, createSkillRegistry, createToolRegistry } from "@/plugin/contributions"
import { createDiscoveredPlugin } from "@/plugin/runtime/activation"
import { createInterceptorRuntime } from "@/plugin/runtime/hooks"
import { createHost } from "@/plugin/runtime/host"
import { PluginRuntimeService } from "@/plugin/runtime/service"
import * as Marketplace from "@/extension/marketplace"
import { tmpdir, provideInstance } from "../fixture/fixture"

const archivePath = process.env.NOVAWAY_AGENCY_AGENTS_ARCHIVE
const run = archivePath ? test : test.skip

run("Agency archive installs and exposes categorized marketplace agents", async () => {
  await using tmp = await tmpdir()
  const config = path.join(tmp.path, "config")
  const home = path.join(tmp.path, "home")
  const workspace = path.join(tmp.path, "workspace")
  await Promise.all([config, home, workspace].map((directory) => fs.mkdir(directory)))
  const bytes = await Bun.file(archivePath!).bytes()
  const original = globalThis.fetch
  globalThis.fetch = Object.assign(async () => new Response(bytes), { preconnect: original.preconnect })
  let installed
  try {
    installed = await Marketplace.installZip({
      name: "com.novaway.agency-agents",
      version: "1.0.0",
      url: "https://example.com/agency-agents-test.zip",
      sha256: Marketplace.digest(Buffer.from(bytes)),
      config,
    })
  } finally {
    globalThis.fetch = original
  }
  expect(installed.files).toBeGreaterThan(180)
  const discovered = await PluginHost.inspect({
    config,
    home,
    directory: workspace,
    worktree: workspace,
    builtin: "",
    cache: path.join(tmp.path, "cache"),
    env: {},
    meta: {},
  })
  const instance = discovered.instances.find((item) => item.id === "agency-agents")
  expect(instance).toMatchObject({ adapter: "v2", status: "installed", diagnostics: [] })
  if (!instance) throw new Error("Agency package was not discovered")
  const registries = () => ({
    tools: createToolRegistry(),
    agents: createAgentRegistry(),
    skills: createSkillRegistry(),
    commands: createCommandRegistry(),
    interceptors: createInterceptorRuntime(),
  })
  const host = createHost(registries())
  const runtime = (current: typeof host) => ({
    registries: current.registries,
    log: { debug() {}, info() {}, warn() {}, error() {} },
    secrets: { read: async () => undefined, write: async () => {}, remove: async () => {} },
  })
  try {
    await host.load(createDiscoveredPlugin({ instance, runtime: runtime(host) }))
    expect(host.registries.agents.list()).toHaveLength(184)
    const layer = Layer.mergeAll(
      Agent.defaultLayer,
      Layer.mock(PluginRuntimeService.Service)({ get: Effect.succeed(host) }),
    )
    await Effect.runPromise(
      Effect.gen(function* () {
        const agents = yield* Agent.Service
        const backend = yield* agents.get("agency-agents_engineering-backend-architect")
        expect(backend?.native).toBeUndefined()
        expect(backend?.mode).toBe("subagent")
        expect(backend?.options.category).toBe("工程开发")
        expect(backend?.options.displayName).toBe("后端架构师")
        expect(backend?.options.agencyPath).toBe("engineering/engineering-backend-architect.md")
        expect(backend?.prompt).toContain("Backend Architect Agent Personality")
        expect(Permission.evaluate("question", "*", backend?.permission ?? []).action).toBe("allow")
        const unity = yield* agents.get("agency-agents_unity-architect")
        expect(unity?.options.category).toBe("游戏开发")
        expect(unity?.options.agencyCategory).toBe("game-development")
        expect(yield* agents.get("engineering-backend-architect")).toMatchObject({
          name: "agency-agents_engineering-backend-architect",
        })
        expect(yield* agents.get("agents-orchestrator")).toMatchObject({
          name: "agency-agents_agents-orchestrator",
          mode: "primary",
        })
      }).pipe(Effect.provide(layer), provideInstance(workspace), Effect.scoped),
    )
    host.deactivate(instance.id, instance.scope)
    expect(host.registries.agents.list()).toHaveLength(0)
  } finally {
    host.dispose()
  }
  expect(await Marketplace.remove("com.novaway.agency-agents@1.0.0", config)).toBe(true)
  expect(await Marketplace.list(config)).toEqual([])
}, 180_000)
