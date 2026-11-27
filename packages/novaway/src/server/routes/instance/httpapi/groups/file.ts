import { File } from "@/file"
import { Ripgrep } from "@/file/ripgrep"
import { LSP } from "@/lsp/lsp"
import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import {
  WorkspaceRoutingMiddleware,
  WorkspaceRoutingQuery,
  WorkspaceRoutingQueryFields,
} from "../middleware/workspace-routing"
import { described } from "./metadata"

export const FileQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  path: Schema.String,
  encoding: Schema.optional(Schema.Literal("base64")),
})

export const FindTextQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  pattern: Schema.String,
  /** 最多返回多少条匹配（默认 10，和原来一致）。 */
  limit: Schema.optional(
    Schema.NumberFromString.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(500)),
  ),
})

export const FindFileQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  query: Schema.String,
  dirs: Schema.optional(Schema.Literals(["true", "false"])),
  type: Schema.optional(Schema.Literals(["file", "directory"])),
  limit: Schema.optional(
    Schema.NumberFromString.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(200)),
  ),
})

export const FindSymbolQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  query: Schema.String,
})

export const LspDocumentQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  path: Schema.String,
})

export const LspPositionQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  path: Schema.String,
  line: Schema.NumberFromString.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  character: Schema.NumberFromString.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
})

export const LspDocumentPayload = Schema.Struct({
  path: Schema.String,
  text: Schema.String,
})

export const LspPositionPayload = Schema.Struct({
  path: Schema.String,
  line: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  character: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  text: Schema.String,
})

export const FileWritePayload = Schema.Struct({
  path: Schema.String,
  content: Schema.String,
})

/**
 * base64 预览通道读不到文件时的公开契约。
 *
 * 失败必须是带 code 的错误，不能是 200 + 空 content。
 * 前端按 `code` 选文案（不存在 / 越界 / 类型不支持），所以这里用一个错误类而不是
 * 按状态码拆成 404/403/415 —— 判别信息在 code 里，状态码只是 transport。
 */
export class FileReadError extends Schema.ErrorClass<FileReadError>("FileReadError")(
  {
    name: Schema.Literal("FileReadError"),
    data: Schema.Struct({
      code: File.ReadErrorCode,
      path: Schema.String,
      message: Schema.String,
    }),
  },
  { httpApiStatus: 400 },
) {}

export const fileReadError = (error: File.ReadError) =>
  new FileReadError({ name: "FileReadError", data: { code: error.code, path: error.path, message: error.message } })

export const FilePaths = {
  findText: "/find",
  findFile: "/find/file",
  findSymbol: "/find/symbol",
  lspDiagnostics: "/lsp/diagnostics",
  lspDocumentSymbols: "/lsp/document-symbols",
  lspDefinition: "/lsp/definition",
  list: "/file",
  content: "/file/content",
  write: "/file/write",
  status: "/file/status",
} as const

export const FileApi = HttpApi.make("file")
  .add(
    HttpApiGroup.make("file")
      .add(
        HttpApiEndpoint.get("findText", FilePaths.findText, {
          query: FindTextQuery,
          success: described(Schema.Array(Ripgrep.SearchMatch), "Matches"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "find.text",
            summary: "Find text",
            description: "Search for text patterns across files in the project using ripgrep.",
          }),
        ),
        HttpApiEndpoint.get("findFile", FilePaths.findFile, {
          query: FindFileQuery,
          success: described(Schema.Array(Schema.String), "File paths"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "find.files",
            summary: "Find files",
            description: "Search for files or directories by name or pattern in the project directory.",
          }),
        ),
        HttpApiEndpoint.get("findSymbol", FilePaths.findSymbol, {
          query: FindSymbolQuery,
          success: described(Schema.Array(LSP.Symbol), "Symbols"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "find.symbols",
            summary: "Find symbols",
            description: "Search for workspace symbols like functions, classes, and variables using LSP.",
          }),
        ),
        HttpApiEndpoint.get("lspDiagnostics", FilePaths.lspDiagnostics, {
          query: WorkspaceRoutingQuery,
          success: described(Schema.Record(Schema.String, Schema.Unknown), "LSP diagnostics by file"),
        }),
        HttpApiEndpoint.post("lspDiagnosticsText", FilePaths.lspDiagnostics, {
          query: WorkspaceRoutingQuery,
          payload: LspDocumentPayload,
          success: described(Schema.Record(Schema.String, Schema.Unknown), "LSP diagnostics by file"),
        }),
        HttpApiEndpoint.get("lspDocumentSymbols", FilePaths.lspDocumentSymbols, {
          query: LspDocumentQuery,
          success: described(Schema.Array(Schema.Unknown), "Document symbols"),
        }),
        HttpApiEndpoint.post("lspDocumentSymbolsText", FilePaths.lspDocumentSymbols, {
          query: WorkspaceRoutingQuery,
          payload: LspDocumentPayload,
          success: described(Schema.Array(Schema.Unknown), "Document symbols"),
        }),
        HttpApiEndpoint.get("lspDefinition", FilePaths.lspDefinition, {
          query: LspPositionQuery,
          success: described(Schema.Array(Schema.Unknown), "Definitions"),
        }),
        HttpApiEndpoint.post("lspDefinitionText", FilePaths.lspDefinition, {
          query: WorkspaceRoutingQuery,
          payload: LspPositionPayload,
          success: described(Schema.Array(Schema.Unknown), "Definitions"),
        }),
        HttpApiEndpoint.get("list", FilePaths.list, {
          query: FileQuery,
          success: described(Schema.Array(File.Node), "Files and directories"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "file.list",
            summary: "List files",
            description: "List files and directories in a specified path.",
          }),
        ),
        HttpApiEndpoint.get("content", FilePaths.content, {
          query: FileQuery,
          error: [FileReadError],
          success: described(File.Content, "File content"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "file.read",
            summary: "Read file",
            description:
              "Read the content of a specified file. The base64 channel fails with FileReadError (not empty content) when the path is missing, escapes the project, or is not a binary preview format.",
          }),
        ),
        HttpApiEndpoint.post("write", FilePaths.write, {
          query: WorkspaceRoutingQuery,
          payload: FileWritePayload,
          success: described(Schema.Boolean, "Write succeeded"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "file.write",
            summary: "Write file",
            description: "Write text content to a file in the project directory.",
          }),
        ),
        HttpApiEndpoint.get("status", FilePaths.status, {
          query: WorkspaceRoutingQuery,
          success: described(Schema.Array(File.Info), "File status"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "file.status",
            summary: "Get file status",
            description: "Get the git status of all files in the project.",
          }),
        ),
      )
      .annotateMerge(
        OpenApi.annotations({
          title: "file",
          description: "Experimental HttpApi file routes.",
        }),
      )
      .middleware(InstanceContextMiddleware)
      .middleware(WorkspaceRoutingMiddleware)
      .middleware(Authorization),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "NovaWay experimental HttpApi",
      version: "0.0.1",
      description: "Experimental HttpApi surface for selected instance routes.",
    }),
  )
