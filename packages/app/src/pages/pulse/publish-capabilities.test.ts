import { describe, expect, test } from "bun:test"
import { splitByCapability, supportsPublish } from "./publish-capabilities"

describe("publish capabilities", () => {
  test("公众号只能发文章，小红书不能发文章", () => {
    expect(supportsPublish("wxGzh", "article")).toBe(true)
    expect(supportsPublish("wxGzh", "video")).toBe(false)
    expect(supportsPublish("xhs", "article")).toBe(false)
    expect(supportsPublish("xhs", "image_text")).toBe(true)
  })

  test("未知平台一律视为不支持，避免误发", () => {
    expect(supportsPublish("unknown", "video")).toBe(false)
  })

  test("未验证的组合先不放开（B站文章 / 快手图文）", () => {
    expect(supportsPublish("bilibili", "video")).toBe(true)
    expect(supportsPublish("bilibili", "article")).toBe(false)
    expect(supportsPublish("kwai", "video")).toBe(true)
    expect(supportsPublish("kwai", "image_text")).toBe(false)
  })

  test("按内容类型切分账号：不支持的要单独返回，界面才能说明原因", () => {
    const accounts = [
      { platform: "xhs", id: "a" },
      { platform: "wxGzh", id: "b" },
      { platform: "douyin", id: "c" },
    ]
    const result = splitByCapability(accounts, "video")
    expect(result.ready.map((item) => item.id)).toEqual(["a", "c"])
    expect(result.unsupported.map((item) => item.id)).toEqual(["b"])
  })
})
