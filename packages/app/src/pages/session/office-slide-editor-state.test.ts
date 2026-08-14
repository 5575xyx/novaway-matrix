import { describe, expect, test } from "bun:test"
import type { OfficeSlide } from "./office-artifact"
import { addOfficeSlide, moveOfficeSlide, removeOfficeSlide } from "./office-slide-editor-state"

function slides(): OfficeSlide[] {
  return [
    { index: 1, title: "封面", content: "- 标题" },
    { index: 2, title: "正文", content: "- 内容" },
    { index: 3, title: "总结", content: "- 行动" },
  ]
}

describe("office slide editor state", () => {
  test("adds a slide after the current deck", () => {
    const next = addOfficeSlide(slides())
    expect(next).toHaveLength(4)
    expect(next.at(-1)).toMatchObject({ index: 4, title: "第 4 页", content: "" })
  })

  test("removes a slide and renumbers the deck", () => {
    const next = removeOfficeSlide(slides(), 1)
    expect(next.map((slide) => slide.title)).toEqual(["封面", "总结"])
    expect(next.map((slide) => slide.index)).toEqual([1, 2])
  })

  test("keeps at least one slide", () => {
    const only = [slides()[0]]
    expect(removeOfficeSlide(only, 0)).toBe(only)
  })

  test("moves a slide up and down", () => {
    expect(moveOfficeSlide(slides(), 1, -1).map((slide) => slide.title)).toEqual(["正文", "封面", "总结"])
    expect(moveOfficeSlide(slides(), 0, 1).map((slide) => slide.title)).toEqual(["正文", "封面", "总结"])
    expect(moveOfficeSlide(slides(), 1, 1).map((slide) => slide.title)).toEqual(["封面", "总结", "正文"])
  })

  test("keeps page assets when moving slides", () => {
    const deck = slides()
    deck[0] = { ...deck[0], assets: ["docs/plan.md"] }
    expect(moveOfficeSlide(deck, 0, 1)[1].assets).toEqual(["docs/plan.md"])
  })
})
