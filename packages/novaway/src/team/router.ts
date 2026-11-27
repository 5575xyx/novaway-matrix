/**
 * 主助手的轻量路由提示。
 *
 * 这不是一个替代模型的分类器：Claude Code 风格的关键是主助手仍然拥有最终
 * 决策权。这里仅把任务复杂度和候选人的相关性压缩成一段短提示，减少模型在
 * 大目录里盲选，同时保留「简单任务不要派人」的默认行为。
 */

export type Candidate = {
  kind: "team" | "expert"
  id: string
  name: string
  text: string
}

export type Recommendation = {
  mode: "main" | "expert" | "team"
  candidate?: Candidate
  reason: string
}

const COMPLEX = [
  "并行",
  "多领域",
  "跨领域",
  "全流程",
  "端到端",
  "同时",
  "分别",
  "compare and implement",
  "parallel",
  "cross-functional",
  "end-to-end",
]

const SPECIALIZED = [
  "竞品",
  "研究",
  "调研",
  "数据",
  "统计",
  "sql",
  "设计",
  "ux",
  "文案",
  "翻译",
  "法律",
  "财务",
  "research",
  "analytics",
  "design",
  "content",
  "legal",
  "finance",
]

const words = (value: string) =>
  value
    .toLocaleLowerCase()
    .split(/[\s,，。！？；;、/\:：()（）\[\]]+/)
    .filter((word) => word.length > 1)

const containsAny = (value: string, values: readonly string[]) => values.some((item) => value.includes(item))

export function recommend(goal: string, candidates: readonly Candidate[]): Recommendation {
  const normalized = goal.trim().toLocaleLowerCase()
  if (!normalized) return { mode: "main", reason: "没有足够的任务上下文，先由主助手处理。" }

  const complex = containsAny(normalized, COMPLEX) || words(normalized).length >= 28
  const specialized = containsAny(normalized, SPECIALIZED)
  if (!complex && !specialized) return { mode: "main", reason: "任务看起来可以由主助手直接完成。" }

  const goalWords = new Set(words(normalized))
  const ranked = candidates
    .map((candidate) => {
      const text = candidate.text.toLocaleLowerCase()
      let score = candidate.kind === "expert" ? 1 : 0
      for (const word of goalWords) if (word.length > 1 && text.includes(word)) score += 2
      if (specialized && candidate.kind === "expert") score += 1
      if (complex && candidate.kind === "team") score += 3
      return { candidate, score }
    })
    .sort((a, b) => b.score - a.score)

  const top = ranked[0]
  if (!top || top.score < 2) {
    return {
      mode: complex ? "team" : "main",
      reason: complex ? "任务包含多个步骤或领域，必要时优先考虑专家团队。" : "任务有专业信号，但没有足够匹配的候选。",
    }
  }
  return {
    mode: top.candidate.kind,
    candidate: top.candidate,
    reason:
      top.candidate.kind === "team"
        ? "任务涉及多个步骤或领域，优先考虑团队协作。"
        : "任务包含明确的专业领域，优先考虑单个专家。",
  }
}

export function guidance(goal: string, candidates: readonly Candidate[]) {
  const result = recommend(goal, candidates)
  const target = result.candidate ? `：${result.candidate.name}` : ""
  return [
    "<system-reminder>",
    "按需协作提示（仅供主助手判断，不是强制计划）：",
    `- ${result.reason}`,
    `- 建议路径：${result.mode === "main" ? "主助手直接处理" : result.mode === "expert" ? "单个专家" : "专家团队"}${target}`,
    "- 如果主助手自己可以可靠完成，不要为了展示协作而调用专家或团队。",
    "</system-reminder>",
  ].join("\n")
}
