import { showToast } from "@novaway/ui/toast"
import { createSimpleContext } from "@novaway/ui/context"
import { createEffect, onCleanup } from "solid-js"
import { useLanguage } from "@/context/language"
import { useSessionLayout } from "@/pages/session/session-layout"
import { createDevServerDetector } from "@/utils/dev-server-detect"
import { normalizePreviewUrl } from "@/utils/preview-url"
import { usePreview } from "./preview"
import { useSDK } from "./sdk"

// 终端输出里首次发现本地 dev server，就自动载入预览并切到分屏。
// 同一地址本会话只动作一次：重复输出不再打扰，用户手动改了地址也不会被抢回来。
export const { use: useDevServers, provider: DevServerProvider } = createSimpleContext({
  name: "DevServer",
  init: () => {
    const language = useLanguage()
    const sdk = useSDK()
    const preview = usePreview()
    const { sessionKey, view } = useSessionLayout()

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

    const report = (chunk: string): void => {
      const current = normalizePreviewUrl(preview.url())
      for (const url of detector.report(chunk)) {
        const normalized = normalizePreviewUrl(url)
        if (!normalized || normalized === current) continue

        if (!preview.setUrl(normalized)) continue
        view().viewMode.set("split")
        showToast({
          title: language.t("preview.autoOpened"),
          description: normalized,
        })
      }
    }

    onCleanup(() => {
      lastDirectory = ""
      lastSession = ""
    })

    return { report }
  },
})
