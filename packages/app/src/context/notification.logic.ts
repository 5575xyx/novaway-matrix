export const TEAM_RUN_ATTENTION_STATES = new Set(["done", "partial", "failed", "needs_review", "blocked"])

/** A durable run notification is emitted only on an observed state edge. */
export const shouldNotifyTeamRun = (input: {
  initialized: boolean
  previous?: string
  state: string
}) =>
  input.initialized &&
  input.previous !== undefined &&
  input.previous !== input.state &&
  TEAM_RUN_ATTENTION_STATES.has(input.state)
