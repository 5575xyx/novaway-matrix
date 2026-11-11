import { afterEach, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { mkdtemp, readFile, rm, writeFile } from "fs/promises"
import os from "os"
import path from "path"
import { createPdf } from "@novaway/core/office/pdf/engine"
import {
  documentHistory,
  editDocumentFile,
  recordDocumentWrite,
  redoDocumentFile,
  undoDocumentFile,
} from "../../src/office/document-sessions"

const dirs: string[] = []

function sha256(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex")
}

async function fixture(name: string, content: string) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "novaway-session-"))
  dirs.push(dir)
  const file = path.join(dir, name)
  await writeFile(file, content, "utf8")
  return file
}

afterEach(async () => {
  while (dirs.length > 0) await rm(dirs.pop()!, { recursive: true, force: true })
})

describe("文档会话：宿主撤销栈", () => {
  test("编辑写入磁盘，撤销 / 重做走同一条字节快照", async () => {
    const file = await fixture("a.txt", "a\nb\nc\n")

    const edited = await editDocumentFile(file, "text", [{ op: "sortLines", descending: true }])
    expect(edited.ok).toBe(true)
    if (!edited.ok) return
    expect(edited.data.history.canUndo).toBe(true)
    expect(edited.data.history.canRedo).toBe(false)
    expect(await readFile(file, "utf8")).toBe("c\nb\na\n")

    const undone = await undoDocumentFile(file, "text")
    expect(undone.ok).toBe(true)
    if (!undone.ok) return
    expect(await readFile(file, "utf8")).toBe("a\nb\nc\n")
    expect(undone.data.history.canUndo).toBe(false)
    expect(undone.data.history.canRedo).toBe(true)

    const redone = await redoDocumentFile(file, "text")
    expect(redone.ok).toBe(true)
    expect(await readFile(file, "utf8")).toBe("c\nb\na\n")
  })

  test("多次编辑逐步撤销，人和 AI 共用同一条历史", async () => {
    const file = await fixture("b.txt", "1\n")

    // 第一步模拟用户在面板里改，第二步模拟 Agent 调用同一个模块。
    expect((await editDocumentFile(file, "text", [{ op: "setText", text: "1\n2\n" }])).ok).toBe(true)
    expect((await editDocumentFile(file, "text", [{ op: "setText", text: "1\n2\n3\n" }])).ok).toBe(true)

    const first = await undoDocumentFile(file, "text")
    expect(first.ok).toBe(true)
    expect(await readFile(file, "utf8")).toBe("1\n2\n")

    const second = await undoDocumentFile(file, "text")
    expect(second.ok).toBe(true)
    expect(await readFile(file, "utf8")).toBe("1\n")

    const exhausted = await undoDocumentFile(file, "text")
    expect(exhausted.ok).toBe(false)

    const history = await documentHistory(file, "text")
    expect(history.ok).toBe(true)
    if (history.ok) expect(history.data).toMatchObject({ canUndo: false, canRedo: true })
  })

  test("文件被外部改过时历史重置，不会把旧快照盖回去", async () => {
    const file = await fixture("c.txt", "x\n")
    expect((await editDocumentFile(file, "text", [{ op: "setText", text: "y\n" }])).ok).toBe(true)

    // 模拟 Word/Excel 之类的另一个程序改写文件。
    await writeFile(file, "外部改的\n", "utf8")

    const history = await documentHistory(file, "text")
    expect(history.ok).toBe(true)
    if (history.ok) expect(history.data.canUndo).toBe(false)

    const undone = await undoDocumentFile(file, "text")
    expect(undone.ok).toBe(false)
    expect(await readFile(file, "utf8")).toBe("外部改的\n")
  })

  test("操作失败时不写盘，也不进历史", async () => {
    const file = await fixture("d.txt", "a\n")
    const failed = await editDocumentFile(file, "text", [{ op: "formatJson" }])
    expect(failed.ok).toBe(false)
    expect(await readFile(file, "utf8")).toBe("a\n")

    const history = await documentHistory(file, "text")
    expect(history.ok).toBe(true)
    if (history.ok) expect(history.data.canUndo).toBe(false)
  })

  test("文件不存在时没有历史，而不是抛错", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "novaway-session-"))
    dirs.push(dir)
    const history = await documentHistory(path.join(dir, "missing.txt"), "text")
    expect(history.ok).toBe(true)
    if (history.ok) expect(history.data).toEqual({ canUndo: false, canRedo: false })
  })

  test("whole-document save rejects a disk version changed after user approval", async () => {
    const file = await fixture("cas.txt", "original\n")
    const approved = new TextEncoder().encode("original\n")
    const next = new TextEncoder().encode("editor version\n")
    const approvedHash = sha256(approved)

    // Simulate an external writer changing the file after the UI read/confirm step.
    await writeFile(file, "external version\n", "utf8")
    const rejected = await recordDocumentWrite(file, "text", approved, next, "保存编辑", approvedHash)

    expect(rejected.ok).toBe(false)
    if (!rejected.ok) expect(rejected.error.code).toBe("conflict")
    expect(await readFile(file, "utf8")).toBe("external version\n")
    const history = await documentHistory(file, "text")
    expect(history.ok).toBe(true)
    if (history.ok) expect(history.data.canUndo).toBe(false)
  })

  test("whole-document save accepts the exact version explicitly approved for overwrite", async () => {
    const file = await fixture("cas-overwrite.txt", "external version\n")
    const approved = new TextEncoder().encode("external version\n")
    const next = new TextEncoder().encode("editor version\n")
    const result = await recordDocumentWrite(file, "text", approved, next, "保存编辑", sha256(approved))

    expect(result.ok).toBe(true)
    expect(await readFile(file, "utf8")).toBe("editor version\n")
    const undone = await undoDocumentFile(file, "text")
    expect(undone.ok).toBe(true)
    expect(await readFile(file, "utf8")).toBe("external version\n")
  })

  test("external calculated bytes also enter the host history", async () => {
    const nl = String.fromCharCode(10)
    const file = await fixture("e.txt", "old" + nl)
    const before = new Uint8Array(await readFile(file))
    const after = new TextEncoder().encode("new" + nl)

    const recorded = await recordDocumentWrite(file, "text", before, after, "画布编辑")
    expect(recorded.ok).toBe(true)
    if (!recorded.ok) return
    expect(recorded.data.history.canUndo).toBe(true)
    expect(recorded.data.history.undoLabel).toBe("画布编辑")
    expect(await readFile(file, "utf8")).toBe("new" + nl)

    const undone = await undoDocumentFile(file, "text")
    expect(undone.ok).toBe(true)
    expect(await readFile(file, "utf8")).toBe("old" + nl)
  })

  test("PDF compatibility page operations use the same host undo history", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "novaway-session-pdf-"))
    dirs.push(dir)
    const file = path.join(dir, "page-tools.pdf")
    const original = await createPdf({ title: "PDF 页面工具" })
    await writeFile(file, original)

    const edited = await editDocumentFile(file, "pdf", [{ op: "rotatePage", page: 1, degrees: 90 }])
    expect(edited.ok).toBe(true)
    if (!edited.ok) return
    expect(edited.data.history.canUndo).toBe(true)

    const undone = await undoDocumentFile(file, "pdf")
    expect(undone.ok).toBe(true)
    expect(Array.from(await readFile(file))).toEqual(Array.from(original))
  })

  test("CSV 也走同一条撤销栈：改单元格 → 撤销 → 重做", async () => {
    const file = await fixture("sheet.csv", "name,count\napple,3\n")
    const edited = await editDocumentFile(file, "csv", [
      { op: "setCellValue", sheet: "Sheet1", ref: { row: 1, col: 1 }, value: 9 },
    ])
    expect(edited.ok).toBe(true)
    if (!edited.ok) return
    expect(edited.data.history.canUndo).toBe(true)
    expect(await readFile(file, "utf8")).toBe("name,count\napple,9\n")

    const undone = await undoDocumentFile(file, "csv")
    expect(undone.ok).toBe(true)
    expect(await readFile(file, "utf8")).toBe("name,count\napple,3\n")

    const redone = await redoDocumentFile(file, "csv")
    expect(redone.ok).toBe(true)
    expect(await readFile(file, "utf8")).toBe("name,count\napple,9\n")
  })
})
