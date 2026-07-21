import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { createPublishPlan, giteeDownloadUrl } from "./publish-powersnexus-gitee-release.mjs"

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function fixture(artifactUrl?: string, artifactSha256 = Bun.SHA256.hash("zip", "hex")) {
  const root = path.join(os.tmpdir(), `powersnexus-gitee-release-${crypto.randomUUID()}`)
  roots.push(root)
  mkdirSync(root, { recursive: true })
  writeFileSync(path.join(root, "powersnexus-6.1.0.zip"), "zip")
  writeFileSync(path.join(root, "files.sha256"), "hash  file\n")
  writeFileSync(
    path.join(root, "manifest.json"),
    JSON.stringify({
      version: "6.1.0",
      channel: "stable",
      sourceCommit: "6b8bd9e9519e166f3533d240f81534cfd00a76de",
      artifactUrl:
        artifactUrl ||
        "https://gitee.com/nova-way/powersnexus/releases/download/v6.1.0/powersnexus-6.1.0.zip",
      artifactSha256,
      signature: "signed",
    }),
  )
  return root
}

describe("PowersNexus Gitee Release 发布计划", () => {
  test("生成 Gitee Release 附件下载地址", () => {
    expect(giteeDownloadUrl("nova-way", "powersnexus", "v6.1.0", "powersnexus-6.1.0.zip")).toBe(
      "https://gitee.com/nova-way/powersnexus/releases/download/v6.1.0/powersnexus-6.1.0.zip",
    )
  })

  test("签名、URL 和摘要一致时允许发布", () => {
    const root = fixture()
    const plan = createPublishPlan({
      owner: "nova-way",
      repo: "powersnexus",
      apiBase: "https://gitee.com/api/v5",
      releaseDirectory: root,
      manifestPath: path.join(root, "manifest.json"),
    })
    expect(plan.ready).toBeTrue()
    expect(plan.versionTag).toBe("v6.1.0")
    expect(plan.channelTag).toBe("powersnexus-stable")
    expect(plan.blockers).toEqual([])
  })

  test("拒绝旧 CDN artifactUrl", () => {
    const root = fixture("https://cdn.novaway.ai/powersnexus/stable/powersnexus-6.1.0.zip")
    const plan = createPublishPlan({
      owner: "nova-way",
      repo: "powersnexus",
      apiBase: "https://gitee.com/api/v5",
      releaseDirectory: root,
      manifestPath: path.join(root, "manifest.json"),
    })
    expect(plan.ready).toBeFalse()
    expect(plan.blockers.some((item) => item.includes("artifactUrl 不匹配"))).toBeTrue()
  })

  test("拒绝 ZIP 摘要不匹配", () => {
    const root = fixture(undefined, "0".repeat(64))
    const plan = createPublishPlan({
      owner: "nova-way",
      repo: "powersnexus",
      apiBase: "https://gitee.com/api/v5",
      releaseDirectory: root,
      manifestPath: path.join(root, "manifest.json"),
    })
    expect(plan.ready).toBeFalse()
    expect(plan.blockers.some((item) => item.includes("ZIP SHA-256 不匹配"))).toBeTrue()
  })
})