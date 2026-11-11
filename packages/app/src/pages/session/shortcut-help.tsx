/**
 * 快捷键帮助浮层（「键盘快捷方式」轻量版）。
 *
 * 不是设置里的完整快捷键编辑器，而是一张只读速查表：列出所有「当前真的绑了
 * 快捷键」的命令，支持搜索，Esc 关闭。入口在文件预览头部「⋯」菜单里。
 */
import { createMemo, createSignal, For, onCleanup, onMount, Show, type Component } from "solid-js"
import fuzzysort from "fuzzysort"
import { makeEventListener } from "@solid-primitives/event-listener"
import { Icon } from "@novaway/ui/icon"
import { useCommand } from "@/context/command"
import { useLanguage } from "@/context/language"

const MAX_ITEMS = 200

export const ShortcutHelp: Component<{ onClose: () => void }> = (props) => {
  const language = useLanguage()
  const command = useCommand()
  const [query, setQuery] = createSignal("")

  // 只列真的绑了快捷键的命令；历史残留里同名只留一行（和设置页同规则）。
  const items = createMemo(() => {
    const seen = new Set<string>()
    const out: Array<{ id: string; title: string; keybind: string }> = []
    for (const option of command.options) {
      if (option.hidden || option.suggested) continue
      const keybind = command.keybind(option.id)
      if (!keybind || seen.has(keybind)) continue
      seen.add(keybind)
      out.push({ id: option.id, title: option.title, keybind })
    }
    return out
  })

  const filtered = createMemo(() => {
    const value = query().trim().toLowerCase()
    if (!value) return items()
    return fuzzysort.go(value, items(), { keys: ["title", "keybind"], threshold: -10000 }).map((r) => r.obj)
  })

  // Esc 关闭：焦点可能不在浮层里（比如刚点完入口按钮），所以监听在 document 上。
  onMount(() => {
    makeEventListener(document, "keydown", (event) => {
      if (event.key !== "Escape") return
      event.preventDefault()
      event.stopPropagation()
      props.onClose()
    })
  })
  onCleanup(() => props.onClose())

  return (
    <div
      class="fixed inset-0 z-50 flex items-start justify-center bg-[color-mix(in_srgb,var(--shadow-color)_40%,transparent)] p-8"
      data-component="shortcut-help"
      onClick={() => props.onClose()}
    >
      <div
        class="flex max-h-[80vh] w-full max-w-xl flex-col overflow-hidden rounded-lg border border-border bg-popover shadow-lg"
        onClick={(event) => event.stopPropagation()}
      >
        <div class="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
          <Icon name="magnifying-glass" size="small" class="shrink-0 text-foreground-subtlest" />
          <input
            type="text"
            data-action="shortcut-help-search"
            class="min-w-0 flex-1 bg-transparent text-13-regular text-foreground outline-none placeholder:text-foreground-subtlest"
            placeholder={language.t("settings.shortcuts.search.placeholder")}
            autofocus
            spellcheck={false}
            value={query()}
            onInput={(event) => setQuery(event.currentTarget.value)}
          />
          <button
            type="button"
            data-action="shortcut-help-close"
            class="grid size-6 shrink-0 place-items-center rounded text-foreground-subtlest transition-colors hover:bg-hover hover:text-foreground"
            aria-label="关闭"
            title="Esc"
            onClick={() => props.onClose()}
          >
            <Icon name="close-small" size="small" />
          </button>
        </div>
        <div class="min-h-0 flex-1 overflow-y-auto no-scrollbar py-1">
          <Show
            when={filtered().length > 0}
            fallback={
              <div class="px-4 py-6 text-center text-12-regular text-foreground-subtle">
                {language.t("settings.shortcuts.search.empty")}
              </div>
            }
          >
            <For each={filtered().slice(0, MAX_ITEMS)}>
              {(item) => (
                <div class="flex items-center gap-3 px-4 py-1.5">
                  <span class="min-w-0 flex-1 truncate text-13-regular text-foreground">{item.title}</span>
                  <kbd class="shrink-0 rounded border border-border bg-surface px-1.5 py-0.5 text-11-regular text-foreground-subtle tabular-nums">
                    {item.keybind}
                  </kbd>
                </div>
              )}
            </For>
          </Show>
        </div>
      </div>
    </div>
  )
}
