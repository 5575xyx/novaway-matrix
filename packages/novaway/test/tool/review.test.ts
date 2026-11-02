import { afterEach, describe, expect } from "bun:test"
import { Effect, Fiber, Layer } from "effect"
import fs from "node:fs/promises"
import path from "node:path"
import { AppFileSystem } from "@novaway/core/filesystem"
import { Agent } from "@/agent/agent"
import { Service as DocumentReviewService, defaultLayer as DocumentReviewLayer } from "@/session/document-review"
import { Session } from "@/session/session"
import { MessageID, PartID, type SessionID as SessionIDType } from "@/session/schema"
import { ModelID, ProviderID } from "@/provider/schema"
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

const forkTool = (sessionID: SessionIDType, directory: string) =>
  Effect.gen(function* () {
    const info = yield* ReviewDocumentTool
    const tool = yield* info.init()
    return yield* tool.execute(doc, ctx(sessionID, directory)).pipe(Effect.forkChild)
  })

const pendingID = (sessionID: SessionIDType) =>
  Effect.gen(function* () {
    const review = yield* DocumentReviewService
    while (true) {
      yield* Effect.sleep("50 millis")
      const pending = yield* review.list(sessionID)
      if (pending.length > 0) return pending[0].id
    }
  })

const sendUserMessage = (sessionID: SessionIDType, text: string) =>
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    const info = yield* sessions.updateMessage({
      id: MessageID.ascending(),
      role: "user",
      sessionID,
      agent: "build",
      model: { providerID: ProviderID.make("test"), modelID: ModelID.make("test") },
      time: { created: Date.now() },
    })
    yield* sessions.updatePart({
      id: PartID.ascending(),
      sessionID,
      messageID: info.id,
      type: "text",
      text,
    })
  })

describe("review_document tool", () => {
  it.instance(
    "waits for approval and tells the agent to continue",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const directory = test.directory
        const sessions = yield* Session.Service
        const session = yield* sessions.create({ title: "review" })
        const review = yield* DocumentReviewService
        yield* writeDoc(directory)

        const fiber = yield* forkTool(session.id, directory)
        const id = yield* pendingID(session.id)
        const pending = (yield* review.list(session.id))[0]
        expect(pending.path).toBe("docs/PRD.md")
        expect(pending.highlights).toEqual(["6 大功能规格", "MVP 分三个阶段"])
        expect(pending.lines).toBe(4)

        expect(yield* review.reply({ id, decision: "approved" })).toBe(true)
        const result = yield* Fiber.join(fiber)
        expect(result.metadata.decision).toBe("approved")
        expect(result.output).toContain("decision: approved")
        expect(result.output).toContain("Continue with the next step")
        expect(yield* review.list(session.id)).toHaveLength(0)
      }),
    { git: true },
  )

  it.instance(
    "carries revision feedback back to the agent",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const directory = test.directory
        const sessions = yield* Session.Service
        const session = yield* sessions.create({ title: "review" })
        const review = yield* DocumentReviewService
        yield* writeDoc(directory)

        const fiber = yield* forkTool(session.id, directory)
        const id = yield* pendingID(session.id)
        yield* review.reply({ id, decision: "revise", feedback: "登录改成手机号验证码" })

        const result = yield* Fiber.join(fiber)
        expect(result.metadata.decision).toBe("revise")
        expect(result.metadata.feedback).toBe("登录改成手机号验证码")
        expect(result.output).toContain("登录改成手机号验证码")
        expect(result.output).toContain("call review_document again")
      }),
    { git: true },
  )

  it.instance(
    "a message typed in the composer becomes revision feedback",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const directory = test.directory
        const sessions = yield* Session.Service
        const session = yield* sessions.create({ title: "review" })
        const review = yield* DocumentReviewService
        yield* writeDoc(directory)

        const fiber = yield* forkTool(session.id, directory)
        yield* pendingID(session.id)
        yield* sendUserMessage(session.id, "把 MVP 拆成四个阶段")

        const result = yield* Fiber.join(fiber)
        expect(result.metadata.decision).toBe("revise")
        expect(result.metadata.feedback).toBe("把 MVP 拆成四个阶段")
        expect(yield* review.list(session.id)).toHaveLength(0)
      }),
    { git: true },
  )

  it.instance(
    "an explicit timeout leaves the review pending and tells the agent to stop",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const directory = test.directory
        const sessions = yield* Session.Service
        const session = yield* sessions.create({ title: "review" })
        const review = yield* DocumentReviewService
        const info = yield* ReviewDocumentTool
        const tool = yield* info.init()
        yield* writeDoc(directory)

        const result = yield* tool.execute({ ...doc, timeout_ms: 20 }, ctx(session.id, directory))
        expect(result.metadata.decision).toBe("pending")
        expect(result.output).toContain("The user has not reviewed the document yet")
        expect(yield* review.list(session.id)).toHaveLength(0)
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
