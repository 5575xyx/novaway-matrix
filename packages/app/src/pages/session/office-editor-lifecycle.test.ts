import { describe, expect, test } from "bun:test"
import { createOfficeEditorLifecycle } from "./office-editor-lifecycle"
import type { OfficeEditor, OfficeEditorContext } from "./office-editor-host"

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function fixture(
  options: {
    save?: OfficeEditor["save"]
    beforeSave?: (baseline: Uint8Array) => Promise<string | false>
    write?: (bytes: Uint8Array, token?: string) => Promise<void>
  } = {},
) {
  let context!: OfficeEditorContext
  const changes: boolean[] = []
  const writes: Uint8Array[] = []
  let disposed = 0
  let marked = 0
  const lifecycle = createOfficeEditorLifecycle({
    context: { container: {} as HTMLElement, name: "first.docx", bytes: new Uint8Array([1]) },
    mount: async (ctx) => {
      context = ctx
      return {
        save: options.save ?? (async () => new Uint8Array([2])),
        markSaved: () => {
          marked++
        },
        dispose: () => {
          disposed++
        },
      }
    },
    beforeSave: options.beforeSave,
    write:
      options.write ??
      (async (bytes) => {
        writes.push(bytes)
      }),
    onDirty: (dirty) => {
      changes.push(dirty)
    },
  })
  return { lifecycle, changes, writes, context: () => context, marked: () => marked, disposed: () => disposed }
}

describe("Office file generation lifecycle", () => {
  test("late mount after disposal releases only its own editor and ignores stale dirty callbacks", async () => {
    const mount = deferred<OfficeEditor>()
    let context!: OfficeEditorContext
    let disposed = 0
    const changes: boolean[] = []
    const session = createOfficeEditorLifecycle({
      context: { container: {} as HTMLElement, name: "late.pdf", bytes: new Uint8Array([1]) },
      mount: (ctx) => {
        context = ctx
        return mount.promise
      },
      write: async () => {
        throw new Error("A disposed editor must never write")
      },
      onDirty: (value) => {
        changes.push(value)
      },
    })
    session.dispose()
    expect(context.signal?.aborted).toBe(true)
    context.onDirty(true)
    mount.resolve({
      save: async () => new Uint8Array([2]),
      dispose: () => {
        disposed++
      },
    })
    expect(await session.ready).toBe(false)
    expect(disposed).toBe(1)
    expect(changes).toEqual([])
    session.dispose()
    expect(disposed).toBe(1)
  })

  test("disposing while conflict confirmation is pending prevents serialization and write", async () => {
    const approval = deferred<string | false>()
    let serialized = 0
    const f = fixture({
      beforeSave: () => approval.promise,
      save: async () => {
        serialized++
        return new Uint8Array([2])
      },
    })
    await f.lifecycle.ready
    f.context().onDirty(true)
    const saving = f.lifecycle.save()
    f.lifecycle.dispose()
    approval.resolve("new-baseline")
    await saving
    expect(serialized).toBe(0)
    expect(f.writes).toHaveLength(0)
    expect(f.disposed()).toBe(1)
  })

  test("disposing during serialization prevents a late result from writing another file", async () => {
    const bytes = deferred<Uint8Array>()
    const f = fixture({ save: () => bytes.promise })
    await f.lifecycle.ready
    f.context().onDirty(true)
    const saving = f.lifecycle.save()
    f.lifecycle.dispose()
    bytes.resolve(new Uint8Array([3]))
    await saving
    expect(f.writes).toHaveLength(0)
    expect(f.marked()).toBe(0)
  })

  test("duplicate save requests share a single write", async () => {
    const bytes = deferred<Uint8Array>()
    const f = fixture({ save: () => bytes.promise })
    await f.lifecycle.ready
    f.context().onDirty(true)
    const first = f.lifecycle.save()
    expect(f.lifecycle.save()).toBe(first)
    bytes.resolve(new Uint8Array([2]))
    await first
    expect(f.writes).toHaveLength(1)
    expect(f.marked()).toBe(1)
    expect(f.lifecycle.dirty()).toBe(false)
    f.lifecycle.dispose()
  })

  test("editing during write retains dirty and advances the disk baseline for the next save", async () => {
    const writing = deferred<void>()
    const started = deferred<void>()
    const baselines: number[][] = []
    const f = fixture({
      beforeSave: async (bytes) => {
        baselines.push(Array.from(bytes))
        return "token"
      },
      write: () => {
        started.resolve()
        return writing.promise
      },
    })
    await f.lifecycle.ready
    f.context().onDirty(true)
    const first = f.lifecycle.save()
    // Let approval/serialization finish and the write begin, without timing sleeps.
    await Promise.resolve()
    await Promise.resolve()
    await started.promise
    f.context().onDirty(true)
    writing.resolve()
    await first
    expect(f.lifecycle.dirty()).toBe(true)
    expect(f.marked()).toBe(0)
    await f.lifecycle.save()
    expect(baselines).toEqual([[1], [2]])
    expect(f.lifecycle.dirty()).toBe(false)
    f.lifecycle.dispose()
  })

  test("Save As snapshots neither write the source nor mark it saved", async () => {
    const f = fixture()
    await f.lifecycle.ready
    f.context().onDirty(true)
    expect(await f.lifecycle.snapshot()).toEqual(new Uint8Array([2]))
    expect(f.writes).toHaveLength(0)
    expect(f.marked()).toBe(0)
    expect(f.lifecycle.dirty()).toBe(true)
    await f.lifecycle.save()
    expect(f.writes).toEqual([new Uint8Array([2])])
    expect(f.marked()).toBe(1)
    expect(f.lifecycle.dirty()).toBe(false)
    f.lifecycle.dispose()
    expect(await f.lifecycle.snapshot()).toBeUndefined()
  })

  test("serialization cannot recursively wait on the Host save request", async () => {
    let context!: OfficeEditorContext
    const f = fixture({
      save: async () => {
        await context.onSaveRequest?.()
        return new Uint8Array([2])
      },
    })
    await f.lifecycle.ready
    context = f.context()
    context.onDirty(true)
    await f.lifecycle.save()
    expect(f.writes).toEqual([new Uint8Array([2])])
    expect(f.lifecycle.dirty()).toBe(false)
    f.lifecycle.dispose()
  })
  test("Save As restores dirty when editor serialization clears its internal dirty flag", async () => {
    let context!: OfficeEditorContext
    let saves = 0
    const lifecycle = createOfficeEditorLifecycle({
      context: { container: {} as HTMLElement, name: "first.xlsx", bytes: new Uint8Array([1]) },
      mount: async (ctx) => {
        context = ctx
        return {
          save: async () => {
            saves++
            context.onDirty(false)
            return new Uint8Array([2])
          },
          dispose: () => {},
        }
      },
      write: async () => {},
      onDirty: () => {},
    })
    await lifecycle.ready
    context.onDirty(true)
    expect(await lifecycle.snapshot()).toEqual(new Uint8Array([2]))
    expect(lifecycle.dirty()).toBe(true)
    await lifecycle.save()
    expect(saves).toBe(1)
    expect(lifecycle.dirty()).toBe(false)
    lifecycle.dispose()
  })
  test("serializer dirty notifications belong to the completed snapshot, not a later edit", async () => {
    const f = fixture({
      save: async () => {
        f.context().onDirty(true)
        return new Uint8Array([3])
      },
    })
    await f.lifecycle.ready
    f.context().onDirty(true)
    await f.lifecycle.save()
    expect(f.writes).toEqual([new Uint8Array([3])])
    expect(f.marked()).toBe(1)
    expect(f.lifecycle.dirty()).toBe(false)
    f.lifecycle.dispose()
  })

  test("cancelled conflicts and failed writes preserve dirty; retry uses the same baseline", async () => {
    let allowed = false
    let failed = true
    const baselines: number[][] = []
    const f = fixture({
      beforeSave: async (bytes) => {
        baselines.push(Array.from(bytes))
        return allowed ? "token" : false
      },
      write: async () => {
        if (failed) throw new Error("disk write failed")
      },
    })
    await f.lifecycle.ready
    f.context().onDirty(true)
    await f.lifecycle.save()
    expect(f.lifecycle.dirty()).toBe(true)
    allowed = true
    await expect(f.lifecycle.save()).rejects.toThrow("disk write failed")
    expect(f.lifecycle.dirty()).toBe(true)
    failed = false
    await f.lifecycle.save()
    expect(baselines).toEqual([[1], [1], [1]])
    expect(f.lifecycle.dirty()).toBe(false)
    f.lifecycle.dispose()
  })
})
