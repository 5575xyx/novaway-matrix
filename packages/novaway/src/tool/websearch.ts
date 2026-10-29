import { Effect, Schema } from "effect"
import { HttpClient } from "effect/unstable/http"
import * as Tool from "./tool"
import * as McpWebSearch from "./mcp-websearch"
import DESCRIPTION from "./websearch.txt"
import { checksum } from "@novaway/core/util/encode"
import { InstallationVersion } from "@novaway/core/installation/version"
import { RuntimeFlags } from "@/effect/runtime-flags"

export const Parameters = Schema.Struct({
  query: Schema.String.annotate({ description: "The search query to use" }),
  allowed_domains: Schema.optional(Schema.Array(Schema.String)).annotate({
    description: "Only include search results from these domains",
  }),
  blocked_domains: Schema.optional(Schema.Array(Schema.String)).annotate({
    description: "Never include search results from these domains",
  }),
  numResults: Schema.optional(Schema.Number).annotate({
    description: "Number of search results to return (default: 8)",
  }),
  livecrawl: Schema.optional(Schema.Literals(["fallback", "preferred"])).annotate({
    description:
      "Live crawl mode - 'fallback': use live crawling as backup if cached content unavailable, 'preferred': prioritize live crawling (default: 'fallback')",
  }),
  type: Schema.optional(Schema.Literals(["auto", "fast", "deep"])).annotate({
    description: "Search type - 'auto': balanced search (default), 'fast': quick results, 'deep': comprehensive search",
  }),
  contextMaxCharacters: Schema.optional(Schema.Number).annotate({
    description: "Maximum characters for context string optimized for LLMs (default: 10000)",
  }),
})

const WebSearchProviderSchema = Schema.Literals(["exa", "parallel"])
export type WebSearchProvider = Schema.Schema.Type<typeof WebSearchProviderSchema>

export function selectWebSearchProvider(sessionID: string, flags = { exa: false, parallel: false }): WebSearchProvider {
  // `OPENCODE_WEBSEARCH_PROVIDER` is the name the CLI docs and older configs
  // use; keep reading it so an existing setup does not silently fall back to
  // the per-session default.
  const override = process.env.NovaWay_WEBSEARCH_PROVIDER ?? process.env.OPENCODE_WEBSEARCH_PROVIDER
  if (override === "exa" || override === "parallel") return override
  if (flags.parallel) return "parallel"
  if (flags.exa) return "exa"

  return Number.parseInt(checksum(sessionID) ?? "0", 36) % 2 === 0 ? "exa" : "parallel"
}

export function webSearchProviderLabel(provider: unknown) {
  if (provider === "parallel") return "Parallel Web Search"
  if (provider === "exa") return "Exa Web Search"
  return "Web Search"
}

export function webSearchModelName(extra: Tool.Context["extra"]) {
  const model = extra?.model
  if (!model || typeof model !== "object") return undefined
  const api = "api" in model && model.api && typeof model.api === "object" ? model.api : undefined
  const apiID = api && "id" in api && typeof api.id === "string" ? api.id : undefined
  const id = "id" in model && typeof model.id === "string" ? model.id : undefined
  return (apiID ?? id)?.slice(0, 100)
}

/**
 * Domain filters without provider-specific flags: push them into the query with
 * `site:` operators. Both backends (Exa and Parallel) understand the operator,
 * whereas passing include/exclude arrays only works on one of them — and an
 * unknown argument makes the MCP call fail instead of filtering.
 */
export function applyDomainFilters(
  query: string,
  allowed?: readonly string[],
  blocked?: readonly string[],
) {
  const clean = (values?: readonly string[]) =>
    (values ?? [])
      .map((value) => value.trim().replace(/^https?:\/\//i, "").replace(/\/.*$/, ""))
      .filter((value) => value.length > 0)
  const only = clean(allowed)
  const never = clean(blocked)
  const parts = [query.trim()]
  if (only.length === 1) parts.push(`site:${only[0]}`)
  if (only.length > 1) parts.push(`(${only.map((domain) => `site:${domain}`).join(" OR ")})`)
  for (const domain of never) parts.push(`-site:${domain}`)
  return parts.join(" ")
}

function parallelAuthHeaders() {
  const headers = { "User-Agent": `NovaWay/${InstallationVersion}` }
  if (!process.env.PARALLEL_API_KEY) return headers
  return { ...headers, Authorization: `Bearer ${process.env.PARALLEL_API_KEY}` }
}

function callProvider(
  http: HttpClient.HttpClient,
  provider: WebSearchProvider,
  params: Schema.Schema.Type<typeof Parameters>,
  ctx: Tool.Context,
) {
  const filtered = applyDomainFilters(params.query, params.allowed_domains, params.blocked_domains)
  if (provider === "parallel") {
    return McpWebSearch.call(
      http,
      McpWebSearch.PARALLEL_URL,
      "web_search",
      McpWebSearch.ParallelSearchArgs,
      {
        objective: filtered,
        search_queries: [filtered],
        session_id: ctx.sessionID,
        model_name: webSearchModelName(ctx.extra),
      },
      "25 seconds",
      parallelAuthHeaders(),
    )
  }

  return McpWebSearch.call(
    http,
    McpWebSearch.EXA_URL,
    "web_search_exa",
    McpWebSearch.SearchArgs,
    {
      query: filtered,
      type: params.type || "auto",
      numResults: params.numResults || 8,
      livecrawl: params.livecrawl || "fallback",
      contextMaxCharacters: params.contextMaxCharacters,
    },
    "25 seconds",
  )
}

export const WebSearchTool = Tool.define(
  "websearch",
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient
    const flags = yield* RuntimeFlags.Service

    return {
      get description() {
        return DESCRIPTION.replace("{{year}}", new Date().getFullYear().toString())
      },
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          if (params.query.trim().length < 2) {
            throw new Error("The search query must be at least 2 characters long.")
          }
          const provider = selectWebSearchProvider(ctx.sessionID, {
            exa: flags.enableExa,
            parallel: flags.enableParallel,
          })
          const title = webSearchProviderLabel(provider)
          yield* ctx.metadata({ title: `${title} "${params.query}"`, metadata: { provider } })

          yield* ctx.ask({
            permission: "websearch",
            patterns: [params.query],
            always: ["*"],
            metadata: {
              query: params.query,
              numResults: params.numResults,
              livecrawl: params.livecrawl,
              type: params.type,
              contextMaxCharacters: params.contextMaxCharacters,
              provider,
            },
          })

          const result = yield* callProvider(http, provider, params, ctx)

          return {
            output: result ?? "No search results found. Please try a different query.",
            title: `${title}: ${params.query}`,
            metadata: { provider },
          }
        }).pipe(Effect.orDie),
    }
  }),
)
