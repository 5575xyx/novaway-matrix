import { afterEach, describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import fs from "node:fs/promises"
import path from "node:path"
import { AppFileSystem } from "@novaway/core/filesystem"
import { Agent } from "@/agent/agent"
import {
  RequestID,
  Service as DocumentReviewService,
  defaultLayer as DocumentReviewLayer,
} from "@/session/document-review"
import { Session } from "@/session/session"
import { MessageID, type SessionID as SessionIDType } from "@/session/schema"
import { ReviewDocumentTool } from "@/tool/review"
import { Truncate } from "@/tool/truncate"
import type * as Tool from "@/tool/tool"
import { disposeAllInstances, TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(
  Layer.mergeAll(
    DocumentReviewLayer,
    Session.defaultLayer,
    Agent.defaultLayer,
    AppFileSystem.defaultLayer,
    Truncate.defaultLayer,
  ),
)

afterEach(async () => {
  await disposeAllInstances()
})

const ctx = (sessionID: SessionIDType, directory: string): Tool.Context => ({
  sessionID,
  messageID: MessageID.make("msg_review"),
  agent: "build",
  abort: new AbortController().signal,
  messages: [],
  directory,
  metadata: () => Effect.void,
  ask: () => Effect.void,
})

const doc = {
  path: "docs/PRD.md",
  kind: "prd" as const,
  title: "学伴 StudyMate PRD",
  version: "v1.0",
  summary: "面向大学生的 AI 学习助手",
  highlights: ["6 大功能规格", "MVP 分三个阶段"],
  questions: ["产品名是否确定？"],
}

const writeDoc = (directory: string) =>
  Effect.promise(async () => {
    await fs.mkdir(path.join(directory, "docs"), { recursive: true })
    await fs.writeFile(path.join(directory, "docs/PRD.md"), "# PRD\n\n第一版\n第二版\n")
  })

describe("review_document tool", () => {
  it.instance(
    "returns immediately so the turn can end while the user reviews",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const directory = test.directory
        const sessions = yield* Session.Service
        const session = yield* sessions.create({ title: "review" })
        const review = yield* DocumentReviewService
        yield* writeDoc(directory)

        const info = yield* ReviewDocumentTool
        const tool = yield* info.init()
        const result = yield* tool.execute(doc, ctx(session.id, directory))

        // 不再阻塞：工具立刻返回 pending，本轮随后结束，会话回到 idle。
        expect(result.metadata.decision).toBe("pending")
        expect(result.metadata.requestID).toBeTruthy()
        expect(result.output).toContain("awaiting_user_decision")
        expect(result.output).toContain("do not start implementing")

        const pending = yield* review.list(session.id)
        expect(pending).toHaveLength(1)
        expect(pending[0]!.path).toBe("docs/PRD.md")
        expect(pending[0]!.highlights).toEqual(["6 大功能规格", "MVP 分三个阶段"])
        expect(pending[0]!.lines).toBe(4)
        expect(pending[0]!.id as string).toBe(result.metadata.requestID as string)
      }),
    { git: true },
  )

  it.instance(
    "a later approval settles the pending request",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const directory = test.directory
        const sessions = yield* Session.Service
        const session = yield* sessions.create({ title: "review" })
        const review = yield* DocumentReviewService
        yield* writeDoc(directory)

        const info = yield* ReviewDocumentTool
        const tool = yield* info.init()
        const result = yield* tool.execute(doc, ctx(session.id, directory))
        const id = result.metadata.requestID as string

        expect(yield* review.reply({ id: RequestID.make(id), decision: "approved" })).toBe(true)
        expect(yield* review.list(session.id)).toHaveLength(0)
        // 重复回复不再生效：卡片只该结算一次。
        expect(yield* review.reply({ id: RequestID.make(id), decision: "approved" })).toBe(false)
      }),
    { git: true },
  )

  it.instance(
    "keeps the revision feedback on the settled request",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const directory = test.directory
        const sessions = yield* Session.Service
        const session = yield* sessions.create({ title: "review" })
        const review = yield* DocumentReviewService
        yield* writeDoc(directory)

        const info = yield* ReviewDocumentTool
        const tool = yield* info.init()
        const result = yield* tool.execute(doc, ctx(session.id, directory))
        const id = result.metadata.requestID as string

        expect(
          yield* review.reply({ id: RequestID.make(id), decision: "revise", feedback: "登录改成手机号验证码" }),
        ).toBe(true)
        const settled = yield* review.wait(RequestID.make(id))
        expect(settled.decision).toBe("revise")
        expect(settled.feedback).toBe("登录改成手机号验证码")
      }),
    { git: true },
  )

  it.instance(
    "fails when the document does not exist yet",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const directory = test.directory
        const sessions = yield* Session.Service
        const session = yield* sessions.create({ title: "review" })
        const info = yield* ReviewDocumentTool
        const tool = yield* info.init()
        const exit = yield* tool.execute(doc, ctx(session.id, directory)).pipe(Effect.exit)
        expect(exit._tag).toBe("Failure")
      }),
    { git: true },
  )
})
