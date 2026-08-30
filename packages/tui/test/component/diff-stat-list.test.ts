import { describe, expect, test } from "bun:test"
import { uniqueDiffStats, DIFF_STAT_MAX_FILES } from "../../src/component/diff-stat-list"

describe("每轮改动统计的去重与归一", () => {
  test("同一个文件多条只保留最后一条,顺序按最后一次出现的位置(和 web 端一致)", () => {
    const result = uniqueDiffStats([
      { file: "a.ts", additions: 1, deletions: 0 },
      { file: "b.ts", additions: 5, deletions: 5 },
      { file: "a.ts", additions: 9, deletions: 2 },
    ])
    expect(result).toEqual([
      { file: "b.ts", additions: 5, deletions: 5 },
      { file: "a.ts", additions: 9, deletions: 2 },
    ])
  })

  test("没有 file 字段的条目直接丢掉:二进制文件的 diff 就是这样", () => {
    expect(uniqueDiffStats([{ additions: 0, deletions: 0 }, { file: "", additions: 1, deletions: 1 }])).toEqual([])
  })

  test("缺失的增删行数补 0,不会渲染出 undefined", () => {
    expect(uniqueDiffStats([{ file: "a.ts" }])).toEqual([{ file: "a.ts", additions: 0, deletions: 0 }])
  })

  test("空输入不炸", () => {
    expect(uniqueDiffStats(undefined)).toEqual([])
    expect(uniqueDiffStats([])).toEqual([])
    expect(uniqueDiffStats([undefined])).toEqual([])
  })

  test("文件数上限存在:一轮改上百个文件时列表不能无限长", () => {
    expect(DIFF_STAT_MAX_FILES).toBeGreaterThan(0)
    expect(DIFF_STAT_MAX_FILES).toBeLessThanOrEqual(20)
  })
})
