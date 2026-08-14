import { describe, expect, test } from "bun:test"
import {
  bytesToBase64,
  createCustomPptTemplate,
  createOfficeExportFile,
  officeArtifactKind,
  officePptTemplates,
  officePptTemplateFile,
  officePptTemplatePreview,
  officePptTemplateSlidePreview,
  officePptTemplateVisual,
} from "./office-export"
import type { OfficeArtifact } from "./office-artifact"
import { officePptTemplateSlideShapes } from "./office-ppt-template-fill"

function artifact(input?: Partial<OfficeArtifact>): OfficeArtifact {
  return {
    body: "# 办公产物\n\n## 产品周报\n\n- 完成本周交付",
    filename: "产品周报.md",
    memory: "",
    slides: [],
    title: "产品周报",
    ...input,
  }
}

function slideArtifact(input?: Partial<OfficeArtifact>): OfficeArtifact {
  return artifact({
    filename: "项目汇报.md",
    slides: [
      { index: 1, title: "项目目标", content: "- 背景\n- 目标" },
      { index: 2, title: "推进计划", content: "- 节奏\n- 风险" },
    ],
    title: "项目汇报",
    ...input,
  })
}

function zipText(bytes: Uint8Array) {
  return new TextDecoder().decode(bytes)
}

describe("createOfficeExportFile", () => {
  test("maps every office agent to its artifact kind", () => {
    expect(officeArtifactKind(artifact(), "office-document")).toBe("document")
    expect(officeArtifactKind(artifact(), "office-ppt")).toBe("ppt")
    expect(officeArtifactKind(artifact(), "office-data")).toBe("data")
    expect(officeArtifactKind(artifact(), "office-design")).toBe("design")
    expect(officeArtifactKind(artifact(), "office-web")).toBe("web")
    expect(officeArtifactKind(artifact(), "office-meeting")).toBe("meeting")
    expect(officeArtifactKind(artifact(), "office-knowledge")).toBe("knowledge")
    expect(officeArtifactKind(artifact(), "office-task")).toBe("task")
    expect(officeArtifactKind(artifact(), "office-communication")).toBe("communication")
  })

  test("exports document artifacts as docx packages", () => {
    const file = createOfficeExportFile(artifact())

    expect(file.filename).toBe("产品周报.docx")
    expect(file.label).toBe("导出 DOCX")
    expect(file.mime).toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.document")
    expect(file.bytes[0]).toBe(0x50)
    expect(file.bytes[1]).toBe(0x4b)
    expect(zipText(file.bytes)).toContain("word/document.xml")
    expect(zipText(file.bytes)).toContain("产品周报")
  })

  test("exports document formulas as editable OMML", () => {
    const text = zipText(
      createOfficeExportFile(
        artifact({
          body: "# 数学文档\n\n能量公式 $E=mc^2$。\n\n分数：\n\n$$\\frac{a}{b}$$",
        }),
      ).bytes,
    )

    expect(text).toContain("<m:oMath")
    expect(text).toContain('<m:oMathPara xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">')
    expect(text).toContain("<m:sSup>")
    expect(text).toContain("<m:f>")
  })

  test("exports slide artifacts as pptx packages", () => {
    const file = createOfficeExportFile(slideArtifact())

    expect(file.filename).toBe("项目汇报.pptx")
    expect(file.label).toBe("导出 PPTX")
    expect(file.mime).toBe("application/vnd.openxmlformats-officedocument.presentationml.presentation")
    expect(file.bytes[0]).toBe(0x50)
    expect(file.bytes[1]).toBe(0x4b)
    expect(zipText(file.bytes)).toContain("ppt/presentation.xml")
    expect(zipText(file.bytes)).toContain("ppt/slides/slide1.xml")
    expect(zipText(file.bytes)).toContain("ppt/slides/_rels/slide1.xml.rels")
    expect(zipText(file.bytes)).toContain("ppt/slideMasters/slideMaster1.xml")
    expect(zipText(file.bytes)).toContain("ppt/slideLayouts/slideLayout1.xml")
    expect(zipText(file.bytes)).toContain("ppt/theme/theme1.xml")
    expect(zipText(file.bytes)).toContain("项目目标")
  })

  test("exposes real PPTX preview and template assets", () => {
    expect(officePptTemplatePreview("pptx-swiss-grid")).toBe(
      "/assets/office-ppt-templates/pptx/swiss-grid/preview/cover.jpg",
    )
    expect(officePptTemplatePreview("pptx-glassmorphism")).toBe(
      "/assets/office-ppt-templates/pptx/glassmorphism/preview/cover.jpg",
    )
    expect(officePptTemplateFile("pptx-swiss-grid")).toBe("/assets/office-ppt-templates/pptx/swiss-grid/template.pptx")
    expect(officePptTemplateFile("pptx-ai-ops")).toBe("/assets/office-ppt-templates/pptx/ai-ops/template.pptx")
    expect(officePptTemplatePreview("presenton-swift")).toBe(
      "/assets/office-ppt-templates/presenton-pptx/swift/preview/cover.jpg",
    )
    expect(officePptTemplateFile("presenton-swift")).toBe(
      "/assets/office-ppt-templates/presenton-pptx/swift/template.pptx",
    )
    expect(officePptTemplateSlidePreview("pptx-swiss-grid", "data")).toBe(
      "/assets/office-ppt-templates/pptx/swiss-grid/preview/data.jpg",
    )
    expect(officePptTemplateSlidePreview("presenton-swift", "closing")).toBe(
      "/assets/office-ppt-templates/presenton-pptx/swift/preview/closing.jpg",
    )
    expect(officePptTemplatePreview("tech")).toBeUndefined()
  })

  test("exports ppt bullet text with valid Chinese OOXML text runs", () => {
    const text = zipText(
      createOfficeExportFile(
        slideArtifact({
          slides: [
            { index: 1, title: "教学课件", content: "- 数学函数专题", layout: "highlight" },
            { index: 2, title: "课堂练习", content: "- 例题讲解\n- 课堂练习\n- 易错点复盘", layout: "highlight" },
          ],
        }),
      ).bytes,
    )

    expect(text).toContain(`char="•"`)
    expect(text).toContain(`lang="zh-CN"`)
    expect(text).toContain("<a:normAutofit")
    expect(text).not.toContain("鈥")
  })

  test("exports editable native formulas from latex markers", () => {
    const text = zipText(
      createOfficeExportFile(
        slideArtifact({
          slides: [
            {
              index: 1,
              title: "数学公式",
              content: "- 能量公式：$E=mc^2$\n- 平方根：$\\sqrt{x}$\n- 分数：$$\\frac{a}{b}$$",
              layout: "highlight",
            },
          ],
        }),
      ).bytes,
    )

    expect(text).toContain("<a14:m")
    expect(text).toContain("<m:oMath>")
    expect(text).toContain("<m:sSup>")
    expect(text).toContain("<m:rad>")
    expect(text).toContain("<m:f>")
    expect(text).not.toContain("$E=mc^2$")
  })

  test("normalizes model-provided slide numbers before packaging", () => {
    const text = zipText(
      createOfficeExportFile(
        slideArtifact({
          slides: [
            { index: 3, title: "封面", content: "- 项目汇报" },
            { index: 3, title: "结论", content: "- 统一页码" },
          ],
        }),
      ).bytes,
    )

    expect(text).toContain("ppt/slides/slide1.xml")
    expect(text).toContain("ppt/slides/slide2.xml")
    expect(text).not.toContain("ppt/slides/slide3.xml")
  })

  test("exports every built-in ppt template with distinct styling", () => {
    const outputs = officePptTemplates
      .filter((template) => template.source !== "Pptx")
      .map((template) => ({
        template,
        text: zipText(createOfficeExportFile(slideArtifact(), { pptTemplate: template.id }).bytes),
      }))

    expect(outputs.length).toBeGreaterThanOrEqual(10)
    expect(outputs.every((item) => item.text.includes("ppt/slides/slide1.xml"))).toBe(true)
    expect(new Set(outputs.map((item) => item.text)).size).toBe(outputs.length)
  })

  test("assigns every built-in ppt template a unique visual motif", () => {
    const legacy = officePptTemplates.filter((template) => template.source !== "Pptx")
    const motifs = legacy.map((template) => officePptTemplateVisual(template.id).motif)

    expect(motifs.every(Boolean)).toBe(true)
    expect(new Set(motifs).size).toBe(legacy.length)
  })

  test("uses different page chrome styles across ppt templates", () => {
    const business = zipText(createOfficeExportFile(slideArtifact(), { pptTemplate: "business" }).bytes)
    const academic = zipText(createOfficeExportFile(slideArtifact(), { pptTemplate: "academic" }).bytes)
    const teaching = zipText(createOfficeExportFile(slideArtifact(), { pptTemplate: "teaching" }).bytes)
    const minimal = zipText(createOfficeExportFile(slideArtifact(), { pptTemplate: "minimal" }).bytes)
    const telecom = zipText(createOfficeExportFile(slideArtifact(), { pptTemplate: "telecom" }).bytes)
    const tech = zipText(createOfficeExportFile(slideArtifact(), { pptTemplate: "tech" }).bytes)

    expect(business).toContain(`<a:ext cx="9144000" cy="430000"/>`)
    expect(academic).toContain("KEY MESSAGE")
    expect(teaching).toContain(`<a:ext cx="8060000" cy="4200000"/>`)
    expect(minimal).toContain(`<a:ext cx="6280000" cy="50000"/>`)
    expect(telecom).toContain("LOGO")
    expect(tech).toContain("HUD")
  })

  test("uses different cover compositions across ppt templates", () => {
    const business = zipText(createOfficeExportFile(slideArtifact(), { pptTemplate: "business" }).bytes)
    const academic = zipText(createOfficeExportFile(slideArtifact(), { pptTemplate: "academic" }).bytes)
    const teaching = zipText(createOfficeExportFile(slideArtifact(), { pptTemplate: "teaching" }).bytes)
    const minimal = zipText(createOfficeExportFile(slideArtifact(), { pptTemplate: "minimal" }).bytes)
    const telecom = zipText(createOfficeExportFile(slideArtifact(), { pptTemplate: "telecom" }).bytes)
    const tech = zipText(createOfficeExportFile(slideArtifact(), { pptTemplate: "tech" }).bytes)

    expect(business).toContain(`<a:ext cx="9144000" cy="1180000"/>`)
    expect(academic).toContain(`<a:ext cx="9144000" cy="620000"/>`)
    expect(teaching).toContain(`<a:ext cx="7920000" cy="3950000"/>`)
    expect(minimal).toContain(`<a:ext cx="6800000" cy="52000"/>`)
    expect(telecom).toContain(`<a:ext cx="1720000" cy="2680000"/>`)
    expect(tech).toContain(`<a:ext cx="1820000" cy="980000"/>`)
  })

  test("renders a complete ppt template page family", () => {
    const text = zipText(
      createOfficeExportFile(
        slideArtifact({
          slides: [
            { index: 1, title: "年度经营汇报", content: "- 战略目标\n- 关键成果\n- 下一步计划" },
            { index: 2, title: "目录", content: "- 目标回顾\n- 数据洞察\n- 行动计划" },
            { index: 3, title: "章节页：核心问题", content: "- 市场变化\n- 组织能力\n- 业务机会" },
            { index: 4, title: "数据洞察", content: "- 收入增长\n- 成本优化\n- 利润改善", layout: "chart" },
            { index: 5, title: "总结与下一步", content: "- 聚焦重点\n- 明确责任\n- 持续复盘" },
          ],
        }),
        { pptTemplate: "ai-ops" },
      ).bytes,
    )

    expect(text).toContain("演示结构")
    expect(text).toContain("01")
    expect(text).toContain("聚焦重点")
    expect(text).toContain("收入增长")
    expect(text).toContain("总结与下一步")
  })

  test("uses template-specific default layouts when slide layout is not specified", () => {
    const input = slideArtifact({
      slides: [
        { index: 1, title: "经营方案", content: "- 目标\n- 计划\n- 成果" },
        { index: 2, title: "关键内容", content: "- 重点一\n- 重点二\n- 重点三\n- 重点四" },
      ],
    })
    const tech = zipText(createOfficeExportFile(input, { pptTemplate: "tech" }).bytes)
    const finance = zipText(createOfficeExportFile(input, { pptTemplate: "finance" }).bytes)
    const creative = zipText(createOfficeExportFile(input, { pptTemplate: "creative" }).bytes)

    expect(tech).toContain("核心层")
    expect(finance).toContain("财务报表")
    expect(creative).toContain("场景叙事")
  })

  test("auto-selects a fitting ppt template from artifact topic", () => {
    const finance = zipText(
      createOfficeExportFile(
        slideArtifact({
          title: "财务经营分析",
          body: "收入、成本、利润和预算指标复盘",
        }),
        { pptTemplate: "auto" },
      ).bytes,
    )
    const product = zipText(
      createOfficeExportFile(
        slideArtifact({
          title: "产品发布路线图",
          body: "用户体验、功能规划和发布节奏",
        }),
        { pptTemplate: "auto" },
      ).bytes,
    )

    expect(finance).not.toBe(product)
    expect(finance).toContain("14532D")
    expect(product).toContain("312E81")
  })

  test("auto-applies pptx template design signals when exporting ppt", () => {
    const text = zipText(
      createOfficeExportFile(
        slideArtifact({
          title: "参考模板汇报",
          body: "PPTX模板设计信号\n- 主题色：#1F4E79、#F2C94C\n- 字体：Aptos\n- 模板页库：封面候选、数据页候选",
        }),
        { pptTemplate: "auto" },
      ).bytes,
    )

    expect(text).toContain("1F4E79")
    expect(text).toContain("F2C94C")
    expect(text).toContain("Aptos")
  })

  test("does not over-match generic growth topics as finance template", () => {
    const growthCampaign = zipText(
      createOfficeExportFile(
        slideArtifact({
          title: "用户增长活动方案",
          body: "营销活动、品牌传播、用户转化和创意设计。",
          slides: [
            { index: 1, title: "增长活动", content: "- 用户触达\n- 品牌传播" },
            { index: 2, title: "创意设计", content: "- 活动玩法\n- 传播物料" },
          ],
        }),
        { pptTemplate: "auto" },
      ).bytes,
    )

    expect(growthCampaign).toContain("9D174D")
    expect(growthCampaign).not.toContain("14532D")
  })

  test("auto-selects teaching and tech templates by content score", () => {
    const teaching = zipText(
      createOfficeExportFile(
        slideArtifact({
          title: "小学数学课堂课件",
          body: "面向学生的教学课程，包含例题、课堂练习和知识点讲解",
        }),
        { pptTemplate: "auto" },
      ).bytes,
    )
    const tech = zipText(
      createOfficeExportFile(
        slideArtifact({
          title: "GraphRAG 技术架构方案",
          body: "系统架构、模块链路、API 集成、部署调优和工程实践",
        }),
        { pptTemplate: "auto" },
      ).bytes,
    )

    expect(teaching).toContain("课堂课件")
    expect(teaching).toContain("166534")
    expect(tech).toContain("技术方案")
    expect(tech).toContain("0F172A")
  })

  test("auto-selects PPT-master deck style templates by topic", () => {
    const cases = [
      { title: "中国电信政企数字化方案", body: "运营商通信网络、政企数字化和转型规划汇报", color: "C00000" },
      { title: "中国电建工程项目技术方案", body: "重大工程报告、技术方案和年度总结", color: "00418D" },
      { title: "中汽研产品认证评测展示", body: "汽车认证展示、评价评测和技术推广", color: "004098" },
      { title: "招商银行交易银行收款方案", body: "销售收款方案、客户案例拆解和分行培训材料", color: "C8152D" },
      { title: "重庆大学学术答辩研究报告", body: "高校学术交流、课题研究和毕业答辩", color: "006BB7" },
    ]

    for (const item of cases) {
      expect(
        zipText(
          createOfficeExportFile(slideArtifact({ title: item.title, body: item.body }), { pptTemplate: "auto" }).bytes,
        ),
      ).toContain(item.color)
    }
  })

  test("auto-selects PPT-master layout style templates by topic", () => {
    const cases = [
      { title: "AI 运维架构汇报", body: "智能运维、可观测、监控告警和数字化转型", color: "DC2626" },
      { title: "重点项目五年规划政策解读", body: "蓝色政务、投资促进和重点项目汇报", color: "0066CC" },
      { title: "政务汇报党建工作总结", body: "红色政务、工作总结和项目推介", color: "DC2626" },
      { title: "医学病例讨论培训", body: "医院临床病例、医学教育和护理培训", color: "0EA5E9" },
      { title: "像素复古编程教程", body: "极客风格、游戏介绍和开发者分享", color: "22C55E" },
      { title: "心理咨询个案分析", body: "心理治疗、依恋关系和咨询案例培训", color: "F97316" },
    ]

    for (const item of cases) {
      expect(
        zipText(
          createOfficeExportFile(slideArtifact({ title: item.title, body: item.body }), { pptTemplate: "auto" }).bytes,
        ),
      ).toContain(item.color)
    }
  })

  test("renders chart, architecture, and process pages as vector shapes", () => {
    const text = zipText(
      createOfficeExportFile(
        slideArtifact({
          slides: [
            { index: 1, title: "方案汇报", content: "- 从指标、架构和流程说明整体方案", layout: "highlight" },
            { index: 2, title: "指标概览", content: "- 收入增长 35%\n- 成本下降 18%\n- 利润提升 42%", layout: "chart" },
            {
              index: 3,
              title: "系统架构",
              content: "- 数据源\n- 图谱构建\n- 检索增强\n- 模型回答",
              layout: "architecture",
            },
            { index: 4, title: "处理闭环", content: "- 提交\n- 审核\n- 生成\n- 发布", layout: "process" },
          ],
        }),
      ).bytes,
    )

    expect(text).toContain("关键指标")
    expect(text).toContain("洞察")
    expect(text).toContain("Shape 72")
    expect(text).toContain("<p:cxnSp>")
    expect(text).toContain(`prst="straightConnector1"`)
    expect(text).toContain("slide4.xml")
  })

  test("reads native connectors back from template slide shape parsing", async () => {
    const bytes = createOfficeExportFile(
      slideArtifact({
        slides: [
          { index: 1, title: "方案汇报", content: "- 从流程说明整体方案", layout: "highlight" },
          { index: 2, title: "处理闭环", content: "- 提交\n- 审核\n- 生成\n- 发布", layout: "process" },
        ],
      }),
    ).bytes
    const shapes = await officePptTemplateSlideShapes("auto", "content", bytes, {
      pageIndex: 1,
      totalPages: 2,
    })
    expect(shapes.some((shape) => shape.name.startsWith("Connector") && shape.kind === "shape")).toBe(true)
  })

  test("renders consulting infographic layouts from ppt master patterns", () => {
    const text = zipText(
      createOfficeExportFile(
        slideArtifact({
          slides: [
            { index: 1, title: "优先级矩阵", content: "- 高价值\n- 机会区\n- 风险区\n- 行动区", layout: "matrix" },
            { index: 2, title: "转化漏斗", content: "- 触达\n- 兴趣\n- 试用\n- 购买\n- 复购", layout: "funnel" },
            { index: 3, title: "能力金字塔", content: "- 愿景\n- 策略\n- 能力\n- 数据\n- 基础设施", layout: "pyramid" },
            { index: 4, title: "增长循环", content: "- 计划\n- 执行\n- 检查\n- 调整", layout: "cycle" },
            {
              index: 5,
              title: "方法论框架",
              content: "- 核心模型\n- 输入\n- 处理\n- 输出\n- 反馈",
              layout: "framework",
            },
          ],
        }),
      ).bytes,
    )

    expect(text).toContain("高价值")
    expect(text).toContain("逐层筛选")
    expect(text).toContain("层级递进")
    expect(text).toContain("闭环")
    expect(text).toContain("核心模型")
  })

  test("renders infographic, map, and scene pages as editable shapes", () => {
    const text = zipText(
      createOfficeExportFile(
        slideArtifact({
          slides: [
            { index: 1, title: "市场故事", content: "- 数据摘要\n- 区域分布\n- 客户案例", layout: "highlight" },
            {
              index: 2,
              title: "指标摘要",
              content: "- 活跃用户增长 35%\n- 留存提升 12%\n- 转化提升 8%",
              layout: "infographic",
            },
            { index: 3, title: "区域分布", content: "- 华东市场\n- 华南市场\n- 西南供应链\n- 北方网点", layout: "map" },
            { index: 4, title: "客户案例", content: "- 课堂导入\n- 分组讨论\n- 课后复盘\n- 持续改进", layout: "scene" },
          ],
        }),
      ).bytes,
    )

    expect(text).toContain("信息摘要")
    expect(text).toContain("区域分布 / 市场覆盖")
    expect(text).toContain("场景叙事")
    expect(text).toContain("活跃用户增长")
    expect(text).toContain("华东市场")
    expect(text).toContain("课堂导入")
  })

  test("renders advanced ppt master chart layouts as editable shapes", () => {
    const text = zipText(
      createOfficeExportFile(
        slideArtifact({
          slides: [
            { index: 1, title: "项目分析", content: "- 高级图表版式演示", layout: "highlight" },
            { index: 2, title: "项目排期", content: "- 需求澄清\n- 设计\n- 开发\n- 测试\n- 发布", layout: "gantt" },
            { index: 3, title: "预算占比", content: "- 研发 40%\n- 市场 25%\n- 运营 20%\n- 服务 15%", layout: "donut" },
            {
              index: 4,
              title: "利润变动",
              content: "- 起始 100\n- 收入 45\n- 成本 -18\n- 费用 -12\n- 结束 115",
              layout: "waterfall",
            },
            {
              index: 5,
              title: "活跃热力",
              content: "- 周一\n- 周二\n- 周三\n- 周四\n- 周五\n- 周六",
              layout: "heatmap",
            },
            { index: 6, title: "能力雷达", content: "- 产品\n- 技术\n- 交付\n- 数据\n- 运营\n- 服务", layout: "radar" },
            { index: 7, title: "交集分析", content: "- 共同价值\n- 用户需求\n- 产品能力\n- 商业目标", layout: "venn" },
            {
              index: 8,
              title: "根因分析",
              content: "- 人员\n- 流程\n- 工具\n- 数据\n- 协作\n- 机制",
              layout: "fishbone",
            },
            { index: 9, title: "客户旅程", content: "- 认知\n- 评估\n- 购买\n- 使用\n- 复购", layout: "journey" },
          ],
        }),
      ).bytes,
    )

    expect(text).toContain("甘特排期")
    expect(text).toContain("甜甜圈占比")
    expect(text).toContain("瀑布拆解")
    expect(text).toContain("热力矩阵")
    expect(text).toContain("能力雷达")
    expect(text).toContain("韦恩交集")
    expect(text).toContain("鱼骨根因")
    expect(text).toContain("旅程地图")
    expect(text).toContain(`prst="ellipse"`)
    expect(text).toContain(`<p:cxnSp>`)
    expect(text).toContain(`prst="straightConnector1"`)
  })

  test("renders ppt master office layouts as editable shapes", () => {
    const text = zipText(
      createOfficeExportFile(
        slideArtifact({
          slides: [
            { index: 1, title: "办公版式", content: "- 通用办公图形版式", layout: "highlight" },
            { index: 2, title: "指标概览", content: "- 收入 35%\n- 成本 -12%\n- 利润 18%\n- 留存 76%", layout: "kpi" },
            { index: 3, title: "达成率", content: "- 完成率 82%\n- 风险可控\n- 下周复盘", layout: "gauge" },
            { index: 4, title: "战略路径", content: "- 试点\n- 扩展\n- 标准化\n- 规模化", layout: "roadmap" },
            { index: 5, title: "主题发散", content: "- 产品\n- 数据\n- 运营\n- 服务", layout: "mindmap" },
            { index: 6, title: "能力支柱", content: "- 技术\n- 流程\n- 组织\n- 数据", layout: "pillars" },
            { index: 7, title: "方案对比", content: "- 成本\n- 收益\n- 风险\n- 周期", layout: "table" },
            { index: 8, title: "任务追踪", content: "- 需求澄清\n- 方案设计\n- 交付验证", layout: "schedule" },
            { index: 9, title: "目标拆解", content: "- 总目标\n- 子目标 A\n- 子目标 B\n- 子目标 C", layout: "orgtree" },
          ],
        }),
      ).bytes,
    )

    expect(text).toContain("KPI 指标卡")
    expect(text).toContain("目标仪表盘")
    expect(text).toContain("纵向路线图")
    expect(text).toContain("核心主题")
    expect(text).toContain("核心支柱")
    expect(text).toContain("对比表格")
    expect(text).toContain("项目排期表")
    expect(text).toContain("层级拆解树")
  })

  test("renders ppt master data and report layouts as editable shapes", () => {
    const text = zipText(
      createOfficeExportFile(
        slideArtifact({
          slides: [
            { index: 1, title: "数据汇报", content: "- 数据与汇报版式演示", layout: "highlight" },
            { index: 2, title: "排行分析", content: "- 渠道 A 80\n- 渠道 B 60\n- 渠道 C 40", layout: "hbar" },
            { index: 3, title: "趋势分析", content: "- Q1 20\n- Q2 35\n- Q3 42\n- Q4 56", layout: "line" },
            { index: 4, title: "贡献分析", content: "- 问题 A 50\n- 问题 B 30\n- 问题 C 20", layout: "pareto" },
            { index: 5, title: "机会气泡", content: "- 市场 A\n- 市场 B\n- 市场 C", layout: "bubble" },
            { index: 6, title: "流向分析", content: "- 官网\n- 渠道\n- 活动\n- 转化\n- 复购", layout: "sankey" },
            { index: 7, title: "面积占比", content: "- 业务 A\n- 业务 B\n- 业务 C", layout: "treemap" },
            { index: 8, title: "财务报表", content: "- 收入 100\n- 成本 60\n- 利润 40", layout: "financial" },
            { index: 9, title: "团队名册", content: "- 产品负责人\n- 技术负责人\n- 运营负责人", layout: "team" },
          ],
        }),
      ).bytes,
    )

    expect(text).toContain("横向排行")
    expect(text).toContain("趋势折线")
    expect(text).toContain("帕累托 80/20")
    expect(text).toContain("气泡矩阵")
    expect(text).toContain("桑基流向")
    expect(text).toContain("<p:cxnSp>")
    expect(text).toContain("面积树图")
    expect(text).toContain("财务报表")
    expect(text).toContain("团队名册")
  })

  test("writes template typography into ppt theme", () => {
    const academic = zipText(createOfficeExportFile(slideArtifact(), { pptTemplate: "academic" }).bytes)
    const creative = zipText(createOfficeExportFile(slideArtifact(), { pptTemplate: "creative" }).bytes)

    expect(academic).toContain(`typeface="SimSun"`)
    expect(academic).toContain(`typeface="Georgia"`)
    expect(creative).toContain(`typeface="Arial Black"`)
  })

  test("renders teaching ppt with classroom visual composition", () => {
    const text = zipText(
      createOfficeExportFile(
        slideArtifact({
          title: "小学数学教学PPT",
          body: "用于小学课堂讲解、例题和课堂练习",
          slides: [
            {
              index: 1,
              title: "课程封面",
              content: "主文案：\n- 标题：小学数学教学PPT\n- 副标题：分数加减法",
              layout: "highlight",
            },
            {
              index: 2,
              title: "课堂练习",
              content: "主文案：\n- 同分母分数相加\n- 分母不变，分子相加\n- 例题讲解\n- 学生独立完成练习",
              layout: "cards",
              visual: "课堂教学卡片和练习板",
            },
          ],
        }),
        { pptTemplate: "teaching" },
      ).bytes,
    )

    expect(text).toContain("课堂课件")
    expect(text).toContain("课堂练习板")
    expect(text).toContain("课堂视觉")
    expect(text).not.toContain(">主文案：<")
  })

  test("renders non-teaching ppt with designed layout markers", () => {
    const text = zipText(
      createOfficeExportFile(
        slideArtifact({
          title: "年度经营复盘",
          body: "经营指标、方案对比、阶段计划和核心结论",
          slides: [
            { index: 1, title: "年度经营复盘", content: "- 收入增长\n- 成本优化" },
            { index: 2, title: "方案取舍", content: "- 增长优先\n- 利润优先\n- 风险控制", layout: "comparison" },
            { index: 3, title: "推进节奏", content: "- 诊断\n- 试点\n- 扩展\n- 复盘", layout: "timeline" },
            { index: 4, title: "关键指标", content: "- 收入增长 28%\n- 成本下降 12%\n- 利润提升 19%", layout: "chart" },
            { index: 5, title: "核心结论", content: "- 优先聚焦高毛利产品\n- 建立月度复盘机制", layout: "split" },
          ],
        }),
        { pptTemplate: "business" },
      ).bytes,
    )

    expect(text).toContain("VS")
    expect(text).toContain("阶段 1")
    expect(text).toContain("建议动作")
    expect(text).toContain("核心结论")
  })

  test("auto-renders agenda and summary page masters", () => {
    const text = zipText(
      createOfficeExportFile(
        slideArtifact({
          title: "产品发布计划",
          body: "产品路线、发布节奏和下一步行动",
          slides: [
            { index: 1, title: "产品发布计划", content: "- 新功能\n- 发布节奏" },
            { index: 2, title: "目录", content: "- 背景\n- 核心能力\n- 发布计划\n- 风险控制" },
            { index: 3, title: "总结与下一步", content: "- 完成内测\n- 启动灰度\n- 收集反馈\n- 正式发布" },
          ],
        }),
        { pptTemplate: "auto" },
      ).bytes,
    )

    expect(text).toContain("产品发布")
    expect(text).toContain("演示结构")
    expect(text).toContain("按章节推进")
    expect(text).toContain("正式发布")
  })

  test("exports ppt with custom template generated from user style description", () => {
    const custom = createCustomPptTemplate("黑金高端商务风，适合董事会经营汇报", "年度经营复盘")
    const text = zipText(createOfficeExportFile(slideArtifact(), { pptTemplate: custom }).bytes)

    expect(custom.name).toContain("模板")
    expect(text).toContain("09090B")
    expect(text).toContain("D97706")
    expect(text).toContain("FFF7ED")
  })

  test("exports ppt with custom template from pptx design signals", () => {
    const custom = createCustomPptTemplate(
      "PPTX模板设计信号\n- 主题色：#1F4E79、#F2C94C\n- 字体：Aptos\n- 模板页库：封面候选、数据页候选",
      "参考模板",
    )
    const text = zipText(createOfficeExportFile(slideArtifact(), { pptTemplate: custom }).bytes)

    expect(text).toContain("1F4E79")
    expect(text).toContain("F2C94C")
    expect(text).toContain("Aptos")
  })

  test("adds topic-matched illustration panels to suitable ppt pages", () => {
    const text = zipText(
      createOfficeExportFile(
        slideArtifact({
          title: "小学数学教学PPT",
          body: "分数加减法课堂教学",
          slides: [
            { index: 1, title: "小学数学教学PPT", content: "- 分数加减法" },
            { index: 2, title: "课堂练习", content: "- 学生分组练习\n- 例题讲解", layout: "split" },
            { index: 3, title: "关键指标", content: "- 正确率 90%\n- 参与度 85%", layout: "chart" },
          ],
        }),
        { pptTemplate: "teaching" },
      ).bytes,
    )

    expect(text).toContain("主题配图")
    expect(text).toContain("1/2")
    expect(text).toContain("关键指标")
  })

  test("embeds data url images into ppt media parts", () => {
    const text = zipText(
      createOfficeExportFile(
        slideArtifact({
          slides: [
            { index: 1, title: "产品发布", content: "- 发布节奏" },
            {
              index: 2,
              title: "产品视觉",
              content: "- 展示产品主视觉",
              visual: "![产品主视觉](data:image/png;base64,iVBORw0KGgo=)",
            },
          ],
        }),
        { pptTemplate: "product" },
      ).bytes,
    )

    expect(text).toContain("ppt/media/slide2-image1.png")
    expect(text).toContain("relationships/image")
    expect(text).toContain("<p:pic>")
    expect(text).toContain('r:embed="rId2"')
  })

  test("exports speaker notes as editable ppt notes slides", () => {
    const text = zipText(
      createOfficeExportFile(
        slideArtifact({
          slides: [
            { index: 1, title: "Cover", content: "- Opening", notes: "Open with the course goal." },
            {
              index: 2,
              title: "Practice",
              content: "- Example\n- Exercise",
              notes: "- Explain the example\n- Leave two minutes",
            },
          ],
        }),
      ).bytes,
    )

    expect(text).toContain("ppt/notesSlides/notesSlide1.xml")
    expect(text).toContain("ppt/notesSlides/_rels/notesSlide1.xml.rels")
    expect(text).toContain("ppt/notesMasters/notesMaster1.xml")
    expect(text).toContain("relationships/notesSlide")
    expect(text).toContain("relationships/notesMaster")
    expect(text).toContain("Open with the course goal.")
    expect(text).toContain("Explain the example")
  })

  test("adds content-aware transitions to exported ppt slides", () => {
    const text = zipText(
      createOfficeExportFile(
        slideArtifact({
          slides: [
            { index: 1, title: "Cover", content: "- Opening", layout: "highlight" },
            { index: 2, title: "Process", content: "- Step one\n- Step two", layout: "process" },
            { index: 3, title: "Architecture", content: "- Layer one\n- Layer two", layout: "architecture" },
            { index: 4, title: "Market", content: "- Region one\n- Region two", layout: "map" },
            { index: 5, title: "Insight", content: "- Visual emphasis\n- Key signal", layout: "cards" },
            { index: 6, title: "Summary", content: "- Next step\n- Closing", layout: "highlight" },
          ],
        }),
        { pptTemplate: "tech" },
      ).bytes,
    )

    expect(text).toContain(`<p:transition spd="slow"><p:fade/></p:transition>`)
    expect(text).toContain(`<p:transition spd="med"><p:wipe dir="l"/></p:transition>`)
    expect(text).toContain(`<p:transition spd="med"><p:push dir="l"/></p:transition>`)
    expect(text).toContain(`<p:transition spd="med"><p:cover dir="l"/></p:transition>`)
    expect(text).toContain(`<p:transition spd="med"><p:strips dir="ld"/></p:transition>`)
  })

  test("maps artifacts to project office folders", () => {
    expect(officeArtifactKind(artifact())).toBe("document")
    expect(officeArtifactKind(artifact({ slides: [{ index: 1, title: "标题", content: "正文" }] }))).toBe("ppt")
  })

  test("encodes export bytes as base64", () => {
    expect(bytesToBase64(new Uint8Array([0x50, 0x4b, 0x03, 0x04]))).toBe("UEsDBA==")
  })
})
