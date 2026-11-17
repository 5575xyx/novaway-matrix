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
import * as Marketplace from "../../src/extension/marketplace"
import * as ExtensionCatalog from "../../src/extension/catalog"

const enabled = process.env.NOVAWAY_PUBLIC_MARKETPLACE_E2E === "1"
const run = enabled ? test : test.skip
const catalogUrl = "https://raw.githubusercontent.com/NovaWay-AI/novaway-plugins/main/catalog/index.json"
const artifactUrl =
  "https://github.com/NovaWay-AI/novaway-plugins/releases/download/com.novaway.marketplace-capability-smoke-v0.2.3/com.novaway.marketplace-capability-smoke-0.2.3.zip"
const artifactSha256 = "47d398295a91d2e7f25ceafd8072f4eda829ee24e353451125b7ddc99e0a3093"
const artifactSize = 5389

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
        (entry) => entry.packageId === "com.novaway.marketplace-capability-smoke" && entry.version === "0.2.3",
      )
      expect(catalogEntry).toMatchObject({
        version: "0.2.3",
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
            version: "0.2.3",
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
      expect(installed.root).toContain("com.novaway.marketplace-capability-smoke@0.2.3")
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
    },
    120_000,
  )
})
