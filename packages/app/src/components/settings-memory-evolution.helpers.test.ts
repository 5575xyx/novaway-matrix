import { describe, expect, test } from "bun:test"
import type {
  EvolutionCandidate,
  EvolutionStatus,
  MemoryReviewCandidate,
  MemoryReviewStatus,
} from "@opencode-ai/sdk/v2/client"
import { pendingBadgeLabel } from "./review-ui-helpers"
import {
  filterEvolutionCandidates,
  evolutionCandidateSource,
  evolutionCounts,
  evolutionSourceCounts,
} from "./settings-evolution.helpers"
import {
  filterMemoryReviewCandidates,
  memoryCandidateSource,
  memoryReviewCounts,
  memoryReviewSourceCounts,
} from "./settings-memory.helpers"
import { matchesModeGroup, modeGroupFromText } from "./settings-mode-groups"

describe("mode group helpers", () => {
  test("classifies mode text by common aliases", () => {
    expect(modeGroupFromText(["AI PPT", "office", "会议纪要"])).toBe("zen")
    expect(modeGroupFromText(["frontend", "coding", "代码审查"])).toBe("forge")
    expect(matchesModeGroup(["营销", "公众号"], "pulse")).toBe(true)
    expect(matchesModeGroup(["普通内容"], "all")).toBe(true)
    expect(matchesModeGroup(["普通内容"], "zen")).toBe(false)
  })
})

describe("memory review UI helpers", () => {
  test("maps memory candidate source tags by priority", () => {
    expect(memoryCandidateSource(["explicit"])).toBe("explicit")
    expect(memoryCandidateSource(["explicit", "compaction"])).toBe("compaction")
    expect(memoryCandidateSource(["background", "session-end"])).toBe("session-end")
    expect(memoryCandidateSource([])).toBe("background")
    expect(memoryCandidateSource(undefined)).toBe("background")
  })

  test("normalizes memory counts and filters candidates by source", () => {
    const status: MemoryReviewStatus = {
      pending: 3,
      applied: "NaN",
      dismissed: 1,
      total: 4,
      source: { all: 3, explicit: 1, background: 1, compaction: 0, "session-end": 1 },
      sourceByStatus: {
        pending: { all: 3, explicit: 1, background: 1, compaction: "NaN", "session-end": 1 },
        applied: { all: 0, explicit: 0, background: 0, compaction: 0, "session-end": 0 },
        dismissed: { all: 1, explicit: 0, background: 1, compaction: 0, "session-end": 0 },
      },
    }
    const candidates = [
      memoryCandidate("mrc_explicit", ["explicit", "mode:zen"]),
      memoryCandidate("mrc_background", []),
      memoryCandidate("mrc_session", ["session-end"]),
    ]

    expect(memoryReviewCounts(status)).toEqual({ pending: 3, applied: 0, dismissed: 1 })
    expect(memoryReviewSourceCounts(status, "pending")).toEqual({
      all: 3,
      explicit: 1,
      background: 1,
      compaction: 0,
      "session-end": 1,
    })
    expect(filterMemoryReviewCandidates(candidates, "session-end").map((item) => item.id)).toEqual(["mrc_session"])
    expect(filterMemoryReviewCandidates(candidates, "all", "zen").map((item) => item.id)).toEqual(["mrc_explicit"])
    expect(filterMemoryReviewCandidates(undefined, "all")).toEqual([])
  })
})

describe("evolution UI helpers", () => {
  test("maps evolution candidate source tags", () => {
    expect(evolutionCandidateSource(["session-end"])).toBe("session-end")
    expect(evolutionCandidateSource(["background"])).toBe("background")
    expect(evolutionCandidateSource([])).toBe("background")
    expect(evolutionCandidateSource(undefined)).toBe("background")
  })

  test("normalizes evolution counts and filters candidates by source", () => {
    const status: EvolutionStatus = {
      pending: 101,
      applied: "Infinity",
      dismissed: 2,
      total: 103,
      source: { all: 101, background: 100, "session-end": 1 },
      sourceByStatus: {
        pending: { all: 101, background: 100, "session-end": 1 },
        applied: { all: 0, background: 0, "session-end": 0 },
        dismissed: { all: 2, background: "NaN", "session-end": 1 },
      },
    }
    const candidates = [
      evolutionCandidate("evc_background", []),
      evolutionCandidate("evc_session", ["session-end", "mode:forge"]),
    ]

    expect(evolutionCounts(status)).toEqual({ pending: 101, applied: 0, dismissed: 2 })
    expect(evolutionSourceCounts(status, "dismissed")).toEqual({ all: 2, background: 0, "session-end": 1 })
    expect(filterEvolutionCandidates(candidates, "background").map((item) => item.id)).toEqual(["evc_background"])
    expect(filterEvolutionCandidates(candidates, "all", "forge").map((item) => item.id)).toEqual(["evc_session"])
    expect(filterEvolutionCandidates(undefined, "all")).toEqual([])
  })
})

describe("review badge helpers", () => {
  test("formats pending badge values", () => {
    expect(pendingBadgeLabel(0)).toBe("0")
    expect(pendingBadgeLabel(99)).toBe("99")
    expect(pendingBadgeLabel(100)).toBe("99+")
    expect(pendingBadgeLabel("NaN")).toBe("0")
  })
})

function memoryCandidate(id: string, tags: string[]): MemoryReviewCandidate {
  return {
    id,
    target: "memory",
    scope: "project",
    content: id,
    tags,
    importance: 0.5,
    reason: "用于验证候选来源筛选。",
    status: "pending",
    time: { created: 1, updated: 1 },
  }
}

function evolutionCandidate(id: string, tags: string[]): EvolutionCandidate {
  return {
    id,
    kind: "project",
    target: "reviews",
    title: id,
    content: id,
    contentFormat: "content",
    reason: "用于验证自我进化来源筛选。",
    tags,
    status: "pending",
    time: { created: 1, updated: 1 },
  }
}
