import { beforeEach, describe, expect, mock, test } from "bun:test"
import { copyLocalFileToClipboard, downloadUrlToTempFile } from "./clipboard-file"

const execFileMock = mock((_cmd: string, _args: string[], callback: (err: Error | null) => void) => {
  callback(null)
})

const spawnMock = mock((_cmd: string, _args: string[]) => {
  const handlers: Record<string, Array<(value: unknown) => void>> = {}
  return {
    on: (event: string, handler: (value: unknown) => void) => {
      handlers[event] = handlers[event] || []
      handlers[event].push(handler)
    },
    stdin: {
      write: (_data: string) => undefined,
      end: () => {
        handlers["close"]?.forEach((h) => h(0))
      },
    },
  }
})

mock.module("node:child_process", () => ({
  execFile: execFileMock,
  spawn: spawnMock,
}))

describe("copyLocalFileToClipboard", () => {
  const originalPlatform = process.platform
  const originalWaylandDisplay = process.env.WAYLAND_DISPLAY

  beforeEach(() => {
    execFileMock.mockClear()
    spawnMock.mockClear()
    execFileMock.mockImplementation((_cmd: string, _args: string[], callback: (err: Error | null) => void) => {
      callback(null)
    })
    Object.defineProperty(process, "platform", { value: originalPlatform })
    if (originalWaylandDisplay === undefined) {
      delete process.env.WAYLAND_DISPLAY
    } else {
      process.env.WAYLAND_DISPLAY = originalWaylandDisplay
    }
  })

  test("Windows uses WinForms Clipboard.SetFileDropList", async () => {
    Object.defineProperty(process, "platform", { value: "win32" })

    const result = await copyLocalFileToClipboard("C:\\path\\to\\video.mp4")

    expect(result).toBe(true)
    expect(execFileMock).toHaveBeenCalledTimes(1)
    const [cmd, args] = execFileMock.mock.calls[0]
    expect(cmd).toBe("powershell.exe")
    expect(args).toEqual(["-NoProfile", "-Command", expect.any(String)])
    const psCommand = (args as string[])[2]
    expect(psCommand).toInclude("System.Windows.Forms")
    expect(psCommand).toInclude("SetFileDropList")
    expect(psCommand).toInclude("C:\\path\\to\\video.mp4")
  })

  test("Windows escapes single quotes in path", async () => {
    Object.defineProperty(process, "platform", { value: "win32" })

    await copyLocalFileToClipboard("C:\\path\\to\\video's.mp4")

    const args = execFileMock.mock.calls[0][1] as string[]
    const psCommand = args[2]
    expect(psCommand).toInclude("video''s.mp4")
  })

  test("macOS uses osascript to copy POSIX file", async () => {
    Object.defineProperty(process, "platform", { value: "darwin" })

    const result = await copyLocalFileToClipboard("/path/to/video.mp4")

    expect(result).toBe(true)
    expect(execFileMock).toHaveBeenCalledTimes(1)
    const [cmd, args] = execFileMock.mock.calls[0]
    expect(cmd).toBe("osascript")
    expect(args).toEqual(["-e", "set the clipboard to (POSIX file '/path/to/video.mp4')"])
  })

  test("Linux Wayland uses wl-copy", async () => {
    Object.defineProperty(process, "platform", { value: "linux" })
    process.env.WAYLAND_DISPLAY = "wayland-1"

    const result = await copyLocalFileToClipboard("/path/to/video.mp4")

    expect(result).toBe(true)
    expect(execFileMock).toHaveBeenCalledTimes(2)
    const wlCopyCall = execFileMock.mock.calls.find(([cmd]) => cmd === "wl-copy")
    expect(wlCopyCall).toBeDefined()
    expect(wlCopyCall?.[1]).toEqual(["--type", "text/uri-list", "file:///path/to/video.mp4"])
  })

  test("Linux X11 uses xclip when wl-copy is unavailable", async () => {
    Object.defineProperty(process, "platform", { value: "linux" })
    delete process.env.WAYLAND_DISPLAY

    // 第一次 which wl-copy 失败，第二次 which xclip 成功
    let callCount = 0
    execFileMock.mockImplementation((cmd: string, args: string[], callback: (err: Error | null) => void) => {
      callCount++
      if (cmd === "which" && args[0] === "wl-copy") {
        callback(new Error("not found"))
        return
      }
      callback(null)
    })

    const result = await copyLocalFileToClipboard("/path/to/video.mp4")

    expect(result).toBe(true)
    expect(spawnMock).toHaveBeenCalledTimes(1)
    expect(spawnMock.mock.calls[0]).toEqual([
      "xclip",
      ["-selection", "clipboard", "-target", "x-special/gnome-copied-files", "-i"],
    ])
  })

  test("returns false when no copy tool is available", async () => {
    Object.defineProperty(process, "platform", { value: "linux" })
    delete process.env.WAYLAND_DISPLAY
    execFileMock.mockImplementation((_cmd: string, _args: string[], callback: (err: Error | null) => void) => {
      callback(new Error("not found"))
    })

    const result = await copyLocalFileToClipboard("/path/to/video.mp4")

    expect(result).toBe(false)
  })
})

describe("downloadUrlToTempFile", () => {
  beforeEach(() => {
    mock.module("node:fs/promises", () => ({
      mkdtemp: mock((prefix: string) => Promise.resolve(`${prefix}abc123`)),
      writeFile: mock((_path: string, _data: Buffer) => Promise.resolve()),
    }))
  })

  test("downloads url to temp file", async () => {
    const responseBuffer = Buffer.from("video-bytes")
    globalThis.fetch = mock(() =>
      Promise.resolve({
        ok: true,
        arrayBuffer: () =>
          Promise.resolve(
            responseBuffer.buffer.slice(
              responseBuffer.byteOffset,
              responseBuffer.byteOffset + responseBuffer.byteLength,
            ),
          ),
      }),
    ) as unknown as typeof fetch

    const result = await downloadUrlToTempFile("https://example.com/video.mp4", "video.mp4")

    expect(result).toBeString()
    expect(result).toInclude("NovaWay-clipboard-")
    expect(result).toEndWith(".mp4")
  })

  test("returns null when fetch fails", async () => {
    globalThis.fetch = mock(() => Promise.resolve({ ok: false })) as unknown as typeof fetch

    const result = await downloadUrlToTempFile("https://example.com/video.mp4", "video.mp4")

    expect(result).toBeNull()
  })
})
