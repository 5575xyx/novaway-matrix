import { describe, expect, test } from "bun:test"
import { PDFDocument, PDFName, StandardFonts } from "pdf-lib"
import { decodeToUnicode, parseToUnicode } from "../../src/office/pdf/to-unicode"
import { readPdfText } from "../../src/office/pdf/engine"

describe("PDF subset-font ToUnicode", () => {
  test("bfchar supports Unicode, ligatures and surrogate pairs", () => {
    const map = parseToUnicode("3 beginbfchar <0001> <4E2D> <0002> <00660069> <0003> <D83DDE00> endbfchar")
    expect(decodeToUnicode(new Uint8Array([0, 1, 0, 2, 0, 3]), map)).toBe("中fi😀")
  })

  test("bfrange supports sequential and array destinations and ignores comments", () => {
    const map = parseToUnicode(`% <ff> <ffff>\n2 beginbfrange
      <01> <03> <0041>
      <04> <05> [<4E2D> <6587>]
      endbfrange`)
    expect(decodeToUnicode(new Uint8Array([1, 2, 3, 4, 5]), map)).toBe("ABC中文")
    expect(map.has("FF")).toBe(false)
  })

  test("invalid or unbounded ranges do not expand; unmapped glyphs stay explicit", () => {
    const map = parseToUnicode("1 beginbfrange <00000000> <7FFFFFFF> <0041> endbfrange")
    expect(map.size).toBe(0)
    expect(decodeToUnicode(new Uint8Array([7]), new Map([["01", "A"]]))).toBe("�")
  })

  test("literal subset glyph bytes are not transcoded through Windows-1252", async () => {
    const doc = await PDFDocument.create()
    const page = doc.addPage()
    const cmap = doc.context.register(doc.context.flateStream("2 beginbfchar <80> <4E2D> <9F> <6587> endbfchar"))
    const font = doc.context.register(
      doc.context.obj({ Type: "Font", Subtype: "Type1", BaseFont: "Subset", ToUnicode: cmap }),
    )
    page.node.set(PDFName.of("Resources"), doc.context.obj({ Font: { F1: font } }))
    const content = doc.context.register(
      doc.context.flateStream(
        Uint8Array.from("BT /F1 12 Tf (\x80\x9F) Tj (\\200\\237) Tj <809F> Tj ET", (char) => char.charCodeAt(0)),
      ),
    )
    page.node.set(PDFName.of("Contents"), content)
    const text = await readPdfText(await doc.save())
    expect(text[0]?.text).toBe("中文中文中文")
  })

  test("Type0 literal strings without a CMap use the same UTF-16BE fallback as hex strings", async () => {
    const doc = await PDFDocument.create()
    const page = doc.addPage()
    const font = doc.context.register(doc.context.obj({ Type: "Font", Subtype: "Type0", BaseFont: "STSong-Light" }))
    page.node.set(PDFName.of("Resources"), doc.context.obj({ Font: { F1: font } }))
    const content = doc.context.register(
      doc.context.flateStream("BT /F1 12 Tf (\\116\\055\\145\\207) Tj <4E2D6587> Tj ET"),
    )
    page.node.set(PDFName.of("Contents"), content)
    const text = await readPdfText(await doc.save())
    expect(text[0]?.text).toBe("中文中文")
  })

  test("WinAnsi fonts decode both literal and hex strings after parsing glyph bytes", async () => {
    const doc = await PDFDocument.create()
    const page = doc.addPage()
    const font = await doc.embedFont(StandardFonts.Helvetica)
    page.drawText("€Ÿ", { font })
    const text = await readPdfText(await doc.save())
    expect(text[0]?.text).toBe("€Ÿ")

    page.node.set(PDFName.of("Resources"), doc.context.obj({ Font: { F1: font.ref } }))
    const content = doc.context.register(
      doc.context.flateStream(Uint8Array.from("BT /F1 12 Tf (\x80\x9F) Tj ET", (char) => char.charCodeAt(0))),
    )
    page.node.set(PDFName.of("Contents"), content)
    expect((await readPdfText(await doc.save()))[0]?.text).toBe("€Ÿ")
  })

  test("real PDF resources resolve compressed CMaps for hex and literal subset text", async () => {
    const doc = await PDFDocument.create()
    const page = doc.addPage()
    const cmap = doc.context.register(
      doc.context.flateStream("3 beginbfchar <01> <0050> <02> <0044> <03> <0046> endbfchar"),
    )
    const font = doc.context.register(
      doc.context.obj({ Type: "Font", Subtype: "Type1", BaseFont: "Subset", ToUnicode: cmap }),
    )
    page.node.set(PDFName.of("Resources"), doc.context.obj({ Font: { F1: font } }))
    const content = doc.context.register(doc.context.flateStream("BT /F1 12 Tf <010203> Tj (\\001\\002\\003) Tj ET"))
    page.node.set(PDFName.of("Contents"), content)
    const text = await readPdfText(await doc.save())
    expect(text[0]?.text).toBe("PDFPDF")
  })
})
