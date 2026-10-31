import * as InstanceState from "@/effect/instance-state"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../../api"

// Resolve the request's directory + workspace into the canonical location
// descriptor. Shared by every v2 handler that echoes `location` back.
export const resolveLocation = Effect.fn("V2Location.resolve")(function* () {
  const instance = yield* InstanceState.context
  const workspaceID = yield* InstanceState.workspaceID
  return {
    directory: instance.directory,
    ...(workspaceID ? { workspaceID } : {}),
    project: {
      id: instance.project.id,
      directory: instance.project.worktree,
    },
  }
})

export const locationHandlers = HttpApiBuilder.group(InstanceHttpApi, "v2.location", (handlers) =>
  handlers.handle("get", () => resolveLocation()),
)
