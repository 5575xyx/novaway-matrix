import { expect } from "bun:test"
import path from "node:path"
import { createHash, generateKeyPairSync, sign } from "node:crypto"
import { BlobWriter, TextReader, ZipWriter } from "@zip.js/zip.js"
import { NodeFileSystem } from "@effect/platform-node"
import { AppProcess } from "@opencode-ai/core/process"
import { Effect, Layer } from "effect"
import { testEffect } from "../lib/effect"
import { TestInstance } from "../fixture/fixture"
import { canonicalizeJson, type SignedUpdateManifest } from "../../src/powersnexus/update-manifest"
import {
  checkForUpdate,
  installCheckedUpdate,
  verifyArtifact,
  type ReadRemote,
} from "../../src/powersnexus/update-service"
import { make } from "../../src/powersnexus/version-store"

const it = testEffect(Layer.mergeAll(NodeFileSystem.layer, AppProcess.defaultLayer))

function sha256(content: Uint8Array | string) {
  return createHash("sha256").update(content).digest("hex")
}

async function fixture() {
  const writer = new ZipWriter(new BlobWriter("application/zip"))
  await writer.add("package.json", new TextReader('{"name":"powersnexus-test"}'))
  await writer.add("src/cli/powersnexus-cli.js", new TextReader("process.exit(0)"))
  const artifact = new Uint8Array(await (await writer.close()).arrayBuffer())
  const provisional = {
    schemaVersion: "1",
    version: "6.2.0",
    channel: "stable",
    protocolVersion: "1.0",
    minimumNovaWayVersion: "1.3.0",
    maximumNovaWayVersion: "<2.0.0",
    sourceCommit: "6b8bd9e9519e166f3533d240f81534cfd00a76de",
    artifactUrl: "https://releases.example.test/powersnexus-6.2.0.zip",
    artifactSha256: sha256(artifact),
    filesSha256: "0".repeat(64),
    artifactSize: artifact.length,
    fileCount: 2,
    publishedAt: "2026-07-17T00:00:00.000Z",
    keyID: "powersnexus-test-2026-01",
    signature: "AA==",
  } satisfies SignedUpdateManifest
  const verified = await Effect.runPromise(
    verifyArtifact(artifact, { ...provisional, filesSha256: await fileListDigest(artifact) }),
  )
  const filesSha256 = sha256(verified.map((entry) => `${entry.sha256}  ${entry.path}\n`).join(""))
  const { publicKey, privateKey } = generateKeyPairSync("ed25519")
  const unsigned = { ...provisional, filesSha256 } as Record<string, unknown>
  delete unsigned.signature
  const manifest = {
    ...provisional,
    filesSha256,
    signature: sign(null, Buffer.from(canonicalizeJson(unsigned), "utf8"), privateKey).toString("base64"),
  }
  return {
    artifact,
    manifest,
    manifestBytes: new TextEncoder().encode(JSON.stringify(manifest)),
    publicKey: publicKey.export({ type: "spki", format: "pem" }).toString(),
    privateKey,
  }
}

async function fileListDigest(artifact: Uint8Array) {
  const temporary = {
    schemaVersion: "1",
    version: "6.2.0",
    channel: "stable",
    protocolVersion: "1.0",
    minimumNovaWayVersion: "1.3.0",
    maximumNovaWayVersion: "<2.0.0",
    sourceCommit: "6b8bd9e9519e166f3533d240f81534cfd00a76de",
    artifactUrl: "https://releases.example.test/powersnexus-6.2.0.zip",
    artifactSha256: sha256(artifact),
    filesSha256: "0".repeat(64),
    artifactSize: artifact.length,
    fileCount: 2,
    publishedAt: "2026-07-17T00:00:00.000Z",
    keyID: "powersnexus-test-2026-01",
    signature: "AA==",
  } satisfies SignedUpdateManifest
  const exit = await Effect.runPromiseExit(verifyArtifact(artifact, temporary))
  if (exit._tag === "Success") throw new Error("测试清单不应预先匹配")
  const { BlobReader, ZipReader } = await import("@zip.js/zip.js")
  const reader = new ZipReader(new BlobReader(new Blob([Buffer.from(artifact)])))
  const entries = (await reader.getEntries()).filter((entry) => !entry.directory)
  const lines: string[] = []
  for (const entry of entries.sort((left, right) => left.filename.localeCompare(right.filename, "en"))) {
    const output = new BlobWriter()
    const blob = await entry.getData?.(output)
    lines.push(`${sha256(new Uint8Array(await blob!.arrayBuffer()))}  ${entry.filename}\n`)
  }
  await reader.close()
  return sha256(lines.join(""))
}

it.instance("主源断网后顺序回退镜像，并安装、自检和注册已验证版本", () =>
  Effect.gen(function* () {
    const tmp = yield* TestInstance
    const data = yield* Effect.promise(fixture)
    const calls: string[] = []
    const main = "https://gitee.example.test/stable/manifest.json"
    const mirror = "https://mirror.example.test/stable/manifest.json"
    const readRemote: ReadRemote = (url) => {
      calls.push(url)
      if (url === main) return Effect.fail(new Error("模拟主源断网"))
      if (url === mirror) return Effect.succeed({ body: data.manifestBytes, finalUrl: url })
      return Effect.succeed({ body: data.artifact, finalUrl: url })
    }
    const checked = yield* checkForUpdate({
      manifestUrls: [main, mirror],
      allowedHosts: ["gitee.example.test", "mirror.example.test", "releases.example.test"],
      trustedKeys: { [data.manifest.keyID]: data.publicKey },
      novaWayVersion: "1.15.4",
      readRemote,
    })
    expect(checked.sourceUrl).toBe(mirror)
    expect(checked.failures).toHaveLength(1)

    const root = path.join(tmp.directory, "powersnexus")
    const bundled = {
      version: "6.1.0",
      protocolVersion: "1.0",
      digest: "a".repeat(64),
      source: "bundled",
      compatible: true,
      verified: true,
      cliPath: path.join(tmp.directory, "bundled", "src", "cli", "powersnexus-cli.js"),
    } as const
    const store = yield* make({ root, bundled, hasActiveRuns: Effect.succeed(false) })
    const installed = yield* installCheckedUpdate({
      checked,
      allowedHosts: ["releases.example.test"],
      root,
      readRemote,
      versionStore: store,
    })

    expect(installed.digest).toBe(data.manifest.artifactSha256)
    expect(installed.verified).toBe(true)
    expect((yield* store.status()).installed.some((item) => item.digest === installed.digest)).toBe(true)
    expect(calls).toEqual([main, mirror, data.manifest.artifactUrl])
  }),
)

it.instance("拒绝非白名单源，全部源失败时保持 active 和 bundled 不变", () =>
  Effect.gen(function* () {
    const tmp = yield* TestInstance
    const calls: string[] = []
    const readRemote: ReadRemote = (url) => {
      calls.push(url)
      return Effect.fail(new Error("模拟断网"))
    }
    const bundled = {
      version: "6.1.0",
      protocolVersion: "1.0",
      digest: "a".repeat(64),
      source: "bundled",
      compatible: true,
      verified: true,
      cliPath: path.join(tmp.directory, "bundled", "src", "cli", "powersnexus-cli.js"),
    } as const
    const store = yield* make({
      root: path.join(tmp.directory, "powersnexus"),
      bundled,
      hasActiveRuns: Effect.succeed(false),
    })
    const exit = yield* Effect.exit(
      checkForUpdate({
        manifestUrls: ["http://untrusted.example.test/manifest.json", "https://mirror.example.test/manifest.json"],
        allowedHosts: ["mirror.example.test"],
        trustedKeys: {},
        novaWayVersion: "1.15.4",
        readRemote,
      }),
    )

    expect(exit._tag).toBe("Failure")
    expect(calls).toEqual(["https://mirror.example.test/manifest.json"])
    expect((yield* store.status()).active.digest).toBe(bundled.digest)
    expect((yield* store.status()).installed).toEqual([bundled])
  }),
)

it.instance("签名失败时继续尝试镜像，并拒绝签名正确但版本范围不兼容的 Manifest", () =>
  Effect.gen(function* () {
    const data = yield* Effect.promise(fixture)
    const badSignature = new TextEncoder().encode(JSON.stringify({ ...data.manifest, signature: "AA==" }))
    const primary = "https://primary.example.test/manifest.json"
    const mirror = "https://mirror.example.test/manifest.json"
    const readRemote: ReadRemote = (url) =>
      Effect.succeed({ body: url === primary ? badSignature : data.manifestBytes, finalUrl: url })
    const checked = yield* checkForUpdate({
      manifestUrls: [primary, mirror],
      allowedHosts: ["primary.example.test", "mirror.example.test", "releases.example.test"],
      trustedKeys: { [data.manifest.keyID]: data.publicKey },
      novaWayVersion: "1.15.4",
      readRemote,
    })
    expect(checked.sourceUrl).toBe(mirror)
    expect(checked.failures).toHaveLength(1)

    const incompatibleUnsigned = { ...data.manifest, maximumNovaWayVersion: "<1.0.0" } as Record<string, unknown>
    delete incompatibleUnsigned.signature
    const incompatible = {
      ...data.manifest,
      maximumNovaWayVersion: "<1.0.0",
      signature: sign(
        null,
        Buffer.from(canonicalizeJson(incompatibleUnsigned), "utf8"),
        data.privateKey,
      ).toString("base64"),
    }
    const exit = yield* Effect.exit(
      checkForUpdate({
        manifestUrls: [mirror],
        allowedHosts: ["mirror.example.test", "releases.example.test"],
        trustedKeys: { [data.manifest.keyID]: data.publicKey },
        novaWayVersion: "1.15.4",
        readRemote: (url) =>
          Effect.succeed({ body: new TextEncoder().encode(JSON.stringify(incompatible)), finalUrl: url }),
      }),
    )
    expect(exit._tag).toBe("Failure")
  }),
)
