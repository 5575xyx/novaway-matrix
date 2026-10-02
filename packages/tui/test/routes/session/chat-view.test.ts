import { expect, test } from "bun:test"
import {
  CHAT_VIEW_ITEMS,
  CHAT_VIEW_KEY,
  CHAT_VIEWS,
  DEFAULT_CHAT_VIEW,
  LAYOUT_COMMAND_ALIASES,
  chatViewArgumentError,
  chatViewShort,
  otherChatView,
  resolveChatViewCommand,
} from "../../../src/routes/session/chat-view"

// /布局 的解析是这个任务里唯一「用户能打错」的地方,所以每一种写法都钉住:
// 认得的写法必须落到正确的视图,不认得的必须落到 undefined(交给正常的发送路径),
// 参数打错必须落到 ok:false 而不是被当成「没给参数」。
test("视图命令:无参的 /布局 与它的别名都在两个视图之间切换", () => {
  for (const head of ["/layout", "/布局", "/视图", " /布局 "]) {
    expect(resolveChatViewCommand(head), head).toEqual({ ok: true, toggle: true })
  }
  for (const head of LAYOUT_COMMAND_ALIASES) {
    expect(resolveChatViewCommand(`/${head}`), head).toEqual({ ok: true, toggle: true })
  }
  // 切换的对端:气泡 ⇄ 流程图
  expect(otherChatView("bubble")).toBe("flow")
  expect(otherChatView("flow")).toBe("bubble")
  expect(CHAT_VIEWS).toEqual(["bubble", "flow"])
  expect(DEFAULT_CHAT_VIEW).toBe("bubble")
})

test("视图命令:/布局 bubble 与 /布局 flow 切到指定视图", () => {
  expect(resolveChatViewCommand("/layout bubble")).toEqual({ ok: true, view: "bubble" })
  expect(resolveChatViewCommand("/layout flow")).toEqual({ ok: true, view: "flow" })
  expect(resolveChatViewCommand("/布局 flow")).toEqual({ ok: true, view: "flow" })
  expect(resolveChatViewCommand("/视图  bubble ")).toEqual({ ok: true, view: "bubble" })
})

test("视图命令:参数非法时明确报出来,不静默按默认视图处理", () => {
  const result = resolveChatViewCommand("/layout bogus")
  expect(result).toEqual({ ok: false, argument: "bogus" })
  // 大小写不宽容:视图名是命令参数,不是自由文本
  expect(resolveChatViewCommand("/layout Flow")).toEqual({ ok: false, argument: "Flow" })
  expect(resolveChatViewCommand("/布局 画布")).toEqual({ ok: false, argument: "画布" })
  // 直说了视图又跟一个参数,也是错(不是忽略掉第二个)
  expect(resolveChatViewCommand("/flow bubble")).toEqual({ ok: false, argument: "bubble" })
  const message = chatViewArgumentError("bogus")
  expect(message).toContain("bogus")
  expect(message).toContain("bubble / flow")
})

test("视图命令:斜杠菜单里那两条命令的每个名字都能直接打", () => {
  for (const item of CHAT_VIEW_ITEMS) {
    for (const head of [`/${item.command}`, `/${item.label}`, `/${item.view}`]) {
      expect(resolveChatViewCommand(head), head).toEqual({ ok: true, view: item.view })
    }
  }
})

test("视图命令:不是本地视图命令的一律交给正常发送路径", () => {
  for (const line of ["", "/", "//", "/help", "/layoutx", "/bubbleish", "layout flow", "你好 /flow"]) {
    expect(resolveChatViewCommand(line), line).toBeUndefined()
  }
})

// 胶囊与斜杠菜单各自要用「短名 / 中文名 / 英文原名」三套说法,这里钉住它们一一对应,
// 免得标签栏写「流程图」而菜单写「流程图视图」,同一个视图两个名字。
test("视图命令:胶囊短名与菜单名一一对应,KV 键名固定", () => {
  expect(CHAT_VIEW_ITEMS.map((item) => item.label)).toEqual(["气泡视图", "流程图视图"])
  expect(CHAT_VIEW_ITEMS.map((item) => chatViewShort(item.view))).toEqual(["气泡", "流程图"])
  expect(CHAT_VIEW_ITEMS.map((item) => item.description)).toEqual(["气泡视图(默认)", "流程图卡片视图 · 节点链式连接"])
  // KV 里存的就是 bubble/flow 这两个词,别哪天改成中文把老用户的持久化读丢了
  expect(CHAT_VIEWS).toContain(DEFAULT_CHAT_VIEW)
  expect(CHAT_VIEW_KEY).toBe("chat_view")
})
