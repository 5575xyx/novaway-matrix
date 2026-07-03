import { describe, expect, test } from "bun:test"
import { extractOfficeArtifact, visibleOfficeMessage } from "./office-artifact"

describe("extractOfficeArtifact", () => {
  test("extracts office body and memory suggestions from structured markdown", () => {
    const artifact = extractOfficeArtifact([
      "一些开场说明",
      "",
      "# 办公产物",
      "",
      "## 项目方案",
      "正文内容",
      "",
      "# 可沉淀记忆/可进化建议",
      "- 可沉淀记忆：偏好先结论后细节",
    ].join("\n"))

    expect(artifact?.body).toBe("# 办公产物\n\n## 项目方案\n正文内容")
    expect(artifact?.memory).toBe("- 可沉淀记忆：偏好先结论后细节")
    expect(artifact?.slides).toEqual([])
    expect(artifact?.title).toBe("项目方案")
    expect(artifact?.filename).toBe("项目方案.md")
  })

  test("ignores normal assistant messages", () => {
    expect(extractOfficeArtifact("普通回答\n\n没有结构化办公标题")).toBeUndefined()
  })

  test("does not treat ppt requirement confirmation as an exportable artifact", () => {
    expect(
      extractOfficeArtifact([
        "# 办公产物",
        "",
        "## PPT 需求确认",
        "",
        "- 需要用户确认：本次数学主题与学段。",
      ].join("\n")),
    ).toBeUndefined()
  })

  test("does not export office confirmation text with memory suggestions as artifact card", () => {
    expect(
      extractOfficeArtifact([
        "# 办公产物",
        "",
        "## 数学教学PPT生成",
        "",
        "可沉淀记忆/可进化建议",
        "",
        "- 可沉淀记忆：（暂无，等用户确认后再沉淀）",
        "- 可进化建议：后续可记录用户常用教学页数范围。",
        "- 需要用户确认：本次具体数学主题与学段。",
      ].join("\n")),
    ).toBeUndefined()
  })

  test("hides memory and evolution suggestions from visible assistant text", () => {
    expect(
      visibleOfficeMessage([
        "# 办公产物",
        "",
        "## 教学 PPT",
        "正文",
        "",
        "可沉淀记忆/可进化建议",
        "- 可沉淀记忆：用户偏好 8 页。",
      ].join("\n")),
    ).toBe("# 办公产物\n\n## 教学 PPT\n正文")
  })

  test("keeps artifact usable when memory section is absent", () => {
    const artifact = extractOfficeArtifact("# 办公产物\n\n产品周报\n\n- 完成本周交付")

    expect(artifact?.body).toBe("# 办公产物\n\n产品周报\n\n- 完成本周交付")
    expect(artifact?.memory).toBe("")
    expect(artifact?.slides).toEqual([])
    expect(artifact?.title).toBe("产品周报")
    expect(artifact?.filename).toBe("产品周报.md")
  })

  test("cleans unsafe filename characters", () => {
    const artifact = extractOfficeArtifact("# 办公产物\n\n## 客户/项目:复盘*报告?\n正文")

    expect(artifact?.filename).toBe("客户-项目-复盘报告-.md")
  })

  test("extracts ppt slide outlines from page headings", () => {
    const artifact = extractOfficeArtifact([
      "# 办公产物",
      "",
      "## 年度经营复盘",
      "",
      "### 第 1 页：封面",
      "- 标题：年度经营复盘",
      "- 副标题：增长与交付",
      "",
      "### 第 2 页 | 核心结论",
      "- 收入增长 20%",
      "- 交付延期 2 周",
    ].join("\n"))

    expect(artifact?.slides).toEqual([
      {
        index: 1,
        title: "封面",
        content: "- 标题：年度经营复盘\n- 副标题：增长与交付",
        layout: undefined,
        visual: undefined,
        notes: undefined,
      },
      {
        index: 2,
        title: "核心结论",
        content: "- 收入增长 20%\n- 交付延期 2 周",
        layout: undefined,
        visual: undefined,
        notes: undefined,
      },
    ])
  })

  test("extracts structured ppt layout fields", () => {
    const artifact = extractOfficeArtifact([
      "# 办公产物",
      "",
      "## GraphRAG 培训课件",
      "",
      "### 第 2 页：部署流程",
      "布局：时间线",
      "视觉：横向步骤线，突出部署阶段。",
      "主文案：",
      "- 环境准备",
      "- 图谱构建",
      "- 检索增强",
      "演讲备注：",
      "- 强调每步产出物。",
    ].join("\n"))

    expect(artifact?.slides[0]).toEqual({
      index: 2,
      title: "部署流程",
      content: "主文案：\n- 环境准备\n- 图谱构建\n- 检索增强",
      layout: "timeline",
      visual: "横向步骤线，突出部署阶段。",
      notes: "强调每步产出物。",
    })
  })

  test("extracts ppt image suggestions as visual guidance", () => {
    const artifact = extractOfficeArtifact([
      "# 办公产物",
      "",
      "### 第 3 页：课堂练习",
      "配图建议：使用附件图片 classroom.png；没有附件时生成一张小学生分组练习分数加减法的课堂插图。",
      "主文案：",
      "- 分组练习",
      "- 讲解错题",
    ].join("\n"))

    expect(artifact?.slides[0]?.visual).toContain("课堂插图")
    expect(artifact?.slides[0]?.content).toBe("主文案：\n- 分组练习\n- 讲解错题")
  })

  test("normalizes chart, architecture, and process layouts", () => {
    const artifact = extractOfficeArtifact([
      "# 办公产物",
      "",
      "### 第 1 页：指标概览",
      "布局：图表",
      "主文案：",
      "- 收入增长",
      "",
      "### 第 2 页：系统链路",
      "布局：架构图",
      "主文案：",
      "- 数据源",
      "",
      "### 第 3 页：处理闭环",
      "布局：流程图",
      "主文案：",
      "- 提交",
    ].join("\n"))

    expect(artifact?.slides.map((slide) => slide.layout)).toEqual(["chart", "architecture", "process"])
  })

  test("normalizes ppt master chart library layouts", () => {
    const artifact = extractOfficeArtifact([
      "# 办公产物",
      "",
      "### 第 1 页：项目排期",
      "布局：甘特",
      "主文案：",
      "- 需求澄清",
      "",
      "### 第 2 页：预算归因",
      "布局：瀑布",
      "主文案：",
      "- 起始预算",
      "",
      "### 第 3 页：客户旅程",
      "布局：旅程",
      "主文案：",
      "- 认知",
    ].join("\n"))

    expect(artifact?.slides.map((slide) => slide.layout)).toEqual(["gantt", "waterfall", "journey"])
  })

  test("normalizes ppt master office layout library patterns", () => {
    const artifact = extractOfficeArtifact([
      "# 办公产物",
      "",
      "### 第 1 页：指标概览",
      "布局：KPI",
      "主文案：",
      "- 收入增长 35%",
      "",
      "### 第 2 页：推进路径",
      "布局：路线图",
      "主文案：",
      "- 试点",
      "",
      "### 第 3 页：组织拆解",
      "布局：组织树",
      "主文案：",
      "- 总目标",
    ].join("\n"))

    expect(artifact?.slides.map((slide) => slide.layout)).toEqual(["kpi", "roadmap", "orgtree"])
  })

  test("normalizes ppt master data and report library patterns", () => {
    const artifact = extractOfficeArtifact([
      "# 办公产物",
      "",
      "### 第 1 页：排行分析",
      "布局：横向条形",
      "主文案：",
      "- 渠道 A",
      "",
      "### 第 2 页：流向分析",
      "布局：桑基",
      "主文案：",
      "- 来源",
      "",
      "### 第 3 页：财务明细",
      "布局：财务报表",
      "主文案：",
      "- 收入",
    ].join("\n"))

    expect(artifact?.slides.map((slide) => slide.layout)).toEqual(["hbar", "sankey", "financial"])
  })

  test("normalizes consulting infographic layouts from ppt master patterns", () => {
    const artifact = extractOfficeArtifact([
      "# 办公产物",
      "",
      "### 第 1 页：优先级判断",
      "布局：矩阵",
      "主文案：",
      "- 高价值",
      "",
      "### 第 2 页：转化路径",
      "布局：漏斗",
      "主文案：",
      "- 获客",
      "",
      "### 第 3 页：能力层级",
      "布局：金字塔",
      "主文案：",
      "- 基础能力",
      "",
      "### 第 4 页：增长飞轮",
      "布局：循环",
      "主文案：",
      "- 计划",
      "",
      "### 第 5 页：方法论框架",
      "布局：框架",
      "主文案：",
      "- 核心模型",
    ].join("\n"))

    expect(artifact?.slides.map((slide) => slide.layout)).toEqual(["matrix", "funnel", "pyramid", "cycle", "framework"])
  })

  test("normalizes narrative and regional layouts from ppt master patterns", () => {
    const artifact = extractOfficeArtifact([
      "# 办公产物",
      "",
      "### 第 1 页：指标摘要",
      "布局：信息图",
      "主文案：",
      "- 核心指标",
      "",
      "### 第 2 页：区域分布",
      "布局：地图",
      "主文案：",
      "- 华东市场",
      "",
      "### 第 3 页：客户案例",
      "布局：场景",
      "主文案：",
      "- 使用故事",
    ].join("\n"))

    expect(artifact?.slides.map((slide) => slide.layout)).toEqual(["infographic", "map", "scene"])
  })

  test("uses cover title instead of slide heading for ppt artifact name", () => {
    const artifact = extractOfficeArtifact([
      "# 办公产物",
      "",
      "### 第 1 页：课程封面",
      "主文案：",
      "- 标题：小学数学教学PPT",
      "- 副标题：分数加减法",
      "",
      "### 第 2 页：学习目标",
      "主文案：",
      "- 理解同分母分数加减法",
    ].join("\n"))

    expect(artifact?.title).toBe("小学数学教学PPT")
    expect(artifact?.filename).toBe("小学数学教学PPT.md")
  })
})
