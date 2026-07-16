import { marked } from "marked"
import type { OfficeArtifact, OfficeSlide } from "./office-artifact"

type ZipEntry = {
  path: string
  data: Uint8Array
}

type PptSlideImage = {
  id: string
  relID: string
  filename: string
  extension: "png" | "jpg" | "gif" | "webp"
  contentType: string
  bytes: Uint8Array
  alt: string
}

export type OfficeExportFile = {
  filename: string
  mime: string
  bytes: Uint8Array
  label: string
}

export type OfficeArtifactKind = "document" | "ppt"
export type OfficePptTemplateID =
  | "tech"
  | "business"
  | "teaching"
  | "minimal"
  | "strategy"
  | "product"
  | "finance"
  | "academic"
  | "creative"
  | "government"
  | "data"
  | "warm"
  | "telecom"
  | "powerchina-classic"
  | "powerchina-modern"
  | "catarc-business"
  | "catarc-classic"
  | "catarc-modern"
  | "cmb"
  | "cqu"
  | "ai-ops"
  | "government-blue"
  | "government-red"
  | "medical"
  | "pixel"
  | "psychology"
export type OfficePptCustomTemplate = {
  id: "custom"
  name: string
  description: string
  visual: PptVisualTemplate
}
export type OfficePptTemplateChoice = OfficePptTemplateID | "auto" | OfficePptCustomTemplate

export const officePptTemplates: Array<{ id: OfficePptTemplateID; name: string; description: string }> = [
  {
    id: "tech",
    name: "\u79d1\u6280\u6df1\u8272",
    description:
      "\u6df1\u8272\u5c01\u9762\u3001\u8367\u5149\u5f3a\u8c03\uff0c\u9002\u5408\u6280\u672f\u8bfe\u4ef6\u548c\u65b9\u6848\u6c47\u62a5",
  },
  {
    id: "business",
    name: "\u5546\u52a1\u6d45\u8272",
    description: "\u514b\u5236\u84dd\u7070\u3001\u4fe1\u606f\u5361\u7247\uff0c\u9002\u5408\u6b63\u5f0f\u6c47\u62a5",
  },
  {
    id: "teaching",
    name: "\u6559\u5b66\u6e05\u723d",
    description: "\u7eff\u8272\u6e05\u723d\u3001\u91cd\u70b9\u680f\uff0c\u9002\u5408\u57f9\u8bad\u8bfe\u4ef6",
  },
  {
    id: "minimal",
    name: "\u6781\u7b80\u9ad8\u5bf9\u6bd4",
    description:
      "\u9ed1\u767d\u9ad8\u5bf9\u6bd4\u3001\u7559\u767d\u5145\u8db3\uff0c\u9002\u5408\u7ed3\u8bba\u578b\u6f14\u793a",
  },
  { id: "strategy", name: "战略蓝图", description: "深蓝、金色强调，适合战略规划和路线图" },
  { id: "product", name: "产品发布", description: "紫蓝渐变感，适合产品介绍和发布会" },
  { id: "finance", name: "财务数据", description: "墨绿和金色，适合经营分析、财务和数据汇报" },
  { id: "academic", name: "学术研究", description: "纸张感浅色，适合研究、知识科普和课程讲义" },
  { id: "creative", name: "创意提案", description: "高饱和撞色，适合创意方案和营销提案" },
  { id: "government", name: "稳重政企", description: "红蓝稳重配色，适合政企、制度和管理汇报" },
  { id: "data", name: "数据洞察", description: "深色数据看板风，适合指标、图表和洞察分析" },
  { id: "warm", name: "温暖叙事", description: "暖色柔和风格，适合故事线、总结和沟通表达" },
  { id: "telecom", name: "电信政企风格", description: "适合政企数字化、转型规划和通信行业方案汇报" },
  { id: "powerchina-classic", name: "工程蓝经典风格", description: "适合工程项目、技术方案、基建成果和年度总结" },
  { id: "powerchina-modern", name: "工程蓝现代风格", description: "适合重大工程、海外市场、技术成果和项目路演" },
  { id: "catarc-business", name: "认证商务风格", description: "适合产品认证、评测展示、客户来访和高端商务汇报" },
  { id: "catarc-classic", name: "认证蓝经典风格", description: "适合认证展示、技术推广、评审材料和商务沟通" },
  { id: "catarc-modern", name: "认证深蓝现代风格", description: "适合前沿技术、战略发布、专业评测和高端汇报" },
  { id: "cmb", name: "银行红商务风格", description: "适合金融业务、交易银行、客户案例和分行培训" },
  { id: "cqu", name: "高校答辩风格", description: "适合学术答辩、研究报告、教学展示和学术交流" },
  { id: "ai-ops", name: "AI 运维架构风格", description: "适合智能运维、基础设施、架构方案和数字化转型" },
  { id: "government-blue", name: "蓝色政务汇报风格", description: "适合重点项目、五年规划、政策解读和政务汇报" },
  { id: "government-red", name: "红色政务汇报风格", description: "适合党建政务、工作总结、项目推介和政策宣讲" },
  { id: "medical", name: "医学高校风格", description: "适合医学报告、病例讨论、科研课题和医院培训" },
  { id: "pixel", name: "像素复古极客风格", description: "适合技术分享、编程教程、游戏主题和创意展示" },
  { id: "psychology", name: "心理咨询专业风格", description: "适合心理培训、咨询案例、课程讲义和专业科普" },
]
const encoder = new TextEncoder()

export function createOfficeExportFile(
  artifact: OfficeArtifact,
  options?: { pptTemplate?: OfficePptTemplateChoice },
): OfficeExportFile {
  if (artifact.slides.length > 0) {
    return {
      filename: replaceExtension(artifact.filename, "pptx"),
      mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      bytes: zip(pptxEntries(artifact, resolvePptTemplate(artifact, options?.pptTemplate ?? "auto"))),
      label: "\u5bfc\u51fa PPTX",
    }
  }

  return {
    filename: replaceExtension(artifact.filename, "docx"),
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    bytes: zip(docxEntries(artifact)),
    label: "\u5bfc\u51fa DOCX",
  }
}

export function officeArtifactKind(artifact: OfficeArtifact, agent?: string): OfficeArtifactKind {
  if (artifact.slides.length > 0 || agent === "office-ppt") return "ppt"
  return "document"
}

export function bytesToBase64(bytes: Uint8Array) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
  const result: string[] = []
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index]!
    const b = bytes[index + 1]
    const c = bytes[index + 2]
    result.push(chars[a >> 2]!)
    result.push(chars[((a & 3) << 4) | ((b ?? 0) >> 4)]!)
    result.push(b === undefined ? "=" : chars[((b & 15) << 2) | ((c ?? 0) >> 6)]!)
    result.push(c === undefined ? "=" : chars[c & 63]!)
  }
  return result.join("")
}

export async function createOfficeHtmlExportFile(artifact: OfficeArtifact): Promise<OfficeExportFile> {
  const htmlBody = await marked.parse(artifact.body)
  const baseStyle = `
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans SC", sans-serif; font-size: 14px; line-height: 1.75; color: #1a1a2e; max-width: 820px; margin: 0 auto; padding: 48px 32px; background: #fff; }
h1 { font-size: 26px; font-weight: 700; margin: 32px 0 16px; padding-bottom: 8px; border-bottom: 2px solid #e5e7eb; color: #111; }
h2 { font-size: 22px; font-weight: 600; margin: 28px 0 14px; color: #1a1a2e; }
h3 { font-size: 18px; font-weight: 500; margin: 24px 0 12px; color: #1a1a2e; }
p { margin-bottom: 12px; }
ul, ol { margin: 8px 0 12px; padding-left: 28px; }
li { margin-bottom: 6px; }
table { width: 100%; border-collapse: collapse; margin: 20px 0; font-size: 13px; border-radius: 6px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
th { background: #f3f4f6; font-weight: 600; text-align: left; padding: 10px 14px; border-bottom: 2px solid #d1d5db; }
td { padding: 10px 14px; border-bottom: 1px solid #e5e7eb; }
tr:last-child td { border-bottom: none; }
tr:hover td { background: #f9fafb; }
pre { background: #f8f9fa; border: 1px solid #e5e7eb; border-radius: 6px; padding: 14px; overflow-x: auto; font-size: 13px; margin: 16px 0; }
code { font-family: "SF Mono", "Fira Code", "Consolas", monospace; font-size: 13px; }
:not(pre) > code { background: #f3f4f6; padding: 2px 6px; border-radius: 3px; color: #e11d48; }
a { color: #2563eb; text-decoration: none; }
a:hover { text-decoration: underline; }
blockquote { border-left: 3px solid #d1d5db; margin: 16px 0; padding-left: 14px; color: #6b7280; }
hr { border: none; height: 1px; background: #e5e7eb; margin: 28px 0; }
img { max-width: 100%; height: auto; border-radius: 4px; margin: 16px 0; }
`
  const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${xml(artifact.title)}</title><style>${baseStyle}</style></head><body>${htmlBody}</body></html>`
  return {
    filename: replaceExtension(artifact.filename, "html"),
    mime: "text/html",
    bytes: encoder.encode(html),
    label: "导出 HTML",
  }
}

function docxEntries(artifact: OfficeArtifact): ZipEntry[] {
  return [
    file(
      "[Content_Types].xml",
      [
        xmlHeader(),
        `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`,
        `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>`,
        `<Default Extension="xml" ContentType="application/xml"/>`,
        `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>`,
        `</Types>`,
      ].join(""),
    ),
    file(
      "_rels/.rels",
      [
        xmlHeader(),
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`,
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>`,
        `</Relationships>`,
      ].join(""),
    ),
    file(
      "word/document.xml",
      [
        xmlHeader(),
        `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">`,
        `<w:body>`,
        ...markdownBodyToWordXml(artifact.body),
        `<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>`,
        `</w:body></w:document>`,
      ].join(""),
    ),
  ]
}

function selectPptTemplate(artifact: OfficeArtifact, choice: OfficePptTemplateChoice): OfficePptTemplateID {
  if (typeof choice === "object") return "business"
  if (choice !== "auto") return choice
  const text = `${artifact.title}\n${artifact.body}\n${artifact.slides
    .map((slide) => `${slide.title}\n${slide.content}\n${slide.visual ?? ""}`)
    .join("\n")}`.toLowerCase()
  const scored = templateScorers
    .map((item) => ({
      id: item.id,
      score: item.patterns.reduce((total, pattern) => total + [...text.matchAll(pattern)].length, 0),
    }))
    .sort((a, b) => b.score - a.score)[0]
  if (scored && scored.score > 0) return scored.id
  return artifact.slides.length <= 6 ? "business" : "minimal"
}

function resolvePptTemplate(artifact: OfficeArtifact, choice: OfficePptTemplateChoice) {
  if (typeof choice === "object") return choice.visual
  const signal = choice === "auto" ? artifactPptTemplateSignal(artifact) : undefined
  if (signal) return createCustomPptTemplate(signal, artifact.title).visual
  return pptTemplate(selectPptTemplate(artifact, choice))
}

function artifactPptTemplateSignal(artifact: OfficeArtifact) {
  const text = `${artifact.title}\n${artifact.body}\n${artifact.slides.map((slide) => `${slide.title}\n${slide.content}\n${slide.visual ?? ""}`).join("\n")}`
  if (/PPTX模板设计信号|PPTX 模板设计信号|参考模板|主题色[:：]\s*#?[0-9A-Fa-f]{6}/.test(text)) return text
  if ([...text.matchAll(/#?[0-9A-Fa-f]{6}/g)].length >= 2) return text
}

const templateScorers: Array<{ id: OfficePptTemplateID; patterns: RegExp[] }> = [
  {
    id: "ai-ops",
    patterns: [/ai运维|智能运维|运维架构|it系统|基础设施|数字化转型|可观测|监控告警|ai ops|aiops|observability/g],
  },
  {
    id: "medical",
    patterns: [/医学|医疗|医院|病例|临床|护理|药学|医学教育|病例讨论|medical|hospital|clinical/g],
  },
  {
    id: "psychology",
    patterns: [/心理|咨询|心理咨询|心理治疗|依恋|个案分析|治疗培训|counseling|psychology|therapy/g],
  },
  {
    id: "pixel",
    patterns: [/像素|复古|极客|编程教程|游戏介绍|程序员|开发者分享|pixel|retro|geek|game/g],
  },
  {
    id: "government-blue",
    patterns: [/五年规划|重点项目|政策解读|招商推介|投资促进|蓝色政务|government blue|policy briefing/g],
  },
  {
    id: "government-red",
    patterns: [/政务汇报|政府汇报|工作总结|党建|红色政务|项目推介|government red|party building/g],
  },
  {
    id: "telecom",
    patterns: [/中国电信|电信|政企数字化|政企方案|转型规划|运营商|通信网络|telecom|carrier/g],
  },
  {
    id: "cmb",
    patterns: [/招商银行|招行|交易银行|销售收款|收款方案|分行培训|银行产品|cmb|cash management/g],
  },
  {
    id: "powerchina-modern",
    patterns: [/中国电建.*现代|重大工程|国际市场|海外市场|技术成果|高端商务谈判|powerchina.*modern/g],
  },
  {
    id: "powerchina-classic",
    patterns: [/中国电建|电建|工程项目|工程报告|技术方案|商务谈判|企业宣传|年度总结|powerchina|engineering project/g],
  },
  {
    id: "catarc-modern",
    patterns: [/中汽研.*现代|前沿技术|战略发布|高端汇报|智能汽车|汽车前瞻|catarc.*modern/g],
  },
  {
    id: "catarc-business",
    patterns: [/中汽研.*商务|产品认证|评测展示|评价展示|技术推广|高端商务|catarc.*business/g],
  },
  {
    id: "catarc-classic",
    patterns: [/中汽研|汽研|认证展示|评测|评价|商务来访|汽车认证|catarc/g],
  },
  {
    id: "cqu",
    patterns: [/重庆大学|重大|学术答辩|毕业答辩|研究报告|学术交流|高校|大学|cqu|thesis defense/g],
  },
  {
    id: "teaching",
    patterns: [
      /培训|课程|教学|学习|讲义|知识|课件|课堂|学生|学员|例题|练习|数学|语文|英语|training|course|lesson|classroom/g,
    ],
  },
  {
    id: "tech",
    patterns: [
      /技术|架构|部署|调优|集成|接口|系统|模块|链路|graph|rag|api|linux|代码|工程|architecture|backend|frontend/g,
    ],
  },
  {
    id: "data",
    patterns: [/图表|分析|洞察|看板|指标|数据|趋势|占比|增长|kpi|dashboard|metric|analytics|chart|insight/g],
  },
  {
    id: "finance",
    patterns: [/财务|经营|收入|成本|利润|预算|报表|现金流|毛利|finance|revenue|cost|profit|budget/g],
  },
  {
    id: "product",
    patterns: [/产品|发布|用户|体验|功能|需求|路线图|prd|product|launch|user|feature|roadmap/g],
  },
  {
    id: "strategy",
    patterns: [/战略|规划|蓝图|路线|目标|okr|愿景|strategy|vision|goal/g],
  },
  {
    id: "academic",
    patterns: [/研究|论文|实验|方法|综述|学术|课题|academic|research|paper|experiment/g],
  },
  {
    id: "government",
    patterns: [/政企|制度|管理|规范|合规|治理|政府|国企|党建|government|policy|governance|compliance/g],
  },
  {
    id: "creative",
    patterns: [/营销|创意|品牌|活动|传播|设计|增长方案|creative|brand|campaign|marketing/g],
  },
  {
    id: "warm",
    patterns: [/复盘|总结|故事|沟通|会议|回顾|述职|团队|summary|review|story|retrospective/g],
  },
]

export function createCustomPptTemplate(description: string, title?: string): OfficePptCustomTemplate {
  const rawText = `${title ?? ""}\n${description}`
  const text = rawText.toLowerCase()
  const base = pptTemplate(customTemplateBase(text))
  const palette = customTemplatePalette(text)
  const typography = customTemplateTypography(rawText)
  return {
    id: "custom",
    name: customTemplateName(description),
    description: description.trim() || "根据用户描述生成的自定义 PPT 模板",
    visual: { ...base, ...palette, ...typography },
  }
}

function markdownBodyToWordXml(markdown: string): string[] {
  const lines = markdown.split("\n")
  const result: string[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]!.trim()
    if (!line) {
      i++
      continue
    }

    if (line.startsWith("|") && line.endsWith("|")) {
      const tableLines: string[] = []
      while (i < lines.length && lines[i]!.trim().startsWith("|")) {
        tableLines.push(lines[i]!.trim())
        i++
      }
      result.push(tableToWordXml(tableLines))
      continue
    }

    if (line.startsWith("```")) {
      const codeLines: string[] = []
      i++
      while (i < lines.length && !lines[i]!.trim().startsWith("```")) {
        codeLines.push(lines[i]!)
        i++
      }
      i++
      result.push(
        `<w:p><w:pPr><w:pStyle w:val="Code"/><w:shd w:fill="F3F4F6"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:sz w:val="20"/></w:rPr><w:t xml:space="preserve">${xml(codeLines.join("\n"))}</w:t></w:r></w:p>`,
      )
      continue
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/)
    if (heading) {
      const level = Math.min(heading[1]!.length, 3)
      const size = [32, 28, 24][level - 1] ?? 24
      const space = [400, 300, 200][level - 1] ?? 200
      const border =
        level === 1 ? `<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="4" w:color="CCCCCC"/></w:pBdr>` : ""
      result.push(
        `<w:p><w:pPr><w:spacing w:before="${space}" w:after="120"/></w:pPr>${inlineToWordRuns(heading[2]!, `<w:rPr><w:b/><w:sz w:val="${size}"/></w:rPr>`)}</w:p>`,
      )
      i++
      continue
    }

    if (line.startsWith("- ") || line.startsWith("* ")) {
      const items: string[] = []
      while (i < lines.length) {
        const l = lines[i]!.trim()
        if (!l.startsWith("- ") && !l.startsWith("* ")) break
        items.push(l.replace(/^[-*]\s+/, ""))
        i++
      }
      for (const item of items) {
        result.push(`<w:p><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr>${inlineToWordRuns(item)}</w:p>`)
      }
      continue
    }

    const paraLines: string[] = []
    while (i < lines.length) {
      const l = lines[i]!.trim()
      if (
        !l ||
        l.startsWith("|") ||
        l.match(/^#{1,6}\s+/) ||
        l.startsWith("- ") ||
        l.startsWith("* ") ||
        l.startsWith("```")
      )
        break
      paraLines.push(l)
      i++
    }
    result.push(`<w:p>${inlineToWordRuns(paraLines.join(" "))}</w:p>`)
  }

  return result
}

function tableToWordXml(rows: string[]): string {
  const parsed = rows.map((row) => parseTableRow(row))
  const colCount = Math.max(...parsed.map((cols) => cols.length), 1)
  const colWidth = Math.floor(9000 / colCount)

  const grid = `<w:tblGrid>${Array.from({ length: colCount }, (_, i) => `<w:gridCol w:w="${colWidth}"/>`).join("")}</w:tblGrid>`

  const body = parsed
    .map((cols, rowIndex) => {
      const cells = cols.map((cell) => {
        const isHeader = rowIndex === 0
        const shading = isHeader ? `<w:shd w:fill="F3F4F6"/>` : ""
        let cellXml = `<w:tc><w:tcW w:w="${colWidth}"/><w:tcPr>${shading}</w:tcPr><w:p>${inlineToWordRuns(cell, isHeader ? '<w:rPr><w:b/><w:sz w:val="22"/></w:rPr>' : '<w:rPr><w:sz w:val="22"/></w:rPr>')}</w:p></w:tc>`
        return cellXml
      })
      return `<w:tr>${cells.join("")}</w:tr>`
    })
    .join("")

  return `<w:tbl>${grid}${body}</w:tbl>`
}

function parseTableRow(line: string): string[] {
  return line
    .split("|")
    .filter((_, i, arr) => i > 0 && i < arr.length - 1)
    .map((cell) => cell.trim())
    .filter((cell) => !/^[-:]+$/.test(cell))
}

function inlineToWordRuns(text: string, baseRunProps?: string): string {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/)
  return parts
    .filter(Boolean)
    .map((part) => {
      const boldMatch = part.match(/^\*\*(.+)\*\*$/)
      if (boldMatch) {
        const props = baseRunProps ? baseRunProps.replace(/<\/w:rPr>/, "<w:b/></w:rPr>") : "<w:rPr><w:b/></w:rPr>"
        return `<w:r>${props}<w:t xml:space="preserve">${xml(boldMatch[1]!)}</w:t></w:r>`
      }
      const italicMatch = part.match(/^\*(.+)\*$/)
      if (italicMatch) {
        const props = baseRunProps ? baseRunProps.replace(/<\/w:rPr>/, "<w:i/></w:rPr>") : "<w:rPr><w:i/></w:rPr>"
        return `<w:r>${props}<w:t xml:space="preserve">${xml(italicMatch[1]!)}</w:t></w:r>`
      }
      return `<w:r>${baseRunProps ?? ""}<w:t xml:space="preserve">${xml(part)}</w:t></w:r>`
    })
    .join("")
}

export function officePptTemplateName(value: OfficePptTemplateChoice) {
  if (typeof value === "object") return value.name
  if (value === "auto") return "自动匹配"
  return officePptTemplates.find((item) => item.id === value)?.name ?? "自动匹配"
}

export function officePptTemplateDescription(value: OfficePptTemplateChoice) {
  if (typeof value === "object") return value.description
  if (value === "auto") return "根据当前 PPT 主题自动匹配模板"
  return officePptTemplates.find((item) => item.id === value)?.description ?? "根据当前 PPT 主题自动匹配模板"
}

export function officePptTemplateVisual(value: OfficePptTemplateChoice) {
  if (typeof value === "object") return value.visual
  return pptTemplate(value === "auto" ? "tech" : value)
}

function customTemplateBase(text: string): OfficePptTemplateID {
  if (/教学|课堂|课程|学生|练习|training|course/.test(text)) return "teaching"
  if (/ai运维|智能运维|运维架构|可观测|监控告警|aiops/.test(text)) return "ai-ops"
  if (/医学|医疗|医院|病例|临床|medical|hospital/.test(text)) return "medical"
  if (/心理|咨询|治疗|依恋|psychology|therapy/.test(text)) return "psychology"
  if (/像素|复古|极客|游戏|pixel|retro|geek/.test(text)) return "pixel"
  if (/五年规划|政策解读|蓝色政务|government blue/.test(text)) return "government-blue"
  if (/政务汇报|党建|红色政务|government red/.test(text)) return "government-red"
  if (/技术|科技|赛博|架构|系统|api|rag|cyber|tech/.test(text)) return "tech"
  if (/数据|指标|看板|洞察|图表|dashboard|data/.test(text)) return "data"
  if (/产品|发布|增长|用户|product|launch/.test(text)) return "product"
  if (/财务|经营|预算|利润|finance/.test(text)) return "finance"
  if (/创意|品牌|营销|活动|creative|brand/.test(text)) return "creative"
  if (/政企|政府|制度|合规|government/.test(text)) return "government"
  if (/学术|研究|论文|academic|research/.test(text)) return "academic"
  if (/温暖|故事|叙事|复盘|warm|story/.test(text)) return "warm"
  if (/极简|黑白|minimal/.test(text)) return "minimal"
  return "business"
}

function customTemplatePalette(text: string): Partial<PptVisualTemplate> {
  const templateSignalPalette = customTemplateSignalPalette(text)
  if (templateSignalPalette) return templateSignalPalette
  if (/黑金|奢华|高端|gold/.test(text))
    return {
      coverBg: "09090B",
      coverBand: "18181B",
      coverTitle: "FFF7ED",
      coverText: "FDE68A",
      pageBg: "FFFBEB",
      side: "111827",
      cardLine: "D97706",
      title: "111827",
      text: "292524",
      muted: "78716C",
      accent: "D97706",
      accent2: "F59E0B",
      accentLight: "FEF3C7",
    }
  if (/赛博|霓虹|科技蓝|蓝紫|cyber|neon/.test(text))
    return {
      coverBg: "020617",
      coverBand: "111827",
      coverTitle: "E0F2FE",
      coverText: "BAE6FD",
      pageBg: "EEF6FF",
      side: "0F172A",
      cardLine: "7DD3FC",
      title: "0F172A",
      text: "1E293B",
      muted: "475569",
      accent: "38BDF8",
      accent2: "8B5CF6",
      accentLight: "CFFAFE",
    }
  if (/粉|浪漫|柔和|少女|pink/.test(text))
    return {
      coverBg: "831843",
      coverBand: "BE185D",
      coverTitle: "FFF1F2",
      coverText: "FCE7F3",
      pageBg: "FFF1F2",
      side: "9D174D",
      cardLine: "F9A8D4",
      title: "831843",
      text: "9F1239",
      muted: "BE185D",
      accent: "EC4899",
      accent2: "F97316",
      accentLight: "FCE7F3",
    }
  if (/绿色|自然|清新|环保|green/.test(text))
    return {
      coverBg: "064E3B",
      coverBand: "065F46",
      coverTitle: "ECFDF5",
      coverText: "BBF7D0",
      pageBg: "F0FDF4",
      side: "166534",
      cardLine: "86EFAC",
      title: "14532D",
      text: "365314",
      muted: "4D7C0F",
      accent: "22C55E",
      accent2: "14B8A6",
      accentLight: "DCFCE7",
    }
  if (/暖|橙|治愈|亲和|orange/.test(text))
    return {
      coverBg: "7C2D12",
      coverBand: "9A3412",
      coverTitle: "FFF7ED",
      coverText: "FED7AA",
      pageBg: "FFFBEB",
      side: "C2410C",
      cardLine: "FDBA74",
      title: "431407",
      text: "7C2D12",
      muted: "9A3412",
      accent: "F97316",
      accent2: "F59E0B",
      accentLight: "FFEDD5",
    }
  if (/红色|政务|庄重|red/.test(text))
    return {
      coverBg: "450A0A",
      coverBand: "7F1D1D",
      coverTitle: "FEF2F2",
      coverText: "FECACA",
      pageBg: "F8FAFC",
      side: "7F1D1D",
      cardLine: "FCA5A5",
      title: "111827",
      text: "334155",
      muted: "64748B",
      accent: "DC2626",
      accent2: "1D4ED8",
      accentLight: "FEE2E2",
    }
  return {}
}

function customTemplateSignalPalette(text: string): Partial<PptVisualTemplate> | undefined {
  const colors = [
    ...new Set(
      [...text.matchAll(/#?([0-9a-f]{6})/gi)]
        .map((match) => match[1]?.toUpperCase())
        .filter((color): color is string => !!color),
    ),
  ]
  if (colors.length === 0) return
  const dark = colors.find((color) => colorLuminance(color) < 0.35) ?? colors[0]!
  const primary = colors.find((color) => color !== dark) ?? colors[0]!
  const secondary = colors.find((color) => color !== dark && color !== primary) ?? primary
  const light = colors.find((color) => colorLuminance(color) > 0.78) ?? mixHex(primary, "FFFFFF", 0.82)
  return {
    coverBg: dark,
    coverBand: primary,
    coverTitle: colorLuminance(dark) > 0.45 ? "111827" : "FFFFFF",
    coverText: colorLuminance(dark) > 0.45 ? "334155" : light,
    pageBg: light,
    side: dark,
    cardLine: mixHex(primary, "FFFFFF", 0.55),
    title: colorLuminance(light) > 0.45 ? "111827" : "FFFFFF",
    text: colorLuminance(light) > 0.45 ? "334155" : "E5E7EB",
    muted: colorLuminance(light) > 0.45 ? "64748B" : "CBD5E1",
    accent: primary,
    accent2: secondary,
    accentLight: mixHex(primary, "FFFFFF", 0.76),
  }
}

function customTemplateTypography(text: string): Partial<PptVisualTemplate> {
  const font = text.match(/字体[:：]\s*([^\n，,、]+)/)?.[1]?.trim() ?? text.match(/typeface="([^"]+)"/)?.[1]?.trim()
  if (!font) return {}
  return { titleFont: font, bodyFont: font, latinFont: font }
}

function colorLuminance(color: string) {
  const [r, g, b] = [0, 2, 4].map((index) => Number.parseInt(color.slice(index, index + 2), 16) / 255)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function mixHex(from: string, to: string, ratio: number) {
  return [0, 2, 4]
    .map((index) =>
      Math.round(
        Number.parseInt(from.slice(index, index + 2), 16) * (1 - ratio) +
          Number.parseInt(to.slice(index, index + 2), 16) * ratio,
      )
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")
    .toUpperCase()
}

function customTemplateName(description: string) {
  const clean = description.replace(/\s+/g, " ").trim()
  if (!clean) return "自定义模板"
  return `${clean.slice(0, 16)}模板`
}

function pptxEntries(artifact: OfficeArtifact, template: PptVisualTemplate): ZipEntry[] {
  const slides =
    artifact.slides.length > 0 ? artifact.slides : [{ index: 1, title: artifact.title, content: artifact.body }]
  const images = pptSlideImages(slides)
  const noteSlides = slides.filter((slide) => slide.notes?.trim())
  const imageDefaults = Array.from(new Set(images.flatMap((slide) => slide.map((image) => imageDefaultXml(image)))))
  const masterRelID = `rId${slides.length + 1}`
  const presPropsRelID = `rId${slides.length + 2}`
  const viewPropsRelID = `rId${slides.length + 3}`
  const tableStylesRelID = `rId${slides.length + 4}`
  const notesMasterRelID = `rId${slides.length + 5}`

  return [
    file(
      "[Content_Types].xml",
      [
        xmlHeader(),
        `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`,
        `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>`,
        `<Default Extension="xml" ContentType="application/xml"/>`,
        ...imageDefaults,
        `<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>`,
        `<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>`,
        `<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>`,
        `<Override PartName="/ppt/presProps.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presProps+xml"/>`,
        `<Override PartName="/ppt/viewProps.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.viewProps+xml"/>`,
        `<Override PartName="/ppt/tableStyles.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.tableStyles+xml"/>`,
        `<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>`,
        `<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>`,
        `<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>`,
        ...(noteSlides.length > 0
          ? [
              `<Override PartName="/ppt/notesMasters/notesMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesMaster+xml"/>`,
            ]
          : []),
        ...slides.map(
          (slide) =>
            `<Override PartName="/ppt/slides/slide${slide.index}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`,
        ),
        ...noteSlides.map(
          (slide) =>
            `<Override PartName="/ppt/notesSlides/notesSlide${slide.index}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml"/>`,
        ),
        `</Types>`,
      ].join(""),
    ),
    file(
      "_rels/.rels",
      [
        xmlHeader(),
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`,
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>`,
        `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>`,
        `<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>`,
        `</Relationships>`,
      ].join(""),
    ),
    file("docProps/core.xml", coreProps(artifact.title)),
    file("docProps/app.xml", appProps(slides.length)),
    file("ppt/presentation.xml", presentationXml(slides.length, masterRelID)),
    file(
      "ppt/_rels/presentation.xml.rels",
      [
        xmlHeader(),
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`,
        ...slides.map(
          (slide, index) =>
            `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${slide.index}.xml"/>`,
        ),
        `<Relationship Id="${masterRelID}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>`,
        `<Relationship Id="${presPropsRelID}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/presProps" Target="presProps.xml"/>`,
        `<Relationship Id="${viewPropsRelID}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/viewProps" Target="viewProps.xml"/>`,
        `<Relationship Id="${tableStylesRelID}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/tableStyles" Target="tableStyles.xml"/>`,
        ...(noteSlides.length > 0
          ? [
              `<Relationship Id="${notesMasterRelID}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesMaster" Target="notesMasters/notesMaster1.xml"/>`,
            ]
          : []),
        `</Relationships>`,
      ].join(""),
    ),
    file(
      "ppt/presProps.xml",
      `${xmlHeader()}<p:presentationPr xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"/>`,
    ),
    file(
      "ppt/viewProps.xml",
      `${xmlHeader()}<p:viewPr xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"/>`,
    ),
    file(
      "ppt/tableStyles.xml",
      `${xmlHeader()}<a:tblStyleLst xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" def="{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}"/>`,
    ),
    file("ppt/theme/theme1.xml", themeXml(template)),
    file("ppt/slideMasters/_rels/slideMaster1.xml.rels", slideMasterRels()),
    file("ppt/slideMasters/slideMaster1.xml", slideMasterXml()),
    file("ppt/slideLayouts/_rels/slideLayout1.xml.rels", slideLayoutRels()),
    file("ppt/slideLayouts/slideLayout1.xml", slideLayoutXml()),
    ...(noteSlides.length > 0
      ? [
          file("ppt/notesMasters/_rels/notesMaster1.xml.rels", notesMasterRels()),
          file("ppt/notesMasters/notesMaster1.xml", notesMasterXml()),
        ]
      : []),
    ...slides.map((slide, index) =>
      file(
        `ppt/slides/slide${slide.index}.xml`,
        [
          xmlHeader(),
          `<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">`,
          `<p:cSld><p:spTree>`,
          `<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>`,
          ...designedSlide(slide, index, slides.length, artifact.title, template, images[index] ?? []),
          `</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>${slideTransitionXml(slide, index, slides.length, template)}</p:sld>`,
        ].join(""),
      ),
    ),
    ...slides.map((slide, index) =>
      file(
        `ppt/slides/_rels/slide${slide.index}.xml.rels`,
        [
          xmlHeader(),
          `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`,
          `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>`,
          ...(images[index] ?? []).map(
            (image) =>
              `<Relationship Id="${image.relID}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/${image.filename}"/>`,
          ),
          ...(slide.notes?.trim()
            ? [
                `<Relationship Id="rId${(images[index]?.length ?? 0) + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide${slide.index}.xml"/>`,
              ]
            : []),
          `</Relationships>`,
        ].join(""),
      ),
    ),
    ...noteSlides.map((slide) => file(`ppt/notesSlides/notesSlide${slide.index}.xml`, notesSlideXml(slide))),
    ...noteSlides.map((slide) =>
      file(`ppt/notesSlides/_rels/notesSlide${slide.index}.xml.rels`, notesSlideRels(slide.index)),
    ),
    ...images.flatMap((slide) => slide.map((image) => file(`ppt/media/${image.filename}`, image.bytes))),
  ]
}

function slideTransitionXml(slide: OfficeSlide, index: number, total: number, template: PptVisualTemplate) {
  const transition = slideTransition(slide, index, total, template)
  return `<p:transition spd="${transition.speed}">${transition.body}</p:transition>`
}

function slideTransition(
  slide: OfficeSlide,
  index: number,
  total: number,
  template: PptVisualTemplate,
): { speed: "fast" | "med" | "slow"; body: string } {
  if (index === 0 || index === total - 1) return { speed: "slow", body: "<p:fade/>" }
  if (["process", "timeline", "roadmap", "gantt", "schedule"].includes(slide.layout ?? ""))
    return { speed: "med", body: '<p:wipe dir="l"/>' }
  if (["architecture", "framework", "mindmap", "orgtree", "cycle"].includes(slide.layout ?? ""))
    return { speed: "med", body: '<p:push dir="l"/>' }
  if (["map", "scene", "journey"].includes(slide.layout ?? "")) return { speed: "med", body: '<p:cover dir="l"/>' }
  if (template.chromeStyle === "hud" || ["heatmap", "radar", "bubble", "sankey"].includes(slide.layout ?? ""))
    return { speed: "med", body: '<p:strips dir="ld"/>' }
  if (
    ["chart", "hbar", "line", "pareto", "donut", "waterfall", "financial", "treemap", "kpi", "gauge", "table"].includes(
      slide.layout ?? "",
    )
  ) {
    return { speed: "fast", body: "<p:fade/>" }
  }
  return { speed: "med", body: "<p:fade/>" }
}

function designedSlide(
  slide: OfficeSlide,
  index: number,
  total: number,
  deckTitle: string,
  template: PptVisualTemplate,
  images: PptSlideImage[],
) {
  if (index === 0) return coverSlide(slide, total, deckTitle, template)
  return contentSlide(slide, index, total, deckTitle, template, images)
}

function coverSlide(
  slide: Pick<OfficeSlide, "title" | "content">,
  total: number,
  deckTitle: string,
  template: PptVisualTemplate,
) {
  const cover = coverCopy(slide, deckTitle)
  if (template.chromeStyle === "topbar") return topbarCover(cover, total, template)
  if (template.chromeStyle === "editorial") return editorialCover(cover, total, template)
  if (template.chromeStyle === "canvas") return canvasCover(cover, total, template)
  if (template.chromeStyle === "minimal") return minimalCover(cover, total, template)
  if (template.chromeStyle === "ribbon") return ribbonCover(cover, total, template)
  if (template.chromeStyle === "hud") return hudCover(cover, total, template)
  if (template.chromeStyle === "thesis") return thesisCover(cover, total, template)
  return sidebarCover(cover, total, template)
}

function sidebarCover(cover: ReturnType<typeof coverCopy>, total: number, template: PptVisualTemplate) {
  return [
    rect(10, 0, 0, 9144000, 5143500, template.coverBg),
    rect(11, 0, 3850000, 9144000, 1293500, template.coverBand),
    roundedRect(12, 6330000, 380000, 2060000, 170000, template.accent, 30000),
    roundedRect(13, 7040000, 720000, 1260000, 110000, template.accent2, 26000),
    roundedRect(14, 7040000, 2500000, 860000, 180000, template.accentLight, 24000),
    roundedRect(15, 620000, 610000, 820000, 110000, template.accent, 16000),
    roundedRect(16, 620000, 760000, 1450000, 90000, template.accent2, 18000),
    roundedRect(17, 6400000, 3210000, 1720000, 430000, template.accentLight, 26000),
    textBox(18, 6660000, 3320000, 1220000, 190000, cover.badge, 1050, {
      color: template.coverTitle,
      bold: true,
      maxLines: 1,
    }),
    textBox(19, 620000, 910000, 7200000, 1150000, cover.title, 3900, {
      color: template.coverTitle,
      bold: true,
      maxLines: 2,
    }),
    textBox(20, 640000, 2190000, 6100000, 960000, cover.subtitle, 1850, {
      color: template.coverText,
      maxLines: 4,
    }),
    ...cover.content.slice(0, 3).flatMap((point, index) => [
      circle(
        21 + index * 3,
        6580000,
        1090000 + index * 430000,
        135000,
        index % 2 === 0 ? template.accent : template.accent2,
        90000,
      ),
      textBox(22 + index * 3, 6810000, 1040000 + index * 430000, 1500000, 220000, point, 900, {
        color: template.coverText,
        maxLines: 1,
      }),
    ]),
    textBox(31, 650000, 4300000, 2400000, 360000, `NovaWay - ${total} slides`, 1200, {
      color: template.accentLight,
      bold: true,
      maxLines: 1,
    }),
  ]
}

function topbarCover(cover: ReturnType<typeof coverCopy>, total: number, template: PptVisualTemplate) {
  return [
    rect(10, 0, 0, 9144000, 5143500, template.pageBg),
    rect(11, 0, 0, 9144000, 1180000, template.coverBg),
    rect(12, 0, 1180000, 9144000, 110000, template.accent),
    roundedRect(13, 6860000, 650000, 1720000, 150000, template.accent2, 24000),
    roundedRect(14, 700000, 1620000, 1460000, 140000, template.accent, 18000),
    roundedRect(15, 2310000, 1620000, 780000, 140000, template.accent2, 18000),
    textBox(16, 700000, 1880000, 6900000, 930000, cover.title, 3900, {
      color: template.title,
      bold: true,
      maxLines: 2,
    }),
    textBox(17, 720000, 3000000, 5600000, 620000, cover.subtitle, 1650, {
      color: template.text,
      maxLines: 3,
    }),
    roundedRect(18, 6810000, 3320000, 1500000, 440000, template.side, 16000),
    textBox(19, 7080000, 3430000, 980000, 180000, cover.badge, 950, {
      color: template.coverTitle,
      bold: true,
      maxLines: 1,
    }),
    textBox(20, 700000, 4300000, 2300000, 240000, `NovaWay - ${total} slides`, 1050, {
      color: template.muted,
      bold: true,
      maxLines: 1,
    }),
  ]
}

function editorialCover(cover: ReturnType<typeof coverCopy>, total: number, template: PptVisualTemplate) {
  return [
    rect(10, 0, 0, 9144000, 5143500, template.pageBg),
    rect(18, 0, 0, 9144000, 220000, template.coverBg),
    rect(11, 760000, 650000, 105000, 3350000, template.accent),
    rect(12, 760000, 650000, 2380000, 105000, template.accent2),
    roundedRect(13, 6500000, 3180000, 1700000, 420000, template.accentLight, 24000),
    textBox(14, 1120000, 840000, 6200000, 360000, cover.badge, 900, {
      color: template.muted,
      bold: true,
      maxLines: 1,
    }),
    textBox(15, 1120000, 1330000, 6100000, 1280000, cover.title, 4050, {
      color: template.title,
      bold: true,
      maxLines: 2,
    }),
    textBox(16, 1160000, 2920000, 5200000, 620000, cover.subtitle, 1500, {
      color: template.text,
      maxLines: 3,
    }),
    textBox(17, 1160000, 4220000, 2200000, 220000, `REPORT / ${total} slides`, 850, {
      color: template.muted,
      bold: true,
      maxLines: 1,
    }),
  ]
}

function canvasCover(cover: ReturnType<typeof coverCopy>, total: number, template: PptVisualTemplate) {
  return [
    rect(10, 0, 0, 9144000, 5143500, template.coverBg),
    roundedRect(11, 610000, 560000, 7920000, 3950000, template.card, 32000, template.cardLine),
    roundedRect(12, 450000, 520000, 940000, 120000, template.accent, 22000),
    roundedRect(13, 7560000, 3660000, 980000, 150000, template.accent2, 22000),
    roundedRect(14, 970000, 980000, 980000, 120000, template.accent, 18000),
    roundedRect(15, 2080000, 980000, 680000, 120000, template.accent2, 18000),
    textBox(16, 970000, 1360000, 6300000, 1120000, cover.title, 3850, {
      color: template.title,
      bold: true,
      maxLines: 2,
    }),
    textBox(17, 990000, 2760000, 5900000, 680000, cover.subtitle, 1650, {
      color: template.text,
      maxLines: 3,
    }),
    roundedRect(32, 6420000, 930000, 1260000, 340000, template.accentLight, 16000, template.cardLine),
    textBox(33, 6660000, 1010000, 760000, 150000, cover.badge, 820, {
      color: template.title,
      bold: true,
      maxLines: 1,
    }),
    ...cover.content.slice(0, 3).flatMap((point, index) => [
      circle(
        18 + index * 3,
        1180000 + index * 1750000,
        3820000,
        150000,
        index % 2 === 0 ? template.accent : template.accent2,
        90000,
      ),
      textBox(19 + index * 3, 1410000 + index * 1750000, 3770000, 1280000, 200000, point, 850, {
        color: template.muted,
        maxLines: 1,
      }),
    ]),
    textBox(31, 6800000, 4060000, 1250000, 220000, `${total} slides`, 850, {
      color: template.muted,
      bold: true,
      maxLines: 1,
    }),
  ]
}

function minimalCover(cover: ReturnType<typeof coverCopy>, total: number, template: PptVisualTemplate) {
  return [
    rect(10, 0, 0, 9144000, 5143500, template.pageBg),
    rect(11, 820000, 1100000, 6800000, 52000, template.side),
    rect(12, 820000, 3920000, 6900000, 26000, template.cardLine),
    textBox(13, 820000, 1420000, 6900000, 930000, cover.title, 3600, {
      color: template.title,
      bold: true,
      maxLines: 2,
    }),
    textBox(14, 840000, 2660000, 5800000, 520000, cover.subtitle, 1450, {
      color: template.text,
      maxLines: 3,
    }),
    textBox(15, 8240000, 1110000, 420000, 170000, `${String(total).padStart(2, "0")}`, 850, {
      color: template.muted,
      bold: true,
      maxLines: 1,
    }),
  ]
}

function ribbonCover(cover: ReturnType<typeof coverCopy>, total: number, template: PptVisualTemplate) {
  return [
    rect(10, 0, 0, 9144000, 5143500, template.pageBg),
    rect(11, 0, 4200000, 9144000, 943500, template.coverBand),
    roundedRect(12, 520000, 320000, 1280000, 360000, template.card, 18000, template.cardLine),
    textBox(13, 690000, 425000, 860000, 130000, "NovaWay", 720, { color: template.title, bold: true, maxLines: 1 }),
    roundedRect(14, 520000, 860000, 1180000, 120000, template.accent, 18000),
    roundedRect(15, 1760000, 860000, 3150000, 120000, template.cardLine, 18000),
    roundedRect(16, 6750000, 620000, 1720000, 2680000, template.accentLight, 30000, template.cardLine),
    roundedRect(17, 6940000, 1100000, 820000, 120000, template.accent, 22000),
    roundedRect(18, 7520000, 1900000, 940000, 150000, template.accent2, 22000),
    rect(19, 7000000, 2920000, 1260000, 70000, template.accent),
    textBox(20, 620000, 1260000, 5600000, 1120000, cover.title, 4050, {
      color: template.title,
      bold: true,
      maxLines: 2,
    }),
    textBox(21, 650000, 2740000, 5200000, 620000, cover.subtitle, 1550, {
      color: template.text,
      maxLines: 3,
    }),
    textBox(22, 650000, 4470000, 2600000, 260000, `${cover.badge} / ${total} slides`, 950, {
      color: template.coverTitle,
      bold: true,
      maxLines: 1,
    }),
    ...cover.content.slice(0, 3).flatMap((point, index) => [
      circle(
        30 + index * 3,
        3730000 + index * 1450000,
        4520000,
        130000,
        index % 2 === 0 ? template.accent : template.accent2,
        90000,
      ),
      textBox(31 + index * 3, 3940000 + index * 1450000, 4470000, 1080000, 190000, point, 760, {
        color: template.coverText,
        maxLines: 1,
      }),
    ]),
  ]
}

function hudCover(cover: ReturnType<typeof coverCopy>, total: number, template: PptVisualTemplate) {
  return [
    rect(10, 0, 0, 9144000, 5143500, template.coverBg),
    roundedRect(11, 6060000, 520000, 2360000, 140000, template.accent2, 18000),
    roundedRect(12, 6460000, 910000, 1620000, 90000, template.accent, 14000),
    rect(13, 6250000, 1160000, 1640000, 50000, template.accent),
    rect(14, 6900000, 1610000, 980000, 32000, template.accent2),
    roundedRect(15, 6120000, 2220000, 1820000, 980000, template.coverBand, 22000, template.accent),
    rect(16, 640000, 3560000, 2460000, 90000, template.accent),
    rect(17, 640000, 3720000, 1480000, 45000, template.accent2),
    textBox(18, 650000, 1320000, 6100000, 1160000, cover.title, 4300, {
      color: template.coverTitle,
      bold: true,
      maxLines: 2,
    }),
    textBox(19, 680000, 2760000, 5100000, 520000, cover.subtitle, 1500, {
      color: template.coverText,
      maxLines: 2,
    }),
    textBox(20, 6760000, 2510000, 820000, 180000, "HUD", 1050, {
      color: template.accentLight,
      bold: true,
      maxLines: 1,
    }),
    textBox(21, 650000, 4320000, 2500000, 220000, `${cover.badge} / ${total} slides`, 850, {
      color: template.accentLight,
      bold: true,
      maxLines: 1,
    }),
  ]
}

function thesisCover(cover: ReturnType<typeof coverCopy>, total: number, template: PptVisualTemplate) {
  return [
    rect(10, 0, 0, 9144000, 5143500, template.pageBg),
    rect(11, 0, 0, 9144000, 620000, template.side),
    rect(12, 650000, 0, 90000, 620000, template.accent),
    roundedRect(13, 7420000, 145000, 1100000, 260000, template.card, 16000, template.cardLine),
    textBox(14, 7660000, 205000, 620000, 110000, "LOGO", 650, { color: template.muted, bold: true, maxLines: 1 }),
    textBox(15, 1120000, 1380000, 6900000, 1080000, cover.title, 3800, {
      color: template.title,
      bold: true,
      maxLines: 2,
    }),
    textBox(16, 1440000, 2740000, 6200000, 520000, cover.subtitle, 1420, {
      color: template.text,
      maxLines: 2,
    }),
    rect(17, 2860000, 3460000, 2250000, 52000, template.accent2),
    rect(18, 5230000, 3415000, 130000, 130000, template.accent),
    rect(19, 5450000, 3415000, 130000, 130000, template.accent2),
    textBox(20, 3420000, 4200000, 2300000, 220000, `${cover.badge} / ${total} slides`, 850, {
      color: template.muted,
      bold: true,
      maxLines: 1,
    }),
  ]
}

function coverCopy(slide: Pick<OfficeSlide, "title" | "content">, deckTitle: string) {
  const lines = contentPoints(slide.content)
  const title = lines.find((line) => line.match(/^标题[:：]/))?.replace(/^标题[:：]\s*/, "") || slide.title || deckTitle
  const subtitle =
    lines.find((line) => line.match(/^副标题[:：]/))?.replace(/^副标题[:：]\s*/, "") ||
    lines.find((line) => !line.match(/^(标题|副标题)[:：]/)) ||
    deckTitle ||
    slide.title
  return {
    title,
    subtitle,
    badge: coverBadge(`${deckTitle}\n${title}\n${subtitle}\n${slide.content}`),
    content: lines.filter((line) => !line.match(/^(标题|副标题)[:：]/)),
  }
}

function coverBadge(input: string) {
  if (/教学|数学|课堂|课程|练习|学生|学员/.test(input)) return "课堂课件"
  if (/技术|架构|系统|部署|接口|工程|RAG|GraphRAG|API/i.test(input)) return "技术方案"
  if (/数据|指标|图表|看板|分析|洞察|增长/.test(input)) return "数据洞察"
  if (/财务|经营|收入|成本|利润|预算|复盘/.test(input)) return "经营汇报"
  if (/产品|发布|用户|体验|功能|路线图/.test(input)) return "产品发布"
  if (/营销|品牌|活动|传播|创意/.test(input)) return "创意提案"
  if (/战略|规划|蓝图|目标|OKR/i.test(input)) return "战略蓝图"
  return "AI 演示文稿"
}

function contentSlide(
  slide: OfficeSlide,
  index: number,
  total: number,
  deckTitle: string,
  template: PptVisualTemplate,
  images: PptSlideImage[],
) {
  return [
    ...contentChrome(slide.title || deckTitle, index, template),
    ...templateMotifDecor(template).map(offsetMotifShapeID),
    ...contentLayout(slide, index, template),
    ...(images[0] ? [picture(70, 6150000, 2920000, 1820000, 980000, images[0])] : slideIllustration(slide, template)),
    ...visualAccent(slide, template),
    ...contentFooter(deckTitle, index, total, template),
  ]
}

function offsetMotifShapeID(shape: string) {
  return shape
    .replace(/id="(\d+)"/, (_, id: string) => `id="${Number(id) + 60}"`)
    .replace(/name="(Shape|Text) (\d+)"/, (_, kind: string, id: string) => `name="${kind} ${Number(id) + 60}"`)
}

function contentChrome(title: string, index: number, template: PptVisualTemplate) {
  if (template.chromeStyle === "topbar") return topbarChrome(title, index, template)
  if (template.chromeStyle === "editorial") return editorialChrome(title, index, template)
  if (template.chromeStyle === "canvas") return canvasChrome(title, index, template)
  if (template.chromeStyle === "minimal") return minimalChrome(title, index, template)
  if (template.chromeStyle === "ribbon") return ribbonChrome(title, index, template)
  if (template.chromeStyle === "hud") return hudChrome(title, index, template)
  if (template.chromeStyle === "thesis") return thesisChrome(title, index, template)
  return sidebarChrome(title, index, template)
}

function sidebarChrome(title: string, index: number, template: PptVisualTemplate) {
  return [
    rect(10, 0, 0, 9144000, 5143500, template.pageBg),
    rect(11, 0, 0, 420000, 5143500, template.side),
    rect(12, 420000, 0, 8724000, 250000, template.accent),
    roundedRect(13, 7350000, 280000, 1120000, 90000, template.accent2, 22000),
    roundedRect(14, 7880000, 500000, 620000, 70000, template.accent, 20000),
    roundedRect(19, 6880000, 3760000, 1320000, 420000, template.accentLight, 22000),
    roundedRect(20, 7340000, 3920000, 780000, 90000, template.accent, 18000),
    roundedRect(21, 7280000, 4110000, 1160000, 70000, template.accent2, 16000),
    rect(15, 690000, 650000, 90000, 760000, template.accent),
    textBox(16, 900000, 560000, 6700000, 760000, title, 3000, {
      color: template.title,
      bold: true,
      maxLines: 2,
    }),
    roundedRect(17, 7820000, 610000, 680000, 360000, template.side, 12000),
    textBox(18, 7920000, 675000, 480000, 190000, `${String(index + 1).padStart(2, "0")}`, 1200, {
      color: template.coverTitle,
      bold: true,
      maxLines: 1,
    }),
  ]
}

function topbarChrome(title: string, index: number, template: PptVisualTemplate) {
  return [
    rect(10, 0, 0, 9144000, 5143500, template.pageBg),
    rect(11, 0, 0, 9144000, 430000, template.side),
    rect(12, 0, 430000, 9144000, 70000, template.accent),
    roundedRect(13, 690000, 645000, 980000, 110000, template.accent, 16000),
    roundedRect(14, 1780000, 645000, 540000, 110000, template.accent2, 16000),
    roundedRect(15, 7640000, 770000, 820000, 120000, template.accentLight, 22000),
    roundedRect(16, 7420000, 660000, 830000, 330000, template.card, 16000, template.cardLine),
    textBox(17, 7610000, 725000, 450000, 170000, `${String(index + 1).padStart(2, "0")}`, 1100, {
      color: template.title,
      bold: true,
      maxLines: 1,
    }),
    textBox(18, 690000, 810000, 6500000, 610000, title, 2850, {
      color: template.title,
      bold: true,
      maxLines: 2,
    }),
  ]
}

function editorialChrome(title: string, index: number, template: PptVisualTemplate) {
  return [
    rect(10, 0, 0, 9144000, 5143500, template.pageBg),
    rect(11, 690000, 590000, 85000, 900000, template.accent),
    roundedRect(12, 6900000, 420000, 1520000, 430000, template.card, 18000, template.cardLine),
    textBox(13, 7200000, 515000, 520000, 180000, `PAGE ${String(index + 1).padStart(2, "0")}`, 780, {
      color: template.muted,
      bold: true,
      maxLines: 1,
    }),
    roundedRect(14, 6720000, 3460000, 1620000, 420000, template.accentLight, 22000),
    roundedRect(15, 7480000, 3950000, 700000, 90000, template.accent, 18000),
    textBox(16, 920000, 560000, 6280000, 760000, title, 3000, {
      color: template.title,
      bold: true,
      maxLines: 2,
    }),
    rect(17, 920000, 1360000, 2100000, 45000, template.accent2),
  ]
}

function canvasChrome(title: string, index: number, template: PptVisualTemplate) {
  return [
    rect(10, 0, 0, 9144000, 5143500, template.pageBg),
    roundedRect(11, 530000, 430000, 8060000, 4200000, template.card, 28000, template.cardLine),
    roundedRect(12, 330000, 420000, 900000, 110000, template.accent, 22000),
    roundedRect(13, 7650000, 3700000, 860000, 160000, template.accent2, 20000),
    roundedRect(14, 870000, 720000, 1120000, 100000, template.accent, 18000),
    roundedRect(15, 2090000, 720000, 640000, 100000, template.accent2, 18000),
    textBox(16, 870000, 900000, 6200000, 620000, title, 2850, {
      color: template.title,
      bold: true,
      maxLines: 2,
    }),
    roundedRect(17, 7550000, 820000, 620000, 300000, template.accentLight, 14000, template.cardLine),
    textBox(18, 7700000, 875000, 320000, 150000, `${String(index + 1).padStart(2, "0")}`, 950, {
      color: template.title,
      bold: true,
      maxLines: 1,
    }),
  ]
}

function minimalChrome(title: string, index: number, template: PptVisualTemplate) {
  return [
    rect(10, 0, 0, 9144000, 5143500, template.pageBg),
    rect(11, 720000, 900000, 6280000, 50000, template.side),
    rect(12, 720000, 4260000, 7720000, 24000, template.cardLine),
    textBox(13, 720000, 500000, 6500000, 330000, title, 2500, {
      color: template.title,
      bold: true,
      maxLines: 1,
    }),
    textBox(14, 7940000, 520000, 460000, 170000, `${String(index + 1).padStart(2, "0")}`, 950, {
      color: template.muted,
      bold: true,
      maxLines: 1,
    }),
  ]
}

function ribbonChrome(title: string, index: number, template: PptVisualTemplate) {
  return [
    rect(10, 0, 0, 9144000, 5143500, template.pageBg),
    roundedRect(11, 650000, 330000, 1320000, 300000, template.accent, 18000),
    rect(12, 1800000, 415000, 5200000, 95000, template.cardLine),
    roundedRect(13, 7240000, 310000, 980000, 340000, template.card, 16000, template.cardLine),
    textBox(14, 7440000, 380000, 560000, 140000, "LOGO", 650, { color: template.muted, bold: true, maxLines: 1 }),
    textBox(15, 830000, 395000, 680000, 120000, `P${String(index + 1).padStart(2, "0")}`, 680, {
      color: template.coverTitle,
      bold: true,
      maxLines: 1,
    }),
    textBox(16, 720000, 760000, 6600000, 560000, title, 2700, {
      color: template.title,
      bold: true,
      maxLines: 2,
    }),
    rect(17, 0, 4830000, 9144000, 90000, template.coverBand),
    roundedRect(18, 7680000, 3940000, 880000, 320000, template.accentLight, 24000),
  ]
}

function hudChrome(title: string, index: number, template: PptVisualTemplate) {
  return [
    rect(10, 0, 0, 9144000, 5143500, template.pageBg),
    roundedRect(11, 640000, 420000, 6900000, 590000, template.card, 22000, template.cardLine),
    rect(12, 640000, 420000, 105000, 590000, template.accent),
    rect(13, 6460000, 420000, 1780000, 52000, template.accent2),
    roundedRect(14, 7120000, 3650000, 1160000, 360000, template.accentLight, 22000),
    textBox(15, 910000, 560000, 5700000, 260000, title, 2200, {
      color: template.title,
      bold: true,
      maxLines: 1,
    }),
    roundedRect(16, 7440000, 545000, 680000, 250000, template.side, 14000),
    textBox(17, 7580000, 600000, 340000, 110000, `${String(index + 1).padStart(2, "0")}`, 760, {
      color: template.coverTitle,
      bold: true,
      maxLines: 1,
    }),
    rect(18, 7020000, 4100000, 920000, 42000, template.accent),
    rect(19, 7600000, 4240000, 580000, 26000, template.accent2),
  ]
}

function thesisChrome(title: string, index: number, template: PptVisualTemplate) {
  return [
    rect(10, 0, 0, 9144000, 5143500, template.pageBg),
    rect(11, 0, 0, 9144000, 560000, template.side),
    rect(12, 650000, 0, 85000, 560000, template.accent),
    rect(13, 0, 560000, 9144000, 360000, template.accentLight),
    rect(14, 650000, 560000, 85000, 360000, template.accent2),
    textBox(15, 900000, 150000, 6100000, 220000, title, 1900, {
      color: template.coverTitle,
      bold: true,
      maxLines: 1,
    }),
    roundedRect(16, 7440000, 145000, 900000, 230000, template.card, 14000, template.cardLine),
    textBox(17, 7660000, 190000, 460000, 100000, "LOGO", 600, { color: template.muted, bold: true, maxLines: 1 }),
    textBox(18, 900000, 665000, 5500000, 130000, "KEY MESSAGE", 650, {
      color: template.muted,
      bold: true,
      maxLines: 1,
    }),
    textBox(19, 8050000, 665000, 450000, 130000, `${String(index + 1).padStart(2, "0")}`, 700, {
      color: template.muted,
      bold: true,
      maxLines: 1,
    }),
  ]
}

function contentFooter(deckTitle: string, index: number, total: number, template: PptVisualTemplate) {
  return [
    textBox(90, 680000, 4600000, 2900000, 240000, deckTitle, 950, { color: template.muted, maxLines: 1 }),
    textBox(91, 8050000, 4600000, 620000, 240000, `${index + 1}/${total}`, 950, {
      color: template.muted,
      maxLines: 1,
    }),
  ]
}

function contentLayout(slide: OfficeSlide, index: number, template: PptVisualTemplate) {
  const points = contentPoints(slide.content)
  const source = `${slide.title}\n${slide.content}`
  const teaching = /教学|数学|课堂|练习|学生|课程|例题|知识点/.test(source)
  if (slide.layout === "cards") return teaching ? classroomLayout(points, template) : cardGridLayout(points, template)
  if (slide.layout === "comparison") return comparisonLayout(points, template)
  if (slide.layout === "timeline") return timelineLayout(points, template)
  if (slide.layout === "highlight") return highlightLayout(points, template)
  if (slide.layout === "split") return splitLayout(points, template)
  if (slide.layout === "chart") return chartLayout(points, template)
  if (slide.layout === "architecture") return architectureLayout(points, template)
  if (slide.layout === "process") return processLayout(points, template)
  if (slide.layout === "matrix") return matrixLayout(points, template)
  if (slide.layout === "funnel") return funnelLayout(points, template)
  if (slide.layout === "pyramid") return pyramidLayout(points, template)
  if (slide.layout === "cycle") return cycleLayout(points, template)
  if (slide.layout === "framework") return frameworkLayout(points, template)
  if (slide.layout === "infographic") return infographicLayout(points, template)
  if (slide.layout === "map") return mapLayout(points, template)
  if (slide.layout === "scene") return sceneLayout(points, template)
  if (slide.layout === "gantt") return ganttLayout(points, template)
  if (slide.layout === "donut") return donutLayout(points, template)
  if (slide.layout === "waterfall") return waterfallLayout(points, template)
  if (slide.layout === "heatmap") return heatmapLayout(points, template)
  if (slide.layout === "radar") return radarLayout(points, template)
  if (slide.layout === "venn") return vennLayout(points, template)
  if (slide.layout === "fishbone") return fishboneLayout(points, template)
  if (slide.layout === "journey") return journeyLayout(points, template)
  if (slide.layout === "kpi") return kpiLayout(points, template)
  if (slide.layout === "gauge") return gaugeLayout(points, template)
  if (slide.layout === "roadmap") return roadmapLayout(points, template)
  if (slide.layout === "mindmap") return mindmapLayout(points, template)
  if (slide.layout === "pillars") return pillarsLayout(points, template)
  if (slide.layout === "table") return tableLayout(points, template)
  if (slide.layout === "schedule") return scheduleLayout(points, template)
  if (slide.layout === "orgtree") return orgTreeLayout(points, template)
  if (slide.layout === "hbar") return horizontalBarLayout(points, template)
  if (slide.layout === "line") return lineTrendLayout(points, template)
  if (slide.layout === "pareto") return paretoLayout(points, template)
  if (slide.layout === "bubble") return bubbleLayout(points, template)
  if (slide.layout === "sankey") return sankeyLayout(points, template)
  if (slide.layout === "treemap") return treemapLayout(points, template)
  if (slide.layout === "financial") return financialLayout(points, template)
  if (slide.layout === "team") return teamRosterLayout(points, template)
  if (/章节页|章节封面|篇章|chapter/i.test(source)) return chapterLayout(points, template)
  if (/目录|大纲|章节|议程|agenda|outline/.test(source)) return agendaLayout(points, template)
  if (/总结|结论|收获|下一步|行动|建议|summary|conclusion|next step/.test(source))
    return summaryLayout(points, template)
  if (/横向条形|排行条|排名条|长标签排名|horizontal.?bar/i.test(source)) return horizontalBarLayout(points, template)
  if (/折线|趋势线|时间序列|走势|line.?chart/i.test(source)) return lineTrendLayout(points, template)
  if (/帕累托|80\/20|二八|pareto/i.test(source)) return paretoLayout(points, template)
  if (/气泡|三轴|组合矩阵|bubble/i.test(source)) return bubbleLayout(points, template)
  if (/桑基|流向|来源去向|流量分配|sankey/i.test(source)) return sankeyLayout(points, template)
  if (/树图|面积占比|层级占比|treemap/i.test(source)) return treemapLayout(points, template)
  if (/财务报表|利润表|损益表|资产负债|现金流量|financial/i.test(source)) return financialLayout(points, template)
  if (/团队名册|团队介绍|成员介绍|人员卡片|team roster/i.test(source)) return teamRosterLayout(points, template)
  if (/kpi|指标卡|关键指标|数据卡|指标概览/i.test(source)) return kpiLayout(points, template)
  if (/仪表盘|仪表|gauge|达成率|完成率|目标进度/i.test(source)) return gaugeLayout(points, template)
  if (/纵向路线图|路线图|roadmap|里程碑|战略路径/i.test(source)) return roadmapLayout(points, template)
  if (/思维导图|mindmap|mind map|脑图|发散/i.test(source)) return mindmapLayout(points, template)
  if (/支柱|pillars?|四大支柱|三大支柱|能力柱/i.test(source)) return pillarsLayout(points, template)
  if (/对比表|功能矩阵|清单表|表格|table/i.test(source)) return tableLayout(points, template)
  if (/排期表|schedule|任务表|项目表|owner|负责人/i.test(source)) return scheduleLayout(points, template)
  if (/组织树|组织架构|org.?tree|top.?down.?tree|层级树|拆解树|okr拆解/i.test(source))
    return orgTreeLayout(points, template)
  if (/甘特|排期|任务周期|进度计划|gantt/i.test(source)) return ganttLayout(points, template)
  if (/甜甜圈|环形|占比环|比例环|donut/i.test(source)) return donutLayout(points, template)
  if (/瀑布|增减归因|桥接|变动拆解|waterfall/i.test(source)) return waterfallLayout(points, template)
  if (/热力图|强度矩阵|活跃度|相关性|heatmap/i.test(source)) return heatmapLayout(points, template)
  if (/雷达|能力评估|能力维度|多维评分|radar/i.test(source)) return radarLayout(points, template)
  if (/韦恩|交集|重叠集合|共同点|venn/i.test(source)) return vennLayout(points, template)
  if (/鱼骨|根因|原因分析|ishikawa|fishbone/i.test(source)) return fishboneLayout(points, template)
  if (/旅程|客户体验|用户旅程|体验地图|痛点|journey/i.test(source)) return journeyLayout(points, template)
  if (/信息图|数据摘要|指标摘要|KPI摘要|kpi rundown|infographic/i.test(source))
    return infographicLayout(points, template)
  if (/区域|地域|地图|网点|市场分布|供应链|map|region/i.test(source)) return mapLayout(points, template)
  if (/场景|案例|故事|客户旅程|情境|scene|story|case/i.test(source)) return sceneLayout(points, template)
  if (/图表|数据|指标|占比|增长|收入|成本|利润|kpi|chart|metric/.test(source)) return chartLayout(points, template)
  if (/架构|模块|系统|链路|分层|组件|graph|rag|architecture/.test(source)) return architectureLayout(points, template)
  if (/矩阵|四象限|象限|SWOT|BCG|matrix/i.test(source)) return matrixLayout(points, template)
  if (/漏斗|转化|获客|销售漏斗|funnel/i.test(source)) return funnelLayout(points, template)
  if (/金字塔|层级|能力栈|价值栈|pyramid/i.test(source)) return pyramidLayout(points, template)
  if (/循环|闭环|飞轮|PDCA|cycle/i.test(source)) return cycleLayout(points, template)
  if (/框架|方法论|模型|中心辐射|framework/i.test(source)) return frameworkLayout(points, template)
  if (/流程图|流转|process|flow/.test(source)) return processLayout(points, template)
  if (/流程|步骤|计划|阶段|路线|节奏|里程碑|推进|部署|调优|集成/.test(source)) return timelineLayout(points, template)
  if (/对比|差异|优劣|方案|成本|收益|风险|取舍|A\/B|AB/.test(source)) return comparisonLayout(points, template)
  if (teaching) return classroomLayout(points, template)
  return templateDefaultLayout(points, index, template)
}

function templateDefaultLayout(points: string[], index: number, template: PptVisualTemplate) {
  if (
    template.motif === "circuit" ||
    template.motif === "network" ||
    template.motif === "ops-map" ||
    template.motif === "autotech"
  )
    return architectureLayout(points, template)
  if (template.motif === "roadmap" || template.motif === "blueprint" || template.motif === "infrastructure")
    return index % 2 === 0 ? roadmapLayout(points, template) : timelineLayout(points, template)
  if (template.motif === "dashboard") return kpiLayout(points, template)
  if (template.motif === "ledger" || template.motif === "bank-ledger") return financialLayout(points, template)
  if (template.motif === "paper" || template.motif === "university" || template.motif === "clinical")
    return splitLayout(points, template)
  if (
    template.motif === "seal" ||
    template.motif === "policy-blue" ||
    template.motif === "policy-red" ||
    template.motif === "certification"
  )
    return tableLayout(points, template)
  if (
    template.motif === "collage" ||
    template.motif === "spotlight" ||
    template.motif === "story" ||
    template.motif === "therapy"
  )
    return sceneLayout(points, template)
  if (template.motif === "classroom") return classroomLayout(points, template)
  if (template.motif === "minimal-line") return splitLayout(points, template)
  if (template.motif === "pixel") return matrixLayout(points, template)
  if (template.motif === "vehicle-track") return processLayout(points, template)
  if (points.length > 0 && points.length <= 4) return cardGridLayout(points, template)
  if (index % 3 === 0) return splitLayout(points, template)
  return highlightLayout(points, template)
}

function visualAccent(slide: OfficeSlide, template: PptVisualTemplate) {
  if (!slide.visual?.trim()) return []
  return [
    roundedRect(80, 6530000, 1080000, 1600000, 260000, template.accentLight, 18000, template.cardLine),
    circle(81, 6660000, 1145000, 120000, template.accent, 85000),
    textBox(82, 6880000, 1120000, 1120000, 130000, visualKeyword(slide.visual), 760, {
      color: template.title,
      bold: true,
      maxLines: 1,
    }),
  ]
}

function slideIllustration(slide: OfficeSlide, template: PptVisualTemplate) {
  const source = `${slide.title}\n${slide.content}\n${slide.visual ?? ""}`
  if (slide.layout === "chart" || slide.layout === "architecture" || slide.layout === "process") return []
  if (/目录|大纲|章节|议程|agenda|outline|章节页|章节封面|篇章|chapter/i.test(source)) return []
  if (/总结|结论|下一步|summary|conclusion|next step/.test(source)) return []
  if (/无需图片|不用图片|不需要图片|无需配图|不需要配图/.test(source)) return []
  const kind = illustrationKind(source)
  if (!kind) return []
  return illustrationCard(70, 6150000, 2920000, 1820000, 980000, kind, template)
}

function illustrationKind(source: string) {
  if (/教学|数学|课堂|学生|练习|课程|课件|例题/.test(source)) return "teaching"
  if (/技术|架构|系统|代码|接口|部署|AI|RAG|GraphRAG|API/i.test(source)) return "tech"
  if (/数据|指标|增长|趋势|收入|成本|利润|看板|分析|洞察/.test(source)) return "data"
  if (/产品|发布|用户|体验|功能|路线图|需求/.test(source)) return "product"
  if (/营销|品牌|活动|传播|创意|海报/.test(source)) return "creative"
  if (/团队|沟通|会议|协作|复盘|述职/.test(source)) return "team"
  return undefined
}

function illustrationCard(
  id: number,
  x: number,
  y: number,
  cx: number,
  cy: number,
  kind: "teaching" | "tech" | "data" | "product" | "creative" | "team",
  template: PptVisualTemplate,
) {
  const title = {
    teaching: "主题配图",
    tech: "技术视觉",
    data: "数据视觉",
    product: "产品视觉",
    creative: "创意视觉",
    team: "协作视觉",
  }[kind]
  return [
    roundedRect(id, x, y, cx, cy, template.card, 22000, template.cardLine),
    rect(id + 1, x, y, cx, 90000, template.accent),
    textBox(id + 2, x + 170000, y + 155000, 900000, 160000, title, 760, {
      color: template.muted,
      bold: true,
      maxLines: 1,
    }),
    ...illustrationShapes(id + 10, x, y, kind, template),
  ]
}

function illustrationShapes(
  id: number,
  x: number,
  y: number,
  kind: "teaching" | "tech" | "data" | "product" | "creative" | "team",
  template: PptVisualTemplate,
) {
  if (kind === "teaching")
    return [
      roundedRect(id, x + 260000, y + 390000, 520000, 330000, template.accentLight, 18000, template.cardLine),
      textBox(id + 1, x + 350000, y + 475000, 320000, 120000, "1/2", 760, {
        color: template.title,
        bold: true,
        maxLines: 1,
      }),
      circle(id + 2, x + 930000, y + 360000, 300000, template.accent, 90000),
      circle(id + 3, x + 1260000, y + 480000, 240000, template.accent2, 90000),
      roundedRect(id + 4, x + 860000, y + 720000, 620000, 80000, template.side, 12000),
    ]
  if (kind === "tech")
    return [
      roundedRect(id, x + 270000, y + 380000, 520000, 300000, template.side, 18000),
      roundedRect(id + 1, x + 1030000, y + 360000, 460000, 270000, template.accentLight, 18000, template.cardLine),
      rect(id + 2, x + 790000, y + 510000, 240000, 55000, template.accent),
      circle(id + 3, x + 410000, y + 480000, 110000, template.accent, 90000),
      circle(id + 4, x + 1190000, y + 455000, 110000, template.accent2, 90000),
      textBox(id + 5, x + 400000, y + 750000, 920000, 130000, "AI Workflow", 700, {
        color: template.muted,
        maxLines: 1,
      }),
    ]
  if (kind === "data")
    return [
      rect(id, x + 310000, y + 740000, 260000, 220000, template.accent),
      rect(id + 1, x + 680000, y + 560000, 260000, 400000, template.accent2),
      rect(id + 2, x + 1050000, y + 430000, 260000, 530000, template.side),
      rect(id + 3, x + 260000, y + 970000, 1220000, 45000, template.cardLine),
      textBox(id + 4, x + 320000, y + 320000, 920000, 160000, "Insight", 900, {
        color: template.title,
        bold: true,
        maxLines: 1,
      }),
    ]
  if (kind === "product")
    return [
      roundedRect(id, x + 420000, y + 330000, 860000, 520000, template.side, 22000),
      roundedRect(id + 1, x + 510000, y + 430000, 680000, 70000, template.accentLight, 12000),
      roundedRect(id + 2, x + 510000, y + 570000, 430000, 70000, template.accent, 12000),
      circle(id + 3, x + 1140000, y + 725000, 160000, template.accent2, 90000),
    ]
  if (kind === "creative")
    return [
      circle(id, x + 390000, y + 430000, 360000, template.accent, 76000),
      circle(id + 1, x + 790000, y + 590000, 460000, template.accent2, 70000),
      circle(id + 2, x + 1230000, y + 410000, 260000, template.accentLight, 90000),
      rightArrow(id + 3, x + 480000, y + 870000, 820000, 130000, template.side),
    ]
  return [
    circle(id, x + 370000, y + 430000, 240000, template.accent, 90000),
    circle(id + 1, x + 760000, y + 380000, 240000, template.accent2, 90000),
    circle(id + 2, x + 1150000, y + 430000, 240000, template.accent, 90000),
    roundedRect(id + 3, x + 300000, y + 760000, 1180000, 170000, template.accentLight, 16000, template.cardLine),
  ]
}

function picture(id: number, x: number, y: number, cx: number, cy: number, image: PptSlideImage) {
  return [
    `<p:pic>`,
    `<p:nvPicPr><p:cNvPr id="${id}" name="${xml(image.alt || image.filename)}" descr="${xml(image.alt || image.filename)}"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>`,
    `<p:blipFill><a:blip r:embed="${image.relID}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>`,
    `<p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="roundRect"><a:avLst/></a:prstGeom><a:ln w="9525"><a:solidFill><a:srgbClr val="FFFFFF"><a:alpha val="35000"/></a:srgbClr></a:solidFill></a:ln></p:spPr>`,
    `</p:pic>`,
  ].join("")
}

function pptSlideImages(slides: Array<Pick<OfficeSlide, "index" | "title" | "content" | "visual">>) {
  let count = 0
  return slides.map((slide) => {
    if (count >= 5) return []
    const image = dataUrlImages(`${slide.visual ?? ""}\n${slide.content}`).slice(0, 1)[0]
    if (!image) return []
    count += 1
    return [
      {
        ...image,
        id: `slide-${slide.index}-image-1`,
        relID: "rId2",
        filename: `slide${slide.index}-image1.${image.extension}`,
        alt: image.alt || `${slide.title} 配图`,
      },
    ]
  })
}

function dataUrlImages(input: string) {
  const result: Array<Omit<PptSlideImage, "id" | "relID" | "filename">> = []
  const pattern =
    /!\[([^\]]*)\]\((data:image\/(?:png|jpeg|jpg|gif|webp);base64,[^)]+)\)|<img[^>]+src=["'](data:image\/(?:png|jpeg|jpg|gif|webp);base64,[^"']+)["'][^>]*>/gi
  for (const match of input.matchAll(pattern)) {
    const url = match[2] ?? match[3]
    if (!url) continue
    const parsed = parseImageDataUrl(url)
    if (!parsed) continue
    result.push({ ...parsed, alt: match[1]?.trim() || "PPT 配图" })
    if (result.length >= 5) break
  }
  return result
}

function parseImageDataUrl(url: string) {
  const match = url.match(/^data:(image\/(?:png|jpeg|jpg|gif|webp));base64,([A-Za-z0-9+/=\s]+)$/i)
  if (!match?.[1] || !match[2]) return
  const contentType = match[1].toLowerCase().replace("image/jpg", "image/jpeg")
  const extension = (contentType === "image/jpeg" ? "jpg" : contentType.replace("image/", "")) as
    | "png"
    | "jpg"
    | "gif"
    | "webp"
  return {
    extension,
    contentType,
    bytes: base64Bytes(match[2]),
  }
}

function imageDefaultXml(image: PptSlideImage) {
  return `<Default Extension="${image.extension}" ContentType="${image.contentType}"/>`
}

function base64Bytes(input: string) {
  const clean = input.replace(/\s+/g, "")
  if (typeof Buffer !== "undefined") return new Uint8Array(Buffer.from(clean, "base64"))
  const binary = atob(clean)
  return Uint8Array.from(binary, (char) => char.charCodeAt(0))
}

function visualKeyword(input: string) {
  if (/图表|数据|指标/.test(input)) return "数据可视化"
  if (/流程|步骤|时间线/.test(input)) return "流程图形化"
  if (/架构|模块|系统/.test(input)) return "结构图形化"
  if (/课堂|教学|练习|例题/.test(input)) return "课堂视觉"
  return "视觉增强"
}

function classroomLayout(points: string[], template: PptVisualTemplate) {
  const items = padPoints(points, 5)
  return [
    roundedRect(30, 900000, 1500000, 3450000, 2600000, template.side, 22000),
    textBox(31, 1220000, 1760000, 2780000, 420000, items[0] ?? "本页重点", 1850, {
      color: template.coverTitle,
      bold: true,
      maxLines: 2,
    }),
    rect(32, 1210000, 2340000, 2550000, 55000, template.accentLight),
    textBox(33, 1220000, 2550000, 2700000, 900000, items.slice(1, 3).join("\n"), 1250, {
      color: template.coverText,
      maxLines: 3,
    }),
    roundedRect(34, 4620000, 1500000, 1600000, 1180000, template.card, 22000, template.cardLine),
    roundedRect(35, 6400000, 1500000, 1600000, 1180000, template.card, 22000, template.cardLine),
    roundedRect(36, 4620000, 3020000, 3380000, 1120000, template.card, 22000, template.cardLine),
    circle(37, 4850000, 1710000, 280000, template.accent, 85000),
    circle(38, 6630000, 1710000, 280000, template.accent2, 85000),
    circle(39, 4860000, 3230000, 260000, template.accentLight, 85000),
    textBox(40, 5230000, 1720000, 770000, 260000, "知识点", 1050, { color: template.title, bold: true, maxLines: 1 }),
    textBox(41, 7010000, 1720000, 700000, 260000, "例题", 1050, { color: template.title, bold: true, maxLines: 1 }),
    textBox(42, 5230000, 2050000, 680000, 350000, items[2] ?? "概念拆解", 920, { color: template.text, maxLines: 2 }),
    textBox(43, 7010000, 2050000, 680000, 350000, items[3] ?? "课堂练习", 920, { color: template.text, maxLines: 2 }),
    textBox(44, 5230000, 3230000, 2380000, 500000, items[4] ?? "用一个问题检查学生是否真正理解", 1120, {
      color: template.text,
      bold: true,
      maxLines: 2,
    }),
    textBox(45, 4850000, 3820000, 2600000, 240000, "课堂练习板", 900, { color: template.muted, maxLines: 1 }),
  ]
}

function chapterLayout(points: string[], template: PptVisualTemplate) {
  const items = padPoints(points, 3)
  return [
    rect(30, 0, 1320000, 9144000, 2420000, template.side),
    rect(31, 850000, 1320000, 760000, 2420000, template.accent),
    rect(32, 1800000, 1700000, 520000, 520000, template.accent2),
    rect(33, 1950000, 1850000, 220000, 220000, template.accentLight),
    textBox(34, 955000, 2260000, 520000, 320000, "01", 1750, {
      color: template.coverTitle,
      bold: true,
      maxLines: 1,
    }),
    textBox(35, 2860000, 1740000, 4720000, 720000, items[0] ?? "核心章节", 2700, {
      color: template.coverTitle,
      bold: true,
      maxLines: 2,
    }),
    rect(36, 2860000, 2690000, 1440000, 65000, template.accent2),
    textBox(37, 2860000, 2960000, 4340000, 420000, items.slice(1).join(" / "), 1200, {
      color: template.coverText,
      maxLines: 2,
    }),
    rect(38, 6800000, 3600000, 1120000, 52000, template.accent2),
  ]
}

function agendaLayout(points: string[], template: PptVisualTemplate) {
  const items = padPoints(points, 5).slice(0, 5)
  return [
    roundedRect(30, 900000, 1450000, 2440000, 2750000, template.side, 22000),
    rect(31, 3340000, 1450000, 90000, 2750000, template.accent),
    textBox(32, 1220000, 1840000, 1780000, 780000, "演示结构", 2400, {
      color: template.coverTitle,
      bold: true,
      maxLines: 2,
    }),
    textBox(33, 1230000, 2850000, 1680000, 500000, "按章节推进，先建立共识，再进入关键内容。", 1120, {
      color: template.coverText,
      maxLines: 2,
    }),
    ...items.flatMap((point, index) => {
      const y = 1500000 + index * 520000
      return [
        rect(40 + index * 5, 4180000, y + 70000, 320000, 320000, index % 2 === 0 ? template.accent : template.accent2),
        textBox(41 + index * 5, 4270000, y + 165000, 120000, 90000, `${index + 1}`, 640, {
          color: template.coverTitle,
          bold: true,
          maxLines: 1,
        }),
        roundedRect(42 + index * 5, 4660000, y, 3150000, 430000, template.card, 20000, template.cardLine),
        rect(43 + index * 5, 4660000, y, 90000, 430000, index % 2 === 0 ? template.accent : template.accent2),
        textBox(44 + index * 5, 4910000, y + 105000, 2600000, 170000, point, 950, {
          color: template.text,
          bold: index === 0,
          maxLines: 1,
        }),
      ]
    }),
  ]
}

function summaryLayout(points: string[], template: PptVisualTemplate) {
  const items = padPoints(points, 4).slice(0, 4)
  return [
    rect(30, 900000, 1500000, 7300000, 120000, template.accent),
    roundedRect(31, 900000, 1710000, 7300000, 820000, template.side, 22000),
    textBox(32, 1250000, 1950000, 6200000, 360000, items[0] ?? "核心结论", 1850, {
      color: template.coverTitle,
      bold: true,
      maxLines: 2,
    }),
    ...items.slice(1).flatMap((point, index) => {
      const x = 900000 + index * 2480000
      return [
        roundedRect(40 + index * 5, x, 2850000, 2180000, 1120000, template.card, 22000, template.cardLine),
        rect(41 + index * 5, x, 2850000, 130000, 1120000, index % 2 === 0 ? template.accent : template.accent2),
        textBox(42 + index * 5, x + 310000, 3120000, 1560000, 360000, point, 1200, {
          color: template.text,
          bold: true,
          maxLines: 2,
        }),
      ]
    }),
  ]
}

function cardGridLayout(points: string[], template: PptVisualTemplate) {
  const items = padPoints(points, 4)
  return [
    textBox(29, 920000, 1340000, 2200000, 260000, "核心要点", 1050, { color: template.muted, bold: true, maxLines: 1 }),
    ...items.flatMap((point, index) => {
      const col = index % 2
      const row = Math.floor(index / 2)
      const x = 900000 + col * 3750000
      const y = 1580000 + row * 1260000
      return [
        roundedRect(30 + index * 5, x, y, 3300000, 980000, template.card, 22000, template.cardLine),
        rect(31 + index * 5, x, y, 130000, 980000, index % 2 === 0 ? template.accent : template.accent2),
        circle(
          32 + index * 5,
          x + 280000,
          y + 220000,
          300000,
          index % 2 === 0 ? template.accent : template.accent2,
          90000,
        ),
        textBox(33 + index * 5, x + 385000, y + 310000, 120000, 140000, `${index + 1}`, 760, {
          color: template.coverTitle,
          bold: true,
          maxLines: 1,
        }),
        textBox(34 + index * 5, x + 700000, y + 220000, 2320000, 470000, point, 1420, {
          color: template.text,
          bold: index === 0,
          maxLines: 2,
        }),
      ]
    }),
  ]
}

function comparisonLayout(points: string[], template: PptVisualTemplate) {
  const left = padPoints(points.slice(0, Math.ceil(points.length / 2)), 3)
  const right = padPoints(points.slice(Math.ceil(points.length / 2)), 3)
  return [
    roundedRect(30, 900000, 1500000, 3400000, 2750000, template.card, 22000, template.cardLine),
    roundedRect(31, 4750000, 1500000, 3400000, 2750000, template.card, 22000, template.cardLine),
    rect(32, 900000, 1500000, 3400000, 150000, template.accent),
    rect(33, 4750000, 1500000, 3400000, 150000, template.accent2),
    circle(38, 4260000, 2460000, 580000, template.accentLight, 90000),
    textBox(39, 4390000, 2630000, 320000, 150000, "VS", 850, { color: template.title, bold: true, maxLines: 1 }),
    textBox(34, 1160000, 1740000, 2600000, 320000, "方案 A", 1500, { color: template.title, bold: true, maxLines: 1 }),
    textBox(35, 5010000, 1740000, 2600000, 320000, "方案 B", 1500, { color: template.title, bold: true, maxLines: 1 }),
    bulletTextBox(36, 1220000, 2200000, 2600000, 1450000, left.join("\n"), 1250, template.text),
    bulletTextBox(37, 4970000, 2200000, 2600000, 1450000, right.join("\n"), 1250, template.text),
  ]
}

function timelineLayout(points: string[], template: PptVisualTemplate) {
  const items = padPoints(points, 4).slice(0, 4)
  return [
    roundedRect(29, 900000, 1560000, 7200000, 2520000, template.card, 22000, template.cardLine),
    rect(30, 1150000, 2700000, 6500000, 80000, template.accent),
    ...items.flatMap((point, index) => {
      const x = 1150000 + index * 2150000
      return [
        circle(31 + index * 5, x, 2460000, 520000, index % 2 === 0 ? template.accent : template.accent2, 95000),
        textBox(32 + index * 5, x + 90000, 2580000, 340000, 180000, `${index + 1}`, 1100, {
          color: template.coverTitle,
          bold: true,
          maxLines: 1,
        }),
        roundedRect(33 + index * 5, x - 320000, 3150000, 1200000, 850000, template.card, 22000, template.cardLine),
        textBox(35 + index * 5, x - 130000, 3240000, 700000, 170000, `阶段 ${index + 1}`, 720, {
          color: template.muted,
          bold: true,
          maxLines: 1,
        }),
        textBox(34 + index * 5, x - 160000, 3340000, 900000, 450000, point, 1050, {
          color: template.text,
          maxLines: 3,
        }),
      ]
    }),
  ]
}

function chartLayout(points: string[], template: PptVisualTemplate) {
  const items = padPoints(points, 4).slice(0, 4)
  const values = chartValues(items)
  return [
    roundedRect(30, 900000, 1500000, 7300000, 2750000, template.card, 22000, template.cardLine),
    textBox(31, 1220000, 1720000, 2500000, 320000, "关键指标", 1450, {
      color: template.title,
      bold: true,
      maxLines: 1,
    }),
    ...[0, 1, 2].map((item) => rect(63 + item, 1260000, 2160000 + item * 560000, 4300000, 25000, template.cardLine)),
    rect(32, 1260000, 3850000, 4300000, 45000, template.cardLine),
    ...items.flatMap((point, index) => {
      const x = 1450000 + index * 980000
      const h = values[index] ?? 1100000
      return [
        roundedRect(
          33 + index * 5,
          x,
          3850000 - h,
          520000,
          h,
          index % 2 === 0 ? template.accent : template.accent2,
          18000,
        ),
        textBox(34 + index * 5, x - 30000, 3850000 - h - 280000, 580000, 220000, chartValueLabel(point), 950, {
          color: template.title,
          bold: true,
          maxLines: 1,
        }),
        textBox(35 + index * 5, x - 120000, 3950000, 760000, 300000, point, 900, {
          color: template.text,
          maxLines: 2,
        }),
      ]
    }),
    roundedRect(60, 6100000, 1850000, 1500000, 720000, template.side, 22000),
    textBox(61, 6300000, 2050000, 1100000, 260000, "洞察", 1200, {
      color: template.coverTitle,
      bold: true,
      maxLines: 1,
    }),
    textBox(62, 6300000, 2400000, 1100000, 760000, items[0] ?? "关注趋势变化", 1100, {
      color: template.coverTitle,
      maxLines: 3,
    }),
    roundedRect(66, 6100000, 2920000, 1500000, 520000, template.accentLight, 22000, template.cardLine),
    textBox(67, 6310000, 3090000, 1080000, 200000, "建议动作", 900, { color: template.title, bold: true, maxLines: 1 }),
    textBox(68, 6310000, 3340000, 1050000, 220000, items[1] ?? "补充数据口径", 820, {
      color: template.text,
      maxLines: 1,
    }),
  ]
}

function chartValues(points: string[]) {
  const numbers = points
    .map((point) => Number(point.match(/-?\d+(?:\.\d+)?/)?.[0]))
    .filter((value) => Number.isFinite(value))
  const max = Math.max(...numbers, 1)
  return points.map((point, index) => {
    const value = Number(point.match(/-?\d+(?:\.\d+)?/)?.[0])
    if (Number.isFinite(value)) return 650000 + Math.round((Math.abs(value) / max) * 1250000)
    return [1500000, 1100000, 1800000, 1350000][index] ?? 1100000
  })
}

function chartValueLabel(point: string) {
  return point.match(/-?\d+(?:\.\d+)?\s*%?/)?.[0] ?? "趋势"
}

function architectureLayout(points: string[], template: PptVisualTemplate) {
  const items = padPoints(points, 5).slice(0, 5)
  return [
    roundedRect(30, 900000, 1500000, 7300000, 2750000, template.card, 22000, template.cardLine),
    textBox(73, 1220000, 1690000, 1200000, 230000, "核心层", 900, { color: template.muted, bold: true, maxLines: 1 }),
    textBox(74, 1220000, 3910000, 1200000, 230000, "能力层", 900, { color: template.muted, bold: true, maxLines: 1 }),
    ...items.flatMap((point, index) => {
      const top = index === 0
      const x = top ? 3650000 : 1250000 + (index - 1) * 1650000
      const y = top ? 1740000 : 3000000
      return [
        roundedRect(
          31 + index * 5,
          x,
          y,
          top ? 1800000 : 1350000,
          620000,
          top ? template.side : template.pageBg,
          20000,
          top ? template.side : template.cardLine,
        ),
        textBox(32 + index * 5, x + 150000, y + 170000, top ? 1500000 : 1050000, 260000, point, 1050, {
          color: top ? template.coverTitle : template.text,
          bold: top,
          maxLines: 2,
        }),
        ...(top ? [] : [rect(33 + index * 5, x + 610000, 2470000, 70000, 530000, template.accent)]),
      ]
    }),
    rect(70, 4550000, 2360000, 70000, 640000, template.accent),
    rect(71, 1900000, 2700000, 5350000, 70000, template.accent),
    circle(72, 4400000, 2540000, 360000, template.accent2, 65000),
  ]
}

function processLayout(points: string[], template: PptVisualTemplate) {
  const items = padPoints(points, 5).slice(0, 5)
  return [
    roundedRect(29, 820000, 1420000, 7500000, 2840000, template.card, 22000, template.cardLine),
    ...items.flatMap((point, index) => {
      const x = 900000 + index * 1460000
      const y = index % 2 === 0 ? 1750000 : 2900000
      return [
        circle(30 + index * 6, x, y, 620000, index % 2 === 0 ? template.accent : template.accent2, 95000),
        textBox(31 + index * 6, x + 180000, y + 190000, 260000, 180000, `${index + 1}`, 1000, {
          color: template.coverTitle,
          bold: true,
          maxLines: 1,
        }),
        roundedRect(32 + index * 6, x - 250000, y + 760000, 1120000, 650000, template.card, 20000, template.cardLine),
        textBox(33 + index * 6, x - 90000, y + 940000, 780000, 280000, point, 950, {
          color: template.text,
          maxLines: 2,
        }),
        ...(index < items.length - 1
          ? [rightArrow(34 + index * 6, x + 620000, y + 255000, 860000, 150000, template.accent)]
          : []),
      ]
    }),
  ]
}

function matrixLayout(points: string[], template: PptVisualTemplate) {
  const items = padPoints(points, 4).slice(0, 4)
  const cells = [
    { x: 1050000, y: 1520000, color: template.accentLight },
    { x: 4700000, y: 1520000, color: "FFFFFF" },
    { x: 1050000, y: 2860000, color: "FFFFFF" },
    { x: 4700000, y: 2860000, color: template.accentLight },
  ]
  return [
    roundedRect(29, 900000, 1420000, 7500000, 2920000, template.card, 22000, template.cardLine),
    rect(30, 4570000, 1540000, 70000, 2580000, template.accent),
    rect(31, 1120000, 2790000, 6900000, 70000, template.accent),
    ...cells.flatMap((cell, index) => [
      roundedRect(32 + index * 5, cell.x, cell.y, 3200000, 1120000, cell.color, 18000, template.cardLine),
      circle(
        33 + index * 5,
        cell.x + 160000,
        cell.y + 160000,
        260000,
        index % 2 === 0 ? template.accent : template.accent2,
        85000,
      ),
      textBox(34 + index * 5, cell.x + 540000, cell.y + 180000, 2200000, 240000, matrixLabel(index), 950, {
        color: template.muted,
        bold: true,
        maxLines: 1,
      }),
      textBox(35 + index * 5, cell.x + 540000, cell.y + 480000, 2100000, 360000, items[index] ?? "", 1050, {
        color: template.text,
        maxLines: 2,
      }),
    ]),
  ]
}

function funnelLayout(points: string[], template: PptVisualTemplate) {
  const items = padPoints(points, 5).slice(0, 5)
  return [
    roundedRect(29, 900000, 1420000, 7500000, 2920000, template.card, 22000, template.cardLine),
    ...items.flatMap((point, index) => {
      const width = 6100000 - index * 720000
      const x = 4570000 - width / 2
      const y = 1650000 + index * 480000
      return [
        roundedRect(30 + index * 5, x, y, width, 360000, index % 2 === 0 ? template.accent : template.accent2, 18000),
        textBox(31 + index * 5, x + 260000, y + 90000, width - 520000, 150000, point, 900, {
          color: template.coverTitle,
          bold: true,
          maxLines: 1,
        }),
      ]
    }),
    textBox(60, 3180000, 4080000, 2800000, 220000, "逐层筛选 / 转化路径", 900, { color: template.muted, maxLines: 1 }),
  ]
}

function pyramidLayout(points: string[], template: PptVisualTemplate) {
  const items = padPoints(points, 5).slice(0, 5)
  return [
    roundedRect(29, 900000, 1420000, 7500000, 2920000, template.card, 22000, template.cardLine),
    ...items.flatMap((point, index) => {
      const level = items.length - index - 1
      const width = 2400000 + level * 720000
      const x = 4570000 - width / 2
      const y = 1700000 + index * 470000
      return [
        roundedRect(30 + index * 5, x, y, width, 350000, index % 2 === 0 ? template.accent2 : template.accent, 18000),
        textBox(31 + index * 5, x + 250000, y + 85000, width - 500000, 150000, point, 900, {
          color: template.coverTitle,
          bold: true,
          maxLines: 1,
        }),
      ]
    }),
    textBox(60, 3180000, 4080000, 2800000, 220000, "层级递进 / 能力堆栈", 900, { color: template.muted, maxLines: 1 }),
  ]
}

function cycleLayout(points: string[], template: PptVisualTemplate) {
  const items = padPoints(points, 4).slice(0, 4)
  const nodes = [
    { x: 4300000, y: 1580000 },
    { x: 6100000, y: 2660000 },
    { x: 4300000, y: 3740000 },
    { x: 2500000, y: 2660000 },
  ]
  return [
    roundedRect(29, 900000, 1420000, 7500000, 2920000, template.card, 22000, template.cardLine),
    circle(30, 3900000, 2320000, 1320000, template.accentLight, 35000),
    textBox(31, 4130000, 2800000, 850000, 220000, "闭环", 1200, { color: template.title, bold: true, maxLines: 1 }),
    ...nodes.flatMap((node, index) => [
      circle(32 + index * 6, node.x, node.y, 740000, index % 2 === 0 ? template.accent : template.accent2, 95000),
      textBox(33 + index * 6, node.x + 245000, node.y + 180000, 250000, 180000, `${index + 1}`, 950, {
        color: template.coverTitle,
        bold: true,
        maxLines: 1,
      }),
      textBox(34 + index * 6, node.x - 360000, node.y + 830000, 1450000, 280000, items[index] ?? "", 900, {
        color: template.text,
        maxLines: 2,
      }),
    ]),
    rightArrow(70, 5300000, 1940000, 760000, 150000, template.accent),
    rightArrow(71, 5300000, 3720000, 760000, 150000, template.accent),
    rightArrow(72, 3300000, 1940000, 760000, 150000, template.accent2),
    rightArrow(73, 3300000, 3720000, 760000, 150000, template.accent2),
  ]
}

function frameworkLayout(points: string[], template: PptVisualTemplate) {
  const items = padPoints(points, 5).slice(0, 5)
  const satellites = [
    { x: 1800000, y: 1720000 },
    { x: 6150000, y: 1720000 },
    { x: 6300000, y: 3300000 },
    { x: 1800000, y: 3300000 },
  ]
  return [
    roundedRect(29, 900000, 1420000, 7500000, 2920000, template.card, 22000, template.cardLine),
    circle(30, 3860000, 2240000, 1420000, template.side, 95000),
    textBox(31, 4070000, 2690000, 1000000, 260000, items[0] ?? "核心模型", 1100, {
      color: template.coverTitle,
      bold: true,
      maxLines: 2,
    }),
    ...satellites.flatMap((node, index) => [
      rect(32 + index * 5, node.x + 720000, node.y + 390000, 1600000, 60000, template.accent),
      roundedRect(33 + index * 5, node.x, node.y, 1550000, 760000, template.accentLight, 20000, template.cardLine),
      textBox(34 + index * 5, node.x + 170000, node.y + 220000, 1180000, 250000, items[index + 1] ?? "", 950, {
        color: template.text,
        maxLines: 2,
      }),
    ]),
  ]
}

function infographicLayout(points: string[], template: PptVisualTemplate) {
  const items = padPoints(points, 5).slice(0, 5)
  return [
    roundedRect(29, 880000, 1420000, 7540000, 2920000, template.card, 22000, template.cardLine),
    textBox(30, 1180000, 1640000, 2500000, 240000, "信息摘要", 1050, {
      color: template.muted,
      bold: true,
      maxLines: 1,
    }),
    ...items.flatMap((point, index) => {
      const x = 1120000 + index * 1400000
      const color = index % 2 === 0 ? template.accent : template.accent2
      return [
        circle(31 + index * 7, x, 2140000, 720000, color, 90000),
        textBox(32 + index * 7, x + 220000, 2350000, 270000, 160000, `${index + 1}`, 900, {
          color: template.coverTitle,
          bold: true,
          maxLines: 1,
        }),
        roundedRect(
          33 + index * 7,
          x - 170000,
          3060000,
          1060000,
          740000,
          template.accentLight,
          18000,
          template.cardLine,
        ),
        textBox(34 + index * 7, x + 10000, 3260000, 700000, 260000, point, 900, {
          color: template.text,
          maxLines: 2,
        }),
        rect(35 + index * 7, x + 340000, 2910000, 50000, 240000, color),
      ]
    }),
  ]
}

function mapLayout(points: string[], template: PptVisualTemplate) {
  const items = padPoints(points, 4).slice(0, 4)
  const markers = [
    { x: 3450000, y: 2180000 },
    { x: 4720000, y: 1920000 },
    { x: 5650000, y: 2750000 },
    { x: 4260000, y: 3380000 },
  ]
  return [
    roundedRect(29, 900000, 1420000, 7500000, 2920000, template.card, 22000, template.cardLine),
    circle(30, 2780000, 1710000, 2850000, template.accentLight, 32000),
    circle(31, 3760000, 1580000, 2350000, template.accentLight, 36000),
    circle(32, 4650000, 2200000, 1900000, template.accentLight, 39000),
    roundedRect(33, 3020000, 1980000, 3200000, 1520000, template.pageBg, 26000, template.cardLine),
    ...markers.flatMap((marker, index) => [
      circle(40 + index * 5, marker.x, marker.y, 230000, index % 2 === 0 ? template.accent : template.accent2, 95000),
      circle(41 + index * 5, marker.x + 62000, marker.y + 62000, 105000, template.coverTitle, 90000),
      textBox(42 + index * 5, marker.x + 250000, marker.y - 10000, 1380000, 220000, items[index] ?? "", 820, {
        color: template.text,
        maxLines: 1,
      }),
    ]),
    textBox(70, 1180000, 3850000, 2100000, 260000, "区域分布 / 市场覆盖", 950, { color: template.muted, maxLines: 1 }),
  ]
}

function sceneLayout(points: string[], template: PptVisualTemplate) {
  const items = padPoints(points, 4).slice(0, 4)
  return [
    roundedRect(29, 900000, 1420000, 7500000, 2920000, template.card, 22000, template.cardLine),
    rect(30, 900000, 1420000, 7500000, 1320000, template.accentLight),
    circle(31, 6460000, 1650000, 620000, template.accent2, 62000),
    circle(32, 1460000, 1900000, 480000, template.accent, 42000),
    roundedRect(33, 1800000, 2840000, 5200000, 540000, template.pageBg, 18000, template.cardLine),
    textBox(34, 2140000, 2980000, 4500000, 220000, items[0] ?? "关键场景", 1150, {
      color: template.title,
      bold: true,
      maxLines: 1,
    }),
    ...items.slice(1, 4).flatMap((point, index) => [
      circle(
        40 + index * 5,
        1860000 + index * 1950000,
        3700000,
        220000,
        index % 2 === 0 ? template.accent : template.accent2,
        90000,
      ),
      textBox(41 + index * 5, 2160000 + index * 1950000, 3650000, 1260000, 260000, point, 850, {
        color: template.text,
        maxLines: 2,
      }),
    ]),
    textBox(70, 1180000, 1640000, 2100000, 240000, "场景叙事", 1050, {
      color: template.title,
      bold: true,
      maxLines: 1,
    }),
  ]
}

function ganttLayout(points: string[], template: PptVisualTemplate) {
  const items = padPoints(points, 6).slice(0, 6)
  return [
    roundedRect(29, 900000, 1420000, 7500000, 2920000, template.card, 22000, template.cardLine),
    textBox(30, 1180000, 1620000, 1700000, 220000, "甘特排期", 1050, {
      color: template.title,
      bold: true,
      maxLines: 1,
    }),
    ...[0, 1, 2, 3].map((index) =>
      rect(31 + index, 3100000 + index * 980000, 1980000, 22000, 1860000, template.cardLine),
    ),
    ...["阶段一", "阶段二", "阶段三", "交付"].map((label, index) =>
      textBox(40 + index, 2860000 + index * 980000, 1720000, 760000, 170000, label, 720, {
        color: template.muted,
        maxLines: 1,
      }),
    ),
    ...items.flatMap((point, index) => {
      const y = 2050000 + index * 300000
      const x = 3000000 + (index % 4) * 520000
      const width = 1150000 + (index % 3) * 360000
      return [
        textBox(55 + index * 4, 1220000, y - 45000, 1500000, 180000, point, 760, { color: template.text, maxLines: 1 }),
        roundedRect(56 + index * 4, x, y, width, 150000, index % 2 === 0 ? template.accent : template.accent2, 18000),
      ]
    }),
  ]
}

function donutLayout(points: string[], template: PptVisualTemplate) {
  const items = padPoints(points, 5).slice(0, 5)
  return [
    roundedRect(29, 900000, 1420000, 7500000, 2920000, template.card, 22000, template.cardLine),
    circle(30, 1800000, 1850000, 1880000, template.accent, 90000),
    circle(31, 2350000, 2400000, 780000, template.card, 95000),
    circle(32, 2980000, 1880000, 1180000, template.accent2, 82000),
    circle(33, 2000000, 3000000, 920000, template.accentLight, 95000),
    textBox(34, 2340000, 2560000, 820000, 260000, "占比", 1350, { color: template.title, bold: true, maxLines: 1 }),
    ...items.flatMap((point, index) => [
      circle(
        40 + index * 4,
        5100000,
        1780000 + index * 430000,
        180000,
        index % 2 === 0 ? template.accent : template.accent2,
        90000,
      ),
      textBox(41 + index * 4, 5380000, 1740000 + index * 430000, 2200000, 240000, point, 900, {
        color: template.text,
        maxLines: 1,
      }),
    ]),
    textBox(70, 1180000, 3920000, 2600000, 220000, "甜甜圈占比 / 中心指标", 900, {
      color: template.muted,
      maxLines: 1,
    }),
  ]
}

function waterfallLayout(points: string[], template: PptVisualTemplate) {
  const items = padPoints(points, 6).slice(0, 6)
  const values = chartValues(items)
  return [
    roundedRect(29, 900000, 1420000, 7500000, 2920000, template.card, 22000, template.cardLine),
    rect(30, 1280000, 3860000, 6150000, 45000, template.cardLine),
    textBox(31, 1220000, 1640000, 2100000, 220000, "瀑布拆解", 1050, {
      color: template.title,
      bold: true,
      maxLines: 1,
    }),
    ...items.flatMap((point, index) => {
      const h = Math.min(values[index] ?? 900000, 1450000)
      const y = index % 2 === 0 ? 3860000 - h : 2700000
      const color = index % 2 === 0 ? template.accent : template.accent2
      return [
        roundedRect(40 + index * 5, 1450000 + index * 950000, y, 560000, h, color, 18000),
        textBox(41 + index * 5, 1360000 + index * 950000, 3970000, 760000, 240000, point, 780, {
          color: template.text,
          maxLines: 2,
        }),
        ...(index < items.length - 1
          ? [rect(42 + index * 5, 2010000 + index * 950000, y + h / 2, 390000, 26000, template.cardLine)]
          : []),
      ]
    }),
  ]
}

function heatmapLayout(points: string[], template: PptVisualTemplate) {
  const items = padPoints(points, 6).slice(0, 6)
  return [
    roundedRect(29, 900000, 1420000, 7500000, 2920000, template.card, 22000, template.cardLine),
    textBox(30, 1180000, 1620000, 1700000, 220000, "热力矩阵", 1050, {
      color: template.title,
      bold: true,
      maxLines: 1,
    }),
    ...Array.from({ length: 24 }, (_, index) => {
      const col = index % 6
      const row = Math.floor(index / 6)
      const palette = [template.accentLight, template.cardLine, template.accent2, template.accent]
      return roundedRect(
        40 + index,
        1700000 + col * 760000,
        2050000 + row * 420000,
        620000,
        300000,
        palette[(col + row) % palette.length]!,
        14000,
      )
    }),
    ...items.map((point, index) =>
      textBox(70 + index, 6420000, 1900000 + index * 340000, 1320000, 210000, point, 780, {
        color: template.text,
        maxLines: 1,
      }),
    ),
  ]
}

function radarLayout(points: string[], template: PptVisualTemplate) {
  const items = padPoints(points, 6).slice(0, 6)
  const nodes = [
    { x: 4200000, y: 1680000 },
    { x: 5600000, y: 2240000 },
    { x: 5600000, y: 3440000 },
    { x: 4200000, y: 3900000 },
    { x: 2800000, y: 3440000 },
    { x: 2800000, y: 2240000 },
  ]
  return [
    roundedRect(29, 900000, 1420000, 7500000, 2920000, template.card, 22000, template.cardLine),
    circle(30, 3350000, 2200000, 1780000, template.accentLight, 45000),
    circle(31, 3780000, 2630000, 920000, template.cardLine, 42000),
    rect(32, 4260000, 1720000, 50000, 2180000, template.cardLine),
    rect(33, 2860000, 2790000, 2820000, 50000, template.cardLine),
    ...nodes.flatMap((node, index) => [
      circle(40 + index * 4, node.x, node.y, 240000, index % 2 === 0 ? template.accent : template.accent2, 90000),
      textBox(41 + index * 4, node.x - 360000, node.y + 290000, 950000, 210000, items[index] ?? "", 760, {
        color: template.text,
        maxLines: 1,
      }),
    ]),
    textBox(70, 1180000, 1620000, 1700000, 220000, "能力雷达", 1050, {
      color: template.title,
      bold: true,
      maxLines: 1,
    }),
  ]
}

function vennLayout(points: string[], template: PptVisualTemplate) {
  const items = padPoints(points, 4).slice(0, 4)
  return [
    roundedRect(29, 900000, 1420000, 7500000, 2920000, template.card, 22000, template.cardLine),
    circle(30, 2300000, 1900000, 1900000, template.accent, 52000),
    circle(31, 3500000, 1900000, 1900000, template.accent2, 52000),
    circle(32, 2900000, 2800000, 1900000, template.accentLight, 70000),
    textBox(33, 3060000, 2780000, 1520000, 330000, items[0] ?? "共同价值", 1100, {
      color: template.title,
      bold: true,
      maxLines: 2,
    }),
    textBox(40, 1500000, 3860000, 1700000, 260000, items[1] ?? "集合 A", 820, { color: template.text, maxLines: 1 }),
    textBox(41, 5900000, 3860000, 1700000, 260000, items[2] ?? "集合 B", 820, { color: template.text, maxLines: 1 }),
    textBox(42, 1180000, 1620000, 1700000, 220000, "韦恩交集", 1050, {
      color: template.title,
      bold: true,
      maxLines: 1,
    }),
  ]
}

function fishboneLayout(points: string[], template: PptVisualTemplate) {
  const items = padPoints(points, 6).slice(0, 6)
  return [
    roundedRect(29, 900000, 1420000, 7500000, 2920000, template.card, 22000, template.cardLine),
    textBox(30, 1180000, 1620000, 1700000, 220000, "鱼骨根因", 1050, {
      color: template.title,
      bold: true,
      maxLines: 1,
    }),
    rect(31, 1900000, 2840000, 5000000, 70000, template.accent),
    rightArrow(32, 6800000, 2745000, 620000, 260000, template.accent),
    roundedRect(33, 7350000, 2570000, 780000, 470000, template.side, 18000),
    textBox(34, 7470000, 2700000, 540000, 180000, "结果", 850, { color: template.coverTitle, bold: true, maxLines: 1 }),
    ...items.flatMap((point, index) => {
      const top = index % 2 === 0
      const x = 2100000 + Math.floor(index / 2) * 1500000
      const y = top ? 2080000 : 3280000
      return [
        rect(
          40 + index * 5,
          x + 360000,
          top ? y + 520000 : 2860000,
          70000,
          560000,
          index % 3 === 0 ? template.accent2 : template.accent,
        ),
        roundedRect(41 + index * 5, x, y, 1100000, 480000, template.accentLight, 18000, template.cardLine),
        textBox(42 + index * 5, x + 130000, y + 130000, 820000, 190000, point, 780, {
          color: template.text,
          maxLines: 1,
        }),
      ]
    }),
  ]
}

function journeyLayout(points: string[], template: PptVisualTemplate) {
  const items = padPoints(points, 5).slice(0, 5)
  return [
    roundedRect(29, 900000, 1420000, 7500000, 2920000, template.card, 22000, template.cardLine),
    textBox(30, 1180000, 1620000, 1700000, 220000, "旅程地图", 1050, {
      color: template.title,
      bold: true,
      maxLines: 1,
    }),
    rect(31, 1280000, 2680000, 6200000, 65000, template.cardLine),
    ...items.flatMap((point, index) => {
      const x = 1380000 + index * 1220000
      const y = index % 2 === 0 ? 2180000 : 3180000
      return [
        circle(40 + index * 6, x, y, 360000, index % 2 === 0 ? template.accent : template.accent2, 90000),
        textBox(41 + index * 6, x + 105000, y + 95000, 130000, 120000, `${index + 1}`, 760, {
          color: template.coverTitle,
          bold: true,
          maxLines: 1,
        }),
        roundedRect(
          42 + index * 6,
          x - 260000,
          y + 470000,
          980000,
          520000,
          template.accentLight,
          18000,
          template.cardLine,
        ),
        textBox(43 + index * 6, x - 90000, y + 610000, 640000, 190000, point, 760, {
          color: template.text,
          maxLines: 1,
        }),
      ]
    }),
    textBox(78, 1220000, 3940000, 2600000, 220000, "行动 / 情绪 / 痛点", 850, { color: template.muted, maxLines: 1 }),
  ]
}

function kpiLayout(points: string[], template: PptVisualTemplate) {
  const items = padPoints(points, 6).slice(0, 6)
  return [
    roundedRect(29, 900000, 1420000, 7500000, 2920000, template.card, 22000, template.cardLine),
    textBox(30, 1180000, 1620000, 1900000, 220000, "KPI 指标卡", 1050, {
      color: template.title,
      bold: true,
      maxLines: 1,
    }),
    ...items.flatMap((point, index) => {
      const x = 1200000 + (index % 3) * 2250000
      const y = 1980000 + Math.floor(index / 3) * 1030000
      return [
        roundedRect(
          40 + index * 5,
          x,
          y,
          1880000,
          780000,
          index % 2 === 0 ? template.accentLight : template.card,
          18000,
          template.cardLine,
        ),
        textBox(41 + index * 5, x + 180000, y + 140000, 1180000, 210000, chartValueLabel(point), 1500, {
          color: template.title,
          bold: true,
          maxLines: 1,
        }),
        textBox(42 + index * 5, x + 180000, y + 430000, 1420000, 210000, point, 780, {
          color: template.text,
          maxLines: 1,
        }),
        rect(43 + index * 5, x, y, 90000, 780000, index % 2 === 0 ? template.accent : template.accent2),
      ]
    }),
  ]
}

function gaugeLayout(points: string[], template: PptVisualTemplate) {
  const items = padPoints(points, 4).slice(0, 4)
  return [
    roundedRect(29, 900000, 1420000, 7500000, 2920000, template.card, 22000, template.cardLine),
    textBox(30, 1180000, 1620000, 1900000, 220000, "目标仪表盘", 1050, {
      color: template.title,
      bold: true,
      maxLines: 1,
    }),
    circle(31, 3100000, 1780000, 2300000, template.accentLight, 65000),
    circle(32, 3450000, 2130000, 1600000, template.card, 95000),
    rect(33, 4200000, 2580000, 1200000, 85000, template.accent),
    circle(34, 4150000, 2500000, 240000, template.accent2, 90000),
    textBox(35, 3750000, 3020000, 1200000, 300000, chartValueLabel(items[0] ?? "80%"), 2000, {
      color: template.title,
      bold: true,
      maxLines: 1,
    }),
    ...items.slice(1, 4).flatMap((point, index) => [
      roundedRect(
        40 + index * 4,
        6100000,
        1900000 + index * 640000,
        1500000,
        430000,
        template.accentLight,
        18000,
        template.cardLine,
      ),
      textBox(41 + index * 4, 6290000, 2020000 + index * 640000, 1100000, 170000, point, 820, {
        color: template.text,
        maxLines: 1,
      }),
    ]),
  ]
}

function roadmapLayout(points: string[], template: PptVisualTemplate) {
  const items = padPoints(points, 6).slice(0, 6)
  return [
    roundedRect(29, 900000, 1420000, 7500000, 2920000, template.card, 22000, template.cardLine),
    textBox(30, 1180000, 1620000, 1900000, 220000, "纵向路线图", 1050, {
      color: template.title,
      bold: true,
      maxLines: 1,
    }),
    rect(31, 4440000, 1900000, 70000, 2100000, template.cardLine),
    ...items.flatMap((point, index) => {
      const left = index % 2 === 0
      const y = 1880000 + index * 350000
      return [
        circle(40 + index * 5, 4300000, y, 340000, index % 2 === 0 ? template.accent : template.accent2, 90000),
        roundedRect(
          41 + index * 5,
          left ? 1900000 : 4960000,
          y - 90000,
          1900000,
          420000,
          template.accentLight,
          18000,
          template.cardLine,
        ),
        textBox(42 + index * 5, left ? 2100000 : 5160000, y + 20000, 1480000, 160000, point, 760, {
          color: template.text,
          maxLines: 1,
        }),
      ]
    }),
  ]
}

function mindmapLayout(points: string[], template: PptVisualTemplate) {
  const items = padPoints(points, 6).slice(0, 6)
  const nodes = [
    { x: 1900000, y: 1960000 },
    { x: 5900000, y: 1960000 },
    { x: 6500000, y: 2960000 },
    { x: 5900000, y: 3860000 },
    { x: 1900000, y: 3860000 },
    { x: 1300000, y: 2960000 },
  ]
  return [
    roundedRect(29, 900000, 1420000, 7500000, 2920000, template.card, 22000, template.cardLine),
    circle(30, 3740000, 2380000, 1320000, template.side, 90000),
    textBox(31, 3980000, 2860000, 900000, 200000, "核心主题", 950, {
      color: template.coverTitle,
      bold: true,
      maxLines: 1,
    }),
    ...nodes.flatMap((node, index) => [
      rect(
        40 + index * 5,
        node.x < 3800000 ? node.x + 1200000 : 4760000,
        node.y + 250000,
        1120000,
        50000,
        template.cardLine,
      ),
      roundedRect(
        41 + index * 5,
        node.x,
        node.y,
        1300000,
        540000,
        index % 2 === 0 ? template.accentLight : template.card,
        18000,
        template.cardLine,
      ),
      textBox(42 + index * 5, node.x + 150000, node.y + 170000, 980000, 180000, items[index] ?? "", 800, {
        color: template.text,
        maxLines: 1,
      }),
    ]),
  ]
}

function pillarsLayout(points: string[], template: PptVisualTemplate) {
  const items = padPoints(points, 4).slice(0, 4)
  return [
    roundedRect(29, 900000, 1420000, 7500000, 2920000, template.card, 22000, template.cardLine),
    textBox(30, 1180000, 1620000, 1900000, 220000, "核心支柱", 1050, {
      color: template.title,
      bold: true,
      maxLines: 1,
    }),
    rect(31, 1250000, 3950000, 6500000, 90000, template.cardLine),
    ...items.flatMap((point, index) => {
      const x = 1450000 + index * 1600000
      return [
        roundedRect(
          40 + index * 5,
          x,
          2140000,
          1100000,
          1760000,
          index % 2 === 0 ? template.accent : template.accent2,
          16000,
        ),
        circle(41 + index * 5, x + 310000, 1800000, 470000, template.accentLight, 90000),
        textBox(42 + index * 5, x + 180000, 2450000, 740000, 560000, point, 950, {
          color: template.coverTitle,
          bold: true,
          maxLines: 3,
        }),
      ]
    }),
  ]
}

function tableLayout(points: string[], template: PptVisualTemplate) {
  const items = padPoints(points, 5).slice(0, 5)
  return [
    roundedRect(29, 900000, 1420000, 7500000, 2920000, template.card, 22000, template.cardLine),
    textBox(30, 1180000, 1620000, 1900000, 220000, "对比表格", 1050, {
      color: template.title,
      bold: true,
      maxLines: 1,
    }),
    rect(31, 1320000, 2020000, 6350000, 420000, template.side),
    ...["维度", "方案 A", "方案 B", "建议"].map((label, index) =>
      textBox(32 + index, 1480000 + index * 1550000, 2140000, 980000, 150000, label, 780, {
        color: template.coverTitle,
        bold: true,
        maxLines: 1,
      }),
    ),
    ...items.flatMap((point, row) => [
      rect(45 + row, 1320000, 2500000 + row * 340000, 6350000, 22000, template.cardLine),
      textBox(55 + row, 1480000, 2590000 + row * 340000, 5600000, 150000, point, 760, {
        color: template.text,
        maxLines: 1,
      }),
    ]),
  ]
}

function scheduleLayout(points: string[], template: PptVisualTemplate) {
  const items = padPoints(points, 5).slice(0, 5)
  return [
    roundedRect(29, 900000, 1420000, 7500000, 2920000, template.card, 22000, template.cardLine),
    textBox(30, 1180000, 1620000, 1900000, 220000, "项目排期表", 1050, {
      color: template.title,
      bold: true,
      maxLines: 1,
    }),
    ...["任务", "负责人", "状态", "时间"].map((label, index) =>
      roundedRect(31 + index, 1220000 + index * 1600000, 1980000, 1400000, 360000, template.side, 12000),
    ),
    ...["任务", "负责人", "状态", "时间"].map((label, index) =>
      textBox(40 + index, 1420000 + index * 1600000, 2070000, 900000, 140000, label, 760, {
        color: template.coverTitle,
        bold: true,
        maxLines: 1,
      }),
    ),
    ...items.flatMap((point, row) => [
      rect(50 + row, 1220000, 2500000 + row * 340000, 6400000, 22000, template.cardLine),
      textBox(60 + row, 1380000, 2590000 + row * 340000, 2200000, 150000, point, 760, {
        color: template.text,
        maxLines: 1,
      }),
      roundedRect(
        70 + row,
        4540000,
        2550000 + row * 340000,
        780000,
        180000,
        row % 2 === 0 ? template.accent : template.accent2,
        12000,
      ),
    ]),
  ]
}

function orgTreeLayout(points: string[], template: PptVisualTemplate) {
  const items = padPoints(points, 7).slice(0, 7)
  return [
    roundedRect(29, 900000, 1420000, 7500000, 2920000, template.card, 22000, template.cardLine),
    textBox(30, 1180000, 1620000, 1900000, 220000, "层级拆解树", 1050, {
      color: template.title,
      bold: true,
      maxLines: 1,
    }),
    roundedRect(31, 3420000, 1850000, 2300000, 480000, template.side, 18000),
    textBox(32, 3740000, 1980000, 1600000, 170000, items[0] ?? "总目标", 860, {
      color: template.coverTitle,
      bold: true,
      maxLines: 1,
    }),
    rect(33, 4530000, 2330000, 60000, 520000, template.cardLine),
    rect(34, 2100000, 2850000, 4900000, 60000, template.cardLine),
    ...items.slice(1, 4).flatMap((point, index) => {
      const x = 1500000 + index * 2300000
      return [
        rect(40 + index * 5, x + 720000, 2850000, 50000, 340000, template.cardLine),
        roundedRect(41 + index * 5, x, 3180000, 1500000, 460000, template.accentLight, 18000, template.cardLine),
        textBox(42 + index * 5, x + 160000, 3310000, 1160000, 160000, point, 760, {
          color: template.text,
          maxLines: 1,
        }),
      ]
    }),
    ...items.slice(4, 7).flatMap((point, index) => [
      roundedRect(
        60 + index * 5,
        1900000 + index * 1900000,
        3850000,
        1200000,
        360000,
        template.card,
        16000,
        template.cardLine,
      ),
      textBox(61 + index * 5, 2040000 + index * 1900000, 3950000, 900000, 130000, point, 680, {
        color: template.text,
        maxLines: 1,
      }),
    ]),
  ]
}

function horizontalBarLayout(points: string[], template: PptVisualTemplate) {
  const items = padPoints(points, 6).slice(0, 6)
  const values = chartValues(items)
  return [
    roundedRect(29, 900000, 1420000, 7500000, 2920000, template.card, 22000, template.cardLine),
    textBox(30, 1180000, 1620000, 1900000, 220000, "横向排行", 1050, {
      color: template.title,
      bold: true,
      maxLines: 1,
    }),
    ...items.flatMap((point, index) => {
      const width = Math.min(values[index] ?? 900000, 2600000)
      return [
        textBox(40 + index * 5, 1280000, 2060000 + index * 330000, 1800000, 160000, point, 720, {
          color: template.text,
          maxLines: 1,
        }),
        roundedRect(
          41 + index * 5,
          3200000,
          2070000 + index * 330000,
          width,
          150000,
          index % 2 === 0 ? template.accent : template.accent2,
          14000,
        ),
        textBox(42 + index * 5, 6000000, 2040000 + index * 330000, 800000, 160000, chartValueLabel(point), 720, {
          color: template.muted,
          maxLines: 1,
        }),
      ]
    }),
  ]
}

function lineTrendLayout(points: string[], template: PptVisualTemplate) {
  const items = padPoints(points, 6).slice(0, 6)
  const nodes = items.map((_, index) => ({ x: 1500000 + index * 1030000, y: 3440000 - ((index * 470000) % 1550000) }))
  return [
    roundedRect(29, 900000, 1420000, 7500000, 2920000, template.card, 22000, template.cardLine),
    textBox(30, 1180000, 1620000, 1900000, 220000, "趋势折线", 1050, {
      color: template.title,
      bold: true,
      maxLines: 1,
    }),
    rect(31, 1300000, 3700000, 6500000, 45000, template.cardLine),
    ...[0, 1, 2].map((index) => rect(32 + index, 1300000, 2200000 + index * 480000, 6500000, 22000, template.cardLine)),
    ...nodes.flatMap((node, index) => [
      ...(index < nodes.length - 1
        ? [
            rect(
              45 + index,
              node.x + 120000,
              node.y + 85000,
              920000,
              45000,
              index % 2 === 0 ? template.accent : template.accent2,
            ),
          ]
        : []),
      circle(55 + index, node.x, node.y, 230000, index % 2 === 0 ? template.accent : template.accent2, 90000),
      textBox(65 + index, node.x - 230000, 3830000, 700000, 170000, items[index] ?? "", 680, {
        color: template.text,
        maxLines: 1,
      }),
    ]),
  ]
}

function paretoLayout(points: string[], template: PptVisualTemplate) {
  const items = padPoints(points, 5).slice(0, 5)
  const values = chartValues(items)
  return [
    roundedRect(29, 900000, 1420000, 7500000, 2920000, template.card, 22000, template.cardLine),
    textBox(30, 1180000, 1620000, 1900000, 220000, "帕累托 80/20", 1050, {
      color: template.title,
      bold: true,
      maxLines: 1,
    }),
    rect(31, 1360000, 3860000, 5600000, 45000, template.cardLine),
    ...items.flatMap((point, index) => {
      const h = Math.min(values[index] ?? 900000, 1500000)
      const x = 1560000 + index * 880000
      return [
        roundedRect(40 + index * 5, x, 3860000 - h, 520000, h, template.accent, 14000),
        circle(41 + index * 5, x + 220000, 3550000 - index * 260000, 160000, template.accent2, 90000),
        textBox(42 + index * 5, x - 120000, 3980000, 760000, 170000, point, 680, { color: template.text, maxLines: 1 }),
      ]
    }),
    textBox(75, 6200000, 1960000, 900000, 200000, "累计贡献", 780, { color: template.muted, maxLines: 1 }),
  ]
}

function bubbleLayout(points: string[], template: PptVisualTemplate) {
  const items = padPoints(points, 5).slice(0, 5)
  const nodes = [
    { x: 2150000, y: 2980000, size: 420000 },
    { x: 3500000, y: 2300000, size: 680000 },
    { x: 5000000, y: 3240000, size: 540000 },
    { x: 6160000, y: 2100000, size: 780000 },
    { x: 6700000, y: 3500000, size: 360000 },
  ]
  return [
    roundedRect(29, 900000, 1420000, 7500000, 2920000, template.card, 22000, template.cardLine),
    textBox(30, 1180000, 1620000, 1900000, 220000, "气泡矩阵", 1050, {
      color: template.title,
      bold: true,
      maxLines: 1,
    }),
    rect(31, 1500000, 3830000, 6100000, 45000, template.cardLine),
    rect(32, 1500000, 1980000, 45000, 1850000, template.cardLine),
    ...nodes.flatMap((node, index) => [
      circle(40 + index * 4, node.x, node.y, node.size, index % 2 === 0 ? template.accent : template.accent2, 65000),
      textBox(41 + index * 4, node.x - 130000, node.y + node.size + 60000, 900000, 170000, items[index] ?? "", 680, {
        color: template.text,
        maxLines: 1,
      }),
    ]),
  ]
}

function sankeyLayout(points: string[], template: PptVisualTemplate) {
  const items = padPoints(points, 6).slice(0, 6)
  return [
    roundedRect(29, 900000, 1420000, 7500000, 2920000, template.card, 22000, template.cardLine),
    textBox(30, 1180000, 1620000, 1900000, 220000, "桑基流向", 1050, {
      color: template.title,
      bold: true,
      maxLines: 1,
    }),
    ...items.slice(0, 3).flatMap((point, index) => [
      roundedRect(
        40 + index * 5,
        1280000,
        2050000 + index * 600000,
        1250000,
        360000,
        template.accentLight,
        16000,
        template.cardLine,
      ),
      textBox(41 + index * 5, 1440000, 2150000 + index * 600000, 880000, 140000, point, 700, {
        color: template.text,
        maxLines: 1,
      }),
      rightArrow(42 + index * 5, 2600000, 2140000 + index * 600000, 1500000, 150000 + index * 50000, template.accent),
    ]),
    roundedRect(70, 4300000, 2500000, 1350000, 520000, template.side, 18000),
    textBox(71, 4500000, 2680000, 900000, 160000, items[3] ?? "核心节点", 780, {
      color: template.coverTitle,
      bold: true,
      maxLines: 1,
    }),
    ...items.slice(4, 6).flatMap((point, index) => [
      rightArrow(80 + index * 5, 5700000, 2500000 + index * 520000, 1120000, 160000, template.accent2),
      roundedRect(
        81 + index * 5,
        6900000,
        2380000 + index * 620000,
        960000,
        360000,
        template.accentLight,
        16000,
        template.cardLine,
      ),
      textBox(82 + index * 5, 7040000, 2480000 + index * 620000, 680000, 140000, point, 680, {
        color: template.text,
        maxLines: 1,
      }),
    ]),
  ]
}

function treemapLayout(points: string[], template: PptVisualTemplate) {
  const items = padPoints(points, 6).slice(0, 6)
  const cells = [
    { x: 1280000, y: 1980000, cx: 2600000, cy: 1500000 },
    { x: 3980000, y: 1980000, cx: 1700000, cy: 720000 },
    { x: 5780000, y: 1980000, cx: 1800000, cy: 720000 },
    { x: 3980000, y: 2800000, cx: 1700000, cy: 680000 },
    { x: 5780000, y: 2800000, cx: 860000, cy: 680000 },
    { x: 6720000, y: 2800000, cx: 860000, cy: 680000 },
  ]
  return [
    roundedRect(29, 900000, 1420000, 7500000, 2920000, template.card, 22000, template.cardLine),
    textBox(30, 1180000, 1620000, 1900000, 220000, "面积树图", 1050, {
      color: template.title,
      bold: true,
      maxLines: 1,
    }),
    ...cells.flatMap((cell, index) => [
      roundedRect(
        40 + index * 4,
        cell.x,
        cell.y,
        cell.cx,
        cell.cy,
        index % 2 === 0 ? template.accent : template.accent2,
        10000,
      ),
      textBox(41 + index * 4, cell.x + 140000, cell.y + 150000, cell.cx - 280000, 180000, items[index] ?? "", 740, {
        color: template.coverTitle,
        bold: true,
        maxLines: 1,
      }),
    ]),
  ]
}

function financialLayout(points: string[], template: PptVisualTemplate) {
  const items = padPoints(points, 6).slice(0, 6)
  return [
    roundedRect(29, 900000, 1420000, 7500000, 2920000, template.card, 22000, template.cardLine),
    textBox(30, 1180000, 1620000, 1900000, 220000, "财务报表", 1050, {
      color: template.title,
      bold: true,
      maxLines: 1,
    }),
    rect(31, 1240000, 2020000, 6400000, 380000, template.side),
    ...["科目", "本期", "同比", "说明"].map((label, index) =>
      textBox(32 + index, 1440000 + index * 1550000, 2120000, 900000, 140000, label, 760, {
        color: template.coverTitle,
        bold: true,
        maxLines: 1,
      }),
    ),
    ...items.flatMap((point, row) => [
      rect(
        45 + row,
        1240000,
        2490000 + row * 310000,
        6400000,
        22000,
        row === items.length - 1 ? template.accent : template.cardLine,
      ),
      textBox(55 + row, 1440000, 2560000 + row * 310000, 2500000, 140000, point, 720, {
        color: row === items.length - 1 ? template.title : template.text,
        bold: row === items.length - 1,
        maxLines: 1,
      }),
      textBox(65 + row, 4600000, 2560000 + row * 310000, 900000, 140000, chartValueLabel(point), 720, {
        color: template.text,
        maxLines: 1,
      }),
    ]),
  ]
}

function teamRosterLayout(points: string[], template: PptVisualTemplate) {
  const items = padPoints(points, 6).slice(0, 6)
  return [
    roundedRect(29, 900000, 1420000, 7500000, 2920000, template.card, 22000, template.cardLine),
    textBox(30, 1180000, 1620000, 1900000, 220000, "团队名册", 1050, {
      color: template.title,
      bold: true,
      maxLines: 1,
    }),
    ...items.flatMap((point, index) => {
      const x = 1280000 + (index % 3) * 2150000
      const y = 1980000 + Math.floor(index / 3) * 1050000
      return [
        roundedRect(40 + index * 5, x, y, 1700000, 820000, template.card, 18000, template.cardLine),
        circle(
          41 + index * 5,
          x + 150000,
          y + 170000,
          360000,
          index % 2 === 0 ? template.accent : template.accent2,
          90000,
        ),
        textBox(42 + index * 5, x + 620000, y + 190000, 880000, 170000, point, 780, {
          color: template.title,
          bold: true,
          maxLines: 1,
        }),
        textBox(43 + index * 5, x + 620000, y + 430000, 860000, 160000, "角色 / 贡献", 680, {
          color: template.muted,
          maxLines: 1,
        }),
      ]
    }),
  ]
}

function matrixLabel(index: number) {
  return ["高价值", "机会区", "风险区", "行动区"][index] ?? "象限"
}

function splitLayout(points: string[], template: PptVisualTemplate) {
  const first = points[0] ?? "核心观点"
  const rest = padPoints(points.slice(1), 5)
  return [
    roundedRect(30, 900000, 1500000, 2850000, 2750000, template.side, 22000),
    textBox(34, 1180000, 1660000, 1800000, 220000, "核心结论", 900, {
      color: template.accentLight,
      bold: true,
      maxLines: 1,
    }),
    textBox(31, 1180000, 1900000, 2200000, 1100000, first, 2100, {
      color: template.coverTitle,
      bold: true,
      maxLines: 4,
    }),
    rect(32, 4100000, 1600000, 120000, 2550000, template.accent),
    roundedRect(35, 4450000, 1500000, 3300000, 2750000, template.card, 22000, template.cardLine),
    bulletTextBox(33, 4450000, 1680000, 3300000, 2250000, rest.join("\n"), 1350, template.text),
  ]
}

function highlightLayout(points: string[], template: PptVisualTemplate) {
  const first = points[0] ?? "关键结论"
  const rest = padPoints(points.slice(1), 5)
  return [
    roundedRect(30, 900000, 1500000, 7300000, 950000, template.side, 22000),
    circle(34, 7140000, 1690000, 460000, template.accent, 65000),
    textBox(31, 1250000, 1740000, 6400000, 420000, first, 1850, {
      color: template.coverTitle,
      bold: true,
      maxLines: 2,
    }),
    roundedRect(32, 900000, 2800000, 7300000, 1350000, template.card, 22000, template.cardLine),
    rect(35, 900000, 2800000, 7300000, 110000, template.accent),
    bulletTextBox(33, 1250000, 3060000, 6400000, 900000, rest.join("\n"), 1300, template.text),
  ]
}

function contentPoints(content: string) {
  return content
    .split("\n")
    .map((line) =>
      line
        .trim()
        .replace(/^[-*•]\s*/, "")
        .replace(/^#+\s*/, ""),
    )
    .filter((line) => line && !/^(主文案|正文|页面目标|核心观点|内容|content)[:：]\s*$/i.test(line))
    .slice(0, 8)
}

function padPoints(points: string[], count: number) {
  const fallback = ["核心目标", "关键动作", "风险控制", "交付结果", "下一步计划"]
  return Array.from({ length: count }, (_, index) => points[index] ?? fallback[index] ?? "补充说明")
}

function templateMotifDecor(template: PptVisualTemplate) {
  if (template.motif === "circuit")
    return [
      rect(80, 6810000, 1620000, 920000, 42000, template.accent),
      rect(81, 7270000, 1620000, 42000, 640000, template.accent),
      roundedRect(82, 7100000, 1460000, 260000, 260000, template.accent2, 65000),
      roundedRect(83, 7550000, 2140000, 210000, 210000, template.accentLight, 70000),
    ]
  if (template.motif === "executive")
    return [
      roundedRect(80, 6500000, 3200000, 560000, 420000, template.card, 16000, template.cardLine),
      roundedRect(81, 7160000, 3200000, 560000, 420000, template.card, 16000, template.cardLine),
      roundedRect(82, 7820000, 3200000, 560000, 420000, template.card, 16000, template.cardLine),
      rect(83, 6500000, 3770000, 1880000, 50000, template.accent),
    ]
  if (template.motif === "classroom")
    return [
      roundedRect(80, 6410000, 3060000, 1780000, 820000, template.side, 18000),
      rect(81, 6590000, 3740000, 1420000, 45000, template.accentLight),
      rect(82, 6670000, 3230000, 180000, 180000, template.accent),
      rect(83, 7000000, 3230000, 180000, 180000, template.accent2),
    ]
  if (template.motif === "minimal-line")
    return [
      rect(80, 6350000, 1880000, 1820000, 30000, template.side),
      rect(81, 7020000, 2150000, 910000, 22000, template.cardLine),
    ]
  if (template.motif === "roadmap")
    return [0, 1, 2].flatMap((item) => [
      roundedRect(
        80 + item * 2,
        6500000 + item * 680000,
        3260000 - item * 260000,
        240000,
        240000,
        item % 2 ? template.accent2 : template.accent,
        78000,
      ),
      rect(81 + item * 2, 6620000 + item * 680000, 3370000 - item * 260000, 560000, 36000, template.cardLine),
    ])
  if (template.motif === "spotlight")
    return [
      roundedRect(80, 6510000, 2450000, 1420000, 620000, template.accentLight, 26000),
      roundedRect(81, 6840000, 2780000, 760000, 320000, template.accent, 32000),
      roundedRect(82, 7060000, 3550000, 880000, 90000, template.accent2, 18000),
    ]
  if (template.motif === "ledger" || template.motif === "bank-ledger")
    return [0, 1, 2, 3].flatMap((item) => [
      rect(
        80 + item * 2,
        6500000,
        2860000 + item * 210000,
        1680000,
        38000,
        item % 2 ? template.cardLine : template.accentLight,
      ),
      rect(
        81 + item * 2,
        6500000,
        2920000 + item * 210000,
        520000 + item * 210000,
        28000,
        item % 2 ? template.accent2 : template.accent,
      ),
    ])
  if (template.motif === "paper" || template.motif === "university" || template.motif === "clinical")
    return [
      roundedRect(80, 6640000, 2540000, 1220000, 1460000, template.card, 16000, template.cardLine),
      rect(81, 6800000, 2810000, 880000, 36000, template.accent),
      rect(82, 6800000, 3030000, 620000, 26000, template.muted),
      rect(83, 6800000, 3220000, 760000, 26000, template.muted),
    ]
  if (template.motif === "collage")
    return [
      roundedRect(80, 6320000, 2620000, 720000, 720000, template.accent, 18000),
      roundedRect(81, 7000000, 2920000, 960000, 620000, template.accent2, 18000),
      roundedRect(82, 6640000, 3460000, 1080000, 480000, template.accentLight, 18000),
    ]
  if (template.motif === "seal" || template.motif === "policy-blue" || template.motif === "policy-red")
    return [
      circle(80, 6740000, 2600000, 1020000, template.accentLight, 30000),
      circle(81, 6900000, 2760000, 700000, template.accent, 18000),
      circle(82, 7100000, 2960000, 300000, template.accent2, 70000),
    ]
  if (template.motif === "dashboard" || template.motif === "ops-map")
    return [
      roundedRect(80, 6320000, 2520000, 1760000, 1120000, template.side, 18000),
      rect(81, 6520000, 3340000, 220000, 260000, template.accent),
      rect(82, 6860000, 3120000, 220000, 480000, template.accent2),
      rect(83, 7200000, 2900000, 220000, 700000, template.accent),
      rect(84, 7540000, 3220000, 220000, 380000, template.accentLight),
    ]
  if (template.motif === "story" || template.motif === "therapy")
    return [
      roundedRect(80, 6400000, 2780000, 1680000, 780000, template.accentLight, 22000),
      roundedRect(81, 6600000, 2980000, 260000, 260000, template.accent, 65000),
      roundedRect(82, 6960000, 3060000, 860000, 52000, template.accent2, 18000),
      roundedRect(83, 6960000, 3240000, 620000, 42000, template.cardLine, 18000),
    ]
  if (template.motif === "network")
    return [
      roundedRect(80, 6540000, 2920000, 240000, 240000, template.accent, 78000),
      roundedRect(81, 7150000, 2700000, 240000, 240000, template.accent2, 78000),
      roundedRect(82, 7700000, 3180000, 240000, 240000, template.accentLight, 78000),
      rect(83, 6660000, 3030000, 580000, 36000, template.cardLine),
      rect(84, 7270000, 2960000, 480000, 36000, template.cardLine),
    ]
  if (template.motif === "blueprint")
    return [0, 1, 2].flatMap((item) => [
      rect(80 + item * 2, 6360000 + item * 460000, 2680000, 26000, 1200000, template.cardLine),
      rect(81 + item * 2, 6360000, 2680000 + item * 330000, 1480000, 26000, template.cardLine),
    ])
  if (template.motif === "infrastructure")
    return [0, 1, 2, 3].map((item) =>
      rect(
        80 + item,
        6420000 + item * 360000,
        3440000 - item * 180000,
        240000,
        620000 + item * 180000,
        item % 2 ? template.accent2 : template.accent,
      ),
    )
  if (template.motif === "certification")
    return [
      roundedRect(80, 6620000, 2700000, 1280000, 940000, template.card, 16000, template.cardLine),
      roundedRect(81, 6960000, 2920000, 520000, 360000, template.accentLight, 70000),
      rect(82, 6800000, 3460000, 920000, 52000, template.accent),
    ]
  if (template.motif === "vehicle-track" || template.motif === "autotech")
    return [
      rect(80, 6360000, 3240000, 1760000, 52000, template.cardLine),
      roundedRect(81, 6560000, 3040000, 330000, 240000, template.accent, 70000),
      roundedRect(82, 7480000, 3040000, 330000, 240000, template.accent2, 70000),
      roundedRect(83, 6760000, 2860000, 720000, 260000, template.accentLight, 16000),
    ]
  if (template.motif === "pixel")
    return [0, 1, 2, 3, 4, 5].map((item) =>
      rect(
        80 + item,
        6420000 + (item % 3) * 260000,
        2860000 + Math.floor(item / 3) * 260000,
        220000,
        220000,
        item % 2 ? template.accent2 : template.accent,
      ),
    )
  return []
}

export type PptVisualTemplate = {
  coverBg: string
  coverBand: string
  coverTitle: string
  coverText: string
  pageBg: string
  side: string
  card: string
  cardLine: string
  title: string
  text: string
  muted: string
  accent: string
  accent2: string
  accentLight: string
  titleFont?: string
  bodyFont?: string
  latinFont?: string
  chromeStyle?: "sidebar" | "topbar" | "editorial" | "canvas" | "minimal" | "ribbon" | "hud" | "thesis"
  motif?: PptTemplateMotif
}

export type PptTemplateMotif =
  | "circuit"
  | "executive"
  | "classroom"
  | "minimal-line"
  | "roadmap"
  | "spotlight"
  | "ledger"
  | "paper"
  | "collage"
  | "seal"
  | "dashboard"
  | "story"
  | "network"
  | "blueprint"
  | "infrastructure"
  | "certification"
  | "vehicle-track"
  | "autotech"
  | "bank-ledger"
  | "university"
  | "ops-map"
  | "policy-blue"
  | "policy-red"
  | "clinical"
  | "pixel"
  | "therapy"

function pptTemplate(id: OfficePptTemplateID): PptVisualTemplate {
  return {
    ...pptTemplateColors(id),
    ...pptTemplateTypography(id),
    chromeStyle: pptTemplateChromeStyle(id),
    motif: pptTemplateMotif(id),
  }
}

function pptTemplateMotif(id: OfficePptTemplateID): PptTemplateMotif {
  if (id === "tech") return "circuit"
  if (id === "business") return "executive"
  if (id === "teaching") return "classroom"
  if (id === "minimal") return "minimal-line"
  if (id === "strategy") return "roadmap"
  if (id === "product") return "spotlight"
  if (id === "finance") return "ledger"
  if (id === "academic") return "paper"
  if (id === "creative") return "collage"
  if (id === "government") return "seal"
  if (id === "data") return "dashboard"
  if (id === "warm") return "story"
  if (id === "telecom") return "network"
  if (id === "powerchina-classic") return "blueprint"
  if (id === "powerchina-modern") return "infrastructure"
  if (id === "catarc-business") return "certification"
  if (id === "catarc-classic") return "vehicle-track"
  if (id === "catarc-modern") return "autotech"
  if (id === "cmb") return "bank-ledger"
  if (id === "cqu") return "university"
  if (id === "ai-ops") return "ops-map"
  if (id === "government-blue") return "policy-blue"
  if (id === "government-red") return "policy-red"
  if (id === "medical") return "clinical"
  if (id === "pixel") return "pixel"
  return "therapy"
}

function pptTemplateTypography(
  id: OfficePptTemplateID,
): Pick<PptVisualTemplate, "titleFont" | "bodyFont" | "latinFont"> {
  if (id === "cqu" || id === "academic")
    return { titleFont: "SimSun", bodyFont: "Microsoft YaHei", latinFont: "Georgia" }
  if (id === "telecom" || id === "cmb" || id === "government" || id === "government-blue" || id === "government-red")
    return { titleFont: "SimHei", bodyFont: "Microsoft YaHei", latinFont: "Segoe UI" }
  if (id === "powerchina-modern" || id === "catarc-modern" || id === "data" || id === "ai-ops")
    return { titleFont: "Microsoft YaHei", bodyFont: "Microsoft YaHei", latinFont: "Segoe UI" }
  if (id === "powerchina-classic" || id === "catarc-business" || id === "catarc-classic")
    return { titleFont: "Microsoft YaHei", bodyFont: "Microsoft YaHei", latinFont: "Arial" }
  if (id === "medical") return { titleFont: "Microsoft YaHei", bodyFont: "Microsoft YaHei", latinFont: "Calibri" }
  if (id === "pixel") return { titleFont: "Consolas", bodyFont: "Microsoft YaHei", latinFont: "Consolas" }
  if (id === "psychology") return { titleFont: "KaiTi", bodyFont: "Microsoft YaHei", latinFont: "Georgia" }
  if (id === "creative") return { titleFont: "Arial Black", bodyFont: "Microsoft YaHei", latinFont: "Arial Black" }
  if (id === "minimal") return { titleFont: "Arial", bodyFont: "Arial", latinFont: "Arial" }
  if (id === "warm") return { titleFont: "KaiTi", bodyFont: "Microsoft YaHei", latinFont: "Georgia" }
  if (id === "tech") return { titleFont: "Microsoft YaHei", bodyFont: "Microsoft YaHei", latinFont: "Segoe UI" }
  return { titleFont: "Microsoft YaHei", bodyFont: "Microsoft YaHei", latinFont: "Arial" }
}

function pptTemplateChromeStyle(id: OfficePptTemplateID): PptVisualTemplate["chromeStyle"] {
  if (id === "telecom" || id === "cmb" || id === "government" || id === "government-blue" || id === "government-red")
    return "ribbon"
  if (
    id === "tech" ||
    id === "data" ||
    id === "powerchina-modern" ||
    id === "catarc-modern" ||
    id === "ai-ops" ||
    id === "pixel"
  )
    return "hud"
  if (id === "academic" || id === "cqu" || id === "medical") return "thesis"
  if (id === "psychology") return "canvas"
  if (
    id === "business" ||
    id === "product" ||
    id === "strategy" ||
    id === "powerchina-classic" ||
    id === "catarc-classic"
  )
    return "topbar"
  if (id === "finance") return "editorial"
  if (id === "teaching" || id === "creative" || id === "warm") return "canvas"
  if (id === "minimal") return "minimal"
  return "sidebar"
}

function pptTemplateColors(id: OfficePptTemplateID): PptVisualTemplate {
  if (id === "ai-ops")
    return {
      coverBg: "07111F",
      coverBand: "0B1B33",
      coverTitle: "E0F2FE",
      coverText: "BAE6FD",
      pageBg: "F7F9FC",
      side: "0B1B33",
      card: "FFFFFF",
      cardLine: "BFDBFE",
      title: "0F172A",
      text: "1E293B",
      muted: "64748B",
      accent: "DC2626",
      accent2: "0EA5E9",
      accentLight: "DBEAFE",
    }
  if (id === "government-blue")
    return {
      coverBg: "002B5C",
      coverBand: "003B7A",
      coverTitle: "FFFFFF",
      coverText: "DBEAFE",
      pageBg: "F8FAFC",
      side: "003366",
      card: "FFFFFF",
      cardLine: "BFDBFE",
      title: "0F172A",
      text: "334155",
      muted: "64748B",
      accent: "0066CC",
      accent2: "CC0000",
      accentLight: "E0F2FE",
    }
  if (id === "government-red")
    return {
      coverBg: "7F1D1D",
      coverBand: "991B1B",
      coverTitle: "FFFFFF",
      coverText: "FEE2E2",
      pageBg: "FFFBF7",
      side: "7F1D1D",
      card: "FFFFFF",
      cardLine: "FECACA",
      title: "450A0A",
      text: "334155",
      muted: "64748B",
      accent: "DC2626",
      accent2: "F59E0B",
      accentLight: "FEE2E2",
    }
  if (id === "medical")
    return {
      coverBg: "EAF8FF",
      coverBand: "D1FAE5",
      coverTitle: "064E3B",
      coverText: "075985",
      pageBg: "F8FEFF",
      side: "075985",
      card: "FFFFFF",
      cardLine: "BAE6FD",
      title: "075985",
      text: "164E63",
      muted: "64748B",
      accent: "0EA5E9",
      accent2: "10B981",
      accentLight: "DFF7EF",
    }
  if (id === "pixel")
    return {
      coverBg: "111827",
      coverBand: "1F2937",
      coverTitle: "ECFCCB",
      coverText: "BBF7D0",
      pageBg: "111827",
      side: "020617",
      card: "1F2937",
      cardLine: "4ADE80",
      title: "ECFCCB",
      text: "D1FAE5",
      muted: "86EFAC",
      accent: "22C55E",
      accent2: "F472B6",
      accentLight: "064E3B",
    }
  if (id === "psychology")
    return {
      coverBg: "FFF7ED",
      coverBand: "FED7AA",
      coverTitle: "431407",
      coverText: "7C2D12",
      pageBg: "FFFBF3",
      side: "9A3412",
      card: "FFFFFF",
      cardLine: "FDBA74",
      title: "431407",
      text: "78350F",
      muted: "A16207",
      accent: "F97316",
      accent2: "14B8A6",
      accentLight: "FFEDD5",
    }
  if (id === "telecom")
    return {
      coverBg: "7F0000",
      coverBand: "C00000",
      coverTitle: "FFFFFF",
      coverText: "FEE2E2",
      pageBg: "FFF7F7",
      side: "C00000",
      card: "FFFFFF",
      cardLine: "FCA5A5",
      title: "7F0000",
      text: "334155",
      muted: "64748B",
      accent: "C00000",
      accent2: "2563EB",
      accentLight: "FEE2E2",
    }
  if (id === "powerchina-classic")
    return {
      coverBg: "002B5C",
      coverBand: "00418D",
      coverTitle: "FFFFFF",
      coverText: "DBEAFE",
      pageBg: "F3F7FC",
      side: "00418D",
      card: "FFFFFF",
      cardLine: "BFDBFE",
      title: "0B2545",
      text: "334155",
      muted: "64748B",
      accent: "00418D",
      accent2: "F59E0B",
      accentLight: "DBEAFE",
    }
  if (id === "powerchina-modern")
    return {
      coverBg: "001E42",
      coverBand: "00418D",
      coverTitle: "F8FAFC",
      coverText: "BAE6FD",
      pageBg: "EEF6FF",
      side: "00346F",
      card: "FFFFFF",
      cardLine: "7DD3FC",
      title: "0F172A",
      text: "1E293B",
      muted: "475569",
      accent: "0EA5E9",
      accent2: "00418D",
      accentLight: "CFFAFE",
    }
  if (id === "catarc-business")
    return {
      coverBg: "001F3F",
      coverBand: "003366",
      coverTitle: "FFFFFF",
      coverText: "DBEAFE",
      pageBg: "F8FAFC",
      side: "003366",
      card: "FFFFFF",
      cardLine: "CBD5E1",
      title: "0F172A",
      text: "334155",
      muted: "64748B",
      accent: "003366",
      accent2: "06B6D4",
      accentLight: "DBEAFE",
    }
  if (id === "catarc-classic")
    return {
      coverBg: "00316E",
      coverBand: "004098",
      coverTitle: "FFFFFF",
      coverText: "DBEAFE",
      pageBg: "F1F5F9",
      side: "004098",
      card: "FFFFFF",
      cardLine: "BFDBFE",
      title: "00316E",
      text: "334155",
      muted: "64748B",
      accent: "004098",
      accent2: "64748B",
      accentLight: "DBEAFE",
    }
  if (id === "catarc-modern")
    return {
      coverBg: "001529",
      coverBand: "0F172A",
      coverTitle: "E0F2FE",
      coverText: "BAE6FD",
      pageBg: "EEF6FF",
      side: "001529",
      card: "FFFFFF",
      cardLine: "7DD3FC",
      title: "001529",
      text: "1E293B",
      muted: "475569",
      accent: "38BDF8",
      accent2: "2563EB",
      accentLight: "CFFAFE",
    }
  if (id === "cmb")
    return {
      coverBg: "7F0B18",
      coverBand: "C8152D",
      coverTitle: "FFFFFF",
      coverText: "FEE2E2",
      pageBg: "FFF7F7",
      side: "C8152D",
      card: "FFFFFF",
      cardLine: "FCA5A5",
      title: "7F0B18",
      text: "334155",
      muted: "64748B",
      accent: "C8152D",
      accent2: "F59E0B",
      accentLight: "FEE2E2",
    }
  if (id === "cqu")
    return {
      coverBg: "004B8D",
      coverBand: "006BB7",
      coverTitle: "FFFFFF",
      coverText: "DBEAFE",
      pageBg: "F6FAFF",
      side: "006BB7",
      card: "FFFFFF",
      cardLine: "BFDBFE",
      title: "003A70",
      text: "334155",
      muted: "64748B",
      accent: "006BB7",
      accent2: "7C3AED",
      accentLight: "DBEAFE",
    }
  if (id === "strategy")
    return {
      coverBg: "0B1120",
      coverBand: "1E293B",
      coverTitle: "F8FAFC",
      coverText: "CBD5E1",
      pageBg: "F8FAFC",
      side: "1E293B",
      card: "FFFFFF",
      cardLine: "EAB308",
      title: "0F172A",
      text: "334155",
      muted: "64748B",
      accent: "EAB308",
      accent2: "2563EB",
      accentLight: "FEF3C7",
    }
  if (id === "product")
    return {
      coverBg: "1E1B4B",
      coverBand: "312E81",
      coverTitle: "FFFFFF",
      coverText: "DDD6FE",
      pageBg: "F5F3FF",
      side: "312E81",
      card: "FFFFFF",
      cardLine: "C4B5FD",
      title: "1E1B4B",
      text: "3730A3",
      muted: "6D28D9",
      accent: "8B5CF6",
      accent2: "06B6D4",
      accentLight: "EDE9FE",
    }
  if (id === "finance")
    return {
      coverBg: "052E16",
      coverBand: "14532D",
      coverTitle: "FFFBEB",
      coverText: "D9F99D",
      pageBg: "F7F8EF",
      side: "14532D",
      card: "FFFFFF",
      cardLine: "D6D3D1",
      title: "052E16",
      text: "1C1917",
      muted: "78716C",
      accent: "D97706",
      accent2: "16A34A",
      accentLight: "FEF3C7",
    }
  if (id === "academic")
    return {
      coverBg: "F8F5EF",
      coverBand: "E7E0D3",
      coverTitle: "1F2937",
      coverText: "4B5563",
      pageBg: "FFFBF3",
      side: "374151",
      card: "FFFFFF",
      cardLine: "D6D3D1",
      title: "1F2937",
      text: "374151",
      muted: "6B7280",
      accent: "7C3AED",
      accent2: "0EA5E9",
      accentLight: "EDE9FE",
    }
  if (id === "creative")
    return {
      coverBg: "2E1065",
      coverBand: "831843",
      coverTitle: "FFFFFF",
      coverText: "FCE7F3",
      pageBg: "FFF7ED",
      side: "9D174D",
      card: "FFFFFF",
      cardLine: "FDBA74",
      title: "431407",
      text: "7C2D12",
      muted: "9A3412",
      accent: "F97316",
      accent2: "EC4899",
      accentLight: "FED7AA",
    }
  if (id === "government")
    return {
      coverBg: "111827",
      coverBand: "7F1D1D",
      coverTitle: "FFFFFF",
      coverText: "FEE2E2",
      pageBg: "F8FAFC",
      side: "1E3A8A",
      card: "FFFFFF",
      cardLine: "CBD5E1",
      title: "111827",
      text: "334155",
      muted: "64748B",
      accent: "B91C1C",
      accent2: "1D4ED8",
      accentLight: "FEE2E2",
    }
  if (id === "data")
    return {
      coverBg: "020617",
      coverBand: "0F172A",
      coverTitle: "E0F2FE",
      coverText: "BAE6FD",
      pageBg: "EEF6FF",
      side: "0F172A",
      card: "FFFFFF",
      cardLine: "7DD3FC",
      title: "0F172A",
      text: "1E293B",
      muted: "475569",
      accent: "0EA5E9",
      accent2: "22D3EE",
      accentLight: "CFFAFE",
    }
  if (id === "warm")
    return {
      coverBg: "431407",
      coverBand: "7C2D12",
      coverTitle: "FFF7ED",
      coverText: "FED7AA",
      pageBg: "FFFBEB",
      side: "92400E",
      card: "FFFFFF",
      cardLine: "FDE68A",
      title: "431407",
      text: "78350F",
      muted: "A16207",
      accent: "F59E0B",
      accent2: "EF4444",
      accentLight: "FEF3C7",
    }
  if (id === "business")
    return {
      coverBg: "F8FAFC",
      coverBand: "E2E8F0",
      coverTitle: "0F172A",
      coverText: "475569",
      pageBg: "F8FAFC",
      side: "1E3A8A",
      card: "FFFFFF",
      cardLine: "CBD5E1",
      title: "0F172A",
      text: "334155",
      muted: "64748B",
      accent: "2563EB",
      accent2: "38BDF8",
      accentLight: "1D4ED8",
    }
  if (id === "teaching")
    return {
      coverBg: "ECFDF5",
      coverBand: "D1FAE5",
      coverTitle: "064E3B",
      coverText: "065F46",
      pageBg: "F7FEE7",
      side: "166534",
      card: "FFFFFF",
      cardLine: "BBF7D0",
      title: "14532D",
      text: "365314",
      muted: "4D7C0F",
      accent: "22C55E",
      accent2: "84CC16",
      accentLight: "047857",
    }
  if (id === "minimal")
    return {
      coverBg: "111111",
      coverBand: "262626",
      coverTitle: "FFFFFF",
      coverText: "D4D4D4",
      pageBg: "FFFFFF",
      side: "111111",
      card: "FFFFFF",
      cardLine: "111111",
      title: "111111",
      text: "262626",
      muted: "737373",
      accent: "111111",
      accent2: "A3A3A3",
      accentLight: "F5F5F5",
    }
  return {
    coverBg: "0F172A",
    coverBand: "111827",
    coverTitle: "FFFFFF",
    coverText: "CBD5E1",
    pageBg: "F8FAFC",
    side: "0F172A",
    card: "FFFFFF",
    cardLine: "E2E8F0",
    title: "0F172A",
    text: "334155",
    muted: "64748B",
    accent: "10B981",
    accent2: "38BDF8",
    accentLight: "99F6E4",
  }
}

function textBox(
  id: number,
  x: number,
  y: number,
  cx: number,
  cy: number,
  text: string,
  size: number,
  options?: { color?: string; bold?: boolean; maxLines?: number },
) {
  return [
    `<p:sp>`,
    `<p:nvSpPr><p:cNvPr id="${id}" name="Text ${id}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>`,
    `<p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>`,
    `<p:txBody><a:bodyPr wrap="square"/><a:lstStyle/>`,
    ...text
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, options?.maxLines ?? 12)
      .map((line) => textParagraph(line.replace(/^[-*]\s*/, ""), size, options)),
    `</p:txBody></p:sp>`,
  ].join("")
}

function bulletTextBox(
  id: number,
  x: number,
  y: number,
  cx: number,
  cy: number,
  text: string,
  size: number,
  color: string,
) {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 8)
  return [
    `<p:sp>`,
    `<p:nvSpPr><p:cNvPr id="${id}" name="Bullets ${id}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>`,
    `<p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>`,
    `<p:txBody><a:bodyPr wrap="square"/><a:lstStyle/>`,
    ...lines.map((line) => {
      const clean = line.replace(/^[-*]\s*/, "")
      return `<a:p><a:pPr marL="260000" indent="-180000"><a:buChar char="•"/></a:pPr><a:r><a:rPr sz="${size}" lang="zh-CN"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill></a:rPr><a:t>${xml(clean)}</a:t></a:r></a:p>`
    }),
    `</p:txBody></p:sp>`,
  ].join("")
}

function textParagraph(text: string, size: number, options?: { color?: string; bold?: boolean }) {
  return `<a:p><a:r><a:rPr sz="${size}"${options?.bold ? ' b="1"' : ""}>${options?.color ? `<a:solidFill><a:srgbClr val="${options.color}"/></a:solidFill>` : ""}</a:rPr><a:t>${xml(text)}</a:t></a:r></a:p>`
}

function rect(id: number, x: number, y: number, cx: number, cy: number, color: string) {
  return shape(id, "rect", x, y, cx, cy, color)
}

function roundedRect(
  id: number,
  x: number,
  y: number,
  cx: number,
  cy: number,
  color: string,
  alpha?: number,
  line?: string,
) {
  return shape(id, "roundRect", x, y, cx, cy, color, alpha, line)
}

function circle(id: number, x: number, y: number, size: number, color: string, alpha?: number) {
  return shape(id, "ellipse", x, y, size, size, color, alpha)
}

function rightArrow(id: number, x: number, y: number, cx: number, cy: number, color: string) {
  return shape(id, "rightArrow", x, y, cx, cy, color)
}

function shape(
  id: number,
  preset: "rect" | "roundRect" | "ellipse" | "rightArrow",
  x: number,
  y: number,
  cx: number,
  cy: number,
  color: string,
  alpha?: number,
  line?: string,
) {
  return [
    `<p:sp>`,
    `<p:nvSpPr><p:cNvPr id="${id}" name="Shape ${id}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>`,
    `<p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="${preset}"><a:avLst/></a:prstGeom>`,
    `<a:solidFill><a:srgbClr val="${color}">${alpha ? `<a:alpha val="${alpha}"/>` : ""}</a:srgbClr></a:solidFill>`,
    line ? `<a:ln w="9525"><a:solidFill><a:srgbClr val="${line}"/></a:solidFill></a:ln>` : `<a:ln><a:noFill/></a:ln>`,
    `</p:spPr></p:sp>`,
  ].join("")
}

function coreProps(title: string) {
  return [
    xmlHeader(),
    `<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">`,
    `<dc:title>${xml(title)}</dc:title>`,
    `<dc:creator>NovaWay</dc:creator>`,
    `<cp:lastModifiedBy>NovaWay</cp:lastModifiedBy>`,
    `<dcterms:created xsi:type="dcterms:W3CDTF">2026-01-01T00:00:00Z</dcterms:created>`,
    `<dcterms:modified xsi:type="dcterms:W3CDTF">2026-01-01T00:00:00Z</dcterms:modified>`,
    `</cp:coreProperties>`,
  ].join("")
}

function appProps(slideCount: number) {
  return [
    xmlHeader(),
    `<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">`,
    `<Application>NovaWay</Application>`,
    `<PresentationFormat>Wide</PresentationFormat>`,
    `<Slides>${slideCount}</Slides>`,
    `<Company>NovaWay</Company>`,
    `</Properties>`,
  ].join("")
}

function presentationXml(slideCount: number, masterRelID: string) {
  return [
    xmlHeader(),
    `<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">`,
    `<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="${masterRelID}"/></p:sldMasterIdLst>`,
    `<p:sldIdLst>`,
    ...Array.from({ length: slideCount }, (_, index) => `<p:sldId id="${256 + index}" r:id="rId${index + 1}"/>`),
    `</p:sldIdLst>`,
    `<p:sldSz cx="9144000" cy="5143500" type="screen16x9"/>`,
    `<p:notesSz cx="6858000" cy="9144000"/>`,
    `</p:presentation>`,
  ].join("")
}

function themeXml(template: PptVisualTemplate) {
  const titleFont = xml(template.titleFont ?? "Microsoft YaHei")
  const bodyFont = xml(template.bodyFont ?? "Microsoft YaHei")
  const latinFont = xml(template.latinFont ?? "Arial")
  return [
    xmlHeader(),
    `<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="NovaWay">`,
    `<a:themeElements>`,
    `<a:clrScheme name="NovaWay"><a:dk1><a:srgbClr val="${template.title}"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="${template.side}"/></a:dk2><a:lt2><a:srgbClr val="${template.pageBg}"/></a:lt2><a:accent1><a:srgbClr val="${template.accent}"/></a:accent1><a:accent2><a:srgbClr val="${template.accent2}"/></a:accent2><a:accent3><a:srgbClr val="6366F1"/></a:accent3><a:accent4><a:srgbClr val="F59E0B"/></a:accent4><a:accent5><a:srgbClr val="EF4444"/></a:accent5><a:accent6><a:srgbClr val="14B8A6"/></a:accent6><a:hlink><a:srgbClr val="${template.accent}"/></a:hlink><a:folHlink><a:srgbClr val="${template.accent2}"/></a:folHlink></a:clrScheme>`,
    `<a:fontScheme name="NovaWay"><a:majorFont><a:latin typeface="${latinFont}"/><a:ea typeface="${titleFont}"/><a:cs typeface="${latinFont}"/></a:majorFont><a:minorFont><a:latin typeface="${latinFont}"/><a:ea typeface="${bodyFont}"/><a:cs typeface="${latinFont}"/></a:minorFont></a:fontScheme>`,
    `<a:fmtScheme name="NovaWay"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme>`,
    `</a:themeElements>`,
    `</a:theme>`,
  ].join("")
}

function slideMasterRels() {
  return [
    xmlHeader(),
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`,
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>`,
    `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/>`,
    `</Relationships>`,
  ].join("")
}

function slideMasterXml() {
  return [
    xmlHeader(),
    `<p:sldMaster xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">`,
    `<p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:effectLst/></p:bgPr></p:bg><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld>`,
    `<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>`,
    `<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>`,
    `<p:txStyles><p:titleStyle/><p:bodyStyle/><p:otherStyle/></p:txStyles>`,
    `</p:sldMaster>`,
  ].join("")
}

function slideLayoutRels() {
  return [
    xmlHeader(),
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`,
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/>`,
    `</Relationships>`,
  ].join("")
}

function slideLayoutXml() {
  return [
    xmlHeader(),
    `<p:sldLayout xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" type="blank" preserve="1">`,
    `<p:cSld name="Blank"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld>`,
    `<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>`,
    `</p:sldLayout>`,
  ].join("")
}

function notesMasterRels() {
  return [
    xmlHeader(),
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`,
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/>`,
    `</Relationships>`,
  ].join("")
}

function notesMasterXml() {
  return [
    xmlHeader(),
    `<p:notesMaster xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">`,
    `<p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:effectLst/></p:bgPr></p:bg><p:spTree>`,
    `<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>`,
    `<p:sp><p:nvSpPr><p:cNvPr id="2" name="Slide Image Placeholder"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="sldImg" idx="1"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="685800" y="457200"/><a:ext cx="5486400" cy="3086100"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln><a:noFill/></a:ln></p:spPr></p:sp>`,
    `<p:sp><p:nvSpPr><p:cNvPr id="3" name="Notes Placeholder"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" idx="2"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="685800" y="3962400"/><a:ext cx="5486400" cy="4114800"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln><a:noFill/></a:ln></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="zh-CN"/></a:p></p:txBody></p:sp>`,
    `</p:spTree></p:cSld>`,
    `<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>`,
    `<p:txStyles><p:titleStyle/><p:bodyStyle/><p:otherStyle/></p:txStyles>`,
    `</p:notesMaster>`,
  ].join("")
}

function notesSlideRels(index: number) {
  return [
    xmlHeader(),
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`,
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="../slides/slide${index}.xml"/>`,
    `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesMaster" Target="../notesMasters/notesMaster1.xml"/>`,
    `</Relationships>`,
  ].join("")
}

function notesSlideXml(slide: OfficeSlide) {
  return [
    xmlHeader(),
    `<p:notes xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">`,
    `<p:cSld><p:spTree>`,
    `<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>`,
    `<p:sp><p:nvSpPr><p:cNvPr id="2" name="Slide Image Placeholder"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="sldImg" idx="1"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="685800" y="457200"/><a:ext cx="5486400" cy="3086100"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln><a:noFill/></a:ln></p:spPr></p:sp>`,
    `<p:sp><p:nvSpPr><p:cNvPr id="3" name="Notes Placeholder"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" idx="2"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="685800" y="3962400"/><a:ext cx="5486400" cy="4114800"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln><a:noFill/></a:ln></p:spPr><p:txBody><a:bodyPr wrap="square"/><a:lstStyle/>${notesParagraphs(slide.notes ?? "")}</p:txBody></p:sp>`,
    `</p:spTree></p:cSld>`,
    `<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>`,
    `</p:notes>`,
  ].join("")
}

function notesParagraphs(notes: string) {
  const lines = notes
    .split("\n")
    .map((line) => line.trim().replace(/^[-*]\s*/, ""))
    .filter(Boolean)
  if (lines.length === 0) return `<a:p><a:endParaRPr lang="zh-CN"/></a:p>`
  return lines
    .slice(0, 12)
    .map(
      (line) =>
        `<a:p><a:r><a:rPr sz="1400" lang="zh-CN"><a:solidFill><a:srgbClr val="334155"/></a:solidFill></a:rPr><a:t>${xml(line)}</a:t></a:r></a:p>`,
    )
    .join("")
}

function replaceExtension(filename: string, ext: string) {
  return `${filename.replace(/\.[^.]+$/, "")}.${ext}`
}

function file(path: string, content: string | Uint8Array): ZipEntry {
  return { path, data: typeof content === "string" ? encoder.encode(content) : content }
}

function xmlHeader() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
}

function xml(input: string) {
  return input.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}

function zip(entries: ZipEntry[]) {
  const localParts: Uint8Array[] = []
  const centralParts: Uint8Array[] = []
  let offset = 0

  for (const entry of entries) {
    const name = encoder.encode(entry.path)
    const crc = crc32(entry.data)
    const local = concat([
      u32(0x04034b50),
      u16(20),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(entry.data.length),
      u32(entry.data.length),
      u16(name.length),
      u16(0),
      name,
      entry.data,
    ])
    localParts.push(local)
    centralParts.push(
      concat([
        u32(0x02014b50),
        u16(20),
        u16(20),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(crc),
        u32(entry.data.length),
        u32(entry.data.length),
        u16(name.length),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(0),
        u32(offset),
        name,
      ]),
    )
    offset += local.length
  }

  const central = concat(centralParts)
  return concat([
    ...localParts,
    central,
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(entries.length),
    u16(entries.length),
    u32(central.length),
    u32(offset),
    u16(0),
  ])
}

function concat(parts: Uint8Array[]) {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.length, 0))
  let offset = 0
  for (const part of parts) {
    result.set(part, offset)
    offset += part.length
  }
  return result
}

function u16(value: number) {
  const data = new Uint8Array(2)
  new DataView(data.buffer).setUint16(0, value, true)
  return data
}

function u32(value: number) {
  const data = new Uint8Array(4)
  new DataView(data.buffer).setUint32(0, value >>> 0, true)
  return data
}

function crc32(data: Uint8Array) {
  let crc = 0xffffffff
  for (const byte of data) {
    crc ^= byte
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
  }
  return (crc ^ 0xffffffff) >>> 0
}
