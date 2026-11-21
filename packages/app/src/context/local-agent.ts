import type { AppMode } from "./layout"

type AgentLike = {
  name: string
  mode: string
  hidden?: boolean
  options?: Record<string, unknown>
}

const textOption = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : undefined)

function declaredWorkbenchID(agent: AgentLike) {
  const raw = agent.options?.workbench
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const id = textOption((raw as Record<string, unknown>).id)
    if (id) return id
  }
  return textOption(agent.options?.modeGroup)
}

/**
 * Filter agents by the dynamically contributed workbench. A plugin normally
 * declares `workbench` on one primary Agent and only `modeGroup` on its other
 * Agents, so the whole group must follow the declared workbench id.
 */
export function visibleAgentList<T extends AgentLike>(agents: readonly T[], mode: AppMode | undefined) {
  const primary = agents.filter((item) => item.mode !== "subagent" && !item.hidden)
  if (mode === "forge") return primary
  if (!mode) return primary

  const owner = primary.find((item) => declaredWorkbenchID(item) === mode)
  const group = textOption(owner?.options?.modeGroup)
  return primary.filter((item) => declaredWorkbenchID(item) === mode || (group && item.options?.modeGroup === group))
}
