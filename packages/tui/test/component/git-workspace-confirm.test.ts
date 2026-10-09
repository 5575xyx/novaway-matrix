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

test("label 是纯展示,不参与状态判定", () => {
  // 危险性由外壳的 DANGEROUS_COMMANDS 判定,本方法不看 label。有人要是重新加回
  // 「label 为空就取消」的门控,这条会红 —— 那等于把语义藏进了一句展示文案。
  const confirm = createConfirm(() => 0)
  expect(confirm.press("d", "")).toBe("armed")
  expect(confirm.pending()?.key).toBe("d")
  // 空 label 的键再按一次同样算同键确认。
  expect(confirm.press("d", "")).toBe("fire")
})

test("press 在窗口边界那一刻算过期", () => {
  // pending() 的 >= 由「超时自动取消」钉住,这里钉 press 里的那一处 —— 两处口径必须一致,
  // 否则会出现「提示条还在、一按却重新武装」的错位。
  let now = 0
  const confirm = createConfirm(() => now)
  confirm.press("d", "丢弃")
  now = CONFIRM_WINDOW_MS
  expect(confirm.press("d", "丢弃")).toBe("armed")
  expect(confirm.pending()?.deadline).toBe(now + CONFIRM_WINDOW_MS)
})
