import { describe, expect, test } from "bun:test"
import { COLLECTION_TEMPLATES, findTemplate, templateCases } from "@/knowledge/templates"

describe("knowledge.templates", () => {
  test("exposes stable template ids", () => {
    expect(COLLECTION_TEMPLATES.length).toBeGreaterThanOrEqual(5)
    expect(findTemplate("runbook")?.name).toBe("运维手册")
    expect(findTemplate("nope")).toBeUndefined()
  })

  test("expands examples to real documents", () => {
    const template = findTemplate("runbook")!
    const cases = templateCases(template, [{ id: "d1", title: "Deploy" }])
    expect(cases).toHaveLength(2)
    expect(cases[0].query).toBe("Deploy 怎么回滚")
    expect(cases[0].expected).toEqual(["d1"])
    expect(cases[0].notes).toContain("运维手册")
  })

  test("returns nothing without documents", () => {
    const template = findTemplate("faq")!
    expect(templateCases(template, [])).toEqual([])
  })

  test("caps at three documents", () => {
    const template = findTemplate("product")!
    const documents = Array.from({ length: 6 }, (_, index) => ({ id: "d" + index, title: "Doc " + index }))
    expect(templateCases(template, documents)).toHaveLength(6)
  })
})

describe("template samples", () => {
  test("every template ships a sample document", () => {
    for (const template of COLLECTION_TEMPLATES) {
      expect(template.sample.title.length).toBeGreaterThan(0)
      expect(template.sample.content.length).toBeGreaterThan(80)
    }
  })

  test("sample content differs per template", () => {
    const titles = new Set(COLLECTION_TEMPLATES.map((item) => item.sample.title))
    expect(titles.size).toBe(COLLECTION_TEMPLATES.length)
  })
})
