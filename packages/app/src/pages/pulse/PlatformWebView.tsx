import { Show, createSignal, onCleanup, onMount } from "solid-js"
import { PLATFORM_LIST } from "@/context/platform-accounts"
import { registerWebview } from "./platform-webview-registry"
import { PlatformIcon } from "@/components/platform-icon"

const WEBVIEW_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36 Edg/133.0.0.0"

interface PlatformWebViewProps {
  accountId: string
  platform: string
  cookies: string
  uid: string
  nickname: string
  avatar: string
}

export function PlatformWebView(props: PlatformWebViewProps) {
  const [loading, setLoading] = createSignal(true)
  const [error, setError] = createSignal("")
  const [webviewSrc, setWebviewSrc] = createSignal("about:blank")
  let webviewRef: any
  let webViewId: number | null = null
  let loadTimer: number | undefined

  const info = () => PLATFORM_LIST.find((p) => p.id === props.platform)
  const clearLoadTimer = () => {
    if (loadTimer !== undefined) {
      window.clearTimeout(loadTimer)
      loadTimer = undefined
    }
  }
  const startLoadTimer = () => {
    clearLoadTimer()
    loadTimer = window.setTimeout(() => {
      if (!loading()) return
      setError("平台页面加载超时，请检查网络或重新检测账号登录状态。")
      setLoading(false)
    }, 15_000)
  }
  const isWxGzh = () => props.platform === "wxGzh"
  const isXianyu = () => props.platform === "xianyu"
  const isDouyin = () => props.platform === "douyin"

  const retry = () => {
    setError("")
    setLoading(true)
    startLoadTimer()

    // 保留同一个 webview 实例，避免错误后重新挂载时丢失 Electron 事件监听。
    // 先回到 about:blank，再切回目标地址，确保失败页面也能真正重试。
    setWebviewSrc("about:blank")
    window.setTimeout(() => {
      if (webviewRef) setWebviewSrc(info()?.viewUrl || "")
    }, 0)
  }

  onMount(() => {
    const wv = webviewRef
    if (!wv) return

    // 让服务端的 webview_* 工具找到这块页面：登记表只装"用户眼前正显示着"的 webview，
    // 组件卸载即注销，模型因此不会操作一个看不见的后台页面。
    const unregister = registerWebview({
      platform: props.platform,
      accountId: props.accountId,
      nickname: props.nickname,
      ready: () => !loading() && !!webviewRef,
      getURL: () => String(webviewRef?.getURL?.() ?? ""),
      getTitle: () => String(webviewRef?.getTitle?.() ?? ""),
      execute: async (script) => {
        if (!webviewRef) throw new Error("平台页面还没有打开")
        return await webviewRef.executeJavaScript(script, true)
      },
      navigate: (url, timeoutMs) =>
        new Promise((resolve, reject) => {
          const target = webviewRef
          if (!target) {
            reject(new Error("平台页面还没有打开"))
            return
          }
          let timer = 0
          const finish = () => {
            clearTimeout(timer)
            target.removeEventListener("did-finish-load", finish)
            target.removeEventListener("did-fail-load", finish)
            resolve({ url: String(target.getURL?.() ?? url), title: String(target.getTitle?.() ?? "") })
          }
          timer = window.setTimeout(finish, timeoutMs)
          target.addEventListener("did-finish-load", finish)
          target.addEventListener("did-fail-load", finish)
          void Promise.resolve(target.loadURL(url)).catch(() => finish())
        }),
      capture: async () => {
        const target = webviewRef
        if (!target?.capturePage) return undefined
        const image = await target.capturePage()
        return image?.toDataURL?.()
      },
      // 小红书把发布按钮藏在 <xhs-publish-btn> 的 closed shadow root 里，
      // 脚本查不到、host.click() 也只打到宿主。只有走浏览器的输入管线
      // （webview.sendInputEvent）点击才会被路由进影子树。
      clickAt: async (x: number, y: number) => {
        const target = webviewRef
        if (!target?.sendInputEvent) throw new Error("当前页面不支持坐标点击")
        const px = Math.round(x)
        const py = Math.round(y)
        target.sendInputEvent({ type: "mouseMove", x: px - 8, y: py - 6 })
        target.sendInputEvent({ type: "mouseMove", x: px, y: py })
        target.sendInputEvent({ type: "mouseDown", x: px, y: py, button: "left", clickCount: 1 })
        target.sendInputEvent({ type: "mouseUp", x: px, y: py, button: "left", clickCount: 1 })
      },
    })
    onCleanup(unregister)
    startLoadTimer()

    wv.addEventListener("dom-ready", async () => {
      const currentUrl = wv.getURL()
      console.log(`[PlatformWebView] dom-ready: ${currentUrl} (platform=${props.platform})`)
      if (currentUrl !== "about:blank") return

      const api = (window as any).api?.platform
      if (api?.createWebview) {
        const id = wv.getWebContentsId()
        console.log(`[PlatformWebView] got webContentsId: ${id}`)
        webViewId = id
        let cookies: any[] = []
        try {
          cookies = JSON.parse(props.cookies)
        } catch {}
        console.log(`[PlatformWebView] parsed ${cookies.length} cookies`)
        if (cookies.length > 0) {
          try {
            // Cookie 写入属于增强步骤，不能无限阻塞页面导航。某些 Electron
            // guest webContents 在 session.cookies.get() 上可能迟迟不返回，
            // 如果一直 await，用户最终只会看到 about:blank 超时。
            const setup = Promise.resolve(api.createWebview(id, cookies))
            const timeout = new Promise<{ success: false; error: string }>((resolve) =>
              window.setTimeout(() => resolve({ success: false, error: "登录态写入超时" }), 2_000),
            )
            const result = await Promise.race([setup, timeout])
            console.log(`[PlatformWebView] createWebview result:`, result)
          } catch (cause) {
            console.warn("[PlatformWebView] createWebview failed; continuing with page navigation", cause)
          }
        }
        if (isDouyin()) {
          try {
            wv.executeJavaScript(`
              localStorage.setItem('douyin_web_hide_guide', '1');
              localStorage.setItem('user_info', '{"uid":"${props.uid}","nickname":"${props.nickname}","avatarUrl":"${props.avatar}"}');
              localStorage.setItem('useShortcut2', '{"Wed Mar 12 2025":false}');
            `)
            console.log(`[PlatformWebView] douyin localStorage injected`)
          } catch (e) {
            console.error(`[PlatformWebView] douyin localStorage injection failed:`, e)
          }
        }
      }

      // about:blank 只负责注入登录态，真正的加载状态由目标平台的
      // did-finish-load / did-fail-load 决定，避免过早结束 loading。
      setWebviewSrc(info()?.viewUrl || "")
    })

    wv.addEventListener("did-finish-load", () => {
      const currentUrl = wv.getURL()
      console.log(`[PlatformWebView] did-finish-load: ${currentUrl}`)
      if (currentUrl === "about:blank") return
      clearLoadTimer()
      setError("")
      setLoading(false)
    })

    wv.addEventListener("did-fail-load", (e: any) => {
      console.log(
        `[PlatformWebView] did-fail-load: code=${e.errorCode}, desc=${e.errorDescription}, url=${wv.getURL()}`,
      )
      // Electron may emit ERR_ABORTED while replacing about:blank; that is not a user-facing failure.
      if (e.errorCode === -3) return
      clearLoadTimer()
      setError(e.errorDescription || "平台页面加载失败，请重试。")
      setLoading(false)
    })
  })

  onCleanup(() => {
    clearLoadTimer()
    if (webViewId !== null) {
      const api = (window as any).api?.platform
      api?.destroyWebview(webViewId)
    }
  })

  return (
    <div class="flex h-full w-full flex-col">
      <div class="flex shrink-0 items-center gap-3 border-b border-border bg-background-alt px-4 py-2">
        <div class="size-5 overflow-hidden rounded bg-background-alt">
          <PlatformIcon
            color={info()?.iconColor}
            markColor={info()?.iconMarkColor}
            svg={info()?.icon ?? ""}
            class="size-full object-contain"
          />
        </div>
        <span class="text-13-medium text-foreground">{info()?.name}</span>
        <span class="truncate text-12-regular text-foreground-subtlest">{info()?.viewUrl}</span>
        <div class="flex-1" />
        <button
          type="button"
          class="rounded-[6px] px-2.5 py-1 text-12-medium text-foreground-subtle transition-colors hover:bg-hover hover:text-foreground"
          onClick={retry}
        >
          刷新
        </button>
      </div>
      <div class="relative min-h-0 flex-1">
        <webview
          ref={(el: any) => {
            webviewRef = el
          }}
          disablewebsecurity={true}
          webpreferences="sandbox"
          allowpopups={isWxGzh() || isXianyu()}
          useragent={WEBVIEW_UA}
          class="size-full"
          src={webviewSrc()}
        />
        <Show when={loading() && !error()}>
          <div class="absolute inset-0 flex items-center justify-center bg-background">
            <div class="flex flex-col items-center gap-3">
              <div class="size-6 animate-spin rounded-full border-2 border-border border-t-border-interactive-base" />
              <span class="text-13-regular text-foreground-subtle">正在加载平台页面...</span>
            </div>
          </div>
        </Show>
        <Show when={error()}>
          <div
            class="absolute inset-0 flex items-center justify-center bg-background px-6"
            role="alert"
            aria-live="assertive"
          >
            <div class="max-w-sm rounded-xl border border-border bg-background p-6 text-center shadow-sm">
              <div class="mx-auto flex size-10 items-center justify-center rounded-full bg-surface-critical-base/15 text-critical-base">
                !
              </div>
              <h3 class="mt-4 text-16-medium text-foreground">平台页面加载失败</h3>
              <p class="mt-2 text-13-regular leading-5 text-foreground-subtle">{error()}</p>
              <button
                type="button"
                class="mt-5 rounded-lg border border-border px-3 py-2 text-12-medium text-foreground transition-colors hover:bg-hover"
                onClick={retry}
              >
                重新加载
              </button>
            </div>
          </div>
        </Show>
      </div>
    </div>
  )
}
