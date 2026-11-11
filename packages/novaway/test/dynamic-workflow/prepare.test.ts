import { describe, expect, test } from "bun:test"
import { prepareWorkflow } from "../../src/dynamic-workflow"

// prepareWorkflow 是工具层唯一要调的入口。它同时承担两个职责：给模型一份能改的错误清单，
// 给确认窗一份能展示的「这次会跑什么」。这两件事都在这里被钉住。

/** 落地方案附录 A 的例子：一次真实的代码评审工作流。 */
const REVIEW = `interface Finding {
  where: string
  what: string
  evidence: string
  severity: "low" | "medium" | "high"
}

const reviewer = agent("reviewer", {
  system: "你是代码评审员。只报告你能指出证据的问题；没有证据的猜测不要写。",
})

phase("收集改动")
const changed = await git.changedFiles()
log(\`检查 \${changed.length} 个改动的文件\`)

phase("逐文件评审")
const results = await Promise.all(
  changed.map(async (file) => {
    const diff = await git.diff(undefined, file)
    const found = await reviewer.ask<Finding[]>(\`审查这个 diff，只报告真实问题：\${diff}\`)
    report({ file, count: found.length })
    return found
  }),
)

const all = results.flat()
report({ total: all.length })

phase("汇总")
return {
  conclusion: \`检查了 \${changed.length} 个文件，发现 \${all.length} 个问题。\`,
  findings: all,
}
`

describe("prepareWorkflow", () => {
  test("完整示例：诊断干净、形状正确、降级产物只依赖 __host", () => {
    const prepared = prepareWorkflow(REVIEW)
    expect(prepared.diagnostics).toEqual([])
    expect(prepared.ok).toBe(true)
    expect(prepared.phaseNames).toEqual(["收集改动", "逐文件评审", "汇总"])
    expect(prepared.actorNames).toEqual(["reviewer"])
    expect(prepared.commands).toEqual([])
    expect(prepared.siteIds).toEqual([
      "actor#1",
      "world-read#1",
      "join#1",
      "fan-out#1",
      "world-read#2",
      "ask#1",
      "report#1",
      "report#2",
    ])
    expect(prepared.lowered!.code).toContain(`__host.createActor("actor#1", "reviewer"`)
    expect(prepared.lowered!.code).toContain(`__host.worldRead("world-read#1", "git-changed-files", [])`)
    expect(prepared.lowered!.code).toContain(`__host.ask("ask#1", reviewer,`)
    expect(prepared.lowered!.code).not.toContain("interface")
  })

  test("有类型错误就不降级：模型需要的是行列，不是一堆无法解释的产物", () => {
    const prepared = prepareWorkflow('const x: number = "nope"\nreturn x')
    expect(prepared.ok).toBe(false)
    expect(prepared.lowered).toBeUndefined()
    expect(prepared.diagnostics).toEqual([
      { code: 2322, message: "Type 'string' is not assignable to type 'number'.", line: 1, column: 7 },
    ])
  })

  test("有门面误用同样不降级，且诊断与类型错误同一条通道", () => {
    const prepared = prepareWorkflow("const g = files.glob\nreturn g")
    expect(prepared.ok).toBe(false)
    expect(prepared.lowered).toBeUndefined()
    expect(prepared.diagnostics.map((item) => item.code)).toEqual([9001])
  })

  test("确认窗需要的命令集与子代理名从站点表推出来", () => {
    const prepared = prepareWorkflow(
      [
        'const a = agent("builder")',
        'const b = agent("checker")',
        'await world.run("git", ["status"])',
        'await world.run("bun", ["test"])',
        'await world.run("git", ["status"])',
        'return await a.ask("做")',
      ].join("\n"),
    )
    expect(prepared.ok).toBe(true)
    expect(prepared.commands).toEqual(["git", "bun"])
    expect(prepared.actorNames).toEqual(["builder", "checker"])
  })

  test("空脚本是合法的：什么都不做的 run 也得能提交", () => {
    const prepared = prepareWorkflow("return 1")
    expect(prepared.ok).toBe(true)
    expect(prepared.siteIds).toEqual([])
    expect(prepared.lowered!.code.trim()).toBe("return 1;")
  })

  test("同一份脚本两次准备，形状与产物都一致", () => {
    const first = prepareWorkflow(REVIEW)
    const second = prepareWorkflow(REVIEW)
    expect(JSON.stringify(first.siteIds)).toBe(JSON.stringify(second.siteIds))
    expect(first.lowered!.code).toBe(second.lowered!.code)
  })
})
