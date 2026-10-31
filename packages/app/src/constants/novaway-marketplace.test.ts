import { describe, expect, test } from "bun:test"
import { NOVAWAY_MARKETPLACE_ENTRIES } from "./novaway-marketplace"
import { dict as en } from "@/i18n/en"
import { dict as zh } from "@/i18n/zh"

describe("constants.novaway-marketplace", () => {
  test("entries have a name, an https source and an install kind", () => {
    expect(NOVAWAY_MARKETPLACE_ENTRIES.length).toBeGreaterThan(0)
    for (const entry of NOVAWAY_MARKETPLACE_ENTRIES) {
      expect(entry.name.length).toBeGreaterThan(0)
      expect(entry.url.startsWith("https://")).toBe(true)
      expect(["git", "zip"]).toContain(entry.kind)
      // git 条目必须能定位到子目录，否则会装整个仓库（ppt-master 是 142MB）
      if (entry.kind === "git") expect(entry.subdir ?? entry.ref).toBeTruthy()
    }
  })

  test("names are unique", () => {
    const names = NOVAWAY_MARKETPLACE_ENTRIES.map((entry) => entry.name)
    expect(new Set(names).size).toBe(names.length)
  })

  test("localized descriptions exist", () => {
    for (const entry of NOVAWAY_MARKETPLACE_ENTRIES) {
      if (!entry.descriptionKey) continue
      expect(en[entry.descriptionKey as keyof typeof en]).toBeTruthy()
      expect(zh[entry.descriptionKey as keyof typeof zh]).toBeTruthy()
    }
  })

  test("ppt-master installs the skills subdirectory of the pinned ref", () => {
    const entry = NOVAWAY_MARKETPLACE_ENTRIES.find((item) => item.name === "ppt-master")
    expect(entry?.url).toBe("https://github.com/hugohe3/ppt-master")
    expect(entry?.subdir).toBe("skills")
    expect(entry?.kind).toBe("git")
  })
})
