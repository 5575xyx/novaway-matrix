import { describe, expect, test } from "bun:test"
import { officeSceneIsActive } from "./office-scene-switcher"

describe("OfficeSceneSwitcher", () => {
  test("derives the selected state from the current active scene", () => {
    expect(officeSceneIsActive("document", "document")).toBe(true)
    expect(officeSceneIsActive("document", "ppt")).toBe(false)
    expect(officeSceneIsActive("ppt", "document")).toBe(false)
    expect(officeSceneIsActive("ppt", "ppt")).toBe(true)
  })
})
