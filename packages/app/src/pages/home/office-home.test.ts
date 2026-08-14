import { describe, expect, test } from "bun:test"
import {
  createOfficeHomeSubmission,
  defaultOfficeHomeDraft,
  defaultOfficeLaunchConfig,
  normalizeOfficeLaunchConfig,
  officeLaunchConfigFromSearch,
  officeLaunchContextText,
  officeWorkspaceSearch,
} from "./office-home"

describe("office home", () => {
  test("uses scene defaults for a fresh draft", () => {
    expect(defaultOfficeHomeDraft("document").useCase).toBe("项目方案")
    expect(defaultOfficeHomeDraft("ppt").useCase).toBe("客户提案")
    expect(defaultOfficeHomeDraft("ppt").pageCount).toBe("5-10 页")
  })

  test("keeps the visible prompt separate from hidden ppt configuration", () => {
    const draft = {
      ...defaultOfficeHomeDraft("ppt"),
      prompt: "生成产品发布会演示",
      role: "运营",
      useCase: "产品介绍",
      audience: "公众",
    }
    const submission = createOfficeHomeSubmission("ppt", draft)

    expect(submission.prompt).toBe("生成产品发布会演示")
    expect(submission.prompt).not.toContain("PPT Master")
    expect(officeLaunchContextText(submission.launchConfig!)).toContain("PPT Master 对齐流程")
    expect(officeLaunchContextText(submission.launchConfig!)).toContain("运营")
    expect(officeLaunchContextText(submission.launchConfig!)).toContain("面向「公众」")
    expect(officeLaunchContextText(submission.launchConfig!)).toContain("页数必须符合「5-10 页」")
  })

  test("turns the selected material source into an explicit generation rule", () => {
    const text = officeLaunchContextText({
      role: "销售",
      useCase: "客户提案",
      audience: "客户",
      pageCount: "10-15 页",
      material: "使用当前项目文件",
      taskTracking: false,
    })

    expect(text).toContain("主动检索当前项目目录")
    expect(text).toContain("区分事实、推断和待确认项")
  })

  test("turns task tracking on into an explicit schedule or gantt rule", () => {
    const text = officeLaunchContextText({
      role: "项目经理",
      useCase: "项目复盘",
      audience: "管理层",
      pageCount: "10-15 页",
      material: "仅基于描述",
      taskTracking: true,
    })

    expect(text).toContain("- 任务追踪：包含")
    expect(text).toContain("至少安排一页甘特图或排期表")
    expect(text).toContain("任务、负责人、状态和时间必须完整")
  })

  test("turns selected project assets into explicit generation rules", () => {
    const text = officeLaunchContextText({
      role: "产品",
      useCase: "产品介绍",
      audience: "客户",
      pageCount: "10-15 页",
      material: "使用当前项目文件",
      taskTracking: false,
      assets: ["docs/plan.md", "data/sales.xlsx"],
    })

    expect(text).toContain("- 已选素材：docs/plan.md、data/sales.xlsx")
    expect(text).toContain("必须优先核验并使用以下项目素材")
  })

  test("falls back to the on-screen defaults for missing or stale selections", () => {
    expect(normalizeOfficeLaunchConfig("ppt", undefined)).toEqual(defaultOfficeLaunchConfig("ppt"))
    expect(
      normalizeOfficeLaunchConfig("ppt", {
        role: "",
        useCase: "会议纪要",
        audience: "客户",
        pageCount: "",
        material: "仅基于描述",
        taskTracking: true,
      }),
    ).toEqual({
      role: "市场",
      useCase: "客户提案",
      audience: "客户",
      pageCount: "5-10 页",
      material: "仅基于描述",
      taskTracking: true,
    })
  })

  test("restores hidden ppt configuration from navigation parameters", () => {
    const config = officeLaunchConfigFromSearch(
      new URLSearchParams({
        officeRole: "运营",
        officeUseCase: "产品介绍",
        officeAudience: "公众",
        officePages: "5-10 页",
        officeMaterial: "使用当前项目文件",
        officeTaskTracking: "1",
        officeAssets: "docs/plan.md,data/sales.xlsx",
      }),
    )

    expect(config).toEqual({
      role: "运营",
      useCase: "产品介绍",
      audience: "公众",
      pageCount: "5-10 页",
      material: "使用当前项目文件",
      taskTracking: true,
      assets: ["docs/plan.md", "data/sales.xlsx"],
    })
  })

  test("enters the project workspace without forcing submit until the user sends", () => {
    const input = {
      prompt: "生成产品发布会演示",
      officeID: "ppt" as const,
      pptTemplate: "teaching",
      launchConfig: {
        role: "运营",
        useCase: "产品介绍",
        audience: "公众",
        pageCount: "5-10 页",
        material: "使用当前项目文件",
        taskTracking: true,
      },
    }
    const open = officeWorkspaceSearch(input)
    const submit = officeWorkspaceSearch({ ...input, submit: true })

    expect(open.get("prompt")).toBe("生成产品发布会演示")
    expect(open.get("pptTemplate")).toBe("teaching")
    expect(open.get("officeTaskTracking")).toBe("1")
    expect(open.get("submit")).toBeNull()
    expect(submit.get("submit")).toBe("1")
  })
})
