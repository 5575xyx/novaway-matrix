import { describe, expect, test } from "bun:test"
import {
  isOfficePreviewFailure,
  officePreviewBase64,
  officePreviewFailure,
  officePreviewFailureTitle,
  readOfficePreview,
  type OfficePreviewErrorCode,
  type OfficePreviewReader,
  type PreviewReadResult,
} from "./office-preview-load"

const CODES: OfficePreviewErrorCode[] = [
  "invalid_path",
  "path_outside_workspace",
  "not_found",
  "unsupported_type",
  "empty",
  "read_failed",
]

const serverReader = (result: PreviewReadResult): OfficePreviewReader => ({
  isExternal: () => false,
  readServer: async () => result,
})

describe("readOfficePreview - success channel", () => {
  test("拿到字节就是字节，不再压成空字符串", async () => {
    const load = await readOfficePreview(serverReader({ data: { content: "UEsDBA==" } }), "output/deck.pptx")
    expect(load).toEqual({ base64: "UEsDBA==" })
    expect(isOfficePreviewFailure(load)).toBe(false)
  })

  test("服务端返回空内容算失败，不算「还在加载」", async () => {
    const load = await readOfficePreview(serverReader({ data: { content: "" } }), "output/empty.pptx")
    expect(load).toEqual({ code: "empty", path: "output/empty.pptx", message: "服务端返回了空内容。" })
  })
})

describe("readOfficePreview - typed server failures", () => {
  test("认识的服务端 code 原样带上来", async () => {
    for (const code of ["invalid_path", "path_outside_workspace", "not_found", "unsupported_type"] as const) {
      const load = await readOfficePreview(
        serverReader({ error: { data: { code, path: "output/deck.pptx", message: "服务端说的话" } } }),
        "output/deck.pptx",
      )
      expect(load).toEqual({ code, path: "output/deck.pptx", message: "服务端说的话" })
    }
  })

  test("不认识的 code 收成 read_failed，不猜", async () => {
    const load = await readOfficePreview(serverReader({ error: { data: { code: "future_code" } } }), "a.pptx")
    if (!isOfficePreviewFailure(load)) throw new Error("expected failure")
    expect(load.code).toBe("read_failed")
    expect(load.path).toBe("a.pptx")
    expect(load.message).not.toBe("")
  })

  test("SDK 不 reject：失败只藏在 error 里，也必须变成失败态", async () => {
    const load = await readOfficePreview(serverReader({ error: { data: {} } }), "output/deck.pptx")
    expect(isOfficePreviewFailure(load)).toBe(true)
  })
})

describe("readOfficePreview - desktop external files", () => {
  test("项目外的文件走宿主通道", async () => {
    const reader: OfficePreviewReader = {
      isExternal: () => true,
      readLocal: async () => "QUJD",
      readServer: async () => ({ data: { content: "NOT_USED" } }),
    }
    expect(await readOfficePreview(reader, "C:/Temp/deck.pptx")).toEqual({ base64: "QUJD" })
  })

  test("宿主读不到 = 文件不在了，说清原因", async () => {
    const reader: OfficePreviewReader = {
      isExternal: () => true,
      readLocal: async () => null,
      readServer: async () => ({ data: { content: "SHU=" } }),
    }
    const load = await readOfficePreview(reader, "C:/Temp/deck.pptx")
    expect(load).toEqual({
      code: "not_found",
      path: "C:/Temp/deck.pptx",
      message: "本地文件读不到，可能已被移动或删除。",
    })
  })

  test("Web 形态没有宿主通道：外部路径仍交给服务端，而不是静默空", async () => {
    const reader: OfficePreviewReader = {
      isExternal: () => true,
      readServer: async () => ({
        error: { data: { code: "path_outside_workspace", path: "/etc/passwd", message: "越界" } },
      }),
    }
    const load = await readOfficePreview(reader, "/etc/passwd")
    expect(load).toEqual({ code: "path_outside_workspace", path: "/etc/passwd", message: "越界" })
  })
})

describe("readOfficePreview - total function", () => {
  test("读取抛异常收成 read_failed，绝不把 reject 漏给渲染树", async () => {
    const reader: OfficePreviewReader = {
      isExternal: () => false,
      readServer: async () => {
        throw new Error("网络断了")
      },
    }
    const load = await readOfficePreview(reader, "output/deck.pptx")
    expect(load).toEqual({ code: "read_failed", path: "output/deck.pptx", message: "网络断了" })
  })
})

describe("预览三态互斥", () => {
  test("失败态没有内容、内容态没有失败", async () => {
    const loaded = await readOfficePreview(serverReader({ error: { data: { code: "not_found" } } }), "a.pptx")
    if (!isOfficePreviewFailure(loaded)) throw new Error("expected failure")
    expect(officePreviewFailure(loaded)).toEqual(loaded)
    expect(officePreviewBase64(loaded)).toBeUndefined()

    const ok = await readOfficePreview(serverReader({ data: { content: "QUJD" } }), "a.pptx")
    expect(officePreviewFailure(ok)).toBeUndefined()
    expect(officePreviewBase64(ok)).toBe("QUJD")
  })

  test("只有没发过请求（undefined）才是加载中", () => {
    expect(officePreviewFailure(undefined)).toBeUndefined()
    expect(officePreviewBase64(undefined)).toBeUndefined()
  })

  test("每种失败 code 都有一句人话标题", () => {
    for (const code of CODES) expect(officePreviewFailureTitle(code).length).toBeGreaterThan(0)
    expect(new Set(CODES.map(officePreviewFailureTitle)).size).toBe(CODES.length)
  })
})
