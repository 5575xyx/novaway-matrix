import path from "node:path"
import { AppProcess } from "@opencode-ai/core/process"
import { Global } from "@opencode-ai/core/global"
import { InstallationLocal, InstallationVersion } from "@opencode-ai/core/installation/version"
import { NodeFileSystem } from "@effect/platform-node"
import packageJson from "../../package.json"
import { Config } from "@/config/config"
import { Context, Effect, FileSystem, Layer, Ref, Schema } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/unstable/http"
import { loadBundled } from "./bundled"
import {
  assertReleaseUrlsReady,
  resolveUpdatePolicy,
  type StableGateReport,
} from "@/config/powersnexus"
import { loadDeveloper } from "./developer"
import { checkForUpdate, installCheckedUpdate, type CheckedManifest, type ReadRemote } from "./update-service"
import { make, type Interface as VersionStore, type MutationRequest, type MutationResult } from "./version-store"
import type { UpdatePolicy, VersionRef } from "./schema"

export type Status = {
  policy: UpdatePolicy
  active: VersionRef
  bundled: VersionRef
  previous?: VersionRef
  installed: VersionRef[]
  available?: Omit<VersionRef, "cliPath">
  activationDeferred: boolean
  lastCheckedAt?: string
  lastErrorCode?: string
  stableGate?: StableGateReport
}

type Runtime = {
  policy: UpdatePolicy
  root: string
  bundled: VersionRef
  developer?: VersionRef
  store: VersionStore
  manifestUrls: ReadonlyArray<string>
  allowedHosts: ReadonlyArray<string>
  trustedKeys: Readonly<Record<string, string | Buffer>>
  readRemote: ReadRemote
  checked?: CheckedManifest
  lastCheckedAt?: string
  lastErrorCode?: string
  stableGate: StableGateReport
}

export class VersionServiceError extends Schema.TaggedErrorClass<VersionServiceError>()(
  "PowersNexusVersionServiceError",
  {
    code: Schema.String,
    message: Schema.String,
  },
) {}

export interface Interface {
  readonly init: () => Effect.Effect<void, VersionServiceError>
  readonly status: () => Effect.Effect<Status, VersionServiceError>
  readonly select: () => Effect.Effect<VersionRef, VersionServiceError>
  readonly check: () => Effect.Effect<Status, VersionServiceError>
  readonly install: (
    request: MutationRequest & { targetDigest: string },
  ) => Effect.Effect<MutationResult, VersionServiceError>
  readonly activate: (
    request: MutationRequest & { targetDigest: string },
  ) => Effect.Effect<MutationResult, VersionServiceError>
  readonly rollback: (request: MutationRequest) => Effect.Effect<MutationResult, VersionServiceError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/PowersNexusVersion") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service
    const fs = yield* FileSystem.FileSystem
    const appProcess = yield* AppProcess.Service
    const http = HttpClient.filterStatusOk(yield* HttpClient.HttpClient)
    const state = yield* Ref.make<Runtime | undefined>(undefined)

    const readRemote: ReadRemote = (url, maxBytes) =>
      http.execute(HttpClientRequest.get(url)).pipe(
        Effect.flatMap((response) =>
          response.arrayBuffer.pipe(
            Effect.flatMap((buffer) => {
              const body = new Uint8Array(buffer)
              if (body.length <= maxBytes) return Effect.succeed({ body, finalUrl: response.request.url })
              return Effect.fail(new Error(`远程响应超过 ${maxBytes} 字节上限`))
            }),
          ),
        ),
        Effect.mapError((cause) => (cause instanceof Error ? cause : new Error("PowersNexus 远程读取失败"))),
      )

    const setup = Effect.fnUntraced(function* () {
      const existing = yield* Ref.get(state)
      if (existing) return existing
      if (process.env.POWERSNEXUS_FIRST_PARTY !== "1") {
        return yield* new VersionServiceError({
          code: "POWERSNEXUS_NOT_AVAILABLE",
          message: "当前进程未启用 PowersNexus 第一方模式",
        })
      }
      const resourceRoot = process.env.POWERSNEXUS_BUNDLED_ROOT
      const publicKeyPath = process.env.POWERSNEXUS_RELEASE_PUBLIC_KEY
      if (!resourceRoot || !publicKeyPath) {
        return yield* new VersionServiceError({
          code: "POWERSNEXUS_NOT_AVAILABLE",
          message: "PowersNexus 内置基线资源配置不完整",
        })
      }
      const novaWayVersion =
        process.env.POWERSNEXUS_NOVAWAY_VERSION ??
        (InstallationVersion === "local" ? packageJson.version : InstallationVersion)
      const loaded = yield* loadBundled({
        resourceRoot,
        publicKeyPath,
        dataRoot: Global.Path.data,
        novaWayVersion,
      }).pipe(Effect.provideService(FileSystem.FileSystem, fs), Effect.provideService(AppProcess.Service, appProcess))
      const info = yield* config.get()
      const manifestUrls = info.powersnexus?.releaseManifestUrls ?? []
      const allowedHosts = info.powersnexus?.releaseAllowedHosts ?? []
      const configuredPolicy = info.powersnexus?.updatePolicy ?? process.env.POWERSNEXUS_UPDATE_POLICY ?? "bundled"
      const resolved = resolveUpdatePolicy({
        policy: configuredPolicy,
        releaseManifestUrls: manifestUrls,
        releaseAllowedHosts: allowedHosts,
        publicKeyPath: process.env.POWERSNEXUS_RELEASE_PUBLIC_KEY,
        keyID: process.env.POWERSNEXUS_RELEASE_KEY_ID,
        // 打包/生产路径提供了公钥时自动启用完整门禁
        strictProductionGate: Boolean(process.env.POWERSNEXUS_RELEASE_PUBLIC_KEY) || process.env.POWERSNEXUS_STABLE_PRODUCTION_GATE === "1",
      })
      const effectivePolicy = resolved.policy
      if (effectivePolicy === "stable") {
        assertReleaseUrlsReady({
          policy: effectivePolicy,
          releaseManifestUrls: manifestUrls,
          releaseAllowedHosts: allowedHosts,
          publicKeyPath: process.env.POWERSNEXUS_RELEASE_PUBLIC_KEY,
          keyID: process.env.POWERSNEXUS_RELEASE_KEY_ID,
        })
      }
      const developer =
        effectivePolicy === "developer"
          ? yield* loadDeveloper({
              directory:
                info.powersnexus?.developerPath ??
                process.env.POWERSNEXUS_DEVELOPER_PATH ??
                "",
              developerBuild: InstallationLocal,
            }).pipe(
              Effect.provideService(FileSystem.FileSystem, fs),
              Effect.provideService(AppProcess.Service, appProcess),
            )
          : undefined
      const root = path.join(Global.Path.data, "powersnexus")
      const store = yield* make({ root, bundled: loaded, hasActiveRuns: Effect.succeed(false) }).pipe(
        Effect.provideService(FileSystem.FileSystem, fs),
      )
      const publicKey = yield* fs.readFileString(publicKeyPath)
      const keyID = process.env.POWERSNEXUS_RELEASE_KEY_ID ?? "powersnexus-bundled-2026-01"
      const runtime: Runtime = {
        policy: effectivePolicy,
        root,
        bundled: loaded,
        developer,
        store,
        manifestUrls,
        allowedHosts,
        trustedKeys: { [keyID]: publicKey },
        readRemote,
        stableGate: resolved.gate,
      }
      yield* Ref.set(state, runtime)
      return runtime
    })
    const getRuntime = yield* Effect.cached(setup())

    const wrap = <A, E, R>(effect: Effect.Effect<A, E, R>, message: string) =>
      effect.pipe(
        Effect.mapError((cause) =>
          cause instanceof VersionServiceError
            ? cause
            : new VersionServiceError({
                code:
                  typeof cause === "object" && cause && "code" in cause && typeof cause.code === "string"
                    ? cause.code
                    : "INTERNAL_WORKFLOW_ERROR",
                message: cause instanceof Error ? cause.message : message,
              }),
        ),
      )

    const status = Effect.fnUntraced(function* () {
      const runtime = yield* getRuntime
      const current = yield* runtime.store.status()
      const active =
        runtime.policy === "bundled"
          ? runtime.bundled
          : runtime.policy === "developer"
            ? (runtime.developer ?? runtime.bundled)
            : current.active
      const available = runtime.checked
        ? {
            version: runtime.checked.manifest.version,
            protocolVersion: runtime.checked.manifest.protocolVersion,
            digest: runtime.checked.manifest.artifactSha256,
            source: "downloaded" as const,
            compatible: true,
            verified: true,
          }
        : undefined
      return {
        policy: runtime.policy,
        active,
        bundled: runtime.bundled,
        previous: current.previous,
        installed: runtime.developer ? [...current.installed, runtime.developer] : current.installed,
        available,
        activationDeferred: current.activationDeferred,
        lastCheckedAt: runtime.lastCheckedAt,
        lastErrorCode: runtime.lastErrorCode,
        stableGate: runtime.stableGate,
      } satisfies Status
    })

    const check = Effect.fnUntraced(function* () {
      const runtime = yield* getRuntime
      if (runtime.policy === "bundled" || runtime.policy === "developer") return yield* status()
      if (runtime.manifestUrls.length === 0) {
        return yield* new VersionServiceError({
          code: "UPDATE_MANIFEST_UNAVAILABLE",
          message: "尚未配置真实签名发布端点，不能检查 stable 更新",
        })
      }
      const checked = yield* checkForUpdate({
        manifestUrls: runtime.manifestUrls,
        allowedHosts: runtime.allowedHosts,
        trustedKeys: runtime.trustedKeys,
        novaWayVersion:
          process.env.POWERSNEXUS_NOVAWAY_VERSION ??
          (InstallationVersion === "local" ? packageJson.version : InstallationVersion),
        readRemote: runtime.readRemote,
      }).pipe(
        Effect.catch((cause) =>
          Ref.set(state, {
            ...runtime,
            lastCheckedAt: new Date().toISOString(),
            lastErrorCode:
              typeof cause === "object" && cause && "code" in cause && typeof cause.code === "string"
                ? cause.code
                : "INTERNAL_WORKFLOW_ERROR",
          }).pipe(Effect.andThen(Effect.fail(cause))),
        ),
      )
      const next = { ...runtime, checked, lastCheckedAt: checked.checkedAt, lastErrorCode: undefined }
      yield* Ref.set(state, next)
      return yield* status()
    })

    const install = Effect.fnUntraced(function* (request: MutationRequest & { targetDigest: string }) {
      const runtime = yield* getRuntime
      const replayed = yield* runtime.store.replayInstall(request)
      if (replayed) return replayed
      if (!runtime.checked || runtime.checked.manifest.artifactSha256 !== request.targetDigest) {
        return yield* new VersionServiceError({
          code: "UPDATE_ARTIFACT_INVALID",
          message: "安装目标必须来自当前已验证的 Manifest",
        })
      }
      yield* installCheckedUpdate({
        checked: runtime.checked,
        allowedHosts: runtime.allowedHosts,
        root: runtime.root,
        readRemote: runtime.readRemote,
        versionStore: runtime.store,
      }).pipe(Effect.provideService(FileSystem.FileSystem, fs), Effect.provideService(AppProcess.Service, appProcess))
      return yield* runtime.store.recordInstalled(request)
    })

    return Service.of({
      init: () => wrap(getRuntime.pipe(Effect.asVoid), "初始化 PowersNexus 版本服务失败"),
      status: () => wrap(status(), "读取 PowersNexus 版本状态失败"),
      select: () => wrap(status().pipe(Effect.map((value) => value.active)), "选择 PowersNexus 版本失败"),
      check: () => wrap(check(), "检查 PowersNexus 更新失败"),
      install: (request) => wrap(install(request), "安装 PowersNexus 更新失败"),
      activate: (request) =>
        wrap(getRuntime.pipe(Effect.flatMap((runtime) => runtime.store.activate(request))), "激活失败"),
      rollback: (request) =>
        wrap(getRuntime.pipe(Effect.flatMap((runtime) => runtime.store.rollback(request))), "回滚失败"),
    })
  }),
)

export const defaultLayer: Layer.Layer<Service> = layer.pipe(
  Layer.provide(Config.defaultLayer),
  Layer.provide(AppProcess.defaultLayer),
  Layer.provide(NodeFileSystem.layer),
  Layer.provide(FetchHttpClient.layer),
)

export * as PowersNexusVersion from "./version-service"
