import { expect, test } from "bun:test"
import { CONFIRM_WINDOW_MS, createConfirm } from "../../src/component/git-workspace/confirm"

test("第一次按键进入确认态,不立即触发", () => {
  const confirm = createConfirm(() => 0)
  expect(confirm.press("d", "丢弃这个文件的改动")).toBe("armed")
  expect(confirm.pending()).toEqual({ key: "d", label: "丢弃这个文件的改动", deadline: CONFIRM_WINDOW_MS })
})

test("同键再按一次才真触发", () => {
  const confirm = createConfirm(() => 0)
  expect(confirm.press("d", "丢弃")).toBe("armed")
  expect(confirm.press("d", "丢弃")).toBe("fire")
  expect(confirm.pending()).toBeUndefined()
})

test("超时自动取消", () => {
  let now = 0
  const confirm = createConfirm(() => now)
  confirm.press("d", "丢弃")
  now = CONFIRM_WINDOW_MS - 1
  expect(confirm.pending()).toBeDefined()
  now = CONFIRM_WINDOW_MS
  expect(confirm.pending()).toBeUndefined()
})

test("超时后再按同键是重新武装,不是触发", () => {
  let now = 0
  const confirm = createConfirm(() => now)
  confirm.press("d", "丢弃")
  now = CONFIRM_WINDOW_MS + 100
  expect(confirm.press("d", "丢弃")).toBe("armed")
  expect(confirm.pending()?.deadline).toBe(now + CONFIRM_WINDOW_MS)
})

test("换一个危险键会顶掉上一个确认态,不是取消", () => {
  // 按 d(丢弃)武装后按 x(删除):外壳会拿 x 再调一次 press,此时应当换成 x 的确认态,
  // 而不是把 x 也一并取消掉 —— 后者会让用户按了键却毫无反应。
  const confirm = createConfirm(() => 0)
  confirm.press("d", "丢弃")
  expect(confirm.press("x", "删除")).toBe("armed")
  expect(confirm.pending()?.key).toBe("x")
  expect(confirm.pending()?.label).toBe("删除")
})

test("clear() 无条件清空", () => {
  const confirm = createConfirm(() => 0)
  confirm.press("d", "丢弃")
  confirm.clear()
  expect(confirm.pending()).toBeUndefined()
})
