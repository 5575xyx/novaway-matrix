import { afterEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {
  addDocument,
  createCollection,
  exportCollection,
  getDocument,
  listCollections,
  listTrash,
  restoreDocument,
  listDocuments,
  removeCollection,
  removeDocument,
  search,
  updateCollection,
  updateDocument,
} from "@/knowledge/store"

const roots: string[] = []

async function tempRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "novaway-knowledge-"))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})

describe("knowledge.store", () => {
  test("creates collections and counts documents", async () => {
    const root = await tempRoot()
    const collection = await createCollection({ name: "Specs", description: "Product specs" }, root)
    expect(collection.name).toBe("Specs")

    const first = (await addDocument(collection.id, { title: "Auth", content: "Login uses OAuth device flow." }, root))
      .document
    await addDocument(collection.id, { title: "Billing", content: "Invoices are generated monthly." }, root)

    const list = await listCollections(root)
    expect(list).toHaveLength(1)
    expect(list[0].documentCount).toBe(2)

    const docs = await listDocuments(collection.id, root)
    expect(docs.map((doc) => doc.title).sort()).toEqual(["Auth", "Billing"])
    expect(docs.find((doc) => doc.title === "Auth")?.size).toBeGreaterThan(0)

    const document = await getDocument(collection.id, first.id, root)
    expect(document?.content).toContain("OAuth")
  })

  test("searches across collections", async () => {
    const root = await tempRoot()
    const specs = await createCollection({ name: "Specs" }, root)
    const ops = await createCollection({ name: "Runbooks" }, root)
    await addDocument(specs.id, { title: "Deploy", content: "Deploy workers with the release script." }, root)
    await addDocument(ops.id, { title: "Rollback", content: "Rollback restores the previous release." }, root)

    const hits = await search({ query: "release" }, root)
    expect(hits.length).toBe(2)

    const scoped = await search({ query: "release", collectionID: specs.id }, root)
    expect(scoped).toHaveLength(1)
    expect(scoped[0].collectionID).toBe(specs.id)
  })

  test("removes documents and collections", async () => {
    const root = await tempRoot()
    const collection = await createCollection({ name: "Temp" }, root)
    const document = (await addDocument(collection.id, { title: "A", content: "a" }, root)).document

    expect(await removeDocument(collection.id, document.id, root)).toBe(true)
    expect(await listDocuments(collection.id, root)).toHaveLength(0)
    expect(await removeCollection(collection.id, root)).toBe(true)
    expect(await listCollections(root)).toHaveLength(0)
  })

  test("updates documents and collections", async () => {
    const root = await tempRoot()
    const collection = await createCollection({ name: "Old" }, root)
    const document = (await addDocument(collection.id, { title: "Draft", content: "first version" }, root)).document

    const renamed = await updateCollection(collection.id, { name: "New", description: "notes" }, root)
    expect(renamed?.name).toBe("New")
    expect(renamed?.description).toBe("notes")

    const updated = await updateDocument(
      collection.id,
      document.id,
      {
        title: "Final",
        content: "second version",
      },
      root,
    )
    expect(updated?.title).toBe("Final")
    expect((await getDocument(collection.id, document.id, root))?.content).toBe("second version")
  })

  test("skips disabled collections in global search", async () => {
    const root = await tempRoot()
    const enabled = await createCollection({ name: "Enabled" }, root)
    const disabled = await createCollection({ name: "Disabled" }, root)
    await addDocument(enabled.id, { title: "Deploy", content: "release process" }, root)
    await addDocument(disabled.id, { title: "Deploy hidden", content: "release process" }, root)

    await updateCollection(disabled.id, { enabled: false }, root)

    const hits = await search({ query: "release" }, root)
    expect(hits.every((hit) => hit.collectionID === enabled.id)).toBe(true)

    // 显式指定集合时仍然可用（用户自己点进来搜）。
    const scoped = await search({ query: "release", collectionID: disabled.id }, root)
    expect(scoped).toHaveLength(1)
  })

  test("rejects path traversal in ids", async () => {
    const root = await tempRoot()
    await expect(getDocument("../etc", "passwd", root)).rejects.toThrow()
  })
})

describe("knowledge session mount", () => {
  test("mounts and clears collections per session", async () => {
    const root = await tempRoot()
    const collection = await createCollection({ name: "Mounted" }, root)
    const { getSessionCollections, setSessionCollections } = await import("@/knowledge/store")

    expect(await getSessionCollections("ses_abc", root)).toEqual([])
    const saved = await setSessionCollections("ses_abc", [collection.id, collection.id], root)
    expect(saved).toEqual([collection.id])
    expect(await getSessionCollections("ses_abc", root)).toEqual([collection.id])

    await setSessionCollections("ses_abc", [], root)
    expect(await getSessionCollections("ses_abc", root)).toEqual([])
  })

  test("rejects path traversal in session ids", async () => {
    const { setSessionCollections } = await import("@/knowledge/store")
    await expect(setSessionCollections("../evil", ["x"], await tempRoot())).rejects.toThrow()
  })
})

describe("knowledge production behaviors", () => {
  test("rejects duplicate content in the same collection", async () => {
    const root = await tempRoot()
    const collection = await createCollection({ name: "Docs" }, root)
    const first = await addDocument(collection.id, { title: "A", content: "same body" }, root)
    const second = await addDocument(collection.id, { title: "B", content: "same body" }, root)

    expect(first.duplicate).toBe(false)
    expect(second.duplicate).toBe(true)
    expect(second.document.id).toBe(first.document.id)
    expect(await listDocuments(collection.id, root)).toHaveLength(1)
  })

  test("groups multiple chunks of one document into a single hit", async () => {
    const root = await tempRoot()
    const collection = await createCollection({ name: "Long" }, root)
    const body = Array.from({ length: 40 }, (_, index) => "release note " + index + " " + "x".repeat(200)).join("\n\n")
    await addDocument(collection.id, { title: "Handbook", content: body }, root)
    const hits = await search({ query: "release", limit: 10 }, root)
    expect(hits).toHaveLength(1)
    expect(hits[0].title).toBe("Handbook")
  })

  test("stats and reindex report the same shape", async () => {
    const root = await tempRoot()
    const collection = await createCollection({ name: "Stats" }, root)
    await addDocument(collection.id, { title: "A", content: "alpha beta gamma" }, root)

    const { stats, reindex } = await import("@/knowledge/store")
    const before = await stats(collection.id, root)
    expect(before.documents).toBe(1)
    expect(before.chunks).toBeGreaterThan(0)
    const after = await reindex(collection.id, root)
    expect(after).toEqual(before)
  })

  test("index cache invalidates when documents change", async () => {
    const root = await tempRoot()
    const collection = await createCollection({ name: "Cache" }, root)
    await addDocument(collection.id, { title: "A", content: "first topic" }, root)
    expect((await search({ query: "first" }, root))[0].title).toBe("A")

    await addDocument(collection.id, { title: "B", content: "second topic" }, root)
    // 稀疏语义会给出模糊命中，但关键词最匹配的那篇必须排第一：
    // 这同时证明缓存已失效（否则只会看到 A）。
    const hits = await search({ query: "second" }, root)
    expect(hits.map((hit) => hit.title)).toContain("B")
    expect(hits[0].title).toBe("B")
  })
})

describe("knowledge document versions", () => {
  test("re-importing the same source updates in place", async () => {
    const root = await tempRoot()
    const collection = await createCollection({ name: "Versioned" }, root)

    const first = await addDocument(
      collection.id,
      { title: "spec.md", content: "v1 content about auth", source: "spec.md" },
      root,
    )
    expect(first.document.version).toBe(1)
    expect(first.updated).toBeFalsy()

    const second = await addDocument(
      collection.id,
      { title: "spec.md", content: "v2 content about auth and billing", source: "spec.md" },
      root,
    )
    expect(second.updated).toBe(true)
    expect(second.document.id).toBe(first.document.id)
    expect(second.document.version).toBe(2)
    expect(second.document.content).toContain("billing")
    expect(await listDocuments(collection.id, root)).toHaveLength(1)
  })

  test("identical content is still reported as a duplicate", async () => {
    const root = await tempRoot()
    const collection = await createCollection({ name: "Same" }, root)
    await addDocument(collection.id, { title: "a.md", content: "same", source: "a.md" }, root)
    const again = await addDocument(collection.id, { title: "a.md", content: "same", source: "a.md" }, root)
    expect(again.duplicate).toBe(true)
    expect(again.document.version).toBe(1)
  })

  test("documents without source still dedupe by content", async () => {
    const root = await tempRoot()
    const collection = await createCollection({ name: "NoSource" }, root)
    const first = await addDocument(collection.id, { title: "A", content: "body" }, root)
    const second = await addDocument(collection.id, { title: "B", content: "body" }, root)
    expect(second.duplicate).toBe(true)
    expect(second.document.id).toBe(first.document.id)
  })
})

describe("knowledge export, restore and relations", () => {
  test("export then restore keeps documents and bumps versions", async () => {
    const root = await tempRoot()
    const collection = await createCollection({ name: "Backup" }, root)
    await addDocument(collection.id, { title: "a.md", content: "alpha content", source: "a.md" }, root)
    await addDocument(collection.id, { title: "b.md", content: "beta content", source: "b.md" }, root)

    const { exportCollection, restoreCollection } = await import("@/knowledge/store")
    const backup = await exportCollection(collection.id, root)
    expect(backup.format).toBe("novaway.knowledge.v1")
    expect(backup.documents).toHaveLength(2)

    const restored = await restoreCollection(collection.id, { documents: backup.documents }, root)
    expect(restored.skipped).toBe(2)
    expect(await listDocuments(collection.id, root)).toHaveLength(2)

    const changed = await restoreCollection(
      collection.id,
      { documents: [{ title: "a.md", source: "a.md", content: "alpha content updated" }] },
      root,
    )
    expect(changed.updated).toBe(1)
    const docs = await listDocuments(collection.id, root)
    expect(docs.find((doc) => doc.source === "a.md")?.version).toBe(2)
  })

  test("related documents rank by shared entities", async () => {
    const root = await tempRoot()
    const collection = await createCollection({ name: "Graph" }, root)
    const target = await addDocument(
      collection.id,
      { title: "Deploy", content: "NovaWay Deploy pipeline uses NovaWay Runner. NovaWay Deploy is fast." },
      root,
    )
    await addDocument(
      collection.id,
      { title: "Runner", content: "NovaWay Runner executes NovaWay Deploy jobs. NovaWay Runner scales." },
      root,
    )
    await addDocument(
      collection.id,
      { title: "Billing", content: "Invoices and refunds for enterprise customers." },
      root,
    )

    const { related } = await import("@/knowledge/store")
    const list = await related({ collectionID: collection.id, documentID: target.document.id }, root)
    expect(list[0].title).toBe("Runner")
    expect(list.some((item) => item.title === "Billing")).toBe(false)
  })
})

describe("knowledge collection scope and read-only", () => {
  test("project collections are only visible in their project", async () => {
    const root = await tempRoot()
    const global = await createCollection({ name: "Global" }, root)
    const project = await createCollection({ name: "Project", scope: "project", projectID: "prj_a" }, root)

    const forA = await listCollections(root, { projectID: "prj_a" })
    expect(forA.map((item) => item.id).sort()).toEqual([global.id, project.id].sort())

    const forB = await listCollections(root, { projectID: "prj_b" })
    expect(forB.map((item) => item.id)).toEqual([global.id])

    // 没有项目上下文（CLI/脚本）时只看到全局集合。
    const bare = await listCollections(root)
    expect(bare.map((item) => item.id)).toEqual([global.id])
  })

  test("scope can be switched back to global", async () => {
    const root = await tempRoot()
    const collection = await createCollection({ name: "Scoped", scope: "project", projectID: "prj_a" }, root)
    const updated = await updateCollection(collection.id, { scope: "global" }, root)
    expect(updated?.scope).toBe("global")
    expect(updated?.projectID).toBeUndefined()
    expect((await listCollections(root, { projectID: "prj_b" })).map((item) => item.id)).toContain(collection.id)
  })

  test("read-only collections reject mutations", async () => {
    const root = await tempRoot()
    const collection = await createCollection({ name: "Locked", readOnly: true }, root)

    await expect(addDocument(collection.id, { title: "a", content: "body" }, root)).rejects.toThrow("read-only")

    // 只读集合仍然可以读取。
    expect(await listDocuments(collection.id, root)).toEqual([])

    // 元数据仍是可管理的：否则只读开关会成为死路。
    expect((await updateCollection(collection.id, { name: "Renamed" }, root))?.name).toBe("Renamed")
  })

  test("readOnly can be toggled off", async () => {
    const root = await tempRoot()
    const collection = await createCollection({ name: "Toggle", readOnly: true }, root)
    await updateCollection(collection.id, { readOnly: false }, root)
    const result = await addDocument(collection.id, { title: "a", content: "body" }, root)
    expect(result.document.title).toBe("a")
  })
})

describe("knowledge export signature", () => {
  test("export carries a verifiable signature", async () => {
    const root = await tempRoot()
    const collection = await createCollection({ name: "Signed" }, root)
    await addDocument(collection.id, { title: "a.md", content: "alpha", source: "a.md" }, root)
    const backup = await exportCollection(collection.id, root)
    expect(backup.signature.algorithm).toBe("sha256")
    expect(backup.signature.documents).toBe(1)

    const { verifyExport } = await import("@/knowledge/store")
    expect(verifyExport(backup)).toEqual({ ok: true, signed: true })
  })

  test("detects tampered documents", async () => {
    const root = await tempRoot()
    const collection = await createCollection({ name: "Tamper" }, root)
    await addDocument(collection.id, { title: "a.md", content: "alpha", source: "a.md" }, root)
    const backup = await exportCollection(collection.id, root)
    backup.documents[0].content = "beta"

    const { verifyExport, restoreCollection } = await import("@/knowledge/store")
    expect(verifyExport(backup).ok).toBe(false)
    await expect(restoreCollection(collection.id, backup, root)).rejects.toThrow()
  })

  test("detects a document count mismatch", async () => {
    const root = await tempRoot()
    const collection = await createCollection({ name: "Count" }, root)
    await addDocument(collection.id, { title: "a.md", content: "alpha", source: "a.md" }, root)
    const backup = await exportCollection(collection.id, root)
    const { verifyExport } = await import("@/knowledge/store")
    expect(verifyExport({ ...backup, documents: [...backup.documents, ...backup.documents] }).ok).toBe(false)
  })

  test("accepts legacy packs without a signature", async () => {
    const { verifyExport } = await import("@/knowledge/store")
    expect(verifyExport({ documents: [{ title: "a", content: "b" }] })).toEqual({ ok: true, signed: false })
  })
})

describe("knowledge overview and recent queries", () => {
  test("overview aggregates collections", async () => {
    const root = await tempRoot()
    const a = await createCollection({ name: "A" }, root)
    const b = await createCollection({ name: "B" }, root)
    await addDocument(a.id, { title: "a1", content: "alpha content long enough to chunk" }, root)
    await addDocument(b.id, { title: "b1", content: "beta content long enough to chunk" }, root)

    const { overview } = await import("@/knowledge/store")
    const value = await overview(root)
    expect(value.collections).toBe(2)
    expect(value.documents).toBe(2)
    expect(value.chunks).toBeGreaterThan(0)
    expect(value.characters).toBeGreaterThan(0)
  })

  test("recent queries dedupe and cap", async () => {
    const root = await tempRoot()
    const collection = await createCollection({ name: "Q" }, root)
    const { rememberQuery, recentQueries, clearQueries } = await import("@/knowledge/store")

    await rememberQuery(collection.id, { query: "deploy", hits: 2 }, root)
    await rememberQuery(collection.id, { query: "rollback", hits: 1 }, root)
    const list = await rememberQuery(collection.id, { query: "deploy", hits: 3 }, root)
    expect(list[0]).toMatchObject({ query: "deploy", hits: 3 })
    expect(list).toHaveLength(2)

    for (let index = 0; index < 25; index++) {
      await rememberQuery(collection.id, { query: "q" + index, hits: 1 }, root)
    }
    expect(await recentQueries(collection.id, root)).toHaveLength(20)

    await clearQueries(collection.id, root)
    expect(await recentQueries(collection.id, root)).toEqual([])
  })

  test("empty queries are ignored", async () => {
    const root = await tempRoot()
    const collection = await createCollection({ name: "E" }, root)
    const { rememberQuery, recentQueries } = await import("@/knowledge/store")
    await rememberQuery(collection.id, { query: "   ", hits: 1 }, root)
    expect(await recentQueries(collection.id, root)).toEqual([])
  })
})

describe("knowledge overview and recent queries", () => {
  test("overview aggregates collections", async () => {
    const root = await tempRoot()
    const a = await createCollection({ name: "A" }, root)
    const b = await createCollection({ name: "B" }, root)
    await addDocument(a.id, { title: "a1", content: "alpha content long enough to chunk" }, root)
    await addDocument(b.id, { title: "b1", content: "beta content long enough to chunk" }, root)

    const { overview } = await import("@/knowledge/store")
    const value = await overview(root)
    expect(value.collections).toBe(2)
    expect(value.documents).toBe(2)
    expect(value.chunks).toBeGreaterThan(0)
    expect(value.characters).toBeGreaterThan(0)
  })

  test("recent queries dedupe and cap", async () => {
    const root = await tempRoot()
    const collection = await createCollection({ name: "Q" }, root)
    const { rememberQuery, recentQueries, clearQueries } = await import("@/knowledge/store")

    await rememberQuery(collection.id, { query: "deploy", hits: 2 }, root)
    await rememberQuery(collection.id, { query: "rollback", hits: 1 }, root)
    const list = await rememberQuery(collection.id, { query: "deploy", hits: 3 }, root)
    expect(list[0]).toMatchObject({ query: "deploy", hits: 3 })
    expect(list).toHaveLength(2)

    for (let index = 0; index < 25; index++) {
      await rememberQuery(collection.id, { query: "q" + index, hits: 1 }, root)
    }
    expect(await recentQueries(collection.id, root)).toHaveLength(20)

    await clearQueries(collection.id, root)
    expect(await recentQueries(collection.id, root)).toEqual([])
  })

  test("empty queries are ignored", async () => {
    const root = await tempRoot()
    const collection = await createCollection({ name: "E" }, root)
    const { rememberQuery, recentQueries } = await import("@/knowledge/store")
    await rememberQuery(collection.id, { query: "   ", hits: 1 }, root)
    expect(await recentQueries(collection.id, root)).toEqual([])
  })
})

describe("knowledge pagination and filtering", () => {
  test("filters by title and paginates", async () => {
    const root = await tempRoot()
    const collection = await createCollection({ name: "Page" }, root)
    for (let index = 0; index < 12; index++) {
      await addDocument(
        collection.id,
        {
          title: "Doc " + index,
          content: "content number " + index + " with enough words",
          source: "doc" + index + ".md",
        },
        root,
      )
    }
    const { listDocumentsPage } = await import("@/knowledge/store")

    const first = await listDocumentsPage(collection.id, { limit: 5 }, root)
    expect(first.total).toBe(12)
    expect(first.items).toHaveLength(5)

    const second = await listDocumentsPage(collection.id, { limit: 5, offset: 5 }, root)
    expect(second.items).toHaveLength(5)
    expect(second.items[0].id).not.toBe(first.items[0].id)

    const filtered = await listDocumentsPage(collection.id, { q: "Doc 3" }, root)
    expect(filtered.total).toBe(1)
    expect(filtered.items[0].title).toBe("Doc 3")

    const bySource = await listDocumentsPage(collection.id, { q: "doc7" }, root)
    expect(bySource.total).toBe(1)

    const byTitle = await listDocumentsPage(collection.id, { sort: "title" }, root)
    expect(byTitle.items[0].title).toBe("Doc 0")
  })

  test("content search is opt-in", async () => {
    const root = await tempRoot()
    const collection = await createCollection({ name: "Content" }, root)
    await addDocument(collection.id, { title: "Alpha", content: "hidden keyword xylophone" }, root)
    const { listDocumentsPage } = await import("@/knowledge/store")

    expect((await listDocumentsPage(collection.id, { q: "xylophone" }, root)).total).toBe(0)
    expect((await listDocumentsPage(collection.id, { q: "xylophone", searchContent: true }, root)).total).toBe(1)
  })
})

describe("knowledge bulk operations", () => {
  test("removes multiple documents and reports missing", async () => {
    const root = await tempRoot()
    const collection = await createCollection({ name: "Bulk" }, root)
    const a = (await addDocument(collection.id, { title: "a", content: "aaa" }, root)).document
    const b = (await addDocument(collection.id, { title: "b", content: "bbb" }, root)).document
    const { removeDocuments } = await import("@/knowledge/store")

    const result = await removeDocuments(collection.id, [a.id, b.id, "kbd_missing"], root)
    expect(result.removed.sort()).toEqual([a.id, b.id].sort())
    expect(result.missing).toEqual(["kbd_missing"])
    expect(await listDocuments(collection.id, root)).toHaveLength(0)
  })

  test("moves a document between collections", async () => {
    const root = await tempRoot()
    const from = await createCollection({ name: "From" }, root)
    const to = await createCollection({ name: "To" }, root)
    const doc = (await addDocument(from.id, { title: "a", content: "alpha body" }, root)).document
    const { moveDocument } = await import("@/knowledge/store")

    const result = await moveDocument(from.id, to.id, doc.id, root)
    expect(result.duplicate).toBe(false)
    expect(result.document.collectionID).toBe(to.id)
    expect(await listDocuments(from.id, root)).toHaveLength(0)
    expect((await listDocuments(to.id, root)).map((item) => item.id)).toEqual([doc.id])
  })

  test("moving duplicate content drops the source", async () => {
    const root = await tempRoot()
    const from = await createCollection({ name: "From2" }, root)
    const to = await createCollection({ name: "To2" }, root)
    const doc = (await addDocument(from.id, { title: "a", content: "same body" }, root)).document
    const existing = (await addDocument(to.id, { title: "b", content: "same body" }, root)).document
    const { moveDocument } = await import("@/knowledge/store")

    const result = await moveDocument(from.id, to.id, doc.id, root)
    expect(result.duplicate).toBe(true)
    expect(result.document.id).toBe(existing.id)
    expect(await listDocuments(from.id, root)).toHaveLength(0)
    expect(await listDocuments(to.id, root)).toHaveLength(1)
  })

  test("rejects moving into a read-only collection", async () => {
    const root = await tempRoot()
    const from = await createCollection({ name: "From3" }, root)
    const to = await createCollection({ name: "To3", readOnly: true }, root)
    const doc = (await addDocument(from.id, { title: "a", content: "alpha" }, root)).document
    const { moveDocument } = await import("@/knowledge/store")
    await expect(moveDocument(from.id, to.id, doc.id, root)).rejects.toThrow("read-only")
  })
})

describe("knowledge integrity and library export", () => {
  test("reports orphan sidecars and repairs them", async () => {
    const root = await tempRoot()
    const collection = await createCollection({ name: "Integrity" }, root)
    await addDocument(collection.id, { title: "a", content: "alpha body" }, root)

    const dir = path.join(root, "collections", collection.id, "documents")
    await fs.writeFile(path.join(dir, "kbd_ghost.embedding.json"), "{}")

    const { integrity, repair } = await import("@/knowledge/store")
    const before = await integrity(root)
    expect(before.documents).toBe(1)
    expect(before.issues.some((item) => item.kind === "orphan-sidecar")).toBe(true)

    const fixed = await repair(root)
    expect(fixed.removed).toBe(1)
    const after = await integrity(root)
    expect(after.issues).toHaveLength(0)
  })

  test("reports duplicate content within a collection", async () => {
    const root = await tempRoot()
    const collection = await createCollection({ name: "Dupes" }, root)
    const doc = (await addDocument(collection.id, { title: "a", content: "dup body" }, root)).document
    // 手工写一份同内容、不同 id 的文档，模拟历史数据。
    const dir = path.join(root, "collections", collection.id, "documents")
    const copy = { ...doc, id: "kbd_copy", title: "copy" }
    await fs.writeFile(path.join(dir, "kbd_copy.json"), JSON.stringify(copy))

    const { integrity } = await import("@/knowledge/store")
    const report = await integrity(root)
    expect(report.issues.some((item) => item.kind === "duplicate-content")).toBe(true)
  })

  test("exports and imports a whole library", async () => {
    const root = await tempRoot()
    const first = await createCollection({ name: "Library A" }, root)
    await addDocument(first.id, { title: "a", content: "alpha body" }, root)

    const { exportLibrary, importLibrary } = await import("@/knowledge/store")
    const backup = await exportLibrary(root)
    expect(backup.format).toBe("novaway.knowledge.library.v1")
    expect(backup.collections).toHaveLength(1)

    const other = await tempRoot()
    const result = await importLibrary(backup, other)
    expect(result.collections).toBe(1)
    expect(result.imported).toBe(1)

    const restored = await listCollections(other)
    expect(restored.map((item) => item.name)).toEqual(["Library A"])
    expect(await listDocuments(restored[0].id, other)).toHaveLength(1)

    // 再导入一次：内容相同，应当全部跳过。
    const again = await importLibrary(backup, other)
    expect(again.collections).toBe(0)
    expect(again.skipped).toBe(1)
  })

  test("rejects an unknown library format", async () => {
    const { importLibrary } = await import("@/knowledge/store")
    await expect(
      importLibrary({ format: "nope" as never, exportedAt: 0, collections: [] }, await tempRoot()),
    ).rejects.toThrow()
  })

  test("document chunks are previewable", async () => {
    const root = await tempRoot()
    const collection = await createCollection({ name: "Chunks" }, root)
    const doc = (await addDocument(collection.id, { title: "a", content: "para one\n\npara two\n\npara three" }, root))
      .document
    const { documentChunks } = await import("@/knowledge/store")
    const chunks = await documentChunks(collection.id, doc.id, root)
    expect(chunks.length).toBeGreaterThan(0)
    expect(chunks[0].text).toContain("para one")
  })
})

describe("trash", () => {
  test("removing a document keeps it in trash until restored", async () => {
    const root = await (async () => {
      const fs = await import("node:fs/promises")
      const os = await import("node:os")
      const path = await import("node:path")
      return fs.mkdtemp(path.join(os.tmpdir(), "novaway-trash-"))
    })()
    const collection = await createCollection({ name: "回收站测试" }, root)
    const added = await addDocument(collection.id, { title: "doc", content: "内容" }, root)
    const document = added.document!

    expect(await removeDocument(collection.id, document.id, root)).toBe(true)
    expect(await listDocuments(collection.id, root)).toHaveLength(0)

    const trash = await listTrash(collection.id, root)
    expect(trash).toHaveLength(1)
    expect(trash[0].document.id).toBe(document.id)

    const restored = await restoreDocument(collection.id, document.id, root)
    expect(restored?.id).toBe(document.id)
    expect(await listDocuments(collection.id, root)).toHaveLength(1)
    expect(await listTrash(collection.id, root)).toHaveLength(0)

    const fs = await import("node:fs/promises")
    await fs.rm(root, { recursive: true, force: true })
  })

  test("permanent removal skips the trash", async () => {
    const fs = await import("node:fs/promises")
    const os = await import("node:os")
    const path = await import("node:path")
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "novaway-trash-"))
    const collection = await createCollection({ name: "永久删除" }, root)
    const added = await addDocument(collection.id, { title: "doc", content: "内容" }, root)
    await removeDocument(collection.id, added.document!.id, root, { permanent: true })
    expect(await listTrash(collection.id, root)).toHaveLength(0)
    await fs.rm(root, { recursive: true, force: true })
  })
})
