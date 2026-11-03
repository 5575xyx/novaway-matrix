import { describe, expect, mock, test } from "bun:test"

// automation.ts / request.ts 在运行时都 import electron；这里只测「拼出来的页面脚本
// 能不能被解析」。上一次踩的坑：TS 模板字符串里的 `\/` 会被吃掉，正则提前结束，
// 生成一串语法错误的脚本 —— 主进程里表现为「静默抓不到任何东西」。
mock.module("electron", () => ({
  net: {},
  session: { fromPartition: () => ({ cookies: { set: async () => {} } }) },
  BrowserWindow: function BrowserWindow() {},
}))

interface CapturedScript {
  code: string
  result: unknown
}

function fakeWindow(result: unknown = false) {
  const captured: CapturedScript[] = []
  const win = {
    isDestroyed: () => false,
    webContents: {
      executeJavaScript: async (code: string) => {
        captured.push({ code, result })
        return result
      },
      debugger: {
        isAttached: () => false,
        attach: () => {},
        detach: () => {},
        sendCommand: async () => ({ root: { nodeId: 1 }, nodeId: 1 }),
      },
    },
  }
  return { win: win as any, captured }
}

const parse = (code: string) => new Function(`return ${code}`)

describe("publish automation scripts", () => {
  test("fillInput / fillEditor / clickByText / hasText / waitForAnySelector 生成的脚本可解析", async () => {
    const automation = await import("./automation")
    const scripts: string[] = []
    const { win, captured } = fakeWindow(true)

    await automation.fillInput(win, ["#title"], "标题")
    await automation.fillEditor(win, [".editor"], "第一行\n第二行")
    await automation.clickByText(win, ["发布", "提交"])
    await automation.hasText(win, ["发布成功"])
    await automation.fillEditor(win, ["iframe#ueditor_0"], "第一行\n第二行")
    await automation.waitForAnySelector(win, ["input[type=file]"], 50)
    for (const item of captured) scripts.push(item.code)

    expect(scripts.length).toBe(6)
    for (const code of scripts) expect(() => parse(code)).not.toThrow()
  })

  test("正文脚本会下钻到同源 iframe（公众号编辑器）", async () => {
    const automation = await import("./automation")
    const { win, captured } = fakeWindow(true)
    await automation.fillEditor(win, ["iframe#ueditor_0"], "正文")
    expect(captured[0].code).toContain("contentDocument")
    expect(captured[0].code).toContain("contentDocument.body")
  })

  test("正文脚本保留换行，不被 TS 模板吃掉", async () => {
    const automation = await import("./automation")
    const { win, captured } = fakeWindow(true)
    await automation.fillEditor(win, [".editor"], "第一行\n第二行")
    // 必须是「反斜杠 + n」（脚本里的转义），而不是模板字符串展开后的真实换行
    expect(captured[0].code).toContain(String.raw`.split("\n")`)
  })
})
