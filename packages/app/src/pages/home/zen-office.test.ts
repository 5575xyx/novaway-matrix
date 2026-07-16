import { describe, expect, test } from "bun:test"
import {
  completeOfficeDraft,
  createOfficePrompt,
  emptyOfficeDraft,
  officeOutputContract,
  zenActions,
} from "./zen-office"

describe("zen office actions", () => {
  test("keeps every office entry actionable", () => {
    expect(zenActions.map((action) => action.id)).toEqual(["document", "ppt"])
    expect(zenActions.every((action) => action.outputs.length > 0 && action.templates.length >= 3)).toBe(true)
  })
})

describe("createOfficePrompt", () => {
  test("defines structured output contracts for every office entry", () => {
    for (const action of zenActions) {
      const contract = officeOutputContract(action.id)
      expect(contract.format.length).toBeGreaterThan(0)
      expect(contract.sections.length).toBeGreaterThanOrEqual(5)
      expect(contract.rules.length).toBeGreaterThanOrEqual(3)
    }
  })

  test("normalizes a draft before preview or submit", () => {
    const action = zenActions.find((item) => item.id === "ppt")!
    expect(emptyOfficeDraft(action)).toEqual({
      subject: "",
      output: "客户提案",
      audience: "",
      source: "",
      requirements: "",
    })

    expect(
      completeOfficeDraft(action, {
        subject: "  ",
        output: "不存在的类型",
        audience: " 管理层 ",
        source: " 背景 ",
        requirements: " 简洁 ",
      }),
    ).toEqual({
      subject: action.placeholder,
      output: "客户提案",
      audience: "管理层",
      source: "背景",
      requirements: "简洁",
    })
  })

  test("uses explicit draft fields in the generated prompt", () => {
    const prompt = createOfficePrompt(zenActions.find((action) => action.id === "ppt")!, {
      subject: "生成 8 页年度经营复盘",
      output: "项目汇报",
      audience: "管理层",
      source: "收入增长 20%，交付延期 2 周。",
      requirements: "先结论后细节，带图表建议。",
    })

    expect(prompt).toContain("AI PPT 大纲与页面内容生成")
    expect(prompt).toContain("生成 8 页年度经营复盘")
    expect(prompt).toContain("项目汇报")
    expect(prompt).toContain("管理层")
    expect(prompt).toContain("收入增长 20%")
    expect(prompt).toContain("结构化产物契约")
    expect(prompt).toContain("Markdown 页级大纲")
    expect(prompt).toContain("### 第 N 页｜标题")
    expect(prompt).toContain("每页包含标题、核心观点、页面文案、视觉建议、配图建议和演讲备注")
    expect(prompt).toContain("全稿最多 5 张")
    expect(prompt).toContain("可沉淀记忆/可进化建议")
    expect(prompt).toContain("不要把未确认的偏好写成确定事实")
  })

  test("falls back to useful defaults when optional fields are empty", () => {
    const prompt = createOfficePrompt(zenActions.find((action) => action.id === "document")!, {
      subject: "写一份项目方案",
      output: "",
      audience: "",
      source: "",
      requirements: "",
    })

    expect(prompt).toContain("项目方案")
    expect(prompt).toContain("未指定，请根据任务内容自行判断。")
    expect(prompt).toContain("暂无补充资料")
    expect(prompt).toContain("保持专业、清晰、可执行")
    expect(prompt).toContain("先给出文档结构")
    expect(prompt).toContain("Markdown 文档，可直接复制保存为 .md")
    expect(prompt).toContain("正文使用「# 办公产物」作为一级标题")
  })
})
