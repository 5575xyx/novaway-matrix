import { expect, test } from "bun:test"
import path from "node:path"
import { mkdirSync, writeFileSync } from "node:fs"
import { NodeFileSystem } from "@effect/platform-node"
import { AppProcess } from "@opencode-ai/core/process"
import { Effect, Layer } from "effect"
import { testEffect } from "../lib/effect"
import { TestInstance } from "../fixture/fixture"
import { assertReleaseUrlsReady } from "../../src/config/powersnexus"
import {
  buildLocalStableRelease,
  createLocalReadRemote,
  localAllowedHosts,
} from "../../src/powersnexus/stable-local"
import { checkForUpdate, installCheckedUpdate } from "../../src/powersnexus/update-service"
import { make } from "../../src/powersnexus/version-store"

const it = testEffect(Layer.mergeAll(NodeFileSystem.layer, AppProcess.defaultLayer))

function bundledRef(directory: string) {
  return {
    version: "6.1.0",
    protocolVersion: "1.0",
    digest: "a".repeat(64),
    source: "bundled" as const,
    compatible: true,
    verified: true,
    cliPath: path.join(directory, "bundled", "src", "cli", "powersnexus-cli.js"),
  }
}

it.instance("本地签名 stable：主源断网后镜像成功，安装→激活→回滚闭环", () =>
  Effect.gen(function* () {
    const tmp = yield* TestInstance
    const bundle = yield* Effect.promise(() => buildLocalStableRelease({ version: "6.2.0" }))
    const readRemote = createLocalReadRemote(bundle, { primaryDown: true })
    const hosts = localAllowedHosts(bundle)

    const checked = yield* checkForUpdate({
      manifestUrls: [bundle.urls.primaryManifest, bundle.urls.mirrorManifest],
      allowedHosts: hosts,
      trustedKeys: { [bundle.keyID]: bundle.publicKeyPem },
      novaWayVersion: "1.15.4",
      readRemote,
    })
    expect(checked.sourceUrl).toBe(bundle.urls.mirrorManifest)
    expect(checked.manifest.version).toBe("6.2.0")
    expect(checked.failures).toHaveLength(1)

    const root = path.join(tmp.directory, "powersnexus")
    const bundled = bundledRef(tmp.directory)
    const store = yield* make({ root, bundled, hasActiveRuns: Effect.succeed(false) })
    const installed = yield* installCheckedUpdate({
      checked,
      allowedHosts: hosts,
      root,
      readRemote,
      versionStore: store,
    })
    expect(installed.digest).toBe(bundle.manifest.artifactSha256)
    expect(installed.verified).toBe(true)

    const activated = yield* store.activate({
      requestID: "local-stable-activate-1",
      targetDigest: installed.digest,
      expectedActiveDigest: bundled.digest,
    })
    expect(activated.status).toBe("activated")
    expect((yield* store.status()).active.digest).toBe(installed.digest)

    const rolled = yield* store.rollback({
      requestID: "local-stable-rollback-1",
      expectedActiveDigest: installed.digest,
    })
    expect(rolled.status).toBe("rolled-back")
    expect((yield* store.status()).active.digest).toBe(bundled.digest)

    // 导出本机联调目录，便于人工检查
    const exportRoot = process.env.POWERSNEXUS_STABLE_LOCAL_ROOT
    if (exportRoot) {
      mkdirSync(path.join(exportRoot, "stable"), { recursive: true })
      mkdirSync(path.join(exportRoot, "artifacts"), { recursive: true })
      mkdirSync(path.join(exportRoot, "keys"), { recursive: true })
      writeFileSync(path.join(exportRoot, "stable", "manifest.json"), Buffer.from(bundle.manifestBytes))
      writeFileSync(path.join(exportRoot, "artifacts", `powersnexus-${bundle.version}.zip`), bundle.artifact)
      writeFileSync(path.join(exportRoot, "keys", "public.pem"), bundle.publicKeyPem)
      writeFileSync(
        path.join(exportRoot, "README.local.txt"),
        [
          "本目录由 stable-local harness 生成，仅用于本机联调。",
          "生产环境必须使用独立保管的签名私钥与 HTTPS 发布端点。",
          `version=${bundle.version}`,
          `digest=${bundle.manifest.artifactSha256}`,
          `keyID=${bundle.keyID}`,
          `mirror=${bundle.urls.mirrorManifest}`,
          `artifact=${bundle.urls.artifact}`,
          "",
        ].join("\n"),
      )
    }
  }),
)

it.instance("本地签名 stable：活动工作流时激活 deferred，结束后可继续", () =>
  Effect.gen(function* () {
    const tmp = yield* TestInstance
    const bundle = yield* Effect.promise(() => buildLocalStableRelease({ version: "6.2.1" }))
    const readRemote = createLocalReadRemote(bundle, { primaryDown: false })
    const hosts = localAllowedHosts(bundle)
    const checked = yield* checkForUpdate({
      manifestUrls: [bundle.urls.primaryManifest],
      allowedHosts: hosts,
      trustedKeys: { [bundle.keyID]: bundle.publicKeyPem },
      novaWayVersion: "1.15.4",
      readRemote,
    })
    const root = path.join(tmp.directory, "powersnexus")
    const bundled = bundledRef(tmp.directory)
    let busy = true
    const store = yield* make({ root, bundled, hasActiveRuns: Effect.sync(() => busy) })
    const installed = yield* installCheckedUpdate({
      checked,
      allowedHosts: hosts,
      root,
      readRemote,
      versionStore: store,
    })
    const deferred = yield* store.activate({
      requestID: "local-stable-deferred-1",
      targetDigest: installed.digest,
      expectedActiveDigest: bundled.digest,
    })
    expect(deferred.status).toBe("deferred")
    expect((yield* store.status()).active.digest).toBe(bundled.digest)
    busy = false
    const later = yield* store.activateDeferred()
    expect(later?.status).toBe("activated")
    expect((yield* store.status()).active.digest).toBe(installed.digest)
  }),
)

test("稳定策略仍拒绝占位 URL；空 URL 不得伪装成已配置 stable", () => {
  expect(() =>
    assertReleaseUrlsReady({
      policy: "stable",
      releaseManifestUrls: ["https://<gitee-release-endpoint>/stable/manifest.json"],
    }),
  ).toThrow("占位")
  expect(() =>
    assertReleaseUrlsReady({
      policy: "stable",
      releaseManifestUrls: [],
    }),
  ).toThrow("bundled")
  expect(() =>
    assertReleaseUrlsReady({
      policy: "stable",
      releaseManifestUrls: ["https://cdn.novaway.ai/powersnexus/stable/manifest.json"],
    }),
  ).not.toThrow()
})
