import { describe, expect, test } from "bun:test"
import { compileScript, formatDiagnostics } from "../../src/dynamic-workflow/compiler/compile"
import { collectSites } from "../../src/dynamic-workflow/analysis/sites"
import { WORKFLOW_FACADE_FILE } from "../../src/dynamic-workflow/facade/dts"

// 门面 d.ts 是三处共用的单一事实源：编译器、工具描述、技能示例都从它派生。
// 它坏掉的方式很隐蔽——语法错误不会让任何一段作者脚本报错（skipLibCheck 会吞掉），
// 只是某个成员悄悄用不了。所以这里从两头夹：文件本身要干净，每个成员都要真的能用。

describe("facade.d.ts", () => {
  test("门面声明文件自己没有语法错误", () => {
    const compiled = compileScript("return 1")
    const facade = compiled.program.getSourceFile(WORKFLOW_FACADE_FILE)!
    const syntactic = compiled.program.getSyntacticDiagnostics(facade)
    expect(syntactic.map((item) => item.messageText)).toEqual([])
  })

  test("每个 facade 成员都能从脚本里直接调用，并各自拿到站点", () => {
    const script = [
      'const persona = { system: "你是评审员" }',
      'const r = agent("named", persona)',
      'const r2 = agent("plain", "你是助手")',
      "const r3 = agent()",
      'const a = await r.ask<string>("纯文本")',
      'const b = await r2.ask<number>("数字")',
      'phase("阶段")',
      'log("进度")',
      "report({ a, b })",
      'const docs = await files.glob("docs/**/*.md")',
      'const text = await files.read("README.md")',
      'const hits = await files.grep("TODO", "src/**")',
      "const changed = await git.changedFiles()",
      'const diff = await git.diff("HEAD~1", "a.ts")',
      "const status = await git.status()",
      "const commits = await git.log(3)",
      'const run = await world.run("ls", ["-la"], { timeoutMs: 1000 })',
      "const topic = args.topic",
      "return { a, b, docs, text, hits, changed, diff, status, commits, run, topic, r3 }",
    ].join("\n")

    const compiled = compileScript(script)
    expect(formatDiagnostics(compiled.diagnostics)).toBe("")

    const table = collectSites(compiled)
    expect(table.diagnostics).toEqual([])
    expect(table.siteIds).toEqual([
      "actor#1",
      "actor#2",
      "actor#3",
      "ask#1",
      "ask#2",
      "report#1",
      "world-read#1",
      "world-read#2",
      "world-read#3",
      "world-read#4",
      "world-read#5",
      "world-read#6",
      "world-read#7",
      "world-read#8",
    ])
    expect(table.sites.filter((site) => site.kind === "actor").map((site) => site.name)).toEqual([
      "named",
      "plain",
      undefined,
    ])
  })

  test("ask 的默认类型参数是 string", () => {
    const compiled = compileScript('const r = agent()\nconst out: string = await r.ask("x")\nreturn out')
    expect(formatDiagnostics(compiled.diagnostics)).toBe("")
  })

  test("ask 的类型参数参与类型检查", () => {
    const compiled = compileScript(
      [
        "interface Row { id: number }",
        "const r = agent()",
        'const rows = await r.ask<Row[]>("x")',
        "return rows[0].id.toFixed()",
      ].join("\n"),
    )
    expect(formatDiagnostics(compiled.diagnostics)).toBe("")
  })

  test("args 是只读的", () => {
    const compiled = compileScript('args.topic = "x"\nreturn args')
    expect(compiled.ok).toBe(false)
  })

  test("Agent 可以复用：同一个句柄上连着 ask 是合法的", () => {
    const table = collectSites(
      compileScript(['const r = agent("x")', 'await r.ask("一")', 'await r.ask("二")', "return 1"].join("\n")),
    )
    expect(table.siteIds).toEqual(["actor#1", "ask#1", "ask#2"])
  })
})
