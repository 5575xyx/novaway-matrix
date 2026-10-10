/** @jsxImportSource @opentui/solid */
//
// 外壳接线:状态行「空格」按当前行分派(规格「状态」),以及四个基础操作
// (切换分支 / 撤销上次提交 / 弹出贮藏 / 新建分支入口)。
//
// 每个用例一个真 git 临时仓库,断言真 git 输出而不是内部信号:
// 这套交互的最终裁判是仓库状态,信号值只决定仓库状态变成什么。
//
// 焦点在哪靠**底部键位条**判断,不靠 ❯:聚焦面板的边框颜色在字符帧里不可见,
// 而 ❯ 在当前分支那一行让位给 ●(branches-panel.tsx 里两个标记抢一格)。
// 键位条文案是焦点面板的唯一可见投影(keybarText),拿它当断言锚点。
import { expect, test } from "bun:test"
import fs from "node:fs"
import path from "node:path"
import { git, gitOut, linesOf, mountWorkspace, porcelain, tmpGitDir } from "./git-workspace-harness"

/** 底部键位条里只有分支面板才有这一段 —— 用它断言焦点真的落到了分支面板。 */
const BRANCHES_KEYBAR = "n 新建"

/** 一个只有初始提交的仓库。所有用例都需要至少一条提交,状态面板才有分支行。 */
async function baseRepo(prefix: string): Promise<string> {
  const dir = tmpGitDir(prefix)
  await git(dir, ["init", "-b", "main"])
  fs.writeFileSync(path.join(dir, "base.txt"), "base\n")
  await git(dir, ["add", "base.txt"])
  await git(dir, ["commit", "-m", "init"])
  return dir
}

test("状态行按空格:选中分支行跳到分支面板", async () => {
  const dir = await baseRepo("nw-ws-act-sp-branch-")
  using ws = await mountWorkspace({ root: dir })
  await ws.waitForFrame((frame) => linesOf(frame, "分支").length > 0, "状态面板渲染出来")
  // 初始 statusRow 是 0,即分支行。
  await ws.pressKey(" ")
  await ws.waitForFrame((frame) => frame.includes(BRANCHES_KEYBAR), "焦点落到分支面板")
})

test("状态行按空格:选中远程行切到下一个远端", async () => {
  const dir = await baseRepo("nw-ws-act-sp-remote-")
  // 两个远端都用 URL 形式:本地路径会让 git 把它们当裸仓库,后续 fetch 行为不同。
  await git(dir, ["remote", "add", "origin", "https://example.com/org/a.git"])
  await git(dir, ["remote", "add", "gitee", "https://example.com/org/b.git"])
  using ws = await mountWorkspace({ root: dir })
  await ws.waitForFrame((frame) => frame.includes("origin"), "默认远端选中 origin")
  await ws.pressKey("j")
  await ws.waitForFrame((frame) => linesOf(frame, "远程").some((line) => line.includes("❯")), "❯ 落在远程行")
  await ws.pressKey(" ")
  await ws.waitForFrame((frame) => linesOf(frame, "gitee").some((line) => line.includes("❯")), "切到下一个远端 gitee")
})

test("状态行按空格:选中变更行全部暂存", async () => {
  const dir = await baseRepo("nw-ws-act-sp-stage-")
  // 改已跟踪文件而不是新增未跟踪文件:暂存后两者的 porcelain 前缀不同(M 与 A),
  // 用 M 断言不会把「add 了别的东西」误判成全暂存。
  fs.writeFileSync(path.join(dir, "base.txt"), "changed\n")
  using ws = await mountWorkspace({ root: dir })
  await ws.waitForFrame(
    (frame) => linesOf(frame, "变更").some((line) => line.includes("1 个文件")),
    "数据加载完(1 个未暂存文件)",
  )
  await ws.pressKey("j")
  await ws.pressKey("j")
  await ws.waitForFrame((frame) => linesOf(frame, "变更").some((line) => line.includes("❯")), "❯ 落在变更行")
  await ws.pressKey(" ")
  await ws.wait(() => porcelain(dir) === "M  base.txt", "全部暂存")
})

test("提交面板 z:回退最近一次提交到暂存区", async () => {
  const dir = await baseRepo("nw-ws-act-undo-")
  fs.writeFileSync(path.join(dir, "c2.txt"), "c2\n")
  await git(dir, ["add", "c2.txt"])
  await git(dir, ["commit", "-m", "second"])
  fs.writeFileSync(path.join(dir, "c3.txt"), "c3\n")
  await git(dir, ["add", "c3.txt"])
  await git(dir, ["commit", "-m", "third"])
  using ws = await mountWorkspace({ root: dir })
  await ws.waitForFrame((frame) => frame.includes("third"), "提交面板加载完 3 条提交")
  await ws.pressKey("4")
  await ws.pressKey("z")
  await ws.wait(() => gitOut(dir, ["log", "--oneline"]).trim().split("\n").length === 2, "回退后剩 2 条提交")
  // --soft 只挪 HEAD:索引与工作区都不动,所以 c3 回到暂存区。
  await ws.wait(() => porcelain(dir) === "A  c3.txt", "c3 回到暂存区")
})

test("贮藏面板空格:弹出贮藏并清空贮藏栈", async () => {
  const dir = await baseRepo("nw-ws-act-stash-")
  fs.writeFileSync(path.join(dir, "base.txt"), "stashed\n")
  await git(dir, ["stash", "push", "-m", "wip"])
  using ws = await mountWorkspace({ root: dir })
  await ws.waitForFrame((frame) => frame.includes("stash@{0}"), "贮藏面板加载完")
  await ws.pressKey("5")
  await ws.pressKey(" ")
  await ws.wait(() => gitOut(dir, ["stash", "list"]).trim() === "", "贮藏栈清空")
  await ws.wait(() => porcelain(dir) === " M base.txt", "贮藏的改动回到工作区")
})

test("分支面板空格:切换到选中的分支", async () => {
  const dir = await baseRepo("nw-ws-act-checkout-")
  // 两个分支名刻意都不含 m:git branch 按 refname 字母序输出,main 会落到列表中间,
  // 而当前分支那一行画的是 ● 不是 ❯ —— ❯ 只能出现在非当前分支上,断言才有抓手。
  await git(dir, ["branch", "alpha"])
  await git(dir, ["branch", "beta"])
  using ws = await mountWorkspace({ root: dir })
  await ws.waitForFrame((frame) => frame.includes("beta"), "分支加载完")
  await ws.pressKey("3")
  await ws.waitForFrame((frame) => frame.includes(BRANCHES_KEYBAR), "焦点落到分支面板")
  await ws.waitForFrame((frame) => linesOf(frame, "alpha").some((line) => line.includes("❯")), "初始行是 alpha")
  await ws.pressKey("j")
  await ws.waitForFrame((frame) => linesOf(frame, "beta").some((line) => line.includes("❯")), "j 之后 ❯ 落到 beta")
  await ws.pressKey(" ")
  await ws.wait(() => gitOut(dir, ["branch", "--show-current"]).trim() === "beta", "切到 beta")
  // beta 变成当前分支后 ● 取代 ❯:这一步证明刷新真把列表重画了,而不是只改了 git 仓库。
  await ws.waitForFrame((frame) => linesOf(frame, "beta").some((line) => line.includes("●")), "beta 行变成当前分支")
})

test("分支面板 n:打开新建分支入口(信号已声明,渲染留到 Task 8)", async () => {
  const dir = await baseRepo("nw-ws-act-new-")
  using ws = await mountWorkspace({ root: dir })
  await ws.waitForFrame((frame) => linesOf(frame, "分支").length > 0, "状态面板渲染出来")
  await ws.pressKey("3")
  await ws.pressKey("n")
  // Task 8 接上 <InlineInput> 之后,这里会升级成断言「新建分支」标题出现;
  // 现在只断言按键没把面板弄坏 —— 万一哪天回归成整屏白屏,这个断言会红。
  await ws.waitForFrame(
    (frame) => frame.includes(BRANCHES_KEYBAR) && linesOf(frame, "main").length > 0,
    "n 之后分支面板仍在",
  )
  const commits = gitOut(dir, ["log", "--oneline"]).trim().split("\n").length
  expect(commits).toBe(1)
})
