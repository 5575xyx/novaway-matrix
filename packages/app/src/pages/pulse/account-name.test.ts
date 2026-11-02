import { describe, expect, test } from "bun:test"
import { accountDisplayName } from "./account-name"

describe("accountDisplayName", () => {
  test("正常昵称直接用", () => {
    expect(accountDisplayName({ platform: "xhs", nickname: "小鱼" })).toBe("小鱼")
  })

  test("空昵称回退到平台账号", () => {
    expect(accountDisplayName({ platform: "xhs", nickname: "   ", account: "abc123" }, "小红书")).toBe("abc123")
  })

  test("占位昵称（迁移数据里的「公众号」）不当作名字", () => {
    expect(accountDisplayName({ platform: "wxGzh", nickname: "公众号" }, "公众号")).toBe("公众号")
    expect(accountDisplayName({ platform: "wxGzh", nickname: "公众号", account: "gh_123" }, "公众号")).toBe("gh_123")
  })

  test("什么都没有时用平台名", () => {
    expect(accountDisplayName({ platform: "xianyu" }, "闲鱼")).toBe("闲鱼")
    expect(accountDisplayName({ platform: "xianyu" })).toBe("xianyu")
  })
})
