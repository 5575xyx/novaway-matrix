/** @jsxImportSource @opentui/solid */
// 空会话 hero 卡的卡片化 + slogan / chips(任务 C4)。
//
// 测的是**生产件本体**:`NeonCard` + `HeroHints`。手抄一份壳的话,改 hero 的 padding 或
// chips 的文案都不会有任何测试变红,而「slogan 42 列 + 卡内 padding 3」这类宽度账就会悄悄失准。
//
// 这里刻意不挂 `EmptySessionHero` 整体:它经 AgentShowcase 依赖 useLocal(),而 LocalProvider
// 要串起 SDK/Sync/Event/Route/Toast —— 与 slogan / chips 的正确性毫无关系。slogan 与 chips
// 因此单独导出成 HeroHints(见该组件的注释)。
import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { NeonCard } from "../../src/component/neon-card"
import { HeroHints } from "../../src/component/empty-session-hero"
import { ThemeReady, ThemeTestProviders } from "../fixture/providers"
import { Locale } from "../../src/util/locale"
import "../../src/ui/card"

// 宽度要够放下整行 slogan(42 列)+ 卡内 padding 3 + 外框 2。
const WIDTH = 70

// 与 hero 里 SLOGAN_SEGMENTS 拼出来的整行一致。写成字面量而不是从组件里导出:
// 这一行是**宽度预算**,改了词就得改这里,而改不动就说明 hero 卡撑不下那一行了。
const SLOGAN_TEXT = "/// · 任务拆解 · 多体协作 · 自动推进 · ///"

const rows = (frame: string) =>
  frame
    .split("\n")
    .map((line) => line.replace(/\s+$/, ""))
    .filter((line) => line.trim().length > 0)

/** 一行自绘边框**之间**的显示列数(去掉边框本身)。captureCharFrame 把每一行都补到满宽,
 *  直接量整行量到的是终端宽度 —— 量出来的「卡片宽度」永远是 WIDTH。 */
function innerColumns(row: string, left: string, right: string) {
  const start = row.indexOf(left) + left.length
  const end = row.indexOf(right, start)
  expect(end, `这一行里没有配对的右边框:\n${row}`).toBeGreaterThan(start)
  return Locale.displayWidth(row.slice(start, end))
}

async function renderHero() {
  const app = await testRender(
    () => (
      <ThemeTestProviders>
        <ThemeReady />
        <box alignItems="center" width="100%">
          {/* 与 EmptySessionHero 里那张卡同一个壳、同一个 width 与 inset(那里多包一层
              paddingTop 的外盒对卡内几何没有影响,见组件的注释)。inset 必须跟着改 ——
              这一节测的是生产件本体,抄漏一个属性就会去量一张生产上并不存在的卡。 */}
          <NeonCard width="auto" inset>
            <box alignItems="center">
              <HeroHints />
            </box>
          </NeonCard>
        </box>
      </ThemeTestProviders>
    ),
    { width: WIDTH, height: 12 },
  )
  try {
    let frame = ""
    for (let attempt = 0; attempt < 80; attempt++) {
      await app.renderOnce()
      frame = app.captureCharFrame()
      if (frame.includes("READY") && frame.includes("╭") && frame.includes("/new")) break
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    return frame
  } finally {
    app.renderer.destroy()
  }
}

test("hero 卡有霓虹卡壳,且 slogan 与 chips 都在卡内", async () => {
  const frame = await renderHero()
  expect(frame).toContain("╭")
  expect(frame).toContain("╯")
  // slogan:首尾 /// + 三个词,词之间夹更暗的 ` · `
  expect(frame).toContain(SLOGAN_TEXT)
  // 原型 card-design-v7.html:898-902 的两颗 chip
  expect(frame).toContain("/new 新建会话")
  expect(frame).toContain("/models 切换模型")
})

test("第三颗 chip(ctrl+alt+k 快捷键)不画 —— which-key 插件 enabled: false,那对键按了没反应", async () => {
  const frame = await renderHero()
  expect(frame).not.toContain("ctrl+alt+k")
  expect(frame).not.toContain("快捷键")
})

test("hero 卡抱内容而不是撑满:描边宽度正好等于最宽那一行(slogan)", async () => {
  const frame = await renderHero()
  const top = rows(frame).find((row) => row.includes("╭"))!
  const slogan = rows(frame).find((row) => row.includes("任务拆解"))!
  // slogan 自身 42 列:`///` 3 + 四段 ` · ` 各 3 + 三个词各 8 + 末尾 `///` 3。
  // 这是这一行最宽的部分,所以卡就是它定的宽(见报告里的窄终端核对项)。
  expect(Locale.displayWidth(SLOGAN_TEXT)).toBe(3 + 4 * 3 + 3 * 8 + 3)
  // 卡抱内容:上下边框之间的宽度 = slogan 那一行两列边框之间的宽度,而两者都远小于终端宽度
  expect(innerColumns(top, "╭", "╮")).toBe(innerColumns(slogan, "│", "│"))
  expect(innerColumns(top, "╭", "╮")).toBeLessThan(WIDTH)
})

// inset 那一档(见 component/neon-card 的 inset):padding 格就是边框格,2 才空得出留白。
// 这一条钉的是「上下各空着一整行」,否则 hero 卡会退回紧贴描边的观感。
test("hero 卡:描边与内容之间空着一整行/一列(inset 生效)", async () => {
  // 剥掉自绘边框字符之后,「留白行」就该什么都不剩(两端那两列边框不算内容)。
  const bare = (row: string) => row.replace(/[│╭╮╰╯─]/g, "").trim()
  const frame = await renderHero()
  const all = rows(frame)
  const at = (index: number) => {
    const row = all[index]
    if (row === undefined) throw new Error(`帧里没有第 ${index} 行:\n${all.join("\n")}`)
    return row
  }
  const top = all.findIndex((row) => row.includes("╭"))
  const bottom = all.findIndex((row) => row.includes("╯"))
  const slogan = all.findIndex((row) => row.includes("任务拆解"))
  // 第 0 行是上边框、第 1 行整行留白,内容从第 2 行开始。
  expect(bare(at(top + 1))).toBe("")
  expect(slogan).toBe(top + 2)
  // 底部同理:最后一行内容与下边框之间还空着一行。
  expect(bare(at(bottom - 1))).toBe("")
  // 左边距本来就是 2(这一档不变),所以左边框列 0 与正文之间至少隔两列。
  const row = at(slogan)
  expect(row.indexOf("/", row.indexOf("│"))).toBeGreaterThanOrEqual(2)
  expect(row.indexOf("任务拆解")).toBeGreaterThan(row.indexOf("│") + 1)
})
