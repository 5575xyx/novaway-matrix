import { Effect, Layer, Context, Schema } from "effect"
import { Bus } from "../bus"
import { Snapshot } from "../snapshot"
import { Storage } from "@/storage/storage"
import { SyncEvent } from "../sync"
import * as Log from "@opencode-ai/core/util/log"
import * as Session from "./session"
import { MessageV2 } from "./message-v2"
import { SessionID, MessageID, PartID } from "./schema"
import { SessionRunState } from "./run-state"
import { SessionSummary } from "./summary"

const log = Log.create({ service: "session.revert" })

const normalize = (file: string) => file.replaceAll("\\", "/")

const addPlannedFile = (files: Map<string, string>, file: string, snapshot: string) => {
  const normalized = normalize(file)
  if (files.has(normalized)) return
  files.set(normalized, snapshot)
}

const toPatches = (files: ReadonlyMap<string, string>) => {
  const groups = new Map<string, string[]>()
  for (const [file, hash] of files) {
    const group = groups.get(hash)
    if (group) {
      group.push(file)
      continue
    }
    groups.set(hash, [file])
  }
  return Array.from(groups.entries()).map(([hash, files]) => ({ hash, files }) satisfies Snapshot.Patch)
}

export const RevertInput = Schema.Struct({
  sessionID: SessionID,
  messageID: MessageID,
  partID: Schema.optional(PartID),
})
export type RevertInput = Schema.Schema.Type<typeof RevertInput>

export interface Interface {
  readonly revert: (input: RevertInput) => Effect.Effect<Session.Info, Session.BusyError>
  readonly unrevert: (input: { sessionID: SessionID }) => Effect.Effect<Session.Info, Session.BusyError>
  readonly cleanup: (session: Session.Info) => Effect.Effect<void>
  readonly plan: (input: { sessionID: SessionID; messageID: MessageID }) => Effect.Effect<Map<string, string>>
  readonly preview: (input: { sessionID: SessionID; messageID: MessageID }) => Effect.Effect<Snapshot.FileDiff[]>
  readonly stage: (input: {
    session: Session.Info
    messageID: MessageID
    files?: boolean
  }) => Effect.Effect<Session.Info["revert"]>
  readonly commit: (session: Session.Info) => Effect.Effect<void>
  readonly clear: (session: Session.Info) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionRevert") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    const snap = yield* Snapshot.Service
    const storage = yield* Storage.Service
    const bus = yield* Bus.Service
    const summary = yield* SessionSummary.Service
    const state = yield* SessionRunState.Service
    const sync = yield* SyncEvent.Service

    const plan = Effect.fn("SessionRevert.plan")(function* (input: { sessionID: SessionID; messageID: MessageID }) {
      const all = yield* sessions.messages({ sessionID: input.sessionID }).pipe(Effect.orDie)
      const files = new Map<string, string>()
      for (const msg of all) {
        if (msg.info.id >= input.messageID && msg.info.role === "assistant") {
          const patches = msg.parts.filter((part): part is MessageV2.PatchPart => part.type === "patch")
          let addedFromSteps = false
          let stepStart: string | undefined
          for (const part of msg.parts) {
            if (part.type === "step-start") {
              stepStart = part.snapshot
            }
            if (part.type === "step-finish" && stepStart && part.snapshot) {
              const changed = yield* snap
                .files({ from: Snapshot.ID.make(stepStart), to: Snapshot.ID.make(part.snapshot) })
                .pipe(Effect.orElseSucceed((): readonly string[] => []))
              for (const file of changed) {
                addPlannedFile(files, file, stepStart)
              }
              if (changed.length > 0) addedFromSteps = true
              stepStart = undefined
            }
          }
          if (addedFromSteps) continue
          for (const part of patches) {
            for (const file of part.files) {
              addPlannedFile(files, file, part.hash)
            }
          }
        }
      }
      return files
    })

    const preview = Effect.fn("SessionRevert.preview")(function* (input: {
      sessionID: SessionID
      messageID: MessageID
    }) {
      const files = yield* plan(input)
      return Array.from(files.keys()).map((file) => ({
        file,
        patch: "",
        additions: 0,
        deletions: 0,
      }))
    })

    const stage = Effect.fn("SessionRevert.stage")(function* (input: {
      session: Session.Info
      messageID: MessageID
      files?: boolean
    }) {
      const original = input.session.revert?.snapshot ? input.session.revert.snapshot : yield* snap.track()
      const next = yield* plan({ sessionID: input.session.id, messageID: input.messageID })
      const restore = new Map<string, string>()
      if (original) {
        for (const file of input.session.revert?.files ?? []) {
          if (file.file) {
            restore.set(file.file, original)
          }
        }
      }
      if (input.files !== false) {
        for (const [file, tree] of next) {
          restore.set(file, tree)
        }
      }
      if (restore.size > 0) {
        yield* snap.revert(toPatches(restore)).pipe(Effect.orDie)
      }
      const paths = input.files === false ? [] : Array.from(next.keys())
      const current = yield* snap.capture()
      const diffs =
        original && current
          ? yield* snap.diff({ from: Snapshot.ID.make(original), to: current, paths }).pipe(Effect.orDie)
          : []
      const files = [...diffs] as Snapshot.FileDiff[]
      const revert = {
        messageID: input.messageID,
        snapshot: original,
        diff: files
          .map((file) => file.patch)
          .join("")
          .trim(),
        files,
      } satisfies Session.Info["revert"]
      yield* sessions.setRevert({
        sessionID: input.session.id,
        revert,
        summary: {
          additions: diffs.reduce((sum, x) => sum + x.additions, 0),
          deletions: diffs.reduce((sum, x) => sum + x.deletions, 0),
          files: diffs.length,
        },
      })
      return revert
    })

    const clear = Effect.fn("SessionRevert.clear")(function* (session: Session.Info) {
      if (!session.revert) return
      const original = session.revert.snapshot
      if (original) {
        yield* snap.checkout(original).pipe(Effect.orDie)
      }
      yield* sessions.clearRevert(session.id)
    })

    const commit = Effect.fn("SessionRevert.commit")(function* (session: Session.Info) {
      if (!session.revert) return
      const sessionID = session.id
      const messageID = session.revert.messageID
      const msgs = yield* sessions.messages({ sessionID }).pipe(Effect.orDie)
      const remove = [] as MessageV2.WithParts[]
      let target: MessageV2.WithParts | undefined
      for (const msg of msgs) {
        if (msg.info.id < messageID) continue
        if (msg.info.id > messageID) {
          remove.push(msg)
          continue
        }
        if (session.revert.partID) {
          target = msg
          continue
        }
        remove.push(msg)
      }
      for (const msg of remove) {
        yield* sync.run(MessageV2.Event.Removed, {
          sessionID,
          messageID: msg.info.id,
        })
      }
      if (session.revert.partID && target) {
        const partID = session.revert.partID
        const idx = target.parts.findIndex((part) => part.id === partID)
        if (idx >= 0) {
          const removeParts = target.parts.slice(idx)
          target.parts = target.parts.slice(0, idx)
          for (const part of removeParts) {
            yield* sync.run(MessageV2.Event.PartRemoved, {
              sessionID,
              messageID: target.info.id,
              partID: part.id,
            })
          }
        }
      }
      yield* sessions.clearRevert(sessionID)
    })

    const revert = Effect.fn("SessionRevert.revert")(function* (input: RevertInput) {
      yield* state.assertNotBusy(input.sessionID)
      const session = yield* sessions.get(input.sessionID).pipe(Effect.orDie)
      yield* stage({ session, messageID: input.messageID })
      const staged = yield* sessions.get(input.sessionID).pipe(Effect.orDie)
      yield* commit(staged)
      return yield* sessions.get(input.sessionID).pipe(Effect.orDie)
    })

    const unrevert = Effect.fn("SessionRevert.unrevert")(function* (input: { sessionID: SessionID }) {
      log.info("unreverting", input)
      yield* state.assertNotBusy(input.sessionID)
      const session = yield* sessions.get(input.sessionID).pipe(Effect.orDie)
      if (!session.revert) return session
      if (session.revert.snapshot) {
        yield* snap.checkout(session.revert.snapshot).pipe(Effect.orDie)
      }
      yield* sessions.clearRevert(input.sessionID)
      return yield* sessions.get(input.sessionID).pipe(Effect.orDie)
    })

    const cleanup = Effect.fn("SessionRevert.cleanup")(function* (session: Session.Info) {
      if (!session.revert) return
      yield* commit(session)
    })

    return Service.of({ revert, unrevert, cleanup, plan, preview, stage, commit, clear })
  }),
)

export const defaultLayer = Layer.suspend(() =>
  layer.pipe(
    Layer.provide(SessionRunState.defaultLayer),
    Layer.provide(Session.defaultLayer),
    Layer.provide(Snapshot.defaultLayer),
    Layer.provide(Storage.defaultLayer),
    Layer.provide(Bus.layer),
    Layer.provide(SessionSummary.defaultLayer),
    Layer.provide(SyncEvent.defaultLayer),
  ),
)

export * as SessionRevert from "./revert"
