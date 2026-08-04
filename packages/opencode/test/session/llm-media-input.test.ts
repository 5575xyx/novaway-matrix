import { describe, expect, test } from "bun:test"
import { LLM } from "@/session/llm"
import type { MessageV2 } from "@/session/message-v2"

describe("LLM media input", () => {
  test("keeps real user text and image attachments only", () => {
    const parts = [
      {
        id: "part_user",
        messageID: "message_1",
        sessionID: "session_1",
        type: "text",
        text: "生成一张招财猫图片",
      },
      {
        id: "part_context",
        messageID: "message_1",
        sessionID: "session_1",
        type: "text",
        text: "<memory-context>plan mode skill workflow</memory-context>",
        synthetic: true,
      },
      {
        id: "part_ignored",
        messageID: "message_1",
        sessionID: "session_1",
        type: "text",
        text: "ignored internal instruction",
        ignored: true,
      },
      {
        id: "part_image",
        messageID: "message_1",
        sessionID: "session_1",
        type: "file",
        mime: "image/png",
        url: "data:image/png;base64,AAAA",
      },
      {
        id: "part_file",
        messageID: "message_1",
        sessionID: "session_1",
        type: "file",
        mime: "text/plain",
        url: "file:///notes.txt",
      },
    ] as MessageV2.Part[]

    expect(LLM.mediaInput(parts)).toEqual({
      prompt: "生成一张招财猫图片",
      images: ["data:image/png;base64,AAAA"],
    })
  })
})
