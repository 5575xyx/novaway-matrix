import { InstanceRef, WorkspaceRef } from "@/effect/instance-ref"
import { InstanceStore } from "@/project/instance-store"
import { Service as BackgroundResumeService } from "@/background/resume"
import type { Interface as BackgroundResumeInterface } from "@/background/resume"
import { Effect, Layer } from "effect"
import { HttpRouter, HttpServerResponse } from "effect/unstable/http"
import { HttpApiMiddleware } from "effect/unstable/httpapi"
import { WorkspaceRouteContext } from "./workspace-routing"

export class InstanceContextMiddleware extends HttpApiMiddleware.Service<
  InstanceContextMiddleware,
  {
    requires: WorkspaceRouteContext
  }
>()("@NovaWay/ExperimentalHttpApiInstanceContext") {}

function decode(input: string): string {
  try {
    return decodeURIComponent(input)
  } catch {
    return input
  }
}

function provideInstanceContext<E>(
  effect: Effect.Effect<HttpServerResponse.HttpServerResponse, E>,
  store: InstanceStore.Interface,
  resume?: BackgroundResumeInterface,
): Effect.Effect<HttpServerResponse.HttpServerResponse, E, WorkspaceRouteContext> {
  return Effect.gen(function* () {
    const route = yield* WorkspaceRouteContext
    const ctx = yield* store.load({ directory: decode(route.directory) })
    // Restart watchers that were interrupted by a process restart. The service
    // memoizes the pass per instance, so hitting it on every request is a
    // cheap boolean check after the first one.
    if (resume) yield* Effect.forkDetach(resume.restore().pipe(Effect.ignore))
    return yield* effect.pipe(
      Effect.provideService(InstanceRef, ctx),
      Effect.provideService(WorkspaceRef, route.workspaceID),
    )
  })
}

export const instanceContextLayer = Layer.effect(
  InstanceContextMiddleware,
  Effect.gen(function* () {
    const store = yield* InstanceStore.Service
    const resume = yield* BackgroundResumeService
    return InstanceContextMiddleware.of((effect) =>
      provideInstanceContext(effect, store, resume as BackgroundResumeInterface),
    )
  }),
)

export const instanceRouterMiddleware = HttpRouter.middleware()(
  Effect.gen(function* () {
    const store = yield* InstanceStore.Service
    const resume = yield* BackgroundResumeService
    return (effect) => provideInstanceContext(effect, store, resume as BackgroundResumeInterface)
  }),
)
