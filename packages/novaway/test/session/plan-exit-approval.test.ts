import { describe, expect, test } from "bun:test"
import { approvedByPlanExit } from "../../src/session/prompt"
import { SessionID } from "../../src/session/schema"

/**
 * `approvedByPlanExit` 是"批准后进入实施"的判据：`beginTurn` 会按 `plan_exit`
 * 注入的合成消息把 phase 重新判成 grill-me，只有它能把这轮顶回 implementation。
 *
 * 判错方向的代价是不对称的：
 * - 误判成 true → 刚批准就把 phase 拉到 implementation，工作流门禁形同虚设；
 * - 误判成 false → 用户点完「开始执行」第一个写工具仍被拦（本次线上 Bug）。
 *
 * 所以每种"看起来像批准"的形态都要单独钉住，尤其是**成功返回但没批准**的那种：
 * 非计划档位下模型乱调 `plan_exit` 会成功返回 "Plan mode is not active"、
 * metadata 是空对象 —— 只判 `status === "completed"` 会把它当成批准。
 */

const sessionID = SessionID.make("ses_plan_signal")

type AnyWithParts = Record<string, unknown>

const textPart = (messageID: string, text: string, synthetic: boolean) => ({
  id: `prt_${messageID}_text`,
  messageID,
  sessionID,
  type: "text",
  text,
  ...(synthetic ? { synthetic: true } : {}),
})

const userMessage = (id: string, options: { synthetic?: boolean; text?: string } = {}): AnyWithParts => ({
  info: { id, sessionID, role: "user", time: { created: 1 } },
  parts: [textPart(id, options.text ?? (options.synthetic ? "The plan has been approved." : "go ahead"), !!options.synthetic)],
})

const assistantMessage = (id: string, parts: AnyWithParts[]): AnyWithParts => ({
  info: { id, sessionID, role: "assistant", parentID: "msg_parent" },
  parts,
})

/** `plan_exit` 的工具 part。`metadata` 是判据本体。 */
const planExitPart = (options: {
  status: "completed" | "error" | "running"
  metadata?: Record<string, unknown>
}): AnyWithParts => {
  const base = {
    id: `prt_plan_exit_${options.status}`,
    messageID: "msg_assistant",
    sessionID,
    type: "tool",
    tool: "plan_exit",
    callID: "call_plan_exit",
  }
  if (options.status === "completed") {
    return {
      ...base,
      state: {
        status: "completed",
        input: {},
        output: "The plan was approved.",
        title: "Leaving plan mode",
        metadata: options.metadata ?? {},
        time: { start: 1, end: 2 },
      },
    }
  }
  if (options.status === "error") {
    return {
      ...base,
      state: { status: "error", input: {}, error: "The user rejected the request.", time: { start: 1, end: 2 } },
    }
  }
  return { ...base, state: { status: "running", input: {}, time: { start: 1 } } }
}

const otherToolPart = (): AnyWithParts => ({
  id: "prt_read",
  messageID: "msg_assistant",
  sessionID,
  type: "tool",
  tool: "read",
  callID: "call_read",
  state: { status: "completed", input: {}, output: "ok", title: "read", metadata: {}, time: { start: 1, end: 2 } },
})

const check = (messages: AnyWithParts[], target: AnyWithParts) =>
  approvedByPlanExit(messages as never, target as never)

describe("approvedByPlanExit", () => {
  test("a standard approval hands the turn to implementation", () => {
    const handoff = userMessage("msg_handoff", { synthetic: true })
    const messages = [
      userMessage("msg_human"),
      assistantMessage("msg_assistant", [planExitPart({ status: "completed", metadata: { execution: "standard" } })]),
      handoff,
    ]
    expect(check(messages, handoff)).toBe(true)
  })

  test("a goal approval counts as well", () => {
    const handoff = userMessage("msg_handoff", { synthetic: true })
    const messages = [
      userMessage("msg_human"),
      assistantMessage("msg_assistant", [planExitPart({ status: "completed", metadata: { execution: "goal" } })]),
      handoff,
    ]
    expect(check(messages, handoff)).toBe(true)
  })

  test("a successful plan_exit outside plan mode is not an approval", () => {
    // 非计划档位下 `plan_exit` 会成功返回 "Plan mode is not active"，metadata 是 {}。
    const handoff = userMessage("msg_handoff", { synthetic: true })
    const messages = [
      userMessage("msg_human"),
      assistantMessage("msg_assistant", [planExitPart({ status: "completed", metadata: {} })]),
      handoff,
    ]
    expect(check(messages, handoff)).toBe(false)
  })

  test("a rejected plan_exit is not an approval", () => {
    const handoff = userMessage("msg_handoff", { synthetic: true })
    const messages = [
      userMessage("msg_human"),
      assistantMessage("msg_assistant", [planExitPart({ status: "error" })]),
      handoff,
    ]
    expect(check(messages, handoff)).toBe(false)
  })

  test("a plan_exit that is still running is not an approval", () => {
    const handoff = userMessage("msg_handoff", { synthetic: true })
    const messages = [
      userMessage("msg_human"),
      assistantMessage("msg_assistant", [planExitPart({ status: "running" })]),
      handoff,
    ]
    expect(check(messages, handoff)).toBe(false)
  })

  test("an approval from an earlier turn does not carry over", () => {
    // 真实时序：批准 → 合成消息 → 实施若干轮 → 真实用户又说了一句 → 又来一条合成消息。
    // 走到真实用户消息就该停：那一轮的批准与这条合成消息无关。
    const later = userMessage("msg_later", { synthetic: true })
    const messages = [
      userMessage("msg_human"),
      assistantMessage("msg_approve", [planExitPart({ status: "completed", metadata: { execution: "standard" } })]),
      userMessage("msg_handoff", { synthetic: true }),
      assistantMessage("msg_impl", [otherToolPart()]),
      userMessage("msg_human_2", { text: "再帮我改个地方" }),
      later,
    ]
    expect(check(messages, later)).toBe(false)
  })

  test("a real user message is reclassified on its own merits", () => {
    // 用户自己敲了新话：这一轮的原因是那句话，不是上一轮的批准。
    const human = userMessage("msg_human")
    const messages = [
      assistantMessage("msg_assistant", [planExitPart({ status: "completed", metadata: { execution: "standard" } })]),
      human,
    ]
    expect(check(messages, human)).toBe(false)
  })

  test("an unknown or missing target message is not an approval", () => {
    const messages = [userMessage("msg_human")]
    expect(check(messages, userMessage("msg_missing", { synthetic: true }))).toBe(false)
    expect(check(messages, undefined as never)).toBe(false)
  })
})
