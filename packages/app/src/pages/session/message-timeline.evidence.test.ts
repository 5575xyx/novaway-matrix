import { describe, expect, test } from "bun:test"
import { collectEvidenceImages, isVerificationTool } from "./message-timeline.evidence"

const image = (url: string, filename?: string) => ({
  attachments: [{ type: "file", mime: "image/png", url, filename }],
})

describe("验证结果只收截图工具的产物", () => {
  // 真实回归：用户只让模型"整理资料"，模型 read 了一张原型图（原型.png），
  // 结果回复末尾冒出一张「验证结果」截图 —— 看着像模型在验证什么，其实只是调研。
  test("read / webfetch / notebook 里的图片不算验证结果", () => {
    const parts = [
      { tool: "read", state: image("data:image/png;base64,AAA", "原型.png") },
      { tool: "webfetch", state: image("data:image/png;base64,BBB") },
      { tool: "read", state: image("data:image/png;base64,CCC", "PDF page 1") },
    ]
    expect(collectEvidenceImages(parts)).toEqual([])
  })

  test("browser_screenshot / computer_screenshot 仍然作为验证结果", () => {
    const parts = [
      { tool: "browser_screenshot", state: image("data:image/png;base64,SHOT", "shot.png") },
      { tool: "computer_screenshot", state: image("data:image/png;base64,DESK") },
    ]
    expect(collectEvidenceImages(parts)).toEqual([
      { url: "data:image/png;base64,SHOT", name: "shot.png", tool: "browser_screenshot" },
      { url: "data:image/png;base64,DESK", name: undefined, tool: "computer_screenshot" },
    ])
  })

  test("同一轮里过程图与截图混排，只留截图", () => {
    const parts = [
      { tool: "read", state: image("data:image/png;base64,PROCESS", "原型.png") },
      { tool: "browser_screenshot", state: image("data:image/png;base64,VERIFY", "shot.png") },
    ]
    expect(collectEvidenceImages(parts).map((item) => item.url)).toEqual(["data:image/png;base64,VERIFY"])
  })

  test("非图片附件与坏数据被忽略", () => {
    const parts = [
      { tool: "browser_screenshot", state: { attachments: [{ mime: "application/pdf", url: "data:application/pdf;base64,X" }] } },
      { tool: "browser_screenshot", state: { attachments: [{ mime: "image/png" }] } },
      { tool: "browser_screenshot", state: { attachments: "nope" } },
      { tool: "browser_screenshot", state: null },
      { tool: "browser_screenshot", state: { attachments: [null] } },
    ]
    expect(collectEvidenceImages(parts)).toEqual([])
  })

  test("工具名白名单", () => {
    expect(isVerificationTool("browser_screenshot")).toBe(true)
    expect(isVerificationTool("computer_screenshot")).toBe(true)
    expect(isVerificationTool("read")).toBe(false)
    expect(isVerificationTool(undefined)).toBe(false)
  })
})
