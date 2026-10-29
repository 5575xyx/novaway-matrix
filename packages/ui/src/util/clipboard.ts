import { filenameFromUrl } from "./download"

interface ElectronAPI {
  copyFileToClipboard?: (opts: { url: string; filename?: string }) => Promise<boolean>
  writeTextToClipboard?: (opts: { text: string }) => Promise<boolean>
}

function getElectronApi(win: Window | undefined): ElectronAPI | undefined {
  return win && "api" in win ? (win as unknown as { api: ElectronAPI }).api : undefined
}

/**
 * 写文本到系统剪贴板。
 *
 * 顺序很关键：桌面端先走主进程（Electron `clipboard.writeText`）。
 * WebView 里 `document.execCommand("copy")` 依赖元素真的拿到焦点、
 * `navigator.clipboard` 又要求安全上下文，两者在自定义协议加载的窗口里
 * 经常**静默失败** —— 表现就是「复制路径」点了没反应、剪贴板里还是旧内容。
 * 主进程那条路不受这些限制，而且能立刻读回来校验。
 */
export async function writeClipboard(text: string): Promise<boolean> {
  const electron = getElectronApi(typeof window === "undefined" ? undefined : window)
  if (electron?.writeTextToClipboard) {
    try {
      if (await electron.writeTextToClipboard({ text })) return true
    } catch {
      // 主进程通道不可用（老版本壳）时继续走浏览器兜底。
    }
  }

  // 浏览器里优先用异步剪贴板 API。
  //
  // 之前把 execCommand 放在前面，踩了两类坑：
  //  - 它在「没有用户激活」的调用栈里（菜单项 onSelect → 异步 copyPath）会返回 true
  //    却什么都没写进去，于是界面弹了「已复制」而剪贴板仍是空的 —— 正是用户反馈的现象；
  //  - 它会临时夺走焦点再还回去，菜单/输入框的焦点状态被打断。
  // writeText 只在真正写入成功时才 resolve，失败会 reject，语义准确得多。
  const clipboard = typeof navigator === "undefined" ? undefined : navigator.clipboard
  if (clipboard?.writeText) {
    try {
      await clipboard.writeText(text)
      return true
    } catch {
      // 非安全上下文 / 权限被拒：继续走 execCommand 兜底。
    }
  }

  const body = typeof document === "undefined" ? undefined : document.body
  if (body) {
    const active = document.activeElement as HTMLElement | null
    const textarea = document.createElement("textarea")
    textarea.value = text
    textarea.setAttribute("readonly", "")
    textarea.style.position = "fixed"
    textarea.style.top = "-1000px"
    textarea.style.opacity = "0"
    textarea.style.pointerEvents = "none"
    body.appendChild(textarea)
    // iOS/WKWebView 只认 setSelectionRange，光 select() 有时选区是空的。
    textarea.focus()
    textarea.select()
    textarea.setSelectionRange(0, text.length)
    const copied = document.execCommand("copy")
    body.removeChild(textarea)
    active?.focus?.()
    if (copied) return true
  }

  return false
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
