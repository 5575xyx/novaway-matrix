import { expect, test } from "bun:test"
import {
  DANGEROUS_COMMANDS,
  GLOBAL_KEYS,
  PANEL_ORDER,
  PANEL_TITLE,
  panelAt,
  panelIndex,
  resolveDiffCommand,
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

test("危险命令集恰好四条 —— 少一条就不弹确认直接执行,多一条就把无害操作变成按两次", () => {
  for (const cmd of ["files.discard", "files.delete", "branches.delete", "stash.discard"] as const) {
    expect(DANGEROUS_COMMANDS.has(cmd)).toBe(true)
  }
  expect(DANGEROUS_COMMANDS.size).toBe(4)
  // 这几条必须不在集里:暂存、切分支、拉推都是无害的,要按两次会很烦。
  expect(DANGEROUS_COMMANDS.has("files.stage")).toBe(false)
  expect(DANGEROUS_COMMANDS.has("branches.checkout")).toBe(false)
  expect(DANGEROUS_COMMANDS.has("global.push")).toBe(false)
})

test("局部键真的覆盖同名全局键", () => {
  // 现有两表的键名没有交集,光靠真实表测不出优先级 —— 把局部查找和全局查找对调,真实表的
  // 断言会照样全绿。所以造一对**故意冲突**的表钉住语义:同一个键在局部和全局都有定义时,
  // 局部胜出。
  const local = { r: "files.focusDiff" as const }
  const global = { ...GLOBAL_KEYS, r: "global.refresh" as const }
  expect(resolveWorkspaceCommand("files", "r", local, global)).toBe("files.focusDiff")
  // 局部没配到的键才落回全局 —— 只测冲突不够,还得确认没有把全局整层屏蔽掉。
  expect(resolveWorkspaceCommand("files", "p", local, global)).toBe("global.pull")
})

test("面板局部键补齐:文件复制路径 / 分支看差异 / 提交复制哈希", () => {
  // `y` 是 Lazygit 里「复制」的惯用键,复用同一字母在不同面板落不同动作 —— 局部键覆盖。
  expect(resolveWorkspaceCommand("files", "y")).toBe("files.copyPath")
  expect(resolveWorkspaceCommand("commits", "y")).toBe("commits.copyHash")
  // 分支面板的 `enter` 是「切到差异视图」不是「检出」,检出仍然走空格。
  expect(resolveWorkspaceCommand("branches", "enter")).toBe("branches.focusDiff")
})

test("差异模式的键位表:滚动 / 翻页 / 退回", () => {
  // 单字母
  expect(resolveDiffCommand("j")).toBe("diff.scrollDown")
  expect(resolveDiffCommand("k")).toBe("diff.scrollUp")
  // 方向键:与 error-component.tsx:84-85 保持一致,ParsedKey.name 直接是 `up` / `down`。
  expect(resolveDiffCommand("up")).toBe("diff.scrollUp")
  expect(resolveDiffCommand("down")).toBe("diff.scrollDown")
  // 翻页键:error-component.tsx:86-87 是 `pageup` / `pagedown`(不是 `pgup` / `pgdn`)。
  expect(resolveDiffCommand("pageup")).toBe("diff.pageUp")
  expect(resolveDiffCommand("pagedown")).toBe("diff.pageDown")
  expect(resolveDiffCommand("esc")).toBe("diff.exit")
})

test("差异模式对数字键 1-5 显式返回 undefined(规格:此时不响应)", () => {
  // 走 resolveWorkspaceCommand 会命中 panel.jump,所以这里必须走独立的差异解析,不能复用。
  for (const key of ["1", "2", "3", "4", "5"]) expect(resolveDiffCommand(key)).toBeUndefined()
})

test("差异模式不放行全局命令键", () => {
  // 差异视图里 `c` 是提交、`p` 是拉取、`f` 是推送、`r` 是刷新,一个都不该生效。
  for (const key of ["c", "p", "f", "r"]) expect(resolveDiffCommand(key)).toBeUndefined()
})

test("既有断言保持:面板模式下数字 1-5 跳面板,0 和 6 不响应", () => {
  expect(resolveWorkspaceCommand("files", "1")).toBe("panel.jump:0")
  expect(resolveWorkspaceCommand("files", "2")).toBe("panel.jump:1")
  expect(resolveWorkspaceCommand("files", "3")).toBe("panel.jump:2")
  expect(resolveWorkspaceCommand("files", "4")).toBe("panel.jump:3")
  expect(resolveWorkspaceCommand("files", "5")).toBe("panel.jump:4")
  expect(resolveWorkspaceCommand("files", "6")).toBeUndefined()
  expect(resolveWorkspaceCommand("files", "0")).toBeUndefined()
})
