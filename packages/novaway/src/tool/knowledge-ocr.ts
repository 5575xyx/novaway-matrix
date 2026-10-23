import { detectOcr, resetOcrDetection } from "@/knowledge/ocr"
import { installRapidOcr } from "@/knowledge/ocr-install"
import { formatSetupReport, setupFailure, type SetupReport, type SetupStepView } from "@/setup/report"
import { Effect, Schema } from "effect"
import * as Tool from "./tool"

/**
 * 知识库 OCR 引擎。
 *
 * 把「一键安装」暴露成 Agent 工具：AI 不再需要自己拼 venv / pip 命令，
 * 直接调用这里就能复用应用内同一套安装逻辑（隔离环境、镜像回退、验证）。
 * 只有需要手动排查的特殊环境，才回退到 shell。
 */
type OcrMetadata = { backend: string; python?: string; module?: string }

const Parameters = Schema.Struct({
  action: Schema.optional(Schema.Literals(["status", "install"])).annotate({
    description: "status (default) reports the detected OCR backend; install sets up RapidOCR in an isolated venv.",
  }),
  reinstall: Schema.optional(Schema.Boolean).annotate({
    description: "With action=install, rebuild the environment from scratch.",
  }),
})

/** 安装进度里的 "phase: message" 文本转成结构化步骤。 */
export function toSetupSteps(events: readonly string[]): SetupStepView[] {
  return events.map((event) => {
    const at = event.indexOf(": ")
    if (at === -1) return { step: event, status: "info" }
    return { step: event.slice(0, at), status: "info", detail: event.slice(at + 2) }
  })
}

export const KnowledgeOcrTool = Tool.define(
  "knowledge_ocr",
  Effect.gen(function* () {
    return {
      description: [
        "Inspect or install the local OCR engine used by the knowledge base for images and scanned PDFs.",
        "Use action=status to see which backend is active and why.",
        "Use action=install to install RapidOCR (PP-OCR Chinese/English models) into an isolated venv under the NovaWay data directory.",
        "The installer never modifies the system Python, prepares a runtime automatically when Python is missing, and verifies the result.",
        "Prefer this tool over manual pip/venv commands; only fall back to the shell when it reports a failure you can diagnose.",
      ].join(" "),
      parameters: Parameters,
      execute: (
        params: Schema.Schema.Type<typeof Parameters>,
        ctx: Tool.Context,
      ): Effect.Effect<Tool.ExecuteResult<OcrMetadata>> =>
        Effect.gen(function* () {
          if ((params.action ?? "status") === "status") {
            const backend = yield* Effect.promise(() => detectOcr())
            const ready = backend.kind !== "none" && backend.kind !== "vision"
            const report: SetupReport = {
              domain: "ocr",
              ready,
              phase: backend.kind,
              summary: ready ? "OCR backend: " + backend.kind : "No local OCR engine is available.",
              facts: {
                label: backend.label,
                languages: backend.languages.join(", "),
              },
              next: ready ? undefined : "Call this tool again with action=install.",
            }
            return {
              title: "OCR engine status",
              metadata: { backend: backend.kind },
              output: formatSetupReport(report),
            }
          }

          yield* ctx.ask({
            permission: "knowledge_ocr",
            patterns: ["install"],
            always: ["*"],
            metadata: { action: "install", reinstall: params.reinstall === true },
          })

          const events: string[] = []
          const result = yield* Effect.promise(() =>
            installRapidOcr({
              reinstall: params.reinstall === true,
              signal: ctx.abort,
              onProgress: (event) => {
                events.push(event.phase + ": " + event.message)
                void Effect.runPromise(ctx.metadata({ title: event.message })).catch(() => undefined)
              },
            }),
          )

          if (!result.ok) {
            throw new Error(
              setupFailure({
                domain: "ocr",
                ready: false,
                phase: "error",
                summary: "OCR installation failed: " + (result.error ?? "unknown error"),
                hint: result.hint,
                steps: toSetupSteps(events),
                next: "Diagnose with the terminal only after checking this output; verify python/python3/py -3 and network access.",
              }),
            )
          }

          // 清掉探测缓存，知识库状态接口立刻返回 rapid。
          resetOcrDetection()
          return {
            title: "OCR engine installed",
            metadata: { backend: "rapid", python: result.python, module: result.module },
            output: formatSetupReport({
              domain: "ocr",
              ready: true,
              phase: "ready",
              summary: "RapidOCR installed and verified.",
              facts: { python: result.python, module: result.module },
              steps: toSetupSteps(events),
            }),
          }
        }),
    }
  }),
)
