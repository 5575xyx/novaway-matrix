import { Context, Effect, Layer, Option } from "effect"
import * as Log from "@novaway/core/util/log"
import { Global } from "@novaway/core/global"
import path from "node:path"
import fs from "node:fs/promises"
import { Config } from "@/config/config"
import { ConfigChannels, type ChannelInfo } from "@/config/channels"
import { InstanceRef, WorkspaceRef } from "@/effect/instance-ref"
import { createSecretStore } from "@/plugin/runtime/secrets"
import type { SessionID } from "@/session/schema"
import { Supervisor, type ChannelHandle, type ChannelHealth, type InboundMessage, type ReplyTarget } from "./channel"
import { FeishuTransport } from "./transports/feishu"
import { TelegramTransport } from "./transports/telegram"
import { DingTalkTransport } from "./transports/dingtalk"
import { WeComTransport } from "./transports/wecom"
import { SlackTransport } from "./transports/slack"

const log = Log.create({ service: "channel" })

type SessionService = {
  create(input: { title: string }): Effect.Effect<{ id: SessionID }>
}
type PromptService = {
  prompt(input: {
    sessionID: SessionID
    parts: { type: "text"; text: string }[]
  }): Effect.Effect<{ parts: readonly unknown[] }, unknown>
}

type State = {
  sessions: Record<string, string>
  users: Record<string, string>
}

type Runtime = {
  supervisor: Supervisor
  state: State
  directory: string
}

export interface Interface {
  /** Start every configured channel for this project. Idempotent. */
  readonly start: (input: { directory: string }) => Effect.Effect<void>
  readonly stop: (input?: { directory: string }) => Effect.Effect<void>
  readonly health: (input: { directory: string }) => Effect.Effect<ChannelHealth[]>
  readonly send: (input: {
    directory: string
    name: string
    text: string
    target: ReplyTarget
  }) => Effect.Effect<void, Error>
}

export class Service extends Context.Service<Service, Interface>()("@novaway/Channel") {}

function stateFile(directory: string) {
  return path.join(directory, ".novaway", "channels", "state.json")
}

async function loadState(directory: string): Promise<State> {
  const text = await fs.readFile(stateFile(directory), "utf8").catch(() => "")
  if (!text) return { sessions: {}, users: {} }
  const parsed = JSON.parse(text) as Partial<State>
  return { sessions: parsed.sessions ?? {}, users: parsed.users ?? {} }
}

async function saveState(directory: string, state: State) {
  const file = stateFile(directory)
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, JSON.stringify(state, null, 2), "utf8")
}

function textFromParts(parts: readonly unknown[]) {
  return parts
    .filter((part): part is { type: string; text?: string } => typeof part === "object" && part !== null)
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text ?? "")
    .filter(Boolean)
    .join("\n\n")
}

const credentialFields = [
  "app_id",
  "app_secret",
  "bot_token",
  "webhook",
  "sign_secret",
  "corp_id",
  "corp_secret",
  "agent_id",
  "callback_token",
  "aes_key",
] as const

type Resolved = ChannelInfo & { kind: ChannelInfo["kind"] }

async function resolveCredentials(info: ChannelInfo): Promise<Resolved> {
  if (!info.secret_name) return info
  const store = createSecretStore(path.join(Global.Path.state, "channel-secrets"))
  const raw = await store.read(info.secret_name).catch((error) => {
    log.warn("failed to read channel secret", { name: info.secret_name, error: String(error) })
    return undefined
  })
  if (!raw) return info
  const parsed = JSON.parse(raw) as Record<string, unknown>
  const merged: Record<string, unknown> = { ...info }
  for (const field of credentialFields) {
    if (typeof parsed[field] === "string" && parsed[field]) merged[field] = parsed[field]
  }
  return merged as Resolved
}

function transportFor(info: Resolved, onError: (error: unknown) => void) {
  const common = {
    ...(info.host ? { host: info.host } : {}),
    ...(info.port ? { port: info.port } : {}),
    path: info.path ?? `/channels/${info.name}`,
    onError,
  }
  if (info.kind === "feishu") {
    if (!info.app_id || !info.app_secret) return undefined
    return new FeishuTransport({ appId: info.app_id, appSecret: info.app_secret })
  }
  if (info.kind === "telegram") {
    if (!info.bot_token) return undefined
    return new TelegramTransport({ token: info.bot_token, onError })
  }
  if (info.kind === "slack") {
    if (!info.bot_token || !info.port) return undefined
    return new SlackTransport({
      botToken: info.bot_token,
      ...(info.sign_secret ? { signingSecret: info.sign_secret } : {}),
      ...common,
    })
  }
  if (info.kind === "dingtalk") {
    if (!info.webhook && !info.port) return undefined
    return new DingTalkTransport({
      ...(info.webhook ? { webhook: info.webhook } : {}),
      ...(info.sign_secret ? { signSecret: info.sign_secret } : {}),
      ...common,
    })
  }
  if (!info.corp_id || !info.corp_secret || !info.agent_id) return undefined
  return new WeComTransport({
    corpId: info.corp_id,
    corpSecret: info.corp_secret,
    agentId: info.agent_id,
    ...(info.callback_token ? { callbackToken: info.callback_token } : {}),
    ...(info.aes_key ? { aesKey: info.aes_key } : {}),
    ...common,
  })
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service
    // Imported lazily: session/prompt imports this module to start channels, so a
    // static import here would close the cycle.
    const sessionModule = yield* Effect.promise(() => import("@/session/session")).pipe(Effect.orDie)
    const promptModule = yield* Effect.promise(() => import("@/session/prompt")).pipe(Effect.orDie)
    const runtimes = new Map<string, Runtime>()

    const start = Effect.fn("Channel.start")(function* (input: { directory: string }) {
      if (runtimes.has(input.directory)) return
      const channels = ConfigChannels.resolve((yield* config.get()).channels)
      if (!channels.enabled || channels.channels.length === 0) return

      const sessions = Option.getOrUndefined(yield* Effect.serviceOption(sessionModule.Service)) as
        | SessionService
        | undefined
      const prompts = Option.getOrUndefined(yield* Effect.serviceOption(promptModule.Service)) as
        | PromptService
        | undefined
      if (!sessions || !prompts) {
        log.warn("channel runtime is missing session services; channels stay stopped")
        return
      }
      const instance = yield* InstanceRef
      const workspace = yield* WorkspaceRef
      const state = yield* Effect.promise(() => loadState(input.directory))
      const supervisor = new Supervisor({
        maxRestarts: channels.max_restarts,
        onEvent: (event) => log.debug("channel event", event),
      })

      const persist = () => Effect.promise(() => saveState(input.directory, state)).pipe(Effect.ignore)

      const route = (name: string, allowedUser?: string) => (message: InboundMessage, channel: ChannelHandle) =>
        Effect.runPromise(
          Effect.gen(function* () {
            const bound = state.users[name] ?? allowedUser
            if (bound && message.senderID && bound !== message.senderID) {
              log.warn("channel dropped a message from an unbound sender", { name, sender: message.senderID })
              return
            }
            if (!bound && message.senderID) {
              state.users[name] = message.senderID
              yield* persist()
            }
            const key = `${name}:${message.conversation}`
            let sessionID = state.sessions[key] as SessionID | undefined
            if (!sessionID) {
              const created = yield* sessions.create({ title: `Channel ${name}: ${message.conversation}`.slice(0, 80) })
              sessionID = created.id
              state.sessions[key] = sessionID
              yield* persist()
            }
            const result = yield* prompts
              .prompt({ sessionID, parts: [{ type: "text", text: message.text }] })
              .pipe(Effect.exit)
            if (result._tag === "Failure") {
              log.warn("channel prompt failed", { name, sessionID })
              yield* Effect.tryPromise(() =>
                channel.send("NovaWay 处理失败，请到 NovaWay 中查看会话。", {
                  conversation: message.conversation,
                  ...(message.messageID ? { replyTo: message.messageID } : {}),
                }),
              ).pipe(Effect.ignore)
              return
            }
            const answer = textFromParts(result.value.parts) || "已完成，请到 NovaWay 中查看完整结果。"
            yield* Effect.tryPromise(() =>
              channel.send(answer, {
                conversation: message.conversation,
                ...(message.messageID ? { replyTo: message.messageID } : {}),
              }),
            ).pipe(Effect.ignore)
          }).pipe(
            Effect.provideService(InstanceRef, instance),
            Effect.provideService(WorkspaceRef, workspace),
            Effect.provideService(sessionModule.Service, sessions as never),
            Effect.provideService(promptModule.Service, prompts as never),
            Effect.catchCause((cause) => Effect.sync(() => log.error("channel route failed", { name, cause }))),
          ),
        )

      for (const channel of channels.channels) {
        const resolved = yield* Effect.promise(() => resolveCredentials(channel))
        const transport = transportFor(resolved, (error) =>
          log.warn("channel transport error", { name: channel.name, error: String(error) }),
        )
        if (!transport) {
          log.warn("channel skipped: missing credentials", { name: channel.name, kind: channel.kind })
          continue
        }
        supervisor.add({
          name: channel.name,
          kind: channel.kind,
          transport,
          route: route(channel.name, channel.user_id?.trim() || undefined),
        })
        log.info("channel registered", { name: channel.name, kind: channel.kind })
      }

      const runtime: Runtime = { supervisor, state, directory: input.directory }
      runtimes.set(input.directory, runtime)
      // Connect in the background: one unreachable provider must not block startup.
      yield* Effect.promise(() =>
        supervisor.start().catch((error) => log.warn("channel start failed", { error: String(error) })),
      )
    })

    const stop = Effect.fn("Channel.stop")(function* (input?: { directory: string }) {
      const targets = input
        ? [...runtimes.entries()].filter(([directory]) => directory === input.directory)
        : [...runtimes.entries()]
      for (const [directory, runtime] of targets) {
        runtimes.delete(directory)
        yield* Effect.promise(() => runtime.supervisor.stop()).pipe(Effect.ignore)
      }
    })

    const health = Effect.fn("Channel.health")(function* (input: { directory: string }) {
      const runtime = runtimes.get(input.directory)
      return runtime ? runtime.supervisor.health() : []
    })

    const send = Effect.fn("Channel.send")(function* (input: {
      directory: string
      name: string
      text: string
      target: ReplyTarget
    }) {
      const runtime = runtimes.get(input.directory)
      if (!runtime) return yield* Effect.fail(new Error("channels are not running for this directory"))
      yield* Effect.tryPromise(() => runtime.supervisor.send(input.name, input.text, input.target))
    })

    return Service.of({ start, stop, health, send })
  }),
)

// Callers already provide Config (session/prompt builds this layer inside its
// own Config-provided graph); providing it again would create a second cache.
export const defaultLayer = layer
