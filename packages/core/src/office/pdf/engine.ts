/**
 * PDF 引擎：页面级编辑、叠加内容、批注和表单填写。
 *
 * 只做 PDF 编辑里**能安全做到**的那一半：
 *   - 页面：删除 / 调序 / 旋转 / 插入空白页 / 裁切；
 *   - 叠加：文字、图片（作为页面内容流的新增部分，不破坏原有内容）；
 *   - 原地改：内容流里完整的文字 run（字体 / 坐标沿用原值）、整张图片换掉；
 *   - 批注：高亮 / 下划线 / 波浪线 / 删除线 / 便签 / 文本框 / 形状（标准 PDF 注解）；
 *   - 表单：填写 AcroForm 字段。
 *
 * 跨 run 或复合字体拼出来的文字仍然改不了：PDF 没有段落模型，这时请用叠加 + 批注，
 * 或者回到源文档（docx/md）去改。
 *
 * 解析/写回交给 pdf-lib（MIT）：它负责对象表、增量更新和交叉引用表，
 * 我们只做「改哪一页、加什么」这一层，和 docx/pptx 的外科手术哲学一致。
 */
import {
  decodePDFRawStream,
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  PDFString,
  StandardFonts,
  degrees,
  rgb,
} from "pdf-lib"
import { drawCjkLines, drawCjkTitle, needsCjk } from "./cjk-font"
import { decryptPdf, isEncryptedPdf, type PdfProtection } from "./decrypt"
import { replacePageText } from "./text-edit"
import { setPageImageBox, findImagePlacement, pageImages } from "./image-box"
import { pageTexts } from "./text-read"
import type {
  ApplyOutcome,
  OfficeEngine,
  OfficeEngineOptions,
  OfficeError,
  OfficeOp,
  OfficeResult,
} from "../engine/contract"
import { fail, ok } from "../engine/contract"

export type PdfPageImage = {
  /** 这一页上的序号，1 起（setPageImageBox 的 index）。 */
  index: number
  /** 左上角原点的框（pt）。 */
  x: number
  y: number
  width: number
  height: number
  /** 顺时针角度。 */
  rotation: number
}

export type PdfPageInfo = {
  /** 1 起。 */
  page: number
  /** pt。 */
  width: number
  height: number
  rotation: number
  /** 页面上画出来的图片；找不到（内容流损坏等）时为空数组。 */
  images: PdfPageImage[]
}

export type PdfFormField = {
  name: string
  kind: "text" | "checkbox" | "dropdown" | "radio" | "list" | "other"
  value?: string | boolean
}

export type PdfState = {
  pages: PdfPageInfo[]
  fields: PdfFormField[]
  /** 打开时是否解过密码；编辑后另存的是未加密文件。 */
  encrypted?: boolean
  protection?: PdfProtection
}

/** 读取 PDF 时的错误；带引擎错误码，CLI / 工具可以直接沿用。 */
export class PdfOpenError extends Error {
  constructor(
    readonly code: OfficeError["code"],
    message: string,
    readonly suggestion?: string,
  ) {
    super(message)
  }
}

type LoadedPdf = {
  doc: PDFDocument
  /** 解密后的字节（原文件未加密时就是传入的字节）。 */
  bytes: Uint8Array
  encrypted: boolean
  protection?: PdfProtection
}

/**
 * 统一的打开入口：先解密码，再交给 pdf-lib。
 *
 * pdf-lib 自己不解密，所以加密文件在这里换成一份等价的未加密字节；
 * 之后所有解析 / 写回都走同一条路。
 */
export async function openPdfBytes(bytes: Uint8Array, password?: string): Promise<OfficeResult<LoadedPdf>> {
  let plain = bytes
  let encrypted = false
  let protection: PdfProtection | undefined
  if (isEncryptedPdf(bytes)) {
    const unlocked = await decryptPdf(bytes, password)
    if (!unlocked.ok) {
      if (unlocked.reason === "password_required" || unlocked.reason === "invalid_password") {
        return fail("password_required", unlocked.message, unlocked.suggestion)
      }
      return fail("open_failed", unlocked.message, unlocked.suggestion)
    }
    plain = unlocked.bytes
    encrypted = unlocked.encrypted
    protection = unlocked.protection
  }
  try {
    const doc = await PDFDocument.load(plain, { updateMetadata: false })
    return ok({ doc, bytes: plain, encrypted, protection })
  } catch (error) {
    return fail("open_failed", "无法解析 PDF：" + (error instanceof Error ? error.message : String(error)))
  }
}

/** 把 OfficeResult 的失败转成异常，给那些返回值不是 Result 的只读函数用。 */
function throwPdfError(error: OfficeError): never {
  throw new PdfOpenError(error.code, error.message, error.suggestion)
}

function decodeBase64(value: string): Uint8Array | undefined {
  const body = value.startsWith("data:") && value.includes(",") ? value.slice(value.indexOf(",") + 1) : value
  try {
    const binary = atob(body.replace(/\s+/g, ""))
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
    return bytes
  } catch {
    return undefined
  }
}

function hexColor(value: string | undefined, fallback: readonly number[] = [0, 0, 0]) {
  const text = (value ?? "").replace(/^#/, "")
  if (!/^[0-9a-fA-F]{6}$/.test(text)) return rgb(fallback[0]!, fallback[1]!, fallback[2]!)
  return rgb(
    Number.parseInt(text.slice(0, 2), 16) / 255,
    Number.parseInt(text.slice(2, 4), 16) / 255,
    Number.parseInt(text.slice(4, 6), 16) / 255,
  )
}

async function readState(doc: PDFDocument): Promise<PdfState> {
  const pages = doc.getPages().map((page, index) => {
    const images: PdfPageImage[] = []
    try {
      // 序号和资源表顺序一致：客户端看到的第 N 张就是这里能改的第 N 张。
      pageImages(doc, index).forEach((_image, order) => {
        const placement = findImagePlacement(doc, index, order + 1)
        if (!placement) return
        images.push({
          index: order + 1,
          x: Math.round(placement.box.x * 100) / 100,
          y: Math.round(placement.box.y * 100) / 100,
          width: Math.round(placement.box.w * 100) / 100,
          height: Math.round(placement.box.h * 100) / 100,
          rotation: placement.rotation,
        })
      })
    } catch {
      // 内容流解析失败不影响页面列表本身。
    }
    return {
      page: index + 1,
      width: page.getWidth(),
      height: page.getHeight(),
      rotation: page.getRotation().angle,
      images,
    }
  })
  const fields: PdfFormField[] = []
  try {
    for (const field of doc.getForm().getFields()) {
      const name = field.getName()
      const constructor = field.constructor.name
      if (constructor === "PDFTextField") {
        fields.push({ name, kind: "text", value: (field as unknown as { getText(): string | undefined }).getText() })
      } else if (constructor === "PDFCheckBox") {
        fields.push({ name, kind: "checkbox", value: (field as unknown as { isChecked(): boolean }).isChecked() })
      } else if (constructor === "PDFDropdown") {
        fields.push({
          name,
          kind: "dropdown",
          value: (field as unknown as { getSelected(): string[] }).getSelected()[0],
        })
      } else if (constructor === "PDFRadioGroup") {
        fields.push({
          name,
          kind: "radio",
          value: (field as unknown as { getSelected(): string | undefined }).getSelected(),
        })
      } else if (constructor === "PDFOptionList") {
        fields.push({
          name,
          kind: "list",
          value: (field as unknown as { getSelected(): string[] }).getSelected()[0],
        })
      } else {
        fields.push({ name, kind: "other" })
      }
    }
  } catch {
    // 没有 AcroForm / 表单损坏：不影响页面编辑。
  }
  return { pages, fields }
}

const A4 = { width: 595.28, height: 841.89 }

function pageOf(doc: PDFDocument, page: number) {
  if (!Number.isInteger(page) || page < 1 || page > doc.getPageCount()) return undefined
  return doc.getPage(page - 1)
}

function markupSubtype(kind: string): string | undefined {
  if (kind === "highlight") return "Highlight"
  if (kind === "underline") return "Underline"
  if (kind === "squiggly") return "Squiggly"
  if (kind === "strikeOut") return "StrikeOut"
  if (kind === "note") return "Text"
  // 文本框批注和形状批注（markup / text box / shapes）。
  if (kind === "text") return "FreeText"
  if (kind === "square" || kind === "rectangle") return "Square"
  if (kind === "circle" || kind === "ellipse") return "Circle"
  if (kind === "line") return "Line"
  return undefined
}

/** 找到 /NM（注解名）等于 id 的注解引用，供回复用。 */
function findAnnotByName(doc: PDFDocument, page: ReturnType<typeof pageOf>, name: string) {
  if (!page) return undefined
  const annots = page.node.Annots()
  if (!annots) return undefined
  for (const ref of annots.asArray()) {
    const entry = doc.context.lookup(ref)
    if (!entry || typeof entry !== "object" || !("get" in entry)) continue
    const dict = entry as PDFDict
    const value = dict.get(PDFName.of("NM"))
    if (value instanceof PDFString && value.decodeText() === name) return ref
  }
  return undefined
}

async function applyOps(doc: PDFDocument, ops: readonly OfficeOp[]): Promise<OfficeResult<string[]>> {
  const applied: string[] = []
  let font: Awaited<ReturnType<PDFDocument["embedFont"]>> | undefined

  for (const op of ops) {
    switch (op.op) {
      case "deletePage": {
        if (doc.getPageCount() <= 1) return fail("invalid_params", "至少要保留一页")
        if (!pageOf(doc, op.page)) return fail("not_found", "没有第 " + op.page + " 页")
        doc.removePage(op.page - 1)
        applied.push("删除第 " + op.page + " 页")
        break
      }
      case "movePage": {
        if (!pageOf(doc, op.from) || !pageOf(doc, op.to)) {
          return fail("not_found", "页码超出范围（共 " + doc.getPageCount() + " 页）")
        }
        // pdf-lib 的 removePage 不返回页面对象：先拿住引用再挪。
        const page = doc.getPage(op.from - 1)
        doc.removePage(op.from - 1)
        doc.insertPage(op.to - 1, page)
        applied.push("第 " + op.from + " 页挪到第 " + op.to + " 页")
        break
      }
      case "rotatePage": {
        const page = pageOf(doc, op.page)
        if (!page) return fail("not_found", "没有第 " + op.page + " 页")
        if (op.degrees % 90 !== 0) return fail("invalid_params", "旋转角度必须是 90 的倍数")
        page.setRotation(degrees(((op.degrees % 360) + 360) % 360))
        applied.push("第 " + op.page + " 页旋转 " + op.degrees + "°")
        break
      }
      case "insertBlankPage": {
        if (!Number.isInteger(op.after) || op.after < 0 || op.after > doc.getPageCount()) {
          return fail("invalid_params", "after 必须在 0 到 " + doc.getPageCount() + " 之间")
        }
        const neighbor = op.after > 0 ? doc.getPage(op.after - 1) : doc.getPage(0)
        const width = op.width ?? neighbor?.getWidth() ?? A4.width
        const height = op.height ?? neighbor?.getHeight() ?? A4.height
        doc.insertPage(op.after, [width, height])
        applied.push("插入空白页（第 " + (op.after + 1) + " 页）")
        break
      }
      case "insertPdfPages": {
        if (!Number.isInteger(op.after) || op.after < 0 || op.after > doc.getPageCount()) {
          return fail("invalid_params", "after 必须在 0 到 " + doc.getPageCount() + " 之间")
        }
        const data = decodeBase64(op.dataBase64)
        if (!data) return fail("invalid_params", "插入页面需要源 PDF 的 dataBase64")
        let source: PDFDocument
        try {
          source = await PDFDocument.load(data, { updateMetadata: false })
        } catch (error) {
          return fail(
            "invalid_params",
            "源文件不是可解析的 PDF：" + (error instanceof Error ? error.message : String(error)),
            "先用 info 确认源文件是 PDF，加密文件要先去掉密码",
          )
        }
        const total = source.getPageCount()
        if (total === 0) return fail("invalid_params", "源 PDF 没有页面")
        const picked = op.pages?.length ? op.pages : Array.from({ length: total }, (_item, index) => index + 1)
        for (const page of picked) {
          if (!Number.isInteger(page) || page < 1 || page > total) {
            return fail("not_found", "源 PDF 没有第 " + page + " 页（共 " + total + " 页）")
          }
        }
        const copied = await doc.copyPages(
          source,
          picked.map((page) => page - 1),
        )
        copied.forEach((page, index) => doc.insertPage(op.after + index, page))
        applied.push("在第 " + op.after + " 页后插入 " + copied.length + " 页（来自源 PDF）")
        break
      }
      case "addPageText": {
        const page = pageOf(doc, op.page)
        if (!page) return fail("not_found", "没有第 " + op.page + " 页")
        const size = op.size ?? 14
        const color = hexColor(op.color)
        try {
          if (needsCjk(op.text)) {
            // 中文走预定义 CID 字体（STSong-Light / Adobe-GB1），不再直接拒绝。
            drawCjkLines(page, doc, {
              text: op.text,
              x: op.x,
              top: op.y,
              size,
              ...(op.color ? { color: op.color } : {}),
            })
          } else {
            font ??= await doc.embedFont(StandardFonts.Helvetica)
            const lines = op.text.split("\n")
            lines.forEach((line, index) => {
              const y = page.getHeight() - op.y - size - index * size * 1.25
              page.drawText(line, { x: op.x, y, size, font: font!, color })
            })
          }
        } catch {
          return fail(
            "unsupported_format",
            "PDF 叠加文字失败：这段内容没能写进页面",
            "可以改用批注，或在源文档（docx / Markdown）里改完再导出 PDF",
          )
        }
        applied.push("第 " + op.page + " 页加文字")
        break
      }
      case "replacePageText": {
        const page = pageOf(doc, op.page)
        if (!page) return fail("not_found", "没有第 " + op.page + " 页")
        if (!op.find) return fail("invalid_params", "要替换的文字不能为空")
        let count = 0
        try {
          count = replacePageText(doc, op.page - 1, op.find, op.replace, op.all ?? false)
        } catch (error) {
          return fail("engine", error instanceof Error ? error.message : "PDF 文字替换失败")
        }
        if (count === 0) {
          return fail(
            "not_found",
            "这一页没有找到要替换的文字：" + op.find,
            "文字可能被拆成多个 run，或使用了复合字体；可以改用 addPageText 叠加，或回到源文档修改后重新导出",
          )
        }
        applied.push("第 " + op.page + " 页替换文字 " + count + " 处")
        break
      }
      case "replacePageImage": {
        const page = pageOf(doc, op.page)
        if (!page) return fail("not_found", "没有第 " + op.page + " 页")
        const data = decodeBase64(op.dataBase64)
        if (!data || data.length === 0) return fail("invalid_params", "图片数据不是合法的 base64")
        const mime = op.mime.toLowerCase()
        let image
        try {
          if (mime === "image/png") image = await doc.embedPng(data)
          else if (mime === "image/jpeg" || mime === "image/jpg") image = await doc.embedJpg(data)
          else return fail("unsupported_format", "PDF 换图片只支持 PNG / JPEG")
        } catch {
          return fail("invalid_params", "图片数据损坏，无法嵌入")
        }
        const entries = pageImageEntries(doc, page)
        const index = op.index ?? 1
        const target = entries[index - 1]
        if (!target) {
          return fail("not_found", "第 " + op.page + " 页没有第 " + index + " 张图片（共 " + entries.length + " 张）")
        }
        // embed 是懒的：不先落进对象表，lookup(image.ref) 还是空的。
        await image.embed()
        // 把新图像的流写进原来的对象槽位：内容流里引用它的画法、位置、缩放都不用动。
        const replacement = doc.context.lookup(image.ref)
        if (!replacement) return fail("engine", "新图片对象未注册")
        doc.context.assign(target.ref, replacement)
        applied.push("第 " + op.page + " 页换掉第 " + index + " 张图片")
        break
      }
      case "setPageImageBox": {
        const page = pageOf(doc, op.page)
        if (!page) return fail("not_found", "没有第 " + op.page + " 页")
        const moved = setPageImageBox(doc, op.page - 1, op)
        if (!moved) {
          return fail(
            "not_found",
            "第 " + op.page + " 页没有第 " + (op.index ?? 1) + " 张可调整的图片",
            "先用 view / get /page[N] 看这一页的图片序号，或确认图片不是画在表单 XObject 里",
          )
        }
        applied.push(
          "第 " +
            op.page +
            " 页第 " +
            (op.index ?? 1) +
            " 张图片 → " +
            Math.round(moved.box.x) +
            "," +
            Math.round(moved.box.y) +
            " " +
            Math.round(moved.box.w) +
            "×" +
            Math.round(moved.box.h) +
            " @ " +
            moved.rotation +
            "°",
        )
        break
      }
      case "addPageImage": {
        const page = pageOf(doc, op.page)
        if (!page) return fail("not_found", "没有第 " + op.page + " 页")
        const data = decodeBase64(op.dataBase64)
        if (!data || data.length === 0) return fail("invalid_params", "图片数据不是合法的 base64")
        const mime = op.mime.toLowerCase()
        let image
        try {
          if (mime === "image/png") image = await doc.embedPng(data)
          else if (mime === "image/jpeg" || mime === "image/jpg") image = await doc.embedJpg(data)
          else return fail("unsupported_format", "PDF 叠加图片只支持 PNG / JPEG")
        } catch {
          return fail("invalid_params", "图片数据损坏，无法嵌入")
        }
        page.drawImage(image, {
          x: op.x,
          y: page.getHeight() - op.y - op.height,
          width: op.width,
          height: op.height,
        })
        applied.push("第 " + op.page + " 页加图片")
        break
      }
      case "annotatePage": {
        const page = pageOf(doc, op.page)
        if (!page) return fail("not_found", "没有第 " + op.page + " 页")
        const subtype = markupSubtype(op.kind)
        if (!subtype) return fail("invalid_params", "不支持的批注类型：" + op.kind)
        const height = page.getHeight()
        const x1 = op.x
        const x2 = op.x + op.width
        const y2 = height - op.y
        const y1 = y2 - op.height
        const color = hexColor(op.color, [1, 0.86, 0.16])
        const replyTo = op.replyTo ? findAnnotByName(doc, page, op.replyTo) : undefined
        if (op.replyTo && !replyTo) return fail("not_found", "找不到要回复的批注：" + op.replyTo)
        const appearance = op.kind === "text" ? (op.fontSize ?? 12) : undefined
        const annot = doc.context.obj({
          Type: "Annot",
          Subtype: subtype,
          Rect: [x1, y1, x2, y2],
          C: [color.red, color.green, color.blue],
          F: 4,
          P: page.ref,
          ...(op.contents ? { Contents: PDFString.of(op.contents) } : {}),
          ...(op.id ? { NM: PDFString.of(op.id) } : {}),
          ...(replyTo ? { IRT: replyTo, RT: PDFName.of("R") } : {}),
          ...(op.kind === "note" ? { Name: "Comment", Open: false } : {}),
          ...(appearance !== undefined ? { DA: PDFString.of("/Helv " + appearance + " Tf 0 g"), Q: 0 } : {}),
          ...(op.kind === "line"
            ? { L: [x1, y2, x2, y1], LE: [PDFName.of("None"), PDFName.of("None")], BS: { W: 2 } }
            : op.kind === "note"
              ? {}
              : op.kind === "text" || op.kind === "square" || op.kind === "circle"
                ? { BS: { W: 1 } }
                : { QuadPoints: [x1, y2, x2, y2, x1, y1, x2, y1], CA: 0.5 }),
        })
        const ref = doc.context.register(annot)
        // 已有注解要保留：新注解追加到 Annots 数组末尾。
        const annots = page.node.Annots()
        const array = annots ? [...annots.asArray()] : []
        array.push(ref)
        page.node.set(PDFName.of("Annots"), doc.context.obj(array as never))
        applied.push("第 " + op.page + " 页加批注（" + op.kind + "）")
        break
      }
      case "cropPage": {
        const page = pageOf(doc, op.page)
        if (!page) return fail("not_found", "没有第 " + op.page + " 页")
        const box = page.getCropBox()
        const left = box.x + (op.left ?? 0)
        const bottom = box.y + (op.bottom ?? 0)
        const width = box.width - (op.left ?? 0) - (op.right ?? 0)
        const height = box.height - (op.bottom ?? 0) - (op.top ?? 0)
        if (width <= 0 || height <= 0) {
          return fail("invalid_params", "裁切后页面为空：四边之和不能超过页面尺寸")
        }
        page.setCropBox(left, bottom, width, height)
        applied.push("第 " + op.page + " 页裁切")
        break
      }
      case "fillForm": {
        const form = doc.getForm()
        for (const field of op.fields) {
          let target
          try {
            target = form.getField(field.name)
          } catch {
            return fail("not_found", "表单里没有字段：" + field.name)
          }
          const kind = target.constructor.name
          try {
            if (kind === "PDFTextField" && typeof field.value === "string") {
              ;(target as unknown as { setText(value: string): void }).setText(field.value)
            } else if (kind === "PDFCheckBox") {
              const box = target as unknown as { check(): void; uncheck(): void }
              if (field.value === true || field.value === "true") box.check()
              else box.uncheck()
            } else if (kind === "PDFDropdown" || kind === "PDFRadioGroup" || kind === "PDFOptionList") {
              if (typeof field.value !== "string") return fail("invalid_params", field.name + " 需要一个字符串值")
              ;(target as unknown as { select(value: string): void }).select(field.value)
            } else {
              return fail("unsupported_format", "不支持的字段类型：" + field.name + "（" + kind + "）")
            }
          } catch (error) {
            return fail(
              "invalid_params",
              field.name + " 填写失败：" + (error instanceof Error ? error.message : String(error)),
            )
          }
        }
        try {
          form.updateFieldAppearances(await doc.embedFont(StandardFonts.Helvetica))
        } catch {
          // 中文字段值没法用标准字体生成外观，值仍然写进了表单。
        }
        applied.push("填写 " + op.fields.length + " 个表单字段")
        break
      }
      default:
        return fail("unsupported_format", op.op + " 不适用于 PDF")
    }
  }
  return ok(applied)
}

export const pdfEngine: OfficeEngine<PdfState> = {
  format: "pdf",

  async open(bytes, options?: OfficeEngineOptions) {
    const loaded = await openPdfBytes(bytes, options?.password)
    if (!loaded.ok) return loaded
    return ok({
      ...(await readState(loaded.data.doc)),
      ...(loaded.data.encrypted ? { encrypted: true } : {}),
      ...(loaded.data.protection ? { protection: loaded.data.protection } : {}),
    })
  },

  async apply(state, ops, bytes, options?: OfficeEngineOptions) {
    if (ops.length === 0) return fail("invalid_params", "没有要执行的页面操作")
    try {
      const loaded = await openPdfBytes(bytes, options?.password)
      if (!loaded.ok) return loaded
      const doc = loaded.data.doc
      const applied = await applyOps(doc, ops)
      if (!applied.ok) return applied
      if (applied.data.length === 0) return fail("invalid_params", "没有要执行的页面操作")
      // 写回的是解密后的普通 PDF：另存即等于「去掉密码保护」。
      const saved = await doc.save({ useObjectStreams: false })
      const next = new Uint8Array(saved)
      const reopened = await pdfEngine.open(next)
      if (!reopened.ok) return reopened
      const outcome: ApplyOutcome<PdfState> = {
        state: reopened.data,
        bytes: next,
        changed: ["pdf"],
        applied: applied.data.map((label) => ({ op: label })),
      }
      return ok(outcome)
    } catch (error) {
      return fail("engine", error instanceof Error ? error.message : "PDF 写入失败")
    }
  },

  /** PDF 是最终产物，不能再导出成另一种文本文档；页面提取用打印 / 另存实现。 */
  /**
   * PDF → PDF 就是「另存为」：字节原样复制，一个字都不重排。
   * 提取页面 / 拆分走 CLI 的 --pages、split（那里换了页面树）。
   */
  async export(_state, target, bytes) {
    const kind = target.toLowerCase().replace(/^\./, "")
    if (kind === "pdf") return ok(bytes)
    return fail("unsupported_format", "PDF 不能导出成 " + target, "PDF 只支持另存为 pdf；提取页面用 --pages 或 split")
  },
}

/**
 * 读 PDF 每页的文字（1 起页码）。解析不了（加密 / 内容流损坏）时明确报错，
 * 不返回空数组糊弄调用方。
 */
export async function readPdfText(
  bytes: Uint8Array,
  pages?: readonly number[],
  password?: string,
): Promise<Array<{ page: number; text: string }>> {
  const loaded = await openPdfBytes(bytes, password)
  if (!loaded.ok) throwPdfError(loaded.error)
  return pageTexts(loaded.data.doc, pages)
}

/** 单页文字；页面不存在时返回 undefined。 */
export async function readPdfPageText(bytes: Uint8Array, page: number, password?: string): Promise<string | undefined> {
  const found = await readPdfText(bytes, [page], password)
  return found[0]?.text
}

/**
 * 提取页面：把指定页（1 起）复制成一个新的 PDF。
 *
 * 只复制页面对象（内容流和它引用的资源会跟着拷贝），不重新绘制，
 * 所以原文件的排版、字体、图片都保持不变。页序按传入顺序。
 */
/**
 * 新建一份 PDF：默认一页 A4，标题居中、正文按行排在下面。
 *
 * 中文标题 / 正文走 PDF 的预定义 CJK 字体（见 ./cjk-font），不再退回空白页；
 * 只有字体对象都无法构造时才留一张空白 A4 —— 至少是一份合法文件。
 */
export async function createPdf(options: { title?: string; body?: string } = {}): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const page = doc.addPage([A4.width, A4.height])
  const title = options.title?.trim() ?? ""
  const body = options.body?.trim() ?? ""
  const cjk = needsCjk(title) || needsCjk(body)
  let y = A4.height - 96
  try {
    if (cjk) {
      // 中文走预定义 CID 字体：不嵌字体，但 Acrobat / WPS / 系统阅读器都能显示。
      if (title) {
        drawCjkTitle(page, doc, { text: title, size: 22, color: "1A1C26" })
        y -= 40
      }
      if (body) drawCjkLines(page, doc, { text: body, x: 64, top: 136, size: 12, color: "333640" })
      return doc.save()
    }
    const font = await doc.embedFont(StandardFonts.Helvetica)
    const bold = await doc.embedFont(StandardFonts.HelveticaBold)
    if (title) {
      const size = 22
      const width = bold.widthOfTextAtSize(title, size)
      page.drawText(title, {
        x: Math.max(48, (A4.width - width) / 2),
        y,
        size,
        font: bold,
        color: rgb(0.1, 0.11, 0.15),
      })
      y -= 40
    }
    if (body) {
      const size = 12
      for (const line of body.split(String.fromCharCode(10))) {
        if (y < 64) break
        if (line.trim() !== "") page.drawText(line, { x: 64, y, size, font, color: rgb(0.2, 0.21, 0.25) })
        y -= size * 1.6
      }
    }
  } catch {
    // 字体对象构造失败也不写坏文件：留一张空白 A4，至少是合法 PDF。
  }
  return doc.save()
}

export async function extractPdfPages(
  bytes: Uint8Array,
  pages: readonly number[],
  password?: string,
): Promise<Uint8Array> {
  const loaded = await openPdfBytes(bytes, password)
  if (!loaded.ok) throwPdfError(loaded.error)
  const source = loaded.data.doc
  const total = source.getPageCount()
  const wanted = pages.filter((page) => Number.isInteger(page) && page >= 1 && page <= total)
  if (wanted.length === 0) throw new Error("没有可提取的页（页码从 1 开始）")
  const target = await PDFDocument.create()
  for (const page of wanted) {
    const [copied] = await target.copyPages(source, [page - 1])
    if (copied) target.addPage(copied)
  }
  return new Uint8Array(await target.save({ useObjectStreams: false }))
}

/** 按每份 size 页切分；最后一份可以不足 size 页。 */
export async function splitPdfPages(bytes: Uint8Array, size: number, password?: string): Promise<Uint8Array[]> {
  if (!Number.isInteger(size) || size < 1) throw new Error("每份页数必须是正整数")
  const loaded = await openPdfBytes(bytes, password)
  if (!loaded.ok) throwPdfError(loaded.error)
  const total = loaded.data.doc.getPageCount()
  const parts: Uint8Array[] = []
  for (let start = 1; start <= total; start += size) {
    const end = Math.min(total, start + size - 1)
    const pages = Array.from({ length: end - start + 1 }, (_, index) => start + index)
    parts.push(await extractPdfPages(bytes, pages, password))
  }
  return parts
}

/**
 * 合并多份 PDF：按传入顺序把所有页面接起来，各页原样复制。
 * 和 split 互为逆操作；源文件只读，结果写到哪里由调用方决定。
 */
export async function mergePdfPages(sources: readonly Uint8Array[], password?: string): Promise<Uint8Array> {
  if (sources.length === 0) throw new Error("合并至少需要一份 PDF")
  const target = await PDFDocument.create()
  for (const [index, bytes] of sources.entries()) {
    const loaded = await openPdfBytes(bytes, password)
    if (!loaded.ok) {
      throw new PdfOpenError(
        loaded.error.code,
        "第 " + (index + 1) + " 份：" + loaded.error.message,
        loaded.error.suggestion,
      )
    }
    const source = loaded.data.doc
    const copied = await target.copyPages(
      source,
      source.getPages().map((_page, pageIndex) => pageIndex),
    )
    for (const page of copied) target.addPage(page)
  }
  return new Uint8Array(await target.save({ useObjectStreams: false }))
}

// ---------------------------------------------------------------------------
// 图片提取
//
// 页面里的图片是 XObject 图像流：JPEG（DCTDecode）可以原样带走，
// Flate 压缩的像素还原成 RGBA 再编成 PNG。两者都只读，不改原文件。
// ---------------------------------------------------------------------------

export type PdfImage = {
  /** 1 起。 */
  page: number
  /** 在这一页上的序号，1 起。 */
  index: number
  mime: "image/jpeg" | "image/png" | "image/jp2"
  data: Uint8Array
  width: number
  height: number
}

/** 这一页资源里所有图像 XObject 的引用（按资源表顺序，1 起就是客户端看到的序号）。 */
function pageImageEntries(doc: PDFDocument, page: ReturnType<typeof pageOf>) {
  if (!page) return []
  const resources = page.node.Resources()
  if (!resources) return []
  const xobjects = resources.lookup(PDFName.of("XObject"), PDFDict)
  if (!xobjects) return []
  const found: Array<{ ref: PDFRef; width: number; height: number }> = []
  for (const [, value] of xobjects.entries()) {
    if (!(value instanceof PDFRef)) continue
    const stream = doc.context.lookup(value)
    if (!(stream instanceof PDFRawStream)) continue
    if (nameOf(stream.dict.get(PDFName.of("Subtype"))) !== "/Image") continue
    const width = Number(stream.dict.get(PDFName.of("Width"))?.toString() ?? 0)
    const height = Number(stream.dict.get(PDFName.of("Height"))?.toString() ?? 0)
    if (width <= 0 || height <= 0) continue
    found.push({ ref: value, width, height })
  }
  return found
}

function nameOf(value: unknown): string | undefined {
  return value instanceof PDFName ? value.asString() : undefined
}

/** /ColorSpace 的名字，或 ICCBased 数组里的分量数。 */
function colorSpaceOf(dict: PDFDict, doc: PDFDocument): { kind: "rgb" | "gray" } | undefined {
  const value = dict.get(PDFName.of("ColorSpace"))
  const name = nameOf(value)
  if (name === "/DeviceRGB") return { kind: "rgb" }
  if (name === "/DeviceGray") return { kind: "gray" }
  if (value instanceof PDFArray) {
    const first = nameOf(doc.context.lookup(value.get(0)))
    if (first === "/DeviceRGB") return { kind: "rgb" }
    if (first === "/DeviceGray") return { kind: "gray" }
    if (first === "/ICCBased") {
      const profile = doc.context.lookup(value.get(1))
      const count =
        profile && typeof profile === "object" && "get" in profile
          ? Number((profile as PDFDict).get(PDFName.of("N"))?.toString() ?? 0)
          : 0
      if (count === 3) return { kind: "rgb" }
      if (count === 1) return { kind: "gray" }
    }
  }
  return undefined
}

function toRgba(pixels: Uint8Array, count: number, mask: Uint8Array | undefined, kind: "rgb" | "gray"): Uint8Array {
  const out = new Uint8Array(count * 4)
  for (let index = 0; index < count; index += 1) {
    if (kind === "rgb") {
      out[index * 4] = pixels[index * 3] ?? 0
      out[index * 4 + 1] = pixels[index * 3 + 1] ?? 0
      out[index * 4 + 2] = pixels[index * 3 + 2] ?? 0
    } else {
      const value = pixels[index] ?? 0
      out[index * 4] = value
      out[index * 4 + 1] = value
      out[index * 4 + 2] = value
    }
    out[index * 4 + 3] = mask ? (mask[index] ?? 255) : 255
  }
  return out
}

/**
 * 提取 PDF 里的图片。
 *
 * `pages` 省略时提取全部页；返回的每个条目都能直接写成 .jpg / .png 文件。
 * 只处理嵌入图像流，不渲染页面（结果是原图，不是截图）。
 */
export async function extractPdfImages(
  bytes: Uint8Array,
  pages?: readonly number[],
  password?: string,
): Promise<PdfImage[]> {
  const { default: UPNG } = await import("@pdf-lib/upng")
  const loaded = await openPdfBytes(bytes, password)
  if (!loaded.ok) throwPdfError(loaded.error)
  const doc = loaded.data.doc
  const total = doc.getPageCount()
  const wanted = pages?.length
    ? pages.filter((page) => page >= 1 && page <= total)
    : Array.from({ length: total }, (_, i) => i + 1)
  const images: PdfImage[] = []

  for (const pageNumber of wanted) {
    const page = doc.getPage(pageNumber - 1)
    const resources = page.node.Resources()
    if (!resources) continue
    const xobjects = resources.lookup(PDFName.of("XObject"), PDFDict)
    if (!xobjects) continue
    let index = 0
    for (const [, ref] of xobjects.entries()) {
      const stream = doc.context.lookup(ref)
      if (!(stream instanceof PDFRawStream)) continue
      const dict = stream.dict
      if (nameOf(dict.get(PDFName.of("Subtype"))) !== "/Image") continue
      const width = Number(dict.get(PDFName.of("Width"))?.toString() ?? 0)
      const height = Number(dict.get(PDFName.of("Height"))?.toString() ?? 0)
      if (width <= 0 || height <= 0) continue
      index += 1

      const filterValue = dict.get(PDFName.of("Filter"))
      const filters = [
        nameOf(filterValue) ?? (filterValue instanceof PDFArray ? nameOf(filterValue.get(0)) : undefined),
      ]
      if (filters.includes("/DCTDecode")) {
        images.push({ page: pageNumber, index, mime: "image/jpeg", data: stream.contents, width, height })
        continue
      }
      if (filters.includes("/JPXDecode")) {
        images.push({ page: pageNumber, index, mime: "image/jp2", data: stream.contents, width, height })
        continue
      }

      const kind = colorSpaceOf(dict, doc)
      const bits = Number(dict.get(PDFName.of("BitsPerComponent"))?.toString() ?? 8)
      if (!kind || bits !== 8) continue

      let pixels: Uint8Array
      try {
        pixels = decodePDFRawStream(stream).decode()
      } catch {
        continue
      }
      const count = width * height
      const needed = count * (kind.kind === "rgb" ? 3 : 1)
      if (pixels.length < needed) continue

      let mask: Uint8Array | undefined
      const maskRef = dict.get(PDFName.of("SMask"))
      const maskStream = maskRef ? doc.context.lookup(maskRef) : undefined
      if (maskStream instanceof PDFRawStream) {
        try {
          const decoded = decodePDFRawStream(maskStream).decode()
          if (decoded.length >= count) mask = decoded
        } catch {
          mask = undefined
        }
      }

      const rgba = toRgba(pixels, count, mask, kind.kind)
      const png = new Uint8Array(UPNG.encode([rgba.buffer as ArrayBuffer], width, height, 0))
      images.push({ page: pageNumber, index, mime: "image/png", data: png, width, height })
    }
  }
  return images
}
