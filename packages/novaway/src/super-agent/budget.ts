import type { Budget } from "./types"

export class BudgetExceeded extends Error {
  constructor(
    readonly dimension: keyof Budget,
    readonly limit: number,
    readonly requested: number,
  ) {
    super(`Super-Agent budget exceeded for ${dimension}: ${requested} > ${limit}`)
  }
}

const dimensions = ["tokens", "usd", "wallTimeMs", "steps", "toolCalls", "childAgents"] as const

export function addBudget(left: Budget, right: Budget): Budget {
  return Object.fromEntries(
    dimensions.flatMap((key) =>
      left[key] !== undefined || right[key] !== undefined ? [[key, (left[key] ?? 0) + (right[key] ?? 0)]] : [],
    ),
  )
}

export function assertWithinBudget(limit: Budget, used: Budget, requested: Budget) {
  const total = addBudget(used, requested)
  for (const dimension of dimensions) {
    if (limit[dimension] !== undefined && (total[dimension] ?? 0) > limit[dimension]!)
      throw new BudgetExceeded(dimension, limit[dimension]!, total[dimension] ?? 0)
  }
  return total
}
