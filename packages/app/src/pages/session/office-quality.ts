import type { OfficeArtifact } from "./office-artifact"
import type { OfficeArtifactKind } from "./office-export"

export type OfficeQualityStatus = "ready" | "review"

export type OfficeQualityCheck = {
  label: string
  passed: boolean
}

export type OfficeQuality = {
  status: OfficeQualityStatus
  label: string
  summary: string
  checks: OfficeQualityCheck[]
}

export function evaluateOfficeArtifactQuality(artifact: OfficeArtifact, kind: OfficeArtifactKind): OfficeQuality {
  const checks = artifact.slides.length > 0 ? pptChecks(artifact) : documentChecks(artifact, kind)
  const missing = checks.filter((check) => !check.passed)
  if (missing.length === 0) {
    return {
      status: "ready",
      label: "可交付",
      summary: "结构完整，可以导出或保存。",
      checks,
    }
  }

  return {
    status: "review",
    label: "建议补充",
    summary: `${missing.length} 项提醒：${missing.map((check) => check.label).join("、")}`,
    checks,
  }
}

function documentChecks(artifact: OfficeArtifact, kind: OfficeArtifactKind): OfficeQualityCheck[] {
  const body = normalized(artifact.body)
  return [
    { label: "标题明确", passed: artifact.title.trim().length > 0 && artifact.title !== "办公产物" },
    { label: "正文充实", passed: body.length >= 80 },
    { label: "结构分区", passed: /^##\s+/m.test(artifact.body) || markdownTable(artifact.body) },
    sceneCheck(kind, body),
  ]
}

function pptChecks(artifact: OfficeArtifact): OfficeQualityCheck[] {
  const body = normalized(artifact.body)
  const layouts = new Set(artifact.slides.map((slide) => slide.layout).filter(Boolean))
  return [
    { label: "页数不少于 3 页", passed: artifact.slides.length >= 3 },
    { label: "每页有标题", passed: artifact.slides.every((slide) => slide.title.trim().length > 0) },
    { label: "每页有正文", passed: artifact.slides.every((slide) => normalized(slide.content).length >= 20) },
    { label: "主要页面标注布局", passed: slideCoverage(artifact, (slide) => !!slide.layout, 0.8) },
    { label: "主要页面有视觉建议", passed: slideCoverage(artifact, (slide) => !!slide.visual, 0.6) },
    { label: "主要页面有演讲备注", passed: slideCoverage(artifact, (slide) => !!slide.notes, 0.6) },
    { label: "版式足够丰富", passed: layouts.size >= Math.min(3, artifact.slides.length) },
    {
      label: "包含视觉或演讲备注",
      passed: /视觉|图表|配图|演讲|备注|讲稿|页面/.test(artifact.body),
    },
    ...pptDesignLockChecks(artifact, layouts),
    ...pptChartDataChecks(artifact),
    ...pptVisualReviewChecks(artifact),
    ...pptTopicChecks(body, layouts),
  ]
}

function slideCoverage(artifact: OfficeArtifact, predicate: (slide: OfficeArtifact["slides"][number]) => boolean, ratio: number) {
  if (artifact.slides.length === 0) return false
  return artifact.slides.filter(predicate).length / artifact.slides.length >= ratio
}

function pptDesignLockChecks(artifact: OfficeArtifact, layouts: Set<OfficeArtifact["slides"][number]["layout"]>): OfficeQualityCheck[] {
  const layoutList = artifact.slides.map((slide) => slide.layout).filter((layout): layout is NonNullable<typeof layout> => !!layout)
  return [
    {
      label: "页面节奏有起伏",
      passed:
        artifact.slides.length < 6 ||
        artifact.slides.some((slide) => /目录|大纲|议程|agenda|outline/.test(slide.title + slide.content)) ||
        artifact.slides.some((slide) => /总结|结论|下一步|行动|收获|summary|conclusion|next/.test(slide.title + slide.content)),
    },
    {
      label: "单页信息不过载",
      passed: artifact.slides.every((slide) => slideLines(slide.content).length <= 7),
    },
    {
      label: "版式没有重复堆叠",
      passed:
        layoutList.length === 0 ||
        Math.max(...Array.from(new Set(layoutList)).map((layout) => layoutList.filter((item) => item === layout).length)) <=
          Math.ceil(artifact.slides.length * 0.55),
    },
    {
      label: "标题适合投影阅读",
      passed: artifact.slides.every((slide) => normalized(slide.title).length <= 24),
    },
    {
      label: "复杂图表有专用版式",
      passed:
        !/帕累托|桑基|甘特|热力图|雷达|韦恩|鱼骨|树图|财务报表|团队名册|pareto|sankey|gantt|heatmap|radar|venn|fishbone|treemap/.test(
          normalized(artifact.body),
        ) ||
        Array.from(layouts)
          .filter((layout): layout is NonNullable<typeof layout> => !!layout)
          .some((layout) =>
          ["pareto", "sankey", "gantt", "heatmap", "radar", "venn", "fishbone", "treemap", "financial", "team"].includes(layout),
        ),
    },
  ]
}

function slideLines(input: string) {
  return input
    .split("\n")
    .map((line) => line.trim().replace(/^[-*•]\s*/, ""))
    .filter(Boolean)
}

function pptChartDataChecks(artifact: OfficeArtifact): OfficeQualityCheck[] {
  return [
    dataLayoutCheck(artifact, ["chart", "hbar", "line", "pareto", "bubble", "kpi", "gauge"], "数据图表包含可核验数值", hasNumericSignal),
    dataLayoutCheck(artifact, ["donut", "treemap", "funnel"], "占比图表包含比例或构成项", (text, slide) =>
      hasRatioSignal(text) || slideLines(slide.content).length >= 3,
    ),
    dataLayoutCheck(artifact, ["gantt", "schedule", "roadmap"], "排期图表包含阶段时间或负责人", hasTimelineSignal),
    dataLayoutCheck(artifact, ["waterfall", "financial"], "财务图表包含金额收入成本或利润", hasFinancialSignal),
    dataLayoutCheck(artifact, ["sankey"], "流向图表包含来源去向或转化", hasFlowSignal),
    dataLayoutCheck(artifact, ["team", "orgtree"], "组织图表包含人员角色或职责", hasTeamSignal),
  ].filter((check): check is OfficeQualityCheck => !!check)
}

function pptVisualReviewChecks(artifact: OfficeArtifact): OfficeQualityCheck[] {
  const slidesWithVisual = artifact.slides.filter((slide) => slide.visual?.trim())
  if (slidesWithVisual.length === 0) return []
  return [
    {
      label: "视觉说明具备可执行细节",
      passed: slidesWithVisual.filter((slide) => hasExecutableVisual(slide.visual ?? "")).length / slidesWithVisual.length >= 0.6,
    },
    {
      label: "关键视觉元素没有缺位",
      passed: artifact.slides.every((slide) => !requiresVisualElement(slide.layout) || hasKeyVisualElement(slide.visual ?? "")),
    },
  ]
}

function hasExecutableVisual(input: string) {
  const text = normalized(input)
  return text.length >= 6 && !/^(普通卡片|左右分栏|重点页|图表|配图|视觉|页面)$/i.test(text) && hasKeyVisualElement(input)
}

function requiresVisualElement(layout: OfficeArtifact["slides"][number]["layout"]) {
  return !!layout && ["chart", "architecture", "process", "map", "scene", "gantt", "donut", "waterfall", "heatmap", "radar", "journey", "hbar", "line", "pareto", "bubble", "sankey", "treemap", "financial"].includes(layout)
}

function hasKeyVisualElement(input: string) {
  return /颜色|图形|图表|配图|图片|插画|照片|图标|箭头|卡片|轴|标签|图例|区域|节点|人物|背景|留白|对比|分栏|矩阵|流程|甘特|柱|线|环|表|地图|场景|结构|层级|关系|布局|shape|chart|image|icon|axis|label|legend|node|arrow|card/i.test(input)
}

function dataLayoutCheck(
  artifact: OfficeArtifact,
  layouts: NonNullable<OfficeArtifact["slides"][number]["layout"]>[],
  label: string,
  predicate: (text: string, slide: OfficeArtifact["slides"][number]) => boolean,
) {
  const slides = artifact.slides.filter((slide) => slide.layout && layouts.includes(slide.layout))
  if (slides.length === 0) return undefined
  return {
    label,
    passed: slides.every((slide) => predicate(normalized(`${slide.title}\n${slide.content}\n${slide.visual ?? ""}\n${slide.notes ?? ""}`), slide)),
  }
}

function hasNumericSignal(text: string) {
  return /\d|%|％|第[一二三四五六七八九十]|top|rank|no\./i.test(text)
}

function hasRatioSignal(text: string) {
  return /\d|%|％|占比|比例|构成|份额|组成|结构|share|ratio|percent/i.test(text)
}

function hasTimelineSignal(text: string) {
  return /\d|年|月|日|周|季度|q[1-4]|阶段|里程碑|时间|周期|负责人|owner|deadline|status/i.test(text)
}

function hasFinancialSignal(text: string) {
  return /\d|¥|￥|\$|收入|成本|利润|预算|现金流|毛利|净利|费用|金额|同比|环比|revenue|cost|profit|budget|cash/i.test(text)
}

function hasFlowSignal(text: string) {
  return /\d|来源|去向|流向|转化|流量|入口|出口|分配|到|至|from|to|source|target|flow|conversion/i.test(text)
}

function hasTeamSignal(text: string) {
  return /负责人|成员|角色|职责|部门|岗位|汇报|协作|owner|member|role|team|dept|department/i.test(text)
}

function pptTopicChecks(body: string, layouts: Set<OfficeArtifact["slides"][number]["layout"]>): OfficeQualityCheck[] {
  return [
    /数据|指标|图表|趋势|占比|增长|收入|成本|利润|kpi|dashboard|metric|chart/.test(body)
      ? { label: "数据内容使用图表页", passed: layouts.has("chart") }
      : undefined,
    /架构|系统|模块|链路|分层|接口|rag|graphrag|architecture/.test(body)
      ? { label: "架构内容使用架构图页", passed: layouts.has("architecture") }
      : undefined,
    /流程|步骤|闭环|路径|阶段|审批|处理|process|flow/.test(body)
      ? { label: "流程内容使用流程页", passed: layouts.has("process") || layouts.has("timeline") }
      : undefined,
    /矩阵|四象限|象限|swot|bcg|matrix/.test(body)
      ? { label: "矩阵内容使用矩阵页", passed: layouts.has("matrix") }
      : undefined,
    /漏斗|转化|销售漏斗|获客|funnel/.test(body)
      ? { label: "漏斗内容使用漏斗页", passed: layouts.has("funnel") }
      : undefined,
    /金字塔|层级|能力栈|价值栈|pyramid/.test(body)
      ? { label: "层级内容使用金字塔页", passed: layouts.has("pyramid") }
      : undefined,
    /循环|飞轮|pdca|cycle/.test(body)
      ? { label: "循环内容使用循环页", passed: layouts.has("cycle") }
      : undefined,
    /框架|方法论|中心模型|framework/.test(body)
      ? { label: "框架内容使用框架页", passed: layouts.has("framework") }
      : undefined,
    /信息图|数据摘要|指标摘要|kpi摘要|infographic/.test(body)
      ? { label: "摘要内容使用信息图页", passed: layouts.has("infographic") }
      : undefined,
    /地图|区域|地域|市场分布|网点|供应链|map|region/.test(body)
      ? { label: "区域内容使用地图页", passed: layouts.has("map") }
      : undefined,
    /场景|案例|故事|情境|scene|story|case/.test(body)
      ? { label: "场景内容使用场景页", passed: layouts.has("scene") }
      : undefined,
    /甘特|排期|任务周期|进度计划|gantt/.test(body)
      ? { label: "排期内容使用甘特页", passed: layouts.has("gantt") }
      : undefined,
    /甜甜圈|环形|占比环|比例环|donut/.test(body)
      ? { label: "占比内容使用甜甜圈页", passed: layouts.has("donut") }
      : undefined,
    /瀑布|增减归因|桥接|变动拆解|waterfall/.test(body)
      ? { label: "归因内容使用瀑布页", passed: layouts.has("waterfall") }
      : undefined,
    /热力图|强度矩阵|活跃度|相关性|heatmap/.test(body)
      ? { label: "强度内容使用热力图页", passed: layouts.has("heatmap") }
      : undefined,
    /雷达|能力评估|能力维度|多维评分|radar/.test(body)
      ? { label: "能力内容使用雷达页", passed: layouts.has("radar") }
      : undefined,
    /韦恩|交集|重叠集合|共同点|venn/.test(body)
      ? { label: "交集内容使用韦恩页", passed: layouts.has("venn") }
      : undefined,
    /鱼骨|根因|原因分析|ishikawa|fishbone/.test(body)
      ? { label: "根因内容使用鱼骨页", passed: layouts.has("fishbone") }
      : undefined,
    /旅程|客户体验|用户旅程|体验地图|痛点|journey/.test(body)
      ? { label: "体验内容使用旅程页", passed: layouts.has("journey") }
      : undefined,
    /kpi|指标卡|关键指标|数据卡|指标概览/.test(body)
      ? { label: "指标内容使用 KPI 卡页", passed: layouts.has("kpi") }
      : undefined,
    /仪表盘|仪表|gauge|达成率|完成率|目标进度/.test(body)
      ? { label: "达成率内容使用仪表盘页", passed: layouts.has("gauge") }
      : undefined,
    /纵向路线图|路线图|roadmap|里程碑|战略路径/.test(body)
      ? { label: "路线内容使用路线图页", passed: layouts.has("roadmap") }
      : undefined,
    /思维导图|mindmap|mind map|脑图|发散/.test(body)
      ? { label: "发散内容使用思维导图页", passed: layouts.has("mindmap") }
      : undefined,
    /支柱|pillars?|四大支柱|三大支柱|能力柱/.test(body)
      ? { label: "支柱内容使用支柱页", passed: layouts.has("pillars") }
      : undefined,
    /对比表|功能矩阵|清单表|表格|table/.test(body)
      ? { label: "表格内容使用表格页", passed: layouts.has("table") }
      : undefined,
    /排期表|schedule|任务表|项目表|owner|负责人/.test(body)
      ? { label: "任务内容使用排期表页", passed: layouts.has("schedule") }
      : undefined,
    /组织树|组织架构|org.?tree|top.?down.?tree|层级树|拆解树|okr拆解/.test(body)
      ? { label: "层级内容使用组织树页", passed: layouts.has("orgtree") }
      : undefined,
    /横向条形|排行条|排名条|长标签排名|horizontal.?bar/.test(body)
      ? { label: "排名内容使用横向条形页", passed: layouts.has("hbar") }
      : undefined,
    /折线|趋势线|时间序列|走势|line.?chart/.test(body)
      ? { label: "趋势内容使用折线页", passed: layouts.has("line") }
      : undefined,
    /帕累托|80\/20|二八|pareto/.test(body)
      ? { label: "贡献内容使用帕累托页", passed: layouts.has("pareto") }
      : undefined,
    /气泡|三轴|组合矩阵|bubble/.test(body)
      ? { label: "三轴内容使用气泡页", passed: layouts.has("bubble") }
      : undefined,
    /桑基|流向|来源去向|流量分配|sankey/.test(body)
      ? { label: "流向内容使用桑基页", passed: layouts.has("sankey") }
      : undefined,
    /树图|面积占比|层级占比|treemap/.test(body)
      ? { label: "面积内容使用树图页", passed: layouts.has("treemap") }
      : undefined,
    /财务报表|利润表|损益表|资产负债|现金流量|financial/.test(body)
      ? { label: "财务内容使用报表页", passed: layouts.has("financial") }
      : undefined,
    /团队名册|团队介绍|成员介绍|人员卡片|team roster/.test(body)
      ? { label: "团队内容使用名册页", passed: layouts.has("team") }
      : undefined,
  ].filter((check): check is OfficeQualityCheck => !!check)
}

function sceneCheck(kind: OfficeArtifactKind, body: string): OfficeQualityCheck {
  return { label: "结论或目标明确", passed: /结论|摘要|目标|背景|行动项|下一步/.test(body) }
}

function normalized(input: string) {
  return input.replace(/\s+/g, "")
}

function markdownTable(input: string) {
  return /^\|.+\|\s*$/m.test(input)
}
