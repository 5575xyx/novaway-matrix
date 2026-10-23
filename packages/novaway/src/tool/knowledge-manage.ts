import { KnowledgeStore } from "@/knowledge"
import { InstanceState } from "@/effect/instance-state"
import { formatSetupReport, setupFailure, type SetupReport, type SetupStepView } from "@/setup/report"
import { Effect, Schema } from "effect"
import * as Tool from "./tool"

/**
 * 知识库管理（对话里直接查 / 建 / 加 / 删）。
 *
 * `knowledge_search` 只负责检索，这个工具补上写侧：集合列表、建集合、加文档、删文档。
 * 全部走 KnowledgeStore，与设置页同一套存储，写完立刻能被检索到。
 */
type KnowledgeMetadata = {
  collections: number
  documents: number
}

const Parameters = Schema.Struct({
  action: Schema.optional(
    Schema.Literals(["status", "documents", "create-collection", "add", "remove", "remove-collection"]),
  ).annotate({
    description:
      "status (default) lists collections; documents lists documents in one collection; create-collection creates one; add stores a text document; remove deletes a document; remove-collection deletes a collection.",
  }),
  collection: Schema.optional(Schema.String).annotate({
    description: "Collection name or id. Required for documents/add/remove/remove-collection.",
  }),
  title: Schema.optional(Schema.String).annotate({ description: "Document title (used as its name)." }),
  content: Schema.optional(Schema.String).annotate({ description: "Document content, plain text or markdown." }),
  documentID: Schema.optional(Schema.String).annotate({ description: "Document id for action=remove." }),
  description: Schema.optional(Schema.String).annotate({
    description: "Collection description for create-collection.",
  }),
  scope: Schema.optional(Schema.Literals(["global", "project"])).annotate({
    description: "Collection scope for create-collection. Defaults to global.",
  }),
})

const MAX_CONTENT = 2_000_000

function step(name: string, status: string, detail?: string): SetupStepView {
  return { step: name, status, ...(detail ? { detail } : {}) }
}

export const KnowledgeManageTool = Tool.define(
  "knowledge_manage",
  Effect.gen(function* () {
    return {
      description: [
        "Manage the local knowledge base: list collections, list documents, create a collection, add a text document, delete a document or a collection.",
        "Use it when the user says things like 'add this to my knowledge base', 'which collections do I have', or 'delete that doc'.",
        "Searching is handled by knowledge_search; this tool is for inspecting and changing the data.",
        "Documents are plain text or markdown. For binaries (PDF/DOCX/images) ask the user to import them from the Knowledge page instead.",
        "Deleting is destructive: confirm with the user before calling remove or remove-collection.",
      ].join(" "),
      parameters: Parameters,
      execute: (
        params: Schema.Schema.Type<typeof Parameters>,
        ctx: Tool.Context,
      ): Effect.Effect<Tool.ExecuteResult<KnowledgeMetadata>> =>
        Effect.gen(function* () {
          const instance = yield* InstanceState.context
          const projectID = instance.project.id

          const collections = yield* Effect.promise(() => KnowledgeStore.listCollections())
          const visible = collections.filter((item) => item.scope !== "project" || item.projectID === projectID)

          const resolve = (value: string | undefined) => {
            const target = value?.trim()
            if (!target) return undefined
            return visible.find((item) => item.id === target || item.name === target)
          }

          if ((params.action ?? "status") === "status") {
            const report: SetupReport = {
              domain: "knowledge",
              ready: visible.length > 0,
              phase: visible.length > 0 ? "ready" : "empty",
              summary:
                visible.length === 0
                  ? "知识库还是空的。"
                  : visible.length +
                    " 个集合，共 " +
                    visible.reduce((sum, item) => sum + item.documentCount, 0) +
                    " 篇文档",
              steps: visible.map((item) =>
                step(
                  item.name,
                  item.enabled === false ? "disabled" : "active",
                  [
                    "id=" + item.id,
                    "documents=" + item.documentCount,
                    item.scope === "project" ? "project" : "global",
                    item.description,
                  ]
                    .filter(Boolean)
                    .join(", "),
                ),
              ),
              next:
                visible.length === 0 ? "用 action=create-collection 建一个集合，再用 action=add 加文档。" : undefined,
            }
            return {
              title: "Knowledge collections",
              metadata: {
                collections: visible.length,
                documents: visible.reduce((sum, item) => sum + item.documentCount, 0),
              },
              output: formatSetupReport(report),
            }
          }

          if (params.action === "create-collection") {
            const name = params.collection?.trim()
            if (!name) throw new Error("action=create-collection 需要 collection（用作集合名）")
            if (visible.some((item) => item.name === name)) throw new Error("已存在同名集合：" + name)

            yield* ctx.ask({
              permission: "knowledge_manage",
              patterns: ["create-collection:" + name],
              always: ["*"],
              metadata: { action: "create-collection", name },
            })

            const created = yield* Effect.promise(() =>
              KnowledgeStore.createCollection({
                name,
                ...(params.description?.trim() ? { description: params.description.trim() } : {}),
                ...(params.scope === "project" ? { scope: "project" as const, projectID } : {}),
              }),
            )
            return {
              title: "Collection created",
              metadata: { collections: visible.length + 1, documents: 0 },
              output: formatSetupReport({
                domain: "knowledge",
                ready: true,
                phase: "created",
                summary: "已创建集合 " + created.name,
                facts: { id: created.id, scope: params.scope === "project" ? "project" : "global" },
              }),
            }
          }

          const collection = resolve(params.collection)
          if (!collection) throw new Error("找不到集合：" + (params.collection ?? "（未提供）"))

          if (params.action === "documents") {
            const docs = yield* Effect.promise(() => KnowledgeStore.listDocuments(collection.id))
            return {
              title: "Knowledge documents",
              metadata: { collections: 1, documents: docs.length },
              output: formatSetupReport({
                domain: "knowledge",
                ready: true,
                phase: "ready",
                summary: collection.name + " 有 " + docs.length + " 篇文档",
                steps: docs.map((item) => step(item.title, "document", "id=" + item.id)),
              }),
            }
          }

          if (params.action === "add") {
            const title = params.title?.trim()
            if (!title) throw new Error("action=add 需要 title")
            const content = params.content ?? ""
            if (!content.trim()) throw new Error("action=add 需要 content")
            if (content.length > MAX_CONTENT) throw new Error("content 太大了（上限 " + MAX_CONTENT + " 字符）")

            yield* ctx.ask({
              permission: "knowledge_manage",
              patterns: ["add:" + collection.name],
              always: ["*"],
              metadata: { action: "add", collection: collection.name, title },
            })

            const result = yield* Effect.promise(() =>
              KnowledgeStore.addDocumentFromFile(collection.id, {
                name: title.endsWith(".md") || title.endsWith(".txt") ? title : title + ".md",
                data: Buffer.from(content, "utf8"),
              }),
            )
            if (!result.document) {
              throw new Error(
                setupFailure({
                  domain: "knowledge",
                  ready: false,
                  phase: "failed",
                  summary: "文档没有入库。",
                  error: result.warning,
                  next: "检查内容是否为空；二进制文件请到知识库页面导入。",
                }),
              )
            }
            return {
              title: "Document added",
              metadata: { collections: 1, documents: 1 },
              output: formatSetupReport({
                domain: "knowledge",
                ready: true,
                phase: "added",
                summary:
                  (result.duplicate ? "已存在相同内容，跳过：" : result.updated ? "已更新文档：" : "已添加文档：") +
                  result.document.title,
                facts: {
                  collection: collection.name,
                  id: result.document.id,
                  characters: String(result.document.content.length),
                },
                next: "现在可以调用 knowledge_search 检索它。",
              }),
            }
          }

          if (params.action === "remove" || params.action === "remove-collection") {
            if (params.action === "remove" && !params.documentID?.trim()) {
              const docs = yield* Effect.promise(() => KnowledgeStore.listDocuments(collection.id))
              throw new Error(
                "action=remove 需要 documentID。当前文档：" +
                  (docs.map((item) => item.id + "=" + item.title).join(", ") || "none"),
              )
            }

            yield* ctx.ask({
              permission: "knowledge_manage",
              patterns: [
                params.action === "remove"
                  ? "remove:" + collection.name + "/" + params.documentID
                  : "remove-collection:" + collection.name,
              ],
              always: ["*"],
              metadata: {
                action: params.action,
                collection: collection.name,
                documentID: params.documentID,
              },
            })

            if (params.action === "remove") {
              const ok = yield* Effect.promise(() => KnowledgeStore.removeDocument(collection.id, params.documentID!))
              if (!ok) throw new Error("删除失败：找不到文档 " + params.documentID)
              return {
                title: "Document removed",
                metadata: { collections: 1, documents: 1 },
                output: "已从 " + collection.name + " 删除文档 " + params.documentID,
              }
            }

            const ok = yield* Effect.promise(() => KnowledgeStore.removeCollection(collection.id))
            return {
              title: "Collection removed",
              metadata: { collections: Math.max(visible.length - 1, 0), documents: 0 },
              output: ok ? "已删除集合 " + collection.name : "删除失败：集合不存在",
            }
          }

          throw new Error("未知 action：" + params.action)
        }),
    }
  }),
)
