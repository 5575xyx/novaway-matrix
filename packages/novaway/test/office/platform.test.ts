import { describe, expect, test } from "bun:test"
import { officeSeedWorkflows } from "../../src/office/platform"

describe("office platform seed workflows", () => {
  test("seeds three differentiated office workflows", () => {
    const now = 1_700_000_000_000
    const seeds = officeSeedWorkflows(now)

    expect(seeds.map((item) => item.id)).toEqual([
      "sales-weekly-report",
      "competitor-watch",
      "batch-file-cleanup",
    ])
    expect(
      seeds.every(
        (item) =>
          item.version === 1 && item.enabled === true && item.createdAt === now && item.updatedAt === now,
      ),
    ).toBe(true)
    expect(seeds.find((item) => item.id === "competitor-watch")?.browser.enabled).toBe(true)
    expect(seeds.some((item) => item.connectors.includes("tencent-docs"))).toBe(true)
    expect(seeds.some((item) => item.prompt.includes("{source_path}") && item.prompt.includes("{output_dir}"))).toBe(true)
    expect(seeds.some((item) => item.prompt.includes("{target_urls}"))).toBe(true)
  })
})
