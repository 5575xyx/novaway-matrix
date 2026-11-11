import { describe, expect, test } from "bun:test"
import { compileScript } from "../../src/dynamic-workflow/compiler/compile"
import { collectSites } from "../../src/dynamic-workflow/analysis/sites"
import { lower } from "../../src/dynamic-workflow/lowering/lower"

// lowering 是「分析」与「沙箱」之间唯一的桥。它出错的方式都很安静：错一个站点 id，
// journal 就会把两次执行记成同一件事；漏掉一个 `agent(`，脚本在沙箱里才炸。
// 所以这里既核对改写结果，也**把产物真的再编译一遍**，证明它只依赖 __host。

function build(scriptText: string) {
  const compiled = compileScript(scriptText)
  const table = collectSites(compiled)
  const lowered = lower(compiled, table, scriptText)
  return { compiled, table, lowered }
}

/** 产物是不是只认 __host：补一行 any 的宿主绑定再编译，出现任何诊断都说明漏了东西。 */
function freeIdentifiers(code: string): string[] {
  const probe = `const __host: any = undefined\n${code}`
  return compileScript(probe).diagnostics.map((item) => `L${item.line - 1}:C${item.column} ${item.message}`)
}

describe("lower / 改写", () => {
  test("每个原语都有自己的改写形状", () => {
    const { lowered } = build(
      [
        'const r = agent("reviewer", { system: "你是评审员" })',
        'const out = await r.ask<number>("多少")',
        'phase("阶段")',
        'log("进度")',
        "report({ out })",
        'const names = await files.glob("**/*.ts")',
        'const hits = await files.grep("TODO", "src/**")',
        'const diff = await git.diff(undefined, "a.ts")',
        'const run = await world.run("ls", ["-la"], { timeoutMs: 1000 })',
        "return { names, hits, diff, run }",
      ].join("\n"),
    )
    expect(lowered.code).toContain(`__host.createActor("actor#1", "reviewer", { system: "你是评审员" })`)
    expect(lowered.code).toContain(`__host.ask("ask#1", r, "多少")`)
    expect(lowered.code).toContain(`__host.enterPhase("阶段")`)
    expect(lowered.code).toContain(`__host.log("进度")`)
    expect(lowered.code).toContain(`__host.report("report#1", { out })`)
    expect(lowered.code).toContain(`__host.worldRead("world-read#1", "glob", ["**/*.ts"])`)
    expect(lowered.code).toContain(`__host.worldRead("world-read#2", "grep", ["TODO", "src/**"])`)
    expect(lowered.code).toContain(`__host.worldRead("world-read#3", "git-diff", [undefined, "a.ts"])`)
    expect(lowered.code).toContain(`__host.worldRead("world-read#4", "run", ["ls", ["-la"], { timeoutMs: 1000 }])`)
    expect(lowered.code).not.toContain("agent(")
    expect(freeIdentifiers(lowered.code)).toEqual([])
  })

  test("类型全部擦掉，泛型参数不进产物", () => {
    const { lowered } = build(
      [
        "interface Row { id: number }",
        "type Id = string",
        "const r = agent()",
        'const rows = await r.ask<Row[]>("给我行")',
        'const id = "x" as unknown as Id',
        "return { rows, id }",
      ].join("\n"),
    )
    expect(lowered.code).not.toContain("interface")
    expect(lowered.code).not.toContain("Row[]")
    expect(lowered.code).not.toContain(" as ")
    expect(freeIdentifiers(lowered.code)).toEqual([])
  })

  test("注释与空行原样保留", () => {
    const { lowered } = build(
      ["// 顶上的注释", "", 'const names = await files.glob("*",)', "// 行尾注释", "", "return names"].join("\n"),
    )
    expect(lowered.code).toContain("// 顶上的注释")
    expect(lowered.code).toContain("// 行尾注释")
  })

  test("嵌套站点：agent().ask() 里外的 id 都落到正确位置", () => {
    const { lowered } = build('const out = await agent("x").ask("hi")\nreturn out')
    expect(lowered.code).toContain(`__host.ask("ask#1", __host.createActor("actor#1", "x"), "hi")`)
    expect(freeIdentifiers(lowered.code)).toEqual([])
  })

  test("args 走 __host.args；被局部变量遮蔽时按局部语义走", () => {
    expect(build("return args.topic").lowered.code).toContain("__host.args.topic")
    expect(build("const args = { topic: 1 }\nreturn args.topic").lowered.code).toContain("args.topic")
  })

  test("没有站点的脚本除了擦类型，几乎是原文", () => {
    const script = "const values: number[] = [1, 2, 3]\nreturn values.reduce((a, b) => a + b, 0)"
    const { lowered } = build(script)
    expect(lowered.code).toContain("const values = [1, 2, 3]")
    expect(lowered.code).toContain("return values.reduce((a, b) => a + b, 0)")
  })
})

describe("lower / 对账", () => {
  test("产物里出现的站点 id 与站点表逐个对齐", () => {
    const { table, lowered } = build(
      [
        'phase("a")',
        'const r = agent("r")',
        'const names = await files.glob("**/*.ts")',
        "const out = await Promise.all(names.map(async (n) => r.ask<string>(n)))",
        "report({ n: out.length })",
        "return out",
      ].join("\n"),
    )
    const fromTable = table.siteIds.filter((id) => !id.startsWith("join#") && !id.startsWith("fan-out#"))
    expect(lowered.siteIds).toEqual(fromTable)
  })

  test("产物里不残留任何门面调用", () => {
    const { lowered } = build(
      [
        'const r = agent("r")',
        'phase("a")',
        'log("b")',
        'await r.ask("c")',
        'report("d")',
        'await files.read("e")',
        'return await world.run("ls")',
      ].join("\n"),
    )
    // 只认「前面不是点」的门面调用：__host.log( 里的 log( 是宿主成员，不算残留。
    for (const leftover of [/(?<![.\w])(agent|phase|log|report)\(/, /(?<![.\w])(files|git|world)\./]) {
      expect(lowered.code).not.toMatch(leftover)
    }
  })

  test("同一份脚本两次降级，产物逐字节一致", () => {
    const script = 'const r = agent("x")\nreturn await r.ask<string>("hi")'
    expect(build(script).lowered.code).toBe(build(script).lowered.code)
  })
})
