import { parseJSON } from "./verifier"

/** 所有员工派工共享的完成报告形状；它描述声明，不替代独立 Verification。 */
export type ReportIdentity = {
  assignmentID: string
  dispatchID: string
  attempt: number
}

export type Parsed = {
  status: "succeeded" | "failed" | "blocked" | "needs_review"
  summary: string
  claims: unknown[]
  evidence: unknown[]
  artifacts: unknown[]
  blockers: unknown[]
  structured: boolean
  identityMismatch: boolean
}

/**
 * 统一读取队长、普通 task worker 和 workflow worker 的输出。
 *
 * 非结构化文本会保留为 `needs_review` 声明：它可以进入人工/验证流程，但不能因为
 * 「有文本」就被当成通过。报告里的 status 只是 worker 的自述，最终结论仍来自 verifier。
 */
export function parse(text: string, expected?: ReportIdentity): Parsed {
  const raw = parseJSON(text)
  if (!raw) {
    return {
      status: "needs_review",
      summary: text.trim().slice(0, 4000),
      claims: [],
      evidence: [],
      artifacts: [],
      blockers: [],
      structured: false,
      identityMismatch: false,
    }
  }
  const declared = raw.status
  const hasDeclaredStatus =
    declared === "failed" || declared === "blocked" || declared === "needs_review" || declared === "succeeded"
  // A JSON object is not automatically a successful report. In particular, a
  // provider may return `{}` after truncation or a tool may wrap an error in a
  // JSON envelope. Only the explicit contract (`status` or the legacy `done`)
  // is allowed to make a positive claim.
  let status: Parsed["status"] = hasDeclaredStatus
    ? declared
    : raw.done === true
      ? "succeeded"
      : raw.done === false
        ? "blocked"
        : "needs_review"
  const summary = typeof raw.summary === "string" ? raw.summary.slice(0, 4000) : ""
  const reportedAssignmentID = typeof raw.assignmentID === "string" ? raw.assignmentID : undefined
  const reportedDispatchID = typeof raw.dispatchID === "string" ? raw.dispatchID : undefined
  const reportedAttempt = typeof raw.attempt === "number" ? raw.attempt : undefined
  const hasIdentity = reportedAssignmentID !== undefined || reportedDispatchID !== undefined || reportedAttempt !== undefined
  // Once an expected identity is available, omitting it is just as unsafe as
  // returning another assignment's identity: a late generic response must not
  // be accepted by the current attempt.
  const identityMissing = Boolean(
    expected &&
      (reportedAssignmentID === undefined || reportedDispatchID === undefined || reportedAttempt === undefined),
  )
  const identityMismatch = Boolean(
    expected &&
      (identityMissing ||
        (hasIdentity &&
          (reportedAssignmentID !== expected.assignmentID ||
            reportedDispatchID !== expected.dispatchID ||
            reportedAttempt !== expected.attempt))),
  )
  const blockers = Array.isArray(raw.blockers) ? raw.blockers : []
  if (!hasDeclaredStatus && raw.done !== true && raw.done !== false) blockers.push({ kind: "missing_report_status" })
  if (identityMissing) blockers.push({ kind: "assignment_identity_missing" })
  else if (identityMismatch) {
    blockers.push({ kind: "assignment_identity_mismatch" })
  }
  if (identityMismatch) status = "needs_review"
  return {
    status,
    summary,
    claims: Array.isArray(raw.claims) ? raw.claims : [],
    evidence: Array.isArray(raw.evidence) ? raw.evidence : [],
    artifacts: Array.isArray(raw.artifacts) ? raw.artifacts : [],
    blockers,
    structured: true,
    identityMismatch,
  }
}
