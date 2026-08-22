import { createMemo, For, Show } from "solid-js"
import { useDialog } from "@novaway/ui/context/dialog"
import { Icon } from "@novaway/ui/icon"
import { OfficePptTemplatePreview } from "@/components/office-ppt-template-preview"
import { OfficeSceneSwitcher } from "@/components/office-scene-switcher"
import { officeTemplateCards, type OfficeTemplateCard } from "@/pages/home/office-template-cards"
import { zenActions, type HomeActionId } from "@/pages/home/zen-office"
import { officePptTemplatePreview, officePptTemplates, officePptTemplateVisual } from "@/pages/session/office-export"

export function OfficeTemplateGallery(props: {
  activeID: HomeActionId
  selectedID?: string
  showSceneSwitcher?: boolean
  onSelect: (id: HomeActionId) => void
  onUseTemplate: (card: OfficeTemplateCard) => void
}) {
  const action = createMemo(() => zenActions.find((item) => item.id === props.activeID) ?? zenActions[0])
  const cards = createMemo(() => officeTemplateCards[props.activeID])
  const dialog = useDialog()

  function previewTemplate(card: OfficeTemplateCard) {
    const template = card.pptTemplate
    if (!template || template === "auto") return
    void dialog.show(() => <OfficePptTemplatePreview template={template} />)
  }

  return (
    <div class="flex w-full flex-col gap-4">
      <Show when={props.showSceneSwitcher !== false}>
        <div class="rounded-[8px] border border-border-weak-base bg-background-panel/68 p-1.5 backdrop-blur-xl">
          <OfficeSceneSwitcher active={props.activeID} onSelect={props.onSelect} />
        </div>
      </Show>

      <div class="flex items-end justify-between gap-4">
        <div class="flex items-start gap-3">
          <div class="grid size-10 shrink-0 place-items-center rounded-[8px] border border-emerald-300/25 bg-emerald-300/10 text-emerald-200">
            <Icon name={action().icon} size="medium" />
          </div>
          <div class="min-w-0 text-left">
            <div class="text-15-medium text-text-strong">{action().title}</div>
            <div class="mt-1 max-w-2xl text-13-regular leading-relaxed text-text-weak">{action().description}</div>
          </div>
        </div>
        <div class="hidden shrink-0 text-12-regular text-text-muted sm:block">
          {props.activeID === "ppt" ? "选择模板后继续描述汇报主题" : "选择模板后可继续补充内容"}
        </div>
      </div>

      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        <For each={cards()}>
          {(card) => (
            <Show
              when={card.pptTemplate}
              fallback={
                <button
                  type="button"
                  class="group min-h-40 rounded-[8px] border border-border-weak-base bg-background-panel/72 p-4 text-left backdrop-blur-xl transition-all hover:-translate-y-0.5 hover:border-emerald-300/40 hover:bg-surface-raised-base hover:shadow-[0_16px_44px_rgba(0,0,0,0.14)]"
                  classList={{
                    "border-emerald-400/70 bg-emerald-400/[0.08] shadow-[0_12px_32px_rgba(16,185,129,0.12)]":
                      props.selectedID === card.id,
                  }}
                  onClick={() => props.onUseTemplate(card)}
                >
                  <div class="flex items-start justify-between gap-3">
                    <div class="grid size-9 shrink-0 place-items-center rounded-[8px] border border-emerald-300/20 bg-emerald-300/[0.08] text-emerald-200">
                      <Icon name={action().icon} size="small" />
                    </div>
                    <div class="flex shrink-0 flex-wrap justify-end gap-1">
                      <For each={card.tags}>
                        {(tag) => (
                          <span class="rounded-full border border-border-weaker-base bg-background-base px-2 py-0.5 text-10-medium text-text-weak">
                            {tag}
                          </span>
                        )}
                      </For>
                    </div>
                  </div>
                  <div class="mt-4">
                    <div class="text-14-medium text-text-strong">{card.title}</div>
                    <div class="mt-1 text-12-regular leading-relaxed text-text-weak">{card.description}</div>
                  </div>
                  <div class="mt-4 flex items-center gap-1.5 text-12-medium text-emerald-200/90 opacity-0 transition-opacity group-hover:opacity-100">
                    <span>使用模板</span>
                    <Icon name="arrow-right" size="small" />
                  </div>
                </button>
              }
            >
              <div
                class="group relative cursor-pointer overflow-hidden rounded-[8px] border border-border-weak-base bg-background-panel/72 text-left backdrop-blur-xl transition-all hover:-translate-y-0.5 hover:border-emerald-300/40 hover:shadow-[0_18px_48px_rgba(0,0,0,0.16)]"
                onClick={() => props.onUseTemplate(card)}
                classList={{
                  "border-emerald-400/80 bg-emerald-400/[0.08] shadow-[0_0_0_3px_rgba(16,185,129,0.16),0_18px_48px_rgba(16,185,129,0.22)]":
                    props.selectedID === card.id,
                }}
                style={
                  props.selectedID === card.id
                    ? {
                        "border-color": "#34d399",
                        "background-color": "rgba(16, 185, 129, 0.08)",
                        "box-shadow": "0 0 0 3px rgba(16, 185, 129, 0.16), 0 18px 48px rgba(16, 185, 129, 0.22)",
                      }
                    : undefined
                }
              >
                <div class="relative">
                  <PptTemplateThumbnail card={card} />
                  <Show when={props.selectedID === card.id}>
                    <div
                      class="absolute right-3 top-3 z-20 flex items-center gap-1 rounded-[7px] border px-2 py-1 text-10-medium text-white"
                      style={{
                        "border-color": "rgba(180, 244, 220, 0.75)",
                        "background-color": "#10b981",
                        "box-shadow": "0 6px 18px rgba(16, 185, 129, 0.38)",
                      }}
                    >
                      <Icon name="check" size="small" />
                      已选择
                    </div>
                  </Show>
                  <div
                    class="absolute inset-0 flex items-center justify-center gap-3 opacity-100 transition-all duration-200 sm:opacity-0 sm:group-hover:opacity-100"
                    style={{
                      "background-color": "rgba(15, 23, 42, 0.34)",
                      "backdrop-filter": "blur(4px)",
                    }}
                  >
                    <button
                      type="button"
                      class="flex h-9 items-center gap-1.5 rounded-[8px] border px-4 text-12-medium shadow-[0_10px_28px_rgba(15,23,42,0.28)] transition-transform hover:-translate-y-px"
                      style={{
                        "border-color": "rgba(255, 255, 255, 0.9)",
                        "background-color": "#ffffff",
                        color: "#111827",
                      }}
                      onClick={(event) => {
                        event.stopPropagation()
                        previewTemplate(card)
                      }}
                    >
                      <Icon name="eye" size="small" />
                      <span>预览</span>
                    </button>
                    <button
                      type="button"
                      class="flex h-9 items-center gap-1.5 rounded-[8px] border px-4 text-12-medium text-white shadow-[0_10px_30px_rgba(16,185,129,0.42)] transition-transform hover:-translate-y-px"
                      style={{
                        "border-color": "rgba(180, 244, 220, 0.78)",
                        "background-color": "#10b981",
                        color: "#ffffff",
                      }}
                      onClick={(event) => {
                        event.stopPropagation()
                        props.onUseTemplate(card)
                      }}
                    >
                      <Icon name={props.selectedID === card.id ? "check" : "check-small"} size="small" />
                      <span>{props.selectedID === card.id ? "已选择" : "选择"}</span>
                    </button>
                  </div>
                </div>
                <div class="p-3">
                  <div class="truncate text-13-medium text-text-strong">{card.title}</div>
                  <div class="mt-1 line-clamp-2 text-11-regular leading-relaxed text-text-weak">{card.description}</div>
                </div>
              </div>
            </Show>
          )}
        </For>
      </div>
    </div>
  )
}

function PptTemplateThumbnail(props: { card: OfficeTemplateCard }) {
  const template = () => props.card.pptTemplate ?? "auto"
  const preview = createMemo(() => officePptTemplatePreview(template()))
  const visual = createMemo(() => officePptTemplateVisual(template()))
  const sourceName = createMemo(() => officePptTemplates.find((item) => item.id === template())?.source)
  const title = () => props.card.title.replace("风格", "")

  return (
    <Show
      when={preview()}
      fallback={
        <div class="relative aspect-[16/9] overflow-hidden p-4" style={{ "background-color": `#${visual().coverBg}` }}>
          <span class="absolute left-0 top-0 h-full w-1.5" style={{ "background-color": `#${visual().accent}` }} />
          <div class="absolute right-3 top-3 grid grid-cols-2 gap-1 opacity-80">
            <span class="h-2 w-5 rounded-[3px]" style={{ "background-color": `#${visual().accent2}` }} />
            <span class="h-2 w-3 rounded-[3px]" style={{ "background-color": `#${visual().accent}` }} />
          </div>
          <div class="flex h-full flex-col justify-center pl-2">
            <span class="h-1.5 w-14 rounded-[3px]" style={{ "background-color": `#${visual().accent}` }} />
            <div
              class="mt-4 max-w-[76%] text-[22px] font-semibold leading-tight"
              style={{ color: `#${visual().coverTitle}` }}
            >
              {title()}
            </div>
            <div
              class="mt-2 max-w-[76%] text-[10px] leading-relaxed opacity-85"
              style={{ color: `#${visual().coverText}` }}
            >
              NovaWay AI 演示
            </div>
          </div>
          <span
            class="absolute bottom-3 right-3 rounded-[5px] px-1.5 py-0.5 text-[9px] font-medium"
            style={{ color: `#${visual().coverTitle}`, "background-color": `#${visual().side}` }}
          >
            PPT
          </span>
        </div>
      }
    >
      {(source) => (
        <div class="relative aspect-[16/9] overflow-hidden bg-white">
          <img
            src={source()}
            alt={`${props.card.title} 模板缩略图`}
            class="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.025]"
            loading="lazy"
          />
          <span class="absolute bottom-2 right-2 rounded-[5px] bg-black/70 px-2 py-1 text-[9px] font-medium text-white backdrop-blur-sm">
            {sourceName() === "Pptx"
              ? "真实 PPTX"
              : sourceName() === "Reveal"
                ? "Reveal 主题"
                : sourceName() === "Presenton"
                  ? "开源 · Presenton"
                  : "开源模板"}
          </span>
        </div>
      )}
    </Show>
  )
}
