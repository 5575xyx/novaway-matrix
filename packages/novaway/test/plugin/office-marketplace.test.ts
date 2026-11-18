import { expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import fs from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { Agent } from "@/agent/agent"
import { Skill } from "@/skill"
import { Permission } from "@/permission"
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
import { SkillTool } from "@/tool/skill"
import { Tool } from "@/tool/tool"
import { Ripgrep } from "@/file/ripgrep"
import { Truncate } from "@/tool/truncate"
import { Session } from "@/session/session"
import { Service as TeamService } from "@/team/team"
import { MessageID, SessionID } from "@/session/schema"
import * as Marketplace from "@/extension/marketplace"
import { tmpdir, provideInstance } from "../fixture/fixture"

const archivePath = process.env.NOVAWAY_OFFICE_PLUGIN_ARCHIVE
const realUrl = process.env.NOVAWAY_OFFICE_PLUGIN_URL
const realSha = process.env.NOVAWAY_OFFICE_PLUGIN_SHA256
const run = archivePath || realUrl ? test : test.skip

run(
  "Office archive installs, reaches Agent/Skill consumers, releases and cold-loads",
  async () => {
    if (!archivePath && !realUrl) throw new Error("NOVAWAY_OFFICE_PLUGIN_ARCHIVE or NOVAWAY_OFFICE_PLUGIN_URL is required")
    await using tmp = await tmpdir()
    const config = path.join(tmp.path, "config")
    const home = path.join(tmp.path, "home")
    const workspace = path.join(tmp.path, "workspace")
    await Promise.all([config, home, workspace].map((directory) => fs.mkdir(directory)))
    const installed = realUrl
      ? await Marketplace.installZip({
          name: "com.novaway.office-suite",
          version: "0.2.0",
          url: realUrl,
          sha256: realSha,
          config,
        })
      : await (async () => {
          const bytes = await Bun.file(archivePath!).bytes()
          const original = globalThis.fetch
          globalThis.fetch = Object.assign(async () => new Response(bytes), { preconnect: original.preconnect })
          return Marketplace.installZip({
            name: "com.novaway.office-suite",
            version: "0.2.0",
            url: "https://example.com/office-suite-0.2.0-test.zip",
            sha256: Marketplace.digest(Buffer.from(bytes)),
            config,
          }).finally(() => {
            globalThis.fetch = original
          })
        })()
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
    const instance = discovered.instances.find((item) => item.id === "office-suite")
    expect(instance).toMatchObject({ adapter: "v2", status: "installed", diagnostics: [] })
    if (!instance) throw new Error("Office package was not discovered")
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
      expect(host.registries.agents.list()).toHaveLength(9)
      expect(host.registries.skills.list()).toHaveLength(10)
      expect(host.registries.tools.list().map((entry) => entry.name)).toEqual(["office-suite_workbench-status"])
      expect(host.registries.commands.list().map((entry) => entry.name)).toEqual(["office-suite_office-workbench-check"])
      const layer = Layer.mergeAll(
        Agent.defaultLayer,
        Skill.defaultLayer,
        Ripgrep.defaultLayer,
        Truncate.defaultLayer,
        Layer.mock(Session.Service)({}),
        Layer.mock(TeamService)({}),
        Layer.mock(PluginRuntimeService.Service)({ get: Effect.succeed(host) }),
      )
      await Effect.runPromise(
        Effect.gen(function* () {
          const agents = yield* Agent.Service
          const skills = yield* Skill.Service
          const tool = yield* Tool.init(yield* SkillTool)
          for (const entry of host.registries.agents.list()) {
            const agent = yield* agents.get(entry.name)
            expect(agent?.options.modeGroup).toBe("office")
            const name = agent?.options.defaultSkill
            if (!agent || typeof name !== "string") throw new Error("Missing Office default skill")
            expect(agent.prompt).toContain(name)
            expect(Permission.evaluate("skill", name, agent.permission).action).toBe("allow")
            expect(Permission.evaluate("edit", "report.docx", agent.permission).action).toBe("ask")
            const available = yield* skills.available(agent)
            expect(available.some((item) => item.name === name)).toBe(true)
            const skill = yield* skills.get(name)
            expect(skill?.location.startsWith(installed.root)).toBe(true)
            const result = yield* tool.execute(
              { name },
              {
                sessionID: SessionID.make("ses_office_market"),
                messageID: MessageID.make("msg_office_market"),
                agent: agent.name,
                directory: workspace,
                messages: [],
                abort: AbortSignal.timeout(30_000),
                metadata: () => Effect.void,
                ask: (request) =>
                  Effect.sync(() => {
                    expect(request.permission).toBe("skill")
                    expect(request.patterns).toContain(name)
                  }),
              },
            )
            expect(result.output).toContain(`# Skill: ${name}`)
            expect(result.output).toContain(pathToFileURL(skill!.location).href)
            expect(result.output).not.toContain("Base directory for this skill: <built-in>")
          }
          // Creova is the host kernel mode: it keeps access to every active
          // Office contribution without requiring a workbench switch.
          const creova = yield* agents.get("creova")
          if (!creova) throw new Error("Missing Creova agent")
          expect(Permission.evaluate("skill", "office-suite_ppt-master", creova.permission).action).toBe("allow")
          expect(Permission.evaluate("workbench-status", "*", creova.permission).action).toBe("allow")
          expect((yield* skills.available(creova)).some((item) => item.name === "office-suite_ppt-master")).toBe(true)

          const status = host.registries.tools.list()[0]
          if (!status) throw new Error("Missing Office Workbench status tool")
          const statusResult = yield* Effect.promise(() =>
            status.item.execute({}, { abort: AbortSignal.timeout(30_000) } as never),
          )
          const statusPayload = JSON.parse(
            typeof statusResult === "string" ? statusResult : String(statusResult.output),
          ) as {
            capabilities?: { pptMaster?: string }
          }
          expect(statusPayload.capabilities?.pptMaster).toBe("bundled")

          const ppt = yield* skills.get("office-suite_office-ppt")
          if (!ppt) throw new Error("Missing PPT Skill")
          const bundledPptMaster = yield* skills.get("office-suite_ppt-master")
          if (!bundledPptMaster) throw new Error("Missing bundled PPT Master Skill")
          expect(bundledPptMaster.location.startsWith(installed.root)).toBe(true)
          expect(bundledPptMaster.content).toContain("PPT Master")
          const catalog = yield* Effect.promise(() =>
            Bun.file(path.join(ppt.location, "templates/presenton/catalog.json")).json(),
          )
          expect(catalog).toBeDefined()
          expect(ppt.content).not.toContain("packages/app/")
          expect(ppt.content).not.toContain("script/visual-benchmark")
          host.deactivate(instance.id, instance.scope)
          expect(yield* agents.get("office-suite_office-ppt")).toBeUndefined()
          expect(yield* skills.get("office-suite_office-ppt")).toBeUndefined()
          expect((yield* agents.list()).some((item) => item.name.startsWith("office-suite_"))).toBe(false)
          expect((yield* skills.all()).some((item) => item.name.startsWith("office-suite_"))).toBe(false)
        }).pipe(Effect.provide(layer), provideInstance(workspace), Effect.scoped),
      )
    } finally {
      host.dispose()
    }
    const cold = createHost(registries())
    try {
      await cold.load(createDiscoveredPlugin({ instance, runtime: runtime(cold) }))
      expect(cold.registries.agents.list()).toHaveLength(9)
      expect(cold.registries.skills.list()).toHaveLength(10)
      cold.deactivate(instance.id, instance.scope)
      const broken = {
        ...instance,
        manifest: {
          ...instance.manifest,
          contributes: {
            ...instance.manifest.contributes,
            skills: [{ id: "missing", description: "Missing resource", source: { file: "./missing/SKILL.md" } }],
          },
        },
      }
      await expect(cold.load(createDiscoveredPlugin({ instance: broken, runtime: runtime(cold) }))).rejects.toThrow()
      expect(cold.state(instance.id, instance.scope)?.status).toBe("failed")
      expect(cold.registries.agents.list()).toHaveLength(0)
      expect(cold.registries.skills.list()).toHaveLength(0)
    } finally {
      cold.dispose()
    }
    expect(await Marketplace.remove("com.novaway.office-suite@0.2.0", config)).toBe(true)
    expect(await Marketplace.list(config)).toEqual([])
  },
  300_000,
)
