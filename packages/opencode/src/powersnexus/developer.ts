import path from "node:path"
import { createHash } from "node:crypto"
import semver from "semver"
import { AppProcess } from "@opencode-ai/core/process"
import { Duration, Effect, FileSystem, Schema } from "effect"
import { ChildProcess } from "effect/unstable/process"
import type { VersionRef } from "./schema"

export class DeveloperVersionError extends Schema.TaggedErrorClass<DeveloperVersionError>()(
  "PowersNexusDeveloperVersionError",
  { code: Schema.String, message: Schema.String },
) {}

function unavailable(message: string) {
  return new DeveloperVersionError({ code: "POWERSNEXUS_NOT_AVAILABLE", message })
}

export const loadDeveloper = Effect.fn("PowersNexus.loadDeveloper")(function* (options: {
  directory: string
  developerBuild: boolean
}) {
  if (!options.developerBuild) return yield* unavailable("developer 策略只能用于本地开发构建")
  if (!path.isAbsolute(options.directory)) return yield* unavailable("developerPath 必须是绝对路径")
  const fs = yield* FileSystem.FileSystem
  const appProcess = yield* AppProcess.Service
  const directory = path.resolve(options.directory)
  const cliPath = path.join(directory, "src", "cli", "powersnexus-cli.js")
  const packagePath = path.join(directory, "package.json")
  const protocolPath = path.join(directory, "schemas", "protocol-v1.json")
  if (!(yield* fs.exists(cliPath)) || !(yield* fs.exists(packagePath)) || !(yield* fs.exists(protocolPath))) {
    return yield* unavailable("developerPath 缺少 package.json、Bridge CLI 或 protocol-v1.json")
  }

  const [packageText, protocolText] = yield* Effect.all([
    fs.readFileString(packagePath),
    fs.readFileString(protocolPath),
  ])
  const metadata = yield* Effect.try({
    try: () => {
      const packageJson = JSON.parse(packageText) as { version?: unknown }
      const protocol = JSON.parse(protocolText) as { properties?: { protocolVersion?: { const?: unknown } } }
      if (typeof packageJson.version !== "string" || !semver.valid(packageJson.version)) throw new Error("版本无效")
      const protocolVersion = protocol.properties?.protocolVersion?.const
      if (typeof protocolVersion !== "string" || !/^1\.[0-9]+$/.test(protocolVersion)) {
        throw new Error("Bridge 协议无效或主版本不兼容")
      }
      return { version: packageJson.version, protocolVersion }
    },
    catch: () => unavailable("developerPath 的版本或 Bridge 协议声明无效"),
  })

  const revision = yield* appProcess.run(
    ChildProcess.make("git", ["rev-parse", "HEAD"], { cwd: directory, extendEnv: true }),
    { timeout: Duration.seconds(10), maxOutputBytes: 1024, maxErrorBytes: 1024 },
  )
  const commit = revision.stdout.toString("utf8").trim()
  if (revision.exitCode !== 0 || !/^[a-f0-9]{40}$/.test(commit)) {
    return yield* unavailable("developerPath 必须指向具有固定提交的 Git 工作树")
  }
  const workingTree = yield* appProcess.run(
    ChildProcess.make("git", ["status", "--porcelain", "--untracked-files=no"], { cwd: directory, extendEnv: true }),
    { timeout: Duration.seconds(10), maxOutputBytes: 1024 * 1024, maxErrorBytes: 1024 },
  )
  if (workingTree.exitCode !== 0 || workingTree.stdout.toString("utf8").trim()) {
    return yield* unavailable("developerPath 必须保持已跟踪文件干净，避免执行内容漂移")
  }
  const doctor = yield* appProcess.run(
    ChildProcess.make(process.execPath, [cliPath, "doctor"], { cwd: directory, extendEnv: true }),
    { timeout: Duration.seconds(30), maxOutputBytes: 1024 * 1024, maxErrorBytes: 1024 * 1024 },
  )
  if (doctor.exitCode !== 0 || doctor.stdoutTruncated || doctor.stderrTruncated) {
    return yield* unavailable("developerPath 未通过 PowersNexus doctor 自检")
  }

  return {
    version: metadata.version,
    protocolVersion: metadata.protocolVersion,
    digest: createHash("sha256").update(`git:${commit}\n`).digest("hex"),
    source: "developer",
    compatible: true,
    verified: true,
    cliPath,
  } satisfies VersionRef
})

export * as PowersNexusDeveloper from "./developer"
