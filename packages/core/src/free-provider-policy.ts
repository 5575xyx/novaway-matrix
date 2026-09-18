import type { RemoteProviderModel } from "./openai-compatible"

export type FreeNature = "model" | "rate-limited" | "credits"

export const FREE_PROVIDER_NATURE: Record<string, FreeNature> = {
  // ═══════════════════════════════════════════════════════════
  // 第一梯队：实测可用的真免费档（按稳定度 + 免费额度排序）
  // ═══════════════════════════════════════════════════════════
  // 国内主力：每日免费额度，国内访问稳定
  modelscope: "model",          // 7+ 模型，每日额度，Qwen3/DeepSeek/GLM 全系
  sensenova: "model",           // 商汤 GLM-5.2 / DeepSeek-V4 / Kimi-K3
  zhipuai: "model",             // 智谱 GLM-4.7-Flash / 4.5-Flash

  // 老牌国外路由
  openrouter: "model",          // :free 后缀 21+ 模型
  kilo: "model",                // 聚合网关，17+ 真实免费

  // 国外限速免费层
  google: "rate-limited",        // Gemini Flash 250-1000次/天
  "siliconflow-cn": "model",     // 部分模型永久免费 + 注册送额度

  // 本地推理（零成本、稳定、无任何限制）
  lmstudio: "model",             // 127.0.0.1:1234
  "atomic-chat": "model",        // 127.0.0.1:1337

  // 国产小工具（每天免费额度）
  agnes: "model",                // Agnes-2.5/2.0-Flash，国产小众

  // ═══════════════════════════════════════════════════════════
  // Credits 档（按 token 付费，不是真免费）
  // ═══════════════════════════════════════════════════════════
  // Groq 2026-09 实测：所有现存模型按 token 收费（最便宜 $0.075/1M）；
  // 之前的 Llama 3.1/3.3 免费档已下线成 Enterprise only。
  groq: "credits",
  // NVIDIA NIM 注册送 1000 次推理试用额度
  nvidia: "credits",
  // ═══════════════════════════════════════════════════════════
  // 第二梯队：试用层（未实测，需要 Key，可能有限制）
  // ═══════════════════════════════════════════════════════════
  huggingface: "rate-limited",   // HF Inference 试用
  mistral: "rate-limited",       // Mistral La Plateforme 试用
  cohere: "rate-limited",        // Cohere Trial
  amd: "credits",                // AMD Developer Cloud 试用
  nova: "model",                 // Amazon Nova 试用

  // ═══════════════════════════════════════════════════════════
  // 第三梯队：未实测（按稳定度排序，待人工验证）
  // ═══════════════════════════════════════════════════════════
  requesty: "model",
  inferx: "model",
  unorouter: "model",
  qvac: "model",
  llama: "model",                // Meta 官方
  zenmux: "model",
  nan: "model",
  pendra: "model",
  orcarouter: "model",
  aihubmix: "model",
  empiriolabs: "model",
  poolside: "model",
  llmgateway: "model",
  zai: "model",                  // 智谱海外官方
  "tencent-tokenhub": "model",
  bothub: "model",
  hetzner: "model",
  poe: "model",
  "regolo-ai": "model",
  "nano-gpt": "model",
  ovhcloud: "model",
  meganova: "model",
  tokenrouter: "model",
  standardcompute: "model",

  // ═══════════════════════════════════════════════════════════
  // 已删除（2026-09 实测不能用的）
  // ═══════════════════════════════════════════════════════════
  // vercel: 删除 — "免费档"要求绑定信用卡才能解锁
  // kenari: 删除 — 实际是 IDR 预付费 credits 服务
  // iflowcn: 删除 — 实测请求延迟极高，经常无回复
  // "kimi-for-coding": 删除 — 控制台已要求付费才能创建 Key
}

export const FREE_PROVIDER_IDS = Object.freeze(Object.keys(FREE_PROVIDER_NATURE))

// 免费通道推荐优先级。桌面/TUI 接入引导、模型选择器里的"免费"分组均按此排序：
//   1. 实测可用的真免费档
//   2. 试用层（可能限制）
//   3. 未实测（按目录规模降序）
//   4. 已删除（2026-09 实测不能用的 vercel / kenari / iflowcn / kimi-for-coding）
export const FREE_PROVIDER_RANK: readonly string[] = Object.freeze([
  // 第一梯队：实测可用的真免费档
  "modelscope",
  "sensenova",
  "zhipuai",
  "openrouter",
  "kilo",
  "google",
  "siliconflow-cn",
  "lmstudio",
  "atomic-chat",
  "agnes",
  // Credits 档（按 token 付费）
  "groq",
  "nvidia",
  // 第二梯队：试用层（未实测）
  "huggingface",
  "mistral",
  "cohere",
  "amd",
  "nova",
  // 第三梯队：未实测
  "requesty",
  "inferx",
  "unorouter",
  "qvac",
  "llama",
  "zenmux",
  "nan",
  "pendra",
  "orcarouter",
  "aihubmix",
  "empiriolabs",
  "poolside",
  "llmgateway",
  "zai",
  "tencent-tokenhub",
  "bothub",
  "hetzner",
  "poe",
  "regolo-ai",
  "nano-gpt",
  "ovhcloud",
  "meganova",
  "tokenrouter",
  "standardcompute",
])

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
  // 2026-08-16 已下线（Groq 官方文档）：403 Forbidden
  // "llama-3.1-8b-instant" → 替换为 openai/gpt-oss-20b
  // "llama-3.3-70b-versatile" → 替换为 openai/gpt-oss-120b 或 qwen/qwen3.6-27b
  "allam-2-7b",
  // qwen-qwq-32b 已下线（2025-07-14）→ 走 qwen/qwen3.6-27b
  // llama-guard-3-8b 已下线（2025-06-06）
  "qwen/qwen3-6-27b",
  "qwen/qwen3-32b",
  // 注：whisper-* / orpheus-* 是音频/转录模型，NovaWay chat 路径不处理这些，
  // 留在这里会让用户选了之后调 Groq 报 403 Forbidden。
  "meta-llama/llama-prompt-guard-2-22m",
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

export const AGNES_FREE_MODEL_IDS = new Set(["agnes-2.5-flash", "agnes-2.0-flash", "agnes-2.1-flash"])

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

const FREE_BY_DEFAULT = new Set(["sensenova", "modelscope", "nvidia"])
const REQUIRE_ZERO_PRICING = new Set([
  "openrouter",
  "zhipuai",
  "agnes",
  "kilo",
  "siliconflow-cn",
  // 2026-09 接入：以下通道用 cost=0 过滤免费模型
  // 已删除 vercel / kenari / kimi-for-coding / groq（groq 已下线免费档）
  "requesty",
  "inferx",
  "unorouter",
  "qvac",
  "llama",
  "zenmux",
  "nan",
  "pendra",
  "orcarouter",
  "aihubmix",
  "empiriolabs",
  "poolside",
  "llmgateway",
  "lmstudio",
  "huggingface",
  "mistral",
  "cohere",
  "amd",
  "meganova",
  "tokenrouter",
  "bothub",
  "hetzner",
  "zai",
  "tencent-tokenhub",
  "nano-gpt",
  "ovhcloud",
  "nova",
  "atomic-chat",
  "standardcompute",
  "poe",
  "regolo-ai",
])

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

export function filterRemoteModelsToFree(providerID: string, models: RemoteProviderModel[]): RemoteProviderModel[] {
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
