import { afterEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Effect } from "effect"
import { SessionMemoryNotes } from "../../src/session/memory-notes"

const dirs: string[] = []

async function dataDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "novaway-notes-"))
  dirs.push(dir)
  SessionMemoryNotes.setDataDir(dir)
  return dir
}

afterEach(async () => {
  SessionMemoryNotes.setDataDir(undefined)
  SessionMemoryNotes.reset()
  await Promise.all(dirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })))
})

describe("session.memory-notes", () => {
  test("treats the untouched template as empty", () => {
    expect(SessionMemoryNotes.isTemplate(SessionMemoryNotes.TEMPLATE)).toBe(true)
    expect(SessionMemoryNotes.isTemplate(SessionMemoryNotes.TEMPLATE + "\n\n")).toBe(true)
    const filled = SessionMemoryNotes.TEMPLATE.replace(
      "_What is actively being worked on right now? Pending tasks not yet completed. Immediate next steps._",
      "Refactoring the shell tool.",
    )
    expect(SessionMemoryNotes.isTemplate(filled)).toBe(false)
  })

  test("read ignores missing and template-only notes", async () => {
    await dataDir()
    expect(await SessionMemoryNotes.read("ses_missing")).toBeUndefined()
    await SessionMemoryNotes.write("ses_template", SessionMemoryNotes.TEMPLATE)
    expect(await SessionMemoryNotes.read("ses_template")).toBeUndefined()
    await SessionMemoryNotes.write("ses_filled", SessionMemoryNotes.TEMPLATE + "\nSome real work.\n")
    expect(await SessionMemoryNotes.read("ses_filled")).toContain("Some real work.")
  })

  test("truncate leaves short notes intact and cuts oversized sections", () => {
    const short = "# Current State\n_something_\nShort body."
    expect(SessionMemoryNotes.truncate(short)).toEqual({ text: short, truncated: false })

    const huge = ["# Current State", "_desc_", "x".repeat(9_000), "", "# Worklog", "_desc_", "done"].join("\n")
    const cut = SessionMemoryNotes.truncate(huge)
    expect(cut.truncated).toBe(true)
    expect(cut.text).toContain("[... section truncated for length ...]")
    expect(cut.text).toContain("# Worklog")
    expect(cut.text.length).toBeLessThan(huge.length)
  })

  test("truncate enforces the total budget", () => {
    const sections = Array.from({ length: 12 }, (_, index) =>
      [`# Section ${index}`, "_desc_", "y".repeat(7_000)].join("\n"),
    )
    const cut = SessionMemoryNotes.truncate(sections.join("\n\n"))
    expect(cut.truncated).toBe(true)
    expect(cut.text.endsWith("[... session notes truncated for length ...]")).toBe(true)
    expect(cut.text.length).toBeLessThanOrEqual(SessionMemoryNotes.MAX_TOTAL_TOKENS * 4 + 60)
  })

  test("shouldExtract waits for the init threshold, then for growth and tool calls", () => {
    const base = { initialized: false, currentTokens: 0, lastTokens: 0, toolCalls: 0, lastTurnHasToolCalls: true }
    expect(SessionMemoryNotes.shouldExtract({ ...base, currentTokens: 9_999 })).toBe(false)
    expect(SessionMemoryNotes.shouldExtract({ ...base, currentTokens: 10_000 })).toBe(true)

    const grown = { ...base, initialized: true, lastTokens: 10_000 }
    expect(SessionMemoryNotes.shouldExtract({ ...grown, currentTokens: 14_999, toolCalls: 5 })).toBe(false)
    expect(SessionMemoryNotes.shouldExtract({ ...grown, currentTokens: 15_000, toolCalls: 2 })).toBe(false)
    expect(SessionMemoryNotes.shouldExtract({ ...grown, currentTokens: 15_000, toolCalls: 3 })).toBe(true)
    // 回合收尾（最后一次没有工具调用）时不必再等三次工具调用。
    expect(
      SessionMemoryNotes.shouldExtract({
        ...grown,
        currentTokens: 15_000,
        toolCalls: 0,
        lastTurnHasToolCalls: false,
      }),
    ).toBe(true)
  })

  test("extractionPrompt asks for the complete file and names the path", async () => {
    const dir = await dataDir()
    const target = SessionMemoryNotes.file("ses_prompt")
    const prompt = SessionMemoryNotes.extractionPrompt(SessionMemoryNotes.TEMPLATE, target)
    expect(prompt).toContain(target)
    expect(target.startsWith(dir)).toBe(true)
    expect(prompt).toContain("COMPLETE updated markdown file")
    expect(prompt).toContain("<current_notes_content>")
  })

  test("maybeUpdate does nothing below the threshold", async () => {
    await dataDir()
    const provider = {
      getLanguage: () => Effect.die(new Error("language model should not be requested")),
    }
    const result = await Effect.runPromiseExit(
      SessionMemoryNotes.maybeUpdate({
        sessionID: "ses_low",
        provider: provider as never,
        model: {} as never,
        messages: [],
        tokens: 500,
        lastTurnHasToolCalls: true,
        lastMessageID: "msg_1",
      }),
    )
    expect(result._tag).toBe("Success")
    expect(SessionMemoryNotes.state("ses_low")).toBeUndefined()
    expect(await SessionMemoryNotes.read("ses_low")).toBeUndefined()
  })
})
