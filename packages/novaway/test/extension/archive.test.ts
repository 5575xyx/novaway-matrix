import { afterEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { archiveUrls, extractArchive, unwrapSingleRoot } from "@/extension/archive"
import { splitGitSpec } from "@/plugin/git-archive"

describe("extension.archive", () => {
  const previousMirror = process.env.NOVAWAY_GITHUB_MIRROR
  const mirror = (url: string) => "https://mirror.example/" + url

  afterEach(() => {
    if (previousMirror === undefined) delete process.env.NOVAWAY_GITHUB_MIRROR
    else process.env.NOVAWAY_GITHUB_MIRROR = previousMirror
  })

  test("resolves github archives for branch, tag and commit refs", () => {
    // 镜像只影响追加的候选；直连地址必须原样保留在最前面。
    process.env.NOVAWAY_GITHUB_MIRROR = "https://mirror.example/"
    const head = "https://github.com/o/r/archive/HEAD.zip"
    expect(archiveUrls("https://github.com/o/r")).toEqual([
      "https://codeload.github.com/o/r/zip/HEAD",
      head,
      mirror(head),
    ])
    expect(archiveUrls("https://github.com/hugohe3/ppt-master", "main")).toEqual([
      "https://codeload.github.com/hugohe3/ppt-master/zip/HEAD",
      "https://github.com/hugohe3/ppt-master/archive/HEAD.zip",
      mirror("https://github.com/hugohe3/ppt-master/archive/HEAD.zip"),
    ])
    const dev = "https://github.com/o/r/archive/refs/heads/dev.zip"
    const tag = "https://github.com/o/r/archive/refs/tags/dev.zip"
    expect(archiveUrls("https://github.com/o/r.git", "dev")).toEqual([
      "https://codeload.github.com/o/r/zip/refs/heads/dev",
      "https://codeload.github.com/o/r/zip/refs/tags/dev",
      dev,
      tag,
      mirror(dev),
      mirror(tag),
    ])
    const commit = "https://github.com/o/r/archive/5e8856be0da8e6bc85c4aa28acc614478f7b7137.zip"
    expect(archiveUrls("https://github.com/o/r", "5e8856be0da8e6bc85c4aa28acc614478f7b7137")).toEqual([
      "https://codeload.github.com/o/r/zip/5e8856be0da8e6bc85c4aa28acc614478f7b7137",
      commit,
      mirror(commit),
    ])
  })

  test("falls back to public mirrors when no override is configured", () => {
    delete process.env.NOVAWAY_GITHUB_MIRROR
    const urls = archiveUrls("https://github.com/o/r", "main")
    expect(urls).toContain("https://ghproxy.net/https://github.com/o/r/archive/HEAD.zip")
    expect(urls[0]).toBe("https://codeload.github.com/o/r/zip/HEAD")
  })

  test("resolves gitee archives", () => {
    expect(archiveUrls("https://gitee.com/nova-way/powersnexus.git", "main")).toEqual([
      "https://gitee.com/nova-way/powersnexus/repository/archive/main.zip",
    ])
    expect(archiveUrls("https://gitee.com/nova-way/powersnexus")).toEqual([
      "https://gitee.com/nova-way/powersnexus/repository/archive/master.zip",
    ])
  })

  test("returns nothing for hosts without a known archive layout", () => {
    expect(archiveUrls("https://gitlab.com/o/r", "main")).toEqual([])
    expect(archiveUrls("git@github.com:o/r.git")).toEqual([])
  })

  test("strips the archive's single top-level directory", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "novaway-archive-"))
    const nested = path.join(dir, "repo-main")
    await fs.mkdir(path.join(nested, "skills"), { recursive: true })
    await fs.writeFile(path.join(nested, "README.md"), "hi")
    await unwrapSingleRoot(dir)
    expect(await fs.readdir(dir)).toEqual(["README.md", "skills"].sort())
    await fs.rm(dir, { recursive: true, force: true })
  })
})

describe("plugin.git-archive", () => {
  test("splits a git spec into repository url and ref", () => {
    expect(splitGitSpec("git+https://gitee.com/nova-way/powersnexus.git#main")).toEqual({
      url: "https://gitee.com/nova-way/powersnexus",
      ref: "main",
    })
    expect(splitGitSpec("git+https://github.com/o/r.git")).toEqual({
      url: "https://github.com/o/r",
      ref: undefined,
    })
  })
})

describe("extension.archive extraction", () => {
  test("strips the archive root and can extract only a subdirectory", async () => {
    const { default: JSZip } = await import("jszip")
    const zip = new JSZip()
    zip.file("ppt-master-main/README.md", "readme")
    zip.file("ppt-master-main/skills/ppt-master/SKILL.md", "skill")
    zip.file("ppt-master-main/skills/ppt-master/templates/a.svg", "<svg/>")
    zip.file("ppt-master-main/docs/guide.md", "guide")
    const buffer = await zip.generateAsync({ type: "nodebuffer" })

    const full = await fs.mkdtemp(path.join(os.tmpdir(), "novaway-full-"))
    await extractArchive(buffer, full)
    expect((await fs.readdir(full)).sort()).toEqual(["README.md", "docs", "skills"].sort())
    await fs.rm(full, { recursive: true, force: true })

    const trimmed = await fs.mkdtemp(path.join(os.tmpdir(), "novaway-sub-"))
    await extractArchive(buffer, trimmed, { prefix: "skills" })
    expect((await fs.readdir(trimmed)).sort()).toEqual(["ppt-master"])
    expect((await fs.readdir(path.join(trimmed, "ppt-master"))).sort()).toEqual(["SKILL.md", "templates"].sort())
    await fs.rm(trimmed, { recursive: true, force: true })
  })

  test("rejects archives that escape the target directory", async () => {
    const { default: JSZip } = await import("jszip")
    const zip = new JSZip()
    zip.file("repo-main/../evil.txt", "boom")
    const buffer = await zip.generateAsync({ type: "nodebuffer" })
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "novaway-evil-"))
    await expect(extractArchive(buffer, dir)).rejects.toThrow()
    await fs.rm(dir, { recursive: true, force: true })
  })
})
