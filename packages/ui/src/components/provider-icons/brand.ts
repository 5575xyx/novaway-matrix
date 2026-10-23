/**
 * 厂商品牌色。
 *
 * 供应商图标都是 `fill="currentColor"`，之前统一用界面前景色，
 * 一眼看过去分不清是哪家。这里按图标 id 给出品牌主色：
 *
 * - 只给**有明确品牌色**的厂商，其余（通用占位 `synthetic`、不确定的）不设，
 *   继续用界面前景色，避免"为了好看而猜错颜色"。
 * - 色值取各家 Logo 的主色，深色主题下也够亮（都按浅色主题可读性调过）。
 */
export const PROVIDER_BRAND_COLORS: Record<string, string> = {
  // 国内
  deepseek: "#4D6BFE",
  moonshotai: "#1F2937",
  "moonshotai-cn": "#1F2937",
  kimi: "#1F2937",
  minimax: "#FF6A3D",
  "minimax-cn": "#FF6A3D",
  "minimax-coding-plan": "#FF6A3D",
  "minimax-cn-coding-plan": "#FF6A3D",
  zhipuai: "#3859FF",
  "zhipuai-coding-plan": "#3859FF",
  zai: "#3859FF",
  "zai-coding-plan": "#3859FF",
  xiaomi: "#FF6900",
  alibaba: "#FF6A00",
  qiniu: "#00A4E4",
  modelscope: "#6B57FF",
  bailing: "#2B6CF6",
  stepfun: "#0B63F6",
  siliconflow: "#7C3AED",
  "siliconflow-cn": "#7C3AED",
  nova: "#6B7280",
  NovaWay: "#10B981",
  "NovaWay-go": "#10B981",
  novaway: "#10B981",
  sensenova: "#00A3FF",
  moark: "#3B82F6",

  // 海外
  openai: "#10A37F",
  anthropic: "#D97757",
  google: "#4285F4",
  "google-vertex": "#4285F4",
  "google-vertex-anthropic": "#D97757",
  xai: "#111827",
  groq: "#F55036",
  mistral: "#FA520F",
  cohere: "#39594D",
  perplexity: "#20808D",
  openrouter: "#6366F1",
  together: "#0F6FFF",
  togetherai: "#0F6FFF",
  fireworks: "#FF5C00",
  "fireworks-ai": "#FF5C00",
  deepinfra: "#4B6BFB",
  cerebras: "#FF6B35",
  nvidia: "#76B900",
  huggingface: "#FFD21E",
  github: "#24292F",
  "github-models": "#24292F",
  "github-copilot": "#24292F",
  gitlab: "#FC6D26",
  azure: "#0078D4",
  "azure-cognitive-services": "#0078D4",
  "amazon-bedrock": "#FF9900",
  ollama: "#111827",
  "ollama-cloud": "#111827",
  lmstudio: "#7C3AED",
  venice: "#6D28D9",
  v0: "#111827",
  vercel: "#111827",
  cloudflare: "#F38020",
  "cloudflare-workers-ai": "#F38020",
  "cloudflare-ai-gateway": "#F38020",
  digitalocean: "#0080FF",
  llama: "#0866FF",
  poe: "#5D3FD3",
  kilo: "#F97316",
  requesty: "#6366F1",
  inference: "#6366F1",
  morgh: "#6366F1",
}

/** 忽略大小写的查表：图标 id 里 `NovaWay` 是大小写混排的。 */
function lookup(id: string) {
  if (PROVIDER_BRAND_COLORS[id]) return PROVIDER_BRAND_COLORS[id]
  const lower = id.toLowerCase()
  for (const [key, value] of Object.entries(PROVIDER_BRAND_COLORS)) {
    if (key.toLowerCase() === lower) return value
  }
  return undefined
}

/** 取厂商品牌色；没有明确品牌色时返回 undefined（由调用方决定兜底）。 */
export function providerBrandColor(id: string | undefined): string | undefined {
  if (!id) return undefined
  const direct = lookup(id)
  if (direct) return direct
  // coding-plan / -cn 之类的变体：去掉后缀再试一次。
  const base = id.replace(/-(coding-plan|cn|go|agent)$/g, "")
  return base === id ? undefined : lookup(base)
}
