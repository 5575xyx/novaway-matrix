import { afterEach, describe, expect, test } from "bun:test"
import { createOfficeEditorLifecycle } from "./office-editor-lifecycle"
import type { OfficeEditorContext } from "./office-editor-host"
import { confirmOfficeEditorClose } from "./office-editor-session"
import {
  detachOfficeEditor,
  disposeOfficeEditor,
  disposeOfficeEditorsForDirectory,
  officeEditorKey,
  peekOfficeEditor,
  putOfficeEditor,
  reconcileOfficeEditors,
  registerKeepAliveCloseGuard,
  type KeepAliveEntry,
} from "./office-editor-keepalive"

const DIR = "E:/keepalive-test"

function entry(path: string, tabPath = path) {
  let context!: OfficeEditorContext
  let disposed = 0
  const container = document.createElement("div")
  const session = createOfficeEditorLifecycle({
    context: { container, name: path, bytes: new Uint8Array([1]) },
    mount: async (ctx) => {
      context = ctx
      return { save: async () => new Uint8Array([2]), dispose: () => disposed++ }
    },
    write: async () => {},
    onDirty: () => {},
  })
  const e: KeepAliveEntry = {
    key: officeEditorKey(DIR, path),
    path,
    tabPath,
    base64: "AAE=",
    container,
    session,
    ready: session.ready,
    attached: false,
    bindings: { write: async () => {} },
  }
  return { e, context: () => context, disposed: () => disposed }
}

afterEach(() => disposeOfficeEditorsForDirectory(DIR))

describe("Office editor keep-alive cache", () => {
  test("detach parks the editor off-DOM without disposing; reattach reuses the same live instance", async () => {
    const { e, disposed } = entry("a.docx")
    await e.ready
    const firstParent = document.createElement("div")
    firstParent.appendChild(e.container)
    putOfficeEditor(e)
    e.attached = true

    detachOfficeEditor(e)
    expect(e.container.parentElement).toBeNull()
    expect(e.attached).toBe(false)
    expect(disposed()).toBe(0)
    expect(peekOfficeEditor(e.key)).toBe(e)

    // 切回来：挂到新的挂载点，仍是同一个实例，未重建。
    const secondParent = document.createElement("div")
    const cached = peekOfficeEditor(e.key)!
    secondParent.appendChild(cached.container)
    expect(cached).toBe(e)
    expect(cached.container.parentElement).toBe(secondParent)
    expect(disposed()).toBe(0)
  })

  test("dirty state survives a detach/reattach cycle", async () => {
    const { e, context } = entry("dirty.docx")
    await e.ready
    putOfficeEditor(e)
    context().onDirty(true)
    detachOfficeEditor(e)
    expect(peekOfficeEditor(e.key)!.session.dirty()).toBe(true)
  })

  test("dispose releases the editor and unregisters its close guard", async () => {
    const { e, context, disposed } = entry("close.docx")
    await e.ready
    putOfficeEditor(e)
    let confirmed = 0
    registerKeepAliveCloseGuard(e, async () => {
      confirmed++
      return false
    })
    context().onDirty(true)
    expect(await confirmOfficeEditorClose("close.docx")).toBe(false)
    expect(confirmed).toBe(1)

    disposeOfficeEditor(e.key)
    expect(disposed()).toBe(1)
    expect(peekOfficeEditor(e.key)).toBeUndefined()
    // 守卫已注销：关闭不再拦截。
    expect(await confirmOfficeEditorClose("close.docx")).toBe(true)
    expect(confirmed).toBe(1)
  })

  test("close guard allows closing a clean editor without prompting", async () => {
    const { e } = entry("clean.docx")
    await e.ready
    putOfficeEditor(e)
    let confirmed = 0
    registerKeepAliveCloseGuard(e, async () => {
      confirmed++
      return false
    })
    expect(await confirmOfficeEditorClose("clean.docx")).toBe(true)
    expect(confirmed).toBe(0)
  })

  test("reconcile disposes only editors whose tab is no longer open", async () => {
    const a = entry("keep.docx")
    const b = entry("gone.docx")
    await Promise.all([a.e.ready, b.e.ready])
    putOfficeEditor(a.e)
    putOfficeEditor(b.e)
    reconcileOfficeEditors(DIR, new Set(["keep.docx"]))
    expect(peekOfficeEditor(a.e.key)).toBe(a.e)
    expect(peekOfficeEditor(b.e.key)).toBeUndefined()
    expect(b.disposed()).toBe(1)
    expect(a.disposed()).toBe(0)
  })

  test("reconcile aligns legacy editors by tab path, not the converted mount path", async () => {
    const { e, disposed } = entry("report-edited-123.docx", "report.doc")
    await e.ready
    putOfficeEditor(e)
    reconcileOfficeEditors(DIR, new Set(["report.doc"]))
    expect(peekOfficeEditor(e.key)).toBe(e)
    expect(disposed()).toBe(0)
    reconcileOfficeEditors(DIR, new Set())
    expect(disposed()).toBe(1)
  })

  test("putting a new editor for the same tab disposes the orphaned previous instance", async () => {
    const old = entry("legacy-edited-1.docx", "legacy.doc")
    const fresh = entry("legacy-edited-2.docx", "legacy.doc")
    await Promise.all([old.e.ready, fresh.e.ready])
    putOfficeEditor(old.e)
    putOfficeEditor(fresh.e)
    expect(old.disposed()).toBe(1)
    expect(peekOfficeEditor(old.e.key)).toBeUndefined()
    expect(peekOfficeEditor(fresh.e.key)).toBe(fresh.e)
  })
})
