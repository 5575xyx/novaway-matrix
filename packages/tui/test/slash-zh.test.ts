import { describe, expect, test } from "bun:test"
import {
  SLASH_ZH,
  SLASH_DESC_ZH,
  SLASH_ORDER,
  slashDescription,
  slashDisplayName,
  slashTranslationKey,
} from "../src/keymap"

describe("斜杠命令的中文名", () => {
  test("每个命令都有排序权重,不会被挤到面板底部找不到", () => {
    const missing = Object.keys(SLASH_ZH).filter((name) => SLASH_ORDER[name] === undefined)
    expect(missing).toEqual([])
  })

  test("固定命令和动态 MCP 命令都显示中文", () => {
    expect(slashDisplayName("redraw")).toBe("/重绘")
    expect(slashDisplayName("sidebar")).toBe("/侧边栏")
    expect(slashDisplayName("fetch:fetch:mcp", "mcp")).toBe("/抓取（MCP）")
    expect(slashTranslationKey("fetch:fetch:mcp")).toBe("fetch")
    expect(slashDescription("diff", "Open Diff viewer")).toBe("打开差异查看器")
    expect(slashDescription("fetch:fetch:mcp", "Fetch a URL and extract its contents as markdown", undefined, "mcp")).toBe(
      "抓取网页内容并转成 Markdown",
    )
    expect(slashDescription("unknown:tool:mcp", "An English MCP description", undefined, "mcp")).toBe("执行 MCP 命令")
  })
  test("中文名和别名互不冲突,否则面板里会互相盖掉", () => {
    const seen = new Map<string, string>()
    const collisions: string[] = []
    for (const [name, list] of Object.entries(SLASH_ZH)) {
      for (const zh of list) {
        const prev = seen.get(zh)
        if (prev) collisions.push(`${zh}: ${prev} & ${name}`)
        seen.set(zh, name)
      }
    }
    expect(collisions).toEqual([])
  })


  test("后台并行子代理用全名做主显示名,简称仍可输入", () => {
    expect(SLASH_ZH["background-subagents"]?.[0]).toBe("后台并行子代理")
    expect(SLASH_ZH["background-subagents"]).toContain("后台并行")
  })

  test("中文说明覆盖里没有残留英文(专有名词如 Markdown/AGENTS.md 例外)", () => {
    for (const [name, desc] of Object.entries(SLASH_DESC_ZH)) {
      expect(desc, name).not.toMatch(/(?<![A-Za-z])[a-z]{4,}/)
    }
  })
})
