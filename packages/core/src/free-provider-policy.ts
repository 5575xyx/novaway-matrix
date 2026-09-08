import type { RemoteProviderModel } from "./openai-compatible"

export type FreeNature = "model" | "rate-limited" | "credits"

export const FREE_PROVIDER_NATURE: Record<string, FreeNature> = {
  sensenova: "model",
  modelscope: "model",
  iflowcn: "model",
  openrouter: "model",
  zhipuai: "model",
  agnes: "model",
  google: "rate-limited",
  groq: "rate-limited",
  nvidia: "credits",
  kilo: "model",
  "siliconflow-cn": "model",
}

export const FREE_PROVIDER_IDS = Object.freeze(Object.keys(FREE_PROVIDER_NATURE))

const GOOGLE_FREE_MODEL_IDS = new Set([
  "gemini-1.5-flash",
  "gemini-1.5-flash-8b",
  "gemini-2.0-flash",
  "gemini-2.0-flash-lite",
  "gemini-2.0-flash-lite-001",
  "gemini-2.0-flash-001",
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-2.5-flash-lite-preview-06-17",
  "gemini-2.5-flash-lite-preview-09-2025",
])

const GROQ_FREE_MODEL_IDS = new Set([
  "gemma2-9b-it",
  "mistral-saba-24b",
  "deepseek-r1-distill-llama-70b",
  "llama-guard-3-8b",
  "llama-3.3-70b-versatile",
  "allam-2-7b",
  "whisper-large-v3",
  "llama-3.1-8b-instant",
  "llama3-70b-8192",
  "qwen-qwq-32b",
  "whisper-large-v3-turbo",
  "llama3-8b-8192",
  "canopylabs/orpheus-arabic-saudi",
  "canopylabs/orpheus-v1-english",
  "meta-llama/llama-4-scout-17b-16e-instruct",
  "meta-llama/llama-prompt-guard-2-22m",
  "meta-llama/llama-guard-4-12b",
  "meta-llama/llama-4-maverick-17b-128e-instruct",
  "meta-llama/llama-prompt-guard-2-86m",
  "openai/gpt-oss-20b",
  "openai/gpt-oss-safeguard-20b",
  "openai/gpt-oss-120b",
  "qwen/qwen3-32b",
  "groq/compound",
  "groq/compound-mini",
  "moonshotai/kimi-k2-instruct",
  "moonshotai/kimi-k2-instruct-0905",
])

export const AGNES_FREE_MODEL_IDS = new Set([
  "agnes-2.5-flash",
  "agnes-2.0-flash",
  "agnes-2.1-flash",
])

export const KILO_FREE_MODEL_IDS = new Set([
  "openrouter/auto",
  "openrouter/bodybuilder",
  "openrouter/owl-alpha",
  "openrouter/pareto-code",
  "openrouter/free",
  "inclusionai/ling-2.6-1t:free",
  "kilo-auto/free",
  "stepfun/step-3.5-flash:free",
  "x-ai/grok-code-fast-1:optimized:free",
  "tencent/hy3-preview:free",
  "poolside/laguna-m.1:free",
  "poolside/laguna-xs.2:free",
  "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",
  "nvidia/nemotron-3-super-120b-a12b:free",
  "baidu/qianfan-ocr-fast:free",
  "baidu/cobuddy:free",
  "google/lyria-3-clip-preview",
  "google/lyria-3-pro-preview",
])

export const SILICONFLOW_FREE_MODEL_IDS = new Set([
  "Qwen/Qwen3.5-4B",
  "tencent/Hunyuan-MT-7B",
  "PaddlePaddle/PaddleOCR-VL",
  "PaddlePaddle/PaddleOCR-VL-1.5",
  "deepseek-ai/DeepSeek-OCR",
])

const FREE_MODEL_IDS: Record<string, ReadonlySet<string>> = {
  google: GOOGLE_FREE_MODEL_IDS,
  groq: GROQ_FREE_MODEL_IDS,
  agnes: AGNES_FREE_MODEL_IDS,
  kilo: KILO_FREE_MODEL_IDS,
  "siliconflow-cn": SILICONFLOW_FREE_MODEL_IDS,
}

const FREE_BY_DEFAULT = new Set(["sensenova", "modelscope", "iflowcn", "nvidia"])
const REQUIRE_ZERO_PRICING = new Set(["openrouter", "zhipuai", "agnes", "kilo", "siliconflow-cn"])

export function isFreeProvider(providerID: string): boolean {
  return providerID in FREE_PROVIDER_NATURE
}

export function freeProviderNature(providerID: string): FreeNature | undefined {
  return FREE_PROVIDER_NATURE[providerID]
}

export function freeCostFromPricing(
  pricing: RemoteProviderModel["pricing"],
): { input: number; output: number } | undefined {
  if (!pricing) return undefined
  const { prompt, completion } = pricing
  if (prompt === 0 && completion === 0) return { input: 0, output: 0 }
  if (prompt !== null && completion !== null) return { input: prompt, output: completion }
  return undefined
}

function isRateLimitedFreeModel(providerID: string, modelID: string): boolean {
  if (providerID === "google") return GOOGLE_FREE_MODEL_IDS.has(modelID) || modelID.startsWith("gemma-")
  if (providerID === "groq") return GROQ_FREE_MODEL_IDS.has(modelID)
  return false
}

export function isFreeRemoteModel(providerID: string, model: RemoteProviderModel): boolean {
  if (!isFreeProvider(providerID)) return true
  if (FREE_BY_DEFAULT.has(providerID)) return true
  if (providerID === "google" || providerID === "groq") return isRateLimitedFreeModel(providerID, model.id)
  if (FREE_MODEL_IDS[providerID]?.has(model.id)) return true
  if (!REQUIRE_ZERO_PRICING.has(providerID)) return false
  const cost = freeCostFromPricing(model.pricing)
  return cost?.input === 0 && cost.output === 0
}

export function filterRemoteModelsToFree(
  providerID: string,
  models: RemoteProviderModel[],
): RemoteProviderModel[] {
  if (!isFreeProvider(providerID)) return models
  return models.filter((model) => isFreeRemoteModel(providerID, model))
}

function isFreeCatalogModel(
  providerID: string,
  model: { cost: { input: number; output: number } },
  modelID: string,
): boolean {
  if (!isFreeProvider(providerID)) return true
  if (providerID === "google" || providerID === "groq") return isRateLimitedFreeModel(providerID, modelID)
  return FREE_MODEL_IDS[providerID]?.has(modelID) === true || (model.cost.input === 0 && model.cost.output === 0)
}

export function filterCatalogToFreeModels<T extends { cost: { input: number; output: number } }>(
  providerID: string,
  models: Record<string, T>,
): Record<string, T> {
  if (!isFreeProvider(providerID)) return models
  return Object.fromEntries(
    Object.entries(models).filter(([modelID, model]) => isFreeCatalogModel(providerID, model, modelID)),
  )
}
