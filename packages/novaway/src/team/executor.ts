/**
 * 统一执行者领域模型。
 *
 * Team、TeamProfile 和 Employee 仍保留各自的存储与生命周期：运行中的 Team 不能被
 * 误当成可复用模板，Employee 也不能被当成一个团队。但它们在目录、授权和 UI 投影
 * 中必须使用同一个执行者模型，避免每个入口重新判断「这是哪种专家」。
 */
export type ExecutorSource = "runtime-team" | "profile" | "employee"

export type ExecutorTeam = {
  kind: "team"
  source: Exclude<ExecutorSource, "employee">
  id: string
  name: string
  description?: string
  capabilities: string[]
  scenarios: string[]
  memberCount: number
  memberPreview: Array<{ name: string; role: string }>
  autoEligible: boolean
}

export type ExecutorExpert = {
  kind: "expert"
  source: "employee"
  id: string
  name: string
  role?: string
  category?: string
  description?: string
  capabilities?: string[]
  available: boolean
}

export type Executor = ExecutorTeam | ExecutorExpert

export function team(input: Omit<ExecutorTeam, "kind">): ExecutorTeam {
  return { kind: "team", ...input }
}

export function expert(input: Omit<ExecutorExpert, "kind">): ExecutorExpert {
  return { kind: "expert", ...input }
}

/** Convert the canonical model to the public expert-center team card. */
export function teamCard(input: ExecutorTeam) {
  return {
    id: input.id,
    name: input.name,
    ...(input.description ? { description: input.description } : {}),
    capabilities: input.capabilities,
    scenarios: input.scenarios,
    memberCount: input.memberCount,
    memberPreview: input.memberPreview,
    autoEligible: input.autoEligible,
  }
}

/** Convert the canonical model to the public expert-center expert card. */
export function expertCard(input: ExecutorExpert) {
  return {
    id: input.id,
    name: input.name,
    ...(input.role ? { role: input.role } : {}),
    ...(input.category ? { category: input.category } : {}),
    ...(input.description ? { description: input.description } : {}),
    ...(input.capabilities?.length ? { capabilities: input.capabilities } : {}),
    available: input.available,
  }
}
