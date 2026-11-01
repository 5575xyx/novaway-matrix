import { describe, expect, it } from "bun:test"
import { parse } from "@/team/report"

describe("captain report parsing", () => {
  it("reads the documented shape", () => {
    const result = parse(
      '{"summary":"交付了","claims":[{"acceptanceID":"a1","text":"补了用例","evidence":"a.ts:1"}],"artifacts":[{"name":"x","version":2}],"done":true}',
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.report.summary).toBe("交付了")
    expect(result.report.claims).toEqual([{ acceptanceID: "a1", text: "补了用例", evidence: "a.ts:1" }])
    expect(result.report.artifacts).toEqual([{ name: "x", version: 2, hash: undefined }])
    expect(result.report.done).toBe(true)
  })

  it("tolerates prose around the JSON object", () => {
    const result = parse('好的，结果如下：\n```json\n{"summary":"ok","claims":[],"done":true}\n```')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.report.done).toBe(true)
  })

  it("treats a bare acknowledgement as malformed instead of an empty delivery", () => {
    const result = parse("ok")
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain("JSON")
  })

  it("treats a JSON object without any of the agreed fields as malformed", () => {
    const result = parse('{"answer":"我不确定"}')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain("summary / claims / done")
  })

  it("accepts an empty claims array: nothing to deliver is a legal report", () => {
    const result = parse('{"claims":[],"done":false}')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.report.claims).toEqual([])
      expect(result.report.done).toBe(false)
      // 没有 summary 时用原文兜底，它只给人看，不参与判定。
      expect(result.report.summary.length).toBeGreaterThan(0)
    }
  })

  it("drops entries that are not objects instead of throwing", () => {
    const result = parse('{"claims":[1,"x",null,{"text":"真的"}],"artifacts":["nope"]}')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.report.claims).toEqual([{ acceptanceID: undefined, text: "真的", evidence: undefined }])
      // 非对象条目被丢弃，不会变成「artifact-0」这种凭空的产物。
      expect(result.report.artifacts).toEqual([])
    }
  })
})
