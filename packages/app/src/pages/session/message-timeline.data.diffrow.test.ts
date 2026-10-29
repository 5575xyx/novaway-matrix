import { describe, expect, test } from "bun:test"
import { TimelineRow } from "./message-timeline.data"

type DiffRow = Extract<TimelineRow.TimelineRow, { _tag: "DiffSummary" }>

describe("DiffSummary fallback flag", () => {
  test("fallback row keeps fallback:true and turn row defaults to false", () => {
    const turn = new TimelineRow.DiffSummary({ userMessageID: "u1", diffs: [] })
    const fallback = new TimelineRow.DiffSummary({ userMessageID: "u2", diffs: [], fallback: true })
    expect((turn as DiffRow).fallback ?? false).toBe(false)
    expect((fallback as DiffRow).fallback).toBe(true)
  })
})
