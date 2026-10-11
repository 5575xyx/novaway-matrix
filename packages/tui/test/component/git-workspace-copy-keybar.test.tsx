/** @jsxImportSource @opentui/solid */
//
// Task 10:y 复制、键位条四种状态、以及「不再有 ? 帮助」的防回归。
//
// 断言全部落在字符帧与真 git 状态上,不读内部信号 —— 键位条文案是 keybarText 的唯一可见投影,
// 拿它当焦点/状态锚点(与 git-workspace-actions.test.tsx 同款做法)。
//
// 复制走 useClipboard:这里用 harness 的 clipboard 选项注入一个可控 provider,
// 既能量出「复制了什么」(断言文件路径 / 40 位完整哈希),也能砍掉 write 测出「剪贴板不可用」。
// 不 mock writeOsc52 —— 它是同步返回 undefined 的进程内实现,没有可观测的失败信号,
// 而 context 的 provider 是这套依赖注入本来就是为了测试而留的口子。
import { expect, test } from "bun:test"
import fs from "node:fs"
import path from "node:path"
import { git, gitOut, linesOf, mountWorkspace, tmpGitDir, type WorkspaceHarness } from "./git-workspace-harness"

const FILES_KEYBAR = "a 全部暂存"
const COMMIT_KEYBAR = "z 撤销上次提交"
const INPUT_KEYBAR = "enter 提交 esc 取消"
const DIFF_KEYBAR = "pgup/pgdn 翻页"

/** 初始提交 + 一个已改文件的仓库:文件面板有一行可复制,状态面板才有「变更」。 */
async function dirtyRepo(prefix: string): Promise<string> {
  const dir = tmpGitDir(prefix)
  await git(dir, ["init", "-b", "main"])
  fs.writeFileSync(path.join(dir, "note.txt"), "one\n")
  await git(dir, ["add", "note.txt"])
  await git(dir, ["commit", "-m", "init"])
  fs.writeFileSync(path.join(dir, "note.txt"), "two\n")
  return dir
}

/** 跳到文件面板并选中指定文件行。初始焦点在状态面板,❯ 不在文件面板里。 */
async function intoFiles(ws: WorkspaceHarness, file: string) {
  await ws.waitForFrame((frame) => linesOf(frame, file).length > 0, `文件面板渲染出 ${file}`)
  await ws.pressKey("2")
  await ws.waitForFrame((frame) => linesOf(frame, file).some((line) => line.includes("❯")), `❯ 落在 ${file}`)
}

/** 记下复制内容的 provider。没给 read:工作区从不读剪贴板,给不给都一样。 */
const recording = (sink: string[]) => ({
  write: async (text: string) => {
    sink.push(text)
  },
})

test("文件面板 y:复制选中文件的路径,提示行给出回音", async () => {
  const copied: string[] = []
  const dir = await dirtyRepo("nw-ws-copy-path-")
  using ws = await mountWorkspace({ root: dir, clipboard: recording(copied) })
  await intoFiles(ws, "note.txt")
  await ws.pressKey("y")
  // 复制是不可见动作,没有回音用户会以为没生效 —— 这条断言就是钉回音。
  await ws.waitForFrame((frame) => frame.includes("已复制路径"), "提示行出现「已复制路径」")
  expect(copied).toEqual(["note.txt"])
})

test("提交面板 y:复制的是 40 位完整哈希,不是面板上画的短哈希", async () => {
  const copied: string[] = []
  const dir = await dirtyRepo("nw-ws-copy-hash-")
  const full = gitOut(dir, ["rev-parse", "HEAD"]).trim()
  using ws = await mountWorkspace({ root: dir, clipboard: recording(copied) })
  await ws.waitForFrame((frame) => frame.includes("init"), "提交面板加载出提交")
  await ws.pressKey("4")
  await ws.waitForFrame((frame) => frame.includes(COMMIT_KEYBAR), "焦点落到提交面板")
  await ws.pressKey("y")
  await ws.waitForFrame((frame) => frame.includes("已复制提交哈希"), "提示行出现「已复制提交哈希」")
  expect(full).toHaveLength(40)
  expect(copied).toEqual([full])
})

test("剪贴板 provider 没有 write:提示「剪贴板不可用」而不是静默", async () => {
  const dir = await dirtyRepo("nw-ws-copy-unavail-")
  using ws = await mountWorkspace({ root: dir, clipboard: { read: async () => undefined } })
  await intoFiles(ws, "note.txt")
  await ws.pressKey("y")
  await ws.waitForFrame((frame) => frame.includes("剪贴板不可用"), "提示行给出「剪贴板不可用」")
})

test("空仓库的提交面板:不印 j/k,但保留 enter / y / z", async () => {
  // 空面板按 j 是空转,印一个按键提示只会让人觉得界面卡了 —— 这条断言钉住这个决定。
  const dir = tmpGitDir("nw-ws-keybar-empty-")
  await git(dir, ["init", "-b", "main"])
  using ws = await mountWorkspace({ root: dir })
  await ws.waitForFrame((frame) => frame.includes("（暂无提交）"), "提交面板空态")
  await ws.pressKey("4")
  await ws.waitForFrame((frame) => frame.includes(COMMIT_KEYBAR), "焦点落到提交面板")
  const frame = await ws.frame()
  expect(frame).not.toContain("j/k 选")
  expect(frame).toContain(COMMIT_KEYBAR)
})

test("键位条确认态:面板键位保留,武装项高亮", async () => {
  const dir = await dirtyRepo("nw-ws-keybar-armed-")
  using ws = await mountWorkspace({ root: dir })
  await intoFiles(ws, "note.txt")
  await ws.waitForFrame((frame) => frame.includes(FILES_KEYBAR), "普通态显示文件面板键位")
  await ws.pressKey("d")
  await ws.waitForFrame((frame) => frame.includes("再按一次 d 丢弃这个文件的改动"), "确认态文案出现")
  expect(await ws.frame()).toContain(FILES_KEYBAR)
})

test("键位条输入态:显示 enter 提交 esc 取消", async () => {
  const dir = tmpGitDir("nw-ws-keybar-input-")
  await git(dir, ["init", "-b", "main"])
  fs.writeFileSync(path.join(dir, "a.txt"), "a\n")
  await git(dir, ["add", "a.txt"])
  using ws = await mountWorkspace({ root: dir })
  await ws.waitForFrame((frame) => frame.includes("a.txt"), "文件面板加载出待提交文件")
  await ws.pressKey("c")
  await ws.waitForFrame((frame) => frame.includes("提交信息"), "出现提交输入框")
  const frame = await ws.frame()
  expect(frame).toContain(INPUT_KEYBAR)
  expect(frame).not.toContain(FILES_KEYBAR)
})

test("键位条差异态:显示 j/k 滚动 pgup/pgdn 翻页 esc 退回", async () => {
  const dir = await dirtyRepo("nw-ws-keybar-diff-")
  using ws = await mountWorkspace({ root: dir })
  await intoFiles(ws, "note.txt")
  ws.app.mockInput.pressEnter()
  await ws.waitForFrame((frame) => frame.includes("note.txt 的改动"), "差异视图渲染出来")
  const frame = await ws.frame()
  expect(frame).toContain(DIFF_KEYBAR)
  expect(frame).not.toContain(FILES_KEYBAR)
})

test("键位条不再有「帮助」:五个面板与差异态都不印", async () => {
  // 防回归:? 帮助本版不做,印一个按了没反应的键比不印更糟。有人手痒把它加回来但没实现时,
  // 这条会红。逐态扫一遍,而不是只扫默认态 —— 帮助最容易在某个分支的字符串里被加回来。
  const dir = await dirtyRepo("nw-ws-keybar-nohelp-")
  using ws = await mountWorkspace({ root: dir })
  await intoFiles(ws, "note.txt")
  for (const digit of ["1", "2", "3", "4", "5"]) {
    await ws.pressKey(digit)
    const frame = await ws.frame()
    expect(frame, `按 ${digit} 后的键位条`).not.toContain("帮助")
  }
  await ws.pressKey("2")
  ws.app.mockInput.pressEnter()
  await ws.waitForFrame((frame) => frame.includes("note.txt 的改动"), "差异视图渲染出来")
  expect(await ws.frame(), "差异态的键位条").not.toContain("帮助")
})
