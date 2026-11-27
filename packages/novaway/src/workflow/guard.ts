import type { Mode } from "@/permission"
import type { Phase } from "./policy"

export type ToolShape = { id: string; workspace?: boolean; readOnly?: boolean }
export type GuardDecision = { allowed: boolean; reason?: string }

/**
 * 只切权限档位的工具：不碰工作区，任何 phase、任何档位都必须放行。
 * 拦掉它们等于把会话锁死在当前档位里（进不了计划模式，也出不来）。
 */
const MODE_TOOLS = new Set(["plan_enter", "plan_exit"])

export type GuardOptions = {
  /**
   * 会话当前的权限档位。计划模式拥有写操作的最终裁决权（permission 层的白名单
   * 比 phase 更细：只有计划目录下的 markdown 与只读 shell），所以它一旦生效，
   * phase 就不再拦写类工具 —— 否则"写计划"和"phase 门禁"会互相否决。
   */
  permissionMode?: Mode
}

/** Deterministic phase gate shared by runtime and tests. Implementation is the only write phase. */
export function checkTool(
  phase: Phase,
  tool: ToolShape,
  verificationTask = false,
  options: GuardOptions = {},
): GuardDecision {
  // 计划模式：写不写由 permission 层裁决，phase 让位（见 GuardOptions.permissionMode）。
  if (options.permissionMode === "plan") return { allowed: true }
  if (tool.readOnly === true || tool.workspace === false) return { allowed: true }
  if (MODE_TOOLS.has(tool.id)) return { allowed: true }
  // Todo state is session bookkeeping, not a workspace mutation. It must remain
  // available during the read-only grill-me/design gates so the model can track
  // research and execution steps without gaining file-write permission.
  if (tool.id === "todowrite") return { allowed: true }
  if (phase === "implementation") return { allowed: true }
  if (phase === "verification") {
    if (tool.id === "task" && verificationTask) return { allowed: true }
    return { allowed: false, reason: `phase ${phase} permits only read-only tools and the verification subagent` }
  }
  if (["intake", "grill-me", "design", "plan", "review", "delivery"].includes(phase)) {
    if (["question", "skill", "task", "git_status", "git_diff", "git_log", "search", "read"].includes(tool.id))
      return { allowed: true }
    return { allowed: false, reason: `phase ${phase} does not permit workspace-mutating tool ${tool.id}` }
  }
  return { allowed: true }
}
