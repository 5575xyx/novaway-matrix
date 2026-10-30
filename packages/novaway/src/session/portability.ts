import { InstanceRef } from "@/effect/instance-ref"
import { MessageV2 } from "@/session/message-v2"
import { Session } from "@/session/session"
import { SessionID } from "@/session/schema"
import { MessageTable, PartTable, SessionTable } from "@/session/session.sql"
import { Database } from "@/storage/db"
import { NotFoundError } from "@/storage/storage"
import { Context, Effect, Layer, Schema, Types } from "effect"

/** A portable snapshot of one session: its info plus every message with parts. */
export const Bundle = Schema.Struct({
  info: Session.Info,
  messages: Schema.Array(MessageV2.WithParts),
}).annotate({ identifier: "SessionExport" })
export type Bundle = Schema.Schema.Type<typeof Bundle>

const decodeMessage = Schema.decodeUnknownSync(MessageV2.Info)
const decodePart = Schema.decodeUnknownSync(MessageV2.Part)

function redact(kind: string, id: string, value: string) {
  return value.trim() ? `[redacted:${kind}:${id}]` : value
}

function data(kind: string, id: string, value: Record<string, unknown> | undefined) {
  if (!value) return value
  return Object.keys(value).length ? { redacted: `${kind}:${id}` } : value
}

function span(id: string, value: { value: string; start: number; end: number }) {
  return {
    ...value,
    value: redact("file-text", id, value.value),
  }
}

function diff(kind: string, diffs: { file?: string; patch?: string }[] | undefined) {
  return diffs?.map((item, i) => ({
    ...item,
    file: item.file === undefined ? undefined : redact(`${kind}-file`, String(i), item.file),
    patch: item.patch === undefined ? undefined : redact(`${kind}-patch`, String(i), item.patch),
  }))
}

function source(part: MessageV2.FilePart) {
  if (!part.source) return part.source
  if (part.source.type === "symbol") {
    return {
      ...part.source,
      path: redact("file-path", part.id, part.source.path),
      name: redact("file-symbol", part.id, part.source.name),
      text: span(part.id, part.source.text),
    }
  }
  if (part.source.type === "resource") {
    return {
      ...part.source,
      clientName: redact("file-client", part.id, part.source.clientName),
      uri: redact("file-uri", part.id, part.source.uri),
      text: span(part.id, part.source.text),
    }
  }
  return {
    ...part.source,
    path: redact("file-path", part.id, part.source.path),
    text: span(part.id, part.source.text),
  }
}

function filepart(part: MessageV2.FilePart): MessageV2.FilePart {
  return {
    ...part,
    url: redact("file-url", part.id, part.url),
    filename: part.filename === undefined ? undefined : redact("file-name", part.id, part.filename),
    source: source(part),
  }
}

function part(part: MessageV2.Part): MessageV2.Part {
  switch (part.type) {
    case "text":
      return {
        ...part,
        text: redact("text", part.id, part.text),
        metadata: data("text-metadata", part.id, part.metadata),
      }
    case "reasoning":
      return {
        ...part,
        text: redact("reasoning", part.id, part.text),
        metadata: data("reasoning-metadata", part.id, part.metadata),
      }
    case "file":
      return filepart(part)
    case "subtask":
      return {
        ...part,
        prompt: redact("subtask-prompt", part.id, part.prompt),
        description: redact("subtask-description", part.id, part.description),
        command: part.command === undefined ? undefined : redact("subtask-command", part.id, part.command),
      }
    case "tool":
      return {
        ...part,
        metadata: data("tool-metadata", part.id, part.metadata),
        state:
          part.state.status === "pending"
            ? {
                ...part.state,
                input: data("tool-input", part.id, part.state.input) ?? part.state.input,
                raw: redact("tool-raw", part.id, part.state.raw),
              }
            : part.state.status === "running"
              ? {
                  ...part.state,
                  input: data("tool-input", part.id, part.state.input) ?? part.state.input,
                  title: part.state.title === undefined ? undefined : redact("tool-title", part.id, part.state.title),
                  metadata: data("tool-state-metadata", part.id, part.state.metadata),
                }
              : part.state.status === "completed"
                ? {
                    ...part.state,
                    input: data("tool-input", part.id, part.state.input) ?? part.state.input,
                    output: redact("tool-output", part.id, part.state.output),
                    title: redact("tool-title", part.id, part.state.title),
                    metadata: data("tool-state-metadata", part.id, part.state.metadata) ?? part.state.metadata,
                    attachments: part.state.attachments?.map(filepart),
                  }
                : {
                    ...part.state,
                    input: data("tool-input", part.id, part.state.input) ?? part.state.input,
                    metadata: data("tool-state-metadata", part.id, part.state.metadata),
                  },
      }
    case "patch":
      return {
        ...part,
        hash: redact("patch", part.id, part.hash),
        files: part.files.map((item: string, i: number) => redact("patch-file", `${part.id}-${i}`, item)),
      }
    case "snapshot":
      return {
        ...part,
        snapshot: redact("snapshot", part.id, part.snapshot),
      }
    case "step-start":
      return {
        ...part,
        snapshot: part.snapshot === undefined ? undefined : redact("snapshot", part.id, part.snapshot),
      }
    case "step-finish":
      return {
        ...part,
        snapshot: part.snapshot === undefined ? undefined : redact("snapshot", part.id, part.snapshot),
      }
    case "agent":
      return {
        ...part,
        source: !part.source
          ? part.source
          : {
              ...part.source,
              value: redact("agent-source", part.id, part.source.value),
            },
      }
    default:
      return part
  }
}

function redactBundle(data: { info: Session.Info; messages: MessageV2.WithParts[] }) {
  return {
    info: {
      ...data.info,
      title: redact("session-title", data.info.id, data.info.title),
      directory: redact("session-directory", data.info.id, data.info.directory),
      summary: !data.info.summary
        ? data.info.summary
        : {
            ...data.info.summary,
            diffs: diff("session-diff", data.info.summary.diffs),
          },
      revert: !data.info.revert
        ? data.info.revert
        : {
            ...data.info.revert,
            snapshot:
              data.info.revert.snapshot === undefined
                ? undefined
                : redact("revert-snapshot", data.info.id, data.info.revert.snapshot),
            diff:
              data.info.revert.diff === undefined
                ? undefined
                : redact("revert-diff", data.info.id, data.info.revert.diff),
          },
    },
    messages: data.messages.map((msg) => ({
      info:
        msg.info.role === "user"
          ? {
              ...msg.info,
              system: msg.info.system === undefined ? undefined : redact("system", msg.info.id, msg.info.system),
              summary: !msg.info.summary
                ? msg.info.summary
                : {
                    ...msg.info.summary,
                    title:
                      msg.info.summary.title === undefined
                        ? undefined
                        : redact("summary-title", msg.info.id, msg.info.summary.title),
                    body:
                      msg.info.summary.body === undefined
                        ? undefined
                        : redact("summary-body", msg.info.id, msg.info.summary.body),
                    diffs: diff("message-diff", msg.info.summary.diffs),
                  },
            }
          : {
              ...msg.info,
              path: {
                cwd: redact("cwd", msg.info.id, msg.info.path.cwd),
                root: redact("root", msg.info.id, msg.info.path.root),
              },
            },
      parts: msg.parts.map(part),
    })),
  }
}

/**
 * Strip user-authored text and on-disk paths from a bundle so it can be
 * attached to a bug report. Structure and ids survive; contents do not.
 */
export function sanitize(bundle: Bundle): Bundle {
  // The redaction helpers walk the same shapes but return structurally
  // equivalent objects; the cast keeps them from constraining every branch.
  return redactBundle(bundle as { info: Session.Info; messages: MessageV2.WithParts[] }) as unknown as Bundle
}

export interface Interface {
  /** Full session snapshot, optionally redacted for sharing. */
  readonly export: (input: { sessionID: SessionID; redact?: boolean }) => Effect.Effect<Bundle, NotFoundError>
  /**
   * Insert a bundle with `onConflictDoNothing` semantics: an existing session
   * id is re-pointed at this project, and messages/parts that already exist are
   * left alone. Returns the stored session info.
   */
  readonly import: (bundle: Bundle) => Effect.Effect<Bundle["info"]>
}

export class Service extends Context.Service<Service, Interface>()("@NovaWay/SessionPortability") {}

export const layer: Layer.Layer<Service, never, Session.Service> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const sessions = yield* Session.Service

    const exportSession = Effect.fn("SessionPortability.export")(function* (input: {
      sessionID: SessionID
      redact?: boolean
    }) {
      const info = yield* sessions.get(input.sessionID)
      const messages = yield* sessions.messages({ sessionID: input.sessionID })
      const bundle = { info, messages } as Bundle
      return input.redact ? sanitize(bundle) : bundle
    })

    const importBundle = Effect.fn("SessionPortability.import")(function* (bundle: Bundle) {
      const ctx = yield* InstanceRef
      const projectID = ctx?.project.id
      const info = Schema.decodeUnknownSync(Session.Info)({
        ...bundle.info,
        ...(projectID ? { projectID } : {}),
      }) as Session.Info
      const row = Session.toRow(info)
      Database.use((db) =>
        db
          .insert(SessionTable)
          .values(row)
          .onConflictDoUpdate({ target: SessionTable.id, set: { project_id: row.project_id } })
          .run(),
      )

      for (const message of bundle.messages) {
        const messageInfo = decodeMessage(message.info) as MessageV2.Info
        const { id, sessionID: _session, ...rest } = messageInfo
        Database.use((db) =>
          db
            .insert(MessageTable)
            .values({
              id,
              session_id: row.id,
              time_created: messageInfo.time?.created ?? Date.now(),
              data: rest,
            })
            .onConflictDoNothing()
            .run(),
        )

        for (const item of message.parts) {
          const partInfo = decodePart(item) as MessageV2.Part
          const { id: partID, sessionID: _partSession, messageID, ...partRest } = partInfo
          Database.use((db) =>
            db
              .insert(PartTable)
              .values({ id: partID, message_id: messageID, session_id: row.id, data: partRest })
              .onConflictDoNothing()
              .run(),
          )
        }
      }

      return info
    })

    return Service.of({ export: exportSession, import: importBundle })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(Session.defaultLayer))

export * as SessionPortability from "./portability"
