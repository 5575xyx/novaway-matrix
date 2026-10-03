import { describe, expect, test } from "bun:test"
import { fileTag, fileTagColor, filetype } from "../../src/util/filetype"
import { Locale } from "../../src/util/locale"
import { DEFAULT_THEMES, resolveTheme } from "../../src/theme"

const KINDS = ["ts", "js", "json", "md", "py", "rs"] as const

// WCAG 相对亮度 → 对比度。与 theme/index.ts 的 terminalMode / selectedForeground 用的是
// 同一套 0.299/0.587/0.114 的思路,这里按 WCAG 的 0.2126/0.7152/0.1222 权重算。
function luminance(color: { r: number; g: number; b: number }) {
  const channel = (value: number) => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
  return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.1222 * channel(color.b)
}

function contrast(a: { r: number; g: number; b: number }, b: { r: number; g: number; b: number }) {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (high + 0.05) / (low + 0.05)
}

describe("util.filetype", () => {
  test("maps filenames to presentation languages", () => {
    expect(filetype("component.tsx")).toBe("typescript")
    expect(filetype("script.js")).toBe("typescript")
    expect(filetype("main.py")).toBe("python")
    expect(filetype("README.unknown")).toBeUndefined()
  })

  test("uses none for missing filenames", () => {
    expect(filetype()).toBe("none")
    expect(filetype("")).toBe("none")
  })
})

// 文件树那一列的语言标签(原型 card-design-v7.html:800-806)。
describe("util.fileTag", () => {
  test("扩展名 → 标签字面(原型那四个 + 两个)", () => {
    expect(fileTag("index.tsx")).toEqual({ kind: "ts", text: "TS" })
    expect(fileTag("index.ts")).toEqual({ kind: "ts", text: "TS" })
    expect(fileTag("probe-browser-qa.cjs")).toEqual({ kind: "js", text: "JS" })
    expect(fileTag("app.jsx")).toEqual({ kind: "js", text: "JS" })
    expect(fileTag("package.json")).toEqual({ kind: "json", text: "{}" })
    expect(fileTag("tsconfig.json")).toEqual({ kind: "json", text: "{}" })
    expect(fileTag("README.md")).toEqual({ kind: "md", text: "Ⓜ" })
    expect(fileTag("main.py")).toEqual({ kind: "py", text: "PY" })
    expect(fileTag("lib.rs")).toEqual({ kind: "rs", text: "RS" })
  })

  test("认不出的扩展名与无扩展名的文件都没有标签(调用方据此落回文件图标)", () => {
    expect(fileTag("logo.png")).toBeUndefined()
    expect(fileTag("notes.unknown")).toBeUndefined()
    expect(fileTag("Makefile")).toBeUndefined()
    expect(fileTag(".gitignore")).toBeUndefined()
  })

  // 标签槽是固定 2 列的盒子(见 component/file-tree 的渲染处),所以每个标签都不得
  // 超过 2 列 —— 超了就会把这一行的固定开销从 2×深度+6 顶成 +3,名字跟着右移。
  // `Ⓜ` 是 East-Asian Ambiguous:按标准口径记 1 列(Bun.stringWidth 就是这么量的),
  // 开了 ambiguous-wide 的 CJK 终端会渲成 2 列,仍在预算内。
  test("每个标签都不超过 2 列", () => {
    for (const name of ["index.tsx", "app.jsx", "package.json", "README.md", "main.py", "lib.rs"]) {
      const tag = fileTag(name)!
      expect(Locale.displayWidth(tag.text), `${name} 的标签`).toBeLessThanOrEqual(2)
    }
  })
})

// 颜色取自语法高亮那一族(理由与逐档实测值见 src/util/filetype 的 fileTagColor 注释)。
describe("util.fileTagColor", () => {
  test("每一档都取一个主题 token,而且深浅两套取值不同", () => {
    const dark = resolveTheme(DEFAULT_THEMES.novaway, "dark")
    const light = resolveTheme(DEFAULT_THEMES.novaway, "light")
    expect(fileTagColor("ts", dark)).toBe(dark.syntaxFunction)
    expect(fileTagColor("js", dark)).toBe(dark.syntaxType)
    expect(fileTagColor("json", dark)).toBe(dark.syntaxNumber)
    expect(fileTagColor("md", dark)).toBe(dark.syntaxKeyword)
    expect(fileTagColor("py", dark)).toBe(dark.syntaxString)
    expect(fileTagColor("rs", dark)).toBe(dark.syntaxVariable)
    // 明暗两套不是同一个色(否则有一档在某个主题下会读不出来)。
    for (const kind of KINDS) {
      expect(fileTagColor(kind, light)).not.toBe(fileTagColor(kind, dark))
    }
  })

  test("六档两两不同色(同屏里要能一眼分清是哪一类文件)", () => {
    for (const mode of ["dark", "light"] as const) {
      const theme = resolveTheme(DEFAULT_THEMES.novaway, mode)
      const colors = KINDS.map((kind) => JSON.stringify(fileTagColor(kind, theme)))
      expect(new Set(colors).size, `${mode} 下六档颜色`).toBe(KINDS.length)
    }
  })

  // 门槛 2.7 是照着原型定的:原型那四个标签色落在同一块面板底(#edf0f5)上是 1.29 ~ 2.53 ——
  // 全部在这条线以下。也就是说这条断言就是「至少要比原型那套清楚」。
  test("每一档落在面板底上的对比度都高于原型那一档(2.7:1)", () => {
    for (const mode of ["dark", "light"] as const) {
      const theme = resolveTheme(DEFAULT_THEMES.novaway, mode)
      for (const kind of KINDS) {
        expect(contrast(fileTagColor(kind, theme), theme.backgroundPanel), `${mode} 的 ${kind}`).toBeGreaterThan(2.7)
      }
    }
  })
})
