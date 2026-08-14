import { describe, expect, test } from "bun:test"
import { officeAgentSyntheticText, transformOfficePrompt } from "./office-agent-prompt"

describe("office agent prompt", () => {
  test("locks the selected ppt template on the first generation", () => {
    const text = officeAgentSyntheticText({
      actionID: "ppt",
      quickMode: false,
      pptTemplate: "tech",
      launchConfig: {
        role: "市场",
        useCase: "客户提案",
        audience: "公司内部",
        pageCount: "5-10 页",
        material: "未选择",
        taskTracking: false,
      },
    })

    expect(text).toContain("当前锁定的 PPT 模板：科技深色")
    expect(text).toContain("第一次生成的 PPT 必须直接套用当前模板")
    expect(text).toContain("当前已选择的 PPT 生成配置")
  })

  test("injects the latest selections on every ppt turn", () => {
    const text = officeAgentSyntheticText({
      actionID: "ppt",
      quickMode: false,
      pptTemplate: "tech",
      launchConfig: {
        role: "销售",
        useCase: "商业计划",
        audience: "客户",
        pageCount: "15-20 页",
        material: "使用当前项目文件",
        taskTracking: true,
        assets: ["docs/plan.md", "data/sales.xlsx"],
      },
    })

    expect(text).toContain("- 角色：销售")
    expect(text).toContain("- 使用场景：商业计划")
    expect(text).toContain("- 目标受众：客户")
    expect(text).toContain("- 页数：15-20 页")
    expect(text).toContain("- 素材：使用当前项目文件")
    expect(text).toContain("- 任务追踪：包含")
    expect(text).toContain("至少安排一页甘特图或排期表")
    expect(text).toContain("- 已选素材：docs/plan.md、data/sales.xlsx")
    expect(text).toContain("以上配置以本条为准")
  })

  test("falls back to the on-screen defaults when no selection was stored", () => {
    const text = officeAgentSyntheticText({
      actionID: "ppt",
      quickMode: false,
      pptTemplate: "tech",
    })

    expect(text).toContain("当前已选择的 PPT 生成配置")
    expect(text).toContain("- 角色：市场")
    expect(text).toContain("- 使用场景：客户提案")
    expect(text).toContain("- 页数：5-10 页")
  })

  test("omits the ppt configuration block for other office scenes", () => {
    const text = officeAgentSyntheticText({
      actionID: "document",
      quickMode: false,
      pptTemplate: "tech",
    })

    expect(text).not.toContain("当前已选择的 PPT 生成配置")
    expect(text).not.toContain("当前锁定的 PPT 模板")
  })

  test("keeps the selected ppt template on follow-up turns without launch config", () => {
    const text = officeAgentSyntheticText({
      actionID: "ppt",
      quickMode: false,
      pptTemplate: "business",
    })

    expect(text).toContain("当前锁定的 PPT 模板：商务浅色")
    expect(text).toContain("后续生成、补充、润色和重新生成都必须继续使用当前模板")
  })

  test("uses the newly selected template after an explicit switch", () => {
    const before = officeAgentSyntheticText({
      actionID: "ppt",
      quickMode: false,
      pptTemplate: "tech",
    })
    const after = officeAgentSyntheticText({
      actionID: "ppt",
      quickMode: false,
      pptTemplate: "teaching",
    })

    expect(before).toContain("科技深色")
    expect(after).toContain("教学清爽")
    expect(after).not.toContain("当前锁定的 PPT 模板：科技深色")
  })

  test("leaves slash commands untouched", () => {
    const prompt = [{ type: "text" as const, content: "/help", start: 0, end: 5 }]
    expect(
      transformOfficePrompt({
        prompt,
        actionID: "ppt",
        quickMode: false,
        pptTemplate: "tech",
      }),
    ).toBe(prompt)
  })

  test("keeps template context when the follow-up mentions the office artifact", () => {
    const prompt = [{ type: "text" as const, content: "继续修改这个办公产物", start: 0, end: 10 }]
    const result = transformOfficePrompt({
      prompt,
      actionID: "ppt",
      quickMode: false,
      pptTemplate: "minimal",
    })

    expect(Array.isArray(result)).toBe(false)
    if (Array.isArray(result)) return
    expect(result.syntheticText).toContain("当前锁定的 PPT 模板：极简高对比")
  })
})
