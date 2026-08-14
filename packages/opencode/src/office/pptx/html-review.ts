import path from "node:path"
import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { runPptxWorker } from "./node-worker"
import { isRecord } from "@/util/record"

export type HtmlSlideReviewPage = {
  page: number
  file: string
  screenshot: string
  errors: string[]
  warnings: string[]
  metrics: {
    width: number
    height: number
    textOverflowCount: number
    brokenImageCount: number
    visibleElementCount: number
  }
}

export type HtmlSlideReview = {
  schema: "novaway.office-ppt-html-review.v1"
  generatedAt: string
  status: "passed" | "failed"
  sourceFingerprint: string
  summary: {
    pages: number
    errors: number
    warnings: number
  }
  pages: HtmlSlideReviewPage[]
}

export async function reviewHtmlSlides(input: {
  deckDir: string
  htmlFiles: string[]
  browserChannel?: string
}): Promise<HtmlSlideReview> {
  const deckDir = path.resolve(input.deckDir)
  const value = await runPptxWorker({
    mode: "review",
    deckDir,
    htmlFiles: input.htmlFiles,
    browserChannel: input.browserChannel,
    sourceFingerprint: await fingerprintHtmlSlides(input.htmlFiles),
  })
  if (!isHtmlSlideReview(value)) throw new Error("PPT 审查进程返回了无效结果")
  return value
}

export async function fingerprintHtmlSlides(htmlFiles: string[]) {
  const hash = createHash("sha256")
  for (const file of htmlFiles) {
    hash.update(path.basename(file))
    hash.update("\0")
    hash.update(await readFile(file))
    hash.update("\n")
  }
  return hash.digest("hex")
}

function isHtmlSlideReview(value: unknown): value is HtmlSlideReview {
  return (
    isRecord(value) &&
    value.schema === "novaway.office-ppt-html-review.v1" &&
    (value.status === "passed" || value.status === "failed") &&
    typeof value.sourceFingerprint === "string" &&
    isRecord(value.summary) &&
    typeof value.summary.pages === "number" &&
    typeof value.summary.errors === "number" &&
    typeof value.summary.warnings === "number" &&
    Array.isArray(value.pages)
  )
}
