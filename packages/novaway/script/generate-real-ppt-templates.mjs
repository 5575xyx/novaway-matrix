import { mkdir, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import PptxGenJS from "pptxgenjs"

const scriptDir = resolve(import.meta.dirname)
const repoRoot = resolve(scriptDir, "../../..")
const outputRoot = resolve(repoRoot, "packages/app/public/assets/office-ppt-templates/pptx")
const ShapeType = {
  ellipse: "ellipse",
  line: "line",
  rect: "rect",
  roundRect: "roundRect",
  triangle: "triangle",
}

const templates = [
  {
    id: "swiss-grid",
    name: "Swiss Grid 瑞士网格",
    description: "严格模块化网格、红黑强调和大量留白，适合设计、战略与作品集汇报。",
    font: "Arial",
    palette: { bg: "F5F4F0", page: "FFFFFF", ink: "111111", red: "E63312", blue: "1954A6", gray: "9A9892" },
    layout: { cover: "split", overview: "agenda", content: "split", cards: "grid", data: "table", closing: "centered" },
  },
  {
    id: "brutalist",
    name: "Brutalist 粗野报纸",
    description: "高对比黑白、粗边框、报刊式标题和醒目贴纸，适合创意发布与年度回顾。",
    font: "Arial Black",
    palette: { bg: "111111", page: "F2EFE7", ink: "111111", red: "D7261D", blue: "1B3B6F", gray: "6F6C63" },
    layout: {
      cover: "newspaper",
      overview: "list",
      content: "columns",
      cards: "sticky",
      data: "table",
      closing: "quote",
    },
  },
  {
    id: "glassmorphism",
    name: "Glassmorphism 玻璃拟态",
    description: "深紫蓝渐变底、半透明圆角面板和青色光点，适合产品发布与 AI 技术汇报。",
    font: "Segoe UI",
    palette: {
      bg: "0A0E27",
      page: "131A45",
      ink: "E8ECFF",
      cyan: "3DDDFC",
      violet: "A26BFA",
      blue: "5B8DEF",
      gray: "A8B0D0",
    },
    layout: {
      cover: "centered",
      overview: "roadmap",
      content: "diagram",
      cards: "kpi",
      data: "dashboard",
      closing: "cta",
    },
  },
  {
    id: "data-dashboard",
    name: "Data Dashboard 数据驾驶舱",
    description: "深色驾驶舱、KPI 卡片、数据表和趋势条，适合经营分析、财报和增长复盘。",
    font: "Segoe UI",
    palette: {
      bg: "07111F",
      page: "0C1B31",
      ink: "EAF4FF",
      cyan: "25D6F0",
      green: "35D07F",
      amber: "FFB74D",
      gray: "7C96B5",
    },
    layout: { cover: "full", overview: "timeline", content: "split", cards: "kpi", data: "dashboard", closing: "cta" },
  },
  {
    id: "editorial-magazine",
    name: "Editorial 杂志叙事",
    description: "米色纸感、衬线标题、垂直分栏和章节刊头，适合品牌故事、内容报告和案例研究。",
    font: "Georgia",
    palette: { bg: "F3EBDC", page: "FFF9EE", ink: "1D1B16", red: "B44B2D", blue: "2D5D7B", gray: "8F8573" },
    layout: {
      cover: "magazine",
      overview: "toc",
      content: "columns",
      cards: "gallery",
      data: "chart",
      closing: "signature",
    },
  },
  {
    id: "memphis-pop",
    name: "Memphis 孟菲斯波普",
    description: "大胆原色、几何拼贴和俏皮构图，适合活动策划、教育分享和创意提案。",
    font: "Trebuchet MS",
    palette: {
      bg: "F5D547",
      page: "FFF7D6",
      ink: "20232A",
      red: "E4572E",
      blue: "2E86DE",
      green: "2A9D8F",
      gray: "767B88",
    },
    layout: {
      cover: "full",
      overview: "roadmap",
      content: "columns",
      cards: "sticky",
      data: "chart",
      closing: "quote",
    },
  },
  {
    id: "risograph-zine",
    name: "Risograph 印刷小志",
    description: "米白纸面、双色印刷感和手工错位排版，适合独立项目、书店文化和创意期刊。",
    font: "Trebuchet MS",
    palette: { bg: "F3EAD3", page: "FAF3E1", ink: "22252A", red: "E4572E", blue: "3B5BA5", gray: "9A927C" },
    layout: {
      cover: "centered",
      overview: "toc",
      content: "columns",
      cards: "gallery",
      data: "table",
      closing: "signature",
    },
  },
  {
    id: "architecture",
    name: "Architecture 建筑档案",
    description: "中性石材色、细线网格和大画幅照片感构图，适合建筑、设计、文旅和空间项目。",
    font: "Segoe UI",
    palette: { bg: "E8E5DE", page: "F7F5F0", ink: "242322", taupe: "8B8175", blue: "2F4858", gray: "B7B1A6" },
    layout: {
      cover: "split",
      overview: "map",
      content: "caseStudy",
      cards: "gallery",
      data: "research",
      closing: "centered",
    },
  },
  {
    id: "botanical",
    name: "Botanical 自然植物",
    description: "鼠尾草绿、陶土橙和有机圆角，适合乡村振兴、文旅、ESG 与生活方式内容。",
    font: "Georgia",
    palette: { bg: "DDE8D8", page: "F4F6ED", ink: "26312B", green: "4F7C64", terracotta: "C86B4D", gray: "879184" },
    layout: {
      cover: "organic",
      overview: "map",
      content: "columns",
      cards: "gallery",
      data: "chart",
      closing: "signature",
    },
  },
  {
    id: "finance",
    name: "Finance 金融数据",
    description: "深蓝与墨绿、严谨表格和稳定面板，适合投资、财务、银行与经营汇报。",
    font: "Arial",
    palette: {
      bg: "0D2033",
      page: "122A44",
      ink: "F2F7FB",
      green: "2FBF8F",
      cyan: "56C1FF",
      amber: "F4B942",
      gray: "8EA4BC",
    },
    layout: {
      cover: "split",
      overview: "agenda",
      content: "table",
      cards: "kpi",
      data: "financial",
      closing: "centered",
    },
  },
  {
    id: "tech-blueprint",
    name: "Tech Blueprint 技术蓝图",
    description: "深蓝图纸、细网格和工程标注，适合技术方案、产品架构与研发里程碑。",
    font: "Consolas",
    palette: {
      bg: "0A1B33",
      page: "0F2747",
      ink: "EAF6FF",
      cyan: "4DD7FE",
      blue: "6CA9FF",
      amber: "FFC857",
      gray: "7FA0C6",
    },
    layout: {
      cover: "blueprint",
      overview: "roadmap",
      content: "diagram",
      cards: "milestones",
      data: "blueprint",
      closing: "terminal",
    },
  },
  {
    id: "ai-ops",
    name: "AI Ops 智能运维",
    description: "深空灰、青绿链路节点和自动化流程，适合基础设施、AI Agent 和数字化转型。",
    font: "Segoe UI",
    palette: {
      bg: "0B1117",
      page: "111B25",
      ink: "E9F4F5",
      cyan: "36D6C7",
      green: "9FE870",
      orange: "FFAD5C",
      gray: "7F95A6",
    },
    layout: {
      cover: "full",
      overview: "flow",
      content: "diagram",
      cards: "incidents",
      data: "dashboard",
      closing: "cta",
    },
  },
  {
    id: "minimal-luxury",
    name: "Minimal Luxury 极简轻奢",
    description: "暖白、黑金与大量留白，适合品牌发布、高端路演和年度战略。",
    font: "Segoe UI",
    palette: { bg: "F2EEE7", page: "FBF8F2", ink: "171512", gold: "B9975B", black: "181816", gray: "A9A197" },
    layout: {
      cover: "minimal",
      overview: "agenda",
      content: "split",
      cards: "products",
      data: "metrics",
      closing: "centered",
    },
  },
  {
    id: "academic",
    name: "Academic 学术答辩",
    description: "正式蓝白、衬线标题和论文式结构，适合学位答辩、科研汇报和学术交流。",
    font: "Times New Roman",
    palette: { bg: "EEF2F7", page: "FFFFFF", ink: "17233A", blue: "1F4E8C", red: "9E2A2B", gray: "6F7D92" },
    layout: {
      cover: "centered",
      overview: "agenda",
      content: "caseStudy",
      cards: "evidence",
      data: "research",
      closing: "centered",
    },
  },
  {
    id: "government",
    name: "Government 政务汇报",
    description: "庄重蓝红、简洁标题栏和规范信息层级，适合政务、党建和公共项目汇报。",
    font: "Microsoft YaHei",
    palette: { bg: "E8EEF5", page: "F8FAFC", ink: "14213D", blue: "244C86", red: "B42318", gray: "71809A" },
    layout: {
      cover: "official",
      overview: "agenda",
      content: "policy",
      cards: "achievements",
      data: "metrics",
      closing: "official",
    },
  },
  {
    id: "startup-pitch",
    name: "Startup Pitch 融资路演",
    description: "珊瑚蓝撞色、大字号主张和分栏故事线，适合创业融资、产品发布与增长提案。",
    font: "Segoe UI",
    palette: { bg: "FF5C61", page: "FFF7F5", ink: "1D2430", blue: "2057D6", yellow: "FFD166", gray: "7D879C" },
    layout: {
      cover: "full",
      overview: "problem",
      content: "split",
      cards: "comparison",
      data: "metrics",
      closing: "cta",
    },
  },
  {
    id: "medical",
    name: "Medical 医学学术",
    description: "清爽青白、圆角卡片和数据表格，适合病例讨论、医学培训和科研课题。",
    font: "Segoe UI",
    palette: { bg: "DCEFED", page: "F6FBFA", ink: "123A3A", teal: "0F8C8C", blue: "3579C9", gray: "78A3A0" },
    layout: {
      cover: "centered",
      overview: "agenda",
      content: "caseStudy",
      cards: "treatment",
      data: "metrics",
      closing: "centered",
    },
  },
  {
    id: "engineering",
    name: "Engineering 工程交付",
    description: "工程橙与冷灰、节点图和进度面板，适合基建、工程项目与实施汇报。",
    font: "Segoe UI",
    palette: { bg: "E9E8E4", page: "F6F5F1", ink: "24262B", orange: "F26B38", blue: "2F5D8A", gray: "8D918D" },
    layout: {
      cover: "project",
      overview: "milestones",
      content: "process",
      cards: "progress",
      data: "financial",
      closing: "cta",
    },
  },
  {
    id: "education",
    name: "Education 教学课件",
    description: "明快黄蓝、圆润卡片和清晰步骤，适合培训、课程、科普和校园分享。",
    font: "Microsoft YaHei",
    palette: { bg: "FFD166", page: "FFF9EA", ink: "263238", blue: "2D7DD2", green: "3BB273", gray: "7F8C8D" },
    layout: {
      cover: "organic",
      overview: "roadmap",
      content: "lesson",
      cards: "exercises",
      data: "metrics",
      closing: "next",
    },
  },
  {
    id: "retro-terminal",
    name: "Retro Terminal 复古终端",
    description: "深黑、荧光绿和等宽字体，适合开发者大会、黑客马拉松和技术分享。",
    font: "Consolas",
    palette: { bg: "07150D", page: "102B1A", ink: "C8F7C5", green: "51F18F", cyan: "4DD7FE", gray: "69A87A" },
    layout: {
      cover: "terminal",
      overview: "commands",
      content: "code",
      cards: "issues",
      data: "logs",
      closing: "terminal",
    },
  },
]

const W = 10
const H = 5.625

function accentOf(spec) {
  return (
    spec.palette.red ??
    spec.palette.blue ??
    spec.palette.green ??
    spec.palette.cyan ??
    spec.palette.orange ??
    spec.palette.terracotta ??
    spec.palette.gold ??
    spec.palette.black
  )
}

function accent2Of(spec) {
  return (
    spec.palette.blue ??
    spec.palette.green ??
    spec.palette.cyan ??
    spec.palette.orange ??
    spec.palette.terracotta ??
    spec.palette.gold ??
    spec.palette.ink
  )
}

function buildPptx(spec) {
  const pptx = new PptxGenJS()
  pptx.defineLayout({ name: "NOVAWAY", width: W, height: H })
  pptx.layout = "NOVAWAY"
  pptx.author = "NovaWay"
  pptx.company = "NovaWay"
  pptx.title = spec.name
  pptx.subject = spec.description

  const roles = [
    { role: "cover", title: "标题标题标题", body: "把核心结论写成一句话，让读者一眼看到这次汇报的价值。" },
    { role: "overview", title: "目录与主线", body: "- 核心背景\n- 目标与方法\n- 关键发现\n- 行动建议" },
    {
      role: "content",
      title: "核心内容",
      body: "- 关键观点一：先讲结论，再给支撑。\n- 关键观点二：用数据说明变化和差距。\n- 关键观点三：给出下一步可执行动作。",
    },
    {
      role: "cards",
      title: "要点卡片",
      body: "- 现状：用一句量化现状。\n- 路径：说明推进节奏。\n- 结果：突出可验收成果。",
    },
    {
      role: "data",
      title: "数据与证据",
      body: "- 营收：1.28 亿 → 1.64 亿\n- 活跃用户：82 万 → 106 万\n- 转化率：3.6% → 4.4%",
    },
    { role: "closing", title: "谢谢", body: "把关键结论和下一步行动再强调一次。" },
  ]

  roles.forEach((item, index) => {
    renderPage(pptx, spec, item.role, index + 1, roles.length, item)
  })
  return pptx
}

function renderPage(pptx, spec, role, page, total, content) {
  const slide = pptx.addSlide()
  const background = role === "data" || role === "closing" ? spec.palette.bg : spec.palette.page
  slide.background = { color: background }

  switch (role) {
    case "cover":
      renderCover(slide, spec, content, page, total)
      break
    case "overview":
      renderOverview(slide, spec, content, page, total)
      break
    case "content":
      renderContent(slide, spec, content, page, total)
      break
    case "cards":
      renderCards(slide, spec, content, page, total)
      break
    case "data":
      renderData(slide, spec, content, page, total)
      break
    case "closing":
      renderClosing(slide, spec, content, page, total)
      break
  }
}

function renderCover(slide, spec, content, page, total) {
  switch (spec.layout.cover) {
    case "split":
      coverSplit(slide, spec, content, page, total)
      break
    case "newspaper":
      coverNewspaper(slide, spec, content, page, total)
      break
    case "centered":
      coverCentered(slide, spec, content, page, total)
      break
    case "full":
      coverFull(slide, spec, content, page, total)
      break
    case "magazine":
      coverMagazine(slide, spec, content, page, total)
      break
    case "organic":
      coverOrganic(slide, spec, content, page, total)
      break
    case "blueprint":
      coverBlueprint(slide, spec, content, page, total)
      break
    case "minimal":
      coverMinimal(slide, spec, content, page, total)
      break
    case "official":
      coverOfficial(slide, spec, content, page, total)
      break
    case "project":
      coverProject(slide, spec, content, page, total)
      break
    case "terminal":
      coverTerminal(slide, spec, content, page, total)
      break
    default:
      coverSplit(slide, spec, content, page, total)
  }
}

function coverSplit(slide, spec, content) {
  const accent = accentOf(spec)
  slide.addShape(ShapeType.rect, { x: 0, y: 0, w: 5.5, h: H, fill: { color: spec.palette.bg } })
  slide.addShape(ShapeType.rect, { x: 0, y: 0, w: 5.5, h: 0.16, fill: { color: accent } })
  slide.addText(spec.name, {
    x: 0.7,
    y: 0.65,
    w: 4.2,
    h: 0.4,
    fontSize: 12,
    fontFace: spec.font,
    color: spec.palette.gray,
    bold: true,
  })
  slide.addText(content.title, {
    x: 0.7,
    y: 2.0,
    w: 4.4,
    h: 1.55,
    fontSize: 34,
    fontFace: spec.font,
    color: spec.palette.ink,
    bold: true,
  })
  slide.addText(content.body, {
    x: 0.75,
    y: 3.7,
    w: 4.0,
    h: 1.0,
    fontSize: 14,
    fontFace: spec.font,
    color: spec.palette.gray,
  })
  slide.addShape(ShapeType.rect, { x: 6.2, y: 0.7, w: 3.0, h: 0.08, fill: { color: accent } })
  slide.addShape(ShapeType.rect, { x: 6.2, y: 1.0, w: 2.0, h: 0.08, fill: { color: accent2Of(spec) } })
  slide.addShape(ShapeType.rect, {
    x: 6.3,
    y: 1.6,
    w: 2.9,
    h: 3.3,
    fill: { color: spec.palette.page },
    line: { color: spec.palette.gray, width: 1 },
  })
  slide.addText("NovaWay / 真实模板", {
    x: 6.65,
    y: 1.9,
    w: 2.2,
    h: 0.5,
    fontSize: 12,
    fontFace: spec.font,
    color: spec.palette.gray,
  })
  slide.addText("01", { x: 6.65, y: 2.7, w: 2.2, h: 1.2, fontSize: 42, fontFace: spec.font, color: accent, bold: true })
  slide.addText("原生可编辑 PPTX", {
    x: 6.65,
    y: 3.9,
    w: 2.2,
    h: 0.5,
    fontSize: 13,
    fontFace: spec.font,
    color: spec.palette.ink,
  })
}

function coverNewspaper(slide, spec, content) {
  const accent = accentOf(spec)
  slide.addShape(ShapeType.rect, { x: 0, y: 0, w: W, h: 0.18, fill: { color: accent } })
  slide.addText(spec.name.toUpperCase(), {
    x: 0.55,
    y: 0.38,
    w: 8.9,
    h: 0.4,
    fontSize: 13,
    fontFace: spec.font,
    color: spec.palette.ink,
    bold: true,
    charSpacing: 3,
  })
  slide.addText(content.title, {
    x: 0.55,
    y: 1.25,
    w: 8.9,
    h: 1.3,
    fontSize: 44,
    fontFace: spec.font,
    color: spec.palette.ink,
    bold: true,
  })
  slide.addShape(ShapeType.rect, { x: 0.55, y: 2.72, w: 8.9, h: 0.12, fill: { color: spec.palette.ink } })
  slide.addText(content.body, {
    x: 0.6,
    y: 3.05,
    w: 6.4,
    h: 1.0,
    fontSize: 17,
    fontFace: spec.font,
    color: spec.palette.ink,
  })
  slide.addShape(ShapeType.rect, {
    x: 7.65,
    y: 1.15,
    w: 1.8,
    h: 1.8,
    rotate: 4,
    fill: { color: accent },
    line: { color: spec.palette.ink, width: 2 },
  })
  slide.addText("VOL.20", {
    x: 7.9,
    y: 1.75,
    w: 1.3,
    h: 0.5,
    fontSize: 16,
    fontFace: spec.font,
    color: spec.palette.page,
    bold: true,
    align: "center",
  })
}

function coverCentered(slide, spec, content) {
  const accent = accentOf(spec)
  slide.addShape(ShapeType.roundRect, {
    x: 1.2,
    y: 1.0,
    w: 7.6,
    h: 3.6,
    rectRadius: 0.08,
    fill: { color: spec.palette.page, transparency: 26 },
    line: { color: accent, width: 1 },
  })
  slide.addText(spec.name, {
    x: 1.7,
    y: 1.55,
    w: 6.6,
    h: 0.5,
    fontSize: 13,
    fontFace: spec.font,
    color: accent,
    bold: true,
    align: "center",
  })
  slide.addText(content.title, {
    x: 1.55,
    y: 2.12,
    w: 6.9,
    h: 1.2,
    fontSize: 38,
    fontFace: spec.font,
    color: spec.palette.ink,
    bold: true,
    align: "center",
  })
  slide.addText(content.body, {
    x: 2.1,
    y: 3.35,
    w: 5.8,
    h: 0.8,
    fontSize: 14,
    fontFace: spec.font,
    color: spec.palette.gray,
    align: "center",
  })
  slide.addShape(ShapeType.ellipse, { x: 8.15, y: 0.45, w: 0.7, h: 0.7, fill: { color: accent, transparency: 40 } })
  slide.addShape(ShapeType.ellipse, {
    x: 0.95,
    y: 4.45,
    w: 0.55,
    h: 0.55,
    fill: { color: accent2Of(spec), transparency: 44 },
  })
}

function coverFull(slide, spec, content) {
  const accent = accentOf(spec)
  slide.addShape(ShapeType.rect, { x: 0, y: 0, w: W, h: H, fill: { color: spec.palette.bg } })
  slide.addShape(ShapeType.ellipse, { x: 7.4, y: -1.1, w: 4.2, h: 4.2, fill: { color: accent, transparency: 62 } })
  slide.addShape(ShapeType.ellipse, {
    x: -0.9,
    y: 3.2,
    w: 3.5,
    h: 3.5,
    fill: { color: accent2Of(spec), transparency: 68 },
  })
  slide.addText(spec.name.toUpperCase(), {
    x: 0.7,
    y: 0.5,
    w: 5.0,
    h: 0.4,
    fontSize: 12,
    fontFace: spec.font,
    color: spec.palette.gray,
    bold: true,
    charSpacing: 2,
  })
  slide.addText(content.title, {
    x: 0.7,
    y: 2.1,
    w: 7.2,
    h: 1.5,
    fontSize: 42,
    fontFace: spec.font,
    color: spec.palette.ink,
    bold: true,
  })
  slide.addText(content.body, {
    x: 0.75,
    y: 3.8,
    w: 5.6,
    h: 0.9,
    fontSize: 16,
    fontFace: spec.font,
    color: spec.palette.gray,
  })
  slide.addShape(ShapeType.rect, { x: 0.75, y: 4.75, w: 1.0, h: 0.1, fill: { color: accent } })
}

function coverMagazine(slide, spec, content) {
  const accent = accentOf(spec)
  slide.addShape(ShapeType.rect, { x: 0, y: 0, w: W, h: 0.18, fill: { color: spec.palette.ink } })
  slide.addText("NOVAWAY MAGAZINE", {
    x: 0.6,
    y: 0.42,
    w: 5.0,
    h: 0.4,
    fontSize: 11,
    fontFace: spec.font,
    color: spec.palette.gray,
    bold: true,
  })
  slide.addText(content.title, {
    x: 0.65,
    y: 1.65,
    w: 5.8,
    h: 1.7,
    fontSize: 40,
    fontFace: spec.font,
    color: spec.palette.ink,
    bold: true,
  })
  slide.addText(content.body, {
    x: 0.7,
    y: 3.6,
    w: 5.4,
    h: 0.9,
    fontSize: 15,
    fontFace: spec.font,
    color: spec.palette.gray,
  })
  slide.addShape(ShapeType.rect, {
    x: 6.6,
    y: 0.7,
    w: 2.7,
    h: 4.2,
    fill: { color: accent, transparency: 82 },
    line: { color: accent, width: 1 },
  })
  slide.addText("ISSUE", {
    x: 7.05,
    y: 1.05,
    w: 1.8,
    h: 0.4,
    fontSize: 12,
    fontFace: spec.font,
    color: accent,
    bold: true,
  })
  slide.addText("2026", {
    x: 7.05,
    y: 1.55,
    w: 1.8,
    h: 1.0,
    fontSize: 34,
    fontFace: spec.font,
    color: spec.palette.ink,
    bold: true,
  })
  slide.addText("故事 / 品牌 / 方法", {
    x: 7.05,
    y: 3.05,
    w: 1.8,
    h: 0.8,
    fontSize: 12,
    fontFace: spec.font,
    color: spec.palette.gray,
  })
}

function coverOrganic(slide, spec, content) {
  const accent = accentOf(spec)
  slide.addShape(ShapeType.ellipse, { x: 0.7, y: 0.65, w: 3.1, h: 1.35, fill: { color: accent, transparency: 30 } })
  slide.addShape(ShapeType.ellipse, {
    x: 6.2,
    y: 4.0,
    w: 3.2,
    h: 1.3,
    fill: { color: accent2Of(spec), transparency: 28 },
  })
  slide.addText(spec.name, {
    x: 0.85,
    y: 2.05,
    w: 3.5,
    h: 0.5,
    fontSize: 14,
    fontFace: spec.font,
    color: accent,
    bold: true,
  })
  slide.addText(content.title, {
    x: 0.85,
    y: 2.55,
    w: 8.2,
    h: 1.2,
    fontSize: 36,
    fontFace: spec.font,
    color: spec.palette.ink,
    bold: true,
  })
  slide.addText(content.body, {
    x: 0.9,
    y: 3.95,
    w: 6.2,
    h: 0.9,
    fontSize: 15,
    fontFace: spec.font,
    color: spec.palette.gray,
  })
}

function coverBlueprint(slide, spec, content) {
  const accent = accentOf(spec)
  slide.addShape(ShapeType.rect, { x: 0, y: 0, w: W, h: H, fill: { color: spec.palette.bg } })
  for (let i = 0; i < 9; i++) {
    slide.addShape(ShapeType.line, { x: 0, y: i * 0.7, w: W, h: 0, line: { color: spec.palette.gray, width: 0.5 } })
  }
  slide.addShape(ShapeType.rect, { x: 0.8, y: 0.8, w: 8.4, h: 0.12, fill: { color: accent } })
  slide.addText("BLUEPRINT // 技术方案", {
    x: 0.85,
    y: 1.15,
    w: 4.0,
    h: 0.4,
    fontSize: 12,
    fontFace: spec.font,
    color: accent,
    bold: true,
  })
  slide.addText(content.title, {
    x: 0.85,
    y: 2.0,
    w: 8.2,
    h: 1.5,
    fontSize: 38,
    fontFace: spec.font,
    color: spec.palette.ink,
    bold: true,
  })
  slide.addText(content.body, {
    x: 0.9,
    y: 3.8,
    w: 6.4,
    h: 0.9,
    fontSize: 15,
    fontFace: spec.font,
    color: spec.palette.gray,
  })
  slide.addShape(ShapeType.roundRect, {
    x: 7.15,
    y: 1.0,
    w: 2.15,
    h: 0.9,
    rectRadius: 0.08,
    fill: { color: spec.palette.page },
    line: { color: accent, width: 1 },
  })
  slide.addText("A-01", {
    x: 7.4,
    y: 1.24,
    w: 1.7,
    h: 0.45,
    fontSize: 15,
    fontFace: spec.font,
    color: accent,
    bold: true,
    align: "center",
  })
}

function coverMinimal(slide, spec, content) {
  const accent = accentOf(spec)
  slide.addText(spec.name, {
    x: 0.7,
    y: 0.55,
    w: 4.0,
    h: 0.4,
    fontSize: 12,
    fontFace: spec.font,
    color: accent,
    bold: true,
  })
  slide.addShape(ShapeType.rect, { x: 0.7, y: 1.2, w: 0.06, h: 3.1, fill: { color: accent } })
  slide.addText(content.title, {
    x: 1.05,
    y: 1.7,
    w: 7.5,
    h: 1.4,
    fontSize: 40,
    fontFace: spec.font,
    color: spec.palette.ink,
    bold: true,
  })
  slide.addText(content.body, {
    x: 1.1,
    y: 3.3,
    w: 6.2,
    h: 0.8,
    fontSize: 15,
    fontFace: spec.font,
    color: spec.palette.gray,
  })
  slide.addText("2026", {
    x: 8.2,
    y: 4.65,
    w: 1.2,
    h: 0.4,
    fontSize: 12,
    fontFace: spec.font,
    color: spec.palette.gray,
    align: "right",
  })
}

function coverOfficial(slide, spec, content) {
  const accent = accentOf(spec)
  slide.addShape(ShapeType.rect, { x: 0, y: 0, w: W, h: 0.14, fill: { color: spec.palette.red ?? accent } })
  slide.addShape(ShapeType.rect, { x: 0, y: H - 0.14, w: W, h: 0.14, fill: { color: spec.palette.red ?? accent } })
  slide.addText("政务汇报", {
    x: 0.8,
    y: 0.5,
    w: 3.0,
    h: 0.4,
    fontSize: 12,
    fontFace: spec.font,
    color: spec.palette.gray,
    bold: true,
  })
  slide.addText(content.title, {
    x: 1.2,
    y: 2.0,
    w: 7.6,
    h: 1.4,
    fontSize: 38,
    fontFace: spec.font,
    color: spec.palette.ink,
    bold: true,
    align: "center",
  })
  slide.addText(content.body, {
    x: 2.0,
    y: 3.5,
    w: 6.0,
    h: 0.8,
    fontSize: 14,
    fontFace: spec.font,
    color: spec.palette.gray,
    align: "center",
  })
  slide.addShape(ShapeType.rect, { x: 4.25, y: 1.7, w: 1.5, h: 0.08, fill: { color: accent } })
}

function coverProject(slide, spec, content) {
  const accent = accentOf(spec)
  slide.addShape(ShapeType.rect, { x: 0, y: 0, w: 3.7, h: H, fill: { color: spec.palette.bg } })
  slide.addText("PROJECT FILE", {
    x: 0.55,
    y: 0.55,
    w: 2.7,
    h: 0.4,
    fontSize: 12,
    fontFace: spec.font,
    color: accent,
    bold: true,
  })
  slide.addText(content.title, {
    x: 0.55,
    y: 2.0,
    w: 2.8,
    h: 1.4,
    fontSize: 30,
    fontFace: spec.font,
    color: spec.palette.ink,
    bold: true,
  })
  slide.addText("编号 / 阶段 / 交付物", {
    x: 0.6,
    y: 3.6,
    w: 2.7,
    h: 0.8,
    fontSize: 12,
    fontFace: spec.font,
    color: spec.palette.gray,
  })
  slide.addShape(ShapeType.rect, {
    x: 4.2,
    y: 0.7,
    w: 5.2,
    h: 4.2,
    fill: { color: spec.palette.page },
    line: { color: accent, width: 1 },
  })
  slide.addText(content.body, {
    x: 4.65,
    y: 1.35,
    w: 4.3,
    h: 1.2,
    fontSize: 22,
    fontFace: spec.font,
    color: spec.palette.ink,
    bold: true,
  })
  slide.addShape(ShapeType.rect, { x: 4.65, y: 2.85, w: 4.3, h: 0.08, fill: { color: accent } })
  slide.addText("里程碑 A → B → C", {
    x: 4.65,
    y: 3.15,
    w: 4.3,
    h: 1.0,
    fontSize: 15,
    fontFace: spec.font,
    color: spec.palette.gray,
  })
}

function coverTerminal(slide, spec, content) {
  const accent = accentOf(spec)
  slide.addShape(ShapeType.rect, { x: 0, y: 0, w: W, h: H, fill: { color: spec.palette.bg } })
  slide.addShape(ShapeType.rect, { x: 0, y: 0, w: W, h: 0.55, fill: { color: spec.palette.page } })
  slide.addText("●  ●  ●", {
    x: 0.35,
    y: 0.16,
    w: 1.2,
    h: 0.3,
    fontSize: 12,
    fontFace: spec.font,
    color: spec.palette.gray,
  })
  slide.addText("$ nova --deploy", {
    x: 0.7,
    y: 1.05,
    w: 4.0,
    h: 0.4,
    fontSize: 14,
    fontFace: spec.font,
    color: accent,
    bold: true,
  })
  slide.addText(content.title, {
    x: 0.7,
    y: 1.9,
    w: 8.4,
    h: 1.4,
    fontSize: 38,
    fontFace: spec.font,
    color: spec.palette.ink,
    bold: true,
  })
  slide.addText(`> ${content.body}`, {
    x: 0.75,
    y: 3.6,
    w: 7.8,
    h: 1.0,
    fontSize: 15,
    fontFace: spec.font,
    color: spec.palette.gray,
  })
  slide.addText("_", { x: 8.55, y: 4.45, w: 0.4, h: 0.4, fontSize: 18, fontFace: spec.font, color: accent })
}

function renderOverview(slide, spec, content, page, total) {
  switch (spec.layout.overview) {
    case "agenda":
      overviewAgenda(slide, spec, content)
      break
    case "list":
      overviewList(slide, spec, content)
      break
    case "roadmap":
      overviewRoadmap(slide, spec, content)
      break
    case "timeline":
      overviewTimeline(slide, spec, content)
      break
    case "toc":
      overviewToc(slide, spec, content)
      break
    case "map":
      overviewMap(slide, spec, content)
      break
    case "flow":
      overviewFlow(slide, spec, content)
      break
    case "commands":
      overviewCommands(slide, spec, content)
      break
    case "milestones":
      overviewMilestones(slide, spec, content)
      break
    case "problem":
      overviewProblem(slide, spec, content)
      break
    default:
      overviewAgenda(slide, spec, content)
  }
  addFooter(slide, spec, page, total)
}

function overviewAgenda(slide, spec, content) {
  header(slide, spec, content.title)
  const points = contentLines(content.body).slice(0, 4)
  points.forEach((point, index) => {
    const y = 1.55 + index * 0.82
    slide.addShape(ShapeType.rect, { x: 0.8, y, w: 0.08, h: 0.46, fill: { color: accentOf(spec) } })
    slide.addText(String(index + 1).padStart(2, "0"), {
      x: 1.1,
      y,
      w: 0.6,
      h: 0.46,
      fontSize: 20,
      fontFace: spec.font,
      color: accentOf(spec),
      bold: true,
    })
    slide.addText(point, {
      x: 1.9,
      y,
      w: 5.4,
      h: 0.46,
      fontSize: 17,
      fontFace: spec.font,
      color: spec.palette.ink,
      bold: true,
    })
    slide.addText(`第 ${index + 1} 部分的一句话说明`, {
      x: 1.95,
      y: y + 0.42,
      w: 6.0,
      h: 0.3,
      fontSize: 11,
      fontFace: spec.font,
      color: spec.palette.gray,
    })
  })
}

function overviewList(slide, spec, content) {
  header(slide, spec, content.title)
  const points = contentLines(content.body)
  points.forEach((point, index) => {
    const y = 1.6 + index * 0.75
    slide.addShape(ShapeType.rect, {
      x: 0.75,
      y,
      w: 8.2,
      h: 0.52,
      fill: { color: spec.palette.page },
      line: { color: spec.palette.gray, width: 1 },
    })
    slide.addText(`0${index + 1}`, {
      x: 1.0,
      y: y + 0.06,
      w: 0.65,
      h: 0.4,
      fontSize: 14,
      fontFace: spec.font,
      color: accentOf(spec),
      bold: true,
    })
    slide.addText(point, {
      x: 1.8,
      y: y + 0.08,
      w: 6.6,
      h: 0.38,
      fontSize: 15,
      fontFace: spec.font,
      color: spec.palette.ink,
      bold: true,
    })
  })
}

function overviewRoadmap(slide, spec, content) {
  header(slide, spec, content.title)
  const points = contentLines(content.body)
  const x0 = 0.8
  const step = 2.1
  slide.addShape(ShapeType.line, { x: x0 + 0.1, y: 2.6, w: 8.4, h: 0, line: { color: accentOf(spec), width: 2 } })
  points.forEach((point, index) => {
    const x = x0 + index * step
    slide.addShape(ShapeType.ellipse, { x: x + 0.28, y: 2.4, w: 0.42, h: 0.42, fill: { color: accentOf(spec) } })
    slide.addText(point, {
      x,
      y: 1.25,
      w: 1.9,
      h: 0.9,
      fontSize: 14,
      fontFace: spec.font,
      color: spec.palette.ink,
      bold: true,
      align: "center",
    })
    slide.addText(`STEP 0${index + 1}`, {
      x,
      y: 3.05,
      w: 1.9,
      h: 0.4,
      fontSize: 11,
      fontFace: spec.font,
      color: spec.palette.gray,
      align: "center",
    })
  })
}

function overviewTimeline(slide, spec, content) {
  header(slide, spec, content.title)
  const points = contentLines(content.body)
  points.forEach((point, index) => {
    const x = 0.95 + index * 2.0
    const h = 0.9 + (index % 2) * 0.55
    slide.addShape(ShapeType.roundRect, {
      x,
      y: 2.7 - h,
      w: 1.7,
      h,
      rectRadius: 0.06,
      fill: { color: spec.palette.page },
      line: { color: accent2Of(spec), width: 1 },
    })
    slide.addShape(ShapeType.ellipse, { x: x + 0.72, y: 2.7, w: 0.3, h: 0.3, fill: { color: accentOf(spec) } })
    slide.addText(point, {
      x: x + 0.15,
      y: 2.62 - h,
      w: 1.4,
      h: h - 0.2,
      fontSize: 13,
      fontFace: spec.font,
      color: spec.palette.ink,
      bold: true,
      align: "center",
    })
  })
  slide.addShape(ShapeType.line, { x: 0.85, y: 2.86, w: 8.4, h: 0, line: { color: spec.palette.gray, width: 1 } })
}

function overviewToc(slide, spec, content) {
  header(slide, spec, "目录 CONTENTS")
  const points = contentLines(content.body)
  points.forEach((point, index) => {
    const y = 1.65 + index * 0.78
    slide.addText(String(index + 1).padStart(2, "0"), {
      x: 0.9,
      y,
      w: 0.8,
      h: 0.5,
      fontSize: 24,
      fontFace: spec.font,
      color: accentOf(spec),
      bold: true,
    })
    slide.addText(point, {
      x: 2.0,
      y: y + 0.05,
      w: 5.0,
      h: 0.4,
      fontSize: 17,
      fontFace: spec.font,
      color: spec.palette.ink,
      bold: true,
    })
    slide.addShape(ShapeType.line, {
      x: 2.0,
      y: y + 0.48,
      w: 5.2,
      h: 0,
      line: { color: spec.palette.gray, width: 0.75 },
    })
    slide.addText("· · · · · ·", {
      x: 6.5,
      y: y + 0.1,
      w: 2.2,
      h: 0.4,
      fontSize: 12,
      fontFace: spec.font,
      color: spec.palette.gray,
      align: "right",
    })
  })
}

function overviewMap(slide, spec, content) {
  header(slide, spec, "路线 ROUTE")
  const points = contentLines(content.body)
  slide.addShape(ShapeType.ellipse, {
    x: 0.7,
    y: 1.45,
    w: 8.6,
    h: 3.35,
    fill: { color: accentOf(spec), transparency: 88 },
  })
  points.forEach((point, index) => {
    const angle = (Math.PI * 2 * index) / Math.max(points.length, 1) - Math.PI / 2
    const cx = 5 + Math.cos(angle) * 3.1
    const cy = 3.1 + Math.sin(angle) * 1.15
    slide.addShape(ShapeType.ellipse, {
      x: cx,
      y: cy,
      w: 1.2,
      h: 0.55,
      fill: { color: spec.palette.page },
      line: { color: accentOf(spec), width: 1 },
    })
    slide.addText(point.slice(0, 6), {
      x: cx,
      y: cy + 0.06,
      w: 1.2,
      h: 0.42,
      fontSize: 11,
      fontFace: spec.font,
      color: spec.palette.ink,
      bold: true,
      align: "center",
    })
  })
  slide.addShape(ShapeType.ellipse, { x: 4.55, y: 2.75, w: 0.9, h: 0.9, fill: { color: accentOf(spec) } })
  slide.addText("START", {
    x: 4.42,
    y: 2.9,
    w: 1.15,
    h: 0.4,
    fontSize: 10,
    fontFace: spec.font,
    color: spec.palette.page,
    bold: true,
    align: "center",
  })
}

function overviewFlow(slide, spec, content) {
  header(slide, spec, "链路 FLOW")
  const points = contentLines(content.body)
  points.forEach((point, index) => {
    const x = 0.65 + index * 2.2
    slide.addShape(ShapeType.roundRect, {
      x,
      y: 2.05,
      w: 1.7,
      h: 1.0,
      rectRadius: 0.08,
      fill: { color: spec.palette.page },
      line: { color: accent2Of(spec), width: 1 },
    })
    slide.addText(point, {
      x: x + 0.1,
      y: 2.28,
      w: 1.5,
      h: 0.55,
      fontSize: 13,
      fontFace: spec.font,
      color: spec.palette.ink,
      bold: true,
      align: "center",
    })
    if (index < points.length - 1)
      slide.addText("→", {
        x: x + 1.68,
        y: 2.28,
        w: 0.55,
        h: 0.55,
        fontSize: 18,
        fontFace: spec.font,
        color: accentOf(spec),
        bold: true,
        align: "center",
      })
  })
  slide.addText("INPUT → PROCESS → OUTPUT", {
    x: 0.7,
    y: 3.45,
    w: 8.6,
    h: 0.5,
    fontSize: 13,
    fontFace: spec.font,
    color: spec.palette.gray,
    align: "center",
  })
}

function overviewCommands(slide, spec, content) {
  header(slide, spec, "$ help --overview")
  const points = contentLines(content.body)
  points.forEach((point, index) => {
    const y = 1.75 + index * 0.78
    slide.addText(`$ ${String(index + 1).padStart(2, "0")}`, {
      x: 0.85,
      y,
      w: 1.2,
      h: 0.4,
      fontSize: 14,
      fontFace: spec.font,
      color: accentOf(spec),
      bold: true,
    })
    slide.addText(point, { x: 2.35, y, w: 6.4, h: 0.4, fontSize: 15, fontFace: spec.font, color: spec.palette.ink })
  })
}

function overviewMilestones(slide, spec, content) {
  header(slide, spec, "里程碑 MILESTONES")
  const points = contentLines(content.body)
  points.forEach((point, index) => {
    const y = 1.55 + index * 0.85
    slide.addShape(ShapeType.rect, { x: 0.85, y, w: 2.5, h: 0.62, fill: { color: accentOf(spec), transparency: 16 } })
    slide.addText(`M${index + 1}`, {
      x: 1.0,
      y: y + 0.1,
      w: 1.0,
      h: 0.4,
      fontSize: 13,
      fontFace: spec.font,
      color: spec.palette.ink,
      bold: true,
    })
    slide.addText(point, {
      x: 3.75,
      y: y + 0.08,
      w: 5.0,
      h: 0.45,
      fontSize: 15,
      fontFace: spec.font,
      color: spec.palette.ink,
      bold: true,
    })
    slide.addText(`阶段说明 ${index + 1}`, {
      x: 3.8,
      y: y + 0.42,
      w: 4.8,
      h: 0.3,
      fontSize: 11,
      fontFace: spec.font,
      color: spec.palette.gray,
    })
  })
}

function overviewProblem(slide, spec, content) {
  header(slide, spec, "问题 / 方案")
  const points = contentLines(content.body)
  slide.addShape(ShapeType.roundRect, {
    x: 0.8,
    y: 1.6,
    w: 4.0,
    h: 2.7,
    rectRadius: 0.08,
    fill: { color: spec.palette.bg },
    line: { color: spec.palette.gray, width: 1 },
  })
  slide.addText("PROBLEM", {
    x: 1.15,
    y: 1.95,
    w: 3.2,
    h: 0.5,
    fontSize: 15,
    fontFace: spec.font,
    color: accentOf(spec),
    bold: true,
  })
  slide.addText(points[0] ?? "问题描述", {
    x: 1.15,
    y: 2.55,
    w: 3.2,
    h: 1.2,
    fontSize: 20,
    fontFace: spec.font,
    color: spec.palette.ink,
    bold: true,
  })
  slide.addShape(ShapeType.roundRect, {
    x: 5.2,
    y: 1.6,
    w: 4.0,
    h: 2.7,
    rectRadius: 0.08,
    fill: { color: accentOf(spec), transparency: 88 },
    line: { color: accentOf(spec), width: 1 },
  })
  slide.addText("SOLUTION", {
    x: 5.55,
    y: 1.95,
    w: 3.2,
    h: 0.5,
    fontSize: 15,
    fontFace: spec.font,
    color: accentOf(spec),
    bold: true,
  })
  slide.addText(points[1] ?? "解决方案", {
    x: 5.55,
    y: 2.55,
    w: 3.2,
    h: 1.2,
    fontSize: 20,
    fontFace: spec.font,
    color: spec.palette.ink,
    bold: true,
  })
}

function renderContent(slide, spec, content, page, total) {
  switch (spec.layout.content) {
    case "split":
      contentSplit(slide, spec, content)
      break
    case "columns":
      contentColumns(slide, spec, content)
      break
    case "diagram":
      contentDiagram(slide, spec, content)
      break
    case "caseStudy":
      contentCaseStudy(slide, spec, content)
      break
    case "table":
      contentTable(slide, spec, content)
      break
    case "process":
      contentProcess(slide, spec, content)
      break
    case "policy":
      contentPolicy(slide, spec, content)
      break
    case "code":
      contentCode(slide, spec, content)
      break
    case "lesson":
      contentLesson(slide, spec, content)
      break
    default:
      contentSplit(slide, spec, content)
  }
  addFooter(slide, spec, page, total)
}

function contentSplit(slide, spec, content) {
  header(slide, spec, content.title)
  slide.addShape(ShapeType.rect, { x: 0.85, y: 1.5, w: 8.3, h: 0.05, fill: { color: accentOf(spec) } })
  slide.addText(content.body, {
    x: 0.9,
    y: 1.85,
    w: 4.4,
    h: 2.7,
    fontSize: 15,
    fontFace: spec.font,
    color: spec.palette.ink,
    valign: "top",
  })
  slide.addShape(ShapeType.roundRect, {
    x: 5.6,
    y: 1.8,
    w: 3.55,
    h: 2.6,
    rectRadius: 0.08,
    fill: { color: accentOf(spec), transparency: 88 },
    line: { color: accentOf(spec), width: 1 },
  })
  slide.addText("结论", {
    x: 5.9,
    y: 2.1,
    w: 3.0,
    h: 0.45,
    fontSize: 14,
    fontFace: spec.font,
    color: accentOf(spec),
    bold: true,
  })
  slide.addText("这里放一个必须被记住的核心判断。", {
    x: 5.9,
    y: 2.65,
    w: 3.0,
    h: 1.2,
    fontSize: 16,
    fontFace: spec.font,
    color: spec.palette.ink,
  })
}

function contentColumns(slide, spec, content) {
  header(slide, spec, content.title)
  const lines = contentLines(content.body)
  const left = lines.slice(0, Math.ceil(lines.length / 2)).join("\n")
  const right = lines.slice(Math.ceil(lines.length / 2)).join("\n")
  slide.addText(left || "左栏", {
    x: 0.9,
    y: 1.7,
    w: 3.9,
    h: 2.8,
    fontSize: 14,
    fontFace: spec.font,
    color: spec.palette.ink,
    valign: "top",
  })
  slide.addShape(ShapeType.line, { x: 5.0, y: 1.7, w: 0, h: 2.8, line: { color: spec.palette.gray, width: 1 } })
  slide.addText(right || "右栏", {
    x: 5.25,
    y: 1.7,
    w: 3.9,
    h: 2.8,
    fontSize: 14,
    fontFace: spec.font,
    color: spec.palette.ink,
    valign: "top",
  })
}

function contentDiagram(slide, spec, content) {
  header(slide, spec, content.title)
  const lines = contentLines(content.body)
  const columns = Math.max(lines.length, 3)
  lines.slice(0, columns).forEach((line, index) => {
    const x = 0.75 + index * 2.1
    slide.addShape(ShapeType.roundRect, {
      x,
      y: 2.0,
      w: 1.85,
      h: 1.25,
      rectRadius: 0.1,
      fill: { color: spec.palette.page },
      line: { color: accent2Of(spec), width: 1 },
    })
    slide.addShape(ShapeType.ellipse, { x: x + 0.72, y: 2.28, w: 0.4, h: 0.4, fill: { color: accentOf(spec) } })
    slide.addText(line.slice(0, 16), {
      x: x + 0.12,
      y: 2.82,
      w: 1.6,
      h: 0.35,
      fontSize: 10,
      fontFace: spec.font,
      color: spec.palette.ink,
      bold: true,
      align: "center",
    })
    if (index < columns - 1)
      slide.addText("→", {
        x: x + 1.83,
        y: 2.4,
        w: 0.3,
        h: 0.4,
        fontSize: 16,
        fontFace: spec.font,
        color: accentOf(spec),
        bold: true,
      })
  })
}

function contentCaseStudy(slide, spec, content) {
  header(slide, spec, content.title)
  slide.addShape(ShapeType.rect, {
    x: 0.85,
    y: 1.55,
    w: 3.2,
    h: 2.9,
    fill: { color: spec.palette.bg },
    line: { color: spec.palette.gray, width: 1 },
  })
  slide.addText("案例图片 / 项目现场", {
    x: 1.05,
    y: 2.85,
    w: 2.8,
    h: 0.5,
    fontSize: 12,
    fontFace: spec.font,
    color: spec.palette.gray,
    align: "center",
  })
  slide.addText(content.title, {
    x: 4.35,
    y: 1.7,
    w: 4.6,
    h: 0.6,
    fontSize: 20,
    fontFace: spec.font,
    color: spec.palette.ink,
    bold: true,
  })
  slide.addText(content.body, {
    x: 4.35,
    y: 2.4,
    w: 4.6,
    h: 2.0,
    fontSize: 14,
    fontFace: spec.font,
    color: spec.palette.gray,
    valign: "top",
  })
}

function contentTable(slide, spec, content) {
  header(slide, spec, content.title)
  const rows = [
    ["指标", "基线", "目标", "变化"],
    ["营收", "1.28 亿", "1.64 亿", "+28%"],
    ["活跃用户", "82 万", "106 万", "+29%"],
    ["转化率", "3.6%", "4.4%", "+0.8pt"],
  ]
  slide.addTable(rows, {
    x: 0.85,
    y: 1.7,
    w: 8.3,
    h: 2.9,
    border: { pt: 1, color: spec.palette.gray },
    fontSize: 13,
    fontFace: spec.font,
    color: spec.palette.ink,
    fill: { color: spec.palette.page },
  })
}

function contentProcess(slide, spec, content) {
  header(slide, spec, content.title)
  const lines = contentLines(content.body)
  lines.slice(0, 4).forEach((line, index) => {
    const x = 0.75 + index * 2.15
    slide.addShape(ShapeType.rect, { x, y: 2.0, w: 1.9, h: 1.0, fill: { color: accentOf(spec), transparency: 14 } })
    slide.addText(line.slice(0, 12), {
      x: x + 0.1,
      y: 2.24,
      w: 1.7,
      h: 0.5,
      fontSize: 13,
      fontFace: spec.font,
      color: spec.palette.ink,
      bold: true,
      align: "center",
    })
    if (index < 3)
      slide.addText("→", {
        x: x + 1.88,
        y: 2.3,
        w: 0.3,
        h: 0.4,
        fontSize: 16,
        fontFace: spec.font,
        color: accentOf(spec),
        bold: true,
      })
  })
}

function contentPolicy(slide, spec, content) {
  header(slide, spec, content.title)
  slide.addShape(ShapeType.rect, { x: 0, y: 1.5, w: 0.18, h: 2.9, fill: { color: accentOf(spec) } })
  const lines = contentLines(content.body)
  slide.addText(lines.join("\n"), {
    x: 0.9,
    y: 1.7,
    w: 8.0,
    h: 2.7,
    fontSize: 15,
    fontFace: spec.font,
    color: spec.palette.ink,
    valign: "top",
  })
  slide.addText("政策依据 / 工作要点 / 下一步", {
    x: 0.95,
    y: 4.45,
    w: 7.8,
    h: 0.4,
    fontSize: 11,
    fontFace: spec.font,
    color: spec.palette.gray,
  })
}

function contentCode(slide, spec, content) {
  header(slide, spec, content.title)
  slide.addShape(ShapeType.rect, { x: 0.8, y: 1.7, w: 8.4, h: 2.8, fill: { color: spec.palette.page } })
  slide.addText(">", {
    x: 1.1,
    y: 2.0,
    w: 0.5,
    h: 0.4,
    fontSize: 14,
    fontFace: spec.font,
    color: accentOf(spec),
    bold: true,
  })
  slide.addText(content.body, {
    x: 1.6,
    y: 1.95,
    w: 7.2,
    h: 2.2,
    fontSize: 15,
    fontFace: spec.font,
    color: spec.palette.ink,
    valign: "top",
  })
}

function contentLesson(slide, spec, content) {
  header(slide, spec, content.title)
  const lines = contentLines(content.body)
  slide.addText(lines.join("\n\n"), {
    x: 0.9,
    y: 1.8,
    w: 5.4,
    h: 2.6,
    fontSize: 15,
    fontFace: spec.font,
    color: spec.palette.ink,
    valign: "top",
  })
  slide.addShape(ShapeType.roundRect, {
    x: 6.7,
    y: 1.8,
    w: 2.55,
    h: 2.6,
    rectRadius: 0.1,
    fill: { color: spec.palette.bg },
    line: { color: accentOf(spec), width: 1 },
  })
  slide.addText("课堂任务", {
    x: 6.95,
    y: 2.1,
    w: 2.0,
    h: 0.5,
    fontSize: 14,
    fontFace: spec.font,
    color: accentOf(spec),
    bold: true,
  })
  slide.addText("把本页知识点应用到一个小练习里。", {
    x: 6.95,
    y: 2.75,
    w: 2.0,
    h: 1.2,
    fontSize: 13,
    fontFace: spec.font,
    color: spec.palette.ink,
  })
}

function renderCards(slide, spec, content, page, total) {
  switch (spec.layout.cards) {
    case "grid":
      cardsGrid(slide, spec, content)
      break
    case "sticky":
      cardsSticky(slide, spec, content)
      break
    case "kpi":
      cardsKpi(slide, spec, content)
      break
    case "gallery":
      cardsGallery(slide, spec, content)
      break
    case "comparison":
      cardsComparison(slide, spec, content)
      break
    case "milestones":
      cardsMilestones(slide, spec, content)
      break
    case "products":
      cardsProducts(slide, spec, content)
      break
    case "evidence":
      cardsEvidence(slide, spec, content)
      break
    case "achievements":
      cardsAchievements(slide, spec, content)
      break
    case "treatment":
      cardsTreatment(slide, spec, content)
      break
    case "progress":
      cardsProgress(slide, spec, content)
      break
    case "exercises":
      cardsExercises(slide, spec, content)
      break
    case "incidents":
      cardsIncidents(slide, spec, content)
      break
    case "issues":
      cardsIssues(slide, spec, content)
      break
    default:
      cardsGrid(slide, spec, content)
  }
  addFooter(slide, spec, page, total)
}

function cardsGrid(slide, spec, content) {
  header(slide, spec, content.title)
  const lines = contentLines(content.body)
  lines.slice(0, 3).forEach((line, index) => {
    const x = 0.85 + index * 2.82
    slide.addShape(ShapeType.rect, {
      x,
      y: 1.6,
      w: 2.55,
      h: 0.1,
      fill: { color: [accentOf(spec), accent2Of(spec), spec.palette.gray][index] },
    })
    slide.addShape(ShapeType.rect, {
      x,
      y: 1.7,
      w: 2.55,
      h: 2.7,
      fill: { color: spec.palette.page },
      line: { color: spec.palette.gray, width: 1 },
    })
    slide.addText(`0${index + 1}`, {
      x: x + 0.25,
      y: 2.05,
      w: 2.0,
      h: 0.5,
      fontSize: 22,
      fontFace: spec.font,
      color: accentOf(spec),
      bold: true,
    })
    slide.addText(line, {
      x: x + 0.25,
      y: 2.75,
      w: 2.05,
      h: 1.2,
      fontSize: 14,
      fontFace: spec.font,
      color: spec.palette.ink,
      bold: true,
    })
  })
}

function cardsSticky(slide, spec, content) {
  header(slide, spec, content.title)
  const lines = contentLines(content.body)
  const rotations = [-3, 2, -2]
  lines.slice(0, 3).forEach((line, index) => {
    const x = 0.75 + index * 2.9
    slide.addShape(ShapeType.rect, {
      x,
      y: 1.65,
      w: 2.6,
      h: 2.7,
      rotate: rotations[index],
      fill: { color: index === 1 ? accent2Of(spec) : spec.palette.page },
      line: { color: spec.palette.ink, width: 1 },
    })
    slide.addText(line, {
      x: x + 0.3,
      y: 2.0,
      w: 2.0,
      h: 1.8,
      fontSize: 15,
      fontFace: spec.font,
      color: spec.palette.ink,
      bold: true,
    })
  })
}

function cardsKpi(slide, spec, content) {
  header(slide, spec, content.title)
  const cards = [
    ["01", "指标 A", "+28%"],
    ["02", "指标 B", "4.8s"],
    ["03", "指标 C", "99.7%"],
    ["04", "指标 D", "¥0.42"],
  ]
  cards.forEach((card, index) => {
    const x = 0.85 + (index % 2) * 4.35
    const y = 1.65 + Math.floor(index / 2) * 1.45
    slide.addShape(ShapeType.roundRect, {
      x,
      y,
      w: 4.05,
      h: 1.2,
      rectRadius: 0.08,
      fill: { color: spec.palette.page },
      line: { color: accent2Of(spec), width: 1 },
    })
    slide.addText(card[0], {
      x: x + 0.25,
      y: y + 0.2,
      w: 0.8,
      h: 0.8,
      fontSize: 22,
      fontFace: spec.font,
      color: accentOf(spec),
      bold: true,
    })
    slide.addText(card[1], {
      x: x + 1.1,
      y: y + 0.18,
      w: 1.8,
      h: 0.45,
      fontSize: 13,
      fontFace: spec.font,
      color: spec.palette.gray,
    })
    slide.addText(card[2], {
      x: x + 1.1,
      y: y + 0.6,
      w: 2.7,
      h: 0.5,
      fontSize: 22,
      fontFace: spec.font,
      color: spec.palette.ink,
      bold: true,
    })
  })
}

function cardsGallery(slide, spec, content) {
  header(slide, spec, content.title)
  const lines = contentLines(content.body)
  lines.slice(0, 4).forEach((line, index) => {
    const x = 0.75 + (index % 2) * 4.35
    const y = 1.6 + Math.floor(index / 2) * 1.4
    slide.addShape(ShapeType.rect, {
      x,
      y,
      w: 4.1,
      h: 1.2,
      fill: { color: index % 2 ? accent2Of(spec) : accentOf(spec), transparency: 74 },
      line: { color: spec.palette.gray, width: 1 },
    })
    slide.addText(line, {
      x: x + 0.25,
      y: y + 0.35,
      w: 3.6,
      h: 0.5,
      fontSize: 15,
      fontFace: spec.font,
      color: spec.palette.ink,
      bold: true,
    })
  })
}

function cardsComparison(slide, spec, content) {
  header(slide, spec, content.title)
  const lines = contentLines(content.body)
  const columns = [
    ["A", lines[0] ?? "方案 A", "确定、可复用、成本可控"],
    ["B", lines[1] ?? "方案 B", "灵活、扩展性强、需要验证"],
    ["C", lines[2] ?? "方案 C", "快速验证、风险较高"],
  ]
  columns.forEach((col, index) => {
    const x = 0.8 + index * 2.85
    slide.addShape(ShapeType.roundRect, {
      x,
      y: 1.6,
      w: 2.6,
      h: 2.7,
      rectRadius: 0.08,
      fill: { color: index === 1 ? accentOf(spec) : spec.palette.page, transparency: index === 1 ? 88 : 0 },
      line: { color: index === 1 ? accentOf(spec) : spec.palette.gray, width: 1 },
    })
    slide.addText(col[0], {
      x: x + 0.3,
      y: 1.95,
      w: 2.0,
      h: 0.5,
      fontSize: 26,
      fontFace: spec.font,
      color: accentOf(spec),
      bold: true,
    })
    slide.addText(col[1], {
      x: x + 0.3,
      y: 2.6,
      w: 2.0,
      h: 0.6,
      fontSize: 16,
      fontFace: spec.font,
      color: spec.palette.ink,
      bold: true,
    })
    slide.addText(col[2], {
      x: x + 0.3,
      y: 3.35,
      w: 2.0,
      h: 0.7,
      fontSize: 11,
      fontFace: spec.font,
      color: spec.palette.gray,
    })
  })
}

function cardsMilestones(slide, spec, content) {
  header(slide, spec, content.title)
  const lines = contentLines(content.body)
  lines.slice(0, 4).forEach((line, index) => {
    const x = 0.75 + index * 2.15
    slide.addShape(ShapeType.ellipse, { x: x + 0.85, y: 1.8, w: 0.55, h: 0.55, fill: { color: accentOf(spec) } })
    slide.addShape(ShapeType.line, { x: x + 0.95, y: 2.35, w: 1.1, h: 0, line: { color: spec.palette.gray, width: 1 } })
    slide.addText(`M${index + 1}`, {
      x: x + 0.55,
      y: 2.65,
      w: 1.15,
      h: 0.4,
      fontSize: 13,
      fontFace: spec.font,
      color: accentOf(spec),
      bold: true,
      align: "center",
    })
    slide.addText(line, {
      x,
      y: 3.15,
      w: 2.0,
      h: 1.0,
      fontSize: 12,
      fontFace: spec.font,
      color: spec.palette.ink,
      bold: true,
      align: "center",
    })
  })
}

function cardsProducts(slide, spec, content) {
  header(slide, spec, content.title)
  const lines = contentLines(content.body)
  const products = [lines[0] ?? "产品 A", lines[1] ?? "产品 B", lines[2] ?? "产品 C"]
  products.forEach((name, index) => {
    const x = 0.85 + index * 2.82
    slide.addShape(ShapeType.rect, { x, y: 1.75, w: 2.55, h: 0.08, fill: { color: accentOf(spec) } })
    slide.addShape(ShapeType.rect, {
      x,
      y: 1.83,
      w: 2.55,
      h: 2.45,
      fill: { color: spec.palette.page },
      line: { color: spec.palette.gray, width: 1 },
    })
    slide.addText(name, {
      x: x + 0.25,
      y: 2.1,
      w: 2.0,
      h: 0.5,
      fontSize: 16,
      fontFace: spec.font,
      color: spec.palette.ink,
      bold: true,
    })
    slide.addText("价值主张一句话", {
      x: x + 0.25,
      y: 3.15,
      w: 2.0,
      h: 0.8,
      fontSize: 12,
      fontFace: spec.font,
      color: spec.palette.gray,
    })
  })
}

function cardsEvidence(slide, spec, content) {
  header(slide, spec, content.title)
  const lines = contentLines(content.body)
  lines.slice(0, 3).forEach((line, index) => {
    const y = 1.7 + index * 0.95
    slide.addShape(ShapeType.rect, {
      x: 0.85,
      y,
      w: 8.3,
      h: 0.75,
      fill: { color: spec.palette.page },
      line: { color: spec.palette.gray, width: 1 },
    })
    slide.addText(`[证据 ${index + 1}]`, {
      x: 1.1,
      y: y + 0.15,
      w: 1.3,
      h: 0.45,
      fontSize: 12,
      fontFace: spec.font,
      color: accentOf(spec),
      bold: true,
    })
    slide.addText(line, {
      x: 2.6,
      y: y + 0.16,
      w: 6.2,
      h: 0.45,
      fontSize: 14,
      fontFace: spec.font,
      color: spec.palette.ink,
    })
  })
}

function cardsAchievements(slide, spec, content) {
  header(slide, spec, content.title)
  const lines = contentLines(content.body)
  const achievements = [lines[0] ?? "重点成果一", lines[1] ?? "重点成果二", lines[2] ?? "重点成果三"]
  achievements.forEach((item, index) => {
    const x = 0.85 + index * 2.82
    slide.addShape(ShapeType.roundRect, {
      x,
      y: 1.7,
      w: 2.55,
      h: 2.5,
      rectRadius: 0.08,
      fill: { color: index === 0 ? (spec.palette.red ?? accentOf(spec)) : accentOf(spec), transparency: 82 },
      line: { color: accentOf(spec), width: 1 },
    })
    slide.addText(String(index + 1), {
      x: x + 0.3,
      y: 2.0,
      w: 1.9,
      h: 0.6,
      fontSize: 30,
      fontFace: spec.font,
      color: accentOf(spec),
      bold: true,
    })
    slide.addText(item, {
      x: x + 0.3,
      y: 3.0,
      w: 1.9,
      h: 0.8,
      fontSize: 14,
      fontFace: spec.font,
      color: spec.palette.ink,
      bold: true,
    })
  })
}

function cardsTreatment(slide, spec, content) {
  header(slide, spec, content.title)
  const lines = contentLines(content.body)
  const items = [lines[0] ?? "诊断", lines[1] ?? "治疗", lines[2] ?? "随访"]
  items.forEach((item, index) => {
    const x = 0.8 + index * 2.85
    slide.addShape(ShapeType.ellipse, {
      x: x + 0.85,
      y: 1.75,
      w: 1.0,
      h: 1.0,
      fill: { color: accentOf(spec), transparency: 30 },
    })
    slide.addText(`0${index + 1}`, {
      x: x + 1.08,
      y: 2.0,
      w: 0.55,
      h: 0.5,
      fontSize: 18,
      fontFace: spec.font,
      color: spec.palette.ink,
      bold: true,
      align: "center",
    })
    slide.addText(item, {
      x,
      y: 3.0,
      w: 2.6,
      h: 0.6,
      fontSize: 15,
      fontFace: spec.font,
      color: spec.palette.ink,
      bold: true,
      align: "center",
    })
    slide.addText("简要说明", {
      x,
      y: 3.65,
      w: 2.6,
      h: 0.5,
      fontSize: 11,
      fontFace: spec.font,
      color: spec.palette.gray,
      align: "center",
    })
  })
}

function cardsProgress(slide, spec, content) {
  header(slide, spec, content.title)
  const lines = contentLines(content.body)
  const stages = [lines[0] ?? "阶段 1", lines[1] ?? "阶段 2", lines[2] ?? "阶段 3"]
  stages.forEach((stage, index) => {
    const y = 1.7 + index * 0.9
    slide.addText(stage, {
      x: 0.9,
      y,
      w: 2.4,
      h: 0.45,
      fontSize: 14,
      fontFace: spec.font,
      color: spec.palette.ink,
      bold: true,
    })
    slide.addShape(ShapeType.rect, {
      x: 3.6,
      y: y + 0.12,
      w: 4.7,
      h: 0.22,
      fill: { color: spec.palette.bg },
      line: { color: spec.palette.gray, width: 1 },
    })
    slide.addShape(ShapeType.rect, {
      x: 3.6,
      y: y + 0.12,
      w: (index + 1) * 1.2,
      h: 0.22,
      fill: { color: accentOf(spec) },
    })
    slide.addText(`${(index + 1) * 25}%`, {
      x: 8.4,
      y,
      w: 0.7,
      h: 0.45,
      fontSize: 13,
      fontFace: spec.font,
      color: accentOf(spec),
      bold: true,
      align: "right",
    })
  })
}

function cardsExercises(slide, spec, content) {
  header(slide, spec, content.title)
  const lines = contentLines(content.body)
  lines.slice(0, 4).forEach((line, index) => {
    const x = 0.75 + (index % 2) * 4.35
    const y = 1.7 + Math.floor(index / 2) * 1.35
    slide.addShape(ShapeType.roundRect, {
      x,
      y,
      w: 4.1,
      h: 1.15,
      rectRadius: 0.1,
      fill: { color: accent2Of(spec), transparency: 76 },
      line: { color: accent2Of(spec), width: 1 },
    })
    slide.addText(`练习 ${index + 1}`, {
      x: x + 0.25,
      y: y + 0.15,
      w: 3.6,
      h: 0.4,
      fontSize: 12,
      fontFace: spec.font,
      color: accentOf(spec),
      bold: true,
    })
    slide.addText(line, {
      x: x + 0.25,
      y: y + 0.55,
      w: 3.6,
      h: 0.45,
      fontSize: 14,
      fontFace: spec.font,
      color: spec.palette.ink,
      bold: true,
    })
  })
}

function cardsIncidents(slide, spec, content) {
  header(slide, spec, content.title)
  const lines = contentLines(content.body)
  const incidents = [
    ["P0", lines[0] ?? "核心故障", "恢复目标 30 分钟"],
    ["P1", lines[1] ?? "性能劣化", "恢复目标 4 小时"],
    ["P2", lines[2] ?? "体验问题", "恢复目标 24 小时"],
  ]
  incidents.forEach((incident, index) => {
    const y = 1.7 + index * 0.9
    slide.addShape(ShapeType.roundRect, {
      x: 0.85,
      y,
      w: 1.1,
      h: 0.65,
      rectRadius: 0.06,
      fill: { color: index === 0 ? (spec.palette.orange ?? accentOf(spec)) : accentOf(spec) },
    })
    slide.addText(incident[0], {
      x: 1.0,
      y: y + 0.12,
      w: 0.8,
      h: 0.4,
      fontSize: 14,
      fontFace: spec.font,
      color: spec.palette.page,
      bold: true,
      align: "center",
    })
    slide.addText(incident[1], {
      x: 2.3,
      y: y + 0.1,
      w: 4.5,
      h: 0.45,
      fontSize: 14,
      fontFace: spec.font,
      color: spec.palette.ink,
      bold: true,
    })
    slide.addText(incident[2], {
      x: 7.0,
      y: y + 0.12,
      w: 2.0,
      h: 0.45,
      fontSize: 11,
      fontFace: spec.font,
      color: spec.palette.gray,
      align: "right",
    })
  })
}

function cardsIssues(slide, spec, content) {
  header(slide, spec, content.title)
  const lines = contentLines(content.body)
  lines.slice(0, 4).forEach((line, index) => {
    const y = 1.7 + index * 0.78
    slide.addText(`#${index + 1}`, {
      x: 0.9,
      y,
      w: 0.8,
      h: 0.4,
      fontSize: 13,
      fontFace: spec.font,
      color: accentOf(spec),
      bold: true,
    })
    slide.addText(line, { x: 1.9, y, w: 6.7, h: 0.4, fontSize: 14, fontFace: spec.font, color: spec.palette.ink })
    slide.addText(index === 0 ? "OPEN" : "FIXED", {
      x: 8.2,
      y,
      w: 0.8,
      h: 0.4,
      fontSize: 10,
      fontFace: spec.font,
      color: index === 0 ? accentOf(spec) : spec.palette.gray,
      bold: true,
      align: "right",
    })
  })
}

function renderData(slide, spec, content, page, total) {
  switch (spec.layout.data) {
    case "table":
      dataTable(slide, spec, content)
      break
    case "dashboard":
      dataDashboard(slide, spec, content)
      break
    case "chart":
      dataChart(slide, spec, content)
      break
    case "research":
      dataResearch(slide, spec, content)
      break
    case "financial":
      dataFinancial(slide, spec, content)
      break
    case "metrics":
      dataMetrics(slide, spec, content)
      break
    case "blueprint":
      dataBlueprint(slide, spec, content)
      break
    case "logs":
      dataLogs(slide, spec, content)
      break
    default:
      dataTable(slide, spec, content)
  }
  addFooter(slide, spec, page, total)
}

function dataTable(slide, spec, content) {
  header(slide, spec, content.title)
  const rows = [
    ["指标", "Q1", "Q2", "变化"],
    ["营收", "1.28 亿", "1.64 亿", "+28%"],
    ["活跃用户", "82 万", "106 万", "+29%"],
    ["转化率", "3.6%", "4.4%", "+0.8pt"],
  ]
  slide.addTable(rows, {
    x: 0.85,
    y: 1.7,
    w: 8.3,
    h: 2.6,
    border: { pt: 1, color: spec.palette.gray },
    fontSize: 13,
    fontFace: spec.font,
    color: spec.palette.ink,
    fill: { color: spec.palette.page },
  })
}

function dataDashboard(slide, spec, content) {
  header(slide, spec, content.title)
  const cards = [
    ["成功率", "92.4%", "↑ 3.2pt"],
    ["P95 延迟", "4.8s", "↓ 18%"],
    ["单次成本", "¥0.42", "↓ 22%"],
    ["可靠性", "99.7%", "SLO"],
  ]
  cards.forEach((card, index) => {
    const x = 0.85 + (index % 2) * 4.35
    const y = 1.6 + Math.floor(index / 2) * 1.25
    slide.addShape(ShapeType.roundRect, {
      x,
      y,
      w: 4.05,
      h: 1.0,
      rectRadius: 0.07,
      fill: { color: spec.palette.page },
      line: { color: accent2Of(spec), width: 1 },
    })
    slide.addText(card[0], {
      x: x + 0.25,
      y: y + 0.12,
      w: 2.0,
      h: 0.4,
      fontSize: 12,
      fontFace: spec.font,
      color: spec.palette.gray,
    })
    slide.addText(card[1], {
      x: x + 0.25,
      y: y + 0.48,
      w: 2.4,
      h: 0.45,
      fontSize: 22,
      fontFace: spec.font,
      color: spec.palette.ink,
      bold: true,
    })
    slide.addText(card[2], {
      x: x + 2.55,
      y: y + 0.52,
      w: 1.3,
      h: 0.4,
      fontSize: 11,
      fontFace: spec.font,
      color: accentOf(spec),
      bold: true,
      align: "right",
    })
  })
  slide.addChart(
    "line",
    [
      {
        name: "趋势",
        labels: ["W1", "W2", "W3", "W4", "W5", "W6", "W7"],
        values: [72, 78, 84, 91, 88, 95, 99],
      },
    ],
    {
      x: 0.9,
      y: 3.9,
      w: 8.2,
      h: 1.2,
      chartColors: [accentOf(spec), accent2Of(spec)],
      showLegend: false,
      showTitle: false,
      catAxisLabelColor: spec.palette.gray,
      catAxisLabelFontSize: 9,
      valAxisLabelColor: spec.palette.gray,
      valAxisLabelFontSize: 9,
    },
  )
}

function dataChart(slide, spec, content) {
  header(slide, spec, content.title)
  slide.addChart(
    "bar",
    [
      {
        name: "趋势",
        labels: ["W1", "W2", "W3", "W4", "W5", "W6", "W7"],
        values: [72, 78, 84, 91, 88, 95, 99],
      },
    ],
    {
      x: 0.9,
      y: 1.75,
      w: 8.2,
      h: 2.75,
      chartColors: [accentOf(spec), accent2Of(spec)],
      showLegend: false,
      showTitle: false,
      catAxisLabelColor: spec.palette.gray,
      catAxisLabelFontSize: 10,
      valAxisLabelColor: spec.palette.gray,
      valAxisLabelFontSize: 10,
    },
  )
}

function dataResearch(slide, spec, content) {
  header(slide, spec, content.title)
  const lines = contentLines(content.body)
  slide.addText("研究方法：样本、来源、对照和显著性说明。", {
    x: 0.9,
    y: 1.75,
    w: 5.4,
    h: 0.5,
    fontSize: 13,
    fontFace: spec.font,
    color: spec.palette.gray,
  })
  slide.addShape(ShapeType.rect, {
    x: 0.9,
    y: 2.4,
    w: 8.2,
    h: 2.2,
    fill: { color: spec.palette.page },
    line: { color: accent2Of(spec), width: 1 },
  })
  slide.addText(lines.join("\n\n"), {
    x: 1.3,
    y: 2.75,
    w: 7.4,
    h: 1.5,
    fontSize: 15,
    fontFace: spec.font,
    color: spec.palette.ink,
    valign: "top",
  })
}

function dataFinancial(slide, spec, content) {
  header(slide, spec, content.title)
  const rows = [
    ["项目", "预算", "实际", "偏差"],
    ["收入", "12.0", "12.6", "+5%"],
    ["成本", "7.8", "7.4", "-5%"],
    ["利润", "4.2", "5.2", "+24%"],
  ]
  slide.addTable(rows, {
    x: 0.85,
    y: 1.7,
    w: 8.3,
    h: 2.6,
    border: { pt: 1, color: spec.palette.gray },
    fontSize: 13,
    fontFace: spec.font,
    color: spec.palette.ink,
    fill: { color: spec.palette.page },
  })
  slide.addChart(
    "bar",
    [
      {
        name: "预算 vs 实际",
        labels: ["收入", "成本", "利润"],
        values: [12.0, 7.8, 4.2],
      },
      {
        name: "实际",
        labels: ["收入", "成本", "利润"],
        values: [12.6, 7.4, 5.2],
      },
    ],
    {
      x: 0.9,
      y: 4.3,
      w: 8.2,
      h: 0.85,
      chartColors: [accentOf(spec), accent2Of(spec)],
      showLegend: false,
      showTitle: false,
      catAxisLabelColor: spec.palette.gray,
      catAxisLabelFontSize: 9,
      valAxisLabelColor: spec.palette.gray,
      valAxisLabelFontSize: 9,
    },
  )
}

function dataMetrics(slide, spec, content) {
  header(slide, spec, content.title)
  const metrics = [
    ["核心指标", "目标", "当前"],
    ["转化率", "4.0%", "4.4%"],
    ["NPS", "45", "52"],
    ["复购率", "30%", "34%"],
  ]
  metrics.forEach((row, index) => {
    const y = 1.65 + index * 0.78
    const color = index === 0 ? spec.palette.gray : accentOf(spec)
    slide.addShape(ShapeType.rect, {
      x: 0.85,
      y,
      w: 4.0,
      h: 0.6,
      fill: { color: spec.palette.page },
      line: { color: color, width: index === 0 ? 1 : 0.75 },
    })
    slide.addText(row[0], {
      x: 1.1,
      y: y + 0.1,
      w: 2.6,
      h: 0.4,
      fontSize: 13,
      fontFace: spec.font,
      color: spec.palette.ink,
      bold: true,
    })
    slide.addText(row[1], {
      x: 3.4,
      y: y + 0.1,
      w: 0.7,
      h: 0.4,
      fontSize: 11,
      fontFace: spec.font,
      color: spec.palette.gray,
      align: "center",
    })
    slide.addText(row[2], {
      x: 4.1,
      y: y + 0.1,
      w: 0.6,
      h: 0.4,
      fontSize: 11,
      fontFace: spec.font,
      color: accentOf(spec),
      bold: true,
      align: "right",
    })
  })
  slide.addChart(
    "doughnut",
    [
      {
        name: "构成",
        labels: ["转化", "NPS", "复购", "其他"],
        values: [34, 52, 28, 14],
      },
    ],
    {
      x: 5.15,
      y: 1.6,
      w: 4.0,
      h: 3.2,
      chartColors: [accentOf(spec), accent2Of(spec), spec.palette.gray, spec.palette.page],
      showLegend: true,
      showTitle: false,
      legendColor: spec.palette.gray,
      legendFontSize: 10,
    },
  )
}

function dataBlueprint(slide, spec, content) {
  header(slide, spec, content.title)
  const lines = contentLines(content.body)
  lines.slice(0, 4).forEach((line, index) => {
    const y = 1.7 + index * 0.72
    slide.addText(`SYS-${index + 1}`, {
      x: 0.9,
      y,
      w: 1.3,
      h: 0.4,
      fontSize: 12,
      fontFace: spec.font,
      color: accentOf(spec),
      bold: true,
    })
    slide.addText(line, { x: 2.4, y, w: 6.4, h: 0.4, fontSize: 14, fontFace: spec.font, color: spec.palette.ink })
  })
  slide.addText("数据采集 → 校验 → 指标化 → 可视化", {
    x: 0.9,
    y: 4.75,
    w: 8.0,
    h: 0.4,
    fontSize: 11,
    fontFace: spec.font,
    color: spec.palette.gray,
  })
}

function dataLogs(slide, spec, content) {
  header(slide, spec, content.title)
  const lines = contentLines(content.body)
  lines.slice(0, 5).forEach((line, index) => {
    const y = 1.7 + index * 0.58
    slide.addText(`[${String(Date.now()).slice(-4)}]`, {
      x: 0.9,
      y,
      w: 1.4,
      h: 0.35,
      fontSize: 11,
      fontFace: spec.font,
      color: accentOf(spec),
      bold: true,
    })
    slide.addText(line, { x: 2.4, y, w: 6.4, h: 0.35, fontSize: 13, fontFace: spec.font, color: spec.palette.ink })
  })
  slide.addText("$ tail -f /var/log/ppt", {
    x: 0.9,
    y: 4.75,
    w: 4.0,
    h: 0.4,
    fontSize: 12,
    fontFace: spec.font,
    color: spec.palette.gray,
  })
}

function renderClosing(slide, spec, content, page, total) {
  switch (spec.layout.closing) {
    case "centered":
      closingCentered(slide, spec, content)
      break
    case "quote":
      closingQuote(slide, spec, content)
      break
    case "cta":
      closingCta(slide, spec, content)
      break
    case "signature":
      closingSignature(slide, spec, content)
      break
    case "official":
      closingOfficial(slide, spec, content)
      break
    case "terminal":
      closingTerminal(slide, spec, content)
      break
    case "next":
      closingNext(slide, spec, content)
      break
    default:
      closingCentered(slide, spec, content)
  }
  addFooter(slide, spec, page, total)
}

function closingCentered(slide, spec, content) {
  slide.addShape(ShapeType.rect, { x: 0, y: 0, w: W, h: 0.16, fill: { color: accentOf(spec) } })
  slide.addText(content.title, {
    x: 0.8,
    y: 1.9,
    w: 8.4,
    h: 1.2,
    fontSize: 44,
    fontFace: spec.font,
    color: spec.palette.ink,
    bold: true,
    align: "center",
  })
  slide.addText(content.body, {
    x: 1.7,
    y: 3.3,
    w: 6.6,
    h: 0.8,
    fontSize: 15,
    fontFace: spec.font,
    color: spec.palette.gray,
    align: "center",
  })
}

function closingQuote(slide, spec, content) {
  slide.addText("“", {
    x: 0.8,
    y: 1.1,
    w: 1.0,
    h: 1.2,
    fontSize: 64,
    fontFace: spec.font,
    color: accentOf(spec),
    bold: true,
  })
  slide.addText(content.title, {
    x: 1.8,
    y: 1.8,
    w: 7.0,
    h: 1.0,
    fontSize: 36,
    fontFace: spec.font,
    color: spec.palette.ink,
    bold: true,
  })
  slide.addText(content.body, {
    x: 1.85,
    y: 3.0,
    w: 6.6,
    h: 1.0,
    fontSize: 16,
    fontFace: spec.font,
    color: spec.palette.gray,
  })
}

function closingCta(slide, spec, content) {
  slide.addShape(ShapeType.rect, { x: 0, y: 0, w: W, h: H, fill: { color: spec.palette.bg } })
  slide.addShape(ShapeType.ellipse, {
    x: 7.3,
    y: 3.6,
    w: 3.2,
    h: 3.2,
    fill: { color: accentOf(spec), transparency: 50 },
  })
  slide.addText(content.title, {
    x: 0.85,
    y: 1.85,
    w: 7.5,
    h: 1.2,
    fontSize: 42,
    fontFace: spec.font,
    color: spec.palette.ink,
    bold: true,
  })
  slide.addText(content.body, {
    x: 0.9,
    y: 3.25,
    w: 6.4,
    h: 0.9,
    fontSize: 16,
    fontFace: spec.font,
    color: spec.palette.gray,
  })
  slide.addShape(ShapeType.roundRect, {
    x: 0.9,
    y: 4.35,
    w: 2.2,
    h: 0.65,
    rectRadius: 0.08,
    fill: { color: accentOf(spec) },
  })
  slide.addText("下一步", {
    x: 1.15,
    y: 4.5,
    w: 1.7,
    h: 0.35,
    fontSize: 13,
    fontFace: spec.font,
    color: spec.palette.page,
    bold: true,
    align: "center",
  })
}

function closingSignature(slide, spec, content) {
  slide.addText("NovaWay", {
    x: 0.85,
    y: 1.0,
    w: 3.0,
    h: 0.5,
    fontSize: 16,
    fontFace: spec.font,
    color: accentOf(spec),
    bold: true,
  })
  slide.addShape(ShapeType.rect, { x: 0.85, y: 1.6, w: 8.3, h: 0.06, fill: { color: spec.palette.gray } })
  slide.addText(content.title, {
    x: 0.9,
    y: 2.35,
    w: 8.0,
    h: 1.2,
    fontSize: 38,
    fontFace: spec.font,
    color: spec.palette.ink,
    bold: true,
  })
  slide.addText(content.body, {
    x: 0.95,
    y: 3.8,
    w: 7.0,
    h: 0.8,
    fontSize: 15,
    fontFace: spec.font,
    color: spec.palette.gray,
  })
}

function closingOfficial(slide, spec, content) {
  slide.addShape(ShapeType.rect, { x: 0, y: 0, w: W, h: 0.14, fill: { color: spec.palette.red ?? accentOf(spec) } })
  slide.addShape(ShapeType.rect, {
    x: 0,
    y: H - 0.14,
    w: W,
    h: 0.14,
    fill: { color: spec.palette.red ?? accentOf(spec) },
  })
  slide.addText(content.title, {
    x: 1.0,
    y: 2.0,
    w: 8.0,
    h: 1.2,
    fontSize: 40,
    fontFace: spec.font,
    color: spec.palette.ink,
    bold: true,
    align: "center",
  })
  slide.addText(content.body, {
    x: 2.0,
    y: 3.3,
    w: 6.0,
    h: 0.8,
    fontSize: 14,
    fontFace: spec.font,
    color: spec.palette.gray,
    align: "center",
  })
}

function closingTerminal(slide, spec, content) {
  slide.addShape(ShapeType.rect, { x: 0, y: 0, w: W, h: H, fill: { color: spec.palette.bg } })
  slide.addShape(ShapeType.rect, { x: 0, y: 0, w: W, h: 0.55, fill: { color: spec.palette.page } })
  slide.addText("●  ●  ●", {
    x: 0.35,
    y: 0.16,
    w: 1.2,
    h: 0.3,
    fontSize: 12,
    fontFace: spec.font,
    color: spec.palette.gray,
  })
  slide.addText("$ nova --summary", {
    x: 0.7,
    y: 1.05,
    w: 4.0,
    h: 0.4,
    fontSize: 14,
    fontFace: spec.font,
    color: accentOf(spec),
    bold: true,
  })
  slide.addText(content.title, {
    x: 0.7,
    y: 2.0,
    w: 8.2,
    h: 1.2,
    fontSize: 38,
    fontFace: spec.font,
    color: spec.palette.ink,
    bold: true,
  })
  slide.addText(content.body, {
    x: 0.75,
    y: 3.5,
    w: 7.8,
    h: 0.9,
    fontSize: 15,
    fontFace: spec.font,
    color: spec.palette.gray,
  })
}

function closingNext(slide, spec, content) {
  slide.addText(content.title, {
    x: 0.85,
    y: 1.5,
    w: 8.0,
    h: 1.2,
    fontSize: 42,
    fontFace: spec.font,
    color: spec.palette.ink,
    bold: true,
  })
  slide.addText(content.body, {
    x: 0.9,
    y: 2.9,
    w: 6.2,
    h: 0.9,
    fontSize: 15,
    fontFace: spec.font,
    color: spec.palette.gray,
  })
  slide.addShape(ShapeType.ellipse, {
    x: 7.0,
    y: 2.9,
    w: 1.9,
    h: 1.9,
    fill: { color: accent2Of(spec), transparency: 30 },
  })
  slide.addText("NEXT", {
    x: 7.45,
    y: 3.55,
    w: 1.0,
    h: 0.5,
    fontSize: 15,
    fontFace: spec.font,
    color: spec.palette.ink,
    bold: true,
    align: "center",
  })
}

function header(slide, spec, title) {
  slide.addShape(ShapeType.rect, { x: 0, y: 0, w: W, h: 0.12, fill: { color: accentOf(spec) } })
  slide.addText(title, {
    x: 0.85,
    y: 0.55,
    w: 6.8,
    h: 0.52,
    fontSize: 26,
    fontFace: spec.font,
    color: spec.palette.ink,
    bold: true,
  })
  slide.addText("NovaWay / PPT", {
    x: 6.8,
    y: 0.62,
    w: 2.35,
    h: 0.36,
    fontSize: 11,
    fontFace: spec.font,
    color: spec.palette.gray,
    align: "right",
  })
}

function addFooter(slide, spec, page, total) {
  slide.addShape(ShapeType.line, { x: 0.85, y: 5.28, w: 8.3, h: 0, line: { color: spec.palette.gray, width: 1 } })
  slide.addText(`${page} / ${total}`, {
    x: 7.7,
    y: 5.32,
    w: 1.45,
    h: 0.3,
    fontSize: 10,
    fontFace: spec.font,
    color: spec.palette.gray,
    align: "right",
  })
}

function contentLines(content) {
  return content
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-*•]\s*/, "").trim())
    .filter(Boolean)
}

for (const spec of templates) {
  const pptx = buildPptx(spec)
  const targetDir = join(outputRoot, spec.id)
  await mkdir(targetDir, { recursive: true })
  const bytes = await pptx.write({ outputType: "nodebuffer" })
  await writeFile(join(targetDir, "template.pptx"), bytes)
  console.log(`生成 ${spec.id}/template.pptx (${(bytes.byteLength / 1024).toFixed(1)} KB)`)
}

console.log(`完成：${templates.length} 套真实 PPTX，每套独立版式组合`)
