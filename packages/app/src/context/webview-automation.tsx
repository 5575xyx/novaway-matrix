import { createSimpleContext } from "@novaway/ui/context"
import { onCleanup, onMount } from "solid-js"
import { useSDK } from "./sdk"
import { findWebview, hasWebview, type WebviewHandle } from "@/pages/pulse/platform-webview-registry"

/**
 * 把服务端发来的「在用户眼前的平台页面里执行 X」请求交给真实的 webview。
 *
 * 通道是请求/响应式的（和 `question` 同构）：
 *   服务端 bus → `platform.webview.request` → 这里执行 → POST /platform/webview/:id/result
 *
 * 为什么不在服务端直接开无头浏览器：公众号这类后台只认浏览器里已经登录的会话，
 * 而且用户必须能看见模型在点什么（否则"自动发布"就变成黑箱操作）。
 */
type Request = {
  id: string
  sessionID: string
  action: "status" | "script" | "navigate" | "screenshot" | "click"
  target?: string
  script?: string
  url?: string
  x?: number
  y?: number
  timeoutMs?: number
}

const NO_PAGE =
  "运营工作台里没有打开的平台页面。请用户在「运营工作台」暂停左侧选中一个账号、让平台页面显示出来，然后再试。"

export const { use: useWebviewAutomation, provider: WebviewAutomationProvider } = createSimpleContext({
  name: "WebviewAutomation",
  init: () => {
    const sdk = useSDK()

    const report = (requestID: string, result: { ok: boolean; data?: unknown; error?: string }) =>
      sdk.client.platformWebview
        .resolve({
          requestID,
          directory: sdk.directory,
          ok: result.ok,
          ...(result.data === undefined ? {} : { data: result.data }),
          ...(result.error === undefined ? {} : { error: result.error }),
        })
        .catch(() => undefined)

    const describe = (handle: WebviewHandle) => ({
      platform: handle.platform,
      accountId: handle.accountId,
      nickname: handle.nickname,
      url: handle.getURL(),
      title: handle.getTitle(),
      ready: handle.ready(),
    })

    const run = async (request: Request) => {
      const handle = findWebview(request.target)
      if (!handle) {
        await report(request.id, { ok: false, error: NO_PAGE })
        return
      }
      try {
        if (request.action === "status") {
          await report(request.id, { ok: true, data: describe(handle) })
          return
        }
        if (!handle.ready()) {
          await report(request.id, { ok: false, error: "平台页面还在加载，请稍后再试。" })
          return
        }
        if (request.action === "script") {
          if (!request.script) {
            await report(request.id, { ok: false, error: "缺少 script" })
            return
          }
          const data = await handle.execute(request.script)
          await report(request.id, { ok: true, data: data === undefined ? null : data })
          return
        }
        if (request.action === "navigate") {
          if (!request.url) {
            await report(request.id, { ok: false, error: "缺少 url" })
            return
          }
          const data = await handle.navigate(request.url, request.timeoutMs ?? 30_000)
          await report(request.id, { ok: true, data })
          return
        }
        if (request.action === "click") {
          if (typeof request.x !== "number" || typeof request.y !== "number") {
            await report(request.id, { ok: false, error: "缺少坐标（x / y）" })
            return
          }
          await handle.clickAt(request.x, request.y)
          await report(request.id, { ok: true, data: { x: request.x, y: request.y } })
          return
        }
        if (request.action === "screenshot") {
          const dataURL = await handle.capture()
          await report(
            request.id,
            dataURL ? { ok: true, data: { dataURL } } : { ok: false, error: "页面截图失败" },
          )
          return
        }
        await report(request.id, { ok: false, error: `不支持的页面操作：${request.action}` })
      } catch (error) {
        await report(request.id, {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    onMount(() => {
      const off = sdk.event.listen((event) => {
        const detail = event.details
        if (detail?.type !== "platform.webview.request") return
        void run(detail.properties as Request)
      })
      // 应用刷新/重连时可能有请求已经发出去了：补跑一遍，别让服务端一直等到超时。
      void sdk.client.platformWebview
        .list({ directory: sdk.directory })
        .then((result) => {
          for (const item of result.data ?? []) void run(item as Request)
        })
        .catch(() => undefined)
      onCleanup(off)
    })

    // 只暴露"有没有可操作的页面"，界面需要时可以据此提示；实际执行走事件通道。
    return { available: () => hasWebview() }
  },
})
