export type OfficeArtifact = {
  body: string
  memory: string
  slides: OfficeSlide[]
  title: string
  filename: string
}

export type OfficeSlideAudio = {
  mime: string
  dataBase64: string
  name?: string
  startFloor?: number
  padding?: number
  subtitles?: Array<{ startMs: number; endMs: number; text: string }>
}

export type OfficeSlideMotion = {
  transition?: {
    effect?: "fade" | "wipe" | "push"
    duration?: number
  }
  animation?: {
    effect?: "fade" | "wipe" | "fly" | "zoom"
    duration?: number
    stagger?: number
  }
}

export type OfficeSlideShapeOverride = {
  id: number
  x?: number
  y?: number
  cx?: number
  cy?: number
}

export type OfficeSlideChartType =
  | "bar"
  | "line"
  | "area"
  | "radar"
  | "scatter"
  | "bubble"
  | "donut"
  | "waterfall"
  | "combo"

export type OfficeSlideChartOptions = {
  title?: string
  xAxisTitle?: string
  yAxisTitle?: string
  xlsxSheet?: string
  showDataLabels?: boolean
  showLegend?: boolean
  legendPosition?: "bottom" | "right" | "top" | "left"
  showPercent?: boolean
  showGridlines?: boolean
  sortData?: "none" | "asc" | "desc"
  colors?: string[]
}

export function visibleOfficeMessage(input: string) {
  return (
    input
      .replace(/\r\n?/g, "\n")
      .split(/^(?:#{1,6}\s*)?可沉淀记忆\/可进化建议\s*$/m)[0]
      ?.trimEnd() ?? ""
  )
}

export function rebuildOfficeArtifact(artifact: OfficeArtifact, slides: OfficeSlide[]): OfficeArtifact {
  const normalized = slides.map((slide, index) => ({
    ...slide,
    index: slide.index || index + 1,
  }))
  return {
    ...artifact,
    slides: normalized,
    body: `# 办公产物\n\n## ${artifact.title}\n\n${normalized.map(slideMarkdown).join("\n\n")}\n`,
  }
}

export type OfficeSlide = {
  index: number
  title: string
  content: string
  layout?:
    | "cards"
    | "comparison"
    | "timeline"
    | "highlight"
    | "split"
    | "chart"
    | "architecture"
    | "process"
    | "matrix"
    | "funnel"
    | "pyramid"
    | "cycle"
    | "framework"
    | "infographic"
    | "map"
    | "scene"
    | "gantt"
    | "donut"
    | "waterfall"
    | "heatmap"
    | "radar"
    | "venn"
    | "fishbone"
    | "journey"
    | "kpi"
    | "gauge"
    | "roadmap"
    | "mindmap"
    | "pillars"
    | "table"
    | "schedule"
    | "orgtree"
    | "hbar"
    | "line"
    | "pareto"
    | "bubble"
    | "sankey"
    | "treemap"
    | "financial"
    | "team"
  visual?: string
  notes?: string
  audio?: OfficeSlideAudio
  motion?: OfficeSlideMotion
  shapeOverrides?: OfficeSlideShapeOverride[]
  assets?: string[]
  chartType?: OfficeSlideChartType
  chartOptions?: OfficeSlideChartOptions
}

export function extractOfficeArtifact(input: string): OfficeArtifact | undefined {
  const lines = input.replace(/\r\n?/g, "\n").split("\n")
  const bodyHeading = findHeading(lines, "办公产物")
  if (bodyHeading === -1) return
  if (findHeading(lines.slice(0, bodyHeading + 1), "PPT 需求确认") !== -1) return

  const memoryHeading = findHeading(lines, "可沉淀记忆/可进化建议")
  const bodyContent = lines
    .slice(bodyHeading + 1, memoryHeading > bodyHeading ? memoryHeading : lines.length)
    .join("\n")
    .trim()
  if (!bodyContent) return
  if (isRequirementConfirmation(bodyContent)) return
  if (!hasOfficeDeliverable(bodyContent)) return

  const slides = extractSlides(bodyContent)
  const title = artifactTitle(bodyContent, slides)
  return {
    body: `# 办公产物\n\n${bodyContent}`,
    memory:
      memoryHeading > bodyHeading
        ? lines
            .slice(memoryHeading + 1)
            .join("\n")
            .trim()
        : "",
    slides,
    title,
    filename: `${filenameSafe(title)}.md`,
  }
}

function isRequirementConfirmation(body: string) {
  if (/^#{2,6}\s*(?:PPT\s*)?需求确认\s*$/m.test(body)) return true
  if (/^#{2,6}\s*(?:PPT\s*)?大纲\s*$/m.test(body)) return true
  return /需要用户确认[:：]/.test(body) && !/^#{2,4}\s*第\s*\d+\s*页/m.test(body)
}

function hasOfficeDeliverable(body: string) {
  if (/^#{2,4}\s*第\s*\d+\s*页/m.test(body)) return true
  if (/^#{2,6}\s*(?:PPT\s*)?需求确认\s*$/m.test(body)) return false
  if (/^#{2,6}\s+\S/m.test(body)) return true
  return body
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .some((line) => !/^[-*]?\s*(需要用户确认|可沉淀记忆|可进化建议|暂无|等待用户|本次|是否|课时|视觉风格)/.test(line))
}

function findHeading(lines: string[], label: string) {
  return lines.findIndex((line) => new RegExp(`^#{1,6}\\s*${escapeRegExp(label)}\\s*$`).test(line.trim()))
}

function artifactTitle(body: string, slides: OfficeSlide[] = []) {
  const deckHeading = body
    .split("\n")
    .map((line) => line.trim().match(/^#{2,6}\s+(.+?)\s*#*$/)?.[1])
    .find((value): value is string => !!value && !/^第\s*\d+\s*页/.test(value) && !/^(?:PPT\s*)?需求确认$/.test(value))
  if (deckHeading) return cleanTitle(deckHeading)

  if (slides.length > 0) {
    const coverTitle = slides[0]?.content
      .split("\n")
      .map(
        (line) =>
          line
            .trim()
            .replace(/^[-*]\s*/, "")
            .match(/^标题[:：]\s*(.+)$/)?.[1],
      )
      .find((value): value is string => !!value)
    if (coverTitle) return cleanTitle(coverTitle)
  }

  const heading = body
    .split("\n")
    .map((line) => line.trim().match(/^#{1,6}\s+(.+?)\s*#*$/)?.[1])
    .find(
      (value): value is string =>
        !!value && value !== "办公产物" && value !== "可沉淀记忆/可进化建议" && !/^第\s*\d+\s*页/.test(value),
    )
  if (heading) return cleanTitle(heading)

  const firstLine = body
    .split("\n")
    .map((line) => cleanTitle(line))
    .find((line) => line.length > 0)
  return firstLine ? firstLine.slice(0, 40) : "办公产物"
}

function cleanTitle(input: string) {
  return input
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_~#]+/g, "")
    .trim()
}

function filenameSafe(input: string) {
  const value = cleanTitle(input)
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
  return value || "办公产物"
}

function escapeRegExp(input: string) {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function extractSlides(body: string) {
  const result: OfficeSlide[] = []
  let current: { index: number; title: string; lines: string[] } | undefined

  for (const line of body.split("\n")) {
    const match = line.trim().match(/^#{2,4}\s*第\s*(\d+)\s*页\s*(?:[—\-:：|]\s*)?(.+?)?\s*#*$/)
    if (match?.[1]) {
      if (current) result.push(slideFrom(current))
      current = {
        index: Number(match[1]),
        title: cleanTitle(match[2] || `第 ${match[1]} 页`),
        lines: [],
      }
      continue
    }

    if (current) current.lines.push(line)
  }

  if (current) result.push(slideFrom(current))
  return result
}

function slideFrom(input: { index: number; title: string; lines: string[] }) {
  const parsed = parseSlideFields(input.lines)
  return {
    index: input.index,
    title: input.title || `第 ${input.index} 页`,
    content: parsed.content,
    layout: parsed.layout,
    visual: parsed.visual,
    notes: parsed.notes,
    audio: parsed.audio,
  }
}

function parseSlideFields(lines: string[]) {
  const fields = new Map<string, string[]>()
  const content: string[] = []
  let active: string | undefined
  for (const raw of lines) {
    const line = raw.trim()
    const match = line.match(
      /^[-*]?\s*(布局|版式|layout|视觉|visual|配图|配图建议|图片|图片建议|插图|插图建议|生成图片提示词|备注|演讲备注|notes|音频|旁白|audio|narration)\s*[:：]\s*(.*)$/i,
    )
    if (match?.[1]) {
      active = match[1].toLowerCase()
      fields.set(active, match[2] ? [match[2]] : [])
      continue
    }
    if (active && line && !/^[-*]?\s*(页面目标|主文案|核心观点|正文|content)\s*[:：]/i.test(line)) {
      fields.get(active)?.push(line.replace(/^[-*]\s*/, ""))
      continue
    }
    active = undefined
    content.push(raw)
  }
  return {
    content: content.join("\n").trim(),
    layout: normalizeSlideLayout(
      [...(fields.get("布局") ?? []), ...(fields.get("版式") ?? []), ...(fields.get("layout") ?? [])].join(" "),
    ),
    visual:
      [
        ...(fields.get("视觉") ?? []),
        ...(fields.get("visual") ?? []),
        ...(fields.get("配图") ?? []),
        ...(fields.get("配图建议") ?? []),
        ...(fields.get("图片") ?? []),
        ...(fields.get("图片建议") ?? []),
        ...(fields.get("插图") ?? []),
        ...(fields.get("插图建议") ?? []),
        ...(fields.get("生成图片提示词") ?? []),
      ]
        .join("\n")
        .trim() || undefined,
    notes:
      [...(fields.get("备注") ?? []), ...(fields.get("演讲备注") ?? []), ...(fields.get("notes") ?? [])]
        .join("\n")
        .trim() || undefined,
    audio: parseSlideAudio(
      [
        ...(fields.get("音频") ?? []),
        ...(fields.get("旁白") ?? []),
        ...(fields.get("audio") ?? []),
        ...(fields.get("narration") ?? []),
      ]
        .join("\n")
        .trim(),
    ),
  }
}

function parseSlideAudio(input: string): OfficeSlideAudio | undefined {
  const match = input.match(/^data:(audio\/(?:mpeg|mp3|wav|x-wav|mp4|m4a|aac));base64,([A-Za-z0-9+/=\s]+)$/i)
  if (!match?.[1] || !match[2]) return undefined
  return {
    mime: normalizeAudioMime(match[1]),
    dataBase64: match[2].replace(/\s+/g, ""),
    name: "旁白",
  }
}

function normalizeAudioMime(mime: string) {
  const value = mime.toLowerCase()
  if (value === "audio/mp3" || value === "audio/x-mp3") return "audio/mpeg"
  if (value === "audio/x-wav" || value === "audio/wav") return "audio/wav"
  return value
}

function normalizeSlideLayout(input: string): OfficeSlide["layout"] | undefined {
  const value = input.toLowerCase()
  if (/甘特|gantt|排期|项目计划|任务周期|进度计划/.test(value)) return "gantt"
  if (/甜甜圈|donut|环形|占比环|比例环/.test(value)) return "donut"
  if (/瀑布|waterfall|增减归因|桥接|变动拆解/.test(value)) return "waterfall"
  if (/热力图|heatmap|强度矩阵|活跃度|相关性/.test(value)) return "heatmap"
  if (/雷达|radar|能力评估|能力维度|多维评分/.test(value)) return "radar"
  if (/韦恩|venn|交集|重叠集合|共同点/.test(value)) return "venn"
  if (/鱼骨|fishbone|根因|原因分析|ishikawa|6m/.test(value)) return "fishbone"
  if (/旅程|journey|客户体验|用户旅程|体验地图|痛点/.test(value)) return "journey"
  if (/kpi|指标卡|关键指标|数据卡|指标概览/.test(value)) return "kpi"
  if (/仪表盘|仪表|gauge|达成率|完成率|目标进度/.test(value)) return "gauge"
  if (/纵向路线图|路线图|roadmap|里程碑|战略路径/.test(value)) return "roadmap"
  if (/思维导图|mindmap|mind map|脑图|发散/.test(value)) return "mindmap"
  if (/支柱|pillars?|四大支柱|三大支柱|能力柱/.test(value)) return "pillars"
  if (/表格|table|对比表|功能矩阵|清单表/.test(value)) return "table"
  if (/排期表|schedule|任务表|项目表|owner|负责人/.test(value)) return "schedule"
  if (/组织树|组织架构|org.?tree|top.?down.?tree|层级树|拆解树|okr拆解/.test(value)) return "orgtree"
  if (/横向条形|horizontal.?bar|排行条|排名条|长标签排名/.test(value)) return "hbar"
  if (/折线|line.?chart|趋势线|时间序列|走势/.test(value)) return "line"
  if (/帕累托|pareto|80\/20|二八/.test(value)) return "pareto"
  if (/气泡|bubble|三轴|组合矩阵/.test(value)) return "bubble"
  if (/桑基|sankey|流向|来源去向|流量分配/.test(value)) return "sankey"
  if (/树图|treemap|面积占比|层级占比/.test(value)) return "treemap"
  if (/财务报表|financial|利润表|损益表|资产负债|现金流量/.test(value)) return "financial"
  if (/团队名册|team roster|团队介绍|成员介绍|人员卡片/.test(value)) return "team"
  if (/卡片|cards?|要点/.test(value)) return "cards"
  if (/对比|comparison|compare|双栏/.test(value)) return "comparison"
  if (/图表|chart|bar|指标|数据/.test(value)) return "chart"
  if (/架构|architecture|系统|模块|链路/.test(value)) return "architecture"
  if (/流程图|process|flow/.test(value)) return "process"
  if (/矩阵|matrix|swot|bcg|四象限|象限/.test(value)) return "matrix"
  if (/漏斗|funnel|转化|销售漏斗/.test(value)) return "funnel"
  if (/金字塔|pyramid|层级|能力栈|价值栈/.test(value)) return "pyramid"
  if (/循环|cycle|闭环|飞轮|pdca/.test(value)) return "cycle"
  if (/框架|framework|方法论|模型|中心辐射/.test(value)) return "framework"
  if (/信息图|infographic|数据摘要|指标摘要|kpi\s*摘要/.test(value)) return "infographic"
  if (/地图|区域|地域|市场分布|网点|供应链|map|region/.test(value)) return "map"
  if (/场景|案例|故事|情境|scene|story|case/.test(value)) return "scene"
  if (/流程|时间线|timeline|步骤/.test(value)) return "timeline"
  if (/强调|结论|highlight|重点/.test(value)) return "highlight"
  if (/分栏|拆分|split/.test(value)) return "split"
}

function slideMarkdown(slide: OfficeSlide) {
  const lines = [`### 第 ${slide.index} 页：${slide.title}`]
  if (slide.layout) lines.push(`布局：${slide.layout}`)
  if (slide.visual?.trim()) lines.push(`视觉：${slide.visual.trim()}`)
  if (slide.content.trim()) lines.push(`主文案：\n${indentBullets(slide.content)}`)
  if (slide.notes?.trim()) lines.push(`演讲备注：\n${indentBullets(slide.notes)}`)
  return lines.join("\n")
}

function indentBullets(input: string) {
  return input
    .trim()
    .split("\n")
    .map((line) => {
      const value = line.trim()
      return value.startsWith("-") ? value : `- ${value}`
    })
    .join("\n")
}
