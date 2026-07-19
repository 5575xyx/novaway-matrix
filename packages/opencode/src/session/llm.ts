import { Provider } from "@/provider/provider"
import * as Log from "@opencode-ai/core/util/log"
import { Context, Effect, Layer, Record, Schema } from "effect"
import * as Stream from "effect/Stream"
import { streamText, wrapLanguageModel, type ModelMessage, type Tool, tool, jsonSchema } from "ai"
import { mergeDeep } from "remeda"
import { GitLabWorkflowLanguageModel } from "gitlab-ai-provider"
import { ProviderTransform } from "@/provider/transform"
import { Config } from "@/config/config"
import { InstanceState } from "@/effect/instance-state"
import type { Agent } from "@/agent/agent"
import type { MessageV2 } from "./message-v2"
import { Plugin } from "@/plugin"
import { SystemPrompt } from "./system"
import { Permission } from "@/permission"
import { PermissionID } from "@/permission/schema"
import { Bus } from "@/bus"
import { Wildcard } from "@/util/wildcard"
import { SessionID } from "@/session/schema"
import { Auth } from "@/auth"
import { InstallationVersion } from "@opencode-ai/core/installation/version"
import { EffectBridge } from "@/effect/bridge"
import { RuntimeFlags } from "@/effect/runtime-flags"
import * as Option from "effect/Option"
import * as OtelTracer from "@effect/opentelemetry/Tracer"
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/unstable/http"
import { AgnesImage, AgnesVideo, ImageGeneration, ProtocolRegistry, VideoGeneration } from "@opencode-ai/llm/protocols"

const log = Log.create({ service: "llm" })
export const OUTPUT_TOKEN_MAX = ProviderTransform.OUTPUT_TOKEN_MAX
type Result = Awaited<ReturnType<typeof streamText>>

// Avoid re-instantiating remeda's deep merge types in this hot LLM path; the runtime behavior is still mergeDeep.
const mergeOptions = (target: Record<string, any>, source: Record<string, any> | undefined): Record<string, any> =>
  mergeDeep(target, source ?? {}) as Record<string, any>

export type StreamInput = {
  user: MessageV2.User
  sessionID: string
  parentSessionID?: string
  model: Provider.Model
  agent: Agent.Info
  permission?: Permission.Ruleset
  system: string[]
  messages: ModelMessage[]
  small?: boolean
  tools: Record<string, Tool>
  retries?: number
  toolChoice?: "auto" | "required" | "none"
}

export type StreamRequest = StreamInput & {
  abort: AbortSignal
}

export type Event = Result["fullStream"] extends AsyncIterable<infer T> ? T : never

export interface Interface {
  readonly stream: (input: StreamInput) => Stream.Stream<Event, unknown>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/LLM") {}

const live: Layer.Layer<
  Service,
  never,
  | Auth.Service
  | Config.Service
  | Provider.Service
  | Plugin.Service
  | Permission.Service
  | RuntimeFlags.Service
  | HttpClient.HttpClient
> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const auth = yield* Auth.Service
    const config = yield* Config.Service
    const provider = yield* Provider.Service
    const plugin = yield* Plugin.Service
    const perm = yield* Permission.Service
    const flags = yield* RuntimeFlags.Service
    const http = yield* HttpClient.HttpClient
    const httpOk = HttpClient.filterStatusOk(http)

    const run = Effect.fn("LLM.run")(function* (input: StreamRequest) {
      const l = log
        .clone()
        .tag("providerID", input.model.providerID)
        .tag("modelID", input.model.id)
        .tag("session.id", input.sessionID)
        .tag("small", (input.small ?? false).toString())
        .tag("agent", input.agent.name)
        .tag("mode", input.agent.mode)
      l.info("stream", {
        modelID: input.model.id,
        providerID: input.model.providerID,
      })

      const [language, cfg, item, info] = yield* Effect.all(
        [
          provider.getLanguage(input.model),
          config.get(),
          provider.getProvider(input.model.providerID),
          auth.get(input.model.providerID),
        ],
        { concurrency: "unbounded" },
      )

      // TODO: move this to a proper hook
      const isOpenaiOauth = item.id === "openai" && info?.type === "oauth"

      const system: string[] = []
      system.push(
        [
          // use agent prompt otherwise provider prompt
          ...(input.agent.prompt ? [input.agent.prompt] : SystemPrompt.provider(input.model)),
          // any custom prompt passed into this call
          ...input.system,
          // any custom prompt from last user message
          ...(input.user.system ? [input.user.system] : []),
        ]
          .filter((x) => x)
          .join("\n"),
      )

      const header = system[0]
      yield* plugin.trigger(
        "experimental.chat.system.transform",
        { sessionID: input.sessionID, model: input.model },
        { system },
      )
      // rejoin to maintain 2-part structure for caching if header unchanged
      if (system.length > 2 && system[0] === header) {
        const rest = system.slice(1)
        system.length = 0
        system.push(header, rest.join("\n"))
      }

      const variant =
        !input.small && input.model.variants && input.user.model.variant
          ? input.model.variants[input.user.model.variant]
          : {}
      const base = input.small
        ? ProviderTransform.smallOptions(input.model)
        : ProviderTransform.options({
            model: input.model,
            sessionID: input.sessionID,
            providerOptions: item.options,
          })
      const options = mergeOptions(mergeOptions(mergeOptions(base, input.model.options), input.agent.options), variant)
      if (isOpenaiOauth) {
        options.instructions = system.join("\n")
      }

      const isWorkflow = language instanceof GitLabWorkflowLanguageModel
      const messages = isOpenaiOauth
        ? input.messages
        : isWorkflow
          ? input.messages
          : [
              ...system.map(
                (x): ModelMessage => ({
                  role: "system",
                  content: x,
                }),
              ),
              ...input.messages,
            ]

      const params = yield* plugin.trigger(
        "chat.params",
        {
          sessionID: input.sessionID,
          agent: input.agent.name,
          model: input.model,
          provider: item,
          message: input.user,
        },
        {
          temperature: input.model.capabilities.temperature
            ? (input.agent.temperature ?? ProviderTransform.temperature(input.model))
            : undefined,
          topP: input.agent.topP ?? ProviderTransform.topP(input.model),
          topK: ProviderTransform.topK(input.model),
          maxOutputTokens: ProviderTransform.maxOutputTokens(input.model, flags.outputTokenMax),
          options,
        },
      )

      const { headers } = yield* plugin.trigger(
        "chat.headers",
        {
          sessionID: input.sessionID,
          agent: input.agent.name,
          model: input.model,
          provider: item,
          message: input.user,
        },
        {
          headers: {},
        },
      )

      const tools = resolveTools(input)

      // GitHub Copilot may require the tools parameter when message history contains
      // tool calls but no tools are active (e.g. compaction). Inject a stub tool that
      // is never meant to be invoked. LiteLLM-backed providers are excluded.
      if (
        input.model.providerID.includes("github-copilot") &&
        Object.keys(tools).length === 0 &&
        hasToolCalls(input.messages)
      ) {
        tools["_noop"] = tool({
          description: "Do not call this tool. It exists only for API compatibility and must never be invoked.",
          inputSchema: jsonSchema({
            type: "object",
            properties: {
              reason: { type: "string", description: "Unused" },
            },
          }),
          execute: async () => ({ output: "", title: "", metadata: {} }),
        })
      }
      const sortedTools = Object.fromEntries(Object.entries(tools).toSorted(([a], [b]) => a.localeCompare(b)))

      // Wire up toolExecutor for DWS workflow models so that tool calls
      // from the workflow service are executed via opencode's tool system
      // and results sent back over the WebSocket.
      if (language instanceof GitLabWorkflowLanguageModel) {
        const workflowModel = language as GitLabWorkflowLanguageModel & {
          sessionID?: string
          sessionPreapprovedTools?: string[]
          approvalHandler?: (approvalTools: { name: string; args: string }[]) => Promise<{ approved: boolean }>
        }
        workflowModel.sessionID = input.sessionID
        workflowModel.systemPrompt = system.join("\n")
        workflowModel.toolExecutor = async (toolName, argsJson, _requestID) => {
          const t = sortedTools[toolName]
          if (!t || !t.execute) {
            return { result: "", error: `Unknown tool: ${toolName}` }
          }
          try {
            const result = await t.execute!(JSON.parse(argsJson), {
              toolCallId: _requestID,
              messages: input.messages,
              abortSignal: input.abort,
            })
            const output = typeof result === "string" ? result : (result?.output ?? JSON.stringify(result))
            return {
              result: output,
              metadata: typeof result === "object" ? result?.metadata : undefined,
              title: typeof result === "object" ? result?.title : undefined,
            }
          } catch (e: any) {
            return { result: "", error: e.message ?? String(e) }
          }
        }

        const ruleset = Permission.merge(input.agent.permission ?? [], input.permission ?? [])
        workflowModel.sessionPreapprovedTools = Object.keys(sortedTools).filter((name) => {
          const match = ruleset.findLast((rule) => Wildcard.match(name, rule.permission))
          return !match || match.action !== "ask"
        })

        const bridge = yield* EffectBridge.make()
        const approvedToolsForSession = new Set<string>()
        workflowModel.approvalHandler = bridge.bind(async (approvalTools) => {
          const uniqueNames = [...new Set(approvalTools.map((t: { name: string }) => t.name))] as string[]
          // Auto-approve tools that were already approved in this session
          // (prevents infinite approval loops for server-side MCP tools)
          if (uniqueNames.every((name) => approvedToolsForSession.has(name))) {
            return { approved: true }
          }

          const id = PermissionID.ascending()
          let unsub: (() => void) | undefined
          try {
            unsub = Bus.subscribe(Permission.Event.Replied, (evt) => {
              if (evt.properties.requestID === id) void evt.properties.reply
            })
            const toolPatterns = approvalTools.map((t: { name: string; args: string }) => {
              try {
                const parsed = JSON.parse(t.args) as Record<string, unknown>
                const title = (parsed?.title ?? parsed?.name ?? "") as string
                return title ? `${t.name}: ${title}` : t.name
              } catch {
                return t.name
              }
            })
            const uniquePatterns = [...new Set(toolPatterns)] as string[]
            await bridge.promise(
              perm.ask({
                id,
                sessionID: SessionID.make(input.sessionID),
                permission: "workflow_tool_approval",
                patterns: uniquePatterns,
                metadata: { tools: approvalTools },
                always: uniquePatterns,
                ruleset: [],
              }),
            )
            for (const name of uniqueNames) approvedToolsForSession.add(name)
            workflowModel.sessionPreapprovedTools = [...(workflowModel.sessionPreapprovedTools ?? []), ...uniqueNames]
            return { approved: true }
          } catch {
            return { approved: false }
          } finally {
            unsub?.()
          }
        })
      }

      const tracer = cfg.experimental?.openTelemetry
        ? Option.getOrUndefined(yield* Effect.serviceOption(OtelTracer.OtelTracer))
        : undefined
      const telemetryTracer = tracer
        ? new Proxy(tracer, {
            get(target, prop, receiver) {
              if (prop !== "startSpan") return Reflect.get(target, prop, receiver)
              return (...args: Parameters<typeof target.startSpan>) => {
                const span = target.startSpan(...args)
                span.setAttribute("session.id", input.sessionID)
                return span
              }
            },
          })
        : undefined

      const opencodeProjectID = input.model.providerID.startsWith("opencode")
        ? (yield* InstanceState.context).project.id
        : undefined

      return streamText({
        onError(error) {
          l.error("stream error", {
            error,
          })
        },
        async experimental_repairToolCall(failed) {
          const lower = failed.toolCall.toolName.toLowerCase()
          if (lower !== failed.toolCall.toolName && sortedTools[lower]) {
            l.info("repairing tool call", {
              tool: failed.toolCall.toolName,
              repaired: lower,
            })
            return {
              ...failed.toolCall,
              toolName: lower,
            }
          }
          return {
            ...failed.toolCall,
            input: JSON.stringify({
              tool: failed.toolCall.toolName,
              error: failed.error.message,
            }),
            toolName: "invalid",
          }
        },
        temperature: params.temperature,
        topP: params.topP,
        topK: params.topK,
        providerOptions: ProviderTransform.providerOptions(input.model, params.options),
        activeTools: Object.keys(sortedTools).filter((x) => x !== "invalid"),
        tools: sortedTools,
        toolChoice: input.toolChoice,
        maxOutputTokens: params.maxOutputTokens,
        abortSignal: input.abort,
        headers: {
          ...(input.model.providerID.startsWith("opencode")
            ? {
                "x-opencode-project": opencodeProjectID,
                "x-opencode-session": input.sessionID,
                "x-opencode-request": input.user.id,
                "x-opencode-client": flags.client,
                "User-Agent": `opencode/${InstallationVersion}`,
              }
            : {
                "x-session-affinity": input.sessionID,
                ...(input.parentSessionID ? { "x-parent-session-id": input.parentSessionID } : {}),
                "User-Agent": `opencode/${InstallationVersion}`,
              }),
          ...input.model.headers,
          ...headers,
        },
        maxRetries: input.retries ?? 0,
        messages,
        model: wrapLanguageModel({
          model: language,
          middleware: [
            {
              specificationVersion: "v3" as const,
              async transformParams(args) {
                if (args.type === "stream") {
                  // @ts-expect-error
                  args.params.prompt = ProviderTransform.message(args.params.prompt, input.model, options)
                }
                return args.params
              },
            },
          ],
        }),
        experimental_telemetry: {
          isEnabled: cfg.experimental?.openTelemetry,
          functionId: "session.llm",
          tracer: telemetryTracer,
          metadata: {
            userId: cfg.username ?? "unknown",
            sessionId: input.sessionID,
          },
        },
      })
    })

    const stream: Interface["stream"] = (input) =>
      Stream.scoped(
        Stream.unwrap(
          Effect.gen(function* () {
            // 智能路由：检测图片/视频生成模型并直接调用生成 API
            const isImageModel = input.model.capabilities?.output?.image === true
            const isVideoModel = input.model.capabilities?.output?.video === true

            if (isImageModel || isVideoModel) {
              // 从消息中提取用户提示词和图片附件
              const lastUserMessage = input.messages.findLast((m) => m.role === "user")
              let userPrompt = ""
              const imageUrls: string[] = []
              if (lastUserMessage) {
                if (typeof lastUserMessage.content === "string") {
                  userPrompt = lastUserMessage.content
                } else if (Array.isArray(lastUserMessage.content)) {
                  const textParts: string[] = []
                  for (const part of lastUserMessage.content) {
                    if (part.type === "text" && "text" in part && typeof part.text === "string") {
                      textParts.push(part.text)
                    } else if (
                      part.type === "file" &&
                      "data" in part &&
                      typeof part.data === "string" &&
                      part.mediaType?.startsWith("image/")
                    ) {
                      imageUrls.push(part.data)
                    }
                  }
                  userPrompt = textParts.join("\n")
                }
              }

              if (!userPrompt) {
                userPrompt = isImageModel ? "请生成图片" : "请生成视频"
              }

              // 从 auth 服务获取 API Key
              const authInfo = yield* auth.get(input.model.providerID)
              let apiKey = ""
              if (authInfo) {
                if (authInfo.type === "api") {
                  apiKey = authInfo.key
                } else if (authInfo.type === "wellknown") {
                  apiKey = authInfo.token
                }
              }

              if (!apiKey) {
                throw new Error(`供应商 "${input.model.providerID}" 未配置 API Key。请在设置 → 供应商中配置 API Key。`)
              }

              // 获取供应商的 base URL；Agnes 协议已内置 /v1，若用户配置的 endpoint 缺少 /v1 则使用协议默认地址
              const providerConfig = yield* provider.getProvider(input.model.providerID)
              const providerBaseURL = providerConfig.options?.baseURL ?? providerConfig.options?.endpoint
              const resolveBaseURL = (protocolBase: string) => {
                if (!providerBaseURL) return protocolBase
                if (providerBaseURL.endsWith("/v1") || providerBaseURL.endsWith("/v1/")) return providerBaseURL
                return protocolBase
              }

              const textId = `text-${Date.now()}`

              if (isImageModel) {
                log.info("routing to image generation", {
                  modelID: input.model.id,
                  prompt: userPrompt.slice(0, 100),
                  imageCount: imageUrls.length,
                  imageSizes: imageUrls.map((url) => url.length),
                })

                const baseURL = resolveBaseURL(AgnesImage.agnesImage.baseURL)
                const protocol = ProtocolRegistry.getImageProtocol(input.model.providerID) ?? {
                  ...AgnesImage.agnesImage,
                  baseURL,
                }
                const finalProtocol = { ...protocol, baseURL }

                const result = yield* ImageGeneration.make()
                  .generate(finalProtocol, { prompt: userPrompt, model: input.model.id, image: imageUrls }, apiKey)
                  .pipe(Effect.provideService(HttpClient.HttpClient, http))

                log.info("image generation result", {
                  imageCount: result.images.length,
                  hasUrl: result.images[0]?.url != null,
                  hasBase64: result.images[0]?.base64 != null,
                })

                const imageUrl = result.images[0]?.url
                const imageBase64 = result.images[0]?.base64
                const outputText = imageUrl
                  ? `已生成图片：![generated image](${imageUrl})`
                  : imageBase64
                    ? `已生成图片：![generated image](data:image/png;base64,${imageBase64})`
                    : "图片生成成功，但返回结果中未包含图片数据"

                return Stream.succeed(makeStartStep()).pipe(
                  Stream.concat(Stream.succeed({ type: "text-start" as const, id: textId })),
                  Stream.concat(Stream.succeed({ type: "text-delta" as const, id: textId, text: outputText })),
                  Stream.concat(Stream.succeed({ type: "text-end" as const, id: textId })),
                  Stream.concat(Stream.succeed(makeFinishStep())),
                )
              }

              if (isVideoModel) {
                log.info("routing to video generation", { modelID: input.model.id, prompt: userPrompt.slice(0, 100) })

                const baseURL = resolveBaseURL(AgnesVideo.agnesVideo.baseURL)
                const protocol = ProtocolRegistry.getVideoProtocol(input.model.providerID) ?? {
                  ...AgnesVideo.agnesVideo,
                  baseURL,
                }
                const finalProtocol = { ...protocol, baseURL }
                const videoService = VideoGeneration.make()

                const createResult = yield* videoService
                  .createTask(
                    finalProtocol,
                    {
                      prompt: userPrompt,
                      model: input.model.id,
                      width: 1152,
                      height: 768,
                      numFrames: 121,
                      frameRate: 24,
                      image: imageUrls[0],
                    },
                    apiKey,
                  )
                  .pipe(Effect.provideService(HttpClient.HttpClient, http))

                if (!createResult.taskId) {
                  throw new Error("视频生成任务创建失败：未返回任务 ID")
                }

                const statusResult = yield* videoService
                  .waitForCompletion(finalProtocol, createResult.taskId, apiKey, {
                    pollIntervalMs: 2000,
                    maxWaitMs: 600000,
                  })
                  .pipe(Effect.provideService(HttpClient.HttpClient, http))

                if (statusResult.status === "failed") {
                  throw new Error(statusResult.error ?? "视频生成失败")
                }

                const videoUrl = statusResult.videoUrl
                const outputText = videoUrl ? `<video src="${videoUrl}" controls width="100%"></video>` : "视频生成完成"

                return Stream.succeed(makeStartStep()).pipe(
                  Stream.concat(Stream.succeed({ type: "text-start" as const, id: textId })),
                  Stream.concat(Stream.succeed({ type: "text-delta" as const, id: textId, text: outputText })),
                  Stream.concat(Stream.succeed({ type: "text-end" as const, id: textId })),
                  Stream.concat(Stream.succeed(makeFinishStep())),
                )
              }
            }

            // 普通聊天模型：调用 run 函数
            const ctrl = yield* Effect.acquireRelease(
              Effect.sync(() => new AbortController()),
              (ctrl) => Effect.sync(() => ctrl.abort()),
            )

            const result = yield* run({ ...input, abort: ctrl.signal })

            return Stream.fromAsyncIterable(result.fullStream, (e) => (e instanceof Error ? e : new Error(String(e))))
          }),
        ),
      )

    return Service.of({ stream })
  }),
)

export const layer = live.pipe(Layer.provide(Permission.defaultLayer))

export const defaultLayer = Layer.suspend(() =>
  layer.pipe(
    Layer.provide(Auth.defaultLayer),
    Layer.provide(Config.defaultLayer),
    Layer.provide(Provider.defaultLayer),
    Layer.provide(Plugin.defaultLayer),
    Layer.provide(RuntimeFlags.defaultLayer),
    Layer.provide(FetchHttpClient.layer),
  ),
)

function makeStartStep(): Event {
  return {
    type: "start-step",
    request: {} as any,
    warnings: [] as any[],
  } as unknown as Event
}

function makeFinishStep(): Event {
  const usage = {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    inputTokenDetails: { noCacheTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
    outputTokenDetails: { textTokens: 0, reasoningTokens: 0 },
  }
  return {
    type: "finish-step",
    finishReason: "stop",
    usage,
    response: {},
    rawFinishReason: undefined,
    providerMetadata: undefined,
  } as unknown as Event
}

function resolveTools(input: Pick<StreamInput, "tools" | "agent" | "permission" | "user">) {
  const disabled = Permission.disabled(
    Object.keys(input.tools),
    Permission.merge(input.agent.permission, input.permission ?? []),
  )
  return Record.filter(input.tools, (_, k) => input.user.tools?.[k] !== false && !disabled.has(k))
}

// Check if messages contain any tool-call content
// Used to determine if a dummy tool should be added (GitHub Copilot only; see stream()).
export function hasToolCalls(messages: ModelMessage[]): boolean {
  for (const msg of messages) {
    if (!Array.isArray(msg.content)) continue
    for (const part of msg.content) {
      if (part.type === "tool-call" || part.type === "tool-result") return true
    }
  }
  return false
}

export * as LLM from "./llm"
