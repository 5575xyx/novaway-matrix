import { expect, test } from "bun:test"
import {
  GLOBAL_KEYS,
  PANEL_KEYS,
  PANEL_ORDER,
  PANEL_TITLE,
  panelAt,
  panelIndex,
  resolveWorkspaceCommand,
} from "../../src/component/git-workspace/focus"

test("五个面板,顺序照 Lazygit", () => {
  expect(PANEL_ORDER).toEqual(["status", "files", "branches", "commits", "stash"])
})

test("面板标题全中文", () => {
  for (const id of PANEL_ORDER) expect(PANEL_TITLE[id]).toMatch(/[一-龥]/)
  expect(PANEL_TITLE.status).toBe("状态")
  expect(PANEL_TITLE.files).toBe("文件")
  expect(PANEL_TITLE.stash).toBe("贮藏")
})

test("panelIndex / panelAt 往返", () => {
  expect(panelIndex("files")).toBe(1)
  expect(panelAt(1)).toBe("files")
})

test("panelAt 对越界下标取模绕回(shift-tab 从第一个往回按)", () => {
  expect(panelAt(-1)).toBe("stash")
  expect(panelAt(5)).toBe("status")
  expect(panelAt(6)).toBe("files")
})

test("tab 循环切面板", () => {
  expect(resolveWorkspaceCommand("status", "tab")).toBe("panel.next")
  expect(resolveWorkspaceCommand("stash", "tab")).toBe("panel.next")
  expect(resolveWorkspaceCommand("files", "shift-tab")).toBe("panel.prev")
})

test("数字键直接跳面板", () => {
  expect(resolveWorkspaceCommand("status", "1")).toBe("panel.jump:0")
  expect(resolveWorkspaceCommand("files", "5")).toBe("panel.jump:4")
  expect(resolveWorkspaceCommand("status", "6")).toBeUndefined()
})

test("同一个键在不同面板含义不同 —— 空格", () => {
  expect(resolveWorkspaceCommand("status", "space")).toBe("status.space")
  expect(resolveWorkspaceCommand("files", "space")).toBe("files.stage")
  expect(resolveWorkspaceCommand("branches", "space")).toBe("branches.checkout")
})

test("enter 在文件面板切到差异视图,在提交面板是看提交", () => {
  expect(resolveWorkspaceCommand("files", "enter")).toBe("files.focusDiff")
  expect(resolveWorkspaceCommand("commits", "enter")).toBe("commits.focusDiff")
})

test("面板局部键优先于全局键", () => {
  // c 在文件面板没有局部含义,落回全局的提交
  expect(resolveWorkspaceCommand("files", "c")).toBe("global.commit")
  // 但 1-5 是全局的,文件面板里也该跳面板
  expect(resolveWorkspaceCommand("files", "1")).toBe("panel.jump:0")
})

test("ctrl+c 和 ctrl+l 不在拦截表里(必须放行给上层)", () => {
  expect(resolveWorkspaceCommand("files", "ctrl+c")).toBeUndefined()
  expect(resolveWorkspaceCommand("files", "ctrl+l")).toBeUndefined()
  expect(GLOBAL_KEYS["ctrl+c"]).toBeUndefined()
})

test("文件面板的危险键都登记在确认机制里", () => {
  expect(PANEL_KEYS.files["d"]).toBe("files.discard")
  expect(PANEL_KEYS.files["x"]).toBe("files.delete")
})
