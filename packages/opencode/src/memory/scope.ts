/** Memory scope classification for all-purpose agents */

export type MemoryScopeName = "global" | "project" | "session"

const GLOBAL_INTENT =
  /global|all projects|across projects|every project|\u6240\u6709\u9879\u76ee|\u5168\u90e8\u9879\u76ee|\u5168\u5c40|\u8de8\u9879\u76ee|\u6574\u4e2a\u7cfb\u7edf/i
const SESSION_INTENT = /\u4ec5?(?:\u672c|\u8fd9\u4e2a)?\u4f1a\u8bdd|only\s+this\s+session|for\s+this\s+session/i
const PROJECT_INTENT =
  /\u4ec5?(?:\u672c|\u8fd9\u4e2a)\u9879\u76ee|\u672c\u4ed3\u5e93|\u5f53\u524d\u9879\u76ee|only\s+this\s+project|this\s+repo/i

const PREFERENCE =
  /\u504f\u597d|\u4e60\u60ef|\u559c\u6b22|\u5e0c\u671b\u4f60|\u8bf7\u7528|\u8bf7\u7528\u4e2d\u6587|\u8bed\u6c14|\u98ce\u683c|\u4e0d\u8981\u592a\u957f|\u7b80\u6d01|\u8be6\u7ec6|\u6211\u662f|\u6211\u7684\u89d2\u8272|\u6211\u7684\u5de5\u4f5c\u65b9\u5f0f|prefer|preference|always\s+reply|in\s+chinese|be\s+concise|i\s+(prefer|like|want)/i

const CONVENTION =
  /\u9879\u76ee|\u4ed3\u5e93|\u76ee\u5f55|\u89c4\u8303|\u7ea6\u5b9a|\u6280\u672f\u6808|\u6846\u67b6|\u5305\u7ba1\u7406|\u5206\u652f|\u63a5\u53e3|\u6570\u636e\u5e93|\u90e8\u7f72|\u6d4b\u8bd5|monorepo|bun|pnpm|npm|vite|react|\u67b6\u6784|\u6a21\u5757|\u672c\u4ed3|\u4ee3\u7801\u5e93|codebase|convention|lint|prettier|\bapi\b|\bci\b|\bproject\b|\brepo\b|\bstack\b/i

export function hasGlobalMemoryIntent(text: string) {
  return GLOBAL_INTENT.test(text)
}

export function hasSessionMemoryIntent(text: string) {
  return SESSION_INTENT.test(text)
}

export function hasProjectMemoryIntent(text: string) {
  return PROJECT_INTENT.test(text)
}

/** Infer scope from free text when no explicit override is provided. */
export function classifyMemoryScope(text: string, hasProject: boolean): MemoryScopeName {
  const t = text.trim()
  if (!t) return hasProject ? "project" : "global"
  if (!hasProject) return "global"
  if (hasSessionMemoryIntent(t)) return "session"
  if (hasGlobalMemoryIntent(t)) return "global"
  if (hasProjectMemoryIntent(t)) return "project"
  const pref = PREFERENCE.test(t)
  const conv = CONVENTION.test(t)
  if (pref && !conv) return "global"
  if (conv && !pref) return "project"
  if (pref && conv) return "project"
  // All-purpose agent: default to global unless project convention signals exist.
  return "global"
}

export function resolveMemoryScope(input: {
  projectID?: string
  userContent?: string
  content?: string
  scope?: MemoryScopeName
}): MemoryScopeName {
  const text = `${input.userContent ?? ""} ${input.content ?? ""}`.trim()
  const hasProject = Boolean(input.projectID)

  if (input.scope === "session") return "session"
  if (input.scope === "global") return "global"
  if (input.scope === "project") return hasProject ? "project" : "global"

  return classifyMemoryScope(text, hasProject)
}

export function scopeLabel(scope: MemoryScopeName) {
  if (scope === "global") return "\u5168\u5c40"
  if (scope === "session") return "\u672c\u4f1a\u8bdd"
  return "\u672c\u9879\u76ee"
}

export function memoryProjectID<T extends string | undefined>(projectID: T, scope: MemoryScopeName): T | undefined {
  return scope === "global" ? undefined : projectID
}
