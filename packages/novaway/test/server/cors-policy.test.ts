import { describe, expect, test } from "bun:test"
import { isAllowedCorsOrigin } from "../../src/server/cors"

describe("cors policy", () => {
  test("allows the console origins", () => {
    expect(isAllowedCorsOrigin("https://novaway.ai")).toBe(true)
    expect(isAllowedCorsOrigin("https://app.novaway.ai")).toBe(true)
    expect(isAllowedCorsOrigin("https://dev.novaway.ai")).toBe(true)
  })

  test("allows local dev servers", () => {
    expect(isAllowedCorsOrigin("http://localhost:3000")).toBe(true)
    expect(isAllowedCorsOrigin("http://127.0.0.1:5173")).toBe(true)
  })

  test("rejects unknown origins unless explicitly configured", () => {
    expect(isAllowedCorsOrigin("https://evil.example")).toBe(false)
    expect(isAllowedCorsOrigin("https://evil.example", { cors: ["https://evil.example"] })).toBe(true)
  })
})
