import { describe, expect, spyOn, test } from "bun:test"
import { marked } from "marked"
import { plainParagraphText, plainStreamingRender, stream } from "./markdown-stream"

describe("markdown stream", () => {
  test("splits stable plain paragraphs so later deltas only reparse the live tail", async () => {
    const text = "First completed paragraph.\n\nSecond paragraph still streaming"
    const blocks = stream(text, true)
    expect(blocks).toEqual([
      { raw: "First completed paragraph.\n\n", src: "First completed paragraph.\n\n", mode: "full" },
      { raw: "Second paragraph still streaming", src: "Second paragraph still streaming", mode: "live" },
    ])
    const rendered = await Promise.all(blocks.map((block) => Promise.resolve(marked.parse(block.src))))
    expect(rendered.join("")).toBe(await Promise.resolve(marked.parse(text)))
  })

  test("returns a single safe prose paragraph without running Markdown healing", () => {
    const text = "A single plain streaming paragraph with no Markdown syntax."
    expect(stream(text, true)).toEqual([{ raw: text, src: text, mode: "live" }])
  })

  test("recognizes plain streaming paragraphs that can bypass tokenization and sanitization", async () => {
    const text = "A & useful paragraph\nwith a second line."
    const plain = plainParagraphText(text)
    expect(plain).toBe("A & useful paragraph\nwith a second line.")
    const escaped = plain!
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;")
    expect(`<p>${escaped}</p>\n`).toBe(await Promise.resolve(marked.parse(plain!)))
    expect(plainStreamingRender(text)?.html).toBe(await Promise.resolve(marked.parse(text)))
    const paragraphs = "First paragraph.\n\nSecond paragraph with & safely escaped."
    const render = plainStreamingRender(paragraphs)
    expect(render?.html).toBe(await Promise.resolve(marked.parse(paragraphs)))
    expect(render?.paragraphCount).toBe(2)
    expect(render?.tailText).toBe("Second paragraph with & safely escaped.")
    const extended = plainStreamingRender(`${paragraphs} More text`, render)
    expect(extended?.stableHtml).toBe(render?.stableHtml)
    expect(extended?.tailText).toBe("Second paragraph with & safely escaped. More text")
    expect(extended?.html).toBe(await Promise.resolve(marked.parse(`${paragraphs} More text`)))
    expect(plainParagraphText("Read https://example.com for details.")).toBeUndefined()
    expect(plainParagraphText("Mail hello@example.com for details.")).toBeUndefined()
    expect(plainParagraphText("Use **emphasis** here.")).toBeUndefined()
    expect(plainStreamingRender("Use &copy; entities.")).toBeUndefined()
    expect(plainStreamingRender(" leading whitespace")).toBeUndefined()
    expect(plainStreamingRender("Hard  \nbreak")).toBeUndefined()
    expect(plainStreamingRender("Escaped \\*markdown\\*.")).toBeUndefined()
  })

  test("does not split paragraphs containing markdown syntax", () => {
    const text = "First paragraph with **emphasis**.\n\nSecond paragraph"
    expect(stream(text, true)).toEqual([{ raw: text, src: text, mode: "live" }])
  })

  test("heals incomplete emphasis while streaming", () => {
    expect(stream("hello **world", true)).toEqual([{ raw: "hello **world", src: "hello **world**", mode: "live" }])
    expect(stream("say `code", true)).toEqual([{ raw: "say `code", src: "say `code`", mode: "live" }])
  })

  test("keeps incomplete links non-clickable until they finish", () => {
    expect(stream("see [docs](https://example.com/gu", true)).toEqual([
      { raw: "see [docs](https://example.com/gu", src: "see docs", mode: "live" },
    ])
  })

  test("splits an unfinished trailing code fence from stable content", () => {
    expect(stream("before\n\n```ts\nconst x = 1", true)).toEqual([
      { raw: "before\n\n", src: "before\n\n", mode: "live" },
      { raw: "```ts\nconst x = 1", src: "```ts\nconst x = 1", mode: "live" },
    ])
  })

  test("skips the preliminary lexer for prose and still splits an indented tilde fence", () => {
    const lexer = spyOn(marked, "lexer")
    try {
      const plain = "Use `helper()` in a paragraph."
      expect(stream(plain, true)).toEqual([{ raw: plain, src: plain, mode: "live" }])
      expect(lexer).not.toHaveBeenCalled()
      const code = ["before", "", "  ~~~sh", "printf hello"].join(String.fromCharCode(10))
      const blocks = stream(code, true)
      expect(blocks).toHaveLength(2)
      expect(blocks[0]?.raw).toBe("before\n\n")
      expect(blocks[1]?.raw.startsWith("  ~~~sh\n")).toBe(true)
      expect(lexer).toHaveBeenCalledTimes(1)
    } finally {
      lexer.mockRestore()
    }
  })

  test("keeps reference-style markdown as one block", () => {
    expect(stream("[docs][1]\n\n[1]: https://example.com", true)).toEqual([
      {
        raw: "[docs][1]\n\n[1]: https://example.com",
        src: "[docs][1]\n\n[1]: https://example.com",
        mode: "live",
      },
    ])
  })
})
