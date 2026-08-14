import { createMemo, For, Show } from "solid-js"
import { Dialog } from "@opencode-ai/ui/dialog"
import {
  officePptTemplateDescription,
  officePptTemplateName,
  officePptTemplates,
  officePptTemplateVisual,
  type OfficePptTemplateID,
} from "@/pages/session/office-export"

const realPreviewSlots = ["cover", "overview", "content", "cards", "data", "closing"] as const

export function OfficePptTemplatePreview(props: { template: OfficePptTemplateID }) {
  const metadata = createMemo(() => officePptTemplates.find((item) => item.id === props.template))
  const family = createMemo(() => props.template.replace(/^(presenton|reveal|pptx)-/, ""))
  const previewRoot = createMemo(() => {
    if (metadata()?.source === "Pptx") return "pptx"
    if (metadata()?.source === "Reveal") return "reveal"
    if (metadata()?.source === "Presenton") return "presenton-pptx"
    return ""
  })
  const realPreviews = createMemo(() =>
    previewRoot()
      ? realPreviewSlots.map((slot, index) => ({
          src:
            previewRoot() === "pptx"
              ? `/assets/office-ppt-templates/pptx/${family()}/preview/${slot}.jpg`
              : previewRoot() === "presenton-pptx"
                ? `/assets/office-ppt-templates/presenton-pptx/${family()}/preview/${slot}.jpg`
                : `/assets/office-ppt-templates/${previewRoot()}/${family()}/${slot}.jpg`,
          label: `模板页面 ${String(index + 1).padStart(2, "0")}`,
        }))
      : [],
  )

  return (
    <Dialog title={`${officePptTemplateName(props.template)} 预览`} class="mx-auto w-full max-w-[1080px]">
      <div class="max-h-[76vh] overflow-auto px-6 pb-6">
        <div class="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div class="max-w-3xl text-13-regular leading-relaxed text-text-weak">
            {officePptTemplateDescription(props.template)}
          </div>
          <div class="flex shrink-0 items-center gap-2">
            <Show
              when={realPreviews().length > 0}
              fallback={<span class="text-11-medium text-text-muted">版式示意</span>}
            >
              <span class="rounded-[6px] border border-emerald-400/25 bg-emerald-400/10 px-2 py-1 text-11-medium text-emerald-600">
                {metadata()?.source === "Pptx"
                  ? "真实 PPTX 模板页面"
                  : metadata()?.source === "Reveal"
                    ? "官方主题真实渲染"
                    : "真实模板页面"}
              </span>
            </Show>
            <Show when={metadata()?.layoutCount}>
              <span class="text-11-regular text-text-muted">{metadata()?.layoutCount} 个布局</span>
            </Show>
          </div>
        </div>

        <Show when={realPreviews().length > 0} fallback={<GeneratedLayoutPreview template={props.template} />}>
          <div class="grid gap-4 md:grid-cols-3">
            <For each={realPreviews()}>
              {(preview) => (
                <div class="relative aspect-[16/9] overflow-hidden rounded-[8px] border border-border-weaker-base bg-white shadow-[0_18px_48px_rgba(0,0,0,0.18)]">
                  <img
                    src={preview.src}
                    alt={`${officePptTemplateName(props.template)} ${preview.label}`}
                    class="h-full w-full object-cover"
                  />
                  <span class="absolute bottom-2 right-2 rounded-[5px] bg-black/70 px-2 py-1 text-[9px] font-medium text-white backdrop-blur-sm">
                    {preview.label}
                  </span>
                </div>
              )}
            </For>
          </div>
        </Show>
      </div>
    </Dialog>
  )
}

function GeneratedLayoutPreview(props: { template: OfficePptTemplateID }) {
  const visual = officePptTemplateVisual(props.template)

  return (
    <div class="grid gap-4 md:grid-cols-3">
      <For each={["封面", "概览", "内容", "卡片", "数据", "收尾"]}>
        {(label, index) => (
          <div class="relative aspect-[16/9] overflow-hidden rounded-[8px] border border-border-weaker-base bg-white shadow-[0_18px_48px_rgba(0,0,0,0.18)]">
            <div class="relative h-full w-full p-3" style={{ "background-color": `#${visual.pageBg}` }}>
              <span class="absolute left-0 top-0 h-full w-1.5" style={{ "background-color": `#${visual.accent}` }} />
              <div class="flex h-full flex-col justify-center pl-3">
                <span class="h-2 w-16 rounded-full" style={{ "background-color": `#${visual.accent}` }} />
                <span class="mt-4 text-[18px] font-semibold" style={{ color: `#${visual.title}` }}>
                  {label}
                </span>
                <span class="mt-1 text-[10px]" style={{ color: `#${visual.text}` }}>
                  当前模板的版式示意
                </span>
                <div class="mt-4 grid grid-cols-3 gap-1.5">
                  <span class="h-10 rounded-[5px]" style={{ "background-color": `#${visual.card}` }} />
                  <span class="h-10 rounded-[5px]" style={{ "background-color": `#${visual.accent2}` }} />
                  <span class="h-10 rounded-[5px]" style={{ "background-color": `#${visual.accentLight}` }} />
                </div>
              </div>
            </div>
            <span class="absolute bottom-2 right-2 rounded-[5px] bg-black/70 px-2 py-1 text-[9px] font-medium text-white backdrop-blur-sm">
              {String(index() + 1).padStart(2, "0")}
            </span>
          </div>
        )}
      </For>
    </div>
  )
}
