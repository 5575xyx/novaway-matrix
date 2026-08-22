export type EvolutionEvalCase = {
  title: string
  kind: string
  target: string
  content: string
  reason: string
  expectedKind?: string
  requiredSections?: string[]
}

export type EvolutionEvalResult = {
  title: string
  valid: boolean
  issues: string[]
  kindOk: boolean
  targetOk: boolean
  contentOk: boolean
  reasonOk: boolean
  requiredSectionsMissing: string[]
}

export function evaluateEvolutionCandidate(input: EvolutionEvalCase): EvolutionEvalResult {
  const issues: string[] = []
  const requiredSectionsMissing =
    input.requiredSections?.filter((section) => !input.content.toLowerCase().includes(section.toLowerCase())) ?? []
  const kindOk = input.expectedKind ? input.kind === input.expectedKind : Boolean(input.kind)
  const targetOk = input.target.trim().length >= 2
  const contentOk = input.content.trim().length >= 8
  const reasonOk = input.reason.trim().length >= 4
  if (!kindOk) issues.push(`kind 不符合预期：${input.kind}`)
  if (!targetOk) issues.push("target 过短或为空")
  if (!contentOk) issues.push("content 过短或为空")
  if (!reasonOk) issues.push("reason 过短或为空")
  for (const section of requiredSectionsMissing) issues.push(`content 缺少必需片段：${section}`)
  return {
    title: input.title,
    valid: issues.length === 0,
    issues,
    kindOk,
    targetOk,
    contentOk,
    reasonOk,
    requiredSectionsMissing,
  }
}

export function summarizeEvolutionEval(results: readonly EvolutionEvalResult[]) {
  return {
    cases: results.length,
    valid: results.filter((item) => item.valid).length,
    invalid: results.filter((item) => !item.valid).length,
    validRate: results.length ? results.filter((item) => item.valid).length / results.length : 0,
  }
}

export type EvolutionRegressionResult = {
  expected: string[]
  found: string[]
  missing: string[]
  score: number
  pass: boolean
}

export function evaluateEvolutionRegression(input: {
  expectedOutcomes?: readonly string[]
  writtenContent: string
  threshold?: number
}): EvolutionRegressionResult {
  const expected = (input.expectedOutcomes ?? []).map((item) => item.trim()).filter(Boolean)
  if (!expected.length) {
    return { expected, found: [], missing: [], score: 1, pass: true }
  }
  const found = expected.filter((outcome) => input.writtenContent.includes(outcome))
  const missing = expected.filter((outcome) => !found.includes(outcome))
  const score = found.length / expected.length
  return {
    expected,
    found,
    missing,
    score,
    pass: score >= (input.threshold ?? 1),
  }
}
