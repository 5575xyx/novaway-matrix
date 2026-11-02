import { describe, expect } from "bun:test"
import { Effect, Fiber, Layer } from "effect"
import * as DocumentReviewNs from "../../src/session/document-review"
import { Bus } from "@/bus"
import { MessageID, SessionID } from "@/session/schema"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.mergeAll(DocumentReviewNs.defaultLayer, Bus.layer))

const sessionID = SessionID.make("ses_review_main")
const input = {
  sessionID,
  messageID: MessageID.make("msg_review"),
  path: "docs/products/PRD.md",
  kind: "prd" as const,
  title: "学伴 StudyMate PRD",
  version: "v1.0",
  summary: "面向大学生的 AI 学习助手",
  highlights: ["6 大功能规格", "MVP 分三个阶段"],
  questions: ["产品名是否确定？"],
  lines: 378,
}

describe("document review", () => {
  it.instance("prepare returns the pending request and list finds it", () =>
    Effect.gen(function* () {
      const review = yield* DocumentReviewNs.Service
      const info = yield* review.prepare(input)
      expect(info.path).toBe("docs/products/PRD.md")
      expect(info.highlights).toEqual(["6 大功能规格", "MVP 分三个阶段"])

      const pending = yield* review.list(sessionID)
      expect(pending.map((item) => item.id)).toEqual([info.id])
      expect(pending.at(0)?.questions).toEqual(["产品名是否确定？"])
    }),
  )

  it.instance("wait blocks until the user approves", () =>
    Effect.gen(function* () {
      const review = yield* DocumentReviewNs.Service
      const info = yield* review.prepare(input)
      const fiber = yield* review.wait(info.id).pipe(Effect.forkChild)

      expect(yield* review.reply({ id: info.id, decision: "approved" })).toBe(true)
      const decision = yield* Fiber.join(fiber)
      expect(decision.decision).toBe("approved")
      expect(yield* review.list(sessionID)).toHaveLength(0)
    }),
  )

  it.instance("revision carries the user's feedback", () =>
    Effect.gen(function* () {
      const review = yield* DocumentReviewNs.Service
      const info = yield* review.prepare(input)
      const fiber = yield* review.wait(info.id).pipe(Effect.forkChild)
      yield* review.reply({ id: info.id, decision: "revise", feedback: "登录改成手机号验证码" })
      const decision = yield* Fiber.join(fiber)
      expect(decision.decision).toBe("revise")
      expect(decision.feedback).toBe("登录改成手机号验证码")
    }),
  )

  it.instance("unknown ids and double replies are ignored", () =>
    Effect.gen(function* () {
      const review = yield* DocumentReviewNs.Service
      expect(yield* review.reply({ id: "review_nope" as never, decision: "approved" })).toBe(false)

      const info = yield* review.prepare(input)
      expect(yield* review.reply({ id: info.id, decision: "approved" })).toBe(true)
      expect(yield* review.reply({ id: info.id, decision: "revise" })).toBe(false)
    }),
  )

  it.instance("clear cancels only the given session", () =>
    Effect.gen(function* () {
      const review = yield* DocumentReviewNs.Service
      const mine = yield* review.prepare(input)
      const other = yield* review.prepare({ ...input, sessionID: SessionID.make("ses_other") })
      const fiber = yield* review.wait(mine.id).pipe(Effect.forkChild)

      yield* review.clear(sessionID)
      const decision = yield* Fiber.join(fiber)
      expect(decision.decision).toBe("cancelled")
      expect((yield* review.list()).map((item) => item.id)).toEqual([other.id])
    }),
  )

  it.instance("wait on an already-cleared request resolves as cancelled", () =>
    Effect.gen(function* () {
      const review = yield* DocumentReviewNs.Service
      const info = yield* review.prepare(input)
      yield* review.clear(sessionID)
      expect((yield* review.wait(info.id)).decision).toBe("cancelled")
    }),
  )
})
