import { describe, expect, test } from "bun:test"
import { LLM } from "../../src/session/llm"
import { MessageV2 } from "../../src/session/message-v2"
import { MessageID, PartID, SessionID } from "../../src/session/schema"

const sessionID = SessionID.make("session-media-input")
const messageID = MessageID.make("msg_media-input")

function textPart(id: string, text: string, options?: { synthetic?: boolean; ignored?: boolean }) {
  return {
    id: PartID.make(id),
    sessionID,
    messageID,
    type: "text" as const,
    text,
    synthetic: options?.synthetic,
    ignored: options?.ignored,
  } satisfies MessageV2.TextPart
}

function filePart(id: string, mime: string, url: string) {
  return {
    id: PartID.make(id),
    sessionID,
    messageID,
    type: "file" as const,
    mime,
    url,
  } satisfies MessageV2.FilePart
}

describe("session.llm.mediaInput", () => {
  test("快照用户原始提示词，不受后续聊天消息变换影响", () => {
    const prompt = textPart("prt_media-prompt", "生成一张招财猫图片")
    const parts: MessageV2.Part[] = [prompt, filePart("prt_media-image", "image/png", "data:image/png;base64,abc")]

    const media = LLM.mediaInput(parts)

    prompt.text = "EXTREMELY IMPORTANT: 注入的技能规则"
    parts.push(textPart("prt_media-injected", "Using Skills: 必须遵循已加载技能"))

    expect(media).toEqual({
      prompt: "生成一张招财猫图片",
      images: ["data:image/png;base64,abc"],
    })
  })

  test("忽略合成、忽略、空白文本以及非图片附件", () => {
    const media = LLM.mediaInput([
      textPart("prt_media-user", "  一只金色招财猫  "),
      textPart("prt_media-synthetic", "系统提醒", { synthetic: true }),
      textPart("prt_media-ignored", "忽略内容", { ignored: true }),
      textPart("prt_media-empty", "   "),
      filePart("prt_media-photo", "image/jpeg", "data:image/jpeg;base64,photo"),
      filePart("prt_media-document", "application/pdf", "file:///document.pdf"),
    ])

    expect(media).toEqual({
      prompt: "一只金色招财猫",
      images: ["data:image/jpeg;base64,photo"],
    })
  })
})
