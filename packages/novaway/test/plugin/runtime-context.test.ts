import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import type {
  Chunk,
  JobInfo,
  KernelApi,
  Logger,
  Manifest,
  MessageDto,
  PluginCapabilities,
  PluginContext,
  ProviderAdapter,
  Registry,
  SecretStore,
  SessionHandle,
  SurfaceContribution,
  Thread,
  ToolContribution,
} from "@novaway/plugin-api"
import { isPluginError } from "@novaway/plugin-api"
import {
  createAgentRegistry,
  createCommandRegistry,
  createOfficeRegistry,
  createProviderRegistry,
  createPublishRegistry,
  createSkillRegistry,
  createSurfaceRegistry,
  createToolRegistry,
} from "@/plugin/contributions"
import { hostAllowed } from "@/plugin/runtime/capabilities"
import {
  createKernelApi,
  createPluginContext,
  type Input,
  type KernelDeps,
  type KernelInput,
} from "@/plugin/runtime/context"
import { createInterceptorRuntime } from "@/plugin/runtime/hooks"
import { createHost } from "@/plugin/runtime/host"
import {
  createActivation,
  createBuiltinActivation,
  createDiscoveredPlugin,
  createToolEntryActivation,
  loadProviderEntries,
  loadToolEntries,
} from "@/plugin/runtime/activation"
import { PluginStorage } from "@/plugin/storage"

/**
 * §14.3 第 8 步的验收：**同一个 fixture 在两种 ctx 下，受限 API 抛 `capability_denied`**。
 *
 * 两条边界分开测，因为它们的判据不同：
 * - scope 决定字段集（§5.3）：第三方碰第一方字段就抛，与 manifest 声明了什么无关；
 * - manifest 决定能力（§5.4）：fs / network / secrets / tools 未声明即拒绝，**第一方也照拒**（L0）。
 *
 * 宿主能力全是假的（会话、LLM、工具执行、fetch、secret store）：M0 不接内核调用点，
 * 这一步要证明的是「构造器把边界守住了」，不是「插件真能驱动会话」。
 */

let base = ""
let workspace = ""
let data = ""

/** ctx.storage 走的是进程级内存库（preload 的 `NOVAWAY_DB=:memory:`），用完要清。 */
const used = new Set<string>()

beforeEach(async () => {
  base = await fs.mkdtemp(path.join(os.tmpdir(), "novaway-ctx-"))
  workspace = path.join(base, "project")
  data = path.join(base, "plugin-data")
  await fs.mkdir(workspace, { recursive: true })
  await fs.mkdir(data, { recursive: true })
})

afterEach(async () => {
  for (const pluginID of used) PluginStorage.uninstall(pluginID, true)
  used.clear()
  await fs.rm(base, { recursive: true, force: true })
})

const session: SessionHandle = {
  id: "ses_1",
  slug: "one",
  projectID: "prj_1",
  directory: "/w",
  title: "t",
  version: "0.0.0",
  time: { created: 0, updated: 0 },
}

const message: MessageDto = {
  info: {
    id: "msg_1",
    sessionID: "ses_1",
    role: "assistant",
    time: { created: 0 },
    parentID: "msg_0",
    modelID: "m",
    providerID: "p",
    mode: "build",
    agent: "build",
    path: { cwd: "/w", root: "/w" },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  },
  parts: [],
}

const job: JobInfo = { id: "job_1", type: "sync", status: "running", started_at: 0 }

function fakeKernel() {
  const calls: string[] = []
  const deps: KernelDeps = {
    sessions: {
      create: async () => {
        calls.push("sessions.create")
        return session
      },
      prompt: async () => {
        calls.push("sessions.prompt")
        return message
      },
      messages: async () => {
        calls.push("sessions.messages")
        return [message]
      },
      abort: async () => {
        calls.push("sessions.abort")
      },
    },
    toolRuntime: {
      execute: async (input) => {
        calls.push(`execute:${input.tool}`)
        return "done"
      },
      list: async () => {
        calls.push("toolRuntime.list")
        return [{ id: "read", description: "read a file", parameters: { type: "object" } }]
      },
    },
    llm: {
      stream: async function* () {
        calls.push("llm.stream")
        yield { type: "text-delta", id: "b1", text: "hi" } satisfies Chunk
      },
      complete: async () => {
        calls.push("llm.complete")
        return "hi"
      },
    },
    background: {
      start: async () => {
        calls.push("background.start")
        return job
      },
      cancel: async () => {
        calls.push("background.cancel")
      },
      list: async () => [job],
    },
    scheduler: {
      every: () => {
        calls.push("scheduler.every")
        return { dispose() {} }
      },
      cron: () => {
        calls.push("scheduler.cron")
        return { dispose() {} }
      },
    },
    events: {
      on: () => {
        calls.push("events.on")
        return { dispose() {} }
      },
      emit: () => {
        calls.push("events.emit")
      },
    },
    permissions: {
      ask: async () => {
        calls.push("permissions.ask")
      },
    },
  }
  return { deps, calls }
}

/** 六个后续里程碑才落地的注册表，测试里用一份纯内存实现顶替（宿主已绑好来源的形状）。 */
function memoryRegistry<T extends { id: string }>(): Registry<T> {
  const items = new Map<string, T>()
  return {
    register(item) {
      items.set(item.id, item)
      return { dispose: () => void items.delete(item.id) }
    },
    resolve(id) {
      return items.get(id)
    },
    list() {
      return [...items.values()]
    },
    onDidChange() {
      return { dispose() {} }
    },
  }
}

function registries(extra?: Partial<Input["registries"]>): Input["registries"] {
  return {
    tools: createToolRegistry(),
    agents: createAgentRegistry(),
    skills: createSkillRegistry(),
    commands: createCommandRegistry(),
    interceptors: createInterceptorRuntime(),
    ...extra,
  }
}

function manifest(pluginID: string, capabilities?: PluginCapabilities, extra?: Partial<Manifest>): Manifest {
  return {
    name: pluginID,
    apiVersion: 2,
    contributes: {},
    ...(capabilities === undefined ? {} : { capabilities }),
    ...extra,
  }
}

describe("tool entry loading", () => {
  test("loads each declared factory with PluginContext and applies conservative safety defaults", async () => {
    const h = harness()
    const { ctx } = third()
    const entry = path.join(base, "weather.mjs")
    await fs.writeFile(
      entry,
      "export default (api) => ({ execute: async ({ city }) => ({ output: `${api.id}:${city}` }) })",
    )
    const tools = await loadToolEntries({
      root: base,
      context: ctx,
      declarations: [
        {
          id: "weather",
          entry: "./weather.mjs",
          description: "weather lookup",
          parameters: { type: "object", properties: { city: { type: "string" } } },
          safety: { readOnly: true },
        },
      ],
    })

    expect(tools).toHaveLength(1)
    expect(tools[0]).toMatchObject({
      id: "weather",
      description: "weather lookup",
      safety: {
        readOnly: true,
        concurrencySafe: false,
        destructive: true,
        idempotent: false,
        maxResultBytes: 20_000,
        deferLoading: false,
      },
    })
    await expect(tools[0]!.execute({ city: "Oslo" }, {} as never)).resolves.toEqual({ output: "acme:Oslo" })
  })

  test("rejects entry paths escaping the plugin root", async () => {
    const { ctx } = third()
    await expect(
      loadToolEntries({
        root: base,
        context: ctx,
        declarations: [
          { id: "escape", entry: "../outside.mjs", description: "escape", parameters: { type: "object" } },
        ],
      }),
    ).rejects.toThrow("outside")
  })

  test("loads provider adapters from entries and rejects paths outside the plugin root", async () => {
    await fs.writeFile(
      path.join(base, "provider.mjs"),
      `export default { id: "acme", name: "Acme", sdk: "@ai-sdk/openai-compatible", models: { chat: { name: "Chat" } } }`,
    )
    await expect(loadProviderEntries({ root: base, entries: ["provider.mjs"], pluginID: "acme" })).resolves.toMatchObject([
      { id: "acme", name: "Acme" },
    ])
    await fs.writeFile(path.join(path.dirname(base), "outside-provider.mjs"), "export default { id: 'outside', name: 'Outside' }")
    await expect(loadProviderEntries({ root: base, entries: ["../outside-provider.mjs"], pluginID: "acme" })).rejects.toThrow("路径越界")
  })

  test("rejects entry symlinks escaping the plugin root", async () => {
    const { ctx } = third()
    const outside = path.join(os.tmpdir(), `plugin-entry-${crypto.randomUUID()}.mjs`)
    const link = path.join(base, "outside.mjs")
    await fs.writeFile(outside, "export default () => ({ execute: async () => ({ output: 'escaped' }) })")
    try {
      await fs.symlink(outside, link)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EPERM") return
      throw error
    }
    await expect(
      loadToolEntries({
        root: base,
        context: ctx,
        declarations: [
          { id: "symlink", entry: "./outside.mjs", description: "escape", parameters: { type: "object" } },
        ],
      }),
    ).rejects.toThrow("路径越界")
  })
})

describe("activation resource ownership", () => {
  test("built-in provider entries register through the production Host and release on disable", async () => {
    const h = harness()
    h.input.registries.providers = createProviderRegistry()
    await fs.writeFile(
      path.join(base, "provider.mjs"),
      `export default { id: "acme", name: "Acme", models: { chat: { name: "Chat" } } }`,
    )
    const plugin = createDiscoveredPlugin({
      instance: {
        id: "builtin.providers", status: "installed", scope: "builtin", origin: "extension", adapter: "v2",
        manifest: manifest("builtin.providers", undefined, {
          kind: "declarative",
          contributes: { providers: ["provider.mjs"] },
        }),
        location: { kind: "directory", root: base, label: "builtin" },
        issues: [], diagnostics: [], contributions: 1,
      },
      runtime: h.input,
    })
    const host = createHost(h.input.registries as never)
    await host.activate(plugin)
    expect(h.input.registries.providers?.list()).toMatchObject([{ id: "acme", name: "Acme" }])
    host.deactivate("builtin.providers", "builtin")
    expect(h.input.registries.providers?.list()).toEqual([])
    host.dispose()
  })

  test("built-in office engine entries register format detection and release on disable", async () => {
    const h = harness()
    h.input.registries.office = createOfficeRegistry()
    await fs.writeFile(path.join(base, "office.mjs"), "export default { open: async () => ({ ok: true }) }")
    const plugin = createDiscoveredPlugin({
      instance: {
        id: "builtin.office", status: "installed", scope: "builtin", origin: "extension", adapter: "v2",
        manifest: manifest("builtin.office", undefined, {
          kind: "declarative",
          contributes: { officeEngines: [{ format: "foo", kind: "document", extensions: ["foo"], entry: "office.mjs" }] },
        }),
        location: { kind: "directory", root: base, label: "builtin" },
        issues: [], diagnostics: [], contributions: 1,
      },
      runtime: h.input,
    })
    const host = createHost(h.input.registries as never)
    await host.activate(plugin)
    expect(h.input.registries.office?.resolve("foo")).toMatchObject({ format: "foo" })
    host.deactivate("builtin.office", "builtin")
    expect(h.input.registries.office?.list()).toEqual([])
    host.dispose()
  })
  test("built-in publish driver entries register and release with Host lifecycle", async () => {
    const h = harness()
    h.input.registries.publish = createPublishRegistry()
    await fs.writeFile(path.join(base, "publish.mjs"), `export default { id: "acme", name: "Acme", supports: ["article"], urls: { article: "https://acme.test" } }`)
    const plugin = createDiscoveredPlugin({
      instance: {
        id: "builtin.publish", status: "installed", scope: "builtin", origin: "extension", adapter: "v2",
        manifest: manifest("builtin.publish", undefined, {
          kind: "declarative",
          contributes: { publishDrivers: ["publish.mjs"] },
        }),
        location: { kind: "directory", root: base, label: "builtin" },
        issues: [], diagnostics: [], contributions: 1,
      },
      runtime: h.input,
    })
    const host = createHost(h.input.registries as never)
    await host.activate(plugin)
    expect(h.input.registries.publish?.resolve("acme")).toMatchObject({ id: "acme", name: "Acme" })
    host.deactivate("builtin.publish", "builtin")
    expect(h.input.registries.publish?.list()).toEqual([])
    host.dispose()
  })

  test("built-in surface entries register and release with Host lifecycle", async () => {
    const h = harness()
    h.input.registries.surfaces = createSurfaceRegistry()
    const plugin = createDiscoveredPlugin({
      instance: {
        id: "builtin.ui", status: "installed", scope: "builtin", origin: "extension", adapter: "v2",
        manifest: manifest("builtin.ui", undefined, {
          kind: "declarative",
          contributes: { surfaces: [{ slot: "sidebar.item", id: "foo", title: "Foo", icon: "sparkles", action: { type: "view", viewId: "foo" } }] },
        }),
        location: { kind: "directory", root: base, label: "builtin" },
        issues: [], diagnostics: [], contributions: 1,
      },
      runtime: h.input,
    })
    const host = createHost(h.input.registries as never)
    await host.activate(plugin)
    expect(h.input.registries.surfaces?.resolve("foo")).toMatchObject({ id: "foo", slot: "sidebar.item" })
    host.deactivate("builtin.ui", "builtin")
    expect(h.input.registries.surfaces?.list()).toEqual([])
    host.dispose()
  })

  test("D7: disabling a built-in contribution bundle removes its surfaces and drivers without affecting another plugin", async () => {
    const h = harness()
    h.input.registries.publish = createPublishRegistry()
    h.input.registries.surfaces = createSurfaceRegistry()
    await fs.writeFile(path.join(base, "publish-d7.mjs"), `export default { id: "builtin-publish", name: "Builtin Publish", supports: ["article"], urls: { article: "https://builtin.test" } }`)
    const builtin = createDiscoveredPlugin({
      instance: {
        id: "builtin.bundle", status: "installed", scope: "builtin", origin: "extension", adapter: "v2",
        manifest: manifest("builtin.bundle", undefined, {
          kind: "declarative",
          contributes: {
            publishDrivers: ["publish-d7.mjs"],
            surfaces: [{ slot: "sidebar.item", id: "builtin-home", title: "Builtin", icon: "home", action: { type: "view", viewId: "builtin" } }],
          },
        }),
        location: { kind: "directory", root: base, label: "builtin" },
        issues: [], diagnostics: [], contributions: 2,
      },
      runtime: h.input,
    })
    const host = createHost(h.input.registries as never)
    await host.activate(builtin)
    const other = {
      id: "other", scope: "project" as const, root: base, manifest: manifest("other"),
      async activate({ registries }: { registries: typeof h.input.registries }) {
        registries.tools.register({ pluginID: "other", scope: "project" }, { id: "other", description: "other", parameters: { type: "object" }, execute: async () => "ok" })
      },
    }
    await host.activate(other)
    host.deactivate("builtin.bundle", "builtin")
    expect(h.input.registries.publish?.list()).toEqual([])
    expect(h.input.registries.surfaces?.list()).toEqual([])
    expect(h.input.registries.tools.list().map((entry) => entry.name)).toEqual(["other_other"])
    host.dispose()
  })

  test("discovered v2 tools can be adapted to the runtime host", async () => {
    const h = harness()
    const entry = path.join(base, "weather.mjs")
    await fs.writeFile(entry, "export default (api) => ({ execute: async () => `${api.id}:${api.signal.aborted}` })")
    const pluginManifest = manifest("acme", undefined, {
      kind: "declarative",
      contributes: {
        tools: [{ id: "weather", entry: "./weather.mjs", description: "weather", parameters: { type: "object" } }],
      },
    })
    const plugin = createDiscoveredPlugin({
      instance: {
        id: "acme",
        status: "installed",
        scope: "project",
        origin: "extension",
        adapter: "v2",
        manifest: pluginManifest,
        location: { kind: "directory", root: base, label: "project" },
        issues: [],
        diagnostics: [],
        installOrder: 4,
        contributions: 1,
      },
      runtime: h.input,
    })
    const host = createHost(h.input.registries as never)
    await host.activate(plugin)
    expect(host.states()).toMatchObject([{ id: "project:acme", status: "active" }])
    expect(h.input.registries.tools.list().map((item) => item.name)).toEqual(["acme_weather"])
    const first = h.input.registries.tools.list()[0]!.item
    const execution = { abort: new AbortController().signal } as Parameters<typeof first.execute>[1]
    expect(await first.execute({}, execution)).toBe("acme:false")
    host.deactivate("acme", "project")
    expect(h.input.registries.tools.list()).toHaveLength(0)
    await expect(first.execute({}, execution)).rejects.toMatchObject({ code: "tool_unavailable" })

    await host.activate(plugin)
    expect(h.input.registries.tools.list().map((item) => item.name)).toEqual(["acme_weather"])
    const second = h.input.registries.tools.list()[0]!.item
    expect(second).not.toBe(first)
    expect(await second.execute({}, execution)).toBe("acme:false")
    host.dispose()
    await expect(second.execute({}, execution)).rejects.toMatchObject({ code: "tool_unavailable" })
  })

  test("discovered v2 Agent, Skill, and Command declarations register and release with Host lifecycle", async () => {
    const h = harness()
    await fs.writeFile(path.join(base, "writer.md"), "Write concise, evidence-based reports.")
    await fs.writeFile(path.join(base, "SKILL.md"), "Use this skill to summarize source material.")
    const pluginManifest = manifest("acme", undefined, {
      kind: "declarative",
      contributes: {
        agents: [{ id: "writer", description: "Report writer", mode: "primary", prompt: { file: "writer.md" } }],
        skills: [{ id: "research", description: "Research skill", source: { file: "SKILL.md" } }],
        commands: [{ id: "draft", description: "Draft a report", template: "Write a report about $ARGUMENTS", argumentHint: "$ARGUMENTS" }],
      },
    })
    const plugin = createDiscoveredPlugin({
      instance: {
        id: "acme", status: "installed", scope: "project", origin: "extension", adapter: "v2",
        manifest: pluginManifest,
        location: { kind: "directory", root: base, label: "project" },
        issues: [], diagnostics: [], installOrder: 4, contributions: 3,
      },
      runtime: h.input,
    })
    const host = createHost(h.input.registries as never)

    await host.activate(plugin)
    expect(h.input.registries.agents.list().map((entry) => entry.name)).toEqual(["acme_writer"])
    expect(h.input.registries.agents.list()[0]?.item.prompt).toBe("Write concise, evidence-based reports.")
    expect(h.input.registries.skills.list().map((entry) => entry.name)).toEqual(["acme_research"])
    expect(h.input.registries.skills.list()[0]?.item.source).toEqual({ file: "SKILL.md", text: "Use this skill to summarize source material." })
    expect(h.input.registries.skills.list()[0]?.root).toBe(base)
    expect(h.input.registries.commands.list().map((entry) => entry.name)).toEqual(["acme_draft"])
    expect(h.input.registries.commands.list()[0]?.item.template).toContain("$ARGUMENTS")

    host.deactivate("acme", "project")
    expect(h.input.registries.agents.list()).toEqual([])
    expect(h.input.registries.skills.list()).toEqual([])
    expect(h.input.registries.commands.list()).toEqual([])
    host.dispose()
  })

  test("discovered plugin adapter rejects unsupported source states", () => {
    const h = harness()
    const instance = {
      id: "legacy",
      status: "installed" as const,
      scope: "project" as const,
      origin: "extension" as const,
      adapter: "legacy-extension" as const,
      manifest: manifest("legacy", undefined, { kind: "declarative" }),
      location: { kind: "directory" as const, root: base, label: "project" as const },
      issues: [],
      diagnostics: [],
      contributions: 0,
    }
    expect(() => createDiscoveredPlugin({ instance, runtime: h.input })).toThrow("统一 Host 激活适配器")
    expect(() => createDiscoveredPlugin({ instance: { ...instance, status: "discovered" }, runtime: h.input })).toThrow(
      "未安装或不是可执行插件",
    )
    expect(() =>
      createDiscoveredPlugin({
        instance: {
          ...instance,
          location: { kind: "spec", spec: "legacy", declaredBy: "novaway.json" },
        },
        runtime: h.input,
      }),
    ).toThrow("尚无统一 Host 激活适配器")
    expect(() =>
      createDiscoveredPlugin({
        instance: {
          ...instance,
          adapter: "v2",
          manifest: manifest("legacy", undefined, {
            kind: "code",
            main: "./index.js",
            contributes: {
              tools: [{ id: "hello", entry: "./tool.js", description: "tool", parameters: { type: "object" } }],
            },
          }),
        },
        runtime: h.input,
      }),
    ).toThrow("未安装或不是可执行插件")
    expect(() =>
      createDiscoveredPlugin({
        instance: {
          ...instance,
          adapter: "v2",
          manifest: manifest("legacy", undefined, {
            kind: "declarative",
            contributes: {
              tools: [{ id: "hello", entry: "./tool.js", description: "tool", parameters: { type: "object" } }],
              providers: ["provider"],
            },
          }),
        },
        runtime: h.input,
      }),
    ).not.toThrow()
  })

  test("tool entry activation registers once and dispose removes the tool", async () => {
    const h = harness()
    const entry = path.join(base, "weather.mjs")
    await fs.writeFile(entry, "export default (api) => ({ execute: async () => api.id })")
    const input = {
      ...h.input,
      manifest: manifest("acme", undefined, {
        contributes: {
          tools: [{ id: "weather", entry: "./weather.mjs", description: "weather", parameters: { type: "object" } }],
        },
      }),
      root: base,
    }
    const runtime = createToolEntryActivation(input)
    await runtime.activate()
    expect(runtime.active).toBe(true)
    expect(h.input.registries.tools.list().map((item) => item.name)).toEqual(["acme_weather"])
    await runtime.activate()
    expect(h.input.registries.tools.list()).toHaveLength(1)
    runtime.dispose()
    expect(runtime.active).toBe(false)
    expect(h.input.registries.tools.list()).toHaveLength(0)
  })

  test("deduplicates activation and releases contributions and listeners", async () => {
    const h = harness()
    const runtime = createActivation(h.input)
    let calls = 0
    let changes = 0
    const activate = async (ctx: PluginContext) => {
      calls += 1
      ctx.commands.register({ id: "hello", description: "hello", template: "hello" })
      ctx.commands.onDidChange(() => {
        changes += 1
      })
    }
    const first = runtime.activate(activate)
    expect(runtime.activate(activate)).toBe(first)
    await first
    expect(calls).toBe(1)
    expect(h.input.registries.commands.list()).toHaveLength(1)
    runtime.dispose()
    runtime.dispose()
    expect(runtime.active).toBe(false)
    expect(h.input.registries.commands.list()).toHaveLength(0)
    expect(changes).toBe(0)
    await runtime.activate(activate)
    expect(changes).toBe(0)
    expect(calls).toBe(2)
    runtime.dispose()
  })

  test("builtin timers and event listeners follow the same reverse release lifecycle", async () => {
    const h = harness({ pluginID: "builtin.acme", scope: "builtin", manifest: manifest("builtin.acme") })
    const kernel = fakeKernel().deps
    const released: string[] = []
    kernel.scheduler.every = () => ({
      dispose() {
        released.push("timer")
      },
    })
    kernel.events.on = () => ({
      dispose() {
        released.push("listener")
      },
    })
    const runtime = createBuiltinActivation({ ...h.input, roots: { workspace, data }, kernel })
    let api: KernelApi | undefined
    await runtime.activate(async (ctx) => {
      api = ctx
      ctx.scheduler.every(1000, async () => {})
      ctx.events.on("change", () => {})
      ctx.commands.register({ id: "hello", description: "hello", template: "hello" })
    })
    runtime.dispose()
    expect(released).toEqual(["listener", "timer"])
    expect(h.input.registries.commands.list()).toHaveLength(0)
    expect(() => api?.scheduler.every(1000, async () => {})).toThrow()
    expect(() => api?.events.on("change", () => {})).toThrow()
    expect(() => api?.events.emit("change", {})).toThrow()
  })

  test("failed activation rolls back registrations and permits retry", async () => {
    const h = harness()
    const runtime = createActivation(h.input)
    await expect(
      runtime.activate(async (ctx) => {
        ctx.commands.register({ id: "hello", description: "hello", template: "hello" })
        throw new Error("activation failed")
      }),
    ).rejects.toThrow("activation failed")
    expect(runtime.active).toBe(false)
    expect(h.input.registries.commands.list()).toHaveLength(0)
    await runtime.activate(async () => {})
    runtime.dispose()
  })

  test("disable prevents a suspended activation from registering late contributions", async () => {
    const h = harness()
    const runtime = createActivation(h.input)
    const ready = Promise.withResolvers<void>()
    const resume = Promise.withResolvers<void>()
    const pending = runtime.activate(async (ctx) => {
      ready.resolve()
      await resume.promise
      ctx.commands.register({ id: "late", description: "late", template: "late" })
    })
    await ready.promise
    runtime.dispose()
    await runtime.activate(async (ctx) => {
      ctx.commands.register({ id: "new", description: "new", template: "new" })
    })
    resume.resolve()
    await expect(pending).rejects.toThrow()
    expect(runtime.active).toBe(true)
    expect(h.input.registries.commands.list().map((entry) => entry.localName)).toEqual(["new"])
    runtime.dispose()
  })
})

type Line = { level: string; message: string; fields?: Record<string, unknown> }

function harness(overrides?: Partial<Input>) {
  const lines: Line[] = []
  const requests: string[] = []
  const values = new Map<string, string>()
  const record = (level: string) => (message: string, fields?: Record<string, unknown>) => {
    lines.push({ level, message, fields })
  }
  const logger: Logger = {
    debug: record("debug"),
    info: record("info"),
    warn: record("warn"),
    error: record("error"),
  }
  const store: SecretStore = {
    read: async (key) => values.get(key),
    write: async (key, value) => {
      values.set(key, value)
    },
    remove: async (key) => {
      values.delete(key)
    },
  }
  const input: Input = {
    pluginID: "acme",
    scope: "global",
    manifest: manifest("acme"),
    signal: new AbortController().signal,
    log: logger,
    registries: registries(),
    secrets: store,
    fetch: Object.assign(
      async (url: string | URL | Request) => {
        requests.push(url instanceof Request ? url.url : String(url))
        return new Response("ok")
      },
      // Bun 的 `typeof fetch` 带 preconnect，用例里用不到但形状要满足。
      { preconnect() {} },
    ),
    ...overrides,
  }
  used.add(input.pluginID)
  return { input, lines, requests, values }
}

function third(overrides?: Partial<Input>) {
  const h = harness(overrides)
  return { ctx: createPluginContext(h.input), ...h }
}

function first(overrides?: Partial<KernelInput>) {
  const h = harness({
    pluginID: "builtin.acme",
    scope: "builtin",
    manifest: manifest("builtin.acme"),
    ...overrides,
  })
  const fake = fakeKernel()
  const ctx = createKernelApi({ roots: { workspace, data }, kernel: fake.deps, ...h.input, ...overrides })
  return { ctx, calls: fake.calls, lines: h.lines, requests: h.requests, values: h.values, input: h.input }
}

function tool(id: string, extra?: Partial<ToolContribution>): ToolContribution {
  return { id, description: id, parameters: { type: "object" }, execute: async () => "ok", ...extra }
}

function provider(id: string): ProviderAdapter {
  return { id, name: id }
}

function surface(id: string): SurfaceContribution {
  return { slot: "statusbar.item", id, title: id, action: { type: "command", command: `acme.${id}` } }
}

/** 越权的证据是错误分类，不是文本：拿 `code` 断言，改措辞不会把用例弄红。 */
async function outcome(run: () => unknown) {
  try {
    await run()
    return "ok"
  } catch (error) {
    if (isPluginError(error)) return error.code
    return `unexpected:${error instanceof Error ? error.message : String(error)}`
  }
}

function denial(run: () => unknown) {
  try {
    run()
  } catch (error) {
    if (isPluginError(error)) return error
    throw error
  }
  throw new Error("预期抛 capability_denied，实际没抛")
}

/** 隐藏字段在类型上就不存在，越权用例只能从宽形状去看；运行时仍然是那个抛错的 getter。 */
function wide(ctx: PluginContext) {
  return ctx as unknown as KernelApi
}

/**
 * 同一份 fixture 跑在两种 ctx 上。第一方有、第三方没有的字段写成可选：
 * 在第三方上它们不是 undefined 而是**访问即抛的 getter**，这正是 §5.3 要的行为。
 */
type Probe = Pick<PluginContext, "id" | "tools" | "storage" | "secrets" | "http" | "log" | "signal"> & {
  providers?: Registry<ProviderAdapter>
  surfaces?: Registry<SurfaceContribution>
  sessions?: KernelApi["sessions"]
  files?: KernelApi["files"]
  toolRuntime?: KernelApi["toolRuntime"]
  config?: KernelApi["config"]
}

async function probe(ctx: Probe) {
  return {
    tool: await outcome(() => ctx.tools.register(tool("hello"))),
    kv: await outcome(() => ctx.storage.set("k", 1)),
    secret: await outcome(() => ctx.secrets.read("acme-token")),
    net: await outcome(() => ctx.http.fetch("https://api.acme.test/v1")),
    provider: await outcome(() => ctx.providers?.register(provider("acme"))),
    surface: await outcome(() => ctx.surfaces?.register(surface("pulse"))),
    session: await outcome(() => ctx.sessions?.create({})),
    file: await outcome(() => ctx.files?.write("note.txt", "x")),
    exec: await outcome(() => ctx.toolRuntime?.execute({ tool: "read", args: {}, sessionID: "ses_1", agent: "build" })),
    config: await outcome(() => ctx.config?.get("model")),
  }
}

const full: PluginCapabilities = {
  fs: ["plugin-data", "workspace-read", "workspace-write"],
  network: ["api.acme.test"],
  secrets: ["acme-token"],
  tools: ["read"],
}

describe("两层 API 的边界（§5.1–§5.3）", () => {
  test("同一份 fixture：第一方全通，第三方受限 API 抛 capability_denied", async () => {
    const providers = memoryRegistry<ProviderAdapter>()
    const surfaces = memoryRegistry<SurfaceContribution>()
    const shared = { providers, surfaces }
    const builtin = first({ manifest: manifest("builtin.acme", full), registries: registries(shared) })
    const external = third({ manifest: manifest("acme", full), registries: registries(shared) })

    expect(await probe(builtin.ctx)).toEqual({
      tool: "ok",
      kv: "ok",
      secret: "ok",
      net: "ok",
      provider: "ok",
      surface: "ok",
      session: "ok",
      file: "ok",
      exec: "ok",
      config: "ok",
    })
    expect(await probe(external.ctx)).toEqual({
      tool: "ok",
      kv: "ok",
      secret: "ok",
      net: "ok",
      provider: "capability_denied",
      surface: "capability_denied",
      session: "capability_denied",
      file: "capability_denied",
      exec: "capability_denied",
      config: "capability_denied",
    })
    expect(builtin.calls).toContain("sessions.create")
    expect(builtin.calls).toContain("execute:read")
  })

  test("受限注册表读取可用：第三方能列出内置提供的 provider，只是不能写", () => {
    const providers = memoryRegistry<ProviderAdapter>()
    const builtin = first({ registries: registries({ providers }) })
    const external = third({ registries: registries({ providers }) })
    builtin.ctx.providers.register(provider("acme"))
    expect(external.ctx.providers.list().map((item) => item.id)).toEqual(["acme"])
    expect(external.ctx.providers.resolve("acme")?.name).toBe("acme")
    expect(denial(() => external.ctx.providers.register(provider("evil"))).code).toBe("capability_denied")
    expect(providers.list().map((item) => item.id)).toEqual(["acme"])
  })

  test("错误信息说清是哪个贡献点、为什么", () => {
    const external = third()
    const error = denial(() => external.ctx.providers.register(provider("acme")))
    expect(error.pluginID).toBe("acme")
    expect(error.message).toContain("providers")
    expect(error.message).toContain("内置")
    expect(denial(() => wide(external.ctx).sessions).message).toContain("sessions")
  })

  test("构造器守住 scope：给第三方发 KernelApi、给内置发 PluginContext 都当场拒绝", () => {
    expect(denial(() => first({ scope: "global" })).message).toContain("builtin")
    expect(denial(() => createPluginContext(harness({ scope: "builtin" }).input)).message).toContain("createKernelApi")
  })

  test("被隐藏的字段不可枚举：展开 ctx 不会炸，直接访问才抛", () => {
    const external = third()
    expect(Object.keys(external.ctx)).not.toContain("sessions")
    expect({ ...external.ctx }.id).toBe("acme")
    expect(JSON.stringify(external.ctx)).toContain('"id":"acme"')
    expect(denial(() => wide(external.ctx).llm).code).toBe("capability_denied")
  })

  test("后续里程碑的注册表没接线时，第一方也拿不到可写入口", () => {
    const builtin = first()
    expect(
      denial(() => builtin.ctx.office.register({ format: "foo", kind: "document", extensions: [".foo"], engine: {} }))
        .code,
    ).toBe("capability_denied")
    expect(builtin.ctx.office.list()).toEqual([])
    expect(denial(() => builtin.ctx.threads).message).toContain("super-agent")
  })

  test("super-agent 接线后第一方能用，第三方仍然碰不到", async () => {
    const superAgent = {
      threads: fakeThreads(),
      channels: { publish: async () => {}, subscribe: () => ({ dispose() {} }) },
      triggers: { register: () => ({ dispose() {} }), fire: async () => {} },
    }
    const builtin = first({ kernel: { ...fakeKernel().deps, superAgent } })
    expect((await builtin.ctx.threads.list()).length).toBe(0)
    expect(denial(() => wide(third().ctx).threads).code).toBe("capability_denied")
  })
})

function fakeThreads(): KernelApi["threads"] {
  const thread: Thread = {
    id: "thr_1",
    title: "t",
    goal: "g",
    constraints: [],
    origin: "manual",
    status: "open",
    usage: { tokens: 0, cost: 0, turns: 0 },
    triggers: [],
    generation: 0,
    createdAt: 0,
    updatedAt: 0,
  }
  return {
    open: async () => thread,
    get: async () => thread,
    post: async () => {},
    wait: async () => thread,
    close: async () => {},
    list: async () => [],
    turns: async () => [],
    claim: async () => {},
  }
}

describe("注册表绑定（§4.8、§4.9、§5.2）", () => {
  test("来源由宿主绑定：第三方命名空间化，作者声明 global 也无效", () => {
    const h = third()
    h.ctx.tools.register(tool("Run Task", { global: true }))
    expect(h.input.registries.tools.list().map((entry) => entry.name)).toEqual(["acme_run_task"])
    const entry = h.input.registries.tools.list()[0]
    expect(entry.pluginID).toBe("acme")
    expect(entry.scope).toBe("global")
    expect(entry.localName).toBe("run_task")
  })

  test("内置插件声明 global 才保留原名", () => {
    const h = first()
    h.ctx.tools.register(tool("office_docx", { global: true }))
    h.ctx.tools.register(tool("extra"))
    expect(h.input.registries.tools.list().map((entry) => entry.name)).toEqual(["builtin_acme_extra", "office_docx"])
    expect(h.ctx.tools.list().map((item) => item.id)).toEqual(["builtin_acme_extra", "office_docx"])
  })

  test("list / resolve 交回的是最终名，作者才拿得到能写进 tools 白名单的名字", () => {
    const h = third()
    h.ctx.tools.register(tool("hello"))
    expect(h.ctx.tools.list().map((item) => item.id)).toEqual(["acme_hello"])
    expect(h.ctx.tools.resolve("acme_hello")?.description).toBe("hello")
    expect(h.ctx.tools.resolve("hello")).toBeUndefined()
  })

  test("交回去的是拷贝：改它不会污染注册表里那条贡献", () => {
    const h = third()
    const item = tool("hello")
    h.ctx.tools.register(item)
    const listed = h.ctx.tools.list()[0]
    listed.description = "tampered"
    expect(item.description).toBe("hello")
    expect(h.ctx.tools.resolve("acme_hello")?.description).toBe("hello")
  })

  test("manifest 的 priority / overrides 与 installOrder 一起进排序键", () => {
    const h = third({
      installOrder: 7,
      manifest: manifest("acme", undefined, { priority: 5, overrides: ["builtin.knowledge"] }),
    })
    h.ctx.agents.register({ id: "writer", description: "w", mode: "subagent", prompt: "x" })
    const entry = h.input.registries.agents.list()[0]
    expect(entry.priority).toBe(5)
    expect(entry.installOrder).toBe(7)
    expect(h.input.registries.agents.diagnostics().map((item) => item.code)).toEqual(["override_unknown"])
  })

  test("dispose 与 onDidChange 直通注册表", () => {
    const h = third()
    let changes = 0
    const watch = h.ctx.tools.onDidChange(() => {
      changes += 1
    })
    const held = h.ctx.tools.register(tool("hello"))
    expect(changes).toBe(1)
    held.dispose()
    expect(changes).toBe(2)
    expect(h.ctx.tools.list()).toEqual([])
    watch.dispose()
    h.ctx.tools.register(tool("again"))
    expect(changes).toBe(2)
  })

  test("拦截器走同一套绑定，注册进运行时而不是旁路", () => {
    const h = third()
    h.ctx.interceptors.register({ id: "trace", hook: "chat.params", handler: () => {} })
    expect(h.input.registries.interceptors.chain("chat.params")).toEqual([{ pluginID: "acme", name: "acme_trace" }])
    expect(h.ctx.interceptors.list().map((item) => item.id)).toEqual(["acme_trace"])
  })
})

describe("能力检查：network（§5.4、§11.1）", () => {
  test("未声明 network 一律拒绝，错误信息带上要访问的主机", async () => {
    const h = third()
    const error = await capture(() => h.ctx.http.fetch("https://api.acme.test/v1"))
    expect(error.code).toBe("capability_denied")
    expect(error.message).toContain("capabilities.network")
    expect(error.message).toContain("api.acme.test")
    expect(h.requests).toEqual([])
  })

  test("声明的主机放行，别的主机拒绝", async () => {
    const h = third({ manifest: manifest("acme", { network: ["api.acme.test"] }) })
    await h.ctx.http.fetch("https://api.acme.test/v1")
    expect(h.requests).toEqual(["https://api.acme.test/v1"])
    expect((await capture(() => h.ctx.http.fetch("https://evil.test/v1"))).code).toBe("capability_denied")
    expect(h.requests).toEqual(["https://api.acme.test/v1"])
  })

  test("通配只匹配子域，不匹配裸域，也不匹配尾巴相同的别的域", () => {
    expect(hostAllowed(["*.acme.test"], "api.acme.test")).toBe(true)
    expect(hostAllowed(["*.acme.test"], "a.b.acme.test")).toBe(true)
    expect(hostAllowed(["*.acme.test"], "acme.test")).toBe(false)
    expect(hostAllowed(["*.acme.test"], "evilacme.test")).toBe(false)
    expect(hostAllowed(["acme.test"], "ACME.TEST")).toBe(true)
    expect(hostAllowed(undefined, "acme.test")).toBe(false)
    expect(hostAllowed([], "acme.test")).toBe(false)
  })

  test("单独一个 * 是全放行（§11.3 要求安装时二次确认）", async () => {
    const h = third({ manifest: manifest("acme", { network: ["*"] }) })
    await h.ctx.http.fetch("https://anything.test/v1")
    expect(h.requests).toEqual(["https://anything.test/v1"])
  })

  test("非 http(s) 协议会绕过白名单，即使声明了 * 也拒绝", async () => {
    const h = third({ manifest: manifest("acme", { network: ["*"] }) })
    expect((await capture(() => h.ctx.http.fetch("file:///etc/passwd"))).code).toBe("capability_denied")
    expect(h.requests).toEqual([])
  })
})

describe("能力检查：secrets（§5.4）", () => {
  test("未声明的 key 读 / 写 / 删都拒绝", async () => {
    const h = third({ manifest: manifest("acme", { secrets: ["acme-token"] }) })
    for (const run of [
      () => h.ctx.secrets.read("other-token"),
      () => h.ctx.secrets.write("other-token", "x"),
      () => h.ctx.secrets.remove("other-token"),
    ]) {
      const error = await capture(run)
      expect(error.code).toBe("capability_denied")
      expect(error.message).toContain("capabilities.secrets")
      expect(error.message).toContain("other-token")
    }
    expect(h.values.size).toBe(0)
  })

  test("声明的 key 三个操作都放行", async () => {
    const h = third({ manifest: manifest("acme", { secrets: ["acme-token"] }) })
    await h.ctx.secrets.write("acme-token", "s3cret")
    expect(await h.ctx.secrets.read("acme-token")).toBe("s3cret")
    await h.ctx.secrets.remove("acme-token")
    expect(await h.ctx.secrets.read("acme-token")).toBeUndefined()
  })

  test("完全没声明 secrets 时连读都不行", async () => {
    const h = third()
    expect((await capture(() => h.ctx.secrets.read("acme-token"))).message).toContain("未声明")
  })
})

describe("能力检查：fs（§5.4、§11.1）", () => {
  test("未声明 fs 拒绝读写", async () => {
    const h = first()
    expect((await capture(() => h.ctx.files.read("a.txt"))).message).toContain("capabilities.fs")
    expect((await capture(() => h.ctx.files.write("a.txt", "x"))).code).toBe("capability_denied")
  })

  test("workspace-read 只授读，workspace-write 只授写，不互相蕴含", async () => {
    const reader = first({ manifest: manifest("builtin.acme", { fs: ["workspace-read"] }) })
    await fs.writeFile(path.join(workspace, "a.txt"), "content")
    expect(await reader.ctx.files.read("a.txt")).toBe("content")
    expect((await capture(() => reader.ctx.files.write("a.txt", "x"))).message).toContain("workspace-write")

    const writer = first({
      pluginID: "builtin.writer",
      manifest: manifest("builtin.writer", { fs: ["workspace-write"] }),
    })
    await writer.ctx.files.write("b.txt", "written")
    expect(await fs.readFile(path.join(workspace, "b.txt"), "utf-8")).toBe("written")
    expect((await capture(() => writer.ctx.files.read("b.txt"))).message).toContain("workspace-read")
  })

  test("plugin-data 授数据目录的读写，工作区权限不覆盖它", async () => {
    const h = first({ manifest: manifest("builtin.acme", { fs: ["plugin-data"] }) })
    const target = path.join(data, "state.json")
    await h.ctx.files.write(target, "{}")
    expect(await h.ctx.files.read(target)).toBe("{}")
    expect((await capture(() => h.ctx.files.read("a.txt"))).code).toBe("capability_denied")
  })

  test("只声明 workspace 权限时碰数据目录同样被拒", async () => {
    const h = first({ manifest: manifest("builtin.acme", { fs: ["workspace-read", "workspace-write"] }) })
    const error = await capture(() => h.ctx.files.write(path.join(data, "state.json"), "{}"))
    expect(error.message).toContain("plugin-data")
  })

  test("../ 与外部绝对路径都逃不出去", async () => {
    const h = first({ manifest: manifest("builtin.acme", { fs: ["workspace-read", "workspace-write"] }) })
    const outside = path.join(base, "outside.txt")
    await fs.writeFile(outside, "secret")
    for (const target of ["../outside.txt", outside]) {
      const error = await capture(() => h.ctx.files.read(target))
      expect(error.code).toBe("capability_denied")
      expect(error.message).toContain("已授权目录之外")
    }
    expect(await fs.readFile(outside, "utf-8")).toBe("secret")
  })

  test("第一方也要声明：L0 的强制方式就是声明 + 调用点检查", async () => {
    const h = first({ manifest: manifest("builtin.acme", { fs: [] }) })
    expect((await capture(() => h.ctx.files.write("a.txt", "x"))).message).toContain("声明为空")
  })
})

/** Windows 非开发者模式建不了符号链接；探一次，建不了就整条跳过（不是断言通过）。 */
const canSymlink = await symlinkPossible()

async function symlinkPossible() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "novaway-link-probe-"))
  const ok = await fs.symlink(path.join(dir, "target"), path.join(dir, "link"), "dir").then(
    () => true,
    () => false,
  )
  await fs.rm(dir, { recursive: true, force: true })
  return ok
}

describe("能力检查：fs 的符号链接", () => {
  test.skipIf(!canSymlink)("链接指向工作区外时，读与写都被拒", async () => {
    const outside = path.join(base, "outside")
    await fs.mkdir(outside)
    await fs.writeFile(path.join(outside, "secret.txt"), "secret")
    await fs.symlink(outside, path.join(workspace, "escape"), "dir")
    const h = first({ manifest: manifest("builtin.acme", { fs: ["workspace-read", "workspace-write"] }) })
    expect((await capture(() => h.ctx.files.read("escape/secret.txt"))).code).toBe("capability_denied")
    // 目标还不存在：只回退到词法路径的话，父目录上的这条链接就绕过去了。
    expect((await capture(() => h.ctx.files.write("escape/new.txt", "x"))).code).toBe("capability_denied")
    expect(await fs.readFile(path.join(outside, "secret.txt"), "utf-8")).toBe("secret")
    expect(await fs.stat(path.join(outside, "new.txt")).catch(() => undefined)).toBeUndefined()
  })
})

describe("能力检查：tools（§5.4）", () => {
  test("未声明该工具即拒绝，且不会走到宿主实现", async () => {
    const h = first({ manifest: manifest("builtin.acme", { tools: ["grep"] }) })
    const error = await capture(() =>
      h.ctx.toolRuntime.execute({ tool: "bash", args: {}, sessionID: "ses_1", agent: "build" }),
    )
    expect(error.code).toBe("capability_denied")
    expect(error.message).toContain("capabilities.tools")
    expect(error.message).toContain("bash")
    expect(h.calls).toEqual([])
  })

  test("声明后放行并转给宿主实现；list 不受 allowlist 限制", async () => {
    const h = first({ manifest: manifest("builtin.acme", { tools: ["read"] }) })
    expect(await h.ctx.toolRuntime.execute({ tool: "read", args: {}, sessionID: "ses_1", agent: "build" })).toBe("done")
    expect((await h.ctx.toolRuntime.list()).map((item) => item.id)).toEqual(["read"])
    expect(h.calls).toEqual(["execute:read", "toolRuntime.list"])
  })
})

describe("storage / config / log（§5.4、§12）", () => {
  test("两个插件的 KV 互不可见", async () => {
    const a = third({ pluginID: "iso_a", manifest: manifest("iso_a") })
    const b = third({ pluginID: "iso_b", manifest: manifest("iso_b") })
    await a.ctx.storage.set("token", "a")
    expect(await a.ctx.storage.get<string>("token")).toBe("a")
    expect(await b.ctx.storage.get("token")).toBeUndefined()
    expect(await b.ctx.storage.keys()).toEqual([])
  })

  test("namespace 取 manifest 声明的那一个，默认 namespace 里看不到", async () => {
    const h = third({
      pluginID: "ns",
      manifest: manifest("ns", undefined, {
        contributes: { storage: { namespace: "acme-state", migrations: "migration.sql" } },
      }),
    })
    await h.ctx.storage.set("k", 1)
    expect(PluginStorage.openKv({ pluginID: "ns", declared: "acme-state" }).get("k")).toBe(1)
    expect(PluginStorage.openKv({ pluginID: "ns" }).get("k")).toBeUndefined()
  })

  test("keys 按前缀过滤，remove 只删自己那条", async () => {
    const h = third({ pluginID: "kv", manifest: manifest("kv") })
    await h.ctx.storage.set("a:1", 1)
    await h.ctx.storage.set("a:2", 2)
    await h.ctx.storage.set("b:1", 3)
    expect(await h.ctx.storage.keys("a:")).toEqual(["a:1", "a:2"])
    expect(await h.ctx.storage.keys()).toEqual(["a:1", "a:2", "b:1"])
    await h.ctx.storage.remove("a:1")
    expect(await h.ctx.storage.keys()).toEqual(["a:2", "b:1"])
  })

  test("config 是 plugins.config.<pluginID> 的只读切片", () => {
    const h = first({ config: { model: "acme/fast", retries: 2 } })
    expect(h.ctx.config.get<string>("model")).toBe("acme/fast")
    expect(h.ctx.config.get<number>("retries")).toBe(2)
    expect(h.ctx.config.get("missing")).toBeUndefined()
    expect(denial(() => wide(third().ctx).config).code).toBe("capability_denied")
  })

  test("每条日志都归到插件名下，作者传同名键覆盖不掉", () => {
    const h = third()
    h.ctx.log.info("hello", { pluginID: "spoofed", extra: 1 })
    h.ctx.log.error("boom")
    expect(h.lines).toEqual([
      { level: "info", message: "hello", fields: { extra: 1, pluginID: "acme" } },
      { level: "error", message: "boom", fields: { pluginID: "acme" } },
    ])
  })

  test("signal 直通宿主给的那个，停用时由宿主 abort", () => {
    const controller = new AbortController()
    const h = third({ signal: controller.signal })
    expect(h.ctx.signal.aborted).toBe(false)
    controller.abort()
    expect(h.ctx.signal.aborted).toBe(true)
  })
})

async function capture(run: () => unknown) {
  try {
    await run()
  } catch (error) {
    if (isPluginError(error)) return error
    throw error
  }
  throw new Error("预期抛 PluginError，实际没抛")
}
