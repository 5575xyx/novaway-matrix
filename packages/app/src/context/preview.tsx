import { createSimpleContext } from "@novaway/ui/context"
import { type Accessor, createMemo } from "solid-js"
import { createStore } from "solid-js/store"
import { Persist, persisted } from "@/utils/persist"
import { normalizePreviewUrl } from "@/utils/preview-url"

// 预览地址归属从 PreviewPanel 上提到 context：分屏模式下标题栏与 dev server 建议条
// 也要写入该地址，地址不能只挂在面板上（切回纯聊天模式面板卸载即丢）。
export const { use: usePreview, provider: PreviewProvider } = createSimpleContext({
  name: "Preview",
  init: (props: { directory: Accessor<string> }) => {
    const [prefs, setPrefs] = persisted(
      Persist.workspace(props.directory(), "preview", ["preview.v1"]),
      createStore({ url: "" }),
    )

    return {
      url: createMemo(() => prefs.url),
      setUrl(input: string): boolean {
        const normalized = normalizePreviewUrl(input)
        if (!normalized) return false
        setPrefs("url", normalized)
        return true
      },
    }
  },
})
