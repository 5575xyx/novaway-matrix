import { expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import fs from "node:fs/promises"
import path from "node:path"
import { Skill } from "@/skill"
import { PluginHost } from "@/plugin/host"
import {
  createAgentRegistry,
  createCommandRegistry,
  createSkillRegistry,
  createToolRegistry,
} from "@/plugin/contributions"
import { createDiscoveredPlugin } from "@/plugin/runtime/activation"
import { createInterceptorRuntime } from "@/plugin/runtime/hooks"
import { createHost } from "@/plugin/runtime/host"
import { PluginRuntimeService } from "@/plugin/runtime/service"
import { Ripgrep } from "@/file/ripgrep"
import { Truncate } from "@/tool/truncate"
import { Session } from "@/session/session"
import { Service as TeamService } from "@/team/team"
import * as Marketplace from "@/extension/marketplace"
import { tmpdir, provideInstance } from "../fixture/fixture"

const archivePath = process.env.NOVAWAY_POWERSNEXUS_ARCHIVE
const realUrl = process.env.NOVAWAY_POWERSNEXUS_URL
const realSha = process.env.NOVAWAY_POWERSNEXUS_SHA256
const run = archivePath || realUrl ? test : test.skip

run(
  "PowersNexus skills archive installs, activates, resolves resources and cold-loads",
  async () => {
    if (!archivePath && !realUrl) throw new Error("NOVAWAY_POWERSNEXUS_ARCHIVE or NOVAWAY_POWERSNEXUS_URL is required")
    await using tmp = await tmpdir()
    const config = path.join(tmp.path, "config")
    const home = path.join(tmp.path, "home")
    const workspace = path.join(tmp.path, "workspace")
    await Promise.all([config, home, workspace].map((directory) => fs.mkdir(directory)))
    const installed = realUrl
      ? await Marketplace.installZip({
          name: "com.novaway.powersnexus",
          version: "1.1.1",
          url: realUrl,
          sha256: realSha,
          config,
        })
      : await (async () => {
          const bytes = await Bun.file(archivePath!).bytes()
          const original = globalThis.fetch
          globalThis.fetch = Object.assign(async () => new Response(bytes), { preconnect: original.preconnect })
          return Marketplace.installZip({
            name: "com.novaway.powersnexus",
            version: "1.1.1",
            url: "https://example.com/powersnexus-test.zip",
            sha256: Marketplace.digest(Buffer.from(bytes)),
            config,
          }).finally(() => {
            globalThis.fetch = original
          })
        })()
    expect(installed.files).toBeGreaterThan(100)
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
    const instance = discovered.instances.find((item) => item.id === "powersnexus")
    expect(instance).toMatchObject({ adapter: "v2", status: "installed", diagnostics: [] })
    if (!instance) throw new Error("PowersNexus package was not discovered")
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
    const plugin = createDiscoveredPlugin({ instance, runtime: runtime(host) })
    try {
      await host.load(plugin)
      expect(host.state(instance.id, instance.scope)?.status).toBe("active")
      expect(host.registries.skills.list()).toHaveLength(23)
      expect(host.registries.agents.list()).toHaveLength(0)
      const layer = Layer.mergeAll(
        Skill.defaultLayer,
        Ripgrep.defaultLayer,
        Truncate.defaultLayer,
        Layer.mock(Session.Service)({}),
        Layer.mock(TeamService)({}),
        Layer.mock(PluginRuntimeService.Service)({ get: Effect.succeed(host) }),
      )
      await Effect.runPromise(
        Effect.gen(function* () {
          const skills = yield* Skill.Service
          const skill = yield* skills.get("powersnexus_using-powersnexus")
          if (!skill) throw new Error("Missing namespaced using-powersnexus skill")
          expect(skill.location.startsWith(installed.root)).toBe(true)
          expect(skill.content).toContain("SUBAGENT-STOP")
          expect(skill.content).not.toContain("Base directory for this skill: <built-in>")
          const tdd = yield* skills.get("powersnexus_test-driven-development")
          if (!tdd) throw new Error("Missing namespaced TDD skill")
          expect(tdd.location.startsWith(installed.root)).toBe(true)
          host.deactivate(instance.id, instance.scope)
          expect(yield* skills.get("powersnexus_using-powersnexus")).toBeUndefined()
        }).pipe(Effect.provide(layer), provideInstance(workspace), Effect.scoped),
      )
    } finally {
      host.dispose()
    }
    const cold = createHost(registries())
    try {
      await cold.load(createDiscoveredPlugin({ instance, runtime: runtime(cold) }))
      expect(cold.registries.skills.list()).toHaveLength(23)
      cold.deactivate(instance.id, instance.scope)
      expect(cold.registries.skills.list()).toHaveLength(0)
    } finally {
      cold.dispose()
    }
    expect(await Marketplace.remove("com.novaway.powersnexus@1.1.1", config)).toBe(true)
    expect(await Marketplace.list(config)).toEqual([])
  },
  180_000,
)