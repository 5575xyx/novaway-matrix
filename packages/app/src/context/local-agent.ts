import type { AppMode } from "./layout"

const forgeAgentNames = new Set(["build", "plan"])
const buildIntentPattern =
  /(继续|执行|实施|开始做|开始实施|开始执行|按方案|按计划|落地|动手|改一下|修改|修复|创建|新建|新增|删除|替换|重构|运行|跑一下|测试|安装|提交|部署|apply|build|continue|proceed|implement|execute|start|fix|edit|create|add|delete|replace|refactor|run|test|install|commit|deploy)/i
const planOnlyPattern =
  /(先别|不要|不需要|暂不|只要|仅|先).*?(执行|实施|修改|改|写入|创建|运行|动手|落地|execute|implement|edit|write|run|apply)|(只|仅).*?(规划|计划|方案|分析|讨论|评估|解释|plan|proposal|analysis|discuss|evaluate|explain)/i

export function visibleAgentList<
  T extends { name: string; mode: string; hidden?: boolean; options?: Record<string, unknown> },
>(agents: readonly T[], mode: AppMode | undefined) {
  const primary = agents.filter((item) => item.mode !== "subagent" && !item.hidden)
  if (mode === "forge") return primary.filter((item) => forgeAgentNames.has(item.name))
  if (mode === "zen")
    return primary.filter((item) => item.name.startsWith("office-") || item.options?.modeGroup === "office")
  if (!mode) return primary
  return primary.filter((item) => item.options?.modeGroup === mode)
}

export function forgeAgentForPrompt(input: {
  mode: AppMode | undefined
  current?: string
  text: string
  promptMode?: "normal" | "shell"
}) {
  if (input.mode !== "forge") return input.current
  if (input.current === "plan" && !hasForgeBuildIntent(input.text)) return "plan"
  return "build"
}

export function shouldAutoBuildAfterForgePlan(input: {
  mode: AppMode | undefined
  text: string
  promptMode?: "normal" | "shell"
}) {
  if (input.mode !== "forge") return false
  if (input.promptMode !== "normal") return false
  const value = input.text.trim()
  if (!value || value.startsWith("/")) return false
  return hasForgeBuildIntent(value)
}

export function hasForgeBuildIntent(text: string) {
  const value = text.trim()
  if (!value) return false
  if (planOnlyPattern.test(value)) return false
  return buildIntentPattern.test(value)
}
