import { describe, expect, it } from "bun:test"
import { Effect, Layer } from "effect"
import { sanitizeEvidence, sanitizeOptional } from "@/team/evidence"
import { Service as RunService, defaultLayer as RunLayer } from "@/team/run"
import { Service as VerificationService, defaultLayer as VerificationLayer } from "@/team/verification"
import { SessionID } from "@/session/schema"
import { testEffect } from "../lib/effect"

const itEffect = testEffect(Layer.mergeAll(RunLayer, VerificationLayer))

describe("evidence redaction", () => {
  it("keeps protocol + host + path and masks every query value", () => {
    const text = sanitizeEvidence("GET https://ci.example.com/job/42?a=1&signature=s3cr3t 返回 200")
    expect(text).toContain("https://ci.example.com/job/42")
    // 不猜哪个参数敏感：签名参数的名字永远列不全，所以查询串一律打码。
    expect(text).not.toContain("s3cr3t")
    expect(text).not.toContain("a=1")
    expect(text).toContain("返回 200")
  })

  it("masks credentials, headers and assignments", () => {
    const url = sanitizeEvidence("https://user:pw@example.com/x")
    expect(url).toContain("example.com/x")
    expect(url).not.toContain("pw@")
    expect(sanitizeEvidence("Authorization: Bearer abc.def.ghi")).toBe("Authorization=***REDACTED***")
    expect(sanitizeEvidence("password=hunter2")).toBe("password=***REDACTED***")
    expect(sanitizeEvidence("src/auth/login.ts:42")).toBe("src/auth/login.ts:42")
  })

  it("leaves an absent value absent instead of turning it into an empty string", () => {
    expect(sanitizeOptional(undefined)).toBeUndefined()
    expect(sanitizeOptional("")).toBe("")
  })

  itEffect.effect("the verifier's text is masked before it is stored or shown", () =>
    Effect.gen(function* () {
      const runs = yield* RunService
      const verification = yield* VerificationService
      const run = yield* runs.create({
        sessionID: SessionID.make("ses_evidence"),
        directory: "/tmp/run",
        mode: "team",
        goal: "证据脱敏",
      })
      yield* verification.register({ runID: run.id, specID: "e1", text: "能复现", kind: "diff" })
      const [acceptance] = yield* verification.list(run.id)
      yield* verification.record({
        acceptanceID: acceptance.id,
        snapshotID: "snap_1",
        verifierVersion: "agent-v1",
        outcome: "pass",
        // 模型很可能会把命令与带凭据的 URL 原样写进证据里。
        measured:
          "curl -H 'Authorization: Bearer sk-live-123456789012345678901234' https://ci.example.com/job?access_token=abcd",
        evidenceRef: "https://ci.example.com/job/42?signature=s3cr3t",
      })

      const [stored] = yield* verification.verifications(run.id)
      // 原始秘密永不落库：读回来的就已经是打码后的文本。
      expect(stored.measured).not.toContain("sk-live")
      expect(stored.measured).not.toContain("abcd")
      expect(stored.evidenceRef).not.toContain("s3cr3t")
      expect(stored.measured).toContain("***REDACTED***")
      expect(stored.evidenceRef).toContain("https://ci.example.com/job/42")
      // 结构字段不受影响：结论与快照才是判定依据。
      expect(stored.outcome).toBe("pass")
      expect(stored.snapshotID).toBe("snap_1")
    }),
  )
})

