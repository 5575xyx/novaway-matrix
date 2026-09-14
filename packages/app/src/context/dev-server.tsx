import { createSimpleContext } from "@novaway/ui/context"
import { createEffect, createSignal, onCleanup } from "solid-js"
import { useSessionLayout } from "@/pages/session/session-layout"
import { createDevServerDetector } from "@/utils/dev-server-detect"
import { normalizePreviewUrl } from "@/utils/preview-url"
import { usePreview } from "./preview"
import { useSDK } from "./sdk"

// 终端输出里发现本地 dev server 后的「建议打开预览」状态。
// 探测到地址只生成建议，不改动用户正在看的预览；地址在 accept() 时才写入。
export const { use: useDevServers, provider: DevServerProvider } = createSimpleContext({
  name: "DevServer",
  init: () => {
    const sdk = useSDK()
    const preview = usePreview()
    const { sessionKey, view } = useSessionLayout()

    const [, setPending] = createSignal<string | undefined>(undefined)
    let detector = createDevServerDetector()
    let lastDirectory = ""
    let lastSession = ""

    createEffect(() => {
      const directory = sdk.directory
      const session = sessionKey()

      if (directory !== lastDirectory) {
        lastDirectory = directory
        // 换工作区就重建去重集合，否则在 A 工作区见过的地址不会在 B 工作区再次提示
        detector = createDevServerDetector()
      }

      if (session !== lastSession) {
        lastSession = session
        setPending(undefined)
      }
    })

    const report = (chunk: string): void => {
      if (setPending()) return

      const current = normalizePreviewUrl(preview.url())
      for (const url of detector.report(chunk)) {
        const normalized = normalizePreviewUrl(url)
        if (!normalized) continue
        if (normalized === current) continue
        setPending(url)
      }
    }

    const dismiss = (): void => {
      setPending(undefined)
    }

    // 单一入口：写入预览地址并切到分屏
    const accept = (): void => {
      const url = setPending()
      if (!url) return
      if (!preview.setUrl(url)) return
      setPending(undefined)
      view().viewMode.set("split")
    }

    onCleanup(() => {
      lastDirectory = ""
      lastSession = ""
    })

    return {
      get pending() {
        return setPending()
      },
      report,
      dismiss,
      accept,
    }
  },
})
