import { describe, expect, test } from "bun:test"
import type { AssistantMessage, Part, UserMessage } from "@novaway/sdk/v2"
import { Timeline, TodoGrouping, TurnFold, TimelineRow, type SummaryDiff } from "./message-timeline.data"

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

describe("TodoGrouping.latestSnapshot", () => {
  const snapshot = (content: string): Part =>
    ({
      id: `todo-${content}`,
      type: "tool",
      tool: "todowrite",
      callID: `call-${content}`,
      sessionID: "ses_test",
      messageID: `msg-${content}`,
      state: {
        status: "completed",
        input: { todos: [{ content, status: "in_progress" }] },
        output: "",
        metadata: {},
        title: "todowrite",
        time: { start: 1, end: 2 },
      },
    }) as Part

  test("stops at the newest non-empty snapshot instead of scanning older messages", () => {
    const calls: string[] = []
    const result = TodoGrouping.latestSnapshot(
      [{ id: "old" }, { id: "middle" }, { id: "latest" }],
      (id) => {
        calls.push(id)
        return id === "latest" ? [snapshot("current task")] : [snapshot("stale task")]
      },
    )

    expect(result.map((todo) => todo.content)).toEqual(["current task"])
    expect(calls).toEqual(["latest"])
  })

  test("skips empty newer snapshots and falls back to the newest prior non-empty snapshot", () => {
    const calls: string[] = []
    const result = TodoGrouping.latestSnapshot(
      [{ id: "old" }, { id: "latest" }],
      (id) => {
        calls.push(id)
        if (id === "latest")
          return [
            {
              ...snapshot(""),
              state: {
                status: "completed",
                input: { todos: [] },
                output: "",
                metadata: {},
                title: "todowrite",
                time: { start: 1, end: 2 },
              },
            } as Part,
          ]
        return [snapshot("previous task")]
      },
    )

    expect(result.map((todo) => todo.content)).toEqual(["previous task"])
    expect(calls).toEqual(["latest", "old"])
  })
})

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

describe("TodoGrouping.group fast path", () => {
  test("caches false classifications so stable text rows need no repeated part lookup", () => {
    const part = textPart("ordinary answer")
    const row = assistantPartRow([part])
    const rows = [row]
    let lookups = 0
    const getPart = (_messageID: string, partID: string) => {
      lookups++
      return partID === part.id ? part : undefined
    }

    expect(TodoGrouping.group(rows, { getPart })).toBe(rows)
    expect(lookups).toBe(1)
    expect(TodoGrouping.group(rows, { getPart })).toBe(rows)
    expect(lookups).toBe(1)
  })

  test("caches true classifications for todo-tool rows", () => {
    const part = toolPart(1000, 2000, "todowrite")
    const row = assistantPartRow([part])
    let lookups = 0
    const getPart = (_messageID: string, partID: string) => {
      lookups++
      return partID === part.id ? part : undefined
    }

    expect(TodoGrouping.hasTodoTool([row], getPart)).toBe(true)
    expect(TodoGrouping.hasTodoTool([row], getPart)).toBe(true)
    expect(lookups).toBe(1)
  })
})

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
    // 跑完的大容器报整轮耗时,不是某一段的。
    expect(folded.durationMs).toBe(5000)
    expect(folded.bare).toBeUndefined()
    expect(folded.active).toBeUndefined()
    expect(TurnFold.fold(rows, {
      getPart: fixtureMap(parts),
      turnTime: () => ({ start: 1000, end: 6000 }),
    })[1]).toBe(folded)
    const changedTiming = TurnFold.fold(rows, {
      getPart: fixtureMap(parts),
      turnTime: () => ({ start: 1000, end: 9000 }),
    })[1] as TimelineRowByTag<"TurnFold">
    expect(changedTiming).not.toBe(folded)
    expect(changedTiming.durationMs).toBe(8000)
  })

  test("active turn closes the group above the narration and opens a new one below it", () => {
    const parts = [[toolPart(1000, 2000)], [textPart("narration")], [toolPart(2500, 3000)]]
    const rows = [
      new TimelineRow.UserMessage({ userMessageID: "msg_user", anchor: true, previousUserMessage: false }),
      new TimelineRow.Thinking({ userMessageID: "msg_user", reasoningHeading: "读代码", startedAt: 900 }),
      assistantPartRow(parts[0]!),
      assistantPartRow(parts[1]!),
      assistantPartRow(parts[2]!, { last: true }),
    ]

    const out = TurnFold.fold(rows, {
      getPart: fixtureMap(parts),
      turnTime: () => ({ start: 1000 }),
      isTurnActive: (id) => id === "msg_user",
    })

    // 正文一出现,上面那组就收尾;下面新开一组跟着当前动作。
    expect(out.map((row) => row._tag)).toEqual(["UserMessage", "TurnFold", "AssistantPart", "TurnFold"])
    const closed = out.at(1)! as TimelineRowByTag<"TurnFold">
    expect(closed.active).toBeUndefined()
    expect(closed.durationMs).toBe(1000)
    expect(closed.rows.length).toBe(1)

    const live = out.at(3)! as TimelineRowByTag<"TurnFold">
    expect(live.active).toBe(true)
    expect(live.startedAt).toBe(1000)
    expect(live.rows.length).toBe(1)
    // 顶部那条工作指示的标题/计时被提升到常驻容器里,不再单独成行(否则同一屏两个计时)。
    expect(out.some((row) => row._tag === "Thinking")).toBe(false)
    expect(live.reasoningHeading).toBe("读代码")
    // 同一轮多组必须各有各的 key:行表按 key 建 Map,撞了就直接丢行。
    expect(TimelineRow.key(closed)).not.toBe(TimelineRow.key(live))
  })

  test("active turn writing the final text keeps the working line under it", () => {
    const parts = [[toolPart(1000, 2000)], [textPart("结果正在流出来")]]
    const rows = [
      new TimelineRow.Thinking({ userMessageID: "msg_user", reasoningHeading: "写结果", startedAt: 900 }),
      assistantPartRow(parts[0]!),
      assistantPartRow(parts[1]!, { last: true }),
      new TimelineRow.PreviewCard({ userMessageID: "msg_user", targets: [] }),
    ]

    const out = TurnFold.fold(rows, {
      getPart: fixtureMap(parts),
      turnTime: () => ({ start: 1000 }),
      isTurnActive: () => true,
    })

    // 工作指示跟在正在写的那段正文后面,不越过产物卡,也不留在轮首。
    expect(out.map((row) => row._tag)).toEqual(["TurnFold", "AssistantPart", "Thinking", "PreviewCard"])
    expect((out.at(0)! as TimelineRowByTag<"TurnFold">).active).toBeUndefined()
  })

  test("active turn keeps question cards outside the container", () => {
    const parts = [[toolPart(1000, 2000)], [toolPart(2500, 3000, "question")]]
    const rows = [assistantPartRow(parts[0]!), assistantPartRow(parts[1]!, { last: true })]

    const out = TurnFold.fold(rows, {
      getPart: fixtureMap(parts),
      turnTime: () => ({ start: 1000 }),
      isTurnActive: () => true,
    })

    expect(out.map((row) => row._tag)).toEqual(["TurnFold", "AssistantPart"])
    const folded = out.at(0)! as TimelineRowByTag<"TurnFold">
    expect(folded.rows.length).toBe(1)
  })

  test("active turn keeps the todo checklist card outside the container", () => {
    const parts = [[toolPart(1000, 2000)]]
    const rows = [
      assistantPartRow(parts[0]!, { last: true }),
      new TimelineRow.TodoOverview({ anchorPartID: "prt_tool_1", done: 0, total: 2, sections: [] }),
    ]

    const out = TurnFold.fold(rows, {
      getPart: fixtureMap(parts),
      turnTime: () => ({ start: 1000 }),
      isTurnActive: () => true,
    })

    expect(out.map((row) => row._tag)).toEqual(["TurnFold", "TodoOverview"])
  })

  test("active turn before the first tool call keeps the working row", () => {
    const parts = [[textPart("narration")]]
    const rows = [
      new TimelineRow.Thinking({ userMessageID: "msg_user", startedAt: 900 }),
      assistantPartRow(parts[0]!, { last: true }),
    ]

    const out = TurnFold.fold(rows, {
      getPart: fixtureMap(parts),
      turnTime: () => ({ start: 1000 }),
      isTurnActive: () => true,
    })

    expect(out.map((row) => row._tag)).toEqual(["Thinking", "AssistantPart"])
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

  test("reuses structural text classification for stable assistant rows", () => {
    const part = textPart("stable answer")
    const row = assistantPartRow([part], { last: true })
    let lookups = 0
    const options = {
      getPart: () => {
        lookups++
        return part
      },
      turnTime: () => ({}),
    }

    TurnFold.fold([row], options)
    const firstPassLookups = lookups
    TurnFold.fold([row], options)

    expect(firstPassLookups).toBe(1)
    expect(lookups).toBe(firstPassLookups)
  })

  test("error row stays visible after the process is folded", () => {
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

    expect(out.map((row) => row._tag)).toEqual(["TurnFold", "AssistantPart", "Error"])
    expect((out[0] as TimelineRowByTag<"TurnFold">).rows.map((row) => row._tag)).toEqual(["AssistantPart"])
    expect(out.at(-1)!._tag).toBe("Error")
  })

  test("interrupted turn divider keeps each attempt folded separately", () => {
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

    expect(out.map((row) => row._tag)).toEqual(["TurnDivider", "TurnFold", "AssistantPart"])
  })

  test("interrupted attempt without a final answer still folds its process", () => {
    const parts = [[toolPart(1000, 2000)]]
    const rows = [
      assistantPartRow(parts[0]!),
      new TimelineRow.TurnDivider({ userMessageID: "msg_user", label: "interrupted" }),
    ]

    const out = TurnFold.fold(rows, {
      getPart: fixtureMap(parts),
      turnTime: () => ({ start: 1000, end: 2000 }),
    })

    expect(out.map((row) => row._tag)).toEqual(["TurnFold", "TurnDivider"])
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

  test("completed turn keeps the big container and re-splits its interior by narration", () => {
    const parts = [[textPart("narration")], [toolPart(1000, 2000)], [textPart("result")]]
    const rows = [assistantPartRow(parts[0]!), assistantPartRow(parts[1]!), assistantPartRow(parts[2]!, { last: true })]

    const out = TurnFold.fold(rows, {
      getPart: fixtureMap(parts),
      turnTime: () => ({ start: 1000, end: 6000 }),
    })

    // 两层都在:外面一张大容器收整轮过程,里面那句中间旁白仍留在段外,和它下面那段一一对应。
    expect(out.map((row) => row._tag)).toEqual(["TurnFold", "AssistantPart"])
    const folded = out.at(0)! as TimelineRowByTag<"TurnFold">
    expect(folded.rows.map((row) => row._tag)).toEqual(["AssistantPart", "TurnFold"])
    expect(folded.durationMs).toBe(5000)
    expect(folded.bare).toBeUndefined()
    // 大容器头部数的是步数,不是子项数(切段后子项里还夹着正文)。
    expect(folded.stepCount).toBe(1)

    const segment = folded.rows.at(1)! as TimelineRowByTag<"TurnFold">
    expect(segment.rows.length).toBe(1)
    // 一行的段不挂第二层折叠头,直接摆在引导线上。
    expect(segment.bare).toBe(true)
  })

  test("narration inside the container closes the segment above and opens the next", () => {
    const parts = [
      [toolPart(1000, 1400)],
      [toolPart(1500, 2000)],
      [textPart("先看清结构")],
      [toolPart(2500, 3000)],
      [textPart("result")],
    ]
    const rows = parts.map((group, index) => assistantPartRow(group, { last: index === parts.length - 1 }))

    const out = TurnFold.fold(rows, {
      getPart: fixtureMap(parts),
      turnTime: () => ({ start: 1000, end: 6000 }),
    })

    const folded = out.at(0)! as TimelineRowByTag<"TurnFold">
    // 段 / 正文 / 段:正文永远在段外,两段各自带自己的耗时。
    expect(folded.rows.map((row) => row._tag)).toEqual(["TurnFold", "AssistantPart", "TurnFold"])
    const segments = folded.rows.filter((row) => row._tag === "TurnFold") as TimelineRowByTag<"TurnFold">[]
    expect(segments.map((segment) => segment.durationMs)).toEqual([1000, 500])
    expect(segments.map((segment) => segment.active)).toEqual([undefined, undefined])
    // 多行的段有自己的折叠头;只有一行的那段直接摆在引导线上。
    expect(segments.map((segment) => segment.bare)).toEqual([undefined, true])
    // 两段锚在自己的第一行,否则虚拟列表按 key 去重会静默丢一段。
    expect(segments[0]!.anchorKey).not.toBe(segments[1]!.anchorKey)
    // 大容器头部数的是步数:3 段过程行,夹在中间的正文不算一步。
    expect(folded.stepCount).toBe(3)
  })

  test("todo sections fold their own tool runs and keep the step narration outside", () => {
    const parts = [[toolPart(1000, 2000)], [textPart("这一步做完了")]]
    const section = new TimelineRow.TodoSection({
      todoID: "todo_1",
      segment: 0,
      title: "第一步",
      status: "completed",
      rows: [assistantPartRow(parts[0]!), assistantPartRow(parts[1]!)],
      outputCount: 1,
    })
    const rows = [
      new TimelineRow.UserMessage({ userMessageID: "msg_user", anchor: true, previousUserMessage: false }),
      new TimelineRow.TodoOverview({ anchorPartID: "prt_todo", done: 1, total: 1, sections: [section] }),
    ]

    const out = TurnFold.fold(rows, {
      getPart: fixtureMap(parts),
      turnTime: () => ({ start: 1000, end: 6000 }),
    })

    const overview = out.at(1)! as TimelineRowByTag<"TodoOverview">
    const folded = overview.sections[0]!.rows
    expect(folded.map((row) => row._tag)).toEqual(["TurnFold", "AssistantPart"])
    // 分区不抢"运行中末段"的位置:清单卡自己就是进度面板。
    expect((folded[0] as TimelineRowByTag<"TurnFold">).active).toBeUndefined()
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

  test("durationMs is omitted when the group has no times of its own", () => {
    const parts = [[toolPart(1000, 2000)], [textPart("result")]]
    // 重试行不带时间,整段就出不了耗时 —— 宁可只显示"已完成",也不要报一个错的秒数。
    const rows = [
      assistantPartRow(parts[0]!),
      new TimelineRow.Retry({ userMessageID: "msg_user" }),
      assistantPartRow(parts[1]!, { last: true }),
    ]

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
