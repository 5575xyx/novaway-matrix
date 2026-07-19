import { expect } from "bun:test"
import path from "node:path"
import { NodeFileSystem } from "@effect/platform-node"
import { AppProcess } from "@opencode-ai/core/process"
import { Effect, Layer } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { testEffect } from "../lib/effect"
import { loadDeveloper } from "../../src/powersnexus/developer"

const workspacePowersNexus = path.resolve(import.meta.dir, "../../../../PowersNexus")
const it = testEffect(Layer.mergeAll(NodeFileSystem.layer, AppProcess.defaultLayer))

it.live("工作区 PowersNexus 可作为 developer 固定版本并执行 CLI", () =>
  Effect.gen(function* () {
    const loaded = yield* loadDeveloper({
      directory: workspacePowersNexus,
      developerBuild: true,
    })
    expect(loaded.source).toBe("developer")
    expect(loaded.version).toBe("6.1.0")
    expect(loaded.protocolVersion).toMatch(/^1\./)
    expect(loaded.cliPath).toContain("powersnexus-cli.js")
    expect(loaded.digest).toMatch(/^[a-f0-9]{64}$/)

    const app = yield* AppProcess.Service
    const help = yield* app.run(
      ChildProcess.make(process.execPath, [loaded.cliPath, "--help"], {
        cwd: workspacePowersNexus,
        extendEnv: true,
      }),
    )
    expect(help.exitCode).toBe(0)
    expect(help.stdout.toString("utf8").toLowerCase()).toContain("powersnexus")
  }),
)