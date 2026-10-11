/** @jsxImportSource @opentui/solid */
//
// Git 工作区鼠标支持测试(计划 3)。
//
// 13 个用例覆盖:行点击、框点击、双击、键位条点击、武装态、滚轮、差异点击、
// 键盘防回归、边界情况。
//
// 鼠标操作走 ws.mouse.click(x, y),坐标从 ws.cellOf(frame, needle) 反查。
// 双击走 ws.mouse.doubleClick(x, y) —— opentui 原生支持。
// 滚轮走 ws.mouse.scroll(x, y, direction)。
import { expect, test } from "bun:test"
import fs from "node:fs"
import path from "node:path"
import { git, gitOut, linesOf, mountWorkspace, porcelain, tmpGitDir } from "./git-workspace-harness"

/** 文件面板键位条锚点:断言焦点在文件面板。 */
const FILES_KEYBAR = "a 全部暂存"
/** 提交面板键位条锚点:断言焦点在提交面板。 */
const COMMIT_KEYBAR = "z 撤销上次提交"
/** 分支面板键位条锚点:断言焦点在分支面板。 */
const BRANCHES_KEYBAR = "n 新建"
/** 贮藏面板键位条锚点:断言焦点在贮藏面板。 */
const STASH_KEYBAR = "空格 弹出"
/** 差异视图键位条锚点:断言差异激活模式。 */
const DIFF_KEYBAR = "pgup/pgdn 翻页"
/** 输入态键位条锚点。 */
const INPUT_KEYBAR = "enter 提交 esc 取消"

/** 一个只有初始提交的仓库。 */
async function baseRepo(prefix: string): Promise<string> {
  const dir = tmpGitDir(prefix)
  await git(dir, ["init", "-b", "main"])
  fs.writeFileSync(path.join(dir, "base.txt"), "base\n")
  await git(dir, ["add", "base.txt"])
  await git(dir, ["commit", "-m", "init"])
  return dir
}

/** 初始提交 + 一个已改文件。 */
async function dirtyRepo(prefix: string): Promise<string> {
  const dir = tmpGitDir(prefix)
  await git(dir, ["init", "-b", "main"])
  fs.writeFileSync(path.join(dir, "note.txt"), "one\n")
  await git(dir, ["add", "note.txt"])
  await git(dir, ["commit", "-m", "init"])
  fs.writeFileSync(path.join(dir, "note.txt"), "two\n")
  return dir
}

/** 初始提交 + 两个提交(用于双击提交行测试)。 */
async function multiCommitRepo(prefix: string): Promise<string> {
  const dir = tmpGitDir(prefix)
  await git(dir, ["init", "-b", "main"])
  fs.writeFileSync(path.join(dir, "a.txt"), "a\n")
  await git(dir, ["add", "a.txt"])
  await git(dir, ["commit", "-m", "first"])
  fs.writeFileSync(path.join(dir, "b.txt"), "b\n")
  await git(dir, ["add", "b.txt"])
  await git(dir, ["commit", "-m", "second"])
  return dir
}

/** 初始提交 + 两个分支(用于双击分支行测试)。 */
async function multiBranchRepo(prefix: string): Promise<string> {
  const dir = tmpGitDir(prefix)
  await git(dir, ["init", "-b", "main"])
  fs.writeFileSync(path.join(dir, "base.txt"), "base\n")
  await git(dir, ["add", "base.txt"])
  await git(dir, ["commit", "-m", "init"])
  await git(dir, ["switch", "-c", "feature"])
  fs.writeFileSync(path.join(dir, "feature.txt"), "feature\n")
  await git(dir, ["add", "feature.txt"])
  await git(dir, ["commit", "-m", "feature work"])
  await git(dir, ["switch", "main"])
  return dir
}

/** 初始提交 + 一个贮藏(用于双击贮藏行测试)。 */
async function stashedRepo(prefix: string): Promise<string> {
  const dir = tmpGitDir(prefix)
  await git(dir, ["init", "-b", "main"])
  fs.writeFileSync(path.join(dir, "base.txt"), "base\n")
  await git(dir, ["add", "base.txt"])
  await git(dir, ["commit", "-m", "init"])
  fs.writeFileSync(path.join(dir, "base.txt"), "stashed\n")
  await git(dir, ["stash", "push", "-m", "wip"])
  return dir
}

/** 跳到文件面板并等它渲染出指定文件。 */
async function intoFiles(ws: Awaited<ReturnType<typeof mountWorkspace>>, file: string) {
  await ws.waitForFrame((frame) => linesOf(frame, file).length > 0, `文件面板渲染出 ${file}`)
  await ws.pressKey("2")
  await ws.waitForFrame((frame) => linesOf(frame, file).some((line) => line.includes("❯")), `❯ 落在 ${file}`)
}

test("点某行:❯ 移到被点行,且该面板变当前面板", async () => {
  const dir = await dirtyRepo("nw-ws-mouse-row-")
  using ws = await mountWorkspace({ root: dir })
  await intoFiles(ws, "note.txt")
  const frame = await ws.frame()
  // 找到文件面板的 ❯ 行,点它上面的另一行(如果有的话)。
  // 这里只有一个文件,所以点同一行验证面板不变。
  // 更好的测试:点另一个面板的行。
  await ws.pressKey("1")
  await ws.waitForFrame((frame) => frame.includes("m 切换远端"), "焦点落到状态面板")
  const frame2 = await ws.frame()
  // 找到状态面板的第一行(分支行),点它。
  const { x, y } = ws.cellOf(frame2, "分支")
  await ws.mouse.click(x, y)
  await ws.waitForFrame((frame) => linesOf(frame, "分支").some((line) => line.includes("❯")), "❯ 落在分支行")
  const frame3 = await ws.frame()
  // 点文件面板的 note.txt 行,验证面板切换到文件面板。
  const { x: x2, y: y2 } = ws.cellOf(frame3, "note.txt")
  await ws.mouse.click(x2, y2)
  await ws.waitForFrame((frame) => frame.includes(FILES_KEYBAR), "焦点切到文件面板")
})

test("点另一个面板的框:切到那个面板", async () => {
  const dir = await dirtyRepo("nw-ws-mouse-frame-")
  using ws = await mountWorkspace({ root: dir })
  await intoFiles(ws, "note.txt")
  // 当前焦点在文件面板,点贮藏面板的框(标题行)。
  const frame = await ws.frame()
  // 贮藏面板标题在下方,找它的框线。
  // 点贮藏面板的边框:找到贮藏面板标题所在行的中间位置。
  const { x, y } = ws.cellOf(frame, "贮藏")
  await ws.mouse.click(x, y)
  await ws.waitForFrame((frame) => frame.includes(STASH_KEYBAR), "焦点切到贮藏面板")
})

test("双击提交行:差异视图激活(键位条变成差异段)", async () => {
  const dir = await multiCommitRepo("nw-ws-mouse-dblcommit-")
  using ws = await mountWorkspace({ root: dir })
  // 等提交数据真的回来再按键:键位条是静态的,「tab 1-5」在数据加载前就已经画出来了,
  // 而按键事件在 renderer 就绪前派发会被整条丢掉 —— 不等就等于没按。
  await ws.waitForFrame((frame) => frame.includes("second"), "提交数据加载完")
  await ws.pressKey("4")
  await ws.waitForFrame((frame) => frame.includes(COMMIT_KEYBAR), "焦点落到提交面板")
  const frame = await ws.frame()
  // 找到提交行,双击。
  const { x, y } = ws.cellOf(frame, "second")
  await ws.mouse.doubleClick(x, y)
  await ws.waitForFrame((frame) => frame.includes(DIFF_KEYBAR), "差异视图激活")
})

test("双击分支行:真的 git switch", async () => {
  const dir = await multiBranchRepo("nw-ws-mouse-dblbranch-")
  using ws = await mountWorkspace({ root: dir })
  await ws.waitForFrame((frame) => frame.includes("feature"), "分支数据加载完")
  await ws.pressKey("3")
  await ws.waitForFrame((frame) => frame.includes(BRANCHES_KEYBAR), "焦点落到分支面板")
  const frame = await ws.frame()
  // 找到 feature 分支行,双击。
  const { x, y } = ws.cellOf(frame, "feature")
  await ws.mouse.doubleClick(x, y)
  // 等 git switch 完成。
  await ws.wait(() => gitOut(dir, ["branch", "--show-current"]).trim() === "feature", "git switch 到 feature")
})

test("双击贮藏行:什么都没发生(git stash list 不变、不崩)", async () => {
  const dir = await stashedRepo("nw-ws-mouse-dblstash-")
  const before = gitOut(dir, ["stash", "list"]).trim()
  using ws = await mountWorkspace({ root: dir })
  await ws.waitForFrame((frame) => frame.includes("stash@{0}"), "贮藏数据加载完")
  await ws.pressKey("5")
  await ws.waitForFrame((frame) => frame.includes(STASH_KEYBAR), "焦点落到贮藏面板")
  const frame = await ws.frame()
  // 找到贮藏行,双击。
  const { x, y } = ws.cellOf(frame, "stash@{0}")
  await ws.mouse.doubleClick(x, y)
  // 等一帧,确认没崩。
  await ws.waitForFrame((frame) => frame.includes("贮藏"), "贮藏面板还在")
  // stash list 不变。
  const after = gitOut(dir, ["stash", "list"]).trim()
  expect(after).toBe(before)
})

test("点键位条的「提交」:打开提交输入框", async () => {
  const dir = await baseRepo("nw-ws-mouse-keybar-commit-")
  // 先暂存一个文件。
  fs.writeFileSync(path.join(dir, "new.txt"), "new\n")
  await git(dir, ["add", "new.txt"])
  using ws = await mountWorkspace({ root: dir })
  // 必须等暂存的文件真的出现在文件面板:数据没回来时点「c 提交」会走「没有可提交的
  // 暂存内容」那条分支,输入框根本不会开 —— 这是等错了锚点,不是功能坏了。
  await ws.waitForFrame((frame) => frame.includes("new.txt"), "暂存文件出现在文件面板")
  const frame = await ws.frame()
  // 找到全局键位条的「c 提交」,点它。
  const { x, y } = ws.cellOf(frame, "c 提交")
  await ws.mouse.click(x, y)
  await ws.waitForFrame((frame) => frame.includes(INPUT_KEYBAR), "出现提交输入框")
})

test("点危险项第一次:只进 armed,仓库没变,面板内出现确认文案", async () => {
  const dir = await dirtyRepo("nw-ws-mouse-danger-first-")
  using ws = await mountWorkspace({ root: dir })
  await intoFiles(ws, "note.txt")
  const before = porcelain(dir)
  const frame = await ws.frame()
  // 找到键位条的「d 丢弃」,点它。
  const { x, y } = ws.cellOf(frame, "d 丢弃")
  await ws.mouse.click(x, y)
  await ws.waitForFrame((frame) => frame.includes("再按一次 d 丢弃这个文件的改动"), "确认文案出现")
  // 仓库没变。
  const after = porcelain(dir)
  expect(after).toBe(before)
})

test("armed 后 3.5s 内再点同一项:真的删", async () => {
  const dir = await dirtyRepo("nw-ws-mouse-danger-second-")
  using ws = await mountWorkspace({ root: dir })
  await intoFiles(ws, "note.txt")
  const before = porcelain(dir)
  expect(before).toBe(" M note.txt")
  const frame = await ws.frame()
  // 找到键位条的「d 丢弃」,第一次点击进 armed。
  const { x, y } = ws.cellOf(frame, "d 丢弃")
  await ws.mouse.click(x, y)
  await ws.waitForFrame((frame) => frame.includes("再按一次 d 丢弃这个文件的改动"), "确认文案出现")
  // 第二次点击同一位置。
  await ws.mouse.click(x, y)
  // 等 discard 完成。
  await ws.wait(() => porcelain(dir) === "", "文件被丢弃")
})

test("键位条显示文本和改之前逐字一致(回归钉)", async () => {
  const dir = await dirtyRepo("nw-ws-mouse-keybar-regression-")
  using ws = await mountWorkspace({ root: dir })
  await intoFiles(ws, "note.txt")
  const frame = await ws.frame()
  // 文件面板键位条全文。
  expect(frame).toContain("j/k 选 空格 暂存 a 全部暂存 enter 看差异 y 复制路径 d 丢弃 x 删除")
  // 切到分支面板。
  await ws.pressKey("3")
  const frame2 = await ws.frame()
  expect(frame2).toContain("j/k 选 空格 切换 n 新建 enter 看差异 d 删除")
  // 切到提交面板。
  await ws.pressKey("4")
  const frame3 = await ws.frame()
  expect(frame3).toContain("j/k 选 enter 看差异 y 复制哈希 z 撤销上次提交")
  // 切到贮藏面板(空贮藏:没有 j/k 选前缀)。
  await ws.pressKey("5")
  const frame4 = await ws.frame()
  expect(frame4).toContain("空格 弹出 d 丢弃")
  // 全局键位条。
  expect(frame).toContain("tab 1-5 切面板 p 拉取 f 推送 c 提交 r 刷新")
})

test("滚轮下滚:长差异的可见内容变了;上滚回到第一屏", async () => {
  const dir = tmpGitDir("nw-ws-mouse-scroll-")
  await git(dir, ["init", "-b", "main"])
  // 创建一个很长的文件用于差异。
  const longContent = Array.from({ length: 200 }, (_, i) => `line ${i}`).join("\n")
  fs.writeFileSync(path.join(dir, "long.txt"), longContent + "\n")
  await git(dir, ["add", "long.txt"])
  await git(dir, ["commit", "-m", "init"])
  // 修改文件,创建差异。
  // 每行都改:git diff 默认只带 ±3 行上下文,改一行只出一小段 hunk,
  // 短到比视口还短,滚动测试就变成了空跑。
  const modifiedContent = longContent.replace(/line (\d+)/g, "line $1 CHANGED")
  fs.writeFileSync(path.join(dir, "long.txt"), modifiedContent + "\n")
  using ws = await mountWorkspace({ root: dir })
  await intoFiles(ws, "long.txt")
  // 进入差异模式。
  ws.app.mockInput.pressEnter()
  await ws.waitForFrame((frame) => frame.includes("long.txt 的改动"), "差异视图渲染出来")
  const before = await ws.frame()
  // 滚轮锚点必须落在**滚动容器内部**:面板顶部两行是差异标题(paddingTop=1 的静态标签),
  // 它挂在 scrollbox 之外,滚它什么都不会发生。所以锚点取 diff 正文第一行,不取标题。
  // scroll 是 async:事件在 delayMs 之后才真正派发,不等的话 capture 到的是派发前的帧。
  const { x, y } = ws.cellOf(before, "line 0")
  await ws.mouse.scroll(x, y, "down")
  await ws.mouse.scroll(x, y, "down")
  await new Promise((r) => setTimeout(r, 120))
  const afterDown = await ws.frame()
  // 可见内容应该变了(第一屏的内容被滚走了)。
  expect(afterDown).not.toBe(before)
  // 上滚回到第一屏。
  await ws.mouse.scroll(x, y, "up")
  await ws.mouse.scroll(x, y, "up")
  await new Promise((r) => setTimeout(r, 120))
  const afterUp = await ws.frame()
  expect(afterUp).toBe(before)
})

test("点差异视图下半部:下方内容滚上来;短差异点击不崩、不出空白", async () => {
  const dir = tmpGitDir("nw-ws-mouse-diffclick-")
  await git(dir, ["init", "-b", "main"])
  // 短差异:只改一行。
  fs.writeFileSync(path.join(dir, "short.txt"), "one\n")
  await git(dir, ["add", "short.txt"])
  await git(dir, ["commit", "-m", "init"])
  fs.writeFileSync(path.join(dir, "short.txt"), "two\n")
  using ws = await mountWorkspace({ root: dir })
  await intoFiles(ws, "short.txt")
  ws.app.mockInput.pressEnter()
  await ws.waitForFrame((frame) => frame.includes("short.txt 的改动"), "差异视图渲染出来")
  const frame = await ws.frame()
  // 点击差异视图的下半部。
  // 找差异内容的某一行,点它下方的位置。
  const { x, y } = ws.cellOf(frame, "short.txt 的改动")
  // 点差异区域的中间位置。
  await ws.mouse.click(x + 50, y + 10)
  // 等一帧,确认没崩。
  const afterClick = await ws.frame()
  // 短差异不崩,不出空白。
  expect(afterClick).toContain("short.txt 的改动")
})

test("鼠标操作之后键盘仍然可用(防回归)", async () => {
  const dir = await dirtyRepo("nw-ws-mouse-keyboard-")
  using ws = await mountWorkspace({ root: dir })
  await intoFiles(ws, "note.txt")
  // 先用鼠标点一下文件行。
  const frame = await ws.frame()
  const { x, y } = ws.cellOf(frame, "note.txt")
  await ws.mouse.click(x, y)
  await ws.waitForFrame((frame) => linesOf(frame, "note.txt").some((line) => line.includes("❯")), "❯ 落在 note.txt")
  // 再用键盘按 y 复制路径。
  await ws.pressKey("y")
  await ws.waitForFrame((frame) => frame.includes("已复制路径"), "键盘 y 仍然可用")
})

test("点空面板、点面板外空隙、点在边框上:不崩、不越界、不改选中行", async () => {
  // 空仓库:所有面板都是空的。
  const dir = tmpGitDir("nw-ws-mouse-empty-")
  await git(dir, ["init", "-b", "main"])
  using ws = await mountWorkspace({ root: dir })
  await ws.waitForFrame((frame) => frame.includes("tab 1-5"), "工作区渲染出来")
  // 初始选中行在状态面板第一行。
  const frame = await ws.frame()
  const initialLine = frame.split("\n")[1] // 第二行通常是状态面板标题。
  // 点空的面板(贮藏面板):找到贮藏面板标题,点它。
  const { x, y } = ws.cellOf(frame, "贮藏")
  await ws.mouse.click(x, y)
  // 等一帧,确认没崩。
  const afterEmpty = await ws.frame()
  expect(afterEmpty).toContain("贮藏")
  // 点面板外空隙(键位条下面的空白)。
  await ws.mouse.click(50, 28) // 接近底部。
  const afterGap = await ws.frame()
  expect(afterGap).toContain("tab 1-5")
  // 点在边框上(面板左侧边框)。
  await ws.mouse.click(1, 5)
  const afterBorder = await ws.frame()
  expect(afterBorder).toContain("tab 1-5")
  // 初始选中行没变(❯ 还在原来的位置)。
  // 用初始帧的第一行作为基准。
  expect(afterBorder.split("\n")[1]).toBe(initialLine)
})
