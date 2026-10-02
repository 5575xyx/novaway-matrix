/** @jsxImportSource @opentui/solid */
// D2 备下的流程图视图占位。**D3 会把 ChatViewFlowPlaceholder 整个删掉**,所以这个文件到那时
// 应该整体删除或改写成画布自己的测试。
//
// 这里只钉一件事:切到 flow 视图之后画面上必须有话说清楚「这一版画布还没做、怎么切回去」。
// 空白不是可接受的降级 —— 那是「界面坏了」,用户会去怀疑自己按错了什么。
import { afterAll, beforeAll, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { ChatViewFlowPlaceholder } from "../../../src/routes/session"
import { currentIconStyle, icon, setIconStyle } from "../../../src/util/panel-icons"
import { Locale } from "../../../src/util/locale"
import { ThemeReady, ThemeTestProviders } from "../../fixture/providers"

const PREVIOUS_STYLE = currentIconStyle()
beforeAll(() => setIconStyle("emoji"))
afterAll(() => setIconStyle(PREVIOUS_STYLE))

async function render(width: number) {
  const app = await testRender(
    () => (
      <ThemeTestProviders>
        <ThemeReady />
        <box height={12} flexDirection="column">
          <ChatViewFlowPlaceholder />
        </box>
      </ThemeTestProviders>
    ),
    { width, height: 14 },
  )
  try {
    let text = ""
    for (let attempt = 0; attempt < 200; attempt++) {
      await app.renderOnce()
      text = app.captureCharFrame()
      if (text.includes("READY") && text.includes("流程图视图")) break
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    return text.split("\n").map((line) => line.replace(/\s+$/, ""))
  } finally {
    app.renderer.destroy()
  }
}

test("流程图视图占位:说清「还没做」与「怎么切回去」", async () => {
  const rows = await render(72)
  const text = rows.join("\n")
  // 「还没做」:不说清楚就是一片空白,看起来像界面坏了
  expect(text).toContain("流程图视图")
  expect(text).toContain("画布尚未实现")
  // 「怎么切回去」:两条路都要给 —— 命令与那颗胶囊
  expect(text).toContain("/layout bubble")
  expect(text).toContain("视图")
})

test("流程图视图占位:窄到放不下也不折行成两倍高", async () => {
  for (const width of [40, 56, 72]) {
    const rows = await render(width)
    for (const row of rows) expect(Locale.displayWidth(row), `${width} 列`).toBeLessThanOrEqual(width)
    expect(rows.join("\n"), `${width} 列`).toContain("画布尚未实现")
  }
})

// 图标随 icons 风格走:emoji 用原型的 ◱,另外两套降级成宽度可预测的字形。
test("流程图视图占位:图标随 icons 风格变化", async () => {
  for (const style of ["emoji", "nerdfont", "ascii"] as const) {
    setIconStyle(style)
    const rows = await render(72)
    expect(rows.join("\n"), style).toContain(icon("view"))
  }
  setIconStyle("emoji")
})
