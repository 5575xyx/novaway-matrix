import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { clearFileTreeCache, readFileTreeDirectory } from "../../src/component/file-tree"

// 这里守的是"卡死"那条:原来的实现在 onMount 里同步递归 10 层扫全仓库,
// 侧栏每切一次还重扫一遍。所以这几条测试盯的都是"只读一层 / 读过就不再读盘"。
let root: string

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "nw-file-tree-"))
  await mkdir(path.join(root, "src", "deep", "deeper"), { recursive: true })
  await mkdir(path.join(root, "node_modules", "pkg"), { recursive: true })
  await mkdir(path.join(root, ".git"), { recursive: true })
  await mkdir(path.join(root, ".novaway"), { recursive: true })
  await writeFile(path.join(root, "a.ts"), "")
  await writeFile(path.join(root, "src", "b.ts"), "")
  await writeFile(path.join(root, "src", "deep", "deeper", "c.ts"), "")
})

afterAll(async () => {
  clearFileTreeCache()
  await rm(root, { recursive: true, force: true })
})

describe("file-tree 懒加载", () => {
  test("只读一层:不递归子目录", async () => {
    clearFileTreeCache()
    const nodes = await readFileTreeDirectory(root)
    expect(nodes.map((x) => x.name)).toEqual([".novaway", "src", "a.ts"])
    // 没有 children 字段 —— 子目录内容要等它被展开时再单独读
    expect(nodes.every((x) => !("children" in x))).toBe(true)
  })

  test("目录排在文件前面,同类按名字排", async () => {
    clearFileTreeCache()
    const nodes = await readFileTreeDirectory(root)
    const firstFile = nodes.findIndex((x) => !x.isDirectory)
    expect(nodes.slice(0, firstFile).every((x) => x.isDirectory)).toBe(true)
    expect(nodes.slice(firstFile).every((x) => !x.isDirectory)).toBe(true)
  })

  test("产物目录和隐藏目录被跳过,.novaway 例外", async () => {
    clearFileTreeCache()
    const names = (await readFileTreeDirectory(root)).map((x) => x.name)
    expect(names).not.toContain("node_modules")
    expect(names).not.toContain(".git")
    expect(names).toContain(".novaway")
  })

  test("第二次调用命中缓存:切标签页不会重扫", async () => {
    clearFileTreeCache()
    const first = await readFileTreeDirectory(root)
    const second = await readFileTreeDirectory(root)
    expect(second).toBe(first) // 同一个数组实例 = 没有再读盘
  })

  test("清缓存后重新读盘,能看到新文件", async () => {
    clearFileTreeCache()
    const before = await readFileTreeDirectory(root)
    await writeFile(path.join(root, "zz.ts"), "")
    expect(await readFileTreeDirectory(root)).toBe(before) // 缓存还在,看不到
    clearFileTreeCache()
    expect((await readFileTreeDirectory(root)).map((x) => x.name)).toContain("zz.ts")
  })

  test("目录不存在时返回空数组,不抛异常", async () => {
    clearFileTreeCache()
    expect(await readFileTreeDirectory(path.join(root, "nope"))).toEqual([])
  })
})
