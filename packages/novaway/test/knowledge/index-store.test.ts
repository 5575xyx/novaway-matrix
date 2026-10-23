import { afterEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {
  buildDocumentIndex,
  clearCollectionIndex,
  indexSize,
  loadCollectionIndex,
  toIndexedChunk,
} from "@/knowledge/index-store"

const temps: string[] = []

async function tempDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "novaway-index-"))
  temps.push(dir)
  return dir
}

afterEach(async () => {
  while (temps.length) await fs.rm(temps.pop()!, { recursive: true, force: true })
})

const doc = (id: string, content: string) => ({
  id,
  hash: "hash-" + id + "-" + content.length,
  title: "Title " + id,
  content,
})

describe("persistent collection index", () => {
  test("builds chunks with term frequencies and sparse vectors", () => {
    const index = buildDocumentIndex({ hash: "h", title: "部署文档", content: "部署流程说明\n\n第二步是回滚。" })
    expect(index.chunks.length).toBeGreaterThan(0)
    expect(index.chunks[0].tl).toBeGreaterThan(0)
    expect(index.chunks[0].tf.length).toBeGreaterThan(0)
    expect(index.chunks[0].vec.length).toBeGreaterThan(0)
  })

  test("reuses cached chunks on the second load", async () => {
    const dir = await tempDir()
    const documents = [doc("a", "部署流程说明\n\n第二步是回滚。"), doc("b", "数据库备份策略")]
    const first = await loadCollectionIndex(dir, "kb_1", "sig-1", documents)
    expect(first.rebuilt).toBe(2)
    expect(first.chunks.length).toBeGreaterThan(0)

    const second = await loadCollectionIndex(dir, "kb_1", "sig-1", documents)
    expect(second.rebuilt).toBe(0)
    expect(second.chunks.length).toBe(first.chunks.length)
    expect(second.chunks[0].text).toBe(first.chunks[0].text)
  })

  test("rebuilds only the document whose hash changed", async () => {
    const dir = await tempDir()
    await loadCollectionIndex(dir, "kb_1", "sig-1", [doc("a", "one"), doc("b", "two")])
    const next = await loadCollectionIndex(dir, "kb_1", "sig-2", [
      doc("a", "one"),
      { id: "b", hash: "changed", title: "Title b", content: "two plus more text" },
    ])
    expect(next.rebuilt).toBe(1)
  })

  test("drops index files for deleted documents", async () => {
    const dir = await tempDir()
    await loadCollectionIndex(dir, "kb_1", "sig-1", [doc("a", "one"), doc("b", "two")])
    await loadCollectionIndex(dir, "kb_1", "sig-2", [doc("a", "one")])
    const files = await fs.readdir(path.join(dir, "index"))
    expect(files.some((file) => file.startsWith("a."))).toBe(true)
    expect(files.some((file) => file.startsWith("b."))).toBe(false)
  })

  test("survives a corrupted document file by rebuilding", async () => {
    const dir = await tempDir()
    await loadCollectionIndex(dir, "kb_1", "sig-1", [doc("a", "one")])
    await fs.writeFile(path.join(dir, "index", "a.json"), "{not json", "utf8")
    const next = await loadCollectionIndex(dir, "kb_1", "sig-1", [doc("a", "one")])
    expect(next.rebuilt).toBe(1)
    expect(next.chunks.length).toBeGreaterThan(0)
  })

  test("restores tf maps usable by the search ranker", async () => {
    const dir = await tempDir()
    const loaded = await loadCollectionIndex(dir, "kb_1", "sig", [doc("a", "部署 部署 回滚")])
    const chunk = loaded.chunks[0]
    expect(chunk.tf).toBeInstanceOf(Map)
    expect(chunk.tf?.get("部署")).toBeGreaterThanOrEqual(1)
    expect(chunk.length).toBeGreaterThan(0)
  })

  test("reports index size and can clear it", async () => {
    const dir = await tempDir()
    await loadCollectionIndex(dir, "kb_1", "sig", [doc("a", "some content")])
    expect(await indexSize(dir)).toBeGreaterThan(0)
    await clearCollectionIndex(dir)
    expect(await indexSize(dir)).toBe(0)
  })

  test("toIndexedChunk keeps chunk identity", () => {
    const built = buildDocumentIndex({ hash: "h", title: "t", content: "alpha beta" })
    const chunk = toIndexedChunk("kb_1", "doc_1", "t", built.chunks[0], "alpha beta")
    expect(chunk.collectionID).toBe("kb_1")
    expect(chunk.documentID).toBe("doc_1")
    expect(chunk.chunk).toBe(built.chunks[0].i)
    expect(chunk.text).toBe("alpha beta")
  })
})
