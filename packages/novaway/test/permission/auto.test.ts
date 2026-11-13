import { describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { Provider } from "@/provider/provider"
import { PermissionAuto } from "@/permission/auto"
import { ProviderTest } from "../fake/provider"

const provider = ProviderTest.fake({
  getLanguage: Effect.fn("TestProvider.getLanguage")(() => Effect.succeed({} as never)),
})

const base = {
  permission: "shell",
  patterns: ["echo hello"],
  metadata: { command: "echo hello" },
  cwd: "/workspace",
}

describe("auto permission classifier", () => {
  test("returns an allow decision from the mocked model", async () => {
    const decision = await Effect.runPromise(
      PermissionAuto.classify(base, async () => ({ text: '{"action":"allow","reason":"安全的只读命令"}' })).pipe(
        Effect.provide(provider.layer),
      ),
    )
    expect(decision).toEqual({ action: "allow", reason: "安全的只读命令" })
  })

  test("returns a deny decision from the mocked model", async () => {
    const decision = await Effect.runPromise(
      PermissionAuto.classify(base, async () => ({ text: '{"action":"deny","reason":"存在破坏性风险"}' })).pipe(
        Effect.provide(provider.layer),
      ),
    )
    expect(decision).toEqual({ action: "deny", reason: "存在破坏性风险" })
  })

  test("fails closed when generation or parsing fails", async () => {
    const unavailable = await Effect.runPromise(
      PermissionAuto.classify(base, async () => Promise.reject(new Error("offline"))).pipe(
        Effect.provide(provider.layer),
      ),
    )
    const invalid = await Effect.runPromise(
      PermissionAuto.classify(base, async () => ({ text: "not json" })).pipe(Effect.provide(provider.layer)),
    )
    expect(unavailable).toBeUndefined()
    expect(invalid).toBeUndefined()
  })

  test("falls back to user confirmation after the denial limit", () => {
    const denied = { action: "deny", reason: "危险" } as const
    expect(PermissionAuto.denialAction({ previous: 0, limit: 3, decision: denied })).toBe("deny")
    expect(PermissionAuto.denialAction({ previous: 2, limit: 3, decision: denied })).toBe("ask")
    expect(PermissionAuto.denialAction({ previous: 0, limit: 3, decision: undefined })).toBe("ask")
    expect(PermissionAuto.denialAction({ previous: 2, limit: 3, decision: { action: "allow", reason: "安全" } })).toBe(
      "allow",
    )
  })

  test("returns undefined when no provider is available", async () => {
    const decision = await Effect.runPromise(
      PermissionAuto.classify(base, async () => ({ text: '{"action":"allow"}' })).pipe(
        Effect.provide(Layer.empty as Layer.Layer<Provider.Service>),
      ),
    )
    expect(decision).toBeUndefined()
  })
})
