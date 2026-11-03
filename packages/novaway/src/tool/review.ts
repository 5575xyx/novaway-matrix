import { Effect, Option, Schema } from "effect"
import * as path from "path"
import { AppFileSystem } from "@novaway/core/filesystem"
import { DocumentReview } from "@/session/document-review"
import { Session } from "@/session/session"
import { InstanceState } from "@/effect/instance-state"
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

/**
 * 写文档 → 用户评审 → 继续/修改。
 *
 * 主代理把 PRD、实施计划这类需要用户拍板的文档挂在这里：卡片上三个动作
 * （开始评审 / 评审通过 / 需要调整）都是点击即生效。
 *
 * **这个工具不阻塞**：登记完评审请求就立刻返回，本轮到此结束、会话回到 idle ——
 * 以前它会在工具里一直等用户拍板，整个任务被卡在"运行中"，既不能发下一条消息，
 * 计时器也一直在涨。现在用户点「评审通过」/「需要调整」时，界面会把结论作为一条
 * 普通用户消息发回来（见 review-shared 的 sendReviewAsMessage），代理从那条消息
 * 继续，等于"评审完自动续上上一轮"。
 */
export const ReviewDocumentTool = Tool.define<
  typeof Parameters,
  Metadata,
  DocumentReview.Service | AppFileSystem.Service
>(
  "review_document",
  Effect.gen(function* () {
    const review = yield* DocumentReview.Service
    const fs = yield* AppFileSystem.Service
    // 会话服务可选：最小 layer 里没有它时按"不知道档位"处理（照常交给用户评审）。
    const sessions = Option.getOrUndefined(yield* Effect.serviceOption(Session.Service))

    return {
      description: [
        "Submit a document (PRD, implementation plan, spec, design) for the user's review.",
        "Renders an interactive card with three actions: open the document, approve it, or request changes with free-form feedback.",
        "This tool returns immediately: the turn ends right here and the session goes idle while the user reviews.",
        "When they decide, you receive a new user message with their decision (approved / changes requested). Continue from that message.",
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
          const startedAt = Date.now()

          // 无人值守：没有人会来点「评审通过」。把文档当成已签收，直接让模型
          // 往下走 —— 否则这一轮会停在"待评审"，整个任务就断在这里。
          if ((sessions ? yield* sessions.permissionModeOf(ctx.sessionID) : undefined) === "unattended") {
            const decision: Metadata = {
              path: relative,
              kind: params.kind,
              title: params.title,
              version: params.version,
              summary: params.summary,
              highlights: [...(params.highlights ?? [])],
              questions: [...(params.questions ?? [])],
              lines,
              decision: "approved",
              waitedMs: 0,
            }
            return {
              title: `Approved: ${params.title}`,
              metadata: decision,
              output: [
                `document: ${relative} (${lines} lines${params.version ? `, ${params.version}` : ""})`,
                "status: auto_approved (unattended mode)",
                "",
                "Nobody is reviewing this document, so it counts as approved. Continue with the next step now:",
                "- for a plan: start implementing it;",
                "- for a PRD/spec: move on to the plan or implementation the user asked for.",
                "Do not call review_document again for the same version.",
              ].join("\n"),
            }
          }

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
          // 卡片按钮靠这个 id 回复服务端；即使本轮已经结束，请求条目也保留着，
          // 用户点按钮时 reply 仍然能结算（前端随后再发消息续上任务）。
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
              decision: "pending",
              waitedMs: Date.now() - startedAt,
            },
          })

          return {
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
              decision: "pending",
              waitedMs: Date.now() - startedAt,
            } satisfies Metadata,
            output: [
              `document: ${relative} (${lines} lines${params.version ? `, ${params.version}` : ""})`,
              "status: awaiting_user_decision",
              "",
              "The document has been handed to the user for review and this turn ends now. Stop here:",
              "do not start implementing, do not restate the document in chat, and do not ask for approval again.",
              "When the user decides, their decision arrives as a new user message:",
              "- approved → continue with the next step (for a plan: start implementing; for a PRD: move on to the plan or implementation the user asked for);",
              "- changes requested → apply every point to the document, keep the rest intact, then call review_document again with an updated summary and a bumped version.",
            ].join("\n"),
          }
        }).pipe(Effect.orDie),
    }
  }),
)
