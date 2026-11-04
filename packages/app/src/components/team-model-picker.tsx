import { Popover as Kobalte } from "@kobalte/core/popover"
import { createMemo, createSignal, Show, type Component } from "solid-js"
import { List } from "@novaway/ui/list"
import { Icon } from "@novaway/ui/icon"
import { ProviderIcon } from "@novaway/ui/provider-icon"
import { useLanguage } from "@/context/language"
import { useModels } from "@/context/models"
import { isAutoModel } from "@/utils/model"
import { modelIconId } from "@/utils/provider-icon"

/**
 * 团队 / 成员的模型选择器。
 *
 * 和对话框里的模型选择器用同一份目录、同一套可见性规则，只是选择结果
 * 不落到当前会话，而是交给调用方写进团队配置。「跟随」是一个明确选项，
 * 不是一个空状态：用户要能一眼分清「我选了 A」和「交给上级默认」。
 */

/** `provider/model` → 两段；modelID 本身可能带 `/`，只切第一个。 */
export function splitModelRef(value: string | undefined) {
  if (!value) return undefined
  const index = value.indexOf("/")
  if (index <= 0 || index === value.length - 1) return undefined
  return { providerID: value.slice(0, index), modelID: value.slice(index + 1) }
}

export function joinModelRef(model: { providerID: string; modelID: string } | undefined) {
  return model ? model.providerID + "/" + model.modelID : undefined
}

export const TeamModelPicker: Component<{
  /** `provider/model`；空 = 跟随上级默认。 */
  value?: string
  /** 触发器的无障碍说明，例如「团队模型」「阿甲的模型」。 */
  label: string
  /** 「跟随」这一行的文案（团队：跟随系统默认；成员：跟随团队模型）。 */
  inheritLabel: string
  disabled?: boolean
  class?: string
  onSelect: (model: string | undefined) => void
}> = (props) => {
  const language = useLanguage()
  const models = useModels()
  const [open, setOpen] = createSignal(false)

  const ref = createMemo(() => splitModelRef(props.value))
  const current = createMemo(() => {
    const value = ref()
    if (!value) return undefined
    return models.list().find((model) => model.provider.id === value.providerID && model.id === value.modelID)
  })
  /** 目录里已经没有这个模型时也要显示原 id：不能看起来像「没选」。 */
  const rawName = () => ref()?.modelID ?? props.value

  const list = createMemo(() =>
    models
      .list()
      .filter((model) => models.visible({ modelID: model.id, providerID: model.provider.id }))
      .filter((model) => !isAutoModel(model.provider.id, model.id)),
  )

  const choose = (model: string | undefined) => {
    props.onSelect(model)
    setOpen(false)
  }

  return (
    <Kobalte open={open()} onOpenChange={setOpen} modal={false} placement="bottom-start" gutter={4}>
      <Kobalte.Trigger
        type="button"
        class={`flex min-w-0 max-w-48 items-center gap-1 rounded-md border border-border px-1.5 py-0.5 text-ui-xs text-foreground-subtle transition-colors hover:bg-hover disabled:opacity-50 ${props.class ?? ""}`}
        disabled={props.disabled}
        aria-label={props.label}
        title={props.value ?? props.inheritLabel}
      >
        <Show when={current()} fallback={<Icon name="lu-brain" size="small" class="shrink-0" />}>
          {(model) => (
            <ProviderIcon
              id={modelIconId(model().provider.id, model().provider.name, model().id, model().name)}
              colorId={modelIconId(model().provider.id, model().provider.name, model().id, model().name)}
              brand
              class="size-3.5 shrink-0"
            />
          )}
        </Show>
        <span class="min-w-0 truncate">{current()?.name ?? (props.value ? rawName() : props.inheritLabel)}</span>
        <Icon name="chevron-down" size="small" class="shrink-0 opacity-60" />
      </Kobalte.Trigger>
      <Kobalte.Portal>
        <Kobalte.Content class="z-50 flex h-80 w-72 flex-col overflow-hidden rounded-md border border-border bg-popover p-2 shadow-md outline-none">
          <Kobalte.Title class="sr-only">{props.label}</Kobalte.Title>
          {/* 跟随不是一个空状态，而是一行可选的值：选中它就表示「交给上级」。 */}
          <button
            type="button"
            class="flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-13-regular text-foreground-subtle transition-colors hover:bg-hover"
            classList={{ "bg-surface text-foreground": !props.value }}
            onClick={() => choose(undefined)}
          >
            <Icon name="lu-users" size="small" class="shrink-0" />
            <span class="min-w-0 flex-1 truncate">{props.inheritLabel}</span>
            <Show when={!props.value}>
              <Icon name="circle-check" size="small" class="shrink-0 text-primary" />
            </Show>
          </button>
          <List
            class="mt-1 min-h-0 flex-1 [&_[data-slot=list-scroll]]:min-h-0 [&_[data-slot=list-scroll]]:flex-1"
            search={{ placeholder: language.t("dialog.model.search.placeholder"), autofocus: true }}
            emptyMessage={language.t("dialog.model.empty")}
            key={(x) => `${x.provider.id}:${x.id}`}
            items={list()}
            current={current()}
            filterKeys={["provider.name", "name", "id"]}
            sortBy={(a, b) => a.name.localeCompare(b.name)}
            groupBy={(x) => x.provider.name}
            onSelect={(x) => {
              if (!x) return
              choose(`${x.provider.id}/${x.id}`)
            }}
          >
            {(item) => (
              <div class="flex w-full items-center gap-x-2 text-13-regular">
                <ProviderIcon
                  id={modelIconId(item.provider.id, item.provider.name, item.id, item.name)}
                  colorId={modelIconId(item.provider.id, item.provider.name, item.id, item.name)}
                  brand
                  class="size-4 shrink-0 text-foreground-subtle"
                />
                <span class="truncate">{item.name}</span>
              </div>
            )}
          </List>
        </Kobalte.Content>
      </Kobalte.Portal>
    </Kobalte>
  )
}
