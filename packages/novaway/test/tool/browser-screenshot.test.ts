import { describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { BrowserService } from "../../src/browser/browser"
import { BrowserScreenshotTool } from "../../src/tool/browser"
import { InstanceRef } from "../../src/effect/instance-ref"
import { Truncate } from "../../src/tool/truncate"
import { Agent } from "../../src/agent/agent"
import { Bus } from "../../src/bus"
import { SessionID, MessageID } from "../../src/session/schema"

const dir = process.cwd()
const ctx = {
  sessionID: SessionID.make("ses_test-browser"),
  messageID: MessageID.make("msg_test"),
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
}

/**
 * 截图必须同时给"落盘路径"和 data URL：界面靠 data URL 直接把验证结果画在回复末尾，
 * 文件路径只用于证据留存。这里用桩浏览器验证这层映射，真实截图链路由 cdp.test.ts 覆盖。
 */
describe("browser_screenshot", () => {
  test("returns the screenshot as an image attachment", async () => {
    const dataURL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg=="
    const browser = Layer.succeed(BrowserService.Service, {
      screenshot: () => Effect.succeed({ path: `${dir}/.novaway/browser/evidence/shot.png`, dataURL }),
    } as never)

    const result = await Effect.gen(function* () {
      const tool = yield* (yield* BrowserScreenshotTool).init()
      return yield* tool.execute({ fullPage: false }, ctx)
    }).pipe(
      Effect.provide(browser),
      Effect.provide(Truncate.defaultLayer),
      Effect.provide(Agent.defaultLayer),
      Effect.provide(Bus.layer),
      Effect.provideService(InstanceRef, { directory: dir, worktree: dir, project: {} as never }),
      Effect.runPromise,
    )

    const attachments = (result as { attachments?: Array<{ mime: string; url: string; filename: string }> }).attachments
    expect(attachments?.length).toBe(1)
    expect(attachments?.[0]?.mime).toBe("image/png")
    expect(attachments?.[0]?.url).toBe(dataURL)
    expect(attachments?.[0]?.filename).toBe("shot.png")
  })
})
