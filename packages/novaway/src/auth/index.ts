import path from "path"
import { Effect, Layer, Schema, Context } from "effect"
import { NonNegativeInt } from "@novaway/core/schema"
import { Global } from "@novaway/core/global"
import { AppFileSystem } from "@novaway/core/filesystem"

export const OAUTH_DUMMY_KEY = "NovaWay-oauth-dummy-key"

const file = path.join(Global.Path.data, "auth.json")

const fail = (message: string) => (cause: unknown) => new AuthError({ message, cause })

export class Oauth extends Schema.Class<Oauth>("OAuth")({
  type: Schema.Literal("oauth"),
  refresh: Schema.String,
  access: Schema.String,
  expires: NonNegativeInt,
  accountId: Schema.optional(Schema.String),
  enterpriseUrl: Schema.optional(Schema.String),
}) {}

export class Api extends Schema.Class<Api>("ApiAuth")({
  type: Schema.Literal("api"),
  key: Schema.String,
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.String)),
}) {}

export class WellKnown extends Schema.Class<WellKnown>("WellKnownAuth")({
  type: Schema.Literal("wellknown"),
  key: Schema.String,
  token: Schema.String,
}) {}

export const Info = Schema.Union([Oauth, Api, WellKnown]).annotate({ discriminator: "type", identifier: "Auth" })
export type Info = Schema.Schema.Type<typeof Info>

export class AuthError extends Schema.TaggedErrorClass<AuthError>()("AuthError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect),
}) {}

export interface Interface {
  readonly get: (providerID: string) => Effect.Effect<Info | undefined, AuthError>
  readonly all: () => Effect.Effect<Record<string, Info>, AuthError>
  readonly set: (key: string, info: Info) => Effect.Effect<void, AuthError>
  readonly remove: (key: string) => Effect.Effect<void, AuthError>
  /** Get all auth entries for a provider. Supports multiple keys per provider. */
  readonly getEntries: (providerID: string) => Effect.Effect<Info[], AuthError>
  /** Add another auth entry for a provider (does not replace existing). */
  readonly addEntry: (key: string, info: Info) => Effect.Effect<void, AuthError>
  /** Remove a specific auth entry by index. */
  readonly removeEntry: (key: string, index: number) => Effect.Effect<void, AuthError>
}

export class Service extends Context.Service<Service, Interface>()("@NovaWay/Auth") {}

const migrateOldFormat = (raw: Record<string, unknown>): boolean => {
  let migrated = false
  for (const [key, val] of Object.entries(raw)) {
    if (!Array.isArray(val)) {
      raw[key] = [val]
      migrated = true
    }
  }
  return migrated
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fsys = yield* AppFileSystem.Service
    const decode = Schema.decodeUnknownOption(Info)

    const readFile = Effect.fn("Auth.readFile")(function* () {
      if (process.env.NovaWay_AUTH_CONTENT) {
        try {
          return JSON.parse(process.env.NovaWay_AUTH_CONTENT) as Record<string, unknown>
        } catch (_) {}
      }
      return (yield* fsys.readJson(file).pipe(Effect.orElseSucceed(() => ({})))) as Record<string, unknown>
    })

    const writeFile = (data: Record<string, unknown>) =>
      fsys.writeJson(file, data, 0o600).pipe(Effect.mapError(fail("Failed to write auth data")))

    const readAll = Effect.fn("Auth.readAll")(function* () {
      const raw = yield* readFile()
      if (migrateOldFormat(raw)) {
        yield* writeFile(raw)
      }
      const result: Record<string, Info[]> = {}
      for (const [key, vals] of Object.entries(raw)) {
        if (!Array.isArray(vals)) continue
        const decoded: Info[] = []
        for (const v of vals) {
          const r = decode(v)
          if (r._tag === "Some") decoded.push(r.value)
        }
        if (decoded.length > 0) result[key] = decoded
      }
      return result
    })

    const get = Effect.fn("Auth.get")(function* (providerID: string) {
      const entries = (yield* readAll())[providerID]
      return entries?.[0]
    })

    const all = Effect.fn("Auth.all")(function* () {
      const allEntries = yield* readAll()
      const result: Record<string, Info> = {}
      for (const [key, entries] of Object.entries(allEntries)) {
        result[key] = entries[0]
      }
      return result
    })

    const set = Effect.fn("Auth.set")(function* (key: string, info: Info) {
      const norm = key.replace(/\/+$/, "")
      const data = yield* readFile()
      if (migrateOldFormat(data)) yield* writeFile(data)
      if (norm !== key) delete data[key]
      delete data[norm + "/"]
      data[norm] = [info]
      yield* writeFile(data)
    })

    const remove = Effect.fn("Auth.remove")(function* (key: string) {
      const norm = key.replace(/\/+$/, "")
      const data = yield* readFile()
      delete data[key]
      delete data[norm]
      yield* writeFile(data)
    })

    const getEntries = Effect.fn("Auth.getEntries")(function* (providerID: string) {
      return (yield* readAll())[providerID] ?? []
    })

    const addEntry = Effect.fn("Auth.addEntry")(function* (key: string, info: Info) {
      const norm = key.replace(/\/+$/, "")
      const data = yield* readFile()
      if (migrateOldFormat(data)) yield* writeFile(data)
      const existing = Array.isArray(data[norm]) ? data[norm] : []
      data[norm] = [...existing, info]
      yield* writeFile(data)
    })

    const removeEntry = Effect.fn("Auth.removeEntry")(function* (key: string, index: number) {
      const norm = key.replace(/\/+$/, "")
      const data = yield* readFile()
      if (!Array.isArray(data[norm])) {
        delete data[norm]
        yield* writeFile(data)
        return
      }
      const entries = [...data[norm]]
      if (index < 0 || index >= entries.length) return
      entries.splice(index, 1)
      if (entries.length === 0) {
        delete data[norm]
      } else {
        data[norm] = entries
      }
      yield* writeFile(data)
    })

    return Service.of({ get, all, set, remove, getEntries, addEntry, removeEntry })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(AppFileSystem.defaultLayer))

export * as Auth from "."
