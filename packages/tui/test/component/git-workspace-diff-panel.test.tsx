/** @jsxImportSource @opentui/solid */
import { afterAll, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import fs from "fs"
import os from "os"
import path from "path"
import { GitDiffPanel, type DiffTarget } from "../../src/component/git-workspace/diff-panel"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"
import { KVProvider } from "../../src/context/kv"
import { ThemeProvider } from "../../src/context/theme"
import { TuiConfigProvider } from "../../src/config"
import { TestTuiContexts } from "../fixture/tui-environment"

async function withPanel(target: DiffTarget, rootPath: string) {
  const app = await testRender(
    () => (
      <TestTuiContexts>
        <TuiConfigProvider config={createTuiResolvedConfig()}>
          <KVProvider>
            <ThemeProvider mode="dark">
              <GitDiffPanel target={target} rootPath={rootPath} />
            </ThemeProvider>
          </KVProvider>
        </TuiConfigProvider>
      </TestTuiContexts>
    ),
    { width: 80, height: 24 },
  )
  await app.renderOnce()
  await new Promise((resolve) => setTimeout(resolve, 25))
  await app.renderOnce()
  return app
}

/** 只拿同步帧(标题/引导文案用):渲染完就断言,然后拆掉。 */
async function syncFrame(target: DiffTarget, rootPath = process.cwd()) {
  const app = await withPanel(target, rootPath)
  try {
    for (let attempt = 0; attempt < 5; attempt++) {
      const frame = app.captureCharFrame()
      if (frame.trim().length > 0) return frame
      await new Promise((resolve) => setTimeout(resolve, 25))
      await app.renderOnce()
    }
    return app.captureCharFrame()
  } finally {
    app.renderer.destroy()
  }
}

/**
 * 等异步结果画到帧上。
 *
 * 不能用 app.waitForFrame():它只反复 capture,不驱动渲染 —— 而测试渲染器不会因为信号变了
 * 就自动重绘(实测 cellsUpdated 恒为 0,20 轮全空转)。真 TUI 有常驻渲染循环,测试里得自己推。
 */
async function settleFrame(app: Awaited<ReturnType<typeof testRender>>, hit: (frame: string) => boolean) {
  for (let attempt = 0; attempt < 40; attempt++) {
    await app.renderOnce()
    const frame = app.captureCharFrame()
    if (hit(frame)) return frame
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error(`谓词始终没命中,最后一帧:\n${app.captureCharFrame()}`)
}

// 下面起真 git 子进程 —— 口径照抄 test/component/git-workspace-state.test.ts。
// 用真仓库是因为本组件的产出完全由 git 决定:mock 掉 git 就等于在测自己写的假数据。
const tmpDirs: string[] = []
function tmpDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  tmpDirs.push(dir)
  return dir
}

afterAll(() => {
  for (const dir of tmpDirs) {
    // Windows 上 git 子进程刚退出时目录句柄可能还没释放完,rm 会 EBUSY。
    // 临时目录,清不掉也无妨,别让它把测试结果带红。
    try {
      fs.rmSync(dir, { recursive: true, force: true })
    } catch {}
  }
  tmpDirs.length = 0
})

const exec = promisify(execFile)
const git = (root: string, args: string[]) =>
  exec("git", ["-c", "user.email=tui@example.com", "-c", "user.name=tui", ...args], { cwd: root })

test("没有目标时显示引导文案,不空白", async () => {
  expect(await syncFrame({ kind: "none" })).toContain("选中文件或提交后在这里看改动")
})

test("目标是文件时标题带上文件名", async () => {
  expect(await syncFrame({ kind: "file", path: "src/component/git-workspace.tsx" })).toContain("的改动")
})

test("目标是提交时标题带提交前缀", async () => {
  expect(await syncFrame({ kind: "commit", hash: "40f2c3c" })).toContain("提交 40f2c3c")
})

test("改动内容真的画出来(等 git 回来,不是断言初始帧)", async () => {
  // 这条才是面板的核心职责。标题是同步渲染的,初始帧非空,所以**不能**直接 captureCharFrame
  // —— 那样只测到标题,git 还没回来。必须 waitForFrame 等到补丁正文出现。
  const dir = tmpDir("nw-dpanel-diff-")
  await git(dir, ["init", "-b", "main"])
  fs.writeFileSync(path.join(dir, "a.txt"), "原样\n")
  await git(dir, ["add", "."])
  await git(dir, ["commit", "-m", "init"])
  fs.writeFileSync(path.join(dir, "a.txt"), "改过\n")

  const app = await withPanel({ kind: "file", path: "a.txt" }, dir)
  try {
    // 渲染出来是「1 + 改过」——行号、符号、内容之间都带空格,别写成 "+改过" 匹配不到。
    const frame = await settleFrame(app, (f) => f.includes("+ 改过"))
    expect(frame).toContain("- 原样")
  } finally {
    app.renderer.destroy()
  }
})

test("git 报错时显示错误,而不是空白或假补丁", async () => {
  // 非仓库目录里 git diff HEAD 直接 fatal(`Could not access 'HEAD'`),且它不含 isMissingHead
  // 认的串,所以必须上抛 → 面板显示错误。同样只能等 settle 后断言:初始帧里没有错误文本。
  const dir = tmpDir("nw-dpanel-norepo-")
  const app = await withPanel({ kind: "file", path: "any.txt" }, dir)
  try {
    const frame = await settleFrame(app, (f) => f.includes("Could not access"))
    expect(frame).not.toContain("没有改动")
  } finally {
    app.renderer.destroy()
  }
})
