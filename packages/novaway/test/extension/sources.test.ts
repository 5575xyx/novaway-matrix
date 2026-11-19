import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { add, get, list, official, remove, update, urlsFor } from "../../src/extension/sources"

const tmp = () => fs.mkdtemp(path.join(os.tmpdir(), "novaway-sources-"))

describe("marketplace sources", () => {
  test("lists the official source without writing it to user storage", async () => {
    const config = await tmp()
    expect((await list(config)).map((item) => item.id)).toEqual(["novaway-official", "claude-official"])
    await expect(fs.access(path.join(config, "marketplace-sources.json"))).rejects.toThrow()
  })

  test("uses Gitee first and GitHub as the official catalog fallback", () => {
    expect(urlsFor(official)).toEqual([
      "https://gitee.com/NovaWay-AI/novaway-plugins/raw/main/catalog/index.json",
      "https://raw.githubusercontent.com/NovaWay-AI/novaway-plugins/main/catalog/index.json",
    ])
    expect(urlsFor({ id: "custom", url: "https://example.com/catalog.json" })).toEqual([
      "https://example.com/catalog.json",
    ])
  })

  test("adds, updates and removes a custom source atomically", async () => {
    const config = await tmp()
    const created = await add({ name: "Team Market", type: "novaway", url: "https://example.com/catalog.json" }, config)
    expect(created.trust).toBe("unverified")
    expect((await get(created.id, config))?.name).toBe("Team Market")
    const changed = await update(created.id, { name: "Updated Market", enabled: false }, config)
    expect(changed).toMatchObject({ name: "Updated Market", enabled: false })
    expect(await remove(created.id, config)).toBe(true)
    expect(await get(created.id, config)).toBeUndefined()
  })

  test("rejects credentials and duplicate URLs", async () => {
    const config = await tmp()
    await expect(add({ name: "Bad", type: "auto", url: "https://user:pass@example.com/catalog.json" }, config)).rejects.toThrow()
    await add({ name: "One", type: "auto", url: "https://example.com/catalog.json" }, config)
    await expect(add({ name: "Two", type: "auto", url: "https://example.com/catalog.json" }, config)).rejects.toThrow(
      /already exists/,
    )
  })

  test("does not allow removing or editing the official source", async () => {
    const config = await tmp()
    await expect(remove(official.id, config)).rejects.toThrow(/builtin|official/)
    await expect(update(official.id, { url: "https://example.com/other.json" }, config)).rejects.toThrow(/official|NovaWay/)
    expect((await update(official.id, { enabled: false }, config)).enabled).toBe(false)
    expect((await list(config)).find((item) => item.id === official.id)?.enabled).toBe(false)
  })
})
