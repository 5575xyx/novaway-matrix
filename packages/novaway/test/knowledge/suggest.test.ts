import { describe, expect, test } from "bun:test"
import { suggestCases } from "@/knowledge/suggest"

const doc = (id: string, title: string, content: string) => ({ id, title, content })

describe("knowledge.suggest", () => {
  test("uses a descriptive title as the query", () => {
    const cases = suggestCases([
      doc(
        "d1",
        "Deployment Runbook.md",
        "Deploy workers with the release script. Rollback restores the previous release.",
      ),
    ])
    expect(cases).toHaveLength(1)
    expect(cases[0].query).toBe("Deployment Runbook")
    expect(cases[0].expected).toEqual(["d1"])
    expect(cases[0].reason).toBe("title")
  })

  test("falls back to distinctive terms for weak titles", () => {
    const cases = suggestCases([
      doc("d1", "readme", "Kubernetes ingress controller configures TLS termination for internal services."),
      doc("d2", "notes", "Billing invoices and refunds for enterprise customers are generated nightly."),
    ])
    expect(cases).toHaveLength(2)
    expect(cases[0].reason).toBe("terms")
    expect(cases[0].query.length).toBeGreaterThan(0)
    // 两篇文档的查询不能重复
    expect(cases[0].query).not.toBe(cases[1].query)
  })

  test("skips very short documents", () => {
    expect(suggestCases([doc("d1", "Tiny", "too short")])).toEqual([])
  })

  test("deduplicates identical titles", () => {
    const cases = suggestCases([
      doc("d1", "Release Notes", "alpha release notes content that is long enough to index."),
      doc("d2", "Release Notes", "beta release notes content that is also long enough to index."),
    ])
    expect(cases.filter((item) => item.query === "Release Notes")).toHaveLength(1)
  })

  test("respects the limit", () => {
    const documents = Array.from({ length: 30 }, (_, index) =>
      doc("d" + index, "Document number " + index, "unique term" + index + " body content long enough to index."),
    )
    expect(suggestCases(documents, 5)).toHaveLength(5)
  })
})
