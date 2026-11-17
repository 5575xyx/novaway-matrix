import { afterEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import type { Logger, SecretStore } from "@novaway/plugin-api"
import { PluginHost } from "@/plugin/host"
import {
  createAgentRegistry,
  createCommandRegistry,
  createOfficeRegistry,
  createPreviewerRegistry,
  createProviderRegistry,
  createSkillRegistry,
  createSurfaceRegistry,
  createToolRegistry,
} from "@/plugin/contributions"
import { createInterceptorRuntime } from "@/plugin/runtime/hooks"
import { createDiscoveredPlugin } from "@/plugin/runtime/activation"
import { createHost, type HostRegistries } from "@/plugin/runtime/host"
import { bindExecutableSuperAgentContributions, createSuperAgentContributionRegistries } from "@/super-agent/plugin-contributions"
import { createDeclarativeRegistries } from "@/plugin/runtime/declarative"
import * as Marketplace from "../../src/extension/marketplace"
import * as ExtensionCatalog from "../../src/extension/catalog"

const enabled = process.env.NOVAWAY_PUBLIC_MARKETPLACE_E2E === "1"
const run = enabled ? test : test.skip
const catalogUrl = "https://raw.githubusercontent.com/NovaWay-AI/novaway-plugins/7feb49e94f4543aea0a5b140869c9c9fd58b0ed8/catalog/index.json"
const artifactUrl =
  "https://github.com/NovaWay-AI/novaway-plugins/releases/download/com.novaway.marketplace-capability-smoke-v0.4.0/com.novaway.marketplace-capability-smoke-0.4.0.zip"
const artifactSha256 = "b2a29e4e3ce148076372a65083647bea58d33e2066563fe618c92cceede74cc0"
const artifactSize = 14576

let base = ""

async function downloadPublicText(url: string) {
  const args = ["-L", "--fail", "--silent", "--show-error", "-A", "novaway-marketplace-capability-test", url]
  let lastError: unknown
  for (let attempt = 0; attempt < 3; attempt += 1) {
    for (const command of ["curl.exe", "curl"]) {
      try {
        const child = Bun.spawn([command, ...args], { stdout: "pipe", stderr: "pipe" })
        const [exitCode, text, errorText] = await Promise.all([
          child.exited,
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
        ])
        if (exitCode === 0) return text
        lastError = new Error(`${command} exited with ${exitCode}: ${errorText}`)
      } catch (error) {
        lastError = error
      }
    }
    await Bun.sleep(1_000 * (attempt + 1))
  }
  throw lastError
}

async function downloadArtifact() {
  await Marketplace.validateArtifactUrl(artifactUrl)
  const args = ["-L", "--fail", "--silent", "--show-error", "-A", "novaway-marketplace-capability-test", artifactUrl]
  let lastError: unknown
  for (let attempt = 0; attempt < 3; attempt += 1) {
    for (const command of ["curl.exe", "curl"]) {
      try {
        const child = Bun.spawn([command, ...args], { stdout: "pipe", stderr: "pipe" })
        const [exitCode, bytes, errorText] = await Promise.all([
          child.exited,
          new Response(child.stdout).arrayBuffer(),
          new Response(child.stderr).text(),
        ])
        if (exitCode === 0) return Buffer.from(bytes)
        lastError = new Error(`${command} exited with ${exitCode}: ${errorText}`)
      } catch (error) {
        lastError = error
      }
    }
    await Bun.sleep(1_000 * (attempt + 1))
  }
  throw lastError
}

function runtimeInput(registries: HostRegistries) {
  const logger: Logger = { debug() {}, info() {}, warn() {}, error() {} }
  const secrets: SecretStore = {
    read: async () => undefined,
    write: async () => {},
    remove: async () => {},
  }
  return { registries, log: logger, secrets }
}

describe("public marketplace capability consumer", () => {
  afterEach(async () => {
    if (base) await fs.rm(base, { recursive: true, force: true })
    base = ""
  })

  run(
    "installs the immutable public artifact and consumes all published capability contributions",
    async () => {
      base = await fs.mkdtemp(path.join(os.tmpdir(), "novaway-marketplace-capability-"))
      const config = path.join(base, "config")
      const home = path.join(base, "home")
      const workspace = path.join(base, "workspace")
      await fs.mkdir(config, { recursive: true })
      await fs.mkdir(home, { recursive: true })
      await fs.mkdir(workspace, { recursive: true })

      const catalogEntries = ExtensionCatalog.parseNovaWay(JSON.parse(await downloadPublicText(catalogUrl)))
      const catalogEntry = catalogEntries.find(
        (entry) => entry.packageId === "com.novaway.marketplace-capability-smoke" && entry.version === "0.4.0",
      )
      expect(catalogEntry).toMatchObject({
        version: "0.4.0",
        capabilities: [
          "agents",
          "skills",
          "tools",
          "commands",
          "interceptors",
          "providers",
          "office",
          "surfaces",
          "previewers",
          "super-agent",
          "agent-runtimes",
          "strategies",
          "task-kinds",
          "verifiers",
          "repair-strategies",
          "agent-templates",
          "policies",
          "mcp",
          "output-styles",
          "lsp",
          "http-routes",
          "triggers",
          "fast-path",
          "routing-policies",
          "worker-types",
          "watchdog-policies",
          "channels",
          "lifecycle-hooks",
          "storage",
        ],
        runtimeTargets: ["novaway-v2"],
        sha256: artifactSha256,
      })

      const artifact = await downloadArtifact()
      expect(artifact.byteLength).toBe(artifactSize)
      expect(Marketplace.digest(artifact)).toBe(artifactSha256)

      let installed: Awaited<ReturnType<typeof Marketplace.installZip>> | undefined
      let installError: unknown
      for (let attempt = 0; attempt < 3 && !installed; attempt += 1) {
        try {
          installed = await Marketplace.installZip({
            name: "com.novaway.marketplace-capability-smoke",
            version: "0.4.0",
            url: artifactUrl,
            sha256: artifactSha256,
            config,
            signal: AbortSignal.timeout(60_000),
          })
        } catch (error) {
          installError = error
          await Bun.sleep(1_000 * (attempt + 1))
        }
      }
      if (!installed) throw installError
      expect(installed.root).toContain("com.novaway.marketplace-capability-smoke@0.4.0")
      const packageRoot = installed.root

      const discovered = await PluginHost.inspect({
        config,
        home,
        directory: workspace,
        worktree: workspace,
        builtin: "",
        cache: path.join(base, "cache"),
        env: {},
        meta: {},
      })
      const instance = discovered.instances.find((item) => item.id === "marketplace-capability-smoke")
      expect(instance).toMatchObject({ adapter: "v2", status: "installed", diagnostics: [] })
      if (!instance || instance.location.kind !== "directory") throw new Error("public capability plugin was not discovered")

      const registries: HostRegistries = {
        tools: createToolRegistry(),
        agents: createAgentRegistry(),
        skills: createSkillRegistry(),
        commands: createCommandRegistry(),
        interceptors: createInterceptorRuntime(),
        providers: createProviderRegistry(),
        office: createOfficeRegistry(),
        previewers: createPreviewerRegistry(),
        surfaces: createSurfaceRegistry(),
        superAgent: createSuperAgentContributionRegistries(),
        declarative: createDeclarativeRegistries(),
      }
      const host = createHost(registries)
      try {
        const plugin = createDiscoveredPlugin({ instance, runtime: runtimeInput(registries) })
        await host.load(plugin)

        expect(host.state(instance.id, instance.scope)).toMatchObject({ status: "active" })
        expect(registries.agents.list().map((entry) => entry.name)).toEqual([
          "marketplace-capability-smoke_capability-reviewer",
        ])
        expect(registries.agents.list()[0]?.item.prompt).toContain("NovaWay Capability Reviewer")
        expect(registries.skills.list().map((entry) => entry.name)).toEqual([
          "marketplace-capability-smoke_marketplace-capability-smoke-skill",
        ])
        const installedSkill = registries.skills.list()[0]?.item
        expect(installedSkill?.source).toHaveProperty("text")
        const skillText = installedSkill && "text" in installedSkill.source ? installedSkill.source.text : ""
        expect(skillText).toContain("Plugin Host")
        expect(registries.commands.list().map((entry) => entry.name)).toEqual([
          "marketplace-capability-smoke_capability-plan",
        ])
        expect(registries.commands.list()[0]?.item.template).toContain("$ARGUMENTS")
        expect(registries.providers?.list().map((entry) => entry.id)).toEqual(["capability-provider"])
        expect(registries.office?.list().map((entry) => entry.format)).toEqual(["novaway-capability"])
        expect(registries.surfaces?.list().map((entry) => ("name" in entry ? entry.name : entry.id))).toEqual([
          "marketplace-capability-smoke_capability-home",
        ])
        expect(registries.previewers?.list().map((entry) => entry.name)).toEqual([
          "marketplace-capability-smoke_capability-preview",
        ])
        expect(registries.interceptors.chain("chat.params")).toEqual([
          { pluginID: "marketplace-capability-smoke", name: "marketplace-capability-smoke_capability-trace" },
        ])
        const params = {} as Record<string, unknown>
        await registries.interceptors.trigger("chat.params", params, params)
        expect(params.marketplaceCapabilitySmoke).toBe(true)

        expect(registries.superAgent?.agentRuntimes.list().map((entry) => entry.id)).toEqual(["capability-runtime"])
        expect(registries.superAgent?.strategies.list().map((entry) => entry.id)).toEqual(["capability-strategy"])
        expect(registries.superAgent?.taskKinds.list().map((entry) => entry.id)).toEqual(["capability-task"])
        expect(registries.superAgent?.verifiers.list().map((entry) => entry.id)).toEqual(["capability-verifier"])
        expect(registries.superAgent?.repairStrategies.list().map((entry) => entry.id)).toEqual(["capability-repair"])
        expect(registries.superAgent?.agentTemplates.list().map((entry) => entry.id)).toEqual(["capability-template"])
        expect(registries.superAgent?.policies.list().map((entry) => entry.id)).toEqual(["capability-policy"])
        expect(registries.superAgent?.surfaces.list().map((entry) => entry.id)).toEqual([
          "capability-super-agent-surface",
        ])

        const executableSuperAgent = bindExecutableSuperAgentContributions(registries.superAgent)
        try {
          const runtime = executableSuperAgent.runtimes.list()[0]
          expect(runtime?.type).toBe("marketplace-smoke")
          expect(await runtime?.discover()).toMatchObject([{ id: "capability-runtime", available: true }])
          const verifier = executableSuperAgent.verifiers.list()[0]
          expect(
            await verifier?.verify({ runID: "fixture", criterion: {} as never, evidence: [] }),
          ).toMatchObject({ outcome: "pass" })
          const repair = executableSuperAgent.repairStrategies.list()[0]
          const repairTask = repair?.create({ runID: "fixture", failed: [], sourceTask: {} as never })
          expect(repairTask).toMatchObject({ kind: "repair", status: "pending" })
        } finally {
          executableSuperAgent.dispose()
        }

        const declarative = registries.declarative
        expect(declarative?.mcpServers.list().map((entry) => entry.item.id)).toEqual(["capability-mcp"])
        expect(declarative?.outputStyles.list().map((entry) => entry.item.id)).toEqual(["capability-output-style"])
        expect(declarative?.lspServers.list().map((entry) => entry.item.id)).toEqual(["capability-lsp"])
        expect(declarative?.lifecycleHooks.list().map((entry) => entry.item.id)).toEqual(["capability-lifecycle"])
        expect(declarative?.httpRoutes.list().map((entry) => entry.item.id)).toEqual(["capability-route"])
        expect(declarative?.triggers.list().map((entry) => entry.item.id)).toEqual(["capability-trigger"])
        expect(declarative?.fastPath.list().map((entry) => entry.item.id)).toEqual(["capability-fast-path"])
        expect(declarative?.routingPolicies.list().map((entry) => entry.item.id)).toEqual(["capability-routing"])
        expect(declarative?.workerTypes.list().map((entry) => entry.item.id)).toEqual(["capability-worker"])
        expect(declarative?.watchdogPolicies.list().map((entry) => entry.item.id)).toEqual(["capability-watchdog"])
        expect(declarative?.channels.list().map((entry) => entry.item.id)).toEqual(["capability-channel"])
        const route = declarative?.httpRoutes.list()[0]?.item as unknown as { handler(): Promise<unknown> }
        expect(await route.handler()).toMatchObject({ status: 200 })
        const trigger = declarative?.triggers.list()[0]?.item as unknown as {
          match(input: unknown): Promise<boolean>
          normalize(input: unknown): unknown
        }
        expect(await trigger.match({ type: "capability" })).toBe(true)
        expect(trigger.normalize({ type: "capability" })).toMatchObject({ triggerID: "capability-trigger" })
        const fastPath = declarative?.fastPath.list()[0]?.item as unknown as {
          when(input: unknown): Promise<boolean>
          handle(input: unknown, context: { record(summary: string): Promise<void> }): Promise<unknown>
        }
        expect(await fastPath.when({})).toBe(true)
        expect(await fastPath.handle({}, { record: async () => {} })).toMatchObject({ handled: true })
        const routing = declarative?.routingPolicies.list()[0]?.item as unknown as { decide(): Promise<unknown> }
        expect(await routing.decide()).toMatchObject({ act: true })
        const worker = declarative?.workerTypes.list()[0]?.item as unknown as { start(): Promise<{ next(): Promise<unknown> }> }
        expect(await (await worker.start()).next()).toMatchObject({ kind: "done" })
        const watchdog = declarative?.watchdogPolicies.list()[0]?.item as unknown as { evaluate(): string }
        expect(watchdog.evaluate()).toBe("healthy")
        const channel = declarative?.channels.list()[0]?.item as unknown as { publish(message: unknown): Promise<unknown> }
        expect(await channel.publish({ text: "installed" })).toMatchObject({ text: "installed" })

        const tool = registries.tools.list().find((entry) => entry.name === "marketplace-capability-smoke_capability-echo")
        expect(tool).toBeDefined()
        const result = await tool!.item.execute(
          { text: "installed" },
          { abort: new AbortController().signal } as never,
        )
        expect(result).toBe("marketplace-capability-smoke:marketplace-capability-smoke:installed")
      } finally {
        host.dispose()
      }
      expect(registries.agents.list()).toEqual([])
      expect(registries.skills.list()).toEqual([])
      expect(registries.tools.list()).toEqual([])
      expect(registries.commands.list()).toEqual([])
      expect(registries.providers?.list()).toEqual([])
      expect(registries.office?.list()).toEqual([])
      expect(registries.surfaces?.list()).toEqual([])
      expect(registries.previewers?.list()).toEqual([])
      expect(registries.interceptors.list()).toEqual([])
      expect(registries.superAgent?.agentRuntimes.list()).toEqual([])
      expect(registries.superAgent?.strategies.list()).toEqual([])
      expect(registries.superAgent?.taskKinds.list()).toEqual([])
      expect(registries.superAgent?.verifiers.list()).toEqual([])
      expect(registries.superAgent?.repairStrategies.list()).toEqual([])
      expect(registries.superAgent?.agentTemplates.list()).toEqual([])
      expect(registries.superAgent?.policies.list()).toEqual([])
      expect(registries.superAgent?.surfaces.list()).toEqual([])
      for (const registry of Object.values(registries.declarative ?? {})) expect(registry.list()).toEqual([])
    },
    120_000,
  )
})
