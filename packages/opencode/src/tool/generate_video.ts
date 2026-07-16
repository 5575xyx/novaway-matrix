import { Effect, Schema } from "effect"
import { HttpClient } from "effect/unstable/http"
import { Tool } from "./tool"
import { Config } from "@/config/config"
import { Auth } from "@/auth"
import { VideoGeneration, AgnesVideo, ProtocolRegistry } from "@opencode-ai/llm/protocols"

ProtocolRegistry.registerVideoProtocol("agnes", AgnesVideo.agnesVideo)

interface Metadata {
  prompt: string
  model: string
  imageUrl: string
}

const Parameters = Schema.Struct({
  prompt: Schema.String,
  model: Schema.optional(Schema.String),
  image: Schema.optional(Schema.Array(Schema.String)),
  size: Schema.optional(Schema.String),
  duration: Schema.optional(Schema.Number),
})

export const GenerateVideoTool = Tool.define(
  "generate_video",
  Effect.gen(function* () {
    const config = yield* Config.Service
    const auth = yield* Auth.Service
    const http = yield* HttpClient.HttpClient
    const videoService = VideoGeneration.make()

    return {
      description: "Generate videos from text prompts and/or images using AI video generation models.",
      parameters: Parameters,
      execute: (args: Schema.Schema.Type<typeof Parameters>) =>
        Effect.gen(function* () {
          const cfg = yield* config.get()
          let providerId = "agnes"
          let apiKey: string | undefined
          let modelName = args.model ?? "agnes-video-v2.0"
          let baseURL: string | undefined

          for (const [pid, pcfg] of Object.entries(cfg.provider ?? {})) {
            if (pcfg.options?.apiKey) {
              apiKey = pcfg.options.apiKey
              providerId = pid
              baseURL = pcfg.options.baseURL
              if (!args.model) {
                const firstModel = Object.keys(pcfg.models ?? {})[0]
                if (firstModel) {
                  modelName = firstModel
                }
              }
              break
            }
            const authInfo = yield* auth.get(pid)
            if (authInfo?.type === "api" && authInfo.key) {
              apiKey = authInfo.key
              providerId = pid
              baseURL = pcfg.options?.baseURL
              if (!args.model) {
                const firstModel = Object.keys(pcfg.models ?? {})[0]
                if (firstModel) {
                  modelName = firstModel
                }
              }
              break
            }
          }

          if (!apiKey) {
            apiKey = process.env.AGNES_API_KEY
          }

          if (!apiKey) {
            throw new Error("No video generation provider configured. Please set up a provider with API key.")
          }

          const protocol = ProtocolRegistry.getVideoProtocol(providerId, baseURL)

          if (!protocol) {
            throw new Error(`No video generation protocol registered for provider "${providerId}".`)
          }

          yield* Effect.logInfo("Creating video generation task", { prompt: args.prompt.slice(0, 50), model: modelName })

          const createResult = yield* videoService.createTask(protocol, {
            prompt: args.prompt,
            model: modelName,
            image: args.image?.[0],
            options: {
              size: args.size,
              duration: args.duration,
            },
          }, apiKey).pipe(Effect.provideService(HttpClient.HttpClient, http))

          if (!createResult.taskId) {
            throw new Error("Failed to create video generation task")
          }

          yield* Effect.logInfo("Video task created", { taskId: createResult.taskId })

          yield* Effect.logInfo("Waiting for video generation completion", { taskId: createResult.taskId })

          const statusResult = yield* videoService.waitForCompletion(protocol, createResult.taskId, apiKey, {
            pollIntervalMs: 10_000,
            maxWaitMs: 5 * 60 * 1000,
          }).pipe(Effect.provideService(HttpClient.HttpClient, http))

          if (statusResult.status === "failed") {
            throw new Error(statusResult.error ?? "Video generation failed")
          }

          yield* Effect.logInfo("Video generation completed", { taskId: createResult.taskId, videoUrl: statusResult.videoUrl })

          return {
            title: `Generated video: ${args.prompt.slice(0, 50)}`,
            output: statusResult.videoUrl ?? "Video generation completed",
            metadata: {
              prompt: args.prompt,
              model: modelName,
              imageUrl: args.image?.[0] ?? "",
            } as Metadata,
          }
        }).pipe(Effect.orDie),
    }
  }),
)
