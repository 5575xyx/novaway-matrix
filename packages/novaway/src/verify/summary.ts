/**
 * 测试输出解析：把常见框架的输出压成一行结论。
 *
 * 只做"够用"的解析：退出码决定成败，行数用于给用户一个可读的摘要。
 * 解析失败不影响结论（退出码为准），只是摘要退化成截取最后几行。
 */
export type VerifyOutcome = {
  ok: boolean
  exitCode: number | null
  /** 通过 / 失败的用例数（能解析出来时）。 */
  passed?: number
  failed?: number
  skipped?: number
  /** 一行摘要。 */
  summary: string
  /** 失败用例名（能解析出来时，最多 10 条）。 */
  failures: string[]
}

export function parseSummary(output: string): Pick<VerifyOutcome, "passed" | "failed" | "skipped" | "failures"> {
  const failures: string[] = []
  for (const pattern of [/^\s*(?:FAIL|✕|×)\s+(.+)$/gm, /^\s*(?:FAILED)\s+(.+)$/gm, /^\s*--- FAIL:\s+(.+)$/gm]) {
    for (const match of output.matchAll(pattern)) {
      const name = match[1]?.trim()
      if (name && failures.length < 10 && !failures.includes(name)) failures.push(name)
    }
  }

  const jest = /Tests:\s*([0-9]+) failed,\s*([0-9]+) passed/.exec(output)
  if (jest) return { failed: Number(jest[1]), passed: Number(jest[2]), failures }

  const vitest = /Tests\s+([0-9]+) failed\s*\|\s*([0-9]+) passed/.exec(output)
  if (vitest) return { failed: Number(vitest[1]), passed: Number(vitest[2]), failures }

  const vitestPass = /Tests\s+([0-9]+) passed\s*\([0-9]+\)/.exec(output)
  if (vitestPass) return { passed: Number(vitestPass[1]), failures }

  const pytest = /([0-9]+) failed,\s*([0-9]+) passed(?:,\s*([0-9]+) skipped)?/.exec(output)
  if (pytest) {
    return {
      failed: Number(pytest[1]),
      passed: Number(pytest[2]),
      skipped: pytest[3] ? Number(pytest[3]) : undefined,
      failures,
    }
  }
  const pytestPass = /([0-9]+) passed(?:,\s*([0-9]+) skipped)?/.exec(output)
  if (pytestPass && !output.includes("failed")) {
    return { passed: Number(pytestPass[1]), skipped: pytestPass[2] ? Number(pytestPass[2]) : undefined, failures }
  }

  const cargo = /test result: [A-Za-z]+\.\s*([0-9]+) passed;\s*([0-9]+) failed/.exec(output)
  if (cargo) return { passed: Number(cargo[1]), failed: Number(cargo[2]), failures }

  // Go: count "ok <pkg>" / "--- FAIL"
  if (output.includes("ok ") || output.includes("--- FAIL")) {
    const failed = failures.length
    return failed > 0 ? { failed, failures } : { passed: undefined, failures }
  }

  return { failures }
}

export function summarize(input: { output: string; exitCode: number | null; timedOut?: boolean }): VerifyOutcome {
  const parsed = parseSummary(input.output)
  const ok = !input.timedOut && input.exitCode === 0
  const parts: string[] = []
  if (input.timedOut) parts.push("timed out")
  if (parsed.passed !== undefined) parts.push(parsed.passed + " passed")
  if (parsed.failed !== undefined) parts.push(parsed.failed + " failed")
  if (parsed.skipped !== undefined) parts.push(parsed.skipped + " skipped")
  if (parts.length === 0) parts.push(ok ? "passed" : "failed (exit " + (input.exitCode ?? "?") + ")")
  return { ok, exitCode: input.exitCode, ...parsed, summary: parts.join(", ") }
}

/** 失败时给模型看的尾部输出（保留最近的报错上下文）。 */
export function tail(output: string, lines = 80) {
  const all = output.split(/\r?\n/)
  if (all.length <= lines) return output
  return "...(truncated)\n" + all.slice(-lines).join("\n")
}
