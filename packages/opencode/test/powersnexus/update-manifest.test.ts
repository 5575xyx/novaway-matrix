import { describe, expect, test } from "bun:test"
import { generateKeyPairSync, sign } from "node:crypto"
import { Effect } from "effect"
import {
  canonicalizeJson,
  verifySignedManifest,
  type SignedUpdateManifest,
} from "../../src/powersnexus/update-manifest"

const baseManifest = {
  schemaVersion: "1",
  version: "6.1.0",
  channel: "stable",
  protocolVersion: "1.0",
  minimumNovaWayVersion: "1.3.0",
  maximumNovaWayVersion: "<2.0.0",
  sourceCommit: "6b8bd9e9519e166f3533d240f81534cfd00a76de",
  artifactUrl: "https://releases.example.com/powersnexus-6.1.0.zip",
  artifactSha256: "4".repeat(64),
  filesSha256: "2".repeat(64),
  artifactSize: 1024,
  fileCount: 177,
  publishedAt: "2026-07-16T00:00:00.000Z",
  keyID: "release-2026-01",
} as const

function signedFixture() {
  const pair = generateKeyPairSync("ed25519")
  const signature = sign(null, Buffer.from(canonicalizeJson(baseManifest), "utf8"), pair.privateKey).toString("base64")
  return {
    manifest: { ...baseManifest, signature },
    publicKey: pair.publicKey.export({ type: "spki", format: "pem" }).toString(),
  }
}

describe("PowersNexus 更新清单", () => {
  test("按 RFC 8785 规范化对象键并拒绝未配对代理项", () => {
    expect(canonicalizeJson({ z: 1, a: [true, null, "中文"] })).toBe('{"a":[true,null,"中文"],"z":1}')
    expect(() => canonicalizeJson({ value: "\ud800" })).toThrow()
  })

  test("验证 Effect Schema、keyID 与 Ed25519 签名", () => {
    const fixture = signedFixture()
    const result = Effect.runSync(verifySignedManifest(fixture.manifest, { "release-2026-01": fixture.publicKey }))
    expect(result.version).toBe("6.1.0")
    expect(result.signature).toBe(fixture.manifest.signature)
  })

  test("拒绝字段篡改、未知 keyID 和额外算法字段", () => {
    const fixture = signedFixture()
    const trusted = { "release-2026-01": fixture.publicKey }
    const tampered: SignedUpdateManifest = { ...fixture.manifest, artifactSize: 2048 }

    expect(() => Effect.runSync(verifySignedManifest(tampered, trusted))).toThrow()
    expect(() => Effect.runSync(verifySignedManifest({ ...fixture.manifest, keyID: "unknown" }, trusted))).toThrow()
    expect(() => Effect.runSync(verifySignedManifest({ ...fixture.manifest, algorithm: "rsa" }, trusted))).toThrow()
  })
})
