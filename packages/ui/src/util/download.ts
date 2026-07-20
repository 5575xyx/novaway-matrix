interface FileSystemWritableFileStream {
  write(data: Blob): Promise<void>
  close(): Promise<void>
}

interface FileSystemFileHandle {
  createWritable(): Promise<FileSystemWritableFileStream>
}

type ShowSaveFilePicker = (options?: { suggestedName?: string }) => Promise<FileSystemFileHandle>

interface ElectronAPI {
  saveFilePicker?: (opts?: { title?: string; defaultPath?: string; data?: Uint8Array }) => Promise<string | null>
}

function getElectronApi(win: Window | undefined): ElectronAPI | undefined {
  return win && "api" in win ? (win as unknown as { api: ElectronAPI }).api : undefined
}

async function downloadWithAnchor(url: string, filename: string | undefined, body: HTMLElement): Promise<boolean> {
  const link = document.createElement("a")
  link.href = url
  link.download = filename ?? ""
  link.rel = "noopener noreferrer"
  link.target = "_blank"
  link.style.display = "none"
  body.appendChild(link)
  link.click()
  body.removeChild(link)
  return true
}

export async function downloadFile(url: string, filename?: string): Promise<boolean> {
  const body = typeof document === "undefined" ? undefined : document.body
  if (!body) return false

  const win = typeof window === "undefined" ? undefined : window
  const electronApi = getElectronApi(win)
  if (electronApi?.saveFilePicker) {
    try {
      const response = await fetch(url, { mode: "cors" })
      if (!response.ok) return false
      const blob = await response.blob()
      const buffer = await blob.arrayBuffer()
      const result = await electronApi.saveFilePicker({
        defaultPath: filename ?? "",
        data: new Uint8Array(buffer),
      })
      return result !== null
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return true
      // 降级到浏览器 API
    }
  }

  const showSaveFilePicker =
    win && "showSaveFilePicker" in win
      ? (win as unknown as { showSaveFilePicker: ShowSaveFilePicker }).showSaveFilePicker
      : undefined

  if (showSaveFilePicker) {
    try {
      const response = await fetch(url, { mode: "cors" })
      if (!response.ok) return false
      const blob = await response.blob()
      const handle = await showSaveFilePicker({ suggestedName: filename ?? "" })
      const writable = await handle.createWritable()
      await writable.write(blob)
      await writable.close()
      return true
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return true
      // 降级到普通下载
    }
  }

  return downloadWithAnchor(url, filename, body)
}

export function filenameFromUrl(url: string, fallback: string): string {
  try {
    const pathname = new URL(url).pathname
    const name = pathname.split("/").pop()
    if (name && name.includes(".")) return decodeURIComponent(name)
  } catch {
    // 忽略无法解析的 URL
  }
  return fallback
}
