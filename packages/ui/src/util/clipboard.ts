import { filenameFromUrl } from "./download"

interface ElectronAPI {
  copyFileToClipboard?: (opts: { url: string; filename?: string }) => Promise<boolean>
}

function getElectronApi(win: Window | undefined): ElectronAPI | undefined {
  return win && "api" in win ? (win as unknown as { api: ElectronAPI }).api : undefined
}

export async function writeClipboard(text: string): Promise<boolean> {
  const body = typeof document === "undefined" ? undefined : document.body
  if (body) {
    const textarea = document.createElement("textarea")
    textarea.value = text
    textarea.setAttribute("readonly", "")
    textarea.style.position = "fixed"
    textarea.style.opacity = "0"
    textarea.style.pointerEvents = "none"
    body.appendChild(textarea)
    textarea.select()
    const copied = document.execCommand("copy")
    body.removeChild(textarea)
    if (copied) return true
  }

  const clipboard = typeof navigator === "undefined" ? undefined : navigator.clipboard
  if (!clipboard?.writeText) return false
  return clipboard.writeText(text).then(
    () => true,
    () => false,
  )
}

async function copyMediaBlobToClipboard(url: string): Promise<boolean> {
  const clipboard = typeof navigator === "undefined" ? undefined : navigator.clipboard
  if (!clipboard?.write) return false

  try {
    const response = await fetch(url, { mode: "cors" })
    if (!response.ok) return false
    const blob = await response.blob()
    if (!blob.type || blob.size === 0) return false
    await clipboard.write([new ClipboardItem({ [blob.type]: blob })])
    return true
  } catch {
    return false
  }
}

function copyVideoFrameToClipboard(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const body = typeof document === "undefined" ? undefined : document.body
    if (!body) {
      resolve(false)
      return
    }

    let objectUrl: string | undefined

    const cleanup = (video: HTMLVideoElement) => {
      video.pause()
      if (video.parentNode) video.parentNode.removeChild(video)
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }

    const fail = (video?: HTMLVideoElement) => {
      if (video) cleanup(video)
      resolve(false)
    }

    const captureFrame = (videoSrc: string, crossOrigin: boolean) => {
      const video = document.createElement("video")
      if (crossOrigin) video.crossOrigin = "anonymous"
      video.src = videoSrc
      video.muted = true
      video.playsInline = true
      video.preload = "metadata"
      video.style.position = "fixed"
      video.style.opacity = "0"
      video.style.pointerEvents = "none"
      video.style.width = "1px"
      body.appendChild(video)

      const onError = () => fail(video)

      video.addEventListener(
        "loadeddata",
        () => {
          try {
            const canvas = document.createElement("canvas")
            canvas.width = video.videoWidth || 640
            canvas.height = video.videoHeight || 360
            const ctx = canvas.getContext("2d")
            if (!ctx) {
              onError()
              return
            }
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
            canvas.toBlob(async (blob) => {
              const clipboard = typeof navigator === "undefined" ? undefined : navigator.clipboard
              if (!blob || !clipboard?.write) {
                onError()
                return
              }
              try {
                await clipboard.write([new ClipboardItem({ [blob.type]: blob })])
                cleanup(video)
                resolve(true)
              } catch {
                onError()
              }
            }, "image/png")
          } catch {
            onError()
          }
        },
        { once: true },
      )
      video.addEventListener("error", onError, { once: true })
      video.load()
    }

    // 优先获取 Blob 生成同源的 object URL，规避视频元素跨域导致 canvas 被污染或加载失败的问题
    fetch(url, { mode: "cors" })
      .then((response) => {
        if (!response.ok) throw new Error("fetch failed")
        return response.blob()
      })
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob)
        captureFrame(objectUrl, false)
      })
      .catch(() => {
        captureFrame(url, true)
      })
  })
}

export async function copyMediaToClipboard(url: string, type?: "image" | "video"): Promise<boolean> {
  // 桌面端优先通过主进程把远程视频下载为临时文件并写入系统剪贴板，实现“复制整个视频”
  if (type === "video") {
    const electronApi = getElectronApi(typeof window === "undefined" ? undefined : window)
    if (electronApi?.copyFileToClipboard) {
      const filename = filenameFromUrl(url, "video.mp4")
      if (await electronApi.copyFileToClipboard({ url, filename })) return true
    }
  }
  if (await copyMediaBlobToClipboard(url)) return true
  if (type === "video") return copyVideoFrameToClipboard(url)
  return false
}
