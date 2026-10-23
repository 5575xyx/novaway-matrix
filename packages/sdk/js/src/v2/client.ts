export * from "./gen/types.gen.js"

import type { SessionBackgroundResponses, SessionTempFile } from "./gen/types.gen.js"
import type { Background, Eval, TempFiles } from "./gen/sdk.gen.js"

/**
 * Stable aliases for response element types. The generator inlines anonymous
 * schemas under `<Operation>Responses`, which makes them awkward to import from
 * UI code. These aliases keep the old, ergonomic names available.
 */
export type BackgroundJobInfo = SessionBackgroundResponses[200][number]
export type TempFileInfo = SessionTempFile

/**
 * Flattened aliases for nested clients.
 *
 * Operation ids with more than one dot produce nested clients, but existing
 * call sites use the flattened form. Declaring the aliases here keeps both the
 * runtime object and the TypeScript surface consistent.
 */
declare module "./gen/sdk.gen.js" {
  interface Session3 {
    backgroundCancel: Background["cancel"]
    tempFilesList: TempFiles["list"]
    tempFilesClean: TempFiles["clean"]
  }
  interface Knowledge {
    runEval: Eval["run"]
    suggestEvalCases: Eval["suggest"]
    evalHistory: Eval["history"]
    evalDiff: Eval["diff"]
    evalReport: Eval["report"]
  }
}

import { createClient } from "./gen/client/client.gen.js"
import { type Config } from "./gen/client/types.gen.js"
import { OpencodeClient } from "./gen/sdk.gen.js"
import { wrapClientError } from "../error-interceptor.js"
export { type Config as OpencodeClientConfig, OpencodeClient }

function pick(value: string | null, fallback?: string, encode?: (value: string) => string) {
  if (!value) return
  if (!fallback) return value
  if (value === fallback) return fallback
  if (encode && value === encode(fallback)) return fallback
  return value
}

function rewrite(request: Request, values: { directory?: string; workspace?: string }) {
  if (request.method !== "GET" && request.method !== "HEAD") return request

  const url = new URL(request.url)
  let changed = false

  for (const [name, key] of [
    ["x-opencode-directory", "directory"],
    ["x-opencode-workspace", "workspace"],
  ] as const) {
    const value = pick(
      request.headers.get(name),
      key === "directory" ? values.directory : values.workspace,
      key === "directory" ? encodeURIComponent : undefined,
    )
    if (!value) continue
    if (!url.searchParams.has(key)) {
      url.searchParams.set(key, value)
    }
    changed = true
  }

  if (!changed) return request

  const next = new Request(url, request)
  next.headers.delete("x-opencode-directory")
  next.headers.delete("x-opencode-workspace")
  return next
}

export function createOpencodeClient(config?: Config & { directory?: string; experimental_workspaceID?: string }) {
  if (!config?.fetch) {
    const customFetch: any = (req: any) => {
      // @ts-ignore
      req.timeout = false
      return fetch(req)
    }
    config = {
      ...config,
      fetch: customFetch,
    }
  }

  if (config?.directory) {
    config.headers = {
      ...config.headers,
      "x-opencode-directory": encodeURIComponent(config.directory),
    }
  }

  if (config?.experimental_workspaceID) {
    config.headers = {
      ...config.headers,
      "x-opencode-workspace": config.experimental_workspaceID,
    }
  }

  const client = createClient(config)
  client.interceptors.request.use((request) =>
    rewrite(request, {
      directory: config?.directory,
      workspace: config?.experimental_workspaceID,
    }),
  )
  client.interceptors.response.use((response) => {
    const contentType = response.headers.get("content-type")
    if (contentType === "text/html")
      throw new Error("Request is not supported by this version of OpenCode Server (Server responded with text/html)")

    return response
  })
  client.interceptors.error.use(wrapClientError)
  const sdk = new OpencodeClient({ client })

  // Compatibility aliases.
  //
  // The OpenAPI operation ids are dotted (`session.background.cancel`), so the
  // generator produces nested clients. Older UI code calls the flattened form
  // (`client.session.backgroundCancel`). Keep both working.
  //
  // Everything here must stay defensive: the generator renames nested clients
  // whenever a method name collides with a path segment (for example
  // `session.background` became a GET method while the cancel endpoint moved to
  // `session.background2.cancel`). A single missing method used to throw
  // "Cannot read properties of undefined (reading 'bind')" and take down the
  // whole client factory, so we only ever bind things that are really functions.
  const alias = (target: any, key: string, value: unknown) => {
    if (!target || typeof value !== "function") return
    if (key in target) return
    Object.defineProperty(target, key, { value, enumerable: false, configurable: true })
  }

  /** Walk `path` from `source` and return the method bound to its owner. */
  const bound = (source: any, ...path: string[]) => {
    let owner = source
    let value = source
    for (const key of path) {
      if (!owner || (typeof owner !== "object" && typeof owner !== "function")) return undefined
      owner = value
      value = owner[key]
    }
    if (typeof value !== "function" || !owner) return undefined
    return value.bind(owner)
  }

  const session: any = sdk.session
  // `session.background` is the GET list endpoint; the cancel client is nested
  // separately (generator suffix `2`) because the names collide.
  alias(session, "backgroundCancel", bound(session.background2, "cancel") ?? bound(session.background, "cancel"))

  const tempFiles: any = session.tempFiles
  alias(session, "tempFilesList", bound(tempFiles, "list"))
  alias(session, "tempFilesClean", bound(tempFiles, "clean"))

  // Retrieval eval routes live under `knowledge.eval.*` in OpenAPI, which the
  // generator turns into an `Eval` client nested under `knowledge`.
  const knowledge: any = sdk.knowledge
  const evalClient: any = (sdk as any).eval ?? knowledge?.eval
  alias(knowledge, "runEval", bound(evalClient, "run"))
  alias(knowledge, "suggestEvalCases", bound(evalClient, "suggest"))
  alias(knowledge, "evalHistory", bound(evalClient, "history"))
  alias(knowledge, "evalDiff", bound(evalClient, "diff"))
  alias(knowledge, "evalReport", bound(evalClient, "report"))

  return sdk
}
