import { Session } from "@/session/session"
import { SessionID } from "@/session/schema"
import { SyncEvent } from "@/sync"
import { Effect, Layer, Scope, Context } from "effect"
import { Config } from "@/config/config"
import { RuntimeFlags } from "@/effect/runtime-flags"
import * as TeamDefaults from "@/team/defaults"
import * as TeamSwitch from "@/team/switch"
import * as ShareNext from "./share-next"

export interface Interface {
  readonly create: (input?: Session.CreateParams) => Effect.Effect<Session.Info>
  readonly share: (sessionID: SessionID) => Effect.Effect<{ url: string }, unknown>
  readonly unshare: (sessionID: SessionID) => Effect.Effect<void, unknown>
}

export class Service extends Context.Service<Service, Interface>()("@NovaWay/SessionShare") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const cfg = yield* Config.Service
    const session = yield* Session.Service
    const shareNext = yield* ShareNext.Service
    const scope = yield* Scope.Scope
    const sync = yield* SyncEvent.Service
    const flags = yield* RuntimeFlags.Service

    const share = Effect.fn("SessionShare.share")(function* (sessionID: SessionID) {
      const conf = yield* cfg.get()
      if (conf.share === "disabled") throw new Error("Sharing is disabled in configuration")
      const result = yield* shareNext.create(sessionID)
      yield* sync.run(Session.Event.Updated, { sessionID, info: { share: { url: result.url } } })
      return result
    })

    const unshare = Effect.fn("SessionShare.unshare")(function* (sessionID: SessionID) {
      yield* shareNext.remove(sessionID)
      yield* sync.run(Session.Event.Updated, { sessionID, info: { share: { url: null } } })
    })

    const create = Effect.fn("SessionShare.create")(function* (input?: Session.CreateParams) {
      const conf = yield* cfg.get()
      // 默认团队模式（§4.5）只在这里生效：这是「用户新建会话」的唯一入口，
      // 团队内部派生会话、子代理都带 parentID，不会被默认值波及。
      const defaults = TeamDefaults.resolve({
        requested: input,
        parentID: input?.parentID,
        enabled: TeamSwitch.enabled(conf.experimental),
        fallback: {
          mode: conf.experimental?.team_default_mode,
          ids: conf.experimental?.team_default_ids,
        },
      })
      const result = yield* session.create(defaults ? { ...input, ...defaults } : input)
      if (result.parentID) return result
      if (!(flags.autoShare || conf.share === "auto")) return result
      yield* share(result.id).pipe(Effect.ignore, Effect.forkIn(scope))
      return result
    })

    return Service.of({ create, share, unshare })
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(ShareNext.defaultLayer),
  Layer.provide(Session.defaultLayer),
  Layer.provide(Config.defaultLayer),
  Layer.provide(SyncEvent.defaultLayer),
  Layer.provide(RuntimeFlags.defaultLayer),
)

export * as SessionShare from "./session"
