import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fingerprint, MAX_INSTALLS, previous, record, SKIP_DIRS } from "../../src/extension/package"
import type { Loaded } from "../../src/extension/schema"

const loaded = (version?: string): Loaded => ({
  name: "demo",
  root: "/tmp/demo",
  source: "user",
  manifest: { name: "demo", ...(version ? { version } : {}) },
  enabled: true,
})

async function tmp() {
  return fs.mkdtemp(path.join(os.tmpdir(), "novaway-ext-"))
}

describe("extension package fingerprint", () => {
  test("fingerprint changes when file content/metadata changes", async () => {
    const dir = await tmp()
    await fs.writeFile(path.join(dir, "plugin.json"), JSON.stringify({ name: "demo", version: "1.0.0" }))
    const first = await fingerprint(dir)
    const same = await fingerprint(dir)
    expect(same.hash).toBe(first.hash)
    expect(same.files).toBe(first.files)

    // Touch the file so size or mtime changes.
    await fs.writeFile(path.join(dir, "plugin.json"), JSON.stringify({ name: "demo", version: "1.0.1" }))
    const next = await fingerprint(dir)
    expect(next.hash).not.toBe(first.hash)
  })

  test("skips node_modules and other build output", async () => {
    const dir = await tmp()
    await fs.writeFile(path.join(dir, "plugin.json"), "{}")
    for (const skip of SKIP_DIRS) {
      await fs.mkdir(path.join(dir, skip), { recursive: true })
      await fs.writeFile(path.join(dir, skip, "junk.js"), "x")
    }
    const print = await fingerprint(dir)
    expect(print.files).toBe(1)
  })

  test("missing directory is an empty fingerprint", async () => {
    const print = await fingerprint(path.join(os.tmpdir(), "novaway-does-not-exist-" + Date.now()))
    expect(print.files).toBe(0)
    expect(print.bytes).toBe(0)
  })

  test("record keeps a bounded install history", async () => {
    let history = record(undefined, loaded("1.0.0"), { files: 1, bytes: 10, hash: "a" }, 1)
    expect(history.installs).toHaveLength(1)
    // Same hash: no new entry.
    history = record(history, loaded("1.0.0"), { files: 1, bytes: 10, hash: "a" }, 2)
    expect(history.installs).toHaveLength(1)
    expect(previous(history)).toBeUndefined()

    for (let i = 0; i < MAX_INSTALLS + 3; i++) {
      history = record(history, loaded(`1.0.${i}`), { files: 1, bytes: 10, hash: `h${i}` }, 10 + i)
    }
    expect(history.installs).toHaveLength(MAX_INSTALLS)
    expect(previous(history)?.hash).toBe(history.installs.at(-2)?.hash)
  })
})
