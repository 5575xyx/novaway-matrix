import { describe, expect, test } from "bun:test"
import { renderSkillFile, skillSlug, yamlString } from "@/tool/skill-install"

describe("skill_install helpers", () => {
  test("slugs names like the settings importer", () => {
    expect(skillSlug("My Skill")).toBe("my-skill")
    expect(skillSlug("  Deploy_Tool.v2  ")).toBe("deploy_tool.v2")
    expect(skillSlug("---")).toBeUndefined()
    expect(skillSlug("")).toBeUndefined()
    expect(skillSlug("中文技能")).toBeUndefined()
  })

  test("quotes yaml values so colons and quotes are safe", () => {
    expect(yamlString('Use when: "x" is set')).toBe('"Use when: \\"x\\" is set"')
    expect(yamlString("line1\nline2")).toBe('"line1 line2"')
    expect(yamlString("  padded  ")).toBe('"padded"')
  })

  test("renders frontmatter followed by the body", () => {
    const text = renderSkillFile({
      name: "deploy",
      description: "Deploy the app",
      content: "# Steps\n1. build\n",
    })
    expect(text).toBe(
      ["---", 'name: "deploy"', 'description: "Deploy the app"', "---", "", "# Steps", "1. build", ""].join("\n"),
    )
  })

  test("adds when_to_use when provided and skips it when blank", () => {
    const withHint = renderSkillFile({
      name: "a",
      description: "d",
      content: "c",
      whenToUse: "When deploying",
    })
    expect(withHint).toContain('when_to_use: "When deploying"')

    const without = renderSkillFile({ name: "a", description: "d", content: "c", whenToUse: "   " })
    expect(without).not.toContain("when_to_use")
  })
})

describe("skill_install frontmatter round-trip", () => {
  test("the rendered file parses with the real skill parser", async () => {
    const { ConfigMarkdown } = await import("@/config/markdown")
    const { renderSkillFile } = await import("@/tool/skill-install")
    const { writeFile, mkdtemp, rm } = await import("node:fs/promises")
    const os = await import("node:os")
    const path = await import("node:path")

    const dir = await mkdtemp(path.join(os.tmpdir(), "novaway-skill-"))
    const file = path.join(dir, "SKILL.md")
    try {
      await writeFile(
        file,
        renderSkillFile({
          name: "deploy-app",
          description: 'Use when deploying: "prod" or staging',
          content: "# Deploy\n\nRun the pipeline.",
          whenToUse: "When the user asks to ship",
        }),
        "utf8",
      )
      const md = await ConfigMarkdown.parse(file)
      expect(md.data.name).toBe("deploy-app")
      expect(md.data.description).toBe('Use when deploying: "prod" or staging')
      expect(md.data.when_to_use).toBe("When the user asks to ship")
      expect(md.content).toContain("Run the pipeline.")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
