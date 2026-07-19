import { expect } from "bun:test"
import path from "node:path"
import { NodeFileSystem } from "@effect/platform-node"
import { AppProcess } from "@opencode-ai/core/process"
import { Effect, FileSystem, Layer } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { testEffect } from "../lib/effect"
import { TestInstance } from "../fixture/fixture"
import { loadDeveloper } from "../../src/powersnexus/developer"

const it = testEffect(Layer.mergeAll(NodeFileSystem.layer, AppProcess.defaultLayer))

it.instance("仅在开发构建中加载固定且干净的本地 Git 提交", () =>
  Effect.gen(function* () {
    const tmp = yield* TestInstance
    const fs = yield* FileSystem.FileSystem
    const processService = yield* AppProcess.Service
    const root = path.join(tmp.directory, "powersnexus")
    yield* fs.makeDirectory(path.join(root, "src", "cli"), { recursive: true })
    yield* fs.makeDirectory(path.join(root, "schemas"), { recursive: true })
    yield* fs.writeFileString(path.join(root, "package.json"), JSON.stringify({ version: "6.2.0" }))
    yield* fs.writeFileString(path.join(root, "src", "cli", "powersnexus-cli.js"), "process.exit(0)")
    yield* fs.writeFileString(
      path.join(root, "schemas", "protocol-v1.json"),
      JSON.stringify({ properties: { protocolVersion: { const: "1.0" } } }),
    )
    for (const args of [
      ["init"],
      ["config", "user.email", "powersnexus@example.test"],
      ["config", "user.name", "PowersNexus Test"],
      ["add", "."],
      ["commit", "-m", "测试固定提交"],
    ]) {
      const result = yield* processService.run(ChildProcess.make("git", args, { cwd: root, extendEnv: true }))
      expect(result.exitCode).toBe(0)
    }

    const loaded = yield* loadDeveloper({ directory: root, developerBuild: true })
    expect(loaded.source).toBe("developer")
    expect(loaded.version).toBe("6.2.0")
    expect(loaded.protocolVersion).toBe("1.0")
    expect(loaded.digest).toMatch(/^[a-f0-9]{64}$/)

    yield* fs.writeFileString(path.join(root, "package.json"), JSON.stringify({ version: "6.2.1" }))
    expect((yield* Effect.exit(loadDeveloper({ directory: root, developerBuild: true })))._tag).toBe("Failure")
    expect((yield* Effect.exit(loadDeveloper({ directory: root, developerBuild: false })))._tag).toBe("Failure")
  }),
)
