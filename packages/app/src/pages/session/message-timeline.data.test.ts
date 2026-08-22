import { describe, expect, test } from "bun:test"
import type { AssistantMessage, Part, UserMessage } from "@novaway/sdk/v2"
import { Timeline } from "./message-timeline.data"

const user = {
  id: "msg_user",
  role: "user",
  sessionID: "ses_test",
  time: { created: 1 },
  agent: "build",
  model: { providerID: "test", modelID: "test" },
} as UserMessage

const assistant = {
  id: "msg_assistant",
  role: "assistant",
  sessionID: "ses_test",
  parentID: "msg_user",
  agent: "build",
  time: { created: 2, completed: 3 },
} as AssistantMessage

const parts = (input: Part[]) => input

describe("Timeline.constructMessageRows", () => {
  test("hides synthetic-only user messages while keeping assistant output", () => {
    const rows = Timeline.constructMessageRows(
      user,
      (messageID) =>
        ({
          msg_user: parts([
            {
              id: "prt_hidden",
              type: "text",
              text: "hidden build instruction",
              synthetic: true,
              sessionID: "ses_test",
              messageID: "msg_user",
            },
          ]),
          msg_assistant: parts([
            {
              id: "prt_assistant",
              type: "text",
              text: "implementation output",
              sessionID: "ses_test",
              messageID: "msg_assistant",
            },
          ]),
        })[messageID] ?? [],
      [assistant],
      0,
      true,
      "idle",
      false,
    )

    expect(rows.some((row) => row._tag === "UserMessage")).toBe(false)
    expect(rows.some((row) => row._tag === "AssistantPart")).toBe(true)
  })

  test("keeps visible user messages", () => {
    const rows = Timeline.constructMessageRows(
      user,
      (messageID) =>
        ({
          msg_user: parts([
            {
              id: "prt_visible",
              type: "text",
              text: "visible request",
              sessionID: "ses_test",
              messageID: "msg_user",
            },
          ]),
        })[messageID] ?? [],
      [],
      0,
      true,
      "idle",
      false,
    )

    expect(rows.some((row) => row._tag === "UserMessage")).toBe(true)
  })
})
