import type { HexColor } from "../../theme/types"

/** Official provider hues used as seeds; resolveThemeVariant adapts them for mode contrast. */
export const PROVIDER_BRAND_COLORS: Record<string, HexColor> = {
  // China
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
  sensenova: "#00A3FF",
  moark: "#3B82F6",

  // Global
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

export const MODEL_BRAND_COLORS: Record<string, HexColor> = {
  sensenova: "#0EA5A4",
  agnes: "#F59E0B",
}

export const PLATFORM_BRAND_COLORS: Record<string, HexColor> = {
  xhs: "#FF2442",
  douyin: "#000000",
  bilibili: "#00A1D6",
  kwai: "#FF4906",
  wxSph: "#07C160",
  wxGzh: "#07C160",
  xianyu: "#FF6A00",
}

/** Resolve a model family id to its theme-adaptive color token. */
export function modelBrandColor(id: string): string {
  return `var(--model-brand-${id}, var(--icon-interactive-base))`
}

/** Resolve a platform id to its mode-adaptive CSS color variable. */
export function platformBrandColor(id: string): string {
  return `var(--platform-brand-${id}, var(--icon-interactive-base))`
}

/** Resolve a foreground color with sufficient contrast against a platform brand surface. */
export function platformBrandForegroundColor(id: string): string {
  return `var(--platform-brand-${id}-foreground, var(--text-on-interactive-base))`
}

/** Resolve a provider id to its mode-adaptive CSS variable. */
export function providerBrandColor(id: string | undefined): string | undefined {
  if (!id) return undefined
  const lookup = (value: string) => {
    if (PROVIDER_BRAND_COLORS[value]) return value
    const lower = value.toLowerCase()
    return Object.keys(PROVIDER_BRAND_COLORS).find((key) => key.toLowerCase() === lower)
  }

  const direct = lookup(id)
  if (direct) return `var(--provider-brand-${direct}, var(--icon-interactive-base))`
  const base = id.replace(/-(coding-plan|cn|go|agent)$/gi, "")
  const resolved = base === id ? undefined : lookup(base)
  return resolved ? `var(--provider-brand-${resolved}, var(--icon-interactive-base))` : undefined
}
