import { describe, expect, test } from "bun:test"
import { isBareFileName, matchUniqueFileName } from "./output-file-path"

describe("isBareFileName", () => {
  test("只有文件名、没有目录才算裸名", () => {
    expect(isBareFileName("product_promo_20261101_134706.pptx")).toBe(true)
    expect(isBareFileName(" README.md ")).toBe(true)
  })

  test("带目录、绝对路径、盘符和 UNC 都不是裸名", () => {
    expect(isBareFileName("output/deck.pptx")).toBe(false)
    expect(isBareFileName("docs\\a.md")).toBe(false)
    expect(isBareFileName("E:/proj/deck.pptx")).toBe(false)
    expect(isBareFileName("/home/u/deck.pptx")).toBe(false)
    expect(isBareFileName("~/deck.pptx")).toBe(false)
    expect(isBareFileName("\\\\share\\a\\deck.pptx")).toBe(false)
  })

  test("空值不当成裸名去发起搜索", () => {
    expect(isBareFileName("")).toBe(false)
    expect(isBareFileName("   ")).toBe(false)
    expect(isBareFileName(undefined)).toBe(false)
  })
})

describe("matchUniqueFileName", () => {
  test("唯一命中就改写成正文里缺了目录的真实路径", () => {
    expect(matchUniqueFileName("deck.pptx", ["output/2026/deck.pptx"])).toBe("output/2026/deck.pptx")
  })

  test("模糊搜索带回来的近似名不算命中", () => {
    expect(matchUniqueFileName("a.pptx", ["a.pptx.bak", "aa.pptx", "notes.txt"])).toBeUndefined()
    expect(matchUniqueFileName("a.pptx", ["output/a.pptx.bak"])).toBeUndefined()
  })

  test("多个同名候选不猜，留给面板报错", () => {
    expect(matchUniqueFileName("deck.pptx", ["output/a/deck.pptx", "output/b/deck.pptx"])).toBeUndefined()
  })

  test("重复命中同一个路径仍算唯一", () => {
    expect(matchUniqueFileName("deck.pptx", ["output/deck.pptx", "output/deck.pptx"])).toBe("output/deck.pptx")
  })

  test("比对大小写不敏感（Windows 真实路径的 casing 不可靠）", () => {
    expect(matchUniqueFileName("Deck.PPTX", ["Output/deck.pptx"])).toBe("Output/deck.pptx")
  })

  test("反斜杠结果也能取出文件名", () => {
    expect(matchUniqueFileName("deck.pptx", ["output\\2026\\deck.pptx"])).toBe("output\\2026\\deck.pptx")
  })

  test("空查询不匹配任何东西", () => {
    expect(matchUniqueFileName("", ["output/deck.pptx"])).toBeUndefined()
  })
})
