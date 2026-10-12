import { For, createMemo, type JSX } from "solid-js"
import { Icon } from "@novaway/ui/icon"
import { IconButton } from "@novaway/ui/icon-button"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { useSDK } from "@/context/sdk"
import { StatusSection } from "./status-section"

export type StatusPanelSection = {
  id: string
  title: string
  summary?: JSX.Element
  defaultOpen?: boolean
  bodyHeight?: string
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
// 容器 < 1279px 一律显示信息胶囊：只读摘要，不承载展开动作——窄态下点击无法越过 CSS 强制 mini，
// 所以窄态可见的那个元素不带任何「可展开」声明。展开按钮只存在于宽容器，此时 data-collapsed 点击确实生效。
function SessionStatusPanelView(props: { sections: StatusPanelSection[] }): JSX.Element {
  const language = useLanguage()
  const layout = useLayout()
  const sdk = useSDK()
  const directory = createMemo(() => sdk.directory)

  const collapsed = layout.statusPanel.collapsed(directory())
  const summaries = createMemo(() => props.sections.filter((section) => section.summary !== undefined))

  return (
    <aside
      data-component="status-panel"
      class="group absolute top-4 right-4 z-10"
      data-collapsed={collapsed() ? "true" : "false"}
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
            onClick={() => layout.statusPanel.toggleCollapsed(directory())}
          />
        </div>
        <div class="flex-1 min-h-0 overflow-y-auto no-scrollbar">
          <For each={props.sections}>
            {(section, index) => {
              const open = layout.statusPanel.open(directory(), section.id, section.defaultOpen)
              return (
                <div classList={{ "border-t border-border-weak-base": index() > 0 }}>
                  <StatusSection
                    id={section.id}
                    title={section.title}
                    summary={section.summary}
                    open={open()}
                    onToggle={() => layout.statusPanel.toggleOpen(directory(), section.id, section.defaultOpen)}
                    bodyHeight={section.bodyHeight}
                  >
                    {section.children}
                  </StatusSection>
                </div>
              )
            }}
          </For>
        </div>
      </div>

      {/* 窄容器强制 mini 时显示：纯信息展示，非控件，因此不挂 onClick 也不声明可展开。 */}
      <div
        data-component="status-panel-mini"
        class="absolute top-0 right-0 hidden h-8 items-center gap-1 rounded-lg border border-border-weak-base bg-background-stronger px-2 shadow-sm @max-[1279px]:flex"
        title={language.t("statusPanel.summary")}
      >
        <CapsuleBody sections={summaries()} />
      </div>

      {/* 外层只做「非窄容器」闸门；按钮自己只处理 data-collapsed，两轴各管一条互斥规则。 */}
      <div class="absolute top-0 right-0 @max-[1279px]:hidden">
        <button
          type="button"
          data-component="status-panel-expand"
          class="hidden h-8 items-center gap-1 rounded-lg border border-border-weak-base bg-background-stronger px-2 shadow-sm group-data-[collapsed=true]:flex"
          title={language.t("statusPanel.expand")}
          aria-label={language.t("statusPanel.expand")}
          onClick={() => layout.statusPanel.toggleCollapsed(directory())}
        >
          <CapsuleBody sections={summaries()} />
        </button>
      </div>
    </aside>
  )
}

const CapsuleBody = (props: { sections: StatusPanelSection[] }): JSX.Element => (
  <>
    <Icon name="status" size="small" class="text-icon-base shrink-0" />
    <For each={props.sections}>
      {(section) => <span class="text-ui-sm tabular-nums text-text-weak shrink-0">{section.summary}</span>}
    </For>
  </>
)
