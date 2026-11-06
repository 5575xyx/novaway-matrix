import { describe, expect, test } from "bun:test"
import {
  type BoundaryManifest,
  edgeKey,
  failures,
  readBaseline,
  readManifest,
  scan,
  scanPluginApi,
} from "../../script/scan-boundary"

/**
 * 门禁 B1（插件文档 §0.3、§2.3）。
 *
 * 这里既测「当前代码是否越界」，也测扫描器本身还能不能发现越界——
 * 否则清单腐烂或豁免失控时，门禁会静默变成常绿。
 */

function withManifest(overrides: Partial<BoundaryManifest>): BoundaryManifest {
  return { ...readManifest(), ...overrides }
}

describe("kernel boundary", () => {
  const manifest = readManifest()
  const baseline = readBaseline()
  const result = scan(manifest, baseline)

  test("B1 通过：没有新增的方向违规、空转豁免或污染的 plugin-api", () => {
    expect(failures(result)).toEqual([])
  })

  test("基线是排好序且无重复的（diff 友好）", () => {
    expect(baseline).toEqual([...baseline].sort())
    expect(new Set(baseline).size).toBe(baseline.length)
  })

  test("plugin-api 只含相对 import 与纯函数", () => {
    expect(scanPluginApi()).toEqual([])
  })

  test("豁免挡住的债务仍然可见", () => {
    expect(result.exempted.length).toBeGreaterThan(0)
    expect(result.exempted.every((edge) => manifest.exempt.some((item) => item.file === edge.file))).toBe(true)
  })
})

describe("scan-boundary 自检", () => {
  const real = readManifest()
  const baseline = readBaseline()

  test("把 capability 路径交给 kernel 检查时能抓到真实越界", () => {
    const caught = scan(
      withManifest({ kernel: ["src/session/session.ts"], capability: ["src/memory/**"], exempt: [] }),
      [],
    )
    expect(caught.violations.map(edgeKey)).toEqual(["src/session/session.ts -> @/memory/service"])
  })

  test("空基线时所有违规都算新增", () => {
    const fresh = scan(real, [])
    expect(fresh.newViolations).toEqual(fresh.violations)
    expect(fresh.violations.length).toBeGreaterThan(0)
  })

  test("基线漏记的边算新增；基线里已修的边要求收紧", () => {
    expect(scan(real, baseline).newViolations).toEqual([])
    const [dropped, ...rest] = baseline
    expect(scan(real, rest).newViolations.map(edgeKey)).toEqual([dropped])
    const ghost = "src/session/session.ts -> @/gone/gone"
    expect(scan(real, [...baseline, ghost]).staleBaseline).toEqual([ghost])
  })

  test("豁免到期即失败", () => {
    const expired = scan(
      withManifest({ milestone: "M5", exempt: [{ file: "src/tool/registry.ts", reason: "x", until: "M1" }] }),
      baseline,
    )
    expect(expired.expiredExempts.join("\n")).toContain("到期于 M1")
    expect(failures(expired).join("\n")).toContain("src/tool/registry.ts")
  })

  test("豁免不再挡任何债务时必须删除", () => {
    const unused = scan(withManifest({ exempt: [{ file: "src/bus/**", reason: "x", until: "M5" }] }), baseline)
    expect(unused.unusedExempts.join("\n")).toContain("src/bus/**")
  })

  test("清单 glob 指向已消失的位置时报警", () => {
    const rotten = scan(withManifest({ capability: [...real.capability, "src/definitely-gone/**"] }), baseline)
    expect(rotten.deadGlobs.join("\n")).toContain("src/definitely-gone/**")
  })
})
