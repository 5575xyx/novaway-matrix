import { describe, expect } from "bun:test"
import path from "node:path"
import { Effect } from "effect"
import { run } from "@/hook/exec"
import type * as Hook from "@/hook/schema"
import { TestInstance } from "../fixture/fixture"
import { Layer } from "effect"
import { testEffect } from "../lib/effect"

// `run()` itself needs no services; the harness still wants a layer.
const it = testEffect(Layer.empty)

const marker = (dir: string, name: string) => path.join(dir, name)
const write = (file: string) => `node -e "require('fs').writeFileSync(process.argv[1], 'ran')" "${file}"`

const exists = (file: string) => Bun.file(file).exists()

const command = (input: Partial<Hook.Command> & { command: string }): Hook.Command =>
  ({ type: "command", ...input }) as Hook.Command

describe("hook conditions", () => {
  it.instance("skips a hook whose `if` does not match the tool", () =>
    Effect.gen(function* () {
      const dir = (yield* TestInstance).directory
      const file = marker(dir, "skipped.txt")
      const hook = command({ command: write(file), if: "edit" })

      const result = yield* run(hook, { event: "PreToolUse", tool: "read", args: {} })
      expect(result.ran).toBe(false)
      expect(yield* Effect.promise(() => exists(file))).toBe(false)
    }),
  )

  it.instance("runs a hook when `if` matches the tool", () =>
    Effect.gen(function* () {
      const dir = (yield* TestInstance).directory
      const file = marker(dir, "matched.txt")
      const hook = command({ command: write(file), if: "edit" })

      const result = yield* run(hook, { event: "PreToolUse", tool: "edit", args: {} })
      expect(result.ran).toBe(true)
      expect(yield* Effect.promise(() => exists(file))).toBe(true)
    }),
  )

  it.instance("supports the Tool(argPattern) form and * wildcard", () =>
    Effect.gen(function* () {
      const dir = (yield* TestInstance).directory
      const gitOnly = marker(dir, "git-only.txt")
      const anyEdit = marker(dir, "any-edit.txt")

      const scoped = yield* run(command({ command: write(gitOnly), if: "shell(git commit)" }), {
        event: "PreToolUse",
        tool: "shell",
        args: { command: "git commit -m x" },
      })
      expect(scoped.ran).toBe(true)

      const wrongCommand = yield* run(command({ command: write(gitOnly), if: "shell(npm install)" }), {
        event: "PreToolUse",
        tool: "shell",
        args: { command: "git commit -m x" },
      })
      expect(wrongCommand.ran).toBe(false)

      const wildcard = yield* run(command({ command: write(anyEdit), if: "edit(*)" }), {
        event: "PreToolUse",
        tool: "edit",
        args: { filePath: "/tmp/x" },
      })
      expect(wildcard.ran).toBe(true)
    }),
  )

  it.instance("runs when no condition is given", () =>
    Effect.gen(function* () {
      const dir = (yield* TestInstance).directory
      const file = marker(dir, "unconditional.txt")
      const result = yield* run(command({ command: write(file) }), { event: "Stop" })
      expect(result.ran).toBe(true)
    }),
  )
})

describe("async hooks", () => {
  it.instance("returns immediately without blocking on the hook", () =>
    Effect.gen(function* () {
      const dir = (yield* TestInstance).directory
      const file = marker(dir, "async.txt")
      // Sleep first so a blocking implementation would visibly stall the caller.
      const slow = `node -e "setTimeout(() => require('fs').writeFileSync(process.argv[1], 'ran'), 400)" "${file}"`

      const started = Date.now()
      const result = yield* run(command({ command: slow, async: true }), { event: "Stop" })
      const elapsed = Date.now() - started

      expect(result.ran).toBe(true)
      expect(result.blocked).toBe(false)
      expect(elapsed).toBeLessThan(300)

      // The hook still runs, just later and without a result.
      yield* Effect.sleep("1200 millis")
      expect(yield* Effect.promise(() => exists(file))).toBe(true)
    }),
  )

  it.instance("async hooks cannot deny", () =>
    Effect.gen(function* () {
      // `exit 2` is the deny protocol for blocking hooks; async discards it.
      const result = yield* run(command({ command: "exit 2", async: true }), { event: "PreToolUse", tool: "edit" })
      expect(result.decision).toBeUndefined()
      expect(result.blocked).toBe(false)
    }),
  )
})
