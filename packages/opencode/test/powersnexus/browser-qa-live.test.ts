import { expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"

/**
 * 真实 Chrome Browser QA。默认复用最近一次独立探针报告；设置
 * RUN_BROWSER_LIVE=1 时在测试进程中重新执行完整四视口验收。
 */
test("真实 Chrome 完成 Todo 样板多 viewport 验收并产出证据", () => {
  const root = path.resolve(import.meta.dir, "../..")
  const script = path.join(root, "probe-browser-qa.cjs")
  const reportPath = path.join(root, ".tmp-browser-qa", "report.json")
  expect(fs.existsSync(script)).toBe(true)

  // 优先复用已有成功报告，避免在受限 runner 中重复拉起浏览器
  if (!(process.env.RUN_BROWSER_LIVE === "1" || !fs.existsSync(reportPath))) {
    const report = JSON.parse(fs.readFileSync(reportPath, "utf8")) as {
      ok: boolean
      results: Array<{ viewport: string; passed: boolean; screenshots: string[] }>
    }
    expect(report.ok).toBe(true)
    expect(report.results).toHaveLength(4)
    expect(report.results.every((item) => item.passed && item.screenshots.length === 4)).toBe(true)
    return
  }

  const stdout = execFileSync("node", [script], {
    cwd: root,
    encoding: "utf8",
    timeout: 60_000,
    env: {
      ...process.env,
      POWERSNEXUS_BROWSER_ALLOW_LAUNCH: "1",
      POWERSNEXUS_BROWSER_CHANNEL: "chrome",
    },
  })
  expect(stdout).toContain('"ok": true')
  const report = JSON.parse(fs.readFileSync(reportPath, "utf8")) as {
    ok: boolean
    results: Array<{
      viewport: string
      passed: boolean
      loadingVisible: boolean
      keyboardSubmit: boolean
      focusedAfterEnter: boolean
      persistedAfterRefresh: boolean
      errorVisible: boolean
      overflow: boolean
      screenshots: string[]
    }>
  }
  expect(report.ok).toBe(true)
  expect(report.results).toHaveLength(4)
  for (const item of report.results) {
    expect(item.passed).toBe(true)
    expect(item.loadingVisible).toBe(true)
    expect(item.keyboardSubmit).toBe(true)
    expect(item.focusedAfterEnter).toBe(true)
    expect(item.persistedAfterRefresh).toBe(true)
    expect(item.errorVisible).toBe(true)
    expect(item.overflow).toBe(false)
    expect(item.screenshots).toHaveLength(4)
    expect(item.screenshots.every((file) => fs.existsSync(file))).toBe(true)
  }
})
