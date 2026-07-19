import path from "node:path"
import { randomUUID } from "node:crypto"
import { Effect, FileSystem, Schema, Semaphore } from "effect"
import { Sha256, VersionRef, type VersionRef as VersionRefType } from "./schema"

const RequestRecord = Schema.Struct({
  requestID: Schema.String,
  operation: Schema.Literals(["install", "activate", "rollback"]),
  targetDigest: Schema.optional(Sha256),
  expectedActiveDigest: Sha256,
  status: Schema.Literals(["installed", "activated", "deferred", "rolled-back"]),
  activeDigest: Sha256,
})

const ActiveState = Schema.Struct({
  schemaVersion: Schema.Literal("1"),
  activeDigest: Sha256,
  previousDigest: Schema.optional(Sha256),
  deferredDigest: Schema.optional(Sha256),
  failedDigests: Schema.Array(Sha256),
  requests: Schema.Array(RequestRecord),
  updatedAt: Schema.String,
})
type ActiveState = Schema.Schema.Type<typeof ActiveState>

const VersionRecord = Schema.Struct({
  ...VersionRef.fields,
  installedAt: Schema.String,
  lastSuccessfulAt: Schema.optional(Schema.String),
})
type VersionRecord = Schema.Schema.Type<typeof VersionRecord>

function isVersionRecord(version: VersionRefType | VersionRecord): version is VersionRecord {
  return "installedAt" in version
}

export class VersionStoreError extends Schema.TaggedErrorClass<VersionStoreError>()("PowersNexusVersionStoreError", {
  code: Schema.String,
  message: Schema.String,
}) {}

export type MutationRequest = {
  requestID: string
  targetDigest?: string
  expectedActiveDigest: string
}

export type MutationResult = {
  requestID: string
  status: "installed" | "activated" | "deferred" | "rolled-back"
  active: VersionRefType
  target?: VersionRefType
  replayed: boolean
}

export type Status = {
  active: VersionRefType
  bundled: VersionRefType
  previous?: VersionRefType
  installed: VersionRefType[]
  activationDeferred: boolean
}

export type Interface = {
  status: () => Effect.Effect<Status, VersionStoreError>
  register: (version: VersionRefType) => Effect.Effect<void, VersionStoreError>
  replayInstall: (request: MutationRequest & { targetDigest: string }) => Effect.Effect<MutationResult | undefined, VersionStoreError>
  recordInstalled: (request: MutationRequest & { targetDigest: string }) => Effect.Effect<MutationResult, VersionStoreError>
  activate: (request: MutationRequest & { targetDigest: string }) => Effect.Effect<MutationResult, VersionStoreError>
  rollback: (request: MutationRequest) => Effect.Effect<MutationResult, VersionStoreError>
  activateDeferred: () => Effect.Effect<MutationResult | undefined, VersionStoreError>
  markSuccessful: (digest: string) => Effect.Effect<void, VersionStoreError>
  markInitializationFailed: (digest: string) => Effect.Effect<VersionRefType, VersionStoreError>
}

export const make = Effect.fn("PowersNexus.VersionStore.make")(function* (options: {
  root: string
  bundled: VersionRefType
  hasActiveRuns: Effect.Effect<boolean>
}) {
  const fs = yield* FileSystem.FileSystem
  const semaphore = yield* Semaphore.make(1)
  const activePath = path.join(options.root, "active.json")
  const versionsPath = path.join(options.root, "versions")
  const downloadsPath = path.join(options.root, "downloads")
  const logPath = path.join(options.root, "update-log.jsonl")

  const wrap = <A, E, R>(effect: Effect.Effect<A, E, R>, message: string) =>
    effect.pipe(
      Effect.mapError(
        (cause) =>
          cause instanceof VersionStoreError
            ? cause
            : new VersionStoreError({
                code: "INTERNAL_WORKFLOW_ERROR",
                message: cause instanceof Error ? cause.message : message,
              }),
      ),
    )

  const ensure = Effect.fnUntraced(function* () {
    yield* fs.makeDirectory(versionsPath, { recursive: true })
    yield* fs.makeDirectory(downloadsPath, { recursive: true })
  })

  const readState = Effect.fnUntraced(function* () {
    const text = yield* fs.readFileString(activePath).pipe(Effect.catch(() => Effect.succeed(undefined)))
    if (!text) return undefined
    return yield* Effect.try({
      try: () => Schema.decodeUnknownSync(ActiveState)(JSON.parse(text)),
      catch: (cause) => cause,
    }).pipe(Effect.catch(() => Effect.succeed(undefined)))
  })

  const writeState = (state: ActiveState) => atomicWriteJson(fs, activePath, state)

  const readVersion = Effect.fnUntraced(function* (file: string) {
    const text = yield* fs.readFileString(file).pipe(Effect.catch(() => Effect.succeed(undefined)))
    if (!text) return undefined
    return yield* Effect.try({
      try: () => Schema.decodeUnknownSync(VersionRecord)(JSON.parse(text)),
      catch: (cause) => cause,
    }).pipe(Effect.catch(() => Effect.succeed(undefined)))
  })

  const installed = Effect.fnUntraced(function* () {
    yield* ensure()
    const names = yield* fs.readDirectory(versionsPath).pipe(Effect.catch(() => Effect.succeed([])))
    const records = yield* Effect.forEach(names, (name) => readVersion(path.join(versionsPath, name, "version.json")), {
      concurrency: "unbounded",
    })
    const downloaded = records.filter((item): item is VersionRecord => item !== undefined)
    return [options.bundled, ...downloaded]
  })

  const appendLog = Effect.fnUntraced(function* (event: Record<string, unknown>) {
    yield* ensure()
    const line = `${JSON.stringify({ timestamp: new Date().toISOString(), ...event })}\n`
    yield* fs.writeFileString(logPath, line, { flag: "a" })
  })

  const resolveStatus = Effect.fnUntraced(function* () {
    const versions = yield* installed()
    const state = yield* readState()
    const byDigest = new Map(versions.map((version) => [version.digest, version]))
    const selected = state ? byDigest.get(state.activeDigest) : undefined
    const successful = versions
      .filter(
        (version): version is VersionRecord =>
          isVersionRecord(version) &&
          version.verified &&
          version.compatible &&
          Boolean(version.lastSuccessfulAt) &&
          !state?.failedDigests.includes(version.digest),
      )
      .sort((left, right) => (right.lastSuccessfulAt ?? "").localeCompare(left.lastSuccessfulAt ?? ""))
    const active =
      selected?.verified && selected.compatible && !state?.failedDigests.includes(selected.digest)
        ? selected
        : (successful[0] ?? options.bundled)
    const previous = state?.previousDigest ? byDigest.get(state.previousDigest) : undefined
    return {
      active,
      bundled: options.bundled,
      previous,
      installed: versions,
      activationDeferred: Boolean(state?.deferredDigest),
    } satisfies Status
  })

  const initialState = (activeDigest: string): ActiveState => ({
    schemaVersion: "1",
    activeDigest,
    failedDigests: [],
    requests: [],
    updatedAt: new Date().toISOString(),
  })

  const requestConflict = (message: string) =>
    new VersionStoreError({ code: "UPDATE_ACTIVE_VERSION_CONFLICT", message })

  const replay = Effect.fnUntraced(function* (
    state: ActiveState,
    request: MutationRequest,
    operation: "install" | "activate" | "rollback",
  ) {
    const existing = state.requests.find((item) => item.requestID === request.requestID)
    if (!existing) return undefined
    if (
      existing.operation !== operation ||
      existing.targetDigest !== request.targetDigest ||
      existing.expectedActiveDigest !== request.expectedActiveDigest
    ) {
      return yield* requestConflict("相同 requestID 对应了不同更新请求")
    }
    const current = yield* resolveStatus()
    const target = request.targetDigest
      ? current.installed.find((version) => version.digest === request.targetDigest)
      : undefined
    return {
      requestID: request.requestID,
      status: existing.status,
      active: current.installed.find((version) => version.digest === existing.activeDigest) ?? current.active,
      target,
      replayed: true,
    } satisfies MutationResult
  })

  const register = Effect.fn("PowersNexus.VersionStore.register")(function* (version: VersionRefType) {
    if (!version.verified || !version.compatible) {
      return yield* new VersionStoreError({
        code: "UPDATE_VERSION_INCOMPATIBLE",
        message: "只能注册已经完整验证且兼容的版本",
      })
    }
    const decoded = yield* Effect.try({
      try: () => Schema.decodeUnknownSync(VersionRef)(version),
      catch: (cause) => new VersionStoreError({ code: "UPDATE_ARTIFACT_INVALID", message: String(cause) }),
    })
    const directory = path.resolve(decoded.cliPath, "../../..")
    const expectedParent = path.resolve(versionsPath)
    if (decoded.source === "downloaded" && path.dirname(directory) !== expectedParent) {
      return yield* new VersionStoreError({
        code: "PATH_OUTSIDE_WORKTREE",
        message: "下载版本目录不在 Version Store 中",
      })
    }
    yield* fs.makeDirectory(directory, { recursive: true })
    yield* atomicWriteJson(fs, path.join(directory, "version.json"), {
      ...decoded,
      installedAt: new Date().toISOString(),
    })
    yield* appendLog({ type: "version.registered", digest: decoded.digest, version: decoded.version })
  })

  const activateUnlocked = Effect.fnUntraced(function* (request: MutationRequest & { targetDigest: string }) {
    const status = yield* resolveStatus()
    const state = (yield* readState()) ?? initialState(status.active.digest)
    const replayed = yield* replay(state, request, "activate")
    if (replayed) return replayed
    if (request.expectedActiveDigest !== status.active.digest) {
      return yield* requestConflict("active digest 已变化，请刷新后重试")
    }
    const target = status.installed.find((item) => item.digest === request.targetDigest)
    if (!target?.verified || !target.compatible) {
      return yield* new VersionStoreError({ code: "UPDATE_VERSION_INCOMPATIBLE", message: "目标版本不可激活" })
    }
    const busy = yield* options.hasActiveRuns
    const nextStatus: "deferred" | "activated" = busy ? "deferred" : "activated"
    const next: ActiveState = {
      ...state,
      activeDigest: busy ? status.active.digest : target.digest,
      previousDigest: busy ? state.previousDigest : status.active.digest,
      deferredDigest: busy ? target.digest : undefined,
      requests: [
        ...state.requests,
        {
          requestID: request.requestID,
          operation: "activate",
          targetDigest: target.digest,
          expectedActiveDigest: request.expectedActiveDigest,
          status: nextStatus,
          activeDigest: busy ? status.active.digest : target.digest,
        },
      ],
      updatedAt: new Date().toISOString(),
    }
    yield* writeState(next)
    yield* appendLog({ type: `version.${nextStatus}`, requestID: request.requestID, targetDigest: target.digest })
    return {
      requestID: request.requestID,
      status: nextStatus,
      active: busy ? status.active : target,
      target,
      replayed: false,
    } satisfies MutationResult
  })

  const activate = (request: MutationRequest & { targetDigest: string }) =>
    semaphore.withPermits(1)(activateUnlocked(request))

  const replayInstall = (request: MutationRequest & { targetDigest: string }) =>
    semaphore.withPermits(1)(
      Effect.gen(function* () {
        const status = yield* resolveStatus()
        const state = (yield* readState()) ?? initialState(status.active.digest)
        return yield* replay(state, request, "install")
      }),
    )

  const recordInstalled = (request: MutationRequest & { targetDigest: string }) =>
    semaphore.withPermits(1)(
      Effect.gen(function* () {
        const status = yield* resolveStatus()
        const state = (yield* readState()) ?? initialState(status.active.digest)
        const replayed = yield* replay(state, request, "install")
        if (replayed) return replayed
        if (request.expectedActiveDigest !== status.active.digest) {
          return yield* requestConflict("active digest 已变化，请刷新后重试")
        }
        const target = status.installed.find((item) => item.digest === request.targetDigest)
        if (!target?.verified || !target.compatible) {
          return yield* new VersionStoreError({ code: "UPDATE_ARTIFACT_INVALID", message: "安装目标尚未注册" })
        }
        yield* writeState({
          ...state,
          requests: [
            ...state.requests,
            {
              requestID: request.requestID,
              operation: "install",
              targetDigest: target.digest,
              expectedActiveDigest: request.expectedActiveDigest,
              status: "installed",
              activeDigest: status.active.digest,
            },
          ],
          updatedAt: new Date().toISOString(),
        })
        yield* appendLog({ type: "version.installed", requestID: request.requestID, targetDigest: target.digest })
        return {
          requestID: request.requestID,
          status: "installed" as const,
          active: status.active,
          target,
          replayed: false,
        }
      }),
    )

  const rollbackUnlocked = Effect.fnUntraced(function* (request: MutationRequest) {
    const status = yield* resolveStatus()
    const state = (yield* readState()) ?? initialState(status.active.digest)
    const replayed = yield* replay(state, request, "rollback")
    if (replayed) return replayed
    if (request.expectedActiveDigest !== status.active.digest) {
      return yield* requestConflict("active digest 已变化，请刷新后重试")
    }
    const targetDigest = request.targetDigest ?? state.previousDigest ?? options.bundled.digest
    const target = status.installed.find((item) => item.digest === targetDigest) ?? options.bundled
    const next: ActiveState = {
      ...state,
      activeDigest: target.digest,
      previousDigest: status.active.digest,
      deferredDigest: undefined,
      requests: [
        ...state.requests,
        {
          requestID: request.requestID,
          operation: "rollback",
          targetDigest: request.targetDigest,
          expectedActiveDigest: request.expectedActiveDigest,
          status: "rolled-back",
          activeDigest: target.digest,
        },
      ],
      updatedAt: new Date().toISOString(),
    }
    yield* writeState(next)
    yield* appendLog({ type: "version.rolled-back", requestID: request.requestID, targetDigest: target.digest })
    return { requestID: request.requestID, status: "rolled-back" as const, active: target, target, replayed: false }
  })

  const rollback = (request: MutationRequest) => semaphore.withPermits(1)(rollbackUnlocked(request))

  const activateDeferred = () =>
    semaphore.withPermits(1)(
      Effect.gen(function* () {
        if (yield* options.hasActiveRuns) return undefined
        const status = yield* resolveStatus()
        const state = yield* readState()
        if (!state?.deferredDigest) return undefined
        const target = status.installed.find((item) => item.digest === state.deferredDigest)
        if (!target) return yield* new VersionStoreError({ code: "UPDATE_ARTIFACT_INVALID", message: "延迟版本已丢失" })
        const requestID = `deferred:${randomUUID()}`
        const next: ActiveState = {
          ...state,
          activeDigest: target.digest,
          previousDigest: status.active.digest,
          deferredDigest: undefined,
          updatedAt: new Date().toISOString(),
        }
        yield* writeState(next)
        yield* appendLog({ type: "version.activated", requestID, targetDigest: target.digest, deferred: true })
        return { requestID, status: "activated" as const, active: target, target, replayed: false }
      }),
    )

  const markSuccessful = (digest: string) =>
    semaphore.withPermits(1)(
      Effect.gen(function* () {
        const status = yield* resolveStatus()
        const target = status.installed.find((item) => item.digest === digest)
        if (!target || target.source === "bundled") return
        const file = path.join(path.resolve(target.cliPath, "../../.."), "version.json")
        const record = yield* readVersion(file)
        if (!record) return
        yield* atomicWriteJson(fs, file, { ...record, lastSuccessfulAt: new Date().toISOString() })
      }),
    )

  const markInitializationFailed = (digest: string) =>
    semaphore.withPermits(1)(
      Effect.gen(function* () {
        const status = yield* resolveStatus()
        const state = (yield* readState()) ?? initialState(status.active.digest)
        if (status.active.digest !== digest) return status.active
        const fallback = status.previous ?? options.bundled
        yield* writeState({
          ...state,
          activeDigest: fallback.digest,
          previousDigest: undefined,
          deferredDigest: undefined,
          failedDigests: [...new Set([...state.failedDigests, digest])],
          updatedAt: new Date().toISOString(),
        })
        yield* appendLog({ type: "version.initialization-failed", digest, rollbackDigest: fallback.digest })
        return fallback
      }),
    )

  const service: Interface = {
    status: () => wrap(resolveStatus(), "读取版本状态失败"),
    register: (version) => wrap(register(version), "注册版本失败"),
    replayInstall: (request) => wrap(replayInstall(request), "读取安装请求失败"),
    recordInstalled: (request) => wrap(recordInstalled(request), "记录安装请求失败"),
    activate: (request) => wrap(activate(request), "激活版本失败"),
    rollback: (request) => wrap(rollback(request), "回滚版本失败"),
    activateDeferred: () => wrap(activateDeferred(), "延迟激活失败"),
    markSuccessful: (digest) => wrap(markSuccessful(digest), "记录成功版本失败"),
    markInitializationFailed: (digest) => wrap(markInitializationFailed(digest), "初始化回滚失败"),
  }
  return service
})

function atomicWriteJson(fs: FileSystem.FileSystem, file: string, value: unknown) {
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`
  return Effect.scoped(
    Effect.gen(function* () {
      yield* fs.makeDirectory(path.dirname(file), { recursive: true })
      const handle = yield* fs.open(temporary, { flag: "wx", mode: 0o600 })
      yield* handle.writeAll(new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`))
      yield* handle.sync
      yield* fs.rename(temporary, file)
    }),
  ).pipe(Effect.ensuring(fs.remove(temporary, { force: true }).pipe(Effect.catch(() => Effect.void))))
}

export * as PowersNexusVersionStore from "./version-store"
