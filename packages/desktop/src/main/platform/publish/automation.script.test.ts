import { describe, expect, mock, test } from "bun:test"

// automation.ts / request.ts 在运行时都 import electron；这里只测「拼出来的页面脚本
// 能不能被解析」。上一次踩的坑：TS 模板字符串里的 `\/` 会被吃掉，正则提前结束，
// 生成一串语法错误的脚本 —— 主进程里表现为「静默抓不到任何东西」。
mock.module("electron", () => ({
  net: {},
  webContents: { getAllWebContents: () => [] },
  session: { fromPartition: () => ({ cookies: { set: async () => {} } }) },
  BrowserWindow: function BrowserWindow() {},
}))

interface CapturedScript {
  code: string
  result: unknown
}

function fakeWindow(result: unknown = false) {
  const captured: CapturedScript[] = []
  const inputEvents: Array<Record<string, unknown>> = []
  const win = {
    isDestroyed: () => false,
    webContents: {
      executeJavaScript: async (code: string) => {
        captured.push({ code, result })
        return result
      },
      sendInputEvent: (event: Record<string, unknown>) => {
        inputEvents.push(event)
      },
      debugger: {
        isAttached: () => false,
        attach: () => {},
        detach: () => {},
        sendCommand: async () => ({ root: { nodeId: 1 }, nodeId: 1 }),
      },
    },
  }
  return { win: win as any, captured, inputEvents }
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

  test("深度查询会走进影子树（视频号的 wujie 微前端）", async () => {
    const automation = await import("./automation")
    const { win, captured } = fakeWindow(true)
    await automation.hasSelector(win, ["div.form-btns button"])
    expect(captured[0].code).toContain("shadowRoot")
    expect(captured[0].code).toContain("contentDocument")
  })

  test("公众号 token 的正则没有被模板字符串吃掉", async () => {
    const automation = await import("./automation")
    const { win, captured } = fakeWindow("")
    await automation.readWechatToken(win)
    const code = captured[0].code
    expect(code).toContain(String.raw`(\d+)`)
    expect(code).toContain(String.raw`\s*\{`)
    expect(() => parse(`async () => (${code})`)).not.toThrow()
  })

  test("坐标点击走真实输入事件（小红书 closed shadow 里的发布按钮）", async () => {
    const automation = await import("./automation")
    const { win, inputEvents } = fakeWindow(undefined)
    await automation.clickAt(win, 320, 480)
    const types = inputEvents.map((event) => event.type)
    expect(types).toEqual(["mouseMove", "mouseMove", "mouseDown", "mouseUp"])
    const down = inputEvents.find((event) => event.type === "mouseDown")!
    expect({ x: down.x, y: down.y, button: down.button }).toEqual({ x: 320, y: 480, button: "left" })
  })

  test("回读比对能容忍 &nbsp; / 零宽字符 / 换行差异", async () => {
    const automation = await import("./automation")
    expect(automation.head("🎉🎉 标题一二三四五六", 3)).toBe("🎉🎉 ")
    const typed = "🎉🎉 标题​一二三"
    expect(automation.normalizeForCompare(typed)).toBe("🎉🎉标题一二三")
  })

  test("批次会保留不支持账号的结果，不会让整批抛错", async () => {
    const runner = await import("./runner")
    const events: Array<{ batchId: string; result: { accountId: string; status: string } }> = []
    const batch = await runner.runPublishBatch(
      [
        { id: "unsupported-1", platform: "unknown-platform", nickname: "测试账号", cookies: "[]" },
        { id: "unsupported-2", platform: "another-unknown-platform", nickname: "测试账号2", cookies: "[]" },
      ],
      { kind: "article", title: "测试", description: "测试内容", filePaths: [] },
      (event) => events.push(event),
      new AbortController().signal,
    )

    expect(batch.finishedAt).toBeNumber()
    expect(batch.results.map((item) => item.status)).toEqual(["unsupported", "unsupported"])
    expect(events.map((event) => event.result.accountId)).toContain("unsupported-1")
    expect(events.map((event) => event.result.accountId)).toContain("unsupported-2")
  })

  test("单个账号预检失败时返回可展示的失败结果", async () => {
    const runner = await import("./runner")
    const batch = await runner.runPublishBatch(
      [{ id: "precheck-1", platform: "xhs", nickname: "测试账号", cookies: "[]" }],
      { kind: "video", title: "测试标题", description: "测试内容", filePaths: [] },
      () => undefined,
      new AbortController().signal,
    )

    expect(batch.results[0].status).toBe("failed")
    expect(batch.results[0].error).toBe("precheck:files-missing")
    expect(batch.results[0].message).toContain("预检未通过")
  })

  test("批次允许一个账号失败而继续产出其他账号结果", async () => {
    const runner = await import("./runner")
    const batch = await runner.runPublishBatch(
      [
        { id: "partial-1", platform: "xhs", nickname: "缺少登录态", cookies: "[]" },
        { id: "partial-2", platform: "unknown-platform", nickname: "不支持账号", cookies: "[]" },
      ],
      { kind: "video", title: "测试标题", description: "测试内容", filePaths: ["C:\\test.mp4"] },
      () => undefined,
      new AbortController().signal,
    )

    expect(batch.results.map((item) => item.status)).toEqual(["failed", "unsupported"])
    expect(batch.results[0].error).toBe("no-cookies")
    expect(batch.results[1].message).toContain("暂不支持")
  })
  test("受控执行器能验证真实批次的结果回传、部分失败和只重试失败账号", async () => {
    const runner = await import("./runner")
    const accounts = [
      { id: "controlled-success", platform: "xhs", nickname: "成功账号", cookies: "[]" },
      { id: "controlled-failed", platform: "douyin", nickname: "失败账号", cookies: "[]" },
    ]
    const calls: string[] = []
    const execute: import("./runner").PublishExecutor = async (account, _input, report) => {
      calls.push(account.id)
      const running = {
        accountId: account.id,
        platform: account.platform,
        nickname: account.nickname,
        status: "running" as const,
        progress: 50,
        message: "平台处理中",
        updatedAt: Date.now(),
      }
      report(running)
      if (account.id === "controlled-failed") {
        return { ...running, status: "failed" as const, progress: 50, message: "平台拒绝", error: "platform-rejected" }
      }
      return {
        ...running,
        status: "success" as const,
        progress: 100,
        message: "平台已确认",
        url: "https://example.test/published/controlled-success",
      }
    }

    const events: Array<{ batchId: string; result: { accountId: string; status: string; url?: string } }> = []
    const input = { kind: "video" as const, title: "受控测试", description: "受控内容", filePaths: ["C:\\test.mp4"] }
    const batch = await runner.runPublishBatch(
      accounts,
      input,
      (event) => events.push(event),
      new AbortController().signal,
      { execute },
    )

    expect(batch.results.map((item) => item.status)).toEqual(["success", "failed"])
    expect(batch.results[0].url).toContain("controlled-success")
    expect(batch.results[1].error).toBe("platform-rejected")
    expect(events.some((event) => event.result.accountId === "controlled-success" && event.result.url)).toBe(true)

    const retryCalls: string[] = []
    const retryBatch = await runner.runPublishBatch(
      accounts.filter((account) => account.id === "controlled-failed"),
      input,
      () => undefined,
      new AbortController().signal,
      {
        execute: async (account) => {
          retryCalls.push(account.id)
          return {
            accountId: account.id,
            platform: account.platform,
            nickname: account.nickname,
            status: "success" as const,
            progress: 100,
            message: "重试后平台已确认",
            url: "https://example.test/published/retried",
            updatedAt: Date.now(),
          }
        },
      },
    )

    expect(calls).toEqual(["controlled-success", "controlled-failed"])
    expect(retryCalls).toEqual(["controlled-failed"])
    expect(retryBatch.results[0].status).toBe("success")
    expect(retryBatch.results[0].url).toContain("retried")
  })
  test("批次在开始前取消时会把排队账号标记为 cancelled", async () => {
    const runner = await import("./runner")
    const controller = new AbortController()
    controller.abort()
    const batch = await runner.runPublishBatch(
      [{ id: "cancelled-1", platform: "xhs", nickname: "测试账号", cookies: "[]" }],
      { kind: "video", title: "测试", description: "测试内容", filePaths: ["C:\\test.mp4"] },
      () => undefined,
      controller.signal,
    )

    expect(batch.results[0].status).toBe("cancelled")
    expect(batch.results[0].message).toBe("已取消")
  })

  test("公众号草稿表单与地址拼装", async () => {
    const automation = await import("./automation")
    const form = automation.wechatDraftForm({ title: "标题", html: "<p>正文</p>" })
    expect(form.get("title0")).toBe("标题")
    expect(form.get("content0")).toBe("<p>正文</p>")
    expect(form.get("isnew")).toBe("0")
    // 没有摘要时让后台自动生成，避免分享卡片空白
    expect(form.get("auto_gen_digest0")).toBe("1")
    expect(automation.parseWechatToken('<script>window.wx = { data: {"t":"987654"} }</script>')).toBe("987654")
    expect(automation.parseWechatToken("", "https://mp.weixin.qq.com/?token=123")).toBe("123")
    expect(automation.wechatDraftUrl("123", "456")).toContain("appmsgid=456")
  })
})
