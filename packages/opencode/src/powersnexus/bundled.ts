import path from "node:path"
import { randomUUID } from "node:crypto"
import semver from "semver"
import { AppProcess } from "@opencode-ai/core/process"
import { Duration, Effect, FileSystem, Schema } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { verifySignedManifest } from "./update-manifest"
import { verifyArtifact } from "./update-service"
import type { VersionRef } from "./schema"

const BUNDLED_KEY_ID = "powersnexus-bundled-2026-01"

export class BundledVersionError extends Schema.TaggedErrorClass<BundledVersionError>()(
  "PowersNexusBundledVersionError",
  {
    code: Schema.String,
    message: Schema.String,
  },
) {}

function unavailable(message: string, code = "POWERSNEXUS_NOT_AVAILABLE") {
  return new BundledVersionError({ code, message })
}

export const loadBundled = Effect.fn("PowersNexus.loadBundled")(function* (options: {
  resourceRoot: string
  publicKeyPath: string
  dataRoot: string
  novaWayVersion: string
}) {
  const fs = yield* FileSystem.FileSystem
  const appProcess = yield* AppProcess.Service

  const loaded = Effect.gen(function* () {
    const names = yield* fs.readDirectory(options.resourceRoot)
    const candidates = yield* Effect.filter(names, (name) =>
      fs.exists(path.join(options.resourceRoot, name, "manifest.json")),
    )
    if (candidates.length !== 1) return yield* unavailable("安装包必须只包含一个 PowersNexus 基线版本")
    const resourceDirectory = path.join(options.resourceRoot, candidates[0])
    const [manifestText, publicKey] = yield* Effect.all([
      fs.readFileString(path.join(resourceDirectory, "manifest.json")),
      fs.readFileString(options.publicKeyPath),
    ])
    const manifestInput = yield* Effect.try({
      try: () => JSON.parse(manifestText),
      catch: () => unavailable("内置 Manifest 不是有效 JSON"),
    })
    const manifest = yield* verifySignedManifest(manifestInput, { [BUNDLED_KEY_ID]: publicKey })
    if (manifest.keyID !== BUNDLED_KEY_ID) return yield* unavailable("内置 Manifest keyID 不受当前版本信任")
    if (manifest.protocolVersion.split(".")[0] !== "1") {
      return yield* unavailable("内置 Bridge 主版本不兼容", "PROTOCOL_VERSION_UNSUPPORTED")
    }
    if (!semver.valid(options.novaWayVersion)) return yield* unavailable("NovaWay 版本无法用于兼容性判断")
    const range = `>=${manifest.minimumNovaWayVersion} ${manifest.maximumNovaWayVersion}`
    if (!semver.satisfies(options.novaWayVersion, range, { includePrerelease: false })) {
      return yield* unavailable("内置 PowersNexus 与当前 NovaWay 版本不兼容", "UPDATE_VERSION_INCOMPATIBLE")
    }

    const artifactName = path.basename(new URL(manifest.artifactUrl).pathname)
    if (artifactName !== `powersnexus-${manifest.version}.zip`) {
      return yield* unavailable("内置制品文件名与 Manifest 版本不一致")
    }
    const artifact = yield* fs.readFile(path.join(resourceDirectory, artifactName))
    const files = yield* verifyArtifact(artifact, manifest)
    const parent = path.join(options.dataRoot, "powersnexus", "bundled")
    const target = path.join(parent, `${manifest.version}-${manifest.artifactSha256}`)
    const exists = yield* fs.exists(target)
    if (!exists) {
      const temporary = path.join(parent, `.install-${manifest.artifactSha256}-${randomUUID()}`)
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
      ).pipe(
        Effect.andThen(fs.rename(temporary, target)),
        Effect.ensuring(fs.remove(temporary, { recursive: true, force: true }).pipe(Effect.catch(() => Effect.void))),
      )
    }

    const cliPath = path.join(target, "src", "cli", "powersnexus-cli.js")
    if (!(yield* fs.exists(cliPath))) return yield* unavailable("内置制品缺少 Bridge CLI")
    const doctor = yield* appProcess.run(
      ChildProcess.make(process.execPath, [cliPath, "doctor"], {
        cwd: target,
        extendEnv: true,
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      }),
      { timeout: Duration.seconds(30), maxOutputBytes: 1024 * 1024, maxErrorBytes: 1024 * 1024 },
    )
    if (doctor.exitCode !== 0 || doctor.stdoutTruncated || doctor.stderrTruncated) {
      return yield* unavailable(`内置 PowersNexus 自检失败：${doctor.stderr.toString("utf8").trim()}`)
    }
    return {
      version: manifest.version,
      protocolVersion: manifest.protocolVersion,
      digest: manifest.artifactSha256,
      source: "bundled",
      compatible: true,
      verified: true,
      cliPath,
    } satisfies VersionRef
  })

  return yield* loaded.pipe(
    Effect.mapError((cause) =>
      cause instanceof BundledVersionError
        ? cause
        : unavailable(cause instanceof Error ? cause.message : "内置 PowersNexus 加载失败"),
    ),
  )
})

export * as PowersNexusBundled from "./bundled"
