import { spawnSync } from "node:child_process"
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { templateV2UiToHtml } from "./vendor/presenton-template-v2-json-to-html.mjs"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, "..")
const templateRoot = resolve(repoRoot, "packages/opencode/src/skill/prompt/office-ppt/templates/presenton")
const outputRoot = resolve(repoRoot, "packages/app/public/assets/office-ppt-templates/presenton-pptx")
const deckRoot = resolve(repoRoot, ".tmp/presenton-pptx-deck")
const opencodeDir = resolve(repoRoot, "packages/opencode")
const chartScript = join(repoRoot, "script/vendor/presenton-charts/chart-4.5.1.umd.min.js")
const chartDataLabelsScript = join(repoRoot, "script/vendor/presenton-charts/chartjs-plugin-datalabels-2.2.0.min.js")

const families = ["dynamic", "editorial", "executive", "general", "modern", "momentum", "standard", "swift"]
const pageRoles = ["cover", "overview", "content", "cards", "data", "closing"]

const rolePatterns = {
  cover: [/cover|opening|hero.*title|main.*title/i],
  overview: [/agenda|contents|table of contents|overview|intro|headline.*description|section/i],
  content: [/content|explainer|solution|features?|columns|callouts|text|media|visual/i],
  cards: [/cards?|stepped|staggered|grid|pillars/i],
  data: [/chart|metric|kpi|performance|data|dashboard|financial|statistics|scorecard/i],
  closing: [/closing|conclusion|takeaway|wrap.*up|ending|summary/i],
}

function pickLayout(template, role, selected) {
  const patterns = rolePatterns[role]
  const matched = template.layouts.find(
    (layout) =>
      !selected.has(layout) &&
      patterns.some((pattern) => pattern.test(`${layout.description ?? ""}\n${layout.id ?? ""}`)),
  )
  if (matched) return matched
  if (role === "cover") return template.layouts[0]
  if (role === "data") {
    const chart = template.layouts.find(
      (layout) =>
        !selected.has(layout) &&
        (JSON.stringify(layout).includes('"type":"chart"') || JSON.stringify(layout).includes("chartType")),
    )
    if (chart) return chart
  }
  if (role === "closing") return template.layouts.at(-1)
  return template.layouts.find((layout) => !selected.has(layout))
}

function resolvePreviewLayouts(template) {
  const selected = new Set()
  const result = new Map()
  for (const role of pageRoles) {
    const layout = pickLayout(template, role, selected)
    if (!layout) throw new Error(`模板 ${template.id} 缺少 ${role} 页面布局`)
    selected.add(layout)
    result.set(role, layout)
  }
  return result
}

function renderPageHtml(template, layout) {
  const ui = { components: layout.components ?? [] }
  let html = templateV2UiToHtml(ui, { fonts: template.fonts })
  if (!html) throw new Error(`模板 ${template.id} 的布局 ${layout.id} 无法渲染`)

  html = html
    .replace(/<link[^>]+fonts\.googleapis\.com[^>]*>/g, "")
    .replaceAll('"/static/', '"../assets/')
    .replaceAll("'/static/", "'../assets/")
    .replaceAll('"/vendor/chart-4.5.1.umd.min.js"', `"${pathToFileURL(chartScript).href}"`)
    .replaceAll('"/vendor/chartjs-plugin-datalabels-2.2.0.min.js"', `"${pathToFileURL(chartDataLabelsScript).href}"`)
  return html
}

function ensurePlaceholderImage(deckDir, family) {
  const placeholderDir = join(deckDir, "assets/images")
  mkdirSync(placeholderDir, { recursive: true })
  const source = join(templateRoot, family, "static/thumbnail.png")
  const target = join(placeholderDir, "replaceable_template_image.png")
  if (existsSync(source)) copyFileSync(source, target)
  else
    writeFileSync(
      target,
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        "base64",
      ),
    )
}

for (const family of families) {
  const templatePath = join(templateRoot, family, "template.json")
  const template = JSON.parse(readFileSync(templatePath, "utf8"))
  const layouts = resolvePreviewLayouts(template)
  const deckDir = join(deckRoot, family)
  const pagesDir = join(deckDir, "pages")
  const assetsDir = join(deckDir, "assets")
  const staticDir = join(templateRoot, family, "static")
  mkdirSync(pagesDir, { recursive: true })
  cpSync(staticDir, assetsDir, { recursive: true })
  ensurePlaceholderImage(deckDir, family)

  pageRoles.forEach((role, index) => {
    const html = renderPageHtml(template, layouts.get(role))
    writeFileSync(join(pagesDir, `page_${String(index + 1).padStart(2, "0")}.html`), html, "utf8")
  })

  const outputDir = join(outputRoot, family)
  mkdirSync(outputDir, { recursive: true })
  const output = join(outputDir, "template.pptx")
  const result = spawnSync(
    "bun",
    ["run", "--cwd", opencodeDir, "src/index.ts", "office-ppt", deckDir, "--force", "--output", output],
    {
      encoding: "utf8",
      stdio: "inherit",
      timeout: 180_000,
    },
  )
  if (result.status !== 0) throw new Error(`Presenton ${family} 转 PPTX 失败`)
  console.log(`生成 ${family}/template.pptx`)
}
