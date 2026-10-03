/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { mkdtemp, writeFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { FileTree, clearFileTreeCache } from "../../src/component/file-tree"
import { SidebarCard } from "../../src/component/sidebar-card"
import { FILE_TREE_NAME_MAX } from "../../src/util/sidebar-metrics"
import { Locale } from "../../src/util/locale"
import { DEFAULT_THEMES, resolveTheme } from "../../src/theme"
import { ThemeReady, ThemeTestProviders } from "../fixture/providers"

// 原型那边每个文件行都带一枚语言标签(`<span class="ic tag-ts">TS</span>`,
// card-design-v7.html:800-806),占的是 `.ic` 那一格(固定 14px,见 :209)。这一组盯三件事:
//   · 认得出的扩展名印出正确的标签;
//   · 认不出的**不印**,而且不留一列空白 —— 否则同屏里两类行的文件名起点会差 2 列;
//   · 标签那一格恒定 2 列,于是名字的起点逐列对齐,且没有多占名字的预算(算式见
//     util/sidebar-metrics 的 FILE_TREE_NAME_MAX)。
//
// 挂在 SidebarCard 里量(与 test/component/sidebar-cards.test.tsx 同一手法):裸挂 FileTree
// 时它拿的是整屏宽度,宽度断言没有意义。**按帧里的列量**,不去读渲染树 —— 文本渲染物上的
// `content` 在这套实现里是空的(见 TextRenderable.updateTextBuffer),读不到字面。

// 一屏里同时给出四类标签、两个认不出的文件,以及一个超长名字(名字预算那一档)。
const LONG_NAME = "a-really-long-entry-name-for-truncation.tsx"

const FILES = ["index.ts", "app.jsx", "package.json", "README.md", "logo.png", "Makefile", LONG_NAME]

const TAG_GLYPHS = ["TS", "JS", "{}", "Ⓜ", "PY", "RS"]

/** 一行帧文本 → 每列一个字形。宽字符(emoji)占两列,第二列记 undefined。 */
function columns(line: string) {
  const cells: (string | undefined)[] = []
  for (const part of new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(line)) {
    cells.push(part.segment)
    for (let rest = 1; rest < Locale.displayWidth(part.segment); rest++) cells.push(undefined)
  }
  return cells
}

/**
 * 某个片段在这一行里从第几列开始。
 *
 * 逐格比而不是 `indexOf`:一格宽的 emoji 在 JS 字符串里是**两个**码元,拼起来做下标
 * 算术会把后面所有列都多算 1(踩过:logo.png 的列号因此读成 7,真实是 6)。片段都是 ASCII,
 * 逐格比就是精确的列号。
 */
function columnOf(line: string, needle: string) {
  const cells = columns(line)
  // needle 全是 ASCII(见下面两处用法),所以 split("") 与逐列比对是等价的。
  const wanted = needle.split("")
  for (let start = 0; start + wanted.length <= cells.length; start++) {
    if (wanted.every((char, offset) => (cells[start + offset] ?? "") === char)) return start
  }
  return -1
}

async function renderTree(width: number) {
  const root = await mkdtemp(path.join(tmpdir(), "nw-lang-tag-"))
  clearFileTreeCache()
  for (const name of FILES) await writeFile(path.join(root, name), "")
  const app = await testRender(
    () => (
      <ThemeTestProviders>
        <ThemeReady />
        <SidebarCard title="资源管理器" icon="@" badge="repo" page="files">
          <FileTree rootPath={root} />
        </SidebarCard>
      </ThemeTestProviders>
    ),
    { width, height: 14 },
  )
  for (let attempt = 0; attempt < 200; attempt++) {
    await app.renderOnce()
    if (app.captureCharFrame().includes("a-really-long")) break
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  return {
    app,
    /** 文件名所在的那一行。 */
    row: (name: string) =>
      app
        .captureCharFrame()
        .split("\n")
        .find((line) => line.includes(name)) ?? "",
    async dispose() {
      app.renderer.destroy()
      clearFileTreeCache()
      await rm(root, { recursive: true, force: true })
    },
  }
}

/**
 * 标签占的那两列:名字文本的内容是 " " + 文件名,所以文件名首字母往前数 3 列就是标签头一列
 * (名字文本第 0 列是那个空格,再往前 2 列是标签槽)。
 */
function tagColumns(row: string, name: string) {
  const at = columnOf(row, name)
  expect(at, `${name} 应当出现在这一行里`).toBeGreaterThan(0)
  return [at - 3, at - 2]
}

test("文件树:认得出的扩展名印出语言标签,认不出的不印", async () => {
  const tree = await renderTree(44)
  try {
    for (const [name, tag] of [
      ["index.ts", "TS"],
      ["app.jsx", "JS"],
      ["package.json", "{}"],
      ["README.md", "Ⓜ"],
      [Locale.truncateToWidth(LONG_NAME, FILE_TREE_NAME_MAX), "TS"],
    ] as const) {
      const row = tree.row(name)
      const [head] = tagColumns(row, name)
      expect(columns(row)[head], `${name} 的标签`).toBe(tag[0])
    }
    // 认不出的两个:logo.png 与 Makefile 的标签那一格里是文件图标,不是任何一枚标签。
    // 无扩展名的 Makefile 尤其要盯 —— split(".").pop() 拿到的是整个文件名。
    for (const name of ["logo.png", "Makefile"]) {
      const row = tree.row(name)
      const cells = tagColumns(row, name).map((at) => columns(row)[at] ?? "")
      expect(TAG_GLYPHS.includes(cells.join("")), `${name} 不该有语言标签,实际是 ${JSON.stringify(cells)}`).toBe(false)
    }
  } finally {
    await tree.dispose()
  }
})

// 「不留一列空白」的验收:有标签的行与没有标签的行,文件名起点必须是同一列 ——
// 标签槽恒定 2 列,没有标签时那一格由文件图标接着(emoji 风格也是 2 列)。
test("文件树:标签不占名字的预算,有无标签的行名字起点逐列对齐", async () => {
  const tree = await renderTree(44)
  try {
    const tagged = columnOf(tree.row("index.ts"), "index.ts")
    const untagged = columnOf(tree.row("logo.png"), "logo.png")
    expect(untagged, "logo.png 的名字起点").toBe(tagged)
    // 卡左边框 1 + 缩进 0 + 箭头段 2 + 标签槽 2 + 名字前那个空格 1 = 6。
    // **与加标签之前是同一列**(原来那一格放的是文件图标,也是 2 列):标签没有多占一列。
    expect(tagged).toBe(6)
    // 名字那一段的预算是 FILE_TREE_NAME_MAX(20 列),超出的按显示列截尾成 `…`。
    const shown = Locale.truncateToWidth(LONG_NAME, FILE_TREE_NAME_MAX)
    expect(shown.endsWith("…")).toBe(true)
    const row = tree.row(shown)
    expect(row, `超长名字那一行应当显示 ${shown}`).not.toBe("")
    expect(Locale.displayWidth(shown)).toBeLessThanOrEqual(FILE_TREE_NAME_MAX)
    // 截尾之后仍留在卡内容区之内(44 − 左边框 1 − 右内边距 1 = 42)。
    expect(columnOf(row, shown) + Locale.displayWidth(shown)).toBeLessThanOrEqual(42)
  } finally {
    await tree.dispose()
  }
})

// 每一枚标签有自己的颜色,且与文件名那一列不同色(否则读起来是同一段文字)。
test("文件树:标签各用各的主题色,与文件名不同色", async () => {
  const tree = await renderTree(44)
  try {
    const theme = resolveTheme(DEFAULT_THEMES.novaway, "dark")
    // captureSpans 给的是「一段同色字符」,按**显示列**摊平成「每列一个前景色」。
    // 不能 `for (const _ of span.text)`:那是按码位迭代,emoji 只算一格而它占两列,
    // 摊出来的网格会从第一个宽字符起整体错位 —— 而下面正是拿列号去索引它。
    const grid = tree.app.captureSpans().lines.map((line) => {
      const cells: { r: number; g: number; b: number }[] = []
      for (const span of line.spans) {
        for (const part of new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(span.text)) {
          for (let rest = 0; rest < Locale.displayWidth(part.segment); rest++) {
            cells.push({ r: span.fg.r, g: span.fg.g, b: span.fg.b })
          }
        }
      }
      return cells
    })
    const rows = tree.app.captureSpans().lines.map((line) => line.spans.map((span) => span.text).join(""))
    const read = (name: string, tag: boolean) => {
      const at = rows.findIndex((text) => columnOf(text, name) >= 0)
      expect(at, `${name} 那一行应当有前景色`).toBeGreaterThanOrEqual(0)
      const column = tag ? tagColumns(rows[at], name)[0] : columnOf(rows[at], name)
      return grid[at][column]
    }
    // 纯函数与渲染结果一致(调用点没有另抄一份颜色表):TS 那枚就是 syntaxFunction
    // (novaway 深色 #00e5ff),JS 那枚是 syntaxType(#ffe066)。
    expect(read("index.ts", true)).toEqual({
      r: theme.syntaxFunction.r,
      g: theme.syntaxFunction.g,
      b: theme.syntaxFunction.b,
    })
    expect(read("app.jsx", true)).toEqual({
      r: theme.syntaxType.r,
      g: theme.syntaxType.g,
      b: theme.syntaxType.b,
    })
    // 两枚标签彼此不同色;文件名那一列是 theme.text(选中时 primary),也与标签不同色。
    expect(read("index.ts", true)).not.toEqual(read("app.jsx", true))
    expect(read("index.ts", false)).toEqual({ r: theme.text.r, g: theme.text.g, b: theme.text.b })
  } finally {
    await tree.dispose()
  }
})
