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

/**
 * 行内输入的标题。三处共用一个组件,标题是区分来源的唯一可见投影:
 * 断言标题就等于断言「打开的是这一处,不是另外两处」。
 */
const COMMIT_TITLE = "提交信息"
const BRANCH_TITLE = "新建分支"
const REMOTE_TITLE = "远端地址"

/**
 * 等数据加载完再跳分支面板。不能在挂载后立即按键:renderer 就绪前派发的事件会被丢掉,
 * 于是「按 3」毫无反应,断言只能一直等到超时。
 */
async function intoBranchesPanel(ws: {
  pressKey: (name: string) => Promise<void>
  waitForFrame: (pred: (frame: string) => boolean, what: string) => Promise<void>
}) {
  await ws.waitForFrame((frame) => linesOf(frame, "分支").length > 0, "状态面板渲染出来")
  await ws.pressKey("3")
  await ws.waitForFrame((frame) => frame.includes(BRANCHES_KEYBAR), "焦点落到分支面板")
}

test("分支面板 n:行内输入建分支并切过去", async () => {
  const dir = await baseRepo("nw-ws-act-new-")
  using ws = await mountWorkspace({ root: dir })
  await intoBranchesPanel(ws)
  await ws.pressKey("n")
  await ws.waitForFrame((frame) => frame.includes(BRANCH_TITLE), "出现「新建分支」输入框")
  for (const key of ["f", "e", "a", "t", "/", "u", "i"]) await ws.pressKey(key)
  ws.app.mockInput.pressEnter()
  await ws.wait(() => gitOut(dir, ["branch", "--show-current"]).trim() === "feat/ui", "git switch -c 切到 feat/ui")
})

test("分支面板 n:打字的字母不触发工作区命令(jkd 就是分支名)", async () => {
  const dir = await baseRepo("nw-ws-act-new-letters-")
  await git(dir, ["branch", "other"])
  using ws = await mountWorkspace({ root: dir })
  await intoBranchesPanel(ws)
  // main 是当前分支画 ● 不画 ❯(两个标记抢一格),所以先 j 下移到 other,
  // 才有可见的 ❯ 能当「焦点行没被动过」的锚点。
  await ws.pressKey("j")
  await ws.waitForFrame((frame) => linesOf(frame, "other").some((line) => line.includes("❯")), "焦点下移到 other")
  await ws.pressKey("n")
  await ws.waitForFrame((frame) => frame.includes(BRANCH_TITLE), "出现「新建分支」输入框")
  for (const key of ["j", "k", "d"]) await ws.pressKey(key)
  await ws.waitForFrame(
    (frame) => linesOf(frame, "other").some((line) => line.includes("❯")),
    "打完字之后焦点行仍是 other,三个字母没有一个变成移动光标",
  )
  ws.app.mockInput.pressEnter()
  await ws.wait(() => gitOut(dir, ["branch", "--show-current"]).trim() === "jkd", "jkd 真的进了分支名")
})

test("分支面板 n:esc 取消后输入框消失、没建分支,能重新打开", async () => {
  const dir = await baseRepo("nw-ws-act-new-esc-")
  using ws = await mountWorkspace({ root: dir })
  await intoBranchesPanel(ws)
  await ws.pressKey("n")
  await ws.waitForFrame((frame) => frame.includes(BRANCH_TITLE), "出现「新建分支」输入框")
  ws.app.mockInput.pressEscape()
  expect(await ws.frame()).not.toContain(BRANCH_TITLE)
  expect(gitOut(dir, ["branch", "--format=%(refname:short)"]).trim().split("\n").length).toBe(1)
  await ws.pressKey("n")
  await ws.waitForFrame((frame) => frame.includes(BRANCH_TITLE), "esc 之后能重新打开")
})

test("分支面板 n:非法分支名提交后回中文提示", async () => {
  const dir = await baseRepo("nw-ws-act-new-bad-")
  using ws = await mountWorkspace({ root: dir })
  await intoBranchesPanel(ws)
  await ws.pressKey("n")
  await ws.waitForFrame((frame) => frame.includes(BRANCH_TITLE), "出现「新建分支」输入框")
  for (const key of ["b", "a", "d", "!", "?"]) await ws.pressKey(key)
  ws.app.mockInput.pressEnter()
  // 失败路径不能静默:输入框关掉之后,原因必须出现在提示行(与 pull/push 失败同一口径)。
  await ws.waitForFrame((frame) => frame.includes("git 执行失败"), "提示行给出失败原因")
  await ws.wait(() => gitOut(dir, ["branch", "--show-current"]).trim() === "main", "仓库分支没变")
})

test("暂存后按 c:行内输入提交,真的产生一条提交", async () => {
  const dir = await baseRepo("nw-ws-act-commit-")
  fs.writeFileSync(path.join(dir, "a.txt"), "a\n")
  await git(dir, ["add", "a.txt"])
  using ws = await mountWorkspace({ root: dir })
  await ws.waitForFrame((frame) => frame.includes("a.txt"), "文件面板加载出待提交文件")
  await ws.pressKey("c")
  await ws.waitForFrame((frame) => frame.includes(COMMIT_TITLE), "出现「提交信息」输入框")
  for (const key of ["m", "y", "c"]) await ws.pressKey(key)
  ws.app.mockInput.pressEnter()
  await ws.wait(() => gitOut(dir, ["log", "-1", "--format=%s"]).trim() === "myc", "git log 出现该提交信息")
  await ws.wait(() => porcelain(dir) === "", "工作区干净,提交真的落地了")
})

test("没有暂存内容按 c:中文提示,不打开输入框", async () => {
  const dir = await baseRepo("nw-ws-act-commit-empty-")
  using ws = await mountWorkspace({ root: dir })
  await ws.waitForFrame((frame) => linesOf(frame, "分支").length > 0, "状态面板渲染出来")
  await ws.pressKey("c")
  // 提示行 detail 只留 17 列,「没有可提交的暂存内容」按列宽截断成前 8 个字 ——
  // 断言取截断后确实可见的前缀,顺带把这条宽度约束钉在测试里。
  await ws.waitForFrame(
    (frame) => frame.includes("没有可提交的暂存") && !frame.includes(COMMIT_TITLE),
    "提示行给出「没有可提交的暂存」,且没有输入框",
  )
})

test("状态面板空格:无远端时行内输入添加远程", async () => {
  const dir = await baseRepo("nw-ws-act-remote-")
  using ws = await mountWorkspace({ root: dir })
  await ws.waitForFrame((frame) => frame.includes("未配置远端"), "远程行显示未配置远端")
  await ws.pressKey("j")
  await ws.waitForFrame((frame) => linesOf(frame, "未配置远端").some((line) => line.includes("❯")), "焦点落在远程行")
  await ws.pressKey(" ")
  await ws.waitForFrame((frame) => frame.includes(REMOTE_TITLE), "出现「远端地址」输入框")
  for (const key of ["g", "i", "t"]) await ws.pressKey(key)
  ws.app.mockInput.pressEnter()
  // git remote -v 用 **tab** 分隔名字和地址,不是空格。
  await ws.wait(() => gitOut(dir, ["remote", "-v"]).includes("origin\tgit"), "git remote -v 出现 origin")
})

test("输入框空着按 enter:不提交也不关闭,等用户真正打完字", async () => {
  const dir = await baseRepo("nw-ws-act-empty-input-")
  fs.writeFileSync(path.join(dir, "a.txt"), "a\n")
  await git(dir, ["add", "a.txt"])
  using ws = await mountWorkspace({ root: dir })
  await ws.waitForFrame((frame) => frame.includes("a.txt"), "文件面板加载出待提交文件")
  await ws.pressKey("c")
  await ws.waitForFrame((frame) => frame.includes(COMMIT_TITLE), "出现「提交信息」输入框")
  ws.app.mockInput.pressEnter()
  await ws.frame()
  // 空内容被当成「还没打完」而不是「提交空标题」:输入框原样留着,仓库也不动。
  expect(await ws.frame()).toContain(COMMIT_TITLE)
  expect(gitOut(dir, ["log", "-1", "--format=%s"]).trim()).toBe("init")
})
