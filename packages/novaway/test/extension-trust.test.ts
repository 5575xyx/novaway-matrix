import { describe, expect, test } from "bun:test"
import { assess } from "../src/extension/trust"

describe("extension trust policy", () => {
  test("allows hashed official artifacts and flags high-risk confirmation", () => {
    const result = assess({ url: "https://gitee.com/NovaWay-AI/novaway-plugins/releases/download/com.novaway.powersnexus-v1.1.4/com.novaway.powersnexus-1.1.4.zip", sourceId: "com.novaway.powersnexus", sha256: "a".repeat(64), permissions: ["workspace"] })
    expect(result.level).toBe("official")
    expect(result.allowed).toBe(true)
    expect(result.requiresConfirmation).toBe(true)
  })
  test("blocks unverifiable third-party artifacts", () => {
    const result = assess({ url: "https://example.com/a.zip" })
    expect(result.level).toBe("untrusted")
    expect(result.allowed).toBe(false)
  })
})

test("verifies detached Ed25519 artifact signatures", async () => {
  const { generateKeyPairSync, sign } = await import("node:crypto")
  const { verifyArtifactSignature } = await import("../src/extension/trust")
  const keys = generateKeyPairSync("ed25519")
  const data = Buffer.from("novaway-artifact")
  const publicKey = keys.publicKey.export({ type: "spki", format: "pem" }).toString()
  const signature = sign(null, data, keys.privateKey).toString("base64")
  expect(verifyArtifactSignature({ data, signature, publicKey })).toBe(true)
  expect(verifyArtifactSignature({ data: Buffer.from("tampered"), signature, publicKey })).toBe(false)
})

test("supports catalog signing key rotation", async () => {
  const { generateKeyPairSync, sign } = await import("node:crypto")
  const { verifySignedCatalog } = await import("../src/extension/catalog")
  const keys = generateKeyPairSync("ed25519")
  const body = { keyId: "key-2026", entries: [{ packageId: "com.novaway.demo" }] }
  const canonical = JSON.stringify({ entries: body.entries })
  const signature = sign(null, Buffer.from(canonical), keys.privateKey).toString("base64")
  const result = verifySignedCatalog({ ...body, signature }, [{ id: "key-2026", publicKey: keys.publicKey.export({ type: "spki", format: "pem" }).toString() }])
  expect(result.verified).toBe(true)
})
