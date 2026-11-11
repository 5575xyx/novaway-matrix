import { describe, expect, test } from "bun:test"
import type { Part } from "@novaway/sdk/v2"
import { workingActivity, workingPhraseCount, workingPhraseKey, WORKING_PHRASE_VARIANTS } from "./working-status"
import { dict as en } from "@/i18n/en"
import type { WorkingActivityKey } from "./working-status"

const tool = (name: string, status: "pending" | "running" | "completed" = "running"): Part => ({
  id: `prt_${name}_${status}`,
  sessionID: "ses_1",
  messageID: "msg_1",
  type: "tool",
  callID: `call_${name}`,
  tool: name,
  state:
    status === "completed"
      ? {
          status,
          input: {},
          output: "",
          title: "",
          metadata: {},
          time: { start: 1, end: 2 },
        }
      : status === "running"
        ? { status, input: {}, time: { start: 1 } }
        : { status, input: {}, raw: "" },
})

const reasoning = (done: boolean): Part => ({
  id: `prt_reasoning_${done}`,
  sessionID: "ses_1",
  messageID: "msg_1",
  type: "reasoning",
  text: "先看看这个函数被谁调用",
  time: done ? { start: 1, end: 2 } : { start: 1 },
})

const text = (done: boolean): Part => ({
  id: `prt_text_${done}`,
  sessionID: "ses_1",
  messageID: "msg_1",
  type: "text",
  text: "我打算这样改",
  time: done ? { start: 1, end: 2 } : { start: 1 },
})

const activity = (parts: Part[], input?: Partial<Parameters<typeof workingActivity>[0]>) =>
  workingActivity({ status: { type: "busy" }, parts, ...input }).key

describe("working activity", () => {
  test("names the tool that is actually running", () => {
    expect(activity([tool("shell")])).toBe("session.working.runningCommand")
    expect(activity([tool("read")])).toBe("session.working.reading")
    expect(activity([tool("grep", "pending")])).toBe("session.working.searching")
    expect(activity([tool("todo")])).toBe("session.working.todo")
    expect(activity([tool("task")])).toBe("session.working.delegating")
    expect(activity([tool("generate_image")])).toBe("session.working.image")
    expect(activity([tool("question", "pending")])).toBe("session.working.waitingQuestion")
  })

  test("falls back to a verb for dynamic mcp tool ids", () => {
    expect(activity([tool("repowiki_read_wiki")])).toBe("session.working.reading")
    expect(activity([tool("github_search_issues")])).toBe("session.working.searching")
    expect(activity([tool("some_weird_thing")])).toBe("session.working.usingTool")
  })

  test("reads the last thing that is still moving", () => {
    expect(activity([tool("read", "completed"), reasoning(false)])).toBe("session.working.thinking")
    expect(activity([reasoning(true), text(false)])).toBe("session.working.composing")
    expect(activity([tool("read"), tool("shell", "completed")])).toBe("session.working.reading")
  })

  test("separates 'just started' from 'between steps'", () => {
    expect(activity([])).toBe("session.working.parsing")
    expect(activity([tool("read", "completed"), reasoning(true)])).toBe("session.working.thinking")
  })

  test("waits on the user before anything else", () => {
    expect(activity([tool("shell")], { waiting: "permission" })).toBe("session.working.waitingPermission")
    expect(activity([tool("shell")], { waiting: "question" })).toBe("session.working.waitingQuestion")
  })

  test("reports retries with the attempt count", () => {
    const status = { type: "retry", attempt: 3, message: "boom", next: 0 } as const
    expect(workingActivity({ status, parts: [tool("read")] })).toEqual({
      key: "session.working.retry",
      params: { attempt: 3 },
    })
  })
})

describe("working phrase variants", () => {
  const allKeys = Object.keys(en).filter(
    (key): key is WorkingActivityKey => key.startsWith("session.working.") && !key.includes(".alt"),
  )

  test("maps each state to three phrase keys", () => {
    expect(WORKING_PHRASE_VARIANTS).toBe(3)
    expect(workingPhraseKey("session.working.thinking", 0)).toBe("session.working.thinking")
    expect(workingPhraseKey("session.working.thinking", 1)).toBe("session.working.thinking.alt1")
    expect(workingPhraseKey("session.working.thinking", 2)).toBe("session.working.thinking.alt2")
  })

  test("common states get six phrasings, the rest three", () => {
    expect(workingPhraseCount("session.working.thinking")).toBe(6)
    expect(workingPhraseCount("session.working.runningCommand")).toBe(6)
    expect(workingPhraseCount("session.working.retry")).toBe(3)
    expect(workingPhraseKey("session.working.thinking", 5)).toBe("session.working.thinking.alt5")
    // 非常用状态抽到 3 套之外也要被钳制回已有措辞。
    expect(workingPhraseKey("session.working.retry", 9)).toBe("session.working.retry.alt2")
  })

  test("every generated phrase key exists in the dictionary", () => {
    expect(allKeys.length).toBe(34)
    for (const key of allKeys) {
      for (let variant = 0; variant < workingPhraseCount(key); variant++) {
        expect(workingPhraseKey(key, variant) in en).toBe(true)
      }
    }
  })
})
