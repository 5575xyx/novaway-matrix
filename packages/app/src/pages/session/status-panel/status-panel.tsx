import { For, createMemo, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { Icon } from "@novaway/ui/icon"
import { IconButton } from "@novaway/ui/icon-button"
import { useLanguage } from "@/context/language"
import { StatusSection } from "./status-section"

export type StatusPanelSection = {
  id: string
  title: string
  summary?: JSX.Element
  defaultOpen?: boolean
  children: JSX.Element
}

// 状态类信息要么有内容要么整块不出现，不给空面板留占位。
export function shouldMountStatusPanel(sections: readonly { id: string }[]): boolean {
  return sections.length > 0
}

export function SessionStatusPanel(props: { sections: StatusPanelSection[] }): JSX.Element | null {
  if (!shouldMountStatusPanel(props.sections)) return null
  return <SessionStatusPanelView sections={props.sections} />
}

// 展开/收起形态由父级 conv-frame 的 @container 裁决，纯 CSS 决定，形态切换不依赖任何 JS 尺寸监听。
// 容器 < 1279px 一律显示胶囊；宽容器下再让用户手动收起。
function SessionStatusPanelView(props: { sections: StatusPanelSection[] }): JSX.Element {
  const language = useLanguage()
  const [store, setStore] = createStore({
    collapsed: false,
    open: {} as Record<string, boolean>,
  })

  const openOf = (id: string, defaultOpen?: boolean) => store.open[id] ?? defaultOpen ?? true
  const toggleOf = (id: string, defaultOpen?: boolean) => setStore("open", id, !openOf(id, defaultOpen))
  const summaries = createMemo(() => props.sections.filter((section) => section.summary !== undefined))

  return (
    <aside
      data-component="status-panel"
      class="group absolute top-4 right-4 z-10"
      data-collapsed={store.collapsed ? "true" : "false"}
    >
      <div
        data-component="status-panel-expanded"
        class="absolute top-0 right-0 flex w-80 min-h-0 max-h-[min(64dvh,32rem)] flex-col overflow-hidden rounded-lg border border-border-weak-base bg-background-stronger shadow-lg @max-[1279px]:hidden group-data-[collapsed=true]:hidden"
      >
        <div class="flex h-9 shrink-0 items-center gap-2 border-b border-border-weak-base px-3">
          <span class="text-ui-sm font-medium text-text-strong truncate">{language.t("statusPanel.title")}</span>
          <div class="flex-1" />
          <IconButton
            icon="collapse"
            variant="ghost"
            size="small"
            class="h-6 w-6 shrink-0"
            title={language.t("statusPanel.collapse")}
            aria-label={language.t("statusPanel.collapse")}
            onClick={() => setStore("collapsed", true)}
          />
        </div>
        <div class="flex-1 min-h-0 overflow-y-auto no-scrollbar">
          <For each={props.sections}>
            {(section, index) => (
              <div classList={{ "border-t border-border-weak-base": index() > 0 }}>
                <StatusSection
                  id={section.id}
                  title={section.title}
                  summary={section.summary}
                  open={openOf(section.id, section.defaultOpen)}
                  onToggle={() => toggleOf(section.id, section.defaultOpen)}
                >
                  {section.children}
                </StatusSection>
              </div>
            )}
          </For>
        </div>
      </div>

      <button
        type="button"
        data-component="status-panel-capsule"
        class="absolute top-0 right-0 hidden h-8 items-center gap-1 rounded-lg border border-border-weak-base bg-background-stronger px-2 shadow-sm @max-[1279px]:flex group-data-[collapsed=true]:flex"
        title={language.t("statusPanel.expand")}
        aria-label={language.t("statusPanel.expand")}
        onClick={() => setStore("collapsed", false)}
      >
        <Icon name="status" size="small" class="text-icon-base shrink-0" />
        <For each={summaries()}>
          {(section) => <span class="text-ui-sm tabular-nums text-text-weak shrink-0">{section.summary}</span>}
        </For>
      </button>
    </aside>
  )
}
