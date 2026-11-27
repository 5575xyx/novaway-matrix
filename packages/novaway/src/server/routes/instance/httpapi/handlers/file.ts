import * as InstanceState from "@/effect/instance-state"
import { File } from "@/file"
import { Ripgrep } from "@/file/ripgrep"
import { LSP } from "@/lsp/lsp"
import { Effect } from "effect"
import { pathToFileURL } from "node:url"
import path from "node:path"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { fileReadError } from "../groups/file"

export const fileHandlers = HttpApiBuilder.group(InstanceHttpApi, "file", (handlers) =>
  Effect.gen(function* () {
    const svc = yield* File.Service
    const ripgrep = yield* Ripgrep.Service
    const lsp = yield* LSP.Service

    const findText = Effect.fn("FileHttpApi.findText")(function* (ctx: { query: { pattern: string; limit?: number } }) {
      return (yield* ripgrep
        .search({
          cwd: (yield* InstanceState.context).directory,
          pattern: ctx.query.pattern,
          limit: ctx.query.limit ?? 10,
        })
        .pipe(Effect.orDie)).items
    })

    const findFile = Effect.fn("FileHttpApi.findFile")(function* (ctx: {
      query: { query: string; dirs?: "true" | "false"; type?: "file" | "directory"; limit?: number }
    }) {
      return yield* svc.search({
        query: ctx.query.query,
        limit: ctx.query.limit ?? 10,
        dirs: ctx.query.dirs !== "false",
        type: ctx.query.type,
      })
    })

    const findSymbol = Effect.fn("FileHttpApi.findSymbol")(function* (ctx: { query: { query: string } }) {
      return yield* lsp.workspaceSymbol(ctx.query.query)
    })

    const lspDiagnostics = Effect.fn("FileHttpApi.lspDiagnostics")(function* () {
      return yield* lsp.diagnostics()
    })

    const lspDiagnosticsText = Effect.fn("FileHttpApi.lspDiagnosticsText")(function* (ctx: {
      payload: { path: string; text: string }
    }) {
      const directory = (yield* InstanceState.context).directory
      const absolute = path.resolve(directory, ctx.payload.path)
      yield* lsp.touchFile(absolute, "document", ctx.payload.text)
      return yield* lsp.diagnostics()
    })

    const lspDocumentSymbols = Effect.fn("FileHttpApi.lspDocumentSymbols")(function* (ctx: { query: { path: string } }) {
      const directory = (yield* InstanceState.context).directory
      const absolute = path.resolve(directory, ctx.query.path)
      return yield* lsp.documentSymbol(pathToFileURL(absolute).href)
    })

    const lspDocumentSymbolsText = Effect.fn("FileHttpApi.lspDocumentSymbolsText")(function* (ctx: {
      payload: { path: string; text: string }
    }) {
      const directory = (yield* InstanceState.context).directory
      const absolute = path.resolve(directory, ctx.payload.path)
      yield* lsp.touchFile(absolute, "document", ctx.payload.text)
      return yield* lsp.documentSymbol(pathToFileURL(absolute).href)
    })

    const lspDefinition = Effect.fn("FileHttpApi.lspDefinition")(function* (ctx: {
      query: { path: string; line: number; character: number }
    }) {
      const directory = (yield* InstanceState.context).directory
      const absolute = path.resolve(directory, ctx.query.path)
      return yield* lsp.definition({ file: absolute, line: ctx.query.line, character: ctx.query.character })
    })

    const lspDefinitionText = Effect.fn("FileHttpApi.lspDefinitionText")(function* (ctx: {
      payload: { path: string; line: number; character: number; text: string }
    }) {
      const directory = (yield* InstanceState.context).directory
      const absolute = path.resolve(directory, ctx.payload.path)
      yield* lsp.touchFile(absolute, "document", ctx.payload.text)
      return yield* lsp.definition({ file: absolute, line: ctx.payload.line, character: ctx.payload.character })
    })


    const list = Effect.fn("FileHttpApi.list")(function* (ctx: { query: { path: string } }) {
      return yield* svc.list(ctx.query.path)
    })

    const content = Effect.fn("FileHttpApi.content")(function* (ctx: { query: { path: string; encoding?: "base64" } }) {
      return yield* svc.read(ctx.query.path, { encoding: ctx.query.encoding }).pipe(Effect.mapError(fileReadError))
    })

    const write = Effect.fn("FileHttpApi.write")(function* (ctx: { payload: { path: string; content: string } }) {
      yield* svc.write(ctx.payload.path, ctx.payload.content)
      return true
    })

    const status = Effect.fn("FileHttpApi.status")(function* () {
      return yield* svc.status()
    })

    return handlers
      .handle("findText", findText)
      .handle("findFile", findFile)
      .handle("findSymbol", findSymbol)
      .handle("lspDiagnostics", lspDiagnostics)
      .handle("lspDiagnosticsText", lspDiagnosticsText)
      .handle("lspDocumentSymbols", lspDocumentSymbols)
      .handle("lspDocumentSymbolsText", lspDocumentSymbolsText)
      .handle("lspDefinition", lspDefinition)
      .handle("lspDefinitionText", lspDefinitionText)
      .handle("list", list)
      .handle("content", content)
      .handle("write", write)
      .handle("status", status)
  }),
)
