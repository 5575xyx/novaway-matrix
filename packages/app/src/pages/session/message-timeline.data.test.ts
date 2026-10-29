import { describe, expect, test } from "bun:test"
import type { AssistantMessage, Part, UserMessage } from "@novaway/sdk/v2"
import { Timeline, TurnFold, TimelineRow, type SummaryDiff } from "./message-timeline.data"

type TimelineRowByTag<T extends TimelineRow.TimelineRow["_tag"]> = Extract<TimelineRow.TimelineRow, { _tag: T }>

const user = {
  id: "msg_user",
  role: "user",
  sessionID: "ses_test",
  time: { created: 1 },
  agent: "build",
  model: { providerID: "test", modelID: "test" },
} as UserMessage

const assistant = {
  id: "msg_assistant",
  role: "assistant",
  sessionID: "ses_test",
  parentID: "msg_user",
  agent: "build",
  time: { created: 2, completed: 3 },
} as AssistantMessage

const parts = (input: Part[]) => input

describe("Timeline.constructMessageRows", () => {
  test("hides synthetic-only user messages while keeping assistant output", () => {
    const rows = Timeline.constructMessageRows(
      user,
      (messageID) =>
        ({
          msg_user: parts([
            {
              id: "prt_hidden",
              type: "text",
              text: "hidden build instruction",
              synthetic: true,
              sessionID: "ses_test",
              messageID: "msg_user",
            },
          ]),
          msg_assistant: parts([
            {
              id: "prt_assistant",
              type: "text",
              text: "implementation output",
              sessionID: "ses_test",
              messageID: "msg_assistant",
            },
          ]),
        })[messageID] ?? [],
      [assistant],
      0,
      true,
      "idle",
      false,
    )

    expect(rows.some((row) => row._tag === "UserMessage")).toBe(false)
    expect(rows.some((row) => row._tag === "AssistantPart")).toBe(true)
  })

  test("keeps visible user messages", () => {
    const rows = Timeline.constructMessageRows(
      user,
      (messageID) =>
        ({
          msg_user: parts([
            {
              id: "prt_visible",
              type: "text",
              text: "visible request",
              sessionID: "ses_test",
              messageID: "msg_user",
            },
          ]),
        })[messageID] ?? [],
      [],
      0,
      true,
      "idle",
      false,
    )

    expect(rows.some((row) => row._tag === "UserMessage")).toBe(true)
  })

  test("keeps a working row at the top with the turn start time while busy", () => {
    const rows = Timeline.constructMessageRows(
      user,
      (messageID) =>
        ({
          msg_assistant: parts([
            {
              id: "prt_tool",
              type: "tool",
              tool: "bash",
              callID: "call_test",
              sessionID: "ses_test",
              messageID: "msg_assistant",
              state: { status: "running", input: {}, title: "bash", time: { start: 2 } },
            },
          ]),
        })[messageID] ?? [],
      [assistant],
      0,
      true,
      "busy",
      true,
    )

    const thinking = rows.find((row) => row._tag === "Thinking")
    expect(thinking).toBeDefined()
    expect(thinking?._tag === "Thinking" && thinking.startedAt).toBe(user.time.created)
    // 工作指示必须排在过程卡片之前,不能被工具行挤到最后。
    expect(rows.findIndex((row) => row._tag === "Thinking")).toBeLessThan(
      rows.findIndex((row) => row._tag === "AssistantPart"),
    )
  })
})

// ===== TurnFold.fold =====

let partSeq = 0
const textPart = (text: string, start?: number): Part => {
  partSeq += 1
  return {
    id: `prt_text_${partSeq}`,
    type: "text",
    text,
    sessionID: "ses_test",
    messageID: "msg_user",
    time: start === undefined ? undefined : { start },
  } as Part
}
const toolPart = (start: number, end: number, tool = "bash"): Part => {
  partSeq += 1
  return {
    id: `prt_tool_${partSeq}`,
    type: "tool",
    tool,
    sessionID: "ses_test",
    messageID: "msg_user",
    state: {
      status: "completed",
      input: {},
      output: "ok",
      title: tool,
      metadata: {},
      time: { start, end },
    },
  } as Part
}

const assistantPartRow = (parts: Part[], options: { last: boolean } = { last: false }) =>
  new TimelineRow.AssistantPart({
    userMessageID: "msg_user",
    group: { key: `part:${parts[0]!.id}`, type: "part", ref: { messageID: "msg_user", partID: parts[0]!.id } },
    previousAssistantPart: false,
    lastAssistantPart: options.last,
  })

const fixtureMap = (groups: Part[][]) => {
  const byID = new Map(groups.flat().map((part) => [part.id, part] as const))
  return (messageID: string, partID: string) => byID.get(partID)
}

describe("TurnFold.fold", () => {
  test("completed turn folds process rows and keeps the trailing result text outside", () => {
    const parts = [[toolPart(1000, 2000)], [textPart("result")]]
    const rows = [
      new TimelineRow.UserMessage({ userMessageID: "msg_user", anchor: true, previousUserMessage: false }),
      assistantPartRow(parts[0]!),
      assistantPartRow(parts[1]!, { last: true }),
    ]

    const out = TurnFold.fold(rows, {
      getPart: fixtureMap(parts),
      turnTime: () => ({ start: 1000, end: 6000 }),
    })

    expect(out.map((row) => row._tag)).toEqual(["UserMessage", "TurnFold", "AssistantPart"])
    const folded = out.at(1)! as TimelineRowByTag<"TurnFold">
    expect(folded.rows.map((row) => row._tag)).toEqual(["AssistantPart"])
    expect(folded.userMessageID).toBe("msg_user")
    expect(folded.durationMs).toBe(5000)
  })

  test("active turn folds as soon as the trailing result text starts streaming", () => {
    const parts = [[toolPart(1000, 2000)], [textPart("result")]]
    const rows = [
      new TimelineRow.UserMessage({ userMessageID: "msg_user", anchor: true, previousUserMessage: false }),
      assistantPartRow(parts[0]!),
      assistantPartRow(parts[1]!, { last: true }),
    ]

    const out = TurnFold.fold(rows, {
      getPart: fixtureMap(parts),
      turnTime: () => ({ start: 1000 }),
    })

    expect(out.map((row) => row._tag)).toEqual(["UserMessage", "TurnFold", "AssistantPart"])
    const folded = out.at(1)! as TimelineRowByTag<"TurnFold">
    expect(folded.rows.map((row) => row._tag)).toEqual(["AssistantPart"])
    expect(folded.durationMs).toBeUndefined()
  })

  test("active turn without trailing result text stays unfolded", () => {
    const parts = [[toolPart(1000, 2000)]]
    const rows = [assistantPartRow(parts[0]!, { last: true })]

    const out = TurnFold.fold(rows, {
      getPart: fixtureMap(parts),
      turnTime: () => ({ start: 1000 }),
    })

    expect(out.some((row) => row._tag === "TurnFold")).toBe(false)
    expect(out.map((row) => row._tag)).toEqual(["AssistantPart"])
  })

  test("turn without trailing result text is left unfolded", () => {
    const parts = [[toolPart(1000, 2000)]]
    const rows = [assistantPartRow(parts[0]!, { last: true })]

    const out = TurnFold.fold(rows, {
      getPart: fixtureMap(parts),
      turnTime: () => ({ start: 1000, end: 6000 }),
    })

    expect(out.some((row) => row._tag === "TurnFold")).toBe(false)
  })

  test("turn without process rows (text only) is left unfolded", () => {
    const parts = [[textPart("answer")]]
    const rows = [assistantPartRow(parts[0]!, { last: true })]

    const out = TurnFold.fold(rows, {
      getPart: fixtureMap(parts),
      turnTime: () => ({ start: 1000, end: 6000 }),
    })

    expect(out.some((row) => row._tag === "TurnFold")).toBe(false)
  })

  test("error row keeps the turn unfolded and in place", () => {
    const parts = [[toolPart(1000, 2000)], [textPart("partial")]]
    const rows = [
      assistantPartRow(parts[0]!),
      assistantPartRow(parts[1]!),
      new TimelineRow.Error({ userMessageID: "msg_user", kind: "unknown" as never, detail: "boom" }),
    ]

    const out = TurnFold.fold(rows, {
      getPart: fixtureMap(parts),
      turnTime: () => ({ start: 1000, end: 6000 }),
    })

    expect(out.some((row) => row._tag === "TurnFold")).toBe(false)
    expect(out.at(-1)!._tag).toBe("Error")
  })

  test("interrupted turn divider keeps the turn unfolded", () => {
    const parts = [[toolPart(1000, 2000)], [textPart("result")]]
    const rows = [
      new TimelineRow.TurnDivider({ userMessageID: "msg_user", label: "interrupted" }),
      assistantPartRow(parts[0]!),
      assistantPartRow(parts[1]!, { last: true }),
    ]

    const out = TurnFold.fold(rows, {
      getPart: fixtureMap(parts),
      turnTime: () => ({ start: 1000, end: 6000 }),
    })

    expect(out.some((row) => row._tag === "TurnFold")).toBe(false)
  })

  test("tail cards stay outside the fold after the result text", () => {
    const parts = [[toolPart(1000, 2000)], [textPart("result")]]
    const diffs = [{ file: "a.ts", path: "a.ts", added: 1, removed: 0 } as unknown as SummaryDiff]
    const rows = [
      assistantPartRow(parts[0]!),
      assistantPartRow(parts[1]!),
      new TimelineRow.DiffSummary({ userMessageID: "msg_user", diffs }),
    ]

    const out = TurnFold.fold(rows, {
      getPart: fixtureMap(parts),
      turnTime: () => ({ start: 1000, end: 6000 }),
    })

    expect(out.map((row) => row._tag)).toEqual(["TurnFold", "AssistantPart", "DiffSummary"])
  })

  test("mid-turn text stays inside the fold, only the last text run is the result", () => {
    const parts = [[textPart("narration")], [toolPart(1000, 2000)], [textPart("result")]]
    const rows = [assistantPartRow(parts[0]!), assistantPartRow(parts[1]!), assistantPartRow(parts[2]!, { last: true })]

    const out = TurnFold.fold(rows, {
      getPart: fixtureMap(parts),
      turnTime: () => ({ start: 1000, end: 6000 }),
    })

    const folded = out.at(0)! as TimelineRowByTag<"TurnFold">
    expect(out.map((row) => row._tag)).toEqual(["TurnFold", "AssistantPart"])
    expect(folded.rows.map((row) => row._tag)).toEqual(["AssistantPart", "AssistantPart"])
  })

  test("turns are bucketed independently by user message (each folds on its own trailing text)", () => {
    const parts1 = [[toolPart(1000, 2000)], [textPart("done one")]]
    const parts2 = [[toolPart(3000, 4000)], [textPart("done two")]]
    partSeq = 0
    const rowA = [assistantPartRow(parts1[0]!), assistantPartRow(parts1[1]!, { last: true })]
    const rowB = [
      new TimelineRow.UserMessage({ userMessageID: "msg_two", anchor: true, previousUserMessage: true }),
      new TimelineRow.AssistantPart({
        userMessageID: "msg_two",
        group: {
          key: `part:${parts2[0]![0]!.id}`,
          type: "part",
          ref: { messageID: "msg_two", partID: parts2[0]![0]!.id },
        },
        previousAssistantPart: false,
        lastAssistantPart: false,
      }),
      new TimelineRow.AssistantPart({
        userMessageID: "msg_two",
        group: {
          key: `part:${parts2[1]![0]!.id}`,
          type: "part",
          ref: { messageID: "msg_two", partID: parts2[1]![0]!.id },
        },
        previousAssistantPart: true,
        lastAssistantPart: true,
      }),
    ]

    const out = TurnFold.fold([...rowA, ...rowB], {
      getPart: (messageID, partID) =>
        messageID === "msg_user" ? fixtureMap(parts1)(messageID, partID) : fixtureMap(parts2)(messageID, partID),
      turnTime: (id) => (id === "msg_user" ? { start: 1000, end: 6000 } : { start: 3000, end: 4000 }),
    })

    const folds = out.filter((row) => row._tag === "TurnFold")
    expect(folds.length).toBe(2)
    expect(folds.map((row) => (row as TimelineRowByTag<"TurnFold">).userMessageID)).toEqual(["msg_user", "msg_two"])
  })

  test("durationMs is omitted when turn time is unknown", () => {
    const parts = [[toolPart(1000, 2000)], [textPart("result")]]
    const rows = [assistantPartRow(parts[0]!), assistantPartRow(parts[1]!, { last: true })]

    const out = TurnFold.fold(rows, {
      getPart: fixtureMap(parts),
      turnTime: () => ({}),
    })

    const folded = out.find((row) => row._tag === "TurnFold") as TimelineRowByTag<"TurnFold">
    expect(folded.durationMs).toBeUndefined()
  })

  test("trailing turn actions stay outside the fold after the result text", () => {
    const groups = [[toolPart(1000, 2000)], [textPart("result")]]
    const rows = [
      assistantPartRow(groups[0]!),
      assistantPartRow(groups[1]!),
      new TimelineRow.TurnActions({ userMessageID: "msg_user", copyText: "result" }),
    ]

    const out = TurnFold.fold(rows, {
      getPart: fixtureMap(groups),
      turnTime: () => ({ start: 1000, end: 6000 }),
    })

    expect(out.map((row) => row._tag)).toEqual(["TurnFold", "AssistantPart", "TurnActions"])
  })
})

describe("Timeline.constructMessageRows turn actions", () => {
  const assistantParts = [
    {
      id: "prt_result_1",
      type: "text",
      text: "hello",
      sessionID: "ses_test",
      messageID: "msg_assistant",
    },
    {
      id: "prt_result_2",
      type: "text",
      text: "world",
      sessionID: "ses_test",
      messageID: "msg_assistant",
    },
  ] as Part[]

  const buildRows = (options: { status?: "idle" | "busy"; isActive?: boolean; assistant?: AssistantMessage[] } = {}) =>
    Timeline.constructMessageRows(
      user,
      (messageID) =>
        ({
          msg_user: [
            { id: "prt_visible", type: "text", text: "request", sessionID: "ses_test", messageID: "msg_user" } as Part,
          ],
          msg_assistant: assistantParts,
        })[messageID] ?? [],
      options.assistant ?? [assistant],
      0,
      true,
      options.status ?? "idle",
      options.isActive ?? false,
    )

  test("appends a turn actions row for a completed turn, merging all assistant text", () => {
    const rows = buildRows()
    const actions = rows.filter((row) => row._tag === "TurnActions") as TimelineRowByTag<"TurnActions">[]

    expect(actions.length).toBe(1)
    expect(actions[0]!.copyText).toBe("hello\n\nworld")
    expect(actions[0]!.createdAt).toBe(2)
    expect(actions[0]!.userMessageID).toBe("msg_user")
    // 只挂一条,且是本轮最后一行。
    expect(rows.at(-1)?._tag).toBe("TurnActions")
  })

  test("omits the actions row while the turn is still running", () => {
    const rows = buildRows({ status: "busy", isActive: true })
    expect(rows.some((row) => row._tag === "TurnActions")).toBe(false)
  })

  test("omits the actions row for an errored turn", () => {
    const rows = buildRows({
      assistant: [{ ...assistant, error: { name: "Error", data: { message: "boom" } } } as unknown as AssistantMessage],
    })
    expect(rows.some((row) => row._tag === "TurnActions")).toBe(false)
  })

  test("omits the actions row for an interrupted turn", () => {
    const rows = buildRows({
      assistant: [{ ...assistant, error: { name: "MessageAbortedError" } } as unknown as AssistantMessage],
    })
    expect(rows.some((row) => row._tag === "TurnActions")).toBe(false)
  })

  test("omits the actions row when the turn has no assistant text", () => {
    const rows = Timeline.constructMessageRows(
      user,
      (messageID) =>
        messageID === "msg_user"
          ? [{ id: "prt_visible", type: "text", text: "request", sessionID: "ses_test", messageID: "msg_user" } as Part]
          : [],
      [],
      0,
      true,
      "idle",
      false,
    )
    expect(rows.some((row) => row._tag === "TurnActions")).toBe(false)
  })
})
