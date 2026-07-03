import { Memory } from "@/memory/service"
import { MemorySchema } from "@/memory/schema"
import { InstanceState } from "@/effect/instance-state"
import { Effect } from "effect"
import { HttpApiBuilder, HttpApiError } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { AddPayload, ListQuery, ReviewCandidateQuery, ReviewPayload, UpdatePayload } from "../groups/memory"
import { notFound } from "../errors"

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
    }) {
      const state = yield* InstanceState.context
      const item = yield* memory.applyReviewCandidate(ctx.params.candidateID, {
        directory: state.directory,
        worktree: state.worktree,
      })
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
  }),
)
