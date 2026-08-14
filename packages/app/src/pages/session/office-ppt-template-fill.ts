import JSZip from "jszip"
import type { OfficeArtifact, OfficeSlide, OfficeSlideShapeOverride } from "./office-artifact"
import { officePptxFillPlanFromArtifact, type OfficePptxTemplateFillChart } from "./office-template-fill"
import { officePptTemplateFile, type OfficeExportFile, type OfficePptTemplateChoice } from "./office-export"
import { ommlMathXml, splitFormulaSegments } from "./office-omml"

type Relationship = {
  id: string
  type: string
  target: string
}

type TextShape = {
  block: string
  maxSize: number
  top: number
}

type AnimationShape = {
  id: number
  kind: "sp" | "pic" | "graphicFrame"
  maxSize: number
  area: number
  top: number
}

type AnimationEffectSpec = {
  presetID: number
  presetSubtype: number
  filter: string
  durationMs: number
  kind: "fade" | "wipe" | "fly" | "zoom"
}

type TimingEntry = {
  kind: "audio" | "animation"
  shapeId: number
  durationMs: number
  delayMs: number
  startMs?: number
  effect?: AnimationEffectSpec
}

type MotionSlide = Pick<OfficeSlide, "layout" | "motion">

export type OfficeAssetContent = string | { content: string; encoding?: "base64" }

export type OfficePptTemplateShape = {
  id: number
  name: string
  kind: "text" | "image" | "chart" | "table" | "shape"
  x: number
  y: number
  cx: number
  cy: number
  text?: string
}

type SlideAudio = {
  mime: string
  extension: "wav" | "mp3" | "m4a"
  dataBase64: string
  startFloor?: number
  padding?: number
  subtitles?: Array<{ startMs: number; endMs: number; text: string }>
}

export type OfficePptAnimationGroup = {
  selector: string
  effect?: "fade" | "wipe" | "fly" | "zoom"
  order?: number
  duration?: number
  delay?: number
  stagger?: number
}

export type OfficePptAnimationSlide = {
  transition?: {
    effect: "fade" | "wipe" | "push"
    duration?: number
  }
  groups: OfficePptAnimationGroup[]
}

export type OfficePptAnimationConfig = {
  version: 1
  defaults?: {
    transition?: { effect: "fade" | "wipe" | "push"; duration?: number }
    animation?: {
      effect?: OfficePptAnimationGroup["effect"]
      duration?: number
      stagger?: number
      trigger?: "on-click" | "with-previous" | "after-previous"
    }
  }
  slides: Record<string, OfficePptAnimationSlide>
}

const slideContentType = "application/vnd.openxmlformats-officedocument.presentationml.slide+xml"

export async function createOfficeExportFileFromPptxTemplate(
  artifact: OfficeArtifact,
  template: OfficePptTemplateChoice,
  options?: {
    includeAnimations?: boolean
    includeNarration?: boolean
    readAsset?: (path: string) => Promise<OfficeAssetContent>
  },
): Promise<OfficeExportFile> {
  if (typeof template !== "string" || !officePptTemplateFile(template)) {
    throw new Error("当前模板不是真实 PPTX 模板")
  }
  const templatePath = officePptTemplateFile(template)
  if (!templatePath) throw new Error(`模板文件不存在：${template}`)
  const response = await fetch(templatePath)
  if (!response.ok) throw new Error(`模板加载失败：${template}`)
  const templateBytes = new Uint8Array(await response.arrayBuffer())
  const chartTemplateResponse = await fetch("/assets/office-ppt-templates/chart-template.xml")
  const chartTemplateXml = chartTemplateResponse.ok ? await chartTemplateResponse.text() : undefined
  const animationsResponse = await fetch(templatePath.replace(/\/template\.pptx$/, "/animations.json"))
  const animationsData = animationsResponse.ok ? await animationsResponse.json() : undefined
  const animations = isOfficePptAnimationConfig(animationsData)
    ? animationsData
    : await derivePptxAnimationConfig(templateBytes)
  const includeAnimations = options?.includeAnimations === true
  const exportArtifact =
    options?.includeNarration === false
      ? { ...artifact, slides: artifact.slides.map((slide) => ({ ...slide, audio: undefined })) }
      : artifact
  const hydratedArtifact = options?.readAsset
    ? await hydrateOfficeSlideAssets(exportArtifact, options.readAsset)
    : exportArtifact
  const bytes = await fillPptxTemplate(templateBytes, hydratedArtifact, {
    chartTemplateXml,
    animations: includeAnimations ? animations : undefined,
    disableAnimations: !includeAnimations,
  })
  return {
    filename: `${filenameSafe(artifact.title)}.pptx`,
    mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    bytes,
    label: "导出 PPTX",
  }
}

export async function fillPptxTemplate(
  templateBytes: Uint8Array,
  artifact: OfficeArtifact,
  options?: { chartTemplateXml?: string; animations?: OfficePptAnimationConfig; disableAnimations?: boolean },
): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(templateBytes)
  const presentationXml = await zip.file("ppt/presentation.xml")?.async("string")
  const presentationRels = await zip.file("ppt/_rels/presentation.xml.rels")?.async("string")
  if (!presentationXml || !presentationRels) throw new Error("模板缺少 presentation.xml 或关系文件")
  const notesTemplateXml =
    (await zip.file("ppt/notesSlides/notesSlide1.xml")?.async("string")) ?? defaultNotesSlideXml()
  const hasNotesMaster = Boolean(zip.file("ppt/notesMasters/notesMaster1.xml"))

  const slideRels = parseRelationships(presentationRels).filter((item) => item.type.endsWith("/slide"))
  const sourceSlides = slideRels.map((item) => normalizePartPath(item.target))
  if (!sourceSlides.length) throw new Error("模板中没有可用的幻灯片")

  const slides = normalizePptSlides(
    artifact.slides.length ? artifact.slides : [{ title: artifact.title, content: artifact.body }],
  )
  const fillPlan = officePptxFillPlanFromArtifact(artifact)
  const selected = selectTemplateSlideIndices(sourceSlides.length, slides.length)
  const outputSlides: Array<{ path: string; relPath: string; xml: string; rels: string }> = []
  const notesSlides: Array<{ path: string; relPath: string; xml: string; rels: string }> = []

  const audioDefaultExtensions: Array<{ extension: string; contentType: string }> = []
  for (let index = 0; index < slides.length; index++) {
    const sourceIndex = selected[index] ?? 0
    const sourcePath = sourceSlides[sourceIndex]
    if (!sourcePath) throw new Error("模板幻灯片索引无效")
    const slide = slides[index]
    if (!slide) throw new Error("幻灯片数据缺失")
    const sourceXml = await zip.file(sourcePath)?.async("string")
    if (!sourceXml) throw new Error(`模板缺少幻灯片：${sourcePath}`)
    const sourceRels = (await zip.file(relsPathFor(sourcePath))?.async("string")) ?? defaultSlideRels()
    const plan = fillPlan[index]
    const outputPath = `ppt/slides/slide${index + 1}.xml`
    const outputRelsPath = relsPathFor(outputPath)
    const outputRels = buildOutputSlideRels(sourceRels)
    const audio = slide.audio ? normalizeSlideAudio(slide.audio) : undefined
    const audioDuration = audio ? audioDurationMs(audio) : undefined
    const sourceXmlWithOverrides = applyShapeOverrides(sourceXml, slide.shapeOverrides)
    let filledXml = addSlideTransition(
      fillSlideTables(
        fillSlideText(sourceXmlWithOverrides, slide),
        plan?.tables ?? [],
        slide.shapeOverrides?.find((item) => item.id === 100),
      ),
      slide,
      audio && audioDuration
        ? {
            durationMs: audioDuration,
            startFloorMs: Math.max(0, Math.round((audio.startFloor ?? 0.8) * 1000)),
            paddingMs: Math.max(0, Math.round((audio.padding ?? 0.5) * 1000)),
          }
        : undefined,
    )
    if (audio) {
      const audioRels = addAudioRelations(outputRels, index + 1, audio)
      zip.file(`ppt/media/narration-${index + 1}.${audio.extension}`, base64Bytes(audio.dataBase64))
      zip.file(`ppt/media/narration-icon-${index + 1}.png`, narrationIconBytes())
      filledXml = addAudioShape(filledXml, 9000 + index, audioRels)
      if (!audioDefaultExtensions.some((item) => item.extension === audio.extension)) {
        audioDefaultExtensions.push({
          extension: audio.extension,
          contentType: audioContentType(audio.extension),
        })
      }
    }
    if (!options?.disableAnimations) {
      filledXml = addSlideAnimations(
        filledXml,
        slide,
        audio && audioDuration
          ? {
              shapeId: 9000 + index,
              durationMs: audioDuration,
              startFloor: audio.startFloor ?? 0.8,
              subtitles: audio.subtitles,
            }
          : undefined,
        options?.animations,
        slideAnimationRole(sourceIndex, sourceSlides.length),
      )
    }
    const notesText = slideNotesText(slide)
    if (notesText) {
      const nextRid = `rId${parseRelationships(outputRels.xml).length + 1}`
      outputRels.xml = outputRels.xml.replace(
        "</Relationships>",
        `<Relationship Id="${nextRid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide${index + 1}.xml"/></Relationships>`,
      )
      notesSlides.push({
        path: `ppt/notesSlides/notesSlide${index + 1}.xml`,
        relPath: `ppt/notesSlides/_rels/notesSlide${index + 1}.xml.rels`,
        xml: buildNotesSlideXml(notesTemplateXml, notesText),
        rels: buildNotesRels(index + 1, hasNotesMaster),
      })
    }
    outputSlides.push({
      path: outputPath,
      relPath: outputRelsPath,
      xml: rewriteSlideRelations(filledXml, sourceRels, outputRels),
      rels: outputRels.xml,
    })
  }

  for (const path of sourceSlides) {
    zip.remove(path)
    zip.remove(relsPathFor(path))
  }
  removeUnusedParts(zip)
  const autoChartParts = await replaceSlideCharts(zip, outputSlides, fillPlan, options?.chartTemplateXml)
  replaceSlideImages(zip, outputSlides, fillPlan)

  const contentTypes = (await zip.file("[Content_Types].xml")?.async("string")) ?? ""
  const cleanContentTypes = contentTypes
    .replace(/<Override PartName="\/ppt\/slides\/slide\d+\.xml"[^>]*\/>/g, "")
    .replace(/<Override PartName="\/ppt\/notesSlides\/notesSlide\d+\.xml"[^>]*\/>/g, "")
  const slideOverrides = outputSlides
    .map((slide) => `<Override PartName="/${slide.path}" ContentType="${slideContentType}"/>`)
    .join("")
  const notesOverrides = notesSlides
    .map(
      (slide) =>
        `<Override PartName="/${slide.path}" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml"/>`,
    )
    .join("")
  const chartOverrides = autoChartParts
    .map(
      (path) =>
        `<Override PartName="/${path}" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>`,
    )
    .join("")
  const updatedContentTypes = cleanContentTypes.replace(
    "</Types>",
    `${slideOverrides}${notesOverrides}${chartOverrides}</Types>`,
  )
  const withAudioDefaults = addContentTypeDefaults(updatedContentTypes, audioDefaultExtensions)
  zip.file("[Content_Types].xml", withAudioDefaults)

  const ids = outputSlides.map((_, index) => `<p:sldId id="${256 + index}" r:id="rId${1000 + index}"/>`).join("")
  zip.file(
    "ppt/presentation.xml",
    presentationXml.replace(/<p:sldIdLst>[\s\S]*?<\/p:sldIdLst>/, `<p:sldIdLst>${ids}</p:sldIdLst>`),
  )

  const keptPresentationRels = parseRelationships(presentationRels)
    .filter((item) => !item.type.endsWith("/slide"))
    .map((item) => relationshipXml(item.id, item.type, item.target))
    .join("")
  const newSlideRels = outputSlides
    .map((_, index) =>
      relationshipXml(
        `rId${1000 + index}`,
        "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide",
        `slides/slide${index + 1}.xml`,
      ),
    )
    .join("")
  zip.file("ppt/_rels/presentation.xml.rels", relationshipsDocument(`${keptPresentationRels}${newSlideRels}`))

  for (const slide of outputSlides) {
    zip.file(slide.path, slide.xml)
    zip.file(slide.relPath, slide.rels)
  }
  for (const slide of notesSlides) {
    zip.file(slide.path, slide.xml)
    zip.file(slide.relPath, slide.rels)
  }

  return zip.generateAsync({
    type: "uint8array",
    mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    compression: "DEFLATE",
  })
}

export async function derivePptxAnimationConfig(templateBytes: Uint8Array): Promise<OfficePptAnimationConfig> {
  const zip = await JSZip.loadAsync(templateBytes)
  const presentationRels = await zip.file("ppt/_rels/presentation.xml.rels")?.async("string")
  if (!presentationRels) throw new Error("模板缺少 presentation.xml.rels")
  const sourceSlides = parseRelationships(presentationRels)
    .filter((item) => item.type.endsWith("/slide"))
    .map((item) => normalizePartPath(item.target))
  const slides: Record<string, OfficePptAnimationSlide> = {}
  for (let index = 0; index < sourceSlides.length; index++) {
    const sourcePath = sourceSlides[index]
    if (!sourcePath) continue
    const xml = await zip.file(sourcePath)?.async("string")
    if (!xml) continue
    const shapes = extractAnimationShapes(xml)
    const titleShape = shapes.find((shape) => shape.kind === "sp" && shape.maxSize >= 1800)
    const groups: OfficePptAnimationGroup[] = []
    for (const shape of shapes) {
      const selector = animationShapeSelector(shape, shape.id === titleShape?.id)
      if (groups.some((group) => group.selector === selector)) continue
      const effect: OfficePptAnimationGroup["effect"] =
        selector === "chart"
          ? "wipe"
          : selector === "cards" || selector === "image"
            ? "fade"
            : selector === "title"
              ? "fade"
              : "fade"
      groups.push({
        selector,
        effect,
        duration: selector === "title" ? 0.5 : 0.4,
        delay: selector === "title" ? 0 : 0.2,
        stagger: 0.2,
      })
    }
    slides[slideAnimationRole(index, sourceSlides.length)] = { groups }
  }
  return {
    version: 1,
    defaults: {
      transition: { effect: "fade", duration: 0.35 },
      animation: { effect: "fade", duration: 0.4, stagger: 0.2, trigger: "after-previous" },
    },
    slides,
  }
}

function normalizePptSlides(
  slides: Array<
    Pick<OfficeSlide, "title" | "content" | "layout" | "notes" | "audio" | "motion" | "shapeOverrides" | "assets">
  >,
): Array<{
  title: string
  content: string
  layout?: OfficeSlide["layout"]
  notes?: string
  audio?: OfficeSlide["audio"]
  motion?: OfficeSlide["motion"]
  shapeOverrides?: OfficeSlide["shapeOverrides"]
  assets?: string[]
}> {
  return slides.map((slide, index) => ({
    title: slide.title || `第 ${index + 1} 页`,
    content: slide.content || "",
    layout: slide.layout,
    notes: slide.notes,
    audio: slide.audio,
    motion: slide.motion,
    shapeOverrides: slide.shapeOverrides,
    assets: slide.assets,
  }))
}

export async function officePptTemplateSlideShapes(
  template: OfficePptTemplateChoice,
  role: string,
  templateBytes?: Uint8Array,
  options?: { pageIndex?: number; totalPages?: number },
): Promise<OfficePptTemplateShape[]> {
  const bytes = templateBytes ?? (await loadTemplateBytes(template))
  if (!bytes) return []
  const zip = await JSZip.loadAsync(bytes)
  const presentationRels = await zip.file("ppt/_rels/presentation.xml.rels")?.async("string")
  if (!presentationRels) return []
  const sourceSlides = parseRelationships(presentationRels)
    .filter((item) => item.type.endsWith("/slide"))
    .map((item) => normalizePartPath(item.target))
  if (!sourceSlides.length) return []
  const sourceIndex =
    options?.pageIndex !== undefined && options.totalPages
      ? (selectTemplateSlideIndices(sourceSlides.length, options.totalPages)[options.pageIndex] ?? 0)
      : slideRoleSourceIndex(role, sourceSlides.length)
  const sourcePath = sourceSlides[sourceIndex]
  const slideXml = sourcePath ? await zip.file(sourcePath)?.async("string") : undefined
  const shapes = slideXml ? parseTemplateSlideShapes(slideXml) : []
  if (role === "data" && !shapes.some((item) => item.id === 200)) {
    shapes.push({
      id: 200,
      name: "Chart",
      kind: "chart",
      x: 685800,
      y: 1550000,
      cx: 7772400,
      cy: 2600000,
    })
  }
  return shapes
}

function selectTemplateSlideIndices(sourceCount: number, targetCount: number): number[] {
  if (sourceCount <= 0) return []
  if (targetCount <= 1) return [0]
  if (targetCount <= sourceCount) {
    const step = (sourceCount - 1) / (targetCount - 1)
    return Array.from({ length: targetCount }, (_, index) => Math.round(index * step))
  }
  const step = (sourceCount - 1) / (targetCount - 1)
  return Array.from({ length: targetCount }, (_, index) => Math.min(sourceCount - 1, Math.round(index * step)))
}

function slideRoleSourceIndex(role: string, sourceCount: number) {
  const roles = ["cover", "overview", "content", "cards", "data", "closing"]
  if (sourceCount <= 1) return 0
  if (role === "cover") return 0
  if (role === "closing") return sourceCount - 1
  const roleIndex = Math.max(1, roles.indexOf(role))
  return Math.min(sourceCount - 1, Math.round((roleIndex / (roles.length - 1)) * (sourceCount - 1)))
}

function parseTemplateSlideShapes(xml: string): OfficePptTemplateShape[] {
  const result: OfficePptTemplateShape[] = []
  const shapePattern = /<(p:sp|p:pic|p:graphicFrame|p:cxnSp)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/g
  for (const match of xml.matchAll(shapePattern)) {
    const block = match[0]
    const identity = block.match(/<p:cNvPr id="(\d+)" name="([^"]*)"/)
    if (!identity) continue
    const id = Number(identity[1])
    if (id <= 1) continue
    const metrics = shapeMetrics(block)
    if (metrics.cx <= 0 || metrics.cy <= 0) continue
    const kind: OfficePptTemplateShape["kind"] =
      match[1] === "p:pic"
        ? "image"
        : match[1] === "p:graphicFrame"
          ? block.includes("drawingml/2006/chart")
            ? "chart"
            : block.includes("drawingml/2006/table")
              ? "table"
              : "shape"
          : match[1] === "p:cxnSp"
            ? "shape"
            : "text"
    result.push({
      id,
      name: decodeXmlEntity(identity[2] ?? ""),
      kind,
      x: metrics.x,
      y: metrics.y,
      cx: metrics.cx,
      cy: metrics.cy,
      text: decodeXmlEntity(block.match(/<a:t>([\s\S]*?)<\/a:t>/)?.[1] ?? "").slice(0, 40) || undefined,
    })
  }
  return result.toSorted((left, right) => left.y - right.y || left.x - right.x)
}

function applyShapeOverrides(xml: string, overrides?: OfficeSlide["shapeOverrides"]) {
  if (!overrides?.length) return xml
  const byId = new Map(overrides.map((item) => [item.id, item]))
  return xml.replace(
    /(<(?:p:sp|p:pic|p:graphicFrame|p:cxnSp)(?:\s[^>]*)?>)([\s\S]*?)(<\/(?:p:sp|p:pic|p:graphicFrame|p:cxnSp)>)/g,
    (match, open: string, inner: string, close: string) => {
      const id = Number(inner.match(/<p:cNvPr id="(\d+)"/)?.[1] ?? 0)
      const override = byId.get(id)
      if (!override) return match
      const metrics = shapeMetrics(inner)
      let next = inner
      if (override.x !== undefined || override.y !== undefined) {
        next = next.replace(
          /(<a:off x=")\d+(" y=")\d+("\/>)/,
          (full, preX: string, midY: string, post: string) =>
            `${preX}${override.x ?? metrics.x}${midY}${override.y ?? metrics.y}${post}`,
        )
      }
      if (override.cx !== undefined || override.cy !== undefined) {
        next = next.replace(
          /(<a:ext cx=")\d+(" cy=")\d+("\/>)/,
          (full, preCx: string, midCy: string, post: string) =>
            `${preCx}${override.cx ?? metrics.cx}${midCy}${override.cy ?? metrics.cy}${post}`,
        )
      }
      return `${open}${next}${close}`
    },
  )
}

async function loadTemplateBytes(template: OfficePptTemplateChoice) {
  const templatePath = officePptTemplateFile(template)
  if (!templatePath) return undefined
  const response = await fetch(templatePath)
  if (!response.ok) return undefined
  return new Uint8Array(await response.arrayBuffer())
}

function parseRelationships(xml: string): Relationship[] {
  const result: Relationship[] = []
  const pattern = /<Relationship\s+Id="([^"]+)"\s+Type="([^"]+)"\s+Target="([^"]+)"\s*\/>/g
  for (const match of xml.matchAll(pattern)) {
    result.push({ id: match[1], type: match[2], target: match[3] })
  }
  return result
}

export async function officePptTemplateSlideCount(templateBytes: Uint8Array) {
  const zip = await JSZip.loadAsync(templateBytes)
  const presentationRels = await zip.file("ppt/_rels/presentation.xml.rels")?.async("string")
  return parseRelationships(presentationRels ?? "").filter((item) => item.type.endsWith("/slide")).length
}

function relationshipXml(id: string, type: string, target: string) {
  return `<Relationship Id="${xml(id)}" Type="${xml(type)}" Target="${xml(target)}"/>`
}

function relationshipsDocument(body: string) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${body}</Relationships>`
}

function defaultSlideRels() {
  return relationshipsDocument(
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>',
  )
}

function defaultNotesSlideXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:notes xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr><p:sp><p:nvSpPr><p:cNvPr id="2" name="Notes Placeholder 2"/><p:cNvSpPr/><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US" dirty="0"/><a:t></a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:notes>`
}

function buildNotesSlideXml(template: string, notes: string) {
  return template.replace(/(<a:t(?:\s[^>]*)?>)[\s\S]*?(<\/a:t>)/, `$1${xml(notes)}$2`)
}

function slideNotesText(slide: { notes?: string; assets?: string[] }) {
  return [slide.notes, ...(slide.assets?.length ? [`素材来源：${slide.assets.join("、")}`] : [])]
    .filter(Boolean)
    .join("\n")
}

function buildNotesRels(slideIndex: number, hasNotesMaster: boolean) {
  const master = hasNotesMaster
    ? '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesMaster" Target="../notesMasters/notesMaster1.xml"/>'
    : ""
  const slide = `<Relationship Id="${hasNotesMaster ? "rId2" : "rId1"}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="../slides/slide${slideIndex}.xml"/>`
  return relationshipsDocument(`${master}${slide}`)
}

function buildOutputSlideRels(sourceRels: string): { xml: string; mapping: Record<string, string> } {
  const relationships = parseRelationships(sourceRels).filter((item) => !item.type.endsWith("/notesSlide"))
  const mapping: Record<string, string> = {}
  const body = relationships
    .map((item, index) => {
      const nextId = `rId${index + 1}`
      mapping[item.id] = nextId
      return relationshipXml(nextId, item.type, item.target)
    })
    .join("")
  return { xml: relationshipsDocument(body), mapping }
}

function rewriteSlideRelations(xml: string, sourceRels: string, outputRels: { mapping: Record<string, string> }) {
  let result = xml
  for (const relationship of parseRelationships(sourceRels)) {
    const next = outputRels.mapping[relationship.id]
    if (!next) continue
    result = result
      .replace(new RegExp(`r:embed="${relationship.id}"`, "g"), `r:embed="${next}"`)
      .replace(new RegExp(`r:link="${relationship.id}"`, "g"), `r:link="${next}"`)
  }
  return result
}

function removeUnusedParts(zip: JSZip) {
  for (const path of Object.keys(zip.files)) {
    if (path.startsWith("ppt/notesSlides/") || path.startsWith("ppt/printerSettings/")) zip.remove(path)
  }
}

function fillSlideText(xml: string, slide: { title: string; content: string }): string {
  const shapes = extractTextShapes(xml).filter((item) => item.maxSize >= 1200)
  if (!shapes.length) return xml
  const title = pickTitleShape(shapes)
  const rawLines = contentLines(slide.content)
  const lines = rawLines.length ? rawLines : [slide.content.trim()]
  let result = replaceShapeText(xml, title, [slide.title])
  const contentShapes = shapes
    .filter((item) => item.block !== title.block)
    .toSorted((a, b) => a.top - b.top || b.maxSize - a.maxSize)
  contentShapes.forEach((shape, index) => {
    const shapeLines = lines.filter((_, lineIndex) => lineIndex % contentShapes.length === index)
    if (shapeLines.length) result = replaceShapeText(result, shape, shapeLines)
  })
  return result
}

function fillSlideTables(
  xml: string,
  tables: ReadonlyArray<ReadonlyArray<ReadonlyArray<string>>>,
  tableOverride?: OfficeSlideShapeOverride,
): string {
  if (!tables.length) return xml
  if (!xml.includes("<a:tbl")) return insertTableGraphicFrame(xml, tables[0], tableOverride)
  let tableIndex = 0
  return xml.replace(/<a:tbl(?:\s[^>]*)?>[\s\S]*?<\/a:tbl>/g, (tableXml) => {
    const table = tables[tableIndex++]
    if (!table) return tableXml
    return replaceTableRows(tableXml, table)
  })
}

function insertTableGraphicFrame(
  slideXml: string,
  table: ReadonlyArray<ReadonlyArray<string>>,
  override?: OfficeSlideShapeOverride,
) {
  const columnCount = Math.max(1, table[0]?.length ?? 1)
  const gridWidth = Math.max(500000, Math.min(5000000, Math.floor(7772400 / columnCount)))
  const rowHeights = table.map(autoTableRowHeight)
  const totalHeight = rowHeights.reduce((sum, height) => sum + height, 0)
  const rows = table
    .map((row, rowIndex) => {
      const cells = row
        .map(
          (cell, index) =>
            `<a:tc><a:txBody>${autoTableCellBody(cell)}<a:lstStyle/><a:p><a:pPr algn="l"/><a:r><a:rPr lang="zh-CN" sz="${index === 0 ? 1300 : 1200}" b="${index === 0 ? 1 : 0}" dirty="0"/><a:t>${xml(cell)}</a:t></a:r></a:p></a:txBody><a:tcPr marL="91440" marR="91440" marT="45720" marB="45720"/></a:tc>`,
        )
        .join("")
      return `<a:tr h="${rowHeights[rowIndex] ?? 640000}">${cells}</a:tr>`
    })
    .join("")
  const tableXml = `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="100" name="Data Table"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="${override?.x ?? 685800}" y="${override?.y ?? 1470000}"/><a:ext cx="${override?.cx ?? 7772400}" cy="${override?.cy ?? totalHeight}"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr firstRow="1" bandRow="1"><a:tableStyleId>{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}</a:tableStyleId></a:tblPr><a:tblGrid>${Array.from({ length: columnCount }, () => `<a:gridCol w="${gridWidth}"/>`).join("")}</a:tblGrid>${rows}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`
  return slideXml.replace("</p:spTree>", `${tableXml}</p:spTree>`)
}

function autoTableCellBody(cell: string) {
  const fontScale = cell.length > 20 ? 75000 : cell.length > 10 ? 90000 : 100000
  return fontScale === 100000
    ? "<a:bodyPr/>"
    : `<a:bodyPr wrap="square"><a:normAutofit fontScale="${fontScale}"/></a:bodyPr>`
}

function autoTableRowHeight(row: ReadonlyArray<string>) {
  const maxCellLength = Math.max(...row.map((cell) => cell.length))
  return Math.min(1200000, Math.max(520000, 420000 + Math.ceil(maxCellLength / 8) * 60000))
}

function replaceTableRows(xml: string, table: ReadonlyArray<ReadonlyArray<string>>) {
  const rows = [...xml.matchAll(/<a:tr(?:\s[^>]*)?>[\s\S]*?<\/a:tr>/g)].map((match) => match[0])
  if (rows.length === 0 || table.length === 0) return xml

  let replaced = false
  return xml.replace(/<a:tr(?:\s[^>]*)?>[\s\S]*?<\/a:tr>/g, () => {
    if (replaced) return ""
    replaced = true
    return table
      .map((row, index) => replaceTableRowCells(rows[Math.min(index, rows.length - 1)] ?? rows[0], row))
      .join("")
  })
}

function replaceTableRowCells(xml: string, row: ReadonlyArray<string>) {
  const cells = [...xml.matchAll(/<a:tc(?:\s[^>]*)?>[\s\S]*?<\/a:tc>/g)].map((match) => match[0])
  if (cells.length === 0 || row.length === 0) return xml

  let replaced = false
  return xml.replace(/<a:tc(?:\s[^>]*)?>[\s\S]*?<\/a:tc>/g, () => {
    if (replaced) return ""
    replaced = true
    return row
      .map((cell, index) => replaceTableCellText(cells[Math.min(index, cells.length - 1)] ?? cells[0], cell))
      .join("")
  })
}

function replaceTableCellText(cellXml: string, value: string) {
  let touched = false
  return cellXml.replace(
    /(<a:t(?:\s[^>]*)?>)([\s\S]*?)(<\/a:t>)/g,
    (match, open: string, _text: string, close: string) => {
      if (touched) return `${open}${close}`
      touched = true
      return `${open}${xml(value)}${close}`
    },
  )
}

async function replaceSlideCharts(
  zip: JSZip,
  outputSlides: Array<{ rels: string; xml: string }>,
  fillPlan: Array<{ charts?: OfficePptxTemplateFillChart[]; shapeOverrides?: OfficeSlideShapeOverride[] }>,
  chartTemplateXml?: string,
): Promise<string[]> {
  const autoChartParts: string[] = []
  for (let index = 0; index < outputSlides.length; index++) {
    const charts = fillPlan[index]?.charts
    if (!charts?.length) continue
    const targets = parseRelationships(outputSlides[index].rels)
      .filter((item) => item.type.endsWith("/chart"))
      .map((item) => resolvePartPath("ppt/slides", item.target))
    if (targets.length === 0 && chartTemplateXml && charts[0]) {
      const chartPath = `ppt/charts/chart-auto-${index + 1}.xml`
      zip.file(chartPath, replacePptxChartXml(chartTemplateXml, charts[0]))
      const slide = outputSlides[index]
      const nextRid = `rId${parseRelationships(slide.rels).length + 1}`
      slide.rels = slide.rels.replace(
        "</Relationships>",
        `<Relationship Id="${nextRid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart-auto-${index + 1}.xml"/></Relationships>`,
      )
      slide.xml = insertChartGraphicFrame(
        slide.xml,
        nextRid,
        fillPlan[index]?.shapeOverrides?.find((item) => item.id === 200),
      )
      autoChartParts.push(chartPath)
      continue
    }
    for (let chartIndex = 0; chartIndex < Math.min(targets.length, charts.length); chartIndex++) {
      const target = targets[chartIndex]
      const chart = charts[chartIndex]
      if (!chart || !target) continue
      const chartXml = await zip.file(target)?.async("string")
      if (!chartXml) continue
      zip.file(target, replacePptxChartXml(chartXml, chart))
    }
  }
  return autoChartParts
}

function insertChartGraphicFrame(xml: string, relId: string, override?: OfficeSlideShapeOverride) {
  const frame = `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="200" name="Chart"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="${override?.x ?? 685800}" y="${override?.y ?? 1550000}"/><a:ext cx="${override?.cx ?? 7772400}" cy="${override?.cy ?? 2600000}"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" r:id="${relId}"/></a:graphicData></a:graphic></p:graphicFrame>`
  return xml.replace("</p:spTree>", `${frame}</p:spTree>`)
}

function replaceSlideImages(
  zip: JSZip,
  outputSlides: Array<{ rels: string }>,
  fillPlan: Array<{ images?: Array<{ mime: string; dataBase64: string }> }>,
) {
  for (let index = 0; index < outputSlides.length; index++) {
    const images = fillPlan[index]?.images
    if (!images?.length) continue
    const targets = parseRelationships(outputSlides[index].rels)
      .filter((item) => item.type.endsWith("/image"))
      .map((item) => resolvePartPath("ppt/slides", item.target))
    targets.slice(0, images.length).forEach((target, imageIndex) => {
      const image = images[imageIndex]
      if (!image || !target || !zip.file(target)) return
      zip.file(target, base64Bytes(image.dataBase64))
    })
  }
}

function replacePptxChartXml(xml: string, chart: OfficePptxTemplateFillChart) {
  const templateSeries = [...xml.matchAll(/<c:ser(?:\s[^>]*)?>[\s\S]*?<\/c:ser>/g)].map((match) => match[0])
  if (templateSeries.length === 0 || chart.series.length === 0) return xml

  let replaced = false
  const withSeries = xml.replace(/<c:ser(?:\s[^>]*)?>[\s\S]*?<\/c:ser>/g, () => {
    if (replaced) return ""
    replaced = true
    return chart.series
      .map((series, index) =>
        replaceChartSeries(
          templateSeries[Math.min(index, templateSeries.length - 1)] ?? templateSeries[0],
          chart.categories,
          series,
          index,
        ),
      )
      .join("")
  })
  const withChartType = applyChartType(withSeries, chart.chartType)
  return applyChartOptions(withChartType, chart.chartOptions)
}

function applyChartType(xml: string, chartType?: OfficePptxTemplateFillChart["chartType"]) {
  if (!chartType || chartType === "bar") return xml
  if (chartType === "line") return convertChartToLine(xml)
  if (chartType === "area") return convertChartToArea(xml)
  if (chartType === "radar") return convertChartToRadar(xml)
  if (chartType === "scatter") return convertChartToScatter(xml)
  if (chartType === "bubble") return convertChartToBubble(xml)
  if (chartType === "waterfall") return convertChartToWaterfall(xml)
  if (chartType === "combo") return convertChartToCombo(xml)
  return convertChartToDonut(xml)
}

function convertChartToLine(xml: string) {
  return xml
    .replace("<c:barChart>", "<c:lineChart>")
    .replace("</c:barChart>", "</c:lineChart>")
    .replace('<c:barDir val="col"/>', "")
    .replace('<c:grouping val="clustered"/>', '<c:grouping val="standard"/>')
    .replace('<c:gapWidth val="150"/><c:overlap val="0"/>', "")
}

function convertChartToArea(xml: string) {
  return xml
    .replace("<c:barChart>", "<c:areaChart>")
    .replace("</c:barChart>", "</c:areaChart>")
    .replace('<c:barDir val="col"/>', "")
    .replace('<c:grouping val="clustered"/>', '<c:grouping val="standard"/>')
    .replace('<c:gapWidth val="150"/><c:overlap val="0"/>', "")
}

function convertChartToRadar(xml: string) {
  return xml
    .replace(
      '<c:barChart><c:barDir val="col"/><c:grouping val="clustered"/><c:varyColors val="0"/>',
      '<c:radarChart><c:radarStyle val="marker"/><c:varyColors val="0"/>',
    )
    .replace("</c:barChart>", "</c:radarChart>")
    .replace('<c:gapWidth val="150"/><c:overlap val="0"/>', "")
}

function convertChartToScatter(xml: string) {
  return xml
    .replace(
      '<c:barChart><c:barDir val="col"/><c:grouping val="clustered"/><c:varyColors val="0"/>',
      '<c:scatterChart><c:scatterStyle val="lineMarker"/><c:varyColors val="0"/>',
    )
    .replace("</c:barChart>", "</c:scatterChart>")
    .replace("<c:cat>", "<c:xVal>")
    .replace("</c:cat>", "</c:xVal>")
    .replace("<c:val>", "<c:yVal>")
    .replace("</c:val>", "</c:yVal>")
    .replace('<c:gapWidth val="150"/><c:overlap val="0"/>', "")
}

function convertChartToBubble(xml: string) {
  const converted = xml
    .replace(
      '<c:barChart><c:barDir val="col"/><c:grouping val="clustered"/><c:varyColors val="0"/>',
      '<c:bubbleChart><c:varyColors val="0"/>',
    )
    .replace("</c:barChart>", "</c:bubbleChart>")
    .replace(/<c:cat>/g, "<c:xVal>")
    .replace(/<\/c:cat>/g, "</c:xVal>")
    .replace(/<c:val>/g, "<c:yVal>")
    .replace(/<\/c:val>/g, "</c:yVal>")
    .replace('<c:gapWidth val="150"/><c:overlap val="0"/>', "")
  return converted.replace(/(<c:yVal>[\s\S]*?<\/c:yVal>)/g, (match, yVal: string) => {
    const inner = yVal.replace(/^<c:yVal>/, "").replace(/<\/c:yVal>$/, "")
    return `${yVal}<c:bubbleSize>${inner}</c:bubbleSize>`
  })
}

function convertChartToDonut(xml: string) {
  const chartBlock = xml.match(/<c:barChart>([\s\S]*?)<\/c:barChart>/)
  if (!chartBlock) return xml
  const series = [...chartBlock[1].matchAll(/<c:ser(?:\s[^>]*)?>[\s\S]*?<\/c:ser>/g)].map((match) => match[0]).join("")
  const donut = `<c:doughnutChart><c:varyColors val="1"/><c:holeSize val="55"/>${series}</c:doughnutChart>`
  return xml
    .replace(/<c:barChart>[\s\S]*?<\/c:barChart>/, donut)
    .replace(/<c:catAx>[\s\S]*?<\/c:catAx>/g, "")
    .replace(/<c:valAx>[\s\S]*?<\/c:valAx>/g, "")
}

function convertChartToWaterfall(xml: string) {
  const chartBlock = xml.match(/<c:barChart>([\s\S]*?)<\/c:barChart>/)
  if (!chartBlock) return xml
  const series = [...chartBlock[1].matchAll(/<c:ser(?:\s[^>]*)?>[\s\S]*?<\/c:ser>/g)].map((match) => match[0]).join("")
  const axIds = [...chartBlock[1].matchAll(/<c:axId val="\d+"\/>/g)].map((match) => match[0]).join("")
  const waterfall = `<c:waterfallChart><c:grouping val="clustered"/><c:varyColors val="0"/>${series}<c:gapWidth val="70"/><c:serLines><c:spPr><a:ln w="12700" cap="flat"><a:solidFill><a:srgbClr val="888888"/></a:solidFill><a:prstDash val="solid"/><a:round/></a:ln></c:spPr></c:serLines>${axIds}</c:waterfallChart>`
  return xml.replace(/<c:barChart>[\s\S]*?<\/c:barChart>/, waterfall)
}

function convertChartToCombo(xml: string) {
  const chartBlock = xml.match(/<c:barChart>([\s\S]*?)<\/c:barChart>/)
  if (!chartBlock) return xml
  const series = [...chartBlock[1].matchAll(/<c:ser(?:\s[^>]*)?>[\s\S]*?<\/c:ser>/g)].map((match) => match[0])
  if (series.length < 2) return xml
  const axIds = [...chartBlock[1].matchAll(/<c:axId val="\d+"\/>/g)].map((match) => match[0]).join("")
  const barChart = `<c:barChart><c:barDir val="col"/><c:grouping val="clustered"/><c:varyColors val="0"/>${series[0] ?? ""}<c:gapWidth val="150"/><c:overlap val="0"/>${axIds}</c:barChart>`
  const lineSeries = series.slice(1).join("")
  const lineChart = `<c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/>${lineSeries}<c:marker val="1"/>${axIds}</c:lineChart>`
  return xml.replace(/<c:barChart>[\s\S]*?<\/c:barChart>/, `${barChart}${lineChart}`)
}

function applyChartOptions(xml: string, chartOptions?: OfficePptxTemplateFillChart["chartOptions"]) {
  if (!chartOptions) return xml
  let next = xml
  if (chartOptions.title?.trim()) next = applyChartTitle(next, chartOptions.title)
  if (chartOptions.xAxisTitle?.trim() || chartOptions.yAxisTitle?.trim()) {
    next = applyAxisTitles(next, chartOptions.xAxisTitle, chartOptions.yAxisTitle)
  }
  if (chartOptions.showDataLabels) next = next.replace(/<c:showVal val="0"\/>/g, '<c:showVal val="1"/>')
  if (chartOptions.showPercent) next = next.replace(/<c:showPercent val="0"\/>/g, '<c:showPercent val="1"/>')
  if (chartOptions.showLegend) {
    next = next.replace(/<c:showLegendKey val="0"\/>/g, '<c:showLegendKey val="1"/>')
    next = applyChartLegend(next, chartOptions.legendPosition ?? "bottom")
  }
  if (chartOptions.showGridlines === false) {
    next = next.replace(/<c:majorGridlines>[\s\S]*?<\/c:majorGridlines>/g, "")
  }
  if (chartOptions.colors?.length) next = applyChartColors(next, chartOptions.colors)
  return next
}

function applyChartTitle(xmlText: string, title: string) {
  const titleXml = `<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr b="1" sz="1400"/></a:pPr><a:r><a:rPr lang="zh-CN" sz="1400" b="1"/><a:t>${xml(title)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title>`
  return xmlText.replace("<c:plotArea>", `${titleXml}<c:plotArea>`)
}

function applyChartLegend(xmlText: string, position: "bottom" | "right" | "top" | "left") {
  if (xmlText.includes("<c:legend>")) return xmlText
  const val = position === "right" ? "r" : position === "left" ? "l" : position === "top" ? "t" : "b"
  const legend = `<c:legend><c:legendPos val="${val}"/><c:overlay val="0"/></c:legend>`
  return xmlText.replace("<c:plotVisOnly", `${legend}<c:plotVisOnly`)
}

function applyAxisTitles(xmlText: string, xTitle?: string, yTitle?: string) {
  let next = xmlText
  if (xTitle?.trim()) {
    next = next.replace(/(<c:catAx>[\s\S]*?<\/c:catAx>)/g, (axis) => insertAxisTitle(axis, xTitle))
  }
  if (yTitle?.trim()) {
    next = next.replace(/(<c:valAx>[\s\S]*?<\/c:valAx>)/g, (axis) => insertAxisTitle(axis, yTitle))
  }
  return next
}

function insertAxisTitle(axisXml: string, title: string) {
  const titleXml = `<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr b="1" sz="1100"/></a:pPr><a:r><a:rPr lang="zh-CN" sz="1100" b="1"/><a:t>${xml(title)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title>`
  return axisXml.replace("<c:numFmt", `${titleXml}<c:numFmt`)
}

function applyChartColors(xml: string, colors: string[]) {
  let seriesIndex = 0
  return xml.replace(/<c:ser(?:\s[^>]*)?>[\s\S]*?<\/c:ser>/g, (series) => {
    const color = colors[Math.min(seriesIndex, colors.length - 1)]
    seriesIndex += 1
    return color
      ? series.replace(/<a:srgbClr val="[0-9A-Fa-f]{6}"\/>/, `<a:srgbClr val="${color.toUpperCase()}"/>`)
      : series
  })
}

function addSlideAnimations(
  xml: string,
  slide: MotionSlide,
  audio?: {
    shapeId: number
    durationMs: number
    startFloor?: number
    subtitles?: Array<{ startMs: number; endMs: number; text: string }>
  },
  animations?: OfficePptAnimationConfig,
  slideRole?: string,
) {
  if (xml.includes("<p:timing")) return xml
  const entries: TimingEntry[] = []
  if (audio) {
    entries.push({
      kind: "audio",
      shapeId: audio.shapeId,
      durationMs: audio.durationMs,
      delayMs: 0,
    })
  }
  const shapes = extractAnimationShapes(xml)
  const titleShape = shapes.find((shape) => shape.kind === "sp" && shape.maxSize >= 1800)
  const slideConfig = (slideRole ? animations?.slides?.[slideRole] : undefined) ?? animations?.slides?.default
  const groups = slideConfig?.groups ?? []
  const animationDefaults = animations?.defaults?.animation
  const pageAnimation = slide.motion?.animation
  const shapeGroupMap = new Map(
    shapes.map((shape) => [
      shape.id,
      groups.find((group) => group.selector === animationShapeSelector(shape, shape.id === titleShape?.id)),
    ]),
  )
  let animationIndex = 0
  shapes.forEach((shape) => {
    const group = shapeGroupMap.get(shape.id)
    const effectName = group?.effect ?? pageAnimation?.effect ?? animationDefaults?.effect ?? "fade"
    const effect = animationEffectForName(effectName, shape, slide, shape.id === titleShape?.id)
    const cue = audio?.subtitles?.[Math.min(animationIndex, Math.max(0, (audio.subtitles?.length ?? 1) - 1))]
    const delaySeconds = audio
      ? 0
      : entries.length === 0
        ? 0
        : (group?.delay ?? group?.stagger ?? pageAnimation?.stagger ?? animationDefaults?.stagger ?? 0.2)
    const durationSeconds =
      pageAnimation?.duration ?? group?.duration ?? animationDefaults?.duration ?? effect.durationMs / 1000
    entries.push({
      kind: "animation",
      shapeId: shape.id,
      effect,
      durationMs: Math.max(100, Math.round(durationSeconds * 1000)),
      delayMs: Math.max(0, Math.round(delaySeconds * 1000)),
      ...(audio ? { startMs: cue?.startMs ?? Math.round((audio.startFloor ?? 0.8) * 1000) } : {}),
    })
    animationIndex++
  })
  if (!entries.length) return xml
  return insertSlideTiming(xml, buildSlideTimingXml(entries))
}

function extractAnimationShapes(xml: string): AnimationShape[] {
  const result: AnimationShape[] = []
  const shapePattern = /<(p:sp|p:pic|p:graphicFrame)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/g
  for (const match of xml.matchAll(shapePattern)) {
    const block = match[0]
    const identity = block.match(/<p:cNvPr id="(\d+)" name="([^"]*)"/)
    if (!identity) continue
    const id = Number(identity[1])
    if (id <= 1 || id >= 9000 || identity[2].toLowerCase().includes("narration")) continue
    const kind = match[1] === "p:sp" ? "sp" : match[1] === "p:pic" ? "pic" : "graphicFrame"
    const metrics = shapeMetrics(block)
    const sizes = [...block.matchAll(/sz="(\d+)"/g)].map((item) => Number(item[1]))
    const maxSize = sizes.length ? Math.max(...sizes) : 0
    const hasText = block.includes("<p:txBody>")
    if (kind === "sp" && !hasText && metrics.cx * metrics.cy < 400_000_000) continue
    if (kind === "sp" && hasText && maxSize < 1200) continue
    if (kind === "pic" && metrics.cx * metrics.cy < 80_000_000) continue
    result.push({ id, kind, maxSize, area: metrics.cx * metrics.cy, top: metrics.y })
  }
  return result.toSorted((left, right) => left.top - right.top || left.id - right.id).slice(0, 12)
}

function shapeMetrics(block: string) {
  return {
    x: Number(block.match(/<a:off[^>]*x="(\d+)"/)?.[1] ?? 0),
    y: Number(block.match(/<a:off[^>]*y="(\d+)"/)?.[1] ?? 0),
    cx: Number(block.match(/<a:ext[^>]*cx="(\d+)"/)?.[1] ?? 0),
    cy: Number(block.match(/<a:ext[^>]*cy="(\d+)"/)?.[1] ?? 0),
  }
}

function animationEffectForName(
  name: OfficePptAnimationGroup["effect"] | undefined,
  shape: AnimationShape,
  slide: { layout?: OfficeSlide["layout"] },
  isTitle: boolean,
): AnimationEffectSpec {
  if (name === "fly") return { presetID: 2, presetSubtype: 4, filter: "fly", durationMs: 500, kind: "fly" }
  if (name === "zoom") return { presetID: 23, presetSubtype: 16, filter: "zoom", durationMs: 500, kind: "zoom" }
  if (
    name === "wipe" ||
    shape.kind === "graphicFrame" ||
    slide.layout === "chart" ||
    slide.layout === "table" ||
    slide.layout === "kpi"
  ) {
    return { presetID: 22, presetSubtype: 4, filter: "wipe(down)", durationMs: 500, kind: "wipe" }
  }
  if (isTitle) return { presetID: 10, presetSubtype: 0, filter: "fade", durationMs: 600, kind: "fade" }
  return { presetID: 10, presetSubtype: 0, filter: "fade", durationMs: 400, kind: "fade" }
}

function animationShapeSelector(shape: AnimationShape, isTitle: boolean) {
  if (shape.kind === "graphicFrame") return "chart"
  if (shape.kind === "pic") return "image"
  if (shape.kind === "sp" && shape.maxSize === 0) return "cards"
  if (isTitle) return "title"
  return "body"
}

function slideAnimationRole(index: number, total: number) {
  if (index === 0) return "cover"
  if (index === total - 1) return "closing"
  const roles = ["overview", "content", "cards", "data", "content"]
  return roles[Math.min(Math.max(0, index - 1), roles.length - 1)] ?? "content"
}

function isOfficePptAnimationConfig(value: unknown): value is OfficePptAnimationConfig {
  if (!value || typeof value !== "object") return false
  const candidate = value as { version?: unknown; slides?: unknown }
  return candidate.version === 1 && !!candidate.slides && typeof candidate.slides === "object"
}

function buildSlideTimingXml(entries: TimingEntry[]) {
  let nextId = 3
  const outerId = nextId++
  const innerSteps: string[] = []
  const builds: string[] = []
  let elapsedMs = 0

  for (const entry of entries) {
    const wrapperId = nextId++
    const rowId = nextId++
    const behaviorId = nextId
    nextId += entry.kind === "audio" ? 1 : 2
    const wrapperDelay = entry.startMs ?? elapsedMs
    const rowXml =
      entry.kind === "audio"
        ? buildAudioTimingRow(entry, rowId, behaviorId)
        : buildAnimationTimingRow(entry, rowId, behaviorId)
    innerSteps.push(
      `<p:par><p:cTn id="${wrapperId}" fill="hold"><p:stCondLst><p:cond delay="${wrapperDelay}"/></p:stCondLst><p:childTnLst><p:par>${rowXml}</p:par></p:childTnLst></p:cTn></p:par>`,
    )
    if (entry.kind === "animation") builds.push(`<p:bldP spid="${entry.shapeId}" grpId="0"/>`)
    elapsedMs = wrapperDelay + entry.durationMs
  }

  const audioEntry = entries.find((entry) => entry.kind === "audio")
  const audioNode = audioEntry ? buildAudioNode(audioEntry.shapeId, nextId++) : ""
  const sequenceXml = `<p:seq concurrent="1" nextAc="seek"><p:cTn id="2" dur="indefinite" nodeType="mainSeq"><p:childTnLst><p:par><p:cTn id="${outerId}" fill="hold"><p:stCondLst><p:cond delay="indefinite"/><p:cond evt="onBegin" delay="0"><p:tn val="2"/></p:cond></p:stCondLst><p:childTnLst>${innerSteps.join("")}</p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn><p:prevCondLst><p:cond evt="onPrev" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:prevCondLst><p:nextCondLst><p:cond evt="onNext" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:nextCondLst></p:seq>`
  return `<p:timing><p:tnLst><p:par><p:cTn id="1" dur="indefinite" restart="never" nodeType="tmRoot"><p:childTnLst>${sequenceXml}${audioNode}</p:childTnLst></p:cTn></p:par></p:tnLst>${builds.length ? `<p:bldLst>${builds.join("")}</p:bldLst>` : ""}</p:timing>`
}

function buildAnimationTimingRow(entry: TimingEntry, rowId: number, behaviorId: number) {
  const effect = entry.effect ? { ...entry.effect, durationMs: entry.durationMs } : undefined
  if (!effect) throw new Error("动画目标缺少效果配置")
  return `<p:cTn id="${rowId}" presetID="${effect.presetID}" presetClass="entr" presetSubtype="${effect.presetSubtype}" fill="hold" grpId="0" nodeType="afterEffect"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst><p:set><p:cBhvr><p:cTn id="${behaviorId}" dur="1" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst></p:cTn><p:tgtEl><p:spTgt spid="${entry.shapeId}"/></p:tgtEl><p:attrNameLst><p:attrName>style.visibility</p:attrName></p:attrNameLst></p:cBhvr><p:to><p:strVal val="visible"/></p:to></p:set>${buildAnimationBehavior(effect, entry.shapeId, behaviorId + 1)}</p:childTnLst></p:cTn>`
}

function buildAnimationBehavior(effect: AnimationEffectSpec, shapeId: number, firstId: number) {
  if (effect.kind === "fly") {
    return `<p:anim calcmode="lin" valueType="num"><p:cBhvr additive="base"><p:cTn id="${firstId}" dur="${effect.durationMs}" fill="hold"/><p:tgtEl><p:spTgt spid="${shapeId}"/></p:tgtEl><p:attrNameLst><p:attrName>ppt_x</p:attrName></p:attrNameLst></p:cBhvr><p:tavLst><p:tav tm="0"><p:val><p:strVal val="#ppt_x"/></p:val></p:tav><p:tav tm="100000"><p:val><p:strVal val="#ppt_x"/></p:val></p:tav></p:tavLst></p:anim><p:anim calcmode="lin" valueType="num"><p:cBhvr additive="base"><p:cTn id="${firstId + 1}" dur="${effect.durationMs}" fill="hold"/><p:tgtEl><p:spTgt spid="${shapeId}"/></p:tgtEl><p:attrNameLst><p:attrName>ppt_y</p:attrName></p:attrNameLst></p:cBhvr><p:tavLst><p:tav tm="0"><p:val><p:strVal val="1+#ppt_h/2"/></p:val></p:tav><p:tav tm="100000"><p:val><p:strVal val="#ppt_y"/></p:val></p:tav></p:tavLst></p:anim>`
  }
  if (effect.kind === "zoom") {
    return `<p:anim calcmode="lin" valueType="num"><p:cBhvr><p:cTn id="${firstId}" dur="${effect.durationMs}" fill="hold"/><p:tgtEl><p:spTgt spid="${shapeId}"/></p:tgtEl><p:attrNameLst><p:attrName>ppt_w</p:attrName></p:attrNameLst></p:cBhvr><p:tavLst><p:tav tm="0"><p:val><p:fltVal val="0"/></p:val></p:tav><p:tav tm="100000"><p:val><p:strVal val="#ppt_w"/></p:val></p:tav></p:tavLst></p:anim><p:anim calcmode="lin" valueType="num"><p:cBhvr><p:cTn id="${firstId + 1}" dur="${effect.durationMs}" fill="hold"/><p:tgtEl><p:spTgt spid="${shapeId}"/></p:tgtEl><p:attrNameLst><p:attrName>ppt_h</p:attrName></p:attrNameLst></p:cBhvr><p:tavLst><p:tav tm="0"><p:val><p:fltVal val="0"/></p:val></p:tav><p:tav tm="100000"><p:val><p:strVal val="#ppt_h"/></p:val></p:tav></p:tavLst></p:anim>`
  }
  return `<p:animEffect transition="in" filter="${effect.filter}"><p:cBhvr><p:cTn id="${firstId}" dur="${effect.durationMs}"/><p:tgtEl><p:spTgt spid="${shapeId}"/></p:tgtEl></p:cBhvr></p:animEffect>`
}

function buildAudioTimingRow(entry: TimingEntry, rowId: number, behaviorId: number) {
  return `<p:cTn id="${rowId}" presetID="1" presetClass="mediacall" presetSubtype="0" fill="hold" nodeType="afterEffect"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst><p:cmd type="call" cmd="playFrom(0.0)"><p:cBhvr><p:cTn id="${behaviorId}" dur="1" fill="hold"/><p:tgtEl><p:spTgt spid="${entry.shapeId}"/></p:tgtEl></p:cBhvr></p:cmd></p:childTnLst></p:cTn>`
}

function buildAudioNode(shapeId: number, id: number) {
  return `<p:audio><p:cMediaNode vol="80000"><p:cTn id="${id}" fill="hold" display="0"><p:stCondLst><p:cond delay="indefinite"/></p:stCondLst><p:endCondLst><p:cond evt="onStopAudio" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:endCondLst></p:cTn><p:tgtEl><p:spTgt spid="${shapeId}"/></p:tgtEl></p:cMediaNode></p:audio>`
}

function insertSlideTiming(xml: string, timing: string) {
  const transition = xml.match(/<p:transition[\s\S]*?<\/p:transition>/)
  if (transition?.index !== undefined) {
    const insertAt = transition.index + transition[0].length
    return `${xml.slice(0, insertAt)}${timing}${xml.slice(insertAt)}`
  }
  return xml.replace("</p:sld>", `${timing}</p:sld>`)
}

function normalizeSlideAudio(audio: NonNullable<OfficeSlide["audio"]>): SlideAudio {
  const mime = audio.mime.toLowerCase().replace("audio/mp3", "audio/mpeg").replace("audio/x-wav", "audio/wav")
  const extension: SlideAudio["extension"] =
    mime === "audio/mpeg" ? "mp3" : mime === "audio/mp4" || mime === "audio/m4a" || mime === "audio/aac" ? "m4a" : "wav"
  return {
    mime,
    extension,
    dataBase64: audio.dataBase64.replace(/\s+/g, ""),
    ...(audio.startFloor === undefined ? {} : { startFloor: audio.startFloor }),
    ...(audio.padding === undefined ? {} : { padding: audio.padding }),
    ...(audio.subtitles ? { subtitles: audio.subtitles } : {}),
  }
}

function addAudioRelations(rels: { xml: string }, slideIndex: number, audio: SlideAudio) {
  const start = parseRelationships(rels.xml).length
  const audioRid = `rId${start + 1}`
  const mediaRid = `rId${start + 2}`
  const iconRid = `rId${start + 3}`
  const target = `../media/narration-${slideIndex}.${audio.extension}`
  rels.xml = rels.xml.replace(
    "</Relationships>",
    `${relationshipXml(audioRid, "http://schemas.openxmlformats.org/officeDocument/2006/relationships/audio", target)}${relationshipXml(mediaRid, "http://schemas.microsoft.com/office/2007/relationships/media", target)}${relationshipXml(iconRid, "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image", `../media/narration-icon-${slideIndex}.png`)}</Relationships>`,
  )
  return { audio: audioRid, media: mediaRid, icon: iconRid }
}

function addAudioShape(xml: string, id: number, rels: { audio: string; icon: string }) {
  const pic = `<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="Narration ${id}" hidden="1"><a:hlinkClick r:id="" action="ppaction://media"/></p:cNvPr><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr><a:audioFile r:link="${rels.audio}"/></p:nvPr></p:nvPicPr><p:blipFill><a:blip r:embed="${rels.icon}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1" cy="1"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`
  return xml.replace("</p:spTree>", `${pic}</p:spTree>`)
}

function audioContentType(extension: SlideAudio["extension"]) {
  if (extension === "mp3") return "audio/mpeg"
  if (extension === "m4a") return "audio/mp4"
  return "audio/x-wav"
}

function audioDurationMs(audio: SlideAudio) {
  if (audio.extension !== "wav") return 10000
  const bytes = base64Bytes(audio.dataBase64)
  if (bytes.length < 44) return 10000
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const byteRate = view.getUint32(28, true)
  const dataSize = view.getUint32(40, true)
  if (!byteRate || !dataSize) return 10000
  return Math.max(100, Math.round((dataSize / byteRate) * 1000))
}

function addContentTypeDefaults(contentTypes: string, entries: Array<{ extension: string; contentType: string }>) {
  let result = contentTypes
  for (const entry of entries) {
    if (new RegExp(`<Default Extension="${entry.extension}"[^>]*/>`).test(result)) continue
    result = result.replace(
      "</Types>",
      `<Default Extension="${entry.extension}" ContentType="${entry.contentType}"/></Types>`,
    )
  }
  return result
}

function narrationIconBytes() {
  return base64Bytes("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=")
}

function replaceChartSeries(
  xml: string,
  categories: string[],
  series: { name: string; values: number[] },
  index: number,
) {
  return replaceChartBlock(
    replaceChartBlock(
      replaceChartBlock(
        xml
          .replace(/<c:idx\s+val="\d+"\s*\/>/, `<c:idx val="${index}"/>`)
          .replace(/<c:order\s+val="\d+"\s*\/>/, `<c:order val="${index}"/>`),
        "c:tx",
        chartTextCache(series.name),
      ),
      "c:cat",
      chartCategoryCache(categories),
    ),
    "c:val",
    chartValueCache(series.values),
  )
}

function replaceChartBlock(xml: string, tag: string, value: string) {
  return xml.replace(new RegExp(`<${tag}(?:\\s[^>]*)?>[\\s\\S]*?<\\/${tag}>`), value)
}

function chartTextCache(value: string) {
  return `<c:tx><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>${xml(value)}</c:v></c:pt></c:strCache></c:strRef></c:tx>`
}

function chartCategoryCache(categories: string[]) {
  return `<c:cat><c:strRef><c:strCache><c:ptCount val="${categories.length}"/>${categories
    .map((category, index) => `<c:pt idx="${index}"><c:v>${xml(category)}</c:v></c:pt>`)
    .join("")}</c:strCache></c:strRef></c:cat>`
}

function chartValueCache(values: number[]) {
  return `<c:val><c:numRef><c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="${values.length}"/>${values
    .map((value, index) => `<c:pt idx="${index}"><c:v>${Number.isFinite(value) ? value : 0}</c:v></c:pt>`)
    .join("")}</c:numCache></c:numRef></c:val>`
}

function addSlideTransition(
  xml: string,
  slide: MotionSlide,
  audioTiming?: { durationMs: number; startFloorMs: number; paddingMs: number },
) {
  const existingTransition = xml.match(/<p:transition[\s\S]*?<\/p:transition>/)
  const motionTransition = slide.motion?.transition
  if (existingTransition && !motionTransition) return xml
  const body = motionTransition
    ? transitionEffectBody(motionTransition.effect ?? "fade")
    : slide.layout === "process" || slide.layout === "timeline" || slide.layout === "roadmap"
      ? '<p:wipe dir="l"/>'
      : slide.layout === "architecture" || slide.layout === "framework" || slide.layout === "mindmap"
        ? '<p:push dir="l"/>'
        : slide.layout === "chart" || slide.layout === "kpi" || slide.layout === "table"
          ? "<p:fade/>"
          : "<p:fade/>"
  const advance = audioTiming
    ? ` advClick="0"><p:advTm val="${Math.max(1000, audioTiming.durationMs + audioTiming.startFloorMs + audioTiming.paddingMs)}"/>${body}`
    : ` spd="${transitionSpeed(motionTransition?.duration)}">${body}`
  const transitionXml = `<p:transition${advance}</p:transition>`
  if (existingTransition?.index !== undefined) {
    return `${xml.slice(0, existingTransition.index)}${transitionXml}${xml.slice(existingTransition.index + existingTransition[0].length)}`
  }
  return xml.replace("</p:sld>", `${transitionXml}</p:sld>`)
}

function transitionEffectBody(effect: "fade" | "wipe" | "push") {
  if (effect === "wipe") return '<p:wipe dir="l"/>'
  if (effect === "push") return '<p:push dir="l"/>'
  return "<p:fade/>"
}

function transitionSpeed(duration?: number) {
  if (duration === undefined) return "med"
  if (duration <= 0.5) return "fast"
  if (duration >= 1.5) return "slow"
  return "med"
}

function resolvePartPath(baseDir: string, target: string) {
  if (target.startsWith("/")) return target.replace(/^\/+/, "")
  const parts = `${baseDir}/${target}`.split("/").filter(Boolean)
  const stack: string[] = []
  for (const part of parts) {
    if (part === "..") stack.pop()
    else if (part !== ".") stack.push(part)
  }
  return stack.join("/")
}

export async function hydrateOfficeSlideAssets(
  artifact: OfficeArtifact,
  readAsset: (path: string) => Promise<OfficeAssetContent>,
): Promise<OfficeArtifact> {
  const slides = []
  for (const slide of artifact.slides) {
    const needsTable =
      Boolean(slide.chartType) || slide.layout === "table" || /表格|排期表|schedule|table/i.test(slide.content)
    if (!slide.assets?.length) {
      slides.push(slide)
      continue
    }
    let content = slide.content
    let visual = slide.visual
    let audio = slide.audio
    for (const asset of slide.assets) {
      try {
        const assetContent = await readAsset(asset)
        if (isAudioAsset(asset) && typeof assetContent !== "string" && assetContent.encoding === "base64" && !audio) {
          audio = {
            mime: audioMimeFromPath(asset),
            dataBase64: assetContent.content,
          }
          continue
        }
        if (
          isImageAsset(asset) &&
          typeof assetContent !== "string" &&
          assetContent.encoding === "base64" &&
          !visual?.includes("data:image")
        ) {
          visual = [visual, `![素材](data:${imageMimeFromPath(asset)};base64,${assetContent.content})`]
            .filter(Boolean)
            .join("\n")
          continue
        }
        if (!/\.(csv|tsv|md|json|xlsx|txt)$/i.test(asset)) continue
        const text = typeof assetContent === "string" ? assetContent : assetContent.content
        if (!content.trim() && !needsTable && /\.(md|txt)$/i.test(asset)) {
          content = textAssetPreview(text)
          continue
        }
        if (!needsTable || content.includes("|")) continue
        const table =
          typeof assetContent !== "string" && assetContent.encoding === "base64" && /\.xlsx$/i.test(asset)
            ? await xlsxTableFromBase64(assetContent.content, slide.chartOptions?.xlsxSheet)
            : tableFromAssetText(text, asset)
        if (table) {
          content = [content, table].filter(Boolean).join("\n\n")
          break
        }
      } catch {
        // 素材不可读时不阻塞导出，仍以页面现有内容生成图表。
      }
    }
    slides.push({
      ...slide,
      content,
      ...(visual ? { visual } : {}),
      ...(audio ? { audio } : {}),
    })
  }
  return { ...artifact, slides }
}

function isAudioAsset(path: string) {
  return /\.(mp3|wav|m4a|aac)$/i.test(path)
}

function textAssetPreview(text: string) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 24)
    .join("\n")
}

function audioMimeFromPath(path: string) {
  if (/\.wav$/i.test(path)) return "audio/wav"
  if (/\.m4a$|\.aac$/i.test(path)) return "audio/mp4"
  return "audio/mpeg"
}

function isImageAsset(path: string) {
  return /\.(png|jpe?g|webp|gif)$/i.test(path)
}

function imageMimeFromPath(path: string) {
  if (/\.png$/i.test(path)) return "image/png"
  if (/\.webp$/i.test(path)) return "image/webp"
  if (/\.gif$/i.test(path)) return "image/gif"
  return "image/jpeg"
}

function tableFromAssetText(text: string, path: string) {
  if (/\.json$/i.test(path)) return jsonTableFromAsset(text)
  if (/\.md$/i.test(path)) return markdownTableFromAsset(text)
  const delimiter = /\.tsv$/i.test(path) ? "\t" : ","
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  if (lines.length < 2) return undefined
  const rows = lines.map((line) => splitDelimitedLine(line, delimiter))
  const header = rows[0]
  if (!header?.length) return undefined
  const separator = header.map(() => "---").join(" | ")
  const body = rows
    .slice(1)
    .filter((row) => row.length >= header.length)
    .map(
      (row) =>
        `| ${row
          .slice(0, header.length)
          .map((cell) => cell.trim())
          .join(" | ")} |`,
    )
  if (!body.length) return undefined
  return [`| ${header.map((cell) => cell.trim()).join(" | ")} |`, `| ${separator} |`, ...body].join("\n")
}

async function xlsxTableFromBase64(base64: string, sheetName?: string) {
  try {
    const zip = await JSZip.loadAsync(base64ToBytes(base64))
    const sharedStrings = (await zip.file("xl/sharedStrings.xml")?.async("string")) ?? ""
    const strings = parseXlsxSharedStrings(sharedStrings)
    const sheetPaths = await xlsxSheetPaths(zip, sheetName)
    for (const sheetPath of sheetPaths) {
      const sheet = await zip.file(sheetPath)?.async("string")
      if (!sheet) continue
      const table = markdownTableFromRows(parseXlsxRows(sheet, strings))
      if (table) return table
    }
    return undefined
  } catch {
    return undefined
  }
}

export async function xlsxSheetNamesFromBase64(base64: string) {
  try {
    const zip = await JSZip.loadAsync(base64ToBytes(base64))
    const workbook = await zip.file("xl/workbook.xml")?.async("string")
    if (!workbook) return []
    return [...workbook.matchAll(/<sheet\b([^>]*)\/>/g)]
      .map((match) => decodeXmlEntity(match[1]?.match(/\bname="([^"]*)"/)?.[1] ?? ""))
      .filter(Boolean)
  } catch {
    return []
  }
}

async function xlsxSheetPaths(zip: JSZip, sheetName?: string) {
  const workbookXml = zip.file("xl/workbook.xml")
  const workbookRels = zip.file("xl/_rels/workbook.xml.rels")
  if (!sheetName || !workbookXml || !workbookRels) {
    return Object.keys(zip.files)
      .filter((path) => path.startsWith("xl/worksheets/") && path.endsWith(".xml"))
      .sort()
  }
  const workbookRelsXml = await workbookRels.async("string")
  const ridToTarget = new Map(
    parseXlsxRelationships(workbookRelsXml).map((item) => [item.id, resolveXlsxPartPath("xl", item.target)]),
  )
  const sheetIdToRid = new Map<string, string>()
  const workbookText = await workbookXml.async("string")
  for (const match of workbookText.matchAll(/<sheet\b([^>]*)\/>/g)) {
    const attrs = match[1] ?? ""
    const id = attrs.match(/\bsheetId="(\d+)"/)?.[1]
    const rid = attrs.match(/\br:id="([^"]+)"/)?.[1]
    if (id && rid) sheetIdToRid.set(id, rid)
  }
  const target = [...workbookText.matchAll(/<sheet\b([^>]*)\/>/g)]
    .map((match) => {
      const attrs = match[1] ?? ""
      const name = decodeXmlEntity(attrs.match(/\bname="([^"]*)"/)?.[1] ?? "")
      const id = attrs.match(/\bsheetId="(\d+)"/)?.[1]
      const rid = attrs.match(/\br:id="([^"]+)"/)?.[1] ?? (id ? sheetIdToRid.get(id) : undefined)
      return { name, rid }
    })
    .find((item) => item.name === sheetName)?.rid
  if (!target) return []
  const path = ridToTarget.get(target)
  return path ? [path] : []
}

function parseXlsxRelationships(xml: string) {
  return [
    ...xml.matchAll(/<Relationship\s+Id="([^"]+)"[^>]*Type="([^"]*\/worksheet)"[^>]*Target="([^"]+)"[^>]*\/>/g),
  ].map((match) => ({ id: match[1], type: match[2], target: match[3] }))
}

function resolveXlsxPartPath(base: string, target: string) {
  const normalized = target.replaceAll("\\", "/").replace(/^\.\//, "")
  if (normalized.startsWith("/")) return normalized.slice(1)
  if (normalized.startsWith(`${base}/`)) return normalized
  if (normalized.startsWith("../")) {
    const parts = base.split("/")
    for (const part of normalized.split("/")) {
      if (part === "..") parts.pop()
      else if (part !== ".") parts.push(part)
    }
    return parts.join("/")
  }
  return `${base}/${normalized}`
}

function base64ToBytes(input: string) {
  const binary = atob(input)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
  return bytes
}

function parseXlsxSharedStrings(xml: string) {
  return [...xml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((match) => {
    const text = [...match[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((item) => item[1] ?? "").join("")
    return decodeXmlEntity(text)
  })
}

function parseXlsxRows(xml: string, sharedStrings: string[]) {
  const rows: string[][] = []
  for (const row of xml.matchAll(/<row(?:\s[^>]*)?>([\s\S]*?)<\/row>/g)) {
    const cells: string[] = []
    for (const cell of row[1].matchAll(/<c([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attrs = cell[1] ?? ""
      const ref = attrs.match(/r="([A-Z]+)\d+"/)?.[1] ?? ""
      const type = attrs.match(/t="([^"]+)"/)?.[1]
      const column = xlsxColumnIndex(ref)
      while (cells.length < column) cells.push("")
      cells[column] = xlsxCellText(cell[2] ?? "", type, sharedStrings)
    }
    if (cells.some((cell) => cell.trim())) rows.push(cells)
  }
  return rows
}

function xlsxColumnIndex(ref: string) {
  let index = 0
  for (const char of ref.toUpperCase()) {
    if (char < "A" || char > "Z") continue
    index = index * 26 + (char.charCodeAt(0) - 64)
  }
  return Math.max(0, index - 1)
}

function xlsxCellText(inner: string, type: string | undefined, sharedStrings: string[]) {
  if (type === "inlineStr") {
    const text = inner.match(/<t[^>]*>([\s\S]*?)<\/t>/)?.[1] ?? ""
    return decodeXmlEntity(text)
  }
  const value = inner.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? ""
  if (type === "s") return sharedStrings[Number(value)] ?? ""
  return decodeXmlEntity(value)
}

function decodeXmlEntity(value: string) {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
}

function jsonTableFromAsset(text: string) {
  const value = JSON.parse(text) as unknown
  if (Array.isArray(value) && value.length && value.every(isRecord)) {
    const headers = [...new Set(value.flatMap((row) => Object.keys(row)))]
    const rows = value.map((row) => headers.map((header) => jsonCell(row[header])))
    return markdownTableFromRows([headers, ...rows])
  }
  if (!isRecord(value)) return undefined
  const categories = value.categories ?? value.labels
  if (!Array.isArray(categories)) return undefined
  const series = value.series ?? value.datasets
  if (Array.isArray(series) && series.every(isRecord)) {
    const names = series.map((item) => jsonCell(item.name ?? "值"))
    const rows = categories.map((category, index) => [
      jsonCell(category),
      ...series.map((item) => jsonCell(jsonSeriesValues(item)[index])),
    ])
    return markdownTableFromRows([["分类", ...names], ...rows])
  }
  const values = value.values
  if (Array.isArray(values)) {
    const rows = categories.map((category, index) => [jsonCell(category), jsonCell(values[index])])
    return markdownTableFromRows([["分类", "值"], ...rows])
  }
  return undefined
}

function markdownTableFromRows(rows: string[][]) {
  if (!rows.length || !rows[0]?.length) return undefined
  const header = rows[0]
  const separator = header.map(() => "---").join(" | ")
  const body = rows
    .slice(1)
    .filter((row) => row.length >= header.length)
    .map((row) => `| ${row.slice(0, header.length).join(" | ")} |`)
  return body.length ? [`| ${header.join(" | ")} |`, `| ${separator} |`, ...body].join("\n") : undefined
}

function jsonCell(value: unknown) {
  if (value === null || value === undefined) return ""
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  return JSON.stringify(value)
}

function jsonSeriesValues(item: Record<string, unknown>) {
  const values = item.data ?? item.values
  return Array.isArray(values) ? values : []
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function markdownTableFromAsset(text: string) {
  const lines = text.split(/\r?\n/).map((line) => line.trim())
  const tableStart = lines.findIndex((line) => line.startsWith("|") && line.endsWith("|"))
  if (tableStart < 0 || tableStart + 1 >= lines.length) return undefined
  const table: string[] = []
  for (let index = tableStart; index < lines.length; index++) {
    const line = lines[index] ?? ""
    if (!line.startsWith("|") || !line.endsWith("|")) break
    table.push(line)
  }
  return table.length >= 2 ? table.join("\n") : undefined
}

function splitDelimitedLine(line: string, delimiter: "," | "\t") {
  const cells: string[] = []
  let current = ""
  let quoted = false
  for (let index = 0; index < line.length; index++) {
    const char = line[index] ?? ""
    if (char === '"') {
      quoted = !quoted
      continue
    }
    if (char === delimiter && !quoted) {
      cells.push(current)
      current = ""
      continue
    }
    current += char
  }
  cells.push(current)
  return cells
}

function base64Bytes(input: string) {
  const binary = atob(input)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
  return bytes
}

function extractTextShapes(xml: string): TextShape[] {
  const result: TextShape[] = []
  const shapePattern = /<p:sp>([\s\S]*?)<\/p:sp>/g
  for (const match of xml.matchAll(shapePattern)) {
    const block = match[0]
    if (!block.includes("<p:txBody>")) continue
    const sizes = [...block.matchAll(/sz="(\d+)"/g)].map((item) => Number(item[1]))
    const top = Number(block.match(/<a:off[^>]*y="(\d+)"/)?.[1] ?? Number.MAX_SAFE_INTEGER)
    result.push({
      block,
      maxSize: sizes.length ? Math.max(...sizes) : 0,
      top,
    })
  }
  return result
}

function pickTitleShape(shapes: TextShape[]): TextShape {
  return shapes.reduce((best, item) => {
    if (item.maxSize !== best.maxSize) return item.maxSize > best.maxSize ? item : best
    return item.top < best.top ? item : best
  })
}

function replaceShapeText(slideXml: string, shape: TextShape, lines: string[]): string {
  const block = shape.block
  const bodyStart = block.indexOf("<p:txBody>")
  const bodyEnd = block.lastIndexOf("</p:txBody>")
  if (bodyStart < 0 || bodyEnd < 0) return slideXml
  const prefix = block.slice(0, bodyStart)
  const suffix = block.slice(bodyEnd + "</p:txBody>".length)
  const rawBodyPrefix = block.slice(bodyStart + "<p:txBody>".length, block.indexOf("<a:p>", bodyStart))
  const bodyPrefix = fitTextBodyPrefix(rawBodyPrefix, lines)
  const runProps = block.match(/<a:rPr\b[^>]*\/>/)?.[0] ?? block.match(/<a:rPr\b[^>]*>[\s\S]*?<\/a:rPr>/)?.[0] ?? ""
  const paragraphs = lines.map((line) => formulaShapeParagraph(line, runProps)).join("")
  const nextBlock = `${prefix}<p:txBody>${bodyPrefix}${paragraphs}</p:txBody>${suffix}`
  return slideXml.replace(block, nextBlock)
}

function formulaShapeParagraph(line: string, runProps: string) {
  const segments = splitFormulaSegments(line)
  const blockFormula = segments.some((segment) => segment.kind === "block")
  const paragraphProps = blockFormula
    ? '<a:pPr algn="ctr"><a:lnSpc><a:spcPct val="105000"/></a:lnSpc><a:spcAft><a:spcPts val="200"/></a:spcAft></a:pPr>'
    : '<a:pPr marL="228600" indent="-228600"><a:lnSpc><a:spcPct val="105000"/></a:lnSpc><a:spcAft><a:spcPts val="200"/></a:spcAft><a:buChar char="•"/></a:pPr>'
  const runs = segments
    .map((segment) =>
      segment.kind === "text"
        ? runProps
          ? `<a:r>${runProps}<a:t>${xml(segment.value)}</a:t></a:r>`
          : `<a:r><a:t>${xml(segment.value)}</a:t></a:r>`
        : ommlMathXml(segment.latex, segment.kind === "block"),
    )
    .join("")
  return `<a:p>${paragraphProps}${runs}</a:p>`
}

function fitTextBodyPrefix(bodyPrefix: string, lines: string[]) {
  const totalChars = lines.reduce((sum, line) => sum + line.length + 2, 0)
  if (totalChars <= 16) return bodyPrefix
  const charScale = totalChars <= 32 ? 90000 : totalChars <= 72 ? 75000 : totalChars <= 140 ? 62000 : 50000
  const rowScale = lines.length >= 8 ? 50000 : lines.length >= 5 ? 62000 : lines.length >= 3 ? 75000 : 90000
  const fontScale = Math.min(charScale, rowScale)
  const bodyPr = bodyPrefix.match(/<a:bodyPr\b[^>]*\/>|<a:bodyPr\b[^>]*>[\s\S]*?<\/a:bodyPr>/)?.[0]
  if (!bodyPr) return bodyPrefix
  const fitted = bodyPr.includes("/>")
    ? bodyPr.replace(
        /<a:bodyPr\b([^>]*)\/>/,
        (match, attrs: string) => `<a:bodyPr${attrs}><a:normAutofit fontScale="${fontScale}"/></a:bodyPr>`,
      )
    : bodyPr.replace(
        /<a:bodyPr\b([^>]*)>[\s\S]*?<\/a:bodyPr>/,
        (match, attrs: string) => `<a:bodyPr${attrs}><a:normAutofit fontScale="${fontScale}"/></a:bodyPr>`,
      )
  return bodyPrefix.replace(bodyPr, fitted)
}

function contentLines(content: string): string[] {
  return content
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-*•]\s*/, "").trim())
    .filter((line) => line.length > 0)
}

function normalizePartPath(target: string) {
  const value = target.replaceAll("\\", "/").replace(/^\.\//, "")
  return value.startsWith("/") ? `ppt${value}` : `ppt/${value}`
}

function relsPathFor(path: string) {
  return path.replace(/\/([^/]+)\.xml$/, "/_rels/$1.xml.rels")
}

function filenameSafe(input: string) {
  const value = input
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
  return value || "办公产物"
}

function xml(input: string) {
  return input.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}
