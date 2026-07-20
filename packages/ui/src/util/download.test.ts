import { beforeEach, describe, expect, jest, test } from "bun:test"
import { downloadFile, filenameFromUrl } from "./download"

beforeEach(() => {
  delete (globalThis as Partial<typeof globalThis>).document
  delete (globalThis as Partial<typeof globalThis>).window
  delete (globalThis as Partial<typeof globalThis>).fetch
})

describe("download", () => {
  test("uses Electron saveFilePicker when available", async () => {
    const saveFilePicker = jest.fn((_opts?: { defaultPath?: string; data?: Uint8Array }) =>
      Promise.resolve("/home/user/Downloads/image.png"),
    )
    Object.defineProperty(globalThis, "window", {
      value: {
        api: { saveFilePicker },
      },
      configurable: true,
    })
    Object.defineProperty(globalThis, "document", {
      value: { body: { appendChild: jest.fn(), removeChild: jest.fn() } },
      configurable: true,
    })
    Object.defineProperty(globalThis, "fetch", {
      value: jest.fn(() => Promise.resolve({ ok: true, blob: () => Promise.resolve(new Blob(["bytes"])) })),
      configurable: true,
    })

    const result = await downloadFile("https://example.com/image.png", "image.png")

    expect(result).toBe(true)
    expect(saveFilePicker).toHaveBeenCalledTimes(1)
    const opts = saveFilePicker.mock.calls[0][0]
    expect(opts?.defaultPath).toBe("image.png")
    expect(opts?.data).toBeInstanceOf(Uint8Array)
    expect(opts?.data?.length).toBe(5)
  })

  test("returns false when Electron saveFilePicker is canceled", async () => {
    const saveFilePicker = jest.fn(() => Promise.resolve(null))
    Object.defineProperty(globalThis, "window", {
      value: {
        api: { saveFilePicker },
      },
      configurable: true,
    })
    Object.defineProperty(globalThis, "document", {
      value: { body: { appendChild: jest.fn(), removeChild: jest.fn() } },
      configurable: true,
    })
    Object.defineProperty(globalThis, "fetch", {
      value: jest.fn(() => Promise.resolve({ ok: true, blob: () => Promise.resolve(new Blob(["bytes"])) })),
      configurable: true,
    })

    const result = await downloadFile("https://example.com/image.png", "image.png")

    expect(result).toBe(false)
  })

  test("uses showSaveFilePicker when available", async () => {
    const write = jest.fn(() => Promise.resolve())
    const close = jest.fn(() => Promise.resolve())
    const createWritable = jest.fn(() => Promise.resolve({ write, close }))
    const showSaveFilePicker = jest.fn(() => Promise.resolve({ createWritable }))
    Object.defineProperty(globalThis, "window", {
      value: { showSaveFilePicker },
      configurable: true,
    })
    Object.defineProperty(globalThis, "document", {
      value: { body: { appendChild: jest.fn(), removeChild: jest.fn() } },
      configurable: true,
    })
    Object.defineProperty(globalThis, "fetch", {
      value: jest.fn(() => Promise.resolve({ ok: true, blob: () => Promise.resolve(new Blob(["bytes"])) })),
      configurable: true,
    })

    const result = await downloadFile("https://example.com/image.png", "image.png")

    expect(result).toBe(true)
    expect(showSaveFilePicker).toHaveBeenCalledWith({ suggestedName: "image.png" })
    expect(write).toHaveBeenCalled()
    expect(close).toHaveBeenCalled()
  })

  test("falls back to anchor when showSaveFilePicker is unavailable", async () => {
    const link: Record<string, unknown> = {
      href: "",
      download: "",
      target: "",
      rel: "",
      style: {},
    }
    const click = jest.fn()
    link.click = click
    const createElement = jest.fn(() => link)
    const appendChild = jest.fn()
    const removeChild = jest.fn()
    Object.defineProperty(globalThis, "window", {
      value: {},
      configurable: true,
    })
    Object.defineProperty(globalThis, "document", {
      value: {
        createElement,
        body: { appendChild, removeChild },
      },
      configurable: true,
    })

    const result = await downloadFile("https://example.com/image.png", "image.png")

    expect(result).toBe(true)
    expect(createElement).toHaveBeenCalledWith("a")
    expect(link.href).toBe("https://example.com/image.png")
    expect(link.download).toBe("image.png")
    expect(link.target).toBe("_blank")
    expect(click).toHaveBeenCalled()
    expect(appendChild).toHaveBeenCalledWith(link)
    expect(removeChild).toHaveBeenCalledWith(link)
  })

  test("extracts filename from URL", () => {
    expect(filenameFromUrl("https://example.com/path/to/file.png", "fallback.png")).toBe("file.png")
    expect(filenameFromUrl("https://example.com/no-extension", "fallback.png")).toBe("fallback.png")
  })
})
