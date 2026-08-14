import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, "..")
const revealRoot = resolve(repoRoot, "script/vendor/reveal")
const buildRoot = resolve(repoRoot, ".tmp/reveal-preview-build")
const outputRoot = resolve(repoRoot, "packages/app/public/assets/office-ppt-templates/reveal")

const themes = [
  ["black", "Black 黑色极简"],
  ["white", "White 白色干净"],
  ["league", "League 深色发布会"],
  ["beige", "Beige 米色商务"],
  ["sky", "Sky 天空清爽"],
  ["simple", "Simple 简洁无衬线"],
  ["serif", "Serif 衬线论文"],
  ["blood", "Blood 深红高对比"],
  ["night", "Night 深蓝夜间"],
  ["moon", "Moon 冷灰月夜"],
  ["solarized", "Solarized 暖纸阅读"],
  ["dracula", "Dracula 暗色开发"],
]

const pageRoles = ["cover", "overview", "content", "cards", "data", "closing"]

function buildOfflineThemeCss(theme) {
  const source = readFileSync(join(revealRoot, "theme", `${theme}.css`), "utf8")
  return source.replace(/@import url\(https:\/\/[^)]+\);?\s*/g, "/* 离线预览：移除外部字体依赖 */\n")
}

const themeLayoutModes = {
  black: { cover: "center", overview: "grid", content: "columns", cards: "grid", data: "metrics", closing: "center" },
  white: { cover: "left", overview: "list", content: "split", cards: "2x2", data: "table", closing: "action" },
  league: {
    cover: "split",
    overview: "chapters",
    content: "columns",
    cards: "stacked",
    data: "bars",
    closing: "center",
  },
  beige: { cover: "paper", overview: "list", content: "manuscript", cards: "notes", data: "table", closing: "quote" },
  sky: { cover: "left", overview: "chips", content: "columns", cards: "grid", data: "metrics", closing: "action" },
  simple: { cover: "center", overview: "table", content: "split", cards: "grid", data: "bars", closing: "center" },
  serif: {
    cover: "paper",
    overview: "chapters",
    content: "manuscript",
    cards: "notes",
    data: "table",
    closing: "thanks",
  },
  blood: { cover: "split", overview: "list", content: "risk", cards: "vertical", data: "bars", closing: "action" },
  night: { cover: "center", overview: "chapters", content: "pillars", cards: "2x2", data: "kpis", closing: "center" },
  moon: { cover: "left", overview: "grid", content: "pillars", cards: "modules", data: "gauge", closing: "footer" },
  solarized: {
    cover: "paper",
    overview: "grid",
    content: "manuscript",
    cards: "notes",
    data: "bars",
    closing: "footer",
  },
  dracula: {
    cover: "terminal",
    overview: "code",
    content: "terminal",
    cards: "modules",
    data: "terminal",
    closing: "terminal",
  },
}

function previewSlide(className, inner) {
  return `<section class="preview-slide ${className}">${inner}</section>`
}

function coverSlide(mode) {
  if (mode === "split")
    return previewSlide(
      "preview-cover layout-split",
      `<div class="split-frame">
        <div class="split-main">
          <div class="preview-kicker">NovaWay AI Office / 2026</div>
          <h1>战略发展汇报</h1>
          <p class="preview-subtitle">从市场判断、关键举措到落地节奏，形成一套完整业务叙事。</p>
        </div>
        <div class="split-side">
          <strong>Q3</strong>
          <span>方案评审</span>
          <span>增长与产品委员会</span>
        </div>
      </div>`,
    )
  if (mode === "paper")
    return previewSlide(
      "preview-cover layout-paper",
      `<div class="paper-chapter">Chapter 01 · NovaWay AI Office</div>
      <h1>2026 战略发展汇报</h1>
      <p class="preview-subtitle">从市场判断、关键举措到落地节奏，用一套完整叙事呈现业务路径、核心数据和下一阶段行动。</p>
      <div class="preview-meta">方案评审 · 增长与产品委员会 · 2026 Q3</div>`,
    )
  if (mode === "terminal")
    return previewSlide(
      "preview-cover layout-terminal",
      `<div class="terminal-window">
        <div class="terminal-bar"><span>NovaWay AI Office</span><span>report.md</span></div>
        <div class="terminal-body">
          <div class="preview-kicker">$ nova-ppt --theme dracula</div>
          <h1>2026 战略发展汇报</h1>
          <p class="preview-subtitle">从市场判断、关键举措到落地节奏，用一套完整叙事呈现业务路径、核心数据和下一阶段行动。</p>
          <div class="preview-meta">方案评审 · 增长与产品委员会 · 2026 Q3</div>
        </div>
      </div>`,
    )
  return previewSlide(
    "preview-cover layout-left",
    `<div class="layout-topline"></div>
    <div class="preview-kicker">NovaWay AI Office</div>
    <h1>2026 战略发展汇报</h1>
    <p class="preview-subtitle">从市场判断、关键举措到落地节奏，用一套完整叙事呈现业务路径、核心数据和下一阶段行动。</p>
    <div class="preview-meta">方案评审 · 增长与产品委员会 · 2026 Q3</div>`,
  )
}

function overviewSlide(mode) {
  const items = [
    ["01", "市场判断", "行业趋势、客户需求与竞争格局"],
    ["02", "核心策略", "产品主线、组织能力与增长路径"],
    ["03", "关键指标", "经营结果、过程指标与健康度"],
    ["04", "行动计划", "里程碑、责任人与风险应对"],
  ]
  if (mode === "chips")
    return previewSlide(
      "preview-overview layout-chips",
      `<div class="preview-kicker">Agenda</div><h2>汇报框架</h2>
      <div class="chips">${items.map(([n, title, desc]) => `<div><span>${n}</span><strong>${title}</strong><p>${desc}</p></div>`).join("")}</div>`,
    )
  if (mode === "chapters")
    return previewSlide(
      "preview-overview layout-chapters",
      `<div class="preview-kicker">Agenda</div><h2>汇报框架</h2>
      <div class="chapters">${items.map(([n, title, desc]) => `<div><span>${n}</span><div><strong>${title}</strong><p>${desc}</p></div></div>`).join("")}</div>`,
    )
  if (mode === "table")
    return previewSlide(
      "preview-overview layout-table",
      `<div class="preview-kicker">Agenda</div><h2>汇报框架</h2>
      <div class="ruled-table">${items.map(([n, title, desc]) => `<div><span>${n}</span><strong>${title}</strong><p>${desc}</p></div>`).join("")}</div>`,
    )
  if (mode === "code")
    return previewSlide(
      "preview-overview layout-code",
      `<div class="terminal-window">
        <div class="terminal-bar"><span>agenda.ts</span><span>4 sections</span></div>
        <div class="terminal-body code-lines">${items.map(([n, title, desc]) => `<div><b>${n}</b><strong>${title}</strong><span>${desc}</span></div>`).join("")}</div>
      </div>`,
    )
  return previewSlide(
    "preview-overview layout-list",
    `<div class="preview-kicker">Agenda</div><h2>汇报框架</h2>
    <div class="stack-list">${items.map(([n, title, desc]) => `<div><span>${n}</span><strong>${title}</strong><p>${desc}</p></div>`).join("")}</div>`,
  )
}

function contentSlide(mode) {
  if (mode === "risk")
    return previewSlide(
      "preview-content layout-risk",
      `<div class="preview-kicker">Risk Review</div><h2>风险与应对</h2>
      <div class="risk-grid">
        <div><span>HIGH</span><strong>交付节奏</strong><p>关键里程碑存在依赖，需要提前确认资源。</p></div>
        <div><span>MED</span><strong>数据质量</strong><p>指标口径仍待统一，影响后续复盘。</p></div>
        <div><span>LOW</span><strong>组织协同</strong><p>跨团队信息同步机制已经建立。</p></div>
      </div>`,
    )
  if (mode === "pillars")
    return previewSlide(
      "preview-content layout-pillars",
      `<div class="preview-kicker">Core Strategy</div><h2>核心策略与执行路径</h2>
      <div class="pillars">
        <div><b>01</b><strong>聚焦高价值场景</strong><p>围绕企业办公、知识沉淀和协作效率形成更清晰的客户价值闭环。</p></div>
        <div><b>02</b><strong>强化 AI 原生体验</strong><p>把生成、修订和交付嵌入真实工作流，降低使用门槛并提升完成度。</p></div>
        <div><b>03</b><strong>构建开放生态</strong><p>通过标准接口和可复用组件，与行业伙伴共同扩展应用边界。</p></div>
      </div>`,
    )
  if (mode === "manuscript")
    return previewSlide(
      "preview-content layout-manuscript",
      `<div class="preview-kicker">Core Strategy</div><h2>核心策略与执行路径</h2>
      <div class="manuscript">
        <p>围绕企业办公、知识沉淀和协作效率，形成更清晰的客户价值闭环。AI 原生体验需要把生成、修订和交付嵌入真实工作流，而不是停留在单点功能。</p>
        <p>通过标准接口和可复用组件，与行业伙伴共同扩展应用边界。经营结果、过程指标与健康度共同构成下一阶段的决策依据。</p>
      </div>`,
    )
  if (mode === "terminal")
    return previewSlide(
      "preview-content layout-terminal",
      `<div class="terminal-window">
        <div class="terminal-bar"><span>strategy.tsx</span><span>3 modules</span></div>
        <div class="terminal-body code-cards">
          <div><b>01</b><strong>聚焦高价值场景</strong><p>围绕企业办公、知识沉淀和协作效率形成客户价值闭环。</p></div>
          <div><b>02</b><strong>强化 AI 原生体验</strong><p>把生成、修订和交付嵌入真实工作流。</p></div>
          <div><b>03</b><strong>构建开放生态</strong><p>通过标准接口和可复用组件扩展应用边界。</p></div>
        </div>
      </div>`,
    )
  return previewSlide(
    "preview-content layout-split",
    `<div class="split-content">
      <div class="split-title">
        <div class="preview-kicker">Core Strategy</div>
        <h2>核心策略<br>与执行路径</h2>
      </div>
      <div class="split-copy">
        <p><strong>01 聚焦高价值场景</strong>围绕企业办公、知识沉淀和协作效率形成更清晰的客户价值闭环。</p>
        <p><strong>02 强化 AI 原生体验</strong>把生成、修订和交付嵌入真实工作流，降低使用门槛并提升完成度。</p>
        <p><strong>03 构建开放生态</strong>通过标准接口和可复用组件，与行业伙伴共同扩展应用边界。</p>
      </div>
    </div>`,
  )
}

function cardsSlide(mode) {
  const cards = [
    ["01", "智能文档", "从草稿到成稿的自动生成与专业排版"],
    ["02", "演示设计", "基于真实模板输出规范、一致的高质量页面"],
    ["03", "会议协同", "自动沉淀结论、决策和可执行行动项"],
    ["04", "知识管理", "跨文档检索、摘要、对比与持续复用"],
  ]
  if (mode === "stacked")
    return previewSlide(
      "preview-cards layout-stacked",
      `<div class="preview-kicker">Solution Cards</div><h2>四大能力模块</h2>
      <div class="stack-list">${cards.map(([n, title, desc]) => `<div><span>${n}</span><strong>${title}</strong><p>${desc}</p></div>`).join("")}</div>`,
    )
  if (mode === "2x2")
    return previewSlide(
      "preview-cards layout-2x2",
      `<div class="preview-kicker">Solution Cards</div><h2>四大能力模块</h2>
      <div class="grid-2x2">${cards.map(([n, title, desc]) => `<div><span>${n}</span><strong>${title}</strong><p>${desc}</p></div>`).join("")}</div>`,
    )
  if (mode === "vertical")
    return previewSlide(
      "preview-cards layout-vertical",
      `<div class="preview-kicker">Solution Cards</div><h2>四大能力模块</h2>
      <div class="vertical-cards">${cards.map(([n, title, desc]) => `<div><span>${n}</span><strong>${title}</strong><p>${desc}</p></div>`).join("")}</div>`,
    )
  if (mode === "modules")
    return previewSlide(
      "preview-cards layout-modules",
      `<div class="terminal-window">
        <div class="terminal-bar"><span>modules</span><span>4 packages</span></div>
        <div class="terminal-body module-grid">${cards.map(([n, title, desc]) => `<div><b>${n}</b><strong>${title}</strong><p>${desc}</p></div>`).join("")}</div>
      </div>`,
    )
  if (mode === "notes")
    return previewSlide(
      "preview-cards layout-notes",
      `<div class="preview-kicker">Solution Cards</div><h2>四大能力模块</h2>
      <div class="note-cards">${cards.map(([n, title, desc]) => `<div><span>${n}</span><strong>${title}</strong><p>${desc}</p></div>`).join("")}</div>`,
    )
  return previewSlide(
    "preview-cards layout-grid",
    `<div class="preview-kicker">Solution Cards</div><h2>四大能力模块</h2>
    <div class="preview-grid">${cards.map(([n, title, desc]) => `<div><span>${n}</span><strong>${title}</strong><p>${desc}</p></div>`).join("")}</div>`,
  )
}

function dataSlide(mode) {
  if (mode === "table")
    return previewSlide(
      "preview-data layout-table",
      `<div class="preview-kicker">Key Metrics</div><h2>关键指标一览</h2>
      <div class="ruled-table">
        <div><span>指标</span><strong>本季度</strong><p>目标达成率</p></div>
        <div><span>128%</span><strong>46%</strong><p>AI 生成内容采纳率</p></div>
        <div><span>3.8x</span><strong>82%</strong><p>方案制作效率提升</p></div>
        <div><span>96%</span><strong>18 项</strong><p>关键项目按时完成</p></div>
      </div>`,
    )
  if (mode === "kpis")
    return previewSlide(
      "preview-data layout-kpis",
      `<div class="preview-kicker">Key Metrics</div><h2>关键指标一览</h2>
      <div class="kpi-grid">
        <div><strong>128%</strong><span>年度目标达成率</span></div>
        <div><strong>46%</strong><span>AI 生成内容采纳率</span></div>
        <div><strong>3.8x</strong><span>方案制作效率提升</span></div>
        <div><strong>18</strong><span>关键项目按时完成</span></div>
      </div>`,
    )
  if (mode === "gauge")
    return previewSlide(
      "preview-data layout-gauge",
      `<div class="preview-kicker">Key Metrics</div><h2>关键指标一览</h2>
      <div class="gauge-grid">
        <div><i style="height: 82%"></i><strong>128%</strong><span>目标达成率</span></div>
        <div><i style="height: 56%"></i><strong>46%</strong><span>内容采纳率</span></div>
        <div><i style="height: 74%"></i><strong>3.8x</strong><span>制作效率</span></div>
        <div><i style="height: 68%"></i><strong>18</strong><span>项目完成</span></div>
      </div>`,
    )
  if (mode === "terminal")
    return previewSlide(
      "preview-data layout-terminal",
      `<div class="terminal-window">
        <div class="terminal-bar"><span>metrics.sh</span><span>4 KPIs</span></div>
        <div class="terminal-body terminal-metrics">
          <div><b>Q1</b><span>46%</span><i style="width: 46%"></i></div>
          <div><b>Q2</b><span>64%</span><i style="width: 64%"></i></div>
          <div><b>Q3</b><span>82%</span><i style="width: 82%"></i></div>
          <div><b>Q4</b><span>96%</span><i style="width: 96%"></i></div>
        </div>
      </div>`,
    )
  return previewSlide(
    "preview-data layout-bars",
    `<div class="preview-kicker">Key Metrics</div><h2>关键指标一览</h2>
    <div class="preview-metrics">
      <div><strong>128%</strong><span>年度目标达成率</span></div>
      <div><strong>46%</strong><span>AI 生成内容采纳率</span></div>
      <div><strong>3.8x</strong><span>方案制作效率提升</span></div>
    </div>
    <div class="preview-bars">
      <div><span>Q1</span><i style="width: 46%"></i></div>
      <div><span>Q2</span><i style="width: 64%"></i></div>
      <div><span>Q3</span><i style="width: 82%"></i></div>
      <div><span>Q4</span><i style="width: 96%"></i></div>
    </div>`,
  )
}

function closingSlide(mode) {
  if (mode === "action")
    return previewSlide(
      "preview-closing layout-action",
      `<div class="preview-kicker">Next Steps</div><h2>下一步行动</h2>
      <div class="preview-closing-list">
        <div><strong>完成核心场景验证</strong><p>在三个重点客户群体中完成试点与价值评估</p></div>
        <div><strong>发布开放接口</strong><p>提供标准模板接入和生态扩展能力</p></div>
        <div><strong>建立季度复盘机制</strong><p>用数据驱动持续优化产品节奏与资源投入</p></div>
      </div>
      <div class="preview-footer">NovaWay · 让复杂工作更快被完成</div>`,
    )
  if (mode === "quote")
    return previewSlide(
      "preview-closing layout-quote",
      `<div class="preview-kicker">Takeaway</div>
      <blockquote>让复杂工作更快被完成，而不是让工具变得更复杂。</blockquote>
      <div class="preview-footer">NovaWay · 2026 战略发展汇报</div>`,
    )
  if (mode === "thanks")
    return previewSlide(
      "preview-closing layout-thanks",
      `<div class="preview-kicker">End</div>
      <h1>谢谢</h1>
      <p class="preview-subtitle">欢迎提出建议，共同推进下一阶段行动计划。</p>
      <div class="preview-meta">NovaWay · 2026</div>`,
    )
  if (mode === "footer")
    return previewSlide(
      "preview-closing layout-footer",
      `<div class="preview-kicker">Next Steps</div><h2>下一步行动</h2>
      <div class="stack-list">
        <div><span>01</span><strong>完成核心场景验证</strong><p>在三个重点客户群体中完成试点与价值评估</p></div>
        <div><span>02</span><strong>发布开放接口</strong><p>提供标准模板接入和生态扩展能力</p></div>
        <div><span>03</span><strong>建立季度复盘机制</strong><p>用数据驱动持续优化产品节奏与资源投入</p></div>
      </div>
      <div class="preview-footer">NovaWay · 让复杂工作更快被完成</div>`,
    )
  if (mode === "terminal")
    return previewSlide(
      "preview-closing layout-terminal",
      `<div class="terminal-window">
        <div class="terminal-bar"><span>next.sh</span><span>ready</span></div>
        <div class="terminal-body">
          <div class="preview-kicker">$ nova --next</div>
          <h2>下一步行动</h2>
          <div class="code-lines">
            <div><b>01</b><strong>完成核心场景验证</strong><span>三个重点客户群体试点</span></div>
            <div><b>02</b><strong>发布开放接口</strong><span>标准模板接入与生态扩展</span></div>
            <div><b>03</b><strong>建立季度复盘机制</strong><span>数据驱动产品节奏</span></div>
          </div>
        </div>
      </div>`,
    )
  return previewSlide(
    "preview-closing layout-center",
    `<div class="preview-kicker">Next Steps</div><h2>下一步行动</h2>
    <div class="preview-closing-list">
      <div><strong>完成核心场景验证</strong><p>在三个重点客户群体中完成试点与价值评估</p></div>
      <div><strong>发布开放接口</strong><p>提供标准模板接入和生态扩展能力</p></div>
      <div><strong>建立季度复盘机制</strong><p>用数据驱动持续优化产品节奏与资源投入</p></div>
    </div>
    <div class="preview-footer">NovaWay · 让复杂工作更快被完成</div>`,
  )
}

function previewSlides(theme) {
  const modes = themeLayoutModes[theme] ?? themeLayoutModes.white
  return [
    coverSlide(modes.cover),
    overviewSlide(modes.overview),
    contentSlide(modes.content),
    cardsSlide(modes.cards),
    dataSlide(modes.data),
    closingSlide(modes.closing),
  ]
}

function renderPreviewHtml(theme) {
  const revealCss = pathToFileURL(join(revealRoot, "reveal.css")).href
  const resetCss = pathToFileURL(join(revealRoot, "reset.css")).href
  const themeCss = pathToFileURL(join(buildRoot, "theme", `${theme}.css`)).href
  const revealJs = pathToFileURL(join(revealRoot, "reveal.js")).href

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <link rel="stylesheet" href="${resetCss}">
  <link rel="stylesheet" href="${revealCss}">
  <link rel="stylesheet" href="${themeCss}">
  <style>
    html, body { width: 1280px; height: 720px; margin: 0; overflow: hidden; }
    .reveal, .reveal-viewport { width: 1280px; height: 720px; }
    .reveal .slides section.preview-slide {
      width: 1280px;
      height: 720px;
      box-sizing: border-box;
      padding: 72px 86px;
      text-align: left;
      font-family: var(--r-main-font), "Microsoft YaHei", "PingFang SC", sans-serif;
    }
    .preview-slide h1, .preview-slide h2 {
      margin: 12px 0 22px;
      font-family: var(--r-heading-font), "Microsoft YaHei", "PingFang SC", sans-serif;
      text-shadow: none;
    }
    .preview-slide h1 { font-size: 62px; line-height: 1.08; }
    .preview-slide h2 { font-size: 40px; line-height: 1.12; }
    .preview-kicker {
      margin-bottom: 14px;
      color: var(--r-link-color);
      font-size: 15px;
      font-weight: 700;
      letter-spacing: 2px;
      text-transform: uppercase;
    }
    .preview-subtitle { max-width: 930px; font-size: 22px; line-height: 1.6; opacity: 0.92; }
    .preview-meta {
      margin-top: 44px;
      font-size: 16px;
      opacity: 0.68;
    }
    .preview-list, .preview-grid, .preview-columns {
      display: grid;
      gap: 14px;
      margin-top: 28px;
    }
    .preview-list { grid-template-columns: 1fr 1fr; }
    .preview-grid { grid-template-columns: repeat(4, 1fr); }
    .preview-columns { grid-template-columns: repeat(3, 1fr); }
    .preview-list > div, .preview-grid > div, .preview-columns > div {
      padding: 18px 20px;
      border: 1px solid color-mix(in srgb, var(--r-main-color) 22%, transparent);
      border-radius: 8px;
      background: color-mix(in srgb, var(--r-main-color) 8%, transparent);
    }
    .preview-list span, .preview-grid span {
      display: block;
      margin-bottom: 10px;
      color: var(--r-link-color);
      font-size: 14px;
      font-weight: 700;
    }
    .preview-list strong, .preview-grid strong, .preview-columns strong {
      display: block;
      font-size: 20px;
      line-height: 1.3;
    }
    .preview-list p, .preview-grid p, .preview-columns p {
      margin: 8px 0 0;
      font-size: 15px;
      line-height: 1.55;
      opacity: 0.8;
    }
    .preview-metrics {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 16px;
      margin-top: 30px;
    }
    .preview-metrics > div {
      padding: 20px;
      border: 1px solid color-mix(in srgb, var(--r-main-color) 22%, transparent);
      border-radius: 8px;
      background: color-mix(in srgb, var(--r-main-color) 8%, transparent);
    }
    .preview-metrics strong {
      display: block;
      color: var(--r-link-color);
      font-size: 38px;
      line-height: 1;
    }
    .preview-metrics span {
      display: block;
      margin-top: 10px;
      font-size: 15px;
      opacity: 0.78;
    }
    .preview-bars {
      display: grid;
      gap: 12px;
      margin-top: 28px;
    }
    .preview-bars > div {
      display: grid;
      grid-template-columns: 56px 1fr;
      align-items: center;
      gap: 12px;
    }
    .preview-bars span { font-size: 14px; font-weight: 700; opacity: 0.8; }
    .preview-bars i {
      display: block;
      height: 16px;
      border-radius: 8px;
      background: var(--r-link-color);
      opacity: 0.9;
    }
    .preview-closing-list {
      display: grid;
      gap: 14px;
      margin-top: 28px;
    }
    .preview-closing-list > div {
      padding: 16px 20px;
      border-left: 4px solid var(--r-link-color);
      background: color-mix(in srgb, var(--r-main-color) 7%, transparent);
    }
    .preview-closing-list strong { font-size: 20px; }
    .preview-closing-list p { margin: 6px 0 0; font-size: 15px; opacity: 0.78; }
    .preview-footer {
      margin-top: 40px;
      font-size: 15px;
      font-weight: 700;
      opacity: 0.72;
    }
    .preview-slide { position: relative; }
    .layout-topline {
      width: 180px;
      height: 5px;
      margin-bottom: 28px;
      background: var(--r-link-color);
    }
    .split-frame {
      display: grid;
      grid-template-columns: 1fr 300px;
      gap: 36px;
      align-items: stretch;
      min-height: 100%;
    }
    .split-main { display: flex; flex-direction: column; justify-content: center; }
    .split-side {
      display: flex;
      flex-direction: column;
      justify-content: flex-end;
      gap: 10px;
      padding: 28px 0 28px 34px;
      border-left: 3px solid var(--r-link-color);
      font-size: 16px;
      opacity: 0.9;
    }
    .split-side strong { font-size: 58px; line-height: 1; }
    .paper-chapter {
      margin-bottom: 22px;
      font-size: 15px;
      font-weight: 700;
      letter-spacing: 2px;
      opacity: 0.72;
    }
    .terminal-window {
      border: 1px solid color-mix(in srgb, var(--r-main-color) 28%, transparent);
      border-radius: 10px;
      overflow: hidden;
      background: color-mix(in srgb, var(--r-main-color) 7%, transparent);
    }
    .terminal-bar {
      display: flex;
      justify-content: space-between;
      padding: 12px 18px;
      border-bottom: 1px solid color-mix(in srgb, var(--r-main-color) 22%, transparent);
      font-size: 13px;
      font-weight: 700;
      letter-spacing: 1px;
      opacity: 0.78;
    }
    .terminal-body { padding: 28px 34px 34px; }
    .stack-list {
      display: grid;
      gap: 0;
      margin-top: 22px;
    }
    .stack-list > div {
      display: grid;
      grid-template-columns: 70px 1fr 2fr;
      gap: 18px;
      align-items: center;
      padding: 18px 4px;
      border-bottom: 1px solid color-mix(in srgb, var(--r-main-color) 18%, transparent);
    }
    .stack-list span, .stack-list b { color: var(--r-link-color); font-size: 18px; font-weight: 800; }
    .stack-list strong { font-size: 20px; }
    .stack-list p { margin: 0; font-size: 15px; opacity: 0.78; }
    .chips {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 14px;
      margin-top: 28px;
    }
    .chips > div {
      padding: 20px 18px;
      border: 1px solid color-mix(in srgb, var(--r-main-color) 18%, transparent);
      border-radius: 14px;
      background: color-mix(in srgb, var(--r-main-color) 7%, transparent);
    }
    .chips span { display: block; color: var(--r-link-color); font-size: 14px; font-weight: 800; }
    .chips strong { display: block; margin-top: 12px; font-size: 20px; }
    .chips p { margin: 8px 0 0; font-size: 14px; line-height: 1.5; opacity: 0.76; }
    .chapters {
      display: grid;
      gap: 10px;
      margin-top: 26px;
    }
    .chapters > div {
      display: grid;
      grid-template-columns: 96px 1fr;
      gap: 18px;
      align-items: baseline;
      padding: 15px 0;
      border-bottom: 1px solid color-mix(in srgb, var(--r-main-color) 16%, transparent);
    }
    .chapters span { color: var(--r-link-color); font-size: 34px; font-weight: 800; }
    .chapters strong { font-size: 21px; }
    .chapters p { margin: 5px 0 0; font-size: 15px; opacity: 0.76; }
    .ruled-table {
      display: grid;
      margin-top: 26px;
      border-top: 2px solid color-mix(in srgb, var(--r-main-color) 45%, transparent);
    }
    .ruled-table > div {
      display: grid;
      grid-template-columns: 90px 1fr 1.4fr;
      gap: 18px;
      align-items: center;
      padding: 16px 8px;
      border-bottom: 1px solid color-mix(in srgb, var(--r-main-color) 18%, transparent);
    }
    .ruled-table span { color: var(--r-link-color); font-size: 20px; font-weight: 800; }
    .ruled-table strong { font-size: 19px; }
    .ruled-table p { margin: 0; font-size: 15px; opacity: 0.76; }
    .code-lines {
      display: grid;
      gap: 12px;
      font-family: Consolas, "SF Mono", monospace;
    }
    .code-lines > div {
      display: grid;
      grid-template-columns: 52px 1fr 1.4fr;
      gap: 14px;
      align-items: center;
      padding: 10px 12px;
      border-left: 3px solid var(--r-link-color);
      background: color-mix(in srgb, var(--r-main-color) 6%, transparent);
    }
    .code-lines b { color: var(--r-link-color); }
    .code-lines strong { font-size: 17px; }
    .code-lines span { font-size: 14px; opacity: 0.74; }
    .grid-2x2 {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
      margin-top: 26px;
    }
    .grid-2x2 > div {
      min-height: 138px;
      padding: 20px 22px;
      border: 1px solid color-mix(in srgb, var(--r-main-color) 22%, transparent);
      border-radius: 8px;
      background: color-mix(in srgb, var(--r-main-color) 8%, transparent);
    }
    .grid-2x2 span { color: var(--r-link-color); font-size: 14px; font-weight: 800; }
    .grid-2x2 strong { display: block; margin-top: 12px; font-size: 22px; }
    .grid-2x2 p { margin: 8px 0 0; font-size: 15px; line-height: 1.5; opacity: 0.78; }
    .vertical-cards {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 16px;
      margin-top: 28px;
    }
    .vertical-cards > div {
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      min-height: 300px;
      padding: 20px;
      border-top: 5px solid var(--r-link-color);
      background: color-mix(in srgb, var(--r-main-color) 7%, transparent);
    }
    .vertical-cards span { color: var(--r-link-color); font-size: 14px; font-weight: 800; }
    .vertical-cards strong { display: block; margin-top: auto; font-size: 22px; }
    .vertical-cards p { margin: 8px 0 0; font-size: 15px; line-height: 1.5; opacity: 0.76; }
    .note-cards {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
      margin-top: 26px;
    }
    .note-cards > div {
      padding: 18px 20px;
      border-left: 4px solid var(--r-link-color);
      background: color-mix(in srgb, var(--r-main-color) 6%, transparent);
    }
    .note-cards span { color: var(--r-link-color); font-size: 14px; font-weight: 800; }
    .note-cards strong { display: block; margin-top: 8px; font-size: 21px; }
    .note-cards p { margin: 7px 0 0; font-size: 15px; opacity: 0.76; }
    .module-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
    }
    .module-grid > div {
      padding: 14px 16px;
      border: 1px solid color-mix(in srgb, var(--r-main-color) 20%, transparent);
      border-radius: 8px;
      background: color-mix(in srgb, var(--r-main-color) 5%, transparent);
    }
    .module-grid b { color: var(--r-link-color); font-family: Consolas, monospace; }
    .module-grid strong { display: block; margin-top: 8px; font-size: 18px; }
    .module-grid p { margin: 6px 0 0; font-size: 14px; opacity: 0.76; }
    .risk-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 16px;
      margin-top: 28px;
    }
    .risk-grid > div {
      padding: 22px;
      border: 1px solid color-mix(in srgb, var(--r-main-color) 24%, transparent);
      border-top: 6px solid var(--r-link-color);
      background: color-mix(in srgb, var(--r-main-color) 7%, transparent);
    }
    .risk-grid span { color: var(--r-link-color); font-size: 14px; font-weight: 800; letter-spacing: 1px; }
    .risk-grid strong { display: block; margin-top: 16px; font-size: 23px; }
    .risk-grid p { margin: 10px 0 0; font-size: 15px; line-height: 1.55; opacity: 0.78; }
    .pillars {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 16px;
      margin-top: 28px;
    }
    .pillars > div { padding: 24px; background: color-mix(in srgb, var(--r-main-color) 7%, transparent); }
    .pillars b { display: block; color: var(--r-link-color); font-size: 34px; }
    .pillars strong { display: block; margin-top: 16px; font-size: 22px; }
    .pillars p { margin: 10px 0 0; font-size: 15px; line-height: 1.55; opacity: 0.78; }
    .manuscript {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 42px;
      margin-top: 30px;
    }
    .manuscript p {
      margin: 0;
      font-size: 20px;
      line-height: 1.85;
      opacity: 0.9;
    }
    .split-content {
      display: grid;
      grid-template-columns: 1fr 1.15fr;
      gap: 54px;
      align-items: center;
      min-height: 100%;
    }
    .split-content h2 { font-size: 46px; }
    .split-copy p {
      margin: 0 0 18px;
      font-size: 17px;
      line-height: 1.7;
      opacity: 0.88;
    }
    .split-copy strong { display: block; margin-bottom: 4px; color: var(--r-link-color); }
    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 16px;
      margin-top: 30px;
    }
    .kpi-grid > div {
      padding: 22px 18px;
      border: 1px solid color-mix(in srgb, var(--r-main-color) 22%, transparent);
      background: color-mix(in srgb, var(--r-main-color) 6%, transparent);
    }
    .kpi-grid strong { display: block; color: var(--r-link-color); font-size: 38px; }
    .kpi-grid span { display: block; margin-top: 10px; font-size: 14px; opacity: 0.78; }
    .gauge-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 18px;
      margin-top: 30px;
      align-items: end;
    }
    .gauge-grid > div {
      min-height: 260px;
      display: flex;
      flex-direction: column;
      justify-content: flex-end;
      padding: 18px;
      border: 1px solid color-mix(in srgb, var(--r-main-color) 20%, transparent);
      background: color-mix(in srgb, var(--r-main-color) 5%, transparent);
    }
    .gauge-grid i {
      display: block;
      width: 100%;
      background: var(--r-link-color);
      opacity: 0.85;
    }
    .gauge-grid strong { display: block; margin-top: 14px; color: var(--r-link-color); font-size: 28px; }
    .gauge-grid span { display: block; margin-top: 6px; font-size: 14px; opacity: 0.78; }
    .terminal-metrics {
      display: grid;
      gap: 12px;
      font-family: Consolas, "SF Mono", monospace;
    }
    .terminal-metrics > div {
      display: grid;
      grid-template-columns: 60px 90px 1fr;
      gap: 14px;
      align-items: center;
    }
    .terminal-metrics b { color: var(--r-link-color); }
    .terminal-metrics span { font-weight: 800; }
    .terminal-metrics i { display: block; height: 12px; background: var(--r-link-color); }
    .preview-closing blockquote {
      margin: 44px 0 0;
      padding: 0 0 0 28px;
      border-left: 5px solid var(--r-link-color);
      font-size: 34px;
      line-height: 1.5;
      font-weight: 700;
    }
  </style>
</head>
<body>
  <div class="reveal">
    <div class="slides">
      ${previewSlides(theme).join("")}
    </div>
  </div>
  <script src="${revealJs}"></script>
  <script>
    Reveal.initialize({
      width: 1280,
      height: 720,
      margin: 0,
      minScale: 1,
      maxScale: 1,
      controls: false,
      progress: false,
      hash: false,
      transition: "none",
      slideNumber: false,
    }).then(() => {
      const slot = Number(new URLSearchParams(location.search).get("s") ?? 0)
      Reveal.slide(slot, 0)
    })
  </script>
</body>
</html>`
}

function capturePage(theme, slot, htmlPath, outputPath) {
  const chrome = process.env.CHROME_PATH ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
  const url = `${pathToFileURL(htmlPath).href}?s=${slot}`
  const args = [
    "--headless=new",
    "--disable-gpu",
    "--no-sandbox",
    "--hide-scrollbars",
    "--run-all-compositor-stages-before-draw",
    "--virtual-time-budget=5000",
    "--window-size=1280,720",
    "--force-device-scale-factor=1",
    "--screenshot-format=jpeg",
    "--screenshot-quality=80",
    `--screenshot=${outputPath}`,
    url,
  ]
  const result = spawnSync(chrome, args, {
    timeout: 30_000,
    stdio: "ignore",
    windowsHide: true,
  })
  if (result.status !== 0 || !existsSync(outputPath)) {
    throw new Error(`截图失败：${theme}/${pageRoles[slot]} (exit=${result.status}, error=${result.error ?? "unknown"})`)
  }
}

rmSync(buildRoot, { recursive: true, force: true })
mkdirSync(join(buildRoot, "theme"), { recursive: true })
cpSync(join(revealRoot, "theme", "fonts"), join(buildRoot, "theme", "fonts"), { recursive: true })

for (const [theme] of themes) {
  writeFileSync(join(buildRoot, "theme", `${theme}.css`), buildOfflineThemeCss(theme), "utf8")
  const htmlPath = join(buildRoot, `${theme}.html`)
  writeFileSync(htmlPath, renderPreviewHtml(theme), "utf8")

  for (const [slot, role] of pageRoles.entries()) {
    const outputPath = join(outputRoot, theme, `${role}.jpg`)
    mkdirSync(dirname(outputPath), { recursive: true })
    capturePage(theme, slot, htmlPath, outputPath)
    console.log(`生成 reveal/${theme}/${role}.jpg <- ${themes.find((item) => item[0] === theme)?.[1] ?? theme}`)
  }
}

console.log(`Reveal 官方主题预览生成完成，共 ${themes.length * pageRoles.length} 张真实页面截图。`)
