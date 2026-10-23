import { describe, expect, it } from "bun:test"
import { ToolBudget } from "../../src/session/tool-budget"
import type { MessageV2 } from "../../src/session/message-v2"
import { SessionID, MessageID, PartID } from "../../src/session/schema"

const sessionID = SessionID.make("ses_budget")

let seq = 0
const message = (tool: string, output: string): MessageV2.WithParts => ({
  info: {
    id: MessageID.make(`msg_${++seq}`),
    sessionID,
    role: "assistant",
    parentID: MessageID.make("msg_0"),
    mode: "build",
    agent: "build",
    cost: 0,
    path: { cwd: "/tmp", root: "/tmp" },
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    modelID: "test" as never,
    providerID: "test" as never,
    time: { created: Date.now() },
  } as MessageV2.Assistant,
  parts: [
    {
      id: PartID.make(`prt_${seq}`),
      sessionID,
      messageID: MessageID.make(`msg_${seq}`),
      type: "tool",
      callID: `call_${seq}`,
      tool,
      state: {
        status: "completed",
        input: {},
        output,
        title: tool,
        metadata: {},
        time: { start: 1, end: 2 },
      },
    } as MessageV2.ToolPart,
  ],
})

const output = (message: MessageV2.WithParts) => {
  const part = message.parts[0] as MessageV2.ToolPart
  return part.state.status === "completed" ? part.state.output : ""
}

describe("tool result budget", () => {
  it("does nothing while under budget", () => {
    const messages = [message("read", "x".repeat(100)), message("grep", "y".repeat(100))]
    const result = ToolBudget.apply(messages, { budgetChars: 10_000 })
    expect(result.replaced).toBe(0)
    expect(result.messages).toBe(messages)
  })

  it("stubs the oldest results once over budget", () => {
    const big = "a".repeat(5_000)
    const messages = [message("read", big), message("grep", big), message("read", big)]
    const result = ToolBudget.apply(messages, { budgetChars: 6_000, keepRecentMessages: 1 })
    expect(result.replaced).toBe(2)
    expect(output(result.messages[0]!)).toContain(ToolBudget.STUB_PREFIX)
    expect(output(result.messages[1]!)).toContain(ToolBudget.STUB_PREFIX)
    // The newest result is preserved verbatim.
    expect(output(result.messages[2]!)).toBe(big)
  })

  it("keeps the recent window even when over budget", () => {
    const big = "a".repeat(5_000)
    const messages = [message("read", big), message("read", big)]
    const result = ToolBudget.apply(messages, { budgetChars: 1, keepRecentMessages: 2 })
    expect(result.replaced).toBe(0)
  })

  it("never stubs protected tools", () => {
    const big = "a".repeat(5_000)
    const messages = [message("skill", big), message("read", big)]
    const result = ToolBudget.apply(messages, { budgetChars: 1, keepRecentMessages: 0 })
    expect(output(result.messages[0]!)).toBe(big)
    expect(output(result.messages[1]!)).toContain(ToolBudget.STUB_PREFIX)
  })

  it("does not mutate the input messages", () => {
    const big = "a".repeat(5_000)
    const messages = [message("read", big), message("read", big)]
    ToolBudget.apply(messages, { budgetChars: 1, keepRecentMessages: 0 })
    expect(output(messages[0]!)).toBe(big)
  })

  it("is idempotent", () => {
    const big = "a".repeat(5_000)
    const messages = [message("read", big), message("read", big)]
    const once = ToolBudget.apply(messages, { budgetChars: 1, keepRecentMessages: 0 })
    const twice = ToolBudget.apply(once.messages, { budgetChars: 1, keepRecentMessages: 0 })
    expect(twice.replaced).toBe(0)
  })

  it("disabled budget is a no-op", () => {
    const messages = [message("read", "a".repeat(5_000))]
    expect(ToolBudget.apply(messages, { budgetChars: Infinity }).replaced).toBe(0)
    expect(ToolBudget.apply(messages, { budgetChars: 0 }).replaced).toBe(0)
  })
})
