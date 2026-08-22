#!/usr/bin/env node
/**
 * PPT 浏览器工作进程。
 *
 * 由 Node 执行：Bun 运行时下 Playwright 与 Chrome DevTools 的 CDP 连接不可用，
 * 因此所有浏览器相关阶段（DOM 审计、截图、HTML 提取）都放到这个进程内。
 *
 * 用法：node worker.mjs <task.json> <result.json>
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { chromium } from "playwright-core"
import { extractPages } from "./vendor/sensenova/dom_extractor.mjs"
import { buildPptx } from "./vendor/sensenova/pptx_builder.mjs"

const [taskPath, resultPath] = process.argv.slice(2)
if (!taskPath || !resultPath) {
  process.stderr.write("用法：node worker.mjs <task.json> <result.json>\n")
  process.exit(2)
}

const task = JSON.parse(readFileSync(taskPath, "utf8"))
const result = { ok: false }

try {
  if (task.mode === "review") {
    result.value = await runReview(task)
  } else if (task.mode === "export") {
    result.value = await runExport(task)
  } else {
    throw new Error(`未知的 PPT 工作进程模式：${task.mode}`)
  }
  result.ok = true
} catch (error) {
  result.error = error?.stack || String(error)
}

writeFileSync(resultPath, JSON.stringify(result), "utf8")
process.exit(result.ok ? 0 : 1)

async function runExport(task) {
  const pages = await extractPages(task.htmlFiles)
  const failed = pages.filter((page) => !page.ir)
  if (failed.length) {
    const details = failed.map((page) => `${path.basename(page.path)}: ${page.error ?? "DOM 提取失败"}`)
    throw new Error(`PPT 页面渲染失败：\n- ${details.join("\n- ")}`)
  }
  const summary = await buildPptx(pages, task.deckDir, task.output)
  if (summary.failCount) {
    const details = summary.failures.map((failure) => `${path.basename(failure.path)}: ${failure.message}`)
    throw new Error(`PPTX 构建失败：\n- ${details.join("\n- ")}`)
  }
  return summary
}

async function runReview(task) {
  const deckDir = path.resolve(task.deckDir)
  const validationDir = path.join(deckDir, "validation")
  mkdirSync(validationDir, { recursive: true })
  const browser = await launchBrowser(task.browserChannel)
  const pages = []
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 })
    for (let index = 0; index < task.htmlFiles.length; index++) {
      const file = task.htmlFiles[index]
      await page.goto(pathToFileURL(file).href, { waitUntil: "load", timeout: 30_000 })
      await page.evaluate(() => document.fonts.ready)
      const audit = await page.evaluate(() => {
        const root = document.querySelector(".wrapper, .slide.canvas, .slide") ?? document.body
        const rootRect = root.getBoundingClientRect()
        const visible = [...root.querySelectorAll("*")].filter((element) => {
          const style = getComputedStyle(element)
          const rect = element.getBoundingClientRect()
          return (
            style.display !== "none" &&
            style.visibility !== "hidden" &&
            Number(style.opacity || "1") > 0 &&
            rect.width > 0 &&
            rect.height > 0
          )
        })
        const textOverflow = visible.filter((element) => {
          if (!element.textContent?.trim()) return false
          if (element.children.length && !["P", "LI", "TD", "TH"].includes(element.tagName)) return false
          return element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 4
        })
        const brokenImages = [...root.querySelectorAll("img")].filter(
          (image) => !image.complete || image.naturalWidth === 0 || image.naturalHeight === 0,
        )
        return {
          selector: root === document.body ? "body" : root.matches(".wrapper") ? ".wrapper" : ".slide",
          width: Math.round(rootRect.width),
          height: Math.round(rootRect.height),
          visibleElementCount: visible.length,
          textOverflow: textOverflow.map(
            (element) =>
              `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ""}${
                element.className && typeof element.className === "string"
                  ? `.${element.className.trim().split(/\s+/).slice(0, 2).join(".")}`
                  : ""
              }`,
          ),
          brokenImages: brokenImages.map((image) => image.getAttribute("src") ?? "<missing-src>"),
        }
      })
      const errors = [
        ...(audit.width === 1280 && audit.height === 720
          ? []
          : [`画布必须为 1280×720，当前为 ${audit.width}×${audit.height}`]),
        ...audit.textOverflow.map((element) => `文字溢出：${element}`),
        ...audit.brokenImages.map((source) => `图片无法加载：${source}`),
      ]
      const warnings = audit.visibleElementCount < 4 ? ["页面可见元素过少，可能是空白页"] : []
      const screenshot = path.join(validationDir, `page_${String(index + 1).padStart(2, "0")}.png`)
      await page.locator(audit.selector).first().screenshot({ path: screenshot, type: "png" })
      pages.push({
        page: index + 1,
        file,
        screenshot,
        errors,
        warnings,
        metrics: {
          width: audit.width,
          height: audit.height,
          textOverflowCount: audit.textOverflow.length,
          brokenImageCount: audit.brokenImages.length,
          visibleElementCount: audit.visibleElementCount,
        },
      })
    }
  } finally {
    await browser.close()
  }

  const errorCount = pages.reduce((total, page) => total + page.errors.length, 0)
  const warningCount = pages.reduce((total, page) => total + page.warnings.length, 0)
  const review = {
    schema: "novaway.office-ppt-html-review.v1",
    generatedAt: new Date().toISOString(),
    status: errorCount ? "failed" : "passed",
    sourceFingerprint: task.sourceFingerprint,
    summary: { pages: pages.length, errors: errorCount, warnings: warningCount },
    pages,
  }
  writeFileSync(path.join(deckDir, "review.json"), `${JSON.stringify(review, null, 2)}\n`, "utf8")
  return review
}

async function launchBrowser(requested) {
  const candidates = requested?.trim() ? [requested.trim()] : ["chrome", "msedge"]
  const failures = []
  for (const channel of candidates) {
    try {
      return await chromium.launch({ headless: true, channel })
    } catch (error) {
      failures.push(`${channel}: ${error?.message || String(error)}`)
    }
  }
  throw new Error(`无法启动 PPT 渲染浏览器：\n- ${failures.join("\n- ")}`)
}
