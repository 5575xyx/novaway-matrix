import { Evolution } from "@/evolution/service"
import { EvolutionSchema } from "@/evolution/schema"
import { InstanceState } from "@/effect/instance-state"
import { Effect } from "effect"
import { HttpApiBuilder, HttpApiError } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { CandidateQuery, CandidateUpdatePayload, ReviewPayload } from "../groups/evolution"
import { notFound } from "../errors"

export const evolutionHandlers = HttpApiBuilder.group(InstanceHttpApi, "evolution", (handlers) =>
  Effect.gen(function* () {
    const evolution = yield* Evolution.Service

    const projectID = Effect.fn("EvolutionHttpApi.projectID")(function* () {
      return (yield* InstanceState.context).project.id
    })

    const status = Effect.fn("EvolutionHttpApi.status")(function* () {
      return yield* evolution.status({ projectID: yield* projectID() })
    })

    const review = Effect.fn("EvolutionHttpApi.review")(function* (ctx: { payload: typeof ReviewPayload.Type }) {
      if (ctx.payload.proposals.length === 0) return yield* new HttpApiError.BadRequest({})
      return yield* evolution.review({
        ...ctx.payload,
        projectID: yield* projectID(),
      })
    })

    const listCandidates = Effect.fn("EvolutionHttpApi.listCandidates")(function* (ctx: {
      query: typeof CandidateQuery.Type
    }) {
      return yield* evolution.list({
        projectID: yield* projectID(),
        kind: ctx.query.kind,
        status: ctx.query.status,
        limit: ctx.query.limit,
      })
    })

    const applyCandidate = Effect.fn("EvolutionHttpApi.applyCandidate")(function* (ctx: {
      params: { candidateID: EvolutionSchema.EvolutionCandidateID }
    }) {
      const item = yield* evolution.apply(ctx.params.candidateID)
      if (!item) return yield* notFound("Evolution candidate not found")
      return item
    })

    const applyFileCandidate = Effect.fn("EvolutionHttpApi.applyFileCandidate")(function* (ctx: {
      params: { candidateID: EvolutionSchema.EvolutionCandidateID }
    }) {
      const state = yield* InstanceState.context
      const item = yield* evolution.applyToDisk(ctx.params.candidateID, {
        directory: state.directory,
        worktree: state.worktree,
      })
      if (!item) return yield* notFound("Evolution candidate not found")
      return item
    })

    const updateCandidate = Effect.fn("EvolutionHttpApi.updateCandidate")(function* (ctx: {
      params: { candidateID: EvolutionSchema.EvolutionCandidateID }
      payload: typeof CandidateUpdatePayload.Type
    }) {
      const item = yield* evolution.update(ctx.params.candidateID, ctx.payload)
      if (!item) return yield* notFound("Evolution candidate not found")
      return item
    })

    const previewCandidate = Effect.fn("EvolutionHttpApi.previewCandidate")(function* (ctx: {
      params: { candidateID: EvolutionSchema.EvolutionCandidateID }
    }) {
      const item = yield* evolution.preview(ctx.params.candidateID)
      if (!item) return yield* notFound("Evolution candidate not found")
      return item
    })

    const dryRunCandidate = Effect.fn("EvolutionHttpApi.dryRunCandidate")(function* (ctx: {
      params: { candidateID: EvolutionSchema.EvolutionCandidateID }
    }) {
      const state = yield* InstanceState.context
      const item = yield* evolution.dryRun(ctx.params.candidateID, {
        directory: state.directory,
        worktree: state.worktree,
      })
      if (!item) return yield* notFound("Evolution candidate not found")
      return item
    })

    const dismissCandidate = Effect.fn("EvolutionHttpApi.dismissCandidate")(function* (ctx: {
      params: { candidateID: EvolutionSchema.EvolutionCandidateID }
    }) {
      const item = yield* evolution.dismiss(ctx.params.candidateID)
      if (!item) return yield* notFound("Evolution candidate not found")
      return item
    })

    return handlers
      .handle("status", status)
      .handle("review", review)
      .handle("listCandidates", listCandidates)
      .handle("updateCandidate", updateCandidate)
      .handle("previewCandidate", previewCandidate)
      .handle("dryRunCandidate", dryRunCandidate)
      .handle("applyCandidate", applyCandidate)
      .handle("applyFileCandidate", applyFileCandidate)
      .handle("dismissCandidate", dismissCandidate)
  }),
)
