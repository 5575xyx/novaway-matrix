import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

const configuredRoot = process.env.SURFACE_E2E_ROOT
const root = configuredRoot ?? (await fs.mkdtemp(path.join(os.tmpdir(), "novaway-surface-e2e-")))
const keepRoot = configuredRoot !== undefined
const dirs = ["config", "data", "state", "cache"].map((name) => path.join(root, name))
const project = path.join(root, "project")
const plugin = path.join(project, ".novaway", "extensions", "surface-e2e")
await Promise.all([...dirs, plugin].map((directory) => fs.mkdir(directory, { recursive: true })))
await fs.writeFile(
  path.join(plugin, "plugin.json"),
  JSON.stringify(
    {
      name: "surface-e2e",
      version: "1.0.0",
      apiVersion: 2,
      kind: "declarative",
      priority: 100,
      activationEvents: ["onView:surface-e2e.dashboard"],
      contributes: {
        commands: [{ id: "refresh", description: "Refresh", template: "/refresh" }],
        surfaces: [
          {
            slot: "sidebar.item",
            id: "dashboard",
            title: "Third-party Dashboard",
            icon: "dot-grid",
            action: {
              type: "view",
              viewId: "surface-e2e.dashboard",
              render: { type: "iframe", url: "https://example.test/surface-e2e.html" },
            },
          },
          {
            slot: "session.panel",
            id: "refresh",
            title: "Refresh third-party",
            action: { type: "command", command: "refresh" },
          },
          {
            slot: "settings.section",
            id: "preferences",
            title: "Surface E2E Preferences",
            description: "Settings supplied by the third-party fixture.",
            view: {
              type: "declarative",
              fields: [
                { key: "endpoint", type: "text", label: "Endpoint", placeholder: "https://example.test" },
                { key: "token", type: "secret", label: "Token" },
              ],
            },
          },
          {
            slot: "message.part.renderer",
            id: "tool-result",
            match: { tool: "bash" },
            renderer: { type: "iframe", url: "https://example.test/surface-renderer.html" },
          },
        ],
        previewers: [
          {
            id: "surface",
            match: { extension: ".surface-e2e" },
            render: { type: "iframe", url: "https://example.test/surface-preview.html" },
          },
        ],
        storage: { namespace: "surface-e2e", migrations: "./migrations" },
      },
    },
    null,
    2,
  ),
)
await fs.writeFile(path.join(project, "surface-e2e.surface-e2e"), "surface preview fixture")
process.env.XDG_CONFIG_HOME = dirs[0]
process.env.XDG_DATA_HOME = dirs[1]
process.env.XDG_STATE_HOME = dirs[2]
process.env.XDG_CACHE_HOME = dirs[3]
process.env.NOVAWAY_DB = path.join(root, "novaway.db")
process.env.NOVAWAY_BUILTIN_PLUGINS = path.resolve(import.meta.dir, "../builtin-plugins")
process.env.NOVAWAY_DISABLE_AUTOPROVISION = "1"
process.env.NOVAWAY_DISABLE_DEFAULT_PLUGINS = "1"
process.env.NOVAWAY_DISABLE_SHARE = "true"
process.env.NOVAWAY_PURE = "1"
const { Server } = await import("../src/server/server")
const listener = await Server.listen({ hostname: "127.0.0.1", port: Number(process.env.SURFACE_E2E_PORT ?? 4220) })
console.log(JSON.stringify({ directory: project, url: listener.url.toString() }))
const stop = async () => {
  await listener.stop(true)
  if (!keepRoot) await fs.rm(root, { recursive: true, force: true }).catch(() => {})
  process.exit(0)
}
process.once("SIGINT", stop)
process.once("SIGTERM", stop)
await new Promise(() => {})
