import { showToast } from "@novaway/ui/toast"
import { createSimpleContext } from "@novaway/ui/context"
import { createEffect, onCleanup } from "solid-js"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { usePlatform } from "@/context/platform"
import { useSessionLayout } from "@/pages/session/session-layout"
import { browserEmbeddedEnabled } from "@/utils/browser-preferences"
import { createDevServerDetector } from "@/utils/dev-server-detect"
import { isLocalPreviewUrl, normalizePreviewUrl } from "@/utils/preview-url"
import { usePreview } from "./preview"
import { useSDK } from "./sdk"

// 终端输出里首次发现本地 dev server，就按浏览器偏好打开：默认载入右侧内置预览，
// 关闭偏好时交给系统浏览器。同一地址本会话只动作一次。
export const { use: useDevServers, provider: DevServerProvider } = createSimpleContext({
  name: "DevServer",
  init: () => {
    const language = useLanguage()
    const globalSync = useGlobalSync()
    const platform = usePlatform()
    const sdk = useSDK()
    const preview = usePreview()
    const layout = useLayout()
    const { sessionKey } = useSessionLayout()

    let detector = createDevServerDetector()
    let lastDirectory = ""
    let lastSession = ""

    createEffect(() => {
      const directory = sdk.directory
      const session = sessionKey()

      // 换工作区或换会话就重建去重集合：A 工作区见过的地址要在 B 工作区再次打开
      if (directory !== lastDirectory || session !== lastSession) {
        lastDirectory = directory
        lastSession = session
        detector = createDevServerDetector()
      }
    })

    /**
     * Open a task-produced URL according to the browser preference. Known local
     * pages use the pane by default; explicit external links still use the
     * system browser unless the caller explicitly prefers the embedded pane.
     */
    const open = (input: string, detectedDevServer = false, options: { preferEmbedded?: boolean } = {}): boolean => {
      const normalized = normalizePreviewUrl(input)
      if (!normalized) return false

      const embedded = browserEmbeddedEnabled(globalSync.data.config)
      const externalEmbeddedUnavailable =
        options.preferEmbedded && !isLocalPreviewUrl(normalized) && platform.platform !== "desktop"
      if (
        !embedded ||
        externalEmbeddedUnavailable ||
        (!options.preferEmbedded && !detectedDevServer && !isLocalPreviewUrl(normalized))
      ) {
        platform.openLink(normalized)
        return true
      }

      const current = normalizePreviewUrl(preview.url())
      if (normalized !== current && !preview.setUrl(normalized)) return false
      layout.sidePane.add("browser")
      if (detectedDevServer) {
        showToast({
          title: language.t("preview.autoOpened"),
          description: normalized,
        })
      }
      return true
    }

    const report = (chunk: string): void => {
      for (const url of detector.report(chunk)) open(url, true)
    }

    onCleanup(() => {
      lastDirectory = ""
      lastSession = ""
    })

    return { open, report }
  },
})
