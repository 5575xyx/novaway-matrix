import { describe, expect, test } from "bun:test"
import { MCP_DEFER_THRESHOLD_TOKENS, shouldDeferMcpTools } from "../../src/tool/mcp-defer"

describe("tool.mcp-defer", () => {
  test("auto-defers once the MCP schema reaches the threshold", () => {
    expect(shouldDeferMcpTools({ schemaTokens: MCP_DEFER_THRESHOLD_TOKENS })).toBe(true)
    expect(shouldDeferMcpTools({ schemaTokens: MCP_DEFER_THRESHOLD_TOKENS + 1 })).toBe(true)
  })

  test("keeps small MCP tool sets eager", () => {
    expect(shouldDeferMcpTools({ schemaTokens: MCP_DEFER_THRESHOLD_TOKENS - 1 })).toBe(false)
  })

  test("explicit configuration wins over the size heuristic", () => {
    expect(shouldDeferMcpTools({ configured: false, schemaTokens: 1_000_000 })).toBe(false)
    expect(shouldDeferMcpTools({ configured: true, schemaTokens: 0 })).toBe(true)
  })
})
