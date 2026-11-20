#!/usr/bin/env bun
/**
 * SU-T1：Surface/Previewer 改造前后的生产 HTTP 行为基线。
 *
 * 每次运行都使用临时 XDG 根目录、临时项目和随机监听端口；不触碰既有服务。
 * 输出是稳定 JSON：移除绝对路径、时间戳、generation 与诊断时间后排序。
 */
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

const root = await fs.mkdtemp(path.join(os.tmpdir(), "novaway-surface-baseline-"))
const xdg = {
  config: path.join(root, "config"),
  data: path.join(root, "data"),
  state: path.join(root, "state"),
  cache: path.join(root, "cache"),
}
const projectEmpty = path.join(root, "project-empty")
const projectPlugin = path.join(root, "project-plugin")
const builtin = path.resolve(import.meta.dir, "../builtin-plugins")
await Promise.all(
  [...Object.values(xdg), projectEmpty, projectPlugin].map((item) => fs.mkdir(item, { recursive: true })),
)
process.env.XDG_CONFIG_HOME = xdg.config
process.env.XDG_DATA_HOME = xdg.data
process.env.XDG_STATE_HOME = xdg.state
process.env.XDG_CACHE_HOME = xdg.cache
process.env.NOVAWAY_DB = path.join(root, "novaway.db")
process.env.NOVAWAY_BUILTIN_PLUGINS = builtin
process.env.NOVAWAY_DISABLE_AUTOPROVISION = "1"
process.env.NOVAWAY_DISABLE_DEFAULT_PLUGINS = "1"
process.env.NOVAWAY_DISABLE_SHARE = "true"
process.env.NOVAWAY_PURE = "1"

const thirdParty = path.join(projectPlugin, ".novaway", "extensions", "surface-baseline")
await fs.mkdir(thirdParty, { recursive: true })
await fs.writeFile(
  path.join(thirdParty, "plugin.json"),
  JSON.stringify(
    {
      name: "surface-baseline",
      version: "1.0.0",
      apiVersion: 2,
      kind: "declarative",
      contributes: {
        tools: [
          {
            id: "probe",
            entry: "./probe.mjs",
            description: "baseline probe",
            parameters: { type: "object", properties: {} },
          },
        ],
        surfaces: [
          {
            slot: "sidebar.item",
            id: "baseline",
            title: "Surface Baseline",
            icon: "dot-grid",
            action: { type: "url", url: "https://example.test/surface-baseline" },
          },
        ],
      },
    },
    null,
    2,
  ),
)
await fs.writeFile(path.join(thirdParty, "probe.mjs"), "export default () => ({ execute: async () => 'ok' })\n")

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable)
  if (typeof value === "string") {
    return value
      .replaceAll(root, "<temp-root>")
      .replaceAll(projectEmpty, "<project-empty>")
      .replaceAll(projectPlugin, "<project-plugin>")
  }
  if (!value || typeof value !== "object") return value
  const record = value as Record<string, unknown>
  return Object.fromEntries(
    Object.entries(record)
      .filter(([key]) => !["generation", "at", "installedAt", "activatedAt"].includes(key))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => [key, stable(item)]),
  )
}

async function request(listener: { url: URL }, directory: string, route: string, init: RequestInit = {}) {
  const response = await fetch(new URL(route, listener.url), {
    ...init,
    headers: { "x-novaway-directory": directory, ...(init.headers ?? {}) },
  })
  const text = await response.text()
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    body = text
  }
  return { status: response.status, body: stable(body) }
}

try {
  const Log = await import("@novaway/core/util/log")
  await Log.init({ print: false })
  const { Server } = await import("../src/server/server")
  const listener = await Server.listen({ hostname: "127.0.0.1", port: 0 })
  try {
    const baseline = {
      schema: 1,
      machine: { platform: process.platform, arch: process.arch, bun: Bun.version },
      cases: {
        emptyProject: await request(listener, projectEmpty, "/plugin/contributions"),
        builtinBundle: await request(listener, projectEmpty, "/plugin/contributions?kind=surface"),
        projectPlugin: await request(listener, projectPlugin, "/plugin"),
        projectContributions: await request(listener, projectPlugin, "/plugin/contributions?kind=surface"),
        projectDiagnostics: await request(listener, projectPlugin, "/plugin/diagnostics"),
        projectSurfaceToggle: await request(listener, projectPlugin, "/plugin/surface-baseline", {
          method: "PATCH",
          body: JSON.stringify({ enabled: true, scope: "project" }),
          headers: { "content-type": "application/json" },
        }),
      },
    }
    console.log(JSON.stringify(baseline, null, 2))
  } finally {
    await listener.stop(true)
  }
} finally {
  await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(() => {})
}
