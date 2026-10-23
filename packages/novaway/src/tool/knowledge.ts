import { KnowledgeStore } from "@/knowledge"
import { Config } from "@/config/config"
import { ConfigMemory } from "@/config/memory"
import { resolveEmbedder, type ResolvedEmbedder } from "@/memory/embedder"
import { PositiveInt } from "@novaway/core/schema"
import { Effect, Schema } from "effect"
import * as Tool from "./tool"

const Parameters = Schema.Struct({
  action: Schema.optional(Schema.Literals(["search", "list"])).annotate({
    description: "search (default) queries documents; list returns the available collections and their sizes.",
  }),
  query: Schema.optional(Schema.String).annotate({
    description: "Keywords or a natural-language question to search for.",
  }),
  collection: Schema.optional(Schema.String).annotate({
    description: "Collection name or id. Omit to search every collection.",
  }),
  limit: Schema.optional(PositiveInt).annotate({ description: "Maximum number of hits (default 8)." }),
})

export const KnowledgeTool = Tool.define(
  "knowledge_search",
  Effect.gen(function* () {
    const config = yield* Config.Service

    const embedder = Effect.fnUntraced(function* () {
      const cfg = yield* config.get()
      return yield* Effect.promise(() => resolveEmbedder(ConfigMemory.resolve(cfg.memory)))
    })

    return {
      description: [
        "Search the user's local knowledge base (documents and notes they added in NovaWay).",
        "Use this when the task references internal docs, specs, runbooks, product notes, or policies that are not in the repository.",
        "Always answer from the returned snippets and cite them by their number, e.g. [1], so the user can trace the source.",
        "If the knowledge base has nothing relevant, say so instead of guessing.",
      ].join(" "),
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const collections = yield* Effect.promise(() => KnowledgeStore.listCollections())

          // list：让模型先知道有哪些集合，避免盲目搜索或传错集合名。
          if (params.action === "list") {
            const overview = yield* Effect.promise(() => KnowledgeStore.overview())
            return {
              title: "Knowledge collections",
              metadata: {
                count: collections.length,
                query: "",
                collection: undefined,
                citations: [] as Array<{ index: number; title: string; documentID: string; collectionID: string }>,
                hits: [] as Array<{
                  title: string
                  snippet: string
                  score: number
                  documentID: string
                  collectionID: string
                }>,
              },
              output:
                collections.length === 0
                  ? "The knowledge base is empty."
                  : [
                      "collections: " + collections.length + ", documents: " + overview.documents,
                      ...collections.map(
                        (item) => "- " + item.name + " (id: " + item.id + ", documents: " + item.documentCount + ")",
                      ),
                    ].join(String.fromCharCode(10)),
            }
          }

          const query = params.query?.trim()
          if (!query) throw new Error("query is required for knowledge search")
          const vector: ResolvedEmbedder | undefined = yield* embedder().pipe(
            Effect.catchCause(() => Effect.succeed(undefined)),
          )
          const target = params.collection?.trim()
          const collection = target ? collections.find((item) => item.id === target || item.name === target) : undefined
          if (target && !collection) {
            return {
              title: "Knowledge search",
              metadata: {
                count: 0,
                query: query,
                collection: target,
                citations: [] as Array<{ index: number; title: string; documentID: string; collectionID: string }>,
                hits: [] as Array<{
                  title: string
                  snippet: string
                  score: number
                  documentID: string
                  collectionID: string
                }>,
              },
              output: `Knowledge collection not found: ${target}. Available: ${
                collections.map((item) => item.name).join(", ") || "(none)"
              }`,
            }
          }

          // 未指定集合时按会话挂载检索；挂载为空就等于全局检索。
          const hits = yield* Effect.promise(() =>
            collection
              ? KnowledgeStore.search({
                  query: query,
                  collectionID: collection.id,
                  limit: params.limit ?? 8,
                  embedder: vector,
                  expand: true,
                })
              : KnowledgeStore.searchForSession({
                  sessionID: ctx.sessionID,
                  query: query,
                  limit: params.limit ?? 8,
                  embedder: vector,
                }),
          )

          if (hits.length === 0) {
            return {
              title: "Knowledge search",
              metadata: {
                count: 0,
                query: query,
                collection: collection?.name,
                citations: [] as Array<{ index: number; title: string; documentID: string; collectionID: string }>,
                hits: [] as Array<{
                  title: string
                  snippet: string
                  score: number
                  documentID: string
                  collectionID: string
                }>,
              },
              output: `No knowledge base results for: ${query}`,
            }
          }

          const names = new Map(collections.map((item) => [item.id, item.name]))
          const output = hits
            .map((hit, index) => {
              const name = names.get(hit.collectionID) ?? hit.collectionID
              return [
                `### [${index + 1}] ${hit.title}`,
                `collection: ${name}`,
                `document: ${hit.documentID}`,
                `score: ${hit.score.toFixed(3)}`,
                "",
                hit.snippet,
              ].join("\n")
            })
            .join("\n\n")

          return {
            title: `Knowledge: ${query}`,
            metadata: {
              count: hits.length,
              query: query,
              collection: collection?.name,
              // hits 供工具行展示摘要；citations 供点击跳转原文。
              hits: hits.map((hit) => ({
                title: hit.title,
                snippet: hit.snippet,
                score: hit.score,
                documentID: hit.documentID,
                collectionID: hit.collectionID,
                via: hit.via,
              })),
              citations: hits.map((hit, index) => ({
                index: index + 1,
                title: hit.title,
                documentID: hit.documentID,
                collectionID: hit.collectionID,
                chunk: hit.chunk,
                snippet: hit.snippet,
              })),
            },
            output,
          }
        }),
    }
  }),
)
