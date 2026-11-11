import { describe, expect, test } from "bun:test"
import {
  base64ToBytes,
  bytesToBase64,
  documentBytesSha256,
  isEditableDocumentPath,
  officeDocumentCapability,
  sameDocumentBytes,
} from "./office-preview-utils"

describe("office 预览的 base64 编解码", () => {
  test("二进制往返不丢字节（含超过一次 btoa 分块的长度）", () => {
    const bytes = new Uint8Array(0x8000 * 2 + 17)
    for (let index = 0; index < bytes.length; index += 1) bytes[index] = index % 251
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes)
  })

  test("空内容往返仍是空", () => {
    expect(bytesToBase64(new Uint8Array())).toBe("")
    expect(base64ToBytes("")).toEqual(new Uint8Array())
  })
})

describe("Office byte baseline comparison", () => {
  test("matches byte-identical content and detects length or content changes", () => {
    expect(sameDocumentBytes(new Uint8Array([0, 255, 2]), new Uint8Array([0, 255, 2]))).toBe(true)
    expect(sameDocumentBytes(new Uint8Array([0, 255, 2]), new Uint8Array([0, 255]))).toBe(false)
    expect(sameDocumentBytes(new Uint8Array([0, 255, 2]), new Uint8Array([0, 254, 2]))).toBe(false)
  })

  test("creates the standard lowercase SHA-256 version token", async () => {
    expect(await documentBytesSha256(new TextEncoder().encode("abc"))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    )
  })
})

describe("哪些文件由宿主维护撤销栈", () => {
  test("OOXML 正式格式与带宏变体都算：头部的撤销按钮对它们必须可用", () => {
    for (const path of ["a.docx", "a.pptx", "a.xlsx", "a.pdf", "a.docm", "a.xlsm", "a.potx"]) {
      expect(isEditableDocumentPath(path)).toBe(true)
    }
  })

  test("文本类文档同样走宿主历史（CSV / HTML / Markdown / 代码）", () => {
    for (const path of ["a.csv", "a.html", "a.md", "a.txt", "a.json"]) {
      expect(isEditableDocumentPath(path)).toBe(true)
    }
  })

  test("Office 宿主策略：旧格式打开但不伪装成可编辑 OOXML", () => {
    expect(officeDocumentCapability("contract.doc")).toBe("converted-edit")
    expect(officeDocumentCapability("budget.xls")).toBe("converted-edit")
    expect(officeDocumentCapability("deck.ppt")).toBe("converted-edit")
    expect(officeDocumentCapability("notes.rtf")).toBe("converted-edit")
    expect(officeDocumentCapability("writer.odt")).toBe("converted-edit")
    expect(officeDocumentCapability("contract.docx")).toBe("native-edit")
  })

  test("旧格式源路径不直接进入宿主历史：编辑通过现代副本承载", () => {
    for (const path of ["a.doc", "a.xls", "a.ppt", "a.odt", "a.rtf", "a.png", undefined]) {
      expect(isEditableDocumentPath(path)).toBe(false)
    }
  })
})
