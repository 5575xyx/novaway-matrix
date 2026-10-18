import type { PermissionRequest } from "@novaway/sdk/v2/client"

/**
 * 权限档位（对齐 ZCode 输入框里的三档选择器）。
 *
 * - `confirm` 变更前确认：每次权限请求都问（默认）。
 * - `auto` 自主模式：常规操作自动放行，**有风险时仍然询问**。
 * - `full` 完全访问：不再询问。
 */
export type PermissionMode = "confirm" | "auto" | "full"

export const PERMISSION_MODES: Array<{
  value: PermissionMode
  titleKey: string
  descriptionKey: string
  icon: "shield" | "autopilot" | "warning"
}> = [
  {
    value: "confirm",
    titleKey: "permission.mode.confirm",
    descriptionKey: "permission.mode.confirm.description",
    icon: "shield",
  },
  {
    value: "auto",
    titleKey: "permission.mode.auto",
    descriptionKey: "permission.mode.auto.description",
    icon: "autopilot",
  },
  {
    value: "full",
    titleKey: "permission.mode.full",
    descriptionKey: "permission.mode.full.description",
    icon: "warning",
  },
]

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
