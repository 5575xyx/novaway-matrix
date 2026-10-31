/**
 * PDF 生成：HTML 文件 / 网页 → PDF。
 *
 * 渲染交给内置浏览器（Chromium 的 `Page.printToPDF`），所以不需要额外的 PDF
 * 引擎，也不需要用户装 Office / LibreOffice。之前「扩展 → PDF」显示不可用，
 * 就是没有这条生成链路；现在它和浏览器工具共用同一套 headless 浏览器。
 */
import path from "node:path"
import { Effect, Schema } from "effect"
import { InstanceState } from "@/effect/instance-state"
import { AppFileSystem } from "@novaway/core/filesystem"
import { BrowserService } from "@/browser/browser"
import * as Tool from "./tool"

type PdfMetadata = {
  path?: string
  bytes?: number
}

const Parameters = Schema.Struct({
  source: Schema.String.annotate({
    description: "本地 HTML 文件路径、http(s) URL，或直接给 HTML 源码（配合 html: true）。相对路径按当前工作区解析。",
  }),
  html: Schema.optional(Schema.Boolean).annotate({
    description: "source 是 HTML 源码而不是路径/URL。",
  }),
  output: Schema.optional(Schema.String).annotate({
    description: "输出文件路径（相对工作区或绝对路径）。默认 <工作区>/<source 名>.pdf。",
  }),
  landscape: Schema.optional(Schema.Boolean).annotate({ description: "横向打印。" }),
  printBackground: Schema.optional(Schema.Boolean).annotate({
    description: "打印背景色/背景图（默认 true，否则页面底色全白）。",
  }),
})

function permission(source: string) {
  return {
    permission: "pdf",
    patterns: [source],
    always: ["*"] as string[],
    metadata: { target: source },
  }
}

/** 从 source 推出默认输出文件名：`report.html` → `report.pdf`。 */
export function defaultOutputName(source: string) {
  if (/^https?:/i.test(source)) {
    const parsed = new URL(source)
    const base = parsed.pathname.split("/").filter(Boolean).pop()
    // 根路径（https://example.com/）没有文件名，用主机名，且不能当扩展名剥掉 ".com"。
    if (!base) return parsed.hostname || "document"
    return base.replace(/[?#].*$/, "").replace(/\.[^.]+$/, "") || "document"
  }
  const base = source.split(/[\/]/).filter(Boolean).pop() ?? "document"
  return base.replace(/\.[^.]+$/, "") || "document"
}

export const PdfCreateTool = Tool.define(
  "pdf_create",
  Effect.gen(function* () {
    const browser = yield* BrowserService.Service
    const fs = yield* AppFileSystem.Service
    return {
      description:
        "Render HTML or a web page to PDF (headless Chromium print pipeline). " +
        "Use it when the user wants a PDF deliverable: write the page as HTML first, then convert it here.",
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const instance = yield* InstanceState.context
          yield* ctx.ask(permission(params.html ? "<html>" : params.source))

          // HTML 源码没有文件名可推，默认落到 document.pdf。
          const fallback = params.html ? "document" : defaultOutputName(params.source)
          const relative = params.output ?? path.join(".", fallback + ".pdf")
          const file = path.isAbsolute(relative) ? relative : path.join(instance.worktree, relative)

          const bytes = yield* browser.printToPdf({
            target: params.html ? "" : params.source,
            html: params.html ? params.source : undefined,
            landscape: params.landscape,
            printBackground: params.printBackground,
          })

          // writeWithDirs：目录不存在时自动补建，省掉一次显式 makeDirectory。
          yield* fs.writeWithDirs(file, bytes).pipe(Effect.orDie)

          const name = path.relative(instance.worktree, file).replaceAll("\\", "/")
          return {
            title: `PDF ${name}`,
            metadata: { path: name, bytes: bytes.byteLength } satisfies PdfMetadata,
            output: `已生成 PDF：${name}（${Math.round(bytes.byteLength / 1024)} KB）`,
          }
        }).pipe(Effect.orDie),
    }
  }),
)
