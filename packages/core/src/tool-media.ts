/**
 * 工具产出图片的「归属」口径 —— 渲染层（@novaway/ui）和时间线数据层（app）必须一致，
 * 所以放在 core 里当唯一事实来源。
 *
 * 截图类工具（browser_screenshot / computer_screenshot）的图片是**验证证据**，
 * 由时间线统一挂在每轮回复末尾的「验证结果」里；其余工具（read 一张原型图、
 * webfetch 抓到的配图、PDF 页渲染……）的图片只是过程产物，待在工具行里展开看。
 */
export const SCREENSHOT_TOOLS = ["browser_screenshot", "computer_screenshot"] as const

const screenshotTools: ReadonlySet<string> = new Set(SCREENSHOT_TOOLS)

/** 这个工具的图片是否属于「验证证据」（渲染在轮尾而不是工具行内）。 */
export function isScreenshotTool(name: string | undefined): boolean {
  return !!name && screenshotTools.has(name)
}
