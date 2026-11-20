import { Auth } from "@/auth"
import { Provider } from "@/provider/provider"
import { AgnesImage, ImageGeneration, OpenAIImage, ProtocolRegistry, SenseNovaImage } from "@novaway/llm/protocols"
import { Effect } from "effect"
import { HttpClient } from "effect/unstable/http"

ProtocolRegistry.registerImageProtocol("agnes", AgnesImage.agnesImage)
ProtocolRegistry.registerImageProtocol("openai", OpenAIImage.openaiImage)
ProtocolRegistry.registerImageProtocol("sensenova", SenseNovaImage.sensenovaImage)
ProtocolRegistry.registerImageProtocol("sense-nova", SenseNovaImage.sensenovaImage)
ProtocolRegistry.registerImageProtocol("sensenova-image", SenseNovaImage.sensenovaImage)

export interface Input {
  readonly prompt: string
  readonly model?: string
  readonly size?: string
  readonly ratio?: string
  readonly n?: number
  readonly image?: ReadonlyArray<string>
  readonly options?: Record<string, unknown>
  /** 网关明确拒绝所选模型时，允许自动改用同供应商的受支持模型重试一次（默认 true）。 */
  readonly allowFallback?: boolean
}

export interface Candidate {
  readonly providerId: string
  readonly apiKey: string
  readonly baseURL?: string
  readonly modelName: string
}

export interface Output {
  readonly images: ImageGeneration.ImageGenerationResult["images"]
  readonly providerId: string
  readonly model: string
  /** 发生透明回退时，记录最初请求的模型名。 */
  readonly fallbackFrom?: string
}

/** 网关（CLIProxyAPI）images 端点不支持所选模型时的错误签名。 */
export function isUnsupportedImageModel(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return /is not supported on \/v1\/images\/generations/i.test(message)
}

/** 网关 images 端点实际支持的模型族：gpt-image* 与 grok-imagine-image*。 */
function pickGatewayFallbackModel(pcfg: Provider.Info | undefined, exclude: string) {
  const ids = Object.keys(pcfg?.models ?? {}).filter(
    (id) => id !== exclude && /^(gpt-image|grok-imagine-image)/i.test(id),
  )
  return ids.find((id) => id === "gpt-image-2.5") ?? ids.find((id) => /^gpt-image/i.test(id)) ?? ids[0]
}

function isSenseNovaBaseURL(baseURL: string | undefined) {
  if (!baseURL) return false
  try {
    return ["token.sensenova.cn", "api.sensenova.cn"].includes(new URL(baseURL).hostname.toLowerCase())
  } catch {
    return false
  }
}

/** 按供应商 / 模型名 / baseURL 选择图片协议，兼容内置网关与 OpenAI 兼容网关上的 gpt-image。 */
function protocolFor(candidate: Candidate) {
  if (isSenseNovaBaseURL(candidate.baseURL)) {
    return { ...SenseNovaImage.sensenovaImage, baseURL: candidate.baseURL ?? SenseNovaImage.sensenovaImage.baseURL }
  }
  // 内置网关是 OpenAI 兼容协议，无论挂的是 agnes-image 还是 gpt-image 都走 OpenAI 格式。
  if (candidate.providerId === "builtin") {
    return { ...OpenAIImage.openaiImage, baseURL: candidate.baseURL ?? OpenAIImage.openaiImage.baseURL }
  }
  if (/^(gpt-image|dall-e)/i.test(candidate.modelName)) {
    return { ...OpenAIImage.openaiImage, baseURL: candidate.baseURL ?? OpenAIImage.openaiImage.baseURL }
  }
  if (/^agnes-image/i.test(candidate.modelName)) {
    return { ...AgnesImage.agnesImage, baseURL: candidate.baseURL ?? AgnesImage.agnesImage.baseURL }
  }
  return ProtocolRegistry.getImageProtocol(candidate.providerId, candidate.baseURL)
}

/**
 * 统一的图片生成入口：从运行时 provider 状态（含内置网关发现的模型与 Key）解析候选，
 * 调用对应协议。工具（generate_image）与 HTTP API（/images/generate）共用，
 * 保证与模型选择器列出的模型一致。
 */
export const generateImage = Effect.fn("Image.generateImage")(function* (input: Input) {
  const providerSvc = yield* Provider.Service
  const auth = yield* Auth.Service
  const http = yield* HttpClient.HttpClient
  const imageService = ImageGeneration.make()
  const providers = yield* providerSvc.list()

  const hasImageOutput = (pcfg: Provider.Info) =>
    Object.values(pcfg.models ?? {}).some((m) => m.capabilities?.output?.image)

  const isImageProvider = (pid: string, pcfg: Provider.Info) =>
    ProtocolRegistry.listImageProviders().includes(pid) || hasImageOutput(pcfg)

  const resolveApiKey = (pid: string, pcfg: Provider.Info) =>
    Effect.gen(function* () {
      const optKey = pcfg.options?.apiKey
      if (typeof optKey === "string" && optKey) return optKey
      if (typeof pcfg.key === "string" && pcfg.key) return pcfg.key
      const authInfo = yield* auth.get(pid)
      if (authInfo?.type === "api") return authInfo.key
      if (authInfo?.type === "wellknown") return authInfo.token
      return undefined
    })

  const baseURLFor = (pcfg: Provider.Info, modelName?: string) => {
    const optBase = pcfg.options?.baseURL ?? pcfg.options?.endpoint
    if (typeof optBase === "string" && optBase) return optBase
    const apiURL = modelName ? pcfg.models?.[modelName]?.api?.url : undefined
    return typeof apiURL === "string" && apiURL ? apiURL : undefined
  }

  const pickImageModel = (pcfg: Provider.Info, preferred?: string) => {
    if (preferred && pcfg.models?.[preferred]) return preferred
    const imageModel = Object.entries(pcfg.models ?? {}).find(([, m]) => m.capabilities?.output?.image)?.[0]
    return imageModel ?? Object.keys(pcfg.models ?? {})[0]
  }

  let candidate: Candidate | undefined

  // 如果显式指定了模型，优先找到拥有该模型且具备图片能力的 provider
  if (input.model) {
    for (const [pid, pcfg] of Object.entries(providers)) {
      if (!pcfg.models?.[input.model]) continue
      if (!isImageProvider(pid, pcfg)) continue
      const key = yield* resolveApiKey(pid, pcfg)
      if (!key) continue
      candidate = {
        providerId: pid,
        apiKey: key,
        baseURL: baseURLFor(pcfg, input.model),
        modelName: input.model,
      }
      break
    }
  }

  // 查找第一个具备图片生成能力且已配置 API Key 的 provider
  if (!candidate) {
    for (const [pid, pcfg] of Object.entries(providers)) {
      if (!isImageProvider(pid, pcfg)) continue
      const key = yield* resolveApiKey(pid, pcfg)
      if (!key) continue
      const fallbackModel = isSenseNovaBaseURL(baseURLFor(pcfg)) ? "sensenova-u1-fast" : "agnes-image-2.1-flash"
      const modelName = pickImageModel(pcfg, input.model) ?? fallbackModel
      candidate = {
        providerId: pid,
        apiKey: key,
        baseURL: baseURLFor(pcfg, modelName),
        modelName,
      }
      break
    }
  }

  // 兜底：使用环境变量中的 Agnes API Key
  if (!candidate) {
    const envKey = process.env.AGNES_API_KEY
    if (envKey) {
      candidate = {
        providerId: "agnes",
        apiKey: envKey,
        baseURL: AgnesImage.agnesImage.baseURL,
        modelName: input.model ?? "agnes-image-2.1-flash",
      }
    }
  }

  if (candidate?.baseURL && /^https?:\/\/apihub\.agnes-ai\.com(?:\/|$)/i.test(candidate.baseURL)) {
    candidate = { ...candidate, baseURL: AgnesImage.agnesImage.baseURL }
  }
  if (isSenseNovaBaseURL(candidate?.baseURL) && candidate?.modelName === "agnes-image-2.1-flash") {
    candidate = { ...candidate, modelName: "sensenova-u1-fast" }
  }

  if (!candidate) {
    return yield* Effect.fail(
      new Error("No image generation provider configured. Please set up a provider with API key."),
    )
  }

  const protocol = protocolFor(candidate)
  if (!protocol) {
    return yield* Effect.fail(
      new Error(`No image generation protocol registered for provider "${candidate.providerId}".`),
    )
  }

  const attempt = (target: Candidate) =>
    imageService
      .generate(
        protocolFor(target) ?? protocol,
        {
          prompt: input.prompt,
          model: target.modelName,
          size: input.size,
          ratio: input.ratio,
          n: input.n,
          image: input.image,
          options: input.options,
        },
        target.apiKey,
      )
      .pipe(
        Effect.provideService(HttpClient.HttpClient, http),
        Effect.mapError((error) => new Error(error instanceof Error ? error.message : String(error))),
        Effect.map((result) => ({
          images: result.images,
          model: target.modelName,
          fallbackFrom: undefined as string | undefined,
        })),
      )

  const result = yield* attempt(candidate).pipe(
    Effect.catch((error) => {
      if (input.allowFallback === false || !isUnsupportedImageModel(error) || candidate.providerId !== "builtin") {
        return Effect.fail(error)
      }
      const fallbackModel = pickGatewayFallbackModel(
        Object.entries(providers).find(([pid]) => pid === candidate.providerId)?.[1],
        candidate.modelName,
      )
      if (!fallbackModel) return Effect.fail(error)
      return attempt({ ...candidate, modelName: fallbackModel }).pipe(
        Effect.map((retry) => ({ ...retry, fallbackFrom: candidate.modelName })),
      )
    }),
  )

  return {
    images: result.images,
    providerId: candidate.providerId,
    model: result.model,
    fallbackFrom: result.fallbackFrom,
  } satisfies Output
})
