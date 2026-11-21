import { verify as verifySignature } from "node:crypto"
/** Runtime trust decision for extensions and MCP servers.
 *
 * This is deliberately deterministic and side-effect free so the UI, CLI and
 * server make the same decision before an artifact is activated.
 */
export type TrustLevel = "official" | "verified" | "untrusted"
export type TrustDecision = {
  level: TrustLevel
  allowed: boolean
  requiresConfirmation: boolean
  reasons: string[]
}

const HIGH_RISK = /(?:filesystem|workspace|process|shell|exec|subprocess|network|mcp|secret|credential|browser)/i

export function assess(input: {
  url: string
  sourceId?: string
  sha256?: string
  permissions?: readonly string[]
  signatureVerified?: boolean
}): TrustDecision {
  const reasons: string[] = []
  let host = ""
  try { host = new URL(input.url).hostname.toLowerCase() } catch { reasons.push("invalid artifact URL") }
  let officialPath = ""
  try { officialPath = new URL(input.url).pathname.toLowerCase() } catch {}
  const officialRepository = (host === "gitee.com" || host === "github.com" || host === "raw.githubusercontent.com") && officialPath.includes("novaway-ai/novaway-plugins")
  const official = officialRepository && input.sourceId?.startsWith("com.novaway.") === true
  const verified = input.signatureVerified === true || (typeof input.sha256 === "string" && /^[a-f0-9]{64}$/i.test(input.sha256))
  const highRisk = (input.permissions ?? []).some((permission) => HIGH_RISK.test(permission))
  if (!verified) reasons.push("artifact has no verifiable SHA-256 or signature")
  if (highRisk) reasons.push("artifact requests high-risk runtime capabilities")
  if (official && verified) return { level: "official", allowed: true, requiresConfirmation: highRisk, reasons }
  if (verified) return { level: "verified", allowed: true, requiresConfirmation: highRisk, reasons }
  return { level: "untrusted", allowed: false, requiresConfirmation: true, reasons }
}

/** Verify an Ed25519 detached signature over the exact downloaded artifact bytes. */
export function verifyArtifactSignature(input: { data: Buffer; signature: string; publicKey: string; algorithm?: "ed25519" }): boolean {
  try {
    return verifySignature(null, input.data, input.publicKey, Buffer.from(input.signature, "base64"))
  } catch {
    return false
  }
}
