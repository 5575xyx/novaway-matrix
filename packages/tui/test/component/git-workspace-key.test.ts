import { expect, test } from "bun:test"
import { keyOfParsed, resolveWorkspaceCommand } from "../../src/component/git-workspace/focus"

test("普通字母取 name", () => {
  expect(keyOfParsed({ name: "d", ctrl: false, shift: false, sequence: "d" })).toBe("d")
  expect(keyOfParsed({ name: "c", ctrl: false, shift: false, sequence: "c" })).toBe("c")
})

test("数字键取 name", () => {
  expect(keyOfParsed({ name: "1", ctrl: false, shift: false, sequence: "1" })).toBe("1")
})

test("ctrl 组合键加前缀", () => {
  expect(keyOfParsed({ name: "c", ctrl: true, shift: false, sequence: "\u0003" })).toBe("ctrl+c")
})

test("shift+tab 合成一个键名", () => {
  expect(keyOfParsed({ name: "tab", ctrl: false, shift: true, sequence: "\u001b[Z" })).toBe("shift-tab")
})

test("普通 tab 不加前缀", () => {
  expect(keyOfParsed({ name: "tab", ctrl: false, shift: false, sequence: "\t" })).toBe("tab")
})

test("alt 组合不落成普通字母", () => {
  // 反面教材:早先版本把 meta 丢掉,于是 alt+f 被当成 f 直接执行了 git push、
  // alt+d 连按两次就丢弃了改动。带前缀保证查表不中,按键被放行给聊天输入框。
  const altF = keyOfParsed({ name: "f", ctrl: false, shift: false, sequence: "alt-f", meta: true })
  expect(altF).toBe("alt+f")
  expect(resolveWorkspaceCommand("status", altF)).toBeUndefined()

  const altD = keyOfParsed({ name: "d", ctrl: false, shift: false, sequence: "alt-d", option: true })
  expect(altD).toBe("alt+d")
  expect(resolveWorkspaceCommand("files", altD)).toBeUndefined()
})

test("ctrl 组合多字符键也不落成裸键", () => {
  // ctrl+space 的裸字节会被解析成 name:"space",ctrl:true —— 不带前缀就会落成普通 space 命令。
  // enter/tab 同理(启用 kitty 协议时会出现)。
  expect(keyOfParsed({ name: "space", ctrl: true, shift: false, sequence: "" })).toBe("ctrl+space")
  expect(resolveWorkspaceCommand("files", "ctrl+space")).toBeUndefined()
  expect(keyOfParsed({ name: "return", ctrl: true, shift: false, sequence: "" })).toBe("ctrl+return")
  expect(resolveWorkspaceCommand("files", "ctrl+return")).toBeUndefined()
})

test("空格:sequence 口径", () => {
  expect(keyOfParsed({ name: " ", ctrl: false, shift: false, sequence: " " })).toBe("space")
})

test("空格:name 已经叫 space 的口径", () => {
  expect(keyOfParsed({ name: "space", ctrl: false, shift: false, sequence: " " })).toBe("space")
})

test("escape / return 归一化成键位表的词汇", () => {
  // opentui 事件的 name 是 escape / return(见 src/util/selection.ts:66、
  // src/component/error-component.tsx:63),而键位表里写的是 esc / enter。
  // 不做这两条映射,按 esc 关工作区、按 enter 看差异都会解析成 undefined 而静默失效。
  expect(keyOfParsed({ name: "escape", ctrl: false, shift: false, sequence: "\u001b" })).toBe("esc")
  expect(keyOfParsed({ name: "return", ctrl: false, shift: false, sequence: "\r" })).toBe("enter")
})

test("归一化后的键能被键位表接住(往返)", () => {
  // 键位表(focus.ts)与 opentui 的事件名是两套词汇,这层归一化是两者的契约。
  // 任一侧改了拼写,这条都会红 —— 只单测 focus.ts 或只单测 keyOfParsed 都测不出。
  expect(
    resolveWorkspaceCommand("files", keyOfParsed({ name: "return", ctrl: false, shift: false, sequence: "\r" })),
  ).toBe("files.focusDiff")
  expect(
    resolveWorkspaceCommand("commits", keyOfParsed({ name: "return", ctrl: false, shift: false, sequence: "\r" })),
  ).toBe("commits.focusDiff")
})
