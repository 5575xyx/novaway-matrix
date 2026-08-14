import { describe, expect, test } from "bun:test"
import { createOfficeSlideRevisionPrompt } from "./office-slide-revise"

const slide = {
  index: 3,
  title: "核心方案",
  content: "- 三步落地路径\n- 负责人：产品组\n- 截止时间：下周",
}

describe("createOfficeSlideRevisionPrompt", () => {
  test("builds a polish prompt that keeps the page viewpoint", () => {
    const prompt = createOfficeSlideRevisionPrompt(slide, "polish")

    expect(prompt).toContain("第 3 页")
    expect(prompt).toContain("核心方案")
    expect(prompt).toContain("当前页面内容")
    expect(prompt).toContain("润色")
    expect(prompt).toContain("保持页面观点")
  })

  test("builds a regenerate prompt scoped to one slide", () => {
    const prompt = createOfficeSlideRevisionPrompt(slide, "regenerate")

    expect(prompt).toContain("重新生成这一页")
    expect(prompt).toContain("只输出这一页")
    expect(prompt).toContain("保持整份 PPT 的主线和风格")
  })
})
