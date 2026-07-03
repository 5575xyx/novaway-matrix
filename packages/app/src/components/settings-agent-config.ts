function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

type PermissionAction = "allow" | "deny" | "ask"
type PermissionRule = {
  permission: string
  pattern: string
  action: PermissionAction
}

function wildcardMatch(value: string, pattern: string) {
  const escaped = pattern
    .replaceAll("\\", "/")
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".")
  return new RegExp(`^${escaped}$`, "si").test(value.replaceAll("\\", "/"))
}

function evaluateSkillPermission(name: string, ruleset: PermissionRule[]) {
  return ruleset.findLast((rule) => wildcardMatch("skill", rule.permission) && wildcardMatch(name, rule.pattern))?.action ?? "ask"
}

function cleanAgentConfig(value: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(value).filter(([key, item]) => {
      if (key === "temperature" || key === "top_p") return typeof item === "number" && Number.isFinite(item)
      return item !== null
    }),
  )
}

function agentPermission(value: Record<string, unknown>) {
  return isRecord(value.permission) ? value.permission : {}
}

export function agentSkillPermission(value: Record<string, unknown>): Record<string, unknown> {
  const permission = agentPermission(value)
  return isRecord(permission.skill) ? permission.skill : {}
}

export function hasSkillPermission(name: string, ruleset: PermissionRule[]) {
  return evaluateSkillPermission(name, ruleset) === "allow"
}

export function withAgentSkills(
  value: Record<string, unknown>,
  builtIn: string[],
  custom: string[],
): Record<string, unknown> {
  const current = agentSkillPermission(value)
  const keep = new Set(["*", ...builtIn, ...custom])
  const removed = Object.keys(current).filter((key) => !keep.has(key))
  return {
    ...cleanAgentConfig(value),
    permission: {
      ...agentPermission(value),
      skill: Object.fromEntries([
        ["*", "deny"],
        ...builtIn.map((name) => [name, "allow"] as const),
        ...custom.map((name) => [name, "allow"] as const),
        ...removed.map((name) => [name, "deny"] as const),
      ]),
    },
  }
}
