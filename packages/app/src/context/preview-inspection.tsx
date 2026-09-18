import { createSimpleContext } from "@novaway/ui/context"
import { showToast } from "@novaway/ui/toast"
import { type Accessor, createSignal, on, onCleanup } from "solid-js"
import { useLanguage } from "@/context/language"
import { usePrompt, type ImageAttachmentPart } from "@/context/prompt"
import {
  PICK_ARM,
  PICK_READY,
  buildPickedContextItem,
  isPickElement,
  isPickMessage,
  pickedElementComment,
  type PickedElement,
} from "@/utils/preview-pick"
import { relativeToWorkspace } from "@/utils/preview-sources"
import { previewFilePath } from "@/utils/preview-url"
import { usePreview } from "./preview"

// 预览里的元素选取。桌面端主进程往 HTML 预览文档注入 inspector 脚本（本地文件走 oc-file
// 协议，dev server 走 http 拦截），脚本只负责采集回传，这里校验消息来源并把它变成 composer 内容。
// 预览地址能映射到工作区文件时加成文件上下文；映射不到（dev server 的虚拟路径）就把元素说明
// 作为正文追加进输入框。注入失败的页面 ready 保持 false，按钮置灰并说明原因。
export const { use: usePreviewInspection, provider: PreviewInspectionProvider } = createSimpleContext({
  name: "PreviewInspection",
  // gate 必须关：createSimpleContext 会把返回值里名为 ready 的成员当成就绪门槛，
  // 而这里的 ready 只是「inspector 握手完成」，初始就是 false，会把预览面板整个 <Show> 掉
  gate: false,
  init: (props: { directory: Accessor<string> }) => {
    const language = useLanguage()
    const preview = usePreview()
    const prompt = usePrompt()

    const [ready, setReady] = createSignal(false)
    const [armed, setArmed] = createSignal(false)
    let frame: HTMLIFrameElement | undefined

    // 换了地址 iframe 会重建，握手与开关联动都要一起复位；同时上报新地址的源，
    // 主进程只对这个源的 http 文档做注入改写，其余 http 流量原样透传
    on(
      () => preview.url(),
      (next) => {
        setReady(false)
        setArmed(false)
        void window.api?.setPreviewInspectorOrigin?.(httpOrigin(next))
      },
    )

    const appendPromptText = (text: string) => {
      const parts = prompt.current()
      const images = parts.filter((part): part is ImageAttachmentPart => part.type === "image")
      const rest = parts.filter((part) => part.type !== "image")
      const start = rest.reduce((sum, part) => sum + part.content.length, 0)
      const insertion = `\n${text}\n`
      prompt.set(
        [...rest, { type: "text", content: insertion, start, end: start + insertion.length }, ...images],
        start + insertion.length,
      )
    }

    const addPicked = (element: PickedElement) => {
      const absolute = previewFilePath(preview.url())
      if (absolute) {
        prompt.context.add(buildPickedContextItem(relativeToWorkspace(absolute, props.directory()), element))
        showToast({
          title: language.t("preview.pick.added"),
          description: language.t("preview.pick.addedHint"),
        })
        return
      }

      appendPromptText(pickedElementComment(element))
      showToast({
        title: language.t("preview.pick.added"),
        description: language.t("preview.pick.appendedHint"),
      })
    }

    const onMessage = (event: MessageEvent) => {
      // event.source 就是发件窗口，比对它比比对 URL 更可靠
      if (!frame || event.source !== frame.contentWindow) return

      const data = event.data
      if (!isPickMessage(data)) return

      if (data.type === PICK_READY) {
        setReady(true)
        return
      }

      if (data.type === PICK_ARM) {
        // 脚本侧 Esc 取消也会回发这条，两边状态保持同步
        setArmed(data.armed)
        return
      }

      if (!isPickElement(data)) return
      setArmed(false)
      addPicked(data.element)
    }

    window.addEventListener("message", onMessage)
    onCleanup(() => window.removeEventListener("message", onMessage))

    const setFrame = (element: HTMLIFrameElement | undefined) => {
      if (element === frame) return
      frame = element
      setReady(false)
      setArmed(false)
    }

    const toggle = () => {
      if (!ready()) return
      const next = !armed()
      setArmed(next)
      frame?.contentWindow?.postMessage(
        { type: PICK_ARM, armed: next, hint: next ? language.t("preview.pick.hint") : "" },
        "*",
      )
    }

    return {
      ready,
      armed,
      toggle,
      setFrame,
    }
  },
})

/** 只有 http(s) 预览需要主进程拦截改写文档；其余地址上报空串，解除上一个源的改写 */
function httpOrigin(url: string): string {
  if (!/^https?:\/\//.test(url)) return ""
  try {
    return new URL(url).origin
  } catch {
    return ""
  }
}
