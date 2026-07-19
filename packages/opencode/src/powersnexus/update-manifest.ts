import { createPublicKey, verify } from "node:crypto"
import { Effect, Schema } from "effect"
import { Sha256 } from "./schema"

const Semver = Schema.String.check(
  Schema.isPattern(/^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/),
)
const ProtocolVersion = Schema.String.check(Schema.isPattern(/^[0-9]+\.[0-9]+$/))
const Commit = Schema.String.check(Schema.isPattern(/^[a-fA-F0-9]{40}$/))
const KeyID = Schema.String.check(Schema.isPattern(/^[a-zA-Z0-9._-]{1,128}$/))
const Base64 = Schema.String.check(Schema.isPattern(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/))
const PositiveInt = Schema.Int.check(Schema.isGreaterThan(0))

export const UnsignedUpdateManifest = Schema.Struct({
  schemaVersion: Schema.Literal("1"),
  version: Semver,
  channel: Schema.Literals(["stable", "preview"]),
  protocolVersion: ProtocolVersion,
  minimumNovaWayVersion: Schema.String,
  maximumNovaWayVersion: Schema.String,
  sourceCommit: Commit,
  artifactUrl: Schema.String,
  artifactSha256: Sha256,
  filesSha256: Sha256,
  artifactSize: PositiveInt,
  fileCount: PositiveInt,
  publishedAt: Schema.String,
  keyID: KeyID,
}).annotate({ identifier: "PowersNexusUnsignedUpdateManifest" })
export type UnsignedUpdateManifest = Schema.Schema.Type<typeof UnsignedUpdateManifest>

export const SignedUpdateManifest = Schema.Struct({
  schemaVersion: Schema.Literal("1"),
  version: Semver,
  channel: Schema.Literals(["stable", "preview"]),
  protocolVersion: ProtocolVersion,
  minimumNovaWayVersion: Schema.String,
  maximumNovaWayVersion: Schema.String,
  sourceCommit: Commit,
  artifactUrl: Schema.String,
  artifactSha256: Sha256,
  filesSha256: Sha256,
  artifactSize: PositiveInt,
  fileCount: PositiveInt,
  publishedAt: Schema.String,
  keyID: KeyID,
  signature: Base64,
}).annotate({ identifier: "PowersNexusSignedUpdateManifest" })
export type SignedUpdateManifest = Schema.Schema.Type<typeof SignedUpdateManifest>

const SIGNED_KEYS = [
  "artifactSha256",
  "artifactSize",
  "artifactUrl",
  "channel",
  "fileCount",
  "filesSha256",
  "keyID",
  "maximumNovaWayVersion",
  "minimumNovaWayVersion",
  "protocolVersion",
  "publishedAt",
  "schemaVersion",
  "signature",
  "sourceCommit",
  "version",
] as const

export class UpdateManifestInvalidError extends Schema.TaggedErrorClass<UpdateManifestInvalidError>()(
  "PowersNexusUpdateManifestInvalidError",
  {
    code: Schema.Literal("UPDATE_MANIFEST_INVALID"),
    message: Schema.String,
  },
) {}

export function canonicalizeJson(value: unknown): string {
  if (value === null || typeof value === "boolean") return JSON.stringify(value)
  if (typeof value === "string") {
    assertValidUnicode(value)
    return JSON.stringify(value)
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("RFC 8785 不允许非有限数字")
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map(canonicalizeJson).join(",")}]`
  if (typeof value === "object") {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record)
      .sort()
      .map((key) => {
        assertValidUnicode(key)
        const item = record[key]
        if (item === undefined) throw new TypeError("RFC 8785 不允许 undefined")
        return `${JSON.stringify(key)}:${canonicalizeJson(item)}`
      })
      .join(",")}}`
  }
  throw new TypeError(`RFC 8785 不支持 ${typeof value}`)
}

function assertValidUnicode(value: string) {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index)
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (!(next >= 0xdc00 && next <= 0xdfff)) throw new TypeError("RFC 8785 不允许未配对的高代理项")
      index++
      continue
    }
    if (code >= 0xdc00 && code <= 0xdfff) throw new TypeError("RFC 8785 不允许未配对的低代理项")
  }
}

export const verifySignedManifest = Effect.fn("PowersNexus.verifySignedManifest")(function* (
  input: unknown,
  trustedKeys: Readonly<Record<string, string | Buffer>>,
) {
  return yield* Effect.try({
    try: () => {
      if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Manifest 必须是 JSON 对象")
      const keys = Object.keys(input).sort()
      if (keys.length !== SIGNED_KEYS.length || keys.some((key, index) => key !== SIGNED_KEYS[index])) {
        throw new Error("Manifest 包含缺失或未声明字段")
      }
      const manifest = Schema.decodeUnknownSync(SignedUpdateManifest)(input)
      if (!manifest.artifactUrl.startsWith("https://")) throw new Error("artifactUrl 必须使用 HTTPS")
      if (Number.isNaN(Date.parse(manifest.publishedAt))) throw new Error("publishedAt 必须是有效时间")
      const pem = trustedKeys[manifest.keyID]
      if (!pem) throw new Error(`未知 keyID：${manifest.keyID}`)
      const key = createPublicKey(pem)
      if (key.asymmetricKeyType !== "ed25519") throw new Error("发布公钥必须是 Ed25519")
      const unsigned = { ...manifest } as Record<string, unknown>
      delete unsigned.signature
      const valid = verify(
        null,
        Buffer.from(canonicalizeJson(unsigned), "utf8"),
        key,
        Buffer.from(manifest.signature, "base64"),
      )
      if (!valid) throw new Error("Manifest 签名无效")
      return manifest
    },
    catch: (cause) =>
      new UpdateManifestInvalidError({
        code: "UPDATE_MANIFEST_INVALID",
        message: cause instanceof Error ? cause.message : "Manifest 无效",
      }),
  })
})

export * as PowersNexusUpdateManifest from "./update-manifest"
