import { describe, expect, test } from "bun:test"
import { compactBytes, formatDate, updateLabel, updateTitle, type InstalledPackage } from "./settings-market-model"

const pkg = (input: Partial<InstalledPackage> & { previous?: InstalledPackage["previous"] }): InstalledPackage => ({
  name: "demo",
  kind: "zip",
  source: "https://example.com/demo.zip",
  root: "/tmp/demo",
  files: 10,
  bytes: 2_048,
  installedAt: Date.parse("2026-03-01T00:00:00Z"),
  ...input,
})

describe("marketplace install history", () => {
  test("first install has no update label", () => {
    expect(updateLabel(pkg({}))).toBeUndefined()
    expect(updateTitle(pkg({}), "en-US")).toBeUndefined()
  })

  test("labels upgrades, downgrades and reinstalls", () => {
    const previous = { source: "https://example.com/demo.zip", installedAt: 1, files: 3, bytes: 100 }
    expect(updateLabel(pkg({ version: "1.3.0", previous: { ...previous, version: "1.2.0" } }))).toBe("1.2.0 → 1.3.0")
    // A reinstall at the same version is still a revision worth showing.
    expect(updateLabel(pkg({ version: "1.3.0", previous: { ...previous, version: "1.3.0" } }))).toBe("reinstalled")
    expect(updateLabel(pkg({ version: "1.3.0", previous }))).toBe("→ 1.3.0")
    expect(updateLabel(pkg({ previous: { ...previous, version: "1.2.0" } }))).toBe("1.2.0 → —")
  })

  test("title explains when and how big the replaced copy was", () => {
    const title = updateTitle(
      pkg({
        version: "1.3.0",
        previous: {
          version: "1.2.0",
          source: "https://cdn/x.zip",
          installedAt: Date.parse("2026-02-01T00:00:00Z"),
          files: 4,
          bytes: 4_608,
        },
      }),
      "en-US",
    )
    expect(title).toContain("previous 1.2.0")
    expect(title).toContain("4 files")
    expect(title).toContain("4.5 KB")
    expect(title).toContain("https://cdn/x.zip")
  })

  test("compactBytes and formatDate stay readable at the edges", () => {
    expect(compactBytes(0)).toBe("0 B")
    expect(compactBytes(999)).toBe("999 B")
    expect(compactBytes(1_536)).toBe("1.5 KB")
    expect(compactBytes(5 * 1_024 * 1_024)).toBe("5.0 MB")
    expect(formatDate(0, "en-US")).toBe("—")
    expect(formatDate(Date.parse("2026-03-01T00:00:00Z"), "en-US")).toContain("2026")
  })
})

import { updateAvailable } from "./settings-market-model"

describe("marketplace updates", () => {
  const installed = (version?: string) => (version ? pkg({ version }) : pkg({}))

  test("flags a newer catalog version", () => {
    expect(updateAvailable(installed("1.2.0"), "1.3.0")).toBe(true)
    expect(updateAvailable(installed("1.10.0"), "1.9.0")).toBe(false)
    expect(updateAvailable(installed("2.0.0"), "2.0.0")).toBe(false)
    expect(updateAvailable(installed("1.2"), "1.2.1")).toBe(true)
  })

  test("stays quiet without version metadata", () => {
    expect(updateAvailable(undefined, "1.0.0")).toBe(false)
    expect(updateAvailable(installed(), "1.0.0")).toBe(false)
    expect(updateAvailable(installed("1.0.0"), undefined)).toBe(false)
  })
})
