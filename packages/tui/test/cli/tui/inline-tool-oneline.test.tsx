import { afterEach, describe, expect, test } from "bun:test"
import { testRender, type JSX } from "@opentui/solid"
import { InlineToolRow } from "../../../src/routes/session"
import { Locale } from "../../../src/util/locale"

// 工具行是"逻辑上的一行":固定宽度的图标列 + flexGrow 的内容列并排。
// 内容里有 \n 时,内容列变成 N 行高而图标列还是 1 行 —— 下面的行整体下移,
// 行尾字符落到下一行的行首,看起来就是界面变形。
// 这一组测试把"必须先压平"这件事钉住:守卫在,两行工具行就正好占两行。

let testSetup: Awaited<ReturnType<typeof testRender>> | undefined

afterEach(() => {
  testSetup?.renderer.destroy()
  testSetup = undefined
})

// 一条真实形状的多行 bash:heredoc 提交信息。模型天天生成这种东西。
const MULTILINE_COMMAND = 'git commit -m "$(cat <<\'EOF\'\nfix: 修一下\n\n第二段说明\nEOF\n)"'

function TwoRows(props: { command: string }) {
  return (
    <box flexDirection="column" width={72}>
      <InlineToolRow complete={true} pending="">
        {props.command}
      </InlineToolRow>
      <InlineToolRow complete={true} pending="">
        读取 src/index.ts
      </InlineToolRow>
    </box>
  )
}

async function renderRows(component: () => JSX.Element) {
  testSetup = await testRender(component, { width: 72, height: 12 })
  await testSetup.renderOnce()
  await testSetup.renderOnce()
  return testSetup
    .captureCharFrame()
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
}

describe("工具行的单行守卫", () => {
  test("压平之后两条工具行正好占两行", async () => {
    const lines = await renderRows(() => <TwoRows command={Locale.oneLine(MULTILINE_COMMAND, 200)} />)
    expect(lines).toHaveLength(2)
    // 第二行还在第二行上,没有被上面撑下去
    expect(lines[1]).toContain("读取 src/index.ts")
  })

  test("压平会把换行折成空格,内容本身不丢", async () => {
    const flat = Locale.oneLine(MULTILINE_COMMAND, 200)
    expect(flat).not.toContain("\n")
    expect(flat).toContain("git commit")
    expect(flat).toContain("EOF")
  })

  test("不压平就会把下面的行顶下去(这就是要守卫的原因)", async () => {
    const lines = await renderRows(() => <TwoRows command={MULTILINE_COMMAND} />)
    expect(lines.length).toBeGreaterThan(2)
  })
})
