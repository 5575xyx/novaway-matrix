import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import JSZip from "jszip"
import {
  digest,
  download,
  extract,
  installZip,
  list,
  previewUpdate,
  MAX_EXTRACT_FILES,
  MAX_EXTRACT_BYTES,
  MAX_REDIRECTS,
  RECORD_FILE,
  remove,
  rollback,
  root,
  recover,
  validateArtifactUrl,
  unwrap,
  verify,
} from "../../src/extension/marketplace"
import { parseClaude, parseNovaWay, parseZcode } from "../../src/extension/catalog"

async function tmp() {
  return fs.mkdtemp(path.join(os.tmpdir(), "novaway-mp-"))
}

async function archive(files: Record<string, string>) {
  const zip = new JSZip()
  for (const [name, content] of Object.entries(files)) zip.file(name, content)
  return Buffer.from(await zip.generateAsync({ type: "nodebuffer" }))
}

function duplicateCentralEntry(buffer: Buffer) {
  const eocdSignature = Buffer.from([0x50, 0x4b, 0x05, 0x06])
  const eocd = buffer.lastIndexOf(eocdSignature)
  if (eocd < 0) throw new Error("test archive has no EOCD")
  const centralOffset = buffer.readUInt32LE(eocd + 16)
  const centralSize = buffer.readUInt32LE(eocd + 12)
  const central = buffer.subarray(centralOffset, centralOffset + centralSize)
  const result = Buffer.concat([buffer.subarray(0, centralOffset), central, central, buffer.subarray(eocd)])
  const nextEocd = eocd + centralSize
  result.writeUInt16LE(2, nextEocd + 8)
  result.writeUInt16LE(2, nextEocd + 10)
  result.writeUInt32LE(centralSize * 2, nextEocd + 12)
  return result
}

describe("extension marketplace", () => {
  test("digest/verify rejects mismatched checksums", () => {
    const data = Buffer.from("hello")
    expect(digest(data)).toBe(verify(data, digest(data)) ?? digest(data))
    expect(() => verify(data, "deadbeef")).toThrow(/checksum mismatch/)
    expect(() => verify(data, undefined)).not.toThrow()
  })

  test("previews source, permission, dependency and digest changes", () => {
    const preview = previewUpdate(
      {
        version: "1.0.0",
        source: "https://old.example/demo.zip",
        sourceId: "old-source",
        sha256: "a".repeat(64),
        permissions: ["read_workspace", "network"],
        dependencies: { "com.base": ">=1.0.0", "com.old": "^1.0.0" },
        conflicts: ["com.blocked"],
      },
      {
        version: "2.0.0",
        source: "https://new.example/demo.zip",
        sourceId: "new-source",
        sha256: "b".repeat(64),
        permissions: ["read_workspace", "write_workspace"],
        dependencies: { "com.base": ">=2.0.0", "com.new": "^1.0.0" },
        conflicts: ["com.other"],
      },
    )
    expect(preview).toMatchObject({
      currentVersion: "1.0.0",
      targetVersion: "2.0.0",
      sourceChanged: true,
      sourceUrlChanged: true,
      permissionsAdded: ["write_workspace"],
      permissionsRemoved: ["network"],
      dependenciesAdded: { "com.base": ">=2.0.0", "com.new": "^1.0.0" },
      dependenciesRemoved: ["com.old"],
      conflictsAdded: ["com.other"],
      conflictsRemoved: ["com.blocked"],
      digestChanged: true,
      requiresConfirmation: true,
    })
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

  test("extract rejects symlink entries", async () => {
    const dir = await tmp()
    const zip = new JSZip()
    zip.file("link", "target", { unixPermissions: 0o120777 })
    await expect(
      extract(Buffer.from(await zip.generateAsync({ type: "nodebuffer", platform: "UNIX" })), dir),
    ).rejects.toThrow(/symlink/)
  })

  test("extract rejects duplicate central-directory entries", async () => {
    const dir = await tmp()
    const duplicate = duplicateCentralEntry(await archive({ "plugin.json": "{}" }))
    await expect(extract(duplicate, dir)).rejects.toThrow(/duplicate entry/)
  })

  test("extract rejects unsupported POSIX node types and declared ZIP bombs", async () => {
    const dir = await tmp()
    const node = new JSZip()
    node.file("device", "x", { unixPermissions: 0o010666 })
    await expect(
      extract(Buffer.from(await node.generateAsync({ type: "nodebuffer", platform: "UNIX" })), dir),
    ).rejects.toThrow(/unsupported POSIX node type/)

    const archiveBytes = await archive({ "small.txt": "x" })
    const eocd = archiveBytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
    const centralOffset = archiveBytes.readUInt32LE(eocd + 16)
    archiveBytes.writeUInt32LE(MAX_EXTRACT_BYTES + 1, centralOffset + 24)
    await expect(extract(archiveBytes, dir)).rejects.toThrow(/expands beyond limit/)
  })

  test("extracts duplicate-content entries as independent files, never hardlinks", async () => {
    const dir = await tmp()
    const bytes = await archive({ "a.txt": "same", "b.txt": "same" })
    await extract(bytes, dir)
    const first = await fs.stat(path.join(dir, "a.txt"))
    const second = await fs.stat(path.join(dir, "b.txt"))
    expect(first.ino).not.toBe(second.ino)
    expect(first.nlink).toBe(1)
    expect(second.nlink).toBe(1)
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

  test("rollback restores the physical previous version and remains reversible", async () => {
    const config = await tmp()
    let body = await archive({ "demo/plugin.json": JSON.stringify({ name: "demo", version: "1.0.0" }) })
    const original = globalThis.fetch
    globalThis.fetch = (async () => new Response(new Uint8Array(body), { status: 200 })) as unknown as typeof fetch
    try {
      await installZip({ name: "demo", version: "1.0.0", url: "https://example.com/demo.zip", config })
      body = await archive({ "demo/plugin.json": JSON.stringify({ name: "demo", version: "2.0.0" }), "v2.txt": "new" })
      await installZip({ name: "demo", version: "2.0.0", url: "https://example.com/demo.zip", config })

      const rolledBack = await rollback("demo", config)
      expect(rolledBack.version).toBe("1.0.0")
      expect(JSON.parse(await fs.readFile(path.join(rolledBack.root, "plugin.json"), "utf8")).version).toBe("1.0.0")
      expect(rolledBack.previous?.version).toBe("2.0.0")
      expect(await fs.readFile(path.join(rolledBack.root, "v2.txt")).catch(() => undefined)).toBeUndefined()

      // The rollback itself retained v2, so a second rollback is possible.
      const forward = await rollback("demo", config)
      expect(forward.version).toBe("2.0.0")
      expect(await fs.readFile(path.join(forward.root, "v2.txt"), "utf8")).toBe("new")
    } finally {
      globalThis.fetch = original
    }
  })

  test("rejects insecure and private artifact URLs", async () => {
    await expect(validateArtifactUrl("http://example.com/plugin.zip")).rejects.toThrow(/HTTPS/)
    await expect(validateArtifactUrl("https://127.0.0.1/plugin.zip")).rejects.toThrow(/private/)
    await expect(validateArtifactUrl("https://user:pass@example.com/plugin.zip")).rejects.toThrow(/HTTPS|credentials/)
  })
  test("follows only validated HTTPS redirects and caps redirect chains", async () => {
    const original = globalThis.fetch
    let calls = 0
    globalThis.fetch = (async (_url: RequestInfo | URL, init: RequestInit) => {
      calls += 1
      expect(init?.redirect).toBe("manual")
      if (calls <= MAX_REDIRECTS + 1) {
        return new Response(null, { status: 302, headers: { location: "https://example.com/next.zip" } })
      }
      return new Response(new Uint8Array([1, 2, 3]), { status: 200 })
    }) as unknown as typeof fetch
    try {
      await expect(download("https://example.com/start.zip")).rejects.toThrow(/too many artifact redirects/)
      expect(calls).toBe(MAX_REDIRECTS + 1)
    } finally {
      globalThis.fetch = original
    }
  })

  test("revalidates redirect targets and the final response hostname", async () => {
    const original = globalThis.fetch
    try {
      globalThis.fetch = (async () =>
        new Response(null, { status: 302, headers: { location: "https://127.0.0.1/private.zip" } })) as unknown as typeof fetch
      await expect(download("https://example.com/start.zip")).rejects.toThrow(/private/)

      globalThis.fetch = (async () =>
        ({
          status: 200,
          ok: true,
          url: "https://127.0.0.1/final.zip",
          headers: new Headers(),
          arrayBuffer: async () => new ArrayBuffer(0),
        }) as unknown as Response) as unknown as typeof fetch
      await expect(download("https://example.com/start.zip")).rejects.toThrow(/private/)
    } finally {
      globalThis.fetch = original
    }
  })

  test("cold-start recovery removes staging trees but preserves installed packages", async () => {
    const config = await tmp()
    const marketplace = root(config)
    await fs.mkdir(path.join(marketplace, ".staging-crashed"), { recursive: true })
    await fs.mkdir(path.join(marketplace, "keep"), { recursive: true })
    await fs.writeFile(
      path.join(marketplace, "keep", RECORD_FILE),
      JSON.stringify({ name: "keep", kind: "zip", source: "legacy", installedAt: 1 }),
    )
    const result = await recover(config)
    expect(result.removedStaging).toBe(1)
    expect(
      await fs.access(path.join(marketplace, ".staging-crashed")).then(
        () => true,
        () => false,
      ),
    ).toBe(false)
    expect(result.installed.map((item) => item.name)).toEqual(["keep"])
  })
  test("rollback rejects missing and escaping backup paths", async () => {
    const config = await tmp()
    await expect(rollback("missing", config)).rejects.toThrow(/找不到|not found/)
    const directory = path.join(root(config), "demo")
    await fs.mkdir(directory, { recursive: true })
    await fs.writeFile(
      path.join(directory, RECORD_FILE),
      JSON.stringify({
        name: "demo",
        kind: "zip",
        source: "https://example.com/demo.zip",
        installedAt: Date.now(),
        history: [
          {
            version: "1.0.0",
            source: "old",
            installedAt: 1,
            files: 1,
            bytes: 1,
            backupPath: path.join(root(config), "outside"),
          },
        ],
      }),
    )
    await expect(rollback("demo", config)).rejects.toThrow(/backup path|历史版本文件/)
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

  test("preserves the current version when staging fails", async () => {
    const config = await tmp()
    const good = await archive({ "demo/plugin.json": JSON.stringify({ name: "demo", version: "1.0.0" }) })
    const bad = await archive({ "../escape.txt": "should not install" })
    const original = globalThis.fetch
    let body = good
    globalThis.fetch = (async () => new Response(new Uint8Array(body), { status: 200 })) as unknown as typeof fetch
    try {
      const installed = await installZip({
        name: "demo",
        version: "1.0.0",
        url: "https://example.com/demo.zip",
        sha256: digest(good),
        config,
      })
      body = bad
      await expect(
        installZip({
          name: "demo",
          version: "1.0.0",
          url: "https://example.com/demo.zip",
          sha256: digest(bad),
          config,
        }),
      ).rejects.toThrow(/escapes root/)
      expect(await fs.readFile(path.join(installed.root, "plugin.json"), "utf8")).toContain('"demo"')
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

  test("parses the official NovaWay catalog and requires a complete artifact digest", () => {
    const list = parseNovaWay({
      schemaVersion: 1,
      entries: [
        {
          packageId: "com.novaway.demo",
          name: "demo",
          version: "1.2.3",
          description: "A demo plugin",
          categories: ["office"],
          tags: ["demo", 42],
          runtimeTargets: ["novaway-v2"],
          capabilities: ["skills"],
          permissions: ["read_workspace"],
          dependencies: { "com.novaway.base": ">=1.0.0" },
          conflicts: ["com.novaway.other"],
          artifacts: [
            {
              type: "github-release",
              url: "https://github.com/NovaWay-AI/novaway-plugins/releases/download/demo-v1.2.3/demo.zip",
              sha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
            },
          ],
        },
        {
          packageId: "com.novaway.bad",
          name: "bad",
          version: "1.0.0",
          runtimeTargets: ["novaway-v2"],
          capabilities: ["skills"],
          artifacts: [{ type: "github-release", url: "https://example.com/bad.zip", sha256: "nope" }],
        },
      ],
    })
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({
      packageId: "com.novaway.demo",
      name: "demo",
      version: "1.2.3",
      kind: "zip",
      keywords: ["office", "demo"],
      permissions: ["read_workspace"],
      dependencies: { "com.novaway.base": ">=1.0.0" },
      conflicts: ["com.novaway.other"],
    })
  })
  test("ignores malformed catalogs", () => {
    expect(parseZcode(null)).toEqual([])
    expect(parseZcode({ plugins: "nope" })).toEqual([])
    expect(parseClaude({})).toEqual([])
  })
})
