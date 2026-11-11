#!/usr/bin/env bun
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { PluginHost } from "../src/plugin/host"
import { createAgentRegistry, createCommandRegistry, createSkillRegistry, createToolRegistry } from "../src/plugin/contributions"
import type { Manifest } from "@novaway/plugin-api"
import { createHost, type Plugin } from "../src/plugin/runtime/host"
import { createInterceptorRuntime } from "../src/plugin/runtime/hooks"

const root = await fs.mkdtemp(path.join(os.tmpdir(), "novaway-plugin-index-"))
const config = path.join(root, "config")
const home = path.join(root, "home")
const directory = path.join(root, "project")
const cache = path.join(root, "cache")
const input = { config, home, directory, worktree: directory, builtin: "", cache, env: {}, meta: {} }

try {
  await Promise.all([config, home, directory, cache].map((dir) => fs.mkdir(dir, { recursive: true })))
  for (let index = 0; index < 20; index++) {
    const name = `bench-${index}`
    const dir = path.join(config, "extensions", name)
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(
      path.join(dir, "plugin.json"),
      JSON.stringify({
        name,
        apiVersion: 2,
        kind: "declarative",
        contributes: { tools: [{ id: "tool", description: "benchmark", parameters: { type: "object" } }] },
      }),
    )
  }

  const median = (times: number[]) => times.sort((a, b) => a - b)[Math.floor(times.length / 2)]!
  const measure = async (runs: number, cold: boolean) => {
    const times: number[] = []
    for (let run = 0; run < runs; run++) {
      if (cold) PluginHost.clearIndexCache()
      const start = performance.now()
      const found = await PluginHost.discover(input)
      const elapsed = performance.now() - start
      if (found.length !== 20) throw new Error(`expected 20 plugins, got ${found.length}`)
      times.push(elapsed)
    }
    return median(times)
  }

  const startup = async (cold: boolean) => {
    if (cold) PluginHost.clearIndexCache()
    const totalStart = performance.now()
    const discoveryStart = performance.now()
    const found = await PluginHost.discover(input)
    const discoveryMs = performance.now() - discoveryStart
    if (found.length !== 20) throw new Error(`expected 20 plugins, got ${found.length}`)

    const host = createHost({
      tools: createToolRegistry(),
      agents: createAgentRegistry(),
      skills: createSkillRegistry(),
      commands: createCommandRegistry(),
      interceptors: createInterceptorRuntime(),
    })
    const plugins: Plugin[] = found.map((_, index) => ({
      id: `bench-${index}`,
      scope: "project" as const,
      root: path.join(config, "extensions", `bench-${index}`),
      manifest: {
        name: `bench-${index}`,
        apiVersion: 2,
        contributes: {
          tools: [{ id: "tool", description: "benchmark", parameters: { type: "object" } }],
        },
      } satisfies Manifest,
      async activate({ registries }) {
        registries.tools.register(
          { pluginID: `bench-${index}`, scope: "project" },
          {
            id: "tool",
            description: "benchmark",
            parameters: { type: "object" },
            execute: async () => "ok",
          },
        )
      },
    }))
    const activationStart = performance.now()
    await Promise.all(plugins.map((plugin) => host.activate(plugin)))
    const activationMs = performance.now() - activationStart
    const totalMs = performance.now() - totalStart
    host.dispose()
    if (host.registries.tools.list().length !== 0) throw new Error("Host dispose left registered tools behind")
    return { discoveryMs, activationMs, totalMs }
  }

  const cold = await measure(9, true)
  const warm = await measure(9, false)
  const coldStartup: Array<{ discoveryMs: number; activationMs: number; totalMs: number }> = []
  const warmStartup: Array<{ discoveryMs: number; activationMs: number; totalMs: number }> = []
  for (let run = 0; run < 9; run++) coldStartup.push(await startup(true))
  for (let run = 0; run < 9; run++) warmStartup.push(await startup(false))
  const summarize = (samples: Array<{ discoveryMs: number; activationMs: number; totalMs: number }>) => ({
    discovery: median(samples.map((sample) => sample.discoveryMs)),
    activation: median(samples.map((sample) => sample.activationMs)),
    total: median(samples.map((sample) => sample.totalMs)),
  })
  const coldResult = summarize(coldStartup)
  const warmResult = summarize(warmStartup)

  const interceptors = createInterceptorRuntime()
  for (let index = 0; index < 20; index++) {
    interceptors.register({ pluginID: `bench-${index}`, scope: "project" }, {
      id: "chat",
      hook: "chat.message",
      handler: () => undefined,
    })
  }
  const interceptorSamples: number[] = []
  for (let run = 0; run < 9; run++) {
    const start = performance.now()
    for (let turn = 0; turn < 100; turn++) await interceptors.trigger("chat.message", {}, {})
    interceptorSamples.push((performance.now() - start) / 100)
  }
  const interceptorMs = median(interceptorSamples)

  console.log(`20 plugins median discover: cold=${cold.toFixed(2)}ms warm=${warm.toFixed(2)}ms`)
  console.log(
    `20 plugins median startup (discovery + RuntimeHost activation): cold=${coldResult.total.toFixed(2)}ms ` +
      `[discover=${coldResult.discovery.toFixed(2)}ms activate=${coldResult.activation.toFixed(2)}ms], ` +
      `warm=${warmResult.total.toFixed(2)}ms [discover=${warmResult.discovery.toFixed(2)}ms ` +
      `activate=${warmResult.activation.toFixed(2)}ms]`,
  )
  console.log(`20 no-op interceptors median per turn: ${interceptorMs.toFixed(3)}ms`)
  if (cold >= 120 || warm >= 30 || coldResult.total >= 400 || interceptorMs >= 15) process.exitCode = 1
} finally {
  PluginHost.clearIndexCache()
  await fs.rm(root, { recursive: true, force: true })
}
