/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import type { GlobalEvent } from "@novaway/sdk-v2-latest/v2"
import { tmpdir } from "../../../fixture/fixture"
import { mount, wait } from "./sync-fixture"

// 流式增量是"每个 token 一条事件"。原来每条都直接写 store,一次写就是一次渲染,
// 而文本部件每次渲染要把已累积的全文重新做一遍高亮 —— 越写越慢。
// 现在窗口内的增量先攒着,一个窗口只落一次 store。这里钉住两件事:
// 攒出来的文本必须和逐条写完全一样,而且服务端补发完整快照时不能把增量重复贴一遍。

const sessionID = "ses_delta_batch"
const messageID = "msg_delta_batch"
const partID = "prt_delta_batch"
const assistant = {
  id: messageID,
  sessionID,
  role: "assistant" as const,
  agent: "build",
  modelID: "model",
  providerID: "test",
  mode: "build",
  parentID: "msg_user",
  path: { cwd: "/tmp/NovaWay", root: "/tmp/NovaWay" },
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: 1, completed: 2 },
}

function global(payload: GlobalEvent["payload"]): GlobalEvent {
  return { directory: "/tmp/other", project: "proj_test", payload }
}

function part(text: string) {
  return { id: partID, sessionID, messageID, type: "text" as const, text }
}

function text(sync: { data: { part: Record<string, unknown[]> } }) {
  const value = sync.data.part[messageID]?.[0] as { type?: string; text?: string } | undefined
  if (value?.type !== "text") return undefined
  return value.text
}

test("窗口内的多条增量合成一次写入,文本按顺序拼齐", async () => {
  await using tmp = await tmpdir()
  await Bun.write(`${tmp.path}/kv.json`, "{}")
  const { app, emit, sync } = await mount(undefined, tmp.path)

  try {
    emit(global({ id: "evt_message", type: "message.updated", properties: { sessionID, info: assistant } }))
    emit(
      global({
        id: "evt_part",
        type: "message.part.updated",
        properties: { sessionID, time: 1, part: part("") },
      }),
    )

    const chunks = ["第", "一", "段", "话", "。"]
    await wait(() => text(sync) === "")
    chunks.forEach((delta, index) =>
      emit(
        global({
          id: `evt_delta_${index}`,
          type: "message.part.delta",
          properties: { sessionID, messageID, partID, field: "text", delta },
        }),
      ),
    )

    // 事件已经投递过去了,但 32ms 的合并窗口还没到,所以一个字都还没落库
    await Bun.sleep(5)
    expect(text(sync)).toBe("")

    await wait(() => text(sync) === chunks.join(""))
  } finally {
    app.renderer.destroy()
  }
})

test("完整快照到达时丢掉未落库的增量,不会把同一段文本贴两遍", async () => {
  await using tmp = await tmpdir()
  await Bun.write(`${tmp.path}/kv.json`, "{}")
  const { app, emit, sync } = await mount(undefined, tmp.path)

  try {
    emit(global({ id: "evt_message", type: "message.updated", properties: { sessionID, info: assistant } }))
    emit(
      global({
        id: "evt_part",
        type: "message.part.updated",
        properties: { sessionID, time: 1, part: part("") },
      }),
    )
    emit(
      global({
        id: "evt_delta",
        type: "message.part.delta",
        properties: { sessionID, messageID, partID, field: "text", delta: "半句" },
      }),
    )
    // 服务端随后补一条完整快照,里面已经含有上面那条增量
    emit(
      global({
        id: "evt_part_full",
        type: "message.part.updated",
        properties: { sessionID, time: 2, part: part("半句话") },
      }),
    )

    await wait(() => text(sync) === "半句话")
    // 再等过一个合并窗口,确认没有迟到的增量把文本变成 "半句话半句"
    await Bun.sleep(80)
    expect(text(sync)).toBe("半句话")
  } finally {
    app.renderer.destroy()
  }
})
