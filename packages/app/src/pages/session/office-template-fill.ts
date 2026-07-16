import type { OfficeArtifact, OfficeSlide } from "./office-artifact"
import { bytesToBase64 } from "./office-export"

export type OfficePptxTemplateFillSlide = {
  slide: number
  texts: string[]
  images?: OfficePptxTemplateFillImage[]
  tables?: string[][][]
  charts?: OfficePptxTemplateFillChart[]
}

export type OfficePptxTemplateFillImage = {
  mime: string
  dataBase64: string
}

export type OfficePptxTemplateFillChart = {
  categories: string[]
  series: Array<{ name: string; values: number[] }>
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
    charts: officePptxFillCharts(tablesBySlide.get(slide.index) ?? []),
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
    }),
    { texts: 0, images: 0, tables: 0, charts: 0 },
  )
  return `已带入 ${summary.texts} 段文本、${summary.images} 张图片、${summary.tables} 个表格、${summary.charts} 个图表`
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

function officePptxFillCharts(tables: string[][][]) {
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
      return [{ categories: rows.map((row) => row[0] ?? ""), series }]
    })
    .slice(0, 4)
}

function numericCell(value: string) {
  const parsed = Number(value.replace(/,/g, "").replace(/%$/, ""))
  if (!Number.isFinite(parsed)) return
  return parsed
}
