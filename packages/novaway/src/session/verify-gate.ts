/**
 * Completion gate for non-trivial work.
 *
 * Mirrors Claude Code's verification-agent contract: once a turn changes
 * enough of the project, "done" is not something the working agent may
 * declare on its own. A separate read-only subagent must inspect the change
 * and report a verdict with command-level evidence.
 *
 * The parser here is deliberately strict. A `VERDICT: PASS` without a
 * `### Check:` block that records both the command and the observed output is
 * rejected, because that is exactly the shape of a hallucinated pass.
 */

export type Verdict = "PASS" | "FAIL" | "PARTIAL"
export type EffectiveVerdict = Verdict | "UNVERIFIED"

export type VerificationCheck = {
  title: string
  kind: "check" | "probe"
  commandRun?: string
  outputObserved?: string
  result?: Verdict
}

export type VerificationReport = {
  declared?: Verdict
  verdict: EffectiveVerdict
  checks: VerificationCheck[]
  adversarialProbes: number
  violations: string[]
}

const SECTION_HEADER = /^#{2,4}\s*(Check|Adversarial probe|检查|对抗性验证|对抗验证)\s*[:：]\s*(.*)$/i
const VERDICT_LINE = /^\s*(?:\*\*)?VERDICT\s*:\s*(PASS|FAIL|PARTIAL)(?:\*\*)?\s*$/i
const FIELD = (names: string[]) =>
  new RegExp(`^\\s*(?:[-*+]\\s+)?(?:\\*\\*)?(?:${names.join("|")})(?:\\*\\*)?\\s*[:：]\\s*(.*)$`, "i")
const RESULT_VALUE = /^(PASS|FAIL|PARTIAL)\b/i

const COMMAND_FIELD = FIELD(["Command run", "执行的命令", "运行命令"])
const OUTPUT_FIELD = FIELD(["Output observed", "观察到的输出", "输出"])
const RESULT_FIELD = FIELD(["Result", "结果"])

const trimValue = (value: string) => value.replace(/^[`'"*]+|[`'"*]+$/g, "").trim()
const isMissing = (value: string | undefined) =>
  !value || value.length === 0 || /^(n\/a|none|not run|no command|未运行|无)$/i.test(value)
const asVerdict = (value: string | undefined): Verdict | undefined => {
  const upper = value?.toUpperCase()
  return upper === "PASS" || upper === "FAIL" || upper === "PARTIAL" ? upper : undefined
}

/**
 * Splits the report into `### Check:` / `### Adversarial probe:` sections and
 * extracts the three fields each section must contain.
 */
export function parseVerificationReport(text: string): VerificationReport {
  const lines = text.split(/\r?\n/)
  const checks: VerificationCheck[] = []
  let declared: Verdict | undefined

  let current: VerificationCheck | undefined
  let pending: "commandRun" | "outputObserved" | undefined
  let buffer: string[] = []

  const cleanBlock = (input: ReadonlyArray<string>) =>
    input
      .map((line) => line.replace(/^\s{0,6}/, ""))
      .filter((line) => !line.trim().startsWith("```"))
      .join("\n")
      .trim()
      .slice(0, 4000)

  const flushField = () => {
    if (pending && current && !current[pending]) {
      const value = cleanBlock(buffer)
      if (value) current[pending] = value
    }
    pending = undefined
    buffer = []
  }

  const flushSection = () => {
    flushField()
    if (current) checks.push(current)
    current = undefined
  }

  for (const line of lines) {
    const header = SECTION_HEADER.exec(line)
    if (header) {
      flushSection()
      current = {
        kind: /^(adversarial probe|对抗性验证|对抗验证)$/i.test(header[1] ?? "") ? "probe" : "check",
        title: header[2]?.trim() ?? "",
      }
      continue
    }
    const verdict = VERDICT_LINE.exec(line)
    if (verdict) {
      flushField()
      declared = asVerdict(verdict[1])
      continue
    }
    const command = COMMAND_FIELD.exec(line)
    if (command) {
      flushField()
      const value = trimValue(command[1] ?? "")
      if (value && current) current.commandRun = value
      else pending = "commandRun"
      continue
    }
    const output = OUTPUT_FIELD.exec(line)
    if (output) {
      flushField()
      const value = trimValue(output[1] ?? "")
      if (value && current) current.outputObserved = value
      else pending = "outputObserved"
      continue
    }
    const result = RESULT_FIELD.exec(line)
    if (result) {
      flushField()
      const value = asVerdict(RESULT_VALUE.exec(result[1]?.trim() ?? "")?.[1])
      if (value && current) current.result = value
      continue
    }
    if (pending) buffer.push(line)
  }
  flushSection()

  const violations: string[] = []
  const evidenced = (check: VerificationCheck) => !isMissing(check.commandRun) && !isMissing(check.outputObserved)

  if (!declared) {
    violations.push("missing a final `VERDICT: PASS|FAIL|PARTIAL` line")
    return {
      declared,
      verdict: "UNVERIFIED",
      checks,
      adversarialProbes: checks.filter((check) => check.kind === "probe").length,
      violations,
    }
  }

  if (declared === "FAIL" || declared === "PARTIAL") {
    return {
      declared,
      verdict: declared,
      checks,
      adversarialProbes: checks.filter((check) => check.kind === "probe").length,
      violations,
    }
  }

  const supporting = checks.filter((check) => check.kind === "check")
  const probes = checks.filter((check) => check.kind === "probe")
  if (supporting.length === 0) violations.push("PASS without any `### Check:` entry")
  if (probes.length === 0) violations.push("PASS without an adversarial probe")
  for (const check of checks) {
    if (check.result === "FAIL" && check.kind === "check") {
      violations.push(`claim PASS while check "${check.title}" reports FAIL`)
    }
    if (!evidenced(check)) {
      violations.push(`"${check.title}" has no command run + observed output`)
    }
  }

  return {
    declared,
    verdict: violations.length === 0 ? "PASS" : "UNVERIFIED",
    checks,
    adversarialProbes: probes.length,
    violations,
  }
}

export type EditRecord = { path: string; tool: string; at: number }

const EDIT_TOOLS = new Set(["write", "edit", "multiedit", "patch", "apply_patch", "notebook_edit"])
const FILE_KEYS = ["filePath", "file_path", "path", "notebook_path", "target_file"]

type PartLike = {
  type?: string
  tool?: string
  state?: {
    status?: string
    input?: Record<string, unknown>
    time?: { start?: number; end?: number }
  }
}

type MessageLike = {
  info: { role?: string }
  parts: ReadonlyArray<PartLike>
}

/**
 * Collects file-modifying tool calls from a message slice. `cwd` is only used
 * to keep absolute paths readable in the gate feedback.
 */
export function collectEdits(
  messages: ReadonlyArray<MessageLike>,
  input?: { since?: number; cwd?: string },
): EditRecord[] {
  const edits: EditRecord[] = []
  for (const message of messages) {
    if (message.info.role !== "assistant") continue
    for (const part of message.parts) {
      if (part.type !== "tool" || !part.tool || !EDIT_TOOLS.has(part.tool)) continue
      const state = part.state
      if (state?.status !== "completed") continue
      const at = state.time?.end ?? state.time?.start ?? 0
      if (input?.since !== undefined && at < input.since) continue
      const raw = FILE_KEYS.map((key) => state.input?.[key]).find((value): value is string => typeof value === "string")
      if (!raw) continue
      const normalized =
        input?.cwd && raw.startsWith(input.cwd) ? raw.slice(input.cwd.length).replace(/^[/\\]+/, "") : raw
      edits.push({ path: normalized, tool: part.tool, at })
    }
  }
  return edits
}

/** Files whose change warrants verification even when the edit count is low. */
const SENSITIVE_PATH =
  /(^|[/\\])(package\.json|package-lock\.json|bun\.lockb?|pnpm-lock\.yaml|yarn\.lock|Cargo\.toml|go\.mod|pyproject\.toml|requirements\.txt|Dockerfile|docker-compose\.[^/\\]+|Makefile|\.github[/\\]workflows[/\\]|terraform[/\\]|k8s[/\\]|helm[/\\])/i

export const VERIFICATION_EDIT_THRESHOLD = 3

export function sensitivePath(path: string) {
  return SENSITIVE_PATH.test(path)
}

export function isNonTrivial(edits: ReadonlyArray<EditRecord>) {
  if (edits.length >= VERIFICATION_EDIT_THRESHOLD) return true
  if (new Set(edits.map((edit) => edit.path)).size >= VERIFICATION_EDIT_THRESHOLD) return true
  return edits.some((edit) => sensitivePath(edit.path))
}

const SKIP_PATTERN =
  /(skip|without|no need for|don'?t (?:need to )?(?:run|do))\s+(?:an?\s+)?verification|不用验证|不需要验证|跳过验证|别验证|无需验证/i

export function skipRequested(userText: string | undefined) {
  return userText ? SKIP_PATTERN.test(userText) : false
}

export type VerificationObservation = {
  verdict: EffectiveVerdict
  completedAt: number
  running?: boolean
  summary?: string
}

export type GateDecision =
  | { action: "skip"; reason: string }
  | { action: "satisfied"; verdict: Verdict }
  | {
      action: "require"
      reason: "missing" | "running" | "failed" | "unverified"
      message: string
      edits: number
      files: string[]
    }

const MAX_LISTED_FILES = 8

function describeFiles(edits: ReadonlyArray<EditRecord>) {
  const files = [...new Set(edits.map((edit) => edit.path))].filter(Boolean)
  const listed = files.slice(0, MAX_LISTED_FILES)
  return {
    files,
    text:
      listed.length > 0
        ? listed.join(", ") + (files.length > listed.length ? ` (+${files.length - listed.length} more)` : "")
        : "unknown files",
  }
}

function requireMessage(
  reason: "missing" | "running" | "failed" | "unverified",
  input: { edits: ReadonlyArray<EditRecord>; latest?: VerificationObservation },
) {
  const { text } = describeFiles(input.edits)
  const body =
    reason === "running"
      ? [
          "A verification subagent is already running for this turn. Wait for its report (task_status / task_wait), then answer based on its VERDICT.",
        ]
      : reason === "failed"
        ? [
            `The verification subagent reported FAIL: ${input.latest?.summary ?? "see its report"}`,
            "Fix the failing behavior, then run verification again. Do not claim the task is complete.",
          ]
        : reason === "unverified"
          ? [
              `The verification report was rejected: ${input.latest?.summary ?? "no usable evidence"}`,
              "Re-run the verification subagent and require command-level evidence: every check needs `Command run`, `Output observed`, and a `Result`, plus at least one adversarial probe, and the report must end with `VERDICT: PASS|FAIL|PARTIAL`.",
            ]
          : [
              "Spawn the read-only verification subagent now:",
              'task(subagent_type: "verification", description: "Verify this turn", prompt: "<the original request + exactly what changed + the commands and behaviors to check>")',
              "The verifier cannot edit files. Give it file paths, the user-visible behavior to prove, and the concrete commands to run.",
            ]
  return [
    "<verification-gate>",
    `This turn changed ${input.edits.length} file edit(s) (${text}), so it is non-trivial work. You may not report it as complete without an independent verification pass.`,
    "",
    ...body,
    "",
    "- VERDICT: PASS — you may report completion, quoting what the verifier actually ran.",
    "- VERDICT: FAIL — fix the failures and verify again.",
    "- VERDICT: PARTIAL — state plainly what could not be verified and why.",
    "Do not describe your own summary as verified.",
    "</verification-gate>",
  ].join("\n")
}

/**
 * Decides whether the turn may finish. Only verifications completed after the
 * last edit count: an older PASS cannot bless newer edits, and a FAIL is never
 * folded into a pass.
 */
export function evaluateVerificationGate(input: {
  edits: ReadonlyArray<EditRecord>
  verifications: ReadonlyArray<VerificationObservation>
  userText?: string
}): GateDecision {
  if (skipRequested(input.userText)) return { action: "skip", reason: "verification skipped at the user's request" }
  if (!isNonTrivial(input.edits)) return { action: "skip", reason: "below the non-trivial edit threshold" }

  const lastEditAt = Math.max(...input.edits.map((edit) => edit.at))
  const after = input.verifications.filter((item) => item.running === true || item.completedAt >= lastEditAt)
  const completed = after.filter((item) => item.running !== true).toSorted((a, b) => a.completedAt - b.completedAt)
  const latest = completed.at(-1)

  if (!latest) {
    const reason = after.some((item) => item.running) ? "running" : "missing"
    return {
      action: "require",
      reason,
      message: requireMessage(reason, { edits: input.edits }),
      edits: input.edits.length,
      files: describeFiles(input.edits).files,
    }
  }

  if (latest.verdict === "PASS" || latest.verdict === "PARTIAL") return { action: "satisfied", verdict: latest.verdict }
  const reason = latest.verdict === "FAIL" ? "failed" : "unverified"
  return {
    action: "require",
    reason,
    message: requireMessage(reason, { edits: input.edits, latest }),
    edits: input.edits.length,
    files: describeFiles(input.edits).files,
  }
}
