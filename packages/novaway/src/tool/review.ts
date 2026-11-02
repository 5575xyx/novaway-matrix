import { Effect, Schema } from "effect"
import * as path from "path"
import { AppFileSystem } from "@novaway/core/filesystem"
import { DocumentReview } from "@/session/document-review"
import { MessageV2 } from "@/session/message-v2"
import { InstanceState } from "@/effect/instance-state"
import { Session } from "@/session/session"
import type { SessionID } from "@/session/schema"
import * as Tool from "./tool"

const Parameters = Schema.Struct({
  path: Schema.String.annotate({
    description: "工作区内的文档路径（相对路径或绝对路径）。用户点「开始评审」时会打开这个文件。",
  }),
  kind: DocumentReview.Kind.annotate({
    description: "文档类型：prd / plan / spec / design / report / other。决定卡片上的标签。",
  }),
  title: Schema.String.annotate({ description: "文档标题，显示在评审卡片上。" }),
  version: Schema.optional(Schema.String).annotate({ description: "版本号，例如 v1.0。" }),
  summary: Schema.optional(Schema.String).annotate({
    description: "一两句话说明这份文档要解决什么、包含哪些部分。显示在卡片正文。",
  }),
  highlights: Schema.optional(Schema.mutable(Schema.Array(Schema.String))).annotate({
    description: "3-8 条要点（覆盖范围、关键决策），卡片上以列表展示。",
  }),
  questions: Schema.optional(Schema.mutable(Schema.Array(Schema.String))).annotate({
    description: "需要用户拍板的待确认项。用户评审通过即代表接受这些默认值。",
  }),
  timeout_ms: Schema.optional(Schema.Number).annotate({
    description: "可选的等待上限（毫秒）。不传就一直等用户拍板，和计划审批一致。",
  }),
})

type Metadata = {
  requestID?: string
  path?: string
  kind?: string
  title?: string
  version?: string
  summary?: string
  highlights?: string[]
  questions?: string[]
  lines?: number
  decision?: DocumentReview.Outcome
  feedback?: string
  waitedMs?: number
}

const POLL_INTERVAL_MS = 1000

const text = (part: MessageV2.Part) => (part.type === "text" && part.synthetic !== true ? part.text.trim() : "")

/**
 * 写文档 → 用户评审 → 继续/修改。
 *
 * 主代理把 PRD、实施计划这类需要用户拍板的文档挂在这里：卡片上三个动作
 * （开始评审 / 评审通过 / 需要调整）都是点击即生效，不需要用户再回聊天框
 * 说一句「可以」。返回的文本直接告诉模型下一步做什么。
 */
export const ReviewDocumentTool = Tool.define<
  typeof Parameters,
  Metadata,
  DocumentReview.Service | Session.Service | AppFileSystem.Service
>(
  "review_document",
  Effect.gen(function* () {
    const review = yield* DocumentReview.Service
    const sessions = yield* Session.Service
    const fs = yield* AppFileSystem.Service

    /**
     * 用户在聊天框里直接发消息（而不是点按钮）时，把那条消息当成调整意见。
     * 这比让代理干等到超时更符合直觉：用户说什么，就按什么改。
     */
    const watchUserMessage = (sessionID: SessionID, since: string) =>
      Effect.gen(function* () {
        while (true) {
          yield* Effect.sleep(`${POLL_INTERVAL_MS} millis`)
          const messages = yield* sessions
            .messages({ sessionID })
            .pipe(Effect.catchCause(() => Effect.succeed([] as MessageV2.WithParts[])))
          const found = messages.find(
            (message) =>
              message.info.role === "user" &&
              message.info.id > since &&
              message.parts.some((part) => text(part).length > 0),
          )
          if (!found) continue
          return found.parts.map(text).filter(Boolean).join("\n").trim()
        }
      })

    return {
      description: [
        "Submit a document (PRD, implementation plan, spec, design) for the user's review and wait for the decision.",
        "Renders an interactive card with three actions: open the document, approve it, or request changes with free-form feedback.",
        "Returns `decision: approved` (continue with the next step), `decision: revise` (apply the feedback, then submit again),",
        "`decision: pending` (the user has not answered in time — stop and wait for their message), or `decision: cancelled`.",
        "Use it whenever a deliverable needs sign-off before you spend more effort on it. Do not also ask for approval in chat.",
      ].join(" "),
      parameters: Parameters,
      execute: (params, ctx) =>
        Effect.gen(function* () {
          const instance = yield* InstanceState.context
          const target = path.isAbsolute(params.path)
            ? params.path
            : path.resolve(ctx.directory ?? instance.directory, params.path)
          const relative =
            path
              .relative(instance.worktree === "/" ? instance.directory : instance.worktree, target)
              .split(path.sep)
              .join("/") || params.path
          const content = yield* fs.readFileStringSafe(target)
          if (!content) {
            return yield* Effect.fail(
              new Error(`Document not found: ${params.path}. Write the document first, then submit it for review.`),
            )
          }
          const lines = content.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n").length
          const timeoutMs = params.timeout_ms && params.timeout_ms > 0 ? params.timeout_ms : undefined
          const startedAt = Date.now()

          yield* ctx.metadata({
            title: `待评审：${params.title}`,
            metadata: {
              path: relative,
              kind: params.kind,
              title: params.title,
              version: params.version,
              summary: params.summary,
              highlights: [...(params.highlights ?? [])],
              questions: [...(params.questions ?? [])],
              lines,
              decision: undefined,
            },
          })

          const incoming = yield* sessions.messages({ sessionID: ctx.sessionID }).pipe(Effect.orDie)
          const since = incoming.at(-1)?.info.id ?? ""
          const info = yield* review.prepare({
            sessionID: ctx.sessionID,
            messageID: ctx.messageID,
            path: relative,
            kind: params.kind,
            title: params.title,
            version: params.version,
            summary: params.summary,
            highlights: params.highlights ?? [],
            questions: params.questions ?? [],
            lines,
          })
          const requestID = info.id as string
          // The card's request id has to reach the UI while the tool is still
          // running, otherwise its buttons have nothing to reply to.
          yield* ctx.metadata({
            title: `待评审：${params.title}`,
            metadata: {
              requestID,
              path: relative,
              kind: params.kind,
              title: params.title,
              version: params.version,
              summary: params.summary,
              highlights: [...(params.highlights ?? [])],
              questions: [...(params.questions ?? [])],
              lines,
            },
          })

          const waiting = review.wait(info.id).pipe(
            Effect.raceFirst(
              watchUserMessage(ctx.sessionID, since).pipe(
                Effect.map((message): DocumentReview.Decision => ({ decision: "revise", feedback: message })),
              ),
            ),
            Effect.onInterrupt(() => review.reply({ id: info.id, decision: "cancelled" })),
          )
          const decision = yield* timeoutMs
            ? waiting.pipe(
                Effect.raceFirst(
                  Effect.sleep(`${timeoutMs} millis`).pipe(
                    Effect.as({ decision: "pending" } as DocumentReview.Decision),
                  ),
                ),
              )
            : waiting
          // Whatever path won, the entry must not linger: the UI would keep
          // showing buttons for a request nobody is waiting on anymore.
          yield* review.reply({
            id: info.id,
            decision: decision.decision,
            ...(decision.feedback ? { feedback: decision.feedback } : {}),
          })

          const waitedMs = Date.now() - startedAt
          const metadata: Metadata = {
            requestID,
            path: relative,
            kind: params.kind,
            title: params.title,
            version: params.version,
            summary: params.summary,
            highlights: [...(params.highlights ?? [])],
            questions: [...(params.questions ?? [])],
            lines,
            decision: decision.decision,
            feedback: decision.feedback,
            waitedMs,
          }

          const header = [
            `document: ${relative} (${lines} lines${params.version ? `, ${params.version}` : ""})`,
            `decision: ${decision.decision}`,
            ...(decision.feedback ? ["", "feedback from the user:", decision.feedback] : []),
            "",
          ]
          const body =
            decision.decision === "approved"
              ? [
                  "The user approved this document. Continue with the next step now (for a plan: start implementing; for a PRD: move on to the plan or implementation the user asked for).",
                ]
              : decision.decision === "revise"
                ? [
                    "The user asked for changes. Edit the document to address every point above, keep the rest intact, then call review_document again with the updated summary and a bumped version. Do not implement anything yet.",
                  ]
                : decision.decision === "pending"
                  ? [
                      "The user has not reviewed the document yet. Stop here: do not start implementing and do not restate the document in chat. Wait for the user's next message; if they give feedback, apply it and submit the document for review again.",
                    ]
                  : [
                      "Review was cancelled (session closed or the user stopped the turn). Do not start implementing and do not re-submit on your own; wait for the user.",
                    ]

          return {
            title:
              decision.decision === "approved"
                ? `已通过评审：${params.title}`
                : decision.decision === "revise"
                  ? `需要调整：${params.title}`
                  : `等待评审：${params.title}`,
            metadata,
            output: [...header, ...body].join("\n"),
          }
        }).pipe(Effect.orDie),
    }
  }),
)
