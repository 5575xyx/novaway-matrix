import { Effect } from "effect"
import { HttpApiBuilder, HttpApiError } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { ExtensionInfo } from "../groups/extension"
import { Service as ExtensionService } from "@/extension/registry"
import * as Marketplace from "@/extension/marketplace"
import * as Catalog from "@/extension/catalog"
import type { Loaded } from "@/extension/schema"

type Change = "added" | "removed" | "upgraded" | "downgraded" | "changed" | "unchanged"

const toInfo = (
  item: Loaded,
  issues?: Array<{ severity: "error" | "warning"; code: string; message: string }>,
  status?: Change,
) => ({
  name: item.name,
  version: item.manifest.version,
  description: item.manifest.description,
  root: item.root,
  source: item.source,
  enabled: item.enabled,
  ...(item.error ? { error: item.error } : {}),
  ...(issues && issues.length > 0 ? { issues } : {}),
  ...(status ? { status } : {}),
})

export const extensionHandlers = HttpApiBuilder.group(InstanceHttpApi, "extension", (handlers) =>
  Effect.gen(function* () {
    const extensions = yield* ExtensionService

    return handlers
      .handle("list", () =>
        Effect.gen(function* () {
          const list = yield* extensions.list()
          const issues = yield* extensions.issues()
          const changes = yield* extensions.changes()
          return list.map((item) => toInfo(item, issues[item.name], changes[item.name]))
        }),
      )
      .handle("contributions", () =>
        Effect.gen(function* () {
          const list = yield* extensions.contributions()
          return list.map((item) => ({
            extension: item.extension,
            root: item.root,
            kind: item.kind,
            ...(item.kind === "mcp" ? { name: item.name } : {}),
            ...("path" in item ? { path: item.path } : {}),
          }))
        }),
      )
      .handle("reload", () =>
        Effect.gen(function* () {
          const list = yield* extensions.reload()
          const issues = yield* extensions.issues()
          const changes = yield* extensions.changes()
          return list.map((item) => toInfo(item, issues[item.name], changes[item.name]))
        }),
      )
      .handle("marketplace", () =>
        Effect.gen(function* () {
          // `Effect.promise` rejects become defects, and `Effect.catch` only
          // handles typed failures. Every network/filesystem step here must use
          // `catchCause` or the whole route 500s when the marketplace is
          // unreachable (offline, blocked registry, slow CDN).
          const installed = yield* Effect.promise(() => Marketplace.list()).pipe(
            Effect.catchCause(() => Effect.succeed([] as Marketplace.Installed[])),
          )
          const errors: string[] = []
          const load = (urls: readonly string[]) =>
            Effect.promise(() => Marketplace.manifest(urls)).pipe(
              Effect.catchCause((cause) => {
                errors.push(String(cause).slice(0, 300))
                return Effect.succeed(undefined as unknown)
              }),
            )
          const zcode = yield* load(Catalog.ZCODE_MARKETPLACE_URLS)
          const claude = yield* load(Catalog.CLAUDE_MARKETPLACE_URLS)
          return {
            installed,
            zcode: Catalog.parseZcode(zcode),
            claude: Catalog.parseClaude(claude),
            errors,
          }
        }),
      )
      .handle("install", (ctx) =>
        Effect.gen(function* () {
          const input = ctx.payload
          const installed =
            input.kind === "zip"
              ? yield* Effect.promise(() =>
                  Marketplace.installZip({
                    name: input.name,
                    url: input.url,
                    version: input.version,
                    sha256: input.sha256,
                  }),
                )
              : yield* Effect.promise(() =>
                  Marketplace.installGit({
                    name: input.name,
                    url: input.url,
                    ref: input.ref,
                    subdir: input.subdir,
                    version: input.version,
                  }),
                )
          yield* extensions.reload()
          return installed
        }).pipe(
          Effect.catchCause((cause) =>
            Effect.fail(
              new HttpApiError.BadRequest({
                message: String(cause).slice(0, 400),
              } as never),
            ),
          ),
        ),
      )
      .handle("uninstall", (ctx) =>
        Effect.gen(function* () {
          const removed = yield* Effect.promise(() => Marketplace.remove(ctx.params.name))
          if (!removed) return yield* Effect.fail(new HttpApiError.NotFound({}))
          yield* extensions.reload()
          return true
        }).pipe(Effect.catchCause(() => Effect.fail(new HttpApiError.BadRequest({})))),
      )
      .handle("integrity", (ctx) =>
        Effect.gen(function* () {
          const list = yield* extensions.list()
          const match = list.find((item) => item.name === ctx.params.name)
          if (!match) return null
          const print = yield* extensions.integrity(ctx.params.name)
          if (!print) return null
          return { name: match.name, root: match.root, ...print }
        }),
      )
      .handle("toggle", (ctx) =>
        Effect.gen(function* () {
          yield* extensions.setEnabled(ctx.params.name, ctx.payload.enabled)
          const list = yield* extensions.list()
          const match = list.find((item) => item.name === ctx.params.name)
          if (!match) return yield* Effect.fail(new HttpApiError.NotFound({}))
          const issues = yield* extensions.issues()
          const changes = yield* extensions.changes()
          return toInfo(match, issues[match.name], changes[match.name])
        }),
      )
  }),
)
