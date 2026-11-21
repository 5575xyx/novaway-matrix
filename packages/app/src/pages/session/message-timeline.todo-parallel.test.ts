import { describe, expect, test } from "bun:test"
import type { Part } from "@novaway/sdk/v2"
import { TodoGrouping, TimelineRow } from "./message-timeline.data"

const part = (id: string, input: Partial<Part>): Part =>
  ({
    id,
    sessionID: "ses_test",
    messageID: "msg_assistant",
    ...input,
  }) as Part

const todoPart = (id: string, todos: { content: string; status: string }[], focusPosition?: number): Part =>
  part(id, {
    type: "tool",
    tool: "todowrite",
    state: {
      status: "completed",
      input: { todos },
      output: "",
      title: "",
      metadata: { todos, ...(focusPosition === undefined ? {} : { focusPosition }) },
      time: { start: 100, end: 110 },
    },
  } as Partial<Part>)

const toolPart = (
  id: string,
  tool: string,
  start: number,
  end: number,
  filePath?: string,
  todoContent?: string,
): Part =>
  part(id, {
    type: "tool",
    tool,
    state: {
      status: "completed",
      input: filePath ? { filePath } : {},
      output: "",
      title: "",
      metadata: todoContent ? { todoContent } : {},
      time: { start, end },
    },
  } as Partial<Part>)

const assistantRow = (ref: { messageID: string; partID: string }): TimelineRow.TimelineRow =>
  new TimelineRow.AssistantPart({
    userMessageID: "msg_user",
    group: { key: ref.partID, type: "part", ref },
    previousAssistantPart: false,
    lastAssistantPart: false,
  })

const ref = (partID: string) => ({ messageID: "msg_assistant", partID })

const overview = (rows: TimelineRow.TimelineRow[]) =>
  rows.find((row) => row._tag === "TodoOverview") as TimelineRow.TodoOverview | undefined

describe("TodoGrouping.group malformed parallel todos", () => {
  const parts = new Map<string, Part>()
  const getPart = (messageID: string, partID: string) => (messageID === "msg_assistant" ? parts.get(partID) : undefined)

  const setup = () => {
    parts.clear()
    parts.set(
      "p_todo",
      todoPart("p_todo", [
        { content: "检查项目结构", status: "in_progress" },
        { content: "实现接口", status: "in_progress" },
        { content: "补测试", status: "pending" },
      ]),
    )
    parts.set("p_read", toolPart("p_read", "glob", 120, 200))
    parts.set("p_write", toolPart("p_write", "write", 220, 400, "src/a.ts"))
    parts.set(
      "p_todo2",
      todoPart("p_todo2", [
        { content: "检查项目结构", status: "completed" },
        { content: "实现接口", status: "completed" },
        { content: "补测试", status: "pending" },
      ]),
    )
  }

  test("does not guess an untagged row into the first parallel item", () => {
    setup()
    const rows = [
      assistantRow(ref("p_todo")),
      assistantRow(ref("p_read")),
      assistantRow(ref("p_write")),
      assistantRow(ref("p_todo2")),
    ]
    const grouped = TodoGrouping.group(rows, { getPart })
    const card = overview(grouped)
    expect(card).toBeDefined()

    const first = card!.sections.find((section) => section.title === "检查项目结构")!
    expect(first.rows.length).toBe(0)
    expect(first.startedAt).toBe(110)
    expect(first.endedAt).toBe(110)
  })

  test("focus snapshots route parallel lane output to the selected item", () => {
    parts.clear()
    parts.set(
      "p_todo",
      todoPart("p_todo", [
        { content: "检查项目结构", status: "in_progress" },
        { content: "实现接口", status: "in_progress" },
      ]),
    )
    parts.set("p_read", toolPart("p_read", "glob", 120, 200, undefined, "检查项目结构"))
    parts.set(
      "p_focus",
      todoPart(
        "p_focus",
        [
          { content: "检查项目结构", status: "in_progress" },
          { content: "实现接口", status: "in_progress" },
        ],
        1,
      ),
    )
    parts.set("p_write", toolPart("p_write", "write", 220, 400, "src/a.ts", "实现接口"))

    const card = overview(
      TodoGrouping.group(
        [
          assistantRow(ref("p_todo")),
          assistantRow(ref("p_read")),
          assistantRow(ref("p_focus")),
          assistantRow(ref("p_write")),
        ],
        { getPart },
      ),
    )!
    expect(card.sections.find((section) => section.title === "检查项目结构")!.rows.length).toBe(1)
    expect(card.sections.find((section) => section.title === "实现接口")!.rows.length).toBe(1)
    expect(card.sections.find((section) => section.title === "实现接口")!.rows[0]._tag).toBe("AssistantPart")
  })
  test("a parallel snapshot without a focus lane preserves empty independent sections", () => {
    setup()
    const rows = [assistantRow(ref("p_todo")), assistantRow(ref("p_todo2"))]
    const card = overview(TodoGrouping.group(rows, { getPart }))
    expect(card).toBeDefined()
    for (const title of ["检查项目结构", "实现接口"]) {
      const section = card!.sections.find((item) => item.title === title)!
      expect(section.rows.length).toBe(0)
      expect(section.startedAt).toBe(110)
    }
  })

  test("single in_progress keeps the previous one-bucket behaviour", () => {
    parts.clear()
    parts.set(
      "p_todo",
      todoPart("p_todo", [
        { content: "检查项目结构", status: "in_progress" },
        { content: "实现接口", status: "pending" },
      ]),
    )
    parts.set("p_read", toolPart("p_read", "glob", 120, 200))
    parts.set(
      "p_todo2",
      todoPart("p_todo2", [
        { content: "检查项目结构", status: "completed" },
        { content: "实现接口", status: "in_progress" },
      ]),
    )
    const rows = [assistantRow(ref("p_todo")), assistantRow(ref("p_read")), assistantRow(ref("p_todo2"))]
    const card = overview(TodoGrouping.group(rows, { getPart }))!
    const first = card.sections.find((section) => section.title === "检查项目结构")!
    expect(first.rows.length).toBe(1)
    expect(first.status).toBe("completed")
  })
})
