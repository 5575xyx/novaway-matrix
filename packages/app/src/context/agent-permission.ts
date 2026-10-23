import type { SessionPermissionMode } from "./permission-risk"

/**
 * 「角色」与「权限档位」的联动规则。
 *
 * 两个概念本身是正交的：角色决定提示词与工具形态，权限档位决定执行闸门。
 * 但有两组组合是自相矛盾的：
 *
 * - 锻造工程 + 计划模式：角色要写代码，闸门却把写操作全拒了；
 * - 规划蓝图 + 自主/跳过：角色自称"只读分析"，闸门却允许直接改文件。
 *
 * 所以界面只让用户做一次选择：选角色自动带出对应档位，选档位自动带出对应角色。
 * 这样做的好处是"中途想只读"依然成立 —— 直接选计划模式即可，角色跟着切换，
 * 读文件、搜索不受影响，写操作被拒绝。
 */
export const PLANNER_AGENT = "plan"
export const BUILDER_AGENT = "build"

/** 选了某角色后，权限档位应当变成什么；`undefined` 表示保持不变。 */
export function permissionForAgent(
  agent: string,
  current: SessionPermissionMode,
): SessionPermissionMode | undefined {
  if (agent === PLANNER_AGENT) return current === "plan" ? undefined : "plan"
  // 离开规划角色时，只读闸门只会挡住这个角色要做的事。
  if (current === "plan") return "default"
  return undefined
}

/** 选了某档位后，角色应当变成什么；`undefined` 表示保持不变。 */
export function agentForPermission(
  mode: SessionPermissionMode,
  current: string | undefined,
): string | undefined {
  if (mode === "plan") return current === PLANNER_AGENT ? undefined : PLANNER_AGENT
  if (current === PLANNER_AGENT) return BUILDER_AGENT
  return undefined
}

/** 角色的执行能力是否与档位一致（用于界面提示与测试断言）。 */
export function isCoherent(agent: string | undefined, mode: SessionPermissionMode): boolean {
  const planner = agent === PLANNER_AGENT
  return planner === (mode === "plan")
}
