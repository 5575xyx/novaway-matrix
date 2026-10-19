import { iconNames } from "@novaway/ui/icons/provider"

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
