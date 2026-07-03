import { describe, expect, test } from "bun:test"
import type { OfficeArtifact } from "./office-artifact"
import { evaluateOfficeArtifactQuality } from "./office-quality"

function artifact(input?: Partial<OfficeArtifact>): OfficeArtifact {
  return {
    body: [
      "# 办公产物",
      "",
      "## 项目方案",
      "## 一句话结论",
      "本方案目标是提升客户交付效率，并明确下一步行动项。",
      "## 背景与目标",
      "当前项目需要统一推进节奏，减少重复沟通。",
      "## 行动项",
      "- 明确负责人",
      "- 制定截止时间",
    ].join("\n"),
    filename: "项目方案.md",
    memory: "",
    slides: [],
    title: "项目方案",
    ...input,
  }
}

describe("evaluateOfficeArtifactQuality", () => {
  test("marks structured documents as ready", () => {
    const quality = evaluateOfficeArtifactQuality(artifact(), "document")

    expect(quality.status).toBe("ready")
    expect(quality.label).toBe("可交付")
  })

  test("asks ppt artifacts to complete slides", () => {
    const quality = evaluateOfficeArtifactQuality(
      artifact({
        slides: [
          { index: 1, title: "封面", content: "标题" },
          { index: 2, title: "结论", content: "增长" },
        ],
      }),
      "ppt",
    )

    expect(quality.status).toBe("review")
    expect(quality.summary).toContain("页数不少于 3 页")
    expect(quality.summary).toContain("每页有正文")
  })

  test("marks well-structured ppt artifacts as ready", () => {
    const quality = evaluateOfficeArtifactQuality(
      artifact({
        body: "# 办公产物\n\n## 教学 PPT\n视觉、配图、演讲备注、页面布局完整。",
        slides: [
          {
            index: 1,
            title: "课程封面",
            content: "- 小学数学乘法口诀教学\n- 面向三年级课堂\n- 明确学习目标和练习节奏",
            layout: "highlight",
            visual: "大标题配绿色教学插画",
            notes: "用一句话说明本节课目标。",
          },
          {
            index: 2,
            title: "学习目标",
            content: "- 理解乘法口诀规律\n- 能用口诀解决基础应用题\n- 能独立完成课堂练习",
            layout: "cards",
            visual: "三张目标卡片",
            notes: "强调目标可以当堂验证。",
          },
          {
            index: 3,
            title: "课堂流程",
            content: "- 导入问题\n- 口诀讲解\n- 分组练习\n- 总结反馈",
            layout: "process",
            visual: "横向流程箭头",
            notes: "按流程推动课堂节奏。",
          },
        ],
      }),
      "ppt",
    )

    expect(quality.status).toBe("ready")
    expect(quality.label).toBe("可交付")
  })

  test("asks ppt artifacts to use advanced ppt master chart layouts", () => {
    const quality = evaluateOfficeArtifactQuality(
      artifact({
        body: "# 办公产物\n\n## 项目分析\n包含甘特排期、甜甜圈占比、瀑布归因、热力图、雷达能力、韦恩交集、鱼骨根因和客户旅程。",
        slides: [
          {
            index: 1,
            title: "分析概览",
            content: "- 排期\n- 占比\n- 归因",
            layout: "cards",
            visual: "普通卡片",
            notes: "说明问题。",
          },
          {
            index: 2,
            title: "补充说明",
            content: "- 能力\n- 交集\n- 根因",
            layout: "split",
            visual: "左右分栏",
            notes: "提示补图。",
          },
          {
            index: 3,
            title: "行动建议",
            content: "- 旅程\n- 痛点\n- 下一步",
            layout: "highlight",
            visual: "重点页",
            notes: "收束到行动。",
          },
        ],
      }),
      "ppt",
    )

    expect(quality.status).toBe("review")
    expect(quality.summary).toContain("排期内容使用甘特页")
    expect(quality.summary).toContain("占比内容使用甜甜圈页")
    expect(quality.summary).toContain("归因内容使用瀑布页")
    expect(quality.summary).toContain("强度内容使用热力图页")
    expect(quality.summary).toContain("能力内容使用雷达页")
    expect(quality.summary).toContain("交集内容使用韦恩页")
    expect(quality.summary).toContain("根因内容使用鱼骨页")
    expect(quality.summary).toContain("体验内容使用旅程页")
  })

  test("asks ppt artifacts to use ppt master office layouts", () => {
    const quality = evaluateOfficeArtifactQuality(
      artifact({
        body: "# 办公产物\n\n## 办公汇报\n包含 KPI 指标卡、仪表盘达成率、路线图、思维导图、支柱、表格、排期表和组织树。",
        slides: [
          {
            index: 1,
            title: "概览",
            content: "- KPI\n- 仪表盘\n- 路线图",
            layout: "cards",
            visual: "普通卡片",
            notes: "说明问题。",
          },
          {
            index: 2,
            title: "补充",
            content: "- 思维导图\n- 支柱\n- 表格",
            layout: "split",
            visual: "左右分栏",
            notes: "提示补图。",
          },
          {
            index: 3,
            title: "行动",
            content: "- 排期表\n- 组织树\n- 下一步",
            layout: "highlight",
            visual: "重点页",
            notes: "收束到行动。",
          },
        ],
      }),
      "ppt",
    )

    expect(quality.status).toBe("review")
    expect(quality.summary).toContain("指标内容使用 KPI 卡页")
    expect(quality.summary).toContain("达成率内容使用仪表盘页")
    expect(quality.summary).toContain("路线内容使用路线图页")
    expect(quality.summary).toContain("发散内容使用思维导图页")
    expect(quality.summary).toContain("支柱内容使用支柱页")
    expect(quality.summary).toContain("表格内容使用表格页")
    expect(quality.summary).toContain("任务内容使用排期表页")
    expect(quality.summary).toContain("层级内容使用组织树页")
  })

  test("asks ppt artifacts to use ppt master data and report layouts", () => {
    const quality = evaluateOfficeArtifactQuality(
      artifact({
        body: "# 办公产物\n\n## 数据汇报\n包含横向条形排名、折线趋势、帕累托 80/20、气泡三轴、桑基流向、树图面积占比、财务报表和团队名册。",
        slides: [
          {
            index: 1,
            title: "概览",
            content: "- 排名\n- 趋势\n- 贡献",
            layout: "cards",
            visual: "普通卡片",
            notes: "说明问题。",
          },
          {
            index: 2,
            title: "补充",
            content: "- 流向\n- 财务\n- 团队",
            layout: "split",
            visual: "左右分栏",
            notes: "提示补图。",
          },
          {
            index: 3,
            title: "行动",
            content: "- 面积占比\n- 气泡矩阵\n- 下一步",
            layout: "highlight",
            visual: "重点页",
            notes: "收束到行动。",
          },
        ],
      }),
      "ppt",
    )

    expect(quality.status).toBe("review")
    expect(quality.summary).toContain("排名内容使用横向条形页")
    expect(quality.summary).toContain("趋势内容使用折线页")
    expect(quality.summary).toContain("贡献内容使用帕累托页")
    expect(quality.summary).toContain("三轴内容使用气泡页")
    expect(quality.summary).toContain("流向内容使用桑基页")
    expect(quality.summary).toContain("面积内容使用树图页")
    expect(quality.summary).toContain("财务内容使用报表页")
    expect(quality.summary).toContain("团队内容使用名册页")
  })

  test("checks ppt master execution lock rules", () => {
    const quality = evaluateOfficeArtifactQuality(
      artifact({
        body: "# 办公产物\n\n## 复杂图表汇报\n包含帕累托、桑基、甘特和热力图，但页面没有专用图表。",
        slides: Array.from({ length: 6 }, (_, index) => ({
          index: index + 1,
          title: index === 0 ? "ABCDEFGHIJKLMNOPQRSTUVWXYZ123456789" : `普通页面 ${index + 1}`,
          content: "- 内容一\n- 内容二\n- 内容三\n- 内容四\n- 内容五\n- 内容六\n- 内容七\n- 内容八",
          layout: "cards" as const,
          visual: "普通卡片",
          notes: "说明问题。",
        })),
      }),
      "ppt",
    )

    expect(quality.status).toBe("review")
    expect(quality.summary).toContain("页面节奏有起伏")
    expect(quality.summary).toContain("单页信息不过载")
    expect(quality.summary).toContain("版式没有重复堆叠")
    expect(quality.summary).toContain("标题适合投影阅读")
    expect(quality.summary).toContain("复杂图表有专用版式")
  })

  test("checks ppt master chart data verification rules", () => {
    const quality = evaluateOfficeArtifactQuality(
      artifact({
        body: "# 办公产物\n\n## 数据汇报\n视觉、图表、演讲备注、页面布局完整。",
        slides: [
          {
            index: 1,
            title: "指标概览",
            content: "- 增长良好\n- 趋势积极\n- 结果稳定",
            layout: "chart",
            visual: "柱状图",
            notes: "说明趋势。",
          },
          {
            index: 2,
            title: "业务分类",
            content: "- 核心业务\n- 增值业务",
            layout: "donut",
            visual: "环形图",
            notes: "说明分类。",
          },
          {
            index: 3,
            title: "推进排期",
            content: "- 需求整理\n- 方案评审\n- 上线复盘",
            layout: "gantt",
            visual: "甘特图",
            notes: "说明计划。",
          },
          {
            index: 4,
            title: "财务拆解",
            content: "- 经营表现\n- 资源投入\n- 盈利质量",
            layout: "financial",
            visual: "财务报表",
            notes: "说明财务。",
          },
          {
            index: 5,
            title: "路径说明",
            content: "- 访客\n- 线索\n- 成交",
            layout: "sankey",
            visual: "桑基图",
            notes: "说明路径。",
          },
          {
            index: 6,
            title: "团队配置",
            content: "- 产品\n- 设计\n- 运营",
            layout: "team",
            visual: "团队名册",
            notes: "说明组织。",
          },
        ],
      }),
      "ppt",
    )

    expect(quality.status).toBe("review")
    expect(quality.summary).toContain("数据图表包含可核验数值")
    expect(quality.summary).toContain("占比图表包含比例或构成项")
    expect(quality.summary).toContain("排期图表包含阶段时间或负责人")
    expect(quality.summary).toContain("财务图表包含金额收入成本或利润")
    expect(quality.summary).toContain("流向图表包含来源去向或转化")
    expect(quality.summary).toContain("组织图表包含人员角色或职责")
  })

  test("checks ppt master visual review rules", () => {
    const quality = evaluateOfficeArtifactQuality(
      artifact({
        body: "# 办公产物\n\n## 技术方案\n视觉、图表、演讲备注、页面布局完整。",
        slides: [
          {
            index: 1,
            title: "方案概览",
            content: "- 说明目标\n- 说明范围\n- 说明路径",
            layout: "highlight",
            visual: "重点页",
            notes: "说明目标。",
          },
          {
            index: 2,
            title: "系统架构",
            content: "- 接入层\n- 服务层\n- 数据层",
            layout: "architecture",
            visual: "页面",
            notes: "说明架构。",
          },
          {
            index: 3,
            title: "处理流程",
            content: "- 输入\n- 处理\n- 输出",
            layout: "process",
            visual: "普通卡片",
            notes: "说明流程。",
          },
        ],
      }),
      "ppt",
    )

    expect(quality.status).toBe("review")
    expect(quality.summary).toContain("视觉说明具备可执行细节")
    expect(quality.summary).toContain("关键视觉元素没有缺位")
  })

  test("asks ppt artifacts to use matching visual layouts for data architecture and process topics", () => {
    const quality = evaluateOfficeArtifactQuality(
      artifact({
        body: "# 办公产物\n\n## 技术方案\n包含数据指标、系统架构和处理流程。",
        slides: [
          {
            index: 1,
            title: "方案概览",
            content: "- 数据指标增长\n- 系统架构升级\n- 处理流程闭环",
            layout: "highlight",
            visual: "重点结论",
            notes: "先讲结论。",
          },
          {
            index: 2,
            title: "关键内容",
            content: "- 数据收入增长 35%\n- 模块链路优化\n- 审批处理阶段",
            layout: "cards",
            visual: "信息卡片",
            notes: "解释三个维度。",
          },
          {
            index: 3,
            title: "下一步",
            content: "- 试点\n- 复盘\n- 推广",
            layout: "split",
            visual: "左右分栏",
            notes: "落到行动。",
          },
        ],
      }),
      "ppt",
    )

    expect(quality.status).toBe("review")
    expect(quality.summary).toContain("数据内容使用图表页")
    expect(quality.summary).toContain("架构内容使用架构图页")
    expect(quality.summary).toContain("流程内容使用流程页")
  })

  test("asks ppt artifacts to use matching consulting infographic layouts", () => {
    const quality = evaluateOfficeArtifactQuality(
      artifact({
        body: "# 办公产物\n\n## 咨询框架\n包含四象限矩阵、转化漏斗、能力金字塔、增长飞轮和方法论框架。",
        slides: [
          {
            index: 1,
            title: "普通卡片",
            content: "- 四象限矩阵\n- 转化漏斗\n- 能力金字塔\n- 增长飞轮\n- 方法论框架",
            layout: "cards",
            visual: "普通卡片",
            notes: "说明问题。",
          },
          {
            index: 2,
            title: "补充说明",
            content: "- 只做文字解释\n- 没有专用图形页\n- 需要优化",
            layout: "split",
            visual: "左右分栏",
            notes: "提醒补图。",
          },
          {
            index: 3,
            title: "行动建议",
            content: "- 后续按框架补齐\n- 每个图形单独成页\n- 保持可编辑",
            layout: "highlight",
            visual: "重点页",
            notes: "收束。",
          },
        ],
      }),
      "ppt",
    )

    expect(quality.status).toBe("review")
    expect(quality.summary).toContain("矩阵内容使用矩阵页")
    expect(quality.summary).toContain("漏斗内容使用漏斗页")
    expect(quality.summary).toContain("层级内容使用金字塔页")
    expect(quality.summary).toContain("循环内容使用循环页")
    expect(quality.summary).toContain("框架内容使用框架页")
  })

  test("asks ppt artifacts to use matching infographic map and scene layouts", () => {
    const quality = evaluateOfficeArtifactQuality(
      artifact({
        body: "# 办公产物\n\n## 市场故事\n包含数据摘要、区域市场分布和客户案例场景。",
        slides: [
          {
            index: 1,
            title: "普通摘要",
            content: "- 数据摘要\n- 区域市场分布\n- 客户案例场景",
            layout: "cards",
            visual: "普通卡片",
            notes: "说明问题。",
          },
          {
            index: 2,
            title: "补充说明",
            content: "- 没有专用图形页\n- 需要优化\n- 后续补齐",
            layout: "split",
            visual: "左右分栏",
            notes: "提醒补图。",
          },
          {
            index: 3,
            title: "行动建议",
            content: "- 按场景补齐\n- 保持可编辑\n- 统一风格",
            layout: "highlight",
            visual: "重点页",
            notes: "收束。",
          },
        ],
      }),
      "ppt",
    )

    expect(quality.status).toBe("review")
    expect(quality.summary).toContain("摘要内容使用信息图页")
    expect(quality.summary).toContain("区域内容使用地图页")
    expect(quality.summary).toContain("场景内容使用场景页")
  })
})
