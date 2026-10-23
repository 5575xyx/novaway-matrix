import { describe, expect, test } from "bun:test"
import { formatSetupReport, formatSetupSteps, setupFailure } from "@/setup/report"

describe("setup report", () => {
  test("renders steps in order and skips empty fields", () => {
    const text = formatSetupReport({
      domain: "ocr",
      ready: true,
      phase: "ready",
      summary: "RapidOCR installed",
      facts: { python: "/data/ocr/venv/bin/python", module: "rapidocr_onnxruntime", empty: "" },
      steps: [
        { step: "venv", status: "ok", detail: "created" },
        { step: "pip", status: "ok" },
      ],
    })
    expect(text).toBe(
      [
        "RapidOCR installed",
        "- python: /data/ocr/venv/bin/python",
        "- module: rapidocr_onnxruntime",
        "steps:",
        "- [ok] venv: created",
        "- [ok] pip",
      ].join("\n"),
    )
  })

  test("includes hint, error and next in that order", () => {
    const text = formatSetupReport({
      domain: "embedding",
      ready: false,
      phase: "needs_manual",
      summary: "Ollama install needs a manual step",
      hint: "check permissions",
      error: "winget failed",
      next: "open https://ollama.com/download",
    })
    expect(text).toBe(
      [
        "Ollama install needs a manual step",
        "hint: check permissions",
        "error: winget failed",
        "next: open https://ollama.com/download",
      ].join("\n"),
    )
  })

  test("handles missing steps", () => {
    expect(formatSetupSteps(undefined)).toBe("")
    expect(formatSetupSteps([])).toBe("")
  })

  test("failure text falls back to a summary", () => {
    expect(setupFailure({ domain: "ocr", ready: false, phase: "error", summary: "" })).toBe("setup failed")
  })
})
