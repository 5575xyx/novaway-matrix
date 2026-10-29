import { describe, expect, test } from "bun:test"
import { TeamCatalog } from "../../src/team/catalog"

const entries: TeamCatalog.CatalogEntry[] = [
  {
    id: "team_a",
    name: "Checkout squad",
    description: "Owns the checkout flow",
    members: [
      { name: "team-lead", agent: "build", role: "lead" },
      { name: "tester", agent: "test", role: "worker" },
    ],
  },
]

describe("team.catalog", () => {
  test("signature changes when the roster changes", () => {
    const base = TeamCatalog.signature("selected", entries)
    expect(base).toBe(TeamCatalog.signature("selected", entries))
    // 模式换了要重新注入：Auto 与指定团队的派发代价不同。
    expect(TeamCatalog.signature("auto", entries)).not.toBe(base)
    const grown: TeamCatalog.CatalogEntry[] = [
      { ...entries[0], members: [...entries[0].members, { name: "writer", agent: "build", role: "worker" }] },
    ]
    // 新加的成员如果不进签名，模型就永远看不到它。
    expect(TeamCatalog.signature("selected", grown)).not.toBe(base)
  })

  test("render lists dispatchable teams and their roster", () => {
    const text = TeamCatalog.render("selected", entries) ?? ""
    expect(text).toContain("Checkout squad")
    expect(text).toContain("team_a")
    expect(text).toContain("team-lead[build](lead)")
    expect(text).toContain("tester[test]")
    expect(text).toContain("team_run")
  })

  test("render spells out the cost of Auto mode", () => {
    // Auto 的代价必须写清楚：不写模型会以为调一次就开跑。
    expect(TeamCatalog.render("auto", entries)).toContain("等待批准")
    expect(TeamCatalog.render("selected", entries)).not.toContain("等待批准")
  })

  test("render returns nothing when no team is available", () => {
    // 空目录不注入：否则模型会看到一段「无法派发」的噪声。
    expect(TeamCatalog.render("selected", [])).toBeUndefined()
  })
})
