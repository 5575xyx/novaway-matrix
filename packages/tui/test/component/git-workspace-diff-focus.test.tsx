/** @jsxImportSource @opentui/solid */
//
// Task 9:差异视图激活模式。文件 / 分支面板按 enter 之后,焦点落到右侧差异视图:
// j/k/↑/↓ 滚动、pgup/pgdn 翻页、esc 退回左列焦点(不关工作区)、tab 切下一个面板。
//
// 断言全部落在字符帧上,不读内部信号 —— 这套交互的最终裁判是「用户看到了什么」,
// 而不是「某个信号变成了 true」。
// 焦点落在哪个面板靠**底部键位条**辨认:聚焦面板的边框颜色在字符帧里不可见
// (与 git-workspace-actions.test.tsx 同一理由)。
//
// 翻页键没有 mockInput 原生入口(KeyCodes 里只有 ARROW_* 与 F1-F12,没有 PAGEUP/PAGEDOWN),
// 所以按真实 CSI 序列发:pressKey 对 KeyCodes 之外的串原样 emit 给 stdin,真实解析器把它
// 解析成 name "pageup" / "pagedown" —— 与 focus.ts 的键名口径一致(已实测确认)。
// ESC 用 fromCharCode 拼,不用 "\u001b" 字面量:那个写法在本仓库的 TSX 解析下不可靠。
import { expect, test } from "bun:test"
import fs from "node:fs"
import path from "node:path"
import { git, linesOf, mountWorkspace, tmpGitDir, type WorkspaceHarness } from "./git-workspace-harness"

const ESC = String.fromCharCode(27)
const PAGEDOWN = `${ESC}[6~`
const PAGEUP = `${ESC}[5~`

/** 底部键位条里只有对应面板才有这一段 —— 拿它当「焦点在这个面板」的断言锚点。 */
const FILES_KEYBAR = "全部暂存"
const STATUS_KEYBAR = "作用于当前行"
const BRANCHES_KEYBAR = "n 新建"
/** 差异态整条替换成这一句 —— 数字键不响应时它必须原样留着。 */
const DIFF_KEYBAR = "pgup/pgdn 翻页"

/** enter / esc / tab 走 mockInput 的原生入口,发完等一帧画完(它们本身不等帧)。 */
async function pressEnter(ws: WorkspaceHarness) {
  ws.app.mockInput.pressEnter()
  await ws.frame()
}

async function pressEsc(ws: WorkspaceHarness) {
  ws.app.mockInput.pressEscape()
  await ws.frame()
}

async function pressTab(ws: WorkspaceHarness) {
  ws.app.mockInput.pressTab()
  await ws.frame()
}

/** 跳到文件面板并等它选中第一行。初始焦点在状态面板,❯ 不在文件面板里。 */
async function intoFilesPanel(ws: WorkspaceHarness, file: string) {
  await ws.waitForFrame((frame) => linesOf(frame, file).length > 0, `文件面板渲染出 ${file}`)
  await ws.pressKey("2")
  await ws.waitForFrame((frame) => linesOf(frame, file).some((line) => line.includes("❯")), `❯ 落在 ${file}`)
}

/** 两个已改文件的仓库:文件面板有两行,「焦点没被切走」才有第二行可对照。 */
async function dirtyRepo(prefix: string): Promise<string> {
  const dir = tmpGitDir(prefix)
  await git(dir, ["init", "-b", "main"])
  fs.writeFileSync(path.join(dir, "aaa.txt"), "alpha\n")
  fs.writeFileSync(path.join(dir, "bbb.txt"), "beta\n")
  await git(dir, ["add", "aaa.txt", "bbb.txt"])
  await git(dir, ["commit", "-m", "init"])
  fs.writeFileSync(path.join(dir, "aaa.txt"), "alpha2\n")
  fs.writeFileSync(path.join(dir, "bbb.txt"), "beta2\n")
  return dir
}

/** 40 行全改的大 diff:一屏装不下,滚动和翻页才有东西可动。 */
async function longDiffRepo(prefix: string): Promise<string> {
  const dir = tmpGitDir(prefix)
  await git(dir, ["init", "-b", "main"])
  const num = (index: number) => String(index + 1).padStart(2, "0")
  fs.writeFileSync(
    path.join(dir, "long.txt"),
    Array.from({ length: 40 }, (_, i) => `alpha-${num(i)}`).join("\n") + "\n",
  )
  await git(dir, ["add", "long.txt"])
  await git(dir, ["commit", "-m", "init"])
  fs.writeFileSync(path.join(dir, "long.txt"), Array.from({ length: 40 }, (_, i) => `beta-${num(i)}`).join("\n") + "\n")
  return dir
}

test("文件面板 enter 进入差异模式:j 不再移动文件行,esc 退回后恢复", async () => {
  const dir = await dirtyRepo("nw-diff-focus-enter-")
  using ws = await mountWorkspace({ root: dir })
  await intoFilesPanel(ws, "aaa.txt")
  await pressEnter(ws)
  await ws.waitForFrame((frame) => frame.includes("aaa.txt 的改动"), "差异视图切到该文件")
  // 差异模式下 j 滚的是差异内容,不是文件行:❯ 必须钉在原来那一行。
  await ws.pressKey("j")
  await ws.pressKey("j")
  await ws.waitForFrame(
    (frame) => linesOf(frame, "aaa.txt").some((line) => line.includes("❯")),
    "差异模式下 j 没把焦点行从 aaa.txt 移走",
  )
  await ws.waitForFrame(
    (frame) => linesOf(frame, "bbb.txt").every((line) => !line.includes("❯")),
    "bbb.txt 没有变成焦点行",
  )
  await pressEsc(ws)
  await ws.pressKey("j")
  await ws.waitForFrame(
    (frame) => linesOf(frame, "bbb.txt").some((line) => line.includes("❯")),
    "esc 退回左列后 j 恢复移动文件行",
  )
})

test("差异模式下 j 真的滚动:第一屏独有的内容被滚走", async () => {
  const dir = await longDiffRepo("nw-diff-focus-scroll-")
  using ws = await mountWorkspace({ root: dir })
  await intoFilesPanel(ws, "long.txt")
  await pressEnter(ws)
  await ws.waitForFrame((frame) => frame.includes("alpha-01"), "差异视图渲染出第一屏")
  const top = await ws.frame()
  for (let i = 0; i < 10; i++) await ws.pressKey("j")
  const scrolled = await ws.frame()
  // alpha-01 在补丁开头几行,滚 10 行必然被顶出屏外。
  expect(top).toContain("alpha-01")
  expect(scrolled).not.toContain("alpha-01")
  expect(scrolled).not.toBe(top)
})

test("差异模式下 pgdn 翻一屏:偏移量明显大于单次 j", async () => {
  const dir = await longDiffRepo("nw-diff-focus-page-")
  using ws = await mountWorkspace({ root: dir })
  await intoFilesPanel(ws, "long.txt")
  await pressEnter(ws)
  await ws.waitForFrame((frame) => frame.includes("alpha-01"), "差异视图渲染出第一屏")
  const top = await ws.frame()
  await ws.pressKey("j")
  const afterOne = await ws.frame()
  expect(afterOne).not.toBe(top)
  await ws.pressKey("k")
  await ws.waitForFrame((frame) => frame.includes("alpha-01"), "k 回到顶部")
  await ws.pressKey(PAGEDOWN)
  const afterPage = await ws.frame()
  // 同样从顶部出发:一行的量与一屏的量必须差出可见距离。
  expect(afterPage).not.toBe(afterOne)
  expect(afterPage).not.toBe(top)
  // alpha-01 在补丁最前面,一屏(≈20 行)必然把它翻过去。
  expect(afterPage).not.toContain("alpha-01")
})

test("差异模式下数字键不响应:焦点不切走,键位条也不变", async () => {
  const dir = await dirtyRepo("nw-diff-focus-digit-")
  using ws = await mountWorkspace({ root: dir })
  await intoFilesPanel(ws, "aaa.txt")
  await pressEnter(ws)
  await ws.waitForFrame((frame) => frame.includes("aaa.txt 的改动"), "差异视图渲染出来")
  await ws.pressKey("1")
  const frame = await ws.frame()
  // 差异态的键位条是差异段(不是文件段):按 1 没把焦点切走,它必须原样留着。
  expect(frame).toContain(DIFF_KEYBAR)
  expect(frame).not.toContain(FILES_KEYBAR)
  expect(frame).not.toContain(STATUS_KEYBAR)
  expect(linesOf(frame, "aaa.txt").some((line) => line.includes("❯"))).toBe(true)
})

test("差异模式下 tab 退出:进下一个面板,j 恢复移动行", async () => {
  const dir = await dirtyRepo("nw-diff-focus-tab-")
  await git(dir, ["branch", "other"])
  using ws = await mountWorkspace({ root: dir })
  await intoFilesPanel(ws, "aaa.txt")
  await pressEnter(ws)
  await ws.waitForFrame((frame) => frame.includes("aaa.txt 的改动"), "差异视图渲染出来")
  await pressTab(ws)
  await ws.waitForFrame((frame) => frame.includes(BRANCHES_KEYBAR), "tab 进下一个面板(分支)")
  // main 是当前分支画 ● 不画 ❯,所以先 j 下移到 other 才有可见的 ❯ 可当锚点。
  await ws.pressKey("j")
  await ws.waitForFrame(
    (frame) => linesOf(frame, "other").some((line) => line.includes("❯")),
    "tab 退出差异模式后 j 恢复移动行",
  )
})

test("分支面板 enter:右侧是分支差异,只含该分支独有的改动", async () => {
  const dir = tmpGitDir("nw-diff-focus-branch-")
  await git(dir, ["init", "-b", "main"])
  fs.writeFileSync(path.join(dir, "base.txt"), "base\n")
  await git(dir, ["add", "base.txt"])
  await git(dir, ["commit", "-m", "init"])
  await git(dir, ["branch", "other"])
  await git(dir, ["switch", "other"])
  fs.writeFileSync(path.join(dir, "side-only.txt"), "side content\n")
  await git(dir, ["add", "side-only.txt"])
  await git(dir, ["commit", "-m", "side"])
  await git(dir, ["switch", "main"])
  fs.writeFileSync(path.join(dir, "main-only.txt"), "main content\n")
  await git(dir, ["add", "main-only.txt"])
  await git(dir, ["commit", "-m", "main-side"])

  using ws = await mountWorkspace({ root: dir })
  await ws.waitForFrame((frame) => linesOf(frame, "other").length > 0, "分支面板渲染出 other")
  await ws.pressKey("3")
  await ws.waitForFrame((frame) => frame.includes(BRANCHES_KEYBAR), "焦点落到分支面板")
  await ws.waitForFrame((frame) => linesOf(frame, "main").some((line) => line.includes("●")), "main 是当前分支")
  await ws.pressKey("j")
  await ws.waitForFrame((frame) => linesOf(frame, "other").some((line) => line.includes("❯")), "❯ 落到 other")
  await pressEnter(ws)
  await ws.waitForFrame((frame) => frame.includes("分支 other"), "差异标题是分支 other")
  await ws.waitForFrame((frame) => frame.includes("side content"), "显示 other 独有的改动")
  // 三点差异的口径:当前分支独有的文件不能被当成「那边删了」混进来。
  expect(await ws.frame()).not.toContain("main content")
})

test("差异小到一屏装不下:滚动命令到边界就停,不越界", async () => {
  const dir = tmpGitDir("nw-diff-focus-clamp-")
  await git(dir, ["init", "-b", "main"])
  fs.writeFileSync(path.join(dir, "tiny.txt"), "one\n")
  await git(dir, ["add", "tiny.txt"])
  await git(dir, ["commit", "-m", "init"])
  fs.writeFileSync(path.join(dir, "tiny.txt"), "two\n")

  using ws = await mountWorkspace({ root: dir })
  await intoFilesPanel(ws, "tiny.txt")
  await pressEnter(ws)
  await ws.waitForFrame((frame) => frame.includes("+ two"), "差异视图渲染出来")
  // 取「+ two」这一行在整屏里的位置当锚点:滚动了它就会变行号。
  const rowOf = (frame: string) => frame.split("\n").findIndex((line) => line.includes("+ two"))
  const before = await ws.frame()
  expect(rowOf(before)).toBeGreaterThan(-1)
  // 内容比视口短:15 次 j 全都该停在原地,一屏翻页也一样。
  for (let i = 0; i < 15; i++) await ws.pressKey("j")
  for (let i = 0; i < 3; i++) await ws.pressKey(PAGEDOWN)
  expect(rowOf(await ws.frame())).toBe(rowOf(before))
  for (let i = 0; i < 15; i++) await ws.pressKey("k")
  for (let i = 0; i < 3; i++) await ws.pressKey(PAGEUP)
  expect(rowOf(await ws.frame())).toBe(rowOf(before))
})

test("差异为空(选中当前分支):没有滚动容器时按 j/k/pgup/pgdn 不崩", async () => {
  const dir = tmpGitDir("nw-diff-focus-empty-")
  await git(dir, ["init", "-b", "main"])
  fs.writeFileSync(path.join(dir, "only.txt"), "only\n")
  await git(dir, ["add", "only.txt"])
  await git(dir, ["commit", "-m", "init"])

  using ws = await mountWorkspace({ root: dir })
  await ws.waitForFrame((frame) => linesOf(frame, "main").length > 0, "分支面板渲染出 main")
  await ws.pressKey("3")
  await ws.waitForFrame(
    (frame) => linesOf(frame, "main").some((line) => line.includes("●")),
    "main 是当前分支(● 只在分支面板画)",
  )
  await pressEnter(ws)
  await ws.waitForFrame((frame) => frame.includes("分支 main"), "差异标题是当前分支")
  await ws.waitForFrame((frame) => frame.includes("没有改动"), "当前分支没有差异")
  await ws.pressKey("j")
  await ws.pressKey("k")
  await ws.pressKey(PAGEDOWN)
  await ws.pressKey(PAGEUP)
  expect(await ws.frame()).toContain("没有改动")
})
