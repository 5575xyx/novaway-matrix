import { describe, expect, test } from "bun:test"
import { applyDomainFilters } from "../../src/tool/websearch"

describe("websearch.applyDomainFilters", () => {
  test("returns the query untouched without filters", () => {
    expect(applyDomainFilters("react hooks")).toBe("react hooks")
  })

  test("appends a single allowed domain as site:", () => {
    expect(applyDomainFilters("react hooks", ["react.dev"])).toBe("react hooks site:react.dev")
  })

  test("groups multiple allowed domains with OR", () => {
    expect(applyDomainFilters("react hooks", ["react.dev", "legacy.reactjs.org"])).toBe(
      "react hooks (site:react.dev OR site:legacy.reactjs.org)",
    )
  })

  test("excludes blocked domains with -site:", () => {
    expect(applyDomainFilters("react hooks", undefined, ["pinterest.com", "quora.com"])).toBe(
      "react hooks -site:pinterest.com -site:quora.com",
    )
  })

  test("strips protocol and path from domain values", () => {
    expect(applyDomainFilters("q", ["https://react.dev/docs"])).toBe("q site:react.dev")
  })

  test("ignores empty domain entries", () => {
    expect(applyDomainFilters("q", ["", "  "], [])).toBe("q")
  })
})
