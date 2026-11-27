import { describe, expect, test } from "bun:test"
import { guidance, recommend, type Candidate } from "../../src/team/router"

const candidates: Candidate[] = [
  { kind: "expert", id: "research", name: "Research expert", text: "research competitor analysis" },
  { kind: "team", id: "product", name: "Product team", text: "product design engineering" },
]

describe("team.router", () => {
  test("keeps ordinary work with the main assistant", () => {
    expect(recommend("把这句话改得更简洁", candidates).mode).toBe("main")
  })

  test("prefers a matching expert for specialized work", () => {
    const result = recommend("做竞品研究并整理事实", candidates)
    expect(result.mode).toBe("expert")
    expect(result.candidate?.id).toBe("research")
  })

  test("prefers a team for parallel cross-domain work", () => {
    const result = recommend("并行完成产品设计、开发和测试", candidates)
    expect(result.mode).toBe("team")
    expect(result.candidate?.id).toBe("product")
  })

  test("renders a non-binding hint for the main assistant", () => {
    const text = guidance("分析竞品", candidates)
    expect(text).toContain("仅供主助手判断")
    expect(text).toContain("Research expert")
    expect(text).toContain("不要为了展示协作")
  })
})
