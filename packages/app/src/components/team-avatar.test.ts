import { describe, expect, test } from "bun:test"
import { teamInitials } from "./team-avatar"

describe("teamInitials", () => {
  test("中文取前两个字", () => {
    expect(teamInitials("代码审查团队")).toBe("代码")
    expect(teamInitials("  测试编排团队 ")).toBe("测试")
  })

  test("英文多名取词首字母，不取前两个字符", () => {
    expect(teamInitials("parallel-test-team")).toBe("PT")
    expect(teamInitials("code review")).toBe("CR")
  })

  test("单个英文词退回前两个字符；空名有占位", () => {
    expect(teamInitials("review")).toBe("re")
    expect(teamInitials("")).toBe("队")
  })
})
