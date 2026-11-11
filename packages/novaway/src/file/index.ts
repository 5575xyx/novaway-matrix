import { BusEvent } from "@/bus/bus-event"
import { InstanceState } from "@/effect/instance-state"

import { AppFileSystem } from "@novaway/core/filesystem"
import { Git } from "@/git"
import { Effect, Layer, Context, Schema, Scope } from "effect"
import * as Stream from "effect/Stream"
import { formatPatch, structuredPatch } from "diff"
import fuzzysort from "fuzzysort"
import ignore from "ignore"
import path from "path"
import { Global } from "@novaway/core/global"
import { containsPath, type InstanceContext } from "../project/instance-context"
import { Filesystem } from "@/util/filesystem"
import * as Log from "@novaway/core/util/log"
import { looksBinary } from "@novaway/core/office/text/format"
import { officeFormatOf } from "@novaway/core/office/engine/registry"
import { decodeFileText, encodeFileText } from "./encoding"
import { Protected } from "./protected"
import { Ripgrep } from "./ripgrep"
import { NonNegativeInt, type DeepMutable } from "@novaway/core/schema"

export const Info = Schema.Struct({
  path: Schema.String,
  added: NonNegativeInt,
  removed: NonNegativeInt,
  status: Schema.Literals(["added", "deleted", "modified"]),
}).annotate({ identifier: "File" })
export type Info = DeepMutable<Schema.Schema.Type<typeof Info>>

export const Node = Schema.Struct({
  name: Schema.String,
  path: Schema.String,
  absolute: Schema.String,
  type: Schema.Literals(["file", "directory"]),
  ignored: Schema.Boolean,
}).annotate({ identifier: "FileNode" })
export type Node = DeepMutable<Schema.Schema.Type<typeof Node>>

const Hunk = Schema.Struct({
  oldStart: NonNegativeInt,
  oldLines: NonNegativeInt,
  newStart: NonNegativeInt,
  newLines: NonNegativeInt,
  lines: Schema.Array(Schema.String),
})

const Patch = Schema.Struct({
  oldFileName: Schema.String,
  newFileName: Schema.String,
  oldHeader: Schema.optional(Schema.String),
  newHeader: Schema.optional(Schema.String),
  hunks: Schema.Array(Hunk),
  index: Schema.optional(Schema.String),
})

export const Content = Schema.Struct({
  type: Schema.Literals(["text", "binary"]),
  content: Schema.String,
  diff: Schema.optional(Schema.String),
  patch: Schema.optional(Patch),
  encoding: Schema.optional(Schema.Literal("base64")),
  mimeType: Schema.optional(Schema.String),
}).annotate({ identifier: "FileContent" })
export type Content = DeepMutable<Schema.Schema.Type<typeof Content>>

export const ReadErrorCode = Schema.Literals([
  "invalid_path",
  "path_outside_workspace",
  "not_found",
  "unsupported_type",
])
export type ReadErrorCode = Schema.Schema.Type<typeof ReadErrorCode>

export const MEDIA_PREVIEW_MAX_BYTES = 512 * 1024 * 1024
export const MEDIA_PREVIEW_RANGE_MAX_BYTES = 1024 * 1024
export const MEDIA_PREVIEW_INLINE_MAX_BYTES = 8 * 1024 * 1024
export const MEDIA_PREVIEW_PATH = "/file/media"

export const MediaRange = Schema.Struct({
  content: Schema.Uint8Array,
  mimeType: Schema.String,
  size: Schema.Number,
  offset: Schema.Number,
  length: Schema.Number,
})
export type MediaRange = Schema.Schema.Type<typeof MediaRange>

/**
 * base64（预览 / 素材导出）通道的失败原因。
 *
 * 读不到必须**失败**，不能回
 * `{ type: "binary", content: "" }` 当成功。空内容和「还在加载」在前端长得一模一样，
 * 于是面板会永远停在加载态，越界被拒也一样静默（原来 `throw new Error` 是 defect，
 * SDK 那侧同样只剩一个 undefined data）。
 */
export class ReadError extends Schema.TaggedErrorClass<ReadError>()("FileReadError", {
  code: ReadErrorCode,
  path: Schema.String,
  message: Schema.String,
}) {}

export const Event = {
  Edited: BusEvent.define(
    "file.edited",
    Schema.Struct({
      file: Schema.String,
    }),
  ),
}

const log = Log.create({ service: "file" })

const binary = new Set([
  "exe",
  "dll",
  "pdb",
  "bin",
  "so",
  "dylib",
  "o",
  "a",
  "lib",
  "wav",
  "mp3",
  "ogg",
  "oga",
  "ogv",
  "ogx",
  "flac",
  "aac",
  "wma",
  "m4a",
  "weba",
  "opus",
  "m4v",
  "mp4",
  "avi",
  "mov",
  "wmv",
  "flv",
  "webm",
  "mkv",
  "zip",
  "tar",
  "gz",
  "gzip",
  "bz",
  "bz2",
  "bzip",
  "bzip2",
  "7z",
  "rar",
  "xz",
  "lz",
  "z",
  "pdf",
  "doc",
  "docx",
  "ppt",
  "pptx",
  "xls",
  "xlsx",
  // 图片:走 base64 通道做真实预览,不能让文本编辑器按乱码打开。
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "bmp",
  "ico",
  "avif",
  "tif",
  "tiff",
  "heic",
  "dmg",
  "iso",
  "img",
  "vmdk",
  "ttf",
  "otf",
  "woff",
  "woff2",
  "eot",
  "sqlite",
  "db",
  "mdb",
  "apk",
  "ipa",
  "aab",
  "xapk",
  "app",
  "pkg",
  "deb",
  "rpm",
  "snap",
  "flatpak",
  "appimage",
  "msi",
  "msp",
  "jar",
  "war",
  "ear",
  "class",
  "kotlin_module",
  "dex",
  "vdex",
  "odex",
  "oat",
  "art",
  "wasm",
  "wat",
  "bc",
  "ll",
  "s",
  "ko",
  "sys",
  "drv",
  "efi",
  "rom",
  "com",
])

const image = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "bmp",
  "webp",
  "ico",
  "tif",
  "tiff",
  "svg",
  "svgz",
  "avif",
  "apng",
  "jxl",
  "heic",
  "heif",
  "raw",
  "cr2",
  "nef",
  "arw",
  "dng",
  "orf",
  "raf",
  "pef",
  "x3f",
])

const text = new Set([
  "ts",
  "tsx",
  "mts",
  "cts",
  "mtsx",
  "ctsx",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "sh",
  "bash",
  "zsh",
  "fish",
  "ps1",
  "psm1",
  "cmd",
  "bat",
  "json",
  "jsonc",
  "json5",
  "yaml",
  "yml",
  "toml",
  "md",
  "mdx",
  "txt",
  "xml",
  "html",
  "htm",
  "css",
  "scss",
  "sass",
  "less",
  "graphql",
  "gql",
  "sql",
  "ini",
  "cfg",
  "conf",
  "env",
])

const textName = new Set([
  "dockerfile",
  "makefile",
  ".gitignore",
  ".gitattributes",
  ".editorconfig",
  ".npmrc",
  ".nvmrc",
  ".prettierrc",
  ".eslintrc",
])

const mime: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  bmp: "image/bmp",
  webp: "image/webp",
  ico: "image/x-icon",
  tif: "image/tiff",
  tiff: "image/tiff",
  svg: "image/svg+xml",
  svgz: "image/svg+xml",
  avif: "image/avif",
  apng: "image/apng",
  jxl: "image/jxl",
  heic: "image/heic",
  heif: "image/heif",
}

type Entry = { files: string[]; dirs: string[] }

const ext = (file: string) => path.extname(file).toLowerCase().slice(1)
const name = (file: string) => path.basename(file).toLowerCase()
const isImageByExtension = (file: string) => image.has(ext(file))
const isTextByExtension = (file: string) => text.has(ext(file))
const isTextByName = (file: string) => textName.has(name(file))
const isBinaryByExtension = (file: string) => binary.has(ext(file))
/**
 * 面板按「Office 包」预览的格式。清单交给 core 的引擎表，不在这里再抄一份：
 * 带宏 / 模板的变体（docm、pptm、xltx…）和只读旧格式（odt、rtf、doc…）
 * 都由同一张别名表映射，前端 `OFFICE_EXTENSIONS` 能点开的前后端一定都认。
 */
const OFFICE_FILE_GLOBS = [
  "*.docx",
  "*.docm",
  "*.dotx",
  "*.dotm",
  "*.doc",
  "*.odt",
  "*.rtf",
  "*.xlsx",
  "*.xlsm",
  "*.xltx",
  "*.xltm",
  "*.xls",
  "*.ods",
  "*.pptx",
  "*.pptm",
  "*.potx",
  "*.potm",
  "*.ppsx",
  "*.ppsm",
  "*.ppt",
  "*.odp",
  "*.pdf",
  "**/*.docx",
  "**/*.docm",
  "**/*.dotx",
  "**/*.dotm",
  "**/*.doc",
  "**/*.odt",
  "**/*.rtf",
  "**/*.xlsx",
  "**/*.xlsm",
  "**/*.xltx",
  "**/*.xltm",
  "**/*.xls",
  "**/*.ods",
  "**/*.pptx",
  "**/*.pptm",
  "**/*.potx",
  "**/*.potm",
  "**/*.ppsx",
  "**/*.ppsm",
  "**/*.ppt",
  "**/*.odp",
  "**/*.pdf",
  "!**/.git/**",
  "!**/node_modules/**",
  "!**/dist/**",
  "!**/build/**",
  "!**/target/**",
  "!**/vendor/**",
]

const isOfficePreviewByExtension = (file: string) => {
  const format = officeFormatOf(file)
  return format === "docx" || format === "xlsx" || format === "pptx" || format === "pdf" || format === "legacy"
}
const isImage = (mimeType: string) => mimeType.startsWith("image/")
const getImageMimeType = (file: string) => mime[ext(file)] || "image/" + ext(file)

function shouldEncode(mimeType: string) {
  const type = mimeType.toLowerCase()
  log.debug("shouldEncode", { type })
  if (!type) return false
  if (type.startsWith("text/")) return false
  if (type.includes("charset=")) return false
  const top = type.split("/", 2)[0]
  return ["image", "audio", "video", "font", "model", "multipart"].includes(top)
}

const hidden = (item: string) => {
  const normalized = item.replaceAll("\\", "/").replace(/\/+$/, "")
  return normalized.split("/").some((part) => part.startsWith(".") && part.length > 1)
}

const sortHiddenLast = (items: string[], prefer: boolean) => {
  if (prefer) return items
  const visible: string[] = []
  const hiddenItems: string[] = []
  for (const item of items) {
    if (hidden(item)) hiddenItems.push(item)
    else visible.push(item)
  }
  return [...visible, ...hiddenItems]
}

interface State {
  cache: Entry
}

export interface Interface {
  readonly init: () => Effect.Effect<void>
  readonly status: () => Effect.Effect<Info[]>
  readonly read: (file: string, options?: { encoding?: "base64" }) => Effect.Effect<Content, ReadError>
  readonly readMediaRange: (file: string, offset: number, length: number) => Effect.Effect<MediaRange, ReadError>
  readonly write: (file: string, content: string) => Effect.Effect<void>
  readonly list: (dir?: string) => Effect.Effect<Node[]>
  readonly search: (input: {
    query: string
    limit?: number
    dirs?: boolean
    type?: "file" | "directory"
  }) => Effect.Effect<string[]>
}

export class Service extends Context.Service<Service, Interface>()("@novaway/File") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const appFs = yield* AppFileSystem.Service
    const rg = yield* Ripgrep.Service
    const git = yield* Git.Service
    const scope = yield* Scope.Scope

    const state = yield* InstanceState.make<State>(
      Effect.fn("File.state")(() =>
        Effect.succeed({
          cache: { files: [], dirs: [] } as Entry,
        }),
      ),
    )

    const scan = Effect.fn("File.scan")(function* () {
      const ctx = yield* InstanceState.context
      if (ctx.directory === path.parse(ctx.directory).root) return
      const isGlobalHome = ctx.directory === Global.Path.home && ctx.project.id === "global"
      const next: Entry = { files: [], dirs: [] }

      if (isGlobalHome) {
        const dirs = new Set<string>()
        const protectedNames = Protected.names()
        const ignoreNested = new Set(["node_modules", "dist", "build", "target", "vendor"])
        const shouldIgnoreName = (name: string) => name.startsWith(".") || protectedNames.has(name)
        const shouldIgnoreNested = (name: string) => name.startsWith(".") || ignoreNested.has(name)
        const top = yield* appFs.readDirectoryEntries(ctx.directory).pipe(Effect.orElseSucceed(() => []))

        for (const entry of top) {
          if (entry.type !== "directory") continue
          if (shouldIgnoreName(entry.name)) continue
          dirs.add(entry.name + "/")

          const base = path.join(ctx.directory, entry.name)
          const children = yield* appFs.readDirectoryEntries(base).pipe(Effect.orElseSucceed(() => []))
          for (const child of children) {
            if (child.type !== "directory") continue
            if (shouldIgnoreNested(child.name)) continue
            dirs.add(entry.name + "/" + child.name + "/")
          }
        }

        next.dirs = Array.from(dirs).toSorted()
      } else {
        const files = yield* rg.files({ cwd: ctx.directory }).pipe(
          Stream.runCollect,
          Effect.map((chunk) => [...chunk]),
        )
        // Office documents are user-facing binary assets. Some repositories (or a
        // user's global git excludes) ignore old extensions such as .rtf/.ods/.odp,
        // but that must not make an existing document disappear from Open Files.
        // Re-scan only the narrow Office suffix set with ignore rules disabled;
        // the exclusions keep dependency/build/vendor trees out of the workspace index.
        const officeFiles = yield* rg
          .files({ cwd: ctx.directory, glob: OFFICE_FILE_GLOBS, noIgnore: true })
          .pipe(Stream.runCollect, Effect.map((chunk) => [...chunk]))
        const allFiles = [...new Set([...files, ...officeFiles])]
        const seen = new Set<string>()
        for (const file of allFiles) {
          next.files.push(file)
          let current = file
          while (true) {
            const dir = path.dirname(current)
            if (dir === ".") break
            if (dir === current) break
            current = dir
            if (seen.has(dir)) continue
            seen.add(dir)
            next.dirs.push(dir + "/")
          }
        }
      }

      const s = yield* InstanceState.get(state)
      s.cache = next
    })

    let cachedScan = yield* Effect.cached(scan().pipe(Effect.catchCause(() => Effect.void)))

    const ensure = Effect.fn("File.ensure")(function* () {
      yield* cachedScan
      cachedScan = yield* Effect.cached(scan().pipe(Effect.catchCause(() => Effect.void)))
    })

    const gitText = Effect.fnUntraced(function* (args: string[]) {
      return (yield* git.run(args, { cwd: (yield* InstanceState.context).directory })).text()
    })

    const init = Effect.fn("File.init")(function* () {
      yield* ensure().pipe(Effect.forkIn(scope))
    })

    const status = Effect.fn("File.status")(function* () {
      const ctx = yield* InstanceState.context
      if (ctx.project.vcs !== "git") return []

      const diffOutput = yield* gitText([
        "-c",
        "core.fsmonitor=false",
        "-c",
        "core.quotepath=false",
        "diff",
        "--numstat",
        "HEAD",
      ])

      const changed: Info[] = []

      if (diffOutput.trim()) {
        for (const line of diffOutput.trim().split("\n")) {
          const [added, removed, file] = line.split("\t")
          changed.push({
            path: file,
            added: added === "-" ? 0 : parseInt(added, 10),
            removed: removed === "-" ? 0 : parseInt(removed, 10),
            status: "modified",
          })
        }
      }

      const untrackedOutput = yield* gitText([
        "-c",
        "core.fsmonitor=false",
        "-c",
        "core.quotepath=false",
        "ls-files",
        "--others",
        "--exclude-standard",
      ])

      if (untrackedOutput.trim()) {
        for (const file of untrackedOutput.trim().split("\n")) {
          const content = yield* appFs
            .readFileString(path.join(ctx.directory, file))
            .pipe(Effect.catch(() => Effect.succeed<string | undefined>(undefined)))
          if (content === undefined) continue
          changed.push({
            path: file,
            added: content.split("\n").length,
            removed: 0,
            status: "added",
          })
        }
      }

      const deletedOutput = yield* gitText([
        "-c",
        "core.fsmonitor=false",
        "-c",
        "core.quotepath=false",
        "diff",
        "--name-only",
        "--diff-filter=D",
        "HEAD",
      ])

      if (deletedOutput.trim()) {
        for (const file of deletedOutput.trim().split("\n")) {
          changed.push({
            path: file,
            added: 0,
            removed: 0,
            status: "deleted",
          })
        }
      }

      return changed.map((item) => {
        const full = path.isAbsolute(item.path) ? item.path : path.join(ctx.directory, item.path)
        return {
          ...item,
          path: path.relative(ctx.directory, full),
        }
      })
    })

    /**
     * base64（预览 / 素材导出）通道的目标解析：
     * 空值 → 越界 → 扩展名白名单 → 存在性 → symlink 二次越界，
     * 每一步失败都抛 `ReadError`，绝不返回空内容冒充成功。
     *
     * 白名单只放真二进制（Office 包 / 图片 / 音视频）：文本类该走文本通道，
     * 让它在这里回空串就等于给前端一个永远不会结束的加载态。
     */
    const resolveBinaryTarget = Effect.fnUntraced(function* (input: string, ctx: InstanceContext) {
      const fail = (code: ReadErrorCode, message: string) => new ReadError({ code, path: input, message })
      const raw = typeof input === "string" ? input.trim() : ""
      if (!raw || raw.includes("\0")) return yield* Effect.fail(fail("invalid_path", "A file path is required."))

      const full = path.resolve(ctx.directory, raw)
      if (!containsPath(full, ctx))
        return yield* Effect.fail(fail("path_outside_workspace", "Access denied: path escapes project directory"))

      if (!isBinaryByExtension(full) && !isImageByExtension(full) && !isOfficePreviewByExtension(full))
        return yield* Effect.fail(fail("unsupported_type", `Not a binary file, read it as text instead: ${raw}`))

      if (!(yield* appFs.existsSafe(full)))
        return yield* Effect.fail(fail("not_found", `File not found: ${path.relative(ctx.directory, full)}`))

      // 第二道越界检查针对 symlink：链接本身在项目内，指向的目标可能在项目外。
      const real = Filesystem.resolve(full)
      if (!containsPath(real, ctx))
        return yield* Effect.fail(fail("path_outside_workspace", "Access denied: link escapes project directory"))
      return real
    })

    const readMediaRange: Interface["readMediaRange"] = Effect.fn("File.readMediaRange")(function* (
      file: string,
      offset: number,
      length: number,
    ) {
      const ctx = yield* InstanceState.context
      const target = yield* resolveBinaryTarget(file, ctx)
      const fail = (code: ReadErrorCode, message: string) => new ReadError({ code, path: file, message })
      if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(length) || length < 1)
        return yield* Effect.fail(fail("invalid_path", "Invalid media byte range."))
      if (length > MEDIA_PREVIEW_RANGE_MAX_BYTES)
        return yield* Effect.fail(fail("unsupported_type", "Requested media range exceeds the maximum chunk size."))

      const info = yield* appFs
        .stat(target)
        .pipe(Effect.catch(() => Effect.fail(fail("not_found", `File not found: ${file}`))))
      const size = Number(info.size)
      if (!Number.isSafeInteger(size) || size > MEDIA_PREVIEW_MAX_BYTES)
        return yield* Effect.fail(fail("unsupported_type", "Media preview is limited to 512 MB."))
      if (size === 0 && offset === 0)
        return { content: Buffer.alloc(0), mimeType: AppFileSystem.mimeType(target), size, offset, length: 0 }
      if (offset >= size)
        return yield* Effect.fail(fail("invalid_path", "Requested media range starts beyond the file."))

      const content = yield* appFs
        .stream(target, {
          offset,
          bytesToRead: Math.min(length, size - offset),
          chunkSize: Math.min(length, size - offset),
        })
        .pipe(
          Stream.runCollect,
          Effect.mapError((error) => fail("not_found", String(error))),
        )
      return {
        content: Buffer.concat(Array.from(content, (chunk) => Buffer.from(chunk))),
        mimeType: AppFileSystem.mimeType(target),
        size,
        offset,
        length: Math.min(length, size - offset),
      }
    })

    const read: Interface["read"] = Effect.fn("File.read")(function* (file: string, options?: { encoding?: "base64" }) {
      using _ = log.time("read", { file })
      const ctx = yield* InstanceState.context

      if (options?.encoding === "base64") {
        const target = yield* resolveBinaryTarget(file, ctx)
        const bytes = yield* appFs.readFile(target).pipe(Effect.catch(() => Effect.succeed(new Uint8Array())))
        return {
          type: "binary" as const,
          content: Buffer.from(bytes).toString("base64"),
          mimeType: AppFileSystem.mimeType(target),
          encoding: "base64" as const,
        }
      }

      const full = path.join(ctx.directory, file)

      if (!containsPath(full, ctx)) {
        return yield* Effect.fail(
          new ReadError({
            code: "path_outside_workspace",
            path: file,
            message: "Access denied: path escapes project directory",
          }),
        )
      }

      if (isImageByExtension(file)) {
        const exists = yield* appFs.existsSafe(full)
        if (exists) {
          const bytes = yield* appFs.readFile(full).pipe(Effect.catch(() => Effect.succeed(new Uint8Array())))
          return {
            type: "text" as const,
            content: Buffer.from(bytes).toString("base64"),
            mimeType: getImageMimeType(file),
            encoding: "base64" as const,
          }
        }
        return { type: "text" as const, content: "" }
      }

      const knownText = isTextByExtension(file) || isTextByName(file)

      if (isBinaryByExtension(file) && !knownText) return { type: "binary" as const, content: "" }

      const exists = yield* appFs.existsSafe(full)
      if (!exists) return { type: "text" as const, content: "" }

      const mimeType = AppFileSystem.mimeType(full)
      const encode = knownText ? false : shouldEncode(mimeType)

      if (encode && !isImage(mimeType)) return { type: "binary" as const, content: "", mimeType }

      if (encode) {
        const bytes = yield* appFs.readFile(full).pipe(Effect.catch(() => Effect.succeed(new Uint8Array())))
        return {
          type: "text" as const,
          content: Buffer.from(bytes).toString("base64"),
          mimeType,
          encoding: "base64" as const,
        }
      }

      // 按真实编码解码：GBK / UTF-16 / 带 BOM 的文件在面板里也不能变成乱码。
      // **不做 trim**：编辑器里改了随便一个字符就会整篇写回，先把首尾空白吃掉
      // 等于悄悄改了文件（行尾换行、缩进都是内容的一部分）。
      const raw = yield* appFs.readFile(full).pipe(Effect.catch(() => Effect.succeed(undefined)))

      // 扩展名不认识的文件按内容判断：文本内容就用文本编辑器打开。
      // 没有这一步，.bin / .dat 这类二进制会被解码成一屏乱码，还会被当成文本写回。
      if (!knownText && raw && looksBinary(decodeFileText(raw))) {
        return { type: "binary" as const, content: "", mimeType }
      }

      const content = raw ? decodeFileText(raw) : ""

      if (ctx.project.vcs === "git") {
        let diff = yield* gitText(["-c", "core.fsmonitor=false", "diff", "--", file])
        if (!diff.trim()) {
          diff = yield* gitText(["-c", "core.fsmonitor=false", "diff", "--staged", "--", file])
        }
        if (diff.trim()) {
          const original = yield* git.show(ctx.directory, "HEAD", file)
          const patch = structuredPatch(file, file, original, content, "old", "new", {
            context: Infinity,
            ignoreWhitespace: true,
          })
          return { type: "text" as const, content, patch, diff: formatPatch(patch) }
        }
        return { type: "text" as const, content }
      }

      return { type: "text" as const, content }
    })

    const write = Effect.fn("File.write")(function* (file: string, content: string) {
      const ctx = yield* InstanceState.context
      const full = path.join(ctx.directory, file)

      if (!containsPath(full, ctx)) {
        throw new Error("Access denied: path escapes project directory")
      }
      if (isBinaryByExtension(file) && !isTextByName(file)) {
        throw new Error("Cannot edit binary files from the text editor")
      }

      // 写回时沿用磁盘上原有的编码 / BOM / 换行符：textarea 只给 \n，
      // 直接写会把 CRLF 变 LF、BOM 丢掉，GBK 文件还会整篇乱码。
      const existing = yield* appFs.readFile(full).pipe(Effect.catch(() => Effect.succeed(undefined)))
      yield* appFs.writeWithDirs(full, encodeFileText(content, existing)).pipe(Effect.orDie)
    })

    const list = Effect.fn("File.list")(function* (dir?: string) {
      const ctx = yield* InstanceState.context
      const exclude = [".git", ".DS_Store"]
      let ignored = (_: string) => false
      if (ctx.project.vcs === "git") {
        const ig = ignore()
        const gitignore = path.join(ctx.worktree, ".gitignore")
        const gitignoreText = yield* appFs.readFileString(gitignore).pipe(Effect.catch(() => Effect.succeed("")))
        if (gitignoreText) ig.add(gitignoreText)
        const ignoreFile = path.join(ctx.worktree, ".ignore")
        const ignoreText = yield* appFs.readFileString(ignoreFile).pipe(Effect.catch(() => Effect.succeed("")))
        if (ignoreText) ig.add(ignoreText)
        ignored = ig.ignores.bind(ig)
      }

      const resolved = dir ? path.join(ctx.directory, dir) : ctx.directory
      if (!containsPath(resolved, ctx)) {
        throw new Error("Access denied: path escapes project directory")
      }

      const entries = yield* appFs.readDirectoryEntries(resolved).pipe(Effect.orElseSucceed(() => []))

      const nodes: Node[] = []
      for (const entry of entries) {
        if (exclude.includes(entry.name)) continue
        const absolute = path.join(resolved, entry.name)
        const file = path.relative(ctx.directory, absolute)
        const type = entry.type === "directory" ? "directory" : "file"
        nodes.push({
          name: entry.name,
          path: file,
          absolute,
          type,
          ignored: ignored(type === "directory" ? file + "/" : file),
        })
      }
      return nodes.sort((a, b) => {
        if (a.type !== b.type) return a.type === "directory" ? -1 : 1
        return a.name.localeCompare(b.name)
      })
    })

    const search = Effect.fn("File.search")(function* (input: {
      query: string
      limit?: number
      dirs?: boolean
      type?: "file" | "directory"
    }) {
      yield* ensure()
      let { cache } = yield* InstanceState.get(state)

      const query = input.query.trim()
      const limit = input.limit ?? 100
      const kind = input.type ?? (input.dirs === false ? "file" : "all")
      log.info("search", { query, kind })

      const preferHidden = query.startsWith(".") || query.includes("/.")

      if (!query) {
        if (kind === "file") return cache.files.slice(0, limit)
        return sortHiddenLast(cache.dirs.toSorted(), preferHidden).slice(0, limit)
      }

      const searchItems = () => (kind === "file" ? cache.files : kind === "directory" ? cache.dirs : [...cache.files, ...cache.dirs])
      const searchLimit = kind === "directory" && !preferHidden ? limit * 20 : limit
      const runSearch = () => fuzzysort.go(query, searchItems(), { limit: searchLimit }).map((item) => item.target)
      let sorted = runSearch()

      // The initial workspace scan is cached for autocomplete performance, but files
      // can be created externally after that scan (notably an Office fixture or an
      // editor writing a new template). Refresh only a miss so newly-created files
      // become searchable without turning every keystroke into a full disk scan.
      if (sorted.length === 0) {
        yield* scan().pipe(Effect.orDie)
        cache = (yield* InstanceState.get(state)).cache
        sorted = runSearch()
      }
      const output = kind === "directory" ? sortHiddenLast(sorted, preferHidden).slice(0, limit) : sorted

      log.info("search", { query, kind, results: output.length })
      return output
    })

    log.info("init")
    return Service.of({ init, status, read, readMediaRange, write, list, search })
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(Ripgrep.defaultLayer),
  Layer.provide(AppFileSystem.defaultLayer),
  Layer.provide(Git.defaultLayer),
)

export * as File from "."
