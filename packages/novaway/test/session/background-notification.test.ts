import { describe, expect, test } from "bun:test"
import { backgroundNotification, resetBackgroundNotifications } from "../../src/session/prompt"
import type { BackgroundJob } from "../../src/background/job"

const job = (over: Partial<BackgroundJob.Info> = {}): BackgroundJob.Info => ({
  id: "job_1",
  type: "shell",
  title: "Start dev server",
  status: "completed",
  started_at: 1,
  completed_at: 2,
  metadata: { background: true, exit: 0 },
  ...over,
})

describe("backgroundNotification", () => {
  test("formats a completed command like CC's task notification", () => {
    const text = backgroundNotification(job())
    expect(text).toContain("<task-notification>")
    expect(text).toContain("<task-id>job_1</task-id>")
    expect(text).toContain("<status>completed</status>")
    expect(text).toContain('<summary>Background command "Start dev server" completed (exit code 0)</summary>')
    expect(text).not.toContain("<output-file>")
  })

  test("distinguishes failures and stopped jobs", () => {
    expect(backgroundNotification(job({ status: "error", metadata: { background: true, exit: 1 } }))).toContain(
      "failed with exit code 1",
    )
    expect(backgroundNotification(job({ status: "cancelled" }))).toContain("was stopped")
    expect(backgroundNotification(job({ status: "error" }))).toContain("<status>failed</status>")
  })

  test("includes the full-output path and escapes XML", () => {
    const text = backgroundNotification(
      job({ title: 'echo "a<b&c>"', metadata: { background: true, exit: 0, outputPath: "C:/tmp/out.txt" } }),
    )
    expect(text).toContain("<output-file>C:/tmp/out.txt</output-file>")
    expect(text).toContain("a&lt;b&amp;c&gt;")
  })

  test("reset clears the announced set", () => {
    resetBackgroundNotifications()
    resetBackgroundNotifications("ses_test")
    expect(backgroundNotification(job())).toContain("job_1")
  })
})
