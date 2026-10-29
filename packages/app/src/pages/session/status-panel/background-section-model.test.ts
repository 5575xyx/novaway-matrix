import { describe, expect, test } from "bun:test"
import { jobKind, jobKindLabelKey, type BackgroundJob } from "./background-section-model"

const job = (input: Partial<BackgroundJob> & { type: string }): BackgroundJob =>
  ({
    id: "job_1",
    title: "job",
    status: "running",
    started_at: 0,
    ...input,
  }) as BackgroundJob

describe("background job kinds", () => {
  test("maps job types to kinds", () => {
    expect(jobKind(job({ type: "task" }))).toBe("agent")
    expect(jobKind(job({ type: "shell" }))).toBe("shell")
    expect(jobKind(job({ type: "monitor" }))).toBe("monitor")
    expect(jobKind(job({ type: "subscribe" }))).toBe("subscribe")
    expect(jobKind(job({ type: "orchestrator" }))).toBe("orchestrator")
    expect(jobKind(job({ type: "something-new" }))).toBe("other")
  })

  test("only non-agent kinds get a label", () => {
    expect(jobKindLabelKey(job({ type: "task" }))).toBeUndefined()
    expect(jobKindLabelKey(job({ type: "monitor" }))).toBe("statusPanel.background.kind.monitor")
    expect(jobKindLabelKey(job({ type: "subscribe" }))).toBe("statusPanel.background.kind.subscribe")
  })
})

import { isResumed, resumeSkipped } from "./background-section-model"

describe("resumed jobs", () => {
  test("flags jobs rebuilt by the resume pass", () => {
    expect(isResumed(job({ type: "monitor", metadata: { resumed: true } } as never))).toBe(true)
    expect(isResumed(job({ type: "monitor" }))).toBe(false)
  })

  test("flags header-authenticated subscriptions that could not restart", () => {
    const skipped = job({
      type: "subscribe",
      status: "cancelled",
      metadata: { resumable: true, auth: true },
    } as never)
    expect(resumeSkipped(skipped)).toBe(true)
    // A cancelled job without auth is just a normal cancellation.
    expect(resumeSkipped(job({ type: "subscribe", status: "cancelled", metadata: { resumable: true } } as never))).toBe(
      false,
    )
  })
})
