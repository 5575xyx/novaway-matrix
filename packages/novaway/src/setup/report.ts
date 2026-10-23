/**
 * 安装/诊断类工具的统一返回形状。
 *
 * 各个能力（OCR、本地向量、语言工具链……）的底层实现形态不同：
 * OCR 走 `InstallResult`，Ollama 走 `SetupResult { ok, status, steps }`。
 * 这里只统一「给模型看的结果」，不强行统一底层实现，避免为抽象而抽象。
 */
export type SetupAction = "status" | "install"

export type SetupStepView = {
  step: string
  status: string
  detail?: string
}

export type SetupReport = {
  /** 能力标识，例如 ocr / embedding。 */
  domain: string
  ready: boolean
  phase: string
  /** 一行结论，作为工具输出的第一行。 */
  summary: string
  facts?: Record<string, string | number | boolean | undefined>
  hint?: string
  error?: string
  steps?: SetupStepView[]
  /** 失败后建议的下一条命令或下一步动作。 */
  next?: string
}

const NL = String.fromCharCode(10)

/** 把 steps 渲染成 `- [ok] install: detail` 形式。 */
export function formatSetupSteps(steps: readonly SetupStepView[] | undefined) {
  if (!steps || steps.length === 0) return ""
  return steps.map((step) => "- [" + step.status + "] " + step.step + (step.detail ? ": " + step.detail : "")).join(NL)
}

/**
 * 渲染成工具输出文本。顺序：结论 → 事实 → 提示 → 错误 → 步骤 → 下一步。
 * 空字段自动省略，避免模型读到一堆 `undefined`。
 */
export function formatSetupReport(report: SetupReport) {
  const lines: string[] = [report.summary]
  for (const [key, value] of Object.entries(report.facts ?? {})) {
    if (value === undefined || String(value).trim() === "") continue
    lines.push("- " + key + ": " + value)
  }
  if (report.hint) lines.push("hint: " + report.hint)
  if (report.error) lines.push("error: " + report.error)
  const steps = formatSetupSteps(report.steps)
  if (steps) lines.push("steps:", steps)
  if (report.next) lines.push("next: " + report.next)
  return lines.join(NL)
}

/** 安装失败时抛给模型的错误文本（与输出保持同样结构）。 */
export function setupFailure(report: SetupReport) {
  return formatSetupReport({ ...report, summary: report.summary || "setup failed" })
}
