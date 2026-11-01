import { describe, expect, test } from "bun:test"
import { imageAttachmentsOf, toolImageAttachments } from "./tool-attachments"

const img = (url: string, filename?: string) => ({ type: "file", mime: "image/png", url, filename })

describe("工具行里的图片附件", () => {
  // 回归：用户只让模型"整理资料"，模型 read 了一张原型图 —— 图必须留在这条
  // `read` 行里（展开可见），而不是被时间线当成「验证结果」挂到回复末尾。
  test("read 读进来的图片属于这一行", () => {
    const state = { attachments: [img("data:image/png;base64,AAA", "原型.png")] }
    expect(toolImageAttachments("read", state)).toEqual([
      { url: "data:image/png;base64,AAA", filename: "原型.png" },
    ])
  })

  test("截图工具的图片不在这里重复渲染（它们在轮尾「验证结果」）", () => {
    const state = { attachments: [img("data:image/png;base64,SHOT")] }
    expect(toolImageAttachments("browser_screenshot", state)).toEqual([])
    expect(toolImageAttachments("computer_screenshot", state)).toEqual([])
  })

  test("webfetch 抓到的配图也留在本行", () => {
    const state = { attachments: [img("data:image/jpeg;base64,BB")] }
    expect(toolImageAttachments("webfetch", state)).toEqual([{ url: "data:image/jpeg;base64,BB", filename: undefined }])
  })

  test("非图片附件 / 坏数据被忽略", () => {
    expect(imageAttachmentsOf([{ mime: "application/pdf", url: "data:application/pdf;base64,X" }])).toEqual([])
    expect(imageAttachmentsOf([{ mime: "image/png" }])).toEqual([])
    expect(imageAttachmentsOf([{ mime: "image/png", url: "" }])).toEqual([])
    expect(imageAttachmentsOf([null, undefined])).toEqual([])
    expect(imageAttachmentsOf(undefined)).toEqual([])
    expect(toolImageAttachments("read", { attachments: "nope" })).toEqual([])
    expect(toolImageAttachments("read", null)).toEqual([])
  })

  test("没有附件时返回空数组（不会凭空多出一个展开箭头）", () => {
    expect(toolImageAttachments("read", { attachments: [] })).toEqual([])
    expect(toolImageAttachments("read", {})).toEqual([])
  })
})
