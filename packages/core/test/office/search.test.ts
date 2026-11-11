import { describe, expect, test } from "bun:test"
import {
  countMatches,
  nextMatch,
  previousMatch,
  replaceAll,
  replaceMatch,
  searchMatches,
} from "../../src/office/text/search"

describe("查找", () => {
  test("普通文本，默认忽略大小写", () => {
    const matches = searchMatches("Foo foo FOO", "foo")
    expect(matches.map((match) => [match.start, match.end])).toEqual([
      [0, 3],
      [4, 7],
      [8, 11],
    ])
    expect(countMatches("Foo foo", "foo", { caseSensitive: true })).toBe(1)
  })

  test("中文同样能查到", () => {
    const matches = searchMatches("第一段文字，第二段文字", "段文字")
    expect(matches).toHaveLength(2)
    expect(matches[0]!.text).toBe("段文字")
  })

  test("整词匹配不会命中子串", () => {
    expect(searchMatches("cat concatenate cat", "cat", { wholeWord: true })).toHaveLength(2)
    expect(searchMatches("cat concatenate", "cat")).toHaveLength(2)
  })

  test("正则模式与非法正则", () => {
    // 默认按字面量：方括号不会被当成字符组。
    expect(searchMatches("a1 b22", "[0-9]+")).toHaveLength(0)
    expect(searchMatches("a1 b22", "[0-9]+", { regex: true }).map((match) => match.text)).toEqual(["1", "22"])
    expect(() => searchMatches("x", "(", { regex: true })).toThrow()
  })

  test("零宽正则不会死循环", () => {
    expect(searchMatches("abc", "^", { regex: true })).toHaveLength(0)
  })

  test("光标往后 / 往前找会绕回", () => {
    const text = "a x a x a"
    expect(nextMatch(text, "a", 2)!.start).toBe(4)
    expect(nextMatch(text, "a", 99)!.start).toBe(0)
    expect(previousMatch(text, "a", 4)!.start).toBe(0)
    expect(previousMatch(text, "a", 0)!.start).toBe(8)
  })

  test("空查询返回空结果", () => {
    expect(searchMatches("abc", "")).toEqual([])
  })
})

describe("替换", () => {
  test("全部替换按字面量插入，不解释 $1", () => {
    const result = replaceAll("a1 a2", "a", "$1")
    expect(result.count).toBe(2)
    expect(result.text).toBe("$11 $12")
  })

  test("大小写不敏感替换统一成新的写法", () => {
    expect(replaceAll("Foo foo", "foo", "bar").text).toBe("bar bar")
  })

  test("替换单个匹配", () => {
    const text = "a b a"
    const match = searchMatches(text, "a")[1]!
    expect(replaceMatch(text, match, "c")).toBe("a b c")
    expect(replaceMatch(text, { start: -1, end: 1, text: "" }, "c")).toBe(text)
  })

  test("没有匹配时原样返回", () => {
    expect(replaceAll("abc", "z", "y")).toEqual({ text: "abc", count: 0 })
  })
})
