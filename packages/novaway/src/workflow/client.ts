import { merge } from "./merge"
import type { State } from "./policy"

export async function updateWithConflictRetry(input: {
  local: State
  base: State
  patch: Partial<Pick<State, "phase" | "route" | "verificationStatus" | "deliveryStatus">>
  update: (expectedRevision: number, patch: Record<string, unknown>) => Promise<State>
  reload: () => Promise<State>
}): Promise<State> {
  try { return await input.update(input.local.revision ?? 0, input.patch) }
  catch {
    const remote = await input.reload()
    const result = merge(input.base, { ...input.local, ...input.patch }, remote)
    return input.update(remote.revision ?? 0, { phase: result.merged.phase, route: result.merged.route, verificationStatus: result.merged.verificationStatus, deliveryStatus: result.merged.deliveryStatus })
  }
}
