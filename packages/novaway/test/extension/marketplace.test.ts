import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import JSZip from "jszip"
import {
  digest,
  extract,
  installZip,
  list,
  MAX_EXTRACT_FILES,
  RECORD_FILE,
  remove,
  root,
  unwrap,
  verify,
} from "../../src/extension/marketplace"
import { parseClaude, parseZcode } from "../../src/extension/catalog"

async function tmp() {
  return fs.mkdtemp(path.join(os.tmpdir(), "novaway-mp-"))
}

async function archive(files: Record<string, string>) {
  const zip = new JSZip()
  for (const [name, content] of Object.entries(files)) zip.file(name, content)
  return Buffer.from(await zip.generateAsync({ type: "nodebuffer" }))
}

describe("extension marketplace", () => {
  test("digest/verify rejects mismatched checksums", () => {
    const data = Buffer.from("hello")
    expect(digest(data)).toBe(verify(data, digest(data)) ?? digest(data))
    expect(() => verify(data, "deadbeef")).toThrow(/checksum mismatch/)
    expect(() => verify(data, undefined)).not.toThrow()
  })

  test("extract rejects path traversal and absolute paths", async () => {
    const dir = await tmp()
    const escape = await archive({ "../escape.txt": "x" })
    await expect(extract(escape, dir)).rejects.toThrow(/escapes root/)
    const absolute = await archive({ "/etc/passwd": "x" })
    await expect(extract(absolute, dir)).rejects.toThrow(/absolute path/)
    const drive = await archive({ "C:/windows/x.txt": "x" })
    await expect(extract(drive, dir)).rejects.toThrow(/absolute path/)
  })

  test("extract writes files and counts bytes", async () => {
    const dir = await tmp()
    const result = await extract(await archive({ "a.txt": "hello", "nested/b.txt": "world!" }), dir)
    expect(result.files).toBe(2)
    expect(result.bytes).toBe(11)
    expect(await fs.readFile(path.join(dir, "nested/b.txt"), "utf8")).toBe("world!")
  })

  test("extract refuses archives with too many entries", async () => {
    const dir = await tmp()
    const files: Record<string, string> = {}
    for (let i = 0; i < MAX_EXTRACT_FILES + 1; i++) files[`f${i}.txt`] = "x"
    await expect(extract(await archive(files), dir)).rejects.toThrow(/too many entries/)
  })

  test("unwrap flattens a single wrapper directory that holds a manifest", async () => {
    const dir = await tmp()
    await extract(await archive({ "pkg/plugin.json": "{}", "pkg/skills/SKILL.md": "# s" }), dir)
    await unwrap(dir)
    expect(
      await fs.access(path.join(dir, "plugin.json")).then(
        () => true,
        () => false,
      ),
    ).toBe(true)
    expect(
      await fs.access(path.join(dir, "pkg")).then(
        () => true,
        () => false,
      ),
    ).toBe(false)
  })

  test("unwrap keeps the wrapper when it is not a package root", async () => {
    const dir = await tmp()
    await extract(await archive({ "pkg/readme.txt": "x" }), dir)
    await unwrap(dir)
    expect(
      await fs.access(path.join(dir, "pkg/readme.txt")).then(
        () => true,
        () => false,
      ),
    ).toBe(true)
  })

  test("installZip writes a record, lists and removes", async () => {
    const config = await tmp()
    const buffer = await archive({ "demo/plugin.json": JSON.stringify({ name: "demo", version: "1.0.0" }) })

    // Serve the archive through a local fetch stub so no network is needed.
    const original = globalThis.fetch
    globalThis.fetch = (async () =>
      new Response(new Uint8Array(buffer), {
        status: 200,
        headers: { "content-length": String(buffer.byteLength) },
      })) as unknown as typeof fetch
    try {
      const installed = await installZip({
        name: "demo",
        version: "1.0.0",
        url: "https://example.com/demo.zip",
        sha256: digest(buffer),
        config,
      })
      expect(installed.root.startsWith(root(config))).toBe(true)
      expect(installed.version).toBe("1.0.0")
      expect(JSON.parse(await fs.readFile(path.join(installed.root, RECORD_FILE), "utf8")).name).toBe("demo")

      const all = await list(config)
      expect(all.map((item) => item.name)).toEqual(["demo"])
      expect(all[0]!.files).toBeGreaterThan(0)

      expect(await remove("demo@1.0.0", config)).toBe(true)
      expect(await list(config)).toEqual([])
    } finally {
      globalThis.fetch = original
    }
  })

  test("reinstall keeps the replaced install as history", async () => {
    const config = await tmp()
    let body = await archive({ "demo/plugin.json": JSON.stringify({ name: "demo", version: "1.0.0" }) })
    const original = globalThis.fetch
    globalThis.fetch = (async () =>
      new Response(new Uint8Array(body), {
        status: 200,
        headers: { "content-length": String(body.byteLength) },
      })) as unknown as typeof fetch
    try {
      const first = await installZip({ name: "demo", url: "https://example.com/demo.zip", version: "1.0.0", config })
      expect(first.previous).toBeUndefined()

      body = await archive({
        "demo/plugin.json": JSON.stringify({ name: "demo", version: "1.1.0" }),
        "demo/extra.txt": "more files",
      })
      const second = await installZip({ name: "demo", url: "https://example.com/demo.zip", version: "1.1.0", config })
      expect(second.version).toBe("1.1.0")
      expect(second.previous?.version).toBe("1.0.0")
      expect(second.previous?.source).toBe("https://example.com/demo.zip")
      expect(second.previous!.files).toBeGreaterThan(0)

      // The old version directory is retired: one package, one install.
      const listed = (await list(config)).filter((item) => item.name === "demo")
      expect(listed).toHaveLength(1)
      expect(listed[0]!.previous?.version).toBe("1.0.0")

      // A third install keeps only the newest revisions (bounded history).
      const third = await installZip({ name: "demo", url: "https://example.com/demo.zip", version: "1.2.0", config })
      expect(third.previous?.version).toBe("1.1.0")
      expect((third.history ?? []).length).toBeLessThanOrEqual(5)
    } finally {
      globalThis.fetch = original
    }
  })

  test("installZip rolls back on checksum mismatch", async () => {
    const config = await tmp()
    const buffer = await archive({ "plugin.json": "{}" })
    const original = globalThis.fetch
    globalThis.fetch = (async () => new Response(new Uint8Array(buffer), { status: 200 })) as unknown as typeof fetch
    try {
      await expect(
        installZip({ name: "bad", url: "https://example.com/bad.zip", sha256: "nope", config }),
      ).rejects.toThrow(/checksum mismatch/)
      expect(await fs.readdir(root(config)).catch(() => [])).toEqual([])
    } finally {
      globalThis.fetch = original
    }
  })

  test("remove refuses paths outside the marketplace root", async () => {
    const config = await tmp()
    await expect(remove("../escape", config)).resolves.toBe(false)
    await expect(remove(path.join(config, "outside"), config)).resolves.toBe(false)
  })
})

describe("marketplace catalog", () => {
  test("parses zcode entries", () => {
    const list = parseZcode({
      plugins: [
        {
          name: "github",
          version: "0.1.2",
          displayName_i18n: { "zh-CN": "GitHub 工作流" },
          description_i18n: { "zh-CN": "提交与 PR", en: "commits and PRs" },
          keywords: ["git", 42],
          source: { url: "https://example.com/github.zip", sha256: "abc" },
        },
        { name: "broken" },
        { name: "github", source: { url: "https://example.com/dup.zip" } },
      ],
    })
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({
      name: "github",
      version: "0.1.2",
      description: "提交与 PR",
      url: "https://example.com/github.zip",
      sha256: "abc",
      keywords: ["git"],
    })
  })

  test("parses claude git entries including subdirectories", () => {
    const list = parseClaude({
      plugins: [
        { name: "local-sub", source: "./plugins/local-sub" },
        {
          name: "external",
          source: { source: "git-subdir", url: "https://github.com/x/y.git", path: "sub", ref: "main" },
        },
        { name: "no-source" },
      ],
    })
    expect(list.map((item) => item.name)).toEqual(["local-sub", "external"])
    expect(list[0]!.subdir).toBe("plugins/local-sub")
    expect(list[1]).toMatchObject({ url: "https://github.com/x/y.git", subdir: "sub", ref: "main" })
  })

  test("ignores malformed catalogs", () => {
    expect(parseZcode(null)).toEqual([])
    expect(parseZcode({ plugins: "nope" })).toEqual([])
    expect(parseClaude({})).toEqual([])
  })
})
