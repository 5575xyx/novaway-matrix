import path from "node:path"
import { createHash, randomUUID } from "node:crypto"
import { Uint8ArrayReader, Uint8ArrayWriter, ZipReader, type Entry } from "@zip.js/zip.js"
import semver from "semver"
import { AppProcess } from "@opencode-ai/core/process"
import { Duration, Effect, FileSystem, Schema } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { verifySignedManifest, type SignedUpdateManifest } from "./update-manifest"
import type { VersionRef } from "./schema"
import { powersnexusNodeExecutable } from "./node-exec"
import type { Interface as VersionStore } from "./version-store"

export type ArtifactLimits = {
  maxFiles: number
  maxFileBytes: number
  maxTotalBytes: number
}

export type VerifiedArtifactEntry = {
  path: string
  content: Uint8Array
  sha256: string
}

export type RemoteResponse = {
  body: Uint8Array
  finalUrl: string
}

export type ReadRemote = (url: string, maxBytes: number) => Effect.Effect<RemoteResponse, Error>

export type CheckedManifest = {
  manifest: SignedUpdateManifest
  sourceUrl: string
  checkedAt: string
  failures: ReadonlyArray<{ url: string; message: string }>
}

export class UpdateServiceError extends Schema.TaggedErrorClass<UpdateServiceError>()("PowersNexusUpdateServiceError", {
  code: Schema.Literals([
    "UPDATE_MANIFEST_UNAVAILABLE",
    "UPDATE_SOURCE_NOT_ALLOWED",
    "UPDATE_VERSION_INCOMPATIBLE",
    "UPDATE_SELF_CHECK_FAILED",
  ]),
  message: Schema.String,
  evidence: Schema.Array(Schema.String),
}) {}

export const DEFAULT_ARTIFACT_LIMITS: ArtifactLimits = {
  maxFiles: 10_000,
  maxFileBytes: 64 * 1024 * 1024,
  maxTotalBytes: 512 * 1024 * 1024,
}

export class UpdateArtifactInvalidError extends Schema.TaggedErrorClass<UpdateArtifactInvalidError>()(
  "PowersNexusUpdateArtifactInvalidError",
  {
    code: Schema.Literal("UPDATE_ARTIFACT_INVALID"),
    message: Schema.String,
    evidence: Schema.Array(Schema.String),
  },
) {}

function sha256(content: Uint8Array | string) {
  return createHash("sha256").update(content).digest("hex")
}

function invalid(message: string, evidence: string[] = []) {
  return new UpdateArtifactInvalidError({ code: "UPDATE_ARTIFACT_INVALID", message, evidence })
}

function serviceError(code: UpdateServiceError["code"], message: string, evidence: string[] = []) {
  return new UpdateServiceError({ code, message, evidence })
}

function validateRemoteUrl(input: string, allowedHosts: ReadonlySet<string>) {
  const url = new URL(input)
  if (url.protocol !== "https:" || url.username || url.password || !allowedHosts.has(url.hostname.toLowerCase())) {
    throw serviceError("UPDATE_SOURCE_NOT_ALLOWED", "更新地址不在 HTTPS 发布域名允许列表中", [input])
  }
  return url
}

function parseRemoteUrl(input: string, allowedHosts: ReadonlySet<string>) {
  return Effect.try({
    try: () => validateRemoteUrl(input, allowedHosts),
    catch: (cause) =>
      cause instanceof UpdateServiceError
        ? cause
        : serviceError("UPDATE_SOURCE_NOT_ALLOWED", "更新地址不是有效 URL", [input]),
  })
}

function assertCompatible(manifest: SignedUpdateManifest, novaWayVersion: string, protocolMajor: string) {
  if (manifest.channel !== "stable") {
    throw serviceError("UPDATE_VERSION_INCOMPATIBLE", "稳定更新策略只接受 stable 通道 Manifest")
  }
  if (manifest.protocolVersion.split(".")[0] !== protocolMajor) {
    throw serviceError("UPDATE_VERSION_INCOMPATIBLE", "PowersNexus Bridge 主版本与当前 NovaWay 不兼容")
  }
  if (!semver.valid(novaWayVersion)) {
    throw serviceError("UPDATE_VERSION_INCOMPATIBLE", "当前 NovaWay 版本不是有效的 Semantic Version")
  }
  const range = `>=${manifest.minimumNovaWayVersion} ${manifest.maximumNovaWayVersion}`
  if (!semver.validRange(range) || !semver.satisfies(novaWayVersion, range, { includePrerelease: false })) {
    throw serviceError("UPDATE_VERSION_INCOMPATIBLE", "更新版本与当前 NovaWay 版本范围不兼容", [range])
  }
}

function ensureCompatible(manifest: SignedUpdateManifest, novaWayVersion: string, protocolMajor: string) {
  return Effect.try({
    try: () => assertCompatible(manifest, novaWayVersion, protocolMajor),
    catch: (cause) =>
      cause instanceof UpdateServiceError
        ? cause
        : serviceError("UPDATE_VERSION_INCOMPATIBLE", "更新版本兼容性检查失败"),
  })
}

export const checkForUpdate = Effect.fn("PowersNexus.checkForUpdate")(function* (options: {
  manifestUrls: ReadonlyArray<string>
  allowedHosts: ReadonlyArray<string>
  trustedKeys: Readonly<Record<string, string | Buffer>>
  novaWayVersion: string
  readRemote: ReadRemote
  protocolMajor?: string
}) {
  const allowedHosts = new Set(options.allowedHosts.map((host) => host.toLowerCase()))
  const failures: Array<{ url: string; message: string }> = []

  for (const sourceUrl of options.manifestUrls) {
    const checked = yield* Effect.gen(function* () {
      yield* parseRemoteUrl(sourceUrl, allowedHosts)
      const response = yield* options.readRemote(sourceUrl, 1024 * 1024)
      yield* parseRemoteUrl(response.finalUrl, allowedHosts)
      if (response.body.length > 1024 * 1024) {
        return yield* serviceError("UPDATE_MANIFEST_UNAVAILABLE", "更新 Manifest 超过 1 MiB 上限")
      }
      const input = yield* Effect.try({
        try: () => JSON.parse(new TextDecoder().decode(response.body)),
        catch: () => serviceError("UPDATE_MANIFEST_UNAVAILABLE", "更新 Manifest 不是有效 JSON"),
      })
      const manifest = yield* verifySignedManifest(input, options.trustedKeys)
      yield* parseRemoteUrl(manifest.artifactUrl, allowedHosts)
      yield* ensureCompatible(manifest, options.novaWayVersion, options.protocolMajor ?? "1")
      return manifest
    }).pipe(
      Effect.map((manifest) => ({ ok: true as const, manifest })),
      Effect.catch((cause) =>
        Effect.succeed({
          ok: false as const,
          message: cause instanceof Error ? cause.message : "更新源验证失败",
        }),
      ),
    )
    if (checked.ok) {
      return {
        manifest: checked.manifest,
        sourceUrl,
        checkedAt: new Date().toISOString(),
        failures,
      } satisfies CheckedManifest
    }
    failures.push({ url: sourceUrl, message: checked.message })
  }

  return yield* serviceError(
    "UPDATE_MANIFEST_UNAVAILABLE",
    "所有 PowersNexus 更新源均不可用或未通过验证",
    failures.map((failure) => `${failure.url}: ${failure.message}`),
  )
})

function normalizeEntryPath(filename: string) {
  if (!filename || filename.includes("\\") || filename.includes("\0")) throw invalid("ZIP 路径包含歧义字符", [filename])
  const normalized = filename.normalize("NFC")
  if (normalized.startsWith("/") || normalized.startsWith("//") || /^[A-Za-z]:/.test(normalized)) {
    throw invalid("ZIP 路径必须是相对路径", [filename])
  }
  const segments = normalized.split("/")
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw invalid("ZIP 路径包含目录穿越或空片段", [filename])
  }
  const device = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i
  if (
    segments.some(
      (segment) => device.test(segment) || segment.includes(":") || segment.endsWith(".") || segment.endsWith(" "),
    )
  ) {
    throw invalid("ZIP 路径包含 Windows 设备名或规范化歧义", [filename])
  }
  return normalized
}

function assertRegularEntry(entry: Entry) {
  if (entry.encrypted) throw invalid("ZIP 不允许加密条目", [entry.filename])
  if (entry.directory) return
  if (entry.msDosCompatible) return
  const mode = (entry.externalFileAttributes >>> 16) & 0xffff
  const fileType = mode & 0o170000
  if (fileType !== 0 && fileType !== 0o100000) {
    throw invalid("ZIP 只允许普通文件，拒绝符号链接、设备或其他特殊类型", [entry.filename])
  }
}

export const verifyArtifact = Effect.fn("PowersNexus.verifyArtifact")(function* (
  artifact: Uint8Array,
  manifest: SignedUpdateManifest,
  limits: ArtifactLimits = DEFAULT_ARTIFACT_LIMITS,
) {
  return yield* Effect.tryPromise({
    try: async () => {
      if (artifact.length !== manifest.artifactSize) throw invalid("artifactSize 与下载字节数不一致")
      if (sha256(artifact) !== manifest.artifactSha256) throw invalid("artifactSha256 校验失败")
      // zip.js 2.7.x 的 Uint8ArrayReader 内部按底层 ArrayBuffer 读取，无法正确处理非零 byteOffset。
      // Effect 文件系统在 Node.js 下可能返回 Buffer 视图，因此先复制为独立、零偏移的字节数组。
      const archive = Uint8Array.from(artifact)
      const reader = new ZipReader(new Uint8ArrayReader(archive))
      try {
        const entries = await reader.getEntries()
        const files = entries.filter((entry) => !entry.directory)
        if (files.length !== manifest.fileCount) throw invalid("fileCount 与 ZIP 普通文件数量不一致")
        if (files.length > limits.maxFiles) throw invalid("ZIP 文件数量超过限制")

        let totalBytes = 0
        const seen = new Set<string>()
        const normalized = files.map((entry) => {
          assertRegularEntry(entry)
          const entryPath = normalizeEntryPath(entry.filename)
          const identity = entryPath.toLocaleLowerCase("en-US")
          if (seen.has(identity)) throw invalid("ZIP 包含重复的规范化路径", [entryPath])
          seen.add(identity)
          if (entry.uncompressedSize > limits.maxFileBytes) throw invalid("ZIP 单文件解压体积超过限制", [entryPath])
          totalBytes += entry.uncompressedSize
          if (totalBytes > limits.maxTotalBytes) throw invalid("ZIP 总解压体积超过限制")
          return { entry, path: entryPath }
        })

        const extracted: VerifiedArtifactEntry[] = []
        for (const item of normalized.sort((left, right) => left.path.localeCompare(right.path, "en"))) {
          const writer = new Uint8ArrayWriter()
          const content = await item.entry.getData?.(writer)
          if (!content) throw invalid("ZIP 条目缺少可读取内容", [item.path])
          if (content.length !== item.entry.uncompressedSize || content.length > limits.maxFileBytes) {
            throw invalid("ZIP 条目实际体积与中央目录不一致", [item.path])
          }
          extracted.push({ path: item.path, content, sha256: sha256(content) })
        }
        const fileList = extracted.map((entry) => `${entry.sha256}  ${entry.path}\n`).join("")
        if (sha256(fileList) !== manifest.filesSha256) throw invalid("filesSha256 校验失败")
        return extracted
      } finally {
        await reader.close()
      }
    },
    catch: (cause) => (cause instanceof UpdateArtifactInvalidError ? cause : invalid(String(cause))),
  })
})

export const installCheckedUpdate = Effect.fn("PowersNexus.installCheckedUpdate")(function* (options: {
  checked: CheckedManifest
  allowedHosts: ReadonlyArray<string>
  root: string
  readRemote: ReadRemote
  versionStore: VersionStore
}) {
  const fs = yield* FileSystem.FileSystem
  const appProcess = yield* AppProcess.Service
  const manifest = options.checked.manifest
  const allowedHosts = new Set(options.allowedHosts.map((host) => host.toLowerCase()))
  yield* parseRemoteUrl(manifest.artifactUrl, allowedHosts)

  const downloads = path.join(options.root, "downloads")
  const versions = path.join(options.root, "versions")
  const download = path.join(downloads, `${manifest.artifactSha256}.zip`)
  const partial = path.join(downloads, `.${manifest.artifactSha256}-${randomUUID()}.part`)
  const target = path.join(versions, `${manifest.version}-${manifest.artifactSha256}`)
  const temporary = path.join(versions, `.install-${manifest.artifactSha256}-${randomUUID()}`)
  yield* fs.makeDirectory(downloads, { recursive: true })
  yield* fs.makeDirectory(versions, { recursive: true })

  const artifact = yield* options.readRemote(manifest.artifactUrl, manifest.artifactSize).pipe(
    Effect.flatMap((response) =>
      Effect.try({
        try: () => {
          validateRemoteUrl(response.finalUrl, allowedHosts)
          return response.body
        },
        catch: (cause) => cause,
      }),
    ),
  )

  return yield* Effect.gen(function* () {
    yield* writeSynced(fs, partial, artifact)
    const files = yield* verifyArtifact(artifact, manifest)
    if (!(yield* fs.exists(download))) yield* fs.rename(partial, download)

    if (!(yield* fs.exists(target))) {
      yield* fs.makeDirectory(temporary, { recursive: true })
      yield* Effect.forEach(
        files,
        (file) =>
          Effect.gen(function* () {
            const destination = path.join(temporary, ...file.path.split("/"))
            yield* fs.makeDirectory(path.dirname(destination), { recursive: true })
            yield* fs.writeFile(destination, file.content)
          }),
        { concurrency: 8, discard: true },
      )
      yield* runDoctor(appProcess, path.join(temporary, "src", "cli", "powersnexus-cli.js"), temporary)
      yield* fs.rename(temporary, target)
    }

    const cliPath = path.join(target, "src", "cli", "powersnexus-cli.js")
    if (!(yield* fs.exists(cliPath))) {
      return yield* serviceError("UPDATE_SELF_CHECK_FAILED", "已安装版本缺少 PowersNexus Bridge CLI")
    }
    yield* runDoctor(appProcess, cliPath, target)
    const version = {
      version: manifest.version,
      protocolVersion: manifest.protocolVersion,
      digest: manifest.artifactSha256,
      source: "downloaded",
      compatible: true,
      verified: true,
      cliPath,
    } satisfies VersionRef
    yield* options.versionStore.register(version)
    return version
  }).pipe(
    Effect.ensuring(
      Effect.all([
        fs.remove(partial, { force: true }).pipe(Effect.catch(() => Effect.void)),
        fs.remove(temporary, { recursive: true, force: true }).pipe(Effect.catch(() => Effect.void)),
      ]).pipe(Effect.asVoid),
    ),
  )
})

function runDoctor(appProcess: AppProcess.Interface, cliPath: string, cwd: string) {
  return Effect.gen(function* () {
    const result = yield* appProcess.run(
      ChildProcess.make(powersnexusNodeExecutable(), [cliPath, "doctor"], {
        cwd,
        extendEnv: true,
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      }),
      { timeout: Duration.seconds(30), maxOutputBytes: 1024 * 1024, maxErrorBytes: 1024 * 1024 },
    )
    if (result.exitCode === 0 && !result.stdoutTruncated && !result.stderrTruncated) return
    return yield* serviceError("UPDATE_SELF_CHECK_FAILED", "PowersNexus 更新版本自检失败", [
      result.stderr.toString("utf8").trim(),
    ])
  })
}

function writeSynced(fs: FileSystem.FileSystem, file: string, content: Uint8Array) {
  return Effect.scoped(
    Effect.gen(function* () {
      const handle = yield* fs.open(file, { flag: "wx", mode: 0o600 })
      yield* handle.writeAll(content)
      yield* handle.sync
    }),
  )
}

export * as PowersNexusUpdateService from "./update-service"
