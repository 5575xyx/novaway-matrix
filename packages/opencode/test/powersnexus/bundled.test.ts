import { expect } from "bun:test"
import path from "node:path"
import { NodeFileSystem } from "@effect/platform-node"
import { AppProcess } from "@opencode-ai/core/process"
import { Effect, Layer } from "effect"
import { testEffect } from "../lib/effect"
import { TestInstance } from "../fixture/fixture"
import { loadBundled } from "../../src/powersnexus/bundled"

const it = testEffect(Layer.mergeAll(NodeFileSystem.layer, AppProcess.defaultLayer))
const resources = path.resolve(import.meta.dir, "../../../desktop/resources")

it.instance("从签名 ZIP 离线注册 6.1.0 基线并通过真实 doctor 自检", () =>
  Effect.gen(function* () {
    const tmp = yield* TestInstance
    const loaded = yield* loadBundled({
      resourceRoot: path.join(resources, "powersnexus-baselines"),
      publicKeyPath: path.join(resources, "powersnexus-release-public-key.pem"),
      dataRoot: path.join(tmp.directory, "data"),
      novaWayVersion: "1.15.4",
    })

    expect(loaded.version).toBe("6.1.0")
    expect(loaded.protocolVersion).toBe("1.0")
    expect(loaded.digest).toBe("4c1915d9506492b71a7026c013849e32223201e2aeba121c0aadaeffae72afd2")
    expect(loaded.source).toBe("bundled")
    expect(loaded.compatible).toBe(true)
    expect(loaded.verified).toBe(true)
    expect(path.isAbsolute(loaded.cliPath)).toBe(true)
  }),
)
