import { afterAll, afterEach, describe, expect, spyOn, test } from "bun:test"
import { Cause, Context, Effect, Layer, ManagedRuntime } from "effect"
import { memoMap } from "@novaway/core/effect/memo-map"
import { InstanceLayer } from "@/project/instance-layer"
import { InstanceStore } from "@/project/instance-store"
import { PluginRuntimeService } from "@/plugin/runtime/service"
import { DEFAULT_MCP_SERVERS } from "@/config/config"
import { ToolRegistry } from "@/tool/registry"
import { Agent } from "@/agent/agent"
import { Command } from "@/command"
import { Skill } from "@/skill"
import { ProviderID, ModelID } from "@/provider/schema"
import type * as Tool from "@/tool/tool"
import JSZip from "jszip"
import path from "path"
import { pathToFileURL } from "node:url"
import { HttpApiApp } from "../../src/server/routes/instance/httpapi/server"
import { PluginStorage } from "../../src/plugin/storage"
import { Global } from "@novaway/core/global"
import { digest, remove as removeMarketplace } from "../../src/extension/marketplace"
import * as MarketplaceSources from "../../src/extension/sources"
import * as MarketplaceOperations from "../../src/extension/operations"
const PluginPaths = {
  list: "/plugin",
  contributions: "/plugin/contributions",
  diagnostics: "/plugin/diagnostics",
  toggle: "/plugin/:id",
  events: "/plugin/events",
} as const
import { resetDatabase } from "../fixture/db"
import { TestLLMServer } from "../lib/llm-server"
import { tmpdir } from "../fixture/fixture"
import * as Log from "@novaway/core/util/log"

void Log.init({ print: false })

const disabledMcp = Object.fromEntries(
  Object.entries(DEFAULT_MCP_SERVERS).map(([name, config]) => [name, { ...config, enabled: false }]),
)

const context = Context.empty() as Context.Context<unknown>
// Use production layers and the production memo map; do not manufacture an
// InstanceRef or a second Host to make the API assertions pass.
const probe = ManagedRuntime.make(
  Layer.mergeAll(
    PluginRuntimeService.defaultLayer,
    ToolRegistry.defaultLayer,
    Agent.defaultLayer,
    Skill.defaultLayer,
    Command.defaultLayer,
    InstanceLayer.layer,
  ),
  { memoMap },
)
afterAll(() => probe.dispose())

function inInstance<A, E>(directory: string, effect: Effect.Effect<A, E, any>) {
  return probe.runPromise(
    InstanceStore.Service.use((store) => store.provide({ directory }, effect)) as Effect.Effect<
      A,
      E,
      InstanceStore.Service | PluginRuntimeService.Service
    >,
  )
}

function runtimeHost(directory: string) {
  return probe.runPromise(
    InstanceStore.Service.use((store) =>
      store.provide(
        { directory },
        PluginRuntimeService.Service.use((runtime) => runtime.get),
      ),
    ),
  )
}

function runtimeTools(directory: string) {
  return probe.runPromise(
    InstanceStore.Service.use((store) =>
      store.provide(
        { directory },
        ToolRegistry.Service.use((registry) => registry.all()),
      ),
    ),
  )
}

function modelTools(directory: string) {
  return probe.runPromise(
    InstanceStore.Service.use((store) =>
      store.provide(
        { directory },
        Effect.gen(function* () {
          const agentService = yield* Agent.Service
          const agent = (yield* agentService.get("build"))!
          const registry = yield* ToolRegistry.Service
          return yield* registry.tools({
            providerID: ProviderID.make("test"),
            modelID: ModelID.make("test-model"),
            agent,
          })
        }),
      ),
    ),
  )
}

function runtimeAgents(directory: string) {
  return probe.runPromise(
    InstanceStore.Service.use((store) =>
      store.provide(
        { directory },
        Agent.Service.use((svc) => svc.list()),
      ),
    ),
  )
}

function runtimeSkills(directory: string) {
  return probe.runPromise(
    InstanceStore.Service.use((store) =>
      store.provide(
        { directory },
        Skill.Service.use((svc) => svc.all()),
      ),
    ),
  )
}

function runtimeCommands(directory: string) {
  return probe.runPromise(
    InstanceStore.Service.use((store) =>
      store.provide(
        { directory },
        Command.Service.use((svc) => svc.list()),
      ),
    ),
  )
}

async function executablePlugin(
  directory: string,
  name = "sample",
  implementation?: string,
  safety?: { readOnly?: boolean; concurrencySafe?: boolean; destructive?: boolean; idempotent?: boolean },
) {
  const root = path.join(directory, ".novaway", "extensions", name)
  await Bun.write(
    path.join(root, "plugin.json"),
    JSON.stringify({
      name,
      apiVersion: 2,
      kind: "declarative",
      contributes: {
        tools: [{
          id: "hello",
          description: "Executable fixture",
          parameters: { type: "object" },
          entry: "hello.mjs",
          ...(safety ? { safety } : {}),
        }],
      },
    }),
  )
  await Bun.write(
    path.join(root, "hello.mjs"),
    implementation ?? `export default (api) => ({ execute: async () => api.id + ":" + api.signal.aborted })`,
  )
  return root
}

function toolContext(directory: string): Tool.Context {
  return {
    sessionID: "ses_plugin" as Tool.Context["sessionID"],
    messageID: "msg_plugin" as Tool.Context["messageID"],
    agent: "build",
    directory,
    abort: new AbortController().signal,
    messages: [],
    metadata: () => Effect.void,
    ask: () => Effect.void,
  }
}

function request(route: string, directory: string, init: RequestInit = {}) {
  return HttpApiApp.webHandler().handler(
    new Request(new URL(`http://localhost${route}`), {
      ...init,
      headers: {
        "x-novaway-directory": directory,
        ...(init.body === undefined ? {} : { "content-type": "application/json" }),
        ...init.headers,
      },
    }),
    context,
  )
}

function projectInstance(instances: Array<{ id: string; scope?: string; [key: string]: unknown }>, id: string) {
  return instances.find((instance) => instance.id === id && instance.scope === "project")
}

const D1_PROTECTED = ["src/tool/registry.ts", "src/session/prompt.ts", "src/agent/agent.ts"] as const
const D2_PROTECTED = ["src/agent/agent.ts", "src/skill/index.ts", "src/command/index.ts"] as const
async function protectedKernelSnapshot(files: readonly string[] = D1_PROTECTED) {
  const root = path.resolve(import.meta.dir, "../..")
  return Promise.all(
    files.map(
      async (relative) =>
        [relative, Buffer.from(await Bun.file(path.join(root, relative)).arrayBuffer()).toString("hex")] as const,
    ),
  )
}

function expectProtectedKernelUnchanged(before: Awaited<ReturnType<typeof protectedKernelSnapshot>>) {
  return protectedKernelSnapshot(before.map(([file]) => file)).then((after) => expect(after).toEqual(before))
}

async function readChunk(reader: ReadableStreamDefaultReader<Uint8Array>) {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      reader.read(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("timed out waiting for plugin event")), 5_000)
      }),
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

async function readEvent(reader: ReadableStreamDefaultReader<Uint8Array>) {
  const result = await readChunk(reader)
  if (result.done || !result.value) throw new Error("plugin event stream closed")
  const text = new TextDecoder().decode(result.value)
  const data = text.match(/^data: (.+)$/m)?.[1]
  if (!data) throw new Error(`invalid plugin event: ${text}`)
  return JSON.parse(data) as { id: string; type: string; properties: unknown }
}

afterEach(async () => {
  await resetDatabase()
})

describe("plugin HttpApi", () => {
  test("manages marketplace sources through the HTTP API", async () => {
    const server = Bun.serve({
      port: 0,
      fetch: () => Response.json({ schemaVersion: 1, entries: [] }),
    })
    await using tmp = await tmpdir()
    const url = `${server.url}catalog.json`
    let sourceID: string | undefined
    try {
      const listed = await request("/extension/marketplace/sources", tmp.path)
      expect(listed.status).toBe(200)
      expect(await listed.json()).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: "novaway-official", trust: "official", builtin: true })]),
      )

      const added = await request("/extension/marketplace/sources", tmp.path, {
        method: "POST",
        body: JSON.stringify({ name: "HTTP Fixture", type: "auto", url }),
      })
      expect(added.status).toBe(200)
      const created = await added.json()
      sourceID = created.id
      expect(created).toMatchObject({ name: "HTTP Fixture", type: "auto", trust: "unverified", enabled: true })

      const disabled = await request(`/extension/marketplace/sources/${sourceID}`, tmp.path, {
        method: "PATCH",
        body: JSON.stringify({ enabled: false, name: "HTTP Fixture Updated" }),
      })
      expect(disabled.status).toBe(200)
      expect(await disabled.json()).toMatchObject({ name: "HTTP Fixture Updated", enabled: false })

      const enabled = await request(`/extension/marketplace/sources/${sourceID}`, tmp.path, {
        method: "PATCH",
        body: JSON.stringify({ enabled: true }),
      })
      expect(enabled.status).toBe(200)

      const refreshed = await request(`/extension/marketplace/sources/${sourceID}/refresh`, tmp.path, {
        method: "POST",
      })
      expect(refreshed.status).toBe(200)
      expect(await refreshed.json()).toMatchObject({ id: sourceID, lastRefreshAt: expect.any(Number) })

      const removed = await request(`/extension/marketplace/sources/${sourceID}`, tmp.path, {
        method: "DELETE",
      })
      expect(removed.status).toBe(200)
      expect(await removed.json()).toBe(true)
      expect((await request(`/extension/marketplace/sources/${sourceID}`, tmp.path, { method: "DELETE" })).status).toBe(
        404,
      )
      expect(
        (
          await request("/extension/marketplace/sources/novaway-official", tmp.path, {
            method: "DELETE",
          })
        ).status,
      ).toBe(400)
    } finally {
      if (sourceID) await MarketplaceSources.remove(sourceID).catch(() => undefined)
      void server.stop(true)
    }
  })

  test("installs and activates a v2 marketplace package when packageId differs from manifest name", async () => {
    await using tmp = await tmpdir({ config: { mcp: disabledMcp } })
    const packageId = "com.novaway.http-marketplace-smoke"
    const pluginName = "http-marketplace-skill"
    const zip = new JSZip()
    zip.file(
      "plugin.json",
      JSON.stringify({
        name: pluginName,
        version: "0.1.0",
        apiVersion: 2,
        kind: "declarative",
        capabilities: { ui: ["office-engine"] },
        contributes: {
          skills: [
            {
              id: "smoke",
              description: "HTTP marketplace smoke skill",
              source: { text: "Marketplace skill is active." },
            },
          ],
          officeEngines: [
            { format: "marketplace-text", kind: "plaintext", extensions: ["mkt"], entry: "office.mjs" },
          ],
        },
      }),
    )
    zip.file(
      "office.mjs",
      `export default {
        format: "marketplace-text",
        async open(bytes) { return { ok: true, data: { text: new TextDecoder().decode(bytes) } } },
        async apply(state, _ops, bytes) { return { ok: true, data: { state, bytes, changed: [], applied: [] } } },
      }`,
    )
    let archive = Buffer.from(await zip.generateAsync({ type: "nodebuffer" }))
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      if (String(input).includes("gitee.com/NovaWay-AI/novaway-plugins/raw/main/catalog/index.json")) {
        return new Response(
          JSON.stringify({
            schemaVersion: 1,
            entries: [
              {
                packageId,
                name: packageId,
                version: "0.2.0",
                runtimeTargets: ["novaway-v2"],
                capabilities: ["skills"],
                permissions: ["read_workspace", "write_workspace"],
                artifacts: [
                  {
                    type: "github-release",
                    url: "https://example.com/http-marketplace-smoke.zip",
                    sha256: digest(archive),
                  },
                ],
              },
            ],
          }),
          { status: 200 },
        )
      }
      return new Response(new Uint8Array(archive), {
        status: 200,
        headers: { "content-length": String(archive.byteLength) },
      })
    }) as unknown as typeof fetch
    const events = await request(PluginPaths.events, tmp.path)
    expect(events.status).toBe(200)
    if (!events.body) throw new Error("missing plugin event stream")
    const eventReader = events.body.getReader()
    let installedRoot: string | undefined
    try {
      const response = await request("/extension/marketplace/install", tmp.path, {
        method: "POST",
        body: JSON.stringify({
          kind: "zip",
          name: packageId,
          url: "https://example.com/http-marketplace-smoke.zip",
          version: "0.1.0",
          sha256: digest(archive),
          sourceId: "novaway-official",
          permissions: ["read_workspace"],
        }),
      })
      expect(response.status).toBe(200)
      const installed = await response.json()
      installedRoot = installed.root
      expect(installed).toMatchObject({ name: packageId, version: "0.1.0" })
      expect(await readEvent(eventReader)).toMatchObject({
        type: "plugin.changed",
        properties: { pluginID: packageId, enabled: true, generation: 1 },
      })
      expect(installed.operationId).toBeString()
      const operation = await request(`/extension/marketplace/operations/${installed.operationId}`, tmp.path)
      expect(operation.status).toBe(200)
      expect(await operation.json()).toMatchObject({
        operationId: installed.operationId,
        operationType: "install",
        phase: "completed",
        progress: 100,
        installationStatus: "installed",
        activationStatus: "active",
        consumerStatus: "usable",
        cleanupStatus: "completed",
        requiresRestart: false,
      })
      const operationHistory = await request("/extension/marketplace/operations", tmp.path)
      expect(operationHistory.status).toBe(200)
      expect(await operationHistory.json()).toContainEqual(expect.objectContaining({ operationId: installed.operationId }))
      const preview = await request(`/extension/marketplace/${packageId}/update/preview`, tmp.path, { method: "POST" })
      expect(preview.status).toBe(200)
      expect(await preview.json()).toMatchObject({
        currentVersion: "0.1.0",
        targetVersion: "0.2.0",
        sourceChanged: false,
        permissionsAdded: ["write_workspace"],
        permissionsRemoved: [],
        requiresConfirmation: true,
      })
      const replay = await request(`/extension/marketplace/${packageId}/update`, tmp.path, { method: "POST" })
      expect(replay.status).toBe(200)
      expect((await replay.json()).operationId).toBeString()
      expect(await readEvent(eventReader)).toMatchObject({
        type: "plugin.changed",
        properties: { pluginID: packageId, enabled: true, generation: 2 },
      })

      expect(PluginStorage.listForInstance(tmp.path)).toContainEqual(
        expect.objectContaining({ plugin_id: pluginName, enabled: 1, status: "active" }),
      )
      const skill = (await runtimeSkills(tmp.path)).find((item) => item.name === `${pluginName}_smoke`)
      expect(skill).toMatchObject({ content: "Marketplace skill is active." })
      const skillTool = (await runtimeTools(tmp.path)).find((item) => item.id === "skill")
      expect(skillTool).toBeDefined()
      expect(
        await inInstance(tmp.path, skillTool!.execute({ name: `${pluginName}_smoke` }, toolContext(tmp.path))),
      ).toMatchObject({
        output: expect.stringContaining("Marketplace skill is active."),
      })

      const office = (
        (await runtimeHost(tmp.path) as { registries: { office?: { resolve: (id: string) => unknown } } }).registries.office?.resolve(
          "marketplace-text",
        ) as
          | {
              format: string
              kind: string
              extensions: string[]
              engine: { open: (bytes: Uint8Array) => Promise<unknown> }
            }
          | undefined
      )
      expect(office).toMatchObject({ format: "marketplace-text", kind: "plaintext", extensions: ["mkt"] })
      const opened = await office!.engine.open(new TextEncoder().encode("marketplace office"))
      expect(opened).toMatchObject({ ok: true, data: { text: "marketplace office" } })

      const newer = new JSZip()
      newer.file(
        "plugin.json",
        JSON.stringify({
          name: pluginName,
          version: "0.2.0",
          apiVersion: 2,
          kind: "declarative",
          contributes: {
            skills: [{ id: "smoke", description: "HTTP marketplace smoke skill", source: { text: "Updated skill." } }],
          },
        }),
      )
      archive = Buffer.from(await newer.generateAsync({ type: "nodebuffer" }))
      const update = await request("/extension/marketplace/install", tmp.path, {
        method: "POST",
        body: JSON.stringify({
          kind: "zip",
          name: packageId,
          url: "https://example.com/http-marketplace-smoke.zip",
          version: "0.2.0",
          sha256: digest(archive),
        }),
      })
      expect(update.status).toBe(200)
      expect(await readEvent(eventReader)).toMatchObject({
        type: "plugin.changed",
        properties: { pluginID: packageId, enabled: true, generation: 3 },
      })
      const rollback = await request(`/extension/marketplace/${packageId}/rollback`, tmp.path, { method: "POST" })
      expect(rollback.status).toBe(200)
      expect(await rollback.json()).toMatchObject({
        name: packageId,
        version: "0.1.0",
        operationId: expect.any(String),
      })
      expect(await readEvent(eventReader)).toMatchObject({
        type: "plugin.changed",
        properties: { pluginID: packageId, enabled: true, generation: 4 },
      })

      const disabled = await request(`/extension/${pluginName}`, tmp.path, {
        method: "PATCH",
        body: JSON.stringify({ enabled: false }),
      })
      expect(disabled.status).toBe(200)
      const disabledBody = await disabled.json()
      expect(disabledBody).toMatchObject({ enabled: false, operationId: expect.any(String) })
      expect(await readEvent(eventReader)).toMatchObject({
        type: "plugin.changed",
        properties: { pluginID: pluginName, enabled: false, generation: 5 },
      })
      const disabledOperation = (await MarketplaceOperations.list()).find(
        (item) => item.packageId === pluginName && item.operationType === "disable",
      )
      expect(disabledOperation).toMatchObject({ phase: "completed", progress: 100 })

      const enabled = await request(`/extension/${pluginName}`, tmp.path, {
        method: "PATCH",
        body: JSON.stringify({ enabled: true }),
      })
      expect(enabled.status).toBe(200)
      const enabledBody = await enabled.json()
      expect(enabledBody).toMatchObject({ enabled: true, operationId: expect.any(String) })
      expect(await readEvent(eventReader)).toMatchObject({
        type: "plugin.changed",
        properties: { pluginID: pluginName, enabled: true, generation: 6 },
      })
      expect(
        (await MarketplaceOperations.list()).find(
          (item) => item.packageId === pluginName && item.operationType === "enable",
        ),
      ).toMatchObject({ phase: "completed", progress: 100 })

      const removed = await request(`/extension/marketplace/${packageId}`, tmp.path, { method: "DELETE" })
      expect(removed.status).toBe(200)
      expect(await removed.json()).toBe(true)
      expect(await readEvent(eventReader)).toMatchObject({
        type: "plugin.changed",
        properties: { pluginID: packageId, enabled: false, generation: 7 },
      })
      expect(await MarketplaceOperations.list()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ packageId, operationType: "uninstall", phase: "completed" }),
        ]),
      )
    } finally {
      await eventReader.cancel()
      globalThis.fetch = originalFetch
      if (installedRoot) await removeMarketplace(installedRoot).catch(() => undefined)
    }
  }, 60_000)

  test("fails the install operation when a v2 package cannot activate", async () => {
    await using tmp = await tmpdir({ config: { mcp: disabledMcp } })
    const packageId = "com.novaway.http-activation-failure"
    const zip = new JSZip()
    zip.file(
      "plugin.json",
      JSON.stringify({
        name: "http-activation-failure",
        version: "0.1.0",
        apiVersion: 2,
        kind: "declarative",
        contributes: {
          skills: [{ id: "broken", description: "Missing resource", source: { file: "./missing/SKILL.md" } }],
        },
      }),
    )
    const archive = Buffer.from(await zip.generateAsync({ type: "nodebuffer" }))
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () =>
      new Response(new Uint8Array(archive), {
        status: 200,
        headers: { "content-length": String(archive.byteLength) },
      })) as unknown as typeof fetch
    try {
      const response = await request("/extension/marketplace/install", tmp.path, {
        method: "POST",
        body: JSON.stringify({
          kind: "zip",
          name: packageId,
          url: "https://example.com/http-activation-failure.zip",
          version: "0.1.0",
          sha256: digest(archive),
          sourceId: "novaway-official",
        }),
      })
      expect(response.status).toBe(400)
      const operations = await MarketplaceOperations.list()
      const operation = operations.find((item) => item.packageId === packageId && item.operationType === "install")
      expect(operation).toMatchObject({ phase: "failed", errorCode: "PLUGIN_ACTIVATION_FAILED" })
    } finally {
      globalThis.fetch = originalFetch
      await removeMarketplace(packageId).catch(() => undefined)
    }
  }, 60_000)

  test("lists static plugin declarations, contributions and diagnostics", async () => {
    await using tmp = await tmpdir()
    await Bun.write(
      path.join(tmp.path, ".novaway", "extensions", "sample", "plugin.json"),
      JSON.stringify({
        name: "sample",
        apiVersion: 2,
        kind: "declarative",
        contributes: {
          tools: [{ id: "hello", description: "A static tool declaration", parameters: { type: "object" } }],
          agents: ["writer"],
          skills: ["review"],
          commands: ["deploy"],
        },
      }),
    )

    const [list, contributions, diagnostics] = await Promise.all([
      request(PluginPaths.list, tmp.path),
      request(PluginPaths.contributions, tmp.path),
      request(PluginPaths.diagnostics, tmp.path),
    ])

    expect(list.status).toBe(200)
    expect(projectInstance((await list.json()).instances, "sample")).toMatchObject({
      id: "sample",
      origin: "extension",
      status: "installed",
    })
    expect(contributions.status).toBe(200)
    expect(await contributions.json()).toContainEqual(
      expect.objectContaining({ pluginID: "sample", kind: "tool", name: "sample_hello", localName: "hello" }),
    )
    expect(diagnostics.status).toBe(200)
    expect(await diagnostics.json()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          pluginID: "sample",
          contribution: { kind: "tool", name: "sample_hello", localName: "hello", status: "installed" },
        }),
        expect.objectContaining({
          pluginID: "sample",
          contribution: { kind: "agent", name: "sample_writer", localName: "writer", status: "installed" },
        }),
        expect.objectContaining({
          pluginID: "sample",
          contribution: { kind: "skill", name: "sample_review", localName: "review", status: "installed" },
        }),
        expect.objectContaining({
          pluginID: "sample",
          contribution: { kind: "command", name: "sample_deploy", localName: "deploy", status: "installed" },
        }),
      ]),
    )
  })

  test("indexes legacy Extension declarations through the unified catalog", async () => {
    await using tmp = await tmpdir()
    await Bun.write(
      path.join(tmp.path, ".novaway", "extensions", "legacy-pack", "plugin.json"),
      JSON.stringify({ name: "legacy-pack", contributes: { commands: "./commands" } }),
    )
    await Bun.write(path.join(tmp.path, ".novaway", "extensions", "legacy-pack", "commands", "hello.md"), "# Hello")

    const list = await request(PluginPaths.list, tmp.path)
    expect(list.status).toBe(200)
    expect((await list.json()).instances).toContainEqual(
      expect.objectContaining({
        id: "legacy-pack",
        origin: "extension",
        adapter: "legacy-extension",
        status: "installed",
      }),
    )

    const response = await request(PluginPaths.contributions, tmp.path)
    expect(response.status).toBe(200)
    expect(await response.json()).toContainEqual(
      expect.objectContaining({
        pluginID: "legacy-pack",
        kind: "command",
        adapter: "legacy-extension",
      }),
    )
  })

  test("indexes configured TUI exports without importing the TUI module", async () => {
    await using tmp = await tmpdir()
    const tuiDir = path.join(tmp.path, "tui-package")
    const serverDir = path.join(tmp.path, "server-package")
    const serverOnlyDir = path.join(tmp.path, "server-only")
    const tuiMarker = path.join(tmp.path, "tui-imported")
    await Bun.write(
      path.join(tmp.path, ".novaway", "tui.json"),
      JSON.stringify({ plugin: ["../tui-package", "../server-package"] }),
    )
    await Bun.write(
      path.join(tmp.path, "novaway.json"),
      JSON.stringify({ plugin: ["./server-package", "./server-only"] }),
    )
    await Bun.write(
      path.join(tuiDir, "package.json"),
      JSON.stringify({ name: "tui-package", exports: { "./tui": "./surface.ts" } }),
    )
    await Bun.write(
      path.join(serverDir, "package.json"),
      JSON.stringify({
        name: "server-package",
        exports: { "./server": "./server.ts", "./tui": "./server-surface.ts" },
      }),
    )
    await Bun.write(
      path.join(serverOnlyDir, "package.json"),
      JSON.stringify({ name: "server-only", exports: { "./tui": "./unused.ts" } }),
    )
    await Bun.write(path.join(tuiDir, "surface.ts"), `await Bun.write(${JSON.stringify(tuiMarker)}, "tui")`)

    const list = await request(PluginPaths.list, tmp.path)
    expect(list.status).toBe(200)
    const instances = (await list.json()).instances as Array<{
      id: string
      origin: string
      adapter: string
      status: string
    }>
    expect(instances).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "tui-package", origin: "tui", adapter: "legacy-tui", status: "installed" }),
        expect.objectContaining({
          id: "server-package",
          origin: "config-plugin",
          adapter: "legacy-config-plugin",
          status: "installed",
        }),
        expect.objectContaining({
          id: "server-only",
          origin: "config-plugin",
          adapter: "legacy-config-plugin",
          status: "installed",
        }),
      ]),
    )
    expect(instances.filter((instance) => instance.id === "server-package")).toHaveLength(1)

    const response = await request(PluginPaths.contributions, tmp.path)
    expect(response.status).toBe(200)
    const entries = (await response.json()) as Array<{ pluginID: string; kind: string; path?: string; adapter: string }>
    expect(entries).toContainEqual(
      expect.objectContaining({
        pluginID: "tui-package",
        kind: "surface",
        path: "surface.ts",
        adapter: "legacy-tui",
      }),
    )
    expect(entries).toContainEqual(
      expect.objectContaining({
        pluginID: "server-package",
        kind: "surface",
        path: "server-surface.ts",
        adapter: "legacy-config-plugin",
      }),
    )
    expect(entries.filter((entry) => entry.pluginID === "server-only" && entry.kind === "surface")).toHaveLength(0)
    expect(await Bun.file(tuiMarker).exists()).toBe(false)
  }, 60_000)

  test("lists the runtime host state separately from discovery state", async () => {
    await using tmp = await tmpdir()
    await Bun.write(
      path.join(tmp.path, ".novaway", "extensions", "sample", "plugin.json"),
      JSON.stringify({ name: "sample", apiVersion: 2, kind: "declarative", contributes: {} }),
    )

    const listed = await request(PluginPaths.list, tmp.path)
    expect(listed.status).toBe(200)
    const body = await listed.json()
    const instance = projectInstance(body.instances, "sample")
    expect(instance).toMatchObject({ id: "sample", status: "installed" })
    expect(instance).not.toHaveProperty("runtimeStatus")
  })

  test("shipped builtin bundle is active in production consumers and can be disabled/re-enabled", async () => {
    await using tmp = await tmpdir()

    const listed = await request(PluginPaths.list, tmp.path)
    const listBody = await listed.json()
    expect(listBody.instances).toContainEqual(
      expect.objectContaining({
        id: "novaway-ui",
        scope: "builtin",
        status: "installed",
        runtimeStatus: "active",
      }),
    )

    const contributions = await request(PluginPaths.contributions, tmp.path)
    const contributionBody = await contributions.json()
    expect(contributionBody).toContainEqual(
      expect.objectContaining({
        pluginID: "novaway-ui",
        kind: "surface",
        scope: "builtin",
        slot: "sidebar.item",
        title: "NovaWay Home",
        action: { type: "view", viewId: "novaway.home" },
      }),
    )
    expect(contributionBody).toContainEqual(
      expect.objectContaining({
        pluginID: "novaway-ui",
        kind: "surface",
        slot: "settings.section",
        view: expect.objectContaining({ type: "declarative" }),
      }),
    )

    expect(contributionBody).toContainEqual(
      expect.objectContaining({
        pluginID: "novaway-ui",
        kind: "surface",
        slot: "message.part.renderer",
        match: { tool: "bash" },
        renderer: { type: "builtin", id: "novaway.fixture-tool-result" },
      }),
    )

    expect(contributionBody).toContainEqual(
      expect.objectContaining({
        pluginID: "novaway-ui",
        kind: "office-engine",
        name: "foo",
        scope: "builtin",
        extensions: ["foo"],
      }),
    )
    expect(contributionBody).toContainEqual(
      expect.objectContaining({
        pluginID: "novaway-ui",
        kind: "previewer",
        localName: "foo-preview",
        scope: "builtin",
        match: { extension: [".foo"] },
        viewId: "novaway.office.file",
        priority: 100,
        readOnly: false,
      }),
    )

    const toggle = (enabled: boolean) =>
      request(PluginPaths.toggle.replace(":id", "novaway-ui"), tmp.path, {
        method: "PATCH",
        body: JSON.stringify({ enabled, scope: "builtin" }),
      })
    expect((await toggle(false)).status).toBe(200)
    const disabledContributions = await (await request(PluginPaths.contributions, tmp.path)).json()
    expect(
      disabledContributions.some(
        (item: { pluginID?: string; kind?: string }) => item.pluginID === "novaway-ui" && item.kind === "previewer",
      ),
    ).toBe(false)
    expect((await toggle(true)).status).toBe(200)
    const reenabledContributions = await (await request(PluginPaths.contributions, tmp.path)).json()
    expect(
      reenabledContributions.some(
        (item: { pluginID?: string; kind?: string; localName?: string }) =>
          item.pluginID === "novaway-ui" && item.kind === "previewer" && item.localName === "foo-preview",
      ),
    ).toBe(true)
  })

  test("D5: builtin publish driver account storage, execution, disable and re-enable are instance-scoped", async () => {
    await using tmp = await tmpdir()

    const initial = await request("/plugin/publish/accounts", tmp.path)
    expect(initial.status).toBe(200)
    expect(await initial.json()).toEqual([])

    const added = await request("/plugin/publish/accounts", tmp.path, {
      method: "POST",
      body: JSON.stringify({ driverID: "fixture-publish", profile: { label: "Release account" } }),
    })
    expect(added.status).toBe(200)
    const account = await added.json()
    expect(account).toMatchObject({
      driverID: "fixture-publish",
      label: "Release account",
      profile: { label: "Release account" },
    })
    expect(account).not.toHaveProperty("token")

    const contributionBody = await (await request(PluginPaths.contributions, tmp.path)).json()
    expect(contributionBody).toContainEqual(
      expect.objectContaining({
        pluginID: "novaway-ui",
        kind: "publish-driver",
        name: "NovaWay Fixture Publish",
        localName: "fixture-publish",
        scope: "builtin",
      }),
    )

    const executed = await request("/plugin/publish/execute", tmp.path, {
      method: "POST",
      body: JSON.stringify({
        driverID: "fixture-publish",
        accountID: account.id,
        kind: "article",
        payload: { title: "Runtime publish proof", description: "host bridge" },
      }),
    })
    expect(executed.status).toBe(200)
    expect(await executed.json()).toMatchObject({
      ok: true,
      driverID: "fixture-publish",
      accountID: account.id,
      kind: "article",
    })

    const disable = await request(PluginPaths.toggle.replace(":id", "novaway-ui"), tmp.path, {
      method: "PATCH",
      body: JSON.stringify({ enabled: false, scope: "builtin" }),
    })
    expect(disable.status).toBe(200)
    expect(await (await request("/plugin/publish/accounts", tmp.path)).json()).toEqual([])
    const disabledContributions = await (await request(PluginPaths.contributions, tmp.path)).json()
    expect(
      disabledContributions.some(
        (item: { pluginID?: string; kind?: string }) =>
          item.pluginID === "novaway-ui" && item.kind === "publish-driver",
      ),
    ).toBe(false)

    const reenable = await request(PluginPaths.toggle.replace(":id", "novaway-ui"), tmp.path, {
      method: "PATCH",
      body: JSON.stringify({ enabled: true, scope: "builtin" }),
    })
    expect(reenable.status).toBe(200)
    expect(await (await request("/plugin/publish/accounts", tmp.path)).json()).toContainEqual(
      expect.objectContaining({ id: account.id, driverID: "fixture-publish", label: "Release account" }),
    )
    const restoredContributions = await (await request(PluginPaths.contributions, tmp.path)).json()
    expect(
      restoredContributions.some(
        (item: { pluginID?: string; kind?: string; localName?: string }) =>
          item.pluginID === "novaway-ui" && item.kind === "publish-driver" && item.localName === "fixture-publish",
      ),
    ).toBe(true)

    await using other = await tmpdir()
    expect(await (await request("/plugin/publish/accounts", other.path)).json()).toEqual([])
  })

  test("disabling a failed plugin persists the completed disabled lifecycle state", async () => {
    await using tmp = await tmpdir()
    await Bun.write(
      path.join(tmp.path, ".novaway", "extensions", "sample", "plugin.json"),
      JSON.stringify({ name: "sample", apiVersion: 2, kind: "declarative", contributes: {} }),
    )

    const toggled = await request(PluginPaths.toggle.replace(":id", "sample"), tmp.path, {
      method: "PATCH",
      body: JSON.stringify({ enabled: false }),
    })

    expect(toggled.status).toBe(200)
    expect(PluginStorage.get("sample", "project", tmp.path)).toMatchObject({ enabled: 0, status: "disabled" })
  })

  test("instance bootstrap reactivates persisted-enabled v2 plugins before consumers load", async () => {
    await using tmp = await tmpdir()
    const root = await executablePlugin(tmp.path)
    PluginStorage.save({
      pluginID: "sample",
      scope: "project",
      instanceKey: tmp.path,
      source: root,
      root,
      enabled: true,
    })

    const tools = await runtimeTools(tmp.path)
    const pluginTool = tools.find((tool) => tool.id === "sample_hello")
    expect(pluginTool).toBeDefined()
    expect(await inInstance(tmp.path, pluginTool!.execute({}, toolContext(tmp.path)))).toMatchObject({
      output: "sample:false",
    })
    expect(PluginStorage.get("sample", "project", tmp.path)).toMatchObject({ enabled: 1, status: "active" })
  }, 30_000)

  test("a broken persisted plugin does not abort instance bootstrap", async () => {
    await using tmp = await tmpdir()
    const root = await executablePlugin(
      tmp.path,
      "broken",
      `export default () => { throw new Error("cold start exploded") }`,
    )
    PluginStorage.save({
      pluginID: "broken",
      scope: "project",
      instanceKey: tmp.path,
      source: root,
      root,
      enabled: true,
    })

    const tools = await runtimeTools(tmp.path)
    expect(tools.some((tool) => tool.id === "read")).toBe(true)
    expect(tools.some((tool) => tool.id.startsWith("broken_"))).toBe(false)
    expect(PluginStorage.get("broken", "project", tmp.path)).toMatchObject({
      enabled: 0,
      status: "failed",
      last_error: { message: "cold start exploded" },
    })
  }, 30_000)

  test("D1: HTTP plugin tools enter the model list, execute, search, disable, and restore", async () => {
    const protectedBefore = await protectedKernelSnapshot()
    await using tmp = await tmpdir()
    await executablePlugin(tmp.path)
    const toggle = (enabled: boolean) =>
      request("/plugin/sample", tmp.path, {
        method: "PATCH",
        body: JSON.stringify({ enabled }),
      })
    // Initialize the consumer before activation to exercise hot invalidation.
    expect((await runtimeTools(tmp.path)).some((tool) => tool.id === "sample_hello")).toBe(false)
    expect((await modelTools(tmp.path)).some((tool) => tool.id === "sample_hello")).toBe(false)
    const toggled = await toggle(true)
    expect(toggled.status).toBe(200)
    expect(await toggled.json()).toMatchObject({ pluginID: "sample", enabled: true, generation: 1 })
    expect((await modelTools(tmp.path)).some((tool) => tool.id === "sample_hello")).toBe(true)
    const first = (await runtimeTools(tmp.path)).find((tool) => tool.id === "sample_hello")!
    expect(first).toBeDefined()
    expect(first.capabilities).toMatchObject({ readOnly: false, concurrencySafe: false, destructive: true })
    expect(await inInstance(tmp.path, first.execute({}, toolContext(tmp.path)))).toMatchObject({
      output: "sample:false",
    })
    const toolSearch = (await runtimeTools(tmp.path)).find((tool) => tool.id === "tool_search")!
    const searchResult = await inInstance(
      tmp.path,
      toolSearch.execute({ query: "sample_hello" }, toolContext(tmp.path)),
    )
    expect(searchResult.output).toContain("sample_hello")
    expect(searchResult.metadata).toMatchObject({ matches: ["sample_hello"] })
    expect(PluginStorage.get("sample", "project", tmp.path)).toMatchObject({
      enabled: 1,
      status: "active",
      last_error: null,
    })
    expect(projectInstance((await (await request("/plugin", tmp.path)).json()).instances, "sample")).toMatchObject({
      id: "sample",
      status: "installed",
      runtimeStatus: "active",
    })
    const repeats = await Promise.all([toggle(true), toggle(true)])
    expect(repeats.map((response) => response.status)).toEqual([200, 200])
    expect((await runtimeTools(tmp.path)).filter((tool) => tool.id === "sample_hello")).toHaveLength(1)
    expect((await toggle(false)).status).toBe(200)
    expect((await runtimeTools(tmp.path)).some((tool) => tool.id === "sample_hello")).toBe(false)
    expect((await modelTools(tmp.path)).some((tool) => tool.id === "sample_hello")).toBe(false)
    const unavailable = await inInstance(
      tmp.path,
      first.execute({}, toolContext(tmp.path)).pipe(Effect.catchCause((cause) => Effect.succeed(Cause.squash(cause)))),
    )
    expect(unavailable).toMatchObject({ code: "tool_unavailable" })
    expect(PluginStorage.get("sample", "project", tmp.path)).toMatchObject({ enabled: 0, status: "disabled" })
    expect((await toggle(true)).status).toBe(200)
    expect((await modelTools(tmp.path)).some((tool) => tool.id === "sample_hello")).toBe(true)
    const second = (await runtimeTools(tmp.path)).find((tool) => tool.id === "sample_hello")!
    expect(second).toBeDefined()
    expect(second).not.toBe(first)
    expect(await inInstance(tmp.path, second.execute({}, toolContext(tmp.path)))).toMatchObject({
      output: "sample:false",
    })
    expect((await toggle(false)).status).toBe(200)
    await expectProtectedKernelUnchanged(protectedBefore)
  }, 120_000)

  test("D2: plugin Agent, Skill, and Command are visible from their production consumers and disappear on disable", async () => {
    const before = await protectedKernelSnapshot(D2_PROTECTED)
    await using tmp = await tmpdir({ config: { mcp: disabledMcp } })
    await using other = await tmpdir({ config: { mcp: disabledMcp } })
    const root = path.join(tmp.path, ".novaway", "extensions", "author")
    await Bun.write(
      path.join(root, "plugin.json"),
      JSON.stringify({
        name: "author",
        apiVersion: 2,
        kind: "declarative",
        contributes: {
          agents: [{ id: "writer", description: "Fixture writer", mode: "primary", prompt: { file: "writer.md" } }],
          skills: [{ id: "research", description: "Fixture research skill", source: { file: "SKILL.md" } }],
          commands: [
            {
              id: "draft",
              description: "Draft with fixture",
              template: "Draft: $ARGUMENTS",
              argumentHint: "$ARGUMENTS",
            },
          ],
        },
      }),
    )
    await Bun.write(path.join(root, "writer.md"), "Write concise reports from sources.")
    await Bun.write(path.join(root, "SKILL.md"), "Inspect sources and cite evidence.")
    const toggle = (enabled: boolean) =>
      request("/plugin/author", tmp.path, {
        method: "PATCH",
        body: JSON.stringify({ enabled }),
      })
    // Warm all consumers before activation: enable must invalidate visibility
    // without relying on first-use initialization or restarting the instance.
    expect((await runtimeAgents(tmp.path)).some((item) => item.name === "author_writer")).toBe(false)
    expect((await runtimeSkills(tmp.path)).some((item) => item.name === "author_research")).toBe(false)
    expect((await runtimeCommands(tmp.path)).some((item) => item.name === "author_draft")).toBe(false)

    expect((await toggle(true)).status).toBe(200)
    expect(await runtimeAgents(tmp.path)).toContainEqual(
      expect.objectContaining({
        name: "author_writer",
        prompt: "Write concise reports from sources.",
      }),
    )
    expect(await runtimeSkills(tmp.path)).toContainEqual(
      expect.objectContaining({
        name: "author_research",
        content: "Inspect sources and cite evidence.",
      }),
    )
    expect(await runtimeCommands(tmp.path)).toContainEqual(
      expect.objectContaining({
        name: "author_draft",
        template: "Draft: $ARGUMENTS",
        source: "command",
      }),
    )

    expect(
      await inInstance(
        tmp.path,
        Agent.Service.use((service) => service.get("author_writer")),
      ),
    ).toMatchObject({ name: "author_writer", prompt: "Write concise reports from sources." })
    expect(
      await inInstance(
        tmp.path,
        Skill.Service.use((service) => service.available()),
      ),
    ).toContainEqual(expect.objectContaining({ name: "author_research" }))
    expect(await runtimeCommands(tmp.path)).toContainEqual(
      expect.objectContaining({
        name: "author_research",
        source: "skill",
        template: "Inspect sources and cite evidence.",
      }),
    )
    const skillTool = (await runtimeTools(tmp.path)).find((item) => item.id === "skill")!
    const loaded = await inInstance(tmp.path, skillTool.execute({ name: "author_research" }, toolContext(tmp.path)))
    expect(loaded.output).toContain("Inspect sources and cite evidence.")
    expect(loaded.output).toContain(`Base directory for this skill: ${pathToFileURL(root).href}`)

    expect((await toggle(false)).status).toBe(200)
    expect((await runtimeAgents(tmp.path)).some((item) => item.name === "author_writer")).toBe(false)
    expect((await runtimeSkills(tmp.path)).some((item) => item.name === "author_research")).toBe(false)
    expect((await runtimeCommands(tmp.path)).some((item) => item.name === "author_draft")).toBe(false)
    expect((await runtimeCommands(tmp.path)).some((item) => item.name === "author_research")).toBe(false)
    expect(
      await inInstance(
        tmp.path,
        Skill.Service.use((service) => service.get("author_research")),
      ),
    ).toBeUndefined()
    expect(
      await inInstance(
        tmp.path,
        Command.Service.use((service) => service.get("author_draft")),
      ),
    ).toBeUndefined()

    expect((await toggle(true)).status).toBe(200)
    expect((await runtimeAgents(tmp.path)).filter((item) => item.name === "author_writer")).toHaveLength(1)
    expect((await runtimeSkills(tmp.path)).filter((item) => item.name === "author_research")).toHaveLength(1)
    expect((await runtimeCommands(tmp.path)).filter((item) => item.name === "author_draft")).toHaveLength(1)
    expect((await runtimeCommands(tmp.path)).filter((item) => item.name === "author_research")).toHaveLength(1)
    expect(
      await inInstance(
        tmp.path,
        Agent.Service.use((service) => service.reload()),
      ),
    ).toContainEqual(expect.objectContaining({ name: "author_writer" }))
    expect(
      await inInstance(
        tmp.path,
        Skill.Service.use((service) => service.reload()),
      ),
    ).toContainEqual(expect.objectContaining({ name: "author_research" }))
    expect(
      await inInstance(
        tmp.path,
        Command.Service.use((service) => service.reload()),
      ),
    ).toContainEqual(expect.objectContaining({ name: "author_draft" }))
    expect((await runtimeAgents(other.path)).some((item) => item.name === "author_writer")).toBe(false)
    expect((await runtimeSkills(other.path)).some((item) => item.name === "author_research")).toBe(false)
    expect((await runtimeCommands(other.path)).some((item) => item.name.startsWith("author_"))).toBe(false)
    await expectProtectedKernelUnchanged(before)
  }, 60_000)

  test("D2: HTTP command invokes the contributed Agent and streams a model response", async () => {
    const before = await protectedKernelSnapshot(D2_PROTECTED)
    const modelRuntime = ManagedRuntime.make(TestLLMServer.layer)
    try {
      const llm = await modelRuntime.runPromise(TestLLMServer.use((server) => Effect.succeed(server)))
      await using tmp = await tmpdir({
        config: {
          mcp: disabledMcp,
          formatter: false,
          lsp: false,
          provider: {
            test: {
              name: "Test",
              id: "test",
              env: [],
              npm: "@ai-sdk/openai-compatible",
              models: {
                "test-model": {
                  id: "test-model",
                  name: "Test Model",
                  tool_call: true,
                  limit: { context: 100000, output: 10000 },
                },
              },
              options: { apiKey: "fixture-key", baseURL: llm.url },
            },
          },
        },
      })
      const root = path.join(tmp.path, ".novaway", "extensions", "writer")
      await Bun.write(
        path.join(root, "plugin.json"),
        JSON.stringify({
          name: "writer",
          apiVersion: 2,
          kind: "declarative",
          contributes: {
            agents: [
              {
                id: "reporter",
                description: "Fixture reporter",
                mode: "primary",
                prompt: "You are the plugin fixture reporter.",
                model: { providerID: "test", modelID: "test-model" },
              },
            ],
            skills: [{ id: "research", description: "Research fixture", source: { text: "Check fixture sources." } }],
            commands: [
              {
                id: "draft",
                description: "Draft report",
                agent: "writer_reporter",
                template: "Draft report for $ARGUMENTS",
              },
            ],
          },
        }),
      )
      expect(
        (
          await request("/plugin/writer", tmp.path, {
            method: "PATCH",
            body: JSON.stringify({ enabled: true }),
          })
        ).status,
      ).toBe(200)
      const agents = await request("/agent", tmp.path)
      expect(agents.status).toBe(200)
      expect(await agents.json()).toContainEqual(expect.objectContaining({ name: "writer_reporter" }))
      const commands = await request("/command", tmp.path)
      expect(commands.status).toBe(200)
      expect(await commands.json()).toContainEqual(
        expect.objectContaining({ name: "writer_draft", agent: "writer_reporter" }),
      )
      await modelRuntime.runPromise(llm.text("Plugin report delivered."))
      const created = await request("/session", tmp.path, {
        method: "POST",
        body: JSON.stringify({
          title: "Plugin D2 fixture",
          permission: [{ permission: "*", pattern: "*", action: "allow" }],
        }),
      })
      expect(created.status).toBe(200)
      const session = (await created.json()) as { id: string }
      const response = await request(`/session/${session.id}/command`, tmp.path, {
        method: "POST",
        body: JSON.stringify({ command: "writer_draft", arguments: "fixture audience" }),
      })
      expect(response.status).toBe(200)
      const result = await response.json()
      expect(result).toMatchObject({ info: { role: "assistant", agent: "writer_reporter", modelID: "test-model" } })
      expect(JSON.stringify(result)).toContain("Plugin report delivered.")
      const inputs = await modelRuntime.runPromise(llm.inputs)
      const report = inputs.find((input) =>
        JSON.stringify(input.messages).includes("Draft report for fixture audience"),
      )
      expect(report).toBeDefined()
      expect(report?.model).toBe("test-model")
      expect(JSON.stringify(report?.messages)).toContain("You are the plugin fixture reporter.")
      expect(
        (
          await request("/plugin/writer", tmp.path, {
            method: "PATCH",
            body: JSON.stringify({ enabled: false }),
          })
        ).status,
      ).toBe(200)
      expect(await (await request("/command", tmp.path)).json()).not.toContainEqual(
        expect.objectContaining({ name: "writer_draft" }),
      )
      await expectProtectedKernelUnchanged(before)
    } finally {
      await modelRuntime.dispose()
    }
  }, 120_000)

  test.each(["agent", "skill"] as const)(
    "D2: %s source outside the plugin root fails activation without partial contributions",
    async (kind) => {
      await using tmp = await tmpdir({ config: { mcp: disabledMcp } })
      const root = path.join(tmp.path, ".novaway", "extensions", "invalid")
      await Bun.write(path.join(root, "..", "outside.md"), "Outside plugin data.")
      await Bun.write(
        path.join(root, "plugin.json"),
        JSON.stringify({
          name: "invalid",
          apiVersion: 2,
          kind: "declarative",
          contributes: {
            agents: [
              {
                id: "writer",
                description: "Writer",
                mode: "primary",
                prompt: kind === "agent" ? { file: "../outside.md" } : "Valid prompt.",
              },
            ],
            skills: [
              {
                id: "research",
                description: "Research",
                source: kind === "skill" ? { file: "../outside.md" } : { text: "Valid skill." },
              },
            ],
            commands: [{ id: "draft", description: "Draft", template: "Draft: $ARGUMENTS" }],
          },
        }),
      )
      const response = await request("/plugin/invalid", tmp.path, {
        method: "PATCH",
        body: JSON.stringify({ enabled: true }),
      })
      expect(response.status).toBe(409)
      expect((await runtimeAgents(tmp.path)).some((item) => item.name.startsWith("invalid_"))).toBe(false)
      expect((await runtimeSkills(tmp.path)).some((item) => item.name.startsWith("invalid_"))).toBe(false)
      expect((await runtimeCommands(tmp.path)).some((item) => item.name.startsWith("invalid_"))).toBe(false)
      expect((await runtimeHost(tmp.path)).state("invalid", "project")).toMatchObject({ status: "failed" })
      expect(PluginStorage.get("invalid", "project", tmp.path)).toMatchObject({ enabled: 0, status: "failed" })
    },
    60_000,
  )

  test("D7: disabling the shipped builtin bundle keeps sessions usable and restores its contributions", async () => {
    const modelRuntime = ManagedRuntime.make(TestLLMServer.layer)
    try {
      const llm = await modelRuntime.runPromise(TestLLMServer.use((server) => Effect.succeed(server)))
      await using tmp = await tmpdir({
        config: {
          mcp: disabledMcp,
          formatter: false,
          lsp: false,
          provider: {
            test: {
              name: "Test",
              id: "test",
              env: [],
              npm: "@ai-sdk/openai-compatible",
              models: {
                "test-model": {
                  id: "test-model",
                  name: "Test Model",
                  tool_call: true,
                  limit: { context: 100000, output: 10000 },
                },
              },
              options: { apiKey: "fixture-key", baseURL: llm.url },
            },
          },
        },
      })
      const toggle = (enabled: boolean) =>
        request(PluginPaths.toggle.replace(":id", "novaway-ui"), tmp.path, {
          method: "PATCH",
          body: JSON.stringify({ enabled, scope: "builtin" }),
        })
      const created = await request("/session", tmp.path, {
        method: "POST",
        body: JSON.stringify({
          title: "D7 builtin disable session",
          permission: [{ permission: "*", pattern: "*", action: "allow" }],
        }),
      })
      expect(created.status).toBe(200)
      const session = (await created.json()) as { id: string }

      expect((await toggle(false)).status).toBe(200)
      expect(await (await request(PluginPaths.contributions, tmp.path)).json()).not.toContainEqual(
        expect.objectContaining({ pluginID: "novaway-ui" }),
      )

      await modelRuntime.runPromise(llm.text("session works without the builtin bundle"))
      const prompted = await request(`/session/${session.id}/message`, tmp.path, {
        method: "POST",
        body: JSON.stringify({
          model: { providerID: "test", modelID: "test-model" },
          parts: [{ type: "text", text: "D7 session after builtin disable" }],
        }),
      })
      expect(prompted.status).toBe(200)
      expect(await prompted.text()).toContain("session works without the builtin bundle")

      expect((await toggle(true)).status).toBe(200)
      expect(await (await request(PluginPaths.contributions, tmp.path)).json()).toContainEqual(
        expect.objectContaining({ pluginID: "novaway-ui", kind: "surface", title: "NovaWay Home" }),
      )
    } finally {
      await modelRuntime.dispose()
    }
  }, 120_000)

  test("D9: disabling during an in-flight tool cancels that turn, updates SSE, and re-enable creates a fresh snapshot", async () => {
    await using tmp = await tmpdir()
    const implementation = `export default (api) => ({ execute: async (_, ctx) => await new Promise(resolve => ctx.abort.addEventListener("abort", () => resolve("cancelled"), { once: true })) })`
    await executablePlugin(tmp.path, "hot", implementation)
    const events = await request(PluginPaths.events, tmp.path)
    if (!events.body) throw new Error("missing plugin event stream")
    const reader = events.body.getReader()
    try {
      expect(
        (
          await request("/plugin/hot", tmp.path, {
            method: "PATCH",
            body: JSON.stringify({ enabled: true }),
          })
        ).status,
      ).toBe(200)
      expect(await readEvent(reader)).toMatchObject({
        type: "plugin.changed",
        properties: { pluginID: "hot", enabled: true, generation: 1 },
      })
      const first = (await runtimeTools(tmp.path)).find((tool) => tool.id === "hot_hello")!
      const inFlight = inInstance(tmp.path, first.execute({}, toolContext(tmp.path)))
      await Promise.resolve()
      const disabled = await request("/plugin/hot", tmp.path, {
        method: "PATCH",
        body: JSON.stringify({ enabled: false }),
      })
      expect(disabled.status).toBe(200)
      expect(await inFlight).toMatchObject({ output: "cancelled" })
      expect(await readEvent(reader)).toMatchObject({
        type: "plugin.changed",
        properties: { pluginID: "hot", enabled: false, generation: 2 },
      })
      await expect(inInstance(tmp.path, first.execute({}, toolContext(tmp.path)))).rejects.toMatchObject({
        code: "tool_unavailable",
      })
      expect(
        (
          await request("/plugin/hot", tmp.path, {
            method: "PATCH",
            body: JSON.stringify({ enabled: true }),
          })
        ).status,
      ).toBe(200)
      const second = (await runtimeTools(tmp.path)).find((tool) => tool.id === "hot_hello")!
      expect(second).not.toBe(first)
      expect(
        (
          await request("/plugin/hot", tmp.path, {
            method: "PATCH",
            body: JSON.stringify({ enabled: false }),
          })
        ).status,
      ).toBe(200)
    } finally {
      await reader.cancel()
    }
  }, 30_000)

  test("D9: the next model turn observes plugin tool changes without restarting the process", async () => {
    const modelRuntime = ManagedRuntime.make(TestLLMServer.layer)
    try {
      const llm = await modelRuntime.runPromise(TestLLMServer.use((server) => Effect.succeed(server)))
      await using tmp = await tmpdir({
        config: {
          mcp: disabledMcp,
          formatter: false,
          lsp: false,
          provider: {
            test: {
              name: "Test",
              id: "test",
              env: [],
              npm: "@ai-sdk/openai-compatible",
              models: {
                "test-model": {
                  id: "test-model",
                  name: "Test Model",
                  tool_call: true,
                  limit: { context: 100000, output: 10000 },
                },
              },
              options: { apiKey: "fixture-key", baseURL: llm.url },
            },
          },
        },
      })
      await executablePlugin(
        tmp.path,
        "hot",
        `export default () => ({ execute: async () => "plugin-pong" })`,
        { readOnly: true, concurrencySafe: true, destructive: false, idempotent: true },
      )
      const toggle = (enabled: boolean) =>
        request("/plugin/hot", tmp.path, {
          method: "PATCH",
          body: JSON.stringify({ enabled }),
        })
      expect((await toggle(true)).status).toBe(200)

      const created = await request("/session", tmp.path, {
        method: "POST",
        body: JSON.stringify({
          title: "D9 turn snapshot",
          permission: [{ permission: "*", pattern: "*", action: "allow" }],
        }),
      })
      expect(created.status).toBe(200)
      const session = (await created.json()) as { id: string }
      const prompt = (text: string) =>
        request(`/session/${session.id}/message`, tmp.path, {
          method: "POST",
          body: JSON.stringify({
            model: { providerID: "test", modelID: "test-model" },
            parts: [{ type: "text", text }],
          }),
        })
      const requestBodies = async () => modelRuntime.runPromise(llm.inputs)

      // A real model turn executes the plugin tool through the production loop.
      await modelRuntime.runPromise(llm.tool("hot_hello", {}))
      await modelRuntime.runPromise(llm.text("first turn complete"))
      const first = await prompt("D9 turn one uses the hot tool")
      expect(first.status).toBe(200)
      expect(await first.text()).toContain("first turn complete")
      const firstBodies = await requestBodies()
      const firstRequest = firstBodies.find((body) =>
        JSON.stringify(body.messages).includes("D9 turn one uses the hot tool"),
      )
      expect(firstRequest).toBeDefined()
      expect(JSON.stringify(firstRequest?.tools ?? [])).toContain("hot_hello")
      expect(firstBodies.some((body) => JSON.stringify(body.messages).includes("plugin-pong"))).toBe(true)

      // The next turn after disable must receive a fresh tool list.
      expect((await toggle(false)).status).toBe(200)
      await modelRuntime.runPromise(llm.text("second turn complete"))
      const second = await prompt("D9 turn two after disable")
      expect(second.status).toBe(200)
      expect(await second.text()).toContain("second turn complete")
      const secondRequest = (await requestBodies()).find((body) =>
        JSON.stringify(body.messages).includes("D9 turn two after disable"),
      )
      expect(secondRequest).toBeDefined()
      expect(JSON.stringify(secondRequest?.tools ?? [])).not.toContain("hot_hello")

      // Re-enable restores the contribution for a later turn without restarting.
      expect((await toggle(true)).status).toBe(200)
      await modelRuntime.runPromise(llm.text("third turn complete"))
      const third = await prompt("D9 turn three after re-enable")
      expect(third.status).toBe(200)
      expect(await third.text()).toContain("third turn complete")
      const thirdRequest = (await requestBodies()).find((body) =>
        JSON.stringify(body.messages).includes("D9 turn three after re-enable"),
      )
      expect(thirdRequest).toBeDefined()
      expect(JSON.stringify(thirdRequest?.tools ?? [])).toContain("hot_hello")
      expect((await toggle(false)).status).toBe(200)
    } finally {
      await modelRuntime.dispose()
    }
  }, 120_000)

  test("entry activation failures return 409, publish diagnostics, and leave no executable contribution", async () => {
    await using tmp = await tmpdir()
    await executablePlugin(tmp.path, "broken", `export default () => { throw new Error("entry exploded") }`)
    const response = await request("/plugin/broken", tmp.path, {
      method: "PATCH",
      body: JSON.stringify({ enabled: true }),
    })
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({
      pluginID: "broken",
      code: "activation_failed",
      message: "entry exploded",
    })
    expect(PluginStorage.get("broken", "project", tmp.path)).toMatchObject({
      enabled: 0,
      status: "failed",
      last_error: { code: "activation_failed", message: "entry exploded" },
    })
    expect((await runtimeTools(tmp.path)).some((tool) => tool.id === "broken_hello")).toBe(false)
    expect(await (await request("/plugin/diagnostics", tmp.path)).json()).toContainEqual(
      expect.objectContaining({ pluginID: "broken", code: "activation_failed", severity: "error" }),
    )
  }, 30_000)

  test("missing tool entries and unsupported contributions cannot produce a false active state", async () => {
    await using tmp = await tmpdir()
    for (const [name, contributes, code] of [
      [
        "missing",
        { tools: [{ id: "hello", description: "Missing entry", parameters: { type: "object" } }] },
        "contribution_invalid",
      ],
      ["unsupported", { providers: ["writer"] }, "activation_failed"],
    ] as const) {
      await Bun.write(
        path.join(tmp.path, ".novaway", "extensions", name, "plugin.json"),
        JSON.stringify({
          name,
          apiVersion: 2,
          kind: "declarative",
          contributes,
        }),
      )
      const response = await request(`/plugin/${name}`, tmp.path, {
        method: "PATCH",
        body: JSON.stringify({ enabled: true }),
      })
      expect(response.status).toBe(409)
      expect(await response.json()).toMatchObject({ pluginID: name, code })
      expect(PluginStorage.get(name, "project", tmp.path)).toMatchObject({
        enabled: 0,
        status: "failed",
        last_error: { code },
      })
    }
  })

  test("enable persistence failure removes the runtime contribution; disable persistence failure restores it", async () => {
    await using tmp = await tmpdir()
    await executablePlugin(tmp.path)
    const toggle = (enabled: boolean) =>
      request("/plugin/sample", tmp.path, { method: "PATCH", body: JSON.stringify({ enabled }) })
    const save = spyOn(PluginStorage, "save")
    try {
      save.mockImplementationOnce(() => {
        throw new Error("disk unavailable")
      })
      const failed = await toggle(true)
      expect(failed.status).toBe(409)
      expect(await failed.json()).toMatchObject({ code: "storage_conflict" })
      expect((await runtimeTools(tmp.path)).some((tool) => tool.id === "sample_hello")).toBe(false)
      expect(PluginStorage.get("sample", "project", tmp.path)).toBeUndefined()
      expect((await toggle(true)).status).toBe(200)
      const first = (await runtimeTools(tmp.path)).find((tool) => tool.id === "sample_hello")!
      save.mockImplementationOnce(() => {
        throw new Error("disk unavailable")
      })
      const failedDisable = await toggle(false)
      expect(failedDisable.status).toBe(409)
      expect(await failedDisable.json()).toMatchObject({ code: "storage_conflict" })
      expect(PluginStorage.get("sample", "project", tmp.path)).toMatchObject({ enabled: 1, status: "active" })
      const restored = (await runtimeTools(tmp.path)).filter((tool) => tool.id === "sample_hello")
      expect(restored).toHaveLength(1)
      expect(restored[0]).not.toBe(first)
      expect(await inInstance(tmp.path, restored[0]!.execute({}, toolContext(tmp.path)))).toMatchObject({
        output: "sample:false",
      })
      expect((await toggle(false)).status).toBe(200)
    } finally {
      save.mockRestore()
    }
  }, 30_000)

  test("cleanup failure is an HTTP conflict with failed diagnostics, never successful disable", async () => {
    await using tmp = await tmpdir()
    await executablePlugin(tmp.path)
    const host = await runtimeHost(tmp.path)
    await host.load({
      id: "sample",
      scope: "project",
      manifest: { name: "sample", apiVersion: 2, contributes: {} },
      root: tmp.path,
      async activate({ resources }) {
        resources.push({
          dispose() {
            throw new Error("cleanup exploded")
          },
        })
      },
    })
    const response = await request("/plugin/sample", tmp.path, {
      method: "PATCH",
      body: JSON.stringify({ enabled: false }),
    })
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: "cleanup_failed", message: "cleanup exploded" })
    expect(PluginStorage.get("sample", "project", tmp.path)).toMatchObject({
      enabled: 0,
      status: "failed",
      last_error: { code: "cleanup_failed" },
    })
    const listed = await request("/plugin", tmp.path)
    expect(projectInstance((await listed.json()).instances, "sample")).toMatchObject({ runtimeStatus: "failed" })
    expect(await (await request("/plugin/diagnostics", tmp.path)).json()).toContainEqual(
      expect.objectContaining({ pluginID: "sample", code: "cleanup_failed", severity: "error" }),
    )
  })

  test("explicit enable revalidates a disabled plugin but cannot bypass safe mode", async () => {
    await using tmp = await tmpdir({ config: { plugins: { disabled: ["sample"] } } })
    await executablePlugin(tmp.path)
    expect(projectInstance((await (await request("/plugin", tmp.path)).json()).instances, "sample")).toMatchObject({
      status: "disabled",
    })
    const previous = process.env.NOVAWAY_SAFE_MODE
    try {
      process.env.NOVAWAY_SAFE_MODE = "1"
      const blocked = await request("/plugin/sample", tmp.path, {
        method: "PATCH",
        body: JSON.stringify({ enabled: true }),
      })
      expect(blocked.status).toBe(409)
      expect(PluginStorage.get("sample", "project", tmp.path)).toBeUndefined()
    } finally {
      if (previous === undefined) delete process.env.NOVAWAY_SAFE_MODE
      else process.env.NOVAWAY_SAFE_MODE = previous
    }
    const enabled = await request("/plugin/sample", tmp.path, {
      method: "PATCH",
      body: JSON.stringify({ enabled: true }),
    })
    expect(enabled.status).toBe(200)
    expect(projectInstance((await (await request("/plugin", tmp.path)).json()).instances, "sample")).toMatchObject({
      status: "installed",
      runtimeStatus: "active",
    })
    expect(
      (await request("/plugin/sample", tmp.path, { method: "PATCH", body: JSON.stringify({ enabled: false }) })).status,
    ).toBe(200)
  }, 30_000)

  test("onView activation loads an installed plugin without persisting enabled state", async () => {
    await using tmp = await tmpdir()
    const root = path.join(tmp.path, ".novaway", "extensions", "on-view")
    await Bun.write(
      path.join(root, "plugin.json"),
      JSON.stringify({
        name: "on-view",
        apiVersion: 2,
        kind: "declarative",
        activationEvents: ["onView:on-view.dashboard"],
        contributes: {
          surfaces: [
            {
              id: "dashboard",
              slot: "sidebar.item",
              title: "On view",
              action: {
                type: "view",
                viewId: "on-view.dashboard",
                render: { type: "iframe", url: "https://example.test/on-view.html" },
              },
            },
          ],
        },
      }),
    )

    const before = await request(PluginPaths.list, tmp.path)
    expect(before.status).toBe(200)
    expect(projectInstance((await before.json()).instances, "on-view")).toMatchObject({
      status: "installed",
    })
    expect(PluginStorage.get("on-view", "project", tmp.path)).toBeUndefined()

    const contributions = await request(PluginPaths.contributions, tmp.path)
    expect(contributions.status).toBe(200)
    expect(await contributions.json()).toContainEqual(
      expect.objectContaining({ pluginID: "on-view", localName: "dashboard", status: "active" }),
    )

    const after = await request(PluginPaths.list, tmp.path)
    expect(projectInstance((await after.json()).instances, "on-view")).toMatchObject({
      status: "installed",
      runtimeStatus: "active",
    })
    expect(PluginStorage.get("on-view", "project", tmp.path)).toBeUndefined()
  }, 30_000)

  test("session plugin lifecycle remains in the Host and never writes plugin_state", async () => {
    await using tmp = await tmpdir()
    const instance = {
      id: "ephemeral",
      status: "installed" as const,
      scope: "session" as const,
      origin: "extension" as const,
      adapter: "v2" as const,
      manifest: { name: "ephemeral", apiVersion: 2, kind: "declarative" as const, contributes: {} },
      location: { kind: "directory" as const, root: tmp.path, label: "project" as const },
      issues: [],
      diagnostics: [],
      contributions: 0,
    }
    await inInstance(
      tmp.path,
      PluginRuntimeService.Service.use((service) => service.setEnabled(instance, true)),
    )
    expect((await runtimeHost(tmp.path)).state("ephemeral", "session")?.status).toBe("active")
    expect(PluginStorage.get("ephemeral", "session")).toBeUndefined()
    await inInstance(
      tmp.path,
      PluginRuntimeService.Service.use((service) => service.setEnabled(instance, false)),
    )
    expect((await runtimeHost(tmp.path)).state("ephemeral", "session")?.status).toBe("disabled")
    expect(PluginStorage.get("ephemeral", "session")).toBeUndefined()
  })

  test("a project toggle cannot disable the same plugin in another directory instance", async () => {
    await using left = await tmpdir()
    await using right = await tmpdir()
    for (const directory of [left.path, right.path]) {
      await Bun.write(
        path.join(directory, ".novaway", "extensions", "isolated", "plugin.json"),
        JSON.stringify({ name: "isolated", apiVersion: 2, kind: "declarative", contributes: {} }),
      )
    }

    const toggled = await request(PluginPaths.toggle.replace(":id", "isolated"), left.path, {
      method: "PATCH",
      body: JSON.stringify({ enabled: false }),
    })
    expect(toggled.status).toBe(200)
    const disabled = await request(PluginPaths.list, left.path)
    const unaffected = await request(PluginPaths.list, right.path)
    expect(projectInstance((await disabled.json()).instances, "isolated")).toMatchObject({ status: "disabled" })
    expect(projectInstance((await unaffected.json()).instances, "isolated")).toMatchObject({ status: "installed" })
    expect(PluginStorage.get("isolated", "project", left.path)?.enabled).toBe(0)
    expect(PluginStorage.get("isolated", "project", right.path)).toBeUndefined()
  })

  test("legacy project state without a directory is preserved and diagnosed, not applied to every project", async () => {
    await using tmp = await tmpdir()
    const root = path.join(tmp.path, ".novaway", "extensions", "unassigned")
    await Bun.write(
      path.join(root, "plugin.json"),
      JSON.stringify({ name: "unassigned", apiVersion: 2, kind: "declarative", contributes: {} }),
    )
    PluginStorage.save({ pluginID: "unassigned", scope: "project", source: root, enabled: false })

    const listed = await request(PluginPaths.list, tmp.path)
    expect(projectInstance((await listed.json()).instances, "unassigned")).toMatchObject({ status: "installed" })
    const diagnostics = await request(PluginPaths.diagnostics, tmp.path)
    expect(await diagnostics.json()).toContainEqual(
      expect.objectContaining({ pluginID: "unassigned", severity: "warning", code: "state_instance_unassigned" }),
    )
    expect(PluginStorage.get("unassigned", "project")?.enabled).toBe(0)
  })

  test("persisted disable state only disables the matching scope instance", async () => {
    await using tmp = await tmpdir()
    await using global = await tmpdir()
    const previous = Global.Path.config
    ;(Global.Path as { config: string }).config = global.path
    try {
      const globalRoot = path.join(Global.Path.config, "extensions", "shared")
      await Bun.write(
        path.join(tmp.path, ".novaway", "extensions", "shared", "plugin.json"),
        JSON.stringify({ name: "shared", apiVersion: 2, kind: "declarative", contributes: {} }),
      )
      await Bun.write(
        path.join(globalRoot, "plugin.json"),
        JSON.stringify({ name: "shared", apiVersion: 2, kind: "declarative", contributes: {} }),
      )
      PluginStorage.save({ pluginID: "shared", scope: "global", source: globalRoot, enabled: false })
      const ambiguous = await request("/plugin/shared", tmp.path, {
        method: "PATCH",
        body: JSON.stringify({ enabled: false }),
      })
      expect(ambiguous.status).toBe(409)
      expect(await ambiguous.json()).toMatchObject({ code: "contribution_invalid" })
      expect(PluginStorage.get("shared", "project", tmp.path)).toBeUndefined()

      const listed = await request(PluginPaths.list, tmp.path)
      expect(listed.status).toBe(200)
      const instances = (await listed.json()).instances
      expect(instances).toContainEqual(expect.objectContaining({ id: "shared", scope: "global", status: "disabled" }))
      expect(instances).toContainEqual(expect.objectContaining({ id: "shared", scope: "project", status: "installed" }))
      const selected = await request("/plugin/shared", tmp.path, {
        method: "PATCH",
        body: JSON.stringify({ enabled: true, scope: "project" }),
      })
      expect(selected.status).toBe(200)
      expect(PluginStorage.get("shared", "project", tmp.path)).toMatchObject({ enabled: 1, status: "active" })
      expect(PluginStorage.get("shared", "global")).toMatchObject({ enabled: 0 })
    } finally {
      ;(Global.Path as { config: string }).config = previous
    }
  })

  test("disabling a plugin publishes plugin.changed with an increasing generation", async () => {
    await using tmp = await tmpdir()
    await Bun.write(
      path.join(tmp.path, ".novaway", "extensions", "sample", "plugin.json"),
      JSON.stringify({
        name: "sample",
        apiVersion: 2,
        kind: "declarative",
        contributes: {
          tools: [{ id: "hello", description: "A static tool declaration", parameters: { type: "object" } }],
        },
      }),
    )

    const initial = await request(PluginPaths.list, tmp.path)
    expect(initial.status).toBe(200)
    expect(projectInstance((await initial.json()).instances, "sample")).toBeDefined()

    const stream = await request(PluginPaths.events, tmp.path)
    expect(stream.status).toBe(200)
    expect(stream.headers.get("content-type")).toContain("text/event-stream")
    if (!stream.body) throw new Error("missing plugin event stream")
    const reader = stream.body.getReader()

    try {
      const toggled = await request(PluginPaths.toggle.replace(":id", "sample"), tmp.path, {
        method: "PATCH",
        body: JSON.stringify({ enabled: false }),
      })
      expect(toggled.status).toBe(200)
      expect(await toggled.json()).toMatchObject({ pluginID: "sample", enabled: false, generation: 1 })

      expect(await readEvent(reader)).toMatchObject({
        type: "plugin.changed",
        properties: { pluginID: "sample", enabled: false, generation: 1 },
      })

      const disabled = await request(PluginPaths.list, tmp.path)
      expect(disabled.status).toBe(200)
      expect(projectInstance((await disabled.json()).instances, "sample")).toMatchObject({ status: "disabled" })
    } finally {
      await reader.cancel()
    }
  })
})
