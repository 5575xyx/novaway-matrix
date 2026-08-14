import type { OfficeSlide } from "./office-artifact"

export function createOfficeSlideRevisionPrompt(slide: OfficeSlide, mode: "polish" | "regenerate") {
  const instruction =
    mode === "polish"
      ? "请只润色这一页的文案、表达和排版建议，保持页面观点和整份 PPT 风格不变。"
      : "请重新生成这一页，保持整份 PPT 的主线和风格，只输出这一页的完整内容。"
  return [
    `请修改当前 PPT 的第 ${slide.index} 页「${slide.title}」。`,
    "",
    "当前页面内容：",
    slide.content,
    "",
    instruction,
  ].join("\n")
}
