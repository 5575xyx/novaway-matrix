import { Show, createSignal, onCleanup, onMount } from "solid-js"
import { PLATFORM_LIST } from "@/context/platform-accounts"

const WEBVIEW_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36 Edg/133.0.0.0"

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
  let webviewRef: any
  let webViewId: number | null = null

  const info = () => PLATFORM_LIST.find((p) => p.id === props.platform)
  const isWxGzh = () => props.platform === "wxGzh"
  const isXianyu = () => props.platform === "xianyu"
  const isDouyin = () => props.platform === "douyin"

  onMount(() => {
    const wv = webviewRef
    if (!wv) return

    wv.addEventListener("dom-ready", async () => {
      const currentUrl = wv.getURL()
      console.log(`[PlatformWebView] dom-ready: ${currentUrl} (platform=${props.platform})`)
      if (currentUrl === "about:blank") {
        const api = (window as any).api?.platform
        if (api?.createWebview) {
          const id = wv.getWebContentsId()
          console.log(`[PlatformWebView] got webContentsId: ${id}`)
          webViewId = id
          let cookies: any[] = []
          try { cookies = JSON.parse(props.cookies) } catch {}
          console.log(`[PlatformWebView] parsed ${cookies.length} cookies`)
          if (cookies.length > 0) {
            const result = await api.createWebview(id, cookies)
            console.log(`[PlatformWebView] createWebview result:`, result)
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
      }
      setLoading(false)
    })

    wv.addEventListener("did-finish-load", () => {
      console.log(`[PlatformWebView] did-finish-load: ${wv.getURL()}`)
    })

    wv.addEventListener("did-fail-load", (e: any) => {
      console.log(`[PlatformWebView] did-fail-load: code=${e.errorCode}, desc=${e.errorDescription}, url=${wv.getURL()}`)
    })
  })

  onCleanup(() => {
    if (webViewId !== null) {
      const api = (window as any).api?.platform
      api?.destroyWebview(webViewId)
    }
  })

  return (
    <div class="flex flex-col h-full w-full">
      <Show when={!error()}>
        <div class="flex items-center gap-3 px-4 py-2 bg-background-weak border-b border-border-weak-base shrink-0">
          <div class="size-5 rounded overflow-hidden bg-white">
            <img src={info()?.icon} alt="" class="size-full object-contain" />
          </div>
          <span class="text-13-medium text-text-strong">{info()?.name}</span>
          <span class="text-12-regular text-text-weaker">{info()?.viewUrl}</span>
          <div class="flex-1" />
          <button
            class="rounded-[6px] px-2.5 py-1 text-12-medium text-text-weak hover:bg-surface-raised-base-hover hover:text-text-strong transition-colors"
            onClick={() => {
              if (webviewRef?.reload) webviewRef.reload()
            }}
          >
            刷新
          </button>
        </div>
        <Show when={loading()}>
          <div class="flex items-center justify-center flex-1 bg-white">
            <div class="flex flex-col items-center gap-3">
              <div class="size-6 border-2 border-border-weak-base border-t-border-interactive-base rounded-full animate-spin" />
              <span class="text-13-regular text-text-weak">正在加载平台页面...</span>
            </div>
          </div>
        </Show>
        <webview
          ref={(el: any) => { webviewRef = el }}
          disablewebsecurity={true}
          webpreferences="sandbox"
          allowpopups={isWxGzh() || isXianyu()}
          useragent={WEBVIEW_UA}
          class="flex-1 w-full"
          src={loading() ? "about:blank" : (info()?.viewUrl || "")}
          style={{ height: "100%" }}
        />
      </Show>
      <Show when={error()}>
        <div class="flex items-center justify-center flex-1">
          <div class="text-center max-w-sm p-8">
            <h3 class="text-16-medium text-text-strong mb-2">加载失败</h3>
            <p class="text-13-regular text-text-weak">{error()}</p>
          </div>
        </div>
      </Show>
    </div>
  )
}
