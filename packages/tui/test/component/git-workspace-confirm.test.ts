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

test("fire 用武装瞬间的目标快照,取走后清空", () => {
  // 武装后列表可能被后台刷新换掉(reload 完成会重排 fileRows),fire 时若重读选中行,
  // 丢弃/删除就会落到另一个文件头上 —— 所以目标在 press 进确认态那一刻就拍板。
  const confirm = createConfirm<{ file: string }>(() => 0)
  expect(confirm.press("d", "丢弃", { file: "a.ts" })).toBe("armed")
  expect(confirm.pending()?.target).toEqual({ file: "a.ts" })
  expect(confirm.press("d", "丢弃", { file: "a.ts" })).toBe("fire")
  expect(confirm.takeFiredTarget()).toEqual({ file: "a.ts" })
  // 一次性:不许残留到下一次 fire。
  expect(confirm.takeFiredTarget()).toBeUndefined()
})

test("换危险键顶掉确认态时,目标也跟着换成新键的", () => {
  const confirm = createConfirm<{ file: string }>(() => 0)
  confirm.press("d", "丢弃", { file: "a.ts" })
  confirm.press("x", "删除", { file: "b.ts" })
  expect(confirm.pending()?.target).toEqual({ file: "b.ts" })
  confirm.press("x", "删除", { file: "b.ts" })
  expect(confirm.takeFiredTarget()).toEqual({ file: "b.ts" })
})

test("没传目标照常武装,fire 时目标为空", () => {
  // branches.delete / stash.discard 在计划 2 之前没有 fire 落地,按的还是无目标的 press ——
  // 不能因为没目标就拒绝武装。
  const confirm = createConfirm<{ file: string }>(() => 0)
  expect(confirm.press("d", "丢弃")).toBe("armed")
  expect(confirm.pending()?.target).toBeUndefined()
  expect(confirm.press("d", "丢弃")).toBe("fire")
  expect(confirm.takeFiredTarget()).toBeUndefined()
})

test("超时重武装时目标也换成新传入的", () => {
  let now = 0
  const confirm = createConfirm<{ file: string }>(() => now)
  confirm.press("d", "丢弃", { file: "a.ts" })
  now = CONFIRM_WINDOW_MS + 100
  confirm.press("d", "丢弃", { file: "b.ts" })
  expect(confirm.pending()?.target).toEqual({ file: "b.ts" })
})
