import { createHash, generateKeyPairSync, sign } from "node:crypto"
import { BlobReader, BlobWriter, TextReader, ZipReader, ZipWriter } from "@zip.js/zip.js"
import { Effect } from "effect"
import { canonicalizeJson, type SignedUpdateManifest } from "./update-manifest"
import type { ReadRemote } from "./update-service"

export type LocalReleaseBundle = {
  version: string
  artifact: Uint8Array
  manifest: SignedUpdateManifest
  manifestBytes: Uint8Array
  publicKeyPem: string
  privateKey: ReturnType<typeof generateKeyPairSync>["privateKey"]
  keyID: string
  hosts: {
    primary: string
    mirror: string
    releases: string
  }
  urls: {
    primaryManifest: string
    mirrorManifest: string
    artifact: string
  }
}

function sha256(content: Uint8Array | string) {
  return createHash("sha256").update(content).digest("hex")
}

async function filesDigest(artifact: Uint8Array) {
  const reader = new ZipReader(new BlobReader(new Blob([Buffer.from(artifact)])))
  try {
    const entries = (await reader.getEntries()).filter((entry) => !entry.directory)
    const lines: string[] = []
    for (const entry of entries.sort((left, right) => left.filename.localeCompare(right.filename, "en"))) {
      const blob = await entry.getData?.(new BlobWriter())
      lines.push(`${sha256(new Uint8Array(await blob!.arrayBuffer()))}  ${entry.filename}\n`)
    }
    return { filesSha256: sha256(lines.join("")), fileCount: entries.length }
  } finally {
    await reader.close()
  }
}

/** 构建仅用于本机 stable 联调的签名发布包（非生产密钥）。 */
export async function buildLocalStableRelease(input?: {
  version?: string
  keyID?: string
  novaWayMin?: string
  novaWayMax?: string
}): Promise<LocalReleaseBundle> {
  const version = input?.version ?? "6.2.0"
  const keyID = input?.keyID ?? "powersnexus-local-stable-2026-01"
  const writer = new ZipWriter(new BlobWriter("application/zip"))
  await writer.add("package.json", new TextReader(JSON.stringify({ name: "powersnexus", version })))
  await writer.add(
    "src/cli/powersnexus-cli.js",
    new TextReader(`#!/usr/bin/env node\nif (process.argv[2] === "doctor") process.exit(0)\nprocess.exit(0)\n`),
  )
  const artifact = new Uint8Array(await (await writer.close()).arrayBuffer())

  const hosts = {
    primary: "gitee.local.test",
    mirror: "mirror.local.test",
    releases: "releases.local.test",
  }
  const urls = {
    primaryManifest: `https://${hosts.primary}/powersnexus/stable/manifest.json`,
    mirrorManifest: `https://${hosts.mirror}/powersnexus/stable/manifest.json`,
    artifact: `https://${hosts.releases}/powersnexus-${version}.zip`,
  }

  const { filesSha256, fileCount } = await filesDigest(artifact)
  const provisional = {
    schemaVersion: "1" as const,
    version,
    channel: "stable" as const,
    protocolVersion: "1.0",
    minimumNovaWayVersion: input?.novaWayMin ?? "1.3.0",
    maximumNovaWayVersion: input?.novaWayMax ?? "<2.0.0",
    sourceCommit: "6b8bd9e9519e166f3533d240f81534cfd00a76de",
    artifactUrl: urls.artifact,
    artifactSha256: sha256(artifact),
    filesSha256,
    artifactSize: artifact.length,
    fileCount,
    publishedAt: new Date().toISOString(),
    keyID,
    signature: "AA==",
  } satisfies SignedUpdateManifest

  const pair = generateKeyPairSync("ed25519")
  const unsigned = { ...provisional } as Record<string, unknown>
  delete unsigned.signature
  const manifest: SignedUpdateManifest = {
    ...provisional,
    signature: sign(null, Buffer.from(canonicalizeJson(unsigned), "utf8"), pair.privateKey).toString("base64"),
  }

  return {
    version,
    artifact,
    manifest,
    manifestBytes: new TextEncoder().encode(JSON.stringify(manifest)),
    publicKeyPem: pair.publicKey.export({ type: "spki", format: "pem" }).toString(),
    privateKey: pair.privateKey,
    keyID,
    hosts,
    urls,
  }
}

/** 把本地发布映射成 update-service 可用的 ReadRemote（不走真实网络）。 */
export function createLocalReadRemote(bundle: LocalReleaseBundle, options?: { primaryDown?: boolean }): ReadRemote {
  const primaryDown = options?.primaryDown ?? true
  return (url) => {
    if (url === bundle.urls.primaryManifest) {
      if (primaryDown) return Effect.fail(new Error("模拟主源断网"))
      return Effect.succeed({ body: bundle.manifestBytes, finalUrl: url })
    }
    if (url === bundle.urls.mirrorManifest) {
      return Effect.succeed({ body: bundle.manifestBytes, finalUrl: url })
    }
    if (url === bundle.urls.artifact || url === bundle.manifest.artifactUrl) {
      return Effect.succeed({ body: bundle.artifact, finalUrl: url })
    }
    return Effect.fail(new Error(`未知远程资源：${url}`))
  }
}

export function localAllowedHosts(bundle: LocalReleaseBundle) {
  return [bundle.hosts.primary, bundle.hosts.mirror, bundle.hosts.releases]
}
