/** 与 PowersNexus CLI `start` 一致的 L0–L4 启发式评估 */
export type WorkflowLevelID = "L0" | "L1" | "L2" | "L3" | "L4"

export function assessWorkflowLevel(description: string): {
  level: WorkflowLevelID
  confidence: number
  reason: string
} {
  const text = (description || "").toLowerCase()
  if (!text.trim()) {
    return { level: "L2", confidence: 50, reason: "无描述，默认标准流程" }
  }
  if (
    /typo|拼写|文案|配置|改个|修复一个字|改一下字|rename\b|注释/.test(text)
  ) {
    return { level: "L0", confidence: 95, reason: "微型修复/文案/配置类" }
  }
  if (/小功能|小优化|小 bug|小bug|简单|quick|hotfix|修一个|小改/.test(text)) {
    return { level: "L1", confidence: 85, reason: "小功能/快速迭代" }
  }
  if (/核心架构|重大重构|系统级|重量级|平台化|从零搭建大型/.test(text)) {
    return { level: "L4", confidence: 90, reason: "重量级/系统级" }
  }
  if (/大型|架构|重构|跨模块|完整流程|端到端|全栈|系统/.test(text)) {
    return { level: "L3", confidence: 80, reason: "跨模块/架构级" }
  }
  // 中等产品功能（Todo/登录/CRUD 等）
  if (/todo|待办|登录|注册|crud|页面|组件|功能|实现|开发|系统/.test(text)) {
    return { level: "L2", confidence: 75, reason: "标准功能实现" }
  }
  return { level: "L2", confidence: 70, reason: "默认标准流程" }
}

export * as PowersNexusLevel from "./level"