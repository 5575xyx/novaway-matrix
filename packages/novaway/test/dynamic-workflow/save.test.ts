import { describe, expect, test } from "bun:test"
import { parseHeader, renderSavedScript, stripHeader, validateName, fileName } from "../../src/dynamic-workflow/saved"

// 保存格式是「注释头 + 正文」。三条硬约束都来自同一个事实：这份文件本身就是一份合法脚本，
// 必须能直接丢进 prepareWorkflow——所以头部只能是行注释、元数据值里不能有换行、
// 正文里再出现 "name:" 也不能被误读。

describe("保存的工作流", () => {
  test("名字就是文件名，所以有一套受限字符", () => {
    expect(validateName("review-diff")).toBeUndefined()
    expect(validateName("data_clean.2")).toBeUndefined()
    expect(validateName("有中文")).toBeString()
    expect(validateName("with space")).toBeString()
    expect(validateName("-leading")).toBeString()
    expect(validateName("")).toBeString()
    expect(fileName("review-diff")).toBe("review-diff.dwf.ts")
  })

  test("头部写进去再读回来，字段一个不少", () => {
    const text = renderSavedScript(
      { name: "review", description: "并行看每个文件", whenToUse: "帮我 review 一下" },
      'phase("评审")\nreturn 1',
    )
    expect(text.startsWith("// name: review")).toBe(true)
    const header = parseHeader(text)
    expect(header).toEqual({ name: "review", description: "并行看每个文件", whenToUse: "帮我 review 一下" })
  })

  test("正文里的 name: 不会被误当成元数据", () => {
    const header = parseHeader("// name: real\nreturn 1\n// name: fake")
    expect(header?.name).toBe("real")
  })

  test("元数据里的换行被压平，不撑破注释头", () => {
    const text = renderSavedScript({ name: "x", description: "第一行\n第二行" }, "return 1")
    expect(
      text
        .split("\n")
        .slice(0, 2)
        .every((line) => line.startsWith("//")),
    ).toBe(true)
    expect(parseHeader(text)?.description).toBe("第一行 第二行")
  })

  test("没有头部时读不出元数据，正文原样保留", () => {
    expect(parseHeader("return 1")).toBeUndefined()
    const body = 'phase("a")\nreturn 2'
    expect(stripHeader(`// name: x\n// description: y\n\n${body}`)).toBe(body)
  })

  test("剥头之后的结果就是合法脚本", () => {
    const text = renderSavedScript({ name: "x" }, "const a = 1\nreturn a")
    expect(stripHeader(text).trimEnd()).toBe("const a = 1\nreturn a")
  })
})
