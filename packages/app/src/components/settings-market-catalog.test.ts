import { describe, expect, test } from "bun:test"
import { createMemo, createRoot } from "solid-js"
import { MARKET_CATEGORIES, MARKET_TYPES, marketTypesOf, updateAvailable } from "./settings-market-model"

const source = await Bun.file(new URL("./settings-market-catalog.tsx", import.meta.url)).text()
const transpiler = new Bun.Transpiler({ loader: "ts" })
// Execute the component's actual memo declarations in their original order.
// This catches eager Solid initialization errors without mocking JSX or app providers.
const declarations = transpiler.transformSync(
  source.slice(source.indexOf("function arrayValue"), source.indexOf("function updatePreviewValue")) +
    source.slice(source.indexOf("  const installedNames ="), source.indexOf("  const compatibilityLabelOf =")),
)

type Entry = { name: string; sourceId?: string }
type Source = { id: string; type: string }

function initialize(input: { entries: Entry[]; sources?: Source[]; installed?: unknown; updates?: unknown }) {
  const dependencies = {
    createMemo,
    MARKET_CATEGORIES,
    MARKET_TYPES,
    marketTypesOf,
    updateAvailable,
    store: { novaway: input.entries, sources: input.sources, installed: input.installed, updates: input.updates },
    language: { intl: () => "en-US" },
    search: () => "",
    category: () => "all",
    typeFilter: () => "all",
    sourceFilter: () => "all",
    sort: () => "featured",
  }
  return createRoot((dispose) => {
    const result = new Function(...Object.keys(dependencies), `${declarations}\nreturn visibleEntries()`)(
      ...Object.values(dependencies),
    ) as Entry[]
    dispose()
    return result
  })
}

describe("marketplace catalog initialization", () => {
  test("renders multiple bundled entries before API collections arrive", () => {
    const entries = initialize({ entries: [{ name: "Z bundled" }, { name: "A bundled" }] })
    expect(entries.length).toBe(2)
    expect(entries.map((entry) => entry.name)).toEqual(["A bundled", "Z bundled"])
  })

  test("sorts official and compatible sources ahead of community entries", () => {
    const entries = initialize({
      entries: [
        { name: "A community", sourceId: "custom" },
        { name: "B zcode", sourceId: "zcode" },
        { name: "C claude", sourceId: "claude" },
        { name: "D official", sourceId: "novaway-official" },
      ],
      sources: [
        { id: "custom", type: "auto" },
        { id: "zcode", type: "zcode" },
        { id: "claude", type: "claude" },
        { id: "novaway-official", type: "auto" },
      ],
    })
    expect(entries.map((entry) => entry.sourceId)).toEqual(["novaway-official", "claude", "zcode", "custom"])
  })

  test("handles missing and invalid API collections while ranking updates", () => {
    expect(initialize({ entries: [] })).toEqual([])
    expect(
      initialize({
        entries: [{ name: "A current" }, { name: "Z outdated" }],
        installed: null,
        updates: [{ name: "Z outdated", state: "outdated" }],
      }).map((entry) => entry.name),
    ).toEqual(["Z outdated", "A current"])
    expect(initialize({ entries: [{ name: "B" }, { name: "A" }], installed: {}, updates: null })).toEqual([
      { name: "A" },
      { name: "B" },
    ])
  })
})
