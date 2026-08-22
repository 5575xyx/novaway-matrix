import { Effect, Schema } from "effect"
import { HttpClient } from "effect/unstable/http"
import { Tool } from "./tool"
import { Config } from "@/config/config"
import { ConfigProvider } from "@/config/provider"
import { Auth } from "@/auth"
import { ImageGeneration, AgnesImage, ProtocolRegistry, SenseNovaImage } from "@novaway/llm/protocols"

ProtocolRegistry.registerImageProtocol("agnes", AgnesImage.agnesImage)
ProtocolRegistry.registerImageProtocol("sensenova", SenseNovaImage.sensenovaImage)
ProtocolRegistry.registerImageProtocol("sense-nova", SenseNovaImage.sensenovaImage)
ProtocolRegistry.registerImageProtocol("sensenova-image", SenseNovaImage.sensenovaImage)

function isSenseNovaBaseURL(baseURL: string | undefined) {
  if (!baseURL) return false
  try {
    return ["token.sensenova.cn", "api.sensenova.cn"].includes(new URL(baseURL).hostname.toLowerCase())
  } catch {
    return false
  }
}

interface Metadata {
  prompt: string
  model: string
  size?: string
  imageUrl?: string
}

const Parameters = Schema.Struct({
  prompt: Schema.String,
  model: Schema.optional(Schema.String),
  size: Schema.optional(Schema.String),
  ratio: Schema.optional(Schema.String),
  image: Schema.optional(Schema.Array(Schema.String)),
})

export const GenerateImageTool = Tool.define(
  "generate_image",
  Effect.gen(function* () {
    const config = yield* Config.Service
    const auth = yield* Auth.Service
    const http = yield* HttpClient.HttpClient
    const imageService = ImageGeneration.make()

    return {
      description:
        "Generate images from text prompts using AI image generation models. Supports text-to-image and image-to-image workflows.",
      parameters: Parameters,
      execute: (args: Schema.Schema.Type<typeof Parameters>) =>
        Effect.gen(function* () {
          const cfg = yield* config.get()

          const hasImageOutput = (pcfg: ConfigProvider.Info) =>
            Object.values(pcfg.models ?? {}).some((m) => m.modalities?.output?.includes("image"))

          const isImageProvider = (pid: string, pcfg: ConfigProvider.Info) =>
            ProtocolRegistry.listImageProviders().includes(pid) || hasImageOutput(pcfg)

          const resolveApiKey = (pid: string, pcfg: ConfigProvider.Info) =>
            Effect.gen(function* () {
              if (pcfg.options?.apiKey) return pcfg.options.apiKey
              const authInfo = yield* auth.get(pid)
              if (authInfo?.type === "api") return authInfo.key
              if (authInfo?.type === "wellknown") return authInfo.token
              return undefined
            })

          const pickImageModel = (pcfg: ConfigProvider.Info, preferred?: string) => {
            if (preferred && pcfg.models?.[preferred]) return preferred
            const imageModel = Object.entries(pcfg.models ?? {}).find(([, m]) =>
              m.modalities?.output?.includes("image"),
            )?.[0]
            return imageModel ?? Object.keys(pcfg.models ?? {})[0]
          }

          type Candidate = {
            providerId: string
            apiKey: string
            baseURL?: string
            modelName: string
          }

          let candidate: Candidate | undefined

          // 如果显式指定了模型，优先找到拥有该模型且具备图片能力的 provider
          if (args.model) {
            for (const [pid, pcfg] of Object.entries(cfg.provider ?? {})) {
              if (!pcfg.models?.[args.model]) continue
              if (!isImageProvider(pid, pcfg)) continue
              const key = yield* resolveApiKey(pid, pcfg)
              if (!key) continue
              candidate = {
                providerId: pid,
                apiKey: key,
                baseURL: pcfg.options?.baseURL ?? pcfg.options?.endpoint,
                modelName: args.model,
              }
              break
            }
          }

          // 查找第一个具备图片生成能力且已配置 API Key 的 provider
          if (!candidate) {
            for (const [pid, pcfg] of Object.entries(cfg.provider ?? {})) {
              if (!isImageProvider(pid, pcfg)) continue
              const key = yield* resolveApiKey(pid, pcfg)
              if (!key) continue
              const fallbackModel = isSenseNovaBaseURL(pcfg.options?.baseURL ?? pcfg.options?.endpoint)
                ? "sensenova-u1-fast"
                : "agnes-image-2.1-flash"
              const modelName = pickImageModel(pcfg, args.model) ?? fallbackModel
              candidate = {
                providerId: pid,
                apiKey: key,
                baseURL: pcfg.options?.baseURL ?? pcfg.options?.endpoint,
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
                modelName: args.model ?? "agnes-image-2.1-flash",
              }
            }
          }

          if (candidate?.baseURL && /^https?:\/\/apihub\.agnes-ai\.com(?:\/|$)/i.test(candidate.baseURL)) {
            candidate.baseURL = AgnesImage.agnesImage.baseURL
          }
          if (isSenseNovaBaseURL(candidate?.baseURL) && candidate?.modelName === "agnes-image-2.1-flash") {
            candidate.modelName = "sensenova-u1-fast"
          }

          if (!candidate) {
            throw new Error("No image generation provider configured. Please set up a provider with API key.")
          }

          const protocol = ProtocolRegistry.getImageProtocol(candidate.providerId, candidate.baseURL)

          if (!protocol) {
            throw new Error(`No image generation protocol registered for provider "${candidate.providerId}".`)
          }

          const imageResult = yield* imageService
            .generate(
              protocol,
              {
                prompt: args.prompt,
                model: candidate.modelName,
                size: args.size,
                ratio: args.ratio,
                image: args.image,
              },
              candidate.apiKey,
            )
            .pipe(Effect.provideService(HttpClient.HttpClient, http))

          const firstImage = imageResult.images[0]
          if (!firstImage) {
            throw new Error("No images were generated")
          }

          const imageUrl = firstImage.url

          return {
            title: `Generated image: ${args.prompt.slice(0, 50)}`,
            output: imageUrl ?? "Image generated successfully (base64)",
            metadata: {
              prompt: args.prompt,
              model: candidate.modelName,
              size: args.size,
              imageUrl: imageUrl ?? "",
            } as Metadata,
          }
        }).pipe(Effect.orDie),
    }
  }),
)
