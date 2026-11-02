import type { useSDK } from "@/context/sdk"

/** 待评审请求（服务端 `document-review` 列表与总线事件共用的形状）。 */
export type ReviewPending = {
  id: string
  sessionID: string
  path: string
  kind: string
  title: string
  version?: string
  createdAt: number
}

export type ReviewDecision = "approved" | "revise"

type Client = ReturnType<typeof useSDK>["client"]

const KIND_LABEL: Record<string, string> = {
  prd: "session.review.kind.prd",
  plan: "session.review.kind.plan",
  spec: "session.review.kind.spec",
  design: "session.review.kind.design",
  report: "session.review.kind.report",
  other: "session.review.kind.other",
}

export const kindLabelKey = (kind: unknown) =>
  (typeof kind === "string" ? KIND_LABEL[kind] : undefined) ?? "session.review.kind.other"

/** 等待时长：55s / 3m / 1h 5m。语言无关，外面套「已等待 {{time}}」。 */
export const formatWait = (ms: number) => {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest ? `${hours}h ${rest}m` : `${hours}h`
}

export const replyToReview = (input: {
  client: Client
  directory: string
  sessionID: string
  requestID: string
  decision: ReviewDecision
  feedback?: string
}) =>
  input.client.session.documentReview.reply({
    directory: input.directory,
    sessionID: input.sessionID,
    requestID: input.requestID,
    documentReviewReplyPayload: {
      decision: input.decision,
      ...(input.feedback ? { feedback: input.feedback } : {}),
    },
  })

/**
 * 评审请求已经失效（代理等超时结束了、会话被清掉）时，把用户的结论作为一条普通
 * 消息发回去 —— 这正是代理「停下等下一条用户消息」的恢复路径，用户不用重打一遍。
 */
export const sendReviewAsMessage = (input: { client: Client; directory: string; sessionID: string; text: string }) =>
  input.client.session.promptAsync({
    directory: input.directory,
    sessionID: input.sessionID,
    parts: [{ type: "text", text: input.text }],
  })
