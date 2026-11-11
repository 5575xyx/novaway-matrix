import { describe, expect, test } from "bun:test"
import { compileScript } from "../../src/dynamic-workflow/compiler/compile"
import { collectSites } from "../../src/dynamic-workflow/analysis/sites"

// 站点表是整条管线的身份证：lowering 按它打桩、journal 按它落行、恢复按它判断
// 「这件事发生过没有」。所以这里盯三件事——识别得准（符号判定）、编号稳定、
// 诊断说人话。

function analyze(...lines: string[]) {
  const compiled = compileScript(lines.join("\n"))
  const table = collectSites(compiled)
  return { compiled, table }
}

const ids = (...lines: string[]) => analyze(...lines).table.siteIds
const codes = (...lines: string[]) => analyze(...lines).table.diagnostics.map((item) => item.code)

describe("collectSites / 识别", () => {
  test("五类有身份的调用各拿各的编号", () => {
    expect(
      ids(
        'const r = agent("reviewer")',
        'const found = await r.ask<string>("看这片 diff")',
        'phase("检查")',
        'const names = await files.glob("**/*.ts")',
        "report({ files: names.length })",
        "return found",
      ),
    ).toEqual(["actor#1", "ask#1", "world-read#1", "report#1"])
  })

  test("按符号判定：作者自己的同名函数不是站点", () => {
    const { table } = analyze(
      "const agent = (name: string) => ({ ask: async (text: string) => text })",
      'const r = agent("local")',
      'const out = await r.ask("hi")',
      "return out",
    )
    expect(table.siteIds).toEqual([])
    expect(table.diagnostics).toEqual([])
  })

  test("按符号判定：局部同名声明遮蔽门面之后就不再是站点", () => {
    expect(
      ids("const files = { read: async (p: string) => p }", 'const t = await files.read("a")', "return t"),
    ).toEqual([])
  })

  test("world-read 的每个原语各有一个 op 词", () => {
    const { table } = analyze(
      'await files.glob("*/*.ts")',
      'await files.read("a.ts")',
      'await files.grep("TODO", "src/**")',
      "await git.changedFiles()",
      'await git.diff(undefined, "a.ts")',
      "await git.status()",
      "await git.log(5)",
      'return await world.run("ls", ["-la"])',
    )
    expect(table.sites.map((site) => site.op)).toEqual([
      "glob",
      "read",
      "grep",
      "git-changed-files",
      "git-diff",
      "git-status",
      "git-log",
      "run",
    ])
  })

  test("Promise.all / allSettled 是汇合点", () => {
    const { table } = analyze(
      'const pending = [world.run("a"), world.run("b")]',
      "const results = await Promise.all(pending)",
      "const settled = await Promise.allSettled(pending)",
      "const other = await Promise.all([1, 2])",
      "return { results, settled, other }",
    )
    const joins = table.sites.filter((site) => site.kind === "join")
    expect(joins.map((site) => site.id)).toEqual(["join#1", "join#2", "join#3"])
    expect(joins.map((site) => site.target)).toEqual(["Promise.all", "Promise.allSettled", "Promise.all"])
  })

  test("编号按源码前序铸造，同一位置外层调用先于内层", () => {
    expect(ids('const v = await agent("x").ask("hi")', "return v")).toEqual(["ask#1", "actor#1"])
  })

  test("siteIds 与 sites 顺序一致，且不含无身份的 log", () => {
    const { table } = analyze('log("开始")', "const r = agent()", 'return await r.ask("x")')
    expect(table.siteIds).toEqual(table.sites.map((site) => site.id))
    expect(table.siteIds).toEqual(["actor#1", "ask#1"])
  })
})

describe("collectSites / 阶段", () => {
  test("phase 覆盖到所在 block 结束，嵌套 block 继承", () => {
    const { table } = analyze(
      "const r = agent()",
      'phase("准备")',
      'const a = await files.read("a")',
      "if (a) {",
      '  const b = await files.read("b")',
      "}",
      'phase("收尾")',
      'const c = await files.read("c")',
      "return [a, c]",
    )
    expect(table.sites.map((site) => [site.id, site.phase])).toEqual([
      ["actor#1", undefined],
      ["world-read#1", "准备"],
      ["world-read#2", "准备"],
      ["world-read#3", "收尾"],
    ])
    expect(table.phaseNames).toEqual(["准备", "收尾"])
  })

  test("阶段名去重但保留首次出现顺序", () => {
    const { table } = analyze('phase("B")', 'phase("A")', 'phase("B")', "return 1")
    expect(table.phaseNames).toEqual(["B", "A"])
  })

  test("phase 之前的站点没有阶段", () => {
    const { table } = analyze('const a = await files.read("a")', 'phase("之后")', "return a")
    expect(table.sites[0]!.phase).toBeUndefined()
  })

  test("分支各自开阶段时，静态表按词法位置给（运行期事件才是权威）", () => {
    const { table } = analyze(
      'if (args.fast) { phase("快") } else { phase("慢") }',
      'const x = await files.read("a")',
      "return x",
    )
    expect(table.phaseNames).toEqual(["快", "慢"])
    expect(table.sites[0]!.phase).toBeUndefined()
  })
})

describe("collectSites / fan-out", () => {
  test("回调体里有站点的迭代方法被提升为 fan-out，后代带 within", () => {
    const { table } = analyze(
      'const names = await files.glob("**/*.ts")',
      "const out = await Promise.all(names.map(async (name) => {",
      "  const text = await files.read(name)",
      "  return text.length",
      "}))",
      "return out",
    )
    const fan = table.sites.find((site) => site.kind === "fan-out")!
    expect(fan.id).toBe("fan-out#1")
    const inside = table.sites.filter((site) => site.within === fan.id)
    expect(inside.map((site) => site.target)).toEqual(["files.read"])
  })

  test("for...of 循环体里有站点，同样提升为 fan-out（顺序版）", () => {
    const { table } = analyze(
      'const names = await files.glob("**/*.ts")',
      "for (const name of names) {",
      "  const text = await files.read(name)",
      "  report({ name, size: text.length })",
      "}",
      "return names",
    )
    const fan = table.sites.find((site) => site.kind === "fan-out")!
    expect(fan.id).toBe("fan-out#1")
    expect(fan.line).toBe(2)
    expect(table.sites.filter((site) => site.within === fan.id).map((site) => site.target)).toEqual([
      "files.read",
      "report",
    ])
  })

  test("循环体里没有站点就不产生 fan-out", () => {
    const { table } = analyze("for (const n of [1, 2]) { log(String(n)) }", "return 1")
    expect(table.sites.filter((site) => site.kind === "fan-out")).toEqual([])
  })

  test("回调体里没有站点的迭代方法不产生 fan-out", () => {
    const { table } = analyze(
      'const names = await files.glob("**/*.ts")',
      "const upper = names.map((name) => name.toUpperCase())",
      "return upper",
    )
    expect(table.sites.filter((site) => site.kind === "fan-out")).toEqual([])
  })
})

describe("collectSites / 确定性", () => {
  test("同一份脚本两次收集得到完全相同的站点表", () => {
    const lines = [
      'phase("a")',
      'const r = agent("r")',
      'const names = await files.glob("**/*.ts")',
      "const out = await Promise.all(names.map(async (n) => r.ask<number>(n)))",
      "report({ n: out.length })",
      "return out",
    ]
    const strip = (table: ReturnType<typeof analyze>["table"]) =>
      JSON.stringify(table.sites.map(({ node, ...rest }) => rest))
    expect(strip(analyze(...lines).table)).toBe(strip(analyze(...lines).table))
  })
})

describe("collectSites / 诊断", () => {
  test("9001：门面可调用物不能存进变量", () => {
    expect(codes("const g = files.glob", "return 1")).toEqual([9001])
    expect(codes('const a = agent("x").ask', "return 1")).toEqual([9001])
    expect(codes("const w = world", "return 1")).toEqual([9001])
  })

  test("9001：属性链只报一次（报链根）", () => {
    const diagnostics = analyze("const g = files.glob", "return 1").table.diagnostics
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]!.message).toContain("files")
  })

  test("9001：直接调用、属性访问、await、箭头体里都不误报", () => {
    expect(
      codes(
        'const names = await files.glob("**/*.ts")',
        "const n = names.length",
        'const c = await agent("x").ask("hi")',
        "const d = names.map((name) => name.length)",
        "return { n, c, d }",
      ),
    ).toEqual([])
  })

  test("9001：args 允许自由读取", () => {
    expect(codes("const topic = args.topic", "const raw = args", "return { topic, raw }")).toEqual([])
  })

  test("9003：world.run 的命令必须是字符串字面量", () => {
    expect(codes('const cmd = "ls"', 'await world.run(cmd, ["-la"])', "return 1")).toEqual([9003])
    expect(codes('await world.run("ls", ["-la"])', "return 1")).toEqual([])
  })

  test("9004：phase 要独立成句，名字要是非空字面量", () => {
    expect(codes('phase("a") && log("x")', "return 1")).toEqual([9004])
    expect(codes('const name = "a"', "phase(name)", "return 1")).toEqual([9004])
    expect(codes('phase("  ")', "return 1")).toEqual([9004])
    expect(codes('phase(" 收集 ")', "return 1")).toEqual([])
  })

  test("9004：字面量名字去掉两端空白", () => {
    expect(analyze('phase(" 收集 ")', "return 1").table.phaseNames).toEqual(["收集"])
  })

  test("9005：子代理名字必须唯一", () => {
    expect(codes('const a = agent("dup")', 'const b = agent("dup")', "return 1")).toEqual([9005])
    expect(codes('const a = agent("one")', 'const b = agent("two")', "const c = agent()", "return 1")).toEqual([])
  })

  test("诊断按位置排序", () => {
    const diagnostics = analyze("const g = files.glob", "phase(1 as unknown as string)", "return g").table.diagnostics
    expect(diagnostics.map((item) => item.line)).toEqual([1, 2])
  })
})
