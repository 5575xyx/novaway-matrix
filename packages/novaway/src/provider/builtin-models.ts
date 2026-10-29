/**
 * 内置网关（`builtin`）的模型档案。
 *
 * 我们的网关只回一个 `{ id, name }` 列表，不告诉我们上下文长度、最大输出、
 * 是不是多模态 —— 之前代码一律按「文本/图像/音频/视频/PDF 全支持 + 128K」
 * 兜底，于是每个模型都显示成一样的东西，附件、上下文窗口、压缩阈值全都不准。
 *
 * 这里按模型 ID 给每个已知模型写一份真实档案（取自各厂商公开规格，
 * 与仓库里 models.dev 目录中同名模型的取值保持一致）；未知模型按名字里的
 * `image` / `video` / `u1.5` 归类，其余当文本模型处理。
 *
 * 只有内置网关用这张表：直连供应商（sensenova、zhipuai…）自己会返回这些字段，
 * 不能覆盖。
 */

export type BuiltinModelKind = "text" | "image" | "video"

export type BuiltinModality = "text" | "image" | "audio" | "video" | "pdf"

export type BuiltinModelProfile = {
  kind: BuiltinModelKind
  /** 上下文窗口（tokens）。生成类模型没有真正意义上的上下文，按提示词上限给一个保守值。 */
  context: number
  /** 最大输出（tokens）。生成类模型这里是输出 token 上限。 */
  output: number
  /** 可接受的输入模态。 */
  input: BuiltinModality[]
  /** 是否支持推理（reasoning）内容。 */
  reasoning: boolean
}

const TEXT: BuiltinModality[] = ["text"]
const VISION: BuiltinModality[] = ["text", "image"]
const DOCS: BuiltinModality[] = ["text", "image", "pdf"]

const GENERATION: Pick<BuiltinModelProfile, "context" | "output"> = { context: 32_768, output: 4_096 }

/**
 * 已知模型档案。按顺序匹配，先到先得 —— 所以更具体的规则要写在更靠前的位置。
 */
const PROFILES: Array<{ match: RegExp; profile: BuiltinModelProfile }> = [
  // Anthropic Claude Sonnet 4.6：1M 上下文，64K 输出，支持图片与 PDF。
  // 网关上的 id 写法是 `claude-sonnet-4-6`（连字符），档案里也见过点号写法，两种都认。
  {
    match: /^claude-sonnet-4[.-]6/i,
    profile: { kind: "text", context: 1_000_000, output: 64_000, input: DOCS, reasoning: true },
  },
  // DeepSeek V4.1 Flash：1,048,576 上下文 / 65,536 输出，支持图片输入。
  {
    match: /^deepseek-v4\.1/i,
    profile: { kind: "text", context: 1_048_576, output: 65_536, input: VISION, reasoning: true },
  },
  // 智谱 GLM-5.3：1M 上下文 / 128K 输出，纯文本。
  {
    match: /^glm-5\.3(?!-flash)/i,
    profile: { kind: "text", context: 1_000_000, output: 131_072, input: TEXT, reasoning: true },
  },
  // GLM-5.3-Flash：200K 上下文 / 128K 输出。
  {
    match: /^glm-5\.3-flash/i,
    profile: { kind: "text", context: 200_000, output: 131_072, input: TEXT, reasoning: true },
  },
  // xAI Grok 4.7：256K 上下文，支持图片输入。
  { match: /^grok-4/i, profile: { kind: "text", context: 256_000, output: 32_768, input: VISION, reasoning: true } },
  // 月之暗面 Kimi K3：1,048,576 上下文 / 65,536 输出，支持图片输入。
  {
    match: /^kimi-k3/i,
    profile: { kind: "text", context: 1_048_576, output: 65_536, input: VISION, reasoning: true },
  },
  // MiniMax M3：204,800 上下文 / 65,536 输出，纯文本。
  {
    match: /^minimax-m3/i,
    profile: { kind: "text", context: 204_800, output: 65_536, input: TEXT, reasoning: true },
  },
  // 商汤 SenseNova 6.8 Flash Lite：262,144 上下文 / 65,536 输出，支持图片输入。
  {
    match: /^sensenova-6\.8/i,
    profile: { kind: "text", context: 262_144, output: 65_536, input: VISION, reasoning: true },
  },
  // SenseNova U1.5：统一的「理解 + 生图」模型，按图片生成使用。
  {
    match: /^sensenova-u1\.5/i,
    profile: { kind: "image", context: 262_144, output: 32_768, input: VISION, reasoning: false },
  },
  // Agnes 视频生成。
  {
    match: /^agnes-video/i,
    profile: { kind: "video", ...GENERATION, input: VISION, reasoning: false },
  },
  // Agnes 图片生成。
  {
    match: /^agnes-image/i,
    profile: { kind: "image", ...GENERATION, input: VISION, reasoning: false },
  },
  // Agnes 3.0 Flash：文本 + 视觉。
  {
    match: /^agnes-3\.0/i,
    profile: { kind: "text", context: 262_144, output: 65_536, input: DOCS, reasoning: true },
  },
  // Agnes 2.5 Flash：文本 + 视觉。
  {
    match: /^agnes-2\.5/i,
    profile: { kind: "text", context: 131_072, output: 32_768, input: VISION, reasoning: true },
  },
]

/** 名字里带这些词的按生成类模型处理（网关新增模型时不用改代码）。 */
export function builtinModelKind(id: string, name = ""): BuiltinModelKind {
  const text = `${id} ${name}`
  if (/image|u1\.5/i.test(text)) return "image"
  if (/video/i.test(text)) return "video"
  return "text"
}

export function builtinModelProfile(id: string, name = ""): BuiltinModelProfile {
  for (const entry of PROFILES) {
    if (entry.match.test(id)) return entry.profile
  }
  for (const entry of PROFILES) {
    if (entry.match.test(name)) return entry.profile
  }
  const kind = builtinModelKind(id, name)
  if (kind === "image") return { kind, ...GENERATION, input: VISION, reasoning: false }
  if (kind === "video") return { kind, ...GENERATION, input: VISION, reasoning: false }
  // 未知文本模型：保守给纯文本 + 128K，宁可少开能力也不要谎报多模态。
  return { kind, context: 128_000, output: 32_768, input: TEXT, reasoning: true }
}
