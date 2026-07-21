#!/usr/bin/env bun
import { randomUUID } from "node:crypto"
import { readFileSync, rmSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { NodeFileSystem } from "@effect/platform-node"
import { AppProcess } from "@opencode-ai/core/process"
import { Effect, Layer } from "effect"
import packageJson from "../package.json"
import { parseReleaseList } from "../src/config/powersnexus"
import { checkForUpdate, installCheckedUpdate, type ReadRemote } from "../src/powersnexus/update-service"
import { make } from "../src/powersnexus/version-store"

const manifestUrls = parseReleaseList(process.env.POWERSNEXUS_RELEASE_MANIFEST_URLS)
const allowedHosts = parseReleaseList(process.env.POWERSNEXUS_RELEASE_ALLOWED_HOSTS)
const publicKeyPath = process.env.POWERSNEXUS_RELEASE_PUBLIC_KEY
const keyID = process.env.POWERSNEXUS_RELEASE_KEY_ID ?? "powersnexus-release-2026-01"
const novaWayVersion = process.env.POWERSNEXUS_NOVAWAY_VERSION ?? packageJson.version

if (!manifestUrls.length) throw new Error("未配置 POWERSNEXUS_RELEASE_MANIFEST_URLS")
if (!allowedHosts.length) throw new Error("未配置 POWERSNEXUS_RELEASE_ALLOWED_HOSTS")
if (!publicKeyPath) throw new Error("未配置 POWERSNEXUS_RELEASE_PUBLIC_KEY")

const publicKey = readFileSync(publicKeyPath, "utf8")
const root = path.join(os.tmpdir(), `powersnexus-stable-online-${randomUUID()}`)

const readRemote: ReadRemote = (url, maxBytes) =>
  Effect.tryPromise({
    try: async () => {
      const response = await fetch(url, { redirect: "follow" })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const body = new Uint8Array(await response.arrayBuffer())
      if (body.length > maxBytes) throw new Error(`远程响应超过 ${maxBytes} 字节上限`)
      return { body, finalUrl: response.url }
    },
    catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
  })

const program = Effect.gen(function* () {
  const bundled = {
    version: "6.1.0",
    protocolVersion: "1.0",
    digest: "a".repeat(64),
    source: "bundled" as const,
    compatible: true,
    verified: true,
    cliPath: path.join(root, "bundled", "src", "cli", "powersnexus-cli.js"),
  }
  const checked = yield* checkForUpdate({
    manifestUrls,
    allowedHosts,
    trustedKeys: { [keyID]: publicKey },
    novaWayVersion,
    readRemote,
  })
  const store = yield* make({ root, bundled, hasActiveRuns: Effect.succeed(false) })
  const installed = yield* installCheckedUpdate({
    checked,
    allowedHosts,
    root,
    readRemote,
    versionStore: store,
  })
  const activated = yield* store.activate({
    requestID: `online-activate-${randomUUID()}`,
    targetDigest: installed.digest,
    expectedActiveDigest: bundled.digest,
  })
  const rolledBack = yield* store.rollback({
    requestID: `online-rollback-${randomUUID()}`,
    expectedActiveDigest: installed.digest,
  })
  return {
    manifestUrl: checked.sourceUrl,
    version: checked.manifest.version,
    keyID: checked.manifest.keyID,
    artifactUrl: checked.manifest.artifactUrl,
    artifactSha256: checked.manifest.artifactSha256,
    installed: installed.verified,
    activated: activated.status,
    rolledBack: rolledBack.status,
  }
})

try {
  const result = await Effect.runPromise(
    program.pipe(Effect.provide(Layer.mergeAll(NodeFileSystem.layer, AppProcess.defaultLayer))),
  )
  console.log(JSON.stringify({ passed: true, ...result }, null, 2))
} finally {
  const resolvedRoot = path.resolve(root)
  const temporaryRoot = path.resolve(os.tmpdir())
  if (resolvedRoot.startsWith(temporaryRoot + path.sep)) {
    rmSync(resolvedRoot, { recursive: true, force: true })
  }
}