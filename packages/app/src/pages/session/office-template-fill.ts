import type { OfficeArtifact, OfficeSlide } from "./office-artifact"
import { bytesToBase64 } from "./office-export"

export type OfficePptxTemplateFillSlide = {
  slide: number
  texts: string[]
  images?: OfficePptxTemplateFillImage[]
  tables?: string[][][]
  charts?: OfficePptxTemplateFillChart[]
  shapeOverrides?: OfficeSlide["shapeOverrides"]
  audio?: OfficePptxTemplateFillAudio
}

export type OfficePptxTemplateFillImage = {
  mime: string
  dataBase64: string
}

export type OfficePptxTemplateFillChart = {
  categories: string[]
  series: Array<{ name: string; values: number[] }>
  chartType?: "bar" | "line" | "area" | "radar" | "scatter" | "bubble" | "donut" | "waterfall" | "combo"
  chartOptions?: {
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
}

export type OfficePptxTemplateFillAudio = {
  mime: string
  dataBase64: string
  name?: string
  startFloor?: number
  padding?: number
  subtitles?: Array<{ startMs: number; endMs: number; text: string }>
}

export type OfficePptxTemplateFillClient = {
  office: {
    pptxTemplate: {
      fill: (parameters: {
        directory: string
        filename: string
        templateBase64: string
        slides: OfficePptxTemplateFillSlide[]
      }) => Promise<{ data?: { path: string; bytes: number | string } }>
    }
  }
}

export function fillOfficePptxTemplate(input: {
  client: OfficePptxTemplateFillClient
  directory: string
  filename: string
  templateBytes: Uint8Array
  slides: OfficePptxTemplateFillSlide[]
}) {
  return input.client.office.pptxTemplate.fill({
    directory: input.directory,
    filename: input.filename,
    templateBase64: bytesToBase64(input.templateBytes),
    slides: input.slides,
  })
}

export function officePptxFillPlanFromArtifact(artifact: OfficeArtifact) {
  const tablesBySlide = new Map(artifact.slides.map((slide) => [slide.index, officePptxFillTables(slide)] as const))
  return artifact.slides.map((slide) => ({
    slide: slide.index,
    texts: officePptxFillTexts(slide),
    images: officePptxFillImages(slide),
    tables: tablesBySlide.get(slide.index) ?? [],
    charts: officePptxFillCharts(tablesBySlide.get(slide.index) ?? [], slide),
    ...(slide.shapeOverrides?.length ? { shapeOverrides: slide.shapeOverrides } : {}),
    ...(slide.audio
      ? {
          audio: {
            mime: slide.audio.mime,
            dataBase64: slide.audio.dataBase64,
            name: slide.audio.name,
            ...(slide.audio.startFloor === undefined ? {} : { startFloor: slide.audio.startFloor }),
            ...(slide.audio.padding === undefined ? {} : { padding: slide.audio.padding }),
            ...(slide.audio.subtitles ? { subtitles: slide.audio.subtitles } : {}),
          },
        }
      : {}),
  }))
}

export function officePptxTemplateFillFilename(artifact: OfficeArtifact) {
  return `${
    artifact.title
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, "-")
      .replace(/\s+/g, " ")
      .trim() || "office-ppt"
  }-套版.pptx`
}

export function officePptxFillPlanSummary(slides: OfficePptxTemplateFillSlide[]) {
  const summary = slides.reduce(
    (result, slide) => ({
      texts: result.texts + slide.texts.length,
      images: result.images + (slide.images?.length ?? 0),
      tables: result.tables + (slide.tables?.length ?? 0),
      charts: result.charts + (slide.charts?.length ?? 0),
      audio: result.audio + (slide.audio ? 1 : 0),
    }),
    { texts: 0, images: 0, tables: 0, charts: 0, audio: 0 },
  )
  return `已带入 ${summary.texts} 段文本、${summary.images} 张图片、${summary.tables} 个表格、${summary.charts} 个图表${summary.audio ? `、${summary.audio} 段旁白` : ""}`
}

function officePptxFillTexts(slide: OfficeSlide) {
  return [
    slide.title,
    ...slide.content
      .split("\n")
      .map((line) => line.trim().replace(/^[-*]\s*/, ""))
      .filter(Boolean),
  ].slice(0, 24)
}

function officePptxFillImages(slide: OfficeSlide) {
  const text = [slide.visual, slide.content].filter(Boolean).join("\n")
  const pattern =
    /!\[[^\]]*]\((data:image\/(?:png|jpeg|jpg|gif|webp);base64,[^)]+)\)|<img[^>]+src=["'](data:image\/(?:png|jpeg|jpg|gif|webp);base64,[^"']+)["'][^>]*>/gi
  return [...text.matchAll(pattern)]
    .flatMap((match) => {
      const url = match[1] ?? match[2]
      const parsed = url?.match(/^data:(image\/(?:png|jpeg|jpg|gif|webp));base64,([A-Za-z0-9+/=\s]+)$/i)
      if (!parsed?.[1] || !parsed[2]) return []
      return [
        { mime: parsed[1].toLowerCase().replace("image/jpg", "image/jpeg"), dataBase64: parsed[2].replace(/\s+/g, "") },
      ]
    })
    .slice(0, 5)
}

function officePptxFillTables(slide: OfficeSlide) {
  const tables: string[][][] = []
  const rows = slide.content.split("\n").map((line) => line.trim())
  for (let index = 0; index < rows.length; index++) {
    if (!isMarkdownTableRow(rows[index] ?? "")) continue
    const table: string[][] = []
    while (index < rows.length && isMarkdownTableRow(rows[index] ?? "")) {
      const cells = markdownTableCells(rows[index] ?? "")
      if (!cells.every((cell) => /^:?-{3,}:?$/.test(cell))) table.push(cells)
      index++
    }
    if (table.length > 0) tables.push(table)
  }
  return tables.slice(0, 4)
}

function isMarkdownTableRow(line: string) {
  return line.startsWith("|") && line.endsWith("|") && line.split("|").length >= 4
}

function markdownTableCells(line: string) {
  return line
    .slice(1, -1)
    .split("|")
    .map((cell) => cell.trim())
}

function officePptxFillCharts(
  tables: string[][][],
  slide: Pick<OfficeSlide, "layout" | "content" | "chartType" | "chartOptions">,
) {
  return tables
    .flatMap((table) => {
      const header = table[0]
      const rows = table.slice(1)
      if (!header || header.length < 2 || rows.length === 0) return []
      const series = header.slice(1).flatMap((name, index) => {
        const values = rows.map((row) => numericCell(row[index + 1] ?? ""))
        if (values.some((value) => value === undefined)) return []
        return [{ name, values: values as number[] }]
      })
      if (series.length === 0) return []
      const chartType = slide.chartType ?? inferChartType(slide)
      const chart = {
        categories: rows.map((row) => row[0] ?? ""),
        series,
        ...(chartType === "bar" ? {} : { chartType }),
        ...(slide.chartOptions ? { chartOptions: slide.chartOptions } : {}),
      }
      if (slide.chartOptions?.sortData && slide.chartOptions.sortData !== "none") {
        return [sortChartData(chart, slide.chartOptions.sortData)]
      }
      return [chart]
    })
    .slice(0, 4)
}

function sortChartData(chart: OfficePptxTemplateFillChart, direction: "asc" | "desc"): OfficePptxTemplateFillChart {
  const order = chart.categories
    .map((_, index) => index)
    .sort((left, right) => {
      const leftValue = chart.series[0]?.values[left] ?? 0
      const rightValue = chart.series[0]?.values[right] ?? 0
      return direction === "asc" ? leftValue - rightValue : rightValue - leftValue
    })
  return {
    ...chart,
    categories: order.map((index) => chart.categories[index] ?? ""),
    series: chart.series.map((series) => ({
      ...series,
      values: order.map((index) => series.values[index] ?? 0),
    })),
  }
}

function inferChartType(
  slide: Pick<OfficeSlide, "layout" | "content">,
): "bar" | "line" | "area" | "radar" | "scatter" | "bubble" | "donut" | "waterfall" | "combo" {
  const text = `${slide.layout ?? ""}\n${slide.content}`
  if (/组合图|柱线|combo|bar.line|柱状.*折线|折线.*柱状/i.test(text)) return "combo"
  if (slide.layout === "waterfall" || /瀑布|waterfall|增减归因|桥接|变动拆解/i.test(text)) return "waterfall"
  if (/气泡|bubble/i.test(text)) return "bubble"
  if (/散点|相关性|分布关系|scatter/i.test(text)) return "scatter"
  if (slide.layout === "radar" || /雷达|能力评估|多维评分|radar/i.test(text)) return "radar"
  if (/面积|堆积区域|area|stacked area/i.test(text)) return "area"
  if (slide.layout === "line" || /折线|趋势|走势|时间序列|line/i.test(text)) return "line"
  if (slide.layout === "donut" || /环形|占比|比例环|甜甜圈|donut|doughnut/i.test(text)) return "donut"
  return "bar"
}

function numericCell(value: string) {
  const parsed = Number(value.replace(/,/g, "").replace(/%$/, ""))
  if (!Number.isFinite(parsed)) return
  return parsed
}
