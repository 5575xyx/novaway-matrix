import { createMemo, For, Show } from "solid-js"
import { Dialog } from "@novaway/ui/dialog"
import { useDialog } from "@novaway/ui/context/dialog"
import { Icon } from "@novaway/ui/icon"
import {
  officePptTemplates,
  type OfficePptTemplateChoice,
  type OfficePptTemplateID,
} from "@/pages/session/office-export"
import { OfficePptTemplatePreview } from "./office-ppt-template-preview"

/**
 * PPT 模板画廊。
 *
 * 以前模板是 `⋯ 下拉里的 60 行纯文字`：名字都叫「Swiss Grid 瑞士网格」「Brutalist 粗野报纸」，
 * 光看字没法判断长什么样，只能一个个点「导出」再打开看 —— 选模板这件事本身就失效了。
 * 这里把打包进客户端的封面图直接铺出来，一眼挑。
 *
 * 三类入口放在最上面：自动匹配（不锁定任何风格）、AI 自定义（描述生成配色）、
 * 上传自己的 .pptx（直接套用你司的母版）。
 */
export function OfficePptTemplateGallery(props: {
  current: OfficePptTemplateChoice
  busy?: boolean
  onSelect: (template: OfficePptTemplateChoice) => void
  onCustom: () => void
  /** 生成后才有产物可供套版；生成前的入口只挑风格，所以这个回调节点可选。 */
  onUpload?: () => void
}) {
  const dialog = useDialog()
  // 按来源分组：真实 PPTX 母版 / Presenton 开源模板 / Reveal 主题，没标来源的归到「内置风格」。
  const groups = createMemo(() => {
    const buckets = new Map<string, typeof officePptTemplates>()
    for (const template of officePptTemplates) {
      const key = template.source ?? "内置风格"
      const list = buckets.get(key) ?? []
      list.push(template)
      buckets.set(key, list)
    }
    return [...buckets.entries()]
  })

  const selectedID = () => (typeof props.current === "object" ? undefined : (props.current as string))

  return (
    <Dialog title="选择 PPT 模板" class="mx-auto w-full max-w-[1120px]">
      <div class="max-h-[76vh] overflow-y-auto px-6 pb-6">
        <div class="mb-5 grid gap-2 sm:grid-cols-3">
          <SpecialCard
            active={props.current === "auto"}
            title="自动匹配"
            description="按当前内容主题自动挑一个风格"
            icon="lu-zap"
            onClick={() => props.onSelect("auto")}
          />
          <SpecialCard
            active={typeof props.current === "object"}
            title="AI 自定义"
            description="描述想要的风格，现场生成配色"
            icon="lu-square-pen"
            onClick={props.onCustom}
          />
          <Show when={props.onUpload}>
            <SpecialCard
              active={false}
              title="上传 PPTX 模板"
              description="用你司母版直接套版（保留原版式）"
              icon="cloud-upload"
              disabled={props.busy}
              onClick={() => props.onUpload?.()}
            />
          </Show>
        </div>

        <For each={groups()}>
          {([source, templates]) => (
            <div class="mb-6">
              <div class="mb-2 flex items-baseline gap-2">
                <span class="text-12-medium text-foreground">{source}</span>
                <span class="text-11-regular text-foreground-subtlest">{templates.length} 个</span>
              </div>
              <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <For each={templates}>
                  {(template) => (
                    <TemplateCard
                      template={template.id}
                      name={template.name}
                      description={template.description}
                      preview={template.preview}
                      selected={selectedID() === template.id}
                      onClick={() => props.onSelect(template.id)}
                      onPreview={() => dialog.show(() => <OfficePptTemplatePreview template={template.id} />)}
                    />
                  )}
                </For>
              </div>
            </div>
          )}
        </For>
      </div>
    </Dialog>
  )
}

function SpecialCard(props: {
  active: boolean
  title: string
  description: string
  icon: Parameters<typeof Icon>[0]["name"]
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      disabled={props.disabled}
      onClick={props.onClick}
      class="flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-colors hover:bg-hover disabled:cursor-not-allowed disabled:opacity-60"
      classList={{
        "border-foreground/40 bg-hover": props.active,
        "border-border": !props.active,
      }}
    >
      <span class="grid size-8 shrink-0 place-items-center rounded-lg border border-border bg-background text-foreground-subtle">
        <Icon name={props.icon} size="small" />
      </span>
      <span class="min-w-0">
        <span class="block truncate text-12-medium text-foreground">{props.title}</span>
        <span class="mt-0.5 block truncate text-11-regular text-foreground-subtle">{props.description}</span>
      </span>
      <Show when={props.active}>
        <Icon name="check-small" size="small" class="ml-auto shrink-0 text-foreground" />
      </Show>
    </button>
  )
}

function TemplateCard(props: {
  template: OfficePptTemplateID
  name: string
  description: string
  preview?: string
  selected: boolean
  onClick: () => void
  onPreview: () => void
}) {
  return (
    <div
      class="group relative overflow-hidden rounded-xl border transition-colors hover:bg-hover"
      classList={{
        "border-foreground/40": props.selected,
        "border-border": !props.selected,
      }}
    >
      <button type="button" class="block w-full text-left" onClick={props.onClick}>
        <span class="relative block aspect-video w-full overflow-hidden bg-surface">
          <Show
            when={props.preview}
            fallback={
              <span class="grid h-full w-full place-items-center text-11-regular text-foreground-subtlest">
                版式示意
              </span>
            }
          >
            <img
              src={props.preview}
              alt={props.name}
              loading="lazy"
              class="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.02]"
            />
          </Show>
          <Show when={props.selected}>
            <span class="absolute right-1.5 top-1.5 grid size-5 place-items-center rounded-full bg-emerald-500 text-white shadow">
              <Icon name="check-small" size="small" />
            </span>
          </Show>
        </span>
        <span class="block px-2.5 py-2">
          <span class="block truncate text-12-medium text-foreground">{props.name}</span>
          <span class="mt-0.5 line-clamp-2 block text-10-regular leading-4 text-foreground-subtle">
            {props.description}
          </span>
        </span>
      </button>
      {/* 想看完整版式再点开大图：卡片本体留给「选中」，两个动作不抢点击。 */}
      <button
        type="button"
        class="absolute right-1.5 bottom-1.5 hidden rounded-md bg-black/70 px-2 py-1 text-[10px] font-medium text-white backdrop-blur-sm group-hover:block"
        onClick={props.onPreview}
      >
        看版式
      </button>
    </div>
  )
}
