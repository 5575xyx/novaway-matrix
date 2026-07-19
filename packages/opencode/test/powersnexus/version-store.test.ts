import { expect } from "bun:test"
import path from "node:path"
import { NodeFileSystem } from "@effect/platform-node"
import { Effect, FileSystem } from "effect"
import { testEffect } from "../lib/effect"
import { TestInstance } from "../fixture/fixture"
import { make } from "../../src/powersnexus/version-store"

const it = testEffect(NodeFileSystem.layer)

function version(directory: string, digest: string, source: "bundled" | "downloaded" = "downloaded") {
  return {
    version: digest.startsWith("a") ? "6.1.0" : "6.2.0",
    protocolVersion: "1.0",
    digest,
    source,
    compatible: true,
    verified: true,
    cliPath: path.join(directory, "src", "cli", "powersnexus-cli.js"),
  } as const
}

it.instance("active.json 损坏或缺失时回退到 bundled", () =>
  Effect.gen(function* () {
    const tmp = yield* TestInstance
    const fs = yield* FileSystem.FileSystem
    const bundled = version(tmp.directory, "a".repeat(64), "bundled")
    const store = yield* make({
      root: path.join(tmp.directory, "store"),
      bundled,
      hasActiveRuns: Effect.succeed(false),
    })

    expect((yield* store.status()).active.digest).toBe(bundled.digest)
    yield* fs.makeDirectory(path.join(tmp.directory, "store"), { recursive: true })
    yield* fs.writeFileString(path.join(tmp.directory, "store", "active.json"), "{broken")
    expect((yield* store.status()).active.digest).toBe(bundled.digest)
  }),
)

it.instance("active 指针丢失时优先选择最近成功且仍兼容的本地版本", () =>
  Effect.gen(function* () {
    const tmp = yield* TestInstance
    const fs = yield* FileSystem.FileSystem
    const root = path.join(tmp.directory, "store")
    const bundled = version(tmp.directory, "a".repeat(64), "bundled")
    const successful = version(path.join(root, "versions", `6.2.0-${"b".repeat(64)}`), "b".repeat(64))
    const store = yield* make({ root, bundled, hasActiveRuns: Effect.succeed(false) })
    yield* store.register(successful)
    yield* store.markSuccessful(successful.digest)
    yield* fs.writeFileString(
      path.join(root, "active.json"),
      JSON.stringify({
        schemaVersion: "1",
        activeDigest: "c".repeat(64),
        failedDigests: [],
        requests: [],
        updatedAt: new Date().toISOString(),
      }),
    )

    expect((yield* store.status()).active.digest).toBe(successful.digest)
  }),
)

it.instance("注册已验证版本并用 expectedActiveDigest 原子激活和回滚", () =>
  Effect.gen(function* () {
    const tmp = yield* TestInstance
    const root = path.join(tmp.directory, "store")
    const bundled = version(tmp.directory, "a".repeat(64), "bundled")
    const downloaded = version(path.join(root, "versions", `6.2.0-${"b".repeat(64)}`), "b".repeat(64))
    const store = yield* make({ root, bundled, hasActiveRuns: Effect.succeed(false) })

    yield* store.register(downloaded)
    const activated = yield* store.activate({
      requestID: "request-activate-001",
      targetDigest: downloaded.digest,
      expectedActiveDigest: bundled.digest,
    })
    expect(activated.status).toBe("activated")
    expect((yield* store.status()).previous?.digest).toBe(bundled.digest)

    const replay = yield* store.activate({
      requestID: "request-activate-001",
      targetDigest: downloaded.digest,
      expectedActiveDigest: bundled.digest,
    })
    expect(replay.replayed).toBe(true)

    const rolledBack = yield* store.rollback({
      requestID: "request-rollback-001",
      expectedActiveDigest: downloaded.digest,
    })
    expect(rolledBack.active.digest).toBe(bundled.digest)
  }),
)

it.instance("安装请求持久幂等并拒绝相同 requestID 指向不同 digest", () =>
  Effect.gen(function* () {
    const tmp = yield* TestInstance
    const root = path.join(tmp.directory, "store")
    const bundled = version(tmp.directory, "a".repeat(64), "bundled")
    const downloaded = version(path.join(root, "versions", `6.2.0-${"b".repeat(64)}`), "b".repeat(64))
    const store = yield* make({ root, bundled, hasActiveRuns: Effect.succeed(false) })
    yield* store.register(downloaded)
    const request = {
      requestID: "request-install-001",
      targetDigest: downloaded.digest,
      expectedActiveDigest: bundled.digest,
    }
    expect((yield* store.recordInstalled(request)).replayed).toBe(false)
    expect((yield* store.replayInstall(request))?.replayed).toBe(true)
    expect((yield* store.recordInstalled(request)).replayed).toBe(true)
    expect(
      (
        yield* Effect.exit(
          store.replayInstall({ ...request, targetDigest: "c".repeat(64) }),
        )
      )._tag,
    ).toBe("Failure")
  }),
)

it.instance("活动工作流时延迟激活，并拒绝过期 optimistic lock", () =>
  Effect.gen(function* () {
    const tmp = yield* TestInstance
    const root = path.join(tmp.directory, "store")
    const bundled = version(tmp.directory, "a".repeat(64), "bundled")
    const downloaded = version(path.join(root, "versions", `6.2.0-${"b".repeat(64)}`), "b".repeat(64))
    const busy = yield* make({ root, bundled, hasActiveRuns: Effect.succeed(true) })
    yield* busy.register(downloaded)

    const deferred = yield* busy.activate({
      requestID: "request-deferred-001",
      targetDigest: downloaded.digest,
      expectedActiveDigest: bundled.digest,
    })
    expect(deferred.status).toBe("deferred")
    expect((yield* busy.status()).activationDeferred).toBe(true)

    const conflict = yield* Effect.exit(
      busy.activate({
        requestID: "request-conflict-001",
        targetDigest: downloaded.digest,
        expectedActiveDigest: "c".repeat(64),
      }),
    )
    expect(conflict._tag).toBe("Failure")
  }),
)

it.instance("新版本首次初始化失败后自动回滚，重启后不再选择失败 digest", () =>
  Effect.gen(function* () {
    const tmp = yield* TestInstance
    const root = path.join(tmp.directory, "store")
    const bundled = version(tmp.directory, "a".repeat(64), "bundled")
    const downloaded = version(path.join(root, "versions", `6.2.0-${"b".repeat(64)}`), "b".repeat(64))
    const store = yield* make({ root, bundled, hasActiveRuns: Effect.succeed(false) })
    yield* store.register(downloaded)
    yield* store.activate({
      requestID: "request-failing-activate",
      targetDigest: downloaded.digest,
      expectedActiveDigest: bundled.digest,
    })

    expect((yield* store.markInitializationFailed(downloaded.digest)).digest).toBe(bundled.digest)
    expect((yield* store.status()).active.digest).toBe(bundled.digest)

    const restarted = yield* make({ root, bundled, hasActiveRuns: Effect.succeed(false) })
    expect((yield* restarted.status()).active.digest).toBe(bundled.digest)
  }),
)

it.instance("并发激活基于同一 active digest 时仅允许一个请求成功", () =>
  Effect.gen(function* () {
    const tmp = yield* TestInstance
    const root = path.join(tmp.directory, "store")
    const bundled = version(tmp.directory, "a".repeat(64), "bundled")
    const first = version(path.join(root, "versions", `6.2.0-${"b".repeat(64)}`), "b".repeat(64))
    const second = version(path.join(root, "versions", `6.2.0-${"c".repeat(64)}`), "c".repeat(64))
    const store = yield* make({ root, bundled, hasActiveRuns: Effect.succeed(false) })
    yield* store.register(first)
    yield* store.register(second)
    const results = yield* Effect.all(
      [
        store
          .activate({
            requestID: "request-concurrent-first",
            targetDigest: first.digest,
            expectedActiveDigest: bundled.digest,
          })
          .pipe(Effect.exit),
        store
          .activate({
            requestID: "request-concurrent-second",
            targetDigest: second.digest,
            expectedActiveDigest: bundled.digest,
          })
          .pipe(Effect.exit),
      ],
      { concurrency: "unbounded" },
    )

    expect(results.filter((result) => result._tag === "Success")).toHaveLength(1)
    expect(results.filter((result) => result._tag === "Failure")).toHaveLength(1)
  }),
)
