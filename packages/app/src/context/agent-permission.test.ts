import { describe, expect, test } from "bun:test"
import { DEFAULT_AGENT } from "./agent-permission"

describe("default agent", () => {
  test("uses Creova", () => {
    expect(DEFAULT_AGENT).toBe("creova")
  })
})
