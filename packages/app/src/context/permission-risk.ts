import type { PermissionRequest } from "@novaway/sdk/v2/client"

/**
 * 会话权限档位。
 *
 * 与内核的 `permission_mode` **完全同名同义** —— 界面上只有这一套词，
 * 客户端不再维护另一份 "confirm / auto / full" 的映射，避免出现
 * "上面选默认、下面选自主" 这种两套开关打架的局面。
 *
 * - `default` 每次确认：按配置规则询问。
 * - `acceptEdits` 自主模式：常规操作自动执行，**危险操作仍然询问**。
 * - `plan` 计划模式：只读，写操作被拒绝。
 * - `bypassPermissions` 跳过所有确认。
 */
export type SessionPermissionMode = "default" | "acceptEdits" | "plan" | "bypassPermissions"

/** 档位的视觉色调：越靠后越"放行"，颜色也越需要让人多看一眼。 */
export type PermissionTone = "neutral" | "blue" | "violet" | "amber"

export const PERMISSION_MODES: Array<{
  value: SessionPermissionMode
  titleKey: string
  descriptionKey: string
  icon: "shield" | "autopilot" | "checklist" | "warning"
  tone: PermissionTone
}> = [
  {
    value: "default",
    titleKey: "permission.mode.confirm",
    descriptionKey: "permission.mode.confirm.description",
    icon: "shield",
    tone: "neutral",
  },
  {
    value: "acceptEdits",
    titleKey: "permission.mode.auto",
    descriptionKey: "permission.mode.auto.description",
    icon: "autopilot",
    tone: "blue",
  },
  {
    value: "plan",
    titleKey: "permission.mode.plan",
    descriptionKey: "permission.mode.plan.description",
    icon: "checklist",
    tone: "violet",
  },
  {
    value: "bypassPermissions",
    titleKey: "permission.mode.full",
    descriptionKey: "permission.mode.full.description",
    icon: "warning",
    tone: "amber",
  },
]

/** 客户端要不要替用户应答：`never` 全问，`risky` 只放行常规操作，`always` 全放行。 */
export function autoRespondsUnder(mode: SessionPermissionMode): "never" | "risky" | "always" {
  if (mode === "bypassPermissions") return "always"
  // 计划模式写操作由内核直接拒绝，其余请求仍需人来决定。
  if (mode === "acceptEdits") return "risky"
  return "never"
}

export function normalizeMode(value: unknown): SessionPermissionMode | undefined {
  return PERMISSION_MODES.some((item) => item.value === value) ? (value as SessionPermissionMode) : undefined
}

/**
 * 危险命令/操作的特征。
 *
 * 只用于「自主模式」的兜底判断：命中就仍然弹确认，其余自动放行。
 * 宁可多问，也不要把不可逆的删除/权限提升/发布动作静默执行掉。
 */
const DANGEROUS_PATTERNS: RegExp[] = [
  /\brm\s+(-[a-z]*[rf]|--recursive|--force)/i,
  /\bRemove-Item\b.*-(Recurse|Force)/i,
  /\b(rmdir|rd)\s+\/[sq]/i,
  /\bdel\s+\/[sfq]/i,
  /\bsudo\b/i,
  /\b(mkfs|fdisk|dd\s+if=|shutdown|reboot|halt)\b/i,
  /\bgit\s+push\b.*(--force|-f\b|--delete)/i,
  /\bgit\s+reset\s+--hard\b/i,
  /\bgit\s+clean\s+-[a-z]*f/i,
  /\b(curl|wget)\b[^|]*\|\s*(sudo\s+)?(sh|bash|zsh)\b/i,
  /\bchmod\s+(-R\s+)?777\b/i,
  /\b(npm|pnpm|yarn|bun)\s+publish\b/i,
  /\b(drop\s+(table|database)|truncate\s+table)\b/i,
  /\bdocker\s+(system\s+prune|rm\s+-f)/i,
  />\s*\/(dev|proc)\//i,
]

const RISKY_PERMISSIONS = new Set(["external_directory"])

/** 这个权限请求在「自主模式」下是否仍然需要询问。 */
export function isRiskyPermission(permission: Pick<PermissionRequest, "permission" | "patterns" | "metadata">) {
  if (RISKY_PERMISSIONS.has(permission.permission)) return true
  const haystack = [...(permission.patterns ?? []), permission.permission].join("\n")
  return DANGEROUS_PATTERNS.some((pattern) => pattern.test(haystack))
}

/** 旧版目录档位（confirm / auto / full）→ 内核档位。 */
export function legacyModeFrom(value: string | undefined, autoAccept?: boolean): SessionPermissionMode | undefined {
  const normalized = normalizeMode(value)
  if (normalized) return normalized
  if (value === "full" || autoAccept === true) return "bypassPermissions"
  if (value === "auto") return "acceptEdits"
  return undefined
}

/**
 * 档位解析顺序：会话 > 旧版目录设置 > 全局默认。
 *
 * 抽成纯函数是为了让"到底哪一档在生效"可以被测试固定下来 ——
 * 之前界面显示默认、实际却在自动放行，就是这条链条没人校验。
 */
export function resolvePermissionMode(input: {
  session?: string
  legacy?: string
  legacyAutoAccept?: boolean
  config?: string
}): SessionPermissionMode {
  return (
    normalizeMode(input.session) ??
    legacyModeFrom(input.legacy, input.legacyAutoAccept) ??
    normalizeMode(input.config) ??
    "default"
  )
}
