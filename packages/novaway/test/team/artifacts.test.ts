import { describe, expect, test } from "bun:test"
import { depsOf, normalize, stillValid, versions } from "@/team/artifacts"

describe("team artifacts", () => {
  test("the same content always yields the same version, regardless of key order", () => {
    const a = normalize([{ name: "api", schema: { b: 2, a: 1 } }])
    const b = normalize([{ name: "api", schema: { a: 1, b: 2 } }])
    expect(a[0].version).toBe(b[0].version)
    expect(a[0].version).toHaveLength(8)
  })

  test("a changed payload produces a new version", () => {
    const before = normalize([{ name: "api", schema: { a: 1 } }])
    const after = normalize([{ name: "api", schema: { a: 2 } }])
    // 内容变了就是新版本：下游必须重验，不能沿用旧结论。
    expect(before[0].version).not.toBe(after[0].version)
  })

  test("nameless artifacts are dropped instead of being named for the model", () => {
    const list = normalize([{ path: "x.ts" }, { name: "  " }, { name: "api" }, { name: "api", extra: 1 }])
    // 无名产物无法参与依赖判断；同名只留第一个，避免「同名产物悄悄换内容」。
    expect(list.map((item) => item.name)).toEqual(["api"])
    expect(normalize("not an array")).toEqual([])
  })

  test("downstream results stay valid while upstream versions match", () => {
    const upstream = versions([
      { index: 0, artifacts: [{ name: "api", schema: { a: 1 } }] },
      { index: 1, artifacts: [] },
    ])
    const deps = depsOf({ deps: [0], upstream })
    expect(deps).toEqual([{ teamID: 0, name: "api", version: upstream.get(0)?.get("api") }])
    expect(stillValid(deps, upstream).valid).toBe(true)
  })

  test("a reworked upstream invalidates exactly the downstream teams that used it", () => {
    const first = versions([{ index: 0, artifacts: [{ name: "api", schema: { a: 1 } }] }])
    const deps = depsOf({ deps: [0], upstream: first })
    const reworked = versions([{ index: 0, artifacts: [{ name: "api", schema: { a: 2 } }] }])
    const result = stillValid(deps, reworked)
    expect(result.valid).toBe(false)
    expect(result.broken[0]?.teamID).toBe(0)
    // 上游产物被删掉同样算失效：「依赖的东西没了」和「它变了」一样严重。
    expect(stillValid(deps, versions([{ index: 0, artifacts: [] }])).valid).toBe(false)
  })

  test("a team with no artifacts cannot be recorded as a dependency", () => {
    const upstream = versions([{ index: 0, artifacts: [] }])
    // 不能凭空声称「依赖了某物」：没有产物就没有可记录的版本。
    expect(depsOf({ deps: [0], upstream })).toEqual([])
  })
})
