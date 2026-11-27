import { describe, expect, test } from "bun:test"
import { agencyDescription, localizeAgencyAgent } from "../../src/agent/agency-localization"

describe("agency localization", () => {
  test("localizes namespaced Agency metadata without changing the id", () => {
    const options = localizeAgencyAgent("agency-agents_academic/academic-anthropologist")
    expect(options?.displayName).toBe("人类学研究员")
    expect(options?.category).toBe("学术研究")
  })

  test("provides a Chinese fallback for a large Agency catalog", () => {
    const options = localizeAgencyAgent("engineering/engineering-frontend-developer")
    expect(String(options?.displayName)).not.toContain("engineering")
    expect(agencyDescription("engineering/engineering-frontend-developer", options)).toContain("工程开发")
  })

  test("does not rewrite ordinary agents", () => {
    expect(localizeAgencyAgent("build", { displayName: "Build" })).toEqual({ displayName: "Build" })
  })
})
