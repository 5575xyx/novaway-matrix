import { iconNames } from "@novaway/ui/icons/provider"
import { providerBrandColor } from "@novaway/ui/provider-brand"

export { providerBrandColor }

/**
 * 把 provider id / 显示名映射到厂商图标。
 *
 * 内置 provider 的 id 与图标名通常一致（deepseek、openai…），直接命中；
 * 自定义供应商（`novaway1`、用户随手起的名字）没有对应 id，就按名称里的
 * 关键词猜厂商 —— 猜不到时退回通用图标，而不是显示一个错误的品牌。
 */
const KEYWORDS: Array<[RegExp, string]> = [
  [/deepseek/i, "deepseek"],
  [/kimi|moonshot|月之暗面/i, "moonshotai"],
  [/minimax/i, "minimax"],
  [/glm|zhipu|智谱|z\.?ai/i, "zai"],
  [/qwen|通义|dashscope|alibaba|阿里/i, "alibaba"],
  [/anthropic|claude/i, "anthropic"],
  [/openai|gpt/i, "openai"],
  [/gemini|google/i, "google"],
  [/grok|xai/i, "xai"],
  [/siliconflow|硅基流动/i, "siliconflow"],
  [/openrouter/i, "openrouter"],
  [/ollama/i, "ollama-cloud"],
  [/mistral/i, "mistral"],
  [/groq/i, "groq"],
  [/nvidia/i, "nvidia"],
  [/stepfun|阶跃/i, "stepfun"],
  [/baichuan|百川/i, "synthetic"],
  [/sensenova|nova|novaway|agnes/i, "nova"],
]

export function providerIconId(id: string | undefined, name?: string | undefined) {
  const candidates = [id ?? "", name ?? ""].filter(Boolean)
  for (const candidate of candidates) {
    if (iconNames.includes(candidate as never)) return candidate
  }
  for (const candidate of candidates) {
    for (const [pattern, icon] of KEYWORDS) {
      if (pattern.test(candidate)) return icon
    }
  }
  return "synthetic"
}

/**
 * 取厂商品牌色：先按解析出的图标 id 查，查不到再按原始 provider id 查。
 *
 * UI 里"跟着厂商变色"的地方（模型名、选中态）统一走这个函数，
 * 返回 undefined 表示该厂商没有明确品牌色，调用方应回落到界面前景色。
 */
export function providerColor(id: string | undefined, name?: string | undefined) {
  return providerBrandColor(providerIconId(id, name)) ?? providerBrandColor(id)
}

/**
 * 聚合型网关：一个 provider 下挂着各家模型，按 provider 解析图标会让
 * GLM / Kimi / Claude 全都显示成同一个网关 logo。
 */
const GATEWAYS = new Set(["builtin", "openrouter", "vercel", "cpa", "free", "NovaWay", "opencode"])

/** 模型名 → 厂商图标。只在这些模型挂在聚合网关下时才使用。 */
const MODEL_KEYWORDS: Array<[RegExp, string]> = [
  [/deepseek/i, "deepseek"],
  [/kimi|moonshot/i, "moonshotai"],
  [/minimax/i, "minimax"],
  [/glm|zhipu/i, "zai"],
  [/qwen|alibaba/i, "alibaba"],
  [/anthropic|claude/i, "anthropic"],
  [/openai|gpt/i, "openai"],
  [/gemini|google/i, "google"],
  [/grok|xai/i, "xai"],
  [/mistral/i, "mistral"],
  [/stepfun/i, "stepfun"],
  [/sensenova|u1\.5|agnes/i, "nova"],
]

/**
 * 模型该用哪个品牌的图标/颜色。
 *
 * 直连供应商（deepseek、sensenova…）本来就只有一个品牌，沿用 provider 的解析结果；
 * 只有在聚合网关下，才按模型名去认厂商 —— 认不出来就退回网关自己的图标。
 */
export function modelIconId(
  providerID: string | undefined,
  providerName: string | undefined,
  modelID: string | undefined,
  modelName?: string | undefined,
) {
  if (providerID && GATEWAYS.has(providerID)) {
    const text = [modelID ?? "", modelName ?? ""].join(" ")
    for (const [pattern, icon] of MODEL_KEYWORDS) {
      if (pattern.test(text)) return icon
    }
  }
  return providerIconId(providerID, providerName)
}

/**
 * 自有模型（sensenova / agnes 系列）共用 Nova 图标，但品牌色应能区分：
 * 全都落到同一个灰值会让网关列表里的模型看起来"没有颜色自适应"。
 */
const MODEL_COLORS: Array<[RegExp, string]> = [
  [/sensenova|u1\.5/i, "#0EA5A4"],
  [/agnes/i, "#F59E0B"],
]

export function modelColor(
  providerID: string | undefined,
  providerName: string | undefined,
  modelID: string | undefined,
  modelName?: string | undefined,
) {
  const icon = modelIconId(providerID, providerName, modelID, modelName)
  if (icon === "nova" && providerID && GATEWAYS.has(providerID)) {
    const text = [modelID ?? "", modelName ?? ""].join(" ")
    for (const [pattern, color] of MODEL_COLORS) {
      if (pattern.test(text)) return color
    }
  }
  return providerBrandColor(icon) ?? providerBrandColor(providerID)
}
