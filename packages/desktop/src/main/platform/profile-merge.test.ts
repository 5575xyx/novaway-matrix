import { describe, expect, test } from "bun:test"
import { mergeProfile } from "./profile-merge"

describe("profile merge", () => {
  test("补齐空资料：昵称/头像/uid 都会被填上", () => {
    const patch = mergeProfile(
      { nickname: "", avatar: "", uid: "" },
      { nickname: "星曜明途", avatar: "https://x/a.png", uid: "gh_1" },
    )
    expect(patch).toEqual({ nickname: "星曜明途", avatar: "https://x/a.png", uid: "gh_1" })
  })

  test("刷新失败返回空值时不覆盖已有资料", () => {
    const patch = mergeProfile(
      { nickname: "星曜明途", avatar: "https://x/a.png", uid: "gh_1" },
      { nickname: "  ", avatar: "", uid: "" },
    )
    expect(patch).toEqual({})
  })

  test("值没变化就不产生补丁（避免无意义的写盘）", () => {
    const current = { nickname: "星曜明途", avatar: "https://x/a.png", uid: "gh_1", fansCount: 10 }
    expect(mergeProfile(current, current)).toEqual({})
  })

  test("粉丝数允许被更新为 0", () => {
    expect(mergeProfile({ fansCount: 10 }, { fansCount: 0 })).toEqual({ fansCount: 0 })
  })
})
