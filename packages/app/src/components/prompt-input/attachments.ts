import { onMount } from "solid-js"
import { makeEventListener } from "@solid-primitives/event-listener"
import { showToast } from "@novaway/ui/toast"
import { usePrompt, type ContentPart, type ImageAttachmentPart } from "@/context/prompt"
import { useLanguage } from "@/context/language"
import { uuid } from "@/utils/uuid"
import { WORKSPACE_FILE_DRAG_MIME, readWorkspaceFileDragPayload } from "@/utils/workspace-file-drag"
import { getCursorPosition } from "./editor-dom"
import { attachmentMime } from "./files"
import { createDragFeedback } from "./drag-feedback"
import { normalizePaste, pasteMode } from "./paste"

function dataUrl(file: File, mime: string) {
  return new Promise<string>((resolve) => {
    const reader = new FileReader()
    reader.addEventListener("error", () => resolve(""))
    reader.addEventListener("load", () => {
      const value = typeof reader.result === "string" ? reader.result : ""
      const idx = value.indexOf(",")
      if (idx === -1) {
        resolve(value)
        return
      }
      resolve(`data:${mime};base64,${value.slice(idx + 1)}`)
    })
    reader.readAsDataURL(file)
  })
}

type PromptAttachmentsInput = {
  editor: () => HTMLDivElement | undefined
  isDialogActive: () => boolean
  setDraggingType: (type: "image" | "@mention" | null) => void
  focusEditor: () => void
  addPart: (part: ContentPart) => boolean
  readClipboardImage?: () => Promise<File | null>
}

export function createPromptAttachments(
  input: PromptAttachmentsInput,
  events: Document = document,
  globalEvents: Window = window,
) {
  const prompt = usePrompt()
  const language = useLanguage()

  const warn = () => {
    showToast({
      title: language.t("prompt.toast.pasteUnsupported.title"),
      description: language.t("prompt.toast.pasteUnsupported.description"),
    })
  }

  const add = async (file: File, toast = true) => {
    const mime = await attachmentMime(file)
    if (!mime) {
      if (toast) warn()
      return false
    }

    const editor = input.editor()
    if (!editor) return false

    const url = await dataUrl(file, mime)
    if (!url) return false

    const attachment: ImageAttachmentPart = {
      type: "image",
      id: uuid(),
      filename: file.name,
      mime,
      dataUrl: url,
    }
    const cursor = prompt.cursor() ?? getCursorPosition(editor)
    prompt.set([...prompt.current(), attachment], cursor)
    return true
  }

  const addAttachment = (file: File) => add(file)

  const addAttachments = async (files: File[], toast = true) => {
    let found = false

    for (const file of files) {
      const ok = await add(file, false)
      if (ok) found = true
    }

    if (!found && files.length > 0 && toast) warn()
    return found
  }

  const removeAttachment = (id: string) => {
    const current = prompt.current()
    const next = current.filter((part) => part.type !== "image" || part.id !== id)
    prompt.set(next, prompt.cursor())
  }

  const handlePaste = async (event: ClipboardEvent) => {
    const clipboardData = event.clipboardData
    if (!clipboardData) return

    event.preventDefault()
    event.stopPropagation()

    const files = Array.from(clipboardData.items).flatMap((item) => {
      if (item.kind !== "file") return []
      const file = item.getAsFile()
      return file ? [file] : []
    })

    if (files.length > 0) {
      await addAttachments(files)
      return
    }

    const plainText = clipboardData.getData("text/plain") ?? ""

    // Desktop: Browser clipboard has no images and no text, try platform's native clipboard for images
    if (input.readClipboardImage && !plainText) {
      const file = await input.readClipboardImage()
      if (file) {
        await addAttachment(file)
        return
      }
    }

    if (!plainText) return

    const text = normalizePaste(plainText)

    const put = () => {
      if (input.addPart({ type: "text", content: text, start: 0, end: 0 })) return true
      input.focusEditor()
      return input.addPart({ type: "text", content: text, start: 0, end: 0 })
    }

    if (pasteMode(text) === "manual") {
      put()
      return
    }

    const inserted = typeof document.execCommand === "function" && document.execCommand("insertText", false, text)
    if (inserted) return

    put()
  }

  const dragFeedback = createDragFeedback(input.setDraggingType)
  const resetDragging = dragFeedback.reset

  const handleGlobalDragOver = (event: DragEvent) => {
    if (input.isDialogActive()) {
      resetDragging()
      return
    }

    const types = event.dataTransfer?.types
    const hasFiles = types?.includes("Files")
    const hasText = types?.includes("text/plain")
    const hasWorkspaceFile = types?.includes(WORKSPACE_FILE_DRAG_MIME)
    if (hasWorkspaceFile || hasText) {
      event.preventDefault()
      dragFeedback.activate("@mention")
    } else if (hasFiles) {
      event.preventDefault()
      dragFeedback.activate("image")
    }
  }

  const handleGlobalDragLeave = (event: DragEvent) => {
    if (!event.relatedTarget) resetDragging()
  }

  const handleGlobalDrop = async (event: DragEvent) => {
    resetDragging()
    if (input.isDialogActive()) return

    event.preventDefault()

    const workspaceFile = readWorkspaceFileDragPayload(event.dataTransfer)
    if (workspaceFile) {
      input.focusEditor()
      // 目录没有文件可读，作为 @ 路径引用插入，交给 agent 自行展开。
      if (workspaceFile.type === "directory") {
        input.addPart({ type: "text", content: `@${workspaceFile.path} `, start: 0, end: 0 })
        return
      }
      input.addPart({ type: "file", path: workspaceFile.path, content: "@" + workspaceFile.path, start: 0, end: 0 })
      return
    }

    const plainText = event.dataTransfer?.getData("text/plain")
    const filePrefix = "file:"
    if (plainText?.startsWith(filePrefix)) {
      const filePath = plainText.slice(filePrefix.length)
      input.focusEditor()
      input.addPart({ type: "file", path: filePath, content: "@" + filePath, start: 0, end: 0 })
      return
    }

    const dropped = event.dataTransfer?.files
    if (!dropped) return

    await addAttachments(Array.from(dropped))
  }

  onMount(() => {
    makeEventListener(events, "dragover", handleGlobalDragOver)
    makeEventListener(events, "dragleave", handleGlobalDragLeave)
    makeEventListener(events, "drop", handleGlobalDrop)
    makeEventListener(globalEvents, "dragend", resetDragging)
    makeEventListener(globalEvents, "drop", resetDragging)
    makeEventListener(globalEvents, "blur", resetDragging)
  })

  return {
    addAttachment,
    addAttachments,
    removeAttachment,
    handlePaste,
  }
}
