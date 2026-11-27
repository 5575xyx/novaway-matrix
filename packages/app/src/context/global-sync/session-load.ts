import type { Session } from "@novaway/sdk/v2/client"
import type { RootLoadArgs } from "./types"

export class SessionListError extends Error {
  constructor(readonly status: number) {
    super(`Session list returned HTTP ${status}`)
  }
}

export async function loadRootSessionsWithFallback(input: RootLoadArgs) {
  try {
    const result = await input.list({ directory: input.directory, roots: true, limit: input.limit })
    return {
      data: result.data,
      limit: input.limit,
      limited: true,
    } as const
  } catch (error) {
    // A failed connection is not evidence that pagination is unsupported.
    // Never retry with an unbounded history query on timeout or a 5xx.
    if (!(error instanceof SessionListError) || (error.status !== 400 && error.status !== 422)) throw error
    const result = await input.list({ directory: input.directory, roots: true })
    return {
      data: result.data,
      limit: input.limit,
      limited: false,
    } as const
  }
}

export function estimateRootSessionTotal(input: { count: number; limit: number; limited: boolean }) {
  if (!input.limited) return input.count
  if (input.count < input.limit) return input.count
  return input.count + 1
}

/** Local summaries are provisional, including when newer session metadata arrived first. */
export function hydrateStartupSessionRows(cached: Session[], current: Session[], verified: boolean) {
  if (verified || cached.length === 0) return
  const byId = new Map(cached.map((row) => [row.id, row]))
  for (const row of current) byId.set(row.id, row)
  return [...byId.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}
