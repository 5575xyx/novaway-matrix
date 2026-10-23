import { describe, expect } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Effect } from "effect"
import { AppFileSystem } from "@novaway/core/filesystem"
import { OutputStyle } from "@/session/output-style"
import { testEffect } from "../lib/effect"

const it = testEffect(AppFileSystem.defaultLayer)

async function project(files: Record<string, string>) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "novaway-style-"))
  for (const [name, content] of Object.entries(files)) {
    const file = path.join(dir, name)
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, content)
  }
  return dir
}

const style = (name: string, body: string, extra = "") => `---\nname: ${name}\n${extra}---\n${body}\n`

describe("output styles", () => {
  it.live("loads project styles with frontmatter", () =>
    Effect.gen(function* () {
      const dir = yield* Effect.promise(() =>
        project({
          ".novaway/output-styles/concise.md": style("concise", "Answer in three sentences.", "description: Short\n"),
        }),
      )
      const styles = yield* OutputStyle.list({ directory: dir, worktree: dir })
      const found = styles.find((item) => item.name === "concise")
      expect(found?.description).toBe("Short")
      expect(found?.body).toBe("Answer in three sentences.")
      // Absent `keep-coding-instructions` keeps the base prompt.
      expect(found?.keepCodingInstructions).toBe(true)
    }),
  )

  it.live("honours keep-coding-instructions: false", () =>
    Effect.gen(function* () {
      const dir = yield* Effect.promise(() =>
        project({
          ".claude/output-styles/plain.md": style("plain", "No preamble.", "keep-coding-instructions: false\n"),
        }),
      )
      const styles = yield* OutputStyle.list({ directory: dir, worktree: dir })
      expect(styles.find((item) => item.name === "plain")?.keepCodingInstructions).toBe(false)
    }),
  )

  it.live("resolves by name and treats `default` as no style", () =>
    Effect.gen(function* () {
      const dir = yield* Effect.promise(() => project({ ".novaway/output-styles/x.md": style("x", "Body.") }))
      expect(yield* OutputStyle.resolve({ directory: dir, worktree: dir, name: "x" })).toBeDefined()
      expect(yield* OutputStyle.resolve({ directory: dir, worktree: dir, name: "missing" })).toBeUndefined()
      expect(yield* OutputStyle.resolve({ directory: dir, worktree: dir, name: "default" })).toBeUndefined()
      expect(yield* OutputStyle.resolve({ directory: dir, worktree: dir, name: undefined })).toBeUndefined()
    }),
  )

  it.live("first match wins when the same style is defined twice", () =>
    Effect.gen(function* () {
      const dir = yield* Effect.promise(() =>
        project({
          ".novaway/output-styles/dup.md": style("dup", "project wins"),
          ".claude/output-styles/dup.md": style("dup", "claude loses"),
        }),
      )
      const styles = yield* OutputStyle.list({ directory: dir, worktree: dir })
      expect(styles.filter((item) => item.name === "dup")).toHaveLength(1)
      expect(styles.find((item) => item.name === "dup")?.body).toBe("project wins")
    }),
  )

  it.live("ignores empty bodies and missing frontmatter names", () =>
    Effect.gen(function* () {
      const dir = yield* Effect.promise(() =>
        project({
          ".novaway/output-styles/empty.md": "---\nname: empty\n---\n\n",
          ".novaway/output-styles/nofm.md": "Just text, named after the file.",
        }),
      )
      const styles = yield* OutputStyle.list({ directory: dir, worktree: dir })
      expect(styles.some((item) => item.name === "empty")).toBe(false)
      // Without frontmatter the filename becomes the style name.
      expect(styles.find((item) => item.name === "nofm")?.body).toBe("Just text, named after the file.")
    }),
  )
})
