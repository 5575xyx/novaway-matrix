import { afterEach, describe, expect } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { fileURLToPath, pathToFileURL } from "url"
import { Effect, Layer, Result, Schema } from "effect"
import { CrossSpawnSpawner } from "@novaway/core/cross-spawn-spawner"
import { ToolRegistry } from "@/tool/registry"
import { BrowserService } from "@/browser/browser"
import { Tool } from "@/tool/tool"
import { disposeAllInstances, TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { TestConfig } from "../fixture/config"
import { Config } from "@/config/config"
import { AppFileSystem } from "@novaway/core/filesystem"
import { Plugin } from "@/plugin"
import { Question } from "@/question"
import { Todo } from "@/session/todo"
import { Goal } from "@/session/goal"
import { defaultLayer as WorkflowDefaultLayer } from "@/workflow/workflow"
import { defaultLayer as OrchestratorDefaultLayer } from "@/orchestrator/orchestrator"
import { Skill } from "@/skill"
import { Agent } from "@/agent/agent"
import { BackgroundJob } from "@/background/job"
import { Session } from "@/session/session"
import { SessionStatus } from "@/session/status"
import { Provider } from "@/provider/provider"
import { Git } from "@/git"
import { LSP } from "@/lsp/lsp"
import { Instruction } from "@/session/instruction"
import { Bus } from "@/bus"
import { FetchHttpClient } from "effect/unstable/http"
import { Format } from "@/format"
import { Ripgrep } from "@/file/ripgrep"
import * as Truncate from "@/tool/truncate"
import { InstanceState } from "@/effect/instance-state"
import { Reference } from "@/reference/reference"
import { ProviderID, ModelID } from "@/provider/schema"
import { ToolJsonSchema } from "@/tool/json-schema"
import { MessageID, SessionID } from "@/session/schema"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { Auth } from "@/auth"
import { defaultLayer as TeamLayer } from "@/team/team"
import { defaultLayer as AgentTaskListLayer } from "@/team/task-list"
import { defaultLayer as AgentMailboxLayer } from "@/team/mailbox"
import { defaultLayer as HookLayer } from "@/hook/service"
import { defaultLayer as McpLayer } from "@/mcp"
import { defaultLayer as EvolutionLayer } from "@/evolution/service"
import { Database } from "@/database"
import { ClientCapabilities } from "@/effect/client-capabilities"
import { PluginRuntimeService } from "@/plugin/runtime/service"
import { PluginToolRuntime } from "@/plugin/runtime/tool"
import type { ToolContribution } from "@novaway/plugin-api"
import { InstanceRef } from "@/effect/instance-ref"

const node = CrossSpawnSpawner.defaultLayer
const configLayer = TestConfig.layer({
  directories: () => InstanceState.directory.pipe(Effect.map((dir) => [path.join(dir, ".novaway")])),
})

const registryLayer = (
  flags: Partial<RuntimeFlags.Info> = {},
  config = configLayer,
  /** 客户端声明的能力；默认走环境变量解析，测试里用显式层覆盖（错误的类型走推断）。 */
  capabilities = ClientCapabilities.defaultLayer,
) =>
  ToolRegistry.layer
    .pipe(
      Layer.provide(Layer.merge(config, PluginRuntimeService.defaultLayer)),
      Layer.provide(Plugin.defaultLayer),
      Layer.provide(Question.defaultLayer),
      Layer.provide(Todo.defaultLayer),
      Layer.provide(Skill.defaultLayer),
      Layer.provide(Agent.defaultLayer),
      Layer.provide(Session.defaultLayer),
      Layer.provide(Layer.mergeAll(SessionStatus.defaultLayer, BackgroundJob.defaultLayer)),
      Layer.provide(Provider.defaultLayer),
      Layer.provide(Git.defaultLayer),
      Layer.provide(Reference.defaultLayer),
      Layer.provide(LSP.defaultLayer),
      Layer.provide(Instruction.defaultLayer),
      Layer.provide(AppFileSystem.defaultLayer),
      Layer.provide(Bus.layer),
      Layer.provide(FetchHttpClient.layer),
      Layer.provide(Format.defaultLayer),
      Layer.provide(node),
      Layer.provide(Ripgrep.defaultLayer),
      Layer.provide(Truncate.defaultLayer),
    )
    .pipe(
      Layer.provide(RuntimeFlags.layer(flags)),
      Layer.provide(Auth.defaultLayer),
      Layer.provide(BrowserService.defaultLayer),
      Layer.provide(Goal.defaultLayer),
      Layer.provide(WorkflowDefaultLayer),
      Layer.provide(OrchestratorDefaultLayer),
      Layer.provide(TeamLayer),
      Layer.provide(AgentTaskListLayer),
      Layer.provide(AgentMailboxLayer),
      Layer.provide(HookLayer),
      Layer.provide(McpLayer),
      Layer.provide(EvolutionLayer),
      Layer.provide(Database.defaultLayer),
      Layer.provide(capabilities),
    )

const deferConfig = TestConfig.layer({
  directories: () => InstanceState.directory.pipe(Effect.map((dir) => [path.join(dir, ".novaway")])),
  get: () => Effect.succeed({ experimental: { defer_loading: true } } as never),
})
const deferred = testEffect(
  Layer.mergeAll(
    registryLayer({}, deferConfig),
    node,
    Agent.defaultLayer,
    Auth.defaultLayer,
    Session.defaultLayer,
    SessionStatus.defaultLayer,
    BackgroundJob.defaultLayer,
  ) as any,
)

// 浏览器控制关掉后，browser_* 与 PDF 打印一起从工具列表消失（设置页/扩展页的开关）。
const noBrowserConfig = TestConfig.layer({
  directories: () => InstanceState.directory.pipe(Effect.map((dir) => [path.join(dir, ".novaway")])),
  get: () => Effect.succeed({ browser: { enabled: false } } as never),
})
const noBrowser = testEffect(
  Layer.mergeAll(
    registryLayer({}, noBrowserConfig),
    node,
    Agent.defaultLayer,
    Auth.defaultLayer,
    Session.defaultLayer,
    SessionStatus.defaultLayer,
    BackgroundJob.defaultLayer,
  ) as any,
)

// 团队编排总控关闭后，team_run 不该出现在工具列表里（§13.1）。
const teamOffConfig = TestConfig.layer({
  directories: () => InstanceState.directory.pipe(Effect.map((dir) => [path.join(dir, ".novaway")])),
  get: () => Effect.succeed({ experimental: { team_orchestration: false } } as never),
})
const teamOff = testEffect(
  Layer.mergeAll(
    registryLayer({}, teamOffConfig),
    node,
    Agent.defaultLayer,
    Auth.defaultLayer,
    Session.defaultLayer,
    SessionStatus.defaultLayer,
    BackgroundJob.defaultLayer,
  ) as any,
)

const it = testEffect(
  Layer.mergeAll(
    registryLayer(),
    node,
    Agent.defaultLayer,
    Auth.defaultLayer,
    PluginRuntimeService.defaultLayer,
  ) as any,
)
const mainOnly = testEffect(
  Layer.mergeAll(
    registryLayer(),
    node,
    Agent.defaultLayer,
    Auth.defaultLayer,
    Session.defaultLayer,
    SessionStatus.defaultLayer,
    BackgroundJob.defaultLayer,
  ) as any,
)
const scout = testEffect(
  Layer.mergeAll(registryLayer({ experimentalScout: true }), node, Agent.defaultLayer, Auth.defaultLayer) as any,
)
const plain = testEffect(
  Layer.mergeAll(
    registryLayer({ experimentalBackgroundSubagents: false }),
    node,
    Agent.defaultLayer,
    Auth.defaultLayer,
  ) as any,
)
const background = testEffect(
  Layer.mergeAll(
    registryLayer({ experimentalBackgroundSubagents: true }),
    node,
    Agent.defaultLayer,
    Auth.defaultLayer,
  ) as any,
)

/**
 * 能力协商矩阵。`plan_exit` 与 `plan_enter` 的注册条件**故意不对称**：
 * 出口恒在（任何 shell 都能从权限下拉切到计划模式，出不来就是死路），
 * 入口仍要客户端主动声明能力 —— 进计划模式需要 UI 接收并渲染审批。
 */
const acp = testEffect(
  Layer.mergeAll(
    registryLayer({}, configLayer, ClientCapabilities.layer({ client: "acp", capabilities: [] })),
    node,
    Agent.defaultLayer,
    Auth.defaultLayer,
  ) as any,
)
const planClient = testEffect(
  Layer.mergeAll(
    registryLayer({}, configLayer, ClientCapabilities.layer({ client: "desktop", capabilities: ["question", "plan"] })),
    node,
    Agent.defaultLayer,
    Auth.defaultLayer,
  ) as any,
)
const planClientExperimental = testEffect(
  Layer.mergeAll(
    registryLayer(
      { experimentalPlanMode: true },
      configLayer,
      ClientCapabilities.layer({ client: "desktop", capabilities: ["question", "plan"] }),
    ),
    node,
    Agent.defaultLayer,
    Auth.defaultLayer,
  ) as any,
)
const noPlanClientExperimental = testEffect(
  Layer.mergeAll(
    registryLayer(
      { experimentalPlanMode: true },
      configLayer,
      ClientCapabilities.layer({ client: "headless", capabilities: [] }),
    ),
    node,
    Agent.defaultLayer,
    Auth.defaultLayer,
  ) as any,
)

afterEach(async () => {
  await disposeAllInstances()
})

describe("deferred tools", () => {
  deferred.instance("hides long-tail tools until activated", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      const agent = yield* Agent.Service
      const build = (yield* agent.get("build"))!
      const session = yield* Session.Service
      const chat = yield* session.create({ title: "defer" })
      const ref = { providerID: ProviderID.make("test"), modelID: ModelID.make("test-model") }

      const before = yield* registry.tools({ ...ref, agent: build, sessionID: chat.id })
      expect(before.some((tool) => tool.id === "browser_click")).toBe(false)
      expect(before.some((tool) => tool.id === "read")).toBe(true)

      // Names (not schemas) are still advertised so the model knows what exists.
      const searchDef = before.find((tool) => tool.id === "tool_search")
      expect(searchDef?.description).toContain("browser_click")

      // tool_search activates what it returns for this session.
      const search = before.find((tool) => tool.id === "tool_search")
      if (!search) throw new Error("tool_search missing")
      yield* search.execute(
        { query: "select:browser_click" },
        {
          sessionID: chat.id,
          messageID: MessageID.make("msg_defer"),
          agent: "build",
          abort: new AbortController().signal,
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
        },
      )

      const after = yield* registry.tools({ ...ref, agent: build, sessionID: chat.id })
      expect(after.some((tool) => tool.id === "browser_click")).toBe(true)
    }),
  )

  // 页面验证的主路径必须在提示词里：藏起来模型会去加载同名的外部技能
  // （自己 spawn 一个可见 Chrome 盖住用户桌面）。
  deferred.instance("keeps opening, snapshotting and screenshotting pages always available", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      const agent = yield* Agent.Service
      const build = (yield* agent.get("build"))!
      const session = yield* Session.Service
      const chat = yield* session.create({ title: "browser-core" })
      const ref = { providerID: ProviderID.make("test"), modelID: ModelID.make("test-model") }

      const before = yield* registry.tools({ ...ref, agent: build, sessionID: chat.id })
      for (const id of ["browser_navigate", "browser_snapshot", "browser_screenshot", "browser_close"]) {
        expect(before.some((tool) => tool.id === id)).toBe(true)
      }
      // 交互类仍然延迟加载，别把整族都塞进每轮请求。
      expect(before.some((tool) => tool.id === "browser_click")).toBe(false)
    }),
  )

  teamOff.instance("drops team_run when team orchestration is switched off", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      const agent = yield* Agent.Service
      const build = (yield* agent.get("build"))!
      const session = yield* Session.Service
      const chat = yield* session.create({ title: "team-off" })
      const ref = { providerID: ProviderID.make("test"), modelID: ModelID.make("test-model") }

      const ids = (yield* registry.tools({ ...ref, agent: build, sessionID: chat.id })).map((tool) => tool.id)
      // 关闭 = 连入口都没有，而不是「调了才发现不能用」。
      expect(ids).not.toContain("team_run")
      // 总控关闭时所有协作入口都隐藏，避免模型绕过 team_run 自行建团队或只建看板。
      for (const id of ["team_create", "team_list", "task_create", "task_list"]) {
        expect(ids).not.toContain(id)
      }
      expect(ids).toContain("read")
    }),
  )

  mainOnly.instance("hides collaboration tools in an explicit main-assistant-only session", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      const agent = yield* Agent.Service
      const build = (yield* agent.get("build"))!
      const session = yield* Session.Service
      const chat = yield* session.create({ title: "main-only", teamMode: "off" })
      const ref = { providerID: ProviderID.make("test"), modelID: ModelID.make("test-model") }

      const ids = (yield* registry.tools({ ...ref, agent: build, sessionID: chat.id })).map((tool) => tool.id)
      for (const id of ["team_run", "team_create", "team_list", "task_create", "task_list", "agent_message"]) {
        expect(ids).not.toContain(id)
      }
      expect(ids).toContain("read")

      // 没有团队模式的历史会话也按主助手处理，避免旧会话绕过新边界。
      const legacy = yield* session.create({ title: "legacy" })
      const legacyIDs = (yield* registry.tools({ ...ref, agent: build, sessionID: legacy.id })).map((tool) => tool.id)
      expect(legacyIDs).not.toContain("team_run")
      expect(legacyIDs).not.toContain("team_create")

      const automatic = yield* session.create({ title: "automatic", teamMode: "auto" })
      const automaticIDs = (yield* registry.tools({ ...ref, agent: build, sessionID: automatic.id })).map((tool) => tool.id)
      expect(automaticIDs).toContain("team_run")
      expect(automaticIDs).toContain("team_create")
    }),
  )

  noBrowser.instance("drops browser tools and PDF export when browser control is disabled", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      const agent = yield* Agent.Service
      const build = (yield* agent.get("build"))!
      const session = yield* Session.Service
      const chat = yield* session.create({ title: "no-browser" })
      const ref = { providerID: ProviderID.make("test"), modelID: ModelID.make("test-model") }

      const ids = (yield* registry.tools({ ...ref, agent: build, sessionID: chat.id })).map((tool) => tool.id)
      expect(ids.some((id) => id.startsWith("browser_"))).toBe(false)
      expect(ids).not.toContain("pdf_create")
      // 其它工具不受影响。
      expect(ids).toContain("read")
    }),
  )

  deferred.instance("activates a whole tool family with select:<prefix>*", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      const agent = yield* Agent.Service
      const build = (yield* agent.get("build"))!
      const session = yield* Session.Service
      const chat = yield* session.create({ title: "defer-family" })
      const ref = { providerID: ProviderID.make("test"), modelID: ModelID.make("test-model") }

      const before = yield* registry.tools({ ...ref, agent: build, sessionID: chat.id })
      const search = before.find((tool) => tool.id === "tool_search")
      if (!search) throw new Error("tool_search missing")
      yield* search.execute(
        { query: "select:browser_*" },
        {
          sessionID: chat.id,
          messageID: MessageID.make("msg_family"),
          agent: "build",
          abort: new AbortController().signal,
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
        },
      )

      const after = yield* registry.tools({ ...ref, agent: build, sessionID: chat.id })
      for (const id of ["browser_click", "browser_fill", "browser_console"]) {
        expect(after.some((tool) => tool.id === id)).toBe(true)
      }
    }),
  )
})

describe("tool.registry", () => {
  it.live("refreshes plugin tool snapshots after contributions change", () =>
    Effect.gen(function* () {
      const runtime = yield* PluginRuntimeService.Service
      const host = yield* runtime.get
      const pluginTool: ToolContribution = {
        id: "ping",
        description: "Plugin ping tool",
        parameters: { type: "object", properties: {}, additionalProperties: false },
        safety: { readOnly: true, concurrencySafe: true, destructive: false, idempotent: true },
        execute: async () => "pong",
      }
      host.registries.tools.register({ pluginID: "sample", scope: "project" }, pluginTool)
      const registry = yield* ToolRegistry.Service
      const added = yield* registry.all()
      expect(added.filter((tool) => tool.id === "sample_ping")).toHaveLength(1)

      host.registries.tools.release("sample")
      const removed = yield* registry.all()
      expect(removed.some((tool) => tool.id === "sample_ping")).toBe(false)
    }).pipe(
      Effect.provide(PluginRuntimeService.defaultLayer),
      Effect.provideService(InstanceRef, {
        directory: "/tmp/plugin-snapshot",
        worktree: "/tmp/plugin-snapshot",
      } as never),
    ),
  )
  it.instance("offers review_document to primary agents only", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      const agents = yield* Agent.Service
      const build = (yield* agents.get("build"))!
      const general = (yield* agents.get("general"))!
      const ref = { providerID: ProviderID.make("test"), modelID: ModelID.make("test-model") }

      const primary = yield* registry.tools({ ...ref, agent: build })
      expect(primary.some((tool) => tool.id === "review_document")).toBe(true)

      const sub = yield* registry.tools({ ...ref, agent: general })
      expect(sub.some((tool) => tool.id === "review_document")).toBe(false)
    }),
  )

  it.instance("hides repo research tools unless experimental", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      const ids = yield* registry.ids()

      expect(ids).not.toContain("repo_clone")
      expect(ids).not.toContain("repo_overview")
    }),
  )

  // 任何 shell 都能从权限下拉把会话切到计划模式，此时提示词要求模型用 plan_exit
  // 收尾。出口工具不能受能力协商/实验开关影响，否则模型只能反复试写计划文件。
  it.instance("always offers plan_exit so plan mode can always be left", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      const ids = yield* registry.ids()

      expect(ids).toContain("plan_exit")
    }),
  )

  scout.instance("shows repo research tools when experimental scout is enabled", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      const ids = yield* registry.ids()

      expect(ids).toContain("repo_clone")
      expect(ids).toContain("repo_overview")
    }),
  )

  plain.instance("hides task_status unless experimental background subagents are enabled", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      const ids = yield* registry.ids()

      expect(ids).not.toContain("task_status")
    }),
  )

  plain.instance("hides task background parameter unless experimental background subagents are enabled", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      const agent = yield* Agent.Service
      const build = (yield* agent.get("build"))!
      if (!build) throw new Error("build agent not found")
      const task = (yield* registry.tools({
        providerID: ProviderID.builtin,
        modelID: ModelID.make("test"),
        agent: build,
      })).find((tool) => tool.id === "task")

      expect(task?.jsonSchema).toBeDefined()
      expect((task?.jsonSchema?.properties as Record<string, unknown> | undefined)?.background).toBeUndefined()
    }),
  )

  background.instance("shows task_status when experimental background subagents are enabled", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      const ids = yield* registry.ids()

      expect(ids).toContain("task_status")
    }),
  )

  it.instance("loads tools from .novaway/tool (singular)", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const configDir = path.join(test.directory, ".novaway")
      const tool = path.join(configDir, "tool")
      yield* Effect.promise(() => fs.mkdir(tool, { recursive: true }))
      yield* Effect.promise(() =>
        Bun.write(
          path.join(tool, "hello.ts"),
          [
            "export default {",
            "  description: 'hello tool',",
            "  args: {},",
            "  execute: async () => {",
            "    return 'hello world'",
            "  },",
            "}",
            "",
          ].join("\n"),
        ),
      )
      const registry = yield* ToolRegistry.Service
      const ids = yield* registry.ids()
      expect(ids).toContain("hello")
    }),
  )

  it.instance("ignores non-tool exports in .novaway/tool files", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const tool = path.join(test.directory, ".novaway", "tool")
      yield* Effect.promise(() => fs.mkdir(tool, { recursive: true }))
      yield* Effect.promise(() =>
        Bun.write(
          path.join(tool, "mixed.ts"),
          [
            "export const helper = 'not a tool'",
            "export default {",
            "  description: 'mixed tool',",
            "  args: {},",
            "  execute: async () => 'ok',",
            "}",
            "",
          ].join("\n"),
        ),
      )

      const registry = yield* ToolRegistry.Service
      const ids = yield* registry.ids()
      expect(ids).toContain("mixed")
      expect(ids).not.toContain("mixed_helper")
    }),
  )

  it.instance("loads tools from .novaway/tools (plural)", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const configDir = path.join(test.directory, ".novaway")
      const tools = path.join(configDir, "tools")
      yield* Effect.promise(() => fs.mkdir(tools, { recursive: true }))
      yield* Effect.promise(() =>
        Bun.write(
          path.join(tools, "hello.ts"),
          [
            "export default {",
            "  description: 'hello tool',",
            "  args: {},",
            "  execute: async () => {",
            "    return 'hello world'",
            "  },",
            "}",
            "",
          ].join("\n"),
        ),
      )
      const registry = yield* ToolRegistry.Service
      const ids = yield* registry.ids()
      expect(ids).toContain("hello")
    }),
  )

  it.instance("loads Zod-schema custom tools with JSON Schema and validation", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const customTools = path.join(test.directory, ".novaway", "tools")
      const pluginTool = pathToFileURL(path.resolve(import.meta.dir, "../../../plugin/src/tool.ts")).href
      yield* Effect.promise(() => fs.mkdir(customTools, { recursive: true }))
      yield* Effect.promise(() =>
        Bun.write(
          path.join(customTools, "sql.ts"),
          [
            `import { tool } from ${JSON.stringify(pluginTool)}`,
            "export default tool({",
            "  description: 'query database',",
            "  args: { query: tool.schema.string().describe('SQL query to execute') },",
            "  execute: async ({ query }) => query,",
            "})",
            "",
          ].join("\n"),
        ),
      )

      const registry = yield* ToolRegistry.Service
      const loaded = (yield* registry.all()).find((tool) => tool.id === "sql")
      if (!loaded) throw new Error("custom sql tool was not loaded")
      expect(loaded?.jsonSchema).toMatchObject({
        type: "object",
        properties: {
          query: { type: "string", description: "SQL query to execute" },
        },
        required: ["query"],
      })
      expect(Result.isSuccess(Schema.decodeUnknownResult(loaded.parameters)({ query: "select 1" }))).toBe(true)
      expect(Result.isSuccess(Schema.decodeUnknownResult(loaded.parameters)({}))).toBe(false)

      const agents = yield* Agent.Service
      const promptTools = yield* registry.tools({
        providerID: ProviderID.builtin,
        modelID: ModelID.make("test"),
        agent: yield* agents.defaultInfo(),
      })
      const promptTool = promptTools.find((tool) => tool.id === "sql")
      if (!promptTool) throw new Error("custom sql tool was not returned for prompts")
      expect(ToolJsonSchema.fromTool(promptTool)).toMatchObject({
        properties: {
          query: { type: "string", description: "SQL query to execute" },
        },
        required: ["query"],
      })
    }),
  )

  it.instance(
    "preserves Zod arg descriptions from config-scoped plugin packages",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const configDir = path.join(test.directory, ".novaway")
        const customTools = path.join(configDir, "tools")
        const plugin = path.join(configDir, "node_modules", "@novaway", "plugin")
        yield* Effect.promise(() => fs.mkdir(path.join(plugin, "dist"), { recursive: true }))
        yield* Effect.promise(() => fs.mkdir(customTools, { recursive: true }))
        yield* Effect.promise(() =>
          fs.cp(path.dirname(fileURLToPath(import.meta.resolve("zod"))), path.join(configDir, "node_modules", "zod"), {
            dereference: true,
            recursive: true,
          }),
        )
        yield* Effect.promise(() =>
          Bun.write(
            path.join(plugin, "package.json"),
            JSON.stringify({ name: "@novaway/plugin", type: "module", exports: { ".": "./dist/index.js" } }),
          ),
        )
        yield* Effect.promise(() =>
          Bun.write(
            path.join(plugin, "dist", "index.js"),
            [
              "import { z } from 'zod'",
              "export function tool(input) {",
              "  return input",
              "}",
              "tool.schema = z",
              "",
            ].join("\n"),
          ),
        )
        yield* Effect.promise(() =>
          Bun.write(
            path.join(customTools, "addition.ts"),
            [
              'import { tool } from "@novaway/plugin"',
              "export default tool({",
              "  description: 'Use this tool to add two numbers and return their sum.',",
              "  args: {",
              "    left: tool.schema.number().describe('The first number to add'),",
              "    right: tool.schema.number().describe('The second number to add'),",
              "  },",
              "  execute: async (args) => `${args.left} + ${args.right} = ${args.left + args.right}`,",
              "})",
              "",
            ].join("\n"),
          ),
        )

        const registry = yield* ToolRegistry.Service
        const loaded = (yield* registry.all()).find((tool) => tool.id === "addition")
        if (!loaded) throw new Error("custom addition tool was not loaded")

        expect(ToolJsonSchema.fromTool(loaded)).toMatchObject({
          properties: {
            left: { type: "number", description: "The first number to add" },
            right: { type: "number", description: "The second number to add" },
          },
        })
      }),
    20_000,
  )

  it.instance("preserves attachments from structured custom tool results", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const customTools = path.join(test.directory, ".novaway", "tools")
      const pluginTool = pathToFileURL(path.resolve(import.meta.dir, "../../../plugin/src/tool.ts")).href
      yield* Effect.promise(() => fs.mkdir(customTools, { recursive: true }))
      yield* Effect.promise(() =>
        Bun.write(
          path.join(customTools, "image.ts"),
          [
            `import { tool } from ${JSON.stringify(pluginTool)}`,
            "export default tool({",
            "  description: 'image tool',",
            "  args: {},",
            "  execute: async () => ({",
            "    output: 'here is an image',",
            "    attachments: [{ type: 'file', mime: 'image/png', filename: 'picture.png', url: 'data:image/png;base64,AAAA' }],",
            "  }),",
            "})",
            "",
          ].join("\n"),
        ),
      )

      const registry = yield* ToolRegistry.Service
      const loaded = (yield* registry.all()).find((tool) => tool.id === "image")
      if (!loaded) throw new Error("custom image tool was not loaded")
      const agents = yield* Agent.Service
      const result = yield* loaded.execute({}, {
        sessionID: SessionID.make("ses_test"),
        messageID: MessageID.make("msg_test"),
        agent: (yield* agents.defaultInfo()).name,
        abort: new AbortController().signal,
        messages: [],
        metadata: () => Effect.void,
        ask: () => Effect.void,
      } satisfies Tool.Context)

      expect(result.output).toBe("here is an image")
      expect(result.attachments).toEqual([
        { type: "file", mime: "image/png", filename: "picture.png", url: "data:image/png;base64,AAAA" },
      ])
    }),
  )

  it.instance("loads legacy JSON-schema-shaped custom tools with wire schema", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const tools = path.join(test.directory, ".novaway", "tools")
      yield* Effect.promise(() => fs.mkdir(tools, { recursive: true }))
      yield* Effect.promise(() =>
        Bun.write(
          path.join(tools, "legacy.ts"),
          [
            "export default {",
            "  description: 'legacy schema tool',",
            "  args: { text: { type: 'string', description: 'Text to render' } },",
            "  execute: async ({ text }) => text,",
            "}",
            "",
          ].join("\n"),
        ),
      )

      const registry = yield* ToolRegistry.Service
      const loaded = (yield* registry.all()).find((tool) => tool.id === "legacy")
      if (!loaded) throw new Error("legacy custom tool was not loaded")
      expect(ToolJsonSchema.fromTool(loaded)).toMatchObject({
        type: "object",
        properties: {
          text: { type: "string", description: "Text to render" },
        },
        required: ["text"],
      })
    }),
  )

  it.instance("loads tools with external dependencies without crashing", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const configDir = path.join(test.directory, ".novaway")
      const tools = path.join(configDir, "tools")
      yield* Effect.promise(() => fs.mkdir(tools, { recursive: true }))
      yield* Effect.promise(() =>
        Bun.write(
          path.join(configDir, "package.json"),
          JSON.stringify({
            name: "custom-tools",
            dependencies: {
              "@novaway/plugin": "^0.0.0",
              cowsay: "^1.6.0",
            },
          }),
        ),
      )
      yield* Effect.promise(() =>
        Bun.write(
          path.join(configDir, "package-lock.json"),
          JSON.stringify({
            name: "custom-tools",
            lockfileVersion: 3,
            packages: {
              "": {
                dependencies: {
                  "@novaway/plugin": "^0.0.0",
                  cowsay: "^1.6.0",
                },
              },
            },
          }),
        ),
      )

      const cowsay = path.join(configDir, "node_modules", "cowsay")
      yield* Effect.promise(() => fs.mkdir(cowsay, { recursive: true }))
      yield* Effect.promise(() =>
        Bun.write(
          path.join(cowsay, "package.json"),
          JSON.stringify({
            name: "cowsay",
            type: "module",
            exports: "./index.js",
          }),
        ),
      )
      yield* Effect.promise(() =>
        Bun.write(
          path.join(cowsay, "index.js"),
          ["export function say({ text }) {", "  return `moo ${text}`", "}", ""].join("\n"),
        ),
      )
      yield* Effect.promise(() =>
        Bun.write(
          path.join(tools, "cowsay.ts"),
          [
            "import { say } from 'cowsay'",
            "export default {",
            "  description: 'tool that imports cowsay at top level',",
            "  args: { text: { type: 'string' } },",
            "  execute: async ({ text }: { text: string }) => {",
            "    return say({ text })",
            "  },",
            "}",
            "",
          ].join("\n"),
        ),
      )
      const registry = yield* ToolRegistry.Service
      const ids = yield* registry.ids()
      expect(ids).toContain("cowsay")
    }),
  )
})

describe("plan mode tool surface", () => {
  // ACP 客户端不声明任何能力（`LEGACY.acp = []`）：它渲染不了审批 UI，
  // 所以拿不到 `plan_enter`；但它仍然拿到 `plan_exit` —— 会话一旦被配置成
  // 计划档，模型必须有办法收尾，否则就是线上那条"反复试写十轮"的死路。
  acp.instance("a client without capabilities still gets plan_exit but not plan_enter", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      const ids = yield* registry.ids()
      expect(ids).toContain("plan_exit")
      expect(ids).not.toContain("plan_enter")
    }),
  )

  planClient.instance("declaring the plan capability is not enough without the flag", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      const ids = yield* registry.ids()
      expect(ids).toContain("plan_exit")
      expect(ids).not.toContain("plan_enter")
    }),
  )

  planClientExperimental.instance("plan_enter shows up once capability and flag agree", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      const ids = yield* registry.ids()
      expect(ids).toContain("plan_enter")
      expect(ids).toContain("plan_exit")
    }),
  )

  noPlanClientExperimental.instance("the flag alone does not hand out plan_enter", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      const ids = yield* registry.ids()
      expect(ids).not.toContain("plan_enter")
      // 出口依旧在：能力协商不该影响"能不能离开计划模式"。
      expect(ids).toContain("plan_exit")
    }),
  )
})
