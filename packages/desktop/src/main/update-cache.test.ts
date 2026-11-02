import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pendingDir, pruneUpdateCache, readUpdaterCacheDirName, updaterCacheDir } from "./update-cache"

const roots: string[] = []

function tempCache() {
  const root = mkdtempSync(join(tmpdir(), "novaway-update-"))
  roots.push(root)
  mkdirSync(join(root, "pending"), { recursive: true })
  return root
}

function touch(dir: string, name: string, bytes = 1024) {
  writeFileSync(join(dir, name), Buffer.alloc(bytes))
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe("updater cache dir", () => {
  test("按 electron-updater 的规则拼目录（优先 app-update.yml 里的名字）", () => {
    const dir = updaterCacheDir({ baseCachePath: "/base", dirName: "novaway-updater", appName: "NovaWay" })
    expect(dir).toBe(join("/base", "novaway-updater"))
  })

  test("读不到名字时回退到应用名", () => {
    expect(updaterCacheDir({ baseCachePath: "/base", appName: "NovaWay" })).toBe(join("/base", "NovaWay"))
  })

  test("从 app-update.yml 里取 updaterCacheDirName", () => {
    const root = tempCache()
    const file = join(root, "app-update.yml")
    writeFileSync(file, 'provider: generic\nurl: https://example.com\nupdaterCacheDirName: novaway-desktop\n')
    expect(readUpdaterCacheDirName(file)).toBe("novaway-desktop")
    expect(readUpdaterCacheDirName(join(root, "missing.yml"))).toBeUndefined()
  })
})

describe("pruneUpdateCache", () => {
  test("没有待安装更新时，清掉所有安装包和 pending 元数据", () => {
    const root = tempCache()
    const pending = pendingDir(root)
    touch(pending, "NovaWay-1.0.0.exe", 2048)
    touch(pending, "update-info.json", 128)
    touch(pending, "NovaWay-1.0.0.exe.blockmap", 64)
    touch(root, "current.blockmap", 64)

    const result = pruneUpdateCache(root)

    expect(result.removed.length).toBe(3)
    expect(result.freedBytes).toBe(2048 + 128 + 64)
    expect(readdirSync(pending)).toEqual([])
    // 根目录的 blockmap 留着，下次差量下载要用
    expect(readdirSync(root)).toEqual(["current.blockmap", "pending"])
  })

  test("有待安装的安装包时，只保留它（及其元数据）", () => {
    const root = tempCache()
    const pending = pendingDir(root)
    const keep = join(pending, "NovaWay-2.0.0.exe")
    touch(pending, "NovaWay-2.0.0.exe", 4096)
    touch(pending, "NovaWay-2.0.0.exe.blockmap", 64)
    touch(pending, "update-info.json", 128)
    touch(pending, "NovaWay-1.0.0.exe", 2048)

    pruneUpdateCache(root, keep)

    expect(readdirSync(pending).sort()).toEqual(["NovaWay-2.0.0.exe", "NovaWay-2.0.0.exe.blockmap", "update-info.json"])
  })

  test("缓存根目录里的旧安装包也清掉", () => {
    const root = tempCache()
    touch(root, "NovaWay-0.9.0.exe", 512)
    touch(root, "current.blockmap", 64)

    pruneUpdateCache(root)

    expect(readdirSync(root)).toEqual(["current.blockmap", "pending"])
  })
})
