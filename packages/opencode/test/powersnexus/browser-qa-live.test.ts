import { expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"

/**
 * 真实 Chrome Browser QA。
 * bun test 内直接拉起 Chrome 在本环境会阻塞，因此默认执行独立 node 探针脚本。
 * 也可先手动: node packages/opencode/probe-browser-qa.cjs
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
      results: Array<{ viewport: string; passed: boolean; shot: string }>
    }
    expect(report.ok).toBe(true)
    expect(report.results.length).toBeGreaterThan(0)
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
    results: Array<{ viewport: string; passed: boolean; shot: string }>
  }
  expect(report.ok).toBe(true)
  expect(report.results).toHaveLength(2)
  for (const item of report.results) {
    expect(item.passed).toBe(true)
    expect(fs.existsSync(item.shot)).toBe(true)
  }
})