import { Memory } from "@/memory/service"
import { MemorySchema } from "@/memory/schema"
import { InstanceState } from "@/effect/instance-state"
import { Effect } from "effect"
import { HttpApiBuilder, HttpApiError } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import {
  AddPayload,
  EmbeddingSetupLocalPayload,
  ListQuery,
  RelationListQuery,
  ReviewCandidateQuery,
  ReviewPayload,
  UpdatePayload,
} from "../groups/memory"
import { notFound } from "../errors"
import { Config } from "@/config/config"
import { ConfigMemory } from "@/config/memory"
import { clearEmbedderCache, resolveEmbedder } from "@/memory/embedder"
import { inspectOllama, setupLocalEmbedding } from "@/memory/ollama-setup"

export const memoryHandlers = HttpApiBuilder.group(InstanceHttpApi, "memory", (handlers) =>
  Effect.gen(function* () {
    const memory = yield* Memory.Service

    const projectID = Effect.fn("MemoryHttpApi.projectID")(function* () {
      return (yield* InstanceState.context).project.id
    })

    const list = Effect.fn("MemoryHttpApi.list")(function* (ctx: { query: typeof ListQuery.Type }) {
      return yield* memory.list({
        projectID: yield* projectID(),
        target: ctx.query.target,
        scope: ctx.query.scope,
        search: ctx.query.search,
        includeArchived: ctx.query.includeArchived,
        limit: ctx.query.limit,
      })
    })

    const status = Effect.fn("MemoryHttpApi.status")(function* () {
      return yield* memory.status({ projectID: yield* projectID() })
    })

    const reviewStatus = Effect.fn("MemoryHttpApi.reviewStatus")(function* () {
      return yield* memory.reviewStatus({ projectID: yield* projectID() })
    })

    const add = Effect.fn("MemoryHttpApi.add")(function* (ctx: { payload: typeof AddPayload.Type }) {
      if (!ctx.payload.content.trim()) return yield* new HttpApiError.BadRequest({})
      const state = yield* InstanceState.context
      return yield* memory.add({
        ...ctx.payload,
        projectID: yield* projectID(),
        source: ctx.payload.source ?? "manual",
        location: {
          directory: state.directory,
          worktree: state.worktree,
        },
      })
    })

    const review = Effect.fn("MemoryHttpApi.review")(function* (ctx: { payload: typeof ReviewPayload.Type }) {
      if (!ctx.payload.userContent.trim()) return yield* new HttpApiError.BadRequest({})
      return yield* memory.review({
        ...ctx.payload,
        projectID: yield* projectID(),
      })
    })

    const listReviewCandidates = Effect.fn("MemoryHttpApi.listReviewCandidates")(function* (ctx: {
      query: typeof ReviewCandidateQuery.Type
    }) {
      return yield* memory.listReviewCandidates({
        projectID: yield* projectID(),
        status: ctx.query.status,
        limit: ctx.query.limit,
      })
    })

    const applyReviewCandidate = Effect.fn("MemoryHttpApi.applyReviewCandidate")(function* (ctx: {
      params: { candidateID: MemorySchema.ReviewCandidateID }
      payload?: { scope?: MemorySchema.Scope }
    }) {
      const state = yield* InstanceState.context
      const item = yield* memory.applyReviewCandidate(
        ctx.params.candidateID,
        {
          directory: state.directory,
          worktree: state.worktree,
        },
        { scope: ctx.payload?.scope },
      )
      if (!item) return yield* notFound("Memory review candidate not found")
      return item
    })

    const dismissReviewCandidate = Effect.fn("MemoryHttpApi.dismissReviewCandidate")(function* (ctx: {
      params: { candidateID: MemorySchema.ReviewCandidateID }
    }) {
      const item = yield* memory.dismissReviewCandidate(ctx.params.candidateID)
      if (!item) return yield* notFound("Memory review candidate not found")
      return item
    })

    const update = Effect.fn("MemoryHttpApi.update")(function* (ctx: {
      params: { memoryID: MemorySchema.MemoryID }
      payload: typeof UpdatePayload.Type
    }) {
      const item = yield* memory.update({ ...ctx.payload, id: ctx.params.memoryID })
      if (!item) return yield* notFound("Memory entry not found")
      return item
    })

    const remove = Effect.fn("MemoryHttpApi.remove")(function* (ctx: { params: { memoryID: MemorySchema.MemoryID } }) {
      const removed = yield* memory.remove(ctx.params.memoryID)
      if (!removed) return yield* notFound("Memory entry not found")
      return true
    })

    const listRelations = Effect.fn("MemoryHttpApi.listRelations")(function* (ctx: {
      query: typeof RelationListQuery.Type
    }) {
      return yield* memory.listRelations({
        projectID: yield* projectID(),
        entity: ctx.query.entity,
        relation: ctx.query.relation,
        includeArchived: ctx.query.includeArchived,
        limit: ctx.query.limit,
      })
    })

    const relationsForMemory = Effect.fn("MemoryHttpApi.relationsForMemory")(function* (ctx: {
      params: { memoryID: MemorySchema.MemoryID }
    }) {
      return yield* memory.relationsForMemory(ctx.params.memoryID)
    })

    const addRelation = Effect.fn("MemoryHttpApi.addRelation")(function* (ctx: {
      payload: MemorySchema.ManualRelationInput
    }) {
      const relation = yield* memory.addRelation(ctx.payload)
      if (!relation) return yield* notFound("Memory entry not found")
      return relation
    })

    const removeRelation = Effect.fn("MemoryHttpApi.removeRelation")(function* (ctx: {
      params: { relationID: MemorySchema.RelationID }
    }) {
      return yield* memory.removeRelation(ctx.params.relationID)
    })

    const embeddingStatus = Effect.fn("MemoryHttpApi.embeddingStatus")(function* () {
      const config = yield* Config.Service
      const cfg = ConfigMemory.resolve((yield* config.get()).memory)
      const ollama = yield* Effect.promise(() =>
        inspectOllama({
          baseURL: cfg.embedding_ollama_url,
          preferredModel: cfg.embedding_ollama_model,
          installDir: cfg.embedding_ollama_install_dir,
          modelsDir: cfg.embedding_ollama_models_dir,
        }),
      )
      const backend = yield* Effect.promise(() => resolveEmbedder(cfg, { force: true }))
      return {
        ...ollama,
        activeBackendLabel: backend.label,
        activeBackendKind: backend.kind,
        activeBackendModelId: backend.modelId,
      }
    })

    const embeddingSetupLocal = Effect.fn("MemoryHttpApi.embeddingSetupLocal")(function* (ctx: {
      payload: typeof EmbeddingSetupLocalPayload.Type
    }) {
      const config = yield* Config.Service
      const current = yield* config.get()
      const memoryCfg = ConfigMemory.resolve(current.memory)
      const result = yield* Effect.promise(() =>
        setupLocalEmbedding({
          allowInstall: ctx.payload.allowInstall ?? true,
          model: ctx.payload.model || memoryCfg.embedding_ollama_model || undefined,
          baseURL: ctx.payload.baseURL || memoryCfg.embedding_ollama_url,
          installDir: ctx.payload.installDir || memoryCfg.embedding_ollama_install_dir,
          modelsDir: ctx.payload.modelsDir || memoryCfg.embedding_ollama_models_dir,
        }),
      )

      if (result.ok && result.config && ctx.payload.applyConfig !== false) {
        // Persist embedding backend choice into project/global effective config via update API surface.
        // Handlers here only return suggested config; UI applies through existing updateConfig.
      }

      clearEmbedderCache()
      const backend = yield* Effect.promise(() =>
        resolveEmbedder(
          ConfigMemory.resolve({
            ...memoryCfg,
            ...(result.config ?? {}),
          }),
          { force: true },
        ),
      )
      return {
        ok: result.ok,
        steps: result.steps,
        config: result.config,
        status: {
          ...result.status,
          activeBackendLabel: backend.label,
          activeBackendKind: backend.kind,
          activeBackendModelId: backend.modelId,
        },
      }
    })

    return handlers
      .handle("list", list)
      .handle("status", status)
      .handle("add", add)
      .handle("reviewStatus", reviewStatus)
      .handle("review", review)
      .handle("listReviewCandidates", listReviewCandidates)
      .handle("applyReviewCandidate", applyReviewCandidate)
      .handle("dismissReviewCandidate", dismissReviewCandidate)
      .handle("update", update)
      .handle("remove", remove)
      .handle("listRelations", listRelations)
      .handle("relationsForMemory", relationsForMemory)
      .handle("addRelation", addRelation)
      .handle("removeRelation", removeRelation)
      .handle("embeddingStatus", embeddingStatus)
      .handle("embeddingSetupLocal", embeddingSetupLocal)
  }),
)
