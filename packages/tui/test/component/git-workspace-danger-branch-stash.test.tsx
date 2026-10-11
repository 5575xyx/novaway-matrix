/** @jsxImportSource @opentui/solid */
//
// 危险操作扩展到分支与贮藏(Task 7)。
//
// 断言真仓库状态而不是内部信号:分支/贮藏的删除最终裁判是 `git branch` 与 `git stash list`,
// 信号值只决定仓库状态变成什么。armed 隔离的判据是 `armedFor` 的分派:文件的面板黄条
// 不能画到分支面板的行上,反之亦然。
import { expect, test } from "bun:test"
import fs from "node:fs"
import path from "node:path"
import { git, gitOut, linesOf, mountWorkspace, tmpGitDir } from "./git-workspace-harness"

/** 一个只有初始提交的仓库。所有用例都需要至少一条提交,状态面板才有分支行。 */
async function baseRepo(prefix: string): Promise<string> {
  const dir = tmpGitDir(prefix)
  await git(dir, ["init", "-b", "main"])
  fs.writeFileSync(path.join(dir, "base.txt"), "base\n")
  await git(dir, ["add", "base.txt"])
  await git(dir, ["commit", "-m", "init"])
  return dir
}

/** 建 `main` 与 `other` 两个分支:git branch 按 refname 字母序输出,main 恒为第一行,
 *  other 恒为第二行 —— 断言里按行号操作才不抖。 */
async function twoBranchRepo(prefix: string): Promise<string> {
  const dir = await baseRepo(prefix)
  await git(dir, ["branch", "other"])
  return dir
}

test("分支面板 d:二次确认才真删除选中分支", async () => {
  const dir = await twoBranchRepo("nw-ws-dg-branch-")
  using ws = await mountWorkspace({ root: dir })
  await ws.waitForFrame((frame) => frame.includes("other"), "分支面板加载完")
  // 3 是分支面板;初始 branchRow=0 是 main(当前分支,画 ●),按 j 挪到 other 那一行。
  // 不 j 的话 ❯ 落在 main 行,而 main 画 ● —— 断言「❯ 在 other」会一直等不到。
  await ws.pressKey("3")
  await ws.pressKey("j")
  await ws.waitForFrame((frame) => linesOf(frame, "other").some((line) => line.includes("❯")), "❯ 落到 other")
  await ws.pressKey("d")
  await ws.waitForFrame((frame) => frame.includes("再按一次 d 删除这个分支"), "底部键位条出现确认文案")
  await ws.pressKey("d")
  await ws.wait(
    () => gitOut(dir, ["branch", "--format=%(refname:short)"]).trim() === "main",
    "git branch 里 other 消失",
  )
  // 当前分支没被动到:状态面板分支行仍是 main。
  await ws.waitForFrame((frame) => linesOf(frame, "main").length > 0, "main 仍在状态面板")
})

test("贮藏面板 d:二次确认才真丢弃选中贮藏", async () => {
  const dir = await baseRepo("nw-ws-dg-stash-")
  fs.writeFileSync(path.join(dir, "base.txt"), "stashed\n")
  await git(dir, ["stash", "push", "-m", "wip"])
  using ws = await mountWorkspace({ root: dir })
  await ws.waitForFrame((frame) => frame.includes("stash@{0}"), "贮藏面板加载完")
  // 5 是贮藏面板;只有一个 stash 项,stashRow=0 就是 stash@{0}。
  // 注意 discard 是「删栈不还原」:贮藏 push 时工作区已经清过,drop 之后工作区依旧干净
  // (与 stash.pop 相反,pop 会把贮藏还原回工作区)。这里断言工作区仍干净才对。
  await ws.pressKey("5")
  await ws.pressKey("d")
  await ws.waitForFrame((frame) => frame.includes("再按一次 d 丢弃这个贮藏"), "底部键位条出现确认文案")
  await ws.pressKey("d")
  await ws.wait(() => gitOut(dir, ["stash", "list"]).trim() === "", "贮藏栈清空")
  await ws.wait(() => gitOut(dir, ["status", "--porcelain"]).trim() === "", "工作区依旧干净")
})

test("分支面板 d:当前分支被拒,提示行给出原因,且没进确认态", async () => {
  const dir = await baseRepo("nw-ws-dg-current-")
  using ws = await mountWorkspace({ root: dir })
  await ws.waitForFrame((frame) => frame.includes("main"), "分支面板加载完")
  // 3 是分支面板;初始 branchRow=0 就是 main —— 当前分支那一行画 ● 不画 ❯。
  // 直接按 d 触发 blockedDanger 前置检查。
  await ws.pressKey("3")
  await ws.waitForFrame((frame) => linesOf(frame, "main").some((line) => line.includes("●")), "● 落在 main")
  await ws.pressKey("d")
  // blockedDanger 拦在前置检查:不进确认态,提示行显示拒绝原因(而非一句「git 执行失败」)。
  // actionHint 挂在状态面板「提示」那一行,所以断言整屏都含该文案即可。
  await ws.waitForFrame((frame) => frame.includes("当前分支不能删除"), "提示行给出拒绝原因")
  await ws.waitForFrame((frame) => !frame.includes("再按一次 d 删除这个分支"), "没进确认态(整屏没有确认文案)")
  await ws.wait(() => gitOut(dir, ["branch", "--format=%(refname:short)"]).trim() === "main", "仓库状态未变")
})

test("armed 隔离:分支面板武装后文件面板不亮黄条,文件面板再武装时分支面板也不受影响", async () => {
  const dir = await baseRepo("nw-ws-dg-isolate-")
  fs.writeFileSync(path.join(dir, "a.txt"), "untracked\n")
  await git(dir, ["branch", "other"])
  using ws = await mountWorkspace({ root: dir })
  await ws.waitForFrame((frame) => frame.includes("other"), "分支面板加载完")
  await ws.waitForFrame((frame) => linesOf(frame, "a.txt").length > 0, "文件面板加载完")

  // 在分支面板武装删除 other:焦点行是分支面板的,文件面板的行不该换文案。
  // 注意:武装后分支面板那一行是 ❯ + 确认文案(不再是 other 名字),
  // 所以断言「❯ 落在 other 行」只到武装前一刻 —— 武装后断言整屏含确认文案即可。
  await ws.pressKey("3")
  await ws.pressKey("j")
  await ws.waitForFrame((frame) => linesOf(frame, "other").some((line) => line.includes("❯")), "❯ 落到 other")
  await ws.pressKey("d")
  await ws.waitForFrame((frame) => frame.includes("再按一次 d 删除这个分支"), "确认文案出现")
  // 文件面板的 a.txt 行仍是普通渲染(未跟踪状态词 + 文件名),没有黄条文案。
  // 贮藏面板此时是空的(（暂无）),也没有「丢弃」的黄条。
  const frame = await ws.frame()
  expect(linesOf(frame, "a.txt").every((line) => !line.includes("再按一次"))).toBe(true)
  expect(frame.includes("（暂无）")).toBe(true)

  // 反向:切到文件面板再武装丢弃。此时 armed.target = { file },分支/贮藏的行都不该有黄条。
  await ws.pressKey("2")
  await ws.pressKey("d")
  await ws.waitForFrame((frame) => frame.includes("再按一次 d 丢弃这个文件的改动"), "确认文案出现(文件)")
  const frame2 = await ws.frame()
  // 分支面板的 main/other 行没有「丢弃这个文件」的黄条文案。
  expect(linesOf(frame2, "main").every((line) => !line.includes("丢弃这个文件"))).toBe(true)
  expect(linesOf(frame2, "other").every((line) => !line.includes("丢弃这个文件"))).toBe(true)
})

test("贮藏面板武装后文件面板不亮黄条,3 秒到期自动清掉确认态", async () => {
  const dir = await baseRepo("nw-ws-dg-timeout-")
  // 两条贮藏 + 一份未跟踪文件,让贮藏与文件面板都有内容可断言。
  fs.writeFileSync(path.join(dir, "base.txt"), "stashed1\n")
  await git(dir, ["stash", "push", "-m", "wip1"])
  fs.writeFileSync(path.join(dir, "base.txt"), "stashed2\n")
  await git(dir, ["stash", "push", "-m", "wip2"])
  fs.writeFileSync(path.join(dir, "a.txt"), "dirty\n")
  using ws = await mountWorkspace({ root: dir })
  await ws.waitForFrame((frame) => frame.includes("stash@{1}"), "贮藏面板加载完两条")
  await ws.waitForFrame((frame) => linesOf(frame, "a.txt").length > 0, "文件面板加载完")

  // 5 是贮藏面板;stashRow=0 就是 stash@{0}(git stash list 里最新的在最上)。
  // 注意:贮藏面板在武装后会把 stash@{0} 那一行整块换成确认文案(与 files-panel 同一
  // 套写法),所以断言「stash@{0} 行含再按一次」会一直等不到 —— 直接断言整屏含确认文案。
  await ws.pressKey("5")
  await ws.pressKey("d")
  await ws.waitForFrame((frame) => frame.includes("再按一次 d 丢弃这个贮藏"), "确认文案出现(贮藏)")
  // 文件面板的 a.txt 行没有贮藏的确认文案 —— armedFor("file") 拿不到 { ref } 目标,返回 undefined。
  const isolatedFrame = await ws.frame()
  expect(linesOf(isolatedFrame, "a.txt").every((line) => !line.includes("再按一次"))).toBe(true)

  // 3 秒到期自动清掉:工作区外壳用真实时钟(没给 GitWorkspace 加时钟注入口),这里就等真时。
  // 外壳的 setInterval 每 100ms 探一次 confirm.pending(),到期那次把 armed 清成 undefined,
  // 底部键位条与面板行都不会再画确认文案。
  await new Promise((resolve) => setTimeout(resolve, 3500))
  await ws.waitForFrame((frame) => !frame.includes("再按一次 d 丢弃这个贮藏"), "3 秒到期后确认态自动清掉")
  // 没按第二次,贮藏没被丢。
  await ws.wait(
    () =>
      gitOut(dir, ["stash", "list"])
        .split("\n")
        .filter((l) => l.length > 0).length === 2,
    "贮藏栈仍是 2 条",
  )
})
