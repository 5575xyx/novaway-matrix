export * as ConfigMemory from "./memory"

import { NonNegativeInt, PositiveInt } from "@opencode-ai/core/schema"
import { Schema } from "effect"

export const EmbeddingMode = Schema.Literals(["auto", "local", "provider", "ollama", "off"])
export type EmbeddingMode = Schema.Schema.Type<typeof EmbeddingMode>

export const Info = Schema.Struct({
  enabled: Schema.optional(Schema.Boolean).annotate({
    description: "启用持久记忆召回与 memory 工具。默认 true（全自动越用越聪明）。",
  }),
  prefetch_limit: Schema.optional(PositiveInt).annotate({
    description: "轻量预取最多注入的记忆条数（摘要索引）。默认 5。",
  }),
  prefetch_budget_chars: Schema.optional(PositiveInt).annotate({
    description: "记忆索引块最大字符数预算，超出则截断低优先级项。默认 1200。",
  }),
  auto_extract: Schema.optional(Schema.Boolean).annotate({
    description: "每轮结束后确定性抽取显式记忆（如「请记住…」）。默认 true。",
  }),
  review_enabled: Schema.optional(Schema.Boolean).annotate({
    description: "启用记忆审查流水线（按轮次生成/推进候选）。默认 true。",
  }),
  review_llm: Schema.optional(Schema.Boolean).annotate({
    description: "用 LLM 从对话中提炼记忆候选。默认 true。",
  }),
  review_interval: Schema.optional(NonNegativeInt).annotate({
    description: "背景记忆审查间隔（用户轮次）。0 表示关闭按轮审查。默认 1。",
  }),
  auto_apply: Schema.optional(Schema.Boolean).annotate({
    description: "记忆候选自动写入长期记忆，无需人工点通过。默认 true。",
  }),
  /**
   * 向量检索后端（开箱即用）：
   * - auto（默认）：始终启用本地语义；若检测到云端 API Key 或本机 Ollama 嵌入模型则自动升级稠密向量
   * - local：仅本地 n-gram 语义（无需任何模型）
   * - provider：强制使用云端 embedding（需 API Key）
   * - ollama：强制使用本机 Ollama embedding
   * - off：关闭语义增强，仅关键词/FTS
   */
  embedding_mode: Schema.optional(EmbeddingMode).annotate({
    description:
      "记忆向量后端：auto/local/provider/ollama/off。默认 auto：无模型也能用，有云端 Key 或 Ollama 时自动增强。",
  }),
  embedding_provider: Schema.optional(Schema.String).annotate({
    description: "云端 embedding 提供商（默认 openai）。仅 provider/auto 时使用。",
  }),
  embedding_model: Schema.optional(Schema.String).annotate({
    description: "云端 embedding 模型（默认 text-embedding-3-small）。",
  }),
  embedding_ollama_model: Schema.optional(Schema.String).annotate({
    description: "Ollama embedding 模型名（默认自动探测 nomic-embed-text 等）。",
  }),
  embedding_ollama_url: Schema.optional(Schema.String).annotate({
    description: "Ollama 地址（默认 http://localhost:11434）。",
  }),
  embedding_ollama_install_dir: Schema.optional(Schema.String).annotate({
    description: "Windows Ollama 程序安装目录；为空时使用官方默认目录。",
  }),
  embedding_ollama_models_dir: Schema.optional(Schema.String).annotate({
    description: "Ollama 模型存储目录，对应 OLLAMA_MODELS 环境变量。",
  }),
})
export type Info = Schema.Schema.Type<typeof Info>

/** 解析后的记忆配置（undefined 字段使用全自动默认值）。 */
export function resolve(input?: Info) {
  return {
    enabled: input?.enabled ?? true,
    prefetch_limit: input?.prefetch_limit ?? 5,
    prefetch_budget_chars: input?.prefetch_budget_chars ?? 1200,
    auto_extract: input?.auto_extract ?? true,
    review_enabled: input?.review_enabled ?? true,
    review_llm: input?.review_llm ?? true,
    review_interval: input?.review_interval ?? 1,
    auto_apply: input?.auto_apply ?? true,
    embedding_mode: input?.embedding_mode ?? ("auto" as const),
    embedding_provider: input?.embedding_provider ?? "openai",
    embedding_model: input?.embedding_model ?? "text-embedding-3-small",
    embedding_ollama_model: input?.embedding_ollama_model,
    embedding_ollama_url: input?.embedding_ollama_url ?? "http://localhost:11434",
    embedding_ollama_install_dir: input?.embedding_ollama_install_dir,
    embedding_ollama_models_dir: input?.embedding_ollama_models_dir,
  }
}
