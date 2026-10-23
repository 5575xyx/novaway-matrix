import { describe, expect, test } from "bun:test"
import { renderRule, ruleFileName } from "@/tool/rules-manage"

describe("rules_manage helpers", () => {
  test("appends .md to safe names", () => {
    expect(ruleFileName("style")).toBe("style.md")
    expect(ruleFileName("  deploy_rules.v2 ")).toBe("deploy_rules.v2.md")
  })

  test("rejects unsafe names", () => {
    expect(ruleFileName("../escape")).toBeUndefined()
    expect(ruleFileName("a/b")).toBeUndefined()
    expect(ruleFileName("中文")).toBeUndefined()
    expect(ruleFileName("")).toBeUndefined()
    expect(ruleFileName(undefined)).toBeUndefined()
  })

  test("renders frontmatter and body", () => {
    const text = renderRule("# Use TypeScript\nAlways.", "Language preference")
    expect(text.startsWith("---")).toBe(true)
    expect(text).toContain("description: Language preference")
    expect(text).toContain("# Use TypeScript")
    expect(text.trimEnd().endsWith("Always.")).toBe(true)
  })

  test("keeps the body parseable without a description", async () => {
    const { ConfigMarkdown } = await import("@/config/markdown")
    const { mkdtemp, writeFile, rm } = await import("node:fs/promises")
    const os = await import("node:os")
    const path = await import("node:path")
    const dir = await mkdtemp(path.join(os.tmpdir(), "novaway-rule-"))
    const file = path.join(dir, "style.md")
    try {
      await writeFile(file, renderRule("Prefer small diffs.", "Style"), "utf8")
      const md = await ConfigMarkdown.parse(file)
      expect(md.data.description).toBe("Style")
      expect(md.content.trim()).toBe("Prefer small diffs.")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
