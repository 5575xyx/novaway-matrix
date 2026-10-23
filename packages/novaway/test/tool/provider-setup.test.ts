import { describe, expect, test } from "bun:test"
import { baseURLVariants, probeURL } from "@/tool/provider-setup"

describe("provider_setup variants", () => {
  test("keeps the original url first", () => {
    expect(baseURLVariants("https://api.deepseek.com")[0]).toBe("https://api.deepseek.com")
  })

  test("adds /v1 when the url has no version", () => {
    expect(baseURLVariants("https://api.example.com")).toContain("https://api.example.com/v1")
  })

  test("does not double-append a version", () => {
    const variants = baseURLVariants("https://api.example.com/v1")
    expect(variants).toContain("https://api.example.com/v1")
    expect(variants.some((item) => item.endsWith("/v1/v1"))).toBe(false)
    expect(variants).toContain("https://api.example.com")
  })

  test("strips a trailing /chat/completions", () => {
    expect(baseURLVariants("https://api.example.com/v1/chat/completions")).toContain("https://api.example.com/v1")
  })

  test("trims trailing slashes and de-duplicates", () => {
    const variants = baseURLVariants("https://api.example.com/v1/")
    expect(variants.every((item) => !item.endsWith("/"))).toBe(true)
    expect(new Set(variants).size).toBe(variants.length)
  })

  test("returns nothing for an empty value", () => {
    expect(baseURLVariants("   ")).toEqual([])
  })
})

describe("provider_setup probe", () => {
  test("reports ok and model samples for a successful endpoint", async () => {
    const original = globalThis.fetch
    globalThis.fetch = (async (input: any) => {
      expect(String(input)).toBe("https://api.example.com/models")
      return new Response(JSON.stringify({ data: [{ id: "a" }, { id: "b" }] }), { status: 200 })
    }) as unknown as typeof fetch
    try {
      const result = await probeURL("https://api.example.com", "secret")
      expect(result.ok).toBe(true)
      expect(result.status).toBe(200)
      expect(result.models).toEqual(["a", "b"])
    } finally {
      globalThis.fetch = original
    }
  })

  test("keeps the http status and trims the error body", async () => {
    const original = globalThis.fetch
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: { message: "invalid api key" } }), {
        status: 401,
      })) as unknown as typeof fetch
    try {
      const result = await probeURL("https://api.example.com", "bad")
      expect(result.ok).toBe(false)
      expect(result.status).toBe(401)
      expect(result.error).toContain("invalid api key")
    } finally {
      globalThis.fetch = original
    }
  })

  test("never returns the api key", async () => {
    const original = globalThis.fetch
    globalThis.fetch = (async () => new Response("boom", { status: 500 })) as unknown as typeof fetch
    try {
      const result = await probeURL("https://api.example.com", "super-secret-key")
      expect(JSON.stringify(result)).not.toContain("super-secret-key")
    } finally {
      globalThis.fetch = original
    }
  })

  test("surfaces network errors without throwing", async () => {
    const original = globalThis.fetch
    globalThis.fetch = (async () => {
      throw new Error("getaddrinfo ENOTFOUND")
    }) as unknown as typeof fetch
    try {
      const result = await probeURL("https://nope.invalid", "k")
      expect(result.status).toBe(0)
      expect(result.error).toContain("ENOTFOUND")
    } finally {
      globalThis.fetch = original
    }
  })
})
