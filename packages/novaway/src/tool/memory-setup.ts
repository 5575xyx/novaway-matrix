import { Config } from "@/config/config"
import { ConfigMemory } from "@/config/memory"
import { clearEmbedderCache } from "@/memory/embedder"
import { inspectOllama, setupLocalEmbedding } from "@/memory/ollama-setup"
import { formatSetupReport, setupFailure, type SetupReport } from "@/setup/report"
import { Effect, Schema } from "effect"
import * as Tool from "./tool"

/**
 * 本地向量模型（Ollama）安装/诊断。
 *
 * 与 OCR 的思路一致：把设置页已有的确定性流程暴露成工具，
 * 让 Agent 在「自动安装卡住」时接着往下排查（权限、代理、端口、模型镜像），
 * 而不是让用户自己敲命令，也不让 AI 另写一套安装逻辑。
 */
type EmbeddingMetadata = {
  ready: boolean
  phase: string
  cliInstalled?: boolean
  daemonRunning?: boolean
  hasEmbedModel?: boolean
}

const Parameters = Schema.Struct({
  action: Schema.optional(Schema.Literals(["status", "install"])).annotate({
    description:
      "status (default) reports whether Ollama and the embedding model are ready; install runs the local setup (detect → install → start → pull).",
  }),
  model: Schema.optional(Schema.String).annotate({
    description: "Embedding model to use, e.g. nomic-embed-text. Defaults to the configured model.",
  }),
  baseURL: Schema.optional(Schema.String).annotate({
    description: "Ollama base URL. Defaults to the configured URL or http://localhost:11434.",
  }),
  installDir: Schema.optional(Schema.String).annotate({
    description: "Custom install directory for the Ollama program (Windows). Optional.",
  }),
  modelsDir: Schema.optional(Schema.String).annotate({
    description: "Custom model storage directory. Optional; takes effect after Ollama restarts.",
  }),
})

function statusReport(status: Awaited<ReturnType<typeof inspectOllama>>): SetupReport {
  return {
    domain: "embedding",
    ready: status.ready,
    phase: status.phase,
    summary: status.ready
      ? "Local embedding is ready: " + (status.selectedModel ?? status.preferredModel)
      : "Local embedding is not ready (" + status.phase + ").",
    facts: {
      cli: status.cliInstalled ? "installed" + (status.cliVersion ? " (" + status.cliVersion + ")" : "") : "missing",
      daemon: status.daemonRunning ? "running" : "stopped",
      "embedding model": status.hasEmbedModel ? (status.selectedModel ?? status.preferredModel) : "missing",
      baseURL: status.baseURL,
      "models dir": status.modelsDir,
    },
    hint: status.hint,
    next: status.ready
      ? undefined
      : status.cliInstalled && !status.daemonRunning
        ? "Start the daemon (ollama serve or launch the Ollama app) and check that port 11434 is free."
        : status.cliInstalled && !status.hasEmbedModel
          ? "Pull the embedding model, or call this tool with action=install."
          : status.installCommand && !status.cliInstalled
            ? "Manual install command: " + status.installCommand
            : "Call this tool with action=install.",
  }
}

export const MemoryEmbeddingSetupTool = Tool.define(
  "memory_embedding_setup",
  Effect.gen(function* () {
    const config = yield* Config.Service

    return {
      description: [
        "Inspect or set up the local embedding backend (Ollama) used by the memory system and knowledge retrieval.",
        "Use action=status to see whether the Ollama CLI, the daemon and the embedding model are available.",
        "Use action=install to run the built-in local setup: detect → install Ollama when missing → start the daemon → pull the embedding model.",
        "Prefer this tool over manual ollama commands, because it reuses the same paths and directories the app is configured with.",
        "When it reports needs_manual, explain the concrete next step (permissions, proxy, restart required, port conflict).",
      ].join(" "),
      parameters: Parameters,
      execute: (
        params: Schema.Schema.Type<typeof Parameters>,
        ctx: Tool.Context,
      ): Effect.Effect<Tool.ExecuteResult<EmbeddingMetadata>> =>
        Effect.gen(function* () {
          const cfg = ConfigMemory.resolve((yield* config.get()).memory)
          const input = {
            baseURL: params.baseURL || cfg.embedding_ollama_url,
            preferredModel: params.model || cfg.embedding_ollama_model,
            installDir: params.installDir || cfg.embedding_ollama_install_dir,
            modelsDir: params.modelsDir || cfg.embedding_ollama_models_dir,
          }

          if ((params.action ?? "status") === "status") {
            const status = yield* Effect.promise(() => inspectOllama(input))
            return {
              title: "Embedding backend status",
              metadata: {
                ready: status.ready,
                phase: status.phase,
                cliInstalled: status.cliInstalled,
                daemonRunning: status.daemonRunning,
                hasEmbedModel: status.hasEmbedModel,
              },
              output: formatSetupReport(statusReport(status)),
            }
          }

          yield* ctx.ask({
            permission: "memory_embedding_setup",
            patterns: ["install"],
            always: ["*"],
            metadata: { action: "install", model: input.preferredModel },
          })

          const result = yield* Effect.promise(() =>
            setupLocalEmbedding({
              baseURL: input.baseURL,
              model: input.preferredModel,
              installDir: input.installDir,
              modelsDir: input.modelsDir,
              allowInstall: true,
            }),
          )

          // 装完必须清缓存，否则记忆检索仍会用旧的（本地语义）后端。
          clearEmbedderCache()

          const report: SetupReport = {
            ...statusReport(result.status),
            steps: result.steps.map((step) => ({ step: step.step, status: step.status, detail: step.detail })),
            summary: result.ok
              ? "Local embedding is ready: " + (result.config?.embedding_ollama_model ?? input.preferredModel)
              : result.status.message || "Local embedding setup did not finish.",
            error: result.ok ? undefined : result.status.message,
          }

          if (!result.ok) throw new Error(setupFailure(report))

          return {
            title: "Local embedding ready",
            metadata: {
              ready: true,
              phase: result.status.phase,
              cliInstalled: result.status.cliInstalled,
              daemonRunning: result.status.daemonRunning,
              hasEmbedModel: result.status.hasEmbedModel,
            },
            output: [
              formatSetupReport(report),
              "next: make sure the memory config selects the ollama embedding mode so retrieval actually uses it.",
            ].join(String.fromCharCode(10)),
          }
        }),
    }
  }),
)
