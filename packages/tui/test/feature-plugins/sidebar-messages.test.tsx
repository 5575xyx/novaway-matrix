/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import messagesPlugin, {
  MESSAGE_COLLAPSE_AT,
  visibleMessages,
} from "../../src/feature-plugins/sidebar/messages"
import { createTuiPluginApi } from "../fixture/tui-plugin"

test("未超阈值时全部消息可见", () => {
  const messages = Array.from({ length: MESSAGE_COLLAPSE_AT }, (_, index) => ({ id: `m${index}` }))
  expect(visibleMessages(messages, false).map((item) => item.id)).toEqual(["m0", "m1", "m2", "m3", "m4"])
  expect(visibleMessages(messages, true).map((item) => item.id)).toEqual(["m0", "m1", "m2", "m3", "m4"])
})

test("超过阈值时默认只保留最近几条,展开后恢复全部", () => {
  const messages = Array.from({ length: MESSAGE_COLLAPSE_AT + 2 }, (_, index) => ({ id: `m${index}` }))
  // 列表按时间正序,"最近"在尾部。
  expect(visibleMessages(messages, false).map((item) => item.id)).toEqual(["m2", "m3", "m4", "m5", "m6"])
  expect(visibleMessages(messages, true)).toEqual(messages)
})

// fixture 里只有 session 和 theme,这里补上取摘要用的 part,并把 slots.register 换成
// 捕获器:拿到插件真正注册进来的 sidebar_content 工厂,再在渲染作用域里调用它
// (opentui 的 reconciler 在 createElement 时就要求 renderer 存在,组件外构造 JSX 会直接抛)。
// 返回 () => any 是因为 slot 工厂返回的 JSX 类型在这里没有意义,测试只断言帧内容。
async function renderMessageList(count: number) {
  const messages = Array.from({ length: count }, (_, index) => ({
    id: `m${index}`,
    role: "user",
    time: { created: index },
  }))
  const api = createTuiPluginApi({
    state: {
      session: {
        // mock 数据只带了 id/role/time,用 never 强转掉 Message 的其余必填字段。
        messages: () => messages as never,
      },
    },
  })
  // fixture 没有 part 和 slots:补上摘要用的 part,并把 register 换成捕获器。
  const state = api.state as unknown as { part: unknown }
  state.part = (messageID: string) => [
    { id: messageID, type: "text", synthetic: false, ignored: false, text: messageID },
  ]
  let slot: ((ctx: unknown, props: { session_id: string }) => unknown) | undefined
  const host = api as unknown as { slots: unknown }
  host.slots = {
    register(plugin: { slots: { sidebar_content: typeof slot } }) {
      slot = plugin.slots.sidebar_content
      return () => {}
    },
  }
  await messagesPlugin.tui(api, undefined, {} as never)
  return () => slot!({}, { session_id: "s1" })
}

async function captureFrame(render: () => unknown, height = 16) {
  const app = await testRender(() => <>{render()}</>, { width: 46, height })
  try {
    let frame = ""
    for (let attempt = 0; attempt < 10; attempt++) {
      await app.renderOnce()
      frame = app.captureCharFrame()
      if (frame.includes("消息")) break
    }
    return frame
  } finally {
    app.renderer.destroy()
  }
}

test("渲染:超过阈值默认折叠,只显示最近几条并标出总数", async () => {
  const frame = await captureFrame(await renderMessageList(MESSAGE_COLLAPSE_AT + 3))

  expect(frame).toContain("▶")
  expect(frame).toContain(`${MESSAGE_COLLAPSE_AT + 3} 条`)
  expect(frame).toContain(`仅显示 ${MESSAGE_COLLAPSE_AT} 条`)
  // 8 条折叠成最后 5 条:m3 是留住的更早那条,m7 是最新那条。
  expect(frame).toContain("m3")
  expect(frame).toContain("m7")
  expect(frame).not.toContain("m2")
  expect(frame).not.toContain("m0")
})

test("渲染:条数没超阈值时不折叠,也没有箭头", async () => {
  const frame = await captureFrame(await renderMessageList(MESSAGE_COLLAPSE_AT))

  expect(frame).toContain(`${MESSAGE_COLLAPSE_AT} 条`)
  expect(frame).toContain("m0")
  expect(frame).toContain(`m${MESSAGE_COLLAPSE_AT - 1}`)
  expect(frame).not.toContain("▶")
  expect(frame).not.toContain("仅显示")
})

test("渲染:没有用户消息时整个消息块不出现", async () => {
  const frame = await captureFrame(await renderMessageList(0), 6)
  expect(frame).not.toContain("消息")
})
