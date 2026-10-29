import { Effect, Option, Schema, Scope, Stream } from "effect"
import { NonNegativeInt } from "@novaway/core/schema"
import * as path from "path"
import * as Tool from "./tool"
import { AppFileSystem } from "@novaway/core/filesystem"
import { LSP } from "@/lsp/lsp"
import DESCRIPTION from "./read.txt"
import { InstanceState } from "@/effect/instance-state"
import { assertExternalDirectoryEffect } from "./external-directory"
import { Instruction } from "../session/instruction"
import { isPdfAttachment, sniffAttachmentMime } from "@/util/media"
import * as Pdf from "@/util/pdf"
import { Reference } from "@/reference/reference"
import { extractOfficeDocumentText, isOfficeDocument } from "@/util/office-document"
import * as Bom from "@/util/bom"
import { ReadState } from "./read-state"
import * as Notebook from "./notebook"

const DEFAULT_READ_LIMIT = 2000
const MAX_LINE_LENGTH = 2000
const MAX_LINE_SUFFIX = `... (line truncated to ${MAX_LINE_LENGTH} chars)`
// Claude Code reads up to 256 KB / 25k output tokens in one call. The previous
// 50 KB cap forced large source files into several round-trips, and the model
// had to reason about a partial view without knowing it was partial.
const MAX_BYTES = 256 * 1024
const MAX_BYTES_LABEL = `${MAX_BYTES / 1024} KB`
const SAMPLE_BYTES = 4096
const SUPPORTED_IMAGE_MIMES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"])

/**
 * Returned instead of the file body when the same range was read before and
 * the file has not changed since. Mirrors Claude Code's `file_unchanged`
 * result: the earlier read is still in context, so re-sending the whole file
 * only burns tokens.
 */
export const FILE_UNCHANGED_STUB =
  "File unchanged since last read. The content from the earlier Read tool_result in this conversation is still current — refer to that instead of re-reading."

class ReadStop extends Schema.TaggedErrorClass<ReadStop>()("ReadStop", {}) {}

// `offset` and `limit` were originally `z.coerce.number()` — the runtime
// coercion was useful when the tool was called from a shell but serves no
// purpose in the LLM tool-call path (the model emits typed JSON). The JSON
// Schema output is identical (`type: "number"`), so the LLM view is
// unchanged; purely CLI-facing uses must now send numbers rather than strings.
export const Parameters = Schema.Struct({
  filePath: Schema.String.annotate({ description: "The absolute path to the file or directory to read" }),
  offset: Schema.optional(NonNegativeInt).annotate({
    description: "The line number to start reading from (1-indexed)",
  }),
  limit: Schema.optional(NonNegativeInt).annotate({
    description: "The maximum number of lines to read (defaults to 2000)",
  }),
  pages: Schema.optional(Schema.String).annotate({
    description:
      'Page range for PDF files (e.g. "1-5", "3", "10-20"). Only applicable to PDF files. Maximum 20 pages per request.',
  }),
})

export const ReadTool = Tool.define(
  "read",
  Effect.gen(function* () {
    const fs = yield* AppFileSystem.Service
    const instruction = yield* Instruction.Service
    const lsp = yield* LSP.Service
    const reference = yield* Reference.Service
    const scope = yield* Scope.Scope
    const readState = yield* ReadState.Service

    const mtimeOf = (stat: { mtime: Option.Option<Date> }) =>
      Option.getOrElse(stat.mtime, () => new Date(0)).getTime()

    const recordRead = (
      ctx: Tool.Context,
      filepath: string,
      stat: { mtime: Option.Option<Date>; size: bigint | number },
      partial: boolean,
      range?: { offset?: number; limit?: number },
    ) =>
      readState.record(ctx.sessionID, filepath, {
        timestamp: Date.now(),
        mtime: mtimeOf(stat),
        size: Number(stat.size),
        partial,
        ...range,
      })

    const miss = Effect.fn("ReadTool.miss")(function* (filepath: string) {
      const dir = path.dirname(filepath)
      const base = path.basename(filepath)
      const items = yield* fs.readDirectory(dir).pipe(
        Effect.map((items) =>
          items
            .filter(
              (item) =>
                item.toLowerCase().includes(base.toLowerCase()) || base.toLowerCase().includes(item.toLowerCase()),
            )
            .map((item) => path.join(dir, item))
            .slice(0, 3),
        ),
        Effect.catch(() => Effect.succeed([] as string[])),
      )

      if (items.length > 0) {
        return yield* Effect.fail(
          new Error(`File not found: ${filepath}\n\nDid you mean one of these?\n${items.join("\n")}`),
        )
      }

      return yield* Effect.fail(new Error(`File not found: ${filepath}`))
    })

    const list = Effect.fn("ReadTool.list")(function* (filepath: string) {
      const items = yield* fs.readDirectoryEntries(filepath)
      return yield* Effect.forEach(
        items,
        Effect.fnUntraced(function* (item) {
          if (item.type === "directory") return item.name + "/"
          if (item.type !== "symlink") return item.name

          const target = yield* fs.stat(path.join(filepath, item.name)).pipe(Effect.catch(() => Effect.void))
          if (target?.type === "Directory") return item.name + "/"
          return item.name
        }),
        { concurrency: "unbounded" },
      ).pipe(Effect.map((items: string[]) => items.sort((a, b) => a.localeCompare(b))))
    })

    const warm = Effect.fn("ReadTool.warm")(function* (filepath: string) {
      yield* lsp.touchFile(filepath).pipe(Effect.ignore, Effect.forkIn(scope))
    })

    const readSample = Effect.fn("ReadTool.readSample")(function* (
      filepath: string,
      fileSize: number,
      sampleSize: number,
    ) {
      if (fileSize === 0) return new Uint8Array()

      return yield* Effect.scoped(
        Effect.gen(function* () {
          const file = yield* fs.open(filepath, { flag: "r" })
          return Option.getOrElse(yield* file.readAlloc(Math.min(sampleSize, fileSize)), () => new Uint8Array())
        }),
      )
    })

    const lines = Effect.fn("ReadTool.lines")(function* (filepath: string, opts: { limit: number; offset: number }) {
      const start = opts.offset - 1
      const raw: string[] = []
      const flags = { bytes: 0, count: 0, cut: false, more: false, done: false }

      // Note: prefer manual TextDecoder over Stream.decodeText — when the source stream
      // ends without flushing, decodeText drops the final unterminated line. We also
      // avoid Stream.runForEachWhile (it currently swallows the final unterminated
      // line of the upstream splitLines pipeline) and use a tagged error to stop the
      // upstream file stream as soon as the byte cap is reached.
      const decoder = new TextDecoder("utf-8")
      yield* fs.stream(filepath).pipe(
        Stream.map((bytes) => decoder.decode(bytes, { stream: true })),
        Stream.splitLines,
        Stream.runForEach((text) =>
          Effect.gen(function* () {
            if (flags.done) return yield* new ReadStop()
            flags.count += 1
            if (flags.count <= start) return

            if (raw.length >= opts.limit) {
              flags.more = true
              return
            }

            const line = text.length > MAX_LINE_LENGTH ? text.substring(0, MAX_LINE_LENGTH) + MAX_LINE_SUFFIX : text
            const size = Buffer.byteLength(line, "utf-8") + (raw.length > 0 ? 1 : 0)
            if (flags.bytes + size <= MAX_BYTES) {
              raw.push(line)
              flags.bytes += size
              return
            }

            flags.cut = true
            flags.more = true
            flags.done = true
            return yield* new ReadStop()
          }),
        ),
        Effect.catchTag("ReadStop", () => Effect.void),
      )

      return { raw, count: flags.count, cut: flags.cut, more: flags.more, offset: opts.offset }
    })

    const isBinaryFile = (filepath: string, bytes: Uint8Array) => {
      const ext = path.extname(filepath).toLowerCase()
      switch (ext) {
        case ".zip":
        case ".tar":
        case ".gz":
        case ".exe":
        case ".dll":
        case ".so":
        case ".class":
        case ".jar":
        case ".war":
        case ".7z":
        case ".doc":
        case ".docx":
        case ".xls":
        case ".xlsx":
        case ".ppt":
        case ".pptx":
        case ".odt":
        case ".ods":
        case ".odp":
        case ".bin":
        case ".dat":
        case ".obj":
        case ".o":
        case ".a":
        case ".lib":
        case ".wasm":
        case ".pyc":
        case ".pyo":
          return true
      }

      if (bytes.length === 0) return false

      let nonPrintableCount = 0
      for (let i = 0; i < bytes.length; i++) {
        if (bytes[i] === 0) return true
        if (bytes[i] < 9 || (bytes[i] > 13 && bytes[i] < 32)) {
          nonPrintableCount++
        }
      }

      return nonPrintableCount / bytes.length > 0.3
    }

    const run = Effect.fn("ReadTool.execute")(function* (
      params: Schema.Schema.Type<typeof Parameters>,
      ctx: Tool.Context,
    ) {
      const instance = yield* InstanceState.context
      let filepath = params.filePath
      if (process.platform === "win32" && /^[/\\](?![/\\])/.test(filepath)) {
        filepath = `${path.parse(instance.directory).root.replace(/[\\/]$/, "")}${filepath}`
      }
      if (!path.isAbsolute(filepath)) {
        filepath = path.resolve(ctx.directory ?? instance.directory, filepath)
      }
      if (process.platform === "win32") {
        filepath = AppFileSystem.normalizePath(filepath)
      }
      yield* reference.ensure(filepath)
      const title = path.relative(ctx.directory ?? instance.worktree, filepath)

      const stat = yield* fs.stat(filepath).pipe(
        Effect.catchIf(
          (err) => "reason" in err && err.reason._tag === "NotFound",
          () => Effect.succeed(undefined),
        ),
      )

      yield* assertExternalDirectoryEffect(ctx, filepath, {
        bypass: Boolean(ctx.extra?.["bypassCwdCheck"]) || (yield* reference.contains(filepath)),
        kind: stat?.type === "Directory" ? "directory" : "file",
      })

      yield* ctx.ask({
        permission: "read",
        patterns: [path.relative(ctx.directory ?? instance.worktree, filepath)],
        always: ["*"],
        metadata: {},
      })

      if (!stat) return yield* miss(filepath)

      if (stat.type === "Directory") {
        const items = yield* list(filepath)
        const limit = params.limit ?? DEFAULT_READ_LIMIT
        const offset = params.offset || 1
        const start = offset - 1
        const sliced = items.slice(start, start + limit)
        const truncated = start + sliced.length < items.length

        return {
          title,
          output: [
            `<path>${filepath}</path>`,
            `<type>directory</type>`,
            `<entries>`,
            sliced.join("\n"),
            truncated
              ? `\n(Showing ${sliced.length} of ${items.length} entries. Use 'offset' parameter to read beyond entry ${offset + sliced.length})`
              : `\n(${items.length} entries)`,
            `</entries>`,
          ].join("\n"),
          metadata: {
            preview: sliced.slice(0, 20).join("\n"),
            truncated,
            partial: false,
            loaded: [] as string[],
          },
        }
      }

      // Same file, same range, and unchanged on disk: the earlier tool_result
      // is still in context, so a full copy only wastes tokens. Entries written
      // by edit/write carry no offset, which keeps them out of this path: the
      // content the model has seen predates the write, so the file must be read
      // again rather than reported as unchanged.
      const offset = params.offset || 1
      const limit = params.limit ?? DEFAULT_READ_LIMIT
      const previous = yield* readState.get(ctx.sessionID, filepath)
      if (
        previous &&
        previous.offset !== undefined &&
        !previous.partial &&
        previous.offset === offset &&
        previous.limit === limit &&
        previous.mtime === mtimeOf(stat)
      ) {
        return {
          title,
          output: FILE_UNCHANGED_STUB,
          metadata: {
            preview: FILE_UNCHANGED_STUB,
            truncated: false,
            partial: false,
            loaded: [] as string[],
          },
        }
      }

      const loaded = yield* instruction.resolve(ctx.messages, filepath, ctx.messageID)
      const sample = yield* readSample(filepath, Number(stat.size), SAMPLE_BYTES)

      const mime = sniffAttachmentMime(sample, AppFileSystem.mimeType(filepath))
      const isImage = SUPPORTED_IMAGE_MIMES.has(mime)

      // PDF 有两条路径（对齐 CC）：小文件整份内联成一个 document block；
      // `pages` 参数或体积过大时用 poppler 按页渲染成 JPEG 图片附件。
      if (isPdfAttachment(mime)) {
        if (params.pages) {
          const invalid = Pdf.validatePageRange(params.pages)
          if (invalid) return yield* Effect.fail(new Error(invalid))
        }

        const size = Number(stat.size)
        const extracted = (range?: { firstPage: number; lastPage: number }) =>
          Effect.promise(() => Pdf.extractPages(filepath, size, range))

        const render = (data: { images: { mime: string; base64: string }[]; count: number; size: number }) => ({
          title,
          output: `PDF pages extracted: ${data.count} page(s) from ${filepath} (${Pdf.formatSize(data.size)})`,
          metadata: {
            preview: `PDF pages extracted: ${data.count} page(s)`,
            truncated: false,
            partial: true,
            loaded: loaded.map((item) => item.filepath),
          },
          attachments: data.images.map((image) => ({
            type: "file" as const,
            mime: image.mime,
            url: `data:${image.mime};base64,${image.base64}`,
          })),
        })

        if (params.pages) {
          const result = yield* extracted(Pdf.parsePageRange(params.pages))
          if (!result.ok) return yield* Effect.fail(new Error(result.error.message))
          yield* recordRead(ctx, filepath, stat, true)
          return render(result.data)
        }

        const count = yield* Effect.promise(() => Pdf.pageCount(filepath))
        if (count !== undefined && count > Pdf.INLINE_PAGE_THRESHOLD) {
          return yield* Effect.fail(
            new Error(
              `This PDF has ${count} pages, which is too many to read at once. ` +
                `Use the pages parameter to read specific page ranges (e.g. pages: "1-5"). ` +
                `Maximum ${Pdf.MAX_PAGES_PER_READ} pages per request.`,
            ),
          )
        }

        // 大文件整份 base64 会挤爆请求，改为分页渲染；poppler 缺失时退回整份内联
        // （小文件仍可用），只有确定放不下才报错。
        if (size > Pdf.EXTRACT_SIZE_THRESHOLD) {
          const result = yield* extracted()
          if (result.ok) {
            yield* recordRead(ctx, filepath, stat, false)
            return render(result.data)
          }
          if (result.error.reason === "unavailable") {
            return yield* Effect.fail(new Error(`${result.error.message} The PDF is too large to inline directly.`))
          }
          return yield* Effect.fail(new Error(result.error.message))
        }

        const whole = yield* Effect.promise(() => Pdf.readWhole(filepath, size))
        if (!whole.ok) return yield* Effect.fail(new Error(whole.error.message))
        const msg = count === undefined ? "PDF read successfully" : `PDF read successfully (${count} pages)`
        yield* recordRead(ctx, filepath, stat, false)
        return {
          title,
          output: msg,
          metadata: {
            preview: msg,
            truncated: false,
            partial: false,
            loaded: loaded.map((item) => item.filepath),
          },
          attachments: [
            {
              type: "file" as const,
              mime: "application/pdf",
              url: `data:application/pdf;base64,${whole.data.base64}`,
            },
          ],
        }
      }

      if (isImage) {
        const bytes = yield* fs.readFile(filepath)
        const msg = "Image read successfully"
        yield* recordRead(ctx, filepath, stat, false)
        return {
          title,
          output: msg,
          metadata: {
            preview: msg,
            truncated: false,
            partial: false,
            loaded: loaded.map((item) => item.filepath),
          },
          attachments: [
            {
              type: "file" as const,
              mime,
              url: `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`,
            },
          ],
        }
      }

      if (isOfficeDocument(filepath, mime)) {
        const bytes = yield* fs.readFile(filepath)
        const document = yield* Effect.promise(() => extractOfficeDocumentText({ filename: filepath, mime, bytes }))
        if (!document)
          return yield* Effect.fail(new Error(`Cannot extract readable text from Office file: ${filepath}`))
        const content = document.text.trim()
        if (!content) return yield* Effect.fail(new Error(`Cannot extract readable text from Office file: ${filepath}`))

        const output = [
          `<path>${filepath}</path>`,
          `<type>office:${document.kind}</type>`,
          "<content>",
          content,
          "</content>",
        ].join("\n")

        const officeTruncated = content.length >= 160_000
        yield* recordRead(ctx, filepath, stat, officeTruncated)
        return {
          title,
          output,
          metadata: {
            preview: content.split("\n").slice(0, 20).join("\n"),
            truncated: officeTruncated,
            partial: officeTruncated,
            loaded: loaded.map((item) => item.filepath),
          },
        }
      }

      if (isBinaryFile(filepath, sample)) {
        return yield* Effect.fail(new Error(`Cannot read binary file: ${filepath}`))
      }

      // Jupyter notebooks are JSON on disk: showing the raw envelope wastes
      // most of the context on metadata and output blobs. Render cells the way
      // the model needs to see them (source + outputs + ids it can edit by),
      // matching Claude Code's notebook read.
      if (path.extname(filepath).toLowerCase() === ".ipynb") {
        const raw = yield* fs.readFileString(filepath)
        const source = Bom.split(raw).text
        let notebook: Notebook.Notebook
        try {
          notebook = Notebook.parse(source)
        } catch (error) {
          return yield* Effect.fail(
            new Error(`Notebook is not valid JSON: ${filepath} (${error instanceof Error ? error.message : String(error)})`),
          )
        }
        const rendered = Notebook.render(notebook, { filePath: filepath, maxBytes: MAX_BYTES })
        yield* recordRead(ctx, filepath, stat, rendered.truncated)
        return {
          title,
          output: [
            `<path>${filepath}</path>`,
            `<type>notebook</type>`,
            `<language>${Notebook.language(notebook)}</language>`,
            rendered.text,
          ].join("\n"),
          metadata: {
            preview: rendered.text.split("\n").slice(0, 20).join("\n"),
            truncated: rendered.truncated,
            partial: rendered.truncated,
            loaded: loaded.map((item) => item.filepath),
          },
          ...(rendered.images.length > 0
            ? {
                attachments: rendered.images.map((image) => ({
                  type: "file" as const,
                  mime: image.mime,
                  url: `data:${image.mime};base64,${image.base64}`,
                })),
              }
            : {}),
        }
      }

      const file = yield* lines(filepath, { limit: params.limit ?? DEFAULT_READ_LIMIT, offset: params.offset || 1 })
      if (file.count < file.offset && !(file.count === 0 && file.offset === 1)) {
        return yield* Effect.fail(
          new Error(`Offset ${file.offset} is out of range for this file (${file.count} lines)`),
        )
      }

      let output = [`<path>${filepath}</path>`, `<type>file</type>`, "<content>\n"].join("\n")
      output += file.raw.map((line, i) => `${i + file.offset}: ${line}`).join("\n")

      const last = file.offset + file.raw.length - 1
      const next = last + 1
      const truncated = file.more || file.cut
      // A read is a full view only when it started at line 1 and consumed the
      // whole file. Anything else must not be treated as a basis for editing.
      const partial = truncated || file.offset > 1
      yield* recordRead(ctx, filepath, stat, partial, {
        offset: file.offset,
        limit: params.limit ?? DEFAULT_READ_LIMIT,
      })
      if (file.cut) {
        output += `\n\n(Output capped at ${MAX_BYTES_LABEL}. Showing lines ${file.offset}-${last}. Use offset=${next} to continue. This is a partial view; read the remaining lines before editing.)`
      } else if (file.more) {
        output += `\n\n(Showing lines ${file.offset}-${last} of ${file.count}. Use offset=${next} to continue. This is a partial view; read the remaining lines before editing.)`
      } else if (file.offset > 1) {
        output += `\n\n(End of file from line ${file.offset} - total ${file.count} lines. This is a partial view; read from line 1 before editing.)`
      } else {
        output += `\n\n(End of file - total ${file.count} lines)`
      }
      output += "\n</content>"

      yield* warm(filepath)

      if (loaded.length > 0) {
        output += `\n\n<system-reminder>\n${loaded.map((item) => item.content).join("\n\n")}\n</system-reminder>`
      }

      return {
        title,
        output,
        metadata: {
          preview: file.raw.slice(0, 20).join("\n"),
          truncated,
          partial,
          loaded: loaded.map((item) => item.filepath),
        },
      }
    })

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        run(params, ctx).pipe(Effect.orDie),
    }
  }),
)
