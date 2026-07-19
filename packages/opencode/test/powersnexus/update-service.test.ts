import { describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { BlobReader, BlobWriter, TextReader, ZipReader, ZipWriter } from "@zip.js/zip.js"
import { Effect } from "effect"
import { verifyArtifact, type ArtifactLimits } from "../../src/powersnexus/update-service"
import type { SignedUpdateManifest } from "../../src/powersnexus/update-manifest"

const limits: ArtifactLimits = { maxFiles: 10, maxFileBytes: 1024, maxTotalBytes: 4096 }

function sha256(content: Uint8Array | string) {
  return createHash("sha256").update(content).digest("hex")
}

async function zip(files: Array<{ name: string; content: string; externalFileAttributes?: number }>) {
  const writer = new ZipWriter(new BlobWriter("application/zip"))
  for (const file of files) {
    await writer.add(file.name, new TextReader(file.content), {
      externalFileAttributes: file.externalFileAttributes,
      versionMadeBy: file.externalFileAttributes === undefined ? undefined : 0x0314,
    })
  }
  return new Uint8Array(await (await writer.close()).arrayBuffer())
}

async function manifestFor(artifact: Uint8Array): Promise<SignedUpdateManifest> {
  const reader = new ZipReader(new BlobReader(new Blob([Buffer.from(artifact)])))
  const entries = (await reader.getEntries()).filter((entry) => !entry.directory)
  const lines: string[] = []
  for (const entry of entries.sort((left, right) => left.filename.localeCompare(right.filename, "en"))) {
    const writer = new BlobWriter()
    const blob = await entry.getData?.(writer)
    lines.push(`${sha256(new Uint8Array(await blob!.arrayBuffer()))}  ${entry.filename}\n`)
  }
  await reader.close()
  return {
    schemaVersion: "1",
    version: "6.1.0",
    channel: "stable",
    protocolVersion: "1.0",
    minimumNovaWayVersion: "1.3.0",
    maximumNovaWayVersion: "<2.0.0",
    sourceCommit: "6b8bd9e9519e166f3533d240f81534cfd00a76de",
    artifactUrl: "https://releases.example.com/powersnexus-6.1.0.zip",
    artifactSha256: sha256(artifact),
    filesSha256: sha256(lines.join("")),
    artifactSize: artifact.length,
    fileCount: entries.length,
    publishedAt: "2026-07-16T00:00:00.000Z",
    keyID: "release-2026-01",
    signature: "AA==",
  }
}

async function expectFailure(effect: ReturnType<typeof verifyArtifact>) {
  const exit = await Effect.runPromiseExit(effect)
  expect(exit._tag).toBe("Failure")
}

describe("PowersNexus 更新制品", () => {
  test("验证 artifact digest、文件清单并返回规范化普通文件", async () => {
    const artifact = await zip([
      { name: "package.json", content: "{}" },
      { name: "src/cli/powersnexus-cli.js", content: "console.log('ok')" },
    ])
    const manifest = await manifestFor(artifact)
    const result = await Effect.runPromise(verifyArtifact(artifact, manifest, limits))

    expect(result.map((entry) => entry.path)).toEqual(["package.json", "src/cli/powersnexus-cli.js"])
  })

  test("支持底层 ArrayBuffer 中具有非零偏移的 ZIP 视图", async () => {
    const artifact = await zip([{ name: "package.json", content: "{}" }])
    const padded = new Uint8Array(artifact.length + 17)
    padded.set(artifact, 11)
    const view = padded.subarray(11, 11 + artifact.length)
    const result = await Effect.runPromise(verifyArtifact(view, await manifestFor(artifact), limits))

    expect(result.map((entry) => entry.path)).toEqual(["package.json"])
  })

  test("拒绝 ZIP 字节、文件清单和声明数量篡改", async () => {
    const artifact = await zip([{ name: "package.json", content: "{}" }])
    const manifest = await manifestFor(artifact)

    await expectFailure(verifyArtifact(artifact, { ...manifest, artifactSha256: "0".repeat(64) }, limits))
    await expectFailure(verifyArtifact(artifact, { ...manifest, filesSha256: "0".repeat(64) }, limits))
    await expectFailure(verifyArtifact(artifact, { ...manifest, fileCount: 2 }, limits))
  })

  test("解压前拒绝路径穿越、反斜杠、设备名和大小写重复", async () => {
    for (const files of [
      [{ name: "../escape.txt", content: "x" }],
      [{ name: "src\\escape.txt", content: "x" }],
      [{ name: "CON.txt", content: "x" }],
      [
        { name: "README.md", content: "a" },
        { name: "readme.md", content: "b" },
      ],
    ]) {
      const artifact = await zip(files)
      const manifest = await manifestFor(artifact)
      await expectFailure(verifyArtifact(artifact, manifest, limits))
    }
  })

  test("拒绝符号链接类型和单文件/总体积超限", async () => {
    const symlink = await zip([{ name: "link", content: "target", externalFileAttributes: (0o120777 << 16) >>> 0 }])
    await expectFailure(verifyArtifact(symlink, await manifestFor(symlink), limits))

    const oversized = await zip([{ name: "large.bin", content: "x".repeat(1025) }])
    await expectFailure(verifyArtifact(oversized, await manifestFor(oversized), limits))
  })
})
