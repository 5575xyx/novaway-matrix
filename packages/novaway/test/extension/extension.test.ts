import { describe, expect } from "bun:test"
import path from "node:path"
import fs from "node:fs/promises"
import { Effect, Layer } from "effect"
import { Service as ExtensionService, defaultLayer as ExtensionLayer } from "@/extension/registry"
import { TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.mergeAll(ExtensionLayer))

async function write(file: string, content: string) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await Bun.write(file, content)
}

function manifest(root: string, body: Record<string, unknown>) {
  return write(path.join(root, ".novaway", "extensions", "demo", "plugin.json"), JSON.stringify(body))
}

describe("extension", () => {
  it.instance("loads a plugin.json manifest and lists contributions", () =>
    Effect.gen(function* () {
      const dir = (yield* TestInstance).directory
      yield* Effect.promise(() =>
        manifest(dir, {
          name: "demo",
          version: "1.0.0",
          description: "demo extension",
          contributes: {
            commands: "./commands",
            agents: "./agents",
            skills: "./skills",
            mcpServers: { echo: { type: "local", command: ["echo"] } },
          },
        }),
      )
      const extensions = yield* ExtensionService
      const list = yield* extensions.reload()
      const demo = list.find((item) => item.name === "demo")
      expect(demo?.error).toBeUndefined()
      expect(demo?.manifest.version).toBe("1.0.0")
      expect(demo?.enabled).toBe(true)

      const contributions = yield* extensions.contributions()
      const kinds = contributions.filter((item) => item.extension === "demo").map((item) => item.kind)
      expect(kinds).toContain("command")
      expect(kinds).toContain("agent")
      expect(kinds).toContain("skill")
      expect(kinds).toContain("mcp")
    }),
  )

  it.instance("toggle disables contributions without deleting files", () =>
    Effect.gen(function* () {
      const dir = (yield* TestInstance).directory
      yield* Effect.promise(() => manifest(dir, { name: "demo", skills: "./skills" }))
      const extensions = yield* ExtensionService
      yield* extensions.reload()

      yield* extensions.setEnabled("demo", false)
      const disabled = yield* extensions.list()
      expect(disabled.find((item) => item.name === "demo")?.enabled).toBe(false)
      const contributions = yield* extensions.contributions()
      expect(contributions.filter((item) => item.extension === "demo")).toEqual([])

      yield* extensions.setEnabled("demo", true)
      const enabled = yield* extensions.list()
      expect(enabled.find((item) => item.name === "demo")?.enabled).toBe(true)
    }),
  )

  it.instance("discovers desktop marketplace installs", () =>
    Effect.gen(function* () {
      const dir = (yield* TestInstance).directory
      // Desktop writes marketplace packages under <config>/marketplace/<name>@<ref>.
      const config = process.env.XDG_CONFIG_HOME ?? ""
      yield* Effect.promise(() =>
        write(
          path.join(config, "novaway", "marketplace", "demo@main", ".claude-plugin", "plugin.json"),
          JSON.stringify({ name: "demo-market", version: "0.3.0", skills: "./skills" }),
        ),
      )
      const extensions = yield* ExtensionService
      const list = yield* extensions.reload()
      const found = list.find((item) => item.name === "demo-market")
      expect(found?.source).toBe("plugin")
      expect(found?.manifest.version).toBe("0.3.0")
    }),
  )

  it.instance("legacy installs without a manifest contribute their conventional dirs", () =>
    Effect.gen(function* () {
      const dir = (yield* TestInstance).directory
      const config = process.env.XDG_CONFIG_HOME ?? ""
      // Desktop installs used to write the package tree with no plugin.json.
      yield* Effect.promise(() =>
        write(path.join(config, "novaway", "marketplace", "legacy@0.1.0", "skills", "demo", "SKILL.md"), "# demo"),
      )
      const extensions = yield* ExtensionService
      yield* extensions.reload()
      const contributions = yield* extensions.contributions()
      // Marketplace directories are named `<name>@<version>`, and without a
      // manifest the directory name becomes the extension name.
      const found = contributions.filter((item) => item.extension === "legacy@0.1.0")
      expect(found.map((item) => item.kind)).toContain("skill")
      // Conventional paths must not produce validation warnings.
      const issues = yield* extensions.issues()
      expect(issues["legacy@0.1.0"] ?? []).toEqual([])
    }),
  )

  it.instance("discovers Claude plugin directories", () =>
    Effect.gen(function* () {
      const dir = (yield* TestInstance).directory
      yield* Effect.promise(() =>
        write(
          path.join(dir, ".claude", "plugins", "claude-demo", ".claude-plugin", "plugin.json"),
          JSON.stringify({ name: "claude-demo", commands: "./commands" }),
        ),
      )
      const extensions = yield* ExtensionService
      const list = yield* extensions.reload()
      const found = list.find((item) => item.name === "claude-demo")
      expect(found?.source).toBe("claude")
      const contributions = yield* extensions.contributions()
      expect(contributions.some((item) => item.extension === "claude-demo" && item.kind === "command")).toBe(true)
    }),
  )
})
