import { describe, expect, test } from "bun:test"
import { compileScript, formatDiagnostics } from "../../src/dynamic-workflow/compiler/compile"
import { libTypescriptVersion } from "../../src/dynamic-workflow/compiler/libs"

// 编译器是整条工作流管线的入口：模型写的脚本能不能跑，先由它说了算。
// 这些用例只验证**契约**——行列要落在作者能看懂的位置、沙箱外的东西要在编译期消失、
// 标准库要够用——不验证 TS 自己的语义（那是 TS 的测试）。

const ok = (script: string) => {
  const result = compileScript(script)
  return { result, text: formatDiagnostics(result.diagnostics) }
}

describe("compileScript", () => {
  test("干净的脚本通过，顶层 await 与 return 都合法", () => {
    const { result, text } = ok(`
      const items = await files.glob("**/*.ts")
      const first = items[0]
      return { count: items.length, first }
    `)
    expect(text).toBe("")
    expect(result.ok).toBe(true)
  })

  test("诊断落在作者自己的行列上，不是包了前缀的虚拟文件坐标", () => {
    const { result } = ok(
      [
        "const a = 1",
        "const b: string = a", // L2:C7
        "",
        'const c: number = "x"', // L4:C7
      ].join("\n"),
    )
    expect(result.ok).toBe(false)
    expect(result.diagnostics.map((item) => `L${item.line}:C${item.column}`)).toEqual(["L2:C7", "L4:C7"])
  })

  test("没有 ambient 全局：process / fetch / require / Buffer 都在编译期失败", () => {
    const { result } = ok(
      ["process.exit(1)", 'await fetch("http://x")', 'require("fs")', 'Buffer.from("x")'].join("\n"),
    )
    expect(result.diagnostics.map((item) => item.line)).toEqual([1, 2, 3, 4])
    for (const diagnostic of result.diagnostics) expect(diagnostic.message).toContain("Cannot find name")
  })

  test("没有 DOM：document / window 不可用", () => {
    const { result } = ok("document.title")
    expect(result.ok).toBe(false)
    expect(result.diagnostics[0]!.message).toContain("Cannot find name 'document'")
  })

  test("import 不可用——脚本只能碰门面", () => {
    const { result } = ok('import fs from "node:fs"\nreturn 1')
    expect(result.ok).toBe(false)
  })

  test("noUncheckedIndexedAccess 关闭：items[i] 可以被当作非空使用", () => {
    const { result, text } = ok(`
      const items = await files.glob("**/*.ts")
      return items[0].toUpperCase()
    `)
    expect(text).toBe("")
    expect(result.ok).toBe(true)
  })

  test("strict 打开：隐式 any 与空值都是错误", () => {
    const { result } = ok(`
      function pick(x) { return x }
      const y: string = null
      return pick(y)
    `)
    expect(result.ok).toBe(false)
    expect(result.diagnostics.length).toBeGreaterThanOrEqual(2)
  })

  test("代码点映射：多字节字符不会把列号算错", () => {
    const { result } = ok('const 名字: number = "值"')
    expect(result.diagnostics[0]!.line).toBe(1)
    expect(result.diagnostics[0]!.column).toBe(7)
  })

  test("重复诊断被去重", () => {
    const { result } = ok('const x: number = "a"')
    expect(result.diagnostics).toHaveLength(1)
  })

  test("同一份脚本编译两次，诊断完全一致（确定性）", () => {
    const script = 'const x: number = "a"\nconst y = fetch("x")'
    const first = compileScript(script).diagnostics
    const second = compileScript(script).diagnostics
    expect(JSON.stringify(first)).toBe(JSON.stringify(second))
  })

  test("formatDiagnostics 给出的是给模型看的一段话", () => {
    const text = formatDiagnostics([{ code: 2304, message: "Cannot find name 'fetch'.", line: 3, column: 9 }])
    expect(text).toBe("工作流脚本有 1 处错误：\nL3:C9 Cannot find name 'fetch'.")
    expect(formatDiagnostics([])).toBe("")
  })

  test("标准库快照覆盖 ES2022 且不含 DOM", () => {
    const { result } = ok(`
      const map = new Map<string, number>()
      map.set("a", 1)
      const values = [...map.values()].flatMap((n) => [n, n])
      const total = values.reduce((sum, n) => sum + n, 0)
      const label = new Intl.NumberFormat("zh-CN").format(total)
      return { total, label, at: values.at(-1) }
    `)
    expect(formatDiagnostics(result.diagnostics)).toBe("")
    expect(result.ok).toBe(true)
  })

  test("快照版本可读——升级 typescript 后要靠它判断是否需要重生成", () => {
    expect(libTypescriptVersion()).toMatch(/^\d+\.\d+\.\d+/)
  })
})
