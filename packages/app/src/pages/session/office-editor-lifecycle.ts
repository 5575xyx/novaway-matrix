import type { OfficeEditor, OfficeEditorContext, OfficeEditorMount } from "./office-editor-host"

/** One immutable file/mount generation. Never read reactive path/write callbacks after awaiting. */
export function createOfficeEditorLifecycle(options: {
  context: Omit<OfficeEditorContext, "signal" | "onDirty" | "onSaveRequest">
  mount: OfficeEditorMount
  beforeSave?: (baseline: Uint8Array) => Promise<string | false | undefined>
  write: (bytes: Uint8Array, baseline?: string) => Promise<void>
  onDirty: (dirty: boolean) => void
}) {
  const controller = new AbortController()
  let editor: OfficeEditor | undefined
  let baseline = options.context.bytes.slice()
  let dirty = false
  let revision = 0
  let saving: Promise<void> | undefined
  let serializedSnapshot: { bytes: Uint8Array; revision: number } | undefined
  let serializing = false

  const changeDirty = (value: boolean) => {
    if (controller.signal.aborted) return
    if (value) revision++
    dirty = value
    options.onDirty(value)
  }

  const serialize = async (current: OfficeEditor) => {
    serializing = true
    try {
      return await current.save()
    } finally {
      serializing = false
    }
  }

  function requestSave() {
    return serializing ? Promise.resolve() : save()
  }

  const performSave = async () => {
    const current = editor
    if (!current || !dirty || controller.signal.aborted) return
    const token = options.beforeSave ? await options.beforeSave(baseline.slice()) : undefined
    if (token === false || controller.signal.aborted) return
    const bytes =
      serializedSnapshot && serializedSnapshot.revision === revision
        ? serializedSnapshot.bytes
        : await serialize(current)
    serializedSnapshot = undefined
    if (controller.signal.aborted) return
    // save() may flush drafts and emit dirty notifications itself (notably PDF).
    // The completed snapshot includes that flush; protect edits made while writing it.
    const version = revision
    await options.write(bytes, token)
    if (controller.signal.aborted) return
    baseline = bytes.slice()
    // Edits made during disk IO still need saving; do not reset their undo baseline.
    if (revision !== version) return
    await current.markSaved?.(bytes)
    if (controller.signal.aborted || revision !== version) return
    changeDirty(false)
  }

  const save = (): Promise<void> => {
    if (saving) return saving
    saving = performSave().finally(() => {
      saving = undefined
    })
    return saving
  }

  const ready = (async () => {
    const mounted = await options.mount({
      ...options.context,
      signal: controller.signal,
      onDirty: changeDirty,
      onSaveRequest: requestSave,
    })
    if (controller.signal.aborted) {
      mounted.dispose()
      return false
    }
    editor = mounted
    return true
  })().catch((error: unknown) => {
    controller.abort()
    throw error
  })

  return {
    ready,
    save,
    async snapshot() {
      const current = editor
      if (!current || controller.signal.aborted) return undefined
      // Save As is a serialization-only operation. Some editor implementations clear
      // their internal dirty flag while serializing, so restore the Host dirty state
      // before caching the exact bytes for the subsequent normal Save.
      const wasDirty = dirty
      const bytes = await serialize(current)
      if (controller.signal.aborted) return undefined
      if (wasDirty && !dirty) changeDirty(true)
      serializedSnapshot = { bytes: bytes.slice(), revision }
      return bytes
    },
    dirty: () => dirty,
    assistant: {
      async reference() {
        return editor?.assistant?.reference() ?? null
      },
    },
    dispose() {
      if (controller.signal.aborted) return
      controller.abort()
      editor?.dispose()
      editor = undefined
    },
  }
}
