import {
  builtinFastPathRules,
  defineBuiltinPlugin,
  defineTool,
  isPluginError,
  pluginErrorCodes,
  toolSafetyDefaults,
} from "../src/index"
import type {
  ChannelMessage,
  Disposable,
  EventSourceContribution,
  KernelApi,
  Manifest,
  PluginError,
  ProviderAdapter,
  RestrictedRegistry,
  ToolContribution,
  ToolDeclaration,
  WorkerHandle,
} from "../src/index"

/* 类型断言小工具：只在编译期生效，本文件不会被测试运行器执行。 */
type Equal<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
type Expect<T extends true> = T

/** 窄参数工具能进 `Registry<ToolContribution>`——`execute` 用方法语法声明，参数双变。 */
type NarrowTool = ToolContribution<{ city: string }>
type _narrow_tool_assignable = Expect<NarrowTool extends ToolContribution ? true : false>
/** 声明式贡献里不许出现函数。 */
type _declaration_has_no_execute = Expect<Equal<"execute" extends keyof ToolDeclaration ? true : false, false>>
/** 错误码集合与 union 一一对应，加码不删码。 */
type _error_codes_exact = Expect<Equal<(typeof pluginErrorCodes)[number], PluginError["code"]>>
/** 未授权注册表：读得到，写返回 never。 */
type _restricted_register_denied = Expect<Equal<ReturnType<RestrictedRegistry<ProviderAdapter>["register"]>, never>>
/** Fast path 内置规则只有这 5 条，插件改不了名（§3.3、Q11）。 */
type _builtin_rules_are_literals = Expect<
  Equal<
    (typeof builtinFastPathRules)[number],
    | "builtin.dedupe"
    | "builtin.known-issue"
    | "builtin.heartbeat"
    | "builtin.budget-exhausted"
    | "builtin.mechanical-action"
  >
>

/** Manifest v2 全量贡献点：24 个 kind 都要能在 contributes 里声明出来。 */
export const manifestFixture = {
  name: "acme_all",
  version: "1.0.0",
  apiVersion: 2,
  kind: "mixed",
  main: "./index.js",
  engines: { novaway: ">=1.0.0" },
  activationEvents: ["onStartup", "onTool:acme_all_weather", "onView:acme_all.dashboard", "onTrigger:acme_all_pr"],
  dependencies: { "acme-weather": "^1.0.0" },
  capabilities: {
    fs: ["plugin-data", "workspace-read"],
    network: ["api.example.com"],
    shell: false,
    process: ["spawn"],
    secrets: ["acme_token"],
    tools: ["novaway_bash"],
    ui: ["acme_all.dashboard"],
  },
  priority: 10,
  overrides: ["builtin.knowledge:knowledge_search"],
  categories: ["demo"],
  license: "MIT",
  contributes: {
    tools: [{ id: "weather", entry: "./tools/weather.js", description: "…", parameters: { type: "object" } }],
    agents: ["./agents"],
    skills: ["./skills"],
    commands: ["./commands"],
    interceptors: "./interceptors.js",
    lifecycleHooks: "./hooks/hooks.json",
    mcpServers: { "my-mcp": { type: "local", command: ["node", "server.js"] } },
    outputStyles: "./output-styles",
    lspServers: "./lsp.json",
    httpRoutes: [{ id: "run", method: "POST", path: "/run", entry: "./routes/run.js" }],
    providers: ["./providers/acme.js"],
    officeEngines: [{ format: "foo", extensions: ["foo"], kind: "document", entry: "./engines/foo.js" }],
    publishDrivers: ["./drivers/acme.js"],
    previewers: [{ id: "foo", match: { extension: ".foo" }, viewId: "foo.preview" }],
    surfaces: [
      {
        slot: "sidebar.item",
        id: "acme",
        title: "Acme",
        icon: "globe",
        order: 50,
        action: { type: "view", viewId: "acme_all.dashboard" },
      },
    ],
    storage: { namespace: "acme", migrations: "./migrations" },
    triggers: [{ id: "pr", kind: "webhook", entry: "./triggers/pr.js", thread: { mode: "reuse" } }],
    fastPath: [{ id: "builtin.dedupe", entry: "./fast-path/dedupe.js" }],
    routingPolicies: [{ id: "acme-routing", entry: "./routing/acme.js" }],
    workerTypes: [{ id: "task", entry: "./worker/task.js" }],
    watchdogPolicies: [{ id: "acme-watchdog", entry: "./watchdog/acme.js" }],
    channels: [{ id: "acme-im", kind: "im", entry: "./channels/im.js" }],
  },
} satisfies Manifest

/** 第一方内置插件：KernelApi 的每个字段都要能用，否则 M1 拆分无处落脚。 */
export const builtinFixture = defineBuiltinPlugin({
  async activate(ctx) {
    ctx.tools.register(
      defineTool({
        id: "hello",
        description: "Say hello",
        parameters: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
        safety: { ...toolSafetyDefaults, readOnly: true, destructive: false, concurrencySafe: true },
        async execute(args: { name: string }, toolCtx) {
          await toolCtx.ask({ permission: "hello", patterns: [args.name], always: ["hello"] })
          return { output: `hello ${args.name}`, metadata: { sessionID: toolCtx.sessionID } }
        },
      }),
    )

    ctx.agents.register({
      id: "reviewer",
      description: "…",
      mode: "subagent",
      prompt: { file: "./agents/reviewer.md" },
    })
    ctx.skills.register({ id: "demo", source: { file: "./skills/demo" }, description: "…" })
    ctx.commands.register({ id: "ping", description: "…", template: "pong $ARGUMENTS" })
    ctx.providers.register({ id: "acme", name: "Acme", auth: { type: "api", key: ["ACME_KEY"] } })
    ctx.office.register({ format: "foo", kind: "document", extensions: [".foo"], engine: {} })
    ctx.publish.register({
      id: "acme",
      name: "Acme",
      supports: ["video"],
      urls: { video: "https://example.com" },
      automation: {},
      account: { login: "cookie", profileFields: [] },
    })
    ctx.surfaces.register({
      slot: "statusbar.item",
      id: "acme",
      title: "Acme",
      action: { type: "url", url: "https://example.com" },
    })
    ctx.schedulers.register({ id: "sweep", schedule: { everyMs: 60_000 }, async run() {} })
    ctx.eventSources.register({
      id: "files",
      kind: "fs",
      async start(emit) {
        emit({ type: "ready", properties: {} })
        return { dispose() {} }
      },
    } satisfies EventSourceContribution)

    await ctx.sessions.create({ title: "watchdog", agent: "reviewer" })
    await ctx.sessions.prompt({ sessionID: "ses_1", text: "hi" })
    await ctx.sessions.messages("ses_1")
    await ctx.sessions.abort("ses_1")

    await ctx.toolRuntime.execute({ tool: "novaway_read", args: {}, sessionID: "ses_1", agent: "build" })
    await ctx.toolRuntime.list({ sessionID: "ses_1" })
    await ctx.llm.complete({ model: { providerID: "openai", modelID: "gpt" }, messages: [], system: ["be brief"] })
    for await (const _chunk of ctx.llm.stream({ model: { providerID: "openai", modelID: "gpt" }, messages: [] })) {
      break
    }

    await ctx.background.start({ type: "publish", run: async () => "done" })
    await ctx.background.list()
    await ctx.background.cancel("job_1")

    const disposables: Disposable[] = []
    disposables.push(ctx.scheduler.every(60_000, async () => {}))
    disposables.push(ctx.scheduler.cron("0 * * * *", async () => {}))
    disposables.push(ctx.events.on("session.idle", () => {}))
    ctx.events.emit("my.event", { ok: true })

    await ctx.storage.set("k", 1)
    await ctx.storage.remove("k")
    await ctx.storage.keys("p")
    const cached = await ctx.storage.get<number>("k")
    if (cached !== undefined) ctx.log.info("cached", { cached })
    await ctx.files.write("a.txt", "b")
    await ctx.files.read("a.txt")
    await ctx.http.fetch("https://api.example.com")
    await ctx.secrets.write("acme_token", "t")
    ctx.config.get<boolean>("plugin.acme.enabled")
    await ctx.permissions.ask({ permission: "acme_token", patterns: [], always: [] })

    const failure: unknown = new Error("boom")
    if (isPluginError(failure)) ctx.log.warn(failure.code, { pluginID: failure.pluginID })

    /* super-agent 侧（§12.2）：只有第一方拿得到 */
    const thread = await ctx.threads.open({
      goal: "修登录页",
      sourceKey: "trigger:acme_all_pr",
      triggers: ["acme_all_pr"],
      budget: { tokens: 200_000 },
    })
    await ctx.threads.post({ threadID: thread.id, text: "顺便看看注册" })
    await ctx.threads.get(thread.id)
    await ctx.threads.wait(thread.id, { until: "waiting", timeoutMs: 1_000 })
    await ctx.threads.turns(thread.id)
    await ctx.threads.claim(thread.id, { worker: "task" })
    await ctx.threads.list({ status: ["running"] })
    await ctx.threads.close(thread.id, "done")

    const message: ChannelMessage = {
      threadID: thread.id,
      priority: "high",
      text: "搞定：3 个测试补上",
      askID: "ask_1",
    }
    await ctx.channels.publish("im", message)
    disposables.push(ctx.channels.subscribe("im", () => {}))
    disposables.push(
      ctx.triggers.register({
        id: "pr",
        kind: "webhook",
        match: (input) => input.kind === "webhook",
        normalize: (input) => [{ triggerID: "acme_all_pr", payload: input, at: Date.now() }],
        thread: { mode: "reuse" },
      }),
    )
    await ctx.triggers.fire("acme_all_pr", { action: "opened" })

    const worker: WorkerHandle = {
      id: "w1",
      type: "task",
      start: async () => {},
      send: async () => {},
      next: async () => ({ kind: "done", summary: "ok" }),
      stop: async () => ({ clean: true }),
    }
    await worker.start()
    await worker.next()
    await worker.stop("user")

    for (const d of disposables) d.dispose()
  },
})

/** 第一方的 ctx 由 API 推断出来，作者不需要手写 `KernelApi`。 */
type _builtin_ctx_inferred = Expect<Equal<Parameters<typeof builtinFixture.activate>[0], KernelApi>>
