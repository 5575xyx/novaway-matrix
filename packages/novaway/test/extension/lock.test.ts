import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { build, diff, EMPTY, hash, read, write } from "../../src/extension/lock"
import type { Loaded } from "../../src/extension/schema"

const loaded = (input: Partial<Loaded> & { name: string }): Loaded => ({
  root: `/tmp/${input.name}`,
  source: "user",
  manifest: { name: input.name, ...(input.manifest as object) },
  enabled: true,
  ...input,
})

describe("extension lock", () => {
  test("hash ignores root and source but tracks manifest content", () => {
    const a = loaded({ name: "demo", manifest: { name: "demo", version: "1.0.0" } })
    const b = loaded({ name: "demo", root: "/other/demo", manifest: { name: "demo", version: "1.0.0" } })
    const c = loaded({ name: "demo", manifest: { name: "demo", version: "1.0.1" } })
    expect(hash(a)).toBe(hash(b))
    expect(hash(a)).not.toBe(hash(c))
  })

  test("first build reports additions", () => {
    const next = build([loaded({ name: "demo", manifest: { name: "demo", version: "1.0.0" } })], EMPTY)
    expect(diff(EMPTY, next).map((item) => item.change)).toEqual(["added"])
  })

  test("detects upgrades, downgrades and edits", () => {
    const v1 = build([loaded({ name: "demo", manifest: { name: "demo", version: "1.0.0" } })])
    const v2 = build([loaded({ name: "demo", manifest: { name: "demo", version: "1.2.0" } })], v1)
    expect(diff(v1, v2)[0]!.change).toBe("upgraded")

    const v0 = build([loaded({ name: "demo", manifest: { name: "demo", version: "0.9.0" } })], v2)
    expect(diff(v2, v0)[0]!.change).toBe("downgraded")

    const edited = build(
      [loaded({ name: "demo", manifest: { name: "demo", version: "1.2.0", description: "edited" } })],
      v2,
    )
    expect(diff(v2, edited)[0]!.change).toBe("changed")
  })

  test("keeps seenAt when nothing changed", () => {
    const first = build([loaded({ name: "demo", manifest: { name: "demo", version: "1.0.0" } })], EMPTY)
    const seenAt = first.entries.demo!.seenAt - 10_000
    const previous = { ...first, entries: { demo: { ...first.entries.demo!, seenAt } } }
    const next = build([loaded({ name: "demo", manifest: { name: "demo", version: "1.0.0" } })], previous)
    expect(next.entries.demo!.seenAt).toBe(seenAt)
    expect(diff(previous, next)[0]!.change).toBe("unchanged")
  })

  test("reports removals", () => {
    const before = build([loaded({ name: "demo", manifest: { name: "demo", version: "1.0.0" } })])
    const after = build([], before)
    expect(diff(before, after).map((item) => item.change)).toEqual(["removed"])
  })

  test("read returns EMPTY for missing or malformed files", async () => {
    const dir = await fs.mkdtemp(path.join(process.env.TMPDIR ?? "/tmp", "novaway-lock-"))
    expect(await read(dir)).toEqual(EMPTY)
    await fs.writeFile(path.join(dir, "extensions.lock.json"), "{")
    expect(await read(dir)).toEqual(EMPTY)
    await fs.writeFile(path.join(dir, "extensions.lock.json"), JSON.stringify({ version: 2, entries: {} }))
    expect(await read(dir)).toEqual(EMPTY)

    const ledger = build([loaded({ name: "demo", manifest: { name: "demo", version: "1.0.0" } })])
    await write(dir, ledger)
    expect((await read(dir)).entries.demo!.version).toBe("1.0.0")
  })
})
