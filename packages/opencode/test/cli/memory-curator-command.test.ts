import { describe, expect, test } from "bun:test"
import { formatCuratorStatus, formatDryRun, formatEvolutionCandidates } from "../../src/cli/cmd/curator"
import { formatMemoryList, formatMemoryReviewCandidates, formatMemoryReviewStatus } from "../../src/cli/cmd/memory"
import { EvolutionCandidateID } from "../../src/evolution/schema"
import type { Candidate, CandidateDryRun, StatusSummary } from "../../src/evolution/schema"
import {
  MemoryID,
  ReviewCandidateID,
  type Info,
  type ReviewCandidate,
  type ReviewStatus,
} from "../../src/memory/schema"

describe("memory CLI formatting", () => {
  test("formats memory entries as table and JSON", () => {
    const item: Info = {
      id: MemoryID.ascending("mem_cli"),
      target: "memory",
      scope: "project",
      content: "Remember that CLI output should stay easy to scan.",
      tags: ["cli"],
      importance: 0.75,
      source: "manual",
      time: { created: 1, updated: 2 },
    }

    expect(formatMemoryList([item], "table")).toContain("mem_cli\tmemory\tproject\t0.75\t2")
    expect(JSON.parse(formatMemoryList([item], "json"))[0].id).toBe("mem_cli")
  })

  test("formats review candidates and status", () => {
    const candidate: ReviewCandidate = {
      id: ReviewCandidateID.ascending("mrc_cli"),
      target: "memory",
      scope: "global",
      content: "Persist useful user preferences.",
      tags: ["review"],
      importance: 0.8,
      reason: "Useful durable preference.",
      status: "pending",
      time: { created: 1, updated: 2 },
    }
    const status: ReviewStatus = {
      pending: 1,
      applied: 0,
      dismissed: 0,
      total: 1,
      source: { all: 1, explicit: 0, background: 1, compaction: 0, "session-end": 0 },
      sourceByStatus: {
        pending: { all: 1, explicit: 0, background: 1, compaction: 0, "session-end": 0 },
        applied: { all: 0, explicit: 0, background: 0, compaction: 0, "session-end": 0 },
        dismissed: { all: 0, explicit: 0, background: 0, compaction: 0, "session-end": 0 },
      },
    }

    expect(formatMemoryReviewCandidates([candidate], "table")).toContain("mrc_cli\tpending\tmemory\tglobal")
    expect(formatMemoryReviewStatus(status, "table")).toContain("pending\t1")
  })
})

describe("curator CLI formatting", () => {
  test("formats candidates and status", () => {
    const candidate: Candidate = {
      id: EvolutionCandidateID.ascending("evc_cli"),
      kind: "project",
      target: "reviews",
      title: "Improve review summaries",
      content: "Always include verification commands.",
      contentFormat: "content",
      reason: "Review reports are easier to audit.",
      tags: ["evolution"],
      status: "pending",
      time: { created: 1, updated: 2 },
    }
    const status: StatusSummary = {
      pending: 1,
      applied: 0,
      dismissed: 0,
      total: 1,
      source: { all: 1, background: 1, "session-end": 0 },
      sourceByStatus: {
        pending: { all: 1, background: 1, "session-end": 0 },
        applied: { all: 0, background: 0, "session-end": 0 },
        dismissed: { all: 0, background: 0, "session-end": 0 },
      },
    }

    expect(formatEvolutionCandidates([candidate], "table")).toContain("evc_cli\tpending\tproject\treviews\t2")
    expect(formatCuratorStatus({ config: { enabled: true, review_interval: 5 }, status }, "table")).toContain(
      "review_interval\t5",
    )
  })

  test("formats dry-run diffs", () => {
    const dryRun: CandidateDryRun = {
      id: EvolutionCandidateID.ascending("evc_diff"),
      kind: "project",
      target: "reviews",
      title: "Improve review summaries",
      note: "preview only",
      files: [
        {
          path: ".novaway/evolution/reviews.md",
          exists: false,
          before: "",
          after: "content\n",
          diff: "--- a/.novaway/evolution/reviews.md\n+++ b/.novaway/evolution/reviews.md\n@@\n+content",
        },
      ],
    }

    expect(formatDryRun(dryRun, "table")).toContain("+content")
  })
})
