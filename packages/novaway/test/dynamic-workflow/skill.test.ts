import { describe, expect, test } from "bun:test"
import { prepareWorkflow } from "../../src/dynamic-workflow"
import SKILL_BODY from "../../src/skill/prompt/dynamic-workflows.md" with { type: "text" }

// 技能文档是作者面的第一份教程。它里面的示例一旦与门面脱节，模型写出来的脚本就全是错的，
// 而那种错误看起来像「模型不会写」，不像「文档过期了」。所以把文档里的 TS 代码块
// 直接丢进编译器：能过就是同一份真相。
function typescriptBlocks(markdown: string): string[] {
  const blocks: string[] = []
  const fence = /```ts\n([\s\S]*?)```/g
  let match: RegExpExecArray | null
  while ((match = fence.exec(markdown)) !== null) blocks.push(match[1]!)
  return blocks
}

describe("dynamic-workflows 技能", () => {
  const blocks = typescriptBlocks(SKILL_BODY)

  test("正文里至少有一个可编译的示例", () => {
    expect(blocks.length).toBeGreaterThan(0)
  })

  for (const [index, block] of blocks.entries()) {
    test(`示例 #${index + 1} 能过编译与降级`, () => {
      const prepared = prepareWorkflow(block)
      if (!prepared.ok) {
        throw new Error(
          [
            `示例 #${index + 1} 编译失败：`,
            ...prepared.diagnostics.map((d) => `L${d.line}:C${d.column} ${d.message}`),
          ].join("\n"),
        )
      }
      expect(prepared.siteIds.length).toBeGreaterThan(0)
    })
  }
})
