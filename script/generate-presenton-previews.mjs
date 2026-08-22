import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { templateV2UiToHtml } from "./vendor/presenton-template-v2-json-to-html.mjs"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, "..")
const templateRoot = resolve(repoRoot, "packages/novaway/src/skill/prompt/office-ppt/templates/presenton")
const outputRoot = resolve(repoRoot, "packages/app/public/assets/office-ppt-templates/presenton")
const upstreamRoot = resolve(repoRoot, ".tmp/presenton-upstream/servers/nextjs")
const chartScript = join(upstreamRoot, "public/vendor/chart-4.5.1.umd.min.js")
const chartDataLabelsScript = join(upstreamRoot, "public/vendor/chartjs-plugin-datalabels-2.2.0.min.js")

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
    if (!layout) {
      throw new Error(`模板 ${template.id} 缺少 ${role} 页面布局`)
    }
    selected.add(layout)
    result.set(role, layout)
  }
  return result
}

function renderPageHtml(template, layout) {
  const ui = { components: layout.components ?? [] }
  let html = templateV2UiToHtml(ui, { fonts: template.fonts })
  if (!html) {
    throw new Error(`模板 ${template.id} 的布局 ${layout.id} 无法渲染`)
  }

  html = html
    .replaceAll("/vendor/chart-4.5.1.umd.min.js", pathToFileURL(chartScript).href)
    .replaceAll("/vendor/chartjs-plugin-datalabels-2.2.0.min.js", pathToFileURL(chartDataLabelsScript).href)
  return html
}

function capturePage(template, role, htmlPath, outputPath) {
  const chrome = process.env.CHROME_PATH ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
  const args = [
    "--headless=new",
    "--disable-gpu",
    "--no-sandbox",
    "--hide-scrollbars",
    "--run-all-compositor-stages-before-draw",
    "--virtual-time-budget=3000",
    "--window-size=1280,720",
    "--force-device-scale-factor=1",
    "--screenshot-format=jpeg",
    "--screenshot-quality=80",
    `--screenshot=${outputPath}`,
    pathToFileURL(htmlPath).href,
  ]
  const result = spawnSync(chrome, args, {
    timeout: 30_000,
    stdio: "ignore",
    windowsHide: true,
  })
  if (result.status !== 0 || !existsSync(outputPath)) {
    throw new Error(`截图失败：${template.id}/${role} (exit=${result.status}, error=${result.error ?? "unknown"})`)
  }
}

function generateFamily(family) {
  const templatePath = join(templateRoot, family, "template.json")
  const template = JSON.parse(readFileSync(templatePath, "utf8"))
  const layouts = resolvePreviewLayouts(template)
  const familyOutput = join(outputRoot, family)
  mkdirSync(familyOutput, { recursive: true })

  for (const role of pageRoles) {
    const layout = layouts.get(role)
    const htmlPath = join(templateRoot, family, `preview-${role}.html`)
    const outputPath = join(familyOutput, `${role}.jpg`)
    writeFileSync(htmlPath, renderPageHtml(template, layout), "utf8")
    try {
      capturePage(template, role, htmlPath, outputPath)
    } finally {
      rmSync(htmlPath, { force: true })
    }
    console.log(`生成 ${family}/${role}.jpg <- ${layout.id}`)
  }
}

for (const family of families) {
  generateFamily(family)
}
