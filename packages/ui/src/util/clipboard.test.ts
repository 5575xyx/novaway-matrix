import { beforeEach, describe, expect, jest, test } from "bun:test"
import { copyMediaToClipboard, writeClipboard } from "./clipboard"

function createDocument(execCommandResult: boolean) {
  const elements: Array<{
    tagName: string
    value: string
    select: () => void
    setAttribute: () => void
    style: Record<string, string>
  }> = []
  const body = {
    appendChild: jest.fn((el: (typeof elements)[number]) => elements.push(el)),
    removeChild: jest.fn(),
  }
  return {
    body,
    execCommand: jest.fn(() => execCommandResult),
    createElement: jest.fn((tagName: string) => {
      const el = {
        tagName,
        value: "",
        select: jest.fn(),
        setAttribute: jest.fn(),
        style: {} as Record<string, string>,
      }
      elements.push(el)
      return el
    }),
  }
}

function createVideoFrameDocument() {
  const elements: Array<Record<string, unknown>> = []
  const body = {
    appendChild: jest.fn((el: (typeof elements)[number]) => elements.push(el)),
    removeChild: jest.fn(),
  }
  const listeners: Record<string, Array<() => void>> = {}

  return {
    body,
    elements,
    createElement: jest.fn((tagName: string) => {
      if (tagName === "video") {
        const video = {
          tagName: "video",
          src: "",
          muted: false,
          playsInline: false,
          preload: "",
          style: {},
          parentNode: body,
          videoWidth: 1920,
          videoHeight: 1080,
          load: jest.fn(() => {
            queueMicrotask(() => listeners["loadeddata"]?.forEach((cb) => cb()))
          }),
          pause: jest.fn(),
          addEventListener: jest.fn((event: string, cb: () => void) => {
            listeners[event] = listeners[event] || []
            listeners[event].push(cb)
          }),
        }
        elements.push(video)
        return video
      }

      if (tagName === "canvas") {
        const ctx = { drawImage: jest.fn() }
        const canvas = {
          tagName: "canvas",
          width: 0,
          height: 0,
          getContext: jest.fn(() => ctx),
          toBlob: jest.fn((cb: (blob: Blob | null) => void) => {
            cb(new Blob(["frame"], { type: "image/png" }))
          }),
        }
        return canvas
      }

      return { tagName }
    }),
  }
}

beforeEach(() => {
  delete (globalThis as Partial<typeof globalThis>).document
  delete (globalThis as Partial<typeof globalThis>).navigator
  delete (globalThis as Partial<typeof globalThis>).fetch
  delete (globalThis as Partial<typeof globalThis>).ClipboardItem
})

describe("writeClipboard", () => {
  test("uses execCommand when document.body is available", async () => {
    const doc = createDocument(true)
    Object.defineProperty(globalThis, "document", { value: doc, configurable: true })

    const result = await writeClipboard("https://example.com/image.png")

    expect(result).toBe(true)
    expect(doc.createElement).toHaveBeenCalledWith("textarea")
    expect(doc.execCommand).toHaveBeenCalledWith("copy")
  })

  test("falls back to navigator.clipboard.writeText", async () => {
    const doc = createDocument(false)
    Object.defineProperty(globalThis, "document", { value: doc, configurable: true })
    const writeText = jest.fn(() => Promise.resolve())
    Object.defineProperty(globalThis, "navigator", { value: { clipboard: { writeText } }, configurable: true })

    const result = await writeClipboard("https://example.com/video.mp4")

    expect(result).toBe(true)
    expect(writeText).toHaveBeenCalledWith("https://example.com/video.mp4")
  })

  test("returns false when all copy methods fail", async () => {
    Object.defineProperty(globalThis, "document", { value: createDocument(false), configurable: true })
    Object.defineProperty(globalThis, "navigator", {
      value: { clipboard: { writeText: () => Promise.reject(new Error("denied")) } },
      configurable: true,
    })

    const result = await writeClipboard("text")

    expect(result).toBe(false)
  })
})

describe("copyMediaToClipboard", () => {
  test("writes image blob to clipboard", async () => {
    const blob = new Blob(["image-bytes"], { type: "image/png" })
    const write = jest.fn(() => Promise.resolve())
    Object.defineProperty(globalThis, "navigator", { value: { clipboard: { write } }, configurable: true })
    Object.defineProperty(globalThis, "fetch", {
      value: jest.fn(() => Promise.resolve({ ok: true, blob: () => Promise.resolve(blob) })),
      configurable: true,
    })
    Object.defineProperty(globalThis, "ClipboardItem", { value: class ClipboardItem {}, configurable: true })

    const result = await copyMediaToClipboard("https://example.com/image.png")

    expect(result).toBe(true)
    expect(write).toHaveBeenCalled()
  })

  test("returns false when fetch fails", async () => {
    Object.defineProperty(globalThis, "navigator", {
      value: { clipboard: { write: jest.fn() } },
      configurable: true,
    })
    Object.defineProperty(globalThis, "fetch", {
      value: jest.fn(() => Promise.resolve({ ok: false, blob: () => Promise.resolve(new Blob([])) })),
      configurable: true,
    })

    const result = await copyMediaToClipboard("https://example.com/image.png")

    expect(result).toBe(false)
  })

  test("returns false when clipboard.write is unsupported", async () => {
    Object.defineProperty(globalThis, "navigator", { value: { clipboard: {} }, configurable: true })

    const result = await copyMediaToClipboard("https://example.com/image.png")

    expect(result).toBe(false)
  })

  test("falls back to video frame copy when blob copy fails for video", async () => {
    Object.defineProperty(globalThis, "document", { value: createVideoFrameDocument(), configurable: true })
    Object.defineProperty(globalThis, "navigator", {
      value: { clipboard: { write: jest.fn(() => Promise.resolve()) } },
      configurable: true,
    })
    Object.defineProperty(globalThis, "fetch", {
      value: jest.fn(() => Promise.resolve({ ok: false })),
      configurable: true,
    })
    Object.defineProperty(globalThis, "ClipboardItem", { value: class ClipboardItem {}, configurable: true })

    const result = await copyMediaToClipboard("https://example.com/video.mp4", "video")

    expect(result).toBe(true)
  })

  test("uses object URL for video frame copy when fetch succeeds", async () => {
    const doc = createVideoFrameDocument()
    Object.defineProperty(globalThis, "document", { value: doc, configurable: true })
    let writeCount = 0
    Object.defineProperty(globalThis, "navigator", {
      value: {
        clipboard: {
          write: jest.fn(() => {
            writeCount++
            // 第一次写入视频 Blob 失败，模拟浏览器不支持剪贴板视频类型
            if (writeCount === 1) return Promise.reject(new Error("video not supported"))
            return Promise.resolve()
          }),
        },
      },
      configurable: true,
    })
    const videoBlob = new Blob(["video-bytes"], { type: "video/mp4" })
    Object.defineProperty(globalThis, "fetch", {
      value: jest.fn(() => Promise.resolve({ ok: true, blob: () => Promise.resolve(videoBlob) })),
      configurable: true,
    })
    Object.defineProperty(globalThis, "ClipboardItem", { value: class ClipboardItem {}, configurable: true })
    const createObjectURL = jest.spyOn(URL, "createObjectURL").mockReturnValue("blob:https://example.com/video-frame")
    const revokeObjectURL = jest.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined)

    const result = await copyMediaToClipboard("https://example.com/video.mp4", "video")

    expect(result).toBe(true)
    expect(fetch).toHaveBeenCalledWith("https://example.com/video.mp4", { mode: "cors" })
    expect(createObjectURL).toHaveBeenCalledWith(videoBlob)
    const video = doc.elements.find((el): el is { tagName: string; src: string } => el.tagName === "video")
    expect(video?.src).toBe("blob:https://example.com/video-frame")
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:https://example.com/video-frame")

    createObjectURL.mockRestore()
    revokeObjectURL.mockRestore()
  })

  test("uses Electron native file copy for video when available", async () => {
    const copyFileToClipboard = jest.fn(() => Promise.resolve(true))
    Object.defineProperty(globalThis, "window", {
      value: {
        api: { copyFileToClipboard },
      },
      configurable: true,
    })
    const fetch = jest.fn(() => Promise.reject(new Error("should not fetch")))
    Object.defineProperty(globalThis, "fetch", { value: fetch, configurable: true })

    const result = await copyMediaToClipboard("https://example.com/path/video.mp4", "video")

    expect(result).toBe(true)
    expect(copyFileToClipboard).toHaveBeenCalledWith({
      url: "https://example.com/path/video.mp4",
      filename: "video.mp4",
    })
    expect(fetch).not.toHaveBeenCalled()
  })

  test("falls back to blob and frame copy when Electron native copy fails", async () => {
    const doc = createVideoFrameDocument()
    const copyFileToClipboard = jest.fn(() => Promise.resolve(false))
    Object.defineProperty(globalThis, "window", {
      value: {
        api: { copyFileToClipboard },
      },
      configurable: true,
    })
    Object.defineProperty(globalThis, "document", { value: doc, configurable: true })
    Object.defineProperty(globalThis, "navigator", {
      value: { clipboard: { write: jest.fn(() => Promise.resolve()) } },
      configurable: true,
    })
    Object.defineProperty(globalThis, "fetch", {
      value: jest.fn(() => Promise.resolve({ ok: false })),
      configurable: true,
    })
    Object.defineProperty(globalThis, "ClipboardItem", { value: class ClipboardItem {}, configurable: true })

    const result = await copyMediaToClipboard("https://example.com/video.mp4", "video")

    expect(result).toBe(true)
    expect(copyFileToClipboard).toHaveBeenCalled()
  })
})
