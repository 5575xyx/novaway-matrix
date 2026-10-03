/** @jsxImportSource @opentui/solid */
// 空会话 hero 卡的卡片化 + slogan / chips(任务 C4)+ 底部快捷键提示的键帽(任务 2)。
//
// 测的是**生产件本体**:`NeonCard` + `HeroHints` + `HeroShortcutHint`。手抄一份壳的话,改 hero 的
// padding 或 chips 的文案都不会有任何测试变红,而「slogan 42 列 + 卡内 padding 3」这类宽度账就会悄悄失准。
//
// 这里刻意不挂 `EmptySessionHero` 整体:它经 AgentShowcase 依赖 useLocal(),而 LocalProvider
// 要串起 SDK/Sync/Event/Route/Toast —— 与 slogan / chips / 快捷键提示的正确性毫无关系。这两段
// 因此单独导出成 HeroHints 与 HeroShortcutHint(见该组件的注释)。
import { expect, test } from "bun:test"
import { onCleanup } from "solid-js"
import type { JSX } from "solid-js"
import { testRender, useRenderer } from "@opentui/solid"
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { createBindingLookup } from "@opentui/keymap/extras"
import { NeonCard } from "../../src/component/neon-card"
import {
  HeroHints,
  HeroShortcutHint,
  HERO_HINT_CHROME,
  heroHintLayout,
  keycapColumns,
} from "../../src/component/empty-session-hero"
import { ThemeReady, ThemeTestProviders } from "../fixture/providers"
import { TuiKeybind } from "../../src/config/keybind"
import { Locale } from "../../src/util/locale"
import { NovaWayKeymapProvider, formatKeySequence, registerNovaWayKeymap, type OpenTuiKeymap } from "../../src/keymap"
import { resolveTheme, type ThemeJson } from "../../src/theme"
import novawayTheme from "../../src/theme/assets/novaway.json" with { type: "json" }
import "../../src/ui/card"

// 与 ThemeProvider mode="dark" 下的默认主题同一份(见 fixture/providers),用来断言键帽那一格
// 的底色与字色真的换了色 —— 换成什么色是这条断言的全部内容。
const THEME = resolveTheme(novawayTheme as ThemeJson, "dark")

function cell(rgba: { r: number; g: number; b: number }) {
  return `${rgba.r.toFixed(4)},${rgba.g.toFixed(4)},${rgba.b.toFixed(4)}`
}

/** captureSpans 给的是「一段同底色字符」;键帽与句子是两枚不同的盒子,各自成段。 */
function styleOfGlyph(app: HintHarness, glyph: string) {
  for (const line of app.captureSpans().lines) {
    const span = line.spans.find((item) => item.text.includes(glyph))
    if (span) return { fg: cell(span.fg), bg: cell(span.bg) }
  }
  throw new Error(`帧里找不到 ${glyph}`)
}

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

// ── 底部那行快捷键提示:键位渲染成键帽(任务 2)─────────────────────────────
//
// 原型 card-design-v7.html:913 是 `⌨<kbd>ctrl</kbd>+<kbd>alt</kbd>+<kbd>k</kbd> 查看键盘快捷键`,
// 那个 <kbd> 是 `background: var(--element)` + 一圈 1px 描边 + `color: var(--text)`
// (:386-390)。终端里一行就是一格,**带边框的盒子要占掉整整三行**(上/内容/下),所以
// 描边这一半在单行里画不出来 —— 键帽只剩「一枚被点亮的面 + 比正文亮一档的字」。
// 那一档正是本仓库给「键」的那套现成处理:component/prompt/card 的 PromptSend 发送按钮
// (`backgroundPanel` 底 + theme.text 字 + 左右各 1 列内边距),与 queue-dock 的行内按钮同款。

const HINT_KEY = "ctrl+alt+k"
// 一整行 = `按 ` 3 + 键帽(键名 10 + 左右内边距 2)12 + ` ` 1 + `查看键盘快捷键` 14 = 30 列。
const HINT_LEAD_COLUMNS = 3 + keycapColumns(HINT_KEY)
const HINT_TAIL_COLUMNS = Locale.displayWidth("查看键盘快捷键")
const HINT_FULL_COLUMNS = HINT_LEAD_COLUMNS + 1 + HINT_TAIL_COLUMNS

test("键帽的列宽 = 键名 + 左右各 1 列内边距(与发送按钮同一档)", () => {
  expect(keycapColumns("enter")).toBe(7)
  expect(keycapColumns(HINT_KEY)).toBe(12)
})

// heroHintLayout 的返回值只有两种:一个对象 = 这一行要画(尾巴可能为空串),
// undefined = 整行不画。**空串与 undefined 必须分得清**:预算刚好够 `按 <键帽>` 而
// 一列都不剩给句子时,画出来的是「按 [键帽]」而不是什么都没有。
test("宽度够时提示行是原型那一句,键位包在键帽里", () => {
  expect(HINT_FULL_COLUMNS).toBe(30)
  expect(heroHintLayout(HINT_KEY, HINT_FULL_COLUMNS)).toEqual({ tail: "查看键盘快捷键" })
  // 上下各留 1 列余量也还是整句
  expect(heroHintLayout(HINT_KEY, HINT_FULL_COLUMNS + 1)).toEqual({ tail: "查看键盘快捷键" })
})

test("窄一档时截的是句子尾巴,键帽与 `按 ` 一个字都不动", () => {
  // 剩 13 列给 14 列的尾巴 → 前 6 个字(12 列)+ 省略号 = `查看键盘快捷…`。
  expect(heroHintLayout(HINT_KEY, HINT_LEAD_COLUMNS + 1 + 13)).toEqual({ tail: "查看键盘快捷…" })
  // 剩 4 列 → `查…`;剩 1 列 → 只剩省略号。键帽仍然完整。
  expect(heroHintLayout(HINT_KEY, HINT_LEAD_COLUMNS + 1 + 4)).toEqual({ tail: "查…" })
  expect(heroHintLayout(HINT_KEY, HINT_LEAD_COLUMNS + 1 + 1)).toEqual({ tail: "…" })
})

test("刚好只够 `按 <键帽>` 时保留这一行、只是没有句子(不是整行消失)", () => {
  expect(heroHintLayout(HINT_KEY, HINT_LEAD_COLUMNS)).toEqual({ tail: "" })
  // 连分隔空格那一列都不给:仍然保留键帽与 `按 `
  expect(heroHintLayout(HINT_KEY, HINT_LEAD_COLUMNS - 1)).toBeUndefined()
})

test("连 `按 <键帽>` 都放不下时整行不画 —— 半截键帽比没有键帽更糟", () => {
  expect(heroHintLayout(HINT_KEY, HINT_LEAD_COLUMNS - 1)).toBeUndefined()
  expect(heroHintLayout(HINT_KEY, 0)).toBeUndefined()
})

test("键位配成 none 时整行不画(而不是画一枚空键帽)", () => {
  expect(heroHintLayout("", 200)).toBeUndefined()
})

// 渲染层:键帽必须是**一枚有底色的盒子**,而不是句子里的一段纯文字 ——
// 后者正是改动前的样子(键与句子同为一种颜色,读起来是「按 ctrl+alt+k 显示…」的一句话)。
type KeymapConfig = ReturnType<typeof createResolvedKeymapConfig>

function createResolvedKeymapConfig(input: TuiKeybind.KeybindOverrides) {
  const keybinds = TuiKeybind.parse(input)
  return {
    keybinds: createBindingLookup(TuiKeybind.toBindingConfig(keybinds), {
      commandMap: TuiKeybind.CommandMap,
      bindingDefaults: TuiKeybind.bindingDefaults(),
    }),
    leader_timeout: 2000,
  }
}

// help.show 在生产里由 app.tsx:964 注册,默认绑定是 keybind.ts:59 的 "none"。
// 这里挂一条同名的命令并**故意改掉键位**,这样「写死 ctrl+alt+k」的实现一定被断言打红。
let mounted: { keymap: OpenTuiKeymap; config: KeymapConfig } | undefined

function HintKeymapLayer(props: { overrides: TuiKeybind.KeybindOverrides; children: JSX.Element }) {
  const renderer = useRenderer()
  const keymap = createDefaultOpenTuiKeymap(renderer)
  const config = createResolvedKeymapConfig(props.overrides)
  const offKeymap = registerNovaWayKeymap(keymap, renderer, config)
  const offLayer = keymap.registerLayer({
    commands: [{ name: "help.show", run() {} }],
    bindings: config.keybinds.gather("test.app", ["help.show"]),
  })
  mounted = { keymap, config }
  onCleanup(() => {
    mounted = undefined
    offLayer()
    offKeymap()
  })
  return <NovaWayKeymapProvider keymap={keymap}>{props.children}</NovaWayKeymapProvider>
}

/** 与 useCommandShortcut 内部同一条路径(getCommandBindings → formatKeySequence),但在组件之外
 *  独立算一遍:期望值不该由被测组件自己提供。 */
function expectedHelpKey() {
  const value = mounted
  if (!value) return ""
  const bindings = value.keymap
    .getCommandBindings({ visibility: "registered", commands: ["help.show"] })
    .get("help.show")
  return formatKeySequence(bindings?.[0]?.sequence, value.config)
}

type HintHarness = Awaited<ReturnType<typeof testRender>>

async function renderHint(overrides: TuiKeybind.KeybindOverrides, width: number): Promise<HintHarness> {
  const Body = () => (
    <box alignItems="center" width="100%">
      {/* 与 EmptySessionHero 里那张卡同一个壳、同一个 width 与 inset —— 键帽左内边距那一格
          要落在卡内,所以这张壳必须是真的。 */}
      <NeonCard width="auto" inset>
        <box alignItems="center">
          <HeroShortcutHint />
        </box>
      </NeonCard>
    </box>
  )
  const app = await testRender(
    () => (
      // 只加 keymap 层,不另套 TuiConfigProvider:useCommandShortcut 只从 useTuiConfig 取
      // formatKeySequence 的显示选项,键位本身来自 keymap 层(这里按 overrides 现挂一条
      // help.show),所以覆盖 TuiConfigProvider 的 keybinds 对渲染出来的那一格没有任何影响。
      <ThemeTestProviders>
        <ThemeReady />
        <HintKeymapLayer overrides={overrides}>
          <Body />
        </HintKeymapLayer>
      </ThemeTestProviders>
    ),
    { width, height: 6 },
  )
  let frame = ""
  for (let attempt = 0; attempt < 80; attempt++) {
    await app.renderOnce()
    frame = app.captureCharFrame()
    if (frame.includes("READY") && frame.includes("╭")) break
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  expect(frame).toContain("READY")
  return app
}

function frameOf(app: HintHarness) {
  return app
    .captureCharFrame()
    .split("\n")
    .map((line) => line.replace(/\s+$/, ""))
    .join("\n")
}

test("提示行:键位渲染成一枚有底色、比句子亮一档的键帽,键名跟着真实绑定走", async () => {
  const app = await renderHint({ help_show: "ctrl+alt+k" }, 60)
  try {
    const frame = frameOf(app)
    expect(expectedHelpKey()).toBe("ctrl+alt+k")
    // 整句一字不差(原型 card-design-v7.html:913 的措辞)
    expect(frame).toContain("按")
    expect(frame).toContain("查看键盘快捷键")
    // 键帽是**一枚盒子**,不是句子里的一段纯文字:底色 backgroundPanel,文字比句子亮一档
    // (句子是 textMuted = 原型的 --muted,键帽是 text = 原型的 --text)。
    const chip = styleOfGlyph(app, "ctrl+alt+k")
    expect(chip.bg).toBe(cell(THEME.backgroundPanel))
    expect(chip.fg).toBe(cell(THEME.text))
    const sentence = styleOfGlyph(app, "查")
    expect(sentence.bg).not.toBe(cell(THEME.backgroundPanel))
    expect(sentence.fg).toBe(cell(THEME.textMuted))
    // 键帽左边的内边距是它自己的格子(那一格是底色),不是句子里的一格空白
    expect(frame).toMatch(/按 {2}ctrl\+alt\+k/)
  } finally {
    app.renderer.destroy()
  }
})

test("提示行:键位被改绑时键帽里是那一位新键,不是写死的 ctrl+alt+k", async () => {
  const app = await renderHint({ help_show: "f1" }, 60)
  try {
    expect(expectedHelpKey()).toBe("f1")
    const frame = frameOf(app)
    expect(frame).toContain("f1")
    expect(frame).not.toContain("ctrl+alt+k")
  } finally {
    app.renderer.destroy()
  }
})

test("提示行:窄终端下先截句子,键帽整枚留在行内", async () => {
  // 预算 = 终端宽 − 卡内左右 padding(HERO_HINT_CHROME)。宽 40 → 预算 36 ≥ 30,整句放得下;
  // 宽 24 → 预算 20 = `按 ` 3 + 键帽 12 + 分隔 1 + 尾巴 4 → 句子截成 `查…`。
  expect(HERO_HINT_CHROME).toBe(4)
  const wide = await renderHint({ help_show: "ctrl+alt+k" }, 40)
  try {
    expect(frameOf(wide)).toContain("查看键盘快捷键")
  } finally {
    wide.renderer.destroy()
  }
  const narrow = await renderHint({ help_show: "ctrl+alt+k" }, 24)
  try {
    const frame = frameOf(narrow)
    expect(frame).toContain("查…")
    expect(frame).not.toContain("查看键盘快捷键")
    // 键帽一枚完整:键名一个字符都没少
    expect(frame).toContain("ctrl+alt+k")
  } finally {
    narrow.renderer.destroy()
  }
})

test("提示行:窄到只够键帽时保留 `按 <键帽>`,句子整段让光", async () => {
  // 宽 19 → 预算 15 = `按 ` 3 + 键帽 12,一列都不剩给分隔空格与句子。
  // 这一档最容易被写成「整行不画」——空串在 JSX 里是 falsy,外层 Show 会把整行吃掉。
  const app = await renderHint({ help_show: "ctrl+alt+k" }, 19)
  try {
    const frame = frameOf(app)
    expect(frame).toContain("ctrl+alt+k")
    expect(frame).toContain("按")
    expect(frame).not.toContain("查看键盘快捷键")
    expect(frame).not.toContain("…")
  } finally {
    app.renderer.destroy()
  }
})

test("提示行:窄到连键帽都放不下时整行不画(不留半枚键帽)", async () => {
  const app = await renderHint({ help_show: "ctrl+alt+k" }, 12)
  try {
    // 预算 8 < `按 ` 3 + 键帽 12 = 15
    const frame = frameOf(app)
    expect(frame).not.toContain("ctrl+alt+k")
    expect(frame).not.toContain("查看键盘快捷键")
    expect(frame).not.toContain("按")
  } finally {
    app.renderer.destroy()
  }
})

test("提示行:help.show 配成 none 时整行不画", async () => {
  const app = await renderHint({}, 60)
  try {
    expect(frameOf(app)).not.toContain("查看键盘快捷键")
  } finally {
    app.renderer.destroy()
  }
})
