import { createEffect, createSignal, onCleanup, Show } from "solid-js"
import { Portal } from "solid-js/web"
import { useLanguage } from "@/context/language"
import { usePrompt } from "@/context/prompt"

type Anchor = { x: number; y: number; bottom: number }

/**
 * 聊天区选中文字后的浮动动作菜单。
 *
 * 对齐 ZCode 的 `SelectionActionMenu`（`v4/SelectionActionMenu.tsx`）：
 * 在任意一条消息里选中一段文字后，浮出两个动作 ——
 *
 * - **添加到当前任务**：把选中内容追加到主输入框（继续问同一个任务）
 * - **在辅助对话中提问**：把选中内容作为草稿带进一条独立小会话
 *
 * 两者的区别正是 ZCode 那套设计的核心：一个是"接着主线聊"，
 * 一个是"开个分会场聊、不污染主对话历史"。
 *
 * 定位：菜单浮在选区上方（放不下时翻到下方），并夹在视口内。
 */
export function SelectionActionMenu(props: { container: () => HTMLElement | undefined; onAskSideChat: (text: string) => void }) {
  const language = useLanguage()
  const prompt = usePrompt()

  const [anchor, setAnchor] = createSignal<Anchor | undefined>()
  const [text, setText] = createSignal("")

  const readSelection = () => {
    const root = props.container()
    if (!root) return
    const selection = window.getSelection()
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      setAnchor(undefined)
      return
    }
    const value = selection.toString().trim()
    if (!value) {
      setAnchor(undefined)
      return
    }
    // 只在**消息区**内的选区上出现：侧栏、输入框里的选区不该弹这个菜单。
    const range = selection.getRangeAt(0)
    const node = range.commonAncestorContainer
    const element = node instanceof Element ? node : node.parentElement
    if (!element || !root.contains(element)) {
      setAnchor(undefined)
      return
    }
    // 输入框 / 可编辑区里的选区同样跳过（那里本来就有自己的选区行为）。
    if (element.closest("input, textarea, [contenteditable='true'], [contenteditable='']")) {
      setAnchor(undefined)
      return
    }
    const rect = range.getBoundingClientRect()
    if (rect.width === 0 && rect.height === 0) {
      setAnchor(undefined)
      return
    }
    setText(value)
    setAnchor({ x: rect.left + rect.width / 2, y: rect.top, bottom: rect.bottom })
  }

  createEffect(() => {
    const onPointerUp = () => {
      // 用 setTimeout 而不是 rAF：窗口被遮挡/最小化时 rAF 会被节流甚至完全不跑，
      // 菜单就永远不出现（实测在后台窗口里复现过）。定时器仍会执行。
      setTimeout(readSelection, 0)
    }
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setAnchor(undefined)
        return
      }
      onPointerUp()
    }
    const onSelectionChange = () => {
      const selection = window.getSelection()
      if (!selection || selection.isCollapsed) setAnchor(undefined)
    }
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target
      if (target instanceof Element && target.closest("[data-selection-action-menu]")) return
      setAnchor(undefined)
    }

    document.addEventListener("pointerup", onPointerUp)
    document.addEventListener("pointerdown", onPointerDown)
    document.addEventListener("keyup", onKeyUp)
    document.addEventListener("selectionchange", onSelectionChange)
    onCleanup(() => {
      document.removeEventListener("pointerup", onPointerUp)
      document.removeEventListener("pointerdown", onPointerDown)
      document.removeEventListener("keyup", onKeyUp)
      document.removeEventListener("selectionchange", onSelectionChange)
    })
  })

  const addToTask = () => {
    const value = text()
    setAnchor(undefined)
    if (!value) return
    // 对齐 ZCode：选中内容变成输入框上方的一张「引用」卡片，而不是把原文
    // 直接灌进输入框。用户接着写自己的问题，发送时引用会作为 synthetic
    // 文本块一并带给模型。
    prompt.context.add({ type: "quote", text: value, label: language.t("session.selection.quoteLabel") })
    document.querySelector<HTMLElement>('[data-component="prompt-input"]')?.focus()
  }

  const askSideChat = () => {
    const value = text()
    setAnchor(undefined)
    if (!value) return
    props.onAskSideChat(value)
  }

  return (
    <Show when={anchor()}>
      {(current) => (
        <Portal>
          <div
            data-selection-action-menu
            class="fixed z-50 flex overflow-hidden rounded-lg border border-border bg-popover text-ui-sm text-foreground shadow-md"
            style={{
              left: `${Math.max(12, Math.min(window.innerWidth - 300, current().x - 150))}px`,
              top: `${current().y - 40 >= 12 ? current().y - 40 : current().bottom + 8}px`,
              width: "max-content",
            }}
            // 防止点击菜单时清掉选区（浏览器默认会在 mousedown 时折叠选区）。
            onMouseDown={(event) => event.preventDefault()}
          >
            <button
              type="button"
              data-action="selection-add-to-task"
              class="px-2.5 py-1.5 transition-colors hover:bg-hover"
              onClick={addToTask}
            >
              {language.t("session.selection.addToTask")}
            </button>
            <div class="w-px shrink-0 bg-border" />
            <button
              type="button"
              data-action="selection-ask-side-chat"
              class="px-2.5 py-1.5 transition-colors hover:bg-hover"
              onClick={askSideChat}
            >
              {language.t("session.selection.askSideChat")}
            </button>
          </div>
        </Portal>
      )}
    </Show>
  )
}
