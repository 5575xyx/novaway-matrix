import { describe, expect, test } from "bun:test"
import { classifyMemoryDomain, domainLabel, resolveMemoryDomain } from "../../src/memory/domain"

describe("memory domain", () => {
  test("labels", () => {
    expect(domainLabel("office")).toBe("\u529e\u516c")
    expect(domainLabel("coding")).toBe("\u7f16\u7a0b")
  })

  test("resolve prefers explicit domain", () => {
    expect(resolveMemoryDomain({ domain: "ops", content: "weekly report" })).toBe("ops")
  })

  test("classify personal vs office", () => {
    expect(classifyMemoryDomain("I prefer working at night")).toBe("personal")
    expect(classifyMemoryDomain("meeting minutes template for tomorrow")).toBe("office")
  })
})
