#!/usr/bin/env bun
/**
 * B2 性能门禁（插件文档 §0.3、§6.4、§15.4）。
 *
 * 口径（与设计文档逐条对应，不另选更宽的边界）：
 * - 启动开销 = `PluginHost.inspect`（发现 + manifest 解析）+ 每个插件的 `createDiscoveredPlugin`
 *   与 `host.load`（onStartup 激活），与 `InstanceBootstrap.run` 中插件段调用的是同一组生产函数；
 *   不含 Server 监听、HTTP 反序列化与无关服务的 init。
 * - 每轮拦截器 = 生产 `createInterceptorRuntime`，10 个 `chat.params` 拦截器，每次采样触发 1000 轮。
 * - 首次 onTool = 20 个声明 `activationEvents: ["onTool:…"]` 的插件全部 load 后，第一次调用工具
 *   的「延迟导入 + 工厂 + 执行」耗时；entry 模块带全局计数器，用来证明 load 期没有导入。
 * - 内存 = 同一插件 50 次 activate/deactivate 后的堆增长（Bun.gc(true) 前后对比）。
 * - 残留写进 `script/plugin-leak-check.ts`（why-is-node-running）与 Host 生命周期单测。
 *
 * 所有 URL、缓存目录、HOME/config 都是临时目录；每次冷测前 `PluginHost.clearIndexCache()`。
 */
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { PluginHost } from "../src/plugin/host"
import {
  createAgentRegistry,
  createCommandRegistry,
  createSkillRegistry,
  createToolRegistry,
} from "../src/plugin/contributions"
import { createHost } from "../src/plugin/runtime/host"
import { createInterceptorRuntime } from "../src/plugin/runtime/hooks"
import { createDiscoveredPlugin } from "../src/plugin/runtime/activation"
import { createSecretStore } from "../src/plugin/runtime/secrets"
import type { ActivationEvent } from "@novaway/plugin-api"

const COUNT = 20
const RUNS = 20
const INTERCEPTORS = 10
const TURNS = 1_000
const CYCLES = 50
const BUDGET = {
  discoveryCold: 120,
  discoveryWarm: 30,
  activationAll: 400,
  activationSingleP95: 50,
  firstOnTool: 300,
  interceptorTurn: 15,
  heapGrowth: 20 * 1_048_576,
}

const log = { debug() {}, info() {}, warn() {}, error() {} }
const root = await fs.mkdtemp(path.join(os.tmpdir(), "novaway-b2-"))
const config = path.join(root, "config")
const home = path.join(root, "home")
const directory = path.join(root, "project")
const cache = path.join(root, "cache")
const secrets = path.join(root, "secrets")
const input = { config, home, directory, worktree: directory, builtin: "", cache, env: {}, meta: {} }

const median = (values: readonly number[]) => {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted.length % 2
    ? sorted[(sorted.length - 1) / 2]!
    : (sorted[sorted.length / 2 - 1]! + sorted[sorted.length / 2]!) / 2
}
const percentile = (values: readonly number[], p: number) => {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)]!
}
const round = (value: number) => Math.round(value * 100) / 100

function registries() {
  return {
    tools: createToolRegistry(),
    agents: createAgentRegistry(),
    skills: createSkillRegistry(),
    commands: createCommandRegistry(),
    interceptors: createInterceptorRuntime(),
  }
}

function discovered(index: number, lazy: boolean, project = directory) {
  const name = `perf-${index}`
  return {
    id: name,
    status: "installed" as const,
    scope: "project" as const,
    origin: "extension" as const,
    adapter: "v2" as const,
    manifest: {
      name,
      version: "1.0.0",
      apiVersion: 2,
      kind: "declarative" as const,
      ...(lazy ? { activationEvents: [`onTool:${name}_run` as ActivationEvent] } : {}),
      contributes: {
        tools: [
          {
            id: "run",
            entry: "./tool.mjs",
            description: `perf benchmark ${name}`,
            parameters: { type: "object", properties: { value: { type: "number" } } } as const,
            safety: { readOnly: true, concurrencySafe: true, destructive: false, idempotent: true },
          },
        ],
      },
    },
    location: {
      kind: "directory" as const,
      root: path.join(project, ".novaway", "extensions", name),
      label: "project" as const,
    },
    issues: [],
    diagnostics: [],
    installOrder: index,
    contributions: 1,
  }
}

async function createFixtures(lazy: boolean, project = directory) {
  for (let index = 0; index < COUNT; index++) {
    const name = `perf-${index}`
    const dir = path.join(project, ".novaway", "extensions", name)
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(
      path.join(dir, "plugin.json"),
      JSON.stringify({
        name,
        version: "1.0.0",
        apiVersion: 2,
        kind: "declarative",
        ...(lazy ? { activationEvents: [`onTool:${name}_run` as ActivationEvent] } : {}),
        contributes: {
          tools: [
            {
              id: "run",
              entry: "./tool.mjs",
              description: `perf benchmark ${name}`,
              parameters: { type: "object", properties: { value: { type: "number" } } },
              safety: { readOnly: true, concurrencySafe: true, destructive: false, idempotent: true },
            },
          ],
        },
      }),
    )
    await fs.writeFile(
      path.join(dir, "tool.mjs"),
      [
        `globalThis.__novawayPerfImports = (globalThis.__novawayPerfImports ?? 0) + 1`,
        `export default () => ({ execute: async (args) => JSON.stringify({ ok: true, value: args?.value ?? 0 }) })`,
      ].join("\n"),
    )
  }
}

async function loadAll() {
  const host = createHost(registries())
  const instances = Array.from({ length: COUNT }, (_, index) => discovered(index, false))
  const perPlugin: number[] = []
  const start = performance.now()
  for (const instance of instances) {
    const plugin = createDiscoveredPlugin({
      instance,
      runtime: { registries: host.registries, log, secrets: createSecretStore(path.join(secrets, instance.id)) },
    })
    const pluginStart = performance.now()
    await host.load(plugin)
    perPlugin.push(performance.now() - pluginStart)
  }
  return { host, activation: performance.now() - start, perPlugin }
}

try {
  await Promise.all([config, home, directory, cache, secrets].map((dir) => fs.mkdir(dir, { recursive: true })))
  await createFixtures(false)

  const discoveryCold: number[] = []
  const discoveryWarm: number[] = []
  const activationCold: number[] = []
  const activationWarm: number[] = []
  const singleActivation: number[] = []

  for (let run = 0; run < RUNS; run++) {
    PluginHost.clearIndexCache()
    const discoveryStart = performance.now()
    const found = await PluginHost.inspect(input)
    discoveryCold.push(performance.now() - discoveryStart)
    if (found.instances.filter((item) => item.adapter === "v2" && item.status === "installed").length !== COUNT) {
      throw new Error(`expected ${COUNT} plugins, got ${found.instances.length}`)
    }
    const cold = await loadAll()
    activationCold.push(cold.activation)
    singleActivation.push(...cold.perPlugin)
    cold.host.dispose()

    const warmDiscoveryStart = performance.now()
    const again = await PluginHost.inspect(input)
    discoveryWarm.push(performance.now() - warmDiscoveryStart)
    if (again.instances.length !== COUNT) throw new Error(`warm discovery lost plugins: ${again.instances.length}`)
    const warm = await loadAll()
    activationWarm.push(warm.activation)
    warm.host.dispose()
  }

  // 首次 onTool：全部 load 后 entry 仍未导入，第一次调用才导入。
  // 每轮用独立项目目录，保证模块导入是新的一次（同路径会被 ESM 缓存，测不到冷导入成本）。
  const firstOnTool: number[] = []
  let lazyVerified = true
  for (let run = 0; run < RUNS; run++) {
    const lazyProject = path.join(root, `lazy-project-${run}`)
    await createFixtures(true, lazyProject)
    const host = createHost(registries())
    const globals = globalThis as { __novawayPerfImports?: number }
    globals.__novawayPerfImports = 0
    const instances = Array.from({ length: COUNT }, (_, index) => discovered(index, true, lazyProject))
    for (const instance of instances) {
      const plugin = createDiscoveredPlugin({
        instance,
        runtime: {
          registries: host.registries,
          log,
          secrets: createSecretStore(path.join(secrets, `lazy-${run}-${instance.id}`)),
        },
      })
      await host.load(plugin)
    }
    const before = globals.__novawayPerfImports ?? 0
    const entry = host.registries.tools.list()[0]
    if (!entry) throw new Error("lazy plugin did not expose its static tool declaration")
    const start = performance.now()
    const execution = { abort: new AbortController().signal } as Parameters<typeof entry.item.execute>[1]
    await entry.item.execute({ value: 1 }, execution)
    firstOnTool.push(performance.now() - start)
    if (before !== 0 || globals.__novawayPerfImports !== 1) lazyVerified = false
    host.dispose()
  }

  const interceptors = createInterceptorRuntime()
  for (let index = 0; index < INTERCEPTORS; index++) {
    interceptors.register(
      { pluginID: `perf-${index}`, scope: "project" },
      { id: "chat", hook: "chat.params", handler: () => undefined },
    )
  }
  const interceptorSamples: number[] = []
  for (let sample = 0; sample < 10; sample++) {
    const start = performance.now()
    for (let turn = 0; turn < TURNS; turn++) await interceptors.trigger("chat.params", {}, {})
    interceptorSamples.push((performance.now() - start) / TURNS)
  }

  const memoryHost = createHost(registries())
  const cycleInstance = discovered(0, false)
  const cyclePlugin = createDiscoveredPlugin({
    instance: cycleInstance,
    runtime: { registries: memoryHost.registries, log, secrets: createSecretStore(path.join(secrets, "cycle")) },
  })
  Bun.gc(true)
  const heapBefore = process.memoryUsage().heapUsed
  for (let cycle = 0; cycle < CYCLES; cycle++) {
    await memoryHost.activate(cyclePlugin)
    memoryHost.deactivate(cyclePlugin.id, "project")
  }
  Bun.gc(true)
  const heapGrowth = process.memoryUsage().heapUsed - heapBefore
  memoryHost.dispose()

  const report = {
    machine: {
      platform: `${process.platform} ${process.arch}`,
      cpu: os.cpus()[0]?.model ?? "unknown",
      cores: os.cpus().length,
      memoryGB: round(os.totalmem() / 1_073_741_824),
      bun: Bun.version,
      node: process.version,
    },
    boundary: {
      startup: "PluginHost.inspect + createDiscoveredPlugin/host.load (InstanceBootstrap plugin phase)",
      discoveryCold: "PluginHost.clearIndexCache() then PluginHost.inspect",
      discoveryWarm: "PluginHost.inspect with warm manifest index cache",
      activation: "serial host.load over all enabled plugins",
      firstOnTool: "lazy tool entry import + factory + first execute (after all 20 loaded)",
      interceptor: "10 chat.params interceptors, 1000 triggers per sample",
      heap: `${CYCLES} activate/deactivate cycles, Bun.gc(true) before/after`,
    },
    plugins: COUNT,
    runs: RUNS,
    discovery: {
      coldMedian: round(median(discoveryCold)),
      coldMax: round(Math.max(...discoveryCold)),
      warmMedian: round(median(discoveryWarm)),
      warmMax: round(Math.max(...discoveryWarm)),
    },
    activation: {
      coldMedian: round(median(activationCold)),
      coldMax: round(Math.max(...activationCold)),
      warmMedian: round(median(activationWarm)),
      singleMedian: round(median(singleActivation)),
      singleP95: round(percentile(singleActivation, 0.95)),
      singleSamples: singleActivation.length,
    },
    firstOnTool: { median: round(median(firstOnTool)), p95: round(percentile(firstOnTool, 0.95)), lazyVerified },
    interceptor: { medianPerTurn: round(median(interceptorSamples)) },
    heap: { growthMB: round(heapGrowth / 1_048_576) },
  }

  console.log(JSON.stringify(report, null, 2))

  const checks: Array<[string, boolean, string]> = [
    [
      `20 plugins manifest parse cold < ${BUDGET.discoveryCold}ms`,
      report.discovery.coldMedian < BUDGET.discoveryCold,
      `${report.discovery.coldMedian}ms`,
    ],
    [
      `20 plugins manifest parse warm < ${BUDGET.discoveryWarm}ms`,
      report.discovery.warmMedian < BUDGET.discoveryWarm,
      `${report.discovery.warmMedian}ms`,
    ],
    [
      `20 plugins all onStartup activation < ${BUDGET.activationAll}ms`,
      report.activation.coldMedian < BUDGET.activationAll,
      `${report.activation.coldMedian}ms`,
    ],
    [
      `single plugin activation P95 < ${BUDGET.activationSingleP95}ms`,
      report.activation.singleP95 < BUDGET.activationSingleP95,
      `${report.activation.singleP95}ms`,
    ],
    [
      `first onTool activation + call < ${BUDGET.firstOnTool}ms`,
      report.firstOnTool.p95 < BUDGET.firstOnTool && lazyVerified,
      `${report.firstOnTool.p95}ms (lazyVerified=${lazyVerified})`,
    ],
    [
      `per-turn interceptors < ${BUDGET.interceptorTurn}ms`,
      report.interceptor.medianPerTurn < BUDGET.interceptorTurn,
      `${report.interceptor.medianPerTurn}ms`,
    ],
    [
      `50 activate/deactivate heap growth < ${BUDGET.heapGrowth / 1_048_576}MB`,
      heapGrowth < BUDGET.heapGrowth,
      `${report.heap.growthMB}MB`,
    ],
  ]
  let failed = false
  for (const [name, ok, detail] of checks) {
    console.log(`${ok ? "PASS" : "FAIL"} ${name}: ${detail}`)
    if (!ok) failed = true
  }
  process.exitCode = failed ? 1 : 0
} finally {
  PluginHost.clearIndexCache()
  await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => {})
}
