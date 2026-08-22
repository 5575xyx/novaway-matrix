/**
 * Out-of-the-box memory embedding resolver.
 *
 * Design goals:
 * 1) Always works with zero setup (local n-gram semantic).
 * 2) Auto-upgrades to dense vectors when user already has cloud API keys
 *    or a local Ollama embedding model ? no extra product setup.
 * 3) Never blocks core memory write/read if dense backend fails.
 */
import { createOpenAI } from "@ai-sdk/openai"
import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import { embedMany } from "ai"
import type { ConfigMemory } from "@/config/memory"

export type EmbeddingMode = "auto" | "local" | "provider" | "ollama" | "off"

export type EmbedBackendKind = "local" | "provider" | "ollama" | "off"

export type ResolvedEmbedder = {
  kind: EmbedBackendKind
  /** Stable id for cache compatibility, e.g. openai:text-embedding-3-small */
  modelId: string
  /** Human-readable status for UI/debug */
  label: string
  /** Dense embedder; undefined for local/off */
  embed?: (texts: string[]) => Promise<number[][]>
}

export type EmbedConfig = ReturnType<typeof ConfigMemory.resolve>

const OLLAMA_PREFERRED = ["nomic-embed-text", "mxbai-embed-large", "bge-m3", "all-minilm", "snowflake-arctic-embed"]

let cache:
  | {
      key: string
      at: number
      value: ResolvedEmbedder
    }
  | undefined

const CACHE_TTL_MS = 60_000

export function denseCosine(a: readonly number[], b: readonly number[]) {
  if (!a.length || a.length !== b.length) return 0
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!
    na += a[i]! * a[i]!
    nb += b[i]! * b[i]!
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb)
  if (!denom) return 0
  return Math.max(0, Math.min(1, dot / denom))
}

export function parseEmbeddingJson(raw: string | null | undefined): number[] | undefined {
  if (!raw) return
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed) || !parsed.every((x) => typeof x === "number" && Number.isFinite(x))) return
    return parsed as number[]
  } catch {
    return
  }
}

function cacheKey(cfg: EmbedConfig) {
  return [
    cfg.embedding_mode,
    cfg.embedding_provider,
    cfg.embedding_model,
    cfg.embedding_ollama_model ?? "",
    cfg.embedding_ollama_url,
  ].join("|")
}

function localBackend(): ResolvedEmbedder {
  return {
    kind: "local",
    modelId: "local:ngram",
    label: "本地语义（无需模型，开箱即用）",
  }
}

function offBackend(): ResolvedEmbedder {
  return {
    kind: "off",
    modelId: "off",
    label: "已关闭语义增强",
  }
}

function readOpenAIKey() {
  return (
    process.env.OPENAI_API_KEY?.trim() ||
    process.env.OPENAI_API_TOKEN?.trim() ||
    process.env.OPENAI_KEY?.trim() ||
    undefined
  )
}

async function probeOllama(baseURL: string, preferred?: string) {
  const root = baseURL.replace(/\/$/, "").replace(/\/v1$/, "")
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 400)
  try {
    const res = await fetch(`${root}/api/tags`, { signal: ctrl.signal })
    if (!res.ok) return
    const data = (await res.json()) as { models?: Array<{ name?: string }> }
    const names = (data.models ?? []).map((m) => m.name).filter((n): n is string => Boolean(n))
    if (preferred) {
      const hit = names.find((n) => n === preferred || n.startsWith(`${preferred}:`))
      if (hit) return { root, model: hit }
    }
    for (const p of OLLAMA_PREFERRED) {
      const hit = names.find((n) => n === p || n.startsWith(`${p}:`))
      if (hit) return { root, model: hit }
    }
    const embedish = names.find((n) => /embed/i.test(n))
    if (embedish) return { root, model: embedish }
  } catch {
    return
  } finally {
    clearTimeout(timer)
  }
}

function providerEmbedder(apiKey: string, model: string): ResolvedEmbedder {
  const client = createOpenAI({ apiKey })
  return {
    kind: "provider",
    modelId: `openai:${model}`,
    label: `云端向量（openai/${model}）`,
    embed: async (texts) => {
      const result = await embedMany({
        model: client.embedding(model),
        values: texts,
      })
      return result.embeddings
    },
  }
}

function ollamaEmbedder(root: string, model: string): ResolvedEmbedder {
  const client = createOpenAICompatible({
    name: "ollama",
    baseURL: `${root}/v1`,
  })
  return {
    kind: "ollama",
    modelId: `ollama:${model}`,
    label: `本地 Ollama 向量（${model}）`,
    embed: async (texts) => {
      // openai-compatible embedding model accessor differs by SDK version
      const embeddingModel =
        "embedding" in client && typeof (client as any).embedding === "function"
          ? (client as any).embedding(model)
          : (client as any).textEmbeddingModel(model)
      const result = await embedMany({
        model: embeddingModel,
        values: texts,
      })
      return result.embeddings
    },
  }
}

/**
 * Resolve the active embedder.
 * Safe to call frequently; results are cached briefly.
 */
export async function resolveEmbedder(cfg: EmbedConfig, opts?: { force?: boolean }): Promise<ResolvedEmbedder> {
  const key = cacheKey(cfg)
  const now = Date.now()
  if (!opts?.force && cache && cache.key === key && now - cache.at < CACHE_TTL_MS) return cache.value

  const mode = cfg.embedding_mode
  let value: ResolvedEmbedder = localBackend()

  if (mode === "off") value = offBackend()
  else if (mode === "local") value = localBackend()
  else if (mode === "provider") {
    const apiKey = readOpenAIKey()
    value = apiKey
      ? providerEmbedder(apiKey, cfg.embedding_model)
      : {
          kind: "local",
          modelId: "local:ngram",
          label: "本地语义（未配置云端 API Key，已回退）",
        }
  } else if (mode === "ollama") {
    const probed = await probeOllama(cfg.embedding_ollama_url, cfg.embedding_ollama_model)
    value = probed
      ? ollamaEmbedder(probed.root, cfg.embedding_ollama_model || probed.model)
      : {
          kind: "local",
          modelId: "local:ngram",
          label: "本地语义（未检测到 Ollama 嵌入模型，已回退）",
        }
  } else {
    // auto: prefer cloud key already present, then ollama, else local
    const apiKey = readOpenAIKey()
    if (apiKey) {
      value = providerEmbedder(apiKey, cfg.embedding_model)
    } else {
      const probed = await probeOllama(cfg.embedding_ollama_url, cfg.embedding_ollama_model)
      value = probed ? ollamaEmbedder(probed.root, cfg.embedding_ollama_model || probed.model) : localBackend()
    }
  }

  cache = { key, at: now, value }
  return value
}

/** Best-effort single-text embed. Returns null for local/off or on failure. */
export async function embedText(cfg: EmbedConfig, text: string): Promise<{ vector: number[]; modelId: string } | null> {
  const backend = await resolveEmbedder(cfg)
  if (!backend.embed) return null
  const trimmed = text.trim()
  if (!trimmed) return null
  try {
    const [vector] = await backend.embed([trimmed])
    if (!vector?.length) return null
    return { vector, modelId: backend.modelId }
  } catch {
    return null
  }
}

export function clearEmbedderCache() {
  cache = undefined
}
