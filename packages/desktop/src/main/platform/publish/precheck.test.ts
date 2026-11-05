import { describe, expect, test } from "bun:test"
import { charCount, precheckPublish, PLATFORM_LIMITS, summarizeIssues } from "./precheck"

const base = {
  kind: "image_text" as const,
  title: "周末去露营",
  description: "带上帐篷和咖啡，在湖边坐一下午。",
  filePaths: ["C:/media/1.jpg"],
  tags: ["露营", "周末"],
}

describe("发布前预检", () => {
  test("干净的内容不报任何问题", () => {
    const result = precheckPublish(base, ["xhs"])
    expect(result.ok).toBe(true)
    expect(result.issues.filter((issue) => issue.level !== "hint")).toEqual([])
  })

  test("没有素材 / 视频给了多个文件是硬错误", () => {
    expect(precheckPublish({ ...base, filePaths: [] }, ["douyin"]).ok).toBe(false)
    const multi = precheckPublish({ ...base, kind: "video", filePaths: ["a.mp4", "b.mp4"] }, ["douyin"])
    expect(multi.ok).toBe(false)
    expect(multi.issues.map((issue) => issue.rule)).toContain("video-multiple")
  })

  test("公众号文章没有标题会被拦住（后台不接受空标题）", () => {
    const result = precheckPublish({ ...base, kind: "article", title: "", filePaths: [] }, ["wxGzh"])
    expect(result.ok).toBe(false)
    expect(result.issues.map((issue) => issue.rule)).toContain("wechat-title-required")
    // 同样的内容发小红书只是没有标题，不拦
    expect(precheckPublish({ ...base, title: "" }, ["xhs"]).ok).toBe(true)
  })

  test("极限词 / 引流 / 收益承诺按 warning 报出来并给出原文", () => {
    const result = precheckPublish(
      {
        ...base,
        title: "全网最低价，效果最好",
        description: "加微信 vx123 领券，稳赚不赔",
      },
      ["xhs"],
    )
    expect(result.ok).toBe(true)
    const rules = result.issues.map((issue) => issue.rule)
    expect(rules).toContain("absolute-words")
    expect(rules).toContain("diversion")
    expect(rules).toContain("promise")
    expect(result.issues.some((issue) => issue.evidence === "最好")).toBe(true)
    // 提示要能直接读：原文 + 改法
    expect(summarizeIssues(result.issues)).toContain("（")
  })

  test("「最近」「最后」不该被当成极限词（词表最常见的误报）", () => {
    const result = precheckPublish(
      { ...base, title: "最近在用的三样东西", description: "最后一个是意外之喜。" },
      ["xhs"],
    )
    expect(result.issues.filter((issue) => issue.rule === "absolute-words")).toEqual([])
  })

  test("长度上限按平台分开算，且 emoji 只算一个字", () => {
    const title = "🎉".repeat(20)
    expect(charCount(title)).toBe(20)
    // 小红书 20 字刚好卡在上限
    expect(
      precheckPublish({ ...base, title }, ["xhs"]).issues.some((issue) => issue.rule === "title-too-long:xhs"),
    ).toBe(false)
    // 同样的标题发公众号没问题，但「标题超过 30 字」的通用提示不触发
    const xhsLimit = PLATFORM_LIMITS.xhs.title
    const long = "好".repeat(xhsLimit + 1)
    const tooLong = precheckPublish({ ...base, title: long }, ["xhs", "wxGzh"])
    expect(tooLong.issues.map((issue) => issue.rule)).toContain("title-too-long:xhs")
    expect(tooLong.issues.map((issue) => issue.rule)).not.toContain("title-too-long:wxGzh")
  })

  test("重复标签、过去的定时时间、AI 标识提醒", () => {
    const result = precheckPublish(
      { ...base, tags: ["露营", "露营", "周末"], scheduleTime: Date.now() - 60_000 },
      ["douyin"],
    )
    const rules = result.issues.map((issue) => issue.rule)
    expect(rules).toContain("tags-duplicate")
    expect(rules).toContain("schedule-past")
    expect(rules).toContain("ai-label")
    // AI 标识只是 hint，不挡发布
    expect(result.ok).toBe(true)
  })
})
